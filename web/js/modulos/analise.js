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
        h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-primario', onclick: abrirLaudo }, ui.icone('documento'), 'Gerar laudo (PDF)')),
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
      kpi('OGMS − KLD', `${fmt(r.geral.difKldMedia, 2)} mm`, 'diferença média entre os sensores (não entra na perda)')));
  }

  /* ---------------- Gráficos ---------------- */

  /** Definição dos gráficos (usada na tela e no laudo). Retorna [[título, opções], ...]. */
  function definirGraficos({ x0, x1, aoPassar }) {
    const { pos, dados, eventos } = arquivo;
    const r = resultado;
    const lim = opcoes.limitePerda;
    const faixas = r.elementos.map((e) => ({ ini: e.ini, fim: e.fim, classe: e.tipo === 'C' ? 'faixa-curva' : null, rotulo: e.sigla }));
    const nomeAlin = (B.ALINHAMENTO.find((a) => a.id === opcoes.alinhamento) || B.ALINHAMENTO[0]).nome;
    const alertas = Float64Array.from(r.difFT, (v) => (Math.abs(v) > lim ? v : NaN));
    const base = { pos, x0, x1, fmtX: B.fmtKm, aoPassar, faixas };
    const pctPorPonto = new Float64Array(pos.length).fill(NaN);
    r.elementos.forEach((e) => { for (let i = e.i0; i <= e.i1; i++) pctPorPonto[i] = e.pctPerda === null ? NaN : e.pctPerda; });
    return [
      ['Curvatura (10000/R) — tangentes e curvas', { ...base, series: [{ nome: '10000/R', valores: dados.curv, classe: 's1' }], referencias: [opcoes.limiarCurva, -opcoes.limiarCurva], eventos }],
      ['Bitola frontal e traseira (mm)', { ...base, series: [{ nome: 'Bitola F', valores: dados.bitF, classe: 's1' }, { nome: 'Bitola T', valores: dados.bitT, classe: 's2' }] }],
      [`Diferença Bitola F − Bitola T (mm) — perda acima de ±${fmt(lim, 0)} mm`, { ...base, series: [{ nome: 'F − T', valores: r.difFT, classe: 's1' }, { nome: 'Perda', valores: alertas, classe: 's-alerta', tipo: 'pontos' }], referencias: [lim, -lim], legenda: false }],
      ['Diferença OGMS − KLD (mm) — comparação entre sensores', { ...base, series: [{ nome: 'OGMS (F) − KLD', valores: r.difKld, classe: 's1' }] }],
      [`Alinhamento: ${nomeAlin}`, { ...base, series: [{ nome: nomeAlin, valores: dados[opcoes.alinhamento], classe: 's1' }] }],
      ['Perda de bitola por elemento (%)', { ...base, series: [{ nome: '% perda', valores: pctPorPonto, classe: 's1' }], yFaixa: [0, 100] }]
    ];
  }

  function renderGraficos() {
    graficos.forEach((g) => g.destruir());
    graficos = [];
    if (!resultado) return ui.limpar(secoes.graficos);
    const { pos, dados, eventos } = arquivo;
    const r = resultado;
    const x0 = zoom ? zoom.x0 : pos[0];
    const x1 = zoom ? zoom.x1 : pos[pos.length - 1];
    const info = h('div', { class: 'info-km', 'aria-live': 'polite' }, 'Passe o dedo ou o mouse sobre um gráfico para ver os valores.');

    const nomeAlin = (B.ALINHAMENTO.find((a) => a.id === opcoes.alinhamento) || B.ALINHAMENTO[0]).nome;

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

    const blocos = definirGraficos({ x0, x1, aoPassar });

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
      h('p', { class: 'sub', text: `Numerados na ordem da inspeção. Perda de bitola considera só a frontal e a traseira: % perda = pontos com |Bitola F − Bitola T| > ${fmt(opcoes.limitePerda, 0)} mm ÷ pontos medidos no elemento.` }),
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

  /* ---------------- Laudo em PDF ---------------- */

  const RESULTADOS = ['Aprovado', 'Aprovado com ressalvas', 'Reprovado'];

  async function abrirLaudo() {
    if (!resultado) return;
    const checklists = await App.dados.listar('checklists');
    const dataInspecao = arquivo.meta.data || '';
    const responsavel = h('input', { type: 'text', maxlength: 80, value: U.pref.get('ultimoResponsavel', '') });
    const res = h('select', null, RESULTADOS.map((r) => h('option', { value: r, text: r })));
    const parecer = h('textarea', { rows: 4, maxlength: 2000, placeholder: 'Parecer técnico, ressalvas e recomendações' });
    const doMesmoDia = checklists.find((c) => U.fmtData(c.data) === dataInspecao);
    const ck = h('select', null,
      h('option', { value: '', text: 'Não incluir' }),
      checklists.slice(0, 20).map((c) => h('option', { value: c.id, text: `${U.fmtData(c.data)} · Ciclo ${c.ciclo} · ${c.responsavel}` })));
    ck.value = doMesmoDia ? doMesmoDia.id : (checklists[0] ? checklists[0].id : '');

    ui.modal({
      titulo: 'Gerar laudo',
      conteudo: h('div', { class: 'pilha' },
        h('p', { class: 'sub', text: 'O laudo reúne a análise do arquivo, o checklist escolhido e o campo de aceite. Na janela de impressão, escolha "Salvar como PDF".' }),
        ui.campo('Responsável pela análise', responsavel),
        ui.campo('Resultado', res),
        ui.campo('Parecer', parecer),
        ui.campo('Checklist incluído', ck, { ajuda: checklists.length ? null : 'Nenhum checklist salvo ainda.' })),
      acoes: [
        { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Gerar PDF',
          classe: 'btn-primario',
          onClick: async (fechar) => {
            if (responsavel.value.trim()) U.pref.set('ultimoResponsavel', responsavel.value.trim());
            let checklist = checklists.find((c) => c.id === ck.value) || null;
            // Checklist feito em outro aparelho: busca as respostas na planilha.
            if (checklist && !(Array.isArray(checklist.respostas) && checklist.respostas.length)) {
              try {
                checklist = await App.api.chamar('getChecklist', { id: checklist.id });
              } catch (e) {
                ui.toast(`Não foi possível buscar as respostas do checklist na planilha (${e.message}). O laudo sai só com o cabeçalho do checklist.`, 'erro', 8000);
                checklist = { ...checklist, respostas: [], amostras: [] };
              }
            }
            fechar();
            imprimirLaudo({ responsavel: responsavel.value.trim(), resultado: res.value, parecer: parecer.value.trim(), checklist });
          }
        }
      ]
    });
  }

  function montarLaudo(info) {
    const r = resultado;
    const m = arquivo.meta;
    const pos = arquivo.pos;
    const agora = U.agora();
    const tabela = (cab, linhas, classe = '') => h('table', { class: `laudo-tabela ${classe}` },
      h('thead', null, h('tr', null, cab.map((t) => h('th', { text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', null, l.map((c) => (c instanceof Node ? h('td', null, c) : h('td', { text: c === null || c === undefined ? '' : String(c) })))))));
    const secao = (titulo, ...filhos) => h('section', { class: 'laudo-secao' }, h('h2', { text: titulo }), filhos);
    const foto = document.querySelector('.cab-foto');

    // Gráficos com largura fixa (o PDF reduz para caber na página).
    const graficosLaudo = definirGraficos({ x0: pos[0], x1: pos[pos.length - 1], aoPassar: null })
      .map(([titulo, op]) => ({ titulo, g: charts.graficoKm({ ...op, titulo, altura: 150 }) }));

    const nivel = B.NIVELAMENTO.filter((p) => arquivo.dados[p.id] && arquivo.dados[p.id].some((v) => !Number.isNaN(v)));
    const nomeAlin = (B.ALINHAMENTO.find((a) => a.id === opcoes.alinhamento) || B.ALINHAMENTO[0]).nome;

    const el = h('div', { id: 'laudo', class: 'laudo' },
      h('header', { class: 'laudo-cab' },
        foto ? h('img', { src: foto.src, alt: '', class: 'laudo-foto' }) : null,
        h('div', null,
          h('h1', { text: 'Laudo de Inspeção – Carro Controle EM80' }),
          h('p', { text: 'Centro de Monitoramento de Ativos' })),
        h('div', { class: 'laudo-emissao' }, h('span', { text: 'Emitido em' }), h('strong', { text: U.fmtDataHora(agora) }))),

      secao('Identificação', tabela(['Campo', 'Valor'], [
        ['Arquivo', nomeArquivo],
        ['Ramal / Linha', [m.ramal, m.linha && `Linha ${m.linha}`].filter(Boolean).join(' · ')],
        ['Data da inspeção', m.data],
        ['Inspetor', m.inspetor],
        ['Responsável pela análise', info.responsavel || '—'],
        ['Trecho', `${B.fmtKm(pos[0])} → ${B.fmtKm(pos[pos.length - 1])} (${fmt(r.geral.extensao / 1000, 2)} km · ${pos.length.toLocaleString('pt-BR')} pontos)`]
      ], 'laudo-id')),

      h('section', { class: `laudo-resultado laudo-res-${RESULTADOS.indexOf(info.resultado)}` },
        h('div', null, h('span', { text: 'Resultado' }), h('strong', { text: info.resultado })),
        info.parecer ? h('p', { text: info.parecer }) : null),

      secao('Indicadores',
        h('div', { class: 'laudo-kpis' },
          [['Perda de bitola', `${fmt(r.geral.pctPerda)}%`, `${r.geral.perdas.toLocaleString('pt-BR')} de ${r.geral.pontos.toLocaleString('pt-BR')} pontos`],
            ['Em tangentes', `${fmt(r.tangentes.pctPerda)}%`, `${r.tangentes.quantidade} tangente(s) · ${fmt(r.tangentes.extensao / 1000, 2)} km`],
            ['Em curvas', `${fmt(r.curvas.pctPerda)}%`, `${r.curvas.quantidade} curva(s) · ${fmt(r.curvas.extensao / 1000, 2)} km`],
            ['OGMS − KLD', `${fmt(r.geral.difKldMedia, 2)} mm`, 'diferença média entre sensores']
          ].map(([t, v, sub]) => h('div', { class: 'laudo-kpi' }, h('span', { text: t }), h('strong', { text: v }), h('small', { text: sub })))),
        h('p', { class: 'laudo-nota', text: `Critérios: perda de bitola quando |Bitola F − Bitola T| > ${fmt(opcoes.limitePerda, 0)} mm. Curva quando |10000/R| ≥ ${fmt(opcoes.limiarCurva, 1)} (média móvel de ${fmt(opcoes.suavizacao, 0)} m; elementos com menos de ${fmt(opcoes.comprimentoMin, 0)} m unidos ao vizinho).` })),

      secao('Gráficos ao longo do km', graficosLaudo.map(({ titulo, g }) => h('div', { class: 'laudo-grafico' }, h('h3', { text: titulo }), g.el))),

      secao('Elementos: tangentes e curvas', tabela(
        ['Elemento', 'Início', 'Fim', 'Ext. (m)', 'Raio (m)', '% perda', 'Máx F−T', 'OGMS−KLD', `Máx ${nomeAlin}`],
        r.elementos.map((e) => [e.nome, B.fmtKm(e.ini), B.fmtKm(e.fim), Math.round(e.extensao).toLocaleString('pt-BR'),
          e.tipo === 'C' && e.raioMedio ? Math.round(e.raioMedio).toLocaleString('pt-BR') : '—',
          `${fmt(e.pctPerda)}%`, fmt(e.maxDif, 2), fmt(e.difKldMedia, 2), fmt(e.alinhMax, 2)]))),

      secao('Ranking de nivelamento (5 maiores valores por parâmetro)',
        h('div', { class: 'laudo-ranking' }, nivel.map((p) => h('div', { class: 'laudo-rank' },
          h('h3', { text: p.nome }),
          tabela(['#', 'km', 'Valor', 'Elemento'], B.ranking(arquivo, r.elementos, p.id, { limite: 5, separacao: 10 })
            .map((x) => [x.posicao, x.km, fmt(x.valor, 2), x.elemento]), 'laudo-mini'))))),

      info.checklist ? secao(`Checklist de inspeção – ${U.fmtData(info.checklist.data)} · Ciclo ${info.checklist.ciclo} · ${info.checklist.responsavel}`,
        info.checklist.respostas.length ? null : h('p', { class: 'laudo-nota', text: `Respostas não disponíveis neste aparelho. Problemas registrados: ${info.checklist.qtdProblemas ?? '—'}.` }),
        tabela(['Sistema', 'Pergunta', 'Resposta', 'Descrição'], info.checklist.respostas.map((x) => [
          x.grupo, x.pergunta, h('span', { class: x.problema === 'Sim' ? 'laudo-problema' : '', text: x.resposta }), x.descricao || ''])),
        (info.checklist.amostras || []).length ? tabela(['Sistema', 'Medição', 'Amostra', 'Valor', 'Referência'], info.checklist.amostras.map((a) => [
          a.grupo, a.medicao, a.amostra, fmt(Number(a.valor), 2), a.rotulo2 ? `${a.rotulo2}: ${fmt(Number(a.valor2), 2)}` : ''])) : null) : null,

      h('section', { class: 'laudo-secao laudo-assinaturas' },
        h('h2', { text: 'Aceite' }),
        h('div', { class: 'laudo-ass' },
          h('div', null, h('div', { class: 'laudo-linha' }), h('strong', { text: info.responsavel || '\u00a0' }), h('span', { text: 'Responsável pela análise' })),
          h('div', null, h('div', { class: 'laudo-linha' }), h('strong', { text: '\u00a0' }), h('span', { text: 'Aceite (nome e assinatura)' })),
          h('div', null, h('div', { class: 'laudo-linha' }), h('strong', { text: '\u00a0' }), h('span', { text: 'Data' })))),

      h('footer', { class: 'laudo-rodape', text: `Gerado pelo App Carro Controle EM80 · ${App.config.build || App.config.versao} · ${U.fmtDataHora(agora)}` }));

    return { el, graficosLaudo };
  }

  function imprimirLaudo(info) {
    const anterior = document.getElementById('laudo');
    if (anterior) anterior.remove();
    const temaAnterior = document.documentElement.getAttribute('data-theme');
    const tituloAnterior = document.title;
    const { el, graficosLaudo } = montarLaudo(info);
    document.body.appendChild(el);
    document.documentElement.setAttribute('data-theme', 'light'); // laudo sempre em fundo branco
    const m = arquivo.meta;
    document.title = `Laudo EM80 ${m.ramal || ''} ${(m.data || '').replace(/\//g, '-')}`.trim();

    const restaurar = () => {
      graficosLaudo.forEach(({ g }) => g.destruir());
      el.remove();
      document.title = tituloAnterior;
      if (temaAnterior) document.documentElement.setAttribute('data-theme', temaAnterior);
      window.removeEventListener('afterprint', restaurar);
    };
    window.addEventListener('afterprint', restaurar);
    // Espera os gráficos serem desenhados antes de abrir a impressão.
    setTimeout(() => {
      graficosLaudo.forEach(({ g }) => g.destruir()); // congela o desenho (não redesenha durante a impressão)
      try {
        window.print();
      } catch (e) {
        restaurar();
        ui.toast(`Não foi possível abrir a impressão: ${e.message}`, 'erro', 6000);
      }
    }, 400);
  }

  App.analise = { montar };
})(window.App);
