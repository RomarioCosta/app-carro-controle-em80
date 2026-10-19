/*
 * Análise do arquivo CSV gerado pelo carro controle (bitola, curvatura, alinhamento e nivelamento).
 * Funções puras (sem tela) para facilitar testes.
 *
 * Formato do arquivo (separado por ";"):
 *  - linha "H": cabeçalho com os nomes das colunas;
 *  - linhas "D": medições (uma a cada 0,25 m);
 *  - linhas "E": eventos (AMV, passagem superior, etc.).
 * Posição de cada ponto = KM × 1000 + LOCALIZACAO (em metros).
 */
'use strict';

(function (App) {
  const { U } = App;
  const B = {};

  /** Colunas usadas na análise, identificadas pelo título (sem espaços, acentos ou maiúsculas). */
  B.COLUNAS = {
    km: 'km',
    loc: 'localizacao',
    vel: 'speed',
    bitF: 'bitolaf',
    bitT: 'bitolat',
    kld: 'bitkld',
    curv: '10000r',
    sup: 'superabs',
    warp: 'warp',
    emp2: 'emp2',
    emp10: 'emp10',
    emp20: 'emp20',
    nl5: 'nlmax5',
    nl20: 'nlmax20',
    nlTqi: 'nltqi',
    vrbt5: 'vrbtmax5',
    alMax10: 'almax10',
    al10: 'al10b10',
    al20: 'al20b10',
    alr10: 'alr1010',
    alr20: 'alr1020',
    val25: 'valb25'
  };

  /** Parâmetros de alinhamento que podem ser exibidos junto com a bitola. */
  B.ALINHAMENTO = [
    { id: 'alr10', nome: 'ALR10_10' },
    { id: 'alr20', nome: 'ALR10_20' },
    { id: 'al10', nome: 'AL10_B10' },
    { id: 'al20', nome: 'AL20_B10' },
    { id: 'alMax10', nome: 'ALmax_10' },
    { id: 'val25', nome: 'VAL_B2,5' }
  ];

  /** Parâmetros de nivelamento para o ranking. */
  B.NIVELAMENTO = [
    { id: 'nl5', nome: 'NLmax_5' },
    { id: 'nl20', nome: 'NLmax_20' },
    { id: 'emp2', nome: 'EMP_2 (empeno)' },
    { id: 'emp10', nome: 'EMP_10 (empeno)' },
    { id: 'emp20', nome: 'EMP_20 (empeno)' },
    { id: 'warp', nome: 'Warp (torção)' },
    { id: 'sup', nome: 'SUPerABS (superelevação)' },
    { id: 'vrbt5', nome: 'VrBTmax5' }
  ];

  B.PADRAO = {
    limiarCurva: 3, // |10000/R| a partir do qual o trecho é curva (R ≈ 3.333 m)
    suavizacao: 10, // metros (média móvel da curvatura)
    comprimentoMin: 20, // metros: trechos menores são unidos ao vizinho
    limitePerda: 2 // mm: |Bitola F − Bitola T| acima disso = perda de bitola
  };

  const num = (s) => {
    const t = String(s ?? '').trim();
    if (!t || t.includes('*')) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  /** Formata a posição em metros como km+metros (ex.: 328+364). */
  B.fmtKm = (m) => {
    if (m === null || m === undefined || !Number.isFinite(m)) return '—';
    const km = Math.floor(m / 1000);
    const resto = Math.round(m - km * 1000);
    return resto === 1000 ? `${km + 1}+000` : `${km}+${String(resto).padStart(3, '0')}`;
  };

  /* ------------------------------------------------------------------ */
  /* Leitura do arquivo                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Lê o texto do CSV. Retorna { meta, pos, dados: {campo: Float64Array}, eventos, avisos }.
   * Valores ausentes ("*******") ficam como NaN.
   */
  B.lerCSV = (texto) => {
    const linhas = String(texto || '').split(/\r?\n/);
    const avisos = [];
    let cab = null;
    const brutos = [];
    const eventos = [];
    let meta = null;

    linhas.forEach((ln) => {
      if (!ln) return;
      const c = ln.split(';');
      const tipo = c[0].trim();
      if (tipo === 'H' && !cab) cab = c.map((x) => U.chaveTitulo(x));
      else if (tipo === 'D') brutos.push(c);
      else if (tipo === 'E') eventos.push(c);
    });

    if (!cab) throw new Error('Cabeçalho (linha "H") não encontrado. Confira se é o arquivo gerado pelo carro controle.');
    const idx = {};
    Object.entries(B.COLUNAS).forEach(([campo, chave]) => { idx[campo] = cab.indexOf(chave); });
    ['km', 'loc', 'bitF', 'bitT'].forEach((c) => {
      if (idx[c] < 0) throw new Error(`Coluna obrigatória não encontrada: ${c === 'loc' ? 'LOCALIZACAO' : c === 'bitF' ? 'Bitola F' : c === 'bitT' ? 'Bitola T' : 'KM'}.`);
    });
    Object.entries(idx).forEach(([campo, i]) => {
      if (i < 0) avisos.push(`Coluna ${campo} não encontrada no arquivo.`);
    });
    if (!brutos.length) throw new Error('O arquivo não tem linhas de medição ("D").');

    const iCampo = (nome) => cab.indexOf(nome);
    const primeira = brutos[0];
    const pega = (nome) => (iCampo(nome) >= 0 ? String(primeira[iCampo(nome)] || '').trim() : '');
    meta = {
      ramal: pega('ramal'),
      linha: pega('linha'),
      inspetor: pega('inspetor'),
      carro: pega('car'),
      data: pega('data'),
      sentido: pega('sequncia') || pega('sequencia')
    };

    const n = brutos.length;
    const pos = new Float64Array(n);
    const dados = {};
    Object.keys(B.COLUNAS).forEach((campo) => { dados[campo] = new Float64Array(n).fill(NaN); });
    let validos = 0;
    brutos.forEach((c, i) => {
      const km = num(c[idx.km]);
      const loc = num(c[idx.loc]);
      pos[i] = km === null || loc === null ? NaN : km * 1000 + loc;
      if (!Number.isNaN(pos[i])) validos++;
      Object.keys(B.COLUNAS).forEach((campo) => {
        if (idx[campo] >= 0) {
          const v = num(c[idx[campo]]);
          if (v !== null) dados[campo][i] = v;
        }
      });
    });
    if (validos < n) avisos.push(`${n - validos} linha(s) sem posição foram ignoradas.`);

    // Mantém só pontos com posição.
    const manter = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(pos[i])) manter.push(i);
    const filtrar = (arr) => Float64Array.from(manter, (i) => arr[i]);
    const posF = filtrar(pos);
    Object.keys(dados).forEach((k) => { dados[k] = filtrar(dados[k]); });

    const evs = eventos.map((c) => {
      const km = num(c[7]);
      const loc = num(c[9]);
      return { pos: km === null || loc === null ? NaN : km * 1000 + loc, codigo: String(c[13] || '').trim(), texto: String(c[14] || '').trim() };
    }).filter((e) => !Number.isNaN(e.pos) && e.texto);

    return { meta, pos: posF, dados, eventos: evs, avisos };
  };

  /* ------------------------------------------------------------------ */
  /* Tangentes e curvas                                                  */
  /* ------------------------------------------------------------------ */

  /** Espaçamento típico entre pontos (mediana das diferenças), em metros. */
  B.espacamento = (pos) => {
    const d = [];
    for (let i = 1; i < pos.length && d.length < 2000; i++) d.push(Math.abs(pos[i] - pos[i - 1]));
    d.sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)] || 0.25 : 0.25;
  };

  /** Média móvel centrada, ignorando valores ausentes. */
  B.mediaMovel = (arr, janela) => {
    const n = arr.length;
    const out = new Float64Array(n).fill(NaN);
    const meia = Math.max(0, Math.floor(janela / 2));
    let soma = 0;
    let cont = 0;
    let ini = 0;
    let fim = -1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - meia);
      const b = Math.min(n - 1, i + meia);
      while (fim < b) { fim++; if (!Number.isNaN(arr[fim])) { soma += arr[fim]; cont++; } }
      while (ini < a) { if (!Number.isNaN(arr[ini])) { soma -= arr[ini]; cont--; } ini++; }
      out[i] = cont ? soma / cont : NaN;
    }
    return out;
  };

  /**
   * Divide o trecho em elementos (tangentes e curvas), na ordem de inspeção.
   * Retorna [{ tipo: 'T'|'C', nome: 'Tangente 01', sigla: 'T01', i0, i1, ini, fim, extensao }].
   */
  B.segmentar = (pos, curv, opcoes = {}) => {
    const o = { ...B.PADRAO, ...opcoes };
    const n = pos.length;
    if (!n) return [];
    const esp = B.espacamento(pos) || 0.25;
    const suave = B.mediaMovel(curv, Math.max(1, Math.round(o.suavizacao / esp)));

    // Classificação ponto a ponto (sem dado: mantém a classe anterior).
    const classe = new Array(n);
    let anterior = 'T';
    for (let i = 0; i < n; i++) {
      const v = suave[i];
      classe[i] = Number.isNaN(v) ? anterior : (Math.abs(v) >= o.limiarCurva ? 'C' : 'T');
      anterior = classe[i];
    }

    // Trechos contínuos.
    let seg = [];
    let ini = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || classe[i] !== classe[ini]) {
        seg.push({ tipo: classe[ini], i0: ini, i1: i - 1 });
        ini = i;
      }
    }
    const ext = (s) => Math.abs(pos[s.i1] - pos[s.i0]) + esp;

    // Une trechos curtos ao vizinho (repete até não sobrar nenhum curto).
    for (let guarda = 0; guarda < 10000 && seg.length > 1; guarda++) {
      let menor = -1;
      seg.forEach((s, k) => { if (ext(s) < o.comprimentoMin && (menor < 0 || ext(s) < ext(seg[menor]))) menor = k; });
      if (menor < 0) break;
      const s = seg[menor];
      const ant = seg[menor - 1];
      const prox = seg[menor + 1];
      if (ant && prox && ant.tipo === prox.tipo) {
        seg.splice(menor - 1, 3, { tipo: ant.tipo, i0: ant.i0, i1: prox.i1 });
      } else {
        const alvo = !ant ? prox : !prox ? ant : (ext(ant) >= ext(prox) ? ant : prox);
        alvo.i0 = Math.min(alvo.i0, s.i0);
        alvo.i1 = Math.max(alvo.i1, s.i1);
        seg.splice(menor, 1);
      }
      // junta vizinhos que ficaram do mesmo tipo
      seg = seg.reduce((acc, x) => {
        const u = acc[acc.length - 1];
        if (u && u.tipo === x.tipo) u.i1 = x.i1;
        else acc.push({ ...x });
        return acc;
      }, []);
    }

    const cont = { T: 0, C: 0 };
    return seg.map((s) => {
      cont[s.tipo]++;
      const numero = String(cont[s.tipo]).padStart(2, '0');
      return {
        ...s,
        sigla: `${s.tipo}${numero}`,
        nome: `${s.tipo === 'T' ? 'Tangente' : 'Curva'} ${numero}`,
        ini: pos[s.i0],
        fim: pos[s.i1],
        extensao: ext(s)
      };
    });
  };

  /* ------------------------------------------------------------------ */
  /* Indicadores                                                         */
  /* ------------------------------------------------------------------ */

  const abs = Math.abs;

  /** Diferença ponto a ponto (NaN quando falta algum dos dois). */
  B.diferenca = (a, b) => Float64Array.from(a, (v, i) => v - b[i]);

  function resumoTrecho(d, i0, i1, opcoes, alinhamento) {
    let validos = 0; let perdas = 0; let maxDif = 0; let somaDif = 0;
    let nK = 0; let somaK = 0; let perdasK = 0;
    let nC = 0; let somaC = 0;
    let nA = 0; let somaA = 0; let maxA = 0;
    for (let i = i0; i <= i1; i++) {
      const f = d.bitF[i]; const t = d.bitT[i];
      if (!Number.isNaN(f) && !Number.isNaN(t)) {
        const dif = f - t;
        validos++;
        somaDif += abs(dif);
        if (abs(dif) > opcoes.limitePerda) perdas++;
        if (abs(dif) > abs(maxDif)) maxDif = dif;
      }
      const k = d.kld[i];
      if (!Number.isNaN(f) && !Number.isNaN(k) && abs(k) < 60) {
        nK++;
        somaK += f - k;
        if (abs(f - k) > opcoes.limitePerda) perdasK++;
      }
      if (!Number.isNaN(d.curv[i])) { nC++; somaC += d.curv[i]; }
      const a = alinhamento ? alinhamento[i] : NaN;
      if (!Number.isNaN(a)) { nA++; somaA += abs(a); if (abs(a) > abs(maxA)) maxA = a; }
    }
    const curvMedia = nC ? somaC / nC : NaN;
    return {
      pontos: validos,
      perdas,
      pctPerda: validos ? (perdas / validos) * 100 : null,
      maxDif: validos ? maxDif : null,
      difMedia: validos ? somaDif / validos : null,
      difKldMedia: nK ? somaK / nK : null,
      pctKld: nK ? (perdasK / nK) * 100 : null,
      curvMedia,
      raioMedio: Number.isNaN(curvMedia) || abs(curvMedia) < 0.01 ? null : 10000 / abs(curvMedia),
      alinhMedio: nA ? somaA / nA : null,
      alinhMax: nA ? maxA : null
    };
  }

  /**
   * Análise completa: elementos, indicadores por elemento e gerais.
   * opcoes: limiarCurva, suavizacao, comprimentoMin, limitePerda, alinhamento (id).
   */
  B.analisar = (arquivo, opcoes = {}) => {
    const o = { ...B.PADRAO, alinhamento: 'alr10', ...opcoes };
    const { pos, dados } = arquivo;
    const alin = dados[o.alinhamento];
    const elementos = B.segmentar(pos, dados.curv, o).map((e) => ({ ...e, ...resumoTrecho(dados, e.i0, e.i1, o, alin) }));
    const geral = resumoTrecho(dados, 0, pos.length - 1, o, alin);

    const porTipo = (tipo) => {
      const els = elementos.filter((e) => e.tipo === tipo);
      const pontos = els.reduce((s, e) => s + e.pontos, 0);
      const perdas = els.reduce((s, e) => s + e.perdas, 0);
      return { quantidade: els.length, extensao: els.reduce((s, e) => s + e.extensao, 0), pontos, perdas, pctPerda: pontos ? (perdas / pontos) * 100 : null };
    };

    return {
      opcoes: o,
      elementos,
      geral: { ...geral, extensao: Math.abs(pos[pos.length - 1] - pos[0]) + B.espacamento(pos) },
      tangentes: porTipo('T'),
      curvas: porTipo('C'),
      difFT: B.diferenca(dados.bitF, dados.bitT),
      difKld: Float64Array.from(dados.bitF, (f, i) => (abs(dados.kld[i]) < 60 ? f - dados.kld[i] : NaN))
    };
  };

  /** Elemento que contém o ponto i. */
  B.elementoDo = (elementos, i) => elementos.find((e) => i >= e.i0 && i <= e.i1) || null;

  /**
   * Ranking dos maiores valores (em módulo) de um parâmetro.
   * Picos a menos de "separacao" metros de um já escolhido são considerados o mesmo defeito.
   */
  B.ranking = (arquivo, elementos, campo, { limite = 10, separacao = 10 } = {}) => {
    const v = arquivo.dados[campo];
    const pos = arquivo.pos;
    if (!v) return [];
    const ordem = [];
    for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i])) ordem.push(i);
    ordem.sort((a, b) => abs(v[b]) - abs(v[a]));
    const escolhidos = [];
    for (const i of ordem) {
      if (escolhidos.length >= limite) break;
      if (escolhidos.some((j) => abs(pos[j] - pos[i]) < separacao)) continue;
      escolhidos.push(i);
    }
    return escolhidos.map((i, k) => {
      const el = B.elementoDo(elementos, i);
      return { posicao: k + 1, i, pos: pos[i], km: B.fmtKm(pos[i]), valor: v[i], elemento: el ? el.sigla : '—' };
    });
  };

  /** Índice do ponto mais próximo de uma posição (pos é monotônico, crescente ou decrescente). */
  B.indicePerto = (pos, alvo) => {
    const n = pos.length;
    if (!n) return -1;
    const crescente = pos[n - 1] >= pos[0];
    let lo = 0; let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((pos[mid] < alvo) === crescente) lo = mid; else hi = mid;
    }
    return abs(pos[lo] - alvo) <= abs(pos[hi] - alvo) ? lo : hi;
  };

  App.bitola = B;
})(window.App);
