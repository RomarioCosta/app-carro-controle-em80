/*
 * Módulo Rota do carro controle.
 * Programação: desenha a rota dia a dia sobre a malha (EH/RH por linha), com pontos de atenção
 * (interdições, serviços, conflitos), observações e garageamento.
 * Execução: marca por onde o carro realmente passou e compara com o programado.
 * PDF para enviar às equipes. Tudo funciona sem internet e sincroniza com a planilha.
 */
'use strict';

(function (App) {
  const { U, ui, store, sync, api, malha: M, esquema } = App;
  const { h } = ui;
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const CHAVE_PLANTA = 'planta:base';

  const CORES_DIA = ['#1f6feb', '#e8590c', '#2b8a3e', '#9c36b5', '#0c8599', '#f08c00', '#364fc7', '#a61e4d', '#5c940d', '#495057'];
  const GRAVIDADES = {
    'Interdição': '#d62828',
    'Atenção': '#7b2d8e',
    'Informação': '#1f6feb'
  };
  const TIPOS_PONTO = ['Plano 24h', 'Subst. TR', 'Subst. Dorm.', 'Subst. Jacaré', 'Subst. JIC', 'Man. AMV', 'Soc. Mec.', 'Desc. Dorm.',
    'EE (manutenção)', 'Linha alta', 'Corte de árvores', 'Rec. TR', 'Infra', 'Trem garageado', 'Conflito de circulação', 'Outro'];
  const COR_EXEC = '#12b886';

  let raiz;
  let corpo;
  let malha = null;
  let planta = null;
  let ciclo = U.pref.get('rota:ciclo', '');
  let dados = null; // { ciclo, dias: [], pontos: [] }
  let modo = U.pref.get('rota:modo', 'programacao');
  let diaSel = U.pref.get('rota:dia', '');
  let ramalSel = U.pref.get('rota:ramal', '');
  let ferramenta = 'trecho'; // trecho | intervalo | ponto
  let inicioIntervalo = null;
  let ciclosServidor = [];

  /* ---------------- Dados ---------------- */

  const chaveCiclo = (c) => `rota:ciclo:${c}`;
  const vivos = (lista) => (lista || []).filter((x) => !x.excluido);
  const diasOrdenados = () => vivos(dados && dados.dias).sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.data).localeCompare(String(b.data)));
  const diaAtual = () => diasOrdenados().find((d) => d.id === diaSel) || null;
  const pontosDo = (dia) => vivos(dados && dados.pontos).filter((p) => p.diaId === dia.id);

  async function carregarLocal() {
    try { planta = await store.get(CHAVE_PLANTA); } catch (e) { planta = null; }
    malha = planta && planta.elementos ? M.montar(planta) : null;
    if (malha && (!ramalSel || !malha.ramais.some((r) => r.ramal === ramalSel))) ramalSel = malha.ramais[0] ? malha.ramais[0].ramal : '';
    dados = ciclo ? (await store.get(chaveCiclo(ciclo))) || { ciclo, dias: [], pontos: [] } : null;
  }

  async function ciclosLocais() {
    const lista = (await store.get('rota:ciclos')) || [];
    const todos = new Set([...lista, ...ciclosServidor.map((c) => c.ciclo)]);
    if (ciclo) todos.add(ciclo);
    return [...todos].sort();
  }

  async function guardarCiclo(c) {
    const lista = (await store.get('rota:ciclos')) || [];
    if (!lista.includes(c)) { lista.push(c); await store.set('rota:ciclos', lista); }
  }

  async function atualizarServidor({ avisar = false } = {}) {
    if (!api.configurado()) return;
    try {
      const lista = await api.chamar('getRota', {});
      ciclosServidor = (lista && lista.ciclos) || [];
      if (!ciclo && ciclosServidor.length) { ciclo = ciclosServidor[ciclosServidor.length - 1].ciclo; U.pref.set('rota:ciclo', ciclo); }
      if (ciclo) {
        const resp = await api.chamar('getRota', { ciclo });
        const pendDias = await sync.pendentesDoTipo('rotaDia');
        const pendPontos = await sync.pendentesDoTipo('rotaPonto');
        await store.atualizar(chaveCiclo(ciclo), (local) => {
          const mesclar = (servidor, pend, locais) => {
            const mapa = new Map(servidor.map((x) => [x.id, x]));
            (locais || []).forEach((x) => { const s = mapa.get(x.id); if (!s || String(s.atualizadoEm || '') < String(x.atualizadoEm || '')) mapa.set(x.id, x); });
            pend.forEach((x) => { if (String(x.ciclo) === ciclo) mapa.set(x.id, x); });
            return [...mapa.values()];
          };
          dados = {
            ciclo,
            dias: mesclar((resp.dias || []).map(normalizarDia), pendDias, local && local.dias),
            pontos: mesclar(resp.pontos || [], pendPontos, local && local.pontos)
          };
          return dados;
        });
      }
      renderTudo();
      if (avisar) ui.toast('Rota atualizada.', 'ok');
    } catch (e) {
      if (avisar) ui.toast(`Não foi possível atualizar: ${e.message}`, 'erro', 5000);
    }
  }

  function normalizarDia(d) {
    return {
      ...d,
      ordem: Number(d.ordem) || 0,
      programados: Array.isArray(d.programados) ? d.programados : String(d.programados || '').split(',').filter(Boolean),
      executados: Array.isArray(d.executados) ? d.executados : String(d.executados || '').split(',').filter(Boolean),
      excluido: d.excluido === true || d.excluido === 'Sim'
    };
  }

  async function salvarDia(dia, { render = true } = {}) {
    dia.atualizadoEm = U.agora();
    if (malha) {
      dia.kmProgramado = Math.round(M.extensao(malha, dia.programados)) / 1000;
      dia.kmExecutado = Math.round(M.extensao(malha, dia.executados)) / 1000;
      dia.resumo = M.resumo(malha, dia.programados);
    }
    await store.atualizar(chaveCiclo(ciclo), (local) => {
      const d = local || { ciclo, dias: [], pontos: [] };
      const i = d.dias.findIndex((x) => x.id === dia.id);
      if (i >= 0) d.dias[i] = dia; else d.dias.push(dia);
      dados = d;
      return d;
    });
    await sync.enfileirar('rotaDia', dia.id, dia);
    if (render) renderConteudo();
  }

  async function salvarPonto(p) {
    p.atualizadoEm = U.agora();
    await store.atualizar(chaveCiclo(ciclo), (local) => {
      const d = local || { ciclo, dias: [], pontos: [] };
      const i = d.pontos.findIndex((x) => x.id === p.id);
      if (i >= 0) d.pontos[i] = p; else d.pontos.push(p);
      dados = d;
      return d;
    });
    await sync.enfileirar('rotaPonto', p.id, p);
    renderConteudo();
  }

  /* ---------------- Montagem ---------------- */

  function montar(el) {
    raiz = el;
    raiz.classList.add('tela-larga'); // usa a área maior no computador
    corpo = h('div', { class: 'pilha' });
    raiz.append(
      h('div', { class: 'tela-cab' },
        h('h1', { text: 'Rota do carro controle' }),
        h('p', { class: 'sub', text: 'Programe a rota dia a dia, com interdições e pontos de atenção, e marque na execução por onde o carro passou.' })),
      corpo);
  }

  async function aoMostrar() {
    await carregarLocal();
    if (dados && !diaAtual() && diaSel !== 'geral') diaSel = diasOrdenados()[0] ? diasOrdenados()[0].id : 'geral';
    renderTudo();
    atualizarServidor();
  }

  /* ---------------- Tela ---------------- */

  let topoEl; let modoEl; let diasEl; let conteudoEl;

  function renderTudo() {
    topoEl = h('section', { class: 'cartao' });
    modoEl = h('div');
    diasEl = h('div');
    conteudoEl = h('div', { class: 'pilha' });
    ui.trocar(corpo, topoEl, malha ? null : cartaoPlanta(), modoEl, diasEl, conteudoEl);
    renderTopo();
    if (!ciclo || !dados) {
      ui.trocar(conteudoEl, h('section', { class: 'cartao vazio-grande' },
        h('p', { text: 'Nenhuma rota criada ainda.' }),
        h('p', { class: 'sub', text: 'Crie a rota do ciclo de inspeção e monte cada dia sobre o esquema da linha.' }),
        h('button', { class: 'btn btn-primario', onclick: novaRota }, ui.icone('mais'), 'Nova rota')));
      ui.limpar(modoEl); ui.limpar(diasEl);
      return;
    }
    renderModo();
    renderDias();
    renderConteudo();
  }

  async function renderTopo() {
    const ciclos = await ciclosLocais();
    const sel = h('select', {
      'aria-label': 'Rota (ciclo)',
      value: ciclo,
      onchange: async (e) => {
        ciclo = e.target.value; U.pref.set('rota:ciclo', ciclo);
        diaSel = '';
        await carregarLocal();
        diaSel = diasOrdenados()[0] ? diasOrdenados()[0].id : 'geral';
        renderTudo();
        atualizarServidor();
      }
    }, ciclos.length ? ciclos.map((c) => h('option', { value: c, text: `Rota · ciclo ${c}` })) : h('option', { value: '', text: 'Nenhuma rota' }));
    ui.trocar(topoEl, h('div', { class: 'barra-topo' },
      h('div', { class: 'linha-campo' }, sel,
        h('button', { class: 'btn-icone', 'aria-label': 'Atualizar do servidor', title: 'Atualizar', onclick: () => atualizarServidor({ avisar: true }) }, ui.icone('sync')),
        h('button', { class: 'btn btn-secundario', onclick: novaRota }, ui.icone('mais'), 'Nova rota')),
      dados && diasOrdenados().length ? h('div', { class: 'linha-campo' },
        h('button', { class: 'btn btn-primario', onclick: abrirPdf }, ui.icone('documento'), modo === 'execucao' ? 'PDF da execução' : 'PDF da rota')) : null));
  }

  function novaRota() {
    const input = h('input', { type: 'text', maxlength: 20, placeholder: 'Ex.: 3 ou 3-2026', value: '' });
    ui.modal({
      titulo: 'Nova rota',
      conteudo: h('div', { class: 'pilha' },
        h('p', { class: 'sub', text: 'Uma rota por ciclo de inspeção. Depois, crie os dias (1º dia, 2º dia…) e desenhe cada um.' }),
        ui.campo('Ciclo', input, { obrigatorio: true })),
      acoes: [
        { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Criar',
          classe: 'btn-primario',
          onClick: async (fechar) => {
            const c = input.value.trim();
            if (!/^[\wº°\-./ ]{1,20}$/.test(c)) return ui.marcarErro(input, 'Informe o ciclo (letras, números, - . /).');
            ciclo = c; U.pref.set('rota:ciclo', c);
            await guardarCiclo(c);
            await carregarLocal();
            fechar();
            if (!diasOrdenados().length) await novoDia();
            renderTudo();
          }
        }
      ]
    });
  }

  function renderModo() {
    const botao = (id, rotulo, icone) => h('button', {
      class: `seg-opcao${modo === id ? ' ativo' : ''}`,
      'aria-pressed': modo === id ? 'true' : 'false',
      onclick: () => {
        if (modo === id) return;
        modo = id; U.pref.set('rota:modo', id);
        inicioIntervalo = null;
        renderTopo(); renderModo(); renderDias(); renderConteudo();
      }
    }, ui.icone(icone), rotulo);
    ui.trocar(modoEl, h('div', { class: 'seg seg-abas seg-modo', role: 'group', 'aria-label': 'Painel' },
      botao('programacao', 'Programação', 'calendario'),
      botao('execucao', 'Execução', 'check')));
  }

  function renderDias() {
    const dias = diasOrdenados();
    const chip = (id, conteudo, cor, extra = {}) => h('button', {
      class: `dia-chip${diaSel === id ? ' ativo' : ''}`,
      style: cor ? { '--cor-dia': cor } : null,
      'aria-pressed': diaSel === id ? 'true' : 'false',
      onclick: () => { diaSel = id; U.pref.set('rota:dia', id); inicioIntervalo = null; renderDias(); renderConteudo(); },
      ...extra
    }, conteudo);
    ui.trocar(diasEl, h('div', { class: 'dias-rota', role: 'group', 'aria-label': 'Dias da rota' },
      chip('geral', [h('strong', { text: 'Visão geral' }), h('span', { text: `${dias.length} dia(s)` })], null),
      dias.map((d) => chip(d.id, [
        h('strong', { text: `${d.ordem}º dia` }),
        h('span', { text: `${d.data ? `${U.diaSemanaCurto(d.data)} ${U.fmtData(d.data).slice(0, 5)}` : 'sem data'}${d.sentido ? ` ${d.sentido === 'Descendo' ? '↓' : '↑'}` : ''}` }),
        modo === 'execucao' && d.programados.length ? h('span', { class: 'dia-chip-pct', text: `${pctAderencia(d)}%` }) : null
      ], d.cor)),
      modo === 'programacao' ? h('button', { class: 'dia-chip dia-novo', onclick: () => novoDia() }, ui.icone('mais'), 'Novo dia') : null));
  }

  async function novoDia() {
    const dias = diasOrdenados();
    const ult = dias[dias.length - 1];
    const ordem = (ult ? Number(ult.ordem) || dias.length : 0) + 1;
    const dia = {
      id: U.uuid(),
      ciclo,
      ordem,
      data: ult && ult.data ? U.somarDias(ult.data, 1) : U.hoje(),
      titulo: '',
      sentido: ult && ult.sentido === 'Subindo' ? 'Descendo' : 'Subindo',
      cor: CORES_DIA[(ordem - 1) % CORES_DIA.length],
      observacao: '',
      garageamento: '',
      programados: [],
      executados: [],
      obsExecucao: '',
      excluido: false,
      criadoEm: U.agora()
    };
    await guardarCiclo(ciclo);
    await salvarDia(dia, { render: false });
    diaSel = dia.id; U.pref.set('rota:dia', dia.id);
    if (corpo.isConnected) { renderDias(); renderConteudo(); }
  }

  const pctAderencia = (d) => {
    if (!malha || !d.programados.length) return 0;
    const prog = new Set(d.programados);
    const feito = M.extensao(malha, d.executados.filter((t) => prog.has(t)));
    const total = M.extensao(malha, d.programados);
    return total ? Math.round((feito / total) * 100) : 0;
  };

  function renderConteudo() {
    if (!conteudoEl) return;
    if (!malha) return ui.trocar(conteudoEl, h('p', { class: 'aviso', text: 'Importe a planta da linha (acima) para desenhar a rota sobre o esquema da ferrovia.' }));
    if (diaSel === 'geral' || !diaAtual()) return ui.trocar(conteudoEl, visaoGeral());
    const dia = diaAtual();
    if (modo === 'execucao') return ui.trocar(conteudoEl, telaExecucao(dia));
    return ui.trocar(conteudoEl, telaProgramacao(dia));
  }

  /* ---------------- Planta (base da malha) ---------------- */

  function cartaoPlanta() {
    const input = h('input', { type: 'file', accept: '.xls,.xlsx', onchange: (e) => { const f = e.target.files[0]; if (f) importarPlanta(f); } });
    return h('section', { class: 'cartao' },
      h('h2', { text: 'Planta da linha' }),
      h('p', { class: 'sub', text: 'A rota é desenhada sobre a planta da linha (EH, RH e linhas de cada ramal). Importe a planilha "Planta da linha" uma vez neste aparelho: ela fica guardada aqui e é a mesma usada na análise do arquivo.' }),
      ui.campo('Planta da linha (.xls ou .xlsx)', input));
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
        try { lida = App.bitola.lerPlanta(XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' })); break; } catch (e) { ultimoErro = e; }
      }
      if (!lida) throw ultimoErro || new Error('Planta não encontrada no arquivo.');
      await store.set(CHAVE_PLANTA, { nome: f.name, importadoEm: U.agora(), elementos: lida.elementos, ramais: lida.ramais });
      await carregarLocal();
      ui.toast(`Planta importada: ${lida.elementos.length.toLocaleString('pt-BR')} elementos.`, 'ok', 5000);
      renderTudo();
    } catch (e) {
      ui.toast(`Não foi possível ler a planta: ${e.message}`, 'erro', 8000);
    }
  }

  /* ---------------- Esquema ---------------- */

  function largura() {
    const w = (conteudoEl && conteudoEl.clientWidth) || (raiz && raiz.clientWidth) || 360;
    return Math.max(280, w - 48); // cartão (16+16) + borda e respiro da caixa do esquema
  }

  const ramaisUsados = (trechos) => {
    const set = new Set(trechos.map((t) => M.separar(t).id.split(':')[0]));
    return malha.ramais.filter((r) => set.has(r.ramal));
  };

  function pontosParaEsquema(lista) {
    return lista.map((p) => ({
      id: p.id,
      trecho: p.trecho,
      cor: GRAVIDADES[p.gravidade] || GRAVIDADES['Atenção'],
      texto: p.tipo || p.gravidade,
      titulo: [p.tipo, p.horario, p.descricao].filter(Boolean).join(' · '),
      ponto: p
    }));
  }

  function seletorRamal(aoMudar, contagem) {
    return h('div', { class: 'seg seg-ramais', role: 'group', 'aria-label': 'Ramal' },
      malha.ramais.map((r) => h('button', {
        class: `seg-opcao${ramalSel === r.ramal ? ' ativo' : ''}`,
        'aria-pressed': ramalSel === r.ramal ? 'true' : 'false',
        title: r.nome,
        onclick: () => { ramalSel = r.ramal; U.pref.set('rota:ramal', r.ramal); inicioIntervalo = null; aoMudar(); }
      }, r.ramal, contagem && contagem[r.ramal] ? h('span', { class: 'seg-badge', text: String(contagem[r.ramal]) }) : null)));
  }

  const contarPorRamal = (trechos) => {
    const c = {};
    trechos.forEach((t) => { const r = M.separar(t).id.split(':')[0]; c[r] = (c[r] || 0) + 1; });
    return c;
  };

  /* ---------------- Programação ---------------- */

  function telaProgramacao(dia) {
    const ramal = malha.ramais.find((r) => r.ramal === ramalSel) || malha.ramais[0];
    const caixaEsquema = h('div', { class: 'esquema-caixa' });
    const resumoEl = h('p', { class: 'sub resumo-rota' });

    function desenharEsquema() {
      const prog = new Set(dia.programados);
      const svg = esquema.desenhar({
        ramal,
        largura: largura(),
        camadas: [{ trechos: prog, cor: dia.cor, estilo: 'cheio' }],
        pontos: pontosParaEsquema(pontosDo(dia)),
        inicioIntervalo,
        aoTocar: (t, u, l) => tocar(t, u, l),
        aoTocarPonto: (p) => editarPonto(dia, p.ponto)
      });
      ui.trocar(caixaEsquema, svg);
      const km = M.extensao(malha, dia.programados) / 1000;
      ui.trocar(resumoEl, dia.programados.length
        ? [h('strong', { text: `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km programados` }), ` · ${M.resumo(malha, dia.programados)}`]
        : 'Nenhum trecho na rota deste dia ainda. Toque nos trechos do esquema para incluir.');
    }

    async function tocar(t, u, l) {
      if (ferramenta === 'ponto') return editarPonto(dia, null, t);
      const lista = new Set(dia.programados);
      if (ferramenta === 'intervalo') {
        if (!inicioIntervalo) { inicioIntervalo = t; desenharEsquema(); ui.toast('Agora toque no trecho final (mesma linha).', 'info', 2500); return; }
        const ini = M.separar(inicioIntervalo);
        const trechos = M.intervalo(malha, ini.id, u.id, ini.linha);
        inicioIntervalo = null;
        if (!trechos.length) { desenharEsquema(); return ui.toast('Escolha o fim no mesmo ramal.', 'erro'); }
        const todos = trechos.every((x) => lista.has(x));
        trechos.forEach((x) => (todos ? lista.delete(x) : lista.add(x)));
        ui.toast(`${trechos.length} trecho(s) ${todos ? 'retirado(s) da' : 'incluído(s) na'} rota.`, 'ok', 1800);
      } else if (lista.has(t)) lista.delete(t); else lista.add(t);
      dia.programados = ordenarTrechos([...lista]);
      desenharEsquema();
      renderDias();
      await salvarDia(dia, { render: false });
    }

    const ferramentas = h('div', { class: 'seg seg-ferramentas', role: 'group', 'aria-label': 'Ferramenta' },
      [['trecho', 'Trecho a trecho'], ['intervalo', 'De… até…'], ['ponto', 'Ponto de atenção']].map(([id, rot]) => h('button', {
        class: `seg-opcao${ferramenta === id ? ' ativo' : ''}`,
        'aria-pressed': ferramenta === id ? 'true' : 'false',
        onclick: () => { ferramenta = id; inicioIntervalo = null; renderConteudo(); }
      }, rot)));
    const dicas = {
      trecho: 'Toque num trecho (EH ou pátio, em cada linha) para incluir ou retirar da rota.',
      intervalo: 'Toque no trecho inicial e depois no final: todos os trechos entre eles, na mesma linha, entram (ou saem) da rota.',
      ponto: 'Toque no trecho onde fica a interdição, serviço ou ponto de atenção.'
    };

    const outros = diasOrdenados().filter((d) => d.id !== dia.id && d.programados.length);
    const copiar = outros.length ? h('select', {
      class: 'select-auto',
      'aria-label': 'Copiar rota de outro dia',
      onchange: async (e) => {
        const origem = outros.find((d) => d.id === e.target.value);
        if (!origem) return;
        dia.programados = ordenarTrechos([...new Set([...dia.programados, ...origem.programados])]);
        await salvarDia(dia);
        ui.toast(`Rota do ${origem.ordem}º dia copiada.`, 'ok');
      }
    }, h('option', { value: '', text: 'Copiar rota de…' }), outros.map((d) => h('option', { value: d.id, text: `${d.ordem}º dia` }))) : null;

    desenharEsquema();
    return [
      cartaoDia(dia),
      h('section', { class: 'cartao' },
        h('div', { class: 'cartao-cab' },
          h('h2', { text: titulo(dia) }),
          h('span', { class: 'chip-cor', style: { background: dia.cor } })),
        seletorRamal(renderConteudo, contarPorRamal(dia.programados)),
        ferramentas,
        h('p', { class: 'sub', text: dicas[ferramenta] }),
        caixaEsquema,
        resumoEl,
        h('div', { class: 'linha-acoes' },
          copiar,
          dia.programados.some((t) => t.startsWith(`${ramal.ramal}:`)) ? h('button', {
            class: 'btn btn-fantasma btn-pequeno',
            onclick: async () => {
              if (!(await ui.confirmar('Limpar ramal', `Retirar da rota deste dia todos os trechos do ramal ${ramal.ramal}?`, { ok: 'Retirar', perigo: true }))) return;
              dia.programados = dia.programados.filter((t) => !t.startsWith(`${ramal.ramal}:`));
              await salvarDia(dia);
            }
          }, ui.icone('lixo'), `Limpar ${ramal.ramal}`) : null),
        legendaEsquema(false)),
      cartaoPontos(dia, true),
      cartaoObservacoes(dia)
    ];
  }

  function ordenarTrechos(trechos) {
    return trechos.slice().sort((a, b) => {
      const x = malha.indice.get(M.separar(a).id); const y = malha.indice.get(M.separar(b).id);
      const ra = x ? malha.ramais.indexOf(x.ramal) : 99; const rb = y ? malha.ramais.indexOf(y.ramal) : 99;
      return ra - rb || (x ? x.i : 0) - (y ? y.i : 0) || a.localeCompare(b);
    });
  }

  const titulo = (dia) => `Rota para o ${dia.ordem}º dia de inspeção${dia.titulo ? ` (${dia.titulo})` : ''}`;

  function cartaoDia(dia) {
    const salvarCampo = (campo) => async (e) => { dia[campo] = e.target.value; await salvarDia(dia, { render: false }); renderDias(); };
    return h('details', { class: 'cartao detalhes', open: !dia.programados.length || null },
      h('summary', null, h('strong', { text: `${dia.ordem}º dia` }),
        h('span', { class: 'sub', text: ` · ${dia.data ? U.fmtData(dia.data) : 'sem data'} · ${dia.sentido || ''} ${dia.titulo ? `· ${dia.titulo}` : ''}` })),
      h('div', { class: 'pilha', style: { marginTop: '10px' } },
        h('div', { class: 'grade-3' },
          ui.campo('Data', h('input', { type: 'date', value: dia.data || '', onchange: salvarCampo('data') })),
          ui.campo('Sentido', h('select', { value: dia.sentido || 'Subindo', onchange: salvarCampo('sentido') },
            ['Subindo', 'Descendo'].map((v) => h('option', { value: v, text: v })))),
          ui.campo('Cor do dia', h('input', { type: 'color', value: dia.cor || CORES_DIA[0], onchange: async (e) => { dia.cor = e.target.value; await salvarDia(dia); renderDias(); } }))),
        ui.campo('Título (complemento)', h('input', { type: 'text', maxlength: 120, placeholder: 'Ex.: Subindo de TU a GV', value: dia.titulo || '', onchange: async (e) => { dia.titulo = e.target.value.trim(); await salvarDia(dia); } }),
          { ajuda: `Aparece como "${titulo({ ...dia, titulo: dia.titulo || 'Subindo de TU a GV' })}".` }),
        h('div', { class: 'linha-acoes' },
          ui.campo('Dia nº', h('input', { type: 'number', min: 1, max: 99, value: dia.ordem, style: { width: '90px' }, onchange: async (e) => { const n = parseInt(e.target.value, 10); if (n > 0) { dia.ordem = n; await salvarDia(dia); renderDias(); } } })),
          h('button', {
            class: 'btn btn-fantasma btn-pequeno',
            onclick: async () => {
              if (!(await ui.confirmar('Excluir dia', `Excluir o ${dia.ordem}º dia da rota (com os pontos de atenção)?`, { ok: 'Excluir', perigo: true }))) return;
              dia.excluido = true;
              for (const p of pontosDo(dia)) { p.excluido = true; await salvarPonto(p); }
              await salvarDia(dia, { render: false });
              diaSel = diasOrdenados()[0] ? diasOrdenados()[0].id : 'geral';
              renderDias(); renderConteudo();
            }
          }, ui.icone('lixo'), 'Excluir dia'))));
  }

  /* ---------------- Pontos de atenção ---------------- */

  function cartaoPontos(dia, editavel) {
    const lista = pontosDo(dia).slice().sort((a, b) => {
      const x = malha.indice.get(M.separar(a.trecho || '').id); const y = malha.indice.get(M.separar(b.trecho || '').id);
      return (x ? malha.ramais.indexOf(x.ramal) * 10000 + x.i : 1e9) - (y ? malha.ramais.indexOf(y.ramal) * 10000 + y.i : 1e9);
    });
    return h('section', { class: 'cartao' },
      h('div', { class: 'cartao-cab' },
        h('h2', { text: `Pontos de atenção (${lista.length})` }),
        editavel ? h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => editarPonto(dia, null) }, ui.icone('mais'), 'Adicionar') : null),
      h('p', { class: 'sub', text: 'Interdições, serviços na via, conflitos de circulação e informações importantes para as equipes.' }),
      lista.length ? h('div', { class: 'lista-pontos' }, lista.map((p) => h('div', {
        class: 'ponto-item',
        style: { '--cor-ponto': GRAVIDADES[p.gravidade] || GRAVIDADES['Atenção'] },
        role: editavel ? 'button' : null,
        tabindex: editavel ? '0' : null,
        onclick: editavel ? () => editarPonto(dia, p) : null
      },
      h('span', { class: 'ponto-tag', text: p.tipo || p.gravidade }),
      h('div', { class: 'ponto-texto' },
        h('strong', { text: [p.local || '—', p.horario].filter(Boolean).join(' · ') }),
        p.descricao ? h('span', { text: p.descricao }) : null),
      h('span', { class: 'ponto-grav', text: p.gravidade || '' })))) : h('p', { class: 'vazio', text: editavel ? 'Nenhum ponto de atenção. Use "Adicionar" ou a ferramenta "Ponto de atenção" no esquema.' : 'Nenhum ponto de atenção.' }));
  }

  function editarPonto(dia, ponto, trecho) {
    const p = ponto ? { ...ponto } : { id: U.uuid(), diaId: dia.id, ciclo, tipo: '', gravidade: 'Interdição', trecho: trecho || '', local: trecho ? M.descrever(malha, trecho) : '', horario: '', descricao: '', excluido: false, criadoEm: U.agora() };
    const listaTipos = h('datalist', { id: 'tipos-ponto' }, TIPOS_PONTO.map((t) => h('option', { value: t })));
    const tipo = h('input', { type: 'text', list: 'tipos-ponto', maxlength: 40, value: p.tipo, placeholder: 'Ex.: Subst. TR, Man. AMV, Plano 24h' });
    const grav = h('select', { value: p.gravidade }, Object.keys(GRAVIDADES).map((g) => h('option', { value: g, text: g })));
    // Local: trechos da rota do dia (mais prováveis) + todos do ramal escolhido.
    const opcoesLocal = [...new Set([...(p.trecho ? [p.trecho] : []), ...dia.programados])];
    const local = h('select', { value: p.trecho },
      h('option', { value: '', text: 'Sem trecho (só texto)' }),
      opcoesLocal.map((t) => h('option', { value: t, text: M.descrever(malha, t) })));
    const localTexto = h('input', { type: 'text', maxlength: 120, value: p.trecho ? '' : p.local, placeholder: 'Ex.: km 71+275 ao 71+281' });
    const horario = h('input', { type: 'text', maxlength: 60, value: p.horario, placeholder: 'Ex.: 08:30 a 16:00' });
    const descricao = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Ex.: TR2 - Substituição de trilho 68 do km 71.275 ao 71.281 (6 m)' });
    descricao.value = p.descricao || '';
    ui.modal({
      titulo: ponto ? 'Ponto de atenção' : 'Novo ponto de atenção',
      conteudo: h('div', { class: 'pilha' }, listaTipos,
        h('div', { class: 'grade-2' }, ui.campo('Tipo', tipo, { obrigatorio: true }), ui.campo('Gravidade', grav)),
        ui.campo('Trecho', local, { ajuda: 'Toque no esquema com a ferramenta "Ponto de atenção" para escolher qualquer trecho.' }),
        ui.campo('Local (texto livre)', localTexto, { ajuda: 'Complemento ou local quando não houver trecho.' }),
        ui.campo('Horário', horario),
        ui.campo('Descrição', descricao)),
      acoes: [
        ponto ? {
          texto: 'Excluir',
          classe: 'btn-fantasma',
          onClick: async (fechar) => { p.excluido = true; fechar(); await salvarPonto(p); ui.toast('Ponto de atenção excluído.', 'ok'); }
        } : { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Salvar',
          classe: 'btn-primario',
          onClick: async (fechar) => {
            if (!tipo.value.trim()) return ui.marcarErro(tipo, 'Informe o tipo.');
            p.tipo = tipo.value.trim();
            p.gravidade = grav.value;
            p.trecho = local.value;
            p.local = [local.value ? M.descrever(malha, local.value) : '', localTexto.value.trim()].filter(Boolean).join(' · ');
            p.horario = horario.value.trim();
            p.descricao = descricao.value.trim();
            fechar();
            await salvarPonto(p);
            ui.toast('Ponto de atenção salvo.', 'ok');
          }
        }
      ]
    });
  }

  function cartaoObservacoes(dia) {
    const obs = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Ex.: Circulação saindo de Tubarão e desviando em Governador Valadares conforme rota acima.' });
    obs.value = dia.observacao || '';
    obs.addEventListener('change', async () => { dia.observacao = obs.value.trim(); await salvarDia(dia, { render: false }); });
    const gar = h('input', { type: 'text', maxlength: 120, value: dia.garageamento || '', placeholder: 'Ex.: EH-30/31 L02 (VRD)' });
    gar.addEventListener('change', async () => { dia.garageamento = gar.value.trim(); await salvarDia(dia, { render: false }); });
    return h('section', { class: 'cartao' },
      h('h2', { text: 'Circulação e garageamento' }),
      ui.campo('Observação da circulação', obs, { ajuda: 'Aparece em destaque no PDF, abaixo do esquema.' }),
      ui.campo('Garageamento no fim do dia', gar));
  }

  /* ---------------- Execução ---------------- */

  function telaExecucao(dia) {
    const ramal = malha.ramais.find((r) => r.ramal === ramalSel) || malha.ramais[0];
    const caixa = h('div', { class: 'esquema-caixa' });
    const kpisEl = h('div', { class: 'kpis kpis-auto' });

    function indicadores() {
      const prog = new Set(dia.programados);
      const exec = new Set(dia.executados);
      const kmProg = M.extensao(malha, dia.programados) / 1000;
      const kmExec = M.extensao(malha, dia.executados) / 1000;
      const kmNoProg = M.extensao(malha, dia.executados.filter((t) => prog.has(t))) / 1000;
      const kmFora = M.extensao(malha, dia.executados.filter((t) => !prog.has(t))) / 1000;
      const kmFalta = M.extensao(malha, dia.programados.filter((t) => !exec.has(t))) / 1000;
      const f = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      const kpi = (t, v, sub) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-titulo', text: t }), h('strong', { class: 'kpi-valor', text: v }), h('span', { class: 'kpi-sub', text: sub }));
      ui.trocar(kpisEl,
        kpi('Aderência', `${kmProg ? Math.round((kmNoProg / kmProg) * 100) : 0}%`, 'do programado percorrido'),
        kpi('Percorrido', `${f(kmExec)} km`, `de ${f(kmProg)} km programados`),
        kpi('Faltou', `${f(kmFalta)} km`, 'programado e não percorrido'),
        kpi('Fora da programação', `${f(kmFora)} km`, 'percorrido sem estar na rota'));
    }

    function desenhar() {
      ui.trocar(caixa, esquema.desenhar({
        ramal,
        largura: largura(),
        camadas: [
          { trechos: new Set(dia.programados), cor: dia.cor, estilo: 'tracejado' },
          { trechos: new Set(dia.executados), cor: COR_EXEC, estilo: 'cheio', desloc: 0 }
        ],
        pontos: pontosParaEsquema(pontosDo(dia)),
        aoTocar: async (t) => {
          const set = new Set(dia.executados);
          if (set.has(t)) set.delete(t); else set.add(t);
          dia.executados = ordenarTrechos([...set]);
          desenhar(); indicadores(); renderDias();
          await salvarDia(dia, { render: false });
        },
        aoTocarPonto: (p) => ui.toast(p.titulo, 'info', 5000)
      }));
    }
    desenhar(); indicadores();

    const obs = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Ex.: Não foi possível passar na EH 44/45 L2 por causa da interdição; desviado pela L1.' });
    obs.value = dia.obsExecucao || '';
    obs.addEventListener('change', async () => { dia.obsExecucao = obs.value.trim(); await salvarDia(dia, { render: false }); });

    return [
      h('section', { class: 'cartao' },
        h('div', { class: 'cartao-cab' }, h('h2', { text: `Execução · ${titulo(dia)}` }), h('span', { class: 'chip-cor', style: { background: dia.cor } })),
        h('p', { class: 'sub', text: `${dia.data ? U.fmtData(dia.data) : ''} · Toque nos trechos por onde o carro passou. Tracejado = programado; verde = percorrido.` }),
        kpisEl),
      h('section', { class: 'cartao' },
        seletorRamal(renderConteudo, contarPorRamal([...dia.programados, ...dia.executados])),
        caixa,
        h('div', { class: 'linha-acoes' },
          h('button', {
            class: 'btn btn-secundario btn-pequeno',
            disabled: !dia.programados.length,
            onclick: async () => {
              dia.executados = ordenarTrechos([...new Set([...dia.executados, ...dia.programados])]);
              await salvarDia(dia); renderDias();
              ui.toast('Toda a rota programada marcada como percorrida.', 'ok');
            }
          }, ui.icone('check'), 'Marcar todo o programado'),
          dia.executados.length ? h('button', {
            class: 'btn btn-fantasma btn-pequeno',
            onclick: async () => {
              if (!(await ui.confirmar('Limpar execução', 'Desmarcar todos os trechos percorridos deste dia?', { ok: 'Desmarcar', perigo: true }))) return;
              dia.executados = []; await salvarDia(dia); renderDias();
            }
          }, ui.icone('x'), 'Limpar execução') : null),
        legendaEsquema(true)),
      h('section', { class: 'cartao' }, ui.campo('Observação da execução', obs)),
      cartaoPontos(dia, false)
    ];
  }

  function legendaEsquema(execucao) {
    const item = (cor, texto, classe = '') => h('span', { class: 'leg-item' }, h('span', { class: `leg-traco ${classe}`, style: { background: cor, borderColor: cor } }), texto);
    return h('div', { class: 'legenda-rota' },
      execucao ? [item('transparent', 'Programado', 'tracejado'), item(COR_EXEC, 'Percorrido')] : null,
      Object.entries(GRAVIDADES).map(([g, c]) => h('span', { class: 'leg-item' }, h('span', { class: 'leg-caixa', style: { background: c } }), g)),
      h('span', { class: 'leg-item' }, h('span', { class: 'leg-patio' }), 'Pátio (RH) com número e km'));
  }

  /* ---------------- Visão geral ---------------- */

  function camadasDias(dias, execucao) {
    const n = dias.length;
    return dias.map((d, k) => ({
      trechos: new Set(execucao ? d.executados : d.programados),
      cor: d.cor,
      estilo: 'fino',
      desloc: n > 1 ? Math.round((k - (n - 1) / 2) * (6 / Math.max(1, n - 1)) * 10) / 10 : 0
    }));
  }

  function visaoGeral() {
    const dias = diasOrdenados();
    const execucao = modo === 'execucao';
    const todos = dias.flatMap((d) => (execucao ? d.executados : d.programados));
    const usados = ramaisUsados(todos);
    const tabela = h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro' },
      h('thead', null, h('tr', null, ['', 'Dia', 'Data', 'Rota', 'Km prog.', execucao ? 'Km percorrido' : 'Pontos', execucao ? 'Aderência' : 'Garageamento'].map((t) => h('th', { text: t })))),
      h('tbody', null, dias.map((d) => h('tr', { tabindex: '0', onclick: () => { diaSel = d.id; renderDias(); renderConteudo(); } },
        h('td', null, h('span', { class: 'chip-cor', style: { background: d.cor } })),
        h('td', { text: `${d.ordem}º` }),
        h('td', { text: d.data ? `${U.diaSemanaCurto(d.data)} ${U.fmtData(d.data)}` : '—' }),
        h('td', { class: 'ev', text: [d.sentido, d.titulo].filter(Boolean).join(' · ') || M.resumo(malha, d.programados) || '—' }),
        h('td', { text: (M.extensao(malha, d.programados) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }),
        h('td', { text: execucao ? (M.extensao(malha, d.executados) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : String(pontosDo(d).length) }),
        h('td', { text: execucao ? `${pctAderencia(d)}%` : (d.garageamento || '—') }))))));

    const blocos = (usados.length ? usados : [malha.ramais.find((r) => r.ramal === ramalSel) || malha.ramais[0]]).map((r) => h('div', { class: 'bloco-ramal' },
      h('h3', { text: r.nome }),
      h('div', { class: 'esquema-caixa' }, esquema.desenhar({ ramal: r, largura: largura(), camadas: camadasDias(dias, execucao), pontos: [] }))));

    return [
      h('section', { class: 'cartao' },
        h('h2', { text: `Visão geral da rota · ciclo ${ciclo}${execucao ? ' (execução)' : ''}` }),
        dias.length ? tabela : h('p', { class: 'vazio', text: 'Crie o primeiro dia da rota.' }),
        h('div', { class: 'legenda-rota' }, dias.map((d) => h('span', { class: 'leg-item' }, h('span', { class: 'leg-traco', style: { background: d.cor } }), `${d.ordem}º dia`)))),
      h('section', { class: 'cartao' }, blocos)
    ];
  }

  /* ---------------- PDF ---------------- */

  function abrirPdf() {
    const dias = diasOrdenados();
    const execucao = modo === 'execucao';
    const marcados = new Set(diaSel && diaSel !== 'geral' ? [diaSel] : dias.map((d) => d.id));
    let geral = diaSel === 'geral' || !diaSel;
    const caixas = dias.map((d) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: marcados.has(d.id), onchange: (e) => { if (e.target.checked) marcados.add(d.id); else marcados.delete(d.id); } }),
      ` ${d.ordem}º dia${d.data ? ` · ${U.fmtData(d.data)}` : ''}${d.titulo ? ` · ${d.titulo}` : ''}`));
    ui.modal({
      titulo: execucao ? 'PDF da execução da rota' : 'PDF da rota',
      conteudo: h('div', { class: 'pilha' },
        h('p', { class: 'sub', text: 'Escolha o que entra no PDF. Cada dia sai numa página (paisagem), com o esquema, os pontos de atenção e as observações.' }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: geral, onchange: (e) => { geral = e.target.checked; } }), ' Visão geral (todos os dias)'),
        caixas),
      acoes: [
        { texto: 'Cancelar', classe: 'btn-secundario', onClick: (f) => f() },
        {
          texto: 'Gerar PDF',
          classe: 'btn-primario',
          onClick: (fechar) => {
            const escolhidos = dias.filter((d) => marcados.has(d.id));
            if (!escolhidos.length && !geral) return ui.toast('Escolha pelo menos um dia.', 'erro');
            fechar();
            imprimir(montarPdf({ dias: escolhidos, geral, execucao }));
          }
        }
      ]
    });
  }

  const LARG_PDF = 1010;

  /** Esquema em filas separadas (uma SVG por fila), para o PDF quebrar a página entre elas. */
  function esquemaPdf(r, op) {
    return esquema.filas(r, LARG_PDF, op.faixa).map((f) => h('div', { class: 'rota-fila' },
      esquema.desenhar({ ...op, ramal: r, largura: LARG_PDF, faixa: f })));
  }

  function montarPdf({ dias, geral, execucao }) {
    const todos = diasOrdenados();
    const tabela = (cab, linhas, classe = '') => h('table', { class: `laudo-tabela ${classe}` },
      h('thead', null, h('tr', null, cab.map((t) => h('th', { text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', null, l.map((c) => (c instanceof Node ? h('td', null, c) : h('td', { text: c === null || c === undefined ? '' : String(c) })))))));
    const km = (t) => (M.extensao(malha, t) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const paginas = [];

    if (geral) {
      const trechos = todos.flatMap((d) => (execucao ? d.executados : d.programados));
      paginas.push(h('section', { class: 'rota-pagina' },
        h('div', { class: 'rota-faixa' }, `ROTA DO CARRO CONTROLE · CICLO ${ciclo}${execucao ? ' · EXECUÇÃO' : ''} · VISÃO GERAL`),
        tabela(['', 'Dia', 'Data', 'Sentido / rota', 'Km programado', execucao ? 'Km percorrido' : 'Pontos de atenção', execucao ? 'Aderência' : 'Garageamento'],
          todos.map((d) => [h('span', { class: 'chip-cor', style: { background: d.cor } }), `${d.ordem}º`, d.data ? `${U.diaSemanaCurto(d.data)} ${U.fmtData(d.data)}` : '—',
            [d.sentido, d.titulo].filter(Boolean).join(' · ') || M.resumo(malha, d.programados), km(d.programados),
            execucao ? km(d.executados) : pontosDo(d).length, execucao ? `${pctAderencia(d)}%` : d.garageamento || '—']), 'centro'),
        ramaisUsados(trechos).map((r) => h('div', { class: 'rota-bloco' },
          h('h3', { text: r.nome }),
          esquemaPdf(r, { camadas: camadasDias(todos, execucao), pontos: [], faixa: esquema.faixaDe(r, trechos, 2) })))));
    }

    dias.forEach((d) => {
      const pontos = pontosDo(d);
      const trechos = execucao ? [...d.programados, ...d.executados] : d.programados;
      const camadas = execucao
        ? [{ trechos: new Set(d.programados), cor: d.cor, estilo: 'tracejado' }, { trechos: new Set(d.executados), cor: COR_EXEC, estilo: 'cheio' }]
        : [{ trechos: new Set(d.programados), cor: d.cor, estilo: 'cheio' }];
      const ramais = ramaisUsados([...trechos, ...pontos.map((p) => p.trecho).filter(Boolean)]);
      paginas.push(h('section', { class: 'rota-pagina' },
        h('div', { class: 'rota-faixa' }, `${d.data ? `${U.fmtData(d.data)} · ` : ''}${titulo(d).toUpperCase()}${execucao ? ' · EXECUÇÃO' : ''}`),
        h('p', { class: 'rota-resumo' },
          d.sentido ? h('span', { class: `rota-sentido${d.sentido === 'Descendo' ? ' descendo' : ''}`, text: d.sentido === 'Descendo' ? '◀ Sentido de circulação' : 'Sentido de circulação ▶' }) : null,
          `Rota: ${M.resumo(malha, d.programados) || '—'} · ${km(d.programados)} km programados`,
          execucao ? ` · ${km(d.executados)} km percorridos · aderência ${pctAderencia(d)}%` : ''),
        ramais.map((r) => {
          const faixa = esquema.faixaDe(r, [...trechos, ...pontos.map((p) => p.trecho).filter(Boolean)], 2);
          return h('div', { class: 'rota-bloco' },
            h('h3', { text: r.nome }),
            esquemaPdf(r, { camadas, pontos: pontosParaEsquema(pontos), faixa }));
        }),
        d.observacao ? h('div', { class: 'rota-obs' }, d.observacao) : null,
        pontos.length ? [h('h3', { text: 'Pontos de atenção' }),
          tabela(['', 'Tipo', 'Local', 'Horário', 'Descrição'], pontos.map((p) => [
            h('span', { class: 'leg-caixa', style: { background: GRAVIDADES[p.gravidade] || GRAVIDADES['Atenção'] } }), p.tipo, p.local, p.horario, p.descricao]))] : null,
        d.garageamento ? h('p', { class: 'rota-garagem' }, h('strong', { text: 'Garageamento: ' }), d.garageamento) : null,
        execucao && d.obsExecucao ? h('p', { class: 'rota-garagem' }, h('strong', { text: 'Execução: ' }), d.obsExecucao) : null,
        h('div', { class: 'legenda-rota' },
          execucao ? [h('span', { class: 'leg-item' }, h('span', { class: 'leg-traco tracejado', style: { borderColor: d.cor } }), 'Programado'), h('span', { class: 'leg-item' }, h('span', { class: 'leg-traco', style: { background: COR_EXEC } }), 'Percorrido')]
            : h('span', { class: 'leg-item' }, h('span', { class: 'leg-traco', style: { background: d.cor } }), 'Rota do dia'),
          Object.entries(GRAVIDADES).map(([g, c]) => h('span', { class: 'leg-item' }, h('span', { class: 'leg-caixa', style: { background: c } }), g)))));
    });

    return h('div', { id: 'laudo', class: 'laudo rota-pdf' }, paginas,
      h('footer', { class: 'laudo-rodape', text: `Gerado pelo App Carro Controle EM80 · ${U.fmtDataHora(U.agora())}` }));
  }

  function imprimir(el) {
    const anterior = document.getElementById('laudo');
    if (anterior) anterior.remove();
    const temaAnterior = document.documentElement.getAttribute('data-theme');
    const tituloAnterior = document.title;
    document.body.appendChild(el);
    document.documentElement.setAttribute('data-theme', 'light');
    document.title = `Rota EM80 ciclo ${ciclo}${modo === 'execucao' ? ' execucao' : ''}`;
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

  App.rota = { _montarPdf: montarPdf };
  App.modulos = App.modulos || [];
  App.modulos.push({ id: 'rota', titulo: 'Rota', icone: 'mapa', montar, aoMostrar });
})(window.App);
