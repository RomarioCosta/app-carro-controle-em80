/*
 * Módulo 2 – Registro de Eventos: falhas de equipamento e outros eventos que afetam a inspeção
 * (atraso da equipe, liberação do carro, chuva…), com o impacto em OMs perdidas e em tempo.
 * Painel com gráficos e exportação em PDF.
 */
'use strict';

(function (App) {
  const { U, ui, dados, config, sync } = App;
  const { h } = ui;
  const COLECAO = 'eventos';
  const FALHA = 'Falha de equipamento';
  const UNIDADES = { h: 'horas', d: 'dias' };

  let raiz;
  let formCartao;
  let painelEl;
  let abertosEl;
  let recentesEl;
  let lista = []; // todos os eventos do aparelho (inclusive excluídos)
  let pendentes = new Map();
  let editando = null; // evento em edição (ou null)
  let f = {}; // campos do formulário
  let periodo = U.pref.get('eventos:periodo', '30d');

  const vazio = () => ({
    categoria: FALHA, equipamento: '', outro: '', parte: '', descricao: '',
    inicio: '', fim: '', omsPerdidas: '', impactoValor: '', impactoUnidade: 'h', observacao: ''
  });

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
  const horasDe = (ev) => (ev.impactoHoras !== undefined && ev.impactoHoras !== '' ? num(ev.impactoHoras) : num(ev.impactoValor) * (ev.impactoUnidade === 'd' ? 24 : 1));
  const fmtN = (v, casas = 0) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
  const fmtHoras = (hh) => (hh >= 24 ? `${fmtN(hh, 1)} h (${fmtN(hh / 24, 1)} dia${hh / 24 >= 2 ? 's' : ''})` : `${fmtN(hh, 1)} h`);
  const textoImpacto = (ev) => {
    const partes = [];
    if (num(ev.omsPerdidas)) partes.push(`${fmtN(ev.omsPerdidas)} OM${num(ev.omsPerdidas) > 1 ? 's' : ''} perdida${num(ev.omsPerdidas) > 1 ? 's' : ''}`);
    if (num(ev.impactoValor)) partes.push(`${fmtN(ev.impactoValor, 1)} ${ev.impactoUnidade === 'd' ? (num(ev.impactoValor) === 1 ? 'dia' : 'dias') : 'h'} de impacto`);
    return partes;
  };
  const visiveis = () => lista.filter((e) => !e.excluidoEm);

  /* ---------------- Montagem ---------------- */

  function montar(el) {
    raiz = el;
    f = vazio();
    formCartao = h('section', { class: 'cartao' });
    painelEl = h('section', { class: 'cartao' });
    abertosEl = h('div', { class: 'lista' });
    recentesEl = h('div', { class: 'lista' });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Registro de Eventos' }),
        h('p', { class: 'sub', text: 'Falhas de equipamento e outros eventos que afetam a inspeção. Deixe o fim em branco enquanto o evento estiver ocorrendo.' })),
      formCartao,
      h('section', { class: 'cartao' }, h('h2', { text: 'Em aberto' }), abertosEl),
      painelEl,
      h('section', { class: 'cartao' }, h('h2', { text: 'Recentes' }), recentesEl));
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

    const numero = (campo, extra = {}) => h('input', {
      type: 'number', name: campo, min: 0, step: extra.step || 1, inputmode: extra.step ? 'decimal' : 'numeric',
      value: f[campo], placeholder: '0',
      oninput: (e) => { f[campo] = e.target.value; }
    });

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
        h('div', { class: 'grade-3' },
          ui.campo('OMs perdidas', numero('omsPerdidas')),
          ui.campo('Impacto no tempo', numero('impactoValor', { step: 0.5 })),
          ui.campo('Unidade', h('select', {
            name: 'impactoUnidade',
            value: f.impactoUnidade,
            onchange: (e) => { f.impactoUnidade = e.target.value; }
          }, Object.entries(UNIDADES).map(([v, t]) => h('option', { value: v, text: t }))))),
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
      omsPerdidas: ev.omsPerdidas === undefined || ev.omsPerdidas === null ? '' : String(ev.omsPerdidas),
      impactoValor: ev.impactoValor === undefined || ev.impactoValor === null ? '' : String(ev.impactoValor),
      impactoUnidade: ev.impactoUnidade === 'd' ? 'd' : 'h',
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
    const oms = U.numero(f.omsPerdidas);
    if (String(f.omsPerdidas).trim() !== '' && (oms === null || oms < 0 || !Number.isInteger(oms))) erros.push(['omsPerdidas', 'Informe um número inteiro (0 ou mais).']);
    const imp = U.numero(f.impactoValor);
    if (String(f.impactoValor).trim() !== '' && (imp === null || imp < 0)) erros.push(['impactoValor', 'Informe um número (0 ou mais).']);
    erros.forEach(([nome, msg]) => ui.marcarErro(form.querySelector(`[name="${nome}"]`), msg));
    if (erros.length) ui.rolarAte(form.querySelector(`[name="${erros[0][0]}"]`));
    return !erros.length;
  }

  /** Evento a partir do formulário. */
  function doForm(base, inicio, fim) {
    const falha = f.categoria === FALHA;
    const oms = String(f.omsPerdidas).trim() === '' ? '' : U.numero(f.omsPerdidas);
    const imp = String(f.impactoValor).trim() === '' ? '' : U.numero(f.impactoValor);
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
      omsPerdidas: oms,
      impactoValor: imp,
      impactoUnidade: f.impactoUnidade,
      impactoHoras: imp === '' ? '' : imp * (f.impactoUnidade === 'd' ? 24 : 1),
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
    f = { ...paraForm(ultimo), inicio: '', fim: '', omsPerdidas: '', impactoValor: '' };
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

  function renderListas() {
    const todos = visiveis();
    const abertos = todos.filter((e) => !e.fim);
    const fechados = todos.filter((e) => e.fim).slice(0, 25);
    ui.trocar(abertosEl, abertos.length ? abertos.map((e) => cartaoEvento(e, true)) : h('p', { class: 'vazio', text: 'Nenhum evento em aberto.' }));
    ui.trocar(recentesEl, fechados.length ? fechados.map((e) => cartaoEvento(e, false)) : h('p', { class: 'vazio', text: 'Nenhum evento finalizado ainda.' }));
    renderPainel();
  }

  /* ---------------- Painel: indicadores e gráficos ---------------- */

  const PERIODOS = [['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']];

  function intervalo() {
    const hoje = U.hoje();
    if (periodo === '7d') return [U.somarDias(hoje, -6), hoje];
    if (periodo === '30d') return [U.somarDias(hoje, -29), hoje];
    if (periodo === 'mes') return [U.inicioMes(hoje), hoje];
    const datas = visiveis().map((e) => String(e.inicio).slice(0, 10)).filter(U.ehData).sort();
    return [datas[0] || hoje, hoje];
  }

  function doPeriodo() {
    const [de, ate] = intervalo();
    return visiveis().filter((e) => { const d = String(e.inicio).slice(0, 10); return d >= de && d <= ate; })
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  }

  function resumo(evs) {
    const minutos = evs.reduce((s, e) => s + (U.minutosEntre(e.inicio, e.fim || U.agora()) || 0), 0);
    return {
      qtd: evs.length,
      oms: evs.reduce((s, e) => s + num(e.omsPerdidas), 0),
      horas: evs.reduce((s, e) => s + horasDe(e), 0),
      minutos
    };
  }

  /** Série por dia (até 62 dias) ou por mês: OMs perdidas (barras) e impacto em horas acumulado (linha). */
  function seriePorData(evs) {
    const [de, ate] = intervalo();
    const dias = Math.round((U.parseData(ate) - U.parseData(de)) / 86400000) + 1;
    const porMes = dias > 62;
    const chaves = [];
    if (porMes) { for (let m = U.inicioMes(de); m <= ate; m = U.somarDias(U.fimMes(m), 1)) chaves.push(m.slice(0, 7)); }
    else { for (let d = de; d <= ate; d = U.somarDias(d, 1)) chaves.push(d); }
    const mapa = new Map(chaves.map((k) => [k, { oms: 0, horas: 0, qtd: 0 }]));
    evs.forEach((e) => {
      const k = porMes ? String(e.inicio).slice(0, 7) : String(e.inicio).slice(0, 10);
      const x = mapa.get(k); if (!x) return;
      x.oms += num(e.omsPerdidas); x.horas += horasDe(e); x.qtd++;
    });
    let acumulado = 0;
    return chaves.map((k) => {
      const x = mapa.get(k);
      acumulado += x.horas;
      return {
        rotulo: porMes ? U.fmtMesAno(`${k}-01`) : U.fmtData(k).slice(0, 5),
        dica: `${porMes ? U.fmtMesAno(`${k}-01`) : `${U.diaSemanaCurto(k)} ${U.fmtData(k)}`} · ${x.qtd} evento(s) · impacto no ${porMes ? 'mês' : 'dia'}: ${fmtHoras(x.horas)}`,
        barra: x.oms,
        linha: Math.round(acumulado * 10) / 10
      };
    });
  }

  function porGrupo(evs, chave, valor) {
    const mapa = new Map();
    evs.forEach((e) => { const k = chave(e) || '—'; mapa.set(k, (mapa.get(k) || 0) + valor(e)); });
    return [...mapa.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }

  function graficos(evs) {
    const { charts } = App;
    const porTipoOms = porGrupo(evs, categoriaDe, (e) => num(e.omsPerdidas));
    const porTipoHoras = porGrupo(evs, categoriaDe, horasDe);
    const falhas = porGrupo(evs.filter(ehFalha), (e) => e.equipamento, () => 1);
    const bloco = (t, g) => h('div', { class: 'laudo-grafico' }, h('h3', { text: t }), g);
    return [
      bloco('OMs perdidas e impacto no tempo acumulado', charts.barrasLinha(seriePorData(evs), {
        nomeBarra: 'OMs perdidas', nomeLinha: 'Impacto acumulado (h)', fmtLinha: (v) => `${fmtN(v, 1)} h`
      })),
      porTipoOms.length ? bloco('OMs perdidas por tipo de evento', charts.barrasH(porTipoOms.map(([r, v]) => ({ rotulo: r, valor: v, texto: fmtN(v) })))) : null,
      porTipoHoras.length ? bloco('Impacto no tempo por tipo de evento', charts.barrasH(porTipoHoras.map(([r, v]) => ({ rotulo: r, valor: v, texto: fmtHoras(v) })), { classe: 'graf-barra-2' })) : null,
      falhas.length ? bloco('Falhas por equipamento (quantidade)', charts.barrasH(falhas.map(([r, v]) => ({ rotulo: r, valor: v, texto: String(v) })))) : null
    ];
  }

  function renderPainel() {
    if (!painelEl) return;
    const evs = doPeriodo();
    const r = resumo(evs);
    const [de, ate] = intervalo();
    const kpi = (t, v, sub) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo', text: t }), h('div', { class: 'kpi-valor', text: v }), h('div', { class: 'kpi-sub', text: sub }));
    ui.trocar(painelEl,
      h('div', { class: 'cartao-cab' },
        h('h2', { text: 'Painel de eventos' }),
        h('button', { class: 'btn btn-secundario btn-pequeno', onclick: exportarPdf, disabled: !evs.length }, ui.icone('documento'), 'Exportar PDF')),
      h('div', { class: 'ev-periodo' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Período' },
          PERIODOS.map(([v, t]) => h('button', {
            type: 'button', class: `seg-opcao${periodo === v ? ' ativo' : ''}`, 'aria-pressed': periodo === v ? 'true' : 'false',
            onclick: () => { periodo = v; U.pref.set('eventos:periodo', v); renderPainel(); }
          }, t))),
        h('span', { class: 'sub', text: `${U.fmtData(de)} a ${U.fmtData(ate)}` })),
      h('div', { class: 'kpis kpis-auto' },
        kpi('Eventos', fmtN(r.qtd), `${evs.filter(ehFalha).length} falha(s) de equipamento`),
        kpi('OMs perdidas', fmtN(r.oms), 'informadas nos eventos'),
        kpi('Impacto no tempo', fmtHoras(r.horas), 'informado nos eventos'),
        kpi('Duração dos eventos', U.fmtDuracao(r.minutos) || '0min', 'do início ao fim')),
      evs.length ? h('div', { class: 'ev-graficos' }, graficos(evs)) : h('p', { class: 'vazio', text: 'Nenhum evento no período.' }));
  }

  /* ---------------- PDF ---------------- */

  function exportarPdf() {
    const evs = doPeriodo();
    const r = resumo(evs);
    const [de, ate] = intervalo();
    const tabela = (cab, linhas) => h('table', { class: 'laudo-tabela ev-tabela' },
      h('thead', null, h('tr', null, cab.map((t) => h('th', { text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', null, l.map((c) => h('td', { text: c === null || c === undefined ? '' : String(c) }))))));
    const foto = document.querySelector('.cab-foto');
    const el = h('div', { id: 'laudo', class: 'laudo ev-pdf' },
      h('header', { class: 'laudo-cab' },
        foto ? h('img', { src: foto.src, alt: '', class: 'laudo-foto' }) : null,
        h('div', null,
          h('h1', { text: 'Relatório de Eventos – Carro Controle EM80' }),
          h('p', { text: `Período: ${U.fmtData(de)} a ${U.fmtData(ate)}` })),
        h('div', { class: 'laudo-emissao' }, h('span', { text: 'Emitido em' }), h('strong', { text: U.fmtDataHora(U.agora()) }))),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Indicadores' }),
        h('div', { class: 'laudo-kpis' },
          [['Eventos', fmtN(r.qtd), `${evs.filter(ehFalha).length} falha(s) de equipamento`],
            ['OMs perdidas', fmtN(r.oms), 'informadas nos eventos'],
            ['Impacto no tempo', fmtHoras(r.horas), 'informado nos eventos'],
            ['Duração dos eventos', U.fmtDuracao(r.minutos) || '0min', 'do início ao fim']
          ].map(([t, v, sub]) => h('div', { class: 'laudo-kpi' }, h('span', { text: t }), h('strong', { text: v }), h('small', { text: sub }))))),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Gráficos' }), graficos(evs)),
      h('section', { class: 'laudo-secao' }, h('h2', { text: 'Eventos do período' }),
        tabela(['Código', 'Tipo', 'Equipamento / descrição', 'Início', 'Fim', 'Duração', 'OMs perdidas', 'Impacto', 'Observação'],
          evs.map((e) => [codigoDe(e), categoriaDe(e), ehFalha(e) ? [e.equipamento, e.parte].filter(Boolean).join(' · ') : e.descricao,
            U.fmtDataHora(e.inicio), e.fim ? U.fmtDataHora(e.fim) : 'em aberto', U.fmtDuracao(U.minutosEntre(e.inicio, e.fim || U.agora())),
            num(e.omsPerdidas) ? fmtN(e.omsPerdidas) : '', num(e.impactoValor) ? `${fmtN(e.impactoValor, 1)} ${e.impactoUnidade === 'd' ? 'dia(s)' : 'h'}` : '',
            e.observacao || '']))),
      h('footer', { class: 'laudo-rodape', text: `Gerado pelo App Carro Controle EM80 · ${U.fmtDataHora(U.agora())}` }));
    imprimir(el, `Eventos EM80 ${U.fmtData(de).replace(/\//g, '-')} a ${U.fmtData(ate).replace(/\//g, '-')}`);
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
    lista = lista.slice().sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
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

  App.eventos = { _codigoDe: codigoDe, _horasDe: horasDe };
  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'eventos', titulo: 'Eventos', icone: 'alerta', montar, aoMostrar });
})(window.App);
