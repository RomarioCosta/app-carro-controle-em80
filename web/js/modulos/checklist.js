/* Módulo 1 – Check List de Inspeção. */
'use strict';

(function (App) {
  const { U, ui, dados, config, OM, sync } = App;
  const { h } = ui;
  const RASCUNHO = 'rascunho:checklist';
  const LINHAS_INICIAIS = 3;

  let raiz;
  let formEl;
  let listaEl;
  let progressoEl;
  let estado;

  const itens = () => config.checklist.flatMap((g) => g.itens.map((it) => ({ ...it, grupo: g.titulo })));
  const perguntasSN = () => itens().filter((i) => i.tipo === 'sn');

  function novoEstado() {
    return {
      cab: { responsavel: U.pref.get('ultimoResponsavel', ''), data: U.hoje(), ciclo: OM.cicloAtivo() || '' },
      resp: {},
      am: {}
    };
  }

  /** Garante a estrutura mínima (útil quando o checklist ganha perguntas novas). */
  function normalizar(e) {
    const st = e && typeof e === 'object' ? e : novoEstado();
    st.cab = st.cab || {};
    st.resp = st.resp || {};
    st.am = st.am || {};
    itens().forEach((it) => {
      if (it.tipo !== 'sn' && !Array.isArray(st.am[it.id])) {
        st.am[it.id] = Array.from({ length: LINHAS_INICIAIS }, () => ({ v: '', v2: '' }));
      }
    });
    return st;
  }

  const salvarRascunho = U.debounce(() => U.pref.set(RASCUNHO, estado), 400);
  function alterou() {
    salvarRascunho();
    atualizarProgresso();
  }

  /* ---------------- Renderização ---------------- */

  function montar(el) {
    raiz = el;
    estado = normalizar(U.pref.get(RASCUNHO, null));
    const temRespostas = Object.keys(estado.resp).length
      || Object.values(estado.am).some((l) => l.some((x) => String(x.v || x.v2 || '').trim()));
    if (!temRespostas) estado.cab.data = U.hoje(); // rascunho vazio de outro dia
    formEl = h('form', { class: 'pilha', novalidate: true, onsubmit: (e) => { e.preventDefault(); salvar(); } });
    listaEl = h('div', { class: 'lista' });
    const parteChecklist = h('div', { class: 'tela' },
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Check List de Inspeção' }),
        h('p', { class: 'sub', text: 'Responda Sim ou Não. Quando houver problema, descreva o que houve.' })),
      formEl,
      h('section', { class: 'cartao' }, h('h2', { text: 'Checklists recentes' }), listaEl));
    const parteAnalise = h('div', { class: 'tela tela-larga', hidden: true });
    let analiseMontada = false;

    // Duas abas: o checklist e a análise do arquivo gerado pelo carro.
    const abas = h('div', { class: 'seg seg-abas', role: 'tablist', 'aria-label': 'Checklist ou análise' });
    const mostrar = (qual) => {
      U.pref.set('checklist:aba', qual);
      parteChecklist.hidden = qual !== 'checklist';
      parteAnalise.hidden = qual !== 'analise';
      if (qual === 'analise' && !analiseMontada) {
        App.analise.montar(parteAnalise);
        analiseMontada = true;
      }
      abas.querySelectorAll('button').forEach((b) => {
        const ativo = b.dataset.aba === qual;
        b.classList.toggle('ativo', ativo);
        b.setAttribute('aria-selected', ativo ? 'true' : 'false');
      });
    };
    [['checklist', 'Checklist'], ['analise', 'Análise do arquivo']].forEach(([id, rotulo]) => {
      abas.appendChild(h('button', { type: 'button', role: 'tab', class: 'seg-opcao', dataset: { aba: id }, onclick: () => mostrar(id) }, rotulo));
    });

    raiz.append(abas, parteChecklist, parteAnalise);
    renderForm();
    mostrar(U.pref.get('checklist:aba', 'checklist') === 'analise' ? 'analise' : 'checklist');
  }

  function renderForm() {
    ui.limpar(formEl);
    const c = estado.cab;
    const entrada = (campo, attrs) => h('input', {
      ...attrs,
      value: c[campo] || '',
      oninput: (e) => { c[campo] = e.target.value; alterou(); }
    });

    formEl.append(
      h('section', { class: 'cartao' },
        h('h2', { text: 'Identificação' }),
        h('div', { class: 'grade-3' },
          ui.campo('Responsável', entrada('responsavel', { type: 'text', name: 'responsavel', autocomplete: 'name', maxlength: 80 }), { obrigatorio: true }),
          ui.campo('Data', entrada('data', { type: 'date', name: 'data' }), { obrigatorio: true }),
          ui.campo('Ciclo', entrada('ciclo', { type: 'text', name: 'ciclo', inputmode: 'numeric', maxlength: 4, placeholder: 'Ex.: 5' }), { obrigatorio: true })))
    );

    config.checklist.forEach((g) => {
      formEl.append(h('section', { class: 'cartao' },
        h('h2', { text: g.titulo }),
        g.itens.map((it) => renderItem({ ...it, grupo: g.titulo }))));
    });

    progressoEl = h('span', { class: 'progresso' });
    formEl.append(h('div', { class: 'barra-acoes barra-fixa' },
      progressoEl,
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: limparForm }, 'Limpar'),
      h('button', { type: 'submit', class: 'btn btn-primario' }, ui.icone('check'), 'Salvar checklist')));
    atualizarProgresso();
  }

  function renderItem(it) {
    return it.tipo === 'sn' ? renderSN(it) : renderAmostras(it);
  }

  function renderSN(it) {
    const r = estado.resp[it.id] || { r: '', d: '' };
    const temProblema = r.r && r.r === it.problemaEm;
    const opcao = (valor) => h('button', {
      type: 'button',
      class: `seg-opcao${r.r === valor ? ' ativo' : ''}${r.r === valor && valor === it.problemaEm ? ' problema' : ''}`,
      'aria-pressed': r.r === valor ? 'true' : 'false',
      onclick: () => {
        estado.resp[it.id] = { r: valor, d: (estado.resp[it.id] || {}).d || '' };
        alterou();
        const novo = renderSN(it);
        no.replaceWith(novo);
        if (valor === it.problemaEm) {
          const ta = novo.querySelector('textarea');
          if (ta && !ta.value) ta.focus();
        }
      }
    }, valor);

    const no = h('div', { class: 'pergunta', dataset: { id: it.id } },
      h('p', { class: 'pergunta-texto', text: it.texto }),
      h('div', { class: 'seg', role: 'group', 'aria-label': it.texto }, opcao('Sim'), opcao('Não')),
      temProblema ? ui.campo('Descreva o que houve', h('textarea', {
        rows: 3,
        maxlength: 2000,
        value: r.d || '',
        oninput: (e) => { estado.resp[it.id].d = e.target.value; alterou(); }
      }), { obrigatorio: true, classe: 'descricao' }) : null);
    return no;
  }

  function renderAmostras(it) {
    const pares = it.tipo === 'pares';
    const linhas = estado.am[it.id];
    const lista = h('div', { class: 'amostras' });

    const redesenhar = () => {
      ui.limpar(lista);
      linhas.forEach((ln, i) => {
        const num = (campo, rotulo) => h('input', {
          type: 'text',
          inputmode: 'decimal',
          class: 'num',
          placeholder: rotulo,
          'aria-label': `${rotulo} – amostra ${i + 1}`,
          value: ln[campo] || '',
          oninput: (e) => { ln[campo] = e.target.value; alterou(); }
        });
        lista.append(h('div', { class: 'amostra' },
          h('span', { class: 'amostra-num', text: `Amostra ${U.pad(i + 1)}` }),
          pares ? num('v', it.rotulos[0]) : num('v', 'Valor'),
          pares ? num('v2', it.rotulos[1]) : null,
          h('button', {
            type: 'button',
            class: 'btn-icone',
            'aria-label': `Remover amostra ${i + 1}`,
            disabled: linhas.length <= 1,
            onclick: () => { linhas.splice(i, 1); alterou(); redesenhar(); }
          }, ui.icone('lixo'))));
      });
    };
    redesenhar();

    return h('div', { class: 'pergunta', dataset: { id: it.id } },
      h('p', { class: 'pergunta-texto', text: it.texto }),
      lista,
      h('button', {
        type: 'button',
        class: 'btn btn-fantasma',
        onclick: () => {
          linhas.push({ v: '', v2: '' });
          alterou();
          redesenhar();
          const inputs = lista.querySelectorAll('input');
          inputs[inputs.length - (pares ? 2 : 1)].focus();
        }
      }, ui.icone('plus'), 'Adicionar amostra'));
  }

  function atualizarProgresso() {
    if (!progressoEl) return;
    const total = perguntasSN().length;
    const feitas = perguntasSN().filter((p) => estado.resp[p.id] && estado.resp[p.id].r).length;
    progressoEl.textContent = `${feitas} de ${total} respondidas`;
  }

  /* ---------------- Salvar ---------------- */

  function validar() {
    ui.limparErros(formEl);
    const erros = [];
    const c = estado.cab;
    const campoCab = (nome) => formEl.querySelector(`[name="${nome}"]`);
    if (!String(c.responsavel || '').trim()) erros.push([campoCab('responsavel'), 'Informe o responsável.']);
    if (!U.parseData(c.data)) erros.push([campoCab('data'), 'Informe a data.']);
    if (!/^\d{1,4}$/.test(String(c.ciclo || '').trim())) erros.push([campoCab('ciclo'), 'Informe o número do ciclo.']);

    itens().forEach((it) => {
      const no = formEl.querySelector(`.pergunta[data-id="${it.id}"]`);
      if (it.tipo === 'sn') {
        const r = estado.resp[it.id];
        if (!r || !r.r) erros.push([no, 'Responda Sim ou Não.']);
        else if (r.r === it.problemaEm && !String(r.d || '').trim()) erros.push([no.querySelector('textarea') || no, 'Descreva o que houve.']);
      } else {
        const invalida = estado.am[it.id].some((ln) => [ln.v, ln.v2].some((v) => String(v || '').trim() && U.numero(v) === null));
        if (invalida) erros.push([no, 'Use apenas números nas amostras (ex.: 1,5 ou -0,8).']);
      }
    });
    erros.forEach(([el, msg]) => el && ui.marcarErro(el, msg));
    return erros;
  }

  async function salvar() {
    const erros = validar();
    if (erros.length) {
      ui.toast(`${erros.length} item(ns) precisam de atenção.`, 'erro');
      ui.rolarAte(erros[0][0]);
      return;
    }
    const c = estado.cab;
    const respostas = perguntasSN().map((p) => {
      const r = estado.resp[p.id];
      const problema = r.r === p.problemaEm;
      return {
        grupo: p.grupo,
        perguntaId: p.id,
        pergunta: p.texto,
        resposta: r.r,
        problema: problema ? 'Sim' : 'Não',
        descricao: problema ? r.d.trim() : ''
      };
    });
    const amostras = [];
    itens().filter((it) => it.tipo !== 'sn').forEach((it) => {
      let n = 0;
      estado.am[it.id].forEach((ln) => {
        const v = U.numero(ln.v);
        const v2 = it.tipo === 'pares' ? U.numero(ln.v2) : null;
        if (v === null && v2 === null) return;
        n++;
        amostras.push({
          grupo: it.grupo,
          medicaoId: it.id,
          medicao: it.tipo === 'pares' ? `${it.texto} – ${it.rotulos[0]}` : it.texto,
          amostra: n,
          valor: v === null ? '' : v,
          rotulo2: it.tipo === 'pares' ? it.rotulos[1] : '',
          valor2: v2 === null ? '' : v2
        });
      });
    });

    const registro = {
      id: U.uuid(),
      data: c.data,
      ciclo: String(c.ciclo).trim(),
      responsavel: c.responsavel.trim(),
      qtdProblemas: respostas.filter((r) => r.problema === 'Sim').length,
      respostas,
      amostras
    };
    try {
      await dados.salvar('checklist', 'checklists', registro);
    } catch (e) {
      ui.toast(`Não foi possível salvar: ${e.message}`, 'erro', 6000);
      return;
    }
    U.pref.set('ultimoResponsavel', registro.responsavel);
    U.pref.del(RASCUNHO);
    estado = normalizar(null);
    estado.cab.ciclo = registro.ciclo;
    renderForm();
    ui.toast('Checklist salvo.', 'ok');
    raiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderLista();
  }

  async function limparForm() {
    const ok = await ui.confirmar('Limpar checklist', 'Apagar as respostas preenchidas até agora?', { ok: 'Limpar', perigo: true });
    if (!ok) return;
    U.pref.del(RASCUNHO);
    estado = normalizar(null);
    renderForm();
  }

  /* ---------------- Lista ---------------- */

  async function renderLista() {
    const [lista, pendentes] = await Promise.all([dados.listar('checklists'), sync.pendentesDoTipo('checklist')]);
    if (!lista.length) {
      ui.trocar(listaEl, h('p', { class: 'vazio', text: 'Nenhum checklist salvo ainda.' }));
      return;
    }
    ui.trocar(listaEl, lista.slice(0, 15).map((c) => h('div', { class: 'item' },
      h('div', { class: 'item-principal' },
        h('strong', { text: `${U.fmtData(c.data)} · Ciclo ${c.ciclo}` }),
        h('span', { class: 'item-sub', text: c.responsavel })),
      h('div', { class: 'item-lado' },
        Number(c.qtdProblemas) > 0
          ? h('span', { class: 'etiqueta etiqueta-alerta', text: `${c.qtdProblemas} problema(s)` })
          : h('span', { class: 'etiqueta etiqueta-ok', text: 'Sem problemas' }),
        pendentes.has(c.id) ? h('span', { class: 'etiqueta etiqueta-pendente', text: 'Não enviado' }) : null))));
  }

  async function aoMostrar() {
    if (!estado.cab.ciclo && OM.cicloAtivo()) {
      estado.cab.ciclo = OM.cicloAtivo();
      const campoCiclo = formEl.querySelector('[name="ciclo"]');
      if (campoCiclo && !campoCiclo.value) campoCiclo.value = estado.cab.ciclo;
    }
    await renderLista();
    try {
      await dados.atualizarDoServidor('checklist', 'checklists');
      await renderLista();
    } catch (e) { /* sem conexão: mantém a lista local */ }
  }

  document.addEventListener('em80:sincronizado', () => { if (listaEl) renderLista(); });

  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'checklist', titulo: 'Checklist', icone: 'checklist', montar, aoMostrar });
})(window.App);
