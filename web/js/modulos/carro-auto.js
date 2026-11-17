/*
 * Painel da automação "Buscar arquivos do carro" (script do Windows em automacao/buscar-carro).
 * O script busca os CSV do carro pelo cabo e grava em Documentos\Carro Controle:
 *   Novos\*.csv       arquivos ainda não carregados no app
 *   estado.json       resultado da última busca (o script escreve)
 *   configuracao.json configurações (o app escreve; o script lê a cada busca)
 * Aqui o app lê o estado, carrega os novos na Montagem e grava a configuração.
 * Só funciona onde o navegador dá acesso a pastas (Chrome/Edge no computador).
 */
'use strict';

(function (App) {
  const { h } = App.ui;
  const ui = App.ui;
  const U = App.util;
  const store = App.store;
  const CHAVE = 'carroAuto:pasta';
  const suportado = () => typeof window.showDirectoryPicker === 'function';

  const PADRAO = {
    ativo: true, intervaloMin: 120, horaIni: '', horaFim: '', origens: [], ignorar: ['teste'], dias: 10,
    avisos: 'sempre', avisarSemCabo: true, segundosAviso: 30, modoWifi: 'desconectar', atualizarAuto: true
  };
  const INTERVALOS = [[30, '30 min'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [240, '4 horas'], [360, '6 horas'], [480, '8 horas']];

  let pasta = null; // FileSystemDirectoryHandle
  let permitido = false;
  let estado = null;
  let config = null; // configuracao.json (null = ainda não existe)
  let novos = [];
  let erro = '';
  let ocupado = false;
  let carregarNaMontagem = null; // (File[]) => Promise<string[]> nomes processados
  let el = null;

  /* ---------- arquivos ---------- */

  const semBom = (t) => t.replace(/^﻿/, '');
  async function lerJson(nome) {
    try {
      const f = await (await pasta.getFileHandle(nome)).getFile();
      return JSON.parse(semBom(await f.text()));
    } catch (e) {
      return null;
    }
  }
  async function gravarJson(nome, obj) {
    const fh = await pasta.getFileHandle(nome, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
  }
  async function pastaNovos(criar = false) {
    try { return await pasta.getDirectoryHandle('Novos', { create: criar }); } catch (e) { return null; }
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
    novos = [];
    const dir = await pastaNovos();
    if (dir) {
      for await (const [nome, hd] of dir.entries()) if (hd.kind === 'file' && /\.csv$/i.test(nome)) novos.push(nome);
      novos.sort();
    }
  }

  async function atualizar() {
    if (!suportado()) return;
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
      if (permitido && !estado && !config && !(await pastaNovos())) ui.toast('Essa pasta não parece a "Carro Controle" do script (sem estado.json nem Novos). Confira se é Documentos\\Carro Controle.', 'info', 8000);
    } catch (e) {
      if (e.name !== 'AbortError') ui.toast(`Não foi possível abrir a pasta: ${e.message}`, 'erro', 6000);
    }
    render();
  }

  async function permitir() {
    try { await temPermissao(true); await ler(); } catch (e) { erro = e.message; }
    render();
  }

  async function carregarNovos() {
    if (!carregarNaMontagem || !novos.length) return;
    ocupado = true; render();
    try {
      const dir = await pastaNovos();
      const files = [];
      for (const n of novos) files.push(await (await dir.getFileHandle(n)).getFile());
      const feitos = (await carregarNaMontagem(files)) || [];
      // tira da pasta Novos o que já está na Montagem (a cópia continua em Todos)
      for (const n of feitos) await dir.removeEntry(n).catch(() => {});
      await ler();
    } catch (e) {
      ui.toast(`Erro ao carregar os arquivos do carro: ${e.message}`, 'erro', 8000);
    }
    ocupado = false; render();
  }

  /* ---------- tela ---------- */

  const dataHora = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
  };
  const efetiva = () => ({ ...PADRAO, ...((estado && estado.config) || {}), ...(config || {}) });

  function linhaEstado() {
    if (!estado) return h('p', { class: 'aviso', text: 'Nenhuma busca registrada ainda nesta pasta. Rode o "Buscar arquivos do carro.bat" uma vez.' });
    const c = efetiva();
    const partes = [];
    const msg = {
      ok: estado.novos ? `${estado.novos} arquivo(s) novo(s)` : 'nenhum arquivo novo',
      semCabo: 'cabo do carro não conectado',
      semAcesso: `sem acesso a ${(estado.semAcesso || []).join(', ') || 'pasta do carro'}`,
      semPasta: 'nenhuma pasta do carro configurada',
      erro: 'erro na busca'
    }[estado.resultado] || estado.mensagem || estado.resultado || '';
    partes.push(h('strong', { text: `Última busca: ${dataHora(estado.ultimaBusca)}` }), ` · ${msg}`);
    if (estado.testes) partes.push(` · ${estado.testes} de teste desprezado(s)`);
    if (estado.erros) partes.push(` · ${estado.erros} erro(s) ao copiar`);
    const problema = ['semAcesso', 'erro', 'semPasta'].includes(estado.resultado) || estado.erros;
    const linhas = [h('p', { class: problema ? 'aviso aviso-erro' : '', 'data-carro-estado': '' }, ...partes)];
    if (c.ativo && estado.ultimaBusca) {
      const prox = new Date(new Date(estado.ultimaBusca).getTime() + c.intervaloMin * 60000);
      const atrasada = Date.now() - prox.getTime() > 45 * 60000;
      linhas.push(h('p', { class: atrasada ? 'aviso' : 'ca-suave', text: atrasada
        ? `A busca automática deveria ter rodado às ${dataHora(prox.toISOString())}. O notebook estava desligado ou o agendamento não está ativo (rode "Ativar agendamento.bat").`
        : `Próxima busca automática por volta de ${dataHora(prox.toISOString())}${c.horaIni && c.horaFim ? ` (só entre ${c.horaIni} e ${c.horaFim})` : ''}.` }));
    } else if (!c.ativo) linhas.push(h('p', { class: 'aviso', text: 'Busca automática pausada.' }));
    if (estado.versao) linhas.push(h('small', { class: 'ca-suave', text: `Script versão ${estado.versao}` }));
    return linhas;
  }

  function formulario() {
    const c = efetiva();
    const campos = {};
    const chk = (k, rot) => h('label', { class: 'check' }, (campos[k] = h('input', { type: 'checkbox', checked: c[k] || null })), ' ', rot);
    campos.intervaloMin = h('select', {}, INTERVALOS.map(([v, t]) => h('option', { value: v, selected: Number(c.intervaloMin) === v || null, text: t })));
    campos.horaIni = h('input', { type: 'time', value: c.horaIni || '' });
    campos.horaFim = h('input', { type: 'time', value: c.horaFim || '' });
    campos.origens = h('textarea', { rows: 2, placeholder: '\\\\em3\\C\\DADOS', value: (c.origens || []).join('\n') });
    campos.ignorar = h('input', { type: 'text', value: (c.ignorar || []).join(', '), placeholder: 'teste' });
    campos.dias = h('input', { type: 'number', min: 0, max: 365, value: c.dias });
    campos.avisos = h('select', {}, [['sempre', 'Sempre (inclusive "não existe arquivo novo")'], ['novos', 'Só quando vier arquivo novo ou der problema'], ['nunca', 'Nunca']]
      .map(([v, t]) => h('option', { value: v, selected: c.avisos === v || null, text: t })));
    campos.segundosAviso = h('input', { type: 'number', min: 5, max: 600, value: c.segundosAviso });
    campos.modoWifi = h('select', {}, [['desconectar', 'Desconectar (sem administrador)'], ['desativar', 'Desativar o adaptador (administrador)']]
      .map(([v, t]) => h('option', { value: v, selected: c.modoWifi === v || null, text: t })));
    async function salvar() {
      const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
      const nova = {
        ativo: campos.ativo.checked,
        intervaloMin: num(campos.intervaloMin.value, 120),
        horaIni: campos.horaIni.value, horaFim: campos.horaFim.value,
        origens: campos.origens.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        ignorar: campos.ignorar.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        dias: Math.max(0, num(campos.dias.value, 10)),
        avisos: campos.avisos.value,
        avisarSemCabo: campos.avisarSemCabo.checked,
        segundosAviso: Math.max(5, num(campos.segundosAviso.value, 30)),
        modoWifi: campos.modoWifi.value,
        atualizarAuto: campos.atualizarAuto.checked,
        salvoEm: new Date().toISOString()
      };
      if ((nova.horaIni && !nova.horaFim) || (!nova.horaIni && nova.horaFim)) { ui.toast('Preencha as duas horas do horário, ou deixe as duas vazias.', 'erro', 5000); return; }
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
    return h('details', { class: 'ca-config' },
      h('summary', { text: 'Configurar a busca automática' }),
      h('div', { class: 'pilha' },
        chk('ativo', 'Busca automática ligada'),
        h('div', { class: 'grade-3' },
          ui.campo('Buscar a cada', campos.intervaloMin),
          ui.campo('Só a partir de', campos.horaIni, { ajuda: 'vazio = o dia todo' }),
          ui.campo('Até', campos.horaFim)),
        ui.campo('Pastas dos computadores do carro (uma por linha)', campos.origens, { ajuda: 'Vazio = usa o que está no configuracao.ps1 do script.' }),
        h('div', { class: 'grade-3' },
          ui.campo('Desprezar arquivos com no nome', campos.ignorar, { ajuda: 'separe por vírgula' }),
          ui.campo('Só arquivos dos últimos (dias)', campos.dias, { ajuda: '0 = todos' }),
          ui.campo('Janela de aviso fecha em (s)', campos.segundosAviso)),
        h('div', { class: 'grade-2' },
          ui.campo('Mostrar aviso no fim da busca', campos.avisos),
          ui.campo('Wi-Fi durante a cópia', campos.modoWifi)),
        chk('avisarSemCabo', 'Avisar quando o cabo do carro não estiver conectado'),
        chk('atualizarAuto', 'Atualizar o script sozinho pelo GitHub'),
        h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-primario', onclick: salvar }, ui.icone('check'), 'Salvar configuração'))));
  }

  function conteudo() {
    const cab = h('div', { class: 'tela-cab' }, h('h2', { text: 'Arquivos do carro (busca automática)' }),
      pasta && permitido ? h('button', { class: 'btn-icone', title: 'Ler de novo a pasta', 'aria-label': 'Atualizar arquivos do carro', onclick: () => atualizar() }, ui.icone('sync')) : null);
    if (!pasta) {
      return [cab,
        h('p', { class: 'ca-suave', text: 'Ligue o app à pasta onde o script "Buscar arquivos do carro" grava os arquivos (Documentos\\Carro Controle). Daqui você vê a última busca, carrega os novos na Montagem e configura a busca.' }),
        h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-primario', onclick: escolherPasta }, ui.icone('documento'), 'Escolher a pasta Carro Controle'))];
    }
    if (!permitido) {
      return [cab,
        h('p', { class: 'ca-suave', text: `O navegador pede para confirmar o acesso à pasta ${pasta.name}.` }),
        h('div', { class: 'linha-acoes' },
          h('button', { class: 'btn btn-primario', onclick: permitir }, ui.icone('check'), 'Permitir acesso à pasta'),
          h('button', { class: 'btn', onclick: escolherPasta, text: 'Escolher outra pasta' }))];
    }
    return [cab,
      erro ? h('p', { class: 'aviso aviso-erro', text: erro }) : null,
      ...linhaEstado(),
      h('div', { class: 'ca-novos' },
        h('span', { 'data-carro-novos': '', text: novos.length ? `${novos.length} arquivo(s) aguardando para carregar` : 'Nenhum arquivo aguardando na pasta Novos.' }),
        novos.length ? h('button', { class: 'btn btn-primario', disabled: ocupado || !carregarNaMontagem || null, title: novos.join('\n'), onclick: carregarNovos },
          ui.icone('upload'), ocupado ? 'Carregando…' : 'Carregar na Montagem') : null),
      formulario(),
      h('small', { class: 'ca-suave' }, `Pasta: ${pasta.name} · `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); escolherPasta(); }, text: 'trocar' }))];
  }

  function render() {
    if (!el) return;
    const aberto = el.querySelector('.ca-config') && el.querySelector('.ca-config').open;
    ui.trocar(el, ...conteudo());
    if (aberto && el.querySelector('.ca-config')) el.querySelector('.ca-config').open = true;
  }

  App.carroAuto = {
    suportado,
    /** Cartão (sempre o mesmo elemento) para a Montagem; null onde o navegador não acessa pastas. */
    cartao({ carregar } = {}) {
      if (!suportado()) return null;
      if (carregar) carregarNaMontagem = carregar;
      if (!el) { el = h('section', { class: 'cartao pilha ca-cartao' }); render(); atualizar(); }
      return el;
    },
    atualizar
  };
})(window.App);
