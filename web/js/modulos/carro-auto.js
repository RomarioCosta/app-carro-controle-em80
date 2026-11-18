/*
 * Tela "Buscar do carro": conversa com o script do Windows (automacao/buscar-carro).
 * O app só LÊ a pasta Documentos\Carro Controle (empresas costumam bloquear a gravação pelo navegador)
 * e manda os pedidos como um arquivo baixado (pasta Downloads), que o agendamento do script confere a cada minuto
 * (o Windows da empresa não deixa o navegador abrir programas):
 *   carro-controle-pedido.json   busca agora (período, sedes, só novos/todos)
 *   carro-controle-config.json   o script grava a configuração
 * O que o script grava na pasta:
 *   estado.json        o script grava o resultado da última busca (pedidoId diz qual pedido terminou)
 *   catalogo.json      o script lista todos os CSV do carro (nome, sede, data) a cada busca
 *   configuracao.json  busca automática (intervalo, horário, avisos…), lida pelo script
 *   Todos\, Novos\     arquivos copiados (Novos = ainda não trazidos para a Montagem)
 * Nome dos arquivos do carro: RAMAL_SEDE_AAAAMMDD… (ex.: RLT_CP_20261117).
 * Só funciona onde o navegador dá acesso a pastas (Chrome/Edge no computador).
 */
'use strict';

(function (App) {
  const { h } = App.ui;
  const ui = App.ui;
  const U = App.U;
  const store = App.store;
  const CHAVE = 'carroAuto:pasta';
  const suportado = () => typeof window.showDirectoryPicker === 'function';

  const PADRAO = {
    ativo: true, intervaloMin: 120, horaIni: '', horaFim: '', origens: [], ignorar: ['teste'], dias: 10,
    avisos: 'sempre', avisarSemCabo: true, segundosAviso: 30, modoWifi: 'desconectar', atualizarAuto: true
  };
  const INTERVALOS = [[30, '30 min'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [240, '4 horas'], [360, '6 horas'], [480, '8 horas']];
  const MAX_LINHAS = 400;

  let raiz = null;
  let pasta = null; // FileSystemDirectoryHandle
  let permitido = false;
  let estado = null;
  let config = null;
  let catalogo = null;
  let historico = []; // historico.jsonl: uma busca por linha (mais nova primeiro)
  let logLinhas = []; // fim do log.txt
  let emTodos = new Set();
  let emNovos = new Set();
  let naMontagem = new Set();
  let marcados = new Set();
  let buscando = null; // { id, inicio }
  let pedidoSimples = null; // hora da busca pedida no modo simples (o app não acompanha: botão Ver resultado)
  let trazendo = false;
  let erro = '';
  let falhaPicker = ''; // erro da janela de pasta do Chrome (aí mostra o modo simples em destaque)
  let passo = ''; // o que aconteceu ao escolher a pasta (aparece na tela, para o diagnóstico)
  let timer = null;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const filtro = U.pref.get('carroAuto:filtro', null) || { de: diasAtras(7), ate: hoje(), sedes: '', modo: 'novos' };
  const salvarFiltro = () => U.pref.set('carroAuto:filtro', filtro);
  const sedesDoFiltro = () => filtro.sedes.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

  /**
   * Lista vinda do script. O PowerShell 5.1 às vezes grava a lista como {"value":[...],"Count":1}
   * (ou um texto só): aqui sempre vira lista.
   */
  const arr = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.value) ? v.value : v === null || v === undefined || v === '' ? [] : [v]);

  /** RLT_CP_20261117… → { ramal, sede, data: '2026-11-17' } */
  function infoNome(nome) {
    const m = /^([A-Za-z0-9]+)_([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})/.exec(nome);
    return m ? { ramal: m[1].toUpperCase(), sede: m[2].toUpperCase(), data: `${m[3]}-${m[4]}-${m[5]}` } : { ramal: '', sede: '', data: '' };
  }

  /* ---------- arquivos ---------- */

  const semBom = (t) => t.replace(/^﻿/, '');
  async function lerTexto(nome) {
    try { return semBom(await (await (await pasta.getFileHandle(nome)).getFile()).text()); } catch (e) { return ''; }
  }
  async function lerJson(nome) {
    try { return JSON.parse(semBom(await (await (await pasta.getFileHandle(nome)).getFile()).text())); } catch (e) { return null; }
  }

  async function subpasta(nome) {
    try { return await pasta.getDirectoryHandle(nome); } catch (e) { return null; }
  }
  async function nomesEm(nome) {
    const s = new Set();
    const d = await subpasta(nome);
    if (d) for await (const [n, hd] of d.entries()) if (hd.kind === 'file') s.add(n);
    return s;
  }
  async function temPermissao(pedir) {
    if (!pasta) return false;
    if (typeof pasta.queryPermission !== 'function') return true;
    const op = { mode: 'read' };
    if ((await pasta.queryPermission(op)) === 'granted') return true;
    return pedir ? (await pasta.requestPermission(op)) === 'granted' : false;
  }

  async function ler() {
    erro = '';
    permitido = await temPermissao(false).catch(() => false);
    if (!permitido) return;
    estado = await lerJson('estado.json');
    config = await lerJson('configuracao.json');
    catalogo = await lerJson('catalogo.json');
    historico = (await lerTexto('historico.jsonl')).split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
    logLinhas = (await lerTexto('log.txt')).split(/\r?\n/).filter(Boolean).slice(-150);
    emTodos = await nomesEm('Todos');
    emNovos = await nomesEm('Novos');
    naMontagem = new Set(App.montagem && App.montagem.nomes ? await App.montagem.nomes() : []);
  }

  async function atualizar() {
    if (!suportado() || !raiz) return;
    try {
      if (!pasta) {
        const salvo = await store.get(CHAVE).catch(() => null);
        pasta = salvo && typeof salvo.getDirectoryHandle === 'function' ? salvo : null; // só pasta de verdade (não o modo simples)
      }
      if (pasta) await ler();
    } catch (e) {
      erro = e.message;
    }
    render();
  }

  const marcar = (t) => { passo = t; const el = raiz && raiz.querySelector('[data-bc-passo]'); if (el) el.textContent = t; };
  /**
   * Modo simples: a pasta escolhida pelo campo de arquivos do navegador (input webkitdirectory), que funciona
   * mesmo quando a janela de pasta do Chrome (showDirectoryPicker) não liga. Vira um objeto com as mesmas
   * funções de leitura da pasta de verdade; é uma foto da pasta (não atualiza sozinha).
   */
  function pastaVirtual(files) {
    const lista = [...files].filter((f) => f.webkitRelativePath);
    const lidaEm = new Date();
    const no = (nome) => ({ nome, arquivos: new Map(), pastas: new Map() });
    const raizNo = no((lista[0] && lista[0].webkitRelativePath.split('/')[0]) || 'pasta');
    lista.forEach((f) => {
      const partes = f.webkitRelativePath.split('/').slice(1);
      let atual = raizNo;
      partes.slice(0, -1).forEach((p) => { if (!atual.pastas.has(p)) atual.pastas.set(p, no(p)); atual = atual.pastas.get(p); });
      atual.arquivos.set(partes[partes.length - 1], f);
    });
    const arq = (n, f) => ({ kind: 'file', name: n, getFile: async () => f });
    const dir = (n0) => ({
      kind: 'directory', name: n0.nome, virtual: true, lidaEm: lidaEm,
      async getFileHandle(n) { if (!n0.arquivos.has(n)) throw new DOMException(`${n} não encontrado`, 'NotFoundError'); return arq(n, n0.arquivos.get(n)); },
      async getDirectoryHandle(n) { if (!n0.pastas.has(n)) throw new DOMException(`${n} não encontrada`, 'NotFoundError'); return dir(n0.pastas.get(n)); },
      async *entries() { for (const [n, f] of n0.arquivos) yield [n, arq(n, f)]; for (const [n, p] of n0.pastas) yield [n, dir(p)]; },
      async removeEntry() { throw new DOMException('somente leitura', 'NotAllowedError'); }
    });
    return dir(raizNo);
  }
  const ehVirtual = () => !!(pasta && pasta.virtual);

  function escolherSimples() {
    const input = h('input', { type: 'file', webkitdirectory: '', multiple: '', hidden: true });
    input.addEventListener('change', async () => {
      if (!input.files || !input.files.length) { marcar('Nenhum arquivo na pasta escolhida (a pasta Novos vazia é normal; escolha a Carro Controle).'); return; }
      await ligar(pastaVirtual(input.files));
      input.remove();
    });
    document.body.appendChild(input);
    marcar('Abrindo a janela de escolha da pasta (modo simples)…');
    input.click();
  }

  /** Liga a pasta escolhida (de verdade ou do modo simples). */
  async function ligar(d0) {
    let d = d0;
    try {
      const tem = async (dir, nome, tipo) => { try { await (tipo === 'pasta' ? dir.getDirectoryHandle(nome) : dir.getFileHandle(nome)); return true; } catch (e) { return false; } };
      // escolheu Documentos: entra na "Carro Controle" que o script cria
      if (await tem(d, 'Carro Controle', 'pasta')) { d = await d.getDirectoryHandle('Carro Controle'); marcar(`Pasta escolhida: Documentos → ${d.name}. Lendo…`); }
      // escolheu a pasta do script (onde estão o .bat e o .ps1): não é ali que ficam os arquivos
      else if (await tem(d, 'buscar-carro.ps1')) {
        ui.toast('Essa é a pasta do script. Os arquivos do carro ficam em Documentos > Carro Controle: escolha essa pasta.', 'erro', 12000);
        marcar(`"${d.name}" é a pasta do script, não a dos arquivos. Escolha Documentos > Carro Controle.`);
        return;
      }
      pasta = d;
      ui.toast(`Pasta ligada: ${d.name}`, 'ok', 3000);
      if (!d.virtual) await store.set(CHAVE, d).catch(() => {});
      if (!d.virtual) await temPermissao(true).catch(() => false);
      await ler();
      pedidoSimples = null;
      marcarProntos();
      marcar(permitido
        ? `Pasta ligada: ${d.name}${d.virtual ? ' (modo simples: depois de uma busca, abra a pasta de novo para atualizar)' : ''}${estado ? ` · última busca encontrada (script ${estado.versao || '?'})` : ' · ainda sem busca registrada'}`
        : `Pasta ${d.name} escolhida, mas o navegador não deu permissão de leitura. Clique em "Permitir acesso à pasta".`);
      if (permitido && !estado && !catalogo && !(await subpasta('Novos'))) ui.toast('Essa pasta ainda não tem nada do script. Ela deve ser Documentos > Carro Controle, criada na primeira vez que o "Buscar arquivos do carro.bat" roda.', 'info', 10000);
    } catch (e) {
      marcar(`Erro ao ler a pasta: ${e.name}: ${e.message}`);
    }
    try { render(); } catch (e) { marcar(`Erro ao mostrar: ${e.message}`); }
  }

  async function escolherPasta() {
    const t0 = Date.now();
    try {
      marcar('Abrindo a janela de escolha da pasta…');
      const d = await window.showDirectoryPicker({ id: 'carro-controle', mode: 'read', startIn: 'documents' });
      marcar(`Pasta escolhida: ${d.name}. Conferindo…`);
      await ligar(d);
    } catch (e) {
      // mostra o erro exato (nome, mensagem e em quanto tempo veio) e oferece o modo simples
      falhaPicker = `${e.name}: ${e.message} (${Date.now() - t0} ms)`;
      marcar(`A janela de pasta do Chrome não ligou: ${falhaPicker}. Use "Abrir a pasta (modo simples)".`);
      try { render(); } catch (e2) { /* segue */ }
    }
  }

  /** Para Buscar agora / Salvar sem pasta ligada: pede a pasta (ou a permissão) na hora. */
  async function garantirPasta() {
    if (pasta && permitido) return true;
    if (pasta) { await permitir(); return permitido; }
    await escolherPasta();
    return !!pasta && permitido;
  }

  async function permitir() {
    try { await temPermissao(true); await ler(); } catch (e) { erro = e.message; }
    render();
  }

  /* ---------- pedidos ao Windows (arquivo baixado na pasta Downloads) ---------- */

  function baixarPedido(nome, tipo, params) {
    const dados = { tipo, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === true ? '1' : v === false ? '0' : String(v ?? '')])) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }));
    const a = h('a', { href: url, download: nome });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---------- buscar agora ---------- */

  async function buscarAgora() {
    if (filtro.de && filtro.ate && filtro.de > filtro.ate) { ui.toast('A data inicial é depois da final.', 'erro', 5000); return; }
    try {
      const id = U.uuid().slice(0, 12);
      // o agendamento do script (a cada minuto) pega o pedido na pasta Downloads
      baixarPedido('carro-controle-pedido.json', 'buscar', { id, de: filtro.de || '', ate: filtro.ate || '', sedes: sedesDoFiltro().join(','), modo: filtro.modo });
      if (!pasta || !permitido) { ui.toast('Busca pedida: começa em até 1 minuto.', 'info', 6000); return; }
      if (ehVirtual()) { pedidoSimples = new Date(); render(); return; }
      buscando = { id, inicio: Date.now() };
      render();
      esperar();
    } catch (e) {
      ui.toast(`Não foi possível pedir a busca: ${e.message}`, 'erro', 6000);
    }
  }

  function esperar() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!buscando) return;
      const e = await lerJson('estado.json').catch(() => null);
      if (e && e.pedidoId === buscando.id) {
        buscando = null;
        await ler();
        const msg = { ok: `Busca concluída: ${e.novos || 0} arquivo(s) copiado(s).`, semCabo: 'O cabo de rede do carro não está conectado.', semAcesso: 'Não consegui acessar a pasta do carro.', semPasta: 'Nenhuma pasta do carro configurada.' }[e.resultado] || 'Busca concluída.';
        ui.toast(msg, e.resultado === 'ok' ? 'ok' : 'erro', 6000);
        marcarProntos();
        render();
        return;
      }
      if (Date.now() - buscando.inicio > 4 * 60000) {
        buscando = null;
        ui.toast('O Windows não pegou o pedido de busca. Confira se o arquivo carro-controle-pedido.json foi baixado na pasta Downloads.', 'erro', 12000);
        render();
        return;
      }
      const b = raiz && raiz.querySelector('[data-bc-buscar]');
      if (b && b.lastChild) b.lastChild.textContent = `Buscando… ${Math.round((Date.now() - buscando.inicio) / 1000)}s`;
      esperar();
    }, 2000);
  }

  function cancelarEspera() {
    buscando = null; clearTimeout(timer);
    render();
  }

  /* ---------- lista ---------- */

  function situacao(a) {
    if (a.teste) return ['teste', 'Teste'];
    if (naMontagem.has(a.nome)) return ['montagem', 'Na Montagem'];
    if (emNovos.has(a.nome)) return ['novo', 'Novo'];
    if (emTodos.has(a.nome)) return ['pronto', 'Pronto'];
    return ['carro', 'Só no carro'];
  }
  function listaFiltrada() {
    const sedes = sedesDoFiltro();
    // lista do carro (catalogo.json) + o que já está nas pastas Todos e Novos (copiados antes de existir a lista)
    const base = arr(catalogo && catalogo.arquivos).slice();
    const vistos = new Set(base.map((a) => a.nome));
    [...emTodos, ...emNovos].filter((n) => /\.csv$/i.test(n) && !vistos.has(n)).forEach((n) => { vistos.add(n); base.push({ nome: n }); });
    return base.map((a) => ({ ...infoNome(a.nome), ...a, data: a.data || infoNome(a.nome).data }))
      .filter((a) => (!filtro.de || !a.data || a.data >= filtro.de) && (!filtro.ate || !a.data || a.data <= filtro.ate) && (!sedes.length || sedes.includes(String(a.sede).toUpperCase())))
      .sort((a, b) => (b.data || '').localeCompare(a.data || '') || a.nome.localeCompare(b.nome));
  }
  const podeTrazer = (a) => ['novo', 'pronto'].includes(situacao(a)[0]);
  function marcarProntos() {
    marcados = new Set(listaFiltrada().filter((a) => podeTrazer(a)).map((a) => a.nome));
  }

  async function trazer() {
    const nomes = [...marcados].filter((n) => (emTodos.has(n) || emNovos.has(n)) && !naMontagem.has(n));
    if (!nomes.length) return;
    trazendo = true; render();
    try {
      const todos = await subpasta('Todos');
      const novosDir = await subpasta('Novos');
      const files = [];
      for (const n of nomes) files.push(await (await (emTodos.has(n) ? todos : novosDir).getFileHandle(n)).getFile());
      const feitos = (await App.montagem.adicionarArquivos(files)) || [];
      const novos = await subpasta('Novos');
      if (novos) for (const n of feitos) if (emNovos.has(n)) await novos.removeEntry(n).catch(() => {});
      await ler();
      feitos.forEach((n) => marcados.delete(n));
    } catch (e) {
      ui.toast(`Erro ao trazer os arquivos: ${e.message}`, 'erro', 8000);
    }
    trazendo = false; render();
  }

  /* ---------- tela ---------- */

  const dataHora = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
  };
  const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  // configuração: a do arquivo (gravada pelo script) e, se for mais nova, a última salva aqui (ainda não confirmada)
  const configLocal = () => U.pref.get('carroAuto:configLocal', null);
  const pendente = () => { const l = configLocal(); return !!(l && (!config || !config.salvoEm || new Date(l.salvoEm) > new Date(config.salvoEm) && l.salvoId !== config.salvoId)); };
  const efetiva = () => ({ ...PADRAO, ...((estado && estado.config) || {}), ...(config || {}), ...(pendente() ? configLocal() : {}) });

  function cartaoPasta() {
    const cab = h('h2', { text: 'Buscar arquivos do carro' });
    const linhaPasso = passo ? h('small', { class: 'sub', 'data-bc-passo': '', text: passo }) : null;
    if (!pasta || !permitido) {
      return h('section', { class: 'cartao pilha' }, cab,
        h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-primario', onclick: escolherSimples }, ui.icone('documento'), 'Abrir a pasta Carro Controle'),
          pasta && !permitido ? h('button', { class: 'btn', onclick: permitir, text: 'Permitir acesso' }) : null,
          h('button', { class: 'btn btn-fantasma', title: 'Pasta lembrada entre as sessões (se o Chrome deixar)', onclick: escolherPasta, text: 'Acesso permanente' })),
        linhaPasso);
    }
    const c = efetiva();
    let status = h('p', { class: 'sub', text: 'Nenhuma busca ainda.' });
    if (estado) {
      const msg = {
        ok: estado.novos ? `${estado.novos} arquivo(s) copiado(s)` : 'nenhum arquivo novo',
        semCabo: 'cabo do carro não conectado',
        semAcesso: `sem acesso a ${arr(estado.semAcesso).join(', ') || 'pasta do carro'}`,
        semPasta: 'pasta do carro não configurada'
      }[estado.resultado] || estado.mensagem || '';
      const problema = ['semAcesso', 'semPasta'].includes(estado.resultado) || estado.erros;
      status = h('p', { class: problema ? 'aviso aviso-erro' : '', 'data-carro-estado': '' },
        h('strong', { text: `Última busca ${dataHora(estado.ultimaBusca)}` }), ` · ${msg}`,
        estado.testes ? ` · ${estado.testes} de teste desprezado(s)` : '', estado.erros ? ` · ${estado.erros} erro(s)` : '');
    }
    let auto = 'Automática desligada';
    if (c.ativo) {
      const cada = (INTERVALOS.find(([v]) => v === Number(c.intervaloMin)) || [0, `${c.intervaloMin} min`])[1];
      const prox = estado && estado.ultimaBusca ? new Date(new Date(estado.ultimaBusca).getTime() + c.intervaloMin * 60000) : null;
      auto = `Automática a cada ${cada}${prox ? ` · próxima ${dataHora(prox.toISOString())}` : ''}${c.horaIni && c.horaFim ? ` · ${c.horaIni}–${c.horaFim}` : ''}`;
    }
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'bc-cab' }, cab,
        h('button', { class: 'btn-icone', title: 'Ler a pasta de novo', 'aria-label': 'Atualizar', onclick: () => (ehVirtual() ? escolherSimples() : atualizar()) }, ui.icone('sync'))),
      erro ? h('p', { class: 'aviso aviso-erro', text: erro }) : null,
      status,
      // modo simples: a tela mostra a pasta como estava quando foi aberta
      ehVirtual() && pasta.lidaEm && Date.now() - pasta.lidaEm.getTime() > 5 * 60000
        ? h('div', { class: 'ca-novos' }, h('span', { text: `Pasta lida às ${dataHora(pasta.lidaEm.toISOString()).slice(6)}: buscas feitas depois não aparecem até atualizar.` }),
          h('button', { class: 'btn btn-primario', onclick: escolherSimples }, ui.icone('sync'), 'Atualizar a pasta'))
        : null,
      h('small', { class: 'sub' }, `${auto} · ${pasta.name}${ehVirtual() && pasta.lidaEm ? ` (lida às ${dataHora(pasta.lidaEm.toISOString()).slice(6)})` : ' (atualiza sozinha)'} · `,
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); escolherSimples(); }, text: 'trocar' }),
        ehVirtual() ? ' · ' : null,
        ehVirtual() ? h('a', { href: '#', title: 'A pasta fica lembrada e a tela atualiza sozinha (se o Chrome deixar)', onclick: (e) => { e.preventDefault(); escolherPasta(); }, text: 'usar acesso permanente' }) : null));
  }

  function cartaoBusca() {
    const de = h('input', { type: 'date', value: filtro.de, name: 'carroDe' });
    const ate = h('input', { type: 'date', value: filtro.ate, name: 'carroAte' });
    const sedes = [...new Set(arr(catalogo && catalogo.arquivos).map((a) => String(a.sede || infoNome(a.nome).sede).toUpperCase()).filter(Boolean))].sort();
    const lista = h('datalist', { id: 'carro-sedes' }, sedes.map((s) => h('option', { value: s })));
    const sede = h('input', { type: 'text', value: filtro.sedes, list: 'carro-sedes', placeholder: 'todas (ex.: CP, GV)', name: 'carroSede', autocomplete: 'off' });
    const aplicar = () => {
      filtro.de = de.value; filtro.ate = ate.value; filtro.sedes = sede.value; salvarFiltro();
      marcarProntos(); renderLista();
    };
    [de, ate].forEach((x) => x.addEventListener('change', aplicar));
    sede.addEventListener('input', U.debounce ? U.debounce(aplicar, 250) : aplicar);
    const atalho = (rot, d0, d1) => h('button', { type: 'button', class: 'btn btn-fantasma', onclick: () => { de.value = d0; ate.value = d1; aplicar(); }, text: rot });
    const modo = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'O que buscar' },
      [['novos', 'Só novos'], ['todos', 'Todos do período']].map(([v, t]) => h('button', {
        type: 'button', role: 'radio', class: `seg-opcao${filtro.modo === v ? ' ativo' : ''}`, 'aria-checked': filtro.modo === v ? 'true' : 'false',
        onclick: () => { filtro.modo = v; salvarFiltro(); render(); }, text: t
      })));
    const ocupado = !!buscando;
    const seg = buscando ? Math.round((Date.now() - buscando.inicio) / 1000) : 0;
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Buscar agora' }),
      h('div', { class: 'grade-3' }, ui.campo('De', de), ui.campo('Até', ate), ui.campo('Sede', sede)), lista,
      h('div', { class: 'linha-acoes bc-acoes' }, atalho('Hoje', hoje(), hoje()), atalho('Ontem', diasAtras(1), diasAtras(1)), atalho('7 dias', diasAtras(7), hoje()), atalho('30 dias', diasAtras(30), hoje()),
        modo,
        h('button', { class: 'btn btn-primario', 'data-bc-buscar': '', disabled: ocupado || null, onclick: buscarAgora }, ui.icone('sync'), document.createTextNode(ocupado ? `Buscando… ${seg}s` : 'Buscar agora')),
        ocupado ? h('button', { class: 'btn', onclick: cancelarEspera, text: 'Parar' }) : null),
      pedidoSimples ? h('div', { class: 'ca-novos', 'data-bc-pedido': '' },
        h('span', { text: `Busca pedida às ${String(pedidoSimples.getHours()).padStart(2, '0')}:${String(pedidoSimples.getMinutes()).padStart(2, '0')}: começa em até 1 minuto e o Windows avisa o resultado.` }),
        h('button', { class: 'btn btn-primario', onclick: () => { pedidoSimples = null; render(); escolherSimples(); } }, ui.icone('sync'), 'Ver resultado'),
        h('button', { class: 'btn-icone', 'aria-label': 'Fechar', onclick: () => { pedidoSimples = null; render(); } }, ui.icone('x'))) : null);
  }

  let listaEl = null;
  function renderLista() {
    if (!listaEl) return;
    const todos = listaFiltrada();
    const semFiltro = (() => { const f = { ...filtro }; filtro.de = ''; filtro.ate = ''; filtro.sedes = ''; const n = listaFiltrada().length; Object.assign(filtro, f); return n; })();
    const linhas = todos.slice(0, MAX_LINHAS);
    const sel = [...marcados].filter((n) => todos.some((a) => a.nome === n && podeTrazer(a)));
    const contagem = {};
    todos.forEach((a) => { const k = situacao(a)[0]; contagem[k] = (contagem[k] || 0) + 1; });
    const corpo = !pasta || !permitido
      ? [h('p', { class: 'sub', text: 'Abra a pasta para ver a lista.' })]
      : !catalogo && !emTodos.size && !emNovos.size
      ? [h('p', { class: 'sub', text: 'Sem lista ainda: faça uma busca com o cabo do carro.' })]
      : !todos.length
        ? [h('p', { class: 'sub', text: semFiltro ? `Nenhum arquivo nesse filtro (${semFiltro} fora do período/sede).` : 'Nenhum arquivo nesse filtro.' })]
        : [
          h('p', { class: 'sub', 'data-carro-resumo': '' }, `${todos.length} arquivo(s)`,
            contagem.novo ? ` · ${contagem.novo} novo(s)` : '', contagem.pronto ? ` · ${contagem.pronto} pronto(s)` : '',
            contagem.montagem ? ` · ${contagem.montagem} na Montagem` : '', contagem.carro ? ` · ${contagem.carro} só no carro` : '',
            semFiltro > todos.length ? ` · ${semFiltro - todos.length} fora do período/sede` : ''),
          h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela mt-tabela bc-tabela' },
            h('thead', {}, h('tr', {},
              h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Marcar todos', checked: sel.length && sel.length === todos.filter(podeTrazer).length || null,
                onchange: (e) => { marcados = e.target.checked ? new Set(todos.filter(podeTrazer).map((a) => a.nome)) : new Set(); renderLista(); } })),
              h('th', { text: 'Arquivo' }), h('th', { text: 'Sede' }), h('th', { text: 'Data' }), h('th', { text: 'Situação' }))),
            h('tbody', {}, linhas.map((a) => {
              const [k, t] = situacao(a);
              const pode = podeTrazer(a);
              return h('tr', { class: `bc-${k}` },
                h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Marcar ${a.nome}`, disabled: !pode || null, checked: (pode && marcados.has(a.nome)) || null,
                  onchange: (e) => { if (e.target.checked) marcados.add(a.nome); else marcados.delete(a.nome); renderLista(); } })),
                h('td', { text: a.nome }), h('td', { text: a.sede || '—' }), h('td', { text: dataBr(a.data) }), h('td', {}, h('span', { class: `bc-sit bc-sit-${k}`, text: t })));
            })))),
          todos.length > MAX_LINHAS ? h('p', { class: 'sub', text: `Mostrando ${MAX_LINHAS} de ${todos.length}.` }) : null
        ];
    ui.trocar(listaEl,
      h('div', { class: 'bc-cab' }, h('h2', { text: 'Arquivos do carro' }),
        h('button', { class: 'btn btn-primario', disabled: !sel.length || trazendo || null, onclick: trazer }, ui.icone('upload'), trazendo ? 'Trazendo…' : `Trazer para a Montagem (${sel.length})`)),
      ...corpo);
  }

  function cartaoAutomatico() {
    const c = efetiva();
    const campos = {};
    const chk = (k, rot) => h('label', { class: 'check' }, (campos[k] = h('input', { type: 'checkbox', checked: c[k] || null })), ' ', rot);
    campos.intervaloMin = h('select', {}, INTERVALOS.map(([v, t]) => h('option', { value: v, selected: Number(c.intervaloMin) === v || null, text: t })));
    campos.horaIni = h('input', { type: 'time', value: c.horaIni || '' });
    campos.horaFim = h('input', { type: 'time', value: c.horaFim || '' });
    campos.avisos = h('select', {}, [['sempre', 'Sempre'], ['novos', 'Só com novidade ou problema'], ['nunca', 'Nunca']]
      .map(([v, t]) => h('option', { value: v, selected: c.avisos === v || null, text: t })));
    campos.origens = h('textarea', { rows: 2, placeholder: '\\\\em3\\C\\DADOS', value: arr(c.origens).join('\n') });
    campos.ignorar = h('input', { type: 'text', value: arr(c.ignorar).join(', '), placeholder: 'teste' });
    campos.dias = h('input', { type: 'number', min: 0, max: 365, value: c.dias });
    campos.segundosAviso = h('input', { type: 'number', min: 5, max: 600, value: c.segundosAviso });
    campos.modoWifi = h('select', {}, [['desconectar', 'Desconectar'], ['desativar', 'Desligar o adaptador (administrador)']]
      .map(([v, t]) => h('option', { value: v, selected: c.modoWifi === v || null, text: t })));
    async function salvar() {
      const num = (x, d) => (x !== '' && Number.isFinite(Number(x)) ? Number(x) : d);
      const nova = {
        ativo: campos.ativo.checked, intervaloMin: num(campos.intervaloMin.value, 120),
        horaIni: campos.horaIni.value, horaFim: campos.horaFim.value,
        origens: campos.origens.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        ignorar: campos.ignorar.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        dias: Math.max(0, num(campos.dias.value, 10)), avisos: campos.avisos.value, avisarSemCabo: campos.avisarSemCabo.checked,
        segundosAviso: Math.max(5, num(campos.segundosAviso.value, 30)), modoWifi: campos.modoWifi.value, atualizarAuto: campos.atualizarAuto.checked,
        salvoEm: new Date().toISOString()
      };
      if (!!nova.horaIni !== !!nova.horaFim) { ui.toast('Preencha as duas horas do horário, ou deixe as duas vazias.', 'erro', 5000); return; }
      // quem grava é o script (o app só lê a pasta): manda pelo link e espera a configuracao.json mudar
      const id = U.uuid().slice(0, 12);
      U.pref.set('carroAuto:configLocal', { ...nova, salvoId: id });
      baixarPedido('carro-controle-config.json', 'config', {
        id, ativo: nova.ativo, intervalo: nova.intervaloMin, horaIni: nova.horaIni, horaFim: nova.horaFim,
        origens: nova.origens.join('|'), ignorar: nova.ignorar.join(','), dias: nova.dias, avisos: nova.avisos,
        avisarSemCabo: nova.avisarSemCabo, segundosAviso: nova.segundosAviso, modoWifi: nova.modoWifi, atualizarAuto: nova.atualizarAuto
      });
      if (!pasta || !permitido || ehVirtual()) { ui.toast('Configuração enviada: vale em até 1 minuto.', 'info', 5000); render(); return; }
      ui.toast('Enviando a configuração ao Windows…', 'info', 3000);
      const inicio = Date.now();
      while (Date.now() - inicio < 60000) {
        await new Promise((r) => setTimeout(r, 1500));
        const c = await lerJson('configuracao.json');
        if (c && c.salvoId === id) {
          config = c;
          ui.toast('Configuração salva. Vale a partir da próxima busca.', 'ok', 4000);
          render();
          return;
        }
      }
      ui.toast('O Windows não confirmou a configuração. Se o navegador perguntou "Abrir Buscar arquivos do carro?", confirme (marque Sempre permitir). Se for a primeira vez, rode o "Buscar arquivos do carro.bat" uma vez.', 'erro', 12000);
    }
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Busca automática' }),
      pasta && permitido && pendente() ? h('p', { class: 'aviso', text: 'Configuração enviada; o Windows aplica em até 1 minuto (atualize a pasta para confirmar).' }) : null,
      chk('ativo', 'Ligada'),
      h('div', { class: 'grade-3' },
        ui.campo('A cada', campos.intervaloMin),
        ui.campo('Das', campos.horaIni),
        ui.campo('Até as', campos.horaFim)),
      ui.campo('Aviso no fim', campos.avisos),
      h('details', { class: 'ca-config' }, h('summary', { text: 'Mais opções' }),
        h('div', { class: 'pilha' },
          ui.campo('Pastas do carro (uma por linha)', campos.origens),
          h('div', { class: 'grade-3' },
            ui.campo('Desprezar nomes com', campos.ignorar),
            ui.campo('Dias para trás (0 = todos)', campos.dias),
            ui.campo('Aviso fecha em (s)', campos.segundosAviso)),
          ui.campo('Wi-Fi na cópia', campos.modoWifi),
          chk('avisarSemCabo', 'Avisar sem o cabo do carro'),
          chk('atualizarAuto', 'Atualizar o script pelo GitHub'))),
      h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-primario', onclick: salvar }, ui.icone('check'), 'Salvar configuração')));
  }

  let histTodos = false;
  function cartaoHistorico() {
    if (!pasta || !permitido) return null;
    const tipos = { automatica: 'Automática', app: 'Pelo app', manual: 'Manual (.bat)' };
    const res = (x) => ({
      ok: x.novos ? `${x.novos} arquivo(s) novo(s)` : 'Nenhum arquivo novo',
      semCabo: 'Cabo não conectado',
      semAcesso: `Sem acesso a ${arr(x.semAcesso).join(', ') || 'pasta do carro'}`,
      semPasta: 'Pasta do carro não configurada'
    }[x.resultado] || x.resultado || '—');
    const lista = histTodos ? historico : historico.slice(0, 15);
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Histórico das buscas' }),
      !historico.length ? h('p', { class: 'sub', text: 'Nenhuma busca registrada ainda.' }) : h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela mt-tabela bc-hist' },
        h('thead', {}, h('tr', {}, ['Quando', 'Como', 'Resultado', 'Teste', 'Erros'].map((t) => h('th', { text: t })))),
        h('tbody', {}, lista.map((x) => {
          const problema = ['semAcesso', 'semPasta'].includes(x.resultado) || x.erros;
          return h('tr', { class: problema ? 'bc-hist-erro' : '', title: arr(x.copiados).join('\n') || x.mensagem || '' },
            h('td', { text: dataHora(x.data) }), h('td', { text: tipos[x.tipo] || x.tipo || '—' }),
            h('td', { text: res(x) }), h('td', { text: x.testes || '' }), h('td', { text: x.erros || '' }));
        })))),
      historico.length > 15 ? h('button', { class: 'btn btn-fantasma', onclick: () => { histTodos = !histTodos; render(); }, text: histTodos ? 'Mostrar menos' : `Mostrar todas (${historico.length})` }) : null,
      logLinhas.length ? h('details', { class: 'ca-config' }, h('summary', { text: 'Log completo' }),
        h('pre', { class: 'bc-log', text: logLinhas.slice().reverse().join('\n') })) : null);
  }

  function render() {
    if (!raiz) return;
    if (!suportado()) {
      ui.trocar(raiz, h('section', { class: 'cartao pilha' }, h('h2', { text: 'Buscar arquivos do carro' }),
        h('p', { class: 'sub', text: 'Esta tela funciona no app do notebook (Chrome ou Edge), onde o script do Windows busca os arquivos do carro.' })));
      return;
    }
    const aberto = raiz.querySelector('.ca-config') && raiz.querySelector('.ca-config').open;
    try {
      // as quatro partes aparecem sempre; sem a pasta ligada, Buscar agora e Salvar pedem a pasta na hora
      listaEl = h('section', { class: 'cartao pilha bc-lista' });
      ui.trocar(raiz, cartaoPasta(), cartaoBusca(), listaEl, cartaoAutomatico(), cartaoHistorico());
      renderLista();
      if (aberto && raiz.querySelector('.ca-config')) raiz.querySelector('.ca-config').open = true;
    } catch (e) {
      console.error(e);
      ui.trocar(raiz, h('section', { class: 'cartao pilha' }, h('h2', { text: 'Buscar arquivos do carro' }),
        h('p', { class: 'aviso aviso-erro', text: `Erro ao mostrar a tela: ${e.message}` }),
        h('div', { class: 'linha-acoes' }, h('button', { class: 'btn', onclick: escolherPasta, text: 'Escolher a pasta de novo' }))));
    }
  }

  App.buscaCarro = {
    suportado,
    montar(el) {
      raiz = el;
      // no modo simples, avisa quando a leitura da pasta ficou velha (sem atrapalhar quem está digitando)
      // com acesso permanente, relê a pasta sozinho a cada minuto (busca automática aparece sem fazer nada)
      setInterval(() => {
        if (!raiz || raiz.hidden || raiz.contains(document.activeElement) || buscando || trazendo) return;
        if (ehVirtual()) render();
        else if (pasta && permitido) atualizar();
      }, 60000);
      render(); atualizar().then(() => { marcarProntos(); renderLista(); }); },
    escolherPasta,
    aoMostrar() { atualizar().then(() => { if (!marcados.size) marcarProntos(); renderLista(); }); },
    infoNome
  };
})(window.App);
