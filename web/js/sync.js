/*
 * Fila de sincronização.
 * Cada registro salvo entra na fila com uma chave única (tipo:id).
 * Salvar o mesmo registro de novo substitui o item da fila (não duplica).
 * O servidor grava de forma idempotente, então reenviar é sempre seguro.
 */
'use strict';

(function (App) {
  const { U, store, api } = App;
  const CHAVE_FILA = 'fila';
  const LOTE = 50;
  const INTERVALO_MS = 60000;

  const estado = {
    pendentes: 0,
    comErro: 0,
    sincronizando: false,
    ultimoSucesso: U.pref.get('ultimoSync', null),
    erro: null
  };

  let emAndamento = null;

  function notificar() {
    document.dispatchEvent(new CustomEvent('em80:sync', { detail: { ...estado } }));
  }

  async function lerFila() {
    return (await store.get(CHAVE_FILA)) || {};
  }

  async function atualizarContagem() {
    const itens = Object.values(await lerFila());
    estado.pendentes = itens.length;
    estado.comErro = itens.filter((i) => i.erro).length;
    notificar();
  }

  async function enfileirar(tipo, id, dados) {
    const key = `${tipo}:${id}`;
    await store.atualizar(CHAVE_FILA, (fila) => {
      const f = fila || {};
      const anterior = f[key];
      f[key] = {
        key,
        tipo,
        dados: JSON.parse(JSON.stringify(dados)),
        seq: (anterior ? anterior.seq : 0) + 1,
        tentativas: 0,
        erro: null,
        em: U.agora()
      };
      return f;
    });
    await atualizarContagem();
    agendar();
  }

  /** Vários registros de uma vez (ex.: programar 30 OMs): uma só gravação na fila. */
  async function enfileirarVarios(lista) {
    if (!lista.length) return;
    await store.atualizar(CHAVE_FILA, (fila) => {
      const f = fila || {};
      lista.forEach(({ tipo, id, dados }) => {
        const key = `${tipo}:${id}`;
        const anterior = f[key];
        f[key] = { key, tipo, dados: JSON.parse(JSON.stringify(dados)), seq: (anterior ? anterior.seq : 0) + 1, tentativas: 0, erro: null, em: U.agora() };
      });
      return f;
    });
    await atualizarContagem();
    agendar();
  }

  /** Dados pendentes de um tipo, indexados pelo id (para mesclar com o servidor). */
  async function pendentesDoTipo(tipo) {
    const mapa = new Map();
    Object.values(await lerFila()).forEach((i) => {
      if (i.tipo === tipo) mapa.set(i.key.slice(tipo.length + 1), i.dados);
    });
    return mapa;
  }

  async function listar() {
    return Object.values(await lerFila()).sort((a, b) => a.em.localeCompare(b.em));
  }

  async function executar(forcar) {
    if (!api.configurado()) {
      estado.erro = 'Servidor não configurado (veja Ajustes).';
      return notificar();
    }
    if (!forcar && navigator.onLine === false) return;

    const itens = await listar();
    if (!itens.length) {
      estado.erro = null;
      return atualizarContagem();
    }

    estado.sincronizando = true;
    notificar();
    try {
      for (let i = 0; i < itens.length; i += LOTE) {
        const lote = itens.slice(i, i + LOTE);
        const resp = await api.chamar('sync', {
          itens: lote.map((it) => ({ key: it.key, tipo: it.tipo, dados: it.dados }))
        });
        const enviados = new Map(lote.map((it) => [it.key, it.seq]));
        await store.atualizar(CHAVE_FILA, (fila) => {
          const f = fila || {};
          (resp.resultados || []).forEach((r) => {
            const atual = f[r.key];
            // Se o registro mudou durante o envio, mantém na fila para enviar a versão nova.
            if (!atual || atual.seq !== enviados.get(r.key)) return;
            if (r.ok) {
              delete f[r.key];
            } else {
              atual.erro = r.erro || 'Erro ao gravar';
              atual.tentativas = (atual.tentativas || 0) + 1;
            }
          });
          return f;
        });
      }
      estado.erro = null;
      estado.ultimoSucesso = U.agora();
      U.pref.set('ultimoSync', estado.ultimoSucesso);
      document.dispatchEvent(new CustomEvent('em80:sincronizado'));
    } catch (e) {
      estado.erro = e.message || 'Falha ao sincronizar.';
    } finally {
      estado.sincronizando = false;
      await atualizarContagem();
    }
  }

  /** Sincroniza agora. Chamadas simultâneas reaproveitam a mesma execução. */
  function sincronizar({ forcar = false } = {}) {
    if (!emAndamento) {
      emAndamento = executar(forcar).finally(() => {
        emAndamento = null;
      });
    }
    return emAndamento;
  }

  const agendar = U.debounce(() => sincronizar(), 1500);

  function iniciar() {
    window.addEventListener('online', () => sincronizar());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sincronizar();
    });
    setInterval(() => {
      if (estado.pendentes > 0) sincronizar();
    }, INTERVALO_MS);
    atualizarContagem().then(() => sincronizar());
  }

  App.sync = { enfileirar, enfileirarVarios, sincronizar, iniciar, listar, pendentesDoTipo, estado, atualizarContagem };
})(window.App);
