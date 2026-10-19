/* Módulo 3 – Produção de OMs: importação, marcação e acompanhamento das metas. */
'use strict';

(function (App) {
  const { U, ui, OM, charts, api } = App;
  const { h } = ui;
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let raiz;
  let topoEl;
  let painelEl;
  let listaCab;
  let listaEl;
  let dados = null; // { ciclo, oms, exec }
  let ref = U.hoje();
  let refManual = false; // true quando o usuário escolheu outra data
  let aba = 'dia';
  let ramal = '';
  let busca = '';
  const travas = new Set(); // evita toque duplo acidental

  function montar(el) {
    raiz = el;
    topoEl = h('div', { class: 'cartao' });
    painelEl = h('div', { class: 'pilha' });
    listaCab = h('div', { class: 'lista-cab' });
    listaEl = h('div', { class: 'lista-om' });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Produção de OMs' }),
        h('p', { class: 'sub', text: 'Toque na OM para marcar como realizada. Toque de novo para desfazer.' })),
      topoEl,
      painelEl,
      h('section', { class: 'cartao' }, listaCab, listaEl));
    renderTudo();
  }

  /* ---------------- Carga de dados ---------------- */

  async function carregarLocal() {
    const ciclo = OM.cicloAtivo();
    dados = ciclo ? await OM.carregarLocal(ciclo) : null;
  }

  async function atualizarServidor({ avisar = false } = {}) {
    if (!api.configurado()) return;
    try {
      let ciclo = OM.cicloAtivo();
      if (!ciclo) {
        const ciclos = await api.chamar('getCiclos');
        if (ciclos && ciclos.length) {
          ciclo = ciclos[0].ciclo;
          OM.definirCicloAtivo(ciclo);
        }
      }
      const novos = await OM.atualizarDoServidor(ciclo);
      if (novos) dados = novos;
      renderTudo();
      if (avisar) ui.toast('Dados atualizados.', 'ok');
    } catch (e) {
      if (avisar) ui.toast(`Não foi possível atualizar: ${e.message}`, 'erro', 5000);
    }
  }

  async function aoMostrar() {
    if (!refManual) ref = U.hoje(); // app aberto de um dia para o outro
    await carregarLocal();
    renderTudo();
    await atualizarServidor();
  }

  /* ---------------- Renderização ---------------- */

  function renderTudo() {
    renderTopo();
    renderPainel();
    renderLista();
  }

  async function renderTopo() {
    const ciclos = await OM.ciclosLocais();
    const ativo = OM.cicloAtivo();
    const opcoes = ciclos.map((c) => c.ciclo);
    if (ativo && !opcoes.includes(ativo)) opcoes.unshift(ativo);

    const sel = h('select', {
      'aria-label': 'Ciclo',
      value: ativo,
      onchange: async (e) => {
        OM.definirCicloAtivo(e.target.value);
        await carregarLocal();
        renderTudo();
        atualizarServidor();
      }
    }, opcoes.length ? opcoes.map((c) => h('option', { value: c, text: `Ciclo ${c}` })) : h('option', { value: '', text: 'Nenhum ciclo' }));

    const data = h('input', {
      type: 'date',
      'aria-label': 'Data de referência',
      value: ref,
      onchange: (e) => {
        if (U.parseData(e.target.value)) mudarData(e.target.value);
      }
    });

    ui.trocar(topoEl,
      h('div', { class: 'barra-topo' },
        h('div', { class: 'linha-campo' }, sel,
          h('button', { class: 'btn-icone', 'aria-label': 'Atualizar do servidor', title: 'Atualizar', onclick: () => atualizarServidor({ avisar: true }) }, ui.icone('sync')),
          h('button', { class: 'btn btn-secundario', onclick: abrirImportacao, title: 'Importar planilha do SAP' }, ui.icone('upload'), 'Importar')),
        h('div', { class: 'linha-campo nav-data' },
          h('button', { class: 'btn-icone', 'aria-label': 'Dia anterior', onclick: () => mudarData(U.somarDias(ref, -1)) }, ui.icone('esquerda')),
          data,
          h('button', { class: 'btn-icone', 'aria-label': 'Próximo dia', onclick: () => mudarData(U.somarDias(ref, 1)) }, ui.icone('direita')),
          ref !== U.hoje() ? h('button', { class: 'btn btn-fantasma', onclick: () => mudarData(U.hoje()) }, 'Hoje') : null)));
  }

  function mudarData(d) {
    ref = d;
    refManual = d !== U.hoje();
    renderTudo();
  }

  function renderPainel() {
    if (!dados || !dados.oms.length) {
      ui.trocar(painelEl, h('section', { class: 'cartao vazio-grande' },
        h('p', { text: OM.cicloAtivo() ? `O ciclo ${OM.cicloAtivo()} ainda não foi carregado neste aparelho.` : 'Nenhum ciclo importado ainda.' }),
        h('p', { class: 'sub', text: 'Importe a planilha de OMs do SAP com a coluna "Data Programada".' }),
        h('button', { class: 'btn btn-primario', onclick: abrirImportacao }, ui.icone('upload'), 'Importar planilha')));
      return;
    }
    const m = OM.metricas(dados, ref);
    const ehHoje = ref === U.hoje();
    ui.trocar(painelEl,
      h('div', { class: 'kpis' },
        charts.indicador({ titulo: ehHoje ? 'Hoje' : U.fmtData(ref), ...m.dia, pct: m.dia.pct }),
        charts.indicador({ titulo: `Semana ${U.fmtData(m.semana.inicio).slice(0, 2)}–${U.fmtData(U.somarDias(m.semana.inicio, 4)).slice(0, 5)}`, ...m.semana }),
        charts.indicador({ titulo: `Mês de ${U.fmtMesAno(ref).split(' de ')[0]}`, ...m.mes, extra: `Meta até ${ehHoje ? 'hoje' : U.fmtData(ref).slice(0, 5)}: ${m.mes.metaAteHoje}` }),
        charts.indicador({ titulo: `Ciclo ${dados.ciclo}`, ...m.ciclo })),
      h('div', { class: 'grade-graficos' },
        h('section', { class: 'cartao' }, h('h2', { text: 'Semana: realizado por dia' }), charts.barrasSemana(m.serieSemana, { hoje: ref })),
        h('section', { class: 'cartao' }, h('h2', { text: 'Mês: acumulado' }), charts.linhaMes(m.serieMes, { hoje: ref }))));
  }

  function renderLista() {
    if (!dados || !dados.oms.length) {
      ui.limpar(listaCab);
      ui.limpar(listaEl);
      return;
    }
    const listas = OM.listas(dados, ref);
    const ramais = [...new Set(dados.oms.map((o) => o.ramal))].sort();
    if (ramal && !ramais.includes(ramal)) ramal = '';

    const abaBtn = (id, rotulo, n) => h('button', {
      class: `seg-opcao${aba === id ? ' ativo' : ''}`,
      'aria-pressed': aba === id ? 'true' : 'false',
      onclick: () => { aba = id; renderLista(); }
    }, `${rotulo} (${n})`);

    const campoBusca = h('input', {
      type: 'search',
      placeholder: 'Buscar OM ou trecho',
      'aria-label': 'Buscar OM',
      value: busca,
      oninput: U.debounce((e) => { busca = e.target.value; desenharItens(listas); }, 200)
    });

    ui.trocar(listaCab,
      h('div', { class: 'seg seg-abas', role: 'group', 'aria-label': 'Filtro da lista' },
        abaBtn('dia', ref === U.hoje() ? 'Hoje' : 'Do dia', listas.doDia.length),
        abaBtn('atrasadas', 'Atrasadas', listas.atrasadas.length),
        abaBtn('todas', 'Todas', listas.todas.length)),
      h('div', { class: 'linha-campo filtros' },
        h('select', {
          'aria-label': 'Ramal',
          value: ramal,
          onchange: (e) => { ramal = e.target.value; desenharItens(listas); }
        }, h('option', { value: '', text: 'Ramal: todos' }), ramais.map((r) => h('option', { value: r, text: r }))),
        campoBusca));
    desenharItens(listas);
  }

  function desenharItens(listas) {
    const base = aba === 'dia' ? listas.doDia : aba === 'atrasadas' ? listas.atrasadas : listas.todas;
    const termo = U.normalizar(busca);
    const filtrada = base.filter((o) => (!ramal || o.ramal === ramal)
      && (!termo || U.normalizar(`${o.textoBreve} ${o.nOrdem} ${o.denominacao}`).includes(termo)));

    if (!filtrada.length) {
      const msg = { dia: 'Nenhuma OM programada para este dia.', atrasadas: 'Nenhuma OM atrasada.', todas: 'Nenhuma OM encontrada.' }[aba];
      ui.trocar(listaEl, h('p', { class: 'vazio', text: base.length ? 'Nenhuma OM com esse filtro.' : msg }));
      return;
    }
    const frag = document.createDocumentFragment();
    filtrada.forEach((o) => frag.appendChild(itemOM(o)));
    ui.trocar(listaEl, frag);
  }

  function itemOM(o) {
    const exec = dados.exec[o.nOrdem];
    const feita = !!(exec && exec.status === OM.REALIZADO);
    const atrasada = !feita && o.dataProgramada && o.dataProgramada < U.hoje();
    const info = [];
    if (o.dataProgramada) info.push(h('span', { class: `chip-info${atrasada ? ' atrasada' : ''}`, text: `Prog. ${U.fmtData(o.dataProgramada).slice(0, 5)}` }));
    else info.push(h('span', { class: 'chip-info', text: 'Sem programação' }));
    if (feita && exec.dataRealizacao) info.push(h('span', { class: 'chip-info feita', text: `Feita ${U.fmtData(exec.dataRealizacao).slice(0, 5)} ${U.fmtHora(exec.dataRealizacao)}` }));

    const linha = h('div', { class: `om${feita ? ' om-feita' : ''}`, dataset: { n: o.nOrdem } },
      h('button', {
        class: 'om-botao',
        'aria-pressed': feita ? 'true' : 'false',
        'aria-label': `${o.textoBreve}: ${feita ? 'realizada' : 'não realizada'}. Tocar para alterar.`,
        onclick: () => alternar(o)
      },
      h('span', { class: 'om-marca', 'aria-hidden': 'true' }, feita ? ui.icone('check') : null),
      h('span', { class: 'om-texto' },
        h('strong', { text: o.textoBreve }),
        h('span', { class: 'om-sub', text: `${o.nOrdem}${o.denominacao ? ` · ${o.denominacao}` : ''}` }),
        h('span', { class: 'om-info' }, info)),
      h('span', { class: `om-status ${feita ? 'ok' : ''}`, text: feita ? 'Realizado' : 'Não realizado' })),
      h('button', {
        class: 'btn-icone om-mais',
        'aria-label': `Reprogramar ${o.textoBreve}`,
        title: 'Reprogramar',
        onclick: () => abrirReprogramacao(o)
      }, ui.icone('calendario')));
    return linha;
  }

  async function alternar(o) {
    if (travas.has(o.nOrdem)) return;
    travas.add(o.nOrdem);
    setTimeout(() => travas.delete(o.nOrdem), 700);
    try {
      const novo = await OM.alternar(dados.ciclo, o.nOrdem);
      dados.exec[o.nOrdem] = novo;
      const antigo = listaEl.querySelector(`.om[data-n="${CSS.escape(o.nOrdem)}"]`);
      if (antigo) antigo.replaceWith(itemOM(o));
      renderPainel();
      atualizarContadores();
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      ui.toast(`Não foi possível marcar: ${e.message}`, 'erro', 5000);
    }
  }

  function atualizarContadores() {
    const listas = OM.listas(dados, ref);
    const botoes = listaCab.querySelectorAll('.seg-abas .seg-opcao');
    const n = [listas.doDia.length, listas.atrasadas.length, listas.todas.length];
    botoes.forEach((b, i) => { b.textContent = b.textContent.replace(/\(\d+\)$/, `(${n[i]})`); });
  }

  /* ---------------- Reprogramação ---------------- */

  function abrirReprogramacao(o) {
    const input = h('input', { type: 'date', value: o.dataProgramada || ref });
    ui.modal({
      titulo: 'Reprogramar OM',
      conteudo: h('div', { class: 'pilha' },
        h('p', null, h('strong', { text: o.textoBreve }), h('br'), h('span', { class: 'sub', text: o.nOrdem })),
        ui.campo('Nova data programada', input)),
      acoes: [
        { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Salvar',
          classe: 'btn-primario',
          onClick: async (fechar) => {
            if (!U.parseData(input.value)) {
              ui.marcarErro(input, 'Informe uma data válida.');
              return;
            }
            try {
              await OM.reprogramar(dados.ciclo, o.nOrdem, input.value);
              o.dataProgramada = input.value;
              fechar();
              renderPainel();
              renderLista();
              ui.toast(`OM reprogramada para ${U.fmtData(input.value)}.`, 'ok');
            } catch (e) {
              ui.toast(`Não foi possível reprogramar: ${e.message}`, 'erro');
            }
          }
        }
      ]
    });
  }

  /* ---------------- Importação ---------------- */

  function carregarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Leitor de planilhas indisponível.')));
      s.onerror = () => reject(new Error('Sem internet para carregar o leitor de planilhas.'));
      document.head.appendChild(s);
    });
  }

  async function lerArquivo(arquivo) {
    const XLSX = await carregarXLSX();
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    // Usa a primeira aba que tiver a coluna Nº Ordem.
    for (const nome of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
      const r = OM.processarLinhas(linhas);
      if (!r.erros.length || nome === wb.SheetNames[wb.SheetNames.length - 1]) return r;
    }
    return OM.processarLinhas([]);
  }

  async function abrirImportacao() {
    let resultado = null;
    const ciclosExistentes = await OM.ciclosLocais();
    const resumo = h('div', { class: 'pilha' });
    const cicloInput = h('input', {
      type: 'text', inputmode: 'numeric', maxlength: 4, placeholder: 'Ex.: 5',
      oninput: () => desenharResumo()
    });
    const arquivoInput = h('input', {
      type: 'file',
      accept: '.xlsx,.xls,.csv',
      onchange: async (e) => {
        const arq = e.target.files[0];
        resultado = null;
        if (!arq) return desenharResumo();
        ui.trocar(resumo, h('p', { class: 'sub', text: 'Lendo arquivo…' }));
        try {
          resultado = await lerArquivo(arq);
        } catch (err) {
          resultado = { oms: [], avisos: [], erros: [err.message] };
        }
        desenharResumo();
      }
    });
    let botaoImportar = null;

    function desenharResumo() {
      const ciclo = cicloInput.value.trim();
      const cicloOk = /^\d{1,4}$/.test(ciclo);
      const pronto = resultado && !resultado.erros.length && cicloOk;
      if (botaoImportar) botaoImportar.disabled = !pronto;
      if (!resultado) return ui.limpar(resumo);
      if (resultado.erros.length) {
        return ui.trocar(resumo, resultado.erros.map((e) => h('p', { class: 'aviso aviso-erro', text: e })));
      }
      const porRamal = {};
      resultado.oms.forEach((o) => { const r = OM.ramal(o.textoBreve); porRamal[r] = (porRamal[r] || 0) + 1; });
      const existente = ciclosExistentes.find((c) => c.ciclo === ciclo);
      const avisos = resultado.avisos.slice(0, 6);
      ui.trocar(resumo,
        h('p', null, h('strong', { text: `${resultado.oms.length} OMs encontradas` }),
          ` · ${resultado.oms.length - resultado.semDataProgramada} com data programada`),
        h('p', { class: 'sub', text: Object.entries(porRamal).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}: ${n}`).join(' · ') }),
        existente ? h('p', { class: 'aviso', text: `O ciclo ${ciclo} já existe (${existente.total} OMs). As OMs serão substituídas pelas deste arquivo; as realizações já lançadas são mantidas.` }) : null,
        avisos.map((a) => h('p', { class: 'aviso', text: a })),
        resultado.avisos.length > avisos.length ? h('p', { class: 'sub', text: `…e mais ${resultado.avisos.length - avisos.length} aviso(s).` }) : null);
    }

    const m = ui.modal({
      titulo: 'Importar planilha de OMs',
      conteudo: h('div', { class: 'pilha' },
        h('p', { class: 'sub', text: 'Use a exportação do SAP com a coluna "Data Programada" preenchida.' }),
        ui.campo('Número do ciclo', cicloInput, { obrigatorio: true }),
        ui.campo('Arquivo (.xlsx)', arquivoInput, { obrigatorio: true }),
        resumo),
      acoes: [
        { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Importar',
          classe: 'btn-primario',
          onClick: async (fechar) => {
            if (!resultado || resultado.erros.length) return;
            botaoImportar.disabled = true;
            botaoImportar.textContent = 'Importando…';
            try {
              const r = await OM.importar(cicloInput.value.trim(), resultado.oms);
              fechar();
              await carregarLocal();
              aba = 'dia';
              renderTudo();
              ui.toast(`${r.importadas} OMs importadas no ciclo ${r.ciclo}.`, 'ok', 5000);
            } catch (e) {
              botaoImportar.disabled = false;
              botaoImportar.textContent = 'Importar';
              ui.toast(e.codigo === 'REDE' ? 'Sem conexão. A importação precisa de internet.' : `Erro na importação: ${e.message}`, 'erro', 6000);
            }
          }
        }
      ]
    });
    botaoImportar = m.caixa.querySelector('.modal-acoes .btn-primario');
    botaoImportar.disabled = true;
  }

  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'producao', titulo: 'Produção', icone: 'grafico', montar, aoMostrar });
})(window.App);
