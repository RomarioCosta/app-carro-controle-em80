/*
 * Montagem dos dados: junta os arquivos do carro de um ciclo e mostra, pela geometria,
 * quanto do trecho já está medido, onde há buracos, sobreposições e inconsistências de km.
 * Cada arquivo tem que complementar o vizinho (ex.: GV1 encosta no GV2) antes de subir para o banco.
 */
'use strict';

(function (App) {
  const { U, ui, store } = App;
  const { h } = ui;
  const B = () => App.bitola;
  const C = () => App.cobertura;
  const CHAVE = 'montagem:arquivos';

  let raiz;
  let planta = null;
  let arquivos = []; // [{ id, nome, ciclo, adicionadoEm, recorte, resumo }]
  let processando = false;
  let abertos = new Set(); // linhas da tabela de sedes abertas ("linha|sede")

  const km = (m) => B().fmtKm(m);
  const kmTxt = (m) => `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const mTxt = (m) => (m >= 1000 ? kmTxt(m) : `${Math.round(m).toLocaleString('pt-BR')} m`);
  const pctTxt = (p) => `${p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const ciclo = () => U.pref.get('montagem:ciclo', (App.OM && App.OM.cicloAtivo()) || '');
  const doCiclo = () => arquivos.filter((a) => (a.ciclo || '') === ciclo());

  async function carregar() {
    planta = App.analise && App.analise.planta ? await App.analise.planta() : null;
    try {
      const salvos = (await store.get(CHAVE)) || [];
      arquivos = salvos.map((a) => ({ ...a, resumo: C().normalizarResumo(a.resumo) }));
    } catch (e) { arquivos = []; }
  }
  const gravar = () => store.set(CHAVE, arquivos).catch((e) => ui.toast(`Não foi possível guardar: ${e.message}`, 'erro', 6000));

  /* ---------------- Arquivos ---------------- */

  async function adicionar(lista) {
    if (!planta) { ui.toast('Importe a geometria na Análise do arquivo primeiro.', 'erro', 6000); return; }
    processando = true;
    render();
    let ok = 0;
    for (let k = 0; k < lista.length; k++) {
      const f = lista[k];
      ui.toast(`Processando ${k + 1}/${lista.length}: ${f.name}…`, 'info', 4000);
      await new Promise((r) => setTimeout(r, 30)); // deixa a tela mostrar o aviso
      try {
        const { nome, texto } = await App.analise.textoDoArquivo(f);
        const arq = B().lerCSV(texto);
        const resumo = C().resumirArquivo(arq, planta, nome);
        const existente = arquivos.findIndex((a) => a.nome === nome && (a.ciclo || '') === ciclo());
        const item = { id: existente >= 0 ? arquivos[existente].id : `${Date.now()}-${k}`, nome, ciclo: ciclo(), adicionadoEm: U.agora(), recorte: null, resumo };
        if (existente >= 0) arquivos[existente] = item; else arquivos.push(item);
        ok++;
      } catch (e) {
        ui.toast(`${f.name}: ${e.message}`, 'erro', 8000);
      }
    }
    processando = false;
    await gravar();
    if (ok) ui.toast(`${ok} arquivo(s) adicionado(s).`, 'ok');
    render();
  }

  async function remover(a) {
    if (!(await ui.confirmar('Remover arquivo', `Remover ${a.nome} da montagem?`, { ok: 'Remover', perigo: true }))) return;
    arquivos = arquivos.filter((x) => x !== a);
    await gravar();
    render();
  }

  /* ---------------- Desenho da faixa (km) ---------------- */

  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { const el = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); return el; }

  /** Faixa horizontal do km: cinza = precisa medir, verde = medido, vermelho = buraco, laranja = medido 2×. */
  function faixa(linha, ini, fim, { divisas = true } = {}) {
    const L = 1000; const A = 14;
    const x = (m) => ((m - ini) / Math.max(1, fim - ini)) * L;
    const larg = (a, b) => Math.max(1.2, x(b) - x(a));
    const el = svg('svg', { viewBox: `0 0 ${L} ${A}`, preserveAspectRatio: 'none', class: 'mt-faixa', role: 'img', 'aria-label': 'Cobertura do trecho' });
    const dentro = (s) => s.fim > ini && s.ini < fim;
    linha.sedes.filter(dentro).forEach((s) => el.appendChild(svg('rect', { x: x(Math.max(ini, s.ini)), y: 2, width: larg(Math.max(ini, s.ini), Math.min(fim, s.fim)), height: 10, class: 'mt-nec' })));
    linha.sedes.filter(dentro).forEach((s) => s.cobertos.forEach(([a, b]) => { if (b > ini && a < fim) el.appendChild(svg('rect', { x: x(Math.max(a, ini)), y: 2, width: larg(Math.max(a, ini), Math.min(b, fim)), height: 10, class: 'mt-cob' })); }));
    // buraco em vermelho só nas sedes que já têm arquivo; nas outras o trecho todo é "falta medir"
    linha.buracos.filter((b) => b.fim > ini && b.ini < fim && linha.sedes.some((s) => s.sede === b.sede && s.coberto > 0))
      .forEach((b) => el.appendChild(svg('rect', { x: x(Math.max(b.ini, ini)), y: 2, width: larg(Math.max(b.ini, ini), Math.min(b.fim, fim)), height: 10, class: 'mt-bur' })));
    linha.sobreposicoes.filter((o) => o.fim > ini && o.ini < fim).forEach((o) => el.appendChild(svg('rect', { x: x(Math.max(o.ini, ini)), y: 0, width: larg(Math.max(o.ini, ini), Math.min(o.fim, fim)), height: 3, class: 'mt-sob' })));
    if (!divisas) return el;
    // nomes das sedes em HTML (o SVG é esticado na largura e deformaria o texto)
    const rotulos = h('div', { class: 'mt-rotulos' });
    linha.sedes.filter(dentro).forEach((s, k) => {
      const xa = x(Math.max(ini, s.ini)); const xb = x(Math.min(fim, s.fim));
      if (k) el.appendChild(svg('line', { x1: xa, x2: xa, y1: 0, y2: 16, class: 'mt-div' }));
      rotulos.appendChild(h('span', { style: `left:${xa / 10}%;width:${(xb - xa) / 10}%`, text: C().normSede(s.sede), title: `${s.sede} ${km(s.ini)} – ${km(s.fim)}` }));
    });
    return h('div', { class: 'mt-faixa-caixa' }, el, rotulos);
    return el;
  }

  /* ---------------- Telas ---------------- */

  function cabecalho() {
    const input = h('input', { type: 'file', multiple: true, name: 'arquivo-montagem', hidden: true, onchange: (e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) adicionar(l); } });
    const ramais = planta ? Object.keys(planta.ramais) : [];
    const ramalAtual = ramalEscolhido();
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'tela-cab' }, h('h1', { text: 'Montagem dos dados' })),
      !planta ? h('p', { class: 'aviso aviso-erro', text: 'Importe a geometria da linha na Análise do arquivo: é ela que diz o que precisa ser medido.' }) : null,
      h('div', { class: 'grade-3' },
        ui.campo('Ciclo', h('input', { type: 'text', value: ciclo(), placeholder: 'ex.: 2026-10', onchange: (e) => { U.pref.set('montagem:ciclo', e.target.value.trim()); render(); } })),
        ui.campo('Ramal', h('select', { onchange: (e) => { U.pref.set('montagem:ramal', e.target.value); render(); } },
          ramais.map((r) => h('option', { value: r, selected: r === ramalAtual || null, text: r })))),
        h('div', { class: 'mt-acao' },
          h('button', { class: 'btn btn-primario', disabled: processando || !planta || null, onclick: () => input.click() }, ui.icone('upload'), processando ? 'Processando…' : 'Adicionar arquivos'),
          input)));
  }

  function ramalEscolhido() {
    if (!planta) return '';
    const ramais = Object.keys(planta.ramais);
    const salvo = U.pref.get('montagem:ramal', '');
    if (ramais.includes(salvo)) return salvo;
    const comArquivo = doCiclo().map((a) => a.resumo.ramal).find((r) => ramais.includes(r));
    return comArquivo || (ramais.includes('LT') ? 'LT' : ramais[0]);
  }

  function resumoGeral(linhas) {
    const nec = linhas.reduce((s, l) => s + l.necessario, 0);
    const cob = linhas.reduce((s, l) => s + l.coberto, 0);
    const bur = linhas.reduce((s, l) => s + l.buracos.filter((b) => l.sedes.find((x) => x.sede === b.sede && x.coberto > 0)).length, 0);
    const sob = linhas.reduce((s, l) => s + l.sobreposicoes.length, 0);
    const div = linhas.reduce((s, l) => s + l.fronteiras.filter((f) => f.situacao === 'buraco').length, 0);
    const kpi = (titulo, valor, sub, classe = '') => h('div', { class: `kpi ${classe}` }, h('div', { class: 'kpi-titulo', text: titulo }), h('div', { class: 'kpi-valor', text: valor }), sub ? h('div', { class: 'kpi-sub', text: sub }) : null);
    const pct = nec ? (cob / nec) * 100 : 0;
    return h('div', { class: 'kpis kpis-auto' },
      h('div', { class: `kpi ${pct >= 99.9 ? 'kpi-ok' : ''}` }, h('div', { class: 'kpi-titulo', text: 'Medido' }), h('div', { class: 'kpi-valor', text: pctTxt(pct) }),
        h('div', { class: 'kpi-barra' }, h('span', { style: `width:${Math.min(100, pct)}%` })), h('div', { class: 'kpi-sub', text: `${kmTxt(cob)} de ${kmTxt(nec)}` })),
      kpi('Falta medir', kmTxt(Math.max(0, nec - cob)), 'pela geometria'),
      kpi('Buracos', String(bur), 'entre arquivos', bur ? 'kpi-ruim' : ''),
      kpi('Divisas abertas', String(div), 'sede não encosta na vizinha', div ? 'kpi-ruim' : ''),
      kpi('Sobreposições', String(sob), 'trecho em 2 arquivos', sob ? 'kpi-atencao' : ''));
  }

  function selo(situacao) {
    const t = { ok: ['mt-ok', '✓ encosta'], buraco: ['mt-erro', '✗ buraco'], pendente: ['mt-pend', 'falta arquivo'] }[situacao];
    return h('span', { class: `mt-selo ${t[0]}`, text: t[1] });
  }

  /** Onde está o buraco: salto dentro de um arquivo, entre dois arquivos, antes ou depois deles. */
  function onde(b) {
    const mesmo = b.antes.filter((n) => b.depois.includes(n));
    if (mesmo.length) return ` · salto do km dentro de ${mesmo.join(', ')}`;
    if (b.antes.length && b.depois.length) return ` · entre ${b.antes.join(', ')} e ${b.depois.join(', ')}`;
    if (b.depois.length) return ` · antes de ${b.depois.join(', ')}`;
    if (b.antes.length) return ` · depois de ${b.antes.join(', ')}`;
    return '';
  }

  function cartaoLinha(l) {
    const ini = l.sedes.length ? l.sedes[0].ini : 0; const fim = l.sedes.length ? l.sedes[l.sedes.length - 1].fim : 1;
    const linhasTabela = [];
    l.sedes.forEach((s) => {
      const chave = `${l.linha}|${s.sede}`;
      const aberto = abertos.has(chave);
      const div = l.fronteiras.find((f) => f.de === s.sede && Math.abs(f.km - s.fim) < 1000);
      const buracos = s.coberto > 0 ? s.buracos : [];
      linhasTabela.push(h('tr', { tabindex: 0, class: aberto ? 'mt-aberta' : '', onclick: () => { if (aberto) abertos.delete(chave); else abertos.add(chave); render(); } },
        h('td', null, h('strong', { text: C().normSede(s.sede) })),
        h('td', { text: `${km(s.ini)} – ${km(s.fim)}` }),
        h('td', { class: 'mt-barra-cel' }, h('div', { class: 'mt-mini' }, faixa({ ...l, sedes: [s] }, s.ini, s.fim, { divisas: false })), h('span', { text: pctTxt(s.pct) })),
        h('td', { class: 'num', text: s.coberto ? kmTxt(Math.max(0, s.necessario - s.coberto)) : kmTxt(s.necessario) }),
        h('td', { class: 'num', text: buracos.length ? String(buracos.length) : '—' }),
        h('td', { class: 'num', text: s.arquivos.length ? String(s.arquivos.length) : '—' }),
        h('td', null, div ? h('span', null, selo(div.situacao), h('span', { class: 'mt-sub', text: ` → ${C().normSede(div.para)}` })) : '')));
      if (aberto) {
        const itens = [];
        s.arquivos.forEach((n) => itens.push(h('li', null, ui.icone('documento'), h('span', { text: n }))));
        buracos.forEach((b) => itens.push(h('li', { class: 'mt-erro-txt' }, h('span', { text: `Buraco ${km(b.ini)} – ${km(b.fim)} (${mTxt(b.fim - b.ini)}) · ${b.eh}${onde(b)}` }))));
        s.sobreposicoes.forEach((o) => itens.push(h('li', { class: 'mt-atencao-txt' }, h('span', { text: `Medido 2× ${km(o.ini)} – ${km(o.fim)} (${mTxt(o.fim - o.ini)}): ${o.arquivos.join(' e ')}. Recorte um dos arquivos.` }))));
        if (!s.arquivos.length) itens.push(h('li', { class: 'mt-sub', text: 'Nenhum arquivo desta sede ainda.' }));
        linhasTabela.push(h('tr', { class: 'mt-detalhe' }, h('td', { colspan: 7 }, h('ul', { class: 'mt-lista' }, itens))));
      }
    });
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'mt-linha-cab' }, h('h2', { text: `Linha ${l.linha}` }), h('span', { class: 'mt-sub', text: `${pctTxt(l.pct)} · falta ${kmTxt(Math.max(0, l.necessario - l.coberto))} de ${kmTxt(l.necessario)}` })),
      faixa(l, ini, fim),
      h('div', { class: 'mt-legenda' }, ['mt-cob:Medido', 'mt-bur:Buraco', 'mt-sob:Medido 2×', 'mt-nec:Falta medir'].map((x) => { const [c, t] = x.split(':'); return h('span', null, h('i', { class: c }), t); })),
      h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela mt-tabela' },
        h('thead', null, h('tr', null, ['Sede', 'Trecho', 'Medido', 'Falta', 'Buracos', 'Arquivos', 'Divisa'].map((t) => h('th', { text: t })))),
        h('tbody', null, linhasTabela))));
  }

  function campoKm(valor, aoMudar, placeholder) {
    return h('input', {
      type: 'text', inputmode: 'decimal', class: 'mt-km', placeholder, value: valor === null || valor === undefined ? '' : km(valor),
      onchange: (e) => {
        const t = e.target.value.trim();
        if (!t) { aoMudar(null); return; }
        const m = B().kmParaMetros(t);
        if (m === null || Number.isNaN(m)) { ui.toast('Km inválido. Use 290+000 ou 290,5.', 'erro'); e.target.value = valor === null || valor === undefined ? '' : km(valor); return; }
        aoMudar(m);
      }
    });
  }

  function cartaoArquivos(lista, conferencia) {
    if (!lista.length) {
      return h('section', { class: 'cartao' }, h('h2', { text: 'Arquivos' }), h('p', { class: 'vazio', text: 'Nenhum arquivo neste ciclo. Adicione os arquivos do carro (.csv ou .zip).' }));
    }
    const ordem = [...lista].sort((a, b) => (a.resumo.ramal + a.resumo.linhaRef).localeCompare(b.resumo.ramal + b.resumo.linhaRef) || Math.min(a.resumo.kmIni, a.resumo.kmFim) - Math.min(b.resumo.kmIni, b.resumo.kmFim));
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: `Arquivos (${lista.length})` }),
      ordem.map((a) => {
        const r = a.resumo;
        const conf = conferencia.find((c) => c.id === a.id) || { trechos: [], avisos: [] };
        const avisos = [...conf.avisos, ...r.inconsistencias];
        const ondeCaiu = [...new Map(conf.trechos.map((t) => [`${t.linha}|${t.sede}`, t])).values()].map((t) => `L${t.linha} ${C().normSede(t.sede)} ${kmTxt(t.m)}`).join(' · ');
        const erros = avisos.filter((x) => x.tipo === 'erro').length; const alertas = avisos.filter((x) => x.tipo === 'alerta').length;
        const mudarRecorte = async (campo, v) => {
          a.recorte = { de: null, ate: null, ...(a.recorte || {}), [campo]: v };
          if (a.recorte.de === null && a.recorte.ate === null) a.recorte = null;
          await gravar(); render();
        };
        return h('details', { class: 'mt-arquivo' },
          h('summary', null,
            h('span', { class: `mt-ponto ${erros ? 'mt-erro' : alertas ? 'mt-alerta' : 'mt-ok'}` }),
            h('strong', { text: a.nome }),
            h('span', { class: 'mt-sub', text: ` · ${r.corretiva || '—'} · ${r.ramal || r.meta.ramal || '—'} L${r.linhaRef} · ${km(r.kmIni)} → ${km(r.kmFim)}${a.recorte ? ' · recortado' : ''}` }),
            avisos.length ? h('span', { class: 'mt-cont', text: `${avisos.length} aviso(s)` }) : null),
          h('div', { class: 'pilha mt-arquivo-corpo' },
            h('p', { class: 'mt-sub', text: `Caiu em: ${ondeCaiu || '—'} · correção do km pela geometria ${Math.round(r.correcao.min)} a ${Math.round(r.correcao.max)} m · ${r.correcao.casadas}/${r.correcao.curvas} curvas casadas` }),
            avisos.length ? h('ul', { class: 'mt-lista' }, avisos.map((x) => h('li', { class: x.tipo === 'erro' ? 'mt-erro-txt' : x.tipo === 'alerta' ? 'mt-atencao-txt' : 'mt-sub', text: x.texto }))) : h('p', { class: 'mt-sub', text: 'Sem inconsistências.' }),
            h('div', { class: 'grade-3' },
              ui.campo('Usar a partir do km', campoKm(a.recorte && a.recorte.de, (v) => mudarRecorte('de', v), 'início')),
              ui.campo('Até o km', campoKm(a.recorte && a.recorte.ate, (v) => mudarRecorte('ate', v), 'fim')),
              h('div', { class: 'mt-acao' }, h('button', { class: 'btn btn-fantasma', onclick: () => remover(a) }, ui.icone('lixo'), 'Remover')))));
      }));
  }

  function render() {
    if (!raiz) return;
    const lista = doCiclo();
    const partes = [cabecalho()];
    if (planta) {
      const ramal = ramalEscolhido();
      const linhas = C().montar(planta, ramal, lista);
      const conferencia = C().conferirArquivos(planta, lista);
      const outros = lista.filter((a) => a.resumo.ramal && a.resumo.ramal !== ramal);
      partes.push(resumoGeral(linhas));
      if (outros.length) partes.push(h('p', { class: 'aviso', text: `${outros.length} arquivo(s) deste ciclo são de outro ramal (${[...new Set(outros.map((a) => a.resumo.ramal))].join(', ')}): escolha o ramal acima para vê-los.` }));
      linhas.forEach((l) => partes.push(cartaoLinha(l)));
      partes.push(cartaoArquivos(lista, conferencia));
    }
    ui.trocar(raiz, ...partes);
  }

  App.montagem = {
    async montar(el) { raiz = el; await carregar(); render(); },
    async aoMostrar() { if (!raiz) return; planta = App.analise && App.analise.planta ? await App.analise.planta() : planta; render(); }
  };
})(window.App);
