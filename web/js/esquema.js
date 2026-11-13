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
      const w = Math.min(utilW, (u.tipo === 'RH' ? LARG_RH : LARG_EH) * fator * (u.larg || 1));
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
    // Faixa (posição vertical) de cada linha na coluna: em geral a ordem L1, L2, L3; algumas colunas mudam
    // (ex.: da 75 à 77 a L3 fica acima da L1, como no painel). A continuidade entre colunas é pela faixa.
    const kU = (u, l) => (u.slot && u.slot[l] !== undefined ? u.slot[l] : kDe(l));

    /**
     * Trilhos de uma coluna. Cada um é um caminho de pontos [fração da largura, faixa]:
     * reto (a linha inteira numa faixa) ou com "via" (pátios desenhados como no painel: a linha desce, nasce no meio…).
     * ke / ks = faixa por onde entra (à esquerda) e sai (à direita); null quando começa ou termina dentro da coluna.
     */
    const memo = new Map();
    const trilhos = (u) => {
      if (!u) return [];
      if (memo.has(u)) return memo.get(u);
      const lista = u.linhas.map((l) => {
        const via = u.via && u.via[l];
        const k = kU(u, l);
        return { ch: l, l, id: M.idDe(u, l), pts: via || [[0, k], [1, k]], reto: !via, ponta: (u.pontas || []).includes(l), ref: u.ref && u.ref[l], livre: (u.livres || []).includes(l) };
      });
      (u.extras || []).forEach((e) => lista.push({ ch: e.ch, l: e.linha, id: e.id, pts: e.pts, reto: false, ponta: true, ref: e, livre: false }));
      lista.forEach((t) => {
        const fim = t.pts[t.pts.length - 1];
        t.f0 = t.pts[0][0]; t.f1 = fim[0];
        t.ke = t.f0 <= 0 ? t.pts[0][1] : null;
        t.ks = t.f1 >= 1 && !t.livre ? fim[1] : null;
      });
      lista.sort((a, b) => a.pts[0][1] - b.pts[0][1]);
      memo.set(u, lista);
      return lista;
    };
    const pontas = (u, lado) => { // faixas que chegam à borda esquerda ('e') ou direita ('d') da coluna (trilhos e linhas só de desenho)
      const out = new Set();
      trilhos(u).forEach((t) => { const k = lado === 'e' ? t.ke : t.ks; if (k !== null) out.add(k); });
      (u.deco || []).forEach((d) => { const p = lado === 'e' ? d.pts[0] : d.pts[d.pts.length - 1]; if ((lado === 'e' && p[0] <= 0) || (lado === 'd' && p[0] >= 1)) out.add(p[1]); });
      return out;
    };
    const faixasDe = (u) => [...trilhos(u).flatMap((t) => t.pts.map((p) => p[1])), ...(u.deco || []).flatMap((d) => d.pts.map((p) => p[1])), ...(u.textos || []).map((t) => t.slot)];
    const temId = (u, id) => u.id === id || Object.values(u.ref || {}).some((x) => x.id === id) || (u.extras || []).some((x) => x.id === id);
    /** Faixa de um caminho numa fração da largura (interpolada). */
    const faixaEm = (pts, fx) => {
      if (fx <= pts[0][0]) return pts[0][1];
      for (let n = 1; n < pts.length; n++) {
        const [xa, ka] = pts[n - 1]; const [xb, kb] = pts[n];
        if (fx <= xb) return xb === xa ? kb : ka + ((kb - ka) * (fx - xa)) / (xb - xa);
      }
      return pts[pts.length - 1][1];
    };

    // Altura de cada fila conforme as faixas que existem nela (L3 só onde houver).
    const nFilas = posicoes.length ? posicoes[posicoes.length - 1].fila + 1 : 1;
    const minK = []; const maxK = [];
    posicoes.forEach((p) => {
      faixasDe(p.u).forEach((k) => { minK[p.fila] = Math.min(minK[p.fila] ?? k, Math.floor(k)); maxK[p.fila] = Math.max(maxK[p.fila] ?? k, Math.ceil(k)); });
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
      posicoes.filter((p) => p.fila === f).forEach((p) => trilhos(p.u).filter((t) => t.reto).forEach((t) => { const k = t.pts[0][1]; if (!vistos.has(k)) vistos.set(k, t.l); }));
      vistos.forEach((l, k) => gTxt.appendChild(s('text', { x: 2, y: yLinha(f, k) + 3, class: 'esq-rot-linha' }, `L${l}`)));
    }

    // A rota usa o trilho da coluna idx que chega à borda ('ks' = direita, 'ke' = esquerda) na faixa k?
    const usaViz = (c, idx, campo, k) => {
      const t = trilhos(r.unidades[idx]).find((x) => x[campo] === k);
      return !!t && c.trechos.has(M.trecho(t.id, t.l));
    };

    posicoes.forEach(({ u, i: idx, x: ux, w, fila: f }) => {
      const tr = trilhos(u);
      if (!tr.length) return;
      const X = (fx) => ux + w * fx;
      const Y = (k) => yLinha(f, k);
      /** Caminho (atributo d) de um trecho do trilho, entre duas frações da largura. */
      const caminho = (pts, fa, fb, dy = 0) => {
        const a = Math.max(fa, pts[0][0]); const b = Math.min(fb, pts[pts.length - 1][0]);
        const lista = [[a, faixaEm(pts, a)], ...pts.filter((p) => p[0] > a && p[0] < b), [b, faixaEm(pts, b)]];
        return lista.map((p, n) => `${n ? 'L' : 'M'}${X(p[0]).toFixed(1)},${(Y(p[1]) + dy).toFixed(1)}`).join(' ');
      };

      // Trilhos (base), como no painel do CCO: a linha que não existe na unidade vizinha começa (ou termina)
      // num desvio em diagonal a partir da linha mais próxima (de cima, se houver) — o desvio do pátio fica com o desenho de "trapézio".
      const ant = r.unidades[idx - 1]; const prox = r.unidades[idx + 1];
      const fAnt = ant ? pontas(ant, 'd') : null; const fProx = prox ? pontas(prox, 'e') : null;
      const dx = Math.min(14, w * 0.22);
      const retos = tr.filter((t) => t.reto);
      const desvios = []; // diagonais dos desvios dos pátios: também são travessões (tocáveis e com rota)
      const desvio = (t, kv, esquerda, xa, xb) => {
        const v = retos.find((x) => x.pts[0][1] === kv);
        if (!v) return;
        const cima = kv < t.pts[0][1] ? v : t; const baixo = cima === v ? t : v;
        // na esquerda: do vizinho (borda) para esta linha; na direita: desta linha para o vizinho (borda)
        const [pa, pb] = esquerda ? [[xa, kv], [xb, t.pts[0][1]]] : [[xa, t.pts[0][1]], [xb, kv]];
        const lado = pa[1] < pb[1] ? 'D' : 'E'; // "\" desce para a direita; "/" sobe
        const fa = (pa[0] - ux) / w; const fb = (pb[0] - ux) / w;
        desvios.push({ lado, la: cima.ch, lb: baixo.ch, fixo: true, desvio: true,
          fCima: pa[1] < pb[1] ? fa : fb, fBaixo: pa[1] < pb[1] ? fb : fa,
          x1: pa[0], y1: Y(pa[1]), x2: pb[0], y2: Y(pb[1]), t: M.travessao(u.id, lado, cima.l, baixo.l) });
      };
      tr.forEach((t) => {
        if (!t.reto) { gBase.append(...trilho(caminho(t.pts, t.f0, t.f1))); return; }
        const k = t.pts[0][1];
        const y = Y(k);
        const vizinha = (fv) => {
          const acima = retos.filter((x) => x.pts[0][1] < k && fv.has(x.pts[0][1])).pop();
          if (acima) return acima.pts[0][1];
          const abaixo = retos.find((x) => x.pts[0][1] > k && fv.has(x.pts[0][1]));
          return abaixo ? abaixo.pts[0][1] : undefined;
        };
        const kAnt = ant && !t.ponta && !fAnt.has(k) ? vizinha(fAnt) : undefined;
        const kProx = prox && !t.ponta && !t.livre && !fProx.has(k) ? vizinha(fProx) : undefined;
        const x0 = kAnt !== undefined ? ux + dx : ux; const x1 = kProx !== undefined ? ux + w - dx : ux + w;
        gBase.append(...trilho(seg(x0, y, x1, y)));
        if (kAnt !== undefined) { gBase.append(...trilho(seg(ux, Y(kAnt), x0, y), 'fino')); desvio(t, kAnt, true, ux, x0); }
        if (kProx !== undefined) { gBase.append(...trilho(seg(x1, y, ux + w, Y(kProx)), 'fino')); desvio(t, kProx, false, x1, ux + w); }
      });

      // Linhas só de desenho (pátio, tocos, travessões sem troca programável) e textos (saída para os ramais).
      (u.deco || []).forEach((d) => {
        const g = s('g', { class: 'esq-deco' }, d.t ? s('title', {}, d.t) : null);
        g.append(...trilho(d.pts.map((p, n) => `${n ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' '), d.fino ? 'fino' : '')); // inteira (pode voltar, como nos laços)
        gBase.appendChild(g);
      });
      (u.textos || []).forEach((t) => gTxt.appendChild(s('text', { x: X(t.fx) - 2, y: Y(t.slot) + (t.dy || 0), class: 'esq-saida-txt', 'text-anchor': 'end' }, t.txt)));

      // Travessões do pátio: E "/" (da linha de baixo, à esquerda, para a de cima) e D "\" (da de cima para a de baixo).
      // Em geral, um de cada entre cada par de linhas vizinhas; os pátios desenhados como no painel trazem a lista (tvs).
      const travessoes = [...desvios];
      if (u.tipo === 'RH') {
        const novo = (lado, a, b, f1, f2, fixo, idTv) => {
          if (desvios.some((d) => d.t === M.travessao(idTv || u.id, lado, a.l, b.l))) return; // o desvio já é este travessão
          const cimaF = lado === 'E' ? f2 : f1; const baixoF = lado === 'E' ? f1 : f2;
          travessoes.push({ lado, la: a.ch, lb: b.ch, nA: a.l, nB: b.l, fixo, fCima: cimaF, fBaixo: baixoF,
            x1: X(f1), y1: Y(faixaEm((lado === 'E' ? b : a).pts, f1)), x2: X(f2), y2: Y(faixaEm((lado === 'E' ? a : b).pts, f2)),
            t: M.travessao(idTv || u.id, lado, a.l, b.l) });
        };
        if (u.tvs) {
          u.tvs.forEach((v) => { const a = tr.find((t) => t.ch === v.la); const b = tr.find((t) => t.ch === v.lb); if (a && b) novo(v.lado, a, b, v.fx[0], v.fx[1], v.fixo !== false, v.id); });
        } else {
          for (let n = 0; n < tr.length - 1; n++) { novo('E', tr[n], tr[n + 1], 0.12, 0.42, false); novo('D', tr[n], tr[n + 1], 0.58, 0.88, false); }
        }
        // No desenho só aparecem os travessões entre duas linhas que seguem dos dois lados (linha dupla);
        // onde uma delas começa ou termina no pátio, o próprio desvio já faz a ligação. Todos continuam tocáveis.
        const segue = (ch) => { const t = tr.find((x) => x.ch === ch); return (!ant || fAnt.has(t.ke)) && (!prox || fProx.has(t.ks)); };
        travessoes.filter((tv) => !tv.desvio && (tv.fixo || (segue(tv.la) && segue(tv.lb)))).forEach((tv) => gBase.append(...trilho(seg(tv.x1, tv.y1, tv.x2, tv.y2), 'fino')));
        // Marcador do pátio, como no painel: casinha, número do pátio numa caixa e o km embaixo (acima da linha de cima do pátio).
        if (!u.semCasa) {
          const km = M.fmtKm(u.ini);
          const top = Y(u.casaSlot ?? Math.min(...tr.flatMap((t) => t.pts.map((p) => p[1])))) - TOPO;
          const cx = X(u.casaFx ?? 0.5);
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
        const usa = (t) => c.trechos.has(M.trecho(t.id, t.l));
        if (u.tipo !== 'RH') {
          tr.forEach((t) => { if (usa(t)) desenharRota(caminho(t.pts, t.f0, t.f1, dy)); });
          travessoes.filter((tv) => c.trechos.has(tv.t)).forEach((tv) => desenharRota(seg(tv.x1, tv.y1 + dy, tv.x2, tv.y2 + dy)));
          return;
        }
        // No pátio: linha por onde chega (EH anterior), por onde sai (EH seguinte) e travessões usados.
        const tvs = travessoes.filter((tv) => c.trechos.has(tv.t));
        tvs.forEach((tv) => desenharRota(seg(tv.x1, tv.y1 + dy, tv.x2, tv.y2 + dy)));
        tr.forEach((t) => {
          const chega = t.ke !== null && usaViz(c, idx - 1, 'ks', t.ke);
          const sai = t.ks !== null && usaViz(c, idx + 1, 'ke', t.ks);
          const noPatio = usa(t);
          const pontos = tvs.flatMap((tv) => (tv.la === t.ch ? [tv.fCima] : tv.lb === t.ch ? [tv.fBaixo] : []));
          const des = (a, b) => desenharRota(caminho(t.pts, a, b, dy));
          // A marcação fica dentro do que foi selecionado: o EH não invade o pátio (RH); a linha do pátio
          // só é pintada quando a própria RH está na rota (ou quando um travessão dela é usado).
          if (!pontos.length) {
            if (noPatio) des(t.f0, t.f1);
            return;
          }
          if (chega && sai && noPatio) return des(t.f0, t.f1);
          const pMin = Math.min(...pontos); const pMax = Math.max(...pontos);
          if (chega) des(t.f0, pMax); // chega por esta linha até o travessão
          else if (sai) des(pMin, t.f1); // sai por esta linha depois do travessão
          else if (noPatio && t.livre) des(pMin, t.f1); // segue para o ramal
          else if (pontos.length > 1) des(pMin, pMax); // entre dois travessões
        });
      });

      // Áreas de toque (uma por linha) e travessões.
      tr.forEach((t) => {
        const trecho = M.trecho(t.id, t.l);
        const fm = (t.f0 + t.f1) / 2;
        if (op.inicioIntervalo === trecho) gRota.appendChild(s('circle', { cx: X(fm), cy: Y(faixaEm(t.pts, fm)), r: 8, class: 'esq-inicio' }));
        if (!op.aoTocar) return;
        const dica = s('title', {}, `${t.ref ? t.ref.rotulo : u.rotulo} · L${t.l} · km ${M.fmtKm(t.ref ? t.ref.ini : u.ini)} a ${M.fmtKm(t.ref ? t.ref.fim : u.fim)}`);
        const y = Y(t.pts[0][1]);
        const alvo = t.reto
          ? s('rect', { x: ux, y: y - PASSO / 2 + 2, width: w, height: PASSO / 2 + 4, class: 'esq-alvo', 'data-trecho': trecho }, dica)
          : s('path', { d: caminho(t.pts, t.f0, t.f1), class: 'esq-alvo-via', 'data-trecho': trecho }, dica);
        alvo.addEventListener('click', () => op.aoTocar(trecho, u, t.l));
        gAlvo.appendChild(alvo);
      });
      if (op.aoTocar) {
        travessoes.forEach((tv) => {
          const alvo = s('path', { d: seg(tv.x1, tv.y1, tv.x2, tv.y2), class: 'esq-alvo-tv', 'data-trecho': tv.t },
            s('title', {}, `Travessão ${u.rotulo}: ${tv.lado === 'E' ? 'sobe para a linha de cima' : 'desce para a linha de baixo'} (troca de linha)`));
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

    // Pontos de atenção: a etiqueta fica colada logo acima da linha do ponto (a linha da interdição: L1, L2…),
    // na coluna do EH/RH. Vários pontos no mesmo lugar: o primeiro e "+N" (os outros N, que abrem numa lista).
    const grupos = new Map();
    (op.pontos || []).forEach((p) => {
      const { id, linha } = M.separar(p.trecho || '');
      const pos = posicoes.find((q) => trilhos(q.u).some((t) => t.id === id && t.l === linha)) || posicoes.find((q) => temId(q.u, id));
      if (!pos) return;
      const tr = trilhos(pos.u);
      const t = tr.find((x) => x.id === id && x.l === linha) || tr[0];
      const chave = `${pos.i}|${t.ch}`;
      if (!grupos.has(chave)) grupos.set(chave, { pos, t, lista: [] });
      grupos.get(chave).lista.push(p);
    });
    grupos.forEach(({ pos, t, lista }) => {
      const { x: ux, w, fila: f } = pos;
      const fm = (t.f0 + t.f1) / 2;
      const y = yLinha(f, faixaEm(t.pts, fm)) - 13;
      const mostrar = lista.length > 2 ? [lista[0], { ...lista[1], texto: `+${lista.length - 1}`, titulo: `Mais ${lista.length - 1} ponto(s) neste local (toque para ver):\n${lista.slice(1).map((p) => p.titulo || p.texto).join('\n')}` }] : lista;
      const total = Math.min(Math.max(56, w * 0.9), Math.max(56, w * (t.f1 - t.f0)));
      const larg = total / mostrar.length;
      const x0 = ux + w * fm - total / 2;
      mostrar.forEach((p, n) => {
        const g = s('g', { class: 'esq-ponto', transform: `translate(${(x0 + n * larg).toFixed(1)},${y.toFixed(1)})` },
          s('rect', { width: Math.max(8, larg - 1).toFixed(1), height: 11, fill: p.cor, class: 'esq-ponto-caixa' }),
          s('text', { x: (larg - 1) / 2, y: 8.3, class: 'esq-ponto-txt', 'text-anchor': 'middle' }, String(p.texto || '').slice(0, Math.max(3, Math.floor(larg / 4.4)))),
          s('title', {}, p.titulo || p.texto || ''));
        if (op.aoTocarPonto) g.addEventListener('click', (e) => { e.stopPropagation(); if (n === 0) op.aoTocarPonto(lista[0]); else op.aoTocarPonto(lista[1], lista.slice(1)); });
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
      const ids = [u.id, ...Object.values(u.ref || {}).map((x) => x.id), ...(u.extras || []).map((x) => x.id)];
      if (trechos.some((t) => ids.includes(M.separar(t).id))) { a = Math.min(a, i); b = Math.max(b, i); }
    });
    if (!Number.isFinite(a)) return null;
    return { i0: Math.max(0, a - folga), i1: Math.min(ramal.unidades.length - 1, b + folga) };
  }

  App.esquema = { desenhar, faixaDe, filas };
})(window.App);
