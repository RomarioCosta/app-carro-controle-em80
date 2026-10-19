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

  App.charts = { barrasSemana, linhaMes, indicador };
})(window.App);
