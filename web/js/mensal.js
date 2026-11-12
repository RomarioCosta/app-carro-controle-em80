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
  /** LOCAL → nome de EH/RH ("EH 11/12", "RH-65") e os números lidos. */
  function nomeDoLocal(local) {
    const t = semAcento(local).toUpperCase().replace(/\(.*?\)/g, ' ').trim();
    let m = t.match(/^RH[\s-]*([0-9]+[A-Z]?)\b/);
    if (m) return { nome: `RH-${m[1]}` };
    if ((m = t.match(/^(?:EH[\s-]*)?([0-9]+[A-Z]?)\s*\/\s*([0-9]+[A-Z]?)\b/))) return { nome: `EH ${m[1]}/${m[2]}`, inv: `EH ${m[2]}/${m[1]}` };
    if ((m = t.match(/^([0-9]+[A-Z]?)$/))) return { nome: `RH-${m[1]}` };
    return null;
  }

  const solto = (x) => nomeComparavel(x).replace(/([0-9])[IV](?=\b|\/|$)/g, '$1');
  const temLetra = (x) => /[0-9][IV]/.test(nomeComparavel(x));

  /**
   * Ids da malha que podem ser o LOCAL. O mesmo nome pode existir em mais de um ramal
   * (ex.: EH 11/12 na Linha Tronco e EH 11V/12V em Fábrica): devolve todos, os de nome exato primeiro.
   */
  function candidatos(malha, local, soExatos = false) {
    const n = nomeDoLocal(local);
    if (!n) return [];
    const nomes = indiceNomes(malha);
    const exatos = [...(nomes.get(nomeComparavel(n.nome)) || []), ...(n.inv ? nomes.get(nomeComparavel(n.inv)) || [] : [])];
    if (soExatos) return [...new Set(exatos)].filter((id) => malha.indice.has(id));
    const alvos = [solto(n.nome), ...(n.inv ? [solto(n.inv)] : [])];
    const soltos = [];
    nomes.forEach((lista, k) => { if (alvos.includes(solto(k))) soltos.push(...lista.map((id) => ({ id, igual: temLetra(k) === temLetra(n.nome) }))); });
    return [...new Set([...exatos, ...soltos.filter((x) => x.igual).map((x) => x.id), ...soltos.map((x) => x.id)])].filter((id) => malha.indice.has(id));
  }

  const telaDe = (malha, id) => malha.indice.get(id).ramal.ramal;

  /** Tela (ramal da Rota) mais comum de cada SEDE, pelos serviços sem dúvida de local. Ajuda a separar nomes repetidos. */
  function telasPorSede(malha, servicos) {
    const cont = {};
    (servicos || []).forEach((s) => {
      const c = candidatos(malha, s.local, true);
      if (c.length !== 1 || !s.sede) return;
      const t = telaDe(malha, c[0]);
      cont[s.sede] = cont[s.sede] || {};
      cont[s.sede][t] = (cont[s.sede][t] || 0) + 1;
    });
    const out = {};
    // só as sedes que ficam (quase) toda numa tela: uma sede que cobre dois ramais não ajuda a decidir
    Object.entries(cont).forEach(([sede, c]) => {
      const [tela, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      const tot = Object.values(c).reduce((a, b) => a + b, 0);
      if (n / tot >= 0.9) out[sede] = tela;
    });
    return out;
  }

  /**
   * Trecho da malha para o serviço. LOCAL aceito: "84/85" (EH), "RH-65", "RH 77 T21/T22", "RH-11 (VFZ)", "206v" (pátio),
   * "11/12 (SING)". Nome repetido em mais de um ramal (EH 11/12 da Tronco × 11V/12V de Fábrica): decide pelo km do
   * serviço (o EH mais perto) e, sem km, pela SEDE (sedePorTela, de telasPorSede).
   * → { trecho, id, linhas, nome } ou null.
   */
  function localizar(malha, s, sedeTela) {
    if (!malha || !s || !s.local) return null;
    const c = candidatos(malha, s.local);
    if (!c.length) return null;
    let id = c[0];
    if (c.length > 1) {
      // "10V/11" (com letra de pátio) é de Fábrica/BH; "11/12" (sem letra) prefere a Tronco
      const n = nomeDoLocal(s.local);
      const iguais = c.filter((x) => temLetra(malha.indice.get(x).unidade.rotulo || '') === temLetra(n.nome));
      const daSede = sedeTela && sedeTela[s.sede] ? c.filter((x) => telaDe(malha, x) === sedeTela[s.sede]) : [];
      // com letra de pátio no LOCAL só servem os EH/RH com letra (a Tronco não tem); sem letra, decide a sede
      if (temLetra(n.nome) && iguais.length) c.splice(0, c.length, ...iguais);
      else if (!(s.kmIni > 0) && daSede.length) c.splice(0, c.length, ...daSede);
      const km = s.kmIni > 0 ? s.kmIni * 1000 : null;
      const dist = (x) => { const u = malha.indice.get(x).unidade; const ini = Math.min(u.ini, u.fim); const fim = Math.max(u.ini, u.fim); return km < ini ? ini - km : km > fim ? km - fim : 0; };
      const pelaSede = sedeTela && sedeTela[s.sede] ? c.filter((x) => telaDe(malha, x) === sedeTela[s.sede]) : [];
      if (km !== null) {
        const ord = c.map((x) => [x, dist(x)]).sort((a, b) => a[1] - b[1]);
        id = ord[0][1] < 5000 ? ord[0][0] : (pelaSede[0] || c[0]);
      } else if (pelaSede.length) id = pelaSede[0];
    }
    const x = malha.indice.get(id);
    const lin = linhasDe(s.linha);
    const col = x.ramal.unidades.find((u) => u.id === id || Object.values(u.ref || {}).some((r) => r.id === id));
    const daUnidade = col ? Object.keys(col.ref || {}).filter((l) => col.ref[l].id === id).concat(col.id === id ? col.linhas : []) : ['1'];
    const linha = lin.find((l) => daUnidade.includes(l)) || daUnidade[0] || '1';
    return { trecho: App.malha.trecho(id, linha), id, linhas: lin, nome: (x.unidade && x.unidade.rotulo) || nomeDoLocal(s.local).nome };
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

  App.mensal = { ler, localizar, candidatos, telasPorSede, doDia, tipoCurto, horario, linhasDe, nomeComparavel, data, hora, aprovado };
})(window.App);
