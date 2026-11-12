/**
 * Planejamento mensal (arquivo .xlsm do planejamento, aba "Tarefas Mensal") para a Rota.
 *
 * - ler(linhas): linhas da aba (matriz, como o sheet_to_json com header: 1) → serviços APROVADOS
 *   (APROVADO, ALTERADO/APROVADO, INCLUÍDO/APROVADO…; fica de fora REPROVADO, CANCELADO, CONDICIONAL e sem status).
 * - localizar(malha, servico): LOCAL + LINHA → trecho da malha da Rota ("LT:EH:49@1"), ou null
 *   quando o LOCAL não é EH nem RH (pátios e terminais: TORRE "A", VCS, VEB…).
 * - doDia(servicos, data): serviços cuja faixa de datas (início a fim) inclui o dia.
 */
(function (App) {
  'use strict';

  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveCab = (s) => semAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Cabeçalho da planilha → campo (comparado sem acento, espaço nem pontuação).
  const CAMPOS = {
    DATAINICIO: 'dataIni', DATAFIM: 'dataFim', HORAINICIO: 'horaIni', HORAFIM: 'horaFim',
    INTERDICAO: 'interdicao', DETALHEINTERD: 'detalhe', SEDE: 'sede', LOCAL: 'local', LINHA: 'linha',
    TAREFAS: 'tarefa', DESCRICAOOBS: 'descricao', AMV: 'amv', KMINICIO: 'kmIni', KMFIM: 'kmFim',
    RECURSO: 'recurso', STATUS: 'status'
  };

  const doisDig = (n) => String(n).padStart(2, '0');

  /** Data da planilha (número de série do Excel, Date ou texto dd/mm/aaaa / aaaa-mm-dd) → "aaaa-mm-dd". */
  function data(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${doisDig(v.getMonth() + 1)}-${doisDig(v.getDate())}`;
    if (typeof v === 'number' && isFinite(v) && v > 20000) {
      const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}-${doisDig(d.getUTCDate())}`;
    }
    const t = String(v).trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${doisDig(m[2])}-${doisDig(m[1])}`;
    return '';
  }

  /** Hora da planilha (fração do dia, Date ou "hh:mm") → "hh:mm". */
  function hora(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return `${doisDig(v.getHours())}:${doisDig(v.getMinutes())}`;
    if (typeof v === 'number' && isFinite(v)) {
      const min = Math.round((v - Math.floor(v)) * 1440);
      return min >= 1440 ? '23:59' : `${doisDig(Math.floor(min / 60))}:${doisDig(min % 60)}`;
    }
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
    return m ? `${doisDig(m[1])}:${m[2]}` : '';
  }

  const aprovado = (st) => { const s = semAcento(st).toUpperCase(); return /APROVADO/.test(s) && !/REPROVADO/.test(s); };

  /** Linhas da aba "Tarefas Mensal" → serviços aprovados. */
  function ler(linhas) {
    const iCab = (linhas || []).findIndex((l) => Array.isArray(l) && l.some((c) => chaveCab(c) === 'DATAINICIO') && l.some((c) => chaveCab(c) === 'STATUS'));
    if (iCab < 0) throw new Error('Aba "Tarefas Mensal" não encontrada (cabeçalho com DATA INÍCIO e STATUS).');
    const col = {};
    linhas[iCab].forEach((c, i) => { const campo = CAMPOS[chaveCab(c)]; if (campo && col[campo] === undefined) col[campo] = i; });
    const out = [];
    let total = 0;
    linhas.slice(iCab + 1).forEach((l, n) => {
      if (!Array.isArray(l)) return;
      const v = (campo) => (col[campo] === undefined ? '' : l[col[campo]]);
      const ini = data(v('dataIni'));
      if (!ini) return;
      total++;
      if (!aprovado(v('status'))) return;
      const txt = (campo, max = 300) => String(v(campo) == null ? '' : v(campo)).replace(/_x000D_/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
      const km = (campo) => { const x = v(campo); const s = String(x == null ? '' : x).trim().replace('+', '.').replace(',', '.'); const k = parseFloat(s); return isFinite(k) ? k : null; };
      out.push({
        id: `m${iCab + 1 + n + 1}`,
        dataIni: ini,
        dataFim: data(v('dataFim')) || ini,
        horaIni: hora(v('horaIni')),
        horaFim: hora(v('horaFim')),
        interdicao: txt('interdicao', 40),
        detalhe: txt('detalhe', 40),
        sede: txt('sede', 20),
        local: txt('local', 60),
        linha: txt('linha', 30),
        tarefa: txt('tarefa', 160),
        descricao: txt('descricao', 400),
        amv: txt('amv', 30),
        kmIni: km('kmIni'),
        kmFim: km('kmFim'),
        recurso: txt('recurso', 60),
        status: txt('status', 30)
      });
    });
    return { servicos: out, total };
  }

  /** Nome de EH/RH comparável: maiúsculo, sem espaços e sem zeros à esquerda ("EH 09I/09V" → "EH9I/9V", "RH-06" → "RH-6"). */
  const nomeComparavel = (s) => semAcento(s).toUpperCase().replace(/\s+/g, '').replace(/(^|[^0-9])0+(\d)/g, '$1$2');

  /** Índice nome → [ids] da malha da Rota (EH e RH, inclusive os EH que aparecem só como linha de outra coluna). */
  function indiceNomes(malha) {
    if (malha._nomesMensal) return malha._nomesMensal;
    const mapa = new Map();
    const por = (nome, id) => { const k = nomeComparavel(nome); if (!mapa.has(k)) mapa.set(k, []); if (!mapa.get(k).includes(id)) mapa.get(k).push(id); };
    malha.ramais.forEach((r) => r.unidades.forEach((u) => {
      if (u.tipo === 'EH' && !u.ref) por(u.rotulo, u.id);
      if (u.tipo === 'RH' && !u.semCasa) por(u.rotulo, u.id);
      Object.values(u.ref || {}).forEach((x) => por(x.rotulo, x.id));
    }));
    malha._nomesMensal = mapa;
    return mapa;
  }

  /** LINHA da planilha → linhas da malha ("1 e 2" → ["1", "2"]; SINGELA → ["1"]; PÁTIO, AMV… → []). */
  function linhasDe(v) {
    const t = semAcento(v).toUpperCase().trim();
    if (/^SINGELA/.test(t)) return ['1'];
    const nums = t.match(/^\d(\s*(E|,|\/|-)\s*\d)*$/) ? t.match(/\d/g) : null;
    return nums ? [...new Set(nums)] : [];
  }

  /**
   * Trecho da malha para o serviço. LOCAL aceito: "84/85" (EH), "RH-65", "RH 77 T21/T22", "RH-11 (VFZ)", "206v" (pátio),
   * "11/12 (SING)". Na RH-86 (que existe em mais de uma tela) fica a primeira, a da Linha Tronco.
   * → { trecho, id, linhas, nome } ou null.
   */
  function localizar(malha, s) {
    if (!malha || !s || !s.local) return null;
    const nomes = indiceNomes(malha);
    let t = semAcento(s.local).toUpperCase().replace(/\(.*?\)/g, ' ').trim();
    let nome = '';
    let m = t.match(/^RH[\s-]*([0-9]+[A-Z]?)\b/);
    if (m) nome = `RH-${m[1]}`;
    else if ((m = t.match(/^(?:EH[\s-]*)?([0-9]+[A-Z]?)\s*\/\s*([0-9]+[A-Z]?)\b/))) nome = `EH ${m[1]}/${m[2]}`;
    else if ((m = t.match(/^([0-9]+[A-Z]?)$/))) nome = `RH-${m[1]}`;
    if (!nome) return null;
    let ids = nomes.get(nomeComparavel(nome));
    if ((!ids || !ids.length) && m[2]) ids = nomes.get(nomeComparavel(`EH ${m[2]}/${m[1]}`)); // "05/04" → EH 04/05
    if (!ids || !ids.length) { // sem a letra do pátio: "12/13I" → EH 12V/13I (só se for um único)
      const solto = (x) => nomeComparavel(x).replace(/([0-9])[IV]\b/g, '$1').replace(/([0-9])[IV](?=\/|$)/g, '$1');
      const alvo = solto(nome); const achados = [];
      const comLetra = /[0-9][IV]/.test(nomeComparavel(nome)); // "12/13I" é de pátio com letra (Fábrica/BH), não o EH 12/13 da Tronco
      nomes.forEach((lista, k) => { if (solto(k) === alvo && /[0-9][IV]/.test(k) === comLetra) achados.push(...lista); });
      if (achados.length === 1) ids = achados;
    }
    if (!ids || !ids.length) return null;
    const id = ids[0];
    const x = malha.indice.get(id);
    if (!x) return null;
    const lin = linhasDe(s.linha);
    const col = x.ramal.unidades.find((u) => u.id === id || Object.values(u.ref || {}).some((r) => r.id === id));
    const daUnidade = col ? Object.keys(col.ref || {}).filter((l) => col.ref[l].id === id).concat(col.id === id ? col.linhas : []) : ['1'];
    const linha = lin.find((l) => daUnidade.includes(l)) || daUnidade[0] || '1';
    return { trecho: App.malha.trecho(id, linha), id, linhas: lin, nome: (x.unidade && x.unidade.rotulo) || nome };
  }

  /** Serviços do dia (a data cai entre o início e o fim). */
  const doDia = (servicos, dia) => (dia ? (servicos || []).filter((s) => s.dataIni <= dia && (s.dataFim || s.dataIni) >= dia) : []);

  /** Etiqueta curta do serviço para o esquema e a lista (como os tipos dos pontos de atenção). */
  function tipoCurto(s) {
    const t = semAcento(`${s.tarefa} ${s.detalhe}`).toUpperCase();
    const regras = [
      [/24 ?HS|24 ?H\b/, 'Plano 24h'], [/TRILHO/, 'Subst. TR'], [/DORMENTE/, 'Subst. Dorm.'], [/JACARE/, 'Subst. Jacaré'], [/\bJIC\b/, 'Man. JIC'],
      [/SOCARIA/, 'Soc. Mec.'], [/DESGUARNEC/, 'Desguarn.'], [/ESTABILIZ/, 'Estabiliz.'], [/AMV|MAQUINA DE CHAVE|\bMCH\b/, 'Man. AMV'],
      [/ALIVIO DE TENSAO/, 'Alívio TT'], [/GRAMPO/, 'Grampos'], [/ROCADA/, 'Roçada'], [/LUBRIFICADOR/, 'Lubrif.'], [/ELETRO|\{EE\}|CIRCUITO DE VIA/, 'Eletro'],
      [/INFRA/, 'Infra'], [/DESCARGA/, 'Descarga'], [/INTERDICAO/, 'Interdição']
    ];
    const r = regras.find(([re]) => re.test(t));
    if (r) return r[1];
    const p = String(s.tarefa || '').trim().split(/\s+/)[0] || 'Serviço';
    return p.charAt(0) + p.slice(1, 12).toLowerCase();
  }

  const horario = (s) => [s.horaIni, s.horaFim].filter(Boolean).join(' às ');

  App.mensal = { ler, localizar, doDia, tipoCurto, horario, linhasDe, nomeComparavel, data, hora, aprovado };
})(window.App);
