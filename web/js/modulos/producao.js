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
  let modoEl; // abas Execução | Programação
  let execEl; // cartão da lista (execução)
  let progEl; // programação (calendário + listas)
  let modo = U.pref.get('producao:modo', 'execucao');
  let versaoServidor = null; // conferida ao abrir a programação
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
        h('p', { class: 'sub', text: 'Programe as OMs por dia na aba Programação e marque as realizadas na aba Execução.' })),
      topoEl,
      painelEl,
      modoEl = h('div'),
      execEl = h('section', { class: 'cartao' }, listaCab, listaEl),
      progEl = h('div', { class: 'pilha' }));
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
    renderModo();
    if (modo === 'programacao') renderProgramacao(); else renderLista();
  }

  function renderModo() {
    const tem = !!(dados && dados.oms.length);
    modoEl.hidden = !tem;
    execEl.hidden = !tem || modo !== 'execucao';
    progEl.hidden = !tem || modo !== 'programacao';
    if (!tem) return;
    const botao = (id, rotulo, icone) => h('button', {
      class: `seg-opcao${modo === id ? ' ativo' : ''}`,
      'aria-pressed': modo === id ? 'true' : 'false',
      onclick: () => {
        if (modo === id) return;
        modo = id;
        U.pref.set('producao:modo', id);
        renderTudo();
      }
    }, ui.icone(icone), rotulo);
    ui.trocar(modoEl, h('div', { class: 'seg seg-abas seg-modo', role: 'group', 'aria-label': 'Modo' },
      botao('execucao', 'Execução', 'check'),
      botao('programacao', 'Programação', 'calendario')));
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
        h('p', { class: 'sub', text: 'Importe a planilha de OMs do SAP. Depois, monte a programação do dia, da semana e do mês na aba Programação.' }),
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
        abaBtn('apropriar', 'A apropriar', listas.aApropriar.length),
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
    const base = { dia: listas.doDia, atrasadas: listas.atrasadas, apropriar: listas.aApropriar, todas: listas.todas }[aba] || listas.doDia;
    const termo = U.normalizar(busca);
    const filtrada = base.filter((o) => (!ramal || o.ramal === ramal)
      && (!termo || U.normalizar(`${o.textoBreve} ${o.nOrdem} ${o.denominacao}`).includes(termo)));

    if (!filtrada.length) {
      const msg = { dia: 'Nenhuma OM programada para este dia.', atrasadas: 'Nenhuma OM atrasada.', apropriar: 'Todas as OMs realizadas já foram apropriadas no SAP.', todas: 'Nenhuma OM encontrada.' }[aba];
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
    info.push(...chipsExtras(o));
    const apropriada = feita && !!exec.apropriadaEm;

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
      feita ? h('button', {
        class: `om-sap${apropriada ? ' ok' : ''}`,
        'aria-pressed': apropriada ? 'true' : 'false',
        'aria-label': `${o.textoBreve}: ${apropriada ? 'apropriada no SAP' : 'não apropriada no SAP'}. Tocar para alterar.`,
        title: apropriada ? `Apropriada no SAP em ${U.fmtDataHora(exec.apropriadaEm)}` : 'Marcar como apropriada no SAP',
        onclick: () => apropriar(o)
      }, apropriada ? ui.icone('check') : null, h('span', { text: 'SAP' })) : null,
      h('button', {
        class: 'btn-icone om-mais',
        'aria-label': `Reprogramar ${o.textoBreve}`,
        title: 'Reprogramar',
        onclick: () => abrirReprogramacao(o)
      }, ui.icone('calendario')));
    return linha;
  }

  /** Chips com a situação no SAP e a programação original (quando a OM foi reprogramada). */
  function chipsExtras(o) {
    const chips = [];
    if (o.dataOriginal && o.dataProgramada !== o.dataOriginal) {
      chips.push(h('span', { class: 'chip-info reprog', text: `Orig. ${U.fmtData(o.dataOriginal).slice(0, 5)}`, title: 'Programação original (a OM foi reprogramada)' }));
    }
    // Coluna STATUS da planilha do SAP (ex.: "LIB: Autorizada p/ execução").
    if (o.status || o.statusUsuario) {
      chips.push(h('span', { class: 'chip-info sap', text: o.status || o.statusUsuario, title: [o.status && `STATUS: ${o.status}`, o.statusUsuario && `Status do usuário: ${o.statusUsuario}`, o.statusOrdem && `Status da ordem: ${o.statusOrdem}`].filter(Boolean).join('\n') }));
    }
    const x = dados.exec[o.nOrdem];
    if (x && x.status === OM.REALIZADO && x.apropriadaEm) chips.push(h('span', { class: 'chip-info feita', text: `Apropriada ${U.fmtData(x.apropriadaEm).slice(0, 5)}` }));
    return chips;
  }

  async function apropriar(o) {
    if (travas.has(`sap:${o.nOrdem}`)) return;
    travas.add(`sap:${o.nOrdem}`);
    setTimeout(() => travas.delete(`sap:${o.nOrdem}`), 700);
    try {
      dados.exec[o.nOrdem] = await OM.apropriar(dados.ciclo, o.nOrdem);
      const antigo = listaEl.querySelector(`.om[data-n="${CSS.escape(o.nOrdem)}"]`);
      if (antigo) antigo.replaceWith(itemOM(o));
      atualizarContadores();
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      ui.toast(e.message, 'erro', 4000);
    }
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
    const n = [listas.doDia.length, listas.atrasadas.length, listas.aApropriar.length, listas.todas.length];
    botoes.forEach((b, i) => { b.textContent = b.textContent.replace(/\(\d+\)$/, `(${n[i]})`); });
  }

  /* ---------------- Programação (calendário) ---------------- */

  const selProg = new Set(); // OMs marcadas na lista do dia
  const selDisp = new Set(); // OMs marcadas na lista para adicionar
  let dispTodas = false; // false = só sem programação; true = também as de outras datas
  let dispRamal = '';
  let dispBusca = '';
  let selDia = null; // dia a que as seleções pertencem

  const fmtDiaLongo = (d) => `${U.diaSemanaCurto(d)} ${U.fmtData(d).slice(0, 5)}`;
  const linhaVia = (o) => { const l = OM.linha(o.textoBreve); return l ? `L${l}` : ''; };
  const kmTxt = (o) => {
    const m = Number(o.km);
    if (!Number.isFinite(m) || m <= 0) return '';
    const fim = Number(o.km2);
    const fmt = (x) => `${Math.floor(x / 1000)}+${String(Math.round(x % 1000)).padStart(3, '0')}`;
    return Number.isFinite(fim) && fim > m ? `km ${fmt(m)} a ${fmt(fim)}` : `km ${fmt(m)}`;
  };

  async function conferirServidor() {
    if (versaoServidor !== null || !api.configurado() || navigator.onLine === false) return;
    try {
      const r = await api.chamar('ping');
      versaoServidor = (r && r.versao) || '0';
      if (modo === 'programacao') renderProgramacao();
    } catch (e) { /* sem conexão: confere depois */ }
  }
  const servidorAntigo = () => {
    if (!versaoServidor) return false;
    const [a, b] = versaoServidor.split('.').map((x) => parseInt(x, 10) || 0);
    return a < 1 || (a === 1 && b < 3);
  };

  async function programar(nOrdens, data, msg) {
    if (!nOrdens.length) return;
    try {
      await OM.programarVarios(dados.ciclo, nOrdens, data);
      dados = (await OM.carregarLocal(dados.ciclo)) || dados; // inclui histórico e programação original
      nOrdens.forEach((n) => { selProg.delete(n); selDisp.delete(n); });
      renderPainel();
      renderProgramacao();
      ui.toast(msg, 'ok', 2500);
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      ui.toast(`Não foi possível programar: ${e.message}`, 'erro', 5000);
    }
  }

  function renderProgramacao() {
    if (!dados || !dados.oms.length) return ui.limpar(progEl);
    if (selDia !== ref) { selProg.clear(); selDisp.clear(); selDia = ref; }
    conferirServidor();
    ui.trocar(progEl,
      servidorAntigo() ? h('p', { class: 'aviso', text: `O servidor (Apps Script) está na versão ${versaoServidor}: atualize o Codigo.js no Apps Script e publique uma nova versão (veja INSTALACAO.md). Até lá, retiradas, histórico de reprogramação e apropriação no SAP ficam pendentes no aparelho.` }) : null,
      cartaoCalendario(),
      cartaoDoDia(),
      cartaoAdicionar());
  }

  function cartaoCalendario() {
    const cal = OM.calendario(dados, ref);
    const ini = U.inicioMes(ref);
    const hoje = U.hoje();
    const seg = U.inicioSemana(ref);
    const sex = U.somarDias(seg, 4);
    const dom = U.somarDias(seg, 6);
    const contar = (a, b) => dados.oms.filter((o) => o.dataProgramada && o.dataProgramada >= a && o.dataProgramada <= b).length;
    const semProg = dados.oms.filter((o) => !o.dataProgramada && !OM.realizada(dados, o.nOrdem)).length;
    const naoFeitas = dados.oms.filter((o) => !OM.realizada(dados, o.nOrdem)).length;

    const saidas = {};
    Object.keys(cal).forEach((d) => { const n = OM.saidasDoDia(dados, d).length; if (n) saidas[d] = n; });
    const celulas = [];
    const desloc = (new Date(`${ini}T12:00:00`).getDay() + 6) % 7; // segunda = 0
    for (let i = 0; i < desloc; i++) celulas.push(h('span', { class: 'cal-vazio' }));
    Object.entries(cal).forEach(([d, c]) => {
      const classes = ['cal-dia'];
      if (d === ref) classes.push('sel');
      if (d === hoje) classes.push('hoje');
      if (U.ehFimDeSemana(d)) classes.push('fds');
      if (d >= seg && d <= dom) classes.push('semana');
      if (c.programadas && c.feitas === c.programadas) classes.push('completo');
      else if (c.programadas && d < hoje) classes.push('pendente');
      celulas.push(h('button', {
        class: classes.join(' '),
        'aria-pressed': d === ref ? 'true' : 'false',
        'aria-label': `${U.fmtData(d)}: ${c.programadas} OMs programadas, ${c.feitas} realizadas`,
        onclick: () => mudarData(d)
      },
      h('span', { class: 'cal-num', text: String(Number(d.slice(8))) }),
      c.programadas ? h('span', { class: 'cal-qtd', text: String(c.programadas) }) : h('span', { class: 'cal-qtd zero', text: '·' }),
      c.programadas ? h('span', { class: 'cal-feitas', text: `${c.feitas} ✓` }) : null,
      saidas[d] ? h('span', { class: 'cal-saidas', text: `↷${saidas[d]}`, title: `${saidas[d]} OM(s) reprogramada(s) para outra data` }) : null));
    });

    const mesAnt = U.somarDias(ini, -1).slice(0, 8) + '01';
    const mesSeg = U.somarDias(U.fimMes(ref), 1);
    return h('section', { class: 'cartao' },
      h('div', { class: 'cal-topo' },
        h('button', { class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarData(mesAnt) }, ui.icone('esquerda')),
        h('h2', { text: U.fmtMesAno(ref).replace(/^./, (c) => c.toUpperCase()) }),
        h('button', { class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarData(mesSeg) }, ui.icone('direita'))),
      h('div', { class: 'cal-grade cal-cab' }, ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((t) => h('span', { text: t }))),
      h('div', { class: 'cal-grade' }, celulas),
      h('p', { class: 'sub cal-resumo' },
        h('strong', { text: `Semana ${U.fmtData(seg).slice(0, 5)}–${U.fmtData(sex).slice(0, 5)}: ${contar(seg, sex)} OMs` }),
        ` · Mês: ${contar(ini, U.fimMes(ref))} OMs · Sem programação: ${semProg} de ${naoFeitas} não realizadas`),
      h('p', { class: 'sub', text: 'Toque num dia para ver e montar a programação dele. Número grande = OMs programadas; ✓ = realizadas; ↷ = reprogramadas para outra data.' }));
  }

  function linhaSelecionavel(o, conjunto, extras, aoMudar) {
    const feita = OM.realizada(dados, o.nOrdem);
    const chk = h('input', {
      type: 'checkbox',
      checked: conjunto.has(o.nOrdem),
      'aria-label': `Selecionar ${o.textoBreve}`,
      onchange: (e) => { if (e.target.checked) conjunto.add(o.nOrdem); else conjunto.delete(o.nOrdem); aoMudar(); }
    });
    const info = [linhaVia(o), kmTxt(o)].filter(Boolean).join(' · ');
    return h('label', { class: `om-sel${feita ? ' om-feita' : ''}${conjunto.has(o.nOrdem) ? ' marcada' : ''}`, dataset: { n: o.nOrdem } },
      chk,
      h('span', { class: 'om-texto' },
        h('strong', { text: o.textoBreve }),
        h('span', { class: 'om-sub', text: `${o.nOrdem}${info ? ` · ${info}` : ''}${o.denominacao ? ` · ${o.denominacao}` : ''}` }),
        h('span', { class: 'om-info' }, chipsExtras(o))),
      extras);
  }

  function cartaoDoDia() {
    const doDia = dados.oms.filter((o) => o.dataProgramada === ref).sort(OM.ordemCampo);
    const feitas = doDia.filter((o) => OM.realizada(dados, o.nOrdem)).length;
    const lista = h('div', { class: 'lista-om' });
    const barra = h('div', { class: 'barra-acoes' });
    const destino = h('input', { type: 'date', 'aria-label': 'Mover para a data', value: U.somarDias(ref, 1) });

    function desenharBarra() {
      const n = selProg.size;
      ui.trocar(barra,
        h('label', { class: 'check' }, h('input', {
          type: 'checkbox',
          checked: n > 0 && n === doDia.length,
          'aria-label': 'Selecionar todas do dia',
          onchange: (e) => {
            selProg.clear();
            if (e.target.checked) doDia.forEach((o) => selProg.add(o.nOrdem));
            desenharLista();
          }
        }), n ? ` ${n} selecionada(s)` : ' Selecionar todas'),
        n ? h('div', { class: 'linha-campo' },
          destino,
          h('button', {
            class: 'btn btn-secundario btn-pequeno',
            onclick: () => {
              if (!U.parseData(destino.value)) return ui.marcarErro(destino, 'Escolha a data.');
              if (destino.value === ref) return;
              programar([...selProg], destino.value, `${n} OM(s) movida(s) para ${fmtDiaLongo(destino.value)}.`);
            }
          }, ui.icone('calendario'), 'Mover'),
          h('button', {
            class: 'btn btn-fantasma btn-pequeno',
            onclick: () => programar([...selProg], '', `${n} OM(s) retirada(s) da programação.`)
          }, ui.icone('x'), 'Retirar')) : null);
    }

    function desenharLista() {
      if (!doDia.length) {
        ui.trocar(lista, h('p', { class: 'vazio', text: 'Nenhuma OM programada para este dia. Adicione abaixo.' }));
      } else {
        ui.trocar(lista, doDia.map((o) => {
          const feita = OM.realizada(dados, o.nOrdem);
          return linhaSelecionavel(o, selProg, [
            feita ? h('span', { class: 'chip-info feita', text: 'Feita' }) : null,
            h('button', {
              class: 'btn-icone om-retirar',
              'aria-label': `Retirar ${o.textoBreve} da programação`,
              title: 'Retirar da programação',
              onclick: (e) => { e.preventDefault(); programar([o.nOrdem], '', `${o.textoBreve} retirada da programação.`); }
            }, ui.icone('x'))
          ], () => { desenharBarra(); marcarLinhas(lista, selProg); });
        }));
      }
      desenharBarra();
    }
    desenharLista();

    const saidas = OM.saidasDoDia(dados, ref);
    const blocoSaidas = saidas.length ? h('details', { class: 'saidas' },
      h('summary', null, h('strong', { text: `Reprogramadas deste dia (${saidas.length})` }),
        h('span', { class: 'sub', text: ` · ${resumoDestinos(saidas)}` })),
      h('p', { class: 'sub', text: `Estavam programadas para ${fmtDiaLongo(ref)} e foram movidas ou retiradas. Fica registrado no histórico (aba "Reprogramacoes" da planilha).` }),
      h('div', { class: 'lista-om' }, saidas.map(({ om: o, registradoEm }) => h('div', { class: 'om-sel' },
        h('span', { class: 'om-texto' },
          h('strong', { text: o.textoBreve }),
          h('span', { class: 'om-sub', text: `${o.nOrdem} · ${o.dataProgramada ? `agora em ${fmtDiaLongo(o.dataProgramada)}` : 'retirada da programação'} · registrado ${U.fmtDataHora(registradoEm)}` }),
          h('span', { class: 'om-info' }, chipsExtras(o))),
        OM.realizada(dados, o.nOrdem) ? h('span', { class: 'chip-info feita', text: 'Feita' }) : h('button', {
          class: 'btn btn-fantasma btn-pequeno',
          title: `Trazer de volta para ${fmtDiaLongo(ref)}`,
          onclick: () => programar([o.nOrdem], ref, `${o.textoBreve} voltou para ${fmtDiaLongo(ref)}.`)
        }, 'Voltar'))))) : null;

    return h('section', { class: 'cartao' },
      h('h2', { text: `Programadas para ${fmtDiaLongo(ref)} (${doDia.length})` }),
      doDia.length ? h('p', { class: 'sub', text: `${feitas} realizada(s). Marque para mover a outra data ou retirar da programação.` }) : null,
      barra,
      lista,
      blocoSaidas);
  }

  /** "48 → Qua 21/10 · 2 retiradas" */
  function resumoDestinos(saidas) {
    const cont = {};
    saidas.forEach(({ om: o }) => { const k = o.dataProgramada || ''; cont[k] = (cont[k] || 0) + 1; });
    return Object.entries(cont).sort((a, b) => (a[0] || '9').localeCompare(b[0] || '9'))
      .map(([d, n]) => (d ? `${n} → ${fmtDiaLongo(d)}` : `${n} retirada(s)`)).join(' · ');
  }

  function marcarLinhas(lista, conjunto) {
    lista.querySelectorAll('.om-sel').forEach((el) => el.classList.toggle('marcada', conjunto.has(el.dataset.n)));
  }

  function cartaoAdicionar() {
    const base = OM.disponiveis(dados, { todas: dispTodas, exceto: ref });
    const ramais = [...new Set(base.map((o) => o.ramal))].sort();
    if (dispRamal && !ramais.includes(dispRamal)) dispRamal = '';
    const lista = h('div', { class: 'lista-om lista-disp' });
    const rodape = h('div', { class: 'barra-acoes' });
    let visiveis = [];

    function filtrar() {
      const termo = U.normalizar(dispBusca);
      visiveis = base.filter((o) => (!dispRamal || o.ramal === dispRamal)
        && (!termo || U.normalizar(`${o.textoBreve} ${o.nOrdem} ${o.denominacao}`).includes(termo)));
    }

    function desenharRodape() {
      const n = selDisp.size;
      ui.trocar(rodape,
        h('label', { class: 'check' }, h('input', {
          type: 'checkbox',
          checked: visiveis.length > 0 && visiveis.every((o) => selDisp.has(o.nOrdem)),
          'aria-label': 'Selecionar todas as visíveis',
          onchange: (e) => {
            visiveis.forEach((o) => { if (e.target.checked) selDisp.add(o.nOrdem); else selDisp.delete(o.nOrdem); });
            marcarLinhas(lista, selDisp);
            lista.querySelectorAll('.om-sel input').forEach((c) => { c.checked = selDisp.has(c.closest('.om-sel').dataset.n); });
            desenharRodape();
          }
        }), ` Todas as ${visiveis.length} visíveis`),
        h('button', {
          class: 'btn btn-primario',
          disabled: !n,
          onclick: () => programar([...selDisp], ref, `${n} OM(s) programada(s) para ${fmtDiaLongo(ref)}.`)
        }, ui.icone('mais'), n ? `Programar ${n} em ${U.fmtData(ref).slice(0, 5)}` : 'Selecione as OMs'));
    }

    function desenharLista() {
      filtrar();
      if (!visiveis.length) {
        ui.trocar(lista, h('p', { class: 'vazio', text: base.length ? 'Nenhuma OM com esse filtro.' : (dispTodas ? 'Todas as OMs não realizadas já estão neste dia.' : 'Todas as OMs não realizadas já estão programadas.') }));
      } else {
        const frag = document.createDocumentFragment();
        visiveis.forEach((o) => frag.appendChild(linhaSelecionavel(o, selDisp,
          o.dataProgramada ? h('span', { class: `chip-info${o.dataProgramada < U.hoje() ? ' atrasada' : ''}`, text: `Prog. ${U.fmtData(o.dataProgramada).slice(0, 5)}` }) : null,
          () => { marcarLinhas(lista, selDisp); desenharRodape(); })));
        ui.trocar(lista, frag);
      }
      desenharRodape();
    }

    const filtros = h('div', { class: 'linha-campo filtros' },
      h('select', {
        'aria-label': 'Ramal',
        value: dispRamal,
        onchange: (e) => { dispRamal = e.target.value; desenharLista(); }
      }, h('option', { value: '', text: 'Ramal: todos' }), ramais.map((r) => h('option', { value: r, text: r }))),
      h('input', {
        type: 'search', placeholder: 'Buscar OM ou trecho', 'aria-label': 'Buscar OM para adicionar', value: dispBusca,
        oninput: U.debounce((e) => { dispBusca = e.target.value; desenharLista(); }, 200)
      }));
    desenharLista();

    const semProg = OM.disponiveis(dados).length;
    const outras = OM.disponiveis(dados, { todas: true, exceto: ref }).length;
    return h('section', { class: 'cartao' },
      h('h2', { text: `Adicionar OMs em ${fmtDiaLongo(ref)}` }),
      h('div', { class: 'seg seg-abas', role: 'group', 'aria-label': 'Quais OMs mostrar' },
        [[false, `Sem programação (${semProg})`], [true, `Todas não realizadas (${outras})`]].map(([v, rot]) => h('button', {
          class: `seg-opcao${dispTodas === v ? ' ativo' : ''}`,
          'aria-pressed': dispTodas === v ? 'true' : 'false',
          onclick: () => { dispTodas = v; renderProgramacao(); }
        }, rot))),
      h('p', { class: 'sub', text: dispTodas ? 'Inclui OMs já programadas em outras datas: ao adicionar, elas mudam para este dia.' : 'Ordenadas por ramal, linha e km.' }),
      filtros,
      rodape,
      lista);
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
              dados = (await OM.carregarLocal(dados.ciclo)) || dados;
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
        h('p', { class: 'sub', text: 'Use a exportação do SAP. A coluna "Data Programada" é opcional: a programação pode ser feita no app, e a que já foi feita é mantida ao reimportar.' }),
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
