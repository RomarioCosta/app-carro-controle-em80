/* Módulo 5 – Relatório de Anomalia (gaveta lateral) com mensagem para o WhatsApp. */
'use strict';

(function (App) {
  const { U, ui, dados, sync } = App;
  const { h } = ui;
  const COLECAO = 'anomalias';
  const RASCUNHO = 'rascunho:anomalia';

  const CAMPOS = [
    { id: 'acaoTomada', rotulo: 'Ação tomada', obrigatorio: true, lista: true },
    { id: 'data', rotulo: 'Data', obrigatorio: true, tipo: 'date' },
    { id: 'local', rotulo: 'Local', obrigatorio: true, lista: true },
    { id: 'kmInicio', rotulo: 'KM início', km: true, placeholder: '000+000' },
    { id: 'kmFim', rotulo: 'KM fim', km: true, placeholder: '000+000' },
    { id: 'defeito', rotulo: 'Defeito', obrigatorio: true, lista: true },
    { id: 'amplitude', rotulo: 'Amplitude', modo: 'decimal' },
    { id: 'observacao', rotulo: 'Observação', area: true },
    { id: 'elemento', rotulo: 'Elemento', lista: true },
    { id: 'latitude', rotulo: 'Latitude', coord: true, placeholder: 'Ex.: -19.9312' },
    { id: 'longitude', rotulo: 'Longitude', coord: true, placeholder: 'Ex.: -43.9401' }
  ];

  let gaveta;
  let corpo;
  let formEl;
  let resultadoEl;
  let historicoEl;
  let f;
  let lista = [];

  const vazio = () => ({ ...Object.fromEntries(CAMPOS.map((c) => [c.id, ''])), data: U.hoje() });
  const salvarRascunho = U.debounce(() => U.pref.set(RASCUNHO, f), 400);

  /* ---------------- Mensagem ---------------- */

  const linkMapa = (lat, lon) => (lat && lon ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : '');

  /** Monta a mensagem no formato usado no WhatsApp. */
  function mensagem(r) {
    const v = (x) => {
      const t = String(x ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
      return t || '-';
    };
    const linhas = [
      ['AÇÃO TOMADA', v(r.acaoTomada)],
      ['DATA', U.fmtData(r.data) || '-'],
      ['LOCAL', v(r.local)],
      ['KM INÍCIO', v(r.kmInicio)],
      ['KM FIM', v(r.kmFim)],
      ['DEFEITO', v(r.defeito)],
      ['AMPLITUDE', v(r.amplitude)],
      ['OBSERVAÇÃO', v(r.observacao)],
      ['ELEMENTO', v(r.elemento)],
      ['LINK DO MAPA', r.linkMapa || linkMapa(r.latitude, r.longitude) || '-']
    ];
    return `*RELATÓRIO DE ANOMALIA*\n\n${linhas.map(([k, x]) => `*▪ ${k}:* ${x}`).join('\n\n')}`;
  }

  const linkWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

  function acoesMensagem(texto, { grande = false } = {}) {
    return h('div', { class: 'linha-acoes' },
      h('button', {
        type: 'button',
        class: `btn btn-secundario${grande ? '' : ' btn-pequeno'}`,
        onclick: async () => ui.toast(await ui.copiar(texto) ? 'Mensagem copiada.' : 'Não foi possível copiar.', 'ok')
      }, ui.icone('copiar'), 'Copiar'),
      h('a', {
        class: `btn btn-whats${grande ? '' : ' btn-pequeno'}`,
        href: linkWhatsApp(texto),
        target: '_blank',
        rel: 'noopener'
      }, ui.icone('enviar'), 'Enviar no WhatsApp'));
  }

  /* ---------------- Gaveta ---------------- */

  function montar(raizGaveta) {
    gaveta = raizGaveta;
    corpo = gaveta.querySelector('.gaveta-corpo');
    const rascunho = U.pref.get(RASCUNHO, null) || {};
    const temConteudo = CAMPOS.some((c) => c.id !== 'data' && String(rascunho[c.id] || '').trim());
    f = temConteudo ? { ...vazio(), ...rascunho } : vazio(); // rascunho vazio de outro dia volta para a data de hoje
    formEl = h('form', { class: 'pilha', novalidate: true, onsubmit: (e) => { e.preventDefault(); salvar(); } });
    resultadoEl = h('div');
    historicoEl = h('div', { class: 'lista' });
    corpo.append(formEl, resultadoEl, h('h3', { class: 'titulo-secao', text: 'Enviados recentemente' }), historicoEl);
    renderForm();
  }

  function renderForm() {
    const sugestoes = (campo) => U.maisFrequentes(lista.map((r) => r[campo]), 12);
    const controles = CAMPOS.map((c) => {
      const attrs = {
        name: c.id,
        value: f[c.id] || '',
        placeholder: c.placeholder || null,
        oninput: (e) => { f[c.id] = e.target.value; salvarRascunho(); }
      };
      let ctrl;
      if (c.area) {
        ctrl = h('textarea', { ...attrs, rows: 3, maxlength: 1000 });
      } else if (c.tipo === 'date') {
        ctrl = h('input', { ...attrs, type: 'date' });
      } else {
        ctrl = h('input', {
          ...attrs,
          type: 'text',
          maxlength: 120,
          autocapitalize: 'characters',
          inputmode: c.km || c.coord ? 'tel' : (c.modo || null),
          list: c.lista ? `dl-an-${c.id}` : null
        });
        if (c.km) {
          ctrl.addEventListener('blur', () => {
            f[c.id] = U.formatarKm(ctrl.value);
            ctrl.value = f[c.id];
            salvarRascunho();
          });
        }
        if (c.id === 'latitude') ctrl.addEventListener('paste', colarCoordenadas);
      }
      return [
        ui.campo(c.rotulo, ctrl, { obrigatorio: c.obrigatorio, classe: c.area ? 'campo-largo' : '' }),
        c.lista ? h('datalist', { id: `dl-an-${c.id}` }, sugestoes(c.id).map((s) => h('option', { value: s }))) : null
      ];
    });

    ui.trocar(formEl,
      h('div', { class: 'grade-2' }, controles),
      h('div', { class: 'barra-acoes' },
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: limpar }, 'Limpar'),
        h('button', { type: 'submit', class: 'btn btn-primario' }, ui.icone('check'), 'Salvar e gerar mensagem')));
  }

  /** Permite colar "lat, long" de uma vez no campo de latitude. */
  function colarCoordenadas(e) {
    const texto = (e.clipboardData || window.clipboardData).getData('text');
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(texto || '');
    if (!m || !/[.]/.test(texto)) return; // "-19,93" sozinho é só uma latitude com vírgula
    e.preventDefault();
    f.latitude = m[1].replace(',', '.');
    f.longitude = m[2].replace(',', '.');
    formEl.querySelector('[name="latitude"]').value = f.latitude;
    formEl.querySelector('[name="longitude"]').value = f.longitude;
    salvarRascunho();
  }

  function validar() {
    ui.limparErros(formEl);
    const erros = [];
    const campo = (id) => formEl.querySelector(`[name="${id}"]`);
    CAMPOS.filter((c) => c.obrigatorio).forEach((c) => {
      if (!String(f[c.id] || '').trim()) erros.push([c.id, `Informe ${c.rotulo.toLowerCase()}.`]);
    });
    if (f.data && !U.parseData(f.data)) erros.push(['data', 'Data inválida.']);
    const lat = U.coordenada(f.latitude, 90);
    const lon = U.coordenada(f.longitude, 180);
    if (lat === null) erros.push(['latitude', 'Latitude inválida (entre -90 e 90).']);
    if (lon === null) erros.push(['longitude', 'Longitude inválida (entre -180 e 180).']);
    if (lat !== null && lon !== null && (!lat) !== (!lon)) erros.push([lat ? 'longitude' : 'latitude', 'Informe latitude e longitude juntas.']);
    erros.forEach(([id, msg]) => ui.marcarErro(campo(id), msg));
    if (erros.length) ui.rolarAte(campo(erros[0][0]));
    return erros.length ? null : { lat, lon };
  }

  async function salvar() {
    const coords = validar();
    if (!coords) return;
    const r = {
      id: U.uuid(),
      acaoTomada: f.acaoTomada.trim(),
      data: f.data,
      local: f.local.trim(),
      kmInicio: U.formatarKm(f.kmInicio),
      kmFim: U.formatarKm(f.kmFim),
      defeito: f.defeito.trim(),
      amplitude: String(f.amplitude || '').trim(),
      observacao: String(f.observacao || '').trim(),
      elemento: String(f.elemento || '').trim(),
      latitude: coords.lat,
      longitude: coords.lon,
      linkMapa: linkMapa(coords.lat, coords.lon)
    };
    try {
      await dados.salvar('anomalia', COLECAO, r);
    } catch (e) {
      ui.toast(`Não foi possível salvar: ${e.message}`, 'erro', 6000);
      return;
    }
    U.pref.del(RASCUNHO);
    const texto = mensagem(r);
    ui.trocar(resultadoEl, h('div', { class: 'resultado' },
      h('div', { class: 'resultado-cab' }, h('strong', { text: 'Relatório salvo. Mensagem pronta:' })),
      h('pre', { class: 'mensagem', text: texto }),
      acoesMensagem(texto, { grande: true }),
      h('button', { type: 'button', class: 'btn btn-fantasma', onclick: novo }, ui.icone('plus'), 'Novo relatório')));
    formEl.hidden = true;
    await carregar();
    resultadoEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function novo() {
    f = vazio();
    ui.limpar(resultadoEl);
    formEl.hidden = false;
    renderForm();
    corpo.scrollTop = 0;
  }

  async function limpar() {
    const ok = await ui.confirmar('Limpar relatório', 'Apagar os campos preenchidos?', { ok: 'Limpar', perigo: true });
    if (!ok) return;
    U.pref.del(RASCUNHO);
    novo();
  }

  async function carregar() {
    let pendentes;
    [lista, pendentes] = await Promise.all([dados.listar(COLECAO), sync.pendentesDoTipo('anomalia')]);
    ui.trocar(historicoEl, lista.length ? lista.slice(0, 10).map((r) => h('div', { class: 'item item-coluna' },
      h('div', { class: 'item-principal' },
        h('strong', { text: `${U.fmtData(r.data)} · ${r.local || '-'}` }),
        h('span', { class: 'item-sub', text: [r.defeito, r.acaoTomada].filter(Boolean).join(' · ') }),
        pendentes.has(r.id) ? h('span', { class: 'etiqueta etiqueta-pendente', text: 'Não enviado à planilha' }) : null),
      acoesMensagem(mensagem(r)))) : h('p', { class: 'vazio', text: 'Nenhum relatório ainda.' }));
    if (!formEl.hidden) atualizarSugestoes();
  }

  function atualizarSugestoes() {
    CAMPOS.filter((c) => c.lista).forEach((c) => {
      const dl = formEl.querySelector(`#dl-an-${c.id}`);
      if (dl) ui.trocar(dl, U.maisFrequentes(lista.map((r) => r[c.id]), 12).map((s) => h('option', { value: s })));
    });
  }

  async function aoAbrir() {
    if (!f.data) f.data = U.hoje();
    await carregar();
    try {
      await dados.atualizarDoServidor('anomalia', COLECAO);
      await carregar();
    } catch (e) { /* sem conexão */ }
  }

  document.addEventListener('em80:sincronizado', () => { if (historicoEl) carregar(); });

  App.anomalia = { montar, aoAbrir, mensagem };
})(window.App);
