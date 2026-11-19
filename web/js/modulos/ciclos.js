/*
 * Ciclos anteriores: arquivar um ciclo da Montagem no Google Drive e consultar depois por trecho (km),
 * sem baixar os arquivos inteiros.
 *  - Arquivar: cada arquivo do ciclo é separado em blocos de 1 km por ramal/linha, já com os ajustes da Montagem
 *    (km corrigido, linha corrigida, sem cortes e sem LOCOM). Os blocos de um arquivo vão num "contêiner" no Drive
 *    e o indice.json do ciclo diz onde está cada bloco. Depois, o ciclo sai da Montagem (fica leve).
 *  - Consultar: ciclo, ramal, linha e km de/até → o servidor devolve só os blocos do trecho; cada arquivo que passou
 *    por ali abre na Análise ou na Tela do carro (o km já vem corrigido).
 */
'use strict';

(function (App) {
  const { U, ui } = App;
  const { h } = ui;
  const C = () => App.cobertura;
  const B = () => App.bitola;
  const BLOCO = 1000; // m
  const MAX_CONTEINER = 15 * 1024 * 1024; // bytes por contêiner (cabe numa chamada ao servidor)
  const MAX_KM_CONSULTA = 50;

  let raiz;
  let ciclosDrive = null; // [{ ciclo, indice }]
  let erroDrive = '';
  let ocupado = false;
  let progresso = '';
  let consulta = null; // { ciclo, ramal, linha, de, ate, arquivos: [{ nome, info, texto, de, ate, pontos }] }

  const api = () => App.api;
  const nuvemOk = () => !!(api() && api().configurado());
  const nomeCiclo = (c) => (c ? `Ciclo ${c}` : 'Sem ciclo');
  const kmTxt = (m) => B().fmtKm(m);

  /** "328+500", "328,5" ou "328.5" → metros. */
  function lerKm(t) {
    const s = String(t || '').trim().replace(/\s/g, '');
    if (!s) return null;
    const m = /^(\d+)\+(\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) return Number(m[1]) * 1000 + Number(m[2].replace(',', '.'));
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n * 1000 : null;
  }

  const gzip = async (texto) => new Uint8Array(await new Response(new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const gunzip = async (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const base64 = (bytes) => new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => falha(r.error);
    r.readAsDataURL(new Blob([bytes]));
  });
  const deBase64 = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k); return out; };
  const nomeSeguro = (n) => String(n).replace(/[^\w.\-]/g, '_');

  async function lerDrive() {
    if (!nuvemOk()) return;
    try { ciclosDrive = await api().chamar('cicloListar', {}); erroDrive = ''; } catch (e) { erroDrive = e.message; }
    render();
  }

  /* ---------------- Arquivar ---------------- */

  /** Assinatura dos ajustes: arquivo já arquivado com os mesmos ajustes não sobe de novo (retomar de onde parou). */
  const assinatura = (a) => JSON.stringify([a.id, a.recorte || null, a.compensar || [], a.linhas || null, a.resumo.versao, a.resumo.pontos]);

  async function arquivar(c) {
    if (ocupado) return;
    const lista = await App.montagem.doCiclo(c);
    if (!lista.length) return;
    const atual = (App.montagem.ciclo() || '') === (c || '');
    const msg = `${lista.length} arquivo(s) de ${nomeCiclo(c).toLowerCase()} vão para o Google Drive, separados por km e com os ajustes da Montagem. Pode levar alguns minutos.${atual ? ' Atenção: é o ciclo atual da Montagem.' : ''}`;
    if (!(await ui.confirmar('Arquivar ciclo', msg, { ok: 'Arquivar' }))) return;
    ocupado = true;
    const falhas = [];
    try {
      const existente = (await api().chamar('cicloListar', { ciclo: c || 'sem-ciclo' }))[0];
      const indice = existente ? existente.indice : { versao: 1, ciclo: c || '', arquivos: {}, blocos: {} };
      for (let k = 0; k < lista.length; k++) {
        const a = lista[k];
        const passo = `${k + 1}/${lista.length}`;
        const sig = assinatura(a);
        if (indice.arquivos[a.nome] && indice.arquivos[a.nome].sig === sig) continue; // já arquivado
        const r = a.resumo;
        if (a.antigo || !r.ramal) { falhas.push(`${a.nome}: ${a.antigo ? 'sem o CSV guardado' : 'ramal fora da geometria'}`); continue; }
        progresso = `Separando ${a.nome} (${passo})…`; render();
        await new Promise((ok) => setTimeout(ok, 30));
        try {
          const texto = await App.montagem.lerCsv(a.id);
          if (!texto) throw new Error('CSV não guardado neste aparelho');
          const { partes, desc } = C().blocosDoArquivo(texto, r, { cortes: a.recorte, tamanho: BLOCO });
          // contêineres: blocos compactados um atrás do outro
          const conteineres = [];
          const pos = [];
          let atualC = null;
          for (const p of partes) {
            const bytes = await gzip(p.texto);
            if (!atualC || atualC.tam + bytes.length > MAX_CONTEINER) {
              atualC = { nome: `${nomeSeguro(a.nome)}.${conteineres.length + 1}.bin`, pedacos: [], tam: 0 };
              conteineres.push(atualC);
            }
            pos.push({ p, c: atualC.nome, o: atualC.tam, t: bytes.length });
            atualC.pedacos.push(bytes); atualC.tam += bytes.length;
          }
          for (let q = 0; q < conteineres.length; q++) {
            const ct = conteineres[q];
            progresso = `Enviando ${a.nome} (${passo})${conteineres.length > 1 ? ` parte ${q + 1}/${conteineres.length}` : ''}…`; render();
            const tudo = new Uint8Array(ct.tam);
            let o = 0; ct.pedacos.forEach((b) => { tudo.set(b, o); o += b.length; });
            await api().chamar('cicloEnviar', { ciclo: c || 'sem-ciclo', nome: ct.nome, base64: await base64(tudo) });
          }
          // índice: tira o que havia deste arquivo e põe os blocos novos
          Object.keys(indice.blocos).forEach((ch) => {
            indice.blocos[ch] = indice.blocos[ch].filter((x) => x.a !== a.nome);
            if (!indice.blocos[ch].length) delete indice.blocos[ch];
          });
          pos.forEach(({ p, c: cn, o, t }) => {
            const ch = `${r.ramal}|${p.linha}|${p.bloco}`;
            (indice.blocos[ch] = indice.blocos[ch] || []).push({ a: a.nome, c: cn, o, t, de: Math.round(p.de), ate: Math.round(p.ate), p: p.pontos });
          });
          indice.arquivos[a.nome] = {
            sig, id: a.id, ramal: r.ramal, data: (r.meta && r.meta.data) || '', corretiva: r.corretiva || '', desc,
            linhas: [...new Set(partes.map((p) => p.linha))], pontos: r.pontos, conteineres: conteineres.map((x) => x.nome), arquivadoEm: new Date().toISOString()
          };
          indice.atualizadoEm = new Date().toISOString();
          await api().chamar('cicloIndiceSalvar', { ciclo: c || 'sem-ciclo', conteudo: JSON.stringify(indice) });
        } catch (e) { falhas.push(`${a.nome}: ${e.message}`); }
      }
      progresso = '';
      await lerDrive();
      if (falhas.length) {
        ui.toast(`Arquivamento incompleto (${falhas.length} arquivo(s) com problema). Rode de novo: os já enviados não sobem outra vez.`, 'erro', 9000);
        progresso = `Com problema: ${falhas.join(' · ')}`;
      } else {
        ui.toast(`${nomeCiclo(c)} arquivado no Google Drive.`, 'ok', 5000);
        if (await ui.confirmar('Tirar da Montagem', `${nomeCiclo(c)} está arquivado e pode ser consultado aqui por trecho. Tirar os ${lista.length} arquivo(s) dele da Montagem (deixa o app leve)?`, { ok: 'Tirar da Montagem', perigo: true })) {
          const n = await App.montagem.removerCiclo(c);
          ui.toast(`${n} arquivo(s) saíram da Montagem.`, 'ok', 4000);
        }
      }
    } catch (e) {
      progresso = `Não foi possível arquivar: ${e.message}`;
    }
    ocupado = false;
    render();
  }

  /* ---------------- Consultar ---------------- */

  async function consultar({ ciclo, ramal, linha, de, ate }) {
    const item = (ciclosDrive || []).find((x) => x.ciclo === ciclo);
    if (!item) return;
    if (de > ate) [de, ate] = [ate, de];
    if (ate - de > MAX_KM_CONSULTA * 1000) { ui.toast(`Consulte até ${MAX_KM_CONSULTA} km por vez.`, 'erro', 5000); return; }
    const ind = item.indice;
    const entradas = [];
    for (let b = Math.floor(de / BLOCO); b <= Math.floor(ate / BLOCO); b++) {
      (ind.blocos[`${ramal}|${linha}|${b}`] || []).forEach((x) => { if (x.ate >= de - 1 && x.de <= ate + 1) entradas.push({ ...x, bloco: b }); });
    }
    consulta = { ciclo, ramal, linha, de, ate, arquivos: [] };
    if (!entradas.length) { render(); return; }
    ocupado = true; progresso = `Buscando ${entradas.length} bloco(s) no Google Drive…`; render();
    try {
      // em lotes (cada resposta do servidor tem limite de tamanho)
      const lotes = [];
      let lote = []; let tam = 0;
      entradas.forEach((x) => { if (lote.length && tam + x.t > 12 * 1024 * 1024) { lotes.push(lote); lote = []; tam = 0; } lote.push(x); tam += x.t; });
      if (lote.length) lotes.push(lote);
      const textos = new Map();
      for (const l of lotes) {
        const r = await api().chamar('cicloTrechos', { ciclo, pedidos: l.map(({ c, o, t }) => ({ c, o, t })) });
        for (let k = 0; k < l.length; k++) textos.set(l[k], await gunzip(deBase64(r[k].base64)));
      }
      const porArquivo = new Map();
      entradas.forEach((x) => { if (!porArquivo.has(x.a)) porArquivo.set(x.a, []); porArquivo.get(x.a).push(x); });
      consulta.arquivos = [...porArquivo.entries()].map(([nome, xs]) => {
        xs.sort((p, q) => p.bloco - q.bloco);
        const info = ind.arquivos[nome] || {};
        return {
          nome, info,
          texto: C().juntarPartes(xs.map((x) => textos.get(x)), !!info.desc),
          de: Math.max(de, Math.min(...xs.map((x) => x.de))), ate: Math.min(ate, Math.max(...xs.map((x) => x.ate))),
          pontos: xs.reduce((s, x) => s + x.p, 0)
        };
      }).sort((p, q) => String(p.info.data).localeCompare(String(q.info.data)) || p.nome.localeCompare(q.nome));
      progresso = '';
    } catch (e) {
      progresso = `Não foi possível consultar: ${e.message}`;
    }
    ocupado = false;
    render();
  }

  let abertoNome = '';
  async function abrir(x, aba, embutido = false) {
    const q = consulta;
    abertoNome = `${x.nome} · ${kmTxt(q.de)} a ${kmTxt(q.ate)}`;
    if (embutido) { U.pref.set(`ciclos:aberto:${aba}`, false); render(); } // recolhe para o arquivo aparecer
    const nome = `${x.nome} · ${nomeCiclo(q.ciclo)} · ${kmTxt(q.de)} a ${kmTxt(q.ate)}`;
    window.dispatchEvent(new CustomEvent('em80:checklist-aba', { detail: aba }));
    await new Promise((r) => setTimeout(r, 30));
    App.analise.abrirTexto(x.texto, nome, { kmFixo: true, cortes: [{ de: null, ate: q.de - 1e-6 }, { de: q.ate + 1e-6, ate: null }] });
    if (aba === 'tela' && App.telaCarro && App.telaCarro.aoMostrar) App.telaCarro.aoMostrar();
  }

  /* ---------------- Tela ---------------- */

  function cartaoConsulta(aba = null) {
    const lista = ciclosDrive || [];
    if (!lista.length) {
      return h('div', { class: 'pilha' }, aba ? null : h('h2', { text: 'Consultar trecho' }),
        h('p', { class: 'sub', text: erroDrive ? `Não foi possível ler o Google Drive: ${erroDrive}` : ciclosDrive ? 'Nenhum ciclo arquivado ainda.' : 'Lendo o Google Drive…' }));
    }
    const pref = U.pref.get('ciclos:consulta', {}) || {};
    const cicloSel = lista.some((x) => x.ciclo === pref.ciclo) ? pref.ciclo : lista[lista.length - 1].ciclo;
    const ind = lista.find((x) => x.ciclo === cicloSel).indice;
    const chaves = Object.keys(ind.blocos).map((k) => k.split('|'));
    const ramais = [...new Set(chaves.map((k) => k[0]))].sort();
    const ramalSel = ramais.includes(pref.ramal) ? pref.ramal : ramais[0];
    const linhas = [...new Set(chaves.filter((k) => k[0] === ramalSel).map((k) => k[1]))].sort();
    const linhaSel = linhas.includes(pref.linha) ? pref.linha : linhas[0];
    const blocos = chaves.filter((k) => k[0] === ramalSel && k[1] === linhaSel).map((k) => Number(k[2]));
    const salvar = (k, v) => { U.pref.set('ciclos:consulta', { ...pref, [k]: v }); render(); };
    const de = h('input', { type: 'text', inputmode: 'decimal', value: pref.de || '', placeholder: 'ex.: 328+500' });
    const ate = h('input', { type: 'text', inputmode: 'decimal', value: pref.ate || '', placeholder: 'ex.: 330' });
    const buscar = () => {
      const a = lerKm(de.value); const b = lerKm(ate.value);
      if (a === null || b === null) { ui.toast('Informe o km de e até (ex.: 328+500 ou 328,5).', 'erro', 4000); return; }
      U.pref.set('ciclos:consulta', { ...pref, ciclo: cicloSel, ramal: ramalSel, linha: linhaSel, de: de.value.trim(), ate: ate.value.trim() });
      consultar({ ciclo: cicloSel, ramal: ramalSel, linha: linhaSel, de: a, ate: b });
    };
    const faixa = blocos.length ? `km ${Math.min(...blocos)} a ${Math.max(...blocos) + 1}` : '';
    return h('div', { class: 'pilha' },
      aba ? null : h('h2', { text: 'Consultar trecho' }),
      h('div', { class: 'grade-4' },
        ui.campo('Ciclo', h('select', { onchange: (e) => salvar('ciclo', e.target.value) }, lista.map((x) => h('option', { value: x.ciclo, selected: x.ciclo === cicloSel || null, text: x.ciclo === 'sem-ciclo' ? 'Sem ciclo' : x.ciclo })))),
        ui.campo('Ramal', h('select', { onchange: (e) => salvar('ramal', e.target.value) }, ramais.map((r) => h('option', { value: r, selected: r === ramalSel || null, text: r })))),
        ui.campo('Linha', h('select', { onchange: (e) => salvar('linha', e.target.value) }, linhas.map((l) => h('option', { value: l, selected: l === linhaSel || null, text: `L${l}` })))),
        h('div')),
      h('div', { class: 'grade-4' },
        ui.campo('Km de', de), ui.campo('Km até', ate),
        h('div', { class: 'mt-acao' }, h('button', { class: 'btn btn-primario', disabled: ocupado || null, onclick: buscar }, ui.icone('busca'), 'Consultar'))),
      faixa ? h('small', { class: 'sub', text: `Arquivado nesta linha: ${faixa}` }) : null,
      resultadoConsulta(aba));
  }

  function resultadoConsulta(aba) {
    const q = consulta;
    if (!q) return null;
    if (!q.arquivos.length) return ocupado ? null : h('p', { class: 'sub', text: `Nenhum arquivo do ${nomeCiclo(q.ciclo).toLowerCase()} passou por ${q.ramal} L${q.linha} entre ${kmTxt(q.de)} e ${kmTxt(q.ate)}.` });
    // lista (cabe no celular): um arquivo por linha, com os botões embaixo
    return h('div', { class: 'pilha-p', 'data-ci-resultado': '' },
      h('small', { class: 'sub', text: `${q.arquivos.length} arquivo(s) em ${q.ramal} L${q.linha}, ${kmTxt(q.de)} a ${kmTxt(q.ate)}` }),
      q.arquivos.map((x) => h('div', { class: 'item ci-item' },
        h('div', { class: 'item-principal' },
          h('strong', { text: x.nome }),
          h('div', { class: 'item-sub', text: `${x.info.data || '—'} · ${x.info.corretiva || '—'} · ${kmTxt(x.de)} → ${kmTxt(x.ate)}` }),
          h('div', { class: 'linha-acoes' }, aba
            ? h('button', { class: 'btn btn-pequeno', onclick: () => abrir(x, aba, true) }, ui.icone(aba === 'tela' ? 'play' : 'grafico'), 'Abrir')
            : [h('button', { class: 'btn btn-pequeno', onclick: () => abrir(x, 'analise') }, ui.icone('grafico'), 'Análise'),
              h('button', { class: 'btn btn-pequeno', onclick: () => abrir(x, 'tela') }, ui.icone('play'), 'Tela do carro')])))));
  }

  async function cartaoArquivar() {
    const locais = (await App.montagem.ciclos()).sort((a, b) => String(a.ciclo).localeCompare(String(b.ciclo)));
    const noDrive = new Map((ciclosDrive || []).map((x) => [x.ciclo, x.indice]));
    const atual = App.montagem.ciclo() || '';
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Arquivar ciclo' }),
      !locais.length ? h('p', { class: 'sub', text: 'Nenhum arquivo na Montagem.' }) : h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
        h('thead', {}, h('tr', {}, ['Ciclo', 'Arquivos na Montagem', 'No Google Drive', ''].map((t) => h('th', { text: t })))),
        h('tbody', {}, locais.map((x) => {
          const ind = noDrive.get(x.ciclo || 'sem-ciclo');
          const qtdDrive = ind ? Object.keys(ind.arquivos).length : 0;
          return h('tr', {},
            h('td', { text: `${nomeCiclo(x.ciclo)}${x.ciclo === atual ? ' (atual)' : ''}` }),
            h('td', { text: String(x.qtd) }),
            h('td', { text: qtdDrive ? `${qtdDrive} arquivo(s)` : '—' }),
            h('td', {}, h('button', { class: 'btn btn-pequeno', disabled: ocupado || !nuvemOk() || null, onclick: () => arquivar(x.ciclo) }, ui.icone('nuvem'), 'Arquivar')));
        })))),
      progresso ? h('p', { class: /^(Com problema|Não foi)/.test(progresso) ? 'aviso aviso-erro' : 'sub', text: progresso }) : null);
  }

  /* Consulta dentro da Análise do arquivo e da Tela do carro (fechada até abrir; lê o Drive só ao abrir) */
  const embutidos = []; // [{ el, aba }]
  function renderEmbutido({ el, aba }) {
    if (!nuvemOk()) { ui.trocar(el); return; }
    const chave = `ciclos:aberto:${aba}`;
    const aberto = !!U.pref.get(chave, false);
    const det = h('details', { class: 'cartao ci-embutido', open: aberto || null },
      h('summary', {}, h('strong', { text: 'Consultar ciclo anterior' }), abertoNome ? h('small', { class: 'sub', text: ` · aberto: ${abertoNome}` }) : null),
      aberto ? cartaoConsulta(aba) : null,
      aberto && progresso && !/^(Separando|Enviando)/.test(progresso) ? h('p', { class: /^(Com problema|Não foi)/.test(progresso) ? 'aviso aviso-erro' : 'sub', text: progresso }) : null);
    det.addEventListener('toggle', () => {
      if (det.open === aberto) return;
      U.pref.set(chave, det.open);
      renderEmbutido({ el, aba });
      if (det.open && !ciclosDrive) lerDrive();
    });
    ui.trocar(el, det);
  }

  let renderizando = 0;
  async function render() {
    embutidos.forEach(renderEmbutido);
    if (!raiz) return;
    const vez = ++renderizando;
    if (!nuvemOk()) {
      ui.trocar(raiz, h('section', { class: 'cartao pilha' }, h('h1', { text: 'Ciclos anteriores' }),
        h('p', { class: 'sub', text: 'Configure o servidor (Ajustes) para arquivar e consultar ciclos no Google Drive.' })));
      return;
    }
    const arq = await cartaoArquivar();
    if (vez !== renderizando) return;
    ui.trocar(raiz, h('section', { class: 'cartao pilha' },
      h('div', { class: 'tela-cab' }, h('h1', { text: 'Ciclos anteriores' }),
        h('button', { class: 'btn btn-pequeno', disabled: ocupado || null, onclick: () => { ciclosDrive = null; render(); lerDrive(); } }, ui.icone('sync'), 'Atualizar'))),
    h('section', { class: 'cartao pilha' }, cartaoConsulta()), arq);
  }

  App.ciclos = {
    montar(el) { raiz = el; render(); lerDrive(); },
    aoMostrar() { render(); if (!ocupado) lerDrive(); },
    /** Põe a consulta (recolhível) no topo de outra aba; "aba" diz onde o arquivo abre ('analise' ou 'tela'). */
    embutir(el, aba) {
      const e = { el, aba };
      embutidos.push(e);
      renderEmbutido(e);
      if (U.pref.get(`ciclos:aberto:${aba}`, false) && !ciclosDrive) lerDrive();
    },
    lerKm
  };
})(window.App);
