/* Ajustes: conexão com o servidor, sincronização, tema e dados do aparelho. */
'use strict';

(function (App) {
  const { U, ui, api, sync, store, config } = App;
  const { h } = ui;

  const NOMES_TIPO = {
    checklist: 'Checklist',
    evento: 'Evento',
    anomalia: 'Anomalia',
    execucao: 'Marcação de OM',
    reprogramacao: 'Reprogramação de OM'
  };

  let raiz;
  let conexaoEl;
  let syncEl;
  let temaEl;

  function montar(el) {
    raiz = el;
    conexaoEl = h('section', { class: 'cartao' });
    syncEl = h('section', { class: 'cartao' });
    temaEl = h('section', { class: 'cartao' });
    raiz.append(
      h('div', { class: 'tela-cab' }, h('h1', { text: 'Ajustes' })),
      conexaoEl, syncEl, temaEl,
      h('section', { class: 'cartao' },
        h('h2', { text: 'Sobre' }),
        h('p', { class: 'sub', text: `App Carro Controle EM80 · versão ${config.versao} · modo ${api.modo() === 'appsscript' ? 'Apps Script' : 'site (PWA)'}` }),
        h('button', { class: 'btn btn-perigo', onclick: apagarDados }, ui.icone('lixo'), 'Apagar dados deste aparelho')));
    renderConexao();
    renderTema();
    document.addEventListener('em80:sync', () => renderSync());
    document.addEventListener('em80:tema', () => renderTema());
  }

  function renderConexao() {
    const web = api.modo() === 'web';
    const url = h('input', { type: 'url', name: 'url', value: api.config.url(), placeholder: 'https://script.google.com/macros/s/.../exec' });
    const token = h('input', { type: 'text', name: 'token', value: api.config.token(), autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: 40 });
    const status = h('p', { class: 'sub' });

    const testar = async () => {
      if (web) api.config.setUrl(url.value);
      api.config.setToken(token.value);
      status.textContent = 'Testando…';
      try {
        const r = await api.chamar('ping');
        status.textContent = `Conectado. Servidor versão ${r.versao}.`;
        ui.toast('Conexão funcionando.', 'ok');
        sync.sincronizar({ forcar: true });
      } catch (e) {
        status.textContent = `Falhou: ${e.message}`;
      }
    };

    ui.trocar(conexaoEl,
      h('h2', { text: 'Conexão com a planilha' }),
      h('form', { class: 'pilha', onsubmit: (e) => { e.preventDefault(); testar(); } },
        web ? ui.campo('URL do servidor (Apps Script)', url, { ajuda: 'Link da implantação do Apps Script, terminado em /exec.' }) : null,
        ui.campo('Código de acesso', token, { ajuda: 'Gerado pela função setup() do Apps Script.' }),
        h('div', { class: 'barra-acoes' }, h('button', { type: 'submit', class: 'btn btn-primario' }, 'Salvar e testar')),
        status));
  }

  async function renderSync() {
    if (!syncEl) return;
    const e = sync.estado;
    const itens = await sync.listar();
    ui.trocar(syncEl,
      h('h2', { text: 'Sincronização' }),
      h('p', null,
        e.pendentes ? `${e.pendentes} registro(s) aguardando envio.` : 'Tudo enviado para a planilha.',
        e.ultimoSucesso ? h('span', { class: 'sub', text: ` Último envio: ${U.fmtDataHora(e.ultimoSucesso)}.` }) : null),
      e.erro ? h('p', { class: 'aviso aviso-erro', text: e.erro }) : null,
      itens.length ? h('div', { class: 'lista' }, itens.slice(0, 50).map((i) => h('div', { class: 'item' },
        h('div', { class: 'item-principal' },
          h('strong', { text: NOMES_TIPO[i.tipo] || i.tipo }),
          h('span', { class: 'item-sub', text: `Salvo em ${U.fmtDataHora(i.em)}` }),
          i.erro ? h('span', { class: 'item-obs erro', text: `Erro: ${i.erro}` }) : null)))) : null,
      h('div', { class: 'barra-acoes' },
        h('button', {
          class: 'btn btn-primario',
          disabled: e.sincronizando,
          onclick: () => sync.sincronizar({ forcar: true })
        }, ui.icone('sync'), e.sincronizando ? 'Sincronizando…' : 'Sincronizar agora')));
  }

  function renderTema() {
    if (!temaEl) return;
    const atual = ui.tema.atual();
    const opcao = (valor, rotulo, ic) => h('button', {
      class: `seg-opcao${atual === valor ? ' ativo' : ''}`,
      'aria-pressed': atual === valor ? 'true' : 'false',
      onclick: () => {
        U.pref.set('tema', valor);
        ui.tema.aplicar(valor);
      }
    }, ui.icone(ic), rotulo);
    ui.trocar(temaEl,
      h('h2', { text: 'Aparência' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' }, opcao('claro', 'Claro', 'sol'), opcao('escuro', 'Escuro', 'lua')));
  }

  async function apagarDados() {
    const pend = sync.estado.pendentes;
    const texto = pend
      ? `Atenção: ${pend} registro(s) ainda NÃO foram enviados à planilha e serão perdidos. Apagar mesmo assim?`
      : 'Os dados já estão na planilha. Isso apaga apenas a cópia guardada neste aparelho.';
    const ok = await ui.confirmar('Apagar dados do aparelho', texto, { ok: 'Apagar', perigo: true });
    if (!ok) return;
    await store.limparTudo();
    ['rascunho:checklist', 'rascunho:anomalia', 'cicloAtivo', 'ultimoSync'].forEach((k) => U.pref.del(k));
    ui.toast('Dados do aparelho apagados.', 'ok');
    setTimeout(() => location.reload(), 800);
  }

  function aoMostrar() {
    renderSync();
  }

  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'ajustes', titulo: 'Ajustes', icone: 'ajustes', montar, aoMostrar });
})(window.App);
