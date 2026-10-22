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

  /* ---------------- Limites: módulo central (js/limites.js) ---------------- */

  const Lm = App.limites;
  const { VELOCIDADES, PARAMETROS, NIVEIS } = Lm;
  const limitesDe = Lm.de;
  const grauExcesso = Lm.grau;

  /** Escala de cada coluna (meia largura, em mm): automática pelo arquivo, com zoom − / +. */
  let zoom = U.pref.get('telaCarro:zoom', {}) || {};
  let mostrarEscala = !!U.pref.get('telaCarro:mostrarEscala', false); // botões + / − escondidos por padrão
  const escalaNice = (v) => { const p = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200]; return p.find((x) => x >= v) || Math.ceil(v); };

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
  let velocidade = Lm.velocidade();
  let janela = Number(U.pref.get('telaCarro:janela', 500)); // metros visíveis
  let fator = Number(U.pref.get('telaCarro:fator', 1)); // velocidade da reprodução: 1×, 2×, 3×…
  const BASE_MS = 10; // 1× = 10 m/s de arquivo por segundo
  let revelado = 0; // distância (m) até onde o traçado já foi desenhado (avança com o play)
  let topo = 0; // distância percorrida (m) no topo da tela
  let cursorI = null; // índice do ponto sob o cursor
  let tocando = false;
  let ultimoQuadro = 0;
  let colunaAtiva = null;

  // Tamanho ajustável arrastando a borda de baixo (altura) e a da direita (largura das colunas).
  let ALTURA = Number(U.pref.get('telaCarro:altura', 520));
  let larguraColuna = Number(U.pref.get('telaCarro:largura', 0)) || null; // null = encaixa na tela
  let juntas = !!U.pref.get('telaCarro:juntas', false); // Bitola F e T na mesma coluna
  const COL_EX = 26; const COL_EL = 64; const COL_KM = 58;

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
        h('div', { class: 'tc-rolagem' }, h('div', { class: 'tc-grade' }, cabecalhoEl,
          h('div', { class: 'tc-corpo-caixa' }, corpoEl, alca('largura')), alca('altura'))),
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
      cursorI = d <= revelado && d >= 0 ? indicePorDist(d) : null;
      colunaAtiva = colunaEm(x);
      desenharCursor();
    });
    corpoEl.addEventListener('pointerleave', () => { cursorI = null; colunaAtiva = null; desenharCursor(); });
    window.addEventListener('resize', U.debounce(() => { if (raiz && raiz.offsetParent) desenhar(); }, 150));
    document.addEventListener('em80:analise', () => { if (raiz && raiz.offsetParent) carregar(); });
  }

  function aoMostrar() { velocidade = Lm.velocidade(); carregar(); atualizarMontagem(); }

  /* ---------------- Arquivos da Montagem ---------------- */

  let montagemLista = []; // arquivos carregados na Montagem dos dados (ciclo atual), em ordem de linha e km
  let seguir = !!U.pref.get('telaCarro:seguir', false); // ao terminar um arquivo, roda o próximo
  async function atualizarMontagem() {
    try { montagemLista = App.montagem && App.montagem.lista ? await App.montagem.lista() : []; } catch (e) { montagemLista = []; }
    renderControles();
  }
  const idAtual = () => {
    const id = App.montagem && App.montagem.atual ? App.montagem.atual() : null;
    const a = montagemLista.find((x) => x.id === id);
    return a && a.nome === nomeArquivo ? id : '';
  };
  async function abrirDaMontagem(id, tocarDepois = false) {
    if (!id) return;
    tocando = false;
    const ok = await App.montagem.abrir(id);
    if (ok && tocarDepois) tocar();
  }
  function vizinho(passo) {
    const k = montagemLista.findIndex((x) => x.id === idAtual());
    const j = k + passo;
    return k >= 0 && j >= 0 && j < montagemLista.length ? montagemLista[j] : (k < 0 && passo > 0 ? montagemLista[0] : null);
  }

  /** Alça para arrastar: 'altura' (borda de baixo) ou 'largura' (borda da direita). */
  function alca(tipo) {
    const el = h('div', { class: `tc-alca tc-alca-${tipo}`, title: tipo === 'altura' ? 'Arraste para mudar a altura da tela' : 'Arraste para mudar a largura das colunas', role: 'separator' });
    let ini = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      ini = { x: e.clientX, y: e.clientY, altura: ALTURA, largura: geometria().lp };
    });
    el.addEventListener('pointermove', (e) => {
      if (!ini) return;
      if (tipo === 'altura') ALTURA = Math.round(Math.max(260, Math.min(1600, ini.altura + (e.clientY - ini.y))));
      else larguraColuna = Math.round(Math.max(50, Math.min(320, ini.largura + (e.clientX - ini.x) / colunas().length)));
      if (prep) desenhar();
    });
    const soltar = () => {
      if (!ini) return;
      ini = null;
      U.pref.set('telaCarro:altura', ALTURA);
      if (larguraColuna) U.pref.set('telaCarro:largura', larguraColuna);
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    el.addEventListener('dblclick', () => { ALTURA = 520; larguraColuna = null; U.pref.set('telaCarro:altura', 520); U.pref.set('telaCarro:largura', 0); if (prep) desenhar(); });
    return el;
  }

  /** Colunas da tela; com "F e T juntas", as duas bitolas ficam na mesma coluna. */
  /** Ordem das colunas e colunas escondidas (escolhidas em "Ordem"). */
  let ordem = U.pref.get('telaCarro:ordem', null) || PARAMETROS.map((p) => p.id);
  let ocultos = U.pref.get('telaCarro:ocultos', []) || [];
  const parametrosEmOrdem = () => {
    const ids = [...ordem.filter((id) => PARAMETROS.some((p) => p.id === id)), ...PARAMETROS.map((p) => p.id).filter((id) => !ordem.includes(id))];
    return ids.map((id) => PARAMETROS.find((p) => p.id === id));
  };

  function colunas() {
    const esc = (ids, chave) => { const auto = Math.max(...ids.map((id) => (prep && prep.escala ? prep.escala[id] : PARAMETROS.find((p) => p.id === id).escala))); return Math.max(0.5, auto / (zoom[chave || ids[0]] || 1)); };
    const visiveis = parametrosEmOrdem().filter((p) => !ocultos.includes(p.id));
    const lista = [];
    visiveis.forEach((p) => {
      if (juntas && (p.id === 'bitF' || p.id === 'bitT')) {
        if (lista.some((c) => c.id === 'bitFT')) return; // F e T juntas: uma coluna, na posição da primeira
        const f = PARAMETROS.find((x) => x.id === 'bitF'); const t = PARAMETROS.find((x) => x.id === 'bitT');
        // mesma escala e mesmo zoom da Bitola F: os limites ficam no mesmo lugar da coluna separada
        lista.push({ ...f, id: 'bitFT', nome: 'Bitola F+T', zoomId: 'bitF', escala: esc(['bitF', 'bitT'], 'bitF'), series: [f, t] });
        return;
      }
      lista.push({ ...p, escala: esc([p.id]), series: [p] });
    });
    return lista;
  }

  function editarOrdem() {
    let lista = parametrosEmOrdem().map((p) => p.id);
    let esc = [...ocultos];
    const caixa = h('div', { class: 'tc-ordem' });
    const render = () => ui.trocar(caixa, lista.map((id, k) => {
      const p = PARAMETROS.find((x) => x.id === id);
      return h('div', { class: 'tc-ordem-item' },
        h('label', { class: 'tc-ordem-nome' }, h('input', { type: 'checkbox', checked: !esc.includes(id), onchange: (e) => { esc = e.target.checked ? esc.filter((x) => x !== id) : [...esc, id]; } }), p.nome),
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', 'aria-label': `Subir ${p.nome}`, disabled: k === 0, onclick: () => { [lista[k - 1], lista[k]] = [lista[k], lista[k - 1]]; render(); } }, '▲'),
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', 'aria-label': `Descer ${p.nome}`, disabled: k === lista.length - 1, onclick: () => { [lista[k + 1], lista[k]] = [lista[k], lista[k + 1]]; render(); } }, '▼'));
    }));
    render();
    ui.modal({
      titulo: 'Ordem dos parâmetros',
      conteudo: h('div', { class: 'pilha' }, h('p', { class: 'sub', text: 'Use ▲ ▼ para mudar a ordem (de cima = coluna da esquerda). Desmarque para esconder a coluna.' }), caixa),
      acoes: [
        { texto: 'Ordem padrão', classe: 'btn-secundario', onClick: (fechar) => { ordem = PARAMETROS.map((p) => p.id); ocultos = []; U.pref.set('telaCarro:ordem', ordem); U.pref.set('telaCarro:ocultos', ocultos); fechar(); if (prep) desenhar(); } },
        { texto: 'Salvar', classe: 'btn-primario', onClick: (fechar) => { ordem = lista; ocultos = esc; U.pref.set('telaCarro:ordem', ordem); U.pref.set('telaCarro:ocultos', ocultos); fechar(); if (prep) desenhar(); } }
      ]
    });
  }

  /** Lê o arquivo da Análise e prepara as séries. */
  function carregar() {
    const est = App.analise && App.analise.estado ? App.analise.estado() : {};
    const mudou = est.arquivo !== arquivo || est.resultado !== resultado;
    arquivo = est.arquivo || null; resultado = est.resultado || null; nomeArquivo = est.nomeArquivo || '';
    if (!arquivo) {
      prep = null;
      renderControles();
      ui.trocar(cabecalhoEl); ui.trocar(leituraEl); ui.trocar(rodapeEl);
      ui.trocar(corpoEl, h('p', { class: 'vazio tc-vazio', text: 'Carregue o arquivo do carro em "Análise do arquivo" ou escolha um arquivo da Montagem acima.' }));
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
    // "INICIO X" + "FIM X" viram uma faixa com a extensão (túnel, AMV, RH, travador, lastro alto…)
    const faixas = []; const soltos = [];
    const nomeEv = (t) => String(t || '').replace(/^\s*(INICIO|INÍCIO|FIM)\s+/i, '').trim().toUpperCase();
    const usados = new Set();
    eventos.forEach((ev, k) => {
      if (usados.has(k)) return;
      if (/^\s*(INICIO|INÍCIO)\s+/i.test(ev.texto)) {
        const nome = nomeEv(ev.texto);
        const j = eventos.findIndex((x, m) => m > k && !usados.has(m) && /^\s*FIM\s+/i.test(x.texto) && nomeEv(x.texto) === nome);
        if (j >= 0) { usados.add(k); usados.add(j); faixas.push({ nome, i0: Math.min(ev.i, eventos[j].i), i1: Math.max(ev.i, eventos[j].i), trav: ev.trav, ini: ev, fim: eventos[j] }); return; }
      }
      soltos.push(ev);
    });
    eventos.faixas = faixas; eventos.soltos = soltos;
    prep = { n, esp, dist, tipo, elementoDo, eventos, total: dist[n - 1] || 0 };
    revelado = 0; // ao abrir, a tela começa vazia: o traçado aparece com o play, de baixo para cima
    topo = -janela;
    // escala automática: 98% dos valores do arquivo cabem com folga
    prep.escala = {};
    PARAMETROS.forEach((p) => {
      const v = p.campo === 'kld' && resultado && resultado.kldValido ? resultado.kldValido : arquivo.dados[p.campo];
      if (!v) { prep.escala[p.id] = p.escala; return; }
      const a = [];
      for (let i = 0; i < v.length; i += 7) if (!Number.isNaN(v[i])) a.push(Math.abs(v[i]));
      a.sort((x, y) => x - y);
      const p98 = a.length ? a[Math.floor(a.length * 0.98)] : p.escala;
      prep.escala[p.id] = escalaNice(Math.max(1, p98 * 1.3));
    });
    cursorI = null;
  }

  /* ---------------- Navegação ---------------- */

  // o topo pode ser negativo: no início o traçado nasce embaixo e sobe (como no Offboard)
  const limitarTopo = (t) => Math.max(-janela, Math.min(t, Math.max(0, prep.total - janela * 0.2)));
  function mover(dm) { topo = limitarTopo(topo + dm); desenhar(); }
  /** Avança o traçado (como o carro andando); a tela rola quando ele chega perto do fim. */
  function avancar(dm) {
    revelado = Math.min(prep.total, revelado + dm);
    topo = revelado - janela; // o ponto mais novo fica embaixo; o resto sobe
    desenhar();
  }
  function reiniciar() { revelado = 0; topo = -janela; cursorI = null; desenhar(); }

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
    topo = revelado - janela;
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
      if (revelado >= prep.total) {
        tocando = false; renderControles();
        const prox = seguir ? vizinho(1) : null; // rodar os arquivos da Montagem em sequência
        if (prox) { ui.toast(`Próximo arquivo: ${prox.nome}`, 'info', 3000); abrirDaMontagem(prox.id, true); }
        return;
      }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  /* ---------------- Controles ---------------- */

  function renderControles() {
    const sel = (valor, opcoes, aoMudar, rotulo) => h('label', { class: 'tc-campo' }, h('span', { text: rotulo }),
      h('select', { value: String(valor), onchange: (e) => aoMudar(Number(e.target.value)) }, opcoes.map(([v, t]) => h('option', { value: String(v), text: t }))));
    const kmInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex.: 312+000', 'aria-label': 'Ir para o km', onkeydown: (e) => { if (e.key === 'Enter') irParaKm(e.target.value); } });
    const atualId = idAtual();
    const anterior = vizinho(-1); const proximo = vizinho(1);
    const linhaMontagem = montagemLista.length ? h('div', { class: 'tc-linha tc-linha-arquivo' },
      h('label', { class: 'tc-campo tc-campo-arquivo' }, h('span', { text: `Arquivos da Montagem${App.montagem.ciclo() ? ` (ciclo ${App.montagem.ciclo()})` : ''}` }),
        h('select', { 'aria-label': 'Arquivo da Montagem', onchange: (e) => abrirDaMontagem(e.target.value) },
          h('option', { value: '', selected: !atualId || null, text: atualId ? '—' : `Arquivo da Análise${nomeArquivo ? `: ${nomeArquivo}` : ''}` }),
          montagemLista.map((a) => h('option', { value: a.id, selected: a.id === atualId || null, text: a.rotulo })))),
      h('div', { class: 'tc-botoes' },
        h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', disabled: !anterior || null, title: anterior ? anterior.nome : '', onclick: () => abrirDaMontagem(anterior.id) }, ui.icone('esquerda'), 'Anterior'),
        h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', disabled: !proximo || null, title: proximo ? proximo.nome : '', onclick: () => abrirDaMontagem(proximo.id) }, 'Próximo', ui.icone('direita'))),
      h('label', { class: 'chip-sel' }, h('input', { type: 'checkbox', checked: seguir || null, onchange: (e) => { seguir = e.target.checked; U.pref.set('telaCarro:seguir', seguir); } }), 'Ao terminar, rodar o próximo arquivo')) : null;
    ui.trocar(controlesEl,
      linhaMontagem,
      h('div', { class: 'tc-linha' },
        h('div', { class: 'tc-campo' }, h('span', { text: 'Ir para o km' }),
          h('div', { class: 'linha-campo' }, kmInput, h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', onclick: () => irParaKm(kmInput.value) }, 'Ir'))),
        sel(janela, [[250, '250 m'], [500, '500 m'], [1000, '1.000 m'], [2000, '2.000 m']], (v) => { janela = v; U.pref.set('telaCarro:janela', v); if (prep) { topo = revelado - janela; desenhar(); } }, 'Trecho na tela'),
        sel(velocidade, VELOCIDADES.map((v) => [v, `${v} km/h`]), (v) => { velocidade = v; Lm.mudarVelocidade(v); desenhar(); }, 'Limites para'),
        sel(fator, [1, 2, 3, 5, 10, 20].map((v) => [v, `${v}×`]), (v) => { fator = v; U.pref.set('telaCarro:fator', v); }, 'Velocidade'),
        h('div', { class: 'tc-botoes' },
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Voltar um trecho', disabled: !prep, onclick: () => mover(-janela * 0.8) }, '▲'),
          h('button', { class: `btn ${tocando ? 'btn-primario' : 'btn-secundario'} btn-pequeno`, type: 'button', disabled: !prep, onclick: tocar }, ui.icone(tocando ? 'parar' : 'play'), tocando ? 'Pausar' : 'Reproduzir'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Avançar um trecho', disabled: !prep, onclick: () => (topo + janela >= revelado ? avancar(janela * 0.8) : mover(janela * 0.8)) }, '▼'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', title: 'Voltar ao início do arquivo, com a tela vazia', disabled: !prep, onclick: reiniciar }, 'Reiniciar'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', onclick: editarLimites }, ui.icone('ajustes'), 'Limites'),
          h('button', { class: 'btn btn-secundario btn-pequeno', type: 'button', onclick: editarOrdem }, '⇅ Ordem')),
        h('label', { class: 'chip-sel tc-juntas' }, h('input', {
          type: 'checkbox', checked: juntas,
          onchange: (e) => { juntas = e.target.checked; U.pref.set('telaCarro:juntas', juntas); if (prep) desenhar(); }
        }), 'Bitola F e T juntas')));
  }

  /* ---------------- Desenho ---------------- */

  function geometria() {
    const largura = Math.max(320, corpoEl.parentElement ? corpoEl.parentElement.clientWidth : 900);
    const base = COL_KM + COL_EX + COL_EL;
    const nc = colunas().length;
    const lp = larguraColuna || Math.max(78, Math.floor((largura - base - 12) / nc));
    return { lp, W: base + lp * nc, base };
  }

  function colunaEm(x) {
    const { lp, base } = geometria();
    const cols = colunas();
    const k = Math.floor((x - base) / lp);
    return k >= 0 && k < cols.length ? cols[k] : null;
  }

  const s = (tag, attrs = {}, ...filhos) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); });
    filhos.flat().forEach((f) => { if (f) el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return el;
  };

  function mudarZoom(id, f) {
    zoom[id] = Math.max(0.25, Math.min(16, (zoom[id] || 1) * f));
    U.pref.set('telaCarro:zoom', zoom);
    desenhar();
  }

  function desenhar() {
    if (!prep) return;
    const { lp, W, base } = geometria();
    const H = ALTURA;
    const { dist, tipo, n } = prep;
    const dados = (resultado && resultado.dados) || arquivo.dados;
    const i0 = indicePorDist(Math.max(0, topo));
    // só o que o "carro" já percorreu (play): ao abrir, nada é desenhado
    const i1 = revelado > Math.max(topo, 0) ? Math.min(indicePorDist(topo + janela), indicePorDist(revelado)) : -1;
    const yDe = (i) => ((dist[i] - topo) / janela) * H;
    const tipoLim = (i) => (tipo[i] === 1 ? 'C' : 'T');

    // cabeçalho (nomes girados, como na tela do carro)
    ui.trocar(cabecalhoEl, h('div', { class: 'tc-cab-linha', style: { width: `${W}px` } },
      h('div', { class: 'tc-cab-cel', style: { width: `${COL_KM}px` } },
        h('button', {
          type: 'button', class: 'tc-seta-escala', title: mostrarEscala ? 'Esconder os botões de escala' : 'Mostrar os botões de escala (+ / −)',
          'aria-label': mostrarEscala ? 'Esconder escala' : 'Mostrar escala', 'aria-expanded': mostrarEscala ? 'true' : 'false',
          onclick: () => { mostrarEscala = !mostrarEscala; U.pref.set('telaCarro:mostrarEscala', mostrarEscala); desenhar(); }
        }, mostrarEscala ? '◂ escala' : 'escala ▸')),
      h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${COL_EX}px` } }, h('span', { text: 'EX' })),
      h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${COL_EL}px` } }, h('span', { text: 'T/E' })),
      colunas().map((p) => h('div', { class: 'tc-cab-cel tc-cab-gira', style: { width: `${lp}px` }, title: p.nome },
        mostrarEscala && h('div', { class: 'tc-zoom' },
          h('button', { type: 'button', title: 'Diminuir a escala (mais detalhe)', 'aria-label': `Aproximar ${p.nome}`, onclick: () => mudarZoom(p.zoomId || p.id, 1.5) }, '+'),
          h('button', { type: 'button', title: 'Aumentar a escala', 'aria-label': `Afastar ${p.nome}`, onclick: () => mudarZoom(p.zoomId || p.id, 1 / 1.5) }, '−')),
        h('span', null, h('strong', { text: p.nome }), h('small', { text: `±${String(Math.round(p.escala * 10) / 10).replace('.', ',')}` }))))));

    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tc-svg' });
    // km na lateral (sem linha horizontal)
    const passoKm = janela <= 500 ? 50 : (janela <= 1000 ? 100 : 200);
    for (let d = Math.max(0, Math.ceil(topo / passoKm) * passoKm); d <= Math.min(topo + janela, revelado); d += passoKm) {
      const i = indicePorDist(d);
      const y = ((d - topo) / janela) * H;
      if (y < 8 || y > H - 4) continue;
      svg.appendChild(s('text', { x: COL_KM - 6, y: y + 4, class: 'tc-km', 'text-anchor': 'end' }, App.bitola.fmtKm(arquivo.pos[i])));
    }

    // coluna T/E: elementos (tangente = linha, curva = barra azul, RH = cinza) e eventos
    const xEl = COL_KM + COL_EX;
    const vistos = new Set();
    for (let i = i0; i <= i1; i++) {
      const e = prep.elementoDo[i];
      if (!e || vistos.has(e)) continue;
      vistos.add(e);
      const ya = Math.max(0, yDe(Math.max(e.i0, i0))); const yb = Math.min(H, yDe(Math.min(e.i1, i1)));
      const t = e.tipo === 'C' ? 'curva' : (e.tipo === 'X' || e.rh ? 'rh' : 'tangente');
      if (t === 'tangente') svg.appendChild(s('line', { x1: xEl + 32, x2: xEl + 32, y1: ya, y2: yb, class: 'tc-el-tangente' }));
      else svg.appendChild(s('rect', { x: xEl + 28, y: ya, width: 9, height: Math.max(1, yb - ya), class: `tc-el-${t}` }));
      if (yb - ya > 26) svg.appendChild(s('text', { x: xEl + 40, y: (ya + yb) / 2 + 3, class: 'tc-el-rotulo' }, t === 'rh' ? (e.trecho || 'RH').split(' · ')[0].replace('RH-', 'R') : e.sigla));
    }
    // eventos com extensão (INICIO/FIM): barra na lateral esquerda durante todo o trecho, com o nome na vertical
    const classeEv = (nome) => (/^EX\b/.test(nome) ? 'ex' : /TUNEL|TÚNEL/.test(nome) ? 'tunel' : /TRA?V/.test(nome) ? 'trav' : /AMV/.test(nome) ? 'amv' : /^RH/.test(nome) ? 'rh' : 'outro');
    (prep.eventos.faixas || []).forEach((fx) => {
      if (fx.i1 < i0 || fx.i0 > i1) return;
      const a = Math.max(0, yDe(Math.max(fx.i0, i0))); const b = Math.min(H, yDe(Math.min(fx.i1, i1)));
      const ya = Math.min(a, b); const yb = Math.max(a, b);
      const g = s('g', { class: `tc-ev tc-ev-faixa tc-ev-${classeEv(fx.nome)}` }, s('title', {}, `${fx.nome}: ${App.bitola.fmtKm(fx.ini.pos)} → ${App.bitola.fmtKm(fx.fim.pos)}`));
      g.appendChild(s('rect', { x: xEl + 2, y: ya, width: 5, height: Math.max(2, yb - ya) }));
      g.appendChild(s('text', { x: xEl + 17, y: yb - 2, transform: `rotate(-90 ${xEl + 17} ${yb - 2})`, 'text-anchor': 'start' }, fx.nome.slice(0, 16)));
      svg.appendChild(g);
    });
    // eventos de um ponto (JIC, PSUP, lubrificador…): marca e texto na vertical (lido de baixo para cima)
    (prep.eventos.soltos || prep.eventos).forEach((ev) => {
      if (ev.i < i0 || ev.i > i1) return;
      const y = yDe(ev.i);
      const g = s('g', { class: ev.trav ? 'tc-ev tc-ev-trav' : 'tc-ev' }, s('title', {}, `${ev.texto} (${App.bitola.fmtKm(ev.pos)})`));
      g.appendChild(s('line', { x1: xEl + 1, x2: xEl + 26, y1: y, y2: y }));
      g.appendChild(s('text', { x: xEl + 17, y: y - 2, transform: `rotate(-90 ${xEl + 17} ${y - 2})`, 'text-anchor': 'start' }, ev.trav ? 'TRAV' : ev.texto.slice(0, 16)));
      svg.appendChild(g);
    });

    // colunas dos parâmetros
    const filas = Math.ceil(H); // uma fila por pixel
    const excessoGeral = new Uint8Array(filas + 1);
    colunas().forEach((col, k) => {
      const x0 = base + k * lp;
      const cx = x0 + lp / 2;
      const meia = lp / 2 - 6;
      // valor maior à esquerda da linha zero (como no Offboard)
      const xv = (v) => cx - (Math.max(-col.escala, Math.min(col.escala, v)) / col.escala) * meia;
      const dentro = (v) => Math.abs(v) <= col.escala;
      const lims = limitesDe(col.series[0], velocidade);
      // linha zero (bitola: 1000 mm), indispensável
      svg.appendChild(s('line', { x1: cx, x2: cx, y1: 0, y2: H, class: 'tc-zero' }));
      // limites (pontilhado) de cada nível, por fila (mudam entre curva e tangente); fora da escala não aparecem
      const elF = new Array(filas + 1);
      for (let i = i0; i <= i1; i++) {
        const f = Math.max(0, Math.min(filas, Math.round(yDe(i))));
        if (!elF[f]) elF[f] = tipoLim(i);
      }
      NIVEIS.forEach((nv) => ['sup', 'inf'].forEach((lado) => {
        let d = ''; let aberto = false;
        for (let f = 0; f <= filas; f++) {
          if (!elF[f]) continue;
          const l = lims[nv.id][elF[f]];
          if (!l || !dentro(l[lado])) { aberto = false; continue; }
          d += `${aberto ? 'L' : 'M'}${xv(l[lado]).toFixed(1)},${f}`;
          aberto = true;
        }
        if (d) svg.appendChild(s('path', { d, class: `tc-limite tc-limite-${nv.id}` }));
      }));
      let algum = false;
      col.series.forEach((p) => {
        // KLD: só leituras válidas (|valor| < 60 mm), como na análise
        const serie = p.campo === 'kld' && resultado && resultado.kldValido ? resultado.kldValido : dados[p.campo];
        if (!serie) return;
        algum = true;
        // agrega por fila de pixel: mín, máx e excesso
        const minF = new Float64Array(filas + 1).fill(NaN); const maxF = new Float64Array(filas + 1).fill(NaN);
        const exc = new Uint8Array(filas + 1);
        for (let i = i0; i <= i1; i++) {
          const v = serie[i];
          if (Number.isNaN(v)) continue;
          const f = Math.max(0, Math.min(filas, Math.round(yDe(i))));
          if (Number.isNaN(minF[f]) || v < minF[f]) minF[f] = v;
          if (Number.isNaN(maxF[f]) || v > maxF[f]) maxF[f] = v;
          const g = grauExcesso(lims, tipoLim(i), v);
          if (g > exc[f]) exc[f] = g;
          if (g > excessoGeral[f]) excessoGeral[f] = g;
        }
        // traçado: em cada fila, do mínimo ao máximo, ligado à fila seguinte;
        // o trecho que passa do limite fica vermelho
        let d = ''; let antes = false;
        const dv = ['', '', '', '']; let antesV = 0;
        for (let f = 0; f <= filas; f++) {
          if (Number.isNaN(minF[f])) { antes = false; antesV = 0; continue; }
          const seg = `${xv(minF[f]).toFixed(1)},${f}L${xv(maxF[f]).toFixed(1)},${f}`;
          d += `${antes ? 'L' : 'M'}${seg}`;
          antes = true;
          const g = exc[f];
          if (g) { dv[g] += `${antesV === g ? 'L' : 'M'}${seg}`; antesV = g; } else antesV = 0;
        }
        if (d) svg.appendChild(s('path', { d, class: 'tc-sinal', stroke: p.cor }));
        NIVEIS.forEach((nv) => { if (dv[nv.grau]) svg.appendChild(s('path', { d: dv[nv.grau], class: `tc-sinal tc-sinal-excesso tc-exc-${nv.id}` })); });
      });
      if (!algum) svg.appendChild(s('text', { x: cx, y: 20, class: 'tc-sem', 'text-anchor': 'middle' }, 'sem dado'));
    });
    // coluna EX: excesso em qualquer parâmetro
    for (let f = 0; f <= filas; f++) {
      const grau = excessoGeral[f];
      if (!grau) continue;
      let g = f; while (g <= filas && excessoGeral[g] === grau) g++;
      svg.appendChild(s('rect', { x: COL_KM + 6, y: f, width: COL_EX - 10, height: Math.max(2, g - f), class: `tc-ex tc-ex-${NIVEIS[grau - 1].id}` }));
      f = g - 1;
    }
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
      ui.trocar(leituraEl, h('span', { class: 'tc-leitura-km', text: revelado > 0 ? App.bitola.fmtKm(arquivo.pos[i]) : '' }));
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
      colunaAtiva.series.forEach((p) => {
        const serie = dados[p.campo];
        if (!serie) return;
        const i0 = indicePorDist(topo); const i1 = Math.min(indicePorDist(topo + janela), indicePorDist(revelado));
        let mx = -Infinity; let mn = Infinity; let soma = 0; let q = 0;
        for (let i = i0; i <= i1; i++) { const v = serie[i]; if (Number.isNaN(v)) continue; mx = Math.max(mx, v); mn = Math.min(mn, v); soma += v; q++; }
        partes.push(h('strong', { text: p.nome }), h('span', { text: `VALOR: ${fmt(serie[cursorI])}  MÁX: ${q ? fmt(mx) : '—'}  MÍN: ${q ? fmt(mn) : '—'}  MÉD: ${q ? fmt(soma / q) : '—'}` }));
      });
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
        par('LIMITES', `${velocidade} km/h (${Lm.editados(velocidade) ? Lm.TEXTOS.editados : Lm.TEXTOS.tabela})`)));
  }

  /* ---------------- Edição dos limites ---------------- */

  function editarLimites() {
    const linhas = PARAMETROS.filter((p) => p.grupo);
    const atual = {};
    linhas.forEach((p) => { atual[p.id] = JSON.parse(JSON.stringify(limitesDe(p, velocidade))); });
    let nivel = 'restricao';
    const caixa = h('div', { class: 'pilha' });
    const campo = (p, el, lado) => {
      const lim = atual[p.id][nivel][el];
      return h('input', {
        type: 'text', inputmode: 'decimal', class: 'tc-lim-input', 'aria-label': `${p.nome} ${el === 'C' ? 'curva' : 'tangente'} ${lado === 'sup' ? 'superior' : 'inferior'}`,
        value: lim ? String(lim[lado]).replace('.', ',') : '',
        onchange: (e) => {
          const v = U.numero(e.target.value);
          if (e.target.value.trim() === '') { atual[p.id][nivel][el] = null; return; }
          if (v === null) { e.target.value = ''; return; }
          const l = atual[p.id][nivel][el] || { sup: Math.abs(v), inf: -Math.abs(v) };
          l[lado] = v;
          atual[p.id][nivel][el] = l;
        }
      });
    };
    const render = () => ui.trocar(caixa,
      h('div', { class: 'seg seg-compacto', role: 'group', 'aria-label': 'Nível do limite' },
        NIVEIS.map((n) => h('button', { type: 'button', class: `seg-opcao tc-nivel-${n.id}${nivel === n.id ? ' ativo' : ''}`, onclick: () => { nivel = n.id; render(); } }, n.nome))),
      h('p', { class: 'sub', text: `${NIVEIS.find((n) => n.id === nivel).nome}: valores em mm em relação à linha zero (bitola: em relação a 1000 mm; fechada 987 = −13). Em branco: sem limite.${nivel === 'restricao' ? ' Padrão: tabela EFVM 2026.' : ''}` }),
      h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro tc-lim' },
        h('thead', null,
          h('tr', null, h('th', { text: 'Parâmetro', rowspan: 2 }), h('th', { text: 'Curva', colspan: 2 }), h('th', { text: 'Tangente', colspan: 2 })),
          h('tr', null, ['Superior', 'Inferior', 'Superior', 'Inferior'].map((t) => h('th', { text: t })))),
        h('tbody', null, linhas.map((p) => h('tr', null, h('td', { text: p.nome }),
          h('td', null, campo(p, 'C', 'sup')), h('td', null, campo(p, 'C', 'inf')),
          h('td', null, campo(p, 'T', 'sup')), h('td', null, campo(p, 'T', 'inf'))))))));
    render();
    ui.modal({
      titulo: `Limites para ${velocidade} km/h`,
      conteudo: caixa,
      acoes: [
        { texto: 'Restaurar tabela EFVM 2026', classe: 'btn-secundario', onClick: (fechar) => { Lm.salvarEdicoes(velocidade, null); fechar(); desenhar(); ui.toast('Limites da tabela EFVM 2026 restaurados (alerta e interdição em branco).', 'ok'); } },
        { texto: 'Salvar', classe: 'btn-primario', onClick: (fechar) => { Lm.salvarEdicoes(velocidade, atual); fechar(); desenhar(); ui.toast(`Limites para ${velocidade} km/h salvos.`, 'ok'); } }
      ]
    });
  }

  App.telaCarro = {
    montar, aoMostrar,
    irParaKm: (t) => { if (prep) irParaKm(t); },
    _limitesPadrao: Lm.padrao, _PARAMETROS: PARAMETROS, _VELOCIDADES: VELOCIDADES
  };
})(window.App);
