/*
 * Tela "Buscar do carro": conversa com o script do Windows (automacao/buscar-carro) pela pasta
 * Documentos\Carro Controle:
 *   pedido.json        o app pede uma busca agora (período, sedes, só novos/todos) e abre carrocontrole://buscar
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
  let emTodos = new Set();
  let emNovos = new Set();
  let naMontagem = new Set();
  let marcados = new Set();
  let buscando = null; // { id, inicio }
  let trazendo = false;
  let erro = '';
  let timer = null;

  const hoje = () => new Date().toISOString().slice(0, 10);
  const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const filtro = U.pref.get('carroAuto:filtro', null) || { de: diasAtras(7), ate: hoje(), sedes: '', modo: 'novos' };
  const salvarFiltro = () => U.pref.set('carroAuto:filtro', filtro);
  const sedesDoFiltro = () => filtro.sedes.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

  /** RLT_CP_20261117… → { ramal, sede, data: '2026-11-17' } */
  function infoNome(nome) {
    const m = /^([A-Za-z0-9]+)_([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})/.exec(nome);
    return m ? { ramal: m[1].toUpperCase(), sede: m[2].toUpperCase(), data: `${m[3]}-${m[4]}-${m[5]}` } : { ramal: '', sede: '', data: '' };
  }

  /* ---------- arquivos ---------- */

  const semBom = (t) => t.replace(/^﻿/, '');
  async function lerJson(nome) {
    try { return JSON.parse(semBom(await (await (await pasta.getFileHandle(nome)).getFile()).text())); } catch (e) { return null; }
  }
  async function gravarJson(nome, obj) {
    const w = await (await pasta.getFileHandle(nome, { create: true })).createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
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
    const op = { mode: 'readwrite' };
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
    emTodos = await nomesEm('Todos');
    emNovos = await nomesEm('Novos');
    naMontagem = new Set(App.montagem && App.montagem.nomes ? await App.montagem.nomes() : []);
  }

  async function atualizar() {
    if (!suportado() || !raiz) return;
    try {
      if (!pasta) pasta = (await store.get(CHAVE).catch(() => null)) || null;
      if (pasta) await ler();
    } catch (e) {
      erro = e.message;
    }
    render();
  }

  async function escolherPasta() {
    try {
      const d = await window.showDirectoryPicker({ id: 'carro-controle', mode: 'readwrite', startIn: 'documents' });
      pasta = d;
      await store.set(CHAVE, d).catch(() => {});
      await temPermissao(true).catch(() => false);
      await ler();
      if (permitido && !estado && !catalogo && !(await subpasta('Novos'))) ui.toast('Essa pasta não parece a "Carro Controle" do script. Confira se é Documentos\\Carro Controle.', 'info', 8000);
    } catch (e) {
      if (e.name !== 'AbortError') ui.toast(`Não foi possível abrir a pasta: ${e.message}`, 'erro', 6000);
    }
    render();
  }

  async function permitir() {
    try { await temPermissao(true); await ler(); } catch (e) { erro = e.message; }
    render();
  }

  /* ---------- buscar agora ---------- */

  async function buscarAgora() {
    if (filtro.de && filtro.ate && filtro.de > filtro.ate) { ui.toast('A data inicial é depois da final.', 'erro', 5000); return; }
    try {
      if (!(await temPermissao(true))) throw new Error('sem permissão na pasta');
      const id = U.uuid();
      await gravarJson('pedido.json', { id, de: filtro.de || '', ate: filtro.ate || '', sedes: sedesDoFiltro(), modo: filtro.modo, criadoEm: new Date().toISOString() });
      buscando = { id, inicio: Date.now() };
      render();
      // o Windows abre o script (link registrado pelo próprio script na primeira vez que roda)
      h('a', { href: 'carrocontrole://buscar' }).click();
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
        ui.toast('O Windows não respondeu ao pedido de busca. Se for a primeira vez, rode o "Buscar arquivos do carro.bat" uma vez (ele instala o botão) e tente de novo.', 'erro', 12000);
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
    pasta && pasta.removeEntry && pasta.removeEntry('pedido.json').catch(() => {});
    render();
  }

  /* ---------- lista ---------- */

  function situacao(a) {
    if (a.teste) return ['teste', 'Teste (desprezado)'];
    if (naMontagem.has(a.nome)) return ['montagem', 'Na Montagem'];
    if (emNovos.has(a.nome)) return ['novo', 'Novo · pronto para trazer'];
    if (emTodos.has(a.nome)) return ['pronto', 'Pronto para trazer'];
    return ['carro', 'Só no carro (busque para copiar)'];
  }
  function listaFiltrada() {
    const sedes = sedesDoFiltro();
    const base = (catalogo && catalogo.arquivos) || [];
    return base.map((a) => ({ ...infoNome(a.nome), ...a, data: a.data || infoNome(a.nome).data }))
      .filter((a) => (!filtro.de || !a.data || a.data >= filtro.de) && (!filtro.ate || !a.data || a.data <= filtro.ate) && (!sedes.length || sedes.includes(String(a.sede).toUpperCase())))
      .sort((a, b) => (b.data || '').localeCompare(a.data || '') || a.nome.localeCompare(b.nome));
  }
  const podeTrazer = (a) => ['novo', 'pronto'].includes(situacao(a)[0]);
  function marcarProntos() {
    marcados = new Set(listaFiltrada().filter((a) => podeTrazer(a)).map((a) => a.nome));
  }

  async function trazer() {
    const nomes = [...marcados].filter((n) => emTodos.has(n) && !naMontagem.has(n));
    if (!nomes.length) return;
    trazendo = true; render();
    try {
      const todos = await subpasta('Todos');
      const files = [];
      for (const n of nomes) files.push(await (await todos.getFileHandle(n)).getFile());
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
  const efetiva = () => ({ ...PADRAO, ...((estado && estado.config) || {}), ...(config || {}) });

  function cartaoPasta() {
    const cab = h('h2', { text: 'Buscar arquivos do carro' });
    if (!pasta) {
      return h('section', { class: 'cartao pilha' }, cab,
        h('p', { class: 'sub', text: 'Ligue o app à pasta onde o script "Buscar arquivos do carro" grava os arquivos (Documentos\\Carro Controle). Depois é só buscar e trazer para a Montagem por aqui.' }),
        h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-primario', onclick: escolherPasta }, ui.icone('documento'), 'Escolher a pasta Carro Controle')));
    }
    if (!permitido) {
      return h('section', { class: 'cartao pilha' }, cab,
        h('p', { class: 'sub', text: `O navegador pede para confirmar o acesso à pasta ${pasta.name}.` }),
        h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-primario', onclick: permitir }, ui.icone('check'), 'Permitir acesso à pasta'),
          h('button', { class: 'btn', onclick: escolherPasta, text: 'Escolher outra pasta' })));
    }
    const c = efetiva();
    const linhas = [];
    if (!estado) linhas.push(h('p', { class: 'aviso', text: 'Nenhuma busca feita ainda. Se o script nunca rodou neste notebook, rode o "Buscar arquivos do carro.bat" uma vez.' }));
    else {
      const msg = {
        ok: estado.novos ? `${estado.novos} arquivo(s) copiado(s)` : 'nenhum arquivo novo',
        semCabo: 'cabo do carro não conectado',
        semAcesso: `sem acesso a ${(estado.semAcesso || []).join(', ') || 'pasta do carro'}`,
        semPasta: 'nenhuma pasta do carro configurada'
      }[estado.resultado] || estado.mensagem || '';
      const problema = ['semAcesso', 'semPasta'].includes(estado.resultado) || estado.erros;
      linhas.push(h('p', { class: problema ? 'aviso aviso-erro' : '', 'data-carro-estado': '' },
        h('strong', { text: `Última busca: ${dataHora(estado.ultimaBusca)}` }), ` · ${msg}`,
        estado.testes ? ` · ${estado.testes} de teste desprezado(s)` : '', estado.erros ? ` · ${estado.erros} erro(s) ao copiar` : ''));
      if (c.ativo && estado.ultimaBusca) {
        const prox = new Date(new Date(estado.ultimaBusca).getTime() + c.intervaloMin * 60000);
        linhas.push(h('p', { class: 'sub', text: `Busca automática: a cada ${(INTERVALOS.find(([v]) => v === Number(c.intervaloMin)) || [0, `${c.intervaloMin} min`])[1]}, próxima por volta de ${dataHora(prox.toISOString())}${c.horaIni && c.horaFim ? ` (entre ${c.horaIni} e ${c.horaFim})` : ''}.` }));
      } else if (!c.ativo) linhas.push(h('p', { class: 'sub', text: 'Busca automática desligada.' }));
    }
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'tela-cab' }, cab, h('button', { class: 'btn-icone', title: 'Ler de novo a pasta', 'aria-label': 'Atualizar', onclick: () => atualizar() }, ui.icone('sync'))),
      erro ? h('p', { class: 'aviso aviso-erro', text: erro }) : null,
      ...linhas,
      h('small', { class: 'sub' }, `Pasta: ${pasta.name}${estado && estado.versao ? ` · script ${estado.versao}` : ''} · `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); escolherPasta(); }, text: 'trocar' })));
  }

  function cartaoBusca() {
    const de = h('input', { type: 'date', value: filtro.de, name: 'carroDe' });
    const ate = h('input', { type: 'date', value: filtro.ate, name: 'carroAte' });
    const sedes = [...new Set(((catalogo && catalogo.arquivos) || []).map((a) => String(a.sede || infoNome(a.nome).sede).toUpperCase()).filter(Boolean))].sort();
    const lista = h('datalist', { id: 'carro-sedes' }, sedes.map((s) => h('option', { value: s })));
    const sede = h('input', { type: 'text', value: filtro.sedes, list: 'carro-sedes', placeholder: 'todas', name: 'carroSede', autocomplete: 'off' });
    const aplicar = () => {
      filtro.de = de.value; filtro.ate = ate.value; filtro.sedes = sede.value; salvarFiltro();
      marcarProntos(); renderLista();
    };
    [de, ate].forEach((x) => x.addEventListener('change', aplicar));
    sede.addEventListener('input', U.debounce ? U.debounce(aplicar, 250) : aplicar);
    const atalho = (rot, d0, d1) => h('button', { type: 'button', class: 'btn btn-fantasma', onclick: () => { de.value = d0; ate.value = d1; aplicar(); }, text: rot });
    const modo = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'O que buscar' },
      [['novos', 'Só os novos'], ['todos', 'Todos do período (copia de novo)']].map(([v, t]) => h('button', {
        type: 'button', role: 'radio', class: `seg-opcao${filtro.modo === v ? ' ativo' : ''}`, 'aria-checked': filtro.modo === v ? 'true' : 'false',
        onclick: () => { filtro.modo = v; salvarFiltro(); render(); }, text: t
      })));
    const ocupado = !!buscando;
    const seg = buscando ? Math.round((Date.now() - buscando.inicio) / 1000) : 0;
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Buscar agora' }),
      h('div', { class: 'grade-3' }, ui.campo('De', de), ui.campo('Até', ate), ui.campo('Sede', sede, { ajuda: 'ex.: CP · várias separadas por vírgula · vazio = todas' })), lista,
      h('div', { class: 'linha-acoes' }, atalho('Hoje', hoje(), hoje()), atalho('Ontem', diasAtras(1), diasAtras(1)), atalho('7 dias', diasAtras(7), hoje()), atalho('30 dias', diasAtras(30), hoje())),
      modo,
      h('div', { class: 'linha-acoes' },
        h('button', { class: 'btn btn-primario', 'data-bc-buscar': '', disabled: ocupado || null, onclick: buscarAgora }, ui.icone('sync'), document.createTextNode(ocupado ? `Buscando… ${seg}s` : 'Buscar agora')),
        ocupado ? h('button', { class: 'btn', onclick: cancelarEspera, text: 'Parar de esperar' }) : null),
      ocupado ? h('p', { class: 'aviso', text: 'O Windows está buscando no carro: o Wi-Fi do notebook cai por alguns segundos e volta sozinho. Se o navegador perguntar "Abrir Buscar arquivos do carro?", marque "Sempre permitir" e confirme.' }) : null);
  }

  let listaEl = null;
  function renderLista() {
    if (!listaEl) return;
    const todos = listaFiltrada();
    const linhas = todos.slice(0, MAX_LINHAS);
    const sel = [...marcados].filter((n) => todos.some((a) => a.nome === n && podeTrazer(a)));
    const contagem = {};
    todos.forEach((a) => { const k = situacao(a)[0]; contagem[k] = (contagem[k] || 0) + 1; });
    const corpo = !catalogo
      ? [h('p', { class: 'sub', text: 'Faça uma busca para listar os arquivos do carro.' })]
      : !todos.length
        ? [h('p', { class: 'sub', text: 'Nenhum arquivo do carro nesse período/sede.' })]
        : [
          h('p', { class: 'sub', 'data-carro-resumo': '' }, `${todos.length} arquivo(s) no carro nesse filtro`,
            contagem.novo ? ` · ${contagem.novo} novo(s)` : '', contagem.pronto ? ` · ${contagem.pronto} pronto(s)` : '',
            contagem.montagem ? ` · ${contagem.montagem} já na Montagem` : '', contagem.carro ? ` · ${contagem.carro} só no carro` : '',
            catalogo.geradoEm ? ` · lista de ${dataHora(catalogo.geradoEm)}` : ''),
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
          todos.length > MAX_LINHAS ? h('p', { class: 'sub', text: `Mostrando ${MAX_LINHAS} de ${todos.length}: estreite o período ou a sede.` }) : null,
          contagem.carro ? h('p', { class: 'sub', text: 'Os que estão "só no carro" ainda não foram copiados: use Buscar agora com "Todos do período".' }) : null
        ];
    ui.trocar(listaEl,
      h('div', { class: 'tela-cab' }, h('h2', { text: 'Arquivos do carro' }),
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
    campos.avisos = h('select', {}, [['sempre', 'Sempre (inclusive "não existe arquivo novo")'], ['novos', 'Só quando vier arquivo novo ou der problema'], ['nunca', 'Nunca']]
      .map(([v, t]) => h('option', { value: v, selected: c.avisos === v || null, text: t })));
    campos.origens = h('textarea', { rows: 2, placeholder: '\\\\em3\\C\\DADOS', value: (c.origens || []).join('\n') });
    campos.ignorar = h('input', { type: 'text', value: (c.ignorar || []).join(', '), placeholder: 'teste' });
    campos.dias = h('input', { type: 'number', min: 0, max: 365, value: c.dias });
    campos.segundosAviso = h('input', { type: 'number', min: 5, max: 600, value: c.segundosAviso });
    campos.modoWifi = h('select', {}, [['desconectar', 'Desconectar (sem administrador)'], ['desativar', 'Desativar o adaptador (administrador)']]
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
      try {
        if (!(await temPermissao(true))) throw new Error('sem permissão na pasta');
        await gravarJson('configuracao.json', nova);
        config = nova;
        ui.toast('Configuração salva. Vale a partir da próxima busca.', 'ok', 4000);
        render();
      } catch (e) {
        ui.toast(`Não foi possível salvar: ${e.message}`, 'erro', 6000);
      }
    }
    return h('section', { class: 'cartao pilha' },
      h('h2', { text: 'Busca automática' }),
      chk('ativo', 'Buscar sozinho de tempos em tempos'),
      h('div', { class: 'grade-3' },
        ui.campo('Buscar a cada', campos.intervaloMin),
        ui.campo('Só a partir de', campos.horaIni, { ajuda: 'vazio = o dia todo' }),
        ui.campo('Até', campos.horaFim)),
      ui.campo('Aviso no fim da busca automática', campos.avisos),
      h('details', { class: 'ca-config' }, h('summary', { text: 'Mais opções' }),
        h('div', { class: 'pilha' },
          ui.campo('Pastas dos computadores do carro (uma por linha)', campos.origens, { ajuda: 'Vazio = usa o que está no configuracao.ps1 do script.' }),
          h('div', { class: 'grade-3' },
            ui.campo('Desprezar arquivos com no nome', campos.ignorar, { ajuda: 'separe por vírgula' }),
            ui.campo('Busca automática: últimos (dias)', campos.dias, { ajuda: '0 = todos' }),
            ui.campo('Janela de aviso fecha em (s)', campos.segundosAviso)),
          ui.campo('Wi-Fi durante a cópia', campos.modoWifi),
          chk('avisarSemCabo', 'Avisar quando o cabo do carro não estiver conectado'),
          chk('atualizarAuto', 'Atualizar o script sozinho pelo GitHub'))),
      h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-primario', onclick: salvar }, ui.icone('check'), 'Salvar configuração')));
  }

  function render() {
    if (!raiz) return;
    if (!suportado()) {
      ui.trocar(raiz, h('section', { class: 'cartao pilha' }, h('h2', { text: 'Buscar arquivos do carro' }),
        h('p', { class: 'sub', text: 'Esta tela funciona no app do notebook (Chrome ou Edge), onde o script do Windows busca os arquivos do carro.' })));
      return;
    }
    const aberto = raiz.querySelector('.ca-config') && raiz.querySelector('.ca-config').open;
    if (!pasta || !permitido) { listaEl = null; ui.trocar(raiz, cartaoPasta()); return; }
    listaEl = h('section', { class: 'cartao pilha bc-lista' });
    ui.trocar(raiz, cartaoPasta(), cartaoBusca(), listaEl, cartaoAutomatico());
    renderLista();
    if (aberto && raiz.querySelector('.ca-config')) raiz.querySelector('.ca-config').open = true;
  }

  App.buscaCarro = {
    suportado,
    montar(el) { raiz = el; render(); atualizar().then(() => { marcarProntos(); renderLista(); }); },
    aoMostrar() { atualizar().then(() => { if (!marcados.size) marcarProntos(); renderLista(); }); },
    infoNome
  };
})(window.App);
