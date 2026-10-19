/* Componentes de interface: criação de elementos, ícones, avisos, janelas e tema. */
'use strict';

(function (App) {
  const { U } = App;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Cria um elemento. Textos são sempre inseridos como texto (nunca como HTML),
   * o que evita problemas com caracteres especiais digitados pelo usuário.
   * h('button', { class: 'btn', onclick: fn, text: 'Salvar' })
   */
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    const a = attrs || {};
    aplicarAttrs(el, a);
    anexar(el, filhos);
    // "value" depois dos filhos, para funcionar em <select> com <option>.
    if (a.value !== undefined && a.value !== null) el.value = a.value;
    return el;
  }

  function aplicarAttrs(el, attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') { /* aplicado depois dos filhos */ }
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }

  function anexar(el, filhos) {
    filhos.flat(Infinity).forEach((f) => {
      if (f === null || f === undefined || f === false) return;
      el.appendChild(f instanceof Node ? f : document.createTextNode(String(f)));
    });
  }

  function limpar(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function trocar(el, ...filhos) {
    limpar(el);
    anexar(el, filhos);
    return el;
  }

  /* ---------- Ícones (traço simples, 24×24) ---------- */
  const ICONES = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    sync: 'M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5M5 3v4h4M19 21v-4h-4',
    sol: 'M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
    lua: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
    alerta: 'M12 3l10 18H2L12 3zM12 10v4.5M12 17.5v.5',
    grafico: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    ajustes: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
    esquerda: 'M15 5l-7 7 7 7',
    direita: 'M9 5l7 7-7 7',
    copiar: 'M8 8h11v12H8zM5 16V4h11',
    editar: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    relogio: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3.5 2',
    play: 'M8 5v14l11-7z',
    parar: 'M7 7h10v10H7z',
    lixo: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    calendario: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
    mais: 'M5 12h.01M12 12h.01M19 12h.01',
    duplicar: 'M8 8h11v12H8zM5 16V4h11M13.5 11v6M10.5 14h6',
    enviar: 'M4 12l16-8-6 16-3-7-7-1z',
    nuvem: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
    semNuvem: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18zM4 4l16 16',
    busca: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM20 20l-4.8-4.8',
    pino: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'
  };

  function icone(nome, classe = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `ico ${classe}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONES[nome] || ICONES.mais);
    svg.appendChild(p);
    return svg;
  }

  /* ---------- Avisos rápidos ---------- */
  function toast(msg, tipo = 'info', ms = 3200) {
    let area = document.getElementById('toasts');
    if (!area) {
      area = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(area);
    }
    const t = h('div', { class: `toast toast-${tipo}` }, msg);
    area.appendChild(t);
    setTimeout(() => {
      t.classList.add('saindo');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* ---------- Janela (modal) ---------- */
  function modal({ titulo, conteudo, acoes = [], aoFechar }) {
    const anterior = document.activeElement;
    const fundo = h('div', { class: 'modal-fundo' });
    const fechar = () => {
      fundo.remove();
      document.removeEventListener('keydown', teclas);
      if (aoFechar) aoFechar();
      if (anterior && anterior.focus) anterior.focus();
    };
    const teclas = (e) => {
      if (e.key === 'Escape') fechar();
    };
    const caixa = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('div', { class: 'modal-cab' },
        h('h2', { text: titulo }),
        h('button', { class: 'btn-icone', 'aria-label': 'Fechar', onclick: fechar }, icone('x'))),
      h('div', { class: 'modal-corpo' }, conteudo),
      acoes.length ? h('div', { class: 'modal-acoes' }, acoes.map((a) => h('button', {
        class: `btn ${a.classe || ''}`,
        text: a.texto,
        onclick: () => a.onClick(fechar)
      }))) : null);
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) fechar();
    });
    fundo.appendChild(caixa);
    document.body.appendChild(fundo);
    document.addEventListener('keydown', teclas);
    const foco = caixa.querySelector('input, select, textarea, .modal-acoes .btn');
    if (foco) setTimeout(() => foco.focus(), 30);
    return { fechar, caixa };
  }

  function confirmar(titulo, texto, { ok = 'Confirmar', perigo = false } = {}) {
    return new Promise((resolve) => {
      let resposta = false;
      modal({
        titulo,
        conteudo: h('p', { text: texto }),
        acoes: [
          { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
          { texto: ok, classe: perigo ? 'btn-perigo' : 'btn-primario', onClick: (f) => { resposta = true; f(); } }
        ],
        aoFechar: () => resolve(resposta)
      });
    });
  }

  /* ---------- Copiar texto ---------- */
  async function copiar(texto) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch (e) { /* tenta o método alternativo */ }
    try {
      const ta = h('textarea', { value: texto, readonly: true, style: { position: 'fixed', top: '-1000px', opacity: '0' } });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Tema claro/escuro ---------- */
  const tema = {
    atual() {
      const salvo = U.pref.get('tema', null);
      if (salvo === 'claro' || salvo === 'escuro') return salvo;
      return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
    },
    aplicar(t) {
      document.documentElement.setAttribute('data-theme', t === 'escuro' ? 'dark' : 'light');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'escuro' ? '#0f1519' : '#33434e');
      document.dispatchEvent(new CustomEvent('em80:tema', { detail: t }));
    },
    alternar() {
      const novo = tema.atual() === 'escuro' ? 'claro' : 'escuro';
      U.pref.set('tema', novo);
      tema.aplicar(novo);
      return novo;
    }
  };

  /* ---------- Formulário ---------- */
  function campo(rotulo, controle, { ajuda, obrigatorio, classe } = {}) {
    const id = controle.id || `c-${U.uuid().slice(0, 8)}`;
    controle.id = id;
    return h('div', { class: `campo ${classe || ''}` },
      h('label', { for: id }, rotulo, obrigatorio ? h('span', { class: 'obrig', 'aria-hidden': 'true', text: ' *' }) : null),
      controle,
      ajuda ? h('small', { class: 'ajuda', text: ajuda }) : null);
  }

  function marcarErro(el, msg) {
    const c = el.closest('.campo, .pergunta') || el;
    c.classList.add('com-erro');
    let m = c.querySelector(':scope > .msg-erro');
    if (!m) {
      m = h('div', { class: 'msg-erro', role: 'alert' });
      c.appendChild(m);
    }
    m.textContent = msg;
  }

  function limparErros(raiz) {
    raiz.querySelectorAll('.com-erro').forEach((c) => c.classList.remove('com-erro'));
    raiz.querySelectorAll('.msg-erro').forEach((m) => m.remove());
  }

  function rolarAte(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const foco = el.matches('input, textarea, select, button') ? el : el.querySelector('input, textarea, select, button');
    if (foco) setTimeout(() => foco.focus({ preventScroll: true }), 300);
  }

  App.ui = { h, limpar, trocar, icone, toast, modal, confirmar, copiar, tema, campo, marcarErro, limparErros, rolarAte };
})(window.App);
