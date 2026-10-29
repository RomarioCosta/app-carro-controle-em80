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
  const CHAVE_CSV = (id) => `montagem:csv:${id}`;

  let raiz;
  let planta = null;
  let arquivos = []; // [{ id, nome, ciclo, adicionadoEm, recorte, resumo }]
  let processando = false;
  const abertos = new Set(); // linhas abertas ("linha|sede") e arquivos abertos ("arq|id")
  let carregado = null; // promessa da primeira leitura do armazenamento

  const km = (m) => B().fmtKm(m);
  const kmTxt = (m) => `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const mTxt = (m) => (m >= 1000 ? kmTxt(m) : `${Math.round(m).toLocaleString('pt-BR')} m`);
  const pctTxt = (p) => `${p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const ciclo = () => U.pref.get('montagem:ciclo', (App.OM && App.OM.cicloAtivo()) || '');
  const doCiclo = () => arquivos.filter((a) => (a.ciclo || '') === ciclo());
  const aba = () => U.pref.get('montagem:aba', 'cobertura');
  /** Saltos/voltas dentro do trecho usado: os dois lados do pulo (km do arquivo) ficam dentro do recorte. */
  const dentroRecorte = (rc, x) => !rc || ((rc.de === null || rc.de === undefined || x >= rc.de) && (rc.ate === null || rc.ate === undefined || x <= rc.ate));
  const compensaveisUsados = (a) => a.resumo.compensaveis.filter((c) => dentroRecorte(a.recorte, c.de) && dentroRecorte(a.recorte, c.km));
  /** Regras da compensação de km (editáveis): margem em m e máximo por ponto em fração do espaçamento. */
  const regras = () => ({ ...B().COMPENSACAO, ...(U.pref.get('montagem:compensacao', {}) || {}) });

  function carregar() {
    if (!carregado) {
      carregado = (async () => {
        planta = App.analise && App.analise.planta ? await App.analise.planta() : null;
        try {
          const salvos = (await store.get(CHAVE)) || [];
          arquivos = salvos.map((a) => ({ ...a, compensar: a.compensar || [], resumo: C().normalizarResumo(a.resumo) }));
          // arquivos adicionados antes desta versão não têm o CSV guardado nem o cálculo dos saltos/voltas
          for (const a of arquivos) a.antigo = !a.resumo.espacamento || !(await store.get(CHAVE_CSV(a.id)).catch(() => null));
        } catch (e) { arquivos = []; }
      })();
    }
    return carregado;
  }

  /**
   * Arquivos calculados numa versão anterior do app (resumo sem a versão atual): recalcula a partir do CSV
   * guardado, mantendo recorte, compensações e correção da linha. Roda em segundo plano, um arquivo por vez.
   */
  let atualizando = null; // { feitos, total } enquanto recalcula
  async function atualizarResumos() {
    if (atualizando || !planta) return;
    const lista = arquivos.filter((a) => !a.antigo && a.resumo.versao !== C().VERSAO_RESUMO);
    if (!lista.length) return;
    atualizando = { feitos: 0, total: lista.length };
    render();
    let ok = 0;
    for (const a of lista) {
      await new Promise((r) => setTimeout(r, 30)); // deixa a tela responder entre um arquivo e outro
      try {
        const texto = await lerCsv(a.id);
        if (texto) {
          const rg = a.regras || regras();
          a.resumo = C().resumirArquivo(B().lerCSV(texto), planta, a.nome, { compensar: a.compensar || [], compensacao: rg, linhas: a.linhas || null });
          a.compensar = (a.compensar || []).filter((ch) => a.resumo.compensaveis.some((c) => c.chave === ch));
          a.regras = rg;
          ok++;
        }
      } catch (e) { /* fica como estava; tenta de novo na próxima vez */ }
      atualizando.feitos++;
      render();
    }
    atualizando = null;
    if (ok) {
      await gravar();
      ui.toast(`${ok} arquivo(s) atualizado(s) para a versão nova (LOCOM, linha do arquivo e RH).`, 'ok', 5000);
    }
    render();
  }

  /* ---------------- CSV guardado (comprimido) ---------------- */

  /** Guarda o CSV comprimido (gzip): a Tela do carro roda o arquivo e a compensação do km recalcula a partir dele. */
  async function guardarCsv(id, texto) {
    try {
      if (typeof CompressionStream !== 'undefined') {
        const blob = await new Response(new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
        await store.set(CHAVE_CSV(id), { gz: blob });
      } else await store.set(CHAVE_CSV(id), { texto });
    } catch (e) { ui.toast(`O arquivo não pôde ser guardado inteiro (${e.message}).`, 'erro', 8000); }
  }
  async function lerCsv(id) {
    const g = await store.get(CHAVE_CSV(id)).catch(() => null);
    if (!g) return null;
    if (g.texto) return g.texto;
    return new Response(g.gz.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  const semCsv = () => ui.toast('Este arquivo foi adicionado numa versão anterior: na Montagem, clique em "Adicionar de novo" e escolha o mesmo arquivo (o recorte é mantido).', 'erro', 9000);
  const gravar = () => store.set(CHAVE, arquivos).catch((e) => ui.toast(`Não foi possível guardar: ${e.message}`, 'erro', 6000));

  /* ---------------- Arquivos ---------------- */

  /** Assinatura do conteúdo do arquivo: o mesmo arquivo com outro nome também é reconhecido como repetido. */
  const assinatura = (pontos, kmIni, kmFim, meta) => [pontos, Math.round(kmIni * 100), Math.round(kmFim * 100), meta.data, meta.corretiva, meta.ramal].join('|');
  const assinaturaDe = (a) => assinatura(a.resumo.pontos, a.resumo.kmIni, a.resumo.kmFim, a.resumo.meta || {});

  /** substituir: true = já confirmado (ex.: "Adicionar de novo" de um arquivo antigo), sem perguntar. */
  async function adicionar(lista, { substituir = false } = {}) {
    if (!planta) { ui.toast('Importe a geometria na Análise do arquivo primeiro.', 'erro', 6000); return; }
    processando = true;
    render();
    let ok = 0; let mantidos = 0;
    for (let k = 0; k < lista.length; k++) {
      const f = lista[k];
      ui.toast(`Processando ${k + 1}/${lista.length}: ${f.name}…`, 'info', 4000);
      await new Promise((r) => setTimeout(r, 30)); // deixa a tela mostrar o aviso
      try {
        const { nome, texto } = await App.analise.textoDoArquivo(f);
        const arq = B().lerCSV(texto);
        const rg = regras();
        // repetido no ciclo: mesmo nome ou mesmo conteúdo (com outro nome)
        const sig = assinatura(arq.pos.length, arq.pos[0], arq.pos[arq.pos.length - 1], arq.meta);
        const doCicloAtual = (a) => (a.ciclo || '') === ciclo();
        let existente = arquivos.findIndex((a) => a.nome === nome && doCicloAtual(a));
        if (existente < 0) existente = arquivos.findIndex((a) => doCicloAtual(a) && !a.antigo && assinaturaDe(a) === sig);
        const anterior = existente >= 0 ? arquivos[existente] : null;
        if (anterior && !substituir) {
          const outroNome = anterior.nome !== nome ? ` com o nome ${anterior.nome} (mesmo conteúdo)` : '';
          const sim = await ui.confirmar('Arquivo já carregado',
            `${nome} já está na Montagem${outroNome}, adicionado em ${U.fmtDataHora(anterior.adicionadoEm) || '—'}. Substituir o arquivo existente? Ele é carregado do zero: o corte, as compensações e a correção da linha do arquivo atual são descartados.`,
            { ok: 'Substituir' });
          if (!sim) { mantidos++; continue; }
        }
        // substituir = carregar do zero; só o "Adicionar de novo" (arquivo de versão antiga) mantém o recorte,
        // a correção da linha e as compensações que ainda existem nele
        const manter = anterior && substituir ? anterior : null;
        const linhas = manter ? manter.linhas || null : null;
        const resumo = C().resumirArquivo(arq, planta, nome, { compensacao: rg, linhas });
        const compensar = manter ? (manter.compensar || []).filter((ch) => resumo.compensaveis.some((c) => c.chave === ch)) : [];
        const final = compensar.length ? C().resumirArquivo(arq, planta, nome, { compensar, compensacao: rg, linhas }) : resumo;
        const item = { id: manter ? manter.id : `${Date.now()}-${k}`, nome, ciclo: ciclo(), adicionadoEm: U.agora(), recorte: manter ? manter.recorte : null, compensar, regras: rg, linhas, resumo: final };
        if (anterior && !manter) await store.del(CHAVE_CSV(anterior.id)).catch(() => {}); // CSV do arquivo substituído
        await guardarCsv(item.id, texto);
        if (existente >= 0) arquivos[existente] = item; else arquivos.push(item);
        ok++;
      } catch (e) {
        ui.toast(`${f.name}: ${e.message}`, 'erro', 8000);
      }
    }
    processando = false;
    await gravar();
    if (ok) ui.toast(`${ok} arquivo(s) adicionado(s).${mantidos ? ` ${mantidos} repetido(s) não substituído(s).` : ''}`, 'ok');
    else if (mantidos) ui.toast(`${mantidos} arquivo(s) repetido(s): o existente foi mantido.`, 'info', 5000);
    render();
  }

  async function remover(a) {
    if (!(await ui.confirmar('Remover arquivo', `Remover ${a.nome} da montagem?`, { ok: 'Remover', perigo: true }))) return;
    arquivos = arquivos.filter((x) => x !== a);
    cortes.delete(a.id);
    await store.del(CHAVE_CSV(a.id)).catch(() => {});
    await gravar();
    render();
  }

  /** Escolher de novo o arquivo (versão anterior): guarda o CSV e recalcula, mantendo o recorte. */
  function reAdicionar(a) {
    const input = h('input', { type: 'file', hidden: true, onchange: async (e) => {
      const f = e.target.files[0];
      input.remove();
      if (!f) return;
      const base = (n) => String(n || '').replace(/\.(zip|csv|txt)$/i, '').toLowerCase();
      if (base(f.name) !== base(a.nome) && !(await ui.confirmar('Arquivo diferente', `Você escolheu ${f.name}, mas este é ${a.nome}. Usar mesmo assim?`, { ok: 'Usar' }))) return;
      await adicionar([f], { substituir: true });
    } });
    document.body.appendChild(input);
    input.click();
  }

  /** Compensar (ou desfazer) um salto/volta do km: recalcula o arquivo a partir do CSV guardado. */
  async function mudarCompensacao(a, chave, compensar) {
    const texto = await lerCsv(a.id).catch(() => null);
    if (!texto) { semCsv(); return; }
    const lista = compensar ? [...new Set([...(a.compensar || []), chave])] : (a.compensar || []).filter((x) => x !== chave);
    ui.toast(`Recalculando ${a.nome}…`, 'info', 3000);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const rg = regras();
      a.resumo = C().resumirArquivo(B().lerCSV(texto), planta, a.nome, { compensar: lista, compensacao: rg, linhas: a.linhas });
      a.compensar = lista.filter((ch) => a.resumo.compensaveis.some((c) => c.chave === ch));
      a.regras = rg;
      await gravar();
      ui.toast(compensar ? 'Compensado: a diferença foi distribuída nos pontos desde o último acerto do km.' : 'Compensação desfeita.', 'ok');
    } catch (e) { ui.toast(`Não foi possível recalcular: ${e.message}`, 'erro', 7000); }
    render();
  }

  /** Correção da coluna LINHA (trocar um valor ou definir a linha num trecho de km): recalcula o arquivo. */
  async function mudarLinhas(a, linhas, mensagem) {
    const texto = await lerCsv(a.id).catch(() => null);
    if (!texto) { semCsv(); return; }
    ui.toast(`Recalculando ${a.nome}…`, 'info', 3000);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const vazio = !Object.keys(linhas.valores || {}).length && !(linhas.trechos || []).length;
      a.resumo = C().resumirArquivo(B().lerCSV(texto), planta, a.nome, { compensar: a.compensar || [], compensacao: a.regras || regras(), linhas: vazio ? null : linhas });
      a.linhas = vazio ? null : linhas;
      await gravar();
      ui.toast(mensagem, 'ok');
    } catch (e) { ui.toast(`Não foi possível recalcular: ${e.message}`, 'erro', 7000); }
    render();
  }

  /** Regras mudaram: recalcula todos os arquivos guardados, para a Montagem e a Tela do carro usarem as mesmas regras. */
  async function recalcularTodos() {
    const rg = regras();
    const lista = arquivos.filter((a) => !a.antigo);
    if (!lista.length) return;
    processando = true;
    render();
    let feitos = 0; const perdidas = [];
    for (const a of lista) {
      ui.toast(`Recalculando ${feitos + 1}/${lista.length}: ${a.nome}…`, 'info', 3000);
      await new Promise((r) => setTimeout(r, 30));
      try {
        const texto = await lerCsv(a.id);
        if (!texto) continue;
        a.resumo = C().resumirArquivo(B().lerCSV(texto), planta, a.nome, { compensar: a.compensar || [], compensacao: rg, linhas: a.linhas });
        const mantidas = (a.compensar || []).filter((ch) => a.resumo.compensaveis.some((c) => c.chave === ch));
        if (mantidas.length < (a.compensar || []).length) perdidas.push(a.nome);
        a.compensar = mantidas;
        a.regras = rg;
        feitos++;
      } catch (e) { ui.toast(`${a.nome}: ${e.message}`, 'erro', 7000); }
    }
    processando = false;
    await gravar();
    ui.toast(perdidas.length
      ? `${feitos} arquivo(s) recalculados. Pelas regras novas, compensações deixaram de valer em: ${perdidas.join(', ')}.`
      : `${feitos} arquivo(s) recalculados com as regras novas.`, perdidas.length ? 'erro' : 'ok', perdidas.length ? 9000 : 4000);
    render();
  }

  /**
   * Roda o arquivo na Tela do carro (Offboard), com o recorte, as compensações e as regras dele.
   * alvo = { i } (ponto do arquivo, exato mesmo com o km compensado) ou { km } (km do arquivo).
   */
  async function abrirNaTela(a, alvo = null) {
    const texto = await lerCsv(a.id).catch(() => null);
    if (!texto) { semCsv(); return false; }
    window.dispatchEvent(new CustomEvent('em80:checklist-aba', { detail: 'tela' }));
    ui.toast(`Abrindo ${a.nome} na Tela do carro…`, 'info', 2500);
    await new Promise((r) => setTimeout(r, 30));
    App.analise.abrirTexto(texto, a.nome, { recorte: a.recorte, compensar: a.compensar || [], regras: a.regras || regras(), linhas: a.linhas || null });
    atual = a.id;
    if (App.telaCarro.aoMostrar) App.telaCarro.aoMostrar();
    if (alvo && Number.isInteger(alvo.i)) App.telaCarro.irParaPonto(alvo.i);
    else if (alvo && alvo.km !== undefined && alvo.km !== null) App.telaCarro.irParaKm(String(Math.round(alvo.km) / 1000).replace('.', ','));
    return true;
  }
  let atual = null; // arquivo da Montagem rodando na Tela do carro

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
    // um traço fino em cada RH (pátio): mostra até que RH o trecho já foi medido
    linha.sedes.filter(dentro).flatMap((s) => s.rh || []).forEach((p) => {
      const meio = (p.ini + p.fim) / 2;
      if (meio < ini || meio > fim) return;
      el.appendChild(svg('line', { x1: x(meio), x2: x(meio), y1: 1, y2: 13, class: 'mt-rh' }));
    });
    const comDica = dicaFaixa(el, linha, ini, fim);
    if (!divisas) return comDica;
    // nomes das sedes em HTML (o SVG é esticado na largura e deformaria o texto)
    const rotulos = h('div', { class: 'mt-rotulos' });
    linha.sedes.filter(dentro).forEach((s, k) => {
      const xa = x(Math.max(ini, s.ini)); const xb = x(Math.min(fim, s.fim));
      if (k) el.appendChild(svg('line', { x1: xa, x2: xa, y1: 0, y2: 16, class: 'mt-div' }));
      rotulos.appendChild(h('span', { style: `left:${xa / 10}%;width:${(xb - xa) / 10}%`, text: C().normSede(s.sede), title: `${s.sede} ${km(s.ini)} – ${km(s.fim)}` }));
    });
    return h('div', { class: 'mt-faixa-caixa' }, comDica, rotulos);
  }

  /**
   * Dica da faixa: passando o mouse ou tocando, mostra o km daquele ponto, se está medido, buraco ou falta medir,
   * a sede e o RH (pátio) em que está ou o mais próximo.
   */
  function dicaFaixa(el, linha, ini, fim) {
    const dica = h('div', { class: 'mt-dica', hidden: true, role: 'status' });
    const cursor = h('div', { class: 'mt-dica-cursor', hidden: true });
    const caixa = h('div', { class: 'mt-faixa-dica' }, el, cursor, dica);
    const dentroDe = (p, iv) => iv.some(([a, b]) => p >= a && p <= b);
    const mostrar = (e) => {
      const ret = el.getBoundingClientRect();
      if (!ret.width) return;
      const fr = Math.min(1, Math.max(0, (e.clientX - ret.left) / ret.width));
      const p = ini + fr * (fim - ini);
      const sede = linha.sedes.find((s) => p >= s.ini && p <= s.fim);
      let situacao = 'fora do que precisa medir';
      if (sede) {
        if (linha.sobreposicoes.some((o) => p >= o.ini && p <= o.fim)) situacao = 'medido 2×';
        else if (dentroDe(p, sede.cobertos || [])) situacao = 'medido';
        else if (sede.coberto > 0 && linha.buracos.some((b) => p >= b.ini && p <= b.fim)) situacao = 'buraco';
        else situacao = 'falta medir';
      }
      const rhs = linha.sedes.flatMap((s) => s.rh || []);
      const noRh = rhs.find((q) => p >= q.ini && p <= q.fim);
      const perto = noRh ? null : rhs.reduce((m, q) => (!m || Math.abs((q.ini + q.fim) / 2 - p) < Math.abs((m.ini + m.fim) / 2 - p) ? q : m), null);
      const rhTxt = noRh ? `no ${noRh.nome || 'RH'}` : perto ? `${mTxt(Math.abs((perto.ini + perto.fim) / 2 - p))} ${(perto.ini + perto.fim) / 2 > p ? 'antes' : 'depois'} do ${perto.nome || 'RH'}` : '';
      ui.trocar(dica, h('strong', { text: `km ${km(p)}` }), h('span', { text: [situacao, sede ? C().normSede(sede.sede) : '', rhTxt].filter(Boolean).join(' · ') }));
      dica.hidden = false; cursor.hidden = false;
      const xr = fr * ret.width;
      cursor.style.left = `${xr}px`;
      dica.style.left = `${Math.min(Math.max(xr - dica.offsetWidth / 2, 0), Math.max(0, ret.width - dica.offsetWidth))}px`;
    };
    const esconder = () => { dica.hidden = true; cursor.hidden = true; };
    el.addEventListener('pointermove', mostrar);
    el.addEventListener('pointerdown', mostrar);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') esconder(); });
    return caixa;
  }
  // no toque, a dica fica até tocar fora da faixa (um só ouvinte para todas as faixas)
  document.addEventListener('pointerdown', (e) => {
    document.querySelectorAll('.mt-faixa-dica').forEach((c) => {
      if (c.contains(e.target)) return;
      c.querySelectorAll('.mt-dica, .mt-dica-cursor').forEach((x) => { x.hidden = true; });
    });
  });

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
        // até onde foi medido, pelos RH (pátios) que ficam dentro de cada trecho medido
        (s.cobertos || []).forEach(([a, b]) => {
          const dentroRh = (s.rh || []).filter((p) => (p.ini + p.fim) / 2 >= a && (p.ini + p.fim) / 2 <= b);
          const pelosRh = dentroRh.length ? ` · ${dentroRh[0].nome}${dentroRh.length > 1 ? ` → ${dentroRh[dentroRh.length - 1].nome}` : ''}` : '';
          itens.push(h('li', { class: 'mt-ok-txt' }, h('span', { text: `Medido ${km(a)} – ${km(b)} (${mTxt(b - a)})${pelosRh}` })));
        });
        buracos.forEach((b) => itens.push(h('li', { class: 'mt-erro-txt' }, h('span', { text: `Buraco ${km(b.ini)} – ${km(b.fim)} (${mTxt(b.fim - b.ini)}) · ${b.eh}${onde(b)}` }))));
        s.sobreposicoes.forEach((o) => itens.push(h('li', { class: 'mt-atencao-txt' }, h('span', { text: `Medido 2× ${km(o.ini)} – ${km(o.fim)} (${mTxt(o.fim - o.ini)}): ${o.arquivos.join(' e ')}. Recorte um dos arquivos.` }))));
        if (!s.arquivos.length) itens.push(h('li', { class: 'mt-sub', text: 'Nenhum arquivo desta sede ainda.' }));
        linhasTabela.push(h('tr', { class: 'mt-detalhe' }, h('td', { colspan: 7 }, h('ul', { class: 'mt-lista' }, itens))));
      }
    });
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'mt-linha-cab' }, h('h2', { text: `Linha ${l.linha}` }), h('span', { class: 'mt-sub', text: `${pctTxt(l.pct)} · falta ${kmTxt(Math.max(0, l.necessario - l.coberto))} de ${kmTxt(l.necessario)}` })),
      faixa(l, ini, fim),
      h('div', { class: 'mt-legenda' }, ['mt-cob:Medido', 'mt-bur:Buraco', 'mt-sob:Medido 2×', 'mt-nec:Falta medir', 'mt-rh:RH (pátio)'].map((x) => { const [c, t] = x.split(':'); return h('span', null, h('i', { class: c }), t); })),
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

  /** Sede do arquivo: coluna CORRETIVA (GV1, CS…); sem ela, a sede onde o arquivo caiu na geometria. */
  const sedeDo = (a, conferencia) => {
    if (a.resumo.corretiva) return a.resumo.corretiva;
    const conf = conferencia.find((c) => c.id === a.id);
    const t = conf && [...conf.trechos].sort((x, y) => y.m - x.m)[0];
    return t ? C().normSede(t.sede) : '';
  };
  /** Busca da sede enquanto digita: redesenha e devolve o foco (com o cursor no fim) ao campo. */
  const buscarSede = U.debounce((texto) => {
    U.pref.set('montagem:filtroSedeTexto', texto);
    render();
    const campo = raiz && raiz.querySelector('input[name="filtroSede"]');
    if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
  }, 250);
  /** Data da inspeção (coluna DATA, dd/mm/aaaa) em aaaa-mm-dd, para ordenar. */
  const dataIso = (d) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(d || '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

  function cartaoArquivos(todos, conferencia) {
    if (!todos.length) {
      return h('section', { class: 'cartao' }, h('h2', { text: 'Arquivos' }), h('p', { class: 'vazio', text: 'Nenhum arquivo neste ciclo. Adicione os arquivos do carro (.csv ou .zip).' }));
    }
    // filtro por data e sede (só a lista de arquivos; a cobertura continua com o ciclo todo)
    const sedes = [...new Set(todos.map((a) => sedeDo(a, conferencia)).filter(Boolean))].sort();
    const datas = [...new Set(todos.map((a) => (a.resumo.meta && a.resumo.meta.data) || '').filter(Boolean))].sort((x, y) => dataIso(y).localeCompare(dataIso(x)));
    // sede: texto livre (em branco = todas); busca na sede e no nome do arquivo, sem diferenciar maiúsculas e acentos
    const fSede = String(U.pref.get('montagem:filtroSedeTexto', '') || '');
    const busca = U.normalizar(fSede).replace(/\s+/g, '');
    const fData = datas.includes(U.pref.get('montagem:filtroData', '')) ? U.pref.get('montagem:filtroData', '') : '';
    const semExtensao = (n) => String(n || '').replace(/\.(csv|txt|zip)$/i, ''); // ".csv" não pode casar com a sede CS
    const casaSede = (a) => !busca || [sedeDo(a, conferencia), semExtensao(a.nome)].some((t) => U.normalizar(t).replace(/\s+/g, '').includes(busca));
    const lista = todos.filter((a) => casaSede(a) && (!fData || (a.resumo.meta && a.resumo.meta.data) === fData));
    const filtroSel = (rotulo, valor, opcoes, chave) => ui.campo(rotulo, h('select', { onchange: (e) => { U.pref.set(chave, e.target.value); render(); } },
      [['', 'Todas'], ...opcoes.map((o) => [o, o])].map(([v, t]) => h('option', { value: v, selected: v === valor || null, text: t }))));
    const campoSede = ui.campo('Sede', h('input', {
      type: 'search', name: 'filtroSede', value: fSede, placeholder: 'ex.: GV2, CS', list: 'mt-sedes', autocomplete: 'off',
      oninput: (e) => buscarSede(e.target.value)
    }));
    const filtros = h('div', { class: 'mt-filtros' },
      campoSede,
      h('datalist', { id: 'mt-sedes' }, sedes.map((x) => h('option', { value: x }))),
      filtroSel('Data da inspeção', fData, datas, 'montagem:filtroData'),
      fSede || fData ? h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => { U.pref.set('montagem:filtroSedeTexto', ''); U.pref.set('montagem:filtroData', ''); render(); } }, ui.icone('x'), 'Limpar filtros') : null,
      h('span', { class: 'mt-sub', role: 'status', text: fSede || fData ? `Mostrando ${lista.length} de ${todos.length} arquivo(s)` : '' }));
    const ordem = [...lista].sort((a, b) => (a.resumo.ramal + a.resumo.linhaRef).localeCompare(b.resumo.ramal + b.resumo.linhaRef) || Math.min(a.resumo.kmIni, a.resumo.kmFim) - Math.min(b.resumo.kmIni, b.resumo.kmFim));
    const antigos = todos.filter((a) => a.antigo);
    const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) adicionar(l, { substituir: true }); } });
    const aberto = U.pref.get('montagem:arquivosAberto', true);
    return h('details', { class: 'cartao mt-arquivos', open: aberto || null, ontoggle: (e) => U.pref.set('montagem:arquivosAberto', e.target.open) },
      h('summary', { class: 'mt-recolhe' }, h('h2', { text: `Arquivos (${todos.length})` }),
        lista.length !== todos.length ? h('span', { class: 'mt-sub', text: `${lista.length} no filtro` }) : null),
      h('div', { class: 'pilha' },
        todos.length > 1 ? filtros : null,
        !lista.length ? h('p', { class: 'vazio', text: 'Nenhum arquivo com esse filtro.' }) : null,
        atualizando ? h('p', { class: 'aviso', role: 'status', text: `Atualizando os arquivos para a versão nova do app: ${atualizando.feitos} de ${atualizando.total}…` }) : null,
        antigos.length ? h('div', { class: 'aviso pilha' },
          h('span', { text: `${antigos.length} arquivo(s) foram adicionados numa versão anterior do app. Para ter o ajuste do km (Compensar), os alertas de geometria e a Tela do carro, adicione de novo os mesmos arquivos (pode selecionar todos de uma vez). O recorte de cada um é mantido.` }),
          h('div', null, h('button', { class: 'btn btn-primario btn-pequeno', disabled: processando || null, onclick: () => input.click() }, ui.icone('upload'), 'Adicionar de novo'), input)) : null,
        ordem.map((a) => {
          const r = a.resumo;
          const conf = conferencia.find((c) => c.id === a.id) || { trechos: [], avisos: [] };
          const avisos = [...conf.avisos, ...r.inconsistencias];
          const ondeCaiu = [...new Map(conf.trechos.map((t) => [`${t.linha}|${t.sede}`, t])).values()].map((t) => `L${t.linha} ${C().normSede(t.sede)} ${kmTxt(t.m)}`).join(' · ');
          const erros = avisos.filter((x) => x.tipo === 'erro').length; const alertas = avisos.filter((x) => x.tipo === 'alerta').length;
          // corte: os campos guardam o valor digitado; só vale ao clicar em "Aplicar corte"
          const pend = cortes.get(a.id) || { de: a.recorte ? a.recorte.de ?? null : null, ate: a.recorte ? a.recorte.ate ?? null : null };
          const editar = (campo, v) => { pend[campo] = v; cortes.set(a.id, pend); };
          const aplicarCorte = async (novo) => {
            let { de, ate } = novo;
            if (de !== null && ate !== null && de > ate) [de, ate] = [ate, de];
            a.recorte = de === null && ate === null ? null : { de, ate };
            cortes.delete(a.id);
            await gravar(); render();
            ui.toast(a.recorte ? `Corte aplicado em ${a.nome}: ${corteTxt(a.recorte)}.` : `Corte retirado de ${a.nome}: o arquivo inteiro é usado.`, 'ok');
          };
          return h('details', { class: 'mt-arquivo', open: abertos.has(`arq|${a.id}`) || null, ontoggle: (e) => { if (e.target.open) abertos.add(`arq|${a.id}`); else abertos.delete(`arq|${a.id}`); } },
            h('summary', null,
              h('span', { class: `mt-ponto ${erros ? 'mt-erro' : alertas ? 'mt-alerta' : 'mt-ok'}` }),
              h('strong', { text: a.nome }),
              h('span', { class: 'mt-sub', text: ` · ${r.corretiva || '—'} · ${r.ramal || r.meta.ramal || '—'} L${r.linhaRef} · ${km(r.kmIni)} → ${km(r.kmFim)}${a.recorte ? ' · recortado' : ''}${a.linhas ? ' · linha corrigida' : ''}` }),
              h('span', { class: 'mt-data', text: [r.meta.data, sentidoTxt(r)].filter(Boolean).join(' · ') }),
              a.antigo ? h('span', { class: 'mt-cont', text: 'adicionar de novo' }) : compensaveisUsados(a).some((c) => !c.tratado) ? h('span', { class: 'mt-cont', text: `${compensaveisUsados(a).filter((c) => !c.tratado).length} salto(s)/volta(s) para compensar` })
                : avisos.length ? h('span', { class: 'mt-cont', text: `${avisos.length} aviso(s)` }) : null),
            h('div', { class: 'pilha mt-arquivo-corpo' },
              h('p', { class: 'mt-sub', text: `Caiu em: ${ondeCaiu || '—'} · correção do km pela geometria ${Math.round(r.correcao.min)} a ${Math.round(r.correcao.max)} m · ${r.correcao.casadas}/${r.correcao.curvas} curvas casadas` }),
              avisos.length ? h('ul', { class: 'mt-lista' }, avisos.map((x) => h('li', { class: x.tipo === 'erro' ? 'mt-erro-txt' : x.tipo === 'alerta' ? 'mt-atencao-txt' : 'mt-sub', text: x.texto }))) : h('p', { class: 'mt-sub', text: 'Sem inconsistências.' }),
              a.antigo ? h('div', { class: 'aviso' }, 'Adicionado numa versão anterior: sem o ajuste do km (Compensar) e sem a Tela do carro. ',
                h('button', { class: 'btn btn-primario btn-pequeno', onclick: () => reAdicionar(a) }, ui.icone('upload'), 'Adicionar de novo')) : null,
              r.compensaveis.length ? listaCompensaveis(a) : null,
              a.antigo ? null : cartaoLinhaArquivo(a),
              h('div', { class: 'linha-acoes' },
                h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => abrirNaTela(a) }, ui.icone('play'), 'Rodar na Tela do carro')),
              h('div', { class: 'pilha mt-comp mt-corte' },
                h('strong', { text: 'Corte do arquivo' }),
                h('span', { class: 'mt-sub', text: a.recorte ? `Corte atual: ${corteTxt(a.recorte)} (km do arquivo).` : 'Sem corte: o arquivo inteiro é usado.' }),
                h('div', { class: 'grade-2' },
                  ui.campo('Usar a partir do km', campoKm(pend.de, (v) => editar('de', v), 'início')),
                  ui.campo('Até o km', campoKm(pend.ate, (v) => editar('ate', v), 'fim'))),
                h('div', { class: 'linha-acoes' },
                  h('button', { class: 'btn btn-primario btn-pequeno', onclick: () => aplicarCorte(pend) }, ui.icone('check'), 'Aplicar corte'),
                  a.recorte ? h('button', { class: 'btn btn-secundario btn-pequeno', onclick: () => aplicarCorte({ de: null, ate: null }) }, ui.icone('x'), 'Limpar corte') : null)),
              h('div', { class: 'linha-acoes' }, h('button', { class: 'btn btn-fantasma', onclick: () => remover(a) }, ui.icone('lixo'), 'Remover arquivo'))));
        })));
  }

  /** Corte digitado e ainda não aplicado, por arquivo (id → { de, ate }). */
  const cortes = new Map();
  const corteTxt = (rc) => [rc.de !== null && rc.de !== undefined ? `a partir do km ${km(rc.de)}` : '', rc.ate !== null && rc.ate !== undefined ? `até o km ${km(rc.ate)}` : ''].filter(Boolean).join(' ');

  /** Sentido da inspeção: coluna SEQUÊNCIA do arquivo (C/D) e o km crescente ou decrescente. */
  function sentidoTxt(r) {
    const seq = String((r.meta && r.meta.sentido) || '').trim().toUpperCase();
    const km = r.kmFim < r.kmIni ? 'km decrescente' : 'km crescente';
    return seq ? `Sentido ${seq} (${km})` : km;
  }

  /* ---------------- Linha do arquivo (coluna LINHA) ---------------- */

  /**
   * Correção da coluna LINHA: o operador pode errar ou confundir as linhas, e "LOCOM" é o carro em deslocamento.
   * Troca cada valor da coluna (para uma linha ou para "desconsiderar") e define a linha num trecho de km.
   */
  function cartaoLinhaArquivo(a) {
    const r = a.resumo;
    const vazia = { valores: {}, trechos: [] };
    if (!r.valoresLinha) {
      return h('div', { class: 'pilha mt-comp' }, h('strong', { text: 'Linha do arquivo' }),
        h('div', null, h('span', { class: 'mt-sub', text: atualizando ? 'Atualizando este arquivo para a versão nova…' : 'Para corrigir a linha deste arquivo, recalcule-o (calculado numa versão anterior). ' }),
          h('button', { class: 'btn btn-secundario btn-pequeno', disabled: processando || null, onclick: () => mudarLinhas(a, a.linhas || vazia, 'Arquivo recalculado.') }, 'Recalcular')));
    }
    const linhasPlanta = planta && r.ramal && planta.ramais[r.ramal] ? planta.ramais[r.ramal].map(String) : [];
    const atual = a.linhas || vazia;
    const regra = () => ({ valores: { ...(atual.valores || {}) }, trechos: [...(atual.trechos || [])] });
    const DESL = B().DESLOCAMENTO;
    const nomeLinha = (l) => (B().ehDeslocamento(l) ? 'desconsiderar (deslocamento)' : `linha ${l}`);
    const auto = (v) => (B().ehDeslocamento(v) ? 'desconsiderar' : B().linhaDaPlanta(v, linhasPlanta) ? `linha ${B().linhaDaPlanta(v, linhasPlanta)}` : `linha ${r.linhaRef}`);
    const opcoesLinha = () => [...linhasPlanta.map((l) => [l, `Linha ${l}`]), [DESL, 'Desconsiderar (LOCOM)']];
    const rotuloValor = (v) => (String(v).trim() === '' ? '(vazio)' : v);

    const linhasValores = r.valoresLinha.map((x) => {
      const escolhido = (atual.valores || {})[x.valor] || '';
      const sel = h('select', {
        'aria-label': `Usar o valor ${rotuloValor(x.valor)} como`,
        onchange: (e) => {
          const nova = regra();
          if (e.target.value) nova.valores[x.valor] = e.target.value; else delete nova.valores[x.valor];
          mudarLinhas(a, nova, `"${rotuloValor(x.valor)}" agora vale como ${e.target.value ? nomeLinha(e.target.value) : 'automático'}.`);
        }
      }, [['', `Automático (${auto(x.valor)})`], ...opcoesLinha()].map(([v, t]) => h('option', { value: v, selected: v === escolhido || null, text: t })));
      return h('div', { class: 'mt-valor-linha', role: 'group', 'aria-label': `Valor ${rotuloValor(x.valor)}` },
        h('div', null, h('strong', { text: rotuloValor(x.valor) }),
          h('span', { class: 'mt-sub', text: ` · ${n0(x.pontos)} pontos · ${km(x.de)} – ${km(x.ate)}` })),
        sel);
    });

    // linha num ou mais trechos de km: várias linhas (início, fim, linha) aplicadas de uma vez
    const novos = [{ de: null, ate: null, linha: linhasPlanta[0] || DESL }];
    const caixaNovos = h('div', { class: 'mt-trechos-novos' });
    const desenharNovos = () => ui.trocar(caixaNovos,
      h('div', { class: 'mt-trecho-cab', 'aria-hidden': 'true' }, h('span', { text: 'Início (km)' }), h('span', { text: 'Fim (km)' }), h('span', { text: 'Linha' }), h('span')),
      novos.map((t, k) => h('div', { class: 'mt-trecho-linha' },
        h('input', { type: 'text', inputmode: 'decimal', class: 'mt-km', 'aria-label': `Início do trecho ${k + 1}`, placeholder: 'Início (km)', value: t.de === null ? '' : km(t.de), onchange: (e) => { t.de = lerKm(e.target, t.de); } }),
        h('input', { type: 'text', inputmode: 'decimal', class: 'mt-km', 'aria-label': `Fim do trecho ${k + 1}`, placeholder: 'Fim (km)', value: t.ate === null ? '' : km(t.ate), onchange: (e) => { t.ate = lerKm(e.target, t.ate); } }),
        h('select', { 'aria-label': `Linha do trecho ${k + 1}`, onchange: (e) => { t.linha = e.target.value; } },
          opcoesLinha().map(([v, txt]) => h('option', { value: v, selected: v === t.linha || null, text: txt }))),
        novos.length > 1 ? h('button', { type: 'button', class: 'btn-icone', 'aria-label': `Tirar a linha ${k + 1}`, title: 'Tirar esta linha', onclick: () => { novos.splice(k, 1); desenharNovos(); } }, ui.icone('x')) : h('span'))));
    desenharNovos();
    const aplicarTrechos = () => {
      const preenchidos = novos.filter((t) => t.de !== null || t.ate !== null);
      if (!preenchidos.length) { ui.toast('Informe o km inicial e o final do trecho.', 'erro'); return; }
      if (preenchidos.some((t) => t.de === null || t.ate === null)) { ui.toast('Cada trecho precisa do km inicial e do final.', 'erro'); return; }
      const nova = regra();
      preenchidos.forEach((t) => nova.trechos.push({ de: Math.min(t.de, t.ate), ate: Math.max(t.de, t.ate), linha: t.linha }));
      const desc = preenchidos.map((t) => `${km(Math.min(t.de, t.ate))} – ${km(Math.max(t.de, t.ate))}: ${nomeLinha(t.linha)}`).join('; ');
      mudarLinhas(a, nova, preenchidos.length > 1 ? `${preenchidos.length} trechos aplicados (${desc}).` : `Trecho ${desc}.`);
    };
    const trechos = (atual.trechos || []).map((t, k) => h('li', null,
      h('span', { text: `${km(t.de)} – ${km(t.ate)} → ${nomeLinha(t.linha)}` }),
      h('button', { class: 'btn-icone', 'aria-label': `Remover o trecho ${km(t.de)} – ${km(t.ate)}`, title: 'Remover', onclick: () => {
        const nova = regra(); nova.trechos.splice(k, 1);
        mudarLinhas(a, nova, 'Trecho removido.');
      } }, ui.icone('lixo'))));

    return h('div', { class: 'pilha mt-comp mt-linha-arq' },
      h('strong', { text: 'Linha do arquivo' }),
      h('span', { class: 'mt-sub', text: 'Valores da coluna LINHA. "LOCOM" é o carro em deslocamento e fica fora da cobertura e dos alertas. Se o operador errou a linha, troque o valor ou defina a linha num trecho de km: vale para a cobertura, os alertas, a Tela do carro e a Análise.' }),
      h('div', { class: 'mt-valores-linha' }, linhasValores),
      h('strong', { class: 'mt-sub-titulo', text: 'Linha num trecho de km' }),
      trechos.length ? h('ul', { class: 'mt-lista mt-trechos' }, trechos) : null,
      caixaNovos,
      h('div', { class: 'linha-acoes' },
        h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => { novos.push({ de: null, ate: null, linha: novos[novos.length - 1].linha }); desenharNovos(); } }, ui.icone('plus'), 'Outro trecho'),
        h('button', { type: 'button', class: 'btn btn-primario btn-pequeno', disabled: processando || null, onclick: aplicarTrechos }, 'Aplicar')));
  }

  /** Km digitado num campo (290+500 ou 290,5); inválido avisa e volta ao valor anterior. */
  function lerKm(input, anterior) {
    const t = input.value.trim();
    if (!t) return null;
    const m = B().kmParaMetros(t);
    if (m === null || Number.isNaN(m)) { ui.toast('Km inválido. Use 290+000 ou 290,5.', 'erro'); input.value = anterior === null ? '' : km(anterior); return anterior; }
    return m;
  }

  /* ---------------- Compensação de saltos e voltas do km ---------------- */

  const n2 = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const n0 = (v) => Math.round(v).toLocaleString('pt-BR');

  function listaCompensaveis(a) {
    const r = a.resumo;
    const esp = r.espacamento || 0.25;
    const rg = a.regras || regras(); // regras com que o arquivo foi calculado
    const usados = compensaveisUsados(a);
    const fora = r.compensaveis.length - usados.length;
    return h('div', { class: 'pilha mt-comp' },
      h('strong', { text: 'Saltos e voltas do km' }),
      fora ? h('span', { class: 'mt-sub', text: `${fora} salto(s)/volta(s) fora do trecho usado (recorte): não precisam de compensação.` }) : null,
      usados.map((c) => {
        // a compensação usa todos os pontos desde o último acerto (resumos de versões anteriores guardavam outro N)
        const ext = c.extensao ?? c.disponiveis * esp;
        const pct = (Math.abs(c.delta) / ext) * 100;
        const porPonto = c.delta / c.disponiveis;
        const cabe = pct <= rg.passoMax * 100 + 1e-10;
        const desde = c.desde !== undefined ? `desde ${km(c.desde)}` : 'desde o início do arquivo ou o pulo anterior';
        const ganha = c.tipo === 'salto' ? 'ganha' : 'perde';
        return h('div', { class: `mt-comp-item ${c.tratado ? 'mt-comp-feito' : ''}` },
          h('div', null, h('strong', { text: `Km ${c.tipo === 'salto' ? 'salta' : 'volta'} de ${km(c.de)} para ${km(c.km)}` }),
            h('span', { class: 'mt-sub', text: c.tipo === 'salto' ? ` · buraco de ${n2(Math.abs(c.delta))} m (${n0(c.pontosFaltando)} pontos)` : ` · sobreposição de ${n2(Math.abs(c.delta))} m (${n0(c.pontosFaltando)} pontos)` })),
          h('div', { class: cabe ? 'mt-sub' : 'mt-atencao-txt', text: `Compensar: a diferença é espalhada nos ${n0(c.disponiveis)} pontos desde o último acerto do km (${desde}, ${mTxt(ext)} antes do pulo). Cada ponto ${ganha} ${n2(Math.abs(porPonto), 4)} m a mais que o anterior (${n2(pct, 2)}% do espaçamento), até ${n2(Math.abs(c.delta))} m no último ponto antes do pulo. O km depois do pulo não muda.${cabe ? '' : ` Passa do máximo de ${n2(rg.passoMax * 100, 1)}% por ponto: confira se é mesmo acerto de km (e não passada repetida ou arquivo faltando).`}` }),
          h('div', { class: 'linha-acoes' },
            c.tratado ? h('span', { class: 'mt-selo mt-ok', text: cabe ? '✓ Compensado' : `✓ Compensado (${n2(pct, 1)}% por ponto)` }) : null,
            h('button', { class: `btn ${c.tratado ? 'btn-fantasma' : cabe ? 'btn-primario' : 'btn-secundario'} btn-pequeno`, disabled: processando || null, onclick: () => mudarCompensacao(a, c.chave, !c.tratado) },
              c.tratado ? 'Desfazer' : cabe ? 'Compensar' : `Compensar mesmo assim (${n2(pct, 1)}% por ponto)`)));
      }));
  }

  function cartaoRegras() {
    const rg = regras();
    const salvar = (campo, v) => {
      const atual = U.pref.get('montagem:compensacao', {}) || {};
      U.pref.set('montagem:compensacao', { ...atual, [campo]: v });
      ui.toast('Regra salva. Recalculando os arquivos da Montagem…', 'ok', 3000);
      recalcularTodos();
    };
    const campoNum = (rotulo, valor, aoMudar, ajuda) => ui.campo(rotulo, h('input', {
      type: 'text', inputmode: 'decimal', value: String(valor).replace('.', ','),
      onchange: (e) => { const v = U.numero(e.target.value); if (v === null || v <= 0) { ui.toast('Valor inválido.', 'erro'); return; } aoMudar(v); }
    }), { ajuda });
    return h('details', { class: 'cartao detalhes' },
      h('summary', null, h('strong', { text: 'Regras da compensação do km' }), h('span', { class: 'sub', text: ` · até ${n2(rg.margem, 1)} m não mexe · espalha desde o último acerto · alerta acima de ${n2(rg.passoMax * 100, 1)}% por ponto` })),
      h('div', { class: 'grade-3', style: { marginTop: '12px' } },
        campoNum('Margem de erro (m)', rg.margem, (v) => salvar('margem', v), 'Salto ou volta até este valor não é compensado.'),
        campoNum('Máximo por ponto (% do espaçamento)', n2(rg.passoMax * 100, 1), (v) => salvar('passoMax', v / 100), 'Acima disso o app pede confirmação. 1% de 0,25 m = 0,0025 m por ponto.'),
        campoNum('Maior salto/volta (m)', rg.maxSalto, (v) => salvar('maxSalto', v), 'Acima disso é passada repetida ou falta de arquivo: use o recorte.')));
  }

  /* ---------------- Conferência da geometria ---------------- */

  /** Km de cada ramal e linha pela geometria importada, para comparar com a planilha. */
  function cartaoGeometria() {
    const lista = C().resumoGeometria(planta);
    const semRhGeo = planta.fonte === 'geometria' && !planta.rhs;
    return h('details', { class: 'cartao detalhes mt-geo', open: abertos.has('geo') || null, ontoggle: (e) => { if (e.target.open) abertos.add('geo'); else abertos.delete('geo'); } },
      h('summary', null, h('strong', { text: 'Conferência da geometria' }), h('span', { class: 'sub', text: ` · km de cada ramal e linha (${lista.length})` })),
      h('div', { class: 'pilha', style: { marginTop: '12px' } },
        h('p', { class: 'mt-sub', text: 'O que precisa ser medido, pela geometria importada: início, fim e extensão de cada ramal e linha (tangentes, curvas e RH). Compare com a planilha; se algum km não bater, me avise com o ramal e a linha.' }),
        semRhGeo ? h('p', { class: 'aviso', text: 'A geometria foi importada numa versão anterior do app, sem as RH: elas estão sendo deduzidas pelos vãos entre os elementos. Importe a geometria de novo na Análise do arquivo para usar as RH da planilha (inclusive no início e no fim de cada ramal).' }) : null,
        (planta.avisos || []).length ? h('ul', { class: 'mt-lista' }, planta.avisos.map((t) => h('li', { class: 'mt-atencao-txt', text: t }))) : null,
        h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela mt-tabela' },
          h('thead', null, h('tr', null, ['Ramal', 'Linha', 'Início', 'Fim', 'Extensão', 'Tang.', 'Curvas', 'RH', 'Sedes'].map((t) => h('th', { text: t })))),
          h('tbody', null, lista.map((g) => h('tr', null,
            h('td', null, h('strong', { text: g.ramal })),
            h('td', { text: g.linha || '—' }),
            h('td', { text: g.ini === null ? '—' : km(g.ini) }),
            h('td', { text: g.fim === null ? '—' : km(g.fim) }),
            h('td', { class: 'num', text: kmTxt(g.extensao) }),
            h('td', { class: 'num', text: n0(g.tangentes) }),
            h('td', { class: 'num', text: n0(g.curvas) }),
            h('td', { class: 'num', text: `${n0(g.rh)}${g.rh && !g.rhDaGeometria ? '*' : ''}` }),
            h('td', { class: 'mt-sub', text: g.sedes.map((x) => `${x.sede || '—'} ${km(x.ini)}–${km(x.fim)}`).join(' · ') })))))),
        lista.some((g) => g.rh && !g.rhDaGeometria) ? h('p', { class: 'mt-sub', text: '* RH deduzidos pelos vãos entre elementos (a geometria importada não tem as RH desta linha).' }) : null));
  }

  /* ---------------- Alertas de geometria ---------------- */

  function cartaoAlertas(lista) {
    const ramal = ramalEscolhido();
    const vel = Number(U.pref.get('telaCarro:velocidade', 68));
    const filtroParam = U.pref.get('montagem:alertaParam', '');
    const filtroNivel = Number(U.pref.get('montagem:alertaNivel', 0));
    const todos = C().alertasGeometria(planta, ramal, lista, (id, el) => App.telaCarro.niveisLimite(id, el, vel));
    const vis = todos.filter((x) => (!filtroParam || x.id === filtroParam) && x.grau >= filtroNivel);
    const cont = (id, g) => todos.filter((x) => x.id === id && x.grau === g).length;
    const NOME_NIVEL = { 1: 'Alerta', 2: 'Restrição', 3: 'Interdição' };
    const sel = (rotulo, valor, opcoes, aoMudar) => ui.campo(rotulo, h('select', { onchange: (e) => aoMudar(e.target.value) },
      opcoes.map(([v, t]) => h('option', { value: String(v), selected: String(v) === String(valor) || null, text: t }))));
    const linhas = vis.slice(0, 500).map((x) => h('tr', { tabindex: 0, title: 'Rodar na Tela do carro neste km', onclick: () => { const a = arquivos.find((y) => y.id === x.idArquivo); if (a) abrirNaTela(a, { i: x.iArq, km: x.kmArq }); } },
      h('td', null, h('span', { class: `mt-selo mt-nivel-${x.grau}`, text: x.nivel })),
      h('td', { text: x.param }),
      h('td', { text: `L${x.linha}` }),
      h('td', { text: `${km(x.ini)}${x.fim - x.ini >= 1 ? ` – ${km(x.fim)}` : ''}` }),
      h('td', { class: 'num', text: n0(Math.max(1, x.fim - x.ini)) }),
      h('td', { text: x.eh }),
      h('td', { text: x.elemento }),
      h('td', { class: 'num', text: n2(x.valor, 1) }),
      h('td', { class: 'num', text: n2(x.limite, 0) }),
      h('td', { class: 'mt-sub', text: x.arquivo })));
    return h('section', { class: 'cartao pilha' },
      h('div', { class: 'mt-linha-cab' }, h('h2', { text: 'Alertas de geometria' }),
        h('span', { class: 'mt-sub', text: 'Empeno, nivelamento e superelevação. Sem bitola e sem alinhamento. Limites da Tela do carro.' })),
      h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela tabela-centro' },
        h('thead', null, h('tr', null, ['Parâmetro', 'Alerta', 'Restrição', 'Interdição', 'Total'].map((t) => h('th', { text: t })))),
        h('tbody', null, C().PARAMETROS_GEOMETRIA.map((id) => h('tr', { onclick: () => { U.pref.set('montagem:alertaParam', filtroParam === id ? '' : id); render(); } },
          h('td', { text: C().NOMES_GEOMETRIA[id] }), h('td', { text: String(cont(id, 1)) }), h('td', { text: String(cont(id, 2)) }), h('td', { text: String(cont(id, 3)) }),
          h('td', null, h('strong', { text: String(cont(id, 1) + cont(id, 2) + cont(id, 3)) }))))))),
      h('div', { class: 'grade-3' },
        sel('Limites para', vel, App.telaCarro.VELOCIDADES.map((v) => [v, `${v} km/h`]), (v) => { U.pref.set('telaCarro:velocidade', Number(v)); render(); }),
        sel('Parâmetro', filtroParam, [['', 'Todos'], ...C().PARAMETROS_GEOMETRIA.map((id) => [id, C().NOMES_GEOMETRIA[id]])], (v) => { U.pref.set('montagem:alertaParam', v); render(); }),
        sel('Nível', filtroNivel, [[0, 'Todos'], [1, 'Alerta ou mais'], [2, 'Restrição ou mais'], [3, 'Interdição']], (v) => { U.pref.set('montagem:alertaNivel', Number(v)); render(); })),
      vis.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela mt-tabela' },
        h('thead', null, h('tr', null, ['Nível', 'Parâmetro', 'Linha', 'Km (geometria)', 'Ext. (m)', 'EH', 'Elemento', 'Valor', 'Limite', 'Arquivo'].map((t) => h('th', { text: t })))),
        h('tbody', null, linhas))) : h('p', { class: 'vazio', text: todos.length ? 'Nenhum alerta com este filtro.' : 'Nenhum trecho passa dos limites nos arquivos deste ciclo.' }),
      vis.length > 500 ? h('p', { class: 'mt-sub', text: `Mostrando 500 de ${vis.length}. Use os filtros.` }) : null,
      h('p', { class: 'mt-sub', text: `Clique num alerta para rodar o arquivo na Tela do carro naquele km. ${NOME_NIVEL[2]} = tabela EFVM 2026; alerta e interdição são preenchidos em Limites, na Tela do carro.` }));
  }

  function abas() {
    const atualAba = aba();
    return h('div', { class: 'seg seg-abas', role: 'tablist', 'aria-label': 'Cobertura ou alertas' },
      [['cobertura', 'Cobertura e arquivos'], ['alertas', 'Alertas de geometria']].map(([id, t]) => h('button', {
        type: 'button', role: 'tab', class: `seg-opcao${atualAba === id ? ' ativo' : ''}`, 'aria-selected': atualAba === id ? 'true' : 'false',
        onclick: () => { U.pref.set('montagem:aba', id); render(); }
      }, t)));
  }

  function render() {
    if (!raiz) return;
    const lista = doCiclo();
    const partes = [cabecalho()];
    if (planta) {
      const ramal = ramalEscolhido();
      const outros = lista.filter((a) => a.resumo.ramal && a.resumo.ramal !== ramal);
      partes.push(abas());
      if (outros.length) partes.push(h('p', { class: 'aviso', text: `${outros.length} arquivo(s) deste ciclo são de outro ramal (${[...new Set(outros.map((a) => a.resumo.ramal))].join(', ')}): escolha o ramal acima para vê-los.` }));
      if (aba() === 'alertas') {
        partes.push(cartaoAlertas(lista));
      } else {
        const linhas = C().montar(planta, ramal, lista);
        const conferencia = C().conferirArquivos(planta, lista);
        partes.push(resumoGeral(linhas));
        linhas.forEach((l) => partes.push(cartaoLinha(l)));
        partes.push(cartaoArquivos(lista, conferencia));
        partes.push(cartaoRegras());
        partes.push(cartaoGeometria());
      }
    }
    ui.trocar(raiz, ...partes);
  }

  /** Arquivos da Montagem em ordem (ramal, linha, km), para a Tela do carro. */
  async function listaParaTela() {
    await carregar();
    return doCiclo().slice().sort((a, b) => (a.resumo.ramal + a.resumo.linhaRef).localeCompare(b.resumo.ramal + b.resumo.linhaRef)
      || Math.min(a.resumo.kmIni, a.resumo.kmFim) - Math.min(b.resumo.kmIni, b.resumo.kmFim))
      .map((a) => ({ id: a.id, nome: a.nome, rotulo: `${a.nome} · ${a.resumo.corretiva || '—'} · L${a.resumo.linhaRef} · ${km(a.resumo.kmIni)} → ${km(a.resumo.kmFim)}` }));
  }

  App.montagem = {
    async montar(el) { raiz = el; await carregar(); render(); atualizarResumos(); },
    async aoMostrar() { if (!raiz) return; planta = App.analise && App.analise.planta ? await App.analise.planta() : planta; render(); atualizarResumos(); },
    lista: listaParaTela,
    atual: () => atual,
    ciclo,
    async abrir(id) { await carregar(); if (!planta && App.analise.planta) planta = await App.analise.planta(); const a = arquivos.find((x) => x.id === id); return a ? abrirNaTela(a) : false; }
  };
})(window.App);
