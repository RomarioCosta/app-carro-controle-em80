/*
 * Comunicação com o servidor (Google Apps Script).
 * - Modo "appsscript": app aberto pelo link do Apps Script -> usa google.script.run.
 * - Modo "web": app hospedado como site (PWA) -> usa fetch para a URL do Apps Script.
 */
'use strict';

(function (App) {
  const { U } = App;
  const TIMEOUT_MS = 45000;

  class ErroApi extends Error {
    constructor(codigo, mensagem) {
      super(mensagem);
      this.codigo = codigo;
    }
  }

  function modo() {
    return window.google && google.script && google.script.run ? 'appsscript' : 'web';
  }

  const config = {
    url: () => U.pref.get('apiUrl', ''),
    token: () => U.pref.get('apiToken', ''),
    setUrl: (v) => U.pref.set('apiUrl', String(v || '').trim()),
    setToken: (v) => U.pref.set('apiToken', String(v || '').trim().toUpperCase())
  };

  function configurado() {
    return modo() === 'appsscript' || /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(config.url());
  }

  function viaAppsScript(pedido) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ErroApi('REDE', 'Tempo esgotado ao falar com o servidor.')), TIMEOUT_MS);
      google.script.run
        .withSuccessHandler((r) => {
          clearTimeout(timer);
          resolve(r);
        })
        .withFailureHandler((e) => {
          clearTimeout(timer);
          reject(new ErroApi('REDE', (e && e.message) || 'Falha de comunicação com o servidor.'));
        })
        .apiCall(pedido);
    });
  }

  async function viaFetch(pedido) {
    const url = config.url();
    if (!url) throw new ErroApi('CONFIG', 'Informe a URL do servidor em Ajustes.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        // text/plain evita a verificação prévia (CORS) que o Apps Script não suporta.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(pedido),
        redirect: 'follow',
        signal: ctrl.signal
      });
      if (!resp.ok) throw new ErroApi('REDE', `Servidor respondeu com erro ${resp.status}.`);
      const texto = await resp.text();
      try {
        return JSON.parse(texto);
      } catch (e) {
        throw new ErroApi('CONFIG', 'Resposta inesperada do servidor. Confira a URL e a implantação (acesso "Qualquer pessoa").');
      }
    } catch (e) {
      if (e instanceof ErroApi) throw e;
      throw new ErroApi('REDE', e.name === 'AbortError' ? 'Tempo esgotado ao falar com o servidor.' : 'Sem conexão com o servidor.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function chamar(acao, dados = {}) {
    const pedido = { acao, dados, token: config.token() };
    const r = modo() === 'appsscript' ? await viaAppsScript(pedido) : await viaFetch(pedido);
    if (!r || typeof r !== 'object') throw new ErroApi('ERRO', 'Resposta vazia do servidor.');
    if (!r.ok) {
      const err = new ErroApi(r.codigo || 'ERRO', r.erro || 'Erro no servidor.');
      if (err.codigo === 'AUTH') document.dispatchEvent(new CustomEvent('em80:auth'));
      throw err;
    }
    return r.dados;
  }

  App.api = { chamar, modo, configurado, config, ErroApi };
})(window.App);
