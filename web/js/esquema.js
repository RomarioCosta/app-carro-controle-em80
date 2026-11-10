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

  const LARG_EH = 80;
  const LARG_RH = 80;
  const TOPO = 50; // marcador do pátio (casinha + número), km e folga para a linha de cima
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
      const w = (u.tipo === 'RH' ? LARG_RH : LARG_EH) * fator * (u.larg || 1);
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
    const PASSO = largura < 600 ? 28 : 24; // no celular, linhas mais afastadas para acertar o toque
    const kDe = (l) => linhas.indexOf(l);
    // Posição (faixa vertical) de cada linha na coluna: em geral a ordem L1, L2, L3; algumas colunas mudam
    // (ex.: da 75 à 77 a L3 fica acima da L1, como no painel). A continuidade entre colunas é pela faixa.
    const kU = (u, l) => (u.slot && u.slot[l] !== undefined ? u.slot[l] : kDe(l));
    const faixas = (u) => new Set([...u.linhas.map((l) => kU(u, l)), ...(u.patio || []).map((p) => p.slot)]);
    const linhaNaFaixa = (u, k) => (u ? u.linhas.find((l) => kU(u, l) === k) : undefined);
    const trechoDe = (u, l) => M.trecho(M.idDe(u, l), l);
    const temId = (u, id) => u.id === id || Object.values(u.ref || {}).some((x) => x.id === id);

    // Altura de cada fila conforme as faixas que existem nela (L3 só onde houver).
    const nFilas = posicoes.length ? posicoes[posicoes.length - 1].fila + 1 : 1;
    const minK = []; const maxK = [];
    posicoes.forEach((p) => {
      const ks = [...faixas(p.u), ...(p.u.saidas || []).filter((x) => x.nasce).map((x) => kU(p.u, x.linha) + 1)];
      ks.forEach((k) => { minK[p.fila] = Math.min(minK[p.fila] ?? k, k); maxK[p.fila] = Math.max(maxK[p.fila] ?? k, k); });
    });
    const topoFila = [];
    let acc = 0;
    for (let f = 0; f < nFilas; f++) { topoFila[f] = acc; acc += TOPO + ((maxK[f] ?? 0) - (minK[f] ?? 0)) * PASSO + BASE; }
    const H = acc + 4;
    const yLinha = (f, k) => topoFila[f] + TOPO + (k - (minK[f] ?? 0)) * PASSO;

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

    // Rótulos das linhas no começo de cada fila (a primeira linha que aparece em cada faixa).
    for (let f = 0; f < nFilas; f++) {
      const vistos = new Map();
      posicoes.filter((p) => p.fila === f).forEach((p) => p.u.linhas.forEach((l) => { const k = kU(p.u, l); if (!vistos.has(k)) vistos.set(k, l); }));
      vistos.forEach((l, k) => gTxt.appendChild(s('text', { x: 2, y: yLinha(f, k) + 3, class: 'esq-rot-linha' }, `L${l}`)));
    }

    // A rota usa a linha que está na faixa k da coluna idx? (para saber por onde chega e sai em cada pátio)
    const usaK = (c, idx, k) => {
      const u = r.unidades[idx];
      const l = linhaNaFaixa(u, k);
      return l !== undefined && c.trechos.has(trechoDe(u, l));
    };

    posicoes.forEach(({ u, i: idx, x: ux, w, fila: f }) => {
      const tr = u.linhas.map((l) => ({ l, k: kU(u, l) })).filter((t) => t.k >= -9).sort((a, b) => a.k - b.k);
      if (!tr.length) return;
      const ks = tr.map((t) => t.k);
      const saidaDe = (l) => (u.saidas || []).find((x) => x.linha === l);

      // Trilhos (base), como no painel do CCO: a linha que não existe na unidade vizinha começa (ou termina)
      // num desvio em diagonal a partir da linha mais próxima (de cima, se houver) — o desvio do pátio fica com o desenho de "trapézio".
      const ant = r.unidades[idx - 1]; const prox = r.unidades[idx + 1];
      const fAnt = ant ? faixas(ant) : null; const fProx = prox ? faixas(prox) : null;
      const dx = Math.min(14, w * 0.22);
      tr.forEach(({ l, k }) => {
        const y = yLinha(f, k);
        const ponta = (u.pontas || []).includes(l);
        const vizinha = (fv) => {
          const acima = tr.filter((t) => t.k < k && fv.has(t.k)).pop();
          if (acima) return acima.k;
          const abaixo = tr.find((t) => t.k > k && fv.has(t.k));
          return abaixo ? abaixo.k : undefined;
        };
        const kAnt = ant && !ponta && !fAnt.has(k) ? vizinha(fAnt) : undefined;
        const kProx = prox && !ponta && !saidaDe(l) && !fProx.has(k) ? vizinha(fProx) : undefined;
        const saida = saidaDe(l);
        const xs = saida && saida.tipo === 'desce' ? ux + w * 0.5 : null;
        const x0 = kAnt !== undefined ? ux + dx : ux; const x1 = xs ?? (kProx !== undefined ? ux + w - dx : ux + w);
        gBase.append(...trilho(seg(x0, y, x1, y)));
        if (kAnt !== undefined) gBase.append(...trilho(seg(ux, yLinha(f, kAnt), x0, y), 'fino'));
        if (kProx !== undefined) gBase.append(...trilho(seg(x1, y, ux + w, yLinha(f, kProx)), 'fino'));
      });

      // Linha do pátio sem trecho (só desenho), que segue na coluna seguinte.
      (u.patio || []).forEach((p) => {
        const y = yLinha(f, p.slot);
        const g = s('g', { class: 'esq-patio' }, s('title', {}, 'Linha do pátio (segue para a 78)'));
        g.append(...trilho(seg(ux + w * (p.de || 0), y, ux + w, y)));
        gBase.appendChild(g);
      });

      // Saídas para os ramais (toco com seta e o nome): "reto" segue em frente, "desce" desce em diagonal.
      const fundoDesce = Math.max(-99, ...(u.saidas || []).filter((x) => x.tipo === 'desce').map((x) => kU(u, x.linha) + (x.nasce ? 1 : 0)));
      (u.saidas || []).forEach((sd) => {
        const k = kU(u, sd.linha);
        const y = yLinha(f, k);
        const xa = ux + w * 0.5; const xb = ux + w - 2; const h = 16;
        const g = s('g', { class: 'esq-saida' }, s('title', {}, `Saída para o ramal ${sd.rotulo || ''}`.trim()));
        if (sd.tipo === 'desce') {
          g.append(...trilho(seg(xa, y, xb, y + h), 'fino'));
          if (sd.nasce) { const y2 = yLinha(f, k + 1); g.append(...trilho(seg(ux + w * 0.3, y2, xa, y2)), ...trilho(seg(xa, y2, xb, y2 + h), 'fino')); }
          if (sd.rotulo) g.appendChild(s('text', { x: xb, y: yLinha(f, fundoDesce) + h + 11, class: 'esq-saida-txt', 'text-anchor': 'end' }, `${sd.rotulo} ↘`));
        } else {
          g.append(s('path', { d: `M${xb - 6},${y - 4} L${xb},${y} L${xb - 6},${y + 4}`, class: 'esq-saida-seta' }));
          if (sd.rotulo) g.appendChild(s('text', { x: xb, y: y - 6, class: 'esq-saida-txt', 'text-anchor': 'end' }, `${sd.rotulo} →`));
        }
        gBase.appendChild(g);
      });

      // Travessões do pátio (entre cada par de linhas vizinhas): E "/" e D "\".
      const travessoes = [];
      if (u.tipo === 'RH') {
        for (let n = 0; n < tr.length - 1; n++) {
          const la = tr[n].l; const lb = tr[n + 1].l;
          const yA = yLinha(f, tr[n].k); const yB = yLinha(f, tr[n + 1].k);
          travessoes.push({ lado: 'E', la, lb, x1: ux + w * 0.12, y1: yB, x2: ux + w * 0.42, y2: yA, xCima: ux + w * 0.42, xBaixo: ux + w * 0.12, t: M.travessao(u.id, 'E', la, lb) });
          travessoes.push({ lado: 'D', la, lb, x1: ux + w * 0.58, y1: yA, x2: ux + w * 0.88, y2: yB, xCima: ux + w * 0.58, xBaixo: ux + w * 0.88, t: M.travessao(u.id, 'D', la, lb) });
        }
        // No desenho só aparecem os travessões entre duas linhas que seguem dos dois lados (linha dupla);
        // onde uma delas começa ou termina no pátio, o próprio desvio já faz a ligação. Todos continuam tocáveis.
        const segue = (l) => { const k = kU(u, l); return (!ant || fAnt.has(k)) && (!prox || fProx.has(k)) && !saidaDe(l); };
        travessoes.filter((tv) => segue(tv.la) && segue(tv.lb)).forEach((tv) => gBase.append(...trilho(seg(tv.x1, tv.y1, tv.x2, tv.y2), 'fino')));
        // Marcador do pátio, como no painel: casinha, número do pátio numa caixa e o km embaixo.
        if (!u.semCasa) {
          const km = M.fmtKm(u.ini);
          const top = topoFila[f];
          const cx = ux + w / 2;
          const nw = Math.max(18, String(u.curto).length * 7 + 6);
          gTxt.append(
            s('path', { d: `M${(cx - 7).toFixed(1)},${top + 13} L${(cx - 7).toFixed(1)},${top + 7} L${cx.toFixed(1)},${top + 1} L${(cx + 7).toFixed(1)},${top + 7} L${(cx + 7).toFixed(1)},${top + 13} Z`, class: 'esq-casa' }),
            s('rect', { x: cx - nw / 2, y: top + 14, width: nw, height: 13, rx: 1.5, class: 'esq-num-caixa' }),
            s('text', { x: cx, y: top + 24.5, class: 'esq-num', 'text-anchor': 'middle' }, u.curto),
            s('text', { x: cx, y: top + 35, class: 'esq-km', 'text-anchor': 'middle' }, u.ligacao ? '' : km),
            s('title', {}, `${u.rotulo}${u.ligacao ? ' (ligação)' : ` · km ${km}`}`));
        }
      }

      // Rota de cada camada.
      (op.camadas || []).forEach((c) => {
        const dy = c.desloc || 0;
        const classe = `esq-camada esq-${c.estilo || 'cheio'}`;
        const desenharRota = (d) => gRota.appendChild(s('path', { d, class: classe, stroke: c.cor }));
        if (u.tipo !== 'RH') {
          tr.forEach(({ l, k }) => { if (c.trechos.has(trechoDe(u, l))) desenharRota(seg(ux, yLinha(f, k) + dy, ux + w, yLinha(f, k) + dy)); });
          return;
        }
        // No pátio: linha por onde chega (EH anterior), por onde sai (EH seguinte) e travessões usados.
        const tvs = travessoes.filter((tv) => c.trechos.has(tv.t));
        const yDe = (l) => yLinha(f, kU(u, l)) + dy;
        tvs.forEach((tv) => desenharRota(seg(tv.x1, tv.y1 + dy, tv.x2, tv.y2 + dy)));
        tr.forEach(({ l, k }) => {
          const chega = usaK(c, idx - 1, k); const sai = !saidaDe(l) && usaK(c, idx + 1, k); const noPatio = c.trechos.has(trechoDe(u, l));
          const pontos = tvs.flatMap((tv) => (tv.la === l ? [tv.xCima] : tv.lb === l ? [tv.xBaixo] : []));
          const x0 = ux; const x1 = ux + w; const Y = yDe(l);
          if (chega && sai) return desenharRota(seg(x0, Y, x1, Y));
          if (!pontos.length) {
            if (noPatio) desenharRota(seg(x0, Y, saidaDe(l) && saidaDe(l).tipo === 'desce' ? ux + w * 0.5 : x1, Y));
            else if (chega) desenharRota(seg(x0, Y, ux + w * 0.5, Y)); // termina no pátio
            else if (sai) desenharRota(seg(ux + w * 0.5, Y, x1, Y)); // começa no pátio
            return;
          }
          const pMin = Math.min(...pontos); const pMax = Math.max(...pontos);
          if (chega) desenharRota(seg(x0, Y, pMax, Y)); // chega por esta linha até o travessão
          else if (sai) desenharRota(seg(pMin, Y, x1, Y)); // sai por esta linha depois do travessão
          else if (pontos.length > 1) desenharRota(seg(pMin, Y, pMax, Y)); // entre dois travessões
        });
      });

      // Áreas de toque (uma por linha) e travessões.
      tr.forEach(({ l, k }) => {
        const y = yLinha(f, k);
        const t = trechoDe(u, l);
        const ref = u.ref && u.ref[l];
        if (op.inicioIntervalo === t) gRota.appendChild(s('circle', { cx: ux + w / 2, cy: y, r: 8, class: 'esq-inicio' }));
        if (!op.aoTocar) return;
        const alvo = s('rect', { x: ux, y: y - PASSO / 2 + 2, width: w, height: PASSO / 2 + 4, class: 'esq-alvo', 'data-trecho': t },
          s('title', {}, `${ref ? ref.rotulo : u.rotulo} · L${l} · km ${M.fmtKm(ref ? ref.ini : u.ini)} a ${M.fmtKm(ref ? ref.fim : u.fim)}`));
        alvo.addEventListener('click', () => op.aoTocar(t, u, l));
        gAlvo.appendChild(alvo);
      });
      if (op.aoTocar) {
        travessoes.forEach((tv) => {
          const alvo = s('path', { d: seg(tv.x1, tv.y1, tv.x2, tv.y2), class: 'esq-alvo-tv', 'data-trecho': tv.t },
            s('title', {}, `Travessão ${u.rotulo}: L${tv.lado === 'E' ? tv.lb : tv.la} → L${tv.lado === 'E' ? tv.la : tv.lb} (troca de linha)`));
          alvo.addEventListener('click', () => op.aoTocar(tv.t, u, ''));
          gAlvo.appendChild(alvo);
        });
      }
    });

    // EH 64 a 66 (Linha Tronco): a linha 3 de passageiro, acima da L1, como no painel (só desenho, sem trecho).
    if (r.ramal === 'LT') {
      const alvo = ['LT:EH:64', 'LT:RH:64>65', 'LT:EH:65'];
      const pos = alvo.map((id) => posicoes.find((p) => p.u.id === id)).filter(Boolean);
      const k1 = pos.length ? kU(pos[0].u, '1') : -1;
      if (pos.length && k1 >= 0) {
        const porFila = new Map();
        pos.forEach((p) => { if (!porFila.has(p.fila)) porFila.set(p.fila, []); porFila.get(p.fila).push(p); });
        porFila.forEach((lista, f) => {
          const y1 = yLinha(f, k1); const y = y1 - 11;
          const ini = lista[0]; const fim = lista[lista.length - 1];
          const xa = ini.u.id === alvo[0] ? ini.x + ini.w * 0.15 : ini.x; // começa logo depois da RH-64
          const xb = fim.u.id === alvo[2] ? fim.x + fim.w * 0.85 : fim.x + fim.w; // termina antes da RH-66
          const g = s('g', { class: 'esq-passageiro' }, s('title', {}, 'Linha 3 de passageiro (EH 64 a 66)'));
          g.append(...trilho(seg(xa + 10, y, xb - 10, y)));
          if (ini.u.id === alvo[0]) g.append(...trilho(seg(xa, y1, xa + 10, y), 'fino'));
          if (fim.u.id === alvo[2]) g.append(...trilho(seg(xb - 10, y, xb, y1), 'fino'));
          gBase.appendChild(g);
        });
      }
    }

    // Pontos de atenção: etiqueta acima da primeira linha ou abaixo da última, como na planilha.
    const grupos = new Map();
    (op.pontos || []).forEach((p) => {
      const { id, linha } = M.separar(p.trecho || '');
      const x = r.unidades.find((u) => temId(u, id));
      const kx = x ? x.linhas.map((l) => kU(x, l)).sort((a, b) => a - b) : [];
      const k = x && x.linhas.includes(linha) ? kU(x, linha) : kx[kx.length - 1];
      const lado = x && k === kx[0] && x.tipo !== 'RH' && x.linhas.length > 1 ? 'cima' : 'baixo';
      const chave = `${id}|${lado}`;
      if (!grupos.has(chave)) grupos.set(chave, { id, lado, lista: [] });
      grupos.get(chave).lista.push(p);
    });
    grupos.forEach(({ id, lado, lista }) => {
      const pos = posicoes.find((p) => temId(p.u, id));
      if (!pos) return;
      const { u, x: ux, w, fila: f } = pos;
      const ks = u.linhas.map((l) => kU(u, l)).sort((a, b) => a - b);
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
      const ids = [u.id, ...Object.values(u.ref || {}).map((x) => x.id)];
      if (trechos.some((t) => ids.includes(M.separar(t).id))) { a = Math.min(a, i); b = Math.max(b, i); }
    });
    if (!Number.isFinite(a)) return null;
    return { i0: Math.max(0, a - folga), i1: Math.min(ramal.unidades.length - 1, b + folga) };
  }

  App.esquema = { desenhar, faixaDe, filas };
})(window.App);
