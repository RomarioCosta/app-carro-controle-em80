/*
 * Desenho esquemático da malha (como o "Lay Out" da planilha da rota):
 * pátios (RH) numerados, ligados pelas linhas L1, L2… de cada EH, com a rota por cima.
 * Gera SVG puro: o mesmo desenho serve para a tela (tocar nos trechos) e para o PDF.
 */
'use strict';

(function (App) {
  const NS = 'http://www.w3.org/2000/svg';
  const M = App.malha;

  function s(tag, attrs = {}, ...filhos) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v); });
    filhos.flat().forEach((f) => { if (f !== null && f !== undefined) el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return el;
  }

  const LARG_EH = 66;
  const LARG_RH = 34;
    const TOPO = 26; // número do pátio e km
  const BASE = 22; // etiquetas dos pontos de atenção

  /**
   * op: {
   *   ramal,                       // da malha
   *   largura,                     // px disponíveis
   *   camadas: [{ trechos: Set, cor, estilo: 'cheio'|'tracejado'|'fino', desloc }],
   *   pontos: [{ id, trecho, cor, texto, titulo }],
   *   inicioIntervalo,             // trecho marcado como início ("de… até…")
   *   faixa: { i0, i1 },           // só parte do ramal (PDF)
   *   aoTocar(trecho), aoTocarPonto(ponto)
   * }
   */
  const ESQ = 24;

  /** Distribui as unidades em filas (como as linhas da planilha), conforme a largura. */
  function distribuir(r, largura, faixa) {
    const utilW = largura - ESQ - 6;
    const i0 = faixa ? Math.max(0, faixa.i0) : 0;
    const i1 = faixa ? Math.min(r.unidades.length - 1, faixa.i1) : r.unidades.length - 1;
    const fator = Math.min(1.3, Math.max(0.7, utilW / 900));
    const posicoes = [];
    let x = 0; let fila = 0;
    for (let i = i0; i <= i1; i++) {
      const u = r.unidades[i];
      const w = (u.tipo === 'RH' ? LARG_RH : LARG_EH) * fator;
      if (x + w > utilW && x > 0) { fila++; x = 0; }
      posicoes.push({ u, i, x: ESQ + x, w, fila });
      x += w;
    }
    return posicoes;
  }

  /** Faixas (i0, i1) de cada fila do desenho: o PDF desenha uma fila por vez para quebrar página entre elas. */
  function filas(r, largura, faixa) {
    const lista = [];
    distribuir(r, Math.max(300, Math.round(largura || 900)), faixa).forEach((p) => {
      if (!lista[p.fila]) lista[p.fila] = { i0: p.i, i1: p.i };
      lista[p.fila].i1 = p.i;
    });
    return lista;
  }

  function desenhar(op) {
    const r = op.ramal;
    const linhas = r.linhas;
    const nL = linhas.length;
    const largura = Math.max(300, Math.round(op.largura || 900));
    const esq = ESQ;
    const posicoes = distribuir(r, largura, op.faixa);
    const PASSO_LINHA = largura < 600 ? 20 : 13; // no celular, linhas mais afastadas para acertar o toque
    const fila = posicoes.length ? posicoes[posicoes.length - 1].fila : 0;
    const altFila = TOPO + (nL - 1) * PASSO_LINHA + 8 + BASE;
    const filas = fila + 1;
    const H = filas * altFila + 6;
    const svg = s('svg', { viewBox: `0 0 ${largura} ${H}`, width: largura, height: H, class: 'esquema', role: 'img', 'aria-label': `Esquema ${r.nome}` });
    const yLinha = (f, k) => f * altFila + TOPO + k * PASSO_LINHA;

    // Rótulos das linhas no começo de cada fila.
    for (let f = 0; f < filas; f++) {
      const presentes = new Set(posicoes.filter((p) => p.fila === f).flatMap((p) => p.u.linhas));
      linhas.forEach((l, k) => { if (presentes.has(l)) svg.appendChild(s('text', { x: 2, y: yLinha(f, k) + 3, class: 'esq-rot-linha' }, `L${l}`)); });
    }

    const gBase = s('g', { class: 'esq-base' });
    const gRota = s('g', { class: 'esq-rota' });
    const gTxt = s('g');
    const gPontos = s('g');
    const gAlvo = s('g');

    posicoes.forEach(({ u, x: ux, w, fila: f }) => {
      const tem = (l) => u.linhas.includes(l);
      if (u.tipo === 'RH') {
        const ks = linhas.map((l, k) => (tem(l) ? k : -1)).filter((k) => k >= 0);
        const ya = yLinha(f, Math.min(...ks)) - 5;
        const yb = yLinha(f, Math.max(...ks)) + 5;
        gBase.appendChild(s('rect', { x: ux + 2, y: ya, width: Math.max(4, w - 4), height: yb - ya, rx: 3, class: 'esq-patio' }));
        gTxt.appendChild(s('text', { x: ux + w / 2, y: f * altFila + 11, class: 'esq-num', 'text-anchor': 'middle' }, u.curto));
        gTxt.appendChild(s('text', { x: ux + w / 2, y: f * altFila + 20, class: 'esq-km', 'text-anchor': 'middle' }, M.fmtKm(u.ini)));
      }
      linhas.forEach((l, k) => {
        if (!tem(l)) return;
        const y = yLinha(f, k);
        gBase.appendChild(s('line', { x1: ux, x2: ux + w, y1: y, y2: y, class: u.tipo === 'RH' ? 'esq-trilho esq-trilho-rh' : 'esq-trilho' }));
        const t = M.trecho(u.id, l);
        (op.camadas || []).forEach((c) => {
          if (!c.trechos.has(t)) return;
          const dy = c.desloc || 0;
          gRota.appendChild(s('line', {
            x1: ux, x2: ux + w, y1: y + dy, y2: y + dy,
            class: `esq-camada esq-${c.estilo || 'cheio'}`,
            stroke: c.cor
          }));
        });
        if (op.inicioIntervalo === t) gRota.appendChild(s('circle', { cx: ux + w / 2, cy: y, r: 7, class: 'esq-inicio' }));
        if (op.aoTocar) {
          const alvo = s('rect', { x: ux, y: y - PASSO_LINHA / 2, width: w, height: PASSO_LINHA, class: 'esq-alvo', 'data-trecho': t },
            s('title', {}, `${u.rotulo} · L${l} · km ${M.fmtKm(u.ini)} a ${M.fmtKm(u.fim)}`));
          alvo.addEventListener('click', () => op.aoTocar(t, u, l));
          gAlvo.appendChild(alvo);
        }
      });
    });

    // Pontos de atenção (etiquetas coloridas abaixo do trecho).
    const porUnidade = new Map();
    (op.pontos || []).forEach((p) => {
      const { id } = M.separar(p.trecho || '');
      if (!porUnidade.has(id)) porUnidade.set(id, []);
      porUnidade.get(id).push(p);
    });
    posicoes.forEach(({ u, x: ux, w, fila: f }) => {
      const lista = porUnidade.get(u.id);
      if (!lista) return;
      const y = yLinha(f, nL - 1) + 9;
      const mostrar = lista.length > 2 ? [lista[0], { ...lista[1], texto: `+${lista.length - 1}`, titulo: lista.slice(1).map((p) => p.titulo || p.texto).join('\n') }] : lista;
      const larg = Math.max(52, w - 2) / mostrar.length; // etiqueta legível mesmo sobre um pátio estreito
      mostrar.forEach((p, n) => {
        const g = s('g', { class: 'esq-ponto', transform: `translate(${(ux + 1 + n * larg).toFixed(1)},${y})` },
          s('rect', { width: Math.max(8, larg - 1).toFixed(1), height: 12, rx: 2, fill: p.cor }),
          s('text', { x: 2, y: 9, class: 'esq-ponto-txt' }, String(p.texto || '').slice(0, Math.max(3, Math.floor(larg / 4.6)))),
          s('title', {}, p.titulo || p.texto || ''));
        if (op.aoTocarPonto) g.addEventListener('click', (e) => { e.stopPropagation(); op.aoTocarPonto(lista[n] && n < 1 ? lista[n] : lista[1] || lista[0]); });
        gPontos.appendChild(g);
      });
    });

    svg.append(gBase, gRota, gTxt, gAlvo, gPontos);
    return svg;
  }

  /** Faixa de unidades (índices) que contém os trechos e pontos, com uma folga. */
  function faixaDe(ramal, trechos, folga = 1) {
    let a = Infinity; let b = -Infinity;
    ramal.unidades.forEach((u, i) => {
      if (trechos.some((t) => M.separar(t).id === u.id)) { a = Math.min(a, i); b = Math.max(b, i); }
    });
    if (!Number.isFinite(a)) return null;
    return { i0: Math.max(0, a - folga), i1: Math.min(ramal.unidades.length - 1, b + folga) };
  }

  App.esquema = { desenhar, faixaDe, filas };
})(window.App);
