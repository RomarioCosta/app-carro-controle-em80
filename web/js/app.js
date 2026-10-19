/* Estrutura do app: cabeçalho, navegação entre telas, gaveta de anomalia e inicialização. */
'use strict';

(function (App) {
  const { U, ui, api, sync } = App;
  const { h } = ui;

  const telas = new Map(); // id -> { modulo, el, montado }
  let navEl;
  let badgeEl;
  let temaBtn;
  let gaveta;
  let gavetaFundo;
  let puxador;
  let gavetaMontada = false;
  let atual = null;

  function cabecalho() {
    badgeEl = h('button', { class: 'sync-badge', onclick: () => ir('ajustes') });
    temaBtn = h('button', {
      class: 'btn-icone btn-cab',
      onclick: () => ui.tema.alternar()
    });
    atualizarBotaoTema();
    return h('header', { class: 'cab' },
      h('div', { class: 'cab-marca' },
        h('img', { class: 'cab-foto', src: 'img/carro.jpg', alt: 'Carro controle EM80', width: 112, height: 72 }),
        h('div', { class: 'cab-titulos' },
          h('span', { class: 'cab-titulo', text: 'Carro Controle EM80' }),
          h('span', { class: 'cab-sub', text: 'Centro de Monitoramento de Ativos' })),
        h('div', { class: 'cab-logo', 'aria-hidden': 'true' })),
      h('div', { class: 'cab-acoes' }, badgeEl,
        h('button', { class: 'btn-icone', 'aria-label': 'Relatório de anomalia', title: 'Relatório de anomalia', onclick: () => abrirGaveta() }, ui.icone('alerta')),
        temaBtn));
  }

  function atualizarBotaoTema() {
    const escuro = ui.tema.atual() === 'escuro';
    ui.trocar(temaBtn, ui.icone(escuro ? 'sol' : 'lua'));
    temaBtn.setAttribute('aria-label', escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    temaBtn.title = escuro ? 'Tema claro' : 'Tema escuro';
  }

  function atualizarBadge(e) {
    let icone = 'nuvem';
    let num = '';
    let texto = 'Enviado';
    let classe = 'ok';
    if (e.sincronizando) {
      icone = 'sync'; texto = 'Enviando…'; classe = 'girando';
    } else if (e.pendentes) {
      icone = e.erro || e.comErro ? 'semNuvem' : 'nuvem';
      num = String(e.pendentes);
      texto = ` pendente${e.pendentes > 1 ? 's' : ''}`;
      classe = e.erro || e.comErro ? 'erro' : 'pendente';
    }
    badgeEl.className = `sync-badge ${classe}`;
    const descricao = e.pendentes ? `${e.pendentes} registro(s) aguardando envio` : 'Tudo enviado';
    badgeEl.title = e.erro ? `Sincronização: ${e.erro}` : descricao;
    badgeEl.setAttribute('aria-label', `${descricao}. Abrir sincronização.`);
    ui.trocar(badgeEl, ui.icone(icone), num ? h('span', { class: 'b-num', text: num }) : null, h('span', { class: 'b-txt', text: texto }));
  }

  /* ---------------- Navegação ---------------- */

  function ir(id) {
    const t = telas.get(id);
    if (!t) return;
    if (!t.montado) {
      t.modulo.montar(t.el);
      t.montado = true;
    }
    telas.forEach((x, k) => { x.el.hidden = k !== id; });
    navEl.querySelectorAll('button').forEach((b) => {
      if (b.dataset.id === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (atual !== id) window.scrollTo(0, 0);
    atual = id;
    U.pref.set('aba', id);
    Promise.resolve(t.modulo.aoMostrar && t.modulo.aoMostrar()).catch((e) => console.error(e));
  }

  /* ---------------- Gaveta de anomalia ---------------- */

  function criarGaveta() {
    gavetaFundo = h('div', { class: 'gaveta-fundo', hidden: true, onclick: fecharGaveta });
    gaveta = h('aside', { class: 'gaveta', 'aria-label': 'Relatório de anomalia', 'aria-hidden': 'true', inert: true },
      h('div', { class: 'gaveta-cab' },
        h('h2', { text: 'Relatório de Anomalia' }),
        h('button', { class: 'btn-icone', 'aria-label': 'Fechar', onclick: fecharGaveta }, ui.icone('x'))),
      h('div', { class: 'gaveta-corpo' }));
    puxador = h('button', { class: 'puxador', onclick: abrirGaveta, 'aria-label': 'Abrir relatório de anomalia' },
      ui.icone('alerta'), h('span', { text: 'Anomalia' }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && gaveta.classList.contains('aberta') && !document.querySelector('.modal-fundo')) fecharGaveta();
    });
    return [gavetaFundo, gaveta, puxador];
  }

  let abertaEm = 0;

  function abrirGaveta() {
    if (gaveta.classList.contains('aberta')) return;
    try {
      if (!gavetaMontada) {
        App.anomalia.montar(gaveta);
        gavetaMontada = true;
      }
    } catch (e) {
      console.error(e);
      ui.toast(`Não foi possível abrir o relatório: ${e.message}`, 'erro', 8000);
      return;
    }
    abertaEm = Date.now();
    gaveta.classList.add('aberta');
    gaveta.removeAttribute('aria-hidden');
    gaveta.removeAttribute('inert');
    gavetaFundo.hidden = false;
    puxador.hidden = true;
    document.body.classList.add('sem-rolagem');
    Promise.resolve().then(() => App.anomalia.aoAbrir()).catch((e) => console.error(e));
    setTimeout(() => {
      const primeiro = gaveta.querySelector('input:not([type=hidden]), textarea');
      if (primeiro && window.matchMedia('(min-width: 900px)').matches) primeiro.focus();
    }, 250);
  }

  function fecharGaveta(ev) {
    // Ignora o "clique fantasma" que alguns celulares disparam logo após o toque que abriu a gaveta.
    if (ev && ev.currentTarget === gavetaFundo && Date.now() - abertaEm < 600) return;
    gaveta.classList.remove('aberta');
    gaveta.setAttribute('aria-hidden', 'true');
    gaveta.setAttribute('inert', '');
    gavetaFundo.hidden = true;
    puxador.hidden = false;
    document.body.classList.remove('sem-rolagem');
    puxador.focus();
  }

  /* ---------------- Código de acesso ---------------- */

  let pedindoCodigo = false;
  let adiado = false; // "Depois": não pergunta de novo nesta sessão (dá para informar em Ajustes)
  function pedirCodigo() {
    if (pedindoCodigo || adiado) return;
    pedindoCodigo = true;
    const input = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', value: api.config.token() });
    ui.modal({
      titulo: 'Código de acesso',
      conteudo: h('div', { class: 'pilha' },
        h('p', { text: 'Informe o código de acesso gerado na instalação (função setup do Apps Script).' }),
        ui.campo('Código', input)),
      acoes: [
        { texto: 'Depois', classe: 'btn-secundario', onClick: (f) => { adiado = true; f(); } },
        {
          texto: 'Salvar',
          classe: 'btn-primario',
          onClick: (f) => {
            api.config.setToken(input.value);
            f();
            sync.sincronizar({ forcar: true });
          }
        }
      ],
      aoFechar: () => { setTimeout(() => { pedindoCodigo = false; }, 3000); }
    });
  }

  /* ---------------- Inicialização ---------------- */

  function registrarServiceWorker() {
    if (api.modo() !== 'web' || !('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado:', e));
  }

  function iniciar() {
    ui.tema.aplicar(ui.tema.atual());
    const raiz = document.getElementById('app');
    const principal = h('main', { class: 'principal', id: 'conteudo' });
    navEl = h('nav', { class: 'nav', 'aria-label': 'Telas' });

    App.modulos.forEach((m) => {
      const el = h('section', { class: 'tela', hidden: true, 'aria-label': m.titulo });
      principal.appendChild(el);
      telas.set(m.id, { modulo: m, el, montado: false });
      navEl.appendChild(h('button', { dataset: { id: m.id }, onclick: () => ir(m.id) },
        ui.icone(m.icone), h('span', { text: m.titulo })));
    });

    ui.trocar(raiz, cabecalho(), navEl, principal, criarGaveta());

    document.addEventListener('em80:sync', (e) => atualizarBadge(e.detail));
    document.addEventListener('em80:tema', atualizarBotaoTema);
    document.addEventListener('em80:auth', pedirCodigo);
    atualizarBadge(sync.estado);

    const inicial = !api.configurado() ? 'ajustes' : U.pref.get('aba', 'checklist');
    ir(telas.has(inicial) ? inicial : 'checklist');
    if (!api.configurado()) ui.toast('Configure a conexão com a planilha para enviar os dados.', 'info', 6000);

    sync.iniciar();
    registrarServiceWorker();
  }

  // Erros inesperados aparecem na tela, para facilitar o diagnóstico em campo.
  const avisados = new Set();
  function avisarErro(erro) {
    console.error(erro);
    if (erro && erro.codigo) return; // erros de comunicação já são tratados na tela
    const msg = String((erro && erro.message) || erro || 'erro desconhecido');
    if (avisados.has(msg)) return;
    avisados.add(msg);
    try { ui.toast(`Erro inesperado: ${msg}`, 'erro', 8000); } catch (e) { /* ignora */ }
  }
  window.addEventListener('error', (e) => avisarErro(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => avisarErro(e.reason));

  App.iniciar = iniciar;
  App.ir = ir;
  iniciar();
})(window.App);
