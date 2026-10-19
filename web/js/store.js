/*
 * Armazenamento local no aparelho (IndexedDB), com alternativa em localStorage.
 * Todas as gravações passam por uma fila única, para que duas alterações
 * rápidas seguidas nunca sobrescrevam uma à outra.
 */
'use strict';

(function (App) {
  const DB_NOME = 'em80';
  const STORE = 'kv';
  let dbPromise = null;

  function abrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open(DB_NOME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  const ls = {
    get(k) {
      try {
        const v = localStorage.getItem(`em80db:${k}`);
        return v === null ? null : JSON.parse(v);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      localStorage.setItem(`em80db:${k}`, JSON.stringify(v));
    },
    del(k) {
      localStorage.removeItem(`em80db:${k}`);
    }
  };

  function req(db, modo, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modo);
      const store = tx.objectStore(STORE);
      let resultado;
      const r = fn(store);
      if (r) r.onsuccess = () => { resultado = r.result; };
      tx.oncomplete = () => resolve(resultado);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
    });
  }

  async function get(k) {
    const db = await abrir();
    if (!db) return ls.get(k);
    const v = await req(db, 'readonly', (s) => s.get(k));
    return v === undefined ? null : v;
  }

  async function setDireto(k, v) {
    const db = await abrir();
    if (!db) return ls.set(k, v);
    await req(db, 'readwrite', (s) => s.put(v, k));
  }

  async function delDireto(k) {
    const db = await abrir();
    if (!db) return ls.del(k);
    await req(db, 'readwrite', (s) => s.delete(k));
  }

  // Fila única de gravações (exclusão mútua).
  let cadeia = Promise.resolve();
  function exclusivo(fn) {
    const p = cadeia.then(fn, fn);
    cadeia = p.catch(() => {});
    return p;
  }

  App.store = {
    get,
    set: (k, v) => exclusivo(() => setDireto(k, v)),
    del: (k) => exclusivo(() => delDireto(k)),
    /** Lê, altera e grava de forma atômica. fn recebe o valor atual e devolve o novo. */
    atualizar: (k, fn) => exclusivo(async () => {
      const atual = await get(k);
      const novo = await fn(atual);
      await setDireto(k, novo);
      return novo;
    }),
    async limparTudo() {
      return exclusivo(async () => {
        const db = await abrir();
        if (db) await req(db, 'readwrite', (s) => s.clear());
        try {
          Object.keys(localStorage).filter((k) => k.startsWith('em80db:')).forEach((k) => localStorage.removeItem(k));
        } catch (e) { /* ignora */ }
      });
    }
  };
})(window.App);
