/*
 * Análise do arquivo CSV do carro controle (aba dentro do Checklist):
 * bitola frontal × traseira, OGMS × KLD, tangentes e curvas, perda de bitola,
 * alinhamento e ranking de nivelamento. Sempre com o km no eixo X.
 */
'use strict';

(function (App) {
  const { U, ui, store, charts } = App;
  const B = App.bitola;
  const { h } = ui;
  const CHAVE = 'bitola:ultimo';

  let raiz;
  let arquivo = null; // resultado de B.lerCSV
  let nomeArquivo = '';
  let resultado = null; // resultado de B.analisar
  let opcoes = { ...B.PADRAO, alinhamento: 'alr10', ...(U.pref.get('bitola:opcoes', {}) || {}) };
  let rankingCampo = 'nl20';
  let zoom = null; // { x0, x1 } ou null (trecho todo)
  let graficos = [];

  const secoes = {};

  function montar(el) {
    raiz = el;
    ['arquivo', 'parametros', 'kpis', 'graficos', 'elementos', 'ranking'].forEach((k) => { secoes[k] = h('div'); });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Análise do arquivo do carro controle' }),
        h('p', { class: 'sub', text: 'Bitola frontal × traseira, OGMS × KLD, tangentes e curvas, alinhamento e nivelamento.' })),
      secoes.arquivo, secoes.parametros, secoes.kpis, secoes.graficos, secoes.elementos, secoes.ranking);
    renderArquivo();
    carregarUltimo();
  }

  /* ---------------- Arquivo ---------------- */

  async function carregarUltimo() {
    try {
      const salvo = await store.get(CHAVE);
      if (salvo && salvo.texto) processar(salvo.texto, salvo.nome, { salvar: false });
    } catch (e) { /* sem arquivo salvo */ }
  }

  async function lerArquivo(f) {
    const buf = await f.arrayBuffer();
    let texto;
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      texto = new TextDecoder('windows-1252').decode(buf); // arquivos do carro costumam vir em ANSI
    }
    processar(texto, f.name, { salvar: true });
  }

  function processar(texto, nome, { salvar }) {
    try {
      arquivo = B.lerCSV(texto);
    } catch (e) {
      arquivo = null;
      resultado = null;
      renderTudo();
      ui.toast(`Não foi possível ler o arquivo: ${e.message}`, 'erro', 7000);
      return;
    }
    nomeArquivo = nome || 'arquivo.csv';
    zoom = null;
    recalcular();
    if (salvar) store.set(CHAVE, { nome: nomeArquivo, texto }).catch(() => {});
  }

  function recalcular() {
    resultado = arquivo ? B.analisar(arquivo, opcoes) : null;
    renderTudo();
  }

  function renderTudo() {
    renderArquivo();
    renderParametros();
    renderKpis();
    renderGraficos();
    renderElementos();
    renderRanking();
  }

  function renderArquivo() {
    const input = h('input', {
      type: 'file',
      accept: '.csv,.txt',
      onchange: (e) => { const f = e.target.files[0]; if (f) lerArquivo(f); }
    });
    const meta = arquivo && arquivo.meta;
    ui.trocar(secoes.arquivo, h('section', { class: 'cartao' },
      h('h2', { text: 'Arquivo' }),
      ui.campo('Arquivo CSV gerado pelo carro controle', input),
      arquivo ? h('div', { class: 'pilha-p' },
        h('p', null, h('strong', { text: nomeArquivo })),
        h('p', { class: 'sub', text: [
          meta.ramal && `Ramal ${meta.ramal}`,
          meta.linha && `Linha ${meta.linha}`,
          meta.data,
          meta.inspetor,
          `${B.fmtKm(arquivo.pos[0])} → ${B.fmtKm(arquivo.pos[arquivo.pos.length - 1])}`,
          `${(resultado.geral.extensao / 1000).toFixed(2).replace('.', ',')} km`,
          `${arquivo.pos.length.toLocaleString('pt-BR')} pontos`
        ].filter(Boolean).join(' · ') }),
        arquivo.avisos.length ? h('p', { class: 'aviso', text: arquivo.avisos.join(' ') }) : null,
        h('button', {
          class: 'btn btn-fantasma',
          onclick: async () => {
            arquivo = null; resultado = null; nomeArquivo = '';
            await store.del(CHAVE).catch(() => {});
            renderTudo();
          }
        }, ui.icone('lixo'), 'Remover arquivo')) : h('p', { class: 'sub', text: 'O arquivo fica guardado neste aparelho até você remover ou abrir outro.' })));
  }

  /* ---------------- Parâmetros ---------------- */

  function renderParametros() {
    if (!arquivo) return ui.limpar(secoes.parametros);
    const numero = (campo, rotulo, ajuda) => ui.campo(rotulo, h('input', {
      type: 'text',
      inputmode: 'decimal',
      value: String(opcoes[campo]).replace('.', ','),
      onchange: (e) => {
        const v = U.numero(e.target.value);
        if (v === null || v <= 0) { e.target.value = String(opcoes[campo]).replace('.', ','); return; }
        opcoes = { ...opcoes, [campo]: v };
        U.pref.set('bitola:opcoes', opcoes);
        recalcular();
      }
    }), { ajuda });

    ui.trocar(secoes.parametros, h('details', { class: 'cartao detalhes' },
      h('summary', null, h('strong', { text: 'Critérios da análise' }),
        h('span', { class: 'sub', text: ` · curva a partir de |10000/R| ${opcoes.limiarCurva} · perda acima de ${opcoes.limitePerda} mm` })),
      h('div', { class: 'grade-2', style: { marginTop: '12px' } },
        numero('limiarCurva', 'Limite de curva (|10000/R|)', 'Abaixo disso é tangente. 3 ≈ raio de 3.333 m.'),
        numero('limitePerda', 'Limite de perda de bitola (mm)', '|Bitola F − Bitola T| acima disso = perda.'),
        numero('suavizacao', 'Suavização da curvatura (m)', 'Média móvel para evitar oscilações.'),
        numero('comprimentoMin', 'Comprimento mínimo do elemento (m)', 'Trechos menores são unidos ao vizinho.')),
      h('button', {
        class: 'btn btn-fantasma',
        onclick: () => {
          opcoes = { ...B.PADRAO, alinhamento: opcoes.alinhamento };
          U.pref.set('bitola:opcoes', opcoes);
          recalcular();
        }
      }, 'Restaurar padrão')));
  }

  /* ---------------- Indicadores ---------------- */

  const fmt = (v, casas = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(casas).replace('.', ','));

  function renderKpis() {
    if (!resultado) return ui.limpar(secoes.kpis);
    const r = resultado;
    const kpi = (titulo, valor, sub) => h('div', { class: 'kpi' },
      h('div', { class: 'kpi-titulo', text: titulo }),
      h('div', { class: 'kpi-valor', text: valor }),
      h('div', { class: 'kpi-sub', text: sub }));
    ui.trocar(secoes.kpis, h('div', { class: 'kpis' },
      kpi('Perda de bitola', `${fmt(r.geral.pctPerda)}%`, `${r.geral.perdas.toLocaleString('pt-BR')} de ${r.geral.pontos.toLocaleString('pt-BR')} pontos`),
      kpi('Em tangentes', `${fmt(r.tangentes.pctPerda)}%`, `${r.tangentes.quantidade} tangente(s) · ${fmt(r.tangentes.extensao / 1000, 2)} km`),
      kpi('Em curvas', `${fmt(r.curvas.pctPerda)}%`, `${r.curvas.quantidade} curva(s) · ${fmt(r.curvas.extensao / 1000, 2)} km`),
      kpi('OGMS − KLD', `${fmt(r.geral.difKldMedia, 2)} mm`, `diferença média · ${fmt(r.geral.pctKld)}% acima de ${fmt(opcoes.limitePerda, 0)} mm`)));
  }

  /* ---------------- Gráficos ---------------- */

  function renderGraficos() {
    graficos.forEach((g) => g.destruir());
    graficos = [];
    if (!resultado) return ui.limpar(secoes.graficos);
    const { pos, dados, eventos } = arquivo;
    const r = resultado;
    const x0 = zoom ? zoom.x0 : pos[0];
    const x1 = zoom ? zoom.x1 : pos[pos.length - 1];
    const lim = opcoes.limitePerda;
    const info = h('div', { class: 'info-km', 'aria-live': 'polite' }, 'Passe o dedo ou o mouse sobre um gráfico para ver os valores.');

    const faixas = r.elementos.map((e) => ({ ini: e.ini, fim: e.fim, classe: e.tipo === 'C' ? 'faixa-curva' : null, rotulo: e.sigla }));
    const nomeAlin = (B.ALINHAMENTO.find((a) => a.id === opcoes.alinhamento) || B.ALINHAMENTO[0]).nome;
    const alertas = Float64Array.from(r.difFT, (v) => (Math.abs(v) > lim ? v : NaN));

    const aoPassar = (p) => {
      graficos.forEach((g) => g.guia(p));
      if (p === null) return;
      const i = B.indicePerto(pos, p);
      const el = B.elementoDo(r.elementos, i);
      const v = (a) => fmt(a[i], 2);
      ui.trocar(info,
        h('strong', { text: `${B.fmtKm(pos[i])}` }), el ? ` · ${el.nome}` : '',
        h('span', { text: ` · F ${v(dados.bitF)} · T ${v(dados.bitT)} · F−T ${v(r.difFT)}` }),
        h('span', { text: ` · KLD ${v(dados.kld)} · OGMS−KLD ${v(r.difKld)}` }),
        h('span', { text: ` · 10000/R ${v(dados.curv)} · ${nomeAlin} ${v(dados[opcoes.alinhamento])}` }));
    };

    const base = { pos, x0, x1, fmtX: B.fmtKm, aoPassar, faixas };
    const blocos = [
      ['Curvatura (10000/R) — tangentes e curvas', { ...base, series: [{ nome: '10000/R', valores: dados.curv, classe: 's1' }], referencias: [opcoes.limiarCurva, -opcoes.limiarCurva], eventos }],
      ['Bitola frontal e traseira (mm)', { ...base, series: [{ nome: 'Bitola F', valores: dados.bitF, classe: 's1' }, { nome: 'Bitola T', valores: dados.bitT, classe: 's2' }] }],
      [`Diferença Bitola F − Bitola T (mm) — perda acima de ±${fmt(lim, 0)} mm`, { ...base, series: [{ nome: 'F − T', valores: r.difFT, classe: 's1' }, { nome: 'Perda', valores: alertas, classe: 's-alerta', tipo: 'pontos' }], referencias: [lim, -lim], legenda: false }],
      ['Diferença OGMS − KLD (mm)', { ...base, series: [{ nome: 'OGMS (F) − KLD', valores: r.difKld, classe: 's1' }], referencias: [lim, -lim] }],
      [`Alinhamento: ${nomeAlin}`, { ...base, series: [{ nome: nomeAlin, valores: dados[opcoes.alinhamento], classe: 's1' }] }]
    ];

    // Perda por elemento (degraus ao longo do km).
    const pctPorPonto = new Float64Array(pos.length).fill(NaN);
    r.elementos.forEach((e) => { for (let i = e.i0; i <= e.i1; i++) pctPorPonto[i] = e.pctPerda === null ? NaN : e.pctPerda; });
    blocos.push(['Perda de bitola por elemento (%)', { ...base, series: [{ nome: '% perda', valores: pctPorPonto, classe: 's1' }], yFaixa: [0, 100] }]);

    const seletorAlin = h('select', {
      'aria-label': 'Parâmetro de alinhamento',
      value: opcoes.alinhamento,
      onchange: (e) => { opcoes = { ...opcoes, alinhamento: e.target.value }; U.pref.set('bitola:opcoes', opcoes); recalcular(); }
    }, B.ALINHAMENTO.map((a) => h('option', { value: a.id, text: a.nome })));

    const conteudo = blocos.map(([titulo, op], k) => {
      const g = charts.graficoKm({ ...op, titulo });
      graficos.push(g);
      return h('div', { class: 'graf-km-item' },
        h('div', { class: 'graf-km-cab' }, h('h3', { text: titulo }), k === 4 ? seletorAlin : null),
        g.el);
    });

    ui.trocar(secoes.graficos, h('section', { class: 'cartao' },
      h('div', { class: 'graf-km-topo' },
        h('h2', { text: 'Gráficos ao longo do km' }),
        h('div', { class: 'linha-campo' },
          h('span', { class: 'sub', text: zoom ? `Trecho: ${B.fmtKm(x0)} → ${B.fmtKm(x1)}` : 'Trecho completo' }),
          zoom ? h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => { zoom = null; renderGraficos(); } }, 'Ver tudo') : null)),
      h('p', { class: 'sub', text: 'Faixas sombreadas = curvas. Toque numa linha da tabela de elementos ou do ranking para aproximar.' }),
      info,
      conteudo));
  }

  function aproximar(ini, fim, margem = 0.1) {
    const ext = Math.abs(fim - ini) || 50;
    const sentido = arquivo.pos[arquivo.pos.length - 1] >= arquivo.pos[0] ? 1 : -1;
    const a = Math.min(ini, fim) - ext * margem;
    const b = Math.max(ini, fim) + ext * margem;
    zoom = sentido > 0 ? { x0: a, x1: b } : { x0: b, x1: a };
    renderGraficos();
    secoes.graficos.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Elementos ---------------- */

  function renderElementos() {
    if (!resultado) return ui.limpar(secoes.elementos);
    const evs = arquivo.eventos;
    const linhas = resultado.elementos.map((e) => {
      const lo = Math.min(e.ini, e.fim); const hi = Math.max(e.ini, e.fim);
      const nomesEv = [...new Set(evs.filter((v) => v.pos >= lo && v.pos <= hi).map((v) => v.texto))].join(', ');
      const pct = e.pctPerda;
      return h('tr', { tabindex: '0', onclick: () => aproximar(e.ini, e.fim), onkeydown: (ev) => { if (ev.key === 'Enter') aproximar(e.ini, e.fim); } },
        h('td', null, h('span', { class: `el-tag ${e.tipo === 'C' ? 'el-curva' : 'el-tangente'}`, text: e.sigla })),
        h('td', { text: B.fmtKm(e.ini) }),
        h('td', { text: B.fmtKm(e.fim) }),
        h('td', { class: 'num', text: Math.round(e.extensao).toLocaleString('pt-BR') }),
        h('td', { class: 'num', text: e.tipo === 'C' && e.raioMedio ? Math.round(e.raioMedio).toLocaleString('pt-BR') : '—' }),
        h('td', { class: 'num' }, h('div', { class: 'barra-pct' },
          h('span', { class: 'barra-pct-fundo' }, h('span', { style: { width: `${Math.min(pct || 0, 100)}%` } })),
          h('span', { text: `${fmt(pct)}%` }))),
        h('td', { class: 'num', text: fmt(e.maxDif, 2) }),
        h('td', { class: 'num', text: fmt(e.difKldMedia, 2) }),
        h('td', { class: 'num', text: fmt(e.alinhMax, 2) }),
        h('td', { class: 'ev', text: nomesEv || '' }));
    });
    const nomeAlin = (B.ALINHAMENTO.find((a) => a.id === opcoes.alinhamento) || B.ALINHAMENTO[0]).nome;
    ui.trocar(secoes.elementos, h('section', { class: 'cartao' },
      h('h2', { text: 'Elementos: tangentes e curvas' }),
      h('p', { class: 'sub', text: `Numerados na ordem da inspeção. % perda = pontos com |Bitola F − Bitola T| > ${fmt(opcoes.limitePerda, 0)} mm ÷ pontos medidos no elemento.` }),
      h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
        h('thead', null, h('tr', null,
          ['Elemento', 'Início', 'Fim', 'Ext. (m)', 'Raio (m)', '% perda', 'Máx F−T', 'OGMS−KLD', `Máx ${nomeAlin}`, 'Eventos'].map((t) => h('th', { text: t })))),
        h('tbody', null, linhas)))));
  }

  /* ---------------- Ranking de nivelamento ---------------- */

  function renderRanking() {
    if (!resultado) return ui.limpar(secoes.ranking);
    const disponiveis = B.NIVELAMENTO.filter((p) => arquivo.dados[p.id] && arquivo.dados[p.id].some((v) => !Number.isNaN(v)));
    if (!disponiveis.some((p) => p.id === rankingCampo) && disponiveis.length) rankingCampo = disponiveis[0].id;
    const lista = B.ranking(arquivo, resultado.elementos, rankingCampo, { limite: 10, separacao: 10 });
    const nome = (B.NIVELAMENTO.find((p) => p.id === rankingCampo) || {}).nome || rankingCampo;
    ui.trocar(secoes.ranking, h('section', { class: 'cartao' },
      h('h2', { text: 'Ranking de nivelamento' }),
      h('p', { class: 'sub', text: 'Os 10 maiores valores (em módulo) do teste. Picos a menos de 10 m entre si contam como um só ponto.' }),
      h('div', { style: { marginBottom: '10px' } },
        h('select', {
          class: 'select-auto',
          'aria-label': 'Parâmetro de nivelamento',
          value: rankingCampo,
          onchange: (e) => { rankingCampo = e.target.value; renderRanking(); }
        }, disponiveis.map((p) => h('option', { value: p.id, text: p.nome })))),
      lista.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
        h('thead', null, h('tr', null, ['#', 'km', nome, 'Elemento'].map((t) => h('th', { text: t })))),
        h('tbody', null, lista.map((x) => h('tr', { tabindex: '0', onclick: () => aproximar(x.pos - 50, x.pos + 50, 0) },
          h('td', { text: String(x.posicao) }),
          h('td', { text: x.km }),
          h('td', { class: 'num', text: fmt(x.valor, 2) }),
          h('td', { text: x.elemento })))))) : h('p', { class: 'vazio', text: 'Sem dados para este parâmetro.' })));
  }

  App.analise = { montar };
})(window.App);
