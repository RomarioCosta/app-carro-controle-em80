/*
 * Módulo 2 – Registro de Eventos: falhas de equipamento e outros eventos que afetam a inspeção
 * (atraso da equipe, liberação do carro, chuva…), com o impacto em OMs perdidas e em tempo.
 * Painel com gráficos, histórico com filtro por data e exportação em PDF e Excel.
 */
'use strict';

(function (App) {
  const { U, ui, dados, config, sync } = App;
  const { h } = ui;
  const COLECAO = 'eventos';
  const FALHA = 'Falha de equipamento';
  const UNIDADES = { min: 'minutos', h: 'horas', d: 'dias' };
  const unidadeDe = (u) => (u === 'd' || u === 'min' ? u : 'h');
  /** Nome antigo do equipamento (antes da correção para Applanix). */
  const NOMES_ANTIGOS = { Aplanix: 'Applanix' };

  let raiz;
  let formCartao;
  let painelEl;
  let abertosEl;
  let lista = []; // todos os eventos do aparelho (inclusive excluídos)
  let pendentes = new Map();
  let editando = null; // evento em edição (ou null)
  let f = {}; // campos do formulário
  let periodo = U.pref.get('eventos:periodo', '30d');
  let linhaGrafico = U.pref.get('eventos:linha', 'acumulado'); // linha do gráfico: 'diario' ou 'acumulado'
  let filtroHist = null; // { de, ate, rotulo }: histórico só desses dias (campo de data ou clique no gráfico)
  let historicoEl;
  let historicoAberto = U.pref.get('eventos:historicoAberto', true);

  const vazio = () => ({
    categoria: FALHA, equipamento: '', outro: '', parte: '', descricao: '',
    inicio: '', fim: '', impactos: [], observacao: ''
  });
  const impactoVazio = (data = '') => ({ data, oms: '', valor: '', unidade: unidadeDe(U.pref.get('eventos:unidade', 'h')) });

  /* ---------------- Identificação e valores ---------------- */

  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  /** Código curto e legível do evento: EV-AAMMDD-XXXX (data do início + 4 caracteres aleatórios). */
  function novoCodigo(inicio) {
    const data = String(inicio || U.agora()).slice(2, 10).replace(/-/g, '');
    const b = new Uint8Array(4);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else b.forEach((_, i) => { b[i] = Math.random() * 256; });
    return `EV-${data}-${[...b].map((x) => ALFABETO[x % ALFABETO.length]).join('')}`;
  }
  /** Eventos antigos (sem código) ganham um código fixo a partir do id. */
  const codigoDe = (ev) => ev.codigo || `EV-${String(ev.inicio || '').slice(2, 10).replace(/-/g, '')}-${String(ev.id || '').replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase()}`;
  const categoriaDe = (ev) => ev.categoria || FALHA;
  const ehFalha = (ev) => categoriaDe(ev) === FALHA;
  const titulo = (ev) => (ehFalha(ev) ? [ev.equipamento, ev.parte] : [categoriaDe(ev), ev.descricao]).filter(Boolean).join(' · ');
  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v));
  const horasImpacto = (i) => num(i.valor) * ({ d: 24, min: 1 / 60 }[i.unidade] || 1);
  /**
   * Impactos do evento, um por dia: [{ data, oms, valor, unidade }].
   * Eventos antigos (um impacto só, nos campos omsPerdidas/impactoValor/dataImpacto) viram um item.
   */
  function impactosDe(ev) {
    let lista = Array.isArray(ev.impactos) ? ev.impactos : null;
    if (!lista && ev.impactosJson) { try { lista = JSON.parse(ev.impactosJson); } catch (e) { lista = null; } }
    if (!Array.isArray(lista)) {
      lista = num(ev.omsPerdidas) || num(ev.impactoValor)
        ? [{ data: diaImpactoAntigo(ev), oms: ev.omsPerdidas, valor: ev.impactoValor, unidade: unidadeDe(ev.impactoUnidade) }]
        : [];
    }
    const inicio = String(ev.inicio || '').slice(0, 10);
    return lista.map((i) => ({ data: U.ehData(String(i.data || '').slice(0, 10)) ? String(i.data).slice(0, 10) : inicio, oms: i.oms, valor: i.valor, unidade: unidadeDe(i.unidade) }))
      .sort((a, b) => a.data.localeCompare(b.data));
  }
  const omsDe = (ev, filtro = () => true) => impactosDe(ev).filter(filtro).reduce((t, i) => t + num(i.oms), 0);
  const horasDe = (ev, filtro = () => true) => impactosDe(ev).filter(filtro).reduce((t, i) => t + horasImpacto(i), 0);
  const fmtTempo = (i) => `${fmtN(i.valor, 1)} ${i.unidade === 'd' ? (num(i.valor) === 1 ? 'dia' : 'dias') : i.unidade === 'min' ? 'min' : 'h'}`;
  const fmtN = (v, casas = 0) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
  const fmtHoras = (hh) => {
    if (hh > 0 && hh < 1) return `${fmtN(hh * 60)} min`;
    return hh >= 24 ? `${fmtN(hh, 1)} h (${fmtN(hh / 24, 1)} dia${hh / 24 >= 2 ? 's' : ''})` : `${fmtN(hh, 1)} h`;
  };
  /** Um texto por dia de impacto: "19/10: 92 OMs perdidas · 8 h". */
  const textoImpacto = (ev) => impactosDe(ev).map((i) => {
    const partes = [];
    if (num(i.oms)) partes.push(`${fmtN(i.oms)} OM${num(i.oms) > 1 ? 's' : ''} perdida${num(i.oms) > 1 ? 's' : ''}`);
    if (num(i.valor)) partes.push(fmtTempo(i));
    return partes.length ? `${U.fmtData(i.data).slice(0, 5)}: ${partes.join(' · ')}` : '';
  }).filter(Boolean);
  const visiveis = () => lista.filter((e) => !e.excluidoEm);
  /** Dia do impacto nos eventos antigos (um impacto só). */
  const diaImpactoAntigo = (ev) => (U.ehData(String(ev.dataImpacto || '').slice(0, 10)) ? String(ev.dataImpacto).slice(0, 10) : String(ev.inicio || '').slice(0, 10));
  /** Rótulo do tipo nos gráficos: em "Outro", a descrição do evento. */
  const rotuloTipo = (ev) => (categoriaDe(ev) === 'Outro' && ev.descricao ? ev.descricao : categoriaDe(ev));

  /* ---------------- Montagem ---------------- */

  function montar(el) {
    raiz = el;
    f = vazio();
    formCartao = h('section', { class: 'cartao' });
    painelEl = h('section', { class: 'cartao' });
    abertosEl = h('div', { class: 'lista' });
    historicoEl = h('details', {
      class: 'cartao ev-historico', open: historicoAberto || null,
      ontoggle: (e) => { historicoAberto = e.target.open; U.pref.set('eventos:historicoAberto', historicoAberto); }
    });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Registro de Eventos' }),
        h('p', { class: 'sub', text: 'Falhas de equipamento e outros eventos que afetam a inspeção. Deixe o fim em branco enquanto o evento estiver ocorrendo.' })),
      formCartao,
      h('section', { class: 'cartao' }, h('h2', { text: 'Em aberto' }), abertosEl),
      painelEl,
      historicoEl);
    renderForm();
    setInterval(() => {
      if (raiz.offsetParent !== null) renderListas();
    }, 30000);
  }

  /* ---------------- Formulário ---------------- */

  function renderForm() {
    const falha = f.categoria === FALHA;
    const ehOutro = f.equipamento === 'Outro';
    const sugestoesParte = U.maisFrequentes(lista.map((e) => e.parte), 15);
    const sugestoesDescricao = U.maisFrequentes(lista.filter((e) => categoriaDe(e) === f.categoria).map((e) => e.descricao), 15);

    const selCategoria = h('select', {
      name: 'categoria',
      value: f.categoria,
      onchange: (e) => { f.categoria = e.target.value; renderForm(); }
    }, config.categoriasEvento.map((c) => h('option', { value: c, text: c })));

    const sel = h('select', {
      name: 'equipamento',
      value: f.equipamento,
      onchange: (e) => { f.equipamento = e.target.value; renderForm(); }
    }, h('option', { value: '', text: 'Selecione…' }), config.equipamentos.map((q) => h('option', { value: q, text: q })));

    const dataHora = (campo, rotulo) => {
      const input = h('input', {
        type: 'datetime-local',
        name: campo,
        value: U.paraInputDataHora(f[campo]),
        onchange: (e) => { f[campo] = U.deInputDataHora(e.target.value); }
      });
      return ui.campo(rotulo, h('div', { class: 'linha-campo' }, input,
        h('button', {
          type: 'button',
          class: 'btn btn-secundario',
          onclick: () => { f[campo] = U.agora(); input.value = U.paraInputDataHora(f[campo]); }
        }, ui.icone('relogio'), 'Agora'),
        f[campo] ? h('button', {
          type: 'button',
          class: 'btn-icone',
          'aria-label': `Limpar ${rotulo.toLowerCase()}`,
          onclick: () => { f[campo] = ''; renderForm(); }
        }, ui.icone('x')) : null));
    };


    ui.trocar(formCartao,
      h('h2', { text: editando ? `Editar evento ${codigoDe(editando)}` : 'Novo evento' }),
      h('form', { class: 'pilha', novalidate: true, onsubmit: (e) => { e.preventDefault(); salvar(); } },
        ui.campo('Tipo de evento', selCategoria, { obrigatorio: true }),
        falha
          ? h('div', { class: 'grade-2' },
            ui.campo('Equipamento', sel, { obrigatorio: true }),
            ehOutro ? ui.campo('Qual equipamento?', h('input', {
              type: 'text', name: 'outro', maxlength: 80, value: f.outro,
              oninput: (e) => { f.outro = e.target.value; }
            }), { obrigatorio: true }) : null,
            ui.campo('Parte do equipamento', h('input', {
              type: 'text', name: 'parte', maxlength: 120, list: 'dl-partes', value: f.parte,
              oninput: (e) => { f.parte = e.target.value; }
            })))
          : ui.campo('Descrição', h('input', {
            type: 'text', name: 'descricao', maxlength: 160, list: 'dl-descricoes', value: f.descricao,
            placeholder: 'Ex.: equipe de manutenção liberou o carro com atraso',
            oninput: (e) => { f.descricao = e.target.value; }
          })),
        h('datalist', { id: 'dl-partes' }, sugestoesParte.map((p) => h('option', { value: p }))),
        h('datalist', { id: 'dl-descricoes' }, sugestoesDescricao.map((p) => h('option', { value: p }))),
        h('div', { class: 'grade-2' },
          dataHora('inicio', 'Início'),
          dataHora('fim', 'Fim')),
        h('fieldset', { class: 'ev-impactos' },
          h('legend', { text: 'Impacto (um por dia)' }),
          f.impactos.map((imp, k) => h('div', { class: 'ev-impacto-linha' },
            h('div', { class: 'grade-4' },
              ui.campo('Data do impacto', h('input', {
                type: 'date', name: `impData${k}`, value: imp.data,
                onchange: (e) => { imp.data = e.target.value; }
              })),
              ui.campo('OMs perdidas', h('input', {
                type: 'number', name: `impOms${k}`, min: 0, step: 1, inputmode: 'numeric', value: imp.oms, placeholder: '0',
                oninput: (e) => { imp.oms = e.target.value; }
              })),
              ui.campo('Impacto no tempo', h('input', {
                type: 'number', name: `impValor${k}`, min: 0, step: 'any', inputmode: 'decimal', value: imp.valor, placeholder: '0',
                oninput: (e) => { imp.valor = e.target.value; }
              })),
              ui.campo('Unidade', h('select', {
                name: `impUnidade${k}`, value: imp.unidade,
                onchange: (e) => { imp.unidade = e.target.value; U.pref.set('eventos:unidade', imp.unidade); }
              }, Object.entries(UNIDADES).map(([v, t]) => h('option', { value: v, text: t }))))),
            h('button', {
              type: 'button', class: 'btn-icone', 'aria-label': `Remover impacto ${k + 1}`, title: 'Remover este dia',
              onclick: () => { f.impactos.splice(k, 1); renderForm(); }
            }, ui.icone('lixo')))),
          h('button', {
            type: 'button', class: 'btn btn-secundario btn-pequeno',
            onclick: () => {
              const ultimo = f.impactos[f.impactos.length - 1];
              const data = ultimo && U.ehData(ultimo.data) ? U.somarDias(ultimo.data, 1) : (String(f.inicio || '').slice(0, 10) || U.hoje());
              f.impactos.push(impactoVazio(data));
              renderForm();
            }
          }, ui.icone('plus'), f.impactos.length ? 'Adicionar outro dia de impacto' : 'Adicionar impacto')),
        ui.campo('Observação', h('textarea', {
          name: 'observacao',
          rows: 3,
          maxlength: 2000,
          value: f.observacao,
          placeholder: 'Detalhes do evento',
          oninput: (e) => { f.observacao = e.target.value; }
        })),
        h('div', { class: 'barra-acoes' },
          editando
            ? h('button', { type: 'button', class: 'btn btn-secundario', onclick: cancelarEdicao }, 'Cancelar edição')
            : [
              h('button', { type: 'button', class: 'btn btn-secundario', onclick: duplicarUltimo, disabled: !visiveis().length }, ui.icone('duplicar'), 'Duplicar último'),
              h('button', { type: 'button', class: 'btn btn-secundario', onclick: iniciarAgora }, ui.icone('play'), 'Iniciar agora')
            ],
          h('button', { type: 'submit', class: 'btn btn-primario' }, ui.icone('check'), editando ? 'Salvar alterações' : 'Salvar evento'))));
  }

  const nomeEquip = (x) => (x.equipamento === 'Outro' ? String(x.outro || '').trim() : x.equipamento);

  function paraForm(ev) {
    const falha = ehFalha(ev);
    const conhecido = config.equipamentos.includes(ev.equipamento) && ev.equipamento !== 'Outro';
    return {
      categoria: config.categoriasEvento.includes(categoriaDe(ev)) ? categoriaDe(ev) : 'Outro',
      equipamento: !falha ? '' : (conhecido ? ev.equipamento : 'Outro'),
      outro: !falha || conhecido ? '' : ev.equipamento,
      parte: ev.parte || '',
      descricao: ev.descricao || '',
      inicio: ev.inicio || '',
      fim: ev.fim || '',
      impactos: impactosDe(ev).map((i) => ({ data: i.data, oms: i.oms === undefined || i.oms === null ? '' : String(i.oms), valor: i.valor === undefined || i.valor === null ? '' : String(i.valor), unidade: i.unidade })),
      observacao: ev.observacao || ''
    };
  }

  function validar(exigirInicio) {
    const form = formCartao.querySelector('form');
    ui.limparErros(form);
    const erros = [];
    if (f.categoria === FALHA) {
      if (!f.equipamento) erros.push(['equipamento', 'Selecione o equipamento.']);
      else if (f.equipamento === 'Outro' && !f.outro.trim()) erros.push(['outro', 'Informe o equipamento.']);
    }
    if (exigirInicio && !f.inicio) erros.push(['inicio', 'Informe o início (ou toque em "Agora").']);
    if (f.inicio && f.fim && f.fim < f.inicio) erros.push(['fim', 'O fim não pode ser antes do início.']);
    const datas = new Set();
    f.impactos.forEach((i, k) => {
      const oms = U.numero(i.oms); const val = U.numero(i.valor);
      if (String(i.oms).trim() !== '' && (oms === null || oms < 0 || !Number.isInteger(oms))) erros.push([`impOms${k}`, 'Informe um número inteiro (0 ou mais).']);
      if (String(i.valor).trim() !== '' && (val === null || val < 0)) erros.push([`impValor${k}`, 'Informe um número (0 ou mais).']);
      if (!U.ehData(i.data)) erros.push([`impData${k}`, 'Informe a data do impacto.']);
      else if (datas.has(i.data)) erros.push([`impData${k}`, 'Já existe um impacto neste dia.']);
      datas.add(i.data);
    });
    erros.forEach(([nome, msg]) => ui.marcarErro(form.querySelector(`[name="${nome}"]`), msg));
    if (erros.length) ui.rolarAte(form.querySelector(`[name="${erros[0][0]}"]`));
    return !erros.length;
  }

  /** Evento a partir do formulário. */
  function doForm(base, inicio, fim) {
    const falha = f.categoria === FALHA;
    const val = (v) => (String(v ?? '').trim() === '' ? '' : U.numero(v));
    const impactos = f.impactos
      .map((i) => ({ data: i.data || String(inicio || '').slice(0, 10), oms: val(i.oms), valor: val(i.valor), unidade: unidadeDe(i.unidade) }))
      .filter((i) => i.oms !== '' || i.valor !== '')
      .sort((a, b) => a.data.localeCompare(b.data));
    const totalOms = impactos.reduce((t, i) => t + num(i.oms), 0);
    const totalHoras = impactos.reduce((t, i) => t + horasImpacto(i), 0);
    const um = impactos.length === 1 ? impactos[0] : null;
    return {
      ...(base || {}),
      id: base ? base.id : U.uuid(),
      codigo: base ? codigoDe(base) : novoCodigo(inicio),
      categoria: f.categoria,
      // fora de "falha de equipamento", o tipo também vai na coluna Equipamento (planilhas antigas exigem o campo)
      equipamento: falha ? nomeEquip(f) : f.categoria,
      parte: falha ? f.parte.trim() : '',
      descricao: falha ? '' : f.descricao.trim(),
      inicio,
      fim,
      // detalhe por dia (planilha: aba Eventos_Impactos) e totais do evento (aba Eventos)
      impactos,
      impactosJson: impactos.length ? JSON.stringify(impactos) : '',
      omsPerdidas: impactos.length ? totalOms : '',
      impactoValor: !impactos.length ? '' : (um ? um.valor : totalHoras),
      impactoUnidade: um ? um.unidade : 'h',
      impactoHoras: impactos.length ? totalHoras : '',
      dataImpacto: impactos.length ? impactos[0].data : '',
      observacao: f.observacao.trim()
    };
  }

  async function gravar(ev, mensagem) {
    try {
      await dados.salvar('evento', COLECAO, ev);
      ui.toast(mensagem, 'ok');
      return true;
    } catch (e) {
      ui.toast(`Não foi possível salvar: ${e.message}`, 'erro', 6000);
      return false;
    }
  }

  async function salvar() {
    if (!validar(true)) return;
    const ev = doForm(editando, f.inicio, f.fim);
    if (await gravar(ev, editando ? 'Evento atualizado.' : (ev.fim ? `Evento ${ev.codigo} salvo.` : `Evento ${ev.codigo} salvo (em aberto).`))) {
      editando = null;
      f = vazio();
      await carregar();
    }
  }

  async function iniciarAgora() {
    if (!validar(false)) return;
    const inicio = U.agora();
    const ev = doForm(null, inicio, '');
    if (await gravar(ev, `Evento ${ev.codigo} iniciado às ${U.fmtHora(inicio)}.`)) {
      f = vazio();
      await carregar();
    }
  }

  function duplicarUltimo() {
    const ultimo = visiveis()[0];
    if (!ultimo) return;
    f = { ...paraForm(ultimo), inicio: '', fim: '', impactos: [] };
    renderForm();
    ui.toast('Dados do último evento copiados. Ajuste os horários e o impacto.', 'info');
  }

  function editar(ev) {
    editando = ev;
    f = paraForm(ev);
    renderForm();
    ui.rolarAte(formCartao);
  }

  function cancelarEdicao() {
    editando = null;
    f = vazio();
    renderForm();
  }

  async function finalizarAgora(ev) {
    const fim = U.agora();
    if (await gravar({ ...ev, codigo: codigoDe(ev), fim: fim < ev.inicio ? ev.inicio : fim }, 'Evento finalizado.')) await carregar();
  }

  async function excluir(ev) {
    const ok = await ui.confirmar(`Excluir o evento ${codigoDe(ev)}?`,
      `${titulo(ev)} · ${U.fmtDataHora(ev.inicio)}. O evento sai das listas e dos gráficos; na planilha, fica marcado como excluído.`,
      { ok: 'Excluir', perigo: true });
    if (!ok) return;
    if (editando && editando.id === ev.id) { editando = null; f = vazio(); }
    if (await gravar({ ...ev, codigo: codigoDe(ev), excluidoEm: U.agora() }, `Evento ${codigoDe(ev)} excluído.`)) await carregar();
  }

  /* ---------------- Listas ---------------- */

  function cartaoEvento(ev, aberto) {
    const dur = U.minutosEntre(ev.inicio, aberto ? U.agora() : ev.fim);
    const impacto = textoImpacto(ev);
    return h('div', { class: `item${aberto ? ' item-aberto' : ''}` },
      h('div', { class: 'item-principal' },
        h('span', { class: 'ev-codigo', text: `${codigoDe(ev)} · ${categoriaDe(ev)}` }),
        h('strong', { text: titulo(ev) }),
        h('span', { class: 'item-sub', text: aberto
          ? `Desde ${U.fmtDataHora(ev.inicio)} · há ${U.fmtDuracao(dur)}`
          : `${U.fmtDataHora(ev.inicio)} → ${ev.fim ? (ev.fim.slice(0, 10) === ev.inicio.slice(0, 10) ? U.fmtHora(ev.fim) : U.fmtDataHora(ev.fim)) : '—'} · ${U.fmtDuracao(dur)}` }),
        impacto.length ? h('div', { class: 'ev-impacto' }, impacto.map((t) => h('span', { class: 'etiqueta etiqueta-alerta', text: t }))) : null,
        ev.observacao ? h('span', { class: 'item-obs', text: ev.observacao }) : null),
      h('div', { class: 'item-lado' },
        pendentes.has(ev.id) ? h('span', { class: 'etiqueta etiqueta-pendente', text: 'Não enviado' }) : null,
        aberto ? h('button', { class: 'btn btn-primario btn-pequeno', onclick: () => finalizarAgora(ev) }, ui.icone('parar'), 'Finalizar agora') : null,
        h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => editar(ev) }, ui.icone('editar'), 'Editar'),
        h('button', { class: 'btn btn-secundario btn-pequeno', 'aria-label': `Excluir ${codigoDe(ev)}`, onclick: () => excluir(ev) }, ui.icone('lixo'), 'Excluir')));
  }

  /** O evento aconteceu (ou teve impacto) entre as datas de e ate? */
  function noIntervalo(ev, de, ate) {
    const ini = String(ev.inicio || '').slice(0, 10);
    const fim = String(ev.fim || U.agora()).slice(0, 10);
    return (ini <= ate && fim >= de) || impactosDe(ev).some((i) => i.data >= de && i.data <= ate);
  }

  /** Filtra o histórico por um dia (ou mês, no gráfico por mês). Repetir o mesmo filtro limpa. */
  function filtrarHistorico(de, ate, rotulo) {
    filtroHist = de && !(filtroHist && filtroHist.de === de && filtroHist.ate === ate) ? { de, ate, rotulo } : null;
    historicoAberto = true;
    renderListas();
    if (filtroHist) ui.rolarAte(historicoEl);
  }

  const LIMITE_HIST = 25;

  function renderHistorico() {
    const todos = visiveis();
    const filtrados = filtroHist ? todos.filter((e) => noIntervalo(e, filtroHist.de, filtroHist.ate)) : todos.filter((e) => e.fim);
    const mostrar = filtroHist ? filtrados : filtrados.slice(0, LIMITE_HIST);
    const campoData = h('input', {
      type: 'date', name: 'filtroData', 'aria-label': 'Filtrar pela data',
      value: filtroHist && filtroHist.de === filtroHist.ate ? filtroHist.de : '',
      onchange: (e) => { const d = e.target.value; filtroHist = null; if (U.ehData(d)) filtrarHistorico(d, d, U.fmtData(d)); else renderListas(); }
    });
    historicoEl.open = historicoAberto;
    ui.trocar(historicoEl,
      h('summary', { class: 'ev-hist-cab' },
        h('h2', { text: 'Histórico de eventos' }),
        h('span', { class: 'sub', text: filtroHist ? `${filtrados.length} evento(s) em ${filtroHist.rotulo}` : `${todos.filter((e) => e.fim).length} finalizado(s)` })),
      h('div', { class: 'ev-hist-filtro' },
        ui.campo('Filtrar pela data', campoData),
        filtroHist ? h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => filtrarHistorico(null) }, ui.icone('x'), 'Limpar filtro') : null,
        h('span', { class: 'sub', text: 'Ou toque num dia do gráfico do painel.' })),
      h('div', { class: 'lista' }, mostrar.length ? mostrar.map((e) => cartaoEvento(e, !e.fim))
        : h('p', { class: 'vazio', text: filtroHist ? `Nenhum evento em ${filtroHist.rotulo}.` : 'Nenhum evento finalizado ainda.' })),
      !filtroHist && filtrados.length > LIMITE_HIST ? h('p', { class: 'sub', text: `Mostrando os ${LIMITE_HIST} mais recentes de ${filtrados.length}. Use o filtro por data para ver os outros.` }) : null);
  }

  function renderListas() {
    const abertos = visiveis().filter((e) => !e.fim);
    ui.trocar(abertosEl, abertos.length ? abertos.map((e) => cartaoEvento(e, true)) : h('p', { class: 'vazio', text: 'Nenhum evento em aberto.' }));
    renderHistorico();
    renderPainel();
  }

  /* ---------------- Painel: indicadores e gráficos ---------------- */

  const PERIODOS = [['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']];

  function intervalo() {
    const hoje = U.hoje();
    if (periodo === '7d') return [U.somarDias(hoje, -6), hoje];
    if (periodo === '30d') return [U.somarDias(hoje, -29), hoje];
    if (periodo === 'mes') return [U.inicioMes(hoje), hoje];
    const datas = visiveis().flatMap((e) => [String(e.inicio).slice(0, 10), ...impactosDe(e).map((i) => i.data)]).filter(U.ehData).sort();
    return [datas[0] || hoje, datas[datas.length - 1] > hoje ? datas[datas.length - 1] : hoje];
  }

  function doPeriodo() {
    const [de, ate] = intervalo();
    return visiveis().filter((e) => [String(e.inicio).slice(0, 10), ...impactosDe(e).map((i) => i.data)].some((d) => d >= de && d <= ate))
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  }

  /** Só os impactos com data dentro do período contam nos totais e gráficos. */
  const noPeriodo = () => { const [de, ate] = intervalo(); return (i) => i.data >= de && i.data <= ate; };

  function resumo(evs) {
    const minutos = evs.reduce((s, e) => s + (U.minutosEntre(e.inicio, e.fim || U.agora()) || 0), 0);
    const filtro = noPeriodo();
    return {
      qtd: evs.length,
      oms: evs.reduce((s, e) => s + omsDe(e, filtro), 0),
      horas: evs.reduce((s, e) => s + horasDe(e, filtro), 0),
      minutos
    };
  }

  /**
   * Série por dia (até 62 dias) ou por mês: OMs perdidas (barras) e impacto no tempo (linha),
   * do dia ou acumulado no período (escolha do usuário). Em minutos quando o maior valor fica abaixo de 2 h.
   */
  function seriePorData(evs) {
    const [de, ate] = intervalo();
    const dias = Math.round((U.parseData(ate) - U.parseData(de)) / 86400000) + 1;
    const porMes = dias > 62;
    const chaves = [];
    if (porMes) { for (let m = U.inicioMes(de); m <= ate; m = U.somarDias(U.fimMes(m), 1)) chaves.push(m.slice(0, 7)); }
    else { for (let d = de; d <= ate; d = U.somarDias(d, 1)) chaves.push(d); }
    const mapa = new Map(chaves.map((k) => [k, { oms: 0, horas: 0, qtd: 0 }]));
    evs.forEach((e) => impactosDe(e).forEach((i) => { // OMs e tempo contam no dia de cada impacto
      const k = porMes ? i.data.slice(0, 7) : i.data;
      const x = mapa.get(k); if (!x) return;
      x.oms += num(i.oms); x.horas += horasImpacto(i); x.qtd++;
    }));
    const acumulado = linhaGrafico === 'acumulado';
    let soma = 0;
    const horas = chaves.map((k) => { soma += mapa.get(k).horas; return acumulado ? soma : mapa.get(k).horas; });
    const emMinutos = Math.max(0, ...horas) < 2;
    const pontos = chaves.map((k, n) => {
      const x = mapa.get(k);
      const de2 = porMes ? `${k}-01` : k;
      return {
        chave: k, de: de2, ate: porMes ? U.fimMes(de2) : k,
        rotulo: porMes ? U.fmtMesAno(de2) : U.fmtData(k).slice(0, 5),
        rotuloLongo: porMes ? U.fmtMesAno(de2) : `${U.diaSemanaCurto(k)} ${U.fmtData(k)}`,
        dica: `${porMes ? U.fmtMesAno(de2) : `${U.diaSemanaCurto(k)} ${U.fmtData(k)}`} · ${x.qtd} impacto(s) · impacto no ${porMes ? 'mês' : 'dia'}: ${fmtHoras(x.horas)}`,
        barra: x.oms,
        horasDia: x.horas,
        linha: emMinutos ? Math.round(horas[n] * 60) : Math.round(horas[n] * 10) / 10
      };
    });
    return { pontos, porMes, emMinutos, acumulado };
  }

  function porGrupo(evs, chave, valor) {
    const mapa = new Map();
    evs.forEach((e) => { const k = chave(e) || '—'; mapa.set(k, (mapa.get(k) || 0) + valor(e)); });
    return [...mapa.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }

  /** Gráfico de barras (OMs perdidas) e linha (impacto no tempo, do dia ou acumulado). */
  function graficoPorData(evs, { interativo = true } = {}) {
    const { charts } = App;
    const sr = seriePorData(evs);
    const un = sr.emMinutos ? 'min' : 'h';
    const nomeLinha = `Impacto no tempo ${sr.acumulado ? 'acumulado no período' : `por ${sr.porMes ? 'mês' : 'dia'}`} (${un})`;
    const sel = filtroHist ? sr.pontos.findIndex((p) => p.de === filtroHist.de && p.ate === filtroHist.ate) : -1;
    return h('div', { class: 'laudo-grafico' },
      h('div', { class: 'ev-graf-cab' },
        h('h3', { text: `OMs perdidas e impacto no tempo ${sr.acumulado ? 'acumulado' : (sr.porMes ? 'por mês' : 'por dia')}` }),
        interativo ? h('div', { class: 'seg seg-compacto', role: 'group', 'aria-label': 'Linha do gráfico' },
          [['diario', sr.porMes ? 'Por mês' : 'Por dia'], ['acumulado', 'Acumulado']].map(([v, t]) => h('button', {
            type: 'button', class: `seg-opcao${linhaGrafico === v ? ' ativo' : ''}`, 'aria-pressed': linhaGrafico === v ? 'true' : 'false',
            onclick: () => { linhaGrafico = v; U.pref.set('eventos:linha', v); renderPainel(); }
          }, t))) : null),
      charts.barrasLinha(sr.pontos, {
        nomeBarra: 'OMs perdidas', nomeLinha, fmtLinha: (v) => `${fmtN(v, sr.emMinutos ? 0 : 1)} ${un}`,
        selecionado: sel,
        aoClicar: interativo ? (p) => filtrarHistorico(p.de, p.ate, sr.porMes ? p.rotulo : p.rotuloLongo) : null,
        dicaClique: interativo ? `Toque para ver os eventos ${sr.porMes ? 'do mês' : 'do dia'}` : null
      }));
  }

  function graficos(evs, opcoes = {}) {
    const { charts } = App;
    const filtro = noPeriodo();
    const porTipoOms = porGrupo(evs, rotuloTipo, (e) => omsDe(e, filtro));
    const porTipoHoras = porGrupo(evs, rotuloTipo, (e) => horasDe(e, filtro));
    const falhas = porGrupo(evs.filter(ehFalha), (e) => e.equipamento, () => 1);
    const bloco = (t, g) => h('div', { class: 'laudo-grafico' }, h('h3', { text: t }), g);
    // barras com linha à esquerda; barras horizontais empilhadas à direita
    return [h('div', { class: 'ev-graf-esq' },
      graficoPorData(evs, opcoes)),
    h('div', { class: 'ev-graf-dir' },
      porTipoOms.length ? bloco('OMs perdidas por tipo de evento', charts.barrasH(porTipoOms.map(([r, v]) => ({ rotulo: r, valor: v, texto: fmtN(v) })))) : null,
      porTipoHoras.length ? bloco('Impacto no tempo por tipo de evento', charts.barrasH(porTipoHoras.map(([r, v]) => ({ rotulo: r, valor: v, texto: fmtHoras(v) })), { classe: 'graf-barra-2' })) : null,
      falhas.length ? bloco('Falhas por equipamento (quantidade)', charts.barrasH(falhas.map(([r, v]) => ({ rotulo: r, valor: v, texto: String(v) })))) : null)];
  }

  function renderPainel() {
    if (!painelEl) return;
    const evs = doPeriodo();
    const r = resumo(evs);
    const [de, ate] = intervalo();
    const kpi = (t, v, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo', text: t }), h('div', { class: 'kpi-valor', text: v }), h('div', { class: 'kpi-sub', text: sub }));
    ui.trocar(painelEl, h('div', { class: 'ev-painel' },
      h('div', { class: 'cartao-cab' },
        h('h2', { text: 'Painel de eventos' }),
        h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-secundario btn-pequeno', onclick: exportarExcel, disabled: !evs.length }, ui.icone('documento'), 'Exportar Excel'),
          h('button', { class: 'btn btn-secundario btn-pequeno', onclick: exportarPdf, disabled: !evs.length }, ui.icone('documento'), 'Exportar PDF'))),
      h('div', { class: 'ev-periodo' },
        h('div', { class: 'seg seg-compacto', role: 'group', 'aria-label': 'Período' },
          PERIODOS.map(([v, t]) => h('button', {
            type: 'button', class: `seg-opcao${periodo === v ? ' ativo' : ''}`, 'aria-pressed': periodo === v ? 'true' : 'false',
            onclick: () => { periodo = v; U.pref.set('eventos:periodo', v); renderPainel(); }
          }, t))),
        h('span', { class: 'sub', text: `${U.fmtData(de)} a ${U.fmtData(ate)}` })),
      h('div', { class: 'kpis ev-kpis' },
        kpi('Eventos', fmtN(r.qtd), `${evs.filter(ehFalha).length} falha(s) de equipamento`),
        kpi('OMs perdidas', fmtN(r.oms), 'informadas nos eventos'),
        kpi('Impacto no tempo', fmtHoras(r.horas), 'informado nos eventos'),
        kpi('Duração dos eventos', U.fmtDuracao(r.minutos) || '0min', 'do início ao fim')),
      evs.length ? h('div', { class: 'ev-graficos' }, graficos(evs)) : h('p', { class: 'vazio', text: 'Nenhum evento no período.' })));
  }

  /* ---------------- PDF ---------------- */

  function exportarPdf() {
    const evs = doPeriodo();
    const r = resumo(evs);
    const [de, ate] = intervalo();
    const tabela = (cab, linhas) => h('table', { class: 'laudo-tabela ev-tabela' },
      h('thead', null, h('tr', null, cab.map((t) => h('th', { text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', null, l.map((c) => h('td', { text: c === null || c === undefined ? '' : String(c) }))))));
    const el = h('div', { id: 'laudo', class: 'laudo ev-pdf' },
      ui.cabecalhoPdf({ titulo: 'Relatório de Eventos – Carro Controle EM80', subtitulo: `Centro de Monitoramento de Ativos · Período: ${U.fmtData(de)} a ${U.fmtData(ate)}`, emissao: U.fmtDataHora(U.agora()) }),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Indicadores' }),
        h('div', { class: 'laudo-kpis' },
          [['Eventos', fmtN(r.qtd), `${evs.filter(ehFalha).length} falha(s) de equipamento`],
            ['OMs perdidas', fmtN(r.oms), 'informadas nos eventos'],
            ['Impacto no tempo', fmtHoras(r.horas), 'informado nos eventos'],
            ['Duração dos eventos', U.fmtDuracao(r.minutos) || '0min', 'do início ao fim']
          ].map(([t, v, sub]) => h('div', { class: 'laudo-kpi' }, h('span', { text: t }), h('strong', { text: v }), h('small', { text: sub }))))),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Gráficos' }), h('div', { class: 'ev-graficos' }, graficos(evs, { interativo: false }))),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Eventos do período' }),
        tabela(['Código', 'Tipo', 'Equipamento / descrição', 'Início', 'Fim', 'Duração', 'OMs perdidas', 'Impactos por dia', 'Observação'],
          evs.map((e) => [codigoDe(e), categoriaDe(e), ehFalha(e) ? [e.equipamento, e.parte].filter(Boolean).join(' · ') : e.descricao,
            U.fmtDataHora(e.inicio), e.fim ? U.fmtDataHora(e.fim) : 'em aberto', U.fmtDuracao(U.minutosEntre(e.inicio, e.fim || U.agora())),
            omsDe(e) ? fmtN(omsDe(e)) : '', textoImpacto(e).join('\n'),
            e.observacao || '']))),
      null);
    imprimir(el, `Eventos EM80 ${U.fmtData(de).replace(/\//g, '-')} a ${U.fmtData(ate).replace(/\//g, '-')}`);
  }

  /* ---------------- Excel ---------------- */

  /**
   * Planilha do período do painel: Resumo (cartões, gráficos e totais por tipo e equipamento),
   * Eventos, Impactos por dia e Por dia. Tabelas do Excel (filtro e zebrado) e gráficos nativos.
   */
  function montarExcel() {
    const X = App.xlsx;
    const evs = doPeriodo().slice().sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    const r = resumo(evs);
    const [de, ate] = intervalo();
    const filtro = noPeriodo();
    const c = (v, e) => ({ v, e });
    const dur = (horas) => c(horas ? horas / 24 : null, 'duracao');
    const descricao = (e) => (ehFalha(e) ? e.parte || '' : e.descricao || '');
    const equipamento = (e) => (ehFalha(e) ? e.equipamento || '' : '');

    /* Por dia (fonte do gráfico de barras e linha) */
    const sr = seriePorData(evs);
    const un = sr.emMinutos ? 'min' : 'h';
    const fmtNum = sr.emMinutos ? 'inteiro' : 'decimal';
    let acum = 0;
    const linhasDia = sr.pontos.map((p) => {
      acum += p.horasDia;
      const conv = (hh) => (sr.emMinutos ? Math.round(hh * 60) : Math.round(hh * 100) / 100);
      return [sr.porMes ? c(p.rotulo, 'texto') : c(X.serial(p.de), 'data'), c(p.barra, 'inteiro'), c(conv(p.horasDia), fmtNum), c(conv(acum), fmtNum)];
    });
    const cabDia = [sr.porMes ? 'Mês' : 'Data', 'OMs perdidas', `Impacto no ${sr.porMes ? 'mês' : 'dia'} (${un})`, `Impacto acumulado (${un})`];
    const porDia = {
      nome: 'Por dia', larguras: [14, 14, 22, 24], congelar: 1,
      linhas: [cabDia, ...linhasDia],
      tabelas: [{ ref: `A1:D${linhasDia.length + 1}`, nome: 'tbPorDia' }]
    };

    /* Eventos */
    const cabEv = ['Código', 'Tipo', 'Equipamento', 'Parte / descrição', 'Início', 'Fim', 'Duração', 'OMs perdidas', 'Impacto no tempo', 'Impactos por dia', 'Observação', 'Situação'];
    const linhasEv = evs.map((e) => [
      c(codigoDe(e), 'texto'), c(categoriaDe(e), 'texto'), c(equipamento(e), 'texto'), c(descricao(e), 'quebra'),
      c(X.serial(e.inicio), 'dataHora'), c(e.fim ? X.serial(e.fim) : null, 'dataHora'),
      c((U.minutosEntre(e.inicio, e.fim || U.agora()) || 0) / 1440, 'duracao'),
      c(omsDe(e) || null, 'inteiro'), dur(horasDe(e)),
      c(textoImpacto(e).join('\n'), 'quebra'), c(e.observacao || '', 'quebra'), c(e.fim ? 'Finalizado' : 'Em aberto', 'texto')
    ]);
    const eventos = {
      nome: 'Eventos', larguras: [17, 20, 13, 30, 16, 16, 10, 14, 17, 30, 42, 11], congelar: 1, paisagem: true,
      linhas: [cabEv, ...linhasEv],
      tabelas: [{ ref: `A1:L${linhasEv.length + 1}`, nome: 'tbEventos' }]
    };

    /* Impactos por dia (só os dias dentro do período) */
    const imps = evs.flatMap((e) => impactosDe(e).filter(filtro).map((i) => ({ e, i }))).sort((a, b) => a.i.data.localeCompare(b.i.data));
    const nomeUn = { min: 'minutos', h: 'horas', d: 'dias' };
    const linhasImp = imps.map(({ e, i }) => [
      c(X.serial(i.data), 'data'), c(codigoDe(e), 'texto'), c(categoriaDe(e), 'texto'), c([equipamento(e), descricao(e)].filter(Boolean).join(' · '), 'quebra'),
      c(num(i.oms) || null, 'inteiro'), dur(horasImpacto(i)), c(num(i.valor) || null, 'decimal'), c(num(i.valor) ? nomeUn[i.unidade] : '', 'texto')
    ]);
    const cabImp = ['Data', 'Código', 'Tipo', 'Equipamento / descrição', 'OMs perdidas', 'Impacto no tempo', 'Valor informado', 'Unidade'];
    const impactos = linhasImp.length ? {
      nome: 'Impactos por dia', larguras: [12, 17, 20, 34, 14, 17, 16, 10], congelar: 1,
      linhas: [cabImp, ...linhasImp],
      tabelas: [{ ref: `A1:H${linhasImp.length + 1}`, nome: 'tbImpactos' }]
    } : null;

    /* Resumo */
    const L = 12; // colunas A–L
    const linhas = []; const mesclas = []; const alturas = {}; const graficos = []; const tabelas = [];
    const pos = () => linhas.length;
    const secao = (texto) => { const l = pos(); linhas.push([c(texto, 'secao'), ...Array.from({ length: L - 1 }, () => c(null, 'secao'))]); mesclas.push(`A${l + 1}:${X.letra(L - 1)}${l + 1}`); };
    linhas.push([c('Eventos do carro controle EM80', 'titulo')]); mesclas.push(`A1:${X.letra(L - 1)}1`); alturas[0] = 22;
    linhas.push([c(`Centro de Monitoramento de Ativos · Período: ${U.fmtData(de)} a ${U.fmtData(ate)} · Emitido em ${U.fmtDataHora(U.agora())}`, 'sub')]);
    mesclas.push(`A2:${X.letra(L - 1)}2`);
    linhas.push([]);
    const cartoes = [
      ['Eventos', c(r.qtd, 'cartaoInteiro'), `${evs.filter(ehFalha).length} falha(s) de equipamento`],
      ['OMs perdidas', c(r.oms, 'cartaoInteiro'), 'informadas nos eventos'],
      ['Impacto no tempo', c(r.horas / 24, 'cartaoDuracao'), 'informado nos eventos (h:min)'],
      ['Duração dos eventos', c(r.minutos / 1440, 'cartaoDuracao'), 'do início ao fim (h:min)']
    ];
    const lc = pos();
    linhas.push(cartoes.map(([t]) => c(t, 'cartaoRotulo')));
    linhas.push(cartoes.map(([, v]) => v));
    linhas.push(cartoes.map(([, , sub]) => c(sub, 'cartaoSub')));
    alturas[lc] = 18; alturas[lc + 1] = 30; alturas[lc + 2] = 30;
    linhas.push([]);

    secao(`OMs perdidas e impacto no tempo ${sr.porMes ? 'por mês' : 'por dia'}`);
    const g1 = pos();
    const nDia = linhasDia.length;
    const colLinha = sr.acumulado ? 3 : 2;
    graficos.push({
      tipo: 'barrasLinha', titulo: `OMs perdidas e impacto no tempo ${sr.acumulado ? 'acumulado' : (sr.porMes ? 'por mês' : 'por dia')} (${un})`,
      de: [0, g1], ate: [L, g1 + 18],
      categorias: { ref: X.absoluta('Por dia', 0, 1, 0, nDia), valores: linhasDia.map((l) => l[0].v), formato: sr.porMes ? null : 'dd/mm' },
      series: [
        { nome: cabDia[1], refNome: X.absoluta('Por dia', 1, 0, 1, 0), ref: X.absoluta('Por dia', 1, 1, 1, nDia), valores: linhasDia.map((l) => l[1].v) },
        { nome: cabDia[colLinha], refNome: X.absoluta('Por dia', colLinha, 0, colLinha, 0), ref: X.absoluta('Por dia', colLinha, 1, colLinha, nDia), valores: linhasDia.map((l) => l[colLinha].v) }
      ],
      formatoLinha: sr.emMinutos ? '#,##0' : '#,##0.0'
    });
    for (let k = 0; k < 19; k++) linhas.push([]);

    /** Tabela de totais (à esquerda) com gráfico de barras (à direita). */
    const blocoTotais = (titulo, nomeTabela, cabecalho, grupos, colGrafico, tituloGrafico) => {
      if (!grupos.length) return;
      secao(titulo);
      const l0 = pos();
      linhas.push(cabecalho);
      grupos.forEach((g) => linhas.push(g));
      tabelas.push({ ref: `A${l0 + 1}:D${l0 + 1 + grupos.length}`, nome: nomeTabela });
      const altura = Math.max(10, grupos.length * 2 + 3);
      graficos.push({
        tipo: 'barrasH', titulo: tituloGrafico, de: [5, l0], ate: [L, l0 + altura],
        categorias: { ref: X.absoluta('Resumo', 0, l0 + 1, 0, l0 + grupos.length), valores: grupos.map((g) => g[0].v) },
        series: [{ nome: cabecalho[colGrafico], refNome: X.absoluta('Resumo', colGrafico, l0, colGrafico, l0), ref: X.absoluta('Resumo', colGrafico, l0 + 1, colGrafico, l0 + grupos.length), valores: grupos.map((g) => g[colGrafico].v || 0) }]
      });
      while (pos() < l0 + altura + 1) linhas.push([]);
    };
    const agrupar = (lista, chave, porFalhas = false) => {
      const m = new Map();
      lista.forEach((e) => {
        const k = chave(e) || '—';
        const x = m.get(k) || { qtd: 0, oms: 0, horas: 0 };
        x.qtd++; x.oms += omsDe(e, filtro); x.horas += horasDe(e, filtro);
        m.set(k, x);
      });
      return [...m.entries()].sort((a, b) => (porFalhas ? b[1].qtd - a[1].qtd || b[1].oms - a[1].oms : b[1].oms - a[1].oms || b[1].qtd - a[1].qtd))
        .map(([k, x]) => [c(k, 'texto'), c(x.qtd, 'inteiro'), c(x.oms, 'inteiro'), dur(x.horas)]);
    };
    const porTipo = agrupar(evs, rotuloTipo);
    blocoTotais('Por tipo de evento', 'tbPorTipo', ['Tipo de evento', 'Eventos', 'OMs perdidas', 'Impacto no tempo'], porTipo,
      porTipo.some((g) => g[2].v) ? 2 : 1, porTipo.some((g) => g[2].v) ? 'OMs perdidas por tipo de evento' : 'Eventos por tipo');
    blocoTotais('Falhas por equipamento', 'tbPorEquipamento', ['Equipamento', 'Falhas', 'OMs perdidas', 'Impacto no tempo'],
      agrupar(evs.filter(ehFalha), (e) => e.equipamento, true), 1, 'Falhas por equipamento');
    linhas.push([c('OMs perdidas e impacto no tempo contam no dia de cada impacto informado no evento. A duração vai do início ao fim do evento (em aberto: até a emissão).', 'nota')]);
    mesclas.push(`A${pos()}:${X.letra(L - 1)}${pos()}`); alturas[pos() - 1] = 30;

    const resumoPl = {
      nome: 'Resumo', larguras: [24, 20, 20, 20, 2, 10, 10, 10, 10, 10, 10, 10], grade: false, paisagem: true,
      linhas, mesclas, alturas, graficos, tabelas
    };
    const nomeArq = `Eventos EM80 ${U.fmtData(de).replace(/\//g, '-')} a ${U.fmtData(ate).replace(/\//g, '-')}.xlsx`;
    return {
      nome: nomeArq,
      bytes: X.gerar({ autor: 'CMA – Centro de Monitoramento de Ativos', titulo: 'Eventos do carro controle EM80', planilhas: [resumoPl, eventos, impactos, porDia].filter(Boolean) })
    };
  }

  function exportarExcel() {
    try {
      const { nome, bytes } = montarExcel();
      App.xlsx.baixar(bytes, nome);
      ui.toast(`Planilha ${nome} gerada.`, 'ok');
    } catch (e) {
      ui.toast(`Não foi possível gerar a planilha: ${e.message}`, 'erro', 7000);
    }
  }

  function imprimir(el, nome) {
    const anterior = document.getElementById('laudo');
    if (anterior) anterior.remove();
    const temaAnterior = document.documentElement.getAttribute('data-theme');
    const tituloAnterior = document.title;
    document.body.appendChild(el);
    document.documentElement.setAttribute('data-theme', 'light');
    document.title = nome;
    const restaurar = () => {
      el.remove();
      document.title = tituloAnterior;
      if (temaAnterior) document.documentElement.setAttribute('data-theme', temaAnterior);
      window.removeEventListener('afterprint', restaurar);
    };
    window.addEventListener('afterprint', restaurar);
    setTimeout(() => {
      try { window.print(); } catch (e) { restaurar(); ui.toast(`Não foi possível abrir a impressão: ${e.message}`, 'erro', 6000); }
    }, 200);
  }

  /* ---------------- Dados ---------------- */

  /** Recarrega a lista. O formulário só é redesenhado quando pedido, para não atrapalhar a digitação. */
  async function carregar({ form = true } = {}) {
    [lista, pendentes] = await Promise.all([dados.listar(COLECAO), sync.pendentesDoTipo('evento')]);
    // nomes antigos de equipamento (ex.: Aplanix → Applanix) aparecem já corrigidos
    lista = lista.map((e) => (NOMES_ANTIGOS[e.equipamento] ? { ...e, equipamento: NOMES_ANTIGOS[e.equipamento] } : e))
      .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
    if (form) renderForm();
    renderListas();
  }

  async function aoMostrar() {
    await carregar();
    try {
      await dados.atualizarDoServidor('evento', COLECAO);
      await carregar({ form: false });
    } catch (e) { /* sem conexão */ }
  }

  document.addEventListener('em80:sincronizado', () => { if (raiz) carregar({ form: false }); });

  App.eventos = { _codigoDe: codigoDe, _horasDe: horasDe, _montarExcel: montarExcel };
  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'eventos', titulo: 'Eventos', icone: 'alerta', montar, aoMostrar });
})(window.App);
