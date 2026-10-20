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

  const LARG_EH = 84;
  const LARG_RH = 60;
  const TOPO = 36; // caixa do km + número do pátio
  const BASE = 30; // desvio de baixo + etiquetas dos pontos de atenção
  const ESQ = 24;

  /** Distribui as unidades em filas (como as linhas da planilha), conforme a largura. */
  function distribuir(r, largura, faixa) {
    const utilW = largura - ESQ - 6;
    const i0 = faixa ? Math.max(0, faixa.i0) : 0;
    const i1 = faixa ? Math.min(r.unidades.length - 1, faixa.i1) : r.unidades.length - 1;
    const fator = Math.min(1.25, Math.max(0.62, utilW / 1150));
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
   *
   * Desenho como o Lay Out da planilha: cada pátio (RH) com a caixa do km e o número,
   * desvios acima e abaixo e o travessão entre as linhas, onde o carro muda de linha.
   */
  function desenhar(op) {
    const r = op.ramal;
    const linhas = r.linhas;
    const largura = Math.max(300, Math.round(op.largura || 900));
    const posicoes = distribuir(r, largura, op.faixa);
    const PASSO = largura < 600 ? 22 : 18; // no celular, linhas mais afastadas para acertar o toque
    const kDe = (l) => linhas.indexOf(l);

    // Altura de cada fila conforme as linhas que existem nela (L3 só onde houver).
    const nFilas = posicoes.length ? posicoes[posicoes.length - 1].fila + 1 : 1;
    const maxK = [];
    posicoes.forEach((p) => { p.u.linhas.forEach((l) => { maxK[p.fila] = Math.max(maxK[p.fila] ?? 0, kDe(l)); }); });
    const topoFila = [];
    let acc = 0;
    for (let f = 0; f < nFilas; f++) { topoFila[f] = acc; acc += TOPO + (maxK[f] || 0) * PASSO + BASE; }
    const H = acc + 4;
    const yLinha = (f, k) => topoFila[f] + TOPO + k * PASSO;

    const svg = s('svg', { viewBox: `0 0 ${largura} ${H}`, width: largura, height: H, class: 'esquema', role: 'img', 'aria-label': `Esquema ${r.nome}` });
    const gBase = s('g', { class: 'esq-base' });
    const gRota = s('g', { class: 'esq-rota' });
    const gTxt = s('g');
    const gAlvo = s('g');
    const gPontos = s('g');

    // Trilho desenhado como na planilha: barra clara com contorno escuro.
    const trilho = (d, extra = '') => [
      s('path', { d, class: `esq-trilho-borda ${extra}` }),
      s('path', { d, class: `esq-trilho-miolo ${extra}` })
    ];
    const seg = (x1, y1, x2, y2) => `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;

    // Rótulos das linhas no começo de cada fila.
    for (let f = 0; f < nFilas; f++) {
      const presentes = new Set(posicoes.filter((p) => p.fila === f).flatMap((p) => p.u.linhas));
      linhas.forEach((l, k) => { if (presentes.has(l)) gTxt.appendChild(s('text', { x: 2, y: yLinha(f, k) + 3, class: 'esq-rot-linha' }, `L${l}`)); });
    }

    // Linhas que a rota usa em cada unidade (por camada), para saber onde há troca de linha nos pátios.
    const usa = (c, idx, l) => {
      const u = r.unidades[idx];
      return !!u && c.trechos.has(M.trecho(u.id, l));
    };

    posicoes.forEach(({ u, i: idx, x: ux, w, fila: f }) => {
      const ks = u.linhas.map(kDe).filter((k) => k >= 0).sort((a, b) => a - b);
      if (!ks.length) return;
      const yTop = yLinha(f, ks[0]);
      const yBot = yLinha(f, ks[ks.length - 1]);

      // Trilhos (base).
      ks.forEach((k) => gBase.append(...trilho(seg(ux, yLinha(f, k), ux + w, yLinha(f, k)))));

      if (u.tipo === 'RH') {
        // Desvio de cima, desvio de baixo e travessões entre linhas vizinhas.
        const a = ux + w * 0.14; const b = ux + w * 0.86; const d = 7;
        gBase.append(...trilho(`M${a.toFixed(1)},${yTop} L${(a + 5).toFixed(1)},${yTop - d} L${(b - 5).toFixed(1)},${yTop - d} L${b.toFixed(1)},${yTop}`, 'fino'));
        gBase.append(...trilho(`M${a.toFixed(1)},${yBot} L${(a + 5).toFixed(1)},${yBot + d} L${(b - 5).toFixed(1)},${yBot + d} L${b.toFixed(1)},${yBot}`, 'fino'));
        for (let n = 0; n < ks.length - 1; n++) {
          const y1 = yLinha(f, ks[n]); const y2 = yLinha(f, ks[n + 1]);
          gBase.append(...trilho(seg(ux + w * 0.3, y1, ux + w * 0.7, y2), 'fino'));
          gBase.append(...trilho(seg(ux + w * 0.3, y2, ux + w * 0.7, y1), 'fino'));
        }
        // Caixa do km e número do pátio.
        const km = M.fmtKm(u.ini);
        const bw = Math.max(34, km.length * 5 + 8);
        const top = topoFila[f];
        gTxt.append(
          s('rect', { x: ux + w / 2 - bw / 2, y: top + 2, width: bw, height: 11, class: 'esq-km-caixa' }),
          s('text', { x: ux + w / 2, y: top + 10.5, class: 'esq-km', 'text-anchor': 'middle' }, km),
          s('text', { x: ux + w / 2, y: top + 25, class: 'esq-num', 'text-anchor': 'middle' }, u.curto));
      }

      // Rota de cada camada.
      (op.camadas || []).forEach((c) => {
        const dy = c.desloc || 0;
        const classe = `esq-camada esq-${c.estilo || 'cheio'}`;
        const desenharRota = (d) => gRota.appendChild(s('path', { d, class: classe, stroke: c.cor }));
        const Y = (l) => yLinha(f, kDe(l)) + dy;
        if (u.tipo !== 'RH') {
          u.linhas.forEach((l) => { if (usa(c, idx, l)) desenharRota(seg(ux, Y(l), ux + w, Y(l))); });
          return;
        }
        // No pátio: de que linha o carro chega (EH anterior) e por qual sai (EH seguinte).
        const ant = u.linhas.filter((l) => usa(c, idx - 1, l));
        const prox = u.linhas.filter((l) => usa(c, idx + 1, l));
        const noPatio = u.linhas.filter((l) => usa(c, idx, l));
        if (ant.length === 1 && prox.length === 1 && ant[0] !== prox[0]) {
          // Troca de linha pelo travessão.
          const y1 = Y(ant[0]); const y2 = Y(prox[0]);
          desenharRota(`M${ux.toFixed(1)},${y1} L${(ux + w * 0.3).toFixed(1)},${y1} L${(ux + w * 0.7).toFixed(1)},${y2} L${(ux + w).toFixed(1)},${y2}`);
          return;
        }
        u.linhas.forEach((l) => {
          const e = ant.includes(l); const sai = prox.includes(l); const p = noPatio.includes(l);
          if (p || (e && sai)) desenharRota(seg(ux, Y(l), ux + w, Y(l)));
          else if (e) desenharRota(seg(ux, Y(l), ux + w * 0.5, Y(l))); // termina no pátio
          else if (sai) desenharRota(seg(ux + w * 0.5, Y(l), ux + w, Y(l))); // começa no pátio
        });
      });

      // Áreas de toque (uma por linha).
      u.linhas.forEach((l) => {
        const y = yLinha(f, kDe(l));
        const t = M.trecho(u.id, l);
        if (op.inicioIntervalo === t) gRota.appendChild(s('circle', { cx: ux + w / 2, cy: y, r: 8, class: 'esq-inicio' }));
        if (!op.aoTocar) return;
        const alvo = s('rect', { x: ux, y: y - PASSO / 2, width: w, height: PASSO, class: 'esq-alvo', 'data-trecho': t },
          s('title', {}, `${u.rotulo} · L${l} · km ${M.fmtKm(u.ini)} a ${M.fmtKm(u.fim)}`));
        alvo.addEventListener('click', () => op.aoTocar(t, u, l));
        gAlvo.appendChild(alvo);
      });
    });

    // Pontos de atenção: etiqueta acima da primeira linha ou abaixo da última, como na planilha.
    const grupos = new Map();
    (op.pontos || []).forEach((p) => {
      const { id, linha } = M.separar(p.trecho || '');
      const x = r.unidades.find((u) => u.id === id);
      const k = x ? kDe(linha) : -1;
      const lado = k <= 0 && x && x.tipo !== 'RH' && x.linhas.length > 1 ? 'cima' : 'baixo';
      const chave = `${id}|${lado}`;
      if (!grupos.has(chave)) grupos.set(chave, { id, lado, lista: [] });
      grupos.get(chave).lista.push(p);
    });
    grupos.forEach(({ id, lado, lista }) => {
      const pos = posicoes.find((p) => p.u.id === id);
      if (!pos) return;
      const { u, x: ux, w, fila: f } = pos;
      const ks = u.linhas.map(kDe).sort((a, b) => a - b);
      const y = lado === 'cima' ? yLinha(f, ks[0]) - 21 : yLinha(f, ks[ks.length - 1]) + 10;
      const mostrar = lista.length > 2 ? [lista[0], { ...lista[1], texto: `+${lista.length - 1}`, titulo: lista.slice(1).map((p) => p.titulo || p.texto).join('\n') }] : lista;
      const total = Math.max(56, w * 0.9);
      const larg = total / mostrar.length;
      const x0 = ux + w / 2 - total / 2;
      mostrar.forEach((p, n) => {
        const g = s('g', { class: 'esq-ponto', transform: `translate(${(x0 + n * larg).toFixed(1)},${y})` },
          s('rect', { width: Math.max(8, larg - 1).toFixed(1), height: 11, fill: p.cor, class: 'esq-ponto-caixa' }),
          s('text', { x: (larg - 1) / 2, y: 8.3, class: 'esq-ponto-txt', 'text-anchor': 'middle' }, String(p.texto || '').slice(0, Math.max(3, Math.floor(larg / 4.4)))),
          s('title', {}, p.titulo || p.texto || ''));
        if (op.aoTocarPonto) g.addEventListener('click', (e) => { e.stopPropagation(); op.aoTocarPonto(n === 0 ? lista[0] : lista[1]); });
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
