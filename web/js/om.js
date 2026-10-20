/*
 * Regras da Produção de OMs: leitura da planilha do SAP, dados do ciclo e metas.
 * Funções puras (sem tela) para facilitar testes.
 */
'use strict';

(function (App) {
  const { U, store, api, sync } = App;
  const OM = {};

  OM.REALIZADO = 'Realizado';
  OM.NAO_REALIZADO = 'Não realizado';

  OM.chave = (ciclo, nOrdem) => `${String(ciclo).trim()}|${String(nOrdem).trim()}`;

  /** Ramal = letras iniciais do texto breve (ex.: "LPR 12/13 L1" -> "LPR"). */
  OM.ramal = (texto) => {
    const m = /^\s*([A-Za-z]{2,4})/.exec(texto || '');
    return m ? m[1].toUpperCase() : 'OUTROS';
  };

  /** Linha da via pelo texto breve (ex.: "RFA 18V/19I L1" -> "1"). '' se não houver. */
  OM.linha = (texto) => {
    const m = /\bL\s?0*(\d{1,2})\s*$/i.exec(String(texto || '').trim());
    return m ? m[1] : '';
  };

  /** Ordem de trabalho: ramal, linha e km. */
  OM.ordemCampo = (a, b) => a.ramal.localeCompare(b.ramal)
    || OM.linha(a.textoBreve).localeCompare(OM.linha(b.textoBreve))
    || (Number(a.km) || 0) - (Number(b.km) || 0)
    || a.textoBreve.localeCompare(b.textoBreve);

  /* ------------------------------------------------------------------ */
  /* Importação da planilha                                              */
  /* ------------------------------------------------------------------ */

  // Reconhece as colunas pelo título (sem acento, maiúsculas ou espaços).
  const COLUNAS = [
    ['nOrdem', (k) => k === 'nordem' || k === 'numeroordem' || k === 'numerodaordem' || k === 'ordem'],
    ['textoBreve', (k) => k === 'textobreve'],
    ['denominacao', (k) => k.startsWith('denominacao')],
    ['localInstalacao', (k) => k === 'localdeinstalacao'],
    ['instalacao', (k) => k === 'instalacao' || k === 'instalcao'],
    ['plano', (k) => k.startsWith('planodemanutencao')],
    ['item', (k) => k.startsWith('itemdemanutencao')],
    ['statusUsuario', (k) => k === 'statusdousuario'],
    ['statusOrdem', (k) => k === 'statusdaordem'],
    ['dataPlanejada', (k) => k === 'dataplanejada'],
    ['tolMin', (k) => k.includes('toleranciamin')],
    ['tolMax', (k) => k.includes('toleranciamax')],
    ['km', (k) => k === 'km'],
    ['km2', (k) => k === 'km2'],
    ['status', (k) => k === 'status'],
    ['dataProgramada', (k) => k.includes('programad')]
  ];
  const DATAS = ['dataPlanejada', 'tolMin', 'tolMax', 'dataProgramada'];

  /** Converte o valor de uma célula de data em "aaaa-mm-dd". '' se vazio, null se inválido. */
  OM.lerData = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? null : U.dataISO(v);
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null; // fora de 1954–2119: não é data do Excel
      const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${U.pad(d.getUTCMonth() + 1)}-${U.pad(d.getUTCDate())}`;
    }
    const s = String(v).trim();
    if (!s) return '';
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
    if (m) {
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
      const iso = `${ano}-${U.pad(m[2])}-${U.pad(m[1])}`;
      return U.parseData(iso) ? iso : null;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return U.parseData(m[0]) ? m[0] : null;
    return null;
  };

  const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const numeroOuVazio = (v) => {
    if (v === '' || v === null || v === undefined) return '';
    const n = typeof v === 'number' ? v : U.numero(v);
    return n === null ? '' : n;
  };

  /**
   * Processa as linhas de uma planilha (matriz de células).
   * Retorna { oms, avisos, erros, semDataProgramada, temColunaProgramada }.
   */
  OM.processarLinhas = (linhas) => {
    const resultado = { oms: [], avisos: [], erros: [], semDataProgramada: 0, temColunaProgramada: false };
    const idxCab = linhas.slice(0, 20).findIndex((l) => (l || []).some((c) => {
      const k = U.chaveTitulo(c);
      return k === 'nordem' || k === 'numeroordem' || k === 'numerodaordem';
    }));
    if (idxCab < 0) {
      resultado.erros.push('Não encontrei a coluna "Nº Ordem". Confira se o arquivo é a exportação do SAP.');
      return resultado;
    }

    const cab = linhas[idxCab].map((c) => U.chaveTitulo(c));
    const pos = {};
    COLUNAS.forEach(([campo, teste]) => {
      const i = cab.findIndex((k) => k && teste(k));
      if (i >= 0) pos[campo] = i;
    });
    if (pos.textoBreve === undefined) resultado.avisos.push('Coluna "Texto breve" não encontrada.');
    resultado.temColunaProgramada = pos.dataProgramada !== undefined;
    if (!resultado.temColunaProgramada) {
      resultado.avisos.push('A planilha não tem a coluna "Data Programada": faça a programação no app (aba Programação). A programação já feita é mantida.');
    }

    const vistos = new Set();
    let datasInvalidas = 0;
    linhas.slice(idxCab + 1).forEach((l, i) => {
      if (!l) return;
      const bruto = l[pos.nOrdem];
      const nOrdem = typeof bruto === 'number' ? String(Math.round(bruto)) : texto(bruto);
      if (!nOrdem) return;
      if (vistos.has(nOrdem)) {
        resultado.avisos.push(`OM ${nOrdem} repetida (linha ${idxCab + i + 2}): mantida só a primeira.`);
        return;
      }
      vistos.add(nOrdem);
      const om = { nOrdem };
      COLUNAS.forEach(([campo]) => {
        if (campo === 'nOrdem' || pos[campo] === undefined) return;
        const v = l[pos[campo]];
        if (DATAS.includes(campo)) {
          const d = OM.lerData(v);
          if (d === null) {
            datasInvalidas++;
            if (campo === 'dataProgramada') {
              resultado.avisos.push(`OM ${nOrdem}: data programada inválida ("${texto(v)}").`);
            }
            om[campo] = '';
          } else {
            om[campo] = d;
          }
        } else if (campo === 'km' || campo === 'km2') {
          om[campo] = numeroOuVazio(v);
        } else {
          om[campo] = texto(typeof v === 'number' && Number.isInteger(v) ? String(v) : v);
        }
      });
      om.textoBreve = om.textoBreve || nOrdem;
      if (!om.dataProgramada) resultado.semDataProgramada++;
      resultado.oms.push(om);
    });

    if (!resultado.oms.length) resultado.erros.push('Nenhuma OM encontrada abaixo do cabeçalho.');
    if (datasInvalidas) resultado.avisos.push(`${datasInvalidas} data(s) não reconhecida(s) foram deixadas em branco.`);
    return resultado;
  };

  /* ------------------------------------------------------------------ */
  /* Dados do ciclo (cache local + servidor)                             */
  /* ------------------------------------------------------------------ */

  const chaveCache = (ciclo) => `om:ciclo:${ciclo}`;

  OM.cicloAtivo = () => U.pref.get('cicloAtivo', '');
  OM.definirCicloAtivo = (c) => U.pref.set('cicloAtivo', String(c || ''));

  OM.ciclosLocais = async () => (await store.get('om:ciclos')) || [];

  OM.carregarLocal = async (ciclo) => (ciclo ? await store.get(chaveCache(ciclo)) : null);

  /** Aplica por cima dos dados do servidor o que ainda está na fila do aparelho. */
  async function aplicarPendentes(dados) {
    const ciclo = dados.ciclo;
    const exec = await sync.pendentesDoTipo('execucao');
    const reprog = await sync.pendentesDoTipo('reprogramacao');
    const hist = await sync.pendentesDoTipo('historicoProgramacao');
    exec.forEach((d) => {
      if (String(d.ciclo) !== ciclo) return;
      const atual = dados.exec[d.nOrdem];
      if (!atual || String(atual.atualizadoEm || '') <= d.atualizadoEm) {
        dados.exec[d.nOrdem] = { status: d.status, dataRealizacao: d.dataRealizacao || '', atualizadoEm: d.atualizadoEm, apropriadaEm: d.apropriadaEm || '' };
      }
    });
    reprog.forEach((d) => {
      if (String(d.ciclo) !== ciclo) return;
      const om = dados.oms.find((o) => o.nOrdem === d.nOrdem);
      if (om) {
        om.dataProgramada = d.dataProgramada;
        if (d.dataOriginal) om.dataOriginal = d.dataOriginal;
      }
    });
    const ids = new Set(dados.historico.map((x) => x.id));
    hist.forEach((d) => { if (String(d.ciclo) === ciclo && !ids.has(d.id)) dados.historico.push(d); });
    return dados;
  }

  /** Busca o ciclo no servidor e grava no aparelho. */
  OM.atualizarDoServidor = async (ciclo) => {
    const [ciclos, resp] = await Promise.all([
      api.chamar('getCiclos'),
      ciclo ? api.chamar('getOMs', { ciclo }) : Promise.resolve(null)
    ]);
    await store.set('om:ciclos', ciclos || []);
    if (!resp) return null;
    const exec = {};
    (resp.execucoes || []).forEach((x) => {
      exec[x.nOrdem] = { status: x.status, dataRealizacao: x.dataRealizacao || '', atualizadoEm: x.atualizadoEm || '', apropriadaEm: x.apropriadaEm || '' };
    });
    let dados = null;
    await store.atualizar(chaveCache(resp.ciclo), async () => {
      dados = await aplicarPendentes({
        ciclo: resp.ciclo,
        oms: (resp.oms || []).map(limparOM),
        exec,
        historico: (resp.historico || []).map((x) => ({ id: x.id, ciclo: String(x.ciclo), nOrdem: String(x.nOrdem), textoBreve: x.textoBreve || '', dataAnterior: x.dataAnterior || '', dataNova: x.dataNova || '', registradoEm: x.registradoEm || '' })),
        atualizadoEm: U.agora()
      });
      return dados;
    });
    return dados;
  };

  function limparOM(o) {
    return {
      nOrdem: String(o.nOrdem),
      textoBreve: o.textoBreve || '',
      denominacao: o.denominacao || '',
      km: o.km,
      km2: o.km2,
      dataPlanejada: o.dataPlanejada || '',
      dataProgramada: o.dataProgramada || '',
      dataOriginal: o.dataOriginal || '',
      statusUsuario: o.statusUsuario || '',
      statusOrdem: o.statusOrdem || '',
      status: o.status || '',
      ramal: OM.ramal(o.textoBreve)
    };
  }

  OM.importar = async (ciclo, oms) => {
    // Mantém a programação feita no app quando a planilha não traz a data programada.
    const local = await OM.carregarLocal(String(ciclo));
    if (local) {
      const prog = new Map(local.oms.filter((o) => o.dataProgramada).map((o) => [o.nOrdem, o.dataProgramada]));
      oms = oms.map((o) => (prog.has(o.nOrdem) ? { ...o, dataProgramada: prog.get(o.nOrdem) } : o));
    }
    const r = await api.chamar('importarOMs', { ciclo, oms });
    OM.definirCicloAtivo(r.ciclo);
    await OM.atualizarDoServidor(r.ciclo);
    return r;
  };

  /** Alterna Realizado/Não realizado e coloca na fila. Retorna o novo estado. */
  OM.alternar = async (ciclo, nOrdem) => {
    let novo = null;
    await store.atualizar(chaveCache(ciclo), (dados) => {
      if (!dados) throw new Error('Ciclo não carregado.');
      const atual = dados.exec[nOrdem];
      const realizado = atual && atual.status === OM.REALIZADO;
      const agora = U.agora();
      novo = realizado
        ? { status: OM.NAO_REALIZADO, dataRealizacao: '', atualizadoEm: agora, apropriadaEm: '' }
        : { status: OM.REALIZADO, dataRealizacao: agora, atualizadoEm: agora, apropriadaEm: '' };
      dados.exec[nOrdem] = novo;
      return dados;
    });
    await sync.enfileirar('execucao', OM.chave(ciclo, nOrdem), { ciclo: String(ciclo), nOrdem, ...novo });
    return novo;
  };

  /** Marca/desmarca a OM realizada como apropriada (confirmada) no SAP. */
  OM.apropriar = async (ciclo, nOrdem) => {
    let novo = null;
    await store.atualizar(chaveCache(ciclo), (dados) => {
      const atual = dados && dados.exec[nOrdem];
      if (!atual || atual.status !== OM.REALIZADO) throw new Error('Marque a OM como realizada antes.');
      const agora = U.agora();
      novo = { ...atual, apropriadaEm: atual.apropriadaEm ? '' : agora, atualizadoEm: agora };
      dados.exec[nOrdem] = novo;
      return dados;
    });
    await sync.enfileirar('execucao', OM.chave(ciclo, nOrdem), { ciclo: String(ciclo), nOrdem, ...novo });
    return novo;
  };

  OM.apropriada = (dados, nOrdem) => {
    const x = dados.exec[nOrdem];
    return !!(x && x.status === OM.REALIZADO && x.apropriadaEm);
  };

  /** Código do status SAP (ex.: "LIB: Autorizada p/ execução" -> "LIB"). */
  OM.statusCurto = (o) => String(o.status || '').split(':')[0].trim();

  /**
   * Programa várias OMs para uma data (ou retira da programação com data '').
   * Quem já estava programado em outra data gera um registro no histórico
   * (data anterior → nova data), e a primeira data programada fica guardada como "programação original".
   * Grava no aparelho na hora e envia ao servidor pela fila.
   */
  OM.programarVarios = async (ciclo, nOrdens, data) => {
    const alvo = new Set(nOrdens.map(String));
    if (!alvo.size) return 0;
    if (data && !U.parseData(data)) throw new Error('Data inválida.');
    const agora = U.agora();
    const itens = [];
    let n = 0;
    await store.atualizar(chaveCache(ciclo), (dados) => {
      if (!dados) throw new Error('Ciclo não carregado.');
      dados.historico = dados.historico || [];
      dados.oms.forEach((o) => {
        if (!alvo.has(o.nOrdem) || o.dataProgramada === data) return;
        const anterior = o.dataProgramada;
        if (anterior) {
          const h = { id: U.uuid(), ciclo: String(ciclo), nOrdem: o.nOrdem, textoBreve: o.textoBreve, dataAnterior: anterior, dataNova: data, registradoEm: agora };
          dados.historico.push(h);
          itens.push({ tipo: 'historicoProgramacao', id: h.id, dados: h });
        }
        o.dataProgramada = data;
        if (!o.dataOriginal && data) o.dataOriginal = data;
        itens.push({ tipo: 'reprogramacao', id: OM.chave(ciclo, o.nOrdem), dados: { ciclo: String(ciclo), nOrdem: o.nOrdem, dataProgramada: data, dataOriginal: o.dataOriginal || '' } });
        n++;
      });
      return dados;
    });
    await sync.enfileirarVarios(itens);
    return n;
  };

  /** OMs que saíram de um dia (movidas ou retiradas), com o destino atual de cada uma. */
  OM.saidasDoDia = (dados, dia) => {
    const vistos = new Set();
    const lista = [];
    (dados.historico || []).filter((h) => h.dataAnterior === dia)
      .sort((a, b) => String(a.registradoEm).localeCompare(String(b.registradoEm)))
      .forEach((h) => {
        if (vistos.has(h.nOrdem)) return;
        const o = dados.oms.find((x) => x.nOrdem === h.nOrdem);
        if (!o || o.dataProgramada === dia) return;
        vistos.add(h.nOrdem);
        lista.push({ om: o, registradoEm: h.registradoEm });
      });
    return lista;
  };

  /** Quantidade de OMs programadas e realizadas por dia de um mês (para o calendário). */
  OM.calendario = (dados, mesRef) => {
    const ini = U.inicioMes(mesRef);
    const fim = U.fimMes(mesRef);
    const dias = {};
    for (let d = ini; d <= fim; d = U.somarDias(d, 1)) dias[d] = { programadas: 0, feitas: 0, realizadasNoDia: 0 };
    dados.oms.forEach((o) => {
      const p = o.dataProgramada;
      if (p && dias[p]) {
        dias[p].programadas++;
        if (OM.realizada(dados, o.nOrdem)) dias[p].feitas++;
      }
      const r = OM.diaRealizacao(dados, o.nOrdem);
      if (r && dias[r]) dias[r].realizadasNoDia++;
    });
    return dias;
  };

  /**
   * OMs que podem ser programadas: não realizadas.
   * Por padrão só as sem programação; com "todas", também as programadas em outras datas.
   */
  OM.disponiveis = (dados, { todas = false, exceto = '' } = {}) => dados.oms
    .filter((o) => !OM.realizada(dados, o.nOrdem) && (todas ? o.dataProgramada !== exceto : !o.dataProgramada))
    .sort(OM.ordemCampo);

  OM.reprogramar = async (ciclo, nOrdem, dataProgramada) => {
    await OM.programarVarios(ciclo, [nOrdem], dataProgramada);
  };

  /* ------------------------------------------------------------------ */
  /* Metas e indicadores                                                 */
  /* ------------------------------------------------------------------ */

  OM.realizada = (dados, nOrdem) => {
    const x = dados.exec[nOrdem];
    return !!(x && x.status === OM.REALIZADO);
  };

  OM.diaRealizacao = (dados, nOrdem) => {
    const x = dados.exec[nOrdem];
    return x && x.status === OM.REALIZADO && x.dataRealizacao ? x.dataRealizacao.slice(0, 10) : '';
  };

  /**
   * Indicadores para a data de referência.
   * - Meta: OMs com data programada no período.
   * - Realizado: OMs realizadas no período (pela data de realização), até a data de referência.
   * - Semana: meta de segunda a sexta; realizado de segunda a domingo (semana vigente).
   */
  OM.metricas = (dados, ref) => {
    const oms = dados.oms;
    const dias = oms.map((o) => OM.diaRealizacao(dados, o.nOrdem));
    const progr = oms.map((o) => o.dataProgramada || '');
    const contar = (lista, ini, fim) => lista.filter((d) => d && d >= ini && d <= fim).length;

    const seg = U.inicioSemana(ref);
    const sex = U.somarDias(seg, 4);
    const dom = U.somarDias(seg, 6);
    const ini = U.inicioMes(ref);
    const fimMes = U.fimMes(ref);

    const dia = { meta: contar(progr, ref, ref), realizado: contar(dias, ref, ref) };
    const semana = {
      meta: contar(progr, seg, sex),
      realizado: contar(dias, seg, ref < dom ? ref : dom),
      inicio: seg,
      fim: dom
    };
    const mes = {
      meta: contar(progr, ini, fimMes),
      metaAteHoje: contar(progr, ini, ref),
      realizado: contar(dias, ini, ref)
    };
    const ciclo = { meta: oms.length, realizado: dias.filter((d) => d && d <= ref).length };

    [dia, semana, mes, ciclo].forEach((m) => { m.pct = U.pct(m.realizado, m.meta); });

    // Série da semana (segunda a domingo).
    const serieSemana = [];
    for (let i = 0; i < 7; i++) {
      const d = U.somarDias(seg, i);
      serieSemana.push({ dia: d, meta: contar(progr, d, d), realizado: d <= ref ? contar(dias, d, d) : null });
    }

    // Série acumulada do mês.
    const serieMes = [];
    let accMeta = 0;
    let accReal = 0;
    for (let d = ini; d <= fimMes; d = U.somarDias(d, 1)) {
      accMeta += contar(progr, d, d);
      accReal += contar(dias, d, d);
      serieMes.push({ dia: d, meta: accMeta, realizado: d <= ref ? accReal : null });
    }

    return { dia, semana, mes, ciclo, serieSemana, serieMes };
  };

  /** Listas da tela: do dia (programadas ou realizadas no dia), atrasadas e todas. */
  OM.listas = (dados, ref) => {
    const doDia = [];
    const atrasadas = [];
    dados.oms.forEach((o) => {
      const realizadaEm = OM.diaRealizacao(dados, o.nOrdem);
      if (o.dataProgramada === ref || realizadaEm === ref) doDia.push(o);
      else if (o.dataProgramada && o.dataProgramada < ref && !OM.realizada(dados, o.nOrdem)) atrasadas.push(o);
    });
    const porProg = (a, b) => (a.dataProgramada || '9').localeCompare(b.dataProgramada || '9') || a.textoBreve.localeCompare(b.textoBreve);
    const aApropriar = dados.oms.filter((o) => OM.realizada(dados, o.nOrdem) && !OM.apropriada(dados, o.nOrdem))
      .sort((a, b) => OM.diaRealizacao(dados, a.nOrdem).localeCompare(OM.diaRealizacao(dados, b.nOrdem)) || OM.ordemCampo(a, b));
    return { doDia: doDia.sort(porProg), atrasadas: atrasadas.sort(porProg), aApropriar, todas: dados.oms.slice().sort(porProg) };
  };

  App.OM = OM;
})(window.App);
