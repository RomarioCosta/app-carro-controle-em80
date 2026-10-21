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
  const CHAVE_PLANTA = 'planta:base';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let raiz;
  let arquivo = null; // resultado de B.lerCSV
  let textoArquivo = '';
  let opcoesAnalise = null; // opções usadas na última análise (o laudo refaz a análise com o offset)
  let nomeArquivo = '';
  let resultado = null; // resultado de B.analisar
  const OPCOES_PADRAO = { ...B.PADRAO, alinhamento: 'alr10', modo: 'hibrido', ajusteKm: 'auto', offset: { bitola: 'bitT', valor: 0, aplicar: false }, bitolas: ['bitF', 'bitT'] };
  const opcoesSalvas = { ...(U.pref.get('bitola:opcoes', {}) || {}) };
  if ('limiarCurva' in opcoesSalvas) { // versão antiga (curvatura): passa a valer o padrão do método pelo raio
    delete opcoesSalvas.limiarCurva; delete opcoesSalvas.suavizacao;
  }
  let opcoes = { ...OPCOES_PADRAO, ...opcoesSalvas };
  let planta = null; // { nome, importadoEm, elementos, ramais }
  let infoPlanta = null; // { ramal, linha, ajuste, acerto, qtd, automatico }
  const cacheAjuste = new Map();
  let rankingCampo = 'nl20';
  let zoom = null; // { x0, x1 } ou null (trecho todo)
  let graficos = [];

  const secoes = {};

  function montar(el) {
    raiz = el;
    ['arquivo', 'planta', 'parametros', 'kpis', 'offset', 'graficos', 'elementos', 'ranking'].forEach((k) => { secoes[k] = h('div'); });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Análise do arquivo do carro controle' }),
        null),
      secoes.arquivo, secoes.planta, secoes.parametros, secoes.kpis, secoes.offset, secoes.graficos, secoes.elementos, secoes.ranking);
    renderArquivo();
    carregarPlanta().then(carregarUltimo);
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
    textoArquivo = texto; // texto original, usado na conferência independente
    // Parâmetro do gráfico que não existe neste formato de arquivo: usa o primeiro disponível.
    const temDados = (id) => arquivo.dados[id] && arquivo.dados[id].some((v) => !Number.isNaN(v));
    if (!temDados(opcoes.alinhamento)) {
      const alt = B.GRUPOS_GRAFICO.flatMap((g) => g.ids).find(temDados);
      if (alt) opcoes = { ...opcoes, alinhamento: alt };
    }
    zoom = null;
    recalcular();
    if (salvar) store.set(CHAVE, { nome: nomeArquivo, texto }).catch(() => {});
  }

  function salvarOpcoes() {
    U.pref.set('bitola:opcoes', opcoes);
  }

  /** Configuração da planta para o arquivo aberto (ramal, linha, elementos e ajuste de km). */
  let problemaPlanta = '';
  function configurarPlanta() {
    infoPlanta = null;
    problemaPlanta = '';
    if (!arquivo || !planta) return null; // com planta, todos os modos mostram EH/RH
    // O ramal vem do arquivo CSV. A localização (EH/RH e elemento) é feita pelo km; a coluna LINHA
    // só escolhe a linha da planta consultada primeiro e é mostrada como informação (pode ser 0, 1, 2, 3 ou um texto).
    const ramal = B.ramalDaPlanta(arquivo.meta.ramal, planta.ramais);
    if (!ramal) { problemaPlanta = `O ramal do arquivo (${arquivo.meta.ramal || '—'}) não existe na planta. Elementos identificados pelo raio.`; return null; }
    const linhasPlanta = (planta.ramais[ramal] || []).map(String);
    // Linha de referência: a linha válida mais frequente no arquivo; sem nenhuma válida, a L1 (ou a primeira do ramal).
    const contagem = new Map();
    const valores = arquivo.linhasValores || [String(arquivo.meta.linha || '')];
    (arquivo.linhaIdx || []).forEach((k) => contagem.set(k, (contagem.get(k) || 0) + 1));
    const resumoLinhas = [...contagem.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, q]) => ({ valor: valores[k] || '—', valida: B.linhaDaPlanta(valores[k], linhasPlanta), pct: (q / arquivo.pos.length) * 100 }));
    const valida = resumoLinhas.find((x) => x.valida);
    const linha = valida ? valida.valida : (linhasPlanta.includes('1') ? '1' : linhasPlanta[0]);
    const localizar = B.localizador(planta, ramal, arquivo, linha);
    const els = B.elementosDaPlanta(planta, ramal, linha);
    let ajuste = 0; let acerto = null; const automatico = opcoes.ajusteKm === 'auto';
    if (automatico) {
      const k = `${nomeArquivo}|${arquivo.pos.length}|${ramal}|${linha}|${opcoes.raioCurva}|${opcoes.suavizacao}`;
      if (!cacheAjuste.has(k)) cacheAjuste.set(k, B.ajusteAutomatico(arquivo.pos, arquivo.dados.curv, els, opcoes));
      ({ ajuste, acerto } = cacheAjuste.get(k));
    } else {
      ajuste = Number(opcoes.ajusteKm) || 0;
    }
    infoPlanta = { ramal, linha, ajuste, acerto, automatico, qtd: els.length, linhasArquivo: resumoLinhas, conferencia: conferirRamal(ramal, linha, els) };
    return { els, ajuste, localizar };
  }

  /**
   * Confere se as curvas do arquivo combinam com o ramal/linha do CSV. TU e LT (e outros ramais) têm os mesmos km:
   * se as curvas combinarem bem melhor com outro ramal, avisa (o ramal do arquivo continua valendo).
   */
  const cacheConferencia = new Map();
  function conferirRamal(ramal, linha, els) {
    const k = `${nomeArquivo}|${arquivo.pos.length}|${ramal}|${linha}`;
    if (cacheConferencia.has(k)) return cacheConferencia.get(k);
    const { pos } = arquivo; const curv = arquivo.dados.curv;
    const propria = B.compatibilidade(pos, curv, els, opcoes);
    let melhorOutro = null;
    Object.entries(planta.ramais).forEach(([r, linhas]) => linhas.forEach((l) => {
      if (r === ramal && String(l) === linha) return;
      const c = B.compatibilidade(pos, curv, B.elementosDaPlanta(planta, r, l), opcoes);
      if (!melhorOutro || c.nota > melhorOutro.nota) melhorOutro = { ...c, ramal: r, linha: String(l) };
    }));
    const suspeito = !!(melhorOutro && melhorOutro.nota >= 60 && melhorOutro.nota >= propria.nota + 20 && melhorOutro.ramal !== ramal);
    const res = { nota: propria.nota, outro: melhorOutro, suspeito };
    cacheConferencia.set(k, res);
    return res;
  }

  function recalcular() {
    if (!arquivo) {
      resultado = null;
    } else {
      const cfg = configurarPlanta();
      opcoesAnalise = { ...opcoes, modo: cfg ? opcoes.modo : 'curvatura', elementosPlanta: cfg ? cfg.els : null, localizar: cfg ? cfg.localizar : null, ajusteKm: cfg ? cfg.ajuste : 0 };
      resultado = B.analisar(arquivo, opcoesAnalise);
    }
    renderTudo();
  }

  /* ---------------- Planta da linha ---------------- */

  async function carregarPlanta() {
    try {
      planta = await store.get(CHAVE_PLANTA);
    } catch (e) { planta = null; }
    renderPlanta();
  }

  function carregarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = XLSX_URL;
      sc.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Leitor de planilhas indisponível.')));
      sc.onerror = () => reject(new Error('Sem internet para carregar o leitor de planilhas.'));
      document.head.appendChild(sc);
    });
  }

  async function importarPlanta(f) {
    ui.toast('Lendo a planta…', 'info', 2000);
    try {
      const XLSX = await carregarXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
      let lida = null; let ultimoErro = null;
      for (const nome of wb.SheetNames) {
        try {
          lida = B.lerPlanta(XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' }));
          break;
        } catch (e) { ultimoErro = e; }
      }
      if (!lida) throw ultimoErro || new Error('Planta não encontrada no arquivo.');
      planta = { nome: f.name, importadoEm: U.agora(), elementos: lida.elementos, ramais: lida.ramais };
      await store.set(CHAVE_PLANTA, planta);
      cacheAjuste.clear();
      opcoes = { ...opcoes, ajusteKm: 'auto' };
      salvarOpcoes();
      ui.toast(`Planta importada: ${lida.elementos.length.toLocaleString('pt-BR')} elementos.`, 'ok', 5000);
      if (arquivo) recalcular(); else renderPlanta();
    } catch (e) {
      ui.toast(`Não foi possível ler a planta: ${e.message}`, 'erro', 8000);
    }
  }

  function renderPlanta() {
    const input = h('input', { type: 'file', accept: '.xls,.xlsx', onchange: (e) => { const f = e.target.files[0]; if (f) importarPlanta(f); } });
    const resumo = planta
      ? `${planta.nome} · ${planta.elementos.length.toLocaleString('pt-BR')} elementos · ramais ${Object.keys(planta.ramais).join(', ')} · importada em ${U.fmtData(planta.importadoEm)}`
      : 'Importe a planilha "Planta da linha" para separar os elementos por EH e linha. Sem ela, os elementos são identificados pelo raio.';
    ui.trocar(secoes.planta, h('details', { class: 'cartao detalhes', open: !planta || null },
      h('summary', null, h('strong', { text: 'Planta da linha' }), h('span', { class: 'sub', text: planta ? ` · ${planta.elementos.length.toLocaleString('pt-BR')} elementos` : ' · não importada' })),
      h('div', { class: 'pilha', style: { marginTop: '10px' } },
        h('p', { class: 'sub', text: resumo }),
        ui.campo(planta ? 'Substituir planta (.xls ou .xlsx)' : 'Planta da linha (.xls ou .xlsx)', input),
        planta ? h('button', {
          class: 'btn btn-fantasma',
          onclick: async () => {
            planta = null;
            await store.del(CHAVE_PLANTA).catch(() => {});
            if (arquivo) recalcular(); else renderPlanta();
          }
        }, ui.icone('lixo'), 'Remover planta') : null)));
  }

  function renderTudo() {
    renderArquivo();
    renderPlanta();
    renderParametros();
    renderOffset();
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
        }, ui.icone('lixo'), 'Remover arquivo')) : null));
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
        salvarOpcoes();
        recalcular();
      }
    }));

    const mudar = (campo, valor) => { opcoes = { ...opcoes, [campo]: valor }; salvarOpcoes(); recalcular(); };
    const usandoPlanta = resultado && resultado.comLocais;
    const conf = infoPlanta && infoPlanta.conferencia;
    const blocoPlanta = planta ? h('div', { class: 'pilha' },
      ui.campo('Elementos', h('div', { class: 'seg seg-modos-analise', role: 'group' },
        [['hibrido', 'Raio + planta'], ['planta', 'Pelo km da planta'], ['curvatura', 'Só raio']].map(([v, r]) => h('button', {
          type: 'button',
          class: `seg-opcao${opcoes.modo === v ? ' ativo' : ''}`,
          'aria-pressed': opcoes.modo === v ? 'true' : 'false',
          onclick: () => mudar('modo', v)
        }, r)))),
      usandoPlanta && conf && conf.suspeito ? h('p', { class: 'aviso aviso-erro', text: `Atenção: as curvas deste arquivo combinam muito mais com o ramal ${conf.outro.ramal}, linha ${conf.outro.linha} (${conf.outro.nota}%) do que com o ramal do arquivo, ${infoPlanta.ramal} (${conf.nota}%). Vários ramais têm os mesmos km: confira a coluna RAMAL do arquivo.` }) : null,
      usandoPlanta && infoPlanta ? h('div', { class: 'grade-3' },
        ui.campo('Correção do km do carro (m)', h('input', {
          type: 'text',
          inputmode: 'tel',
          value: opcoes.ajusteKm === 'auto' ? '' : String(opcoes.ajusteKm).replace('.', ','),
          placeholder: infoPlanta ? `auto: ${fmt(infoPlanta.ajuste, 1)}` : 'auto',
          onchange: (e) => {
            const v = U.numero(e.target.value);
            mudar('ajusteKm', e.target.value.trim() === '' || v === null ? 'auto' : v);
          }
        }))) : null,
      !infoPlanta && problemaPlanta ? h('p', { class: 'aviso', text: problemaPlanta }) : null) : null;

    ui.trocar(secoes.parametros, h('details', { class: 'cartao detalhes' },
      h('summary', null, h('strong', { text: 'Critérios da análise' }),
        h('span', { class: 'sub', text: ` · ${usandoPlanta ? `elementos da planta (${infoPlanta.ramal}, pelo km, correção ${fmt(infoPlanta.ajuste, 0)} m)` : `curva com raio até ${int(opcoes.raioCurva)} m`} · perda acima de ${opcoes.limitePerda} mm` })),
      h('div', { class: 'pilha', style: { marginTop: '12px' } },
        blocoPlanta,
        h('div', { class: 'grade-2' },
          numero('limitePerda', 'Limite de perda de bitola (mm)', '|Bitola F − Bitola T| acima disso = perda.'),
          numero('limiteElemento', 'Elemento perdeu a bitola acima de (%)', 'Curva ou tangente com % de perda acima disso conta como elemento que perdeu a bitola.'),
          numero('limiteVariacao', 'Limite de variação rápida (mm)', 'Desvio padrão da bitola em 1 m acima disso = provável erro de leitura.'),
          numero('raioCurva', 'Raio máximo de curva (m)', 'Raio medido até este valor é curva; volta a tangente acima do dobro.'),
          numero('suavizacao', 'Suavização do raio (m)', 'Média móvel do 10000/R.'),
          numero('curvaMin', 'Curva mínima (m)', 'Curva mais curta vira tangente.'),
          numero('tangenteMin', 'Tangente mínima entre curvas (m)', 'Mais curta, entre duas curvas: une (mesmo lado) ou divide entre elas (curva reversa).'))),
      h('button', {
        class: 'btn btn-fantasma',
        onclick: () => {
          opcoes = { ...OPCOES_PADRAO, alinhamento: opcoes.alinhamento, offset: opcoes.offset };
          salvarOpcoes();
          recalcular();
        }
      }, 'Restaurar padrão')));
  }

  /* ---------------- Indicadores ---------------- */

  const NOMES_BITOLA = { bitF: 'Bitola F', bitT: 'Bitola T', kld: 'KLD' };
  const fmt = (v, casas = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(casas).replace('.', ','));

  const int = (v) => Math.round(v || 0).toLocaleString('pt-BR');
  /** Extensão (m) da área acima da regra: pontos acima × espaçamento entre pontos. */
  const extAcima = (perdas) => (perdas || 0) * ((resultado && resultado.esp) || 0.25);

  function renderKpis() {
    if (!resultado) return ui.limpar(secoes.kpis);
    const r = resultado;
    const kpi = (titulo, valor, sub) => h('div', { class: 'kpi' },
      h('div', { class: 'kpi-titulo', text: titulo }),
      h('div', { class: 'kpi-valor', text: valor }),
      h('div', { class: 'kpi-sub', text: sub }));
    ui.trocar(secoes.kpis, h('div', { class: 'kpis kpis-auto' },
      kpi('Perda de bitola', `${fmt(r.geral.pctPerda)}%`, `${int(r.geral.perdas)} de ${int(r.geral.pontos)} pontos`),
      kpi('Elementos com perda', `${r.tangentes.comPerda + r.curvas.comPerda} de ${r.tangentes.quantidade + r.curvas.quantidade}`, `acima de ${fmt(opcoes.limiteElemento ?? 10, 0)}%`),
      kpi('Em tangentes', `${fmt(r.tangentes.pctPerda)}%`, `${int(r.tangentes.perdas)} de ${int(r.tangentes.pontos)} pontos`),
      kpi('Em curvas', `${fmt(r.curvas.pctPerda)}%`, `${int(r.curvas.perdas)} de ${int(r.curvas.pontos)} pontos`),
      kpi('OGMS − KLD', `${fmt(r.geral.difKldMedia, 2)} mm`, 'diferença média')));
  }

  /* ---------------- Gráficos ---------------- */

  const mais1000 = (arr) => Float64Array.from(arr, (v) => v + B.NOMINAL);
  const nomeAlinhamento = () => B.parametroGrafico(opcoes.alinhamento).nome;

  /** Definição dos gráficos (usada na tela e no laudo). Retorna [{ titulo, op, seletor }]. */
  function definirGraficos({ x0, x1, aoPassar }) {
    const { pos, eventos } = arquivo;
    const r = resultado;
    const d = r.dados; // já com o offset, se aplicado
    const lim = opcoes.limitePerda;
    const faixas = r.elementos.map((e) => ({ ini: e.ini, fim: e.fim, classe: e.tipo === 'C' ? 'faixa-curva' : (e.tipo === 'X' ? 'faixa-fora' : null), rotulo: e.tipo === 'X' ? e.trecho || '' : e.sigla }));
    const nomeAlin = nomeAlinhamento();
    const alertas = Float64Array.from(r.difFT, (v) => (Math.abs(v) > lim ? v : NaN));
    const base = { pos, x0, x1, fmtX: B.fmtKm, aoPassar, faixas };
    const pctPorPonto = new Float64Array(pos.length).fill(NaN);
    r.elementos.forEach((e) => { for (let i = e.i0; i <= e.i1; i++) pctPorPonto[i] = e.pctPerda === null ? NaN : e.pctPerda; });
    const serieBitola = {
      bitF: { nome: 'Bitola F', valores: mais1000(d.bitF), classe: 's1' },
      bitT: { nome: 'Bitola T', valores: mais1000(d.bitT), classe: 's2' },
      kld: { nome: 'KLD', valores: mais1000(r.kldValido), classe: 's3' }
    };
    const escolhidas = (opcoes.bitolas && opcoes.bitolas.length ? opcoes.bitolas : ['bitF', 'bitT']).filter((k) => serieBitola[k]);
    const nomesEscolhidas = escolhidas.map((k) => NOMES_BITOLA[k]).join(', ').replace(/, ([^,]*)$/, ' e $1');
    // Bitolas: linhas finas; em trechos longos, faixa mín–máx + média (sem borrão).
    const fino = { classe: 'graf-fino' };
    const offsetTxt = opcoes.offset.aplicar && opcoes.offset.valor ? ` · offset ${fmt(opcoes.offset.valor, 1)} mm em ${NOMES_BITOLA[opcoes.offset.bitola]}` : '';
    return [
      { titulo: 'Raio (10000/R) — tangentes e curvas', op: { ...base, series: [{ nome: '10000/R', valores: d.curv, classe: 's1' }], referencias: [10000 / opcoes.raioCurva, -10000 / opcoes.raioCurva], eventos } },
      { titulo: `Bitolas (mm): ${nomesEscolhidas}${offsetTxt}`, seletor: 'bitolas', op: { ...base, ...fino, altura: 230, estilo: 'faixa', corteY: 0.01, series: escolhidas.map((k) => serieBitola[k]) } },
      { titulo: `${B.parametroGrafico(opcoes.alinhamento).grupo}: ${nomeAlin}`, seletor: 'alinhamento', op: { ...base, ...fino, series: [{ nome: nomeAlin, valores: d[opcoes.alinhamento], classe: 's1' }] } },
      { titulo: `Diferença Bitola F − Bitola T (mm) — perda acima de ±${fmt(lim, 0)} mm`, op: { ...base, ...fino, series: [{ nome: 'F − T', valores: r.difFT, classe: 's1' }, { nome: 'Perda', valores: alertas, classe: 's-alerta', tipo: 'pontos' }], referencias: [lim, -lim], legenda: false } },
      { titulo: `Variação rápida da bitola: desvio padrão em 1 m (mm) — limite ${fmt(opcoes.limiteVariacao, 1)} mm`, op: { ...base, ...fino, series: [{ nome: 'σ Bitola F', valores: r.varF, classe: 's1' }, { nome: 'σ Bitola T', valores: r.varT, classe: 's2' }], referencias: [opcoes.limiteVariacao] } },
      { titulo: 'Perda de bitola por elemento (%)', op: { ...base, series: [{ nome: '% perda', valores: pctPorPonto, classe: 's1' }], yFaixa: [0, 100] } }
    ];
  }

  function renderGraficos() {
    graficos.forEach((g) => g.destruir());
    graficos = [];
    if (!resultado) return ui.limpar(secoes.graficos);
    const { pos, dados: brutos } = arquivo;
    const r = resultado;
    const d = r.dados;
    const x0 = zoom ? zoom.x0 : pos[0];
    const x1 = zoom ? zoom.x1 : pos[pos.length - 1];
    const info = h('div', { class: 'info-km', 'aria-live': 'polite' }, 'Passe o dedo ou o mouse sobre um gráfico para ver os valores.');
    const nomeAlin = nomeAlinhamento();

    const aoPassar = (p) => {
      graficos.forEach((g) => g.guia(p));
      if (p === null) return;
      const i = B.indicePerto(pos, p);
      const el = B.elementoDo(r.elementos, i);
      const v = (a) => fmt(a[i], 2);
      const b = (a) => (Number.isNaN(a[i]) ? '—' : fmt(a[i] + B.NOMINAL, 2));
      ui.trocar(info,
        h('strong', { text: `${B.fmtKm(pos[i])}` }), el ? ` · ${el.nome}` : '',
        h('span', { text: ` · F ${b(d.bitF)} · T ${b(d.bitT)} · F−T ${v(r.difFT)}` }),
        h('span', { text: ` · KLD ${b(r.kldValido)} · OGMS−KLD ${v(r.difKld)}` }),
        h('span', { text: ` · σ1m ${v(r.variacao)}` }),
        h('span', { text: ` · 10000/R ${v(brutos.curv)} · ${nomeAlin} ${v(d[opcoes.alinhamento])}` }));
    };

    const seletorAlin = h('select', {
      'aria-label': 'Parâmetro do gráfico (alinhamento, nivelamento, empeno, superelevação)',
      value: opcoes.alinhamento,
      onchange: (e) => { opcoes = { ...opcoes, alinhamento: e.target.value }; salvarOpcoes(); recalcular(); }
    }, B.GRUPOS_GRAFICO.map((g) => {
      const itens = g.ids.filter((id) => arquivo.dados[id] && arquivo.dados[id].some((v) => !Number.isNaN(v)));
      return itens.length ? h('optgroup', { label: g.grupo }, itens.map((id) => h('option', { value: id, text: B.parametroGrafico(id).nome }))) : null;
    }));

    const atuais = opcoes.bitolas && opcoes.bitolas.length ? opcoes.bitolas : ['bitF', 'bitT'];
    const seletorBitolas = h('div', { class: 'bitolas-sel', role: 'group', 'aria-label': 'Bitolas no gráfico' },
      Object.entries(NOMES_BITOLA).map(([k, nome]) => h('label', { class: 'chip-sel' },
        h('input', {
          type: 'checkbox',
          checked: atuais.includes(k),
          onchange: (e) => {
            const nova = Object.keys(NOMES_BITOLA).filter((x) => (x === k ? e.target.checked : atuais.includes(x)));
            if (!nova.length) { e.target.checked = true; return; } // pelo menos uma
            opcoes = { ...opcoes, bitolas: nova }; salvarOpcoes(); renderGraficos();
          }
        }), nome)));
    const seletores = { alinhamento: seletorAlin, bitolas: seletorBitolas };

    const conteudo = definirGraficos({ x0, x1, aoPassar }).map(({ titulo, op, seletor }) => {
      const g = charts.graficoKm({ ...op, titulo });
      graficos.push(g);
      return h('div', { class: 'graf-km-item' },
        h('div', { class: 'graf-km-cab' }, h('h3', { text: titulo }), seletor ? seletores[seletor] : null),
        g.el);
    });

    ui.trocar(secoes.graficos, h('section', { class: 'cartao' },
      h('div', { class: 'graf-km-topo' },
        h('h2', { text: 'Gráficos ao longo do km' }),
        h('div', { class: 'linha-campo' },
          h('span', { class: 'sub', text: zoom ? `Trecho: ${B.fmtKm(x0)} → ${B.fmtKm(x1)}` : 'Trecho completo' }),
          zoom ? h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => { zoom = null; renderGraficos(); } }, 'Ver tudo') : null)),
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

  const barraPct = (pct) => h('div', { class: 'barra-pct' },
    h('span', { class: 'barra-pct-fundo' }, h('span', { style: { width: `${Math.min(pct || 0, 100)}%` } })),
    h('span', { text: `${fmt(pct)}%` }));

  /** Colunas da tabela de elementos (usadas na tela e no laudo). */
  function colunasElementos(paraLaudo) {
    const planta = resultado.comLocais;
    const evs = arquivo.eventos;
    const eventosDo = (e) => {
      const lo = Math.min(e.ini, e.fim); const hi = Math.max(e.ini, e.fim);
      // todos os eventos registrados na faixa de km do elemento, com o km de cada um
      return evs.filter((v) => v.pos >= lo && v.pos <= hi).map((v) => `${v.texto} (${B.fmtKm(v.pos)})`).join(', ');
    };
    const pct = (v) => (paraLaudo ? `${fmt(v)}%` : barraPct(v));
    const cols = [];
    // Sempre: trecho (EH/RH) primeiro, depois a linha.
    if (planta) cols.push({ t: 'EH / RH', v: (e) => e.trecho || '—' });
    cols.push({ t: 'Linha', v: (e) => e.linha || linhaAtual() });
    cols.push({ t: 'Elemento', v: (e) => (paraLaudo ? (e.tipo === 'X' ? 'Circuito' : `${e.tipo === 'C' ? 'Curva' : 'Tangente'} ${e.sigla.slice(1)}`) : h('span', { class: `el-tag ${e.tipo === 'C' ? 'el-curva' : e.tipo === 'X' ? 'el-fora' : 'el-tangente'}`, text: e.sigla, title: e.nome })) });
    if (planta) cols.push({ t: 'Lado', v: (e) => (e.tipo === 'C' ? (e.lado === 'D' ? 'Dir.' : e.lado === 'E' ? 'Esq.' : '—') : '') });
    // Só raio: elemento(s) da planta a que o km do elemento pertence (o de mais pontos primeiro).
    cols.push(
      { t: 'Início', v: (e) => B.fmtKm(e.ini) },
      { t: 'Fim', v: (e) => B.fmtKm(e.fim) },
      { t: 'Ext. (m)', n: true, v: (e) => Math.round(e.extensao).toLocaleString('pt-BR') },
      { t: 'Pontos', n: true, v: (e) => int(e.pontos) },
      { t: 'Pontos acima', n: true, v: (e) => int(e.perdas) },
      { t: 'Ext. acima (m)', n: true, v: (e) => fmt(extAcima(e.perdas), 1) },
      { t: '% perda', n: true, v: (e) => {
        // pouca leitura de F e T no elemento: resultado pouco confiável
        const baixa = e.cobertura !== null && e.cobertura !== undefined && e.cobertura < 0.9;
        if (paraLaudo) return `${fmt(e.pctPerda)}%${baixa ? ' *' : ''}`;
        const v = pct(e.pctPerda);
        return baixa ? h('span', { class: 'baixa-cobertura', title: `Só ${fmt(e.cobertura * 100, 0)}% dos pontos do elemento com Bitola F e T lidas` }, v, ' ⚠') : v;
      } },
      { t: `Máx ${nomeAlinhamento()}`, n: true, v: (e) => fmt(e.alinhMax, 2) });
    cols.push({ t: 'Eventos', ev: true, v: eventosDo });
    return cols;
  }

  /** Linha da inspeção: sempre a do arquivo CSV. */
  function linhaAtual() {
    return String((arquivo && arquivo.meta.linha) || '—'); // a linha é sempre a do arquivo CSV
  }

  /** Do local com maior perda para o com menor (sem medição por último). */
  function porPerda(itens) {
    return itens.map((x, k) => [x, k]).sort((a, b) => {
      const ra = a[0].tipo === 'X' || a[0].rh ? 1 : 0; const rb = b[0].tipo === 'X' || b[0].rh ? 1 : 0; // pátios (RH) por último
      const pa = a[0].pctPerda ?? -1; const pb = b[0].pctPerda ?? -1;
      return ra - rb || pb - pa || a[1] - b[1];
    }).map(([x]) => x);
  }

  /** Resumo por trecho: EH/RH, linha e o elemento com a maior perda de bitola. */
  function colunasEh(paraLaudo) {
    const nomeEl = (p) => {
      if (!p) return '—';
      if (p.tipo === 'X') return 'Circuito';
      const texto = `${p.tipo === 'C' ? 'Curva' : 'Tangente'} ${p.sigla.slice(1)}`;
      return paraLaudo ? texto : h('span', { class: `el-tag ${p.tipo === 'C' ? 'el-curva' : 'el-tangente'}`, text: p.sigla, title: texto });
    };
    return [
      { t: 'EH / RH', v: (g) => g.eh },
      { t: 'Linha', v: (g) => g.linha || linhaAtual() },
      { t: 'Início', v: (g) => B.fmtKm(g.ini) },
      { t: 'Fim', v: (g) => B.fmtKm(g.fim) },
      { t: 'Ext. (m)', n: true, v: (g) => Math.round(g.extensao).toLocaleString('pt-BR') },
      { t: 'Pontos', n: true, v: (g) => int(g.pontos) },
      { t: 'Pontos acima', n: true, v: (g) => int(g.perdas) },
      { t: 'Ext. acima (m)', n: true, v: (g) => fmt(extAcima(g.perdas), 1) },
      { t: '% perda', n: true, v: (g) => `${fmt(g.pctPerda)}%` },
      { t: `Perderam (>${fmt(opcoes.limiteElemento ?? 10, 0)}%)`, n: true, v: (g) => (g.rh ? '—' : `${g.comPerda || 0} de ${(g.tangentes || 0) + (g.curvas || 0)}`) },
      { t: 'Maior perda', v: (g) => nomeEl(g.pior) },
      { t: '% do elemento', n: true, v: (g) => (g.pior ? `${fmt(g.pior.pctPerda)}%` : '—') }
    ];
  }

  /** Linha de total das tabelas: os mesmos pontos do cartão "Perda de bitola" (circuitos não entram). */
  function valoresTotal(cols) {
    const g = resultado.geral;
    const temRh = resultado.elementos.some((e) => e.tipo === 'X' || e.rh);
    return cols.map((c, k) => {
      if (k === 0) return temRh ? 'Total (sem circuitos)' : 'Total';
      if (c.t === 'Pontos') return int(g.pontos);
      if (c.t === 'Pontos acima') return int(g.perdas);
      if (c.t === 'Ext. acima (m)') return fmt(extAcima(g.perdas), 1);
      if (c.t === '% perda') return `${fmt(g.pctPerda)}%`;
      return '';
    });
  }

  function tabelaTela(cols, itens, aoClicar) {
    return h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro' },
      h('thead', null, h('tr', null, cols.map((c) => h('th', { text: c.t })))),
      h('tbody', null, itens.map((x) => h('tr', {
        tabindex: '0',
        onclick: () => aoClicar(x),
        onkeydown: (ev) => { if (ev.key === 'Enter') aoClicar(x); }
      }, cols.map((c) => {
        const v = c.v(x);
        return v instanceof Node ? h('td', { class: c.n ? 'num' : '' }, v) : h('td', { class: c.ev ? 'ev' : (c.n ? 'num' : ''), text: v });
      })))),
      h('tfoot', null, h('tr', { class: 'linha-total' }, valoresTotal(cols).map((v, k) => h('td', { class: k ? 'num' : '', text: v }))))));
  }

  function renderElementos() {
    if (!resultado) return ui.limpar(secoes.elementos);
    const r = resultado;
    const planta = r.comLocais;
    ui.trocar(secoes.elementos,
      planta && r.porEh.length ? h('section', { class: 'cartao' },
        h('h2', { text: 'Resumo por trecho (EH e RH)' }),
        tabelaTela(colunasEh(false), porPerda(r.porEh), (g) => (g.pior ? aproximar(g.pior.ini, g.pior.fim) : aproximar(g.ini, g.fim)))) : null,
      h('section', { class: 'cartao' },
        h('div', { class: 'cartao-cab' },
          h('h2', { text: r.modo === 'curvatura' ? 'Elementos: tangentes e curvas' : 'Elementos da planta: tangentes e curvas' }),
          cartaoConferencia()),
        tabelaTela(colunasElementos(false), porPerda(r.elementos), (e) => aproximar(e.ini, e.fim))));
  }

  /* ---------------- Dupla checagem ---------------- */

  /** Selo da conferência independente (relê o CSV original e recalcula) e botão da planilha de conferência. */
  function cartaoConferencia() {
    const c = textoArquivo ? B.conferir(textoArquivo, resultado, opcoes.limitePerda) : null;
    const selo = !c ? null : c.ok
      ? h('span', { class: 'conf-ok', title: `Recontagem independente a partir do CSV original: ${c.linhas.toLocaleString('pt-BR')} linhas de medição; pontos e pontos acima de cada elemento iguais aos da análise.${c.voltas.length ? ` O km volta ${c.voltas.length} vez(es) no arquivo.` : ''}` }, ui.icone('check'), 'Conferido')
      : h('button', { class: 'conf-erro', onclick: () => mostrarDivergencias(c) }, `⚠ ${c.divergencias.length} divergência(s)`);
    return h('div', { class: 'linha-acoes' }, selo,
      h('button', { class: 'btn btn-secundario btn-pequeno', onclick: baixarConferencia, title: 'Planilha com cada ponto: km, Bitola F, Bitola T, F − T e se está acima da regra' }, ui.icone('documento'), 'Planilha de conferência'));
  }

  function mostrarDivergencias(c) {
    ui.modal({
      titulo: 'Divergências na conferência',
      conteudo: h('div', { class: 'pilha' },
        c.linhasApp !== null && c.linhasApp !== c.linhas ? h('p', { class: 'aviso aviso-erro', text: `Linhas de medição: ${c.linhas.toLocaleString('pt-BR')} no CSV × ${c.linhasApp.toLocaleString('pt-BR')} na análise.` }) : null,
        c.voltas.length ? h('p', { class: 'sub', text: `O km volta ${c.voltas.length} vez(es) no arquivo: ${c.voltas.slice(0, 5).map((v) => `${B.fmtKm(v.de)} → ${B.fmtKm(v.para)}`).join(', ')}${c.voltas.length > 5 ? '…' : ''}` }) : null,
        h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro' },
        h('thead', null, h('tr', null, ['Elemento', 'Início', 'Fim', 'Pontos (app)', 'Pontos (conferência)', 'Acima (app)', 'Acima (conferência)'].map((t) => h('th', { text: t })))),
        h('tbody', null, c.divergencias.map((d) => h('tr', null,
          [d.sigla, B.fmtKm(d.ini), B.fmtKm(d.fim), d.app.pontos, d.conferido.pontos, d.app.perdas, d.conferido.perdas].map((v) => h('td', { text: String(v) })))))))),
      acoes: [{ texto: 'Fechar', classe: 'btn-secundario', onClick: (f) => f() }]
    });
  }

  /** Planilha (CSV para o Excel) com todos os pontos e o cálculo de cada um, para conferir na mão. */
  function baixarConferencia() {
    const r = resultado;
    const { pos, dados } = arquivo;
    const lim = opcoes.limitePerda;
    const doPonto = new Array(pos.length);
    r.elementos.forEach((e) => { for (let i = e.i0; i <= e.i1; i++) doPonto[i] = e; });
    const num = (v, casas = 2) => (Number.isNaN(v) ? '' : v.toFixed(casas).replace('.', ','));
    const linhas = ['KM;LOCALIZACAO;Linha;Bitola F;Bitola T;F - T;|F - T| (módulo);Acima do limite (1 = sim);Elemento;Tipo;EH / RH;Na estatística (1 = sim)'];
    for (let i = 0; i < pos.length; i++) {
      const e = doPonto[i] || {};
      const dif = B.difBitola(dados.bitF[i], dados.bitT[i]);
      const km = Math.floor(pos[i] / 1000);
      linhas.push([
        km, num(pos[i] - km * 1000), arquivo.linhasValores ? arquivo.linhasValores[arquivo.linhaIdx[i]] : '',
        num(dados.bitF[i]), num(dados.bitT[i]), num(dif), num(Math.abs(dif)),
        Number.isNaN(dif) ? '' : (B.ehPerda(dif, lim) ? 1 : 0),
        e.sigla || '', !e.tipo ? '' : (e.tipo === 'X' || e.rh ? 'Circuito' : (e.tipo === 'C' ? 'Curva' : 'Tangente')),
        e.trecho || e.eh || '', (r.mascara && !r.mascara[i]) || Number.isNaN(dif) ? 0 : 1
      ].join(';'));
    }
    const blob = new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `conferencia-${nomeArquivo.replace(/\.[^.]+$/, '')}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- Simulação de offset ---------------- */

  let offsetAberto = false; // mantém o cartão aberto ao trocar a bitola
  function renderOffset() {
    if (!resultado) return ui.limpar(secoes.offset);
    const off = opcoes.offset;
    const original = arquivo.dados;
    const lim = opcoes.limitePerda;
    const simulado = B.dadosComOffset(original, { ...off, valor: off.valor || 0 });
    const mascara = resultado.mascara; // pátios (RH) fora da estatística
    const antes = B.avaliarPerda(original, lim, 0, original.bitF.length - 1, mascara);
    const depois = B.avaliarPerda(simulado, lim, 0, simulado.bitF.length - 1, mascara);
    const porTipo = (dados, tipo) => {
      let pontos = 0; let perdas = 0;
      resultado.elementos.filter((e) => e.tipo === tipo && !e.rh).forEach((e) => {
        const x = B.avaliarPerda(dados, lim, e.i0, e.i1, mascara);
        pontos += x.pontos; perdas += x.perdas;
      });
      return pontos ? (perdas / pontos) * 100 : null;
    };
    const mediaKld = (dados) => {
      let n = 0; let soma = 0;
      for (let i = 0; i < dados.bitF.length; i++) {
        const f = dados.bitF[i]; const k = dados.kld[i];
        if (!Number.isNaN(f) && !Number.isNaN(k) && Math.abs(k) < 60) { n++; soma += f - k; }
      }
      return n ? soma / n : null;
    };
    const mudar = (campos) => { offsetAberto = true; opcoes = { ...opcoes, offset: { ...opcoes.offset, ...campos } }; salvarOpcoes(); recalcular(); };

    const valor = h('input', {
      type: 'text', inputmode: 'tel', value: off.valor ? String(off.valor).replace('.', ',') : '', placeholder: '0,0',
      onchange: (e) => { const v = U.numero(e.target.value); mudar({ valor: v === null ? 0 : v }); }
    });
    // porModulo: melhora = mais perto de zero (ex.: OGMS − KLD pode ser negativo).
    const linha = (rotulo, a, b, casas = 1, suf = '%', porModulo = false) => {
      const ok = a !== null && b !== null;
      const va = ok && porModulo ? Math.abs(a) : a; const vb = ok && porModulo ? Math.abs(b) : b;
      const classe = !ok || Math.abs(vb - va) < 1e-9 ? '' : (vb < va ? 'melhor' : 'pior');
      return h('tr', null,
        h('td', { text: rotulo }),
        h('td', { class: 'num', text: `${fmt(a, casas)}${suf}` }),
        h('td', { class: 'num', text: `${fmt(b, casas)}${suf}` }),
        h('td', { class: `num ${classe}`, text: ok ? `${b - a > 0 ? '+' : ''}${fmt(b - a, casas)}` : '—' }));
    };

    const sugestao = off.bitola !== 'kld' ? B.melhorOffset(original, off.bitola, lim, mascara) : null;
    ui.trocar(secoes.offset, h('details', { class: 'cartao detalhes', open: off.valor || offsetAberto ? true : null, ontoggle: (e) => { offsetAberto = e.target.open; } },
      h('summary', null, h('strong', { text: 'Simulação de offset' }),
        h('span', { class: 'sub', text: off.valor ? ` · ${fmt(off.valor, 1)} mm em ${NOMES_BITOLA[off.bitola]}${off.aplicar ? ' (aplicado)' : ''} · perda ${fmt(antes.pct)}% → ${fmt(depois.pct)}%` : ' · escolha uma bitola e um valor' })),
      h('div', { class: 'pilha', style: { marginTop: '12px' } },
        h('div', { class: 'grade-3' },
          ui.campo('Bitola', h('select', { value: off.bitola, onchange: (e) => mudar({ bitola: e.target.value }) },
            Object.entries(NOMES_BITOLA).map(([k, n]) => h('option', { value: k, text: n })))),
          ui.campo('Offset (mm)', valor),
          ui.campo('Aplicar', h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: off.aplicar, onchange: (e) => mudar({ aplicar: e.target.checked }) }),
            ' Usar nos gráficos, tabelas e laudo'))),
        sugestao ? h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => mudar({ valor: sugestao.valor }) }, ui.icone('sync'), `Usar melhor offset: ${fmt(sugestao.valor, 1)} mm`),
          h('span', { class: 'sub', text: `perda mínima possível com offset em ${NOMES_BITOLA[off.bitola]}: ${fmt(sugestao.pct)}%` })) : null,
        h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-offset tabela-centro' },
          h('thead', null, h('tr', null, ['', 'Sem offset', 'Com offset', 'Diferença'].map((t) => h('th', { text: t })))),
          h('tbody', null,
            linha('Perda de bitola (geral)', antes.pct, depois.pct),
            linha('Perda em tangentes', porTipo(original, 'T'), porTipo(simulado, 'T')),
            linha('Perda em curvas', porTipo(original, 'C'), porTipo(simulado, 'C')),
            linha('OGMS − KLD médio', mediaKld(original), mediaKld(simulado), 2, ' mm', true)))))));
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
      h('div', { style: { marginBottom: '10px' } },
        h('select', {
          class: 'select-auto',
          'aria-label': 'Parâmetro de nivelamento',
          value: rankingCampo,
          onchange: (e) => { rankingCampo = e.target.value; renderRanking(); }
        }, disponiveis.map((p) => h('option', { value: p.id, text: p.nome })))),
      lista.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro' },
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

  /** Laudo: melhor offset em cada bitola e o resultado se ele for aplicado (mesma regra da análise). */
  function tabelaOffsetLaudo(tabela) {
    if (!opcoesAnalise) return null;
    const lim = opcoes.limitePerda;
    const base = B.analisar(arquivo, { ...opcoesAnalise, offset: { ...opcoes.offset, aplicar: false } });
    const linhas = [];
    ['bitF', 'bitT'].forEach((b) => {
      const m = B.melhorOffset(arquivo.dados, b, lim, base.mascara);
      if (!m) return;
      const com = B.analisar(arquivo, { ...opcoesAnalise, offset: { bitola: b, valor: m.valor, aplicar: true } });
      const el = (r) => `${r.tangentes.comPerda + r.curvas.comPerda} de ${r.tangentes.quantidade + r.curvas.quantidade}`;
      const seta = (a, d) => `${fmt(a)}% → ${fmt(d)}%`;
      linhas.push([NOMES_BITOLA[b], `${m.valor > 0 ? '+' : ''}${fmt(m.valor, 1)}`,
        seta(base.geral.pctPerda, com.geral.pctPerda), seta(base.tangentes.pctPerda, com.tangentes.pctPerda),
        seta(base.curvas.pctPerda, com.curvas.pctPerda), `${el(base)} → ${el(com)}`]);
    });
    if (!linhas.length) return null;
    return h('section', { class: 'laudo-secao' }, h('h2', { text: 'Melhor offset e resultado se aplicado' }),
      tabela(['Bitola', 'Melhor offset (mm)', 'Perda de bitola', 'Em tangentes', 'Em curvas', 'Elementos com perda'], linhas, 'centro'),
      h('p', { class: 'laudo-nota', text: `Sem offset → com o melhor offset. Melhor offset: o valor de −10 a +10 mm (passo 0,1) que deixa menos pontos com |F − T| > ${fmt(lim, 0)} mm.` }));
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
      .map(({ titulo, op }) => ({ titulo, g: charts.graficoKm({ ...op, titulo, altura: 140 }) }));

    const nivel = B.NIVELAMENTO.filter((p) => arquivo.dados[p.id] && arquivo.dados[p.id].some((v) => !Number.isNaN(v)));
    const tabelaCols = (cols, itens) => tabela(cols.map((c) => c.t), [...itens.map((x) => cols.map((c) => c.v(x))), valoresTotal(cols)], 'centro');
    const off = opcoes.offset;
    const criterios = [
      `Bitola = ${B.NOMINAL} mm + valor do arquivo.`,
      `Ponto acima da regra: |Bitola F − Bitola T| > ${fmt(opcoes.limitePerda, 0)} mm, com a diferença arredondada a 0,01 mm (exatamente ${fmt(opcoes.limitePerda, 0)},00 mm não está acima); só pontos com Bitola F e T lidas. % perda = pontos acima da regra ÷ total de pontos. Curva ou tangente perdeu a bitola quando a % de perda passa de ${fmt(opcoes.limiteElemento ?? 10, 0)}%. * = elemento com menos de 90% dos pontos com leitura.`,
      `Variação rápida quando o desvio padrão da bitola em 1 m passa de ${fmt(opcoes.limiteVariacao, 1)} mm.`,
      r.modo !== 'curvatura'
        ? `${r.modo === 'hibrido' ? 'Elementos com limites pelo raio medido e nomes da planta da linha' : 'Elementos pelo km da planta da linha'} (${planta.nome}), por trecho EH x/y e RH (circuito); circuitos (RH) fora das estatísticas gerais: ramal ${infoPlanta.ramal} do arquivo CSV, localização pelo km (a coluna LINHA é só informativa), correção do km de ${fmt(infoPlanta.ajuste, 1)} m${infoPlanta.automatico ? ' (automático' + (infoPlanta.acerto !== null ? `, curvas coincidentes em ${fmt(infoPlanta.acerto, 0)}% do trecho` : '') + ')' : ''}.`
        : `Elementos pelo raio medido (10000/R, média móvel de ${fmt(opcoes.suavizacao, 0)} m): curva com raio até ${int(opcoes.raioCurva)} m, volta a tangente acima de ${int(opcoes.raioCurva * 2)} m; curva mínima ${fmt(opcoes.curvaMin, 0)} m; tangente menor que ${fmt(opcoes.tangenteMin, 0)} m entre curvas é absorvida por elas.`,
      off.aplicar && off.valor ? `Offset de ${fmt(off.valor, 1)} mm aplicado em ${NOMES_BITOLA[off.bitola]}.` : ''
    ].filter(Boolean).join(' ');

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
          [['Perda de bitola', `${fmt(r.geral.pctPerda)}%`, `${int(r.geral.perdas)} pontos acima de ${int(r.geral.pontos)} · ${fmt(extAcima(r.geral.perdas), 0)} m`],
            ['Elementos que perderam', `${r.tangentes.comPerda + r.curvas.comPerda} de ${r.tangentes.quantidade + r.curvas.quantidade}`, `${r.tangentes.comPerda} tangente(s) · ${r.curvas.comPerda} curva(s) · > ${fmt(opcoes.limiteElemento ?? 10, 0)}%`],
            ['Em tangentes', `${fmt(r.tangentes.pctPerda)}%`, `${int(r.tangentes.perdas)} de ${int(r.tangentes.pontos)} pontos · ${r.tangentes.quantidade} tangente(s)`],
            ['Em curvas', `${fmt(r.curvas.pctPerda)}%`, `${int(r.curvas.perdas)} de ${int(r.curvas.pontos)} pontos · ${r.curvas.quantidade} curva(s)`],
            ['Variação rápida', `${fmt(r.geral.pctVariacao)}%`, `σ em 1 m > ${fmt(opcoes.limiteVariacao, 1)} mm`]
          ].map(([t, v, sub]) => h('div', { class: 'laudo-kpi' }, h('span', { text: t }), h('strong', { text: v }), h('small', { text: sub })))),
        h('p', { class: 'laudo-nota', text: `Critérios: ${criterios}` })),

      tabelaOffsetLaudo(tabela),

      secao('Gráficos ao longo do km', graficosLaudo.map(({ titulo, g }) => h('div', { class: 'laudo-grafico' }, h('h3', { text: titulo }), g.el))),

      r.comLocais && r.porEh.length ? secao('Resumo por trecho (EH e RH) — maior perda primeiro', tabelaCols(colunasEh(true), porPerda(r.porEh))) : null,

      secao(`${r.comLocais ? 'Elementos com EH/RH da planta: tangentes e curvas' : 'Elementos: tangentes e curvas'} — maior perda primeiro`, tabelaCols(colunasElementos(true), porPerda(r.elementos))),

      secao('Ranking de nivelamento (5 maiores valores por parâmetro)',
        h('div', { class: 'laudo-ranking' }, nivel.map((p) => h('div', { class: 'laudo-rank' },
          h('h3', { text: p.nome }),
          tabela(['#', 'km', 'Valor', 'Elemento'], B.ranking(arquivo, r.elementos, p.id, { limite: 5, separacao: 10 })
            .map((x) => [x.posicao, x.km, fmt(x.valor, 2), x.elemento]), 'laudo-mini centro'))))),

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
