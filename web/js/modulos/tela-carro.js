/*
 * Tela do carro: gráfico vertical por km, no estilo da tela do carro controle (Offboard).
 * Uma coluna por parâmetro, com os limites da tabela de parâmetros EFVM 2026 (editáveis),
 * marca de excesso, faixa de eventos/elementos e reprodução "em tempo real".
 * Usa o mesmo arquivo carregado na Análise do arquivo.
 */
'use strict';

(function (App) {
  const { U, ui } = App;
  const { h } = ui;
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------------- Limites (Parâmetros EFVM 2026 – bitola métrica) ---------------- */

  /** Velocidades da tabela (km/h). */
  const VELOCIDADES = [15, 20, 30, 35, 40, 45, 50, 60, 68];
  /**
   * Limites em mm por velocidade (mesma ordem de VELOCIDADES), por elemento (curva/tangente).
   * Faixas da tabela ("22 a 28") usam o menor valor. null = sem limite.
   * Bitola: superior = aberta (1000 + valor), inferior = fechada (987 → −13).
   */
  const TABELA = {
    bitola: { curva: [35, 33, 32, 32, 32, 32, 32, 32, 31], tangente: [35, 33, 32, 32, 32, 32, 32, 32, 31], inferior: -13 },
    alinhamento: { curva: [31, 28, 26, 25, 24, 22, 20, 18, 17], tangente: [31, 28, 26, 25, 24, 22, 20, 18, 17] },
    variacao: { curva: [34, 33, 32, 32, 30, 29, 25, 23, 22], tangente: [34, 33, 32, 32, 30, 29, 25, 23, 22] },
    empeno2: { curva: [18, 17, 16, 15, 14, 13, 12, 11, 10], tangente: [47, 40, 28, 35, 32, 30, 24, 20, 19] },
    nivelamento5: { curva: [28, 22, 22, 22, 21, 21, 21, 21, 21], tangente: [28, 22, 22, 22, 21, 21, 21, 21, 21] },
    empeno10: { curva: [39, 38, 38, 38, 33, 32, 32, 32, 31], tangente: [39, 38, 38, 38, 33, 32, 32, 32, 31] },
    // superelevação = nivelamento transversal; o limite vale só na tangente
    superelevacao: { curva: null, tangente: [48, 39, 36, 33, 32, 31, 30, 28, 27] }
  };

  /** Colunas na ordem pedida. escala = meio da largura da coluna (mm). */
  const PARAMETROS = [
    { id: 'bitF', nome: 'Bitola F', campo: 'bitF', grupo: 'bitola', cor: '#16a34a', escala: 40 },
    { id: 'bitT', nome: 'Bitola T', campo: 'bitT', grupo: 'bitola', cor: '#1d4ed8', escala: 40 },
    { id: 'kld', nome: 'Bit_KLD', campo: 'kld', grupo: 'bitola', cor: '#c026d3', escala: 40 },
    { id: 'val25', nome: 'ALv_B2,5', campo: 'val25', grupo: 'alinhamento', cor: '#1d4ed8', escala: 40 },
    { id: 'vrbt5', nome: 'VrBTmax5', campo: 'vrbt5', grupo: 'variacao', cor: '#1d4ed8', escala: 40 },
    { id: 'emp2', nome: 'EMP_2', campo: 'emp2', grupo: 'empeno2', cor: '#1d4ed8', escala: 50 },
    { id: 'nl5', nome: 'NLmax_5', campo: 'nl5', grupo: 'nivelamento5', cor: '#1d4ed8', escala: 40 },
    { id: 'emp10', nome: 'EMP_10', campo: 'emp10', grupo: 'empeno10', cor: '#1d4ed8', escala: 50 },
    { id: 'curv', nome: '10000/R', campo: 'curv', grupo: null, cor: '#334155', escala: 45 },
    { id: 'sup', nome: 'SUPerABS', campo: 'sup', grupo: 'superelevacao', cor: '#16a34a', escala: 110 }
  ];

  /** Limites padrão de um parâmetro numa velocidade: { C: { sup, inf } | null, T: … }. */
  function limitesPadrao(p, vel) {
    const t = p.grupo && TABELA[p.grupo];
    if (!t) return { C: null, T: null };
    const k = Math.max(0, VELOCIDADES.indexOf(Number(vel)));
    const lim = (lista) => {
      if (!lista || lista[k] === null || lista[k] === undefined) return null;
      return { sup: lista[k], inf: t.inferior !== undefined ? t.inferior : -lista[k] };
    };
    return { C: lim(t.curva), T: lim(t.tangente) };
  }

  let edicoes = U.pref.get('telaCarro:limites', {}) || {}; // { [vel]: { [param]: { C, T } } }
  function limitesDe(p, vel) {
    const e = edicoes[vel] && edicoes[vel][p.id];
    return e || limitesPadrao(p, vel);
  }

  /* ---------------- Estado ---------------- */

  let raiz;
  let corpoEl;
  let cabecalhoEl;
  let leituraEl;
  let rodapeEl;
  let controlesEl;
  let arquivo = null;
  let resultado = null;
  let nomeArquivo = '';
  let prep = null; // dados preparados do arquivo
  let velocidade = Number(U.pref.get('telaCarro:velocidade', 68));
  let janela = Number(U.pref.get('telaCarro:janela', 500)); // metros visíveis
  let fator = Number(U.pref.get('telaCarro:fator', 1)); // velocidade da reprodução: 1×, 2×, 3×…
  const BASE_MS = 10; // 1× = 10 m/s de arquivo por segundo
  let revelado = 0; // distância (m) até onde o traçado já foi desenhado (avança com o play)
  let topo = 0; // distância percorrida (m) no topo da tela
  let cursorI = null; // índice do ponto sob o cursor
  let tocando = false;
  let ultimoQuadro = 0;
  let colunaAtiva = null;

  const ALTURA = 520;
  const COL_EX = 26; const COL_EL = 64; const COL_KM = 0; // sem a coluna de km à esquerda

  /* ---------------- Montagem ---------------- */

  function montar(el) {
    raiz = el;
    controlesEl = h('div', { class: 'tc-controles' });
    leituraEl = h('div', { class: 'tc-leitura' });
    cabecalhoEl = h('div', { class: 'tc-cab' });
    corpoEl = h('div', { class: 'tc-corpo' });
    rodapeEl = h('div', { class: 'tc-rodape' });
    raiz.append(
      h('div', { class: 'tela-cab' }, h('h1', { text: 'Tela do carro' })),
      controlesEl,
      h('div', { class: 'tc-janela' },
        leituraEl,
        h('div', { class: 'tc-rolagem' }, h('div', { class: 'tc-grade' }, cabecalhoEl, corpoEl)),
        rodapeEl));
    corpoEl.addEventListener('wheel', (e) => {
      if (!prep) return;
      e.preventDefault();
      mover((e.deltaY > 0 ? 1 : -1) * janela * 0.1);
    }, { passive: false });
    let arrasto = null;
    corpoEl.addEventListener('pointerdown', (e) => { arrasto = { y: e.clientY, topo }; corpoEl.setPointerCapture(e.pointerId); });
    corpoEl.addEventListener('pointerup', () => { arrasto = null; });
    corpoEl.addEventListener('pointermove', (e) => {
      if (!prep) return;
      if (arrasto && Math.abs(e.clientY - arrasto.y) > 3) {
        topo = limitarTopo(arrasto.topo - ((e.clientY - arrasto.y) / ALTURA) * janela);
        desenhar();
        return;
      }
      const svg = corpoEl.querySelector('svg');
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const y = ((e.clientY - r.top) / r.height) * ALTURA;
      const x = ((e.clientX - r.left) / r.width) * Number(svg.getAttribute('width'));
      const d = topo + (y / ALTURA) * janela;
      cursorI = d <= revelado ? indicePorDist(d) : null;
      colunaAtiva = colunaEm(x);
      desenharCursor();
    });
    corpoEl.addEventListener('pointerleave', () => { cursorI = null; colunaAtiva = null; desenharCursor(); });
    window.addEventListener('resize', U.debounce(() => { if (raiz && raiz.offsetParent) desenhar(); }, 150));
    document.addEventListener('em80:analise', () => { if (raiz && raiz.offsetParent) carregar(); });
  }

  function aoMostrar() { carregar(); }

  /** Lê o arquivo da Análise e prepara as séries. */
  function carregar() {
    const est = App.analise && App.analise.estado ? App.analise.estado() : {};
    const mudou = est.arquivo !== arquivo || est.resultado !== resultado;
    arquivo = est.arquivo || null; resultado = est.resultado || null; nomeArquivo = est.nomeArquivo || '';
    if (!arquivo) {
      prep = null;
      renderControles();
      ui.trocar(cabecalhoEl); ui.trocar(leituraEl); ui.trocar(rodapeEl);
      ui.trocar(corpoEl, h('p', { class: 'vazio tc-vazio', text: 'Carregue o arquivo do carro em "Análise do arquivo" para ver a tela.' }));
      return;
    }
    if (mudou || !prep) preparar();
    renderControles();
    desenhar();
  }

  function preparar() {
    const { pos } = arquivo;
    const n = pos.length;
    const esp = App.bitola.espacamento(pos) || 0.25;
    const dist = App.bitola.distanciaPercorrida(pos, esp);
    const tipo = new Uint8Array(n); // 0 tangente, 1 curva, 2 circuito
    const elementoDo = new Array(n);
    (resultado ? resultado.elementos : []).forEach((e) => {
      const t = e.tipo === 'C' ? 1 : (e.tipo === 'X' || e.rh ? 2 : 0);
      for (let i = e.i0; i <= e.i1; i++) { tipo[i] = t; elementoDo[i] = e; }
    });
    // eventos do arquivo: índice do ponto mais próximo do km do evento
    const eventos = (arquivo.eventos || []).map((ev) => {
      let melhor = 0; let d = Infinity;
      for (let i = 0; i < n; i += 4) { const x = Math.abs(pos[i] - ev.pos); if (x < d) { d = x; melhor = i; } }
      return { ...ev, i: melhor, trav: /\bTRA?V(ADOR)?\b/i.test(`${ev.texto} ${ev.codigo}`) };
    });
    prep = { n, esp, dist, tipo, elementoDo, eventos, total: dist[n - 1] || 0 };
    topo = 0;
    revelado = 0; // ao abrir, a tela começa vazia: o traçado aparece com o play
    cursorI = null;
  }

  /* ---------------- Navegação ---------------- */

  const limitarTopo = (t) => Math.max(0, Math.min(t, Math.max(0, prep.total - janela * 0.2)));
  function mover(dm) { topo = limitarTopo(topo + dm); desenhar(); }
  /** Avança o traçado (como o carro andando); a tela rola quando ele chega perto do fim. */
  function avancar(dm) {
    revelado = Math.min(prep.total, revelado + dm);
    if (revelado > topo + janela * 0.9) topo = limitarTopo(revelado - janela * 0.9);
    desenhar();
  }
  function reiniciar() { revelado = 0; topo = 0; cursorI = null; desenhar(); }

  function indicePorDist(d) {
    const { dist, n } = prep;
    let lo = 0; let hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (dist[m] < d) lo = m + 1; else hi = m; }
    return Math.min(n - 1, lo);
  }

  function irParaKm(texto) {
    const metros = App.bitola.kmParaMetros(texto);
    if (metros === null || !prep) { ui.toast('Km inválido. Use, por exemplo, 312 ou 312+089.', 'erro'); return; }
    let melhor = 0; let d = Infinity;
    arquivo.pos.forEach((p, i) => { const x = Math.abs(p - metros); if (x < d) { d = x; melhor = i; } });
    if (d > 500) ui.toast(`O km mais próximo no arquivo é ${App.bitola.fmtKm(arquivo.pos[melhor])}.`, 'info');
    revelado = prep.dist[melhor];
    topo = limitarTopo(revelado - janela * 0.9);
    cursorI = melhor;
    desenhar();
  }

  function tocar() {
    tocando = !tocando;
    renderControles();
    if (!tocando) return;
    ultimoQuadro = performance.now();
    const passo = (agora) => {
      if (!tocando || !raiz.offsetParent) { tocando = false; renderControles(); return; }
      const dt = (agora - ultimoQuadro) / 1000;
      ultimoQuadro = agora;
      avancar(BASE_MS * fator * dt);
      if (revelado >= prep.total) { tocando = false; renderControles(); return; }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  /* ---------------- Controles ---------------- */

  function renderControles() {
    const sel = (valor, opcoes, aoMudar, rotulo) => h('label', { class: 'tc-campo' }, h('span', { text: rotulo }),
      h('select', { value: String(valor), onchange: (e) => aoMudar(Number(e.target.value)) }, opcoes.map(([v, t]) => h('option', { value: String(v), text: t }))));
    const kmInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex.: 312+000', 'aria-label': 'Ir para o km', onkeydown: (e) => { if (e.key === 'Enter') irParaKm(e.target.value); } });
    ui.trocar(controlesEl,
      h('div', { class: 'tc-linha' },
        h('div', { class: 'tc-campo' }, h('span', { text: 'Ir para o km' }),
          h('div', { class: 'linha-campo' }, kmInput, h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', onclick: () => irParaKm(kmInput.value) }, 'Ir'))),
        sel(janela, [[250, '250 m'], [500, '500 m'], [1000, '1.000 m'], [2000, '2.000 m']], (v) => { janela = v; U.pref.set('telaCarro:janela', v); if (prep) { topo = limitarTopo(topo); desenhar(); } }, 'Trecho na tela'),
        sel(velocidade, VELOCIDADES.map((v) => [v, `${v} km/h`]), (v) => { velocidade = v; U.pref.set('telaCarro:velocidade', v); desenhar(); }, 'Limites para'),
        sel(fator, [1, 2, 3, 5, 10, 20].map((v) => [v, `${v}×`]), (v) => { fator = v; U.pref.set('telaCarro:fator', v); }, 'Velocidade'),
        h('div', { class: 'tc-botoes' },
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Voltar um trecho', disabled: !prep, onclick: () => mover(-janela * 0.8) }, '▲'),
          h('button', { class: `btn ${tocando ? 'btn-primario' : 'btn-secundario'} btn-pequeno`, type: 'button', disabled: !prep, onclick: tocar }, ui.icone(tocando ? 'parar' : 'play'), tocando ? 'Pausar' : 'Reproduzir'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Avançar um trecho', disabled: !prep, onclick: () => (topo + janela >= revelado ? avancar(janela * 0.8) : mover(janela * 0.8)) }, '▼'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Voltar ao início do arquivo, com a tela vazia', disabled: !prep, onclick: reiniciar }, 'Reiniciar'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', onclick: editarLimites }, ui.icone('ajustes'), 'Limites'))));
  }

  /* ---------------- Desenho ---------------- */

  function geometria() {
    const largura = Math.max(320, corpoEl.parentElement ? corpoEl.parentElement.clientWidth : 900);
    const base = COL_KM + COL_EX + COL_EL;
    const lp = Math.max(78, Math.floor((largura - base) / PARAMETROS.length));
    return { lp, W: base + lp * PARAMETROS.length, base };
  }

  function colunaEm(x) {
    const { lp, base } = geometria();
    const k = Math.floor((x - base) / lp);
    return k >= 0 && k < PARAMETROS.length ? PARAMETROS[k] : null;
  }

  const s = (tag, attrs = {}, ...filhos) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); });
    filhos.flat().forEach((f) => { if (f) el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return el;
  };

  function desenhar() {
    if (!prep) return;
    const { lp, W, base } = geometria();
    const H = ALTURA;
    const { dist, tipo, n } = prep;
    const dados = (resultado && resultado.dados) || arquivo.dados;
    const i0 = indicePorDist(topo);
    // só o que o "carro" já percorreu (play): ao abrir, nada é desenhado
    const i1 = revelado > topo ? Math.min(indicePorDist(topo + janela), indicePorDist(revelado)) : -1;
    const yDe = (i) => ((dist[i] - topo) / janela) * H;
    const tipoLim = (i) => (tipo[i] === 1 ? 'C' : 'T');

    // cabeçalho (nomes girados, como na tela do carro)
    ui.trocar(cabecalhoEl, h('div', { class: 'tc-cab-linha', style: { width: `${W}px` } },
      h('div', { class: 'tc-cab-cel', style: { width: `${COL_KM}px` } }),
      h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${COL_EX}px` } }, h('span', { text: 'EX' })),
      h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${COL_EL}px` } }, h('span', { text: 'T/E' })),
      PARAMETROS.map((p) => h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${lp}px` }, title: p.nome },
        h('span', null, h('strong', { text: p.nome }), h('small', { text: `±${p.escala}` }))))));

    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tc-svg' });
    // coluna T/E: elementos (tangente = linha, curva = barra azul, RH = cinza) e eventos
    const xEl = COL_KM + COL_EX;
    const vistos = new Set();
    for (let i = i0; i <= i1; i++) {
      const e = prep.elementoDo[i];
      if (!e || vistos.has(e)) continue;
      vistos.add(e);
      const ya = Math.max(0, yDe(Math.max(e.i0, i0))); const yb = Math.min(H, yDe(Math.min(e.i1, i1)));
      const t = e.tipo === 'C' ? 'curva' : (e.tipo === 'X' || e.rh ? 'rh' : 'tangente');
      if (t === 'tangente') svg.appendChild(s('line', { x1: xEl + 10, x2: xEl + 10, y1: ya, y2: yb, class: 'tc-el-tangente' }));
      else svg.appendChild(s('rect', { x: xEl + 6, y: ya, width: 9, height: Math.max(1, yb - ya), class: `tc-el-${t}` }));
      if (yb - ya > 26) svg.appendChild(s('text', { x: xEl + 20, y: (ya + yb) / 2 + 3, class: 'tc-el-rotulo' }, t === 'rh' ? (e.trecho || 'RH').split(' · ')[0] : e.sigla));
    }
    prep.eventos.forEach((ev) => {
      if (ev.i < i0 || ev.i > i1) return;
      const y = yDe(ev.i);
      const g = s('g', { class: ev.trav ? 'tc-ev tc-ev-trav' : 'tc-ev' }, s('title', {}, `${ev.texto} (${App.bitola.fmtKm(ev.pos)})`));
      g.appendChild(s('line', { x1: xEl + 2, x2: xEl + COL_EL - 2, y1: y, y2: y }));
      g.appendChild(s('text', { x: xEl + COL_EL - 2, y: y - 2, 'text-anchor': 'end' }, ev.trav ? 'TRAV' : ev.texto.slice(0, 9)));
      svg.appendChild(g);
    });

    // colunas dos parâmetros
    const filas = Math.ceil(H); // uma fila por pixel
    const excessoGeral = new Uint8Array(filas + 1);
    PARAMETROS.forEach((p, k) => {
      const x0 = base + k * lp;
      const cx = x0 + lp / 2;
      const meia = lp / 2 - 6;
      const xv = (v) => cx + (Math.max(-p.escala, Math.min(p.escala, v)) / p.escala) * meia;
      // KLD: só leituras válidas (|valor| < 60 mm), como na análise
      const serie = p.campo === 'kld' && resultado && resultado.kldValido ? resultado.kldValido : dados[p.campo];
      const lims = limitesDe(p, velocidade);
      if (!serie) { svg.appendChild(s('text', { x: cx, y: 20, class: 'tc-sem', 'text-anchor': 'middle' }, 'sem dado')); return; }
      // agrega por fila de pixel: mín, máx e excesso
      const minF = new Float64Array(filas + 1).fill(NaN); const maxF = new Float64Array(filas + 1).fill(NaN);
      const exc = new Uint8Array(filas + 1); const limF = new Array(filas + 1);
      for (let i = i0; i <= i1; i++) {
        const f = Math.max(0, Math.min(filas, Math.round(yDe(i))));
        const lim = lims[tipoLim(i)];
        if (!limF[f]) limF[f] = lim || 'nenhum';
        const v = serie[i];
        if (Number.isNaN(v)) continue;
        if (Number.isNaN(minF[f]) || v < minF[f]) minF[f] = v;
        if (Number.isNaN(maxF[f]) || v > maxF[f]) maxF[f] = v;
        if (lim && (v > lim.sup || v < lim.inf)) { exc[f] = 1; excessoGeral[f] = 1; }
      }
      // limites (pontilhado), por fila (mudam entre curva e tangente)
      ['sup', 'inf'].forEach((lado) => {
        let d = ''; let aberto = false;
        for (let f = 0; f <= filas; f++) {
          const l = limF[f];
          if (!l) continue;
          if (l === 'nenhum') { aberto = false; continue; }
          d += `${aberto ? 'L' : 'M'}${xv(l[lado]).toFixed(1)},${f}`;
          aberto = true;
        }
        if (d) svg.appendChild(s('path', { d, class: 'tc-limite' }));
      });
      // sinal: em cada fila, do mínimo ao máximo, ligado à fila seguinte
      let d = ''; let antes = false;
      for (let f = 0; f <= filas; f++) {
        if (Number.isNaN(minF[f])) { antes = false; continue; }
        d += `${antes ? 'L' : 'M'}${xv(minF[f]).toFixed(1)},${f}L${xv(maxF[f]).toFixed(1)},${f}`;
        antes = true;
      }
      if (d) svg.appendChild(s('path', { d, class: 'tc-sinal', stroke: p.cor }));
      // excesso: caixa vermelha do limite até o pico, como na tela do carro
      for (let f = 0; f <= filas; f++) {
        if (!exc[f]) continue;
        let g = f; let pico = 0; let lado = 1;
        while (g <= filas && exc[g]) {
          const l = limF[g] !== 'nenhum' ? limF[g] : null;
          if (l) {
            if (maxF[g] - l.sup > pico) { pico = maxF[g] - l.sup; lado = 1; }
            if (l.inf - minF[g] > pico) { pico = l.inf - minF[g]; lado = -1; }
          }
          g++;
        }
        const l = limF[f] !== 'nenhum' ? limF[f] : { sup: 0, inf: 0 };
        const xa = xv(lado > 0 ? l.sup : l.inf); const xb = xv(lado > 0 ? l.sup + pico : l.inf - pico);
        svg.appendChild(s('rect', { x: Math.min(xa, xb) - 3, y: Math.max(0, f - 2), width: Math.abs(xb - xa) + 6, height: Math.max(4, g - f + 3), class: 'tc-excesso' }));
        f = g;
      }
    });
    // coluna EX: excesso em qualquer parâmetro
    for (let f = 0; f <= filas; f++) {
      if (!excessoGeral[f]) continue;
      let g = f; while (g <= filas && excessoGeral[g]) g++;
      svg.appendChild(s('rect', { x: COL_KM + 6, y: f, width: COL_EX - 10, height: Math.max(2, g - f), class: 'tc-ex' }));
      f = g;
    }
    if (revelado <= topo) svg.appendChild(s('text', { x: W / 2, y: H / 2, class: 'tc-dica', 'text-anchor': 'middle' }, 'Toque em Reproduzir para o carro começar a andar.'));
    svg.appendChild(s('g', { class: 'tc-cursor' }));
    ui.trocar(corpoEl, svg);
    desenharCursor();
    renderRodape();
  }

  function desenharCursor() {
    const svg = corpoEl.querySelector('svg');
    if (!svg || !prep) return;
    const g = svg.querySelector('.tc-cursor');
    while (g.firstChild) g.removeChild(g.firstChild);
    const dados = (resultado && resultado.dados) || arquivo.dados;
    const fmt = (v) => (Number.isNaN(v) || v === undefined ? '—' : v.toFixed(2).replace('.', ','));
    if (cursorI === null) {
      const i = indicePorDist(topo);
      ui.trocar(leituraEl, h('span', { class: 'tc-leitura-km', text: App.bitola.fmtKm(arquivo.pos[i]) }), h('span', { text: 'Passe o mouse (ou o dedo) sobre a tela para ler os valores.' }));
      renderRodape();
      return;
    }
    const y = ((prep.dist[cursorI] - topo) / janela) * ALTURA;
    const W = Number(svg.getAttribute('width'));
    g.appendChild(s('line', { x1: COL_KM, x2: W, y1: y, y2: y, class: 'tc-cursor-linha' }));
    // leitura no topo: km + parâmetro sob o mouse (máx, mín e média do trecho na tela), como no Offboard
    const km = App.bitola.fmtKm(arquivo.pos[cursorI]);
    const partes = [h('span', { class: 'tc-leitura-km', text: km })];
    if (colunaAtiva) {
      const serie = dados[colunaAtiva.campo];
      if (serie) {
        const i0 = indicePorDist(topo); const i1 = Math.min(indicePorDist(topo + janela), indicePorDist(revelado));
        let mx = -Infinity; let mn = Infinity; let soma = 0; let q = 0;
        for (let i = i0; i <= i1; i++) { const v = serie[i]; if (Number.isNaN(v)) continue; mx = Math.max(mx, v); mn = Math.min(mn, v); soma += v; q++; }
        partes.push(h('strong', { text: colunaAtiva.nome }), h('span', { text: `VALOR: ${fmt(serie[cursorI])}  MÁX: ${q ? fmt(mx) : '—'}  MÍN: ${q ? fmt(mn) : '—'}  MÉD: ${q ? fmt(soma / q) : '—'}` }));
      }
    } else {
      partes.push(h('span', { text: PARAMETROS.map((p) => `${p.nome} ${fmt(dados[p.campo] ? dados[p.campo][cursorI] : NaN)}`).join('   ') }));
    }
    ui.trocar(leituraEl, partes);
    renderRodape();
  }

  function renderRodape() {
    if (!prep) return;
    const m = arquivo.meta || {};
    const i = cursorI !== null ? cursorI : indicePorDist(topo);
    const e = prep.elementoDo[i];
    const par = (r, v) => h('span', null, h('b', { text: r }), ` ${v || '—'}`);
    ui.trocar(rodapeEl,
      h('div', { class: 'tc-rodape-km', text: App.bitola.fmtKm(arquivo.pos[i]).replace('+', ', ') }),
      h('div', { class: 'tc-rodape-dados' },
        par('FERROVIA', 'EFVM'), par('RAMAL', m.ramal), par('CORRETIVA', m.corretiva),
        par('LINHA', App.bitola.linhaDoTrecho(arquivo, i, i)), par('DATA', m.data), par('INSPETOR', m.inspetor),
        par('ARQUIVO', nomeArquivo), par('ELEMENTO', e ? [e.trecho || e.eh, e.tipo === 'X' ? 'RH' : e.sigla].filter(Boolean).join(' · ') : ''),
        par('LIMITES', `${velocidade} km/h${edicoes[velocidade] ? ' (editados)' : ' (EFVM 2026)'}`)));
  }

  /* ---------------- Edição dos limites ---------------- */

  function editarLimites() {
    const linhas = PARAMETROS.filter((p) => p.grupo);
    const atual = {};
    linhas.forEach((p) => { atual[p.id] = JSON.parse(JSON.stringify(limitesDe(p, velocidade))); });
    const campo = (p, el, lado) => {
      const lim = atual[p.id][el];
      return h('input', {
        type: 'text', inputmode: 'decimal', class: 'tc-lim-input', 'aria-label': `${p.nome} ${el === 'C' ? 'curva' : 'tangente'} ${lado === 'sup' ? 'superior' : 'inferior'}`,
        value: lim ? String(lim[lado]).replace('.', ',') : '',
        onchange: (e) => {
          const v = U.numero(e.target.value);
          if (e.target.value.trim() === '') { atual[p.id][el] = null; return; }
          if (v === null) { e.target.value = ''; return; }
          const l = atual[p.id][el] || { sup: Math.abs(v), inf: -Math.abs(v) };
          l[lado] = v;
          atual[p.id][el] = l;
        }
      });
    };
    ui.modal({
      titulo: `Limites para ${velocidade} km/h`,
      conteudo: h('div', { class: 'pilha' },
        h('p', { class: 'sub', text: 'Valores em mm em relação ao zero do parâmetro (bitola: em relação a 1000 mm; fechada 987 = −13). Em branco: sem limite.' }),
        h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro tc-lim' },
          h('thead', null,
            h('tr', null, h('th', { text: 'Parâmetro', rowspan: 2 }), h('th', { text: 'Curva', colspan: 2 }), h('th', { text: 'Tangente', colspan: 2 })),
            h('tr', null, ['Superior', 'Inferior', 'Superior', 'Inferior'].map((t) => h('th', { text: t })))),
          h('tbody', null, linhas.map((p) => h('tr', null, h('td', { text: p.nome }),
            h('td', null, campo(p, 'C', 'sup')), h('td', null, campo(p, 'C', 'inf')),
            h('td', null, campo(p, 'T', 'sup')), h('td', null, campo(p, 'T', 'inf')))))))),
      acoes: [
        { texto: 'Restaurar tabela EFVM 2026', classe: 'btn-secundario', onClick: (fechar) => { delete edicoes[velocidade]; U.pref.set('telaCarro:limites', edicoes); fechar(); desenhar(); ui.toast('Limites da tabela EFVM 2026 restaurados.', 'ok'); } },
        { texto: 'Salvar', classe: 'btn-primario', onClick: (fechar) => { edicoes[velocidade] = atual; U.pref.set('telaCarro:limites', edicoes); fechar(); desenhar(); ui.toast(`Limites para ${velocidade} km/h salvos.`, 'ok'); } }
      ]
    });
  }

  App.telaCarro = { montar, aoMostrar, _limitesPadrao: limitesPadrao, _PARAMETROS: PARAMETROS, _VELOCIDADES: VELOCIDADES };
})(window.App);
