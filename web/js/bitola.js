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

  /** Parâmetros que podem ser vistos no gráfico selecionável (por grupo). */
  B.GRUPOS_GRAFICO = [
    { grupo: 'Alinhamento', ids: ['alr10', 'alr20', 'al10', 'al20', 'alMax10', 'val25'] },
    { grupo: 'Nivelamento longitudinal', ids: ['nl5', 'nl20'] },
    { grupo: 'Empeno e torção', ids: ['emp2', 'emp10', 'emp20', 'warp'] },
    { grupo: 'Superelevação', ids: ['sup'] },
    { grupo: 'Outros', ids: ['vrbt5'] }
  ];
  /** Nome e grupo de um parâmetro do gráfico selecionável. */
  B.parametroGrafico = (id) => {
    const p = [...B.ALINHAMENTO, ...B.NIVELAMENTO].find((x) => x.id === id) || B.ALINHAMENTO[0];
    const g = B.GRUPOS_GRAFICO.find((x) => x.ids.includes(p.id));
    return { id: p.id, nome: p.nome, grupo: g ? g.grupo : 'Parâmetro' };
  };

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
    // Linha de cada ponto (pode mudar dentro do arquivo: 0, 1, 2, 3 ou até um texto como "TESTE01").
    const iLinha = iCampo('linha');
    const linhasValores = [];
    const linhaIdxBruto = new Uint16Array(n);
    const indiceValor = new Map();
    brutos.forEach((c, i) => {
      const v = iLinha >= 0 ? String(c[iLinha] || '').trim() : '';
      if (!indiceValor.has(v)) { indiceValor.set(v, linhasValores.length); linhasValores.push(v); }
      linhaIdxBruto[i] = indiceValor.get(v);
    });
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
    const linhaIdx = Uint16Array.from(manter, (i) => linhaIdxBruto[i]);

    const evs = eventos.map((c) => {
      const km = num(c[7]);
      const loc = num(c[9]);
      return { pos: km === null || loc === null ? NaN : km * 1000 + loc, codigo: String(c[13] || '').trim(), texto: String(c[14] || '').trim() };
    }).filter((e) => !Number.isNaN(e.pos) && e.texto);

    return { meta, pos: posF, dados, eventos: evs, avisos, linhaIdx, linhasValores };
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

  /* ------------------------------------------------------------------ */
  /* Regra da perda de bitola (fonte única para tela, laudo e offset)    */
  /* ------------------------------------------------------------------ */
  //
  // 1) Diferença no ponto: F − T, arredondada a 0,01 mm (resolução do arquivo). Sem o arredondamento,
  //    contas como 2,7 − 0,7 dão 2,0000000000000004 e um ponto com diferença de exatamente 2,00 mm
  //    seria contado como perda.
  // 2) Ponto com perda: |F − T| > limite (padrão 2 mm; exatamente 2,00 mm não é perda).
  //    Só entra ponto com Bitola F e Bitola T lidas; pontos sem leitura não contam para nada.
  // 3) % de perda = extensão com perda ÷ extensão medida, em metros. Cada ponto vale a distância que o
  //    carro andou até o ponto seguinte: parado ou em ré vale 0 (não conta duas vezes o mesmo lugar) e
  //    salto de km (falha de gravação) vale só o espaçamento normal. Com o carro andando normalmente
  //    (um ponto a cada 0,25 m) dá o mesmo que contar pontos.
  // 4) Pátios (RH) ficam fora das estatísticas gerais (máscara).

  /** Diferença F − T arredondada a 0,01 mm (NaN se faltar uma das duas). */
  B.difBitola = (f, t) => (Number.isNaN(f) || Number.isNaN(t) ? NaN : Math.round((f - t) * 100) / 100);

  /** Ponto com perda de bitola: |F − T| (arredondada) maior que o limite. */
  B.ehPerda = (dif, limite) => !Number.isNaN(dif) && abs(dif) > limite;

  /** Peso (m) de cada ponto: distância andada até o próximo, sem contar parada, ré nem salto de km. */
  B.pesosDistancia = (pos) => {
    const n = pos.length;
    const w = new Float64Array(n);
    if (!n) return w;
    const esp = B.espacamento(pos) || 0.25;
    const sentido = pos[n - 1] >= pos[0] ? 1 : -1;
    const maxPasso = Math.max(1, esp * 4);
    for (let i = 0; i < n; i++) {
      const d = i < n - 1 ? (pos[i + 1] - pos[i]) * sentido : esp;
      w[i] = d <= 0 ? 0 : d > maxPasso ? esp : d;
    }
    return w;
  };

  /**
   * Perda de bitola num intervalo de pontos (regra acima).
   * Retorna pontos/perdas (contagem), metros/metrosPerda (extensão) e pct (sobre a extensão).
   */
  B.avaliarPerda = (dados, limite, i0 = 0, i1 = dados.bitF.length - 1, mascara = null, pesos = null) => {
    let pontos = 0; let perdas = 0; let metros = 0; let metrosPerda = 0;
    for (let i = i0; i <= i1; i++) {
      if (mascara && !mascara[i]) continue;
      const dif = B.difBitola(dados.bitF[i], dados.bitT[i]);
      if (Number.isNaN(dif)) continue;
      const w = pesos ? pesos[i] : 1;
      pontos++; metros += w;
      if (B.ehPerda(dif, limite)) { perdas++; metrosPerda += w; }
    }
    const pct = metros > 0 ? (metrosPerda / metros) * 100 : (pontos ? (perdas / pontos) * 100 : null);
    return { pontos, perdas, metros, metrosPerda, pct };
  };

  /** Perda de bitola em todo o trecho (compatível com a versão anterior). */
  B.perdaTotal = (dados, limite, i0 = 0, i1 = dados.bitF.length - 1, mascara = null, pesos = null) =>
    B.avaliarPerda(dados, limite, i0, i1, mascara, pesos);

  /**
   * Offset (em mm) para a bitola F ou T que mais reduz a perda de bitola (mesma regra, mesmos pesos).
   * Testa de −10 a +10 mm em passos de 0,1 mm.
   */
  B.melhorOffset = (dados, bitola, limite, mascara = null, pesos = null) => {
    if (bitola !== 'bitF' && bitola !== 'bitT') return null;
    const difs = []; const ws = [];
    for (let i = 0; i < dados.bitF.length; i++) {
      if (mascara && !mascara[i]) continue;
      const dif = B.difBitola(dados.bitF[i], dados.bitT[i]);
      if (!Number.isNaN(dif)) { difs.push(dif); ws.push(pesos ? pesos[i] : 1); }
    }
    if (!difs.length) return null;
    const total = ws.reduce((a, b) => a + b, 0) || difs.length;
    const sinal = bitola === 'bitF' ? 1 : -1; // offset em F soma na diferença; em T, subtrai
    let melhor = { valor: 0, perdas: Infinity, metros: Infinity };
    for (let k = -100; k <= 100; k++) {
      const off = k / 10;
      let perdas = 0; let metros = 0;
      difs.forEach((d, n) => { if (B.ehPerda(Math.round((d + sinal * off) * 100) / 100, limite)) { perdas++; metros += ws[n]; } });
      if (metros < melhor.metros - 1e-9 || (abs(metros - melhor.metros) < 1e-9 && abs(off) < abs(melhor.valor))) melhor = { valor: off, perdas, metros };
    }
    return { valor: melhor.valor, perdas: melhor.perdas, pontos: difs.length, metrosPerda: melhor.metros, pct: (melhor.metros / total) * 100 };
  };

  function resumoTrecho(d, i0, i1, opcoes, extras) {
    let validos = 0; let perdas = 0; let maxDif = 0; let somaDif = 0; let metros = 0; let metrosPerda = 0; let metrosTotal = 0;
    const pesos = extras.pesos;
    let nK = 0; let somaK = 0; let perdasK = 0;
    let nC = 0; let somaC = 0;
    let nA = 0; let somaA = 0; let maxA = 0;
    let nV = 0; let varRapida = 0;
    const alinhamento = extras.alinhamento;
    const mascara = extras.mascara; // 0 = fora da estatística (pátio/RH)
    for (let i = i0; i <= i1; i++) {
      if (mascara && !mascara[i]) continue;
      const f = d.bitF[i];
      const w = pesos ? pesos[i] : 1;
      metrosTotal += w;
      const dif = B.difBitola(f, d.bitT[i]);
      if (!Number.isNaN(dif)) {
        validos++;
        metros += w;
        somaDif += abs(dif);
        if (B.ehPerda(dif, opcoes.limitePerda)) { perdas++; metrosPerda += w; }
        if (abs(dif) > abs(maxDif)) maxDif = dif;
      }
      const k = d.kld[i];
      if (!Number.isNaN(f) && !Number.isNaN(k) && abs(k) < KLD_MAX) {
        const dk = Math.round((f - k) * 100) / 100;
        nK++;
        somaK += dk;
        if (B.ehPerda(dk, opcoes.limitePerda)) perdasK++;
      }
      if (!Number.isNaN(d.curv[i])) { nC++; somaC += d.curv[i]; }
      const a = alinhamento ? alinhamento[i] : NaN;
      if (!Number.isNaN(a)) { nA++; somaA += abs(a); if (abs(a) > abs(maxA)) maxA = a; }
      const v = extras.variacao[i];
      if (!Number.isNaN(v)) { nV += w; if (v > opcoes.limiteVariacao) varRapida += w; } // também em metros
    }
    const curvMedia = nC ? somaC / nC : NaN;
    return {
      pontos: validos,
      perdas,
      metros,
      metrosPerda,
      // % sobre a extensão medida (F e T lidas); sem pesos, sobre os pontos
      pctPerda: metros > 0 ? (metrosPerda / metros) * 100 : (validos ? (perdas / validos) * 100 : null),
      // fração da extensão do trecho com Bitola F e T lidas (abaixo de 90%, o resultado é pouco confiável)
      cobertura: metrosTotal > 0 ? metros / metrosTotal : null,
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
    const candidatos = Object.keys(ramais).filter((k) => r.endsWith(k));
    return candidatos.length === 1 ? candidatos[0] : '';
  };

  /** Elementos da planta de um ramal e linha, em ordem de km. */
  B.elementosDaPlanta = (planta, ramal, linha) => planta.elementos
    .filter((e) => e.ramal === ramal && String(e.linha) === String(linha))
    .sort((a, b) => a.ini - b.ini);

  /** Linha da planta correspondente ao valor da coluna LINHA ("1", "01", "L1", "LINHA 2"…); null se não for linha. */
  B.linhaDaPlanta = (valor, linhasPlanta) => {
    const m = /^\s*(?:L|LINHA)?\s*0*(\d{1,2})\s*$/i.exec(String(valor ?? ''));
    if (!m) return null;
    const l = String(Number(m[1]));
    return linhasPlanta.map(String).includes(l) ? l : null;
  };

  /**
   * Localização pelo km: para cada ponto, o elemento da planta que contém o km (com a correção).
   * A linha do arquivo só escolhe qual linha da planta consultar primeiro; se ela não existir
   * (ou não tiver elemento naquele km), usa as outras linhas do ramal. Nunca bloqueia pela linha.
   */
  B.localizador = (planta, ramal, arquivo, linhaRef) => {
    const linhasPlanta = (planta.ramais[ramal] || []).map(String);
    const porLinha = new Map(linhasPlanta.map((l) => [l, B.elementosDaPlanta(planta, ramal, l)]));
    const ordem = [linhaRef, ...linhasPlanta.filter((l) => l !== linhaRef)].filter((l) => porLinha.has(l));
    const valores = (arquivo.linhasValores || []).map((v) => B.linhaDaPlanta(v, linhasPlanta));
    const idx = arquivo.linhaIdx;
    return (i, km) => {
      const propria = idx && valores[idx[i]];
      if (propria) { const el = naPlanta(porLinha.get(propria), km); if (el) return el; }
      for (const l of ordem) { if (l === propria) continue; const el = naPlanta(porLinha.get(l), km); if (el) return el; }
      return null;
    };
  };

  /** Valores da coluna LINHA num intervalo de pontos (mais frequentes primeiro), ex.: "1" ou "1 / TESTE01". */
  B.linhaDoTrecho = (arquivo, i0, i1) => {
    if (!arquivo.linhaIdx || !arquivo.linhasValores) return String((arquivo.meta && arquivo.meta.linha) || '');
    const cont = new Map();
    for (let i = i0; i <= i1; i++) { const k = arquivo.linhaIdx[i]; cont.set(k, (cont.get(k) || 0) + 1); }
    return [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => arquivo.linhasValores[k] || '—').join(' / ');
  };

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
   * Quanto as curvas do arquivo combinam com as curvas de um ramal/linha da planta (0 a 100),
   * testando deslocamentos de km. Só olha as curvas (as tangentes combinam com qualquer lugar).
   * Usado para conferir se o km do arquivo é mesmo do ramal informado (ex.: TU e LT têm os mesmos km).
   */
  B.compatibilidade = (pos, curv, els, opcoes = {}) => {
    const o = { ...B.PADRAO, ...opcoes };
    if (!els.length || !pos.length) return { nota: 0, ajuste: 0 };
    const esp = B.espacamento(pos) || 0.25;
    const suave = B.mediaMovel(curv, Math.max(1, Math.round(o.suavizacao / esp)));
    const passo = Math.max(1, Math.round(5 / esp)); // 1 amostra a cada 5 m
    const amostras = [];
    for (let i = 0; i < pos.length; i += passo) {
      if (!Number.isNaN(suave[i])) amostras.push([pos[i], abs(suave[i]) >= o.limiarCurva]);
    }
    const nota = (aj) => {
      let vp = 0; let medidas = 0; let planta = 0; let dentro = 0;
      for (const [p, curva] of amostras) {
        const el = naPlanta(els, p + aj);
        if (!el) continue;
        dentro++;
        const curvaPlanta = el.tipo === 'C';
        if (curva) medidas++;
        if (curvaPlanta) planta++;
        if (curva && curvaPlanta) vp++;
      }
      if (dentro < amostras.length * 0.5 || !medidas || !planta) return 0;
      return (2 * vp) / (medidas + planta); // F1 das amostras em curva
    };
    let melhor = { nota: 0, ajuste: 0 };
    for (let aj = -300; aj <= 300; aj += 10) {
      const v = nota(aj);
      if (v > melhor.nota) melhor = { nota: v, ajuste: aj };
    }
    return { nota: Math.round(melhor.nota * 100), ajuste: melhor.ajuste };
  };

  /**
   * Curvatura + planta: os limites de cada elemento vêm da curvatura medida (o que o carro realmente viu)
   * e o nome vem da planta (Curva 01, Tangente 02 do EH x/y). Trechos fora da planta viram RH (pátio).
   */
  B.segmentarHibrido = (pos, curv, els, ajuste = 0, opcoes = {}, achar = null) => {
    const o = { ...B.PADRAO, ...opcoes };
    const n = pos.length;
    if (!n) return [];
    const esp = B.espacamento(pos) || 0.25;
    const nomes = B.nomesTrechos(els);
    const linhaPlanta = els.length ? els[0].linha : '';
    const medidos = B.segmentar(pos, curv, o);
    const ref = new Array(n);
    for (let i = 0; i < n; i++) ref[i] = achar ? achar(i, pos[i] + ajuste) : naPlanta(els, pos[i] + ajuste);
    const minRh = Math.max(o.comprimentoMin, 25); // pátios reais têm ~260 m; buracos menores são falha da planta

    // 1) Pátios: trechos contínuos fora da planta com pelo menos o comprimento mínimo (no arquivo todo).
    const noPatio = new Uint8Array(n);
    for (let i = 0; i < n;) {
      if (ref[i]) { i++; continue; }
      let k = i;
      while (k + 1 < n && !ref[k + 1]) k++;
      if (abs(pos[k] - pos[i]) + esp >= minRh) noPatio.fill(1, i, k + 1);
      i = k + 1;
    }
    // Cada trecho medido é dividido onde entra/sai de um pátio.
    let pedacos = [];
    medidos.forEach((m) => {
      let ini = m.i0;
      for (let i = m.i0 + 1; i <= m.i1 + 1; i++) {
        if (i <= m.i1 && noPatio[i] === noPatio[ini]) continue;
        pedacos.push({ medido: m.tipo, i0: ini, i1: i - 1, fora: !!noPatio[ini] });
        ini = i;
      }
    });
    // Pátio cortado por uma mudança de curvatura vira um pedaço só.
    pedacos = pedacos.reduce((acc, p) => {
      const u = acc[acc.length - 1];
      if (u && u.fora && p.fora) u.i1 = p.i1; else acc.push({ ...p });
      return acc;
    }, []);
    const ext = (p) => abs(pos[p.i1] - pos[p.i0]) + esp;
    // Pedaços curtos dentro da planta (sobras ao lado de um pátio) são unidos ao vizinho da planta.
    for (let k = 0; k < pedacos.length; k++) {
      const p = pedacos[k];
      if (pedacos.length > 1 && !p.fora && ext(p) < o.comprimentoMin) {
        const ant = pedacos[k - 1]; const prox = pedacos[k + 1];
        const alvo = (ant && !ant.fora) ? ant : (prox && !prox.fora) ? prox : (ant || prox);
        alvo.i0 = Math.min(alvo.i0, p.i0); alvo.i1 = Math.max(alvo.i1, p.i1);
        pedacos.splice(k, 1);
        k = Math.max(-1, k - 2);
      }
    }

    // 2) Nome pela planta: o elemento da planta com mais pontos no pedaço.
    const rotulo = (p) => {
      if (p.fora) {
        const rh = nomes.rh((pos[p.i0] + pos[p.i1]) / 2 + ajuste);
        return { chave: `RH|${rh}`, tipo: 'X', eh: rh, trecho: rh, sigla: 'RH', nome: `${rh} (pátio)`, lado: '', raioPlanta: null };
      }
      const cont = new Map();
      for (let i = p.i0; i <= p.i1; i++) if (ref[i]) cont.set(ref[i], (cont.get(ref[i]) || 0) + 1);
      let el = null; let maior = 0;
      // prefere elemento do mesmo tipo do medido (curva medida → curva da planta)
      cont.forEach((q, e) => { const peso = q * (e.tipo === p.medido ? 1.5 : 1); if (peso > maior) { maior = peso; el = e; } });
      const numero = el.num ? String(el.num).padStart(2, '0') : '';
      const trecho = nomes.eh(el.eh);
      return {
        chave: `EL|${el.ini}|${el.fim}`,
        tipo: el.tipo,
        eh: trecho,
        trecho,
        sigla: `${el.tipo}${numero}`,
        nome: `${trecho} · ${el.tipo === 'C' ? 'Curva' : 'Tangente'} ${numero}`,
        lado: el.lado,
        raioPlanta: el.raio || null,
        superelevacao: el.superelevacao,
        planta: { ini: el.ini, fim: el.fim },
        tipoMedido: p.medido
      };
    };

    // 3) Junta pedaços vizinhos com o mesmo elemento da planta.
    const saida = [];
    pedacos.forEach((p) => {
      const r = rotulo(p);
      const u = saida[saida.length - 1];
      if (u && u.chave === r.chave) { u.i1 = p.i1; return; }
      saida.push({ ...r, i0: p.i0, i1: p.i1 });
    });
    return saida.map(({ chave, ...e }) => ({ ...e, ini: pos[e.i0], fim: pos[e.i1], extensao: abs(pos[e.i1] - pos[e.i0]) + esp, linha: linhaPlanta }));
  };


  /**
   * Nome dos trechos da ferrovia a partir da planta.
   * A ferrovia alterna EH (entre pátios, ~7 km) e RH (pátio, ~260 m). O "Eh 43" da planta é o
   * trecho EH 43/44; o pátio entre o EH 42/43 e o EH 43/44 é a RH-43. Ordem: km crescente.
   */
  B.nomesTrechos = (els) => {
    const ordem = [];
    els.forEach((e) => { if (ordem[ordem.length - 1] !== e.eh) ordem.push(e.eh); });
    const proximo = {};
    ordem.forEach((eh, k) => {
      const seguinte = ordem.slice(k + 1).find((x) => x !== eh && x !== '');
      const n = Number(eh);
      proximo[eh] = seguinte !== undefined && Number(seguinte) > n ? seguinte : (Number.isFinite(n) && eh !== '' ? String(n + 1) : '');
    });
    return {
      eh: (eh) => (eh === '' ? 'EH ?' : `EH ${eh}/${proximo[eh] || '?'}`),
      /** RH na posição p (metros da planta): número do EH logo acima no km. */
      rh: (p) => {
        const acima = els.find((e) => e.ini >= p && e.eh !== '');
        if (acima) return `RH-${acima.eh}`;
        const abaixo = [...els].reverse().find((e) => e.fim <= p && e.eh !== '');
        const n = abaixo ? Number(abaixo.eh) : NaN;
        return Number.isFinite(n) ? `RH-${n + 1}` : 'RH';
      }
    };
  };

  /**
   * Elementos pela planta: cada ponto do arquivo (posição + ajuste) é atribuído ao elemento da planta.
   * Trechos sem elemento na planta são as RH (pátios).
   */
  B.segmentarPorPlanta = (pos, els, ajuste = 0, achar = null) => {
    const n = pos.length;
    const esp = B.espacamento(pos) || 0.25;
    const nomes = B.nomesTrechos(els);
    const linhaPlanta = els.length ? els[0].linha : '';
    const seg = [];
    let atual = null;
    for (let i = 0; i < n; i++) {
      const el = achar ? achar(i, pos[i] + ajuste) : naPlanta(els, pos[i] + ajuste);
      if (!atual || atual.ref !== el) {
        atual = { ref: el, i0: i, i1: i };
        seg.push(atual);
      } else {
        atual.i1 = i;
      }
    }
    return seg.map((s) => {
      const e = s.ref;
      const base = { i0: s.i0, i1: s.i1, ini: pos[s.i0], fim: pos[s.i1], extensao: abs(pos[s.i1] - pos[s.i0]) + esp, linha: e ? e.linha : linhaPlanta };
      if (!e) {
        const rh = nomes.rh((pos[s.i0] + pos[s.i1]) / 2 + ajuste);
        return { ...base, tipo: 'X', eh: rh, trecho: rh, sigla: 'RH', nome: `${rh} (pátio)`, lado: '', raioPlanta: null };
      }
      const numero = e.num ? String(e.num).padStart(2, '0') : '';
      const trecho = nomes.eh(e.eh);
      return {
        ...base,
        tipo: e.tipo,
        eh: trecho,
        trecho,
        sigla: `${e.tipo}${numero}`,
        nome: `${trecho} · ${e.tipo === 'C' ? 'Curva' : 'Tangente'} ${numero}`,
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
    const pesos = B.pesosDistancia(pos);
    const extras = { alinhamento: alin, variacao, pesos };

    const temPlanta = !!(o.elementosPlanta && o.elementosPlanta.length);
    const modo = temPlanta && (o.modo === 'planta' || o.modo === 'hibrido') ? o.modo : 'curvatura';
    const usarPlanta = modo !== 'curvatura';
    let brutos;
    if (modo === 'planta') brutos = B.segmentarPorPlanta(pos, o.elementosPlanta, o.ajusteKm || 0, o.localizar || null);
    else if (modo === 'hibrido') brutos = B.segmentarHibrido(pos, dados.curv, o.elementosPlanta, o.ajusteKm || 0, o, o.localizar || null);
    else brutos = B.segmentar(pos, dados.curv, o);
    // A linha mostrada é a da coluna LINHA do arquivo em cada trecho (só informativa).
    const elementos = brutos.map((e) => ({ ...e, linha: B.linhaDoTrecho(arquivo, e.i0, e.i1), ...resumoTrecho(dados, e.i0, e.i1, o, extras) }));
    // Pátios (RH) ficam fora das estatísticas gerais (perda de bitola, OGMS × KLD, variação).
    const mascara = new Uint8Array(pos.length).fill(1);
    elementos.forEach((e) => { if (e.tipo === 'X') mascara.fill(0, e.i0, e.i1 + 1); });
    const geral = resumoTrecho(dados, 0, pos.length - 1, o, { ...extras, mascara });
    const extensaoRh = elementos.filter((e) => e.tipo === 'X').reduce((s2, e) => s2 + e.extensao, 0);

    // Totais = soma das extensões medidas e com perda dos elementos (mesma regra do geral).
    const somar = (els) => {
      const soma = (k) => els.reduce((s, e) => s + (e[k] || 0), 0);
      const metros = soma('metros'); const metrosPerda = soma('metrosPerda');
      const pontos = soma('pontos'); const perdas = soma('perdas');
      return {
        quantidade: els.length, extensao: soma('extensao'), pontos, perdas, metros, metrosPerda,
        pctPerda: metros > 0 ? (metrosPerda / metros) * 100 : (pontos ? (perdas / pontos) * 100 : null)
      };
    };

    // Resumo por trecho (EH e RH; só no modo planta), na ordem da inspeção.
    const porEh = [];
    if (usarPlanta) {
      elementos.forEach((e) => {
        let g = porEh.find((x) => x.eh === e.eh);
        if (!g) { g = { eh: e.eh, rh: e.tipo === 'X', linha: e.linha, els: [] }; porEh.push(g); }
        g.els.push(e);
      });
      porEh.forEach((g) => {
        const r = resumoTrecho(dados, Math.min(...g.els.map((e) => e.i0)), Math.max(...g.els.map((e) => e.i1)), o, extras);
        g.linha = [...new Set(g.els.flatMap((e) => String(e.linha || '').split(' / ')).filter(Boolean))].join(' / ');
        Object.assign(g, somar(g.els), { pctVariacao: r.pctVariacao, ini: g.els[0].ini, fim: g.els[g.els.length - 1].fim, curvas: g.els.filter((e) => e.tipo === 'C').length, tangentes: g.els.filter((e) => e.tipo === 'T').length });
        // Elemento com a maior perda de bitola no trecho (na RH, o próprio pátio).
        const pior = g.els.reduce((m, e) => ((e.pctPerda ?? -1) > (m ? m.pctPerda ?? -1 : -2) ? e : m), null);
        g.pior = pior ? { sigla: pior.sigla, tipo: pior.tipo, nome: pior.nome, pctPerda: pior.pctPerda, ini: pior.ini, fim: pior.fim } : null;
        delete g.els;
      });
    }

    return {
      opcoes: o,
      modo,
      mascara,
      pesos,
      dados,
      elementos,
      porEh,
      geral: { ...geral, extensao: abs(pos[pos.length - 1] - pos[0]) + esp, extensaoRh },
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
      return { posicao: k + 1, i, pos: pos[i], km: B.fmtKm(pos[i]), valor: v[i], elemento: !el ? '—' : (el.trecho ? (el.tipo === 'X' ? el.trecho : `${el.trecho} · ${el.sigla}`) : el.sigla) };
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
