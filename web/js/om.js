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
      resultado.avisos.push('Coluna "Data Programada" não encontrada: as OMs entram no ciclo, mas sem meta diária.');
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
    exec.forEach((d) => {
      if (String(d.ciclo) !== ciclo) return;
      const atual = dados.exec[d.nOrdem];
      if (!atual || String(atual.atualizadoEm || '') <= d.atualizadoEm) {
        dados.exec[d.nOrdem] = { status: d.status, dataRealizacao: d.dataRealizacao || '', atualizadoEm: d.atualizadoEm };
      }
    });
    reprog.forEach((d) => {
      if (String(d.ciclo) !== ciclo) return;
      const om = dados.oms.find((o) => o.nOrdem === d.nOrdem);
      if (om) om.dataProgramada = d.dataProgramada;
    });
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
      exec[x.nOrdem] = { status: x.status, dataRealizacao: x.dataRealizacao || '', atualizadoEm: x.atualizadoEm || '' };
    });
    let dados = null;
    await store.atualizar(chaveCache(resp.ciclo), async () => {
      dados = await aplicarPendentes({
        ciclo: resp.ciclo,
        oms: (resp.oms || []).map(limparOM),
        exec,
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
      ramal: OM.ramal(o.textoBreve)
    };
  }

  OM.importar = async (ciclo, oms) => {
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
        ? { status: OM.NAO_REALIZADO, dataRealizacao: '', atualizadoEm: agora }
        : { status: OM.REALIZADO, dataRealizacao: agora, atualizadoEm: agora };
      dados.exec[nOrdem] = novo;
      return dados;
    });
    await sync.enfileirar('execucao', OM.chave(ciclo, nOrdem), { ciclo: String(ciclo), nOrdem, ...novo });
    return novo;
  };

  OM.reprogramar = async (ciclo, nOrdem, dataProgramada) => {
    await store.atualizar(chaveCache(ciclo), (dados) => {
      const om = dados && dados.oms.find((o) => o.nOrdem === nOrdem);
      if (!om) throw new Error('OM não encontrada.');
      om.dataProgramada = dataProgramada;
      return dados;
    });
    await sync.enfileirar('reprogramacao', OM.chave(ciclo, nOrdem), { ciclo: String(ciclo), nOrdem, dataProgramada });
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
    return { doDia: doDia.sort(porProg), atrasadas: atrasadas.sort(porProg), todas: dados.oms.slice().sort(porProg) };
  };

  App.OM = OM;
})(window.App);
