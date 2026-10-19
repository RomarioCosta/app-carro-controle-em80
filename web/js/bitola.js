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
    limitePerda: 2, // mm: |Bitola F − Bitola T| acima disso = perda de bitola
    limiteVariacao: 1.5, // mm: desvio padrão da bitola em 1 m acima disso = variação rápida (provável erro)
    janelaVariacao: 1 // metros
  };

  /** A bitola nominal é 1000 mm; o arquivo traz só a diferença. */
  B.NOMINAL = 1000;

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

  const KLD_MAX = 60; // leituras do KLD acima disso (em módulo) são erro de sensor

  /** Desvio padrão móvel (janela centrada, em pontos), ignorando valores ausentes. */
  B.desvioMovel = (arr, janela) => {
    const n = arr.length;
    const out = new Float64Array(n).fill(NaN);
    const meia = Math.max(1, Math.floor(janela / 2));
    for (let i = 0; i < n; i++) {
      let soma = 0; let soma2 = 0; let c = 0;
      for (let j = Math.max(0, i - meia); j <= Math.min(n - 1, i + meia); j++) {
        const v = arr[j];
        if (!Number.isNaN(v)) { soma += v; soma2 += v * v; c++; }
      }
      if (c >= 3) out[i] = Math.sqrt(Math.max(0, soma2 / c - (soma / c) ** 2));
    }
    return out;
  };

  /** Dados com o offset aplicado (se pedido). Não altera o arquivo original. */
  B.dadosComOffset = (dados, offset) => {
    if (!offset || !offset.valor || !['bitF', 'bitT', 'kld'].includes(offset.bitola)) return dados;
    const ajustado = Float64Array.from(dados[offset.bitola], (v) => v + offset.valor);
    return { ...dados, [offset.bitola]: ajustado };
  };

  /** Perda de bitola em todo o trecho (|F − T| > limite). */
  B.perdaTotal = (dados, limite, i0 = 0, i1 = dados.bitF.length - 1) => {
    let pontos = 0; let perdas = 0;
    for (let i = i0; i <= i1; i++) {
      const f = dados.bitF[i]; const t = dados.bitT[i];
      if (Number.isNaN(f) || Number.isNaN(t)) continue;
      pontos++;
      if (abs(f - t) > limite) perdas++;
    }
    return { pontos, perdas, pct: pontos ? (perdas / pontos) * 100 : null };
  };

  /**
   * Offset (em mm) para a bitola F ou T que mais reduz a perda de bitola.
   * Testa de −10 a +10 mm em passos de 0,1 mm.
   */
  B.melhorOffset = (dados, bitola, limite) => {
    if (bitola !== 'bitF' && bitola !== 'bitT') return null;
    const difs = [];
    for (let i = 0; i < dados.bitF.length; i++) {
      const f = dados.bitF[i]; const t = dados.bitT[i];
      if (!Number.isNaN(f) && !Number.isNaN(t)) difs.push(f - t);
    }
    if (!difs.length) return null;
    const sinal = bitola === 'bitF' ? 1 : -1; // offset em F soma na diferença; em T, subtrai
    let melhor = { valor: 0, perdas: Infinity };
    for (let k = -100; k <= 100; k++) {
      const off = k / 10;
      let perdas = 0;
      for (const d of difs) if (abs(d + sinal * off) > limite) perdas++;
      if (perdas < melhor.perdas || (perdas === melhor.perdas && abs(off) < abs(melhor.valor))) melhor = { valor: off, perdas };
    }
    return { valor: melhor.valor, perdas: melhor.perdas, pontos: difs.length, pct: (melhor.perdas / difs.length) * 100 };
  };

  function resumoTrecho(d, i0, i1, opcoes, extras) {
    let validos = 0; let perdas = 0; let maxDif = 0; let somaDif = 0;
    let nK = 0; let somaK = 0; let perdasK = 0;
    let nC = 0; let somaC = 0;
    let nA = 0; let somaA = 0; let maxA = 0;
    let nV = 0; let varRapida = 0;
    const alinhamento = extras.alinhamento;
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
      if (!Number.isNaN(f) && !Number.isNaN(k) && abs(k) < KLD_MAX) {
        nK++;
        somaK += f - k;
        if (abs(f - k) > opcoes.limitePerda) perdasK++;
      }
      if (!Number.isNaN(d.curv[i])) { nC++; somaC += d.curv[i]; }
      const a = alinhamento ? alinhamento[i] : NaN;
      if (!Number.isNaN(a)) { nA++; somaA += abs(a); if (abs(a) > abs(maxA)) maxA = a; }
      const v = extras.variacao[i];
      if (!Number.isNaN(v)) { nV++; if (v > opcoes.limiteVariacao) varRapida++; }
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
      alinhMax: nA ? maxA : null,
      pctVariacao: nV ? (varRapida / nV) * 100 : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* Planta da linha (elementos por EH)                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Lê a planilha "Planta da linha" (matriz de células da aba).
   * Colunas: Ramal, Linha, Eh, C/T, Lado curva, Nº Elemento Eh, km inicial, km final, extensão, grau, raio, superelevação.
   * Retorna { elementos: [...], ramais: { LT: [1, 2], ... }, avisos }.
   */
  B.lerPlanta = (linhas) => {
    const chave = (v) => U.chaveTitulo(v);
    let idxCab = -1;
    for (let i = 0; i < Math.min(linhas.length, 40); i++) {
      const ks = (linhas[i] || []).map(chave);
      if (ks.includes('ramal') && ks.includes('linha') && ks.includes('eh')) { idxCab = i; break; }
    }
    if (idxCab < 0) throw new Error('Não encontrei o cabeçalho da planta (colunas Ramal, Linha e Eh).');
    const c1 = linhas[idxCab] || [];
    const c2 = linhas[idxCab + 1] || [];
    const largura = Math.max(c1.length, c2.length);
    // Títulos em duas linhas (ex.: "Quilometragem" / "Inicial"): junta as duas.
    let ultimoGrupo = '';
    const titulos = [];
    for (let j = 0; j < largura; j++) {
      const a = chave(c1[j]);
      if (a) ultimoGrupo = a;
      const b = chave(c2[j]);
      titulos.push({ a, b, grupo: a || ultimoGrupo });
    }
    const achar = (teste) => titulos.findIndex(teste);
    const col = {
      ramal: achar((t) => t.a === 'ramal'),
      linha: achar((t) => t.a === 'linha'),
      eh: achar((t) => t.a === 'eh'),
      ct: achar((t) => t.a === 'ct'),
      lado: achar((t) => t.a.startsWith('lado')),
      num: achar((t) => t.a.startsWith('nelemento') || t.a.startsWith('numeroelemento')),
      ini: achar((t) => t.b === 'inicial' || t.a.includes('inicial')),
      fim: achar((t) => t.b === 'final' || t.a === 'final'),
      raio: achar((t) => t.a.startsWith('raio')),
      sup: achar((t) => t.a.startsWith('superelevacao'))
    };
    ['ramal', 'linha', 'eh', 'ct', 'ini', 'fim'].forEach((k) => {
      if (col[k] < 0) throw new Error(`Coluna da planta não encontrada: ${k}.`);
    });

    const n = (v) => (typeof v === 'number' ? v : U.numero(v));
    const elementos = [];
    let descartados = 0;
    linhas.slice(idxCab + 2).forEach((l) => {
      if (!l) return;
      const ramal = String(l[col.ramal] ?? '').trim().toUpperCase();
      const tipo = String(l[col.ct] ?? '').trim().toUpperCase();
      const ini = n(l[col.ini]);
      const fim = n(l[col.fim]);
      if (!ramal || (tipo !== 'C' && tipo !== 'T')) return;
      if (ini === null || fim === null || fim <= ini) { descartados++; return; }
      elementos.push({
        ramal,
        linha: String(l[col.linha] ?? '').trim(),
        eh: String(l[col.eh] ?? '').trim(),
        tipo,
        lado: col.lado >= 0 ? String(l[col.lado] ?? '').trim().toUpperCase() : '',
        num: col.num >= 0 ? String(l[col.num] ?? '').trim() : '',
        ini: Math.round(ini * 1000 * 1000) / 1000, // km → metros
        fim: Math.round(fim * 1000 * 1000) / 1000,
        raio: col.raio >= 0 ? n(l[col.raio]) : null,
        superelevacao: col.sup >= 0 ? n(l[col.sup]) : null
      });
    });
    if (!elementos.length) throw new Error('Nenhum elemento encontrado na planta.');
    const ramais = {};
    elementos.forEach((e) => {
      ramais[e.ramal] = ramais[e.ramal] || [];
      if (!ramais[e.ramal].includes(e.linha)) ramais[e.ramal].push(e.linha);
    });
    Object.values(ramais).forEach((l) => l.sort());
    return { elementos, ramais, avisos: descartados ? [`${descartados} linha(s) da planta sem km válido foram ignoradas.`] : [] };
  };

  /** Ramal da planta correspondente ao do arquivo (ex.: "RLT" → "LT"). */
  B.ramalDaPlanta = (ramalArquivo, ramais) => {
    const r = String(ramalArquivo || '').trim().toUpperCase();
    if (ramais[r]) return r;
    if (r.length > 2 && r.startsWith('R') && ramais[r.slice(1)]) return r.slice(1);
    return Object.keys(ramais).find((k) => r.endsWith(k)) || '';
  };

  /** Elementos da planta de um ramal e linha, em ordem de km. */
  B.elementosDaPlanta = (planta, ramal, linha) => planta.elementos
    .filter((e) => e.ramal === ramal && String(e.linha) === String(linha))
    .sort((a, b) => a.ini - b.ini);

  /** Elemento da planta que contém a posição (busca binária). */
  function naPlanta(els, p) {
    let lo = 0; let hi = els.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p < els[mid].ini) hi = mid - 1;
      else if (p >= els[mid].fim) lo = mid + 1;
      else return els[mid];
    }
    return null;
  }

  /**
   * Ajuste de km (em metros, somado à posição do arquivo) que melhor alinha as curvas
   * medidas (10000/R) com as curvas da planta. Testa de −300 a +300 m.
   */
  B.ajusteAutomatico = (pos, curv, els, opcoes = {}) => {
    const o = { ...B.PADRAO, ...opcoes };
    if (!els.length || !pos.length) return { ajuste: 0, acerto: null };
    const esp = B.espacamento(pos) || 0.25;
    const suave = B.mediaMovel(curv, Math.max(1, Math.round(o.suavizacao / esp)));
    const passo = Math.max(1, Math.round(1 / esp)); // 1 amostra por metro
    const amostras = [];
    for (let i = 0; i < pos.length; i += passo) {
      if (!Number.isNaN(suave[i])) amostras.push([pos[i], suave[i] <= -o.limiarCurva ? 'E' : suave[i] >= o.limiarCurva ? 'D' : 'T']);
    }
    const nota = (aj, troca) => {
      let ok = 0; let total = 0;
      for (const [p, cls] of amostras) {
        const el = naPlanta(els, p + aj);
        if (!el) continue;
        total++;
        let esperado = el.tipo === 'T' ? 'T' : (el.lado === 'D' ? 'D' : 'E');
        if (troca && esperado !== 'T') esperado = esperado === 'D' ? 'E' : 'D';
        if (esperado === cls) ok++;
      }
      return total >= amostras.length * 0.3 ? ok / total : 0;
    };
    let melhor = { ajuste: 0, acerto: -1, troca: false };
    [false, true].forEach((troca) => {
      for (let aj = -300; aj <= 300; aj += 2) {
        const v = nota(aj, troca);
        if (v > melhor.acerto + 1e-9 || (Math.abs(v - melhor.acerto) < 1e-9 && Math.abs(aj) < Math.abs(melhor.ajuste))) melhor = { ajuste: aj, acerto: v, troca };
      }
    });
    for (let aj = melhor.ajuste - 2; aj <= melhor.ajuste + 2; aj += 0.5) {
      const v = nota(aj, melhor.troca);
      if (v > melhor.acerto + 1e-9) melhor = { ...melhor, ajuste: aj, acerto: v };
    }
    return { ajuste: melhor.ajuste, acerto: melhor.acerto < 0 ? null : melhor.acerto * 100 };
  };

  /**
   * Elementos pela planta: cada ponto do arquivo (posição + ajuste) é atribuído ao elemento da planta.
   * Trechos sem elemento (pátios, AMV fora da planta) viram "Sem elemento na planta".
   */
  B.segmentarPorPlanta = (pos, els, ajuste = 0) => {
    const n = pos.length;
    const esp = B.espacamento(pos) || 0.25;
    const seg = [];
    let atual = null;
    for (let i = 0; i < n; i++) {
      const el = naPlanta(els, pos[i] + ajuste);
      if (!atual || atual.ref !== el) {
        atual = { ref: el, i0: i, i1: i };
        seg.push(atual);
      } else {
        atual.i1 = i;
      }
    }
    // Nome do trecho sem elemento: "Entre EH x e EH y" (vizinhos na sequência do arquivo).
    const ehVizinho = (k, passo) => {
      for (let j = k + passo; j >= 0 && j < seg.length; j += passo) if (seg[j].ref) return seg[j].ref.eh;
      return '';
    };
    return seg.map((s, k) => {
      const e = s.ref;
      if (!e) {
        const a = ehVizinho(k, -1); const b = ehVizinho(k, 1);
        s.nomeGap = a && b ? (a === b ? `Sem elemento na planta (EH ${a})` : `Entre EH ${a} e EH ${b}`) : 'Sem elemento na planta';
      }
      const base = { i0: s.i0, i1: s.i1, ini: pos[s.i0], fim: pos[s.i1], extensao: abs(pos[s.i1] - pos[s.i0]) + esp };
      if (!e) return { ...base, tipo: 'X', eh: '', sigla: '—', nome: s.nomeGap, lado: '', raioPlanta: null };
      const numero = e.num ? String(e.num).padStart(2, '0') : '';
      return {
        ...base,
        tipo: e.tipo,
        eh: e.eh,
        sigla: `${e.tipo}${numero}`,
        nome: `EH ${e.eh} · ${e.tipo === 'C' ? 'Curva' : 'Tangente'} ${numero}`,
        lado: e.lado,
        raioPlanta: e.raio || null,
        superelevacao: e.superelevacao,
        planta: { ini: e.ini, fim: e.fim }
      };
    });
  };

  /**
   * Análise completa: elementos, indicadores por elemento, por EH e gerais.
   * opcoes: limiarCurva, suavizacao, comprimentoMin, limitePerda, limiteVariacao, alinhamento (id),
   *         offset { bitola, valor, aplicar }, modo ('planta'|'curvatura'), elementosPlanta, ajusteKm.
   */
  B.analisar = (arquivo, opcoes = {}) => {
    const o = { ...B.PADRAO, alinhamento: 'alr10', ...opcoes };
    const { pos } = arquivo;
    const original = arquivo.dados;
    const dados = o.offset && o.offset.aplicar ? B.dadosComOffset(original, o.offset) : original;
    const alin = dados[o.alinhamento];
    const esp = B.espacamento(pos) || 0.25;
    const janela = Math.max(3, Math.round(o.janelaVariacao / esp) + 1);
    const varF = B.desvioMovel(dados.bitF, janela);
    const varT = B.desvioMovel(dados.bitT, janela);
    const variacao = Float64Array.from(varF, (v, i) => Math.max(Number.isNaN(v) ? -1 : v, Number.isNaN(varT[i]) ? -1 : varT[i])).map((v) => (v < 0 ? NaN : v));
    const extras = { alinhamento: alin, variacao };

    const usarPlanta = o.modo === 'planta' && o.elementosPlanta && o.elementosPlanta.length;
    const brutos = usarPlanta ? B.segmentarPorPlanta(pos, o.elementosPlanta, o.ajusteKm || 0) : B.segmentar(pos, dados.curv, o);
    const elementos = brutos.map((e) => ({ ...e, ...resumoTrecho(dados, e.i0, e.i1, o, extras) }));
    const geral = resumoTrecho(dados, 0, pos.length - 1, o, extras);

    const somar = (els) => {
      const pontos = els.reduce((s, e) => s + e.pontos, 0);
      const perdas = els.reduce((s, e) => s + e.perdas, 0);
      return { quantidade: els.length, extensao: els.reduce((s, e) => s + e.extensao, 0), pontos, perdas, pctPerda: pontos ? (perdas / pontos) * 100 : null };
    };

    // Resumo por EH (só no modo planta), na ordem da inspeção.
    const porEh = [];
    if (usarPlanta) {
      elementos.forEach((e) => {
        if (e.tipo === 'X') return;
        let g = porEh.find((x) => x.eh === e.eh);
        if (!g) { g = { eh: e.eh, els: [] }; porEh.push(g); }
        g.els.push(e);
      });
      porEh.forEach((g) => {
        const r = resumoTrecho(dados, Math.min(...g.els.map((e) => e.i0)), Math.max(...g.els.map((e) => e.i1)), o, extras);
        Object.assign(g, somar(g.els), { pctVariacao: r.pctVariacao, ini: g.els[0].ini, fim: g.els[g.els.length - 1].fim, curvas: g.els.filter((e) => e.tipo === 'C').length, tangentes: g.els.filter((e) => e.tipo === 'T').length });
        delete g.els;
      });
    }

    return {
      opcoes: o,
      modo: usarPlanta ? 'planta' : 'curvatura',
      dados,
      elementos,
      porEh,
      geral: { ...geral, extensao: abs(pos[pos.length - 1] - pos[0]) + esp },
      tangentes: somar(elementos.filter((e) => e.tipo === 'T')),
      curvas: somar(elementos.filter((e) => e.tipo === 'C')),
      difFT: B.diferenca(dados.bitF, dados.bitT),
      difKld: Float64Array.from(dados.bitF, (f, i) => (abs(dados.kld[i]) < KLD_MAX ? f - dados.kld[i] : NaN)),
      kldValido: Float64Array.from(dados.kld, (k) => (abs(k) < KLD_MAX ? k : NaN)),
      varF,
      varT,
      variacao
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
