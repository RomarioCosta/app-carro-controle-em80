/* Módulo 2 – Registro de Eventos (falhas durante a inspeção). */
'use strict';

(function (App) {
  const { U, ui, dados, config, sync } = App;
  const { h } = ui;
  const COLECAO = 'eventos';

  let raiz;
  let formCartao;
  let abertosEl;
  let recentesEl;
  let lista = [];
  let pendentes = new Map();
  let editando = null; // evento em edição (ou null)
  let f = {}; // campos do formulário

  const vazio = () => ({ equipamento: '', outro: '', parte: '', inicio: '', fim: '', observacao: '' });

  function montar(el) {
    raiz = el;
    f = vazio();
    formCartao = h('section', { class: 'cartao' });
    abertosEl = h('div', { class: 'lista' });
    recentesEl = h('div', { class: 'lista' });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Registro de Eventos' }),
        h('p', { class: 'sub', text: 'Falhas durante a inspeção. Deixe o fim em branco enquanto a falha estiver ocorrendo.' })),
      formCartao,
      h('section', { class: 'cartao' }, h('h2', { text: 'Em aberto' }), abertosEl),
      h('section', { class: 'cartao' }, h('h2', { text: 'Recentes' }), recentesEl));
    renderForm();
    setInterval(() => {
      if (raiz.offsetParent !== null) renderListas();
    }, 30000);
  }

  /* ---------------- Formulário ---------------- */

  function renderForm() {
    const ehOutro = f.equipamento === 'Outro';
    const historico = lista.filter((e) => !f.equipamento || nomeEquip(f) === e.equipamento);
    const sugestoesParte = U.maisFrequentes(lista.map((e) => e.parte), 15);
    const sugestoesObs = U.maisFrequentes(historico.map((e) => e.observacao), 5);

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

    const obs = h('textarea', {
      name: 'observacao',
      rows: 3,
      maxlength: 2000,
      value: f.observacao,
      placeholder: 'Impacto da falha na inspeção',
      oninput: (e) => { f.observacao = e.target.value; }
    });

    const listaParte = h('datalist', { id: 'dl-partes' }, sugestoesParte.map((p) => h('option', { value: p })));

    ui.trocar(formCartao,
      h('h2', { text: editando ? 'Editar evento' : 'Novo evento' }),
      h('form', { class: 'pilha', novalidate: true, onsubmit: (e) => { e.preventDefault(); salvar(); } },
        h('div', { class: 'grade-2' },
          ui.campo('Equipamento', sel, { obrigatorio: true }),
          ehOutro ? ui.campo('Qual equipamento?', h('input', {
            type: 'text', name: 'outro', maxlength: 80, value: f.outro,
            oninput: (e) => { f.outro = e.target.value; }
          }), { obrigatorio: true }) : null,
          ui.campo('Parte do equipamento', h('input', {
            type: 'text', name: 'parte', maxlength: 120, list: 'dl-partes', value: f.parte,
            oninput: (e) => { f.parte = e.target.value; }
          }))),
        listaParte,
        h('div', { class: 'grade-2' },
          dataHora('inicio', 'Início'),
          dataHora('fim', 'Fim')),
        ui.campo('Observação / impacto', obs),
        sugestoesObs.length ? h('div', { class: 'chips', 'aria-label': 'Observações frequentes' },
          sugestoesObs.map((t) => h('button', {
            type: 'button',
            class: 'chip',
            title: t,
            onclick: () => {
              f.observacao = f.observacao.trim() ? `${f.observacao.trim()}; ${t}` : t;
              obs.value = f.observacao;
            }
          }, t.length > 40 ? `${t.slice(0, 40)}…` : t))) : null,
        h('div', { class: 'barra-acoes' },
          editando
            ? h('button', { type: 'button', class: 'btn btn-secundario', onclick: cancelarEdicao }, 'Cancelar edição')
            : [
              h('button', { type: 'button', class: 'btn btn-secundario', onclick: duplicarUltimo, disabled: !lista.length }, ui.icone('duplicar'), 'Duplicar último'),
              h('button', { type: 'button', class: 'btn btn-secundario', onclick: iniciarAgora }, ui.icone('play'), 'Iniciar agora')
            ],
          h('button', { type: 'submit', class: 'btn btn-primario' }, ui.icone('check'), editando ? 'Salvar alterações' : 'Salvar evento'))));
  }

  const nomeEquip = (x) => (x.equipamento === 'Outro' ? String(x.outro || '').trim() : x.equipamento);

  function paraForm(ev) {
    const conhecido = config.equipamentos.includes(ev.equipamento) && ev.equipamento !== 'Outro';
    return {
      equipamento: conhecido ? ev.equipamento : 'Outro',
      outro: conhecido ? '' : ev.equipamento,
      parte: ev.parte || '',
      inicio: ev.inicio || '',
      fim: ev.fim || '',
      observacao: ev.observacao || ''
    };
  }

  function validar(exigirInicio) {
    const form = formCartao.querySelector('form');
    ui.limparErros(form);
    const erros = [];
    if (!f.equipamento) erros.push(['equipamento', 'Selecione o equipamento.']);
    else if (f.equipamento === 'Outro' && !f.outro.trim()) erros.push(['outro', 'Informe o equipamento.']);
    if (exigirInicio && !f.inicio) erros.push(['inicio', 'Informe o início (ou toque em "Agora").']);
    if (f.inicio && f.fim && f.fim < f.inicio) erros.push(['fim', 'O fim não pode ser antes do início.']);
    erros.forEach(([nome, msg]) => ui.marcarErro(form.querySelector(`[name="${nome}"]`), msg));
    if (erros.length) ui.rolarAte(form.querySelector(`[name="${erros[0][0]}"]`));
    return !erros.length;
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
    const ev = {
      ...(editando || {}),
      id: editando ? editando.id : U.uuid(),
      equipamento: nomeEquip(f),
      parte: f.parte.trim(),
      inicio: f.inicio,
      fim: f.fim,
      observacao: f.observacao.trim()
    };
    if (await gravar(ev, editando ? 'Evento atualizado.' : (ev.fim ? 'Evento salvo.' : 'Evento salvo (em aberto).'))) {
      editando = null;
      f = vazio();
      await carregar();
    }
  }

  async function iniciarAgora() {
    if (!validar(false)) return;
    const ev = {
      id: U.uuid(),
      equipamento: nomeEquip(f),
      parte: f.parte.trim(),
      inicio: U.agora(),
      fim: '',
      observacao: f.observacao.trim()
    };
    if (await gravar(ev, `Falha iniciada às ${U.fmtHora(ev.inicio)}.`)) {
      f = vazio();
      await carregar();
    }
  }

  function duplicarUltimo() {
    const ultimo = lista[0];
    if (!ultimo) return;
    f = { ...paraForm(ultimo), inicio: '', fim: '' };
    renderForm();
    ui.toast('Dados do último evento copiados. Ajuste os horários.', 'info');
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
    if (await gravar({ ...ev, fim: fim < ev.inicio ? ev.inicio : fim }, 'Evento finalizado.')) await carregar();
  }

  /* ---------------- Listas ---------------- */

  function cartaoEvento(ev, aberto) {
    const dur = U.minutosEntre(ev.inicio, aberto ? U.agora() : ev.fim);
    return h('div', { class: `item${aberto ? ' item-aberto' : ''}` },
      h('div', { class: 'item-principal' },
        h('strong', { text: [ev.equipamento, ev.parte].filter(Boolean).join(' · ') }),
        h('span', { class: 'item-sub', text: aberto
          ? `Desde ${U.fmtDataHora(ev.inicio)} · há ${U.fmtDuracao(dur)}`
          : `${U.fmtDataHora(ev.inicio)} → ${ev.fim ? U.fmtHora(ev.fim) : '—'} · ${U.fmtDuracao(dur)}` }),
        ev.observacao ? h('span', { class: 'item-obs', text: ev.observacao }) : null),
      h('div', { class: 'item-lado' },
        pendentes.has(ev.id) ? h('span', { class: 'etiqueta etiqueta-pendente', text: 'Não enviado' }) : null,
        aberto ? h('button', { class: 'btn btn-primario btn-pequeno', onclick: () => finalizarAgora(ev) }, ui.icone('parar'), 'Finalizar agora') : null,
        h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => editar(ev) }, ui.icone('editar'), 'Editar')));
  }

  function renderListas() {
    const abertos = lista.filter((e) => !e.fim);
    const fechados = lista.filter((e) => e.fim).slice(0, 25);
    ui.trocar(abertosEl, abertos.length ? abertos.map((e) => cartaoEvento(e, true)) : h('p', { class: 'vazio', text: 'Nenhuma falha em aberto.' }));
    ui.trocar(recentesEl, fechados.length ? fechados.map((e) => cartaoEvento(e, false)) : h('p', { class: 'vazio', text: 'Nenhum evento finalizado ainda.' }));
  }

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

  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'eventos', titulo: 'Eventos', icone: 'alerta', montar, aoMostrar });
})(window.App);
