/*
 * Gráficos em SVG puro (funcionam offline, sem bibliotecas).
 * Série "Realizado" = cor de destaque; "Meta" = cinza de referência.
 */
'use strict';

(function (App) {
  const { U, ui } = App;
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs = {}, ...filhos) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    });
    filhos.flat().forEach((f) => {
      if (f) el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    });
    return el;
  }

  function escalaY(max) {
    if (max <= 4) return { max: 4, passo: 1 };
    const brutos = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const passo = brutos.find((p) => max / p <= 4) || Math.ceil(max / 4);
    return { max: Math.ceil(max / passo) * passo, passo };
  }

  function legenda() {
    return ui.h('div', { class: 'graf-legenda' },
      ui.h('span', { class: 'leg-item' }, ui.h('span', { class: 'leg-chave leg-real' }), 'Realizado'),
      ui.h('span', { class: 'leg-item' }, ui.h('span', { class: 'leg-chave leg-meta' }), 'Meta'));
  }

  /** Tooltip compartilhado dentro do contêiner do gráfico. */
  function criarTooltip(caixa) {
    const tip = ui.h('div', { class: 'graf-tip', hidden: true });
    caixa.appendChild(tip);
    return {
      mostrar(linhas, x, y) {
        ui.trocar(tip, linhas.map((l) => ui.h('div', null, l)));
        tip.hidden = false;
        const largura = caixa.clientWidth;
        const w = tip.offsetWidth;
        tip.style.left = `${Math.min(Math.max(x - w / 2, 0), largura - w)}px`;
        tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
      },
      esconder() { tip.hidden = true; }
    };
  }

  /**
   * Colunas por dia (Realizado) com marca de meta.
   * serie: [{ dia, meta, realizado|null }]
   */
  function barrasSemana(serie, { hoje } = {}) {
    const W = 340; const H = 190;
    const m = { t: 16, r: 8, b: 30, l: 28 };
    const iw = W - m.l - m.r; const ih = H - m.t - m.b;
    const maxV = Math.max(1, ...serie.map((d) => Math.max(d.meta, d.realizado || 0)));
    const esc = escalaY(maxV);
    const y = (v) => m.t + ih - (v / esc.max) * ih;
    const banda = iw / serie.length;
    const larg = Math.min(24, banda * 0.55);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graf', role: 'img', 'aria-label': 'Realizado por dia na semana, comparado à meta' });
    for (let v = 0; v <= esc.max; v += esc.passo) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'graf-grade' }));
      svg.appendChild(s('text', { x: m.l - 6, y: y(v) + 4, class: 'graf-eixo', 'text-anchor': 'end' }, String(v)));
    }

    const caixa = ui.h('div', { class: 'graf-caixa' });
    const tip = criarTooltip(caixa);

    serie.forEach((d, i) => {
      const cx = m.l + banda * i + banda / 2;
      const g = s('g', { class: d.dia === hoje ? 'graf-hoje' : '' });
      if (d.realizado) {
        const topo = y(d.realizado);
        const alt = m.t + ih - topo;
        const r = Math.min(4, alt / 2, larg / 2);
        // Coluna com topo arredondado e base reta.
        g.appendChild(s('path', {
          class: 'graf-barra',
          d: `M${cx - larg / 2},${m.t + ih} V${topo + r} Q${cx - larg / 2},${topo} ${cx - larg / 2 + r},${topo} H${cx + larg / 2 - r} Q${cx + larg / 2},${topo} ${cx + larg / 2},${topo + r} V${m.t + ih} Z`
        }));
      }
      if (d.meta) {
        g.appendChild(s('line', { class: 'graf-meta', x1: cx - larg / 2 - 5, x2: cx + larg / 2 + 5, y1: y(d.meta), y2: y(d.meta) }));
      }
      g.appendChild(s('text', { x: cx, y: H - 10, class: `graf-eixo${d.dia === hoje ? ' graf-eixo-forte' : ''}`, 'text-anchor': 'middle' }, U.diaSemanaCurto(d.dia)));
      const alvo = s('rect', { x: m.l + banda * i, y: m.t, width: banda, height: ih + m.b, class: 'graf-alvo' });
      const mostrar = () => {
        const r = caixa.getBoundingClientRect();
        const escala = r.width / W;
        tip.mostrar([
          `${U.diaSemanaCurto(d.dia)} ${U.fmtData(d.dia).slice(0, 5)}`,
          `Realizado: ${d.realizado === null ? '—' : d.realizado}`,
          `Meta: ${d.meta}`
        ], cx * escala, y(Math.max(d.meta, d.realizado || 0)) * escala);
      };
      alvo.addEventListener('pointerenter', mostrar);
      alvo.addEventListener('pointerdown', mostrar);
      alvo.addEventListener('pointerleave', () => tip.esconder());
      g.appendChild(alvo);
      svg.appendChild(g);
    });

    caixa.insertBefore(svg, caixa.firstChild);
    return ui.h('div', { class: 'graf-bloco' }, legenda(), caixa);
  }

  /** Linhas acumuladas do mês: meta x realizado. serie: [{ dia, meta, realizado|null }] */
  function linhaMes(serie, { hoje } = {}) {
    const W = 340; const H = 190;
    const m = { t: 16, r: 12, b: 30, l: 34 };
    const iw = W - m.l - m.r; const ih = H - m.t - m.b;
    const maxV = Math.max(1, ...serie.map((d) => Math.max(d.meta, d.realizado || 0)));
    const esc = escalaY(maxV);
    const n = serie.length;
    const x = (i) => m.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
    const y = (v) => m.t + ih - (v / esc.max) * ih;

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graf', role: 'img', 'aria-label': 'Produção acumulada no mês, comparada à meta acumulada' });
    for (let v = 0; v <= esc.max; v += esc.passo) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'graf-grade' }));
      svg.appendChild(s('text', { x: m.l - 6, y: y(v) + 4, class: 'graf-eixo', 'text-anchor': 'end' }, String(v)));
    }
    [0, 9, 19, n - 1].filter((i, k, arr) => i < n && arr.indexOf(i) === k).forEach((i) => {
      svg.appendChild(s('text', { x: x(i), y: H - 10, class: 'graf-eixo', 'text-anchor': i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle') }, serie[i].dia.slice(8, 10)));
    });

    const caminho = (campo) => serie
      .map((d, i) => (d[campo] === null ? null : `${x(i)},${y(d[campo])}`))
      .filter(Boolean)
      .map((p, i) => `${i ? 'L' : 'M'}${p}`)
      .join(' ');

    svg.appendChild(s('path', { d: caminho('meta'), class: 'graf-linha-meta' }));
    const reais = serie.map((d, i) => ({ d, i })).filter((p) => p.d.realizado !== null);
    if (reais.length) {
      svg.appendChild(s('path', { d: caminho('realizado'), class: 'graf-linha-real' }));
      const ult = reais[reais.length - 1];
      svg.appendChild(s('circle', { cx: x(ult.i), cy: y(ult.d.realizado), r: 4.5, class: 'graf-ponto' }));
    }

    const caixa = ui.h('div', { class: 'graf-caixa' });
    const tip = criarTooltip(caixa);
    const guia = s('line', { class: 'graf-guia', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    svg.appendChild(guia);
    const alvo = s('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'graf-alvo' });
    const mover = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      const d = serie[i];
      guia.setAttribute('x1', x(i));
      guia.setAttribute('x2', x(i));
      guia.setAttribute('visibility', 'visible');
      const escala = r.width / W;
      tip.mostrar([
        U.fmtData(d.dia),
        `Realizado acumulado: ${d.realizado === null ? '—' : d.realizado}`,
        `Meta acumulada: ${d.meta}`
      ], x(i) * escala, y(Math.max(d.meta, d.realizado || 0)) * escala);
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerdown', mover);
    alvo.addEventListener('pointerleave', () => {
      guia.setAttribute('visibility', 'hidden');
      tip.esconder();
    });
    svg.appendChild(alvo);
    if (hoje) {
      const iHoje = serie.findIndex((d) => d.dia === hoje);
      if (iHoje >= 0) svg.insertBefore(s('line', { class: 'graf-hoje-linha', x1: x(iHoje), x2: x(iHoje), y1: m.t, y2: m.t + ih }), svg.firstChild);
    }
    caixa.insertBefore(svg, caixa.firstChild);
    return ui.h('div', { class: 'graf-bloco' }, legenda(), caixa);
  }

  /** Cartão de indicador: percentual em destaque + barra de progresso. */
  function indicador({ titulo, pct, realizado, meta, extra }) {
    const largura = pct === null ? 0 : Math.min(pct, 100);
    return ui.h('div', { class: `kpi${pct !== null && pct >= 100 ? ' kpi-ok' : ''}` },
      ui.h('div', { class: 'kpi-titulo', text: titulo }),
      ui.h('div', { class: 'kpi-valor', text: U.fmtPct(pct) }),
      ui.h('div', { class: 'kpi-barra', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(largura) },
        ui.h('span', { style: { width: `${largura}%` } })),
      ui.h('div', { class: 'kpi-sub', text: meta ? `${realizado} de ${meta} OMs` : `${realizado} realizadas · sem meta` }),
      extra ? ui.h('div', { class: 'kpi-extra', text: extra }) : null);
  }

  /* ------------------------------------------------------------------ */
  /* Gráfico com km no eixo X (análise do arquivo do carro controle)     */
  /* ------------------------------------------------------------------ */

  function passoKm(extensao) {
    const alvo = extensao / 6;
    return [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].find((p) => p >= alvo) || 10000;
  }

  function faixaY(listas, extras) {
    const vals = [];
    listas.forEach((l) => l.forEach((v) => { if (Number.isFinite(v)) vals.push(v); }));
    extras.forEach((v) => { if (Number.isFinite(v)) vals.push(v); });
    if (!vals.length) return [-1, 1];
    vals.sort((a, b) => a - b);
    const corte = vals.length > 400 ? Math.floor(vals.length * 0.002) : 0; // ignora picos isolados de leitura
    let lo = vals[corte];
    let hi = vals[vals.length - 1 - corte];
    extras.forEach((v) => { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (lo === hi) { lo -= 1; hi += 1; }
    const folga = (hi - lo) * 0.08;
    return [lo - folga, hi + folga];
  }

  function passoY(lo, hi) {
    const bruto = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(bruto));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) || mag * 10;
  }

  /**
   * Gráfico de linhas ao longo da quilometragem.
   * opcoes: { pos, x0, x1, series: [{ nome, valores, classe, tipo: 'linha'|'pontos' }],
   *           faixas: [{ ini, fim, classe, rotulo }], referencias: [valores de y], eventos: [{ pos, texto }],
   *           altura, unidade, legenda, aoPassar(pos|null), fmtX }
   * Retorna { el, guia(pos|null) }.
   */
  function graficoKm(op) {
    const caixa = ui.h('div', { class: 'graf-caixa graf-km' });
    const H = op.altura || 170;
    const m = { t: 18, r: 12, b: 26, l: 46 };
    let guiaLinha = null;
    let estado = null;
    let ultimaLargura = 0;

    function desenhar() {
      const W = Math.max(280, Math.round(caixa.clientWidth || 0));
      if (W === ultimaLargura && caixa.querySelector('svg')) return;
      ultimaLargura = W;
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const { pos, x0, x1 } = op;
      const x = (p) => m.l + ((p - x0) / (x1 - x0)) * iw;
      const lo = Math.min(x0, x1);
      const hi = Math.max(x0, x1);

      // Índices visíveis.
      const vis = [];
      for (let i = 0; i < pos.length; i++) if (pos[i] >= lo && pos[i] <= hi) vis.push(i);
      const visiveis = op.series.map((s) => vis.map((i) => s.valores[i]));
      const [y0, y1] = op.yFaixa || faixaY(visiveis, op.referencias || []);
      const y = (v) => m.t + ih - ((Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * ih;

      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'graf', role: 'img', 'aria-label': op.titulo || 'Gráfico por km' });
      const idClip = `clip-${Math.random().toString(36).slice(2, 8)}`;
      svg.appendChild(s('defs', {}, s('clipPath', { id: idClip }, s('rect', { x: m.l, y: m.t, width: iw, height: ih }))));

      // Faixas (curvas) e rótulos dos elementos.
      (op.faixas || []).forEach((f) => {
        const xa = Math.max(m.l, Math.min(x(f.ini), x(f.fim)));
        const xb = Math.min(m.l + iw, Math.max(x(f.ini), x(f.fim)));
        if (xb <= xa) return;
        if (f.classe) svg.appendChild(s('rect', { x: xa, y: m.t, width: xb - xa, height: ih, class: f.classe }));
        if (f.rotulo && xb - xa > 26) svg.appendChild(s('text', { x: (xa + xb) / 2, y: m.t - 5, class: 'graf-eixo graf-rotulo-el', 'text-anchor': 'middle' }, f.rotulo));
      });

      // Grade e eixo Y.
      const py = passoY(y0, y1);
      for (let v = Math.ceil(y0 / py) * py; v <= y1; v += py) {
        const yy = y(v);
        svg.appendChild(s('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, class: Math.abs(v) < 1e-9 ? 'graf-zero' : 'graf-grade' }));
        svg.appendChild(s('text', { x: m.l - 6, y: yy + 4, class: 'graf-eixo', 'text-anchor': 'end' }, String(Math.round(v * 100) / 100)));
      }
      (op.referencias || []).forEach((v) => {
        svg.appendChild(s('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), class: 'graf-limite' }));
      });

      // Eixo X (km).
      const passo = passoKm(hi - lo);
      for (let p = Math.ceil(lo / passo) * passo; p <= hi; p += passo) {
        const xx = x(p);
        svg.appendChild(s('line', { x1: xx, x2: xx, y1: m.t, y2: m.t + ih, class: 'graf-grade' }));
        svg.appendChild(s('text', { x: xx, y: H - 8, class: 'graf-eixo', 'text-anchor': 'middle' }, (op.fmtX || String)(p)));
      }

      // Eventos (AMV, passagem superior…).
      (op.eventos || []).forEach((e) => {
        if (e.pos < lo || e.pos > hi) return;
        const xx = x(e.pos);
        svg.appendChild(s('line', { x1: xx, x2: xx, y1: m.t + ih - 8, y2: m.t + ih, class: 'graf-evento' }, s('title', {}, e.texto)));
      });

      // Séries (reduzidas a no máximo 2 pontos por pixel, preservando picos).
      const g = s('g', { 'clip-path': `url(#${idClip})` });
      op.series.forEach((serie) => {
        const baldes = new Map();
        vis.forEach((i) => {
          const v = serie.valores[i];
          if (!Number.isFinite(v)) return;
          const px = Math.round(x(pos[i]));
          const b = baldes.get(px);
          if (!b) baldes.set(px, { min: v, max: v, iMin: i, iMax: i, primeiro: i, ultimo: i });
          else {
            if (v < b.min) { b.min = v; b.iMin = i; }
            if (v > b.max) { b.max = v; b.iMax = i; }
            b.ultimo = i;
          }
        });
        const colunas = [...baldes.entries()].sort((a, b) => a[0] - b[0]);
        if (serie.tipo === 'pontos') {
          colunas.forEach(([px, b]) => {
            const v = Math.abs(b.max) >= Math.abs(b.min) ? b.max : b.min;
            g.appendChild(s('rect', { x: px - 1.5, y: y(v) - 1.5, width: 3, height: 3, class: serie.classe }));
          });
          return;
        }
        let d = '';
        let ultimoIdx = null;
        colunas.forEach(([px, b]) => {
          // Interrompe a linha só onde faltam medições (mais de 4 pontos seguidos sem valor).
          const quebra = ultimoIdx === null || Math.abs(b.primeiro - ultimoIdx) > 4;
          const pontos = b.min === b.max ? [b.min] : (b.iMin < b.iMax ? [b.min, b.max] : [b.max, b.min]);
          pontos.forEach((v, k) => {
            d += `${quebra && k === 0 ? 'M' : 'L'}${px},${y(v).toFixed(1)} `;
          });
          ultimoIdx = b.ultimo;
        });
        if (d) g.appendChild(s('path', { d, class: `graf-serie ${serie.classe || ''}` }));
      });
      svg.appendChild(g);

      // Guia e área de interação.
      guiaLinha = s('line', { class: 'graf-guia', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
      svg.appendChild(guiaLinha);
      const alvo = s('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'graf-alvo' });
      const mover = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * W;
        const p = x0 + ((px - m.l) / iw) * (x1 - x0);
        if (op.aoPassar) op.aoPassar(p);
      };
      alvo.addEventListener('pointermove', mover);
      alvo.addEventListener('pointerdown', mover);
      alvo.addEventListener('pointerleave', () => op.aoPassar && op.aoPassar(null));
      svg.appendChild(alvo);

      estado = { x, lo, hi };
      ui.trocar(caixa, svg);
    }

    // Redesenha no próximo quadro (evita o aviso "ResizeObserver loop" do navegador).
    let agendado = false;
    const ro = new ResizeObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; desenhar(); });
    });
    ro.observe(caixa);
    requestAnimationFrame(desenhar);

    const bloco = ui.h('div', { class: 'graf-bloco' },
      op.legenda !== false && op.series.length > 1 ? ui.h('div', { class: 'graf-legenda' },
        op.series.map((sr) => ui.h('span', { class: 'leg-item' }, ui.h('span', { class: `leg-chave ${sr.classe}` }), sr.nome))) : null,
      caixa);

    return {
      el: bloco,
      guia(p) {
        if (!guiaLinha || !estado) return;
        if (p === null || p < estado.lo || p > estado.hi) {
          guiaLinha.setAttribute('visibility', 'hidden');
          return;
        }
        const xx = estado.x(p);
        guiaLinha.setAttribute('x1', xx);
        guiaLinha.setAttribute('x2', xx);
        guiaLinha.setAttribute('visibility', 'visible');
      },
      destruir() { ro.disconnect(); }
    };
  }

  App.charts = { barrasSemana, linhaMes, indicador, graficoKm };
})(window.App);
