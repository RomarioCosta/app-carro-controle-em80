/*
 * Repositório local dos registros (checklists, eventos, anomalias).
 * Salva no aparelho primeiro e coloca na fila de sincronização.
 */
'use strict';

(function (App) {
  const { U, store, sync, api } = App;
  const LIMITE = 200;

  const ordenar = (lista) => lista.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));

  async function listar(colecao) {
    return (await store.get(colecao)) || [];
  }

  async function salvar(tipo, colecao, obj) {
    const agora = U.agora();
    const reg = { ...obj, criadoEm: obj.criadoEm || agora, atualizadoEm: agora };
    await store.atualizar(colecao, (atual) => {
      const lista = (atual || []).filter((x) => x.id !== reg.id);
      lista.push(reg);
      return ordenar(lista).slice(0, LIMITE);
    });
    await sync.enfileirar(tipo, reg.id, reg);
    document.dispatchEvent(new CustomEvent('em80:dados', { detail: { colecao } }));
    return reg;
  }

  /**
   * Atualiza a lista local com o que está na planilha.
   * Registros ainda não sincronizados (ou salvos durante a consulta) têm prioridade.
   */
  async function atualizarDoServidor(tipo, colecao) {
    if (!api.configurado() || navigator.onLine === false) return null;
    const inicio = U.agora();
    const doServidor = await api.chamar('getRecentes', { tipo, limite: LIMITE });
    const resultado = await store.atualizar(colecao, async (atual) => {
      const pendentes = await sync.pendentesDoTipo(tipo);
      const mapa = new Map();
      const locais = new Map((atual || []).map((r) => [r.id, r]));
      // Mescla com a cópia local: campos que o servidor não devolve (ex.: respostas do checklist) são mantidos.
      (doServidor || []).forEach((r) => mapa.set(r.id, { ...(locais.get(r.id) || {}), ...r }));
      (atual || []).forEach((r) => {
        if (!mapa.has(r.id) && String(r.atualizadoEm || '') >= inicio) mapa.set(r.id, r);
      });
      pendentes.forEach((d, id) => mapa.set(id, d));
      return ordenar([...mapa.values()]).slice(0, LIMITE);
    });
    document.dispatchEvent(new CustomEvent('em80:dados', { detail: { colecao } }));
    return resultado;
  }

  App.dados = { listar, salvar, atualizarDoServidor };
})(window.App);
