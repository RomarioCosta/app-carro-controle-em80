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

  /**
   * Colunas usadas na análise, identificadas pelo título (sem espaços, acentos ou maiúsculas).
   * Uma lista aceita nomes alternativos (o formato do CSV muda entre versões do carro).
   */
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
    nl10: 'nlmax10',
    nl20: 'nlmax20',
    nlTqi: 'nltqi',
    vrbt5: 'vrbtmax5',
    alMax10: 'almax10',
    al10: 'al10b10',
    al20: 'al20b10',
    alr10: 'alr1010',
    alr20: 'alr1020',
    val25: ['valb25', 'alvb25'],
    al10mean: 'al10mean'
  };

  /** Parâmetros de alinhamento que podem ser exibidos junto com a bitola. */
  B.ALINHAMENTO = [
    { id: 'alr10', nome: 'ALR10_10' },
    { id: 'alr20', nome: 'ALR10_20' },
    { id: 'al10', nome: 'AL10_B10' },
    { id: 'al20', nome: 'AL20_B10' },
    { id: 'alMax10', nome: 'ALmax_10' },
    { id: 'val25', nome: 'VAL_B2,5 (ALv_B2,5)' },
    { id: 'al10mean', nome: 'AL10mean' }
  ];

  /** Parâmetros de nivelamento para o ranking. */
  B.NIVELAMENTO = [
    { id: 'nl5', nome: 'NLmax_5' },
    { id: 'nl10', nome: 'NLmax_10' },
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
    { grupo: 'Alinhamento', ids: ['alr10', 'alr20', 'al10', 'al20', 'alMax10', 'val25', 'al10mean'] },
    { grupo: 'Nivelamento longitudinal', ids: ['nl5', 'nl10', 'nl20'] },
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
    raioCurva: 3000, // m: raio medido até este valor é curva (10000/R ≥ 3,33); volta a tangente acima do dobro
    suavizacao: 20, // m: média móvel do raio medido (10000/R)
    curvaMin: 50, // m: curva mais curta que isso vira tangente
    tangenteMin: 20, // m: tangente mais curta que isso entre curvas do mesmo lado une as curvas
    comprimentoMin: 20, // m: trechos menores são unidos ao vizinho (modos com a planta)
    limitePerda: 2, // mm: |Bitola F − Bitola T| acima disso = perda de bitola
    limiteVariacao: 1.5, // mm: desvio padrão da bitola em 1 m acima disso = variação rápida (provável erro)
    janelaVariacao: 1, // metros
    limiteElemento: 10, // %: curva ou tangente com perda acima disso "perdeu a bitola"
    ajustePlacaMax: 300 // m: salto/volta do km que cai num km inteiro (placa) até isso = acerto do km em campo
  };

  /** A bitola nominal é 1000 mm; o arquivo traz só a diferença. */
  B.NOMINAL = 1000;

  const num = (s) => {
    const t = String(s ?? '').trim();
    if (!t || t.includes('*')) return null;
    const n = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t); // aceita vírgula decimal
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
    Object.entries(B.COLUNAS).forEach(([campo, chave]) => {
      const nomes = Array.isArray(chave) ? chave : [chave];
      idx[campo] = nomes.map((nm) => cab.indexOf(nm)).find((i) => i >= 0) ?? -1;
    });
    ['km', 'loc', 'bitF', 'bitT'].forEach((c) => {
      if (idx[c] < 0) throw new Error(`Coluna obrigatória não encontrada: ${c === 'loc' ? 'LOCALIZACAO' : c === 'bitF' ? 'Bitola F' : c === 'bitT' ? 'Bitola T' : 'KM'}.`);
    });
    // Colunas opcionais que faltam (o formato do CSV muda entre versões) não geram aviso: só somem do gráfico.
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
      sentido: pega('sequncia') || pega('sequencia'),
      corretiva: pega('corretiva')
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
    // Arquivo aberto e salvo no Excel costuma ter os números trocados (ponto e vírgula decimais): avisa.
    let foraFaixa = 0; let lidos = 0;
    for (let i = 0; i < n; i++) {
      for (const c of ['bitF', 'bitT']) {
        const v = dados[c][i];
        if (!Number.isNaN(v)) { lidos++; if (Math.abs(v) > 60) foraFaixa++; }
      }
    }
    if (lidos && foraFaixa / lidos > 0.01) {
      avisos.push(`${Math.round((foraFaixa / lidos) * 100)}% das leituras de bitola estão fora da faixa esperada (±60 mm). Se o arquivo foi aberto e salvo no Excel, os números podem ter sido alterados: use o arquivo original do carro e o campo "Analisar a partir do km".`);
    }

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

    // Formato novo do carro: sem linhas "E"; os trechos marcados na coluna EX (código ≠ 0) viram eventos
    // "INICIO EX n" / "FIM EX n" (o mesmo que aparece na coluna EX do Offboard).
    const iEx = cab.indexOf('ex');
    if (iEx >= 0) {
      let ini = -1; let cod = 0; let ultimo = -1;
      const fechar = () => {
        if (ini < 0) return;
        evs.push({ pos: posF[ini], codigo: String(cod), texto: `INICIO EX ${cod}`, ex: true });
        evs.push({ pos: posF[ultimo], codigo: String(cod), texto: `FIM EX ${cod}`, ex: true });
        ini = -1;
      };
      manter.forEach((iBruto, k) => {
        const v = num(brutos[iBruto][iEx]);
        const c = v === null ? 0 : Math.round(v);
        if (c && ini >= 0 && c === cod && k - ultimo <= 4) { ultimo = k; return; }
        if (c) { fechar(); ini = k; cod = c; ultimo = k; return; }
        if (ini >= 0 && k - ultimo > 4) fechar();
      });
      fechar();
    }

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

  /** Curvatura (|10000/R|) correspondente a um raio em metros. */
  B.curvaturaDoRaio = (raio) => (raio > 0 ? 10000 / raio : Infinity);

  /**
   * Distância percorrida até cada ponto (m). Não depende do km: se o km volta (correção em campo)
   * ou salta, o trecho conta só o espaçamento normal entre os pontos.
   */
  B.distanciaPercorrida = (pos, esp) => {
    const n = pos.length;
    const d = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const passo = Math.abs(pos[i] - pos[i - 1]);
      d[i] = d[i - 1] + (Number.isFinite(passo) && passo <= 5 * esp ? passo : esp);
    }
    return d;
  };

  /**
   * Elementos pelo raio medido (coluna 10000/R), na ordem de inspeção.
   * 1. Raio suavizado por média móvel (suavizacao, em m).
   * 2. Classificação com histerese: entra em curva quando o raio fica ≤ raioCurva;
   *    só volta a tangente quando o raio passa de raioCurva × 2 (evita liga-desliga em curvas abertas).
   *    O sinal de 10000/R separa curvas para lados opostos (curvas reversas).
   * 3. Limpeza, sempre pelo trecho mais curto primeiro:
   *    - curva com menos de curvaMin (m), ou com raio médio maior que raioCurva, vira tangente;
   *    - tangente com menos de tangenteMin (m) entre duas curvas: do mesmo lado, une as curvas;
   *      de lados opostos (curva reversa), é dividida entre as duas.
   * Retorna [{ tipo: 'T'|'C', lado: 'E'|'D'|'', nome, sigla, i0, i1, ini, fim, extensao, raioMin }].
   */
  B.segmentar = (pos, curv, opcoes = {}) => {
    const o = { ...B.PADRAO, ...opcoes };
    const n = pos.length;
    if (!n) return [];
    const esp = B.espacamento(pos) || 0.25;
    const dist = B.distanciaPercorrida(pos, esp);
    const k = B.mediaMovel(curv, Math.max(1, Math.round(o.suavizacao / esp)));
    const kEntra = B.curvaturaDoRaio(o.raioCurva);
    const kSai = kEntra / 2;

    // 1) Classe de cada ponto: 'T', 'E' (10000/R negativo) ou 'D' (positivo). Sem leitura: mantém a anterior.
    const classe = new Array(n);
    let est = 'T';
    for (let i = 0; i < n; i++) {
      const v = k[i];
      if (!Number.isNaN(v)) {
        if (v >= kEntra) est = 'D';
        else if (v <= -kEntra) est = 'E';
        else if ((est === 'D' && v < kSai) || (est === 'E' && v > -kSai)) est = 'T';
      }
      classe[i] = est;
    }

    // 2) Trechos contínuos.
    let seg = [];
    for (let i = 0, ini = 0; i <= n; i++) {
      if (i === n || classe[i] !== classe[ini]) { seg.push({ c: classe[ini], i0: ini, i1: i - 1 }); ini = i; }
    }
    const ext = (s) => dist[s.i1] - dist[s.i0] + esp;
    const juntar = () => {
      seg = seg.reduce((acc, x) => {
        const u = acc[acc.length - 1];
        if (u && u.c === x.c) u.i1 = x.i1; else acc.push({ ...x });
        return acc;
      }, []);
    };

    // Raio médio da curva: tem que ficar dentro do raio de curva (não só um pico).
    const mediaAbs = (s) => {
      let soma = 0; let q = 0;
      for (let i = s.i0; i <= s.i1; i++) if (!Number.isNaN(k[i])) { soma += Math.abs(k[i]); q++; }
      return q ? soma / q : 0;
    };

    // 3) Limpeza: resolve primeiro o trecho mais curto que viola a regra.
    for (let guarda = 0; guarda < 100000; guarda++) {
      let alvo = -1;
      seg.forEach((s, j) => {
        const curto = s.c === 'T'
          ? ext(s) < o.tangenteMin && seg[j - 1] && seg[j + 1] && seg[j - 1].c !== 'T' && seg[j + 1].c !== 'T'
          : ext(s) < o.curvaMin || mediaAbs(s) < kEntra;
        if (curto && (alvo < 0 || ext(s) < ext(seg[alvo]))) alvo = j;
      });
      if (alvo < 0) break;
      const s = seg[alvo];
      if (s.c !== 'T') s.c = 'T';
      else if (seg[alvo - 1].c === seg[alvo + 1].c) s.c = seg[alvo - 1].c; // une as duas curvas
      else { // curva reversa: a tangente curta é dividida entre as duas curvas
        const meio = Math.floor((s.i0 + s.i1) / 2);
        seg[alvo - 1].i1 = meio; seg[alvo + 1].i0 = meio + 1;
        seg.splice(alvo, 1);
      }
      juntar();
    }

    // 4) Ajuste fino do início/fim de cada curva: a suavização de suavizacao m desloca a transição,
    //    então o limite é procurado no raio pouco suavizado (5 m), onde ele cruza o raio de saída.
    const fino = B.mediaMovel(curv, Math.max(1, Math.round(5 / esp)));
    const janela = Math.max(1, Math.round(o.suavizacao / esp));
    const foraDaCurva = (i) => Number.isNaN(fino[i]) || Math.abs(fino[i]) < kSai;
    for (let j = 0; j < seg.length - 1; j++) {
      const a = seg[j]; const b = seg[j + 1];
      if ((a.c === 'T') === (b.c === 'T')) continue; // só tangente ↔ curva
      const lim0 = Math.max(a.i0 + 1, a.i1 - janela); const lim1 = Math.min(b.i1, a.i1 + 1 + janela);
      let novo = a.i1 + 1; // primeiro ponto do segundo trecho
      if (b.c !== 'T') { // entra na curva: da curva para trás até achar tangente
        for (let i = lim1 - 1; i >= lim0; i--) if (foraDaCurva(i)) { novo = i + 1; break; }
      } else { // sai da curva: da curva para frente até achar tangente
        for (let i = lim0; i < lim1; i++) if (foraDaCurva(i)) { novo = i; break; }
      }
      novo = Math.min(Math.max(novo, a.i0 + 1), b.i1);
      a.i1 = novo - 1; b.i0 = novo;
    }

    const cont = { T: 0, C: 0 };
    return seg.map((s) => {
      const tipo = s.c === 'T' ? 'T' : 'C';
      cont[tipo]++;
      const numero = String(cont[tipo]).padStart(2, '0');
      let kMax = 0;
      for (let i = s.i0; i <= s.i1; i++) if (Math.abs(k[i]) > kMax) kMax = Math.abs(k[i]);
      return {
        tipo,
        lado: tipo === 'C' ? s.c : '',
        i0: s.i0,
        i1: s.i1,
        sigla: `${tipo}${numero}`,
        nome: `${tipo === 'T' ? 'Tangente' : 'Curva'} ${numero}`,
        ini: pos[s.i0],
        fim: pos[s.i1],
        extensao: ext(s),
        raioMin: tipo === 'C' && kMax > 0 ? 10000 / kMax : null
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
  //    contas como 4,03 − 2,03 dão 2,0000000000000004 e um ponto com diferença de exatamente 2,00 mm
  //    seria contado como perda.
  // 2) Ponto acima da regra (com perda): |F − T| > limite (padrão 2 mm; exatamente 2,00 mm não é perda).
  //    Só entra ponto com Bitola F e Bitola T lidas.
  // 3) % de perda = pontos acima da regra ÷ total de pontos (contagem de pontos, todos os pontos do arquivo).
  // 4) Elemento (curva ou tangente) que perdeu a bitola: % de perda acima de 10% (ajustável).
  // 5) Circuitos (RH) ficam fora das estatísticas gerais (máscara).

  /** Diferença F − T arredondada a 0,01 mm (NaN se faltar uma das duas). */
  B.difBitola = (f, t) => (Number.isNaN(f) || Number.isNaN(t) ? NaN : Math.round((f - t) * 100) / 100);

  /** Ponto acima da regra: |F − T| (arredondada) maior que o limite. */
  B.ehPerda = (dif, limite) => !Number.isNaN(dif) && abs(dif) > limite;

  /** Perda de bitola num intervalo de pontos: { pontos, perdas, pct }. */
  B.avaliarPerda = (dados, limite, i0 = 0, i1 = dados.bitF.length - 1, mascara = null) => {
    let pontos = 0; let perdas = 0;
    for (let i = i0; i <= i1; i++) {
      if (mascara && !mascara[i]) continue;
      const dif = B.difBitola(dados.bitF[i], dados.bitT[i]);
      if (Number.isNaN(dif)) continue;
      pontos++;
      if (B.ehPerda(dif, limite)) perdas++;
    }
    return { pontos, perdas, pct: pontos ? (perdas / pontos) * 100 : null };
  };

  /** Perda de bitola em todo o trecho (compatível com a versão anterior). */
  B.perdaTotal = (dados, limite, i0 = 0, i1 = dados.bitF.length - 1, mascara = null) => B.avaliarPerda(dados, limite, i0, i1, mascara);

  /** Elemento que perdeu a bitola: % de perda acima do limite do elemento (padrão 10%). */
  B.elementoPerdeu = (pctPerda, limiteElemento = 10) => pctPerda !== null && pctPerda !== undefined && pctPerda > limiteElemento;

  /**
   * Offset (em mm) para a bitola F ou T que mais reduz a perda de bitola (mesma regra).
   * Testa de −10 a +10 mm em passos de 0,1 mm.
   */
  B.melhorOffset = (dados, bitola, limite, mascara = null) => {
    if (bitola !== 'bitF' && bitola !== 'bitT') return null;
    const difs = [];
    for (let i = 0; i < dados.bitF.length; i++) {
      if (mascara && !mascara[i]) continue;
      const dif = B.difBitola(dados.bitF[i], dados.bitT[i]);
      if (!Number.isNaN(dif)) difs.push(dif);
    }
    if (!difs.length) return null;
    const sinal = bitola === 'bitF' ? 1 : -1; // offset em F soma na diferença; em T, subtrai
    let melhor = { valor: 0, perdas: Infinity };
    for (let k = -100; k <= 100; k++) {
      const off = k / 10;
      let perdas = 0;
      for (const d of difs) if (B.ehPerda(Math.round((d + sinal * off) * 100) / 100, limite)) perdas++;
      if (perdas < melhor.perdas || (perdas === melhor.perdas && abs(off) < abs(melhor.valor))) melhor = { valor: off, perdas };
    }
    return { valor: melhor.valor, perdas: melhor.perdas, pontos: difs.length, pct: (melhor.perdas / difs.length) * 100 };
  };

  function resumoTrecho(d, i0, i1, opcoes, extras) {
    let validos = 0; let perdas = 0; let maxDif = 0; let somaDif = 0; let total = 0;
    let nK = 0; let somaK = 0; let perdasK = 0;
    let nC = 0; let somaC = 0;
    let nA = 0; let somaA = 0; let maxA = 0;
    let nV = 0; let varRapida = 0;
    const alinhamento = extras.alinhamento;
    const mascara = extras.mascara; // 0 = fora da estatística (pátio/RH)
    for (let i = i0; i <= i1; i++) {
      if (mascara && !mascara[i]) continue;
      const f = d.bitF[i];
      total++;
      const dif = B.difBitola(f, d.bitT[i]);
      if (!Number.isNaN(dif)) {
        validos++;
        somaDif += abs(dif);
        if (B.ehPerda(dif, opcoes.limitePerda)) perdas++;
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
      if (!Number.isNaN(v)) { nV++; if (v > opcoes.limiteVariacao) varRapida++; }
    }
    const curvMedia = nC ? somaC / nC : NaN;
    return {
      pontos: validos,
      perdas,
      // % de perda = pontos acima da regra ÷ total de pontos
      pctPerda: validos ? (perdas / validos) * 100 : null,
      // fração dos pontos do trecho com Bitola F e T lidas (abaixo de 90%, o resultado é pouco confiável)
      cobertura: total > 0 ? validos / total : null,
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
    // Tabela "Geometria da EFVM – Carro Controle" (aba elementos_revia): formato próprio.
    for (let i = 0; i < Math.min(linhas.length, 40); i++) {
      const ks = (linhas[i] || []).map(chave);
      if (ks.includes('tipoativo') && ks.includes('kminicial') && ks.includes('ehlinha')) return B.lerGeometria(linhas, i);
    }
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

  /**
   * Lê a tabela "Geometria da EFVM – Carro Controle" (aba elementos_revia).
   * Colunas: ramal (RLT), sede, elemento (CURVA 1, TANGENTE 2, RH-50), tipo_ativo (CURVA/TANGENTE/RH),
   * sentido (Esquerda/Direita), km_inicial e km_final (metros), raio, eh_linha ("49/50 L1").
   * As RH (circuitos) não viram elemento: ficam como trecho sem elemento, como na planta.
   */
  B.lerGeometria = (linhas, idxCab) => {
    const ks = (linhas[idxCab] || []).map((v) => U.chaveTitulo(v));
    const col = (k) => ks.indexOf(k);
    const c = {
      ramal: col('ramal'), elemento: col('elemento'), tipo: col('tipoativo'), sentido: col('sentido'),
      ini: col('kminicial'), fim: col('kmfinal'), raio: col('raio'), ehLinha: col('ehlinha'), sede: col('sede')
    };
    ['ramal', 'tipo', 'ini', 'fim', 'ehLinha'].forEach((k) => {
      if (c[k] < 0) throw new Error(`Coluna da geometria não encontrada: ${k}.`);
    });
    const n = (v) => (typeof v === 'number' ? v : U.numero(v));
    const elementos = [];
    let descartados = 0; let circuitos = 0;
    const rhs = []; // circuitos com o km (contagem e cobertura); não viram elemento
    linhas.slice(idxCab + 1).forEach((l) => {
      if (!l) return;
      const tipoAtivo = String(l[c.tipo] ?? '').trim().toUpperCase();
      const ramalBruto = String(l[c.ramal] ?? '').trim().toUpperCase();
      if (!ramalBruto || !tipoAtivo) return;
      if (tipoAtivo === 'RH') {
        circuitos++;
        const ini = n(l[c.ini]); const fim = n(l[c.fim]);
        const m = /L(\w+)\s*$/i.exec(String(l[c.ehLinha] ?? ''));
        const nome = c.elemento >= 0 ? String(l[c.elemento] ?? '').trim().toUpperCase() : 'RH';
        const rm = c.raio >= 0 ? n(l[c.raio]) : null;
        const ramalRh = ramalBruto.length > 2 && ramalBruto.startsWith('R') ? ramalBruto.slice(1) : ramalBruto;
        const linhaRh = m ? String(m[1]).replace(/^0+(?=\d)/, '') : '';
        // a mesma RH vem repetida (uma linha para cada EH vizinho)
        const repetida = rhs.find((r) => r.ramal === ramalRh && r.linha === linhaRh && r.nome === nome && r.ini === ini && r.fim === fim);
        if (repetida) { if (rm && !repetida.raio) repetida.raio = rm; return; }
        if (ini !== null && fim !== null && fim > ini && m) {
          rhs.push({ raio: rm || null, ramal: ramalBruto.length > 2 && ramalBruto.startsWith('R') ? ramalBruto.slice(1) : ramalBruto, linha: String(m[1]).replace(/^0+(?=\d)/, ''), nome, ini, fim, sede: c.sede >= 0 ? String(l[c.sede] ?? '').trim() : '' });
        }
        return;
      }
      const tipo = tipoAtivo.startsWith('CURVA') ? 'C' : tipoAtivo.startsWith('TANGENTE') ? 'T' : '';
      const ini = n(l[c.ini]); const fim = n(l[c.fim]);
      if (!tipo) return;
      if (ini === null || fim === null || fim <= ini) { descartados++; return; }
      // "49/50 L1" → EH 49/50, linha 1
      const m = /^\s*([^\s]+)\s+L(\w+)\s*$/i.exec(String(l[c.ehLinha] ?? ''));
      const eh = m ? m[1] : String(l[c.ehLinha] ?? '').trim();
      const linha = m ? String(m[2]).replace(/^0+(?=\d)/, '') : '';
      const sentido = c.sentido >= 0 ? String(l[c.sentido] ?? '').trim().toUpperCase() : '';
      const num = c.elemento >= 0 ? (/(\d+)\s*$/.exec(String(l[c.elemento] ?? '')) || [])[1] || '' : '';
      elementos.push({
        ramal: ramalBruto.length > 2 && ramalBruto.startsWith('R') ? ramalBruto.slice(1) : ramalBruto, // RLT → LT
        linha,
        eh: eh.split('/')[0],
        nomeEh: `EH ${eh}`,
        tipo,
        lado: sentido.startsWith('E') ? 'E' : sentido.startsWith('D') ? 'D' : '',
        num,
        ini,
        fim,
        raio: c.raio >= 0 ? n(l[c.raio]) : null,
        superelevacao: null,
        sede: c.sede >= 0 ? String(l[c.sede] ?? '').trim() : ''
      });
    });
    if (!elementos.length) throw new Error('Nenhum elemento encontrado na geometria.');
    const ramais = {};
    elementos.forEach((e) => {
      ramais[e.ramal] = ramais[e.ramal] || [];
      if (!ramais[e.ramal].includes(e.linha)) ramais[e.ramal].push(e.linha);
    });
    Object.values(ramais).forEach((l) => l.sort());
    return {
      elementos, ramais, fonte: 'geometria', circuitos, rhs,
      avisos: descartados ? [`${descartados} linha(s) da geometria sem km válido foram ignoradas.`] : []
    };
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

  /** Correção do km no ponto i: um valor só ou um valor por ponto (correção variável). */
  const aj = (ajuste, i) => (typeof ajuste === 'number' ? ajuste : ajuste[i]);

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
      if (!Number.isNaN(suave[i])) amostras.push([pos[i], suave[i] <= -B.curvaturaDoRaio(o.raioCurva) ? 'E' : suave[i] >= B.curvaturaDoRaio(o.raioCurva) ? 'D' : 'T']);
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
    const [de, ate] = o.faixaAjuste || [-300, 300];
    [false, true].forEach((troca) => {
      for (let aj = de; aj <= ate; aj += 2) {
        const v = nota(aj, troca);
        if (v > melhor.acerto + 1e-9 || (Math.abs(v - melhor.acerto) < 1e-9 && Math.abs(aj) < Math.abs(melhor.ajuste))) melhor = { ajuste: aj, acerto: v, troca };
      }
    });
    for (let aj = melhor.ajuste - 2; aj <= melhor.ajuste + 2; aj += 0.5) {
      const v = nota(aj, melhor.troca);
      if (v > melhor.acerto + 1e-9) melhor = { ...melhor, ajuste: aj, acerto: v };
    }
    return { ajuste: melhor.ajuste, acerto: melhor.acerto < 0 ? null : melhor.acerto * 100, troca: melhor.troca };
  };

  /**
   * Correção do km ponto a ponto. O odômetro do carro escorrega aos poucos (dezenas de metros por km)
   * e o km é acertado à mão em campo (saltos). Uma correção única para o arquivo todo não serve.
   * 1. O arquivo é dividido onde o km salta (correção manual).
   * 2. Em cada parte, a correção inicial vem da comparação das curvas nos primeiros 3 km (−300 a +300 m).
   * 3. Cada curva medida (pelo raio) é casada com a curva da planta mais próxima do km previsto
   *    (até 100 m, mesmo lado, extensão parecida); a correção daquela curva = centro da planta − centro medido.
   * 4. Entre duas curvas casadas, a correção é interpolada; antes da primeira e depois da última, fica constante.
   * Retorna { ajustes: Float64Array, ancoras: [{ i, ajuste }], casadas, curvas, min, max }.
   */
  function ajusteVariavelBase(pos, curv, els, opcoes = {}) {
    const o = { ...B.PADRAO, ...opcoes };
    const n = pos.length;
    const ajustes = new Float64Array(n);
    if (!els.length || !n) return { ajustes, ancoras: [], casadas: 0, curvas: 0, min: 0, max: 0 };
    const esp = B.espacamento(pos) || 0.25;
    const curvasPlanta = els.filter((e) => e.tipo === 'C').map((e) => ({ c: (e.ini + e.fim) / 2, ext: e.fim - e.ini, lado: e.lado }));
    const medidas = B.segmentar(pos, curv, o).filter((e) => e.tipo === 'C');
    // partes entre saltos de km
    const partes = [];
    for (let i = 1, ini = 0; i <= n; i++) {
      if (i === n || !(Math.abs(pos[i] - pos[i - 1]) <= 5 * esp)) { partes.push([ini, i - 1]); ini = i; }
    }
    const ancoras = [];
    let casadas = 0; let total = 0;
    partes.forEach(([a, b]) => {
      if (b - a < 4) return;
      const doTrecho = medidas.filter((m) => m.i0 >= a && m.i1 <= b);
      total += doTrecho.length;
      // correção inicial: primeiros 3 km da parte
      const fimIni = Math.min(b, a + Math.round(3000 / esp));
      const ini = B.ajusteAutomatico(pos.subarray(a, fimIni + 1), curv.subarray(a, fimIni + 1), els, o);
      let atual = ini.ajuste;
      const troca = ini.troca;
      const anc = [];
      doTrecho.forEach((m) => {
        const centro = (m.ini + m.fim) / 2;
        const ext = Math.abs(m.fim - m.ini);
        let ladoMedido = m.lado; if (troca) ladoMedido = ladoMedido === 'D' ? 'E' : 'D';
        let melhor = null; let dMin = 100;
        for (const c of curvasPlanta) {
          const d = Math.abs(c.c - (centro + atual));
          if (d > dMin) continue;
          if (c.lado && ladoMedido && c.lado !== ladoMedido) continue;
          if (ext < c.ext * 0.5 || ext > c.ext * 2) continue;
          dMin = d; melhor = c;
        }
        if (!melhor) return;
        atual = melhor.c - centro;
        anc.push({ i: Math.round((m.i0 + m.i1) / 2), ajuste: atual });
        casadas++;
      });
      if (!anc.length) { ajustes.fill(ini.ajuste, a, b + 1); return; }
      for (let i = a; i <= b; i++) {
        if (i <= anc[0].i) { ajustes[i] = anc[0].ajuste; continue; }
        if (i >= anc[anc.length - 1].i) { ajustes[i] = anc[anc.length - 1].ajuste; continue; }
      }
      for (let k = 0; k < anc.length - 1; k++) {
        const p = anc[k]; const q = anc[k + 1];
        for (let i = p.i; i <= q.i; i++) ajustes[i] = p.ajuste + ((q.ajuste - p.ajuste) * (i - p.i)) / Math.max(1, q.i - p.i);
      }
      ancoras.push(...anc);
    });
    let min = Infinity; let max = -Infinity;
    ajustes.forEach((v) => { if (v < min) min = v; if (v > max) max = v; });
    return { ajustes, ancoras, casadas, curvas: total, min, max };
  }

  /**
   * Acertos do km na placa: o operador passa pela placa (ex.: 366+000) com o sistema marcando outro km
   * (366+015) e acerta o km. No arquivo aparece um salto ou volta de um ponto para o outro, caindo num km inteiro.
   * Candidato: um único passo fora do normal, de até ajustePlacaMax m, que cai num km inteiro (±0,5 m),
   * com o km andando normal logo depois. Retorna [{ i, delta }] (delta = quanto o km pulou além do passo normal).
   */
  B.acertosDePlaca = (pos, opcoes = {}) => {
    const max = opcoes.ajustePlacaMax ?? B.PADRAO.ajustePlacaMax;
    const n = pos.length;
    if (n < 10 || !max) return [];
    const esp = B.espacamento(pos) || 0.25;
    const sinal = pos[n - 1] < pos[0] ? -1 : 1;
    const normal = (i) => i > 0 && i < n && Math.abs(pos[i] - pos[i - 1] - sinal * esp) <= 0.6 * esp + 0.01;
    const out = [];
    for (let i = 1; i < n; i++) {
      if (normal(i)) continue;
      const delta = pos[i] - (pos[i - 1] + sinal * esp);
      if (Math.abs(delta) < 1 || Math.abs(delta) > max) continue;
      const resto = ((pos[i] % 1000) + 1000) % 1000;
      if (Math.min(resto, 1000 - resto) > 0.5) continue;
      let segue = true;
      for (let k = i + 1; k <= Math.min(n - 1, i + 8); k++) if (!normal(k)) segue = false;
      if (segue) out.push({ i, delta });
    }
    return out;
  };

  /** Identificação estável de um acerto (não muda com o recorte do arquivo): "km antes>km da placa". */
  B.chaveAcerto = (de, km) => `${Math.round(de * 100) / 100}>${Math.round(km * 100) / 100}`;

  /**
   * Km com os acertos de placa distribuídos no trecho anterior (desde o acerto anterior, a última quebra do km
   * ou o início do arquivo). Fator de escala do trecho: f = (L + Δ) / L, com L = distância medida pelo sistema
   * no trecho e Δ = diferença na placa. Faltou km (Δ > 0): o trecho estica; passou (Δ < 0): o trecho encolhe.
   * km'(j) = km(ref) + (km(j) − km(ref)) · f. O km depois do acerto é o da placa e não muda.
   */
  B.posComAcertos = (pos, acertos) => {
    const p = Float64Array.from(pos);
    const n = pos.length;
    if (!acertos.length) return p;
    const esp = B.espacamento(pos) || 0.25;
    const sinal = pos[n - 1] < pos[0] ? -1 : 1;
    const quebras = [];
    for (let i = 1; i < n; i++) if (Math.abs(pos[i] - pos[i - 1] - sinal * esp) > 5 * esp && !acertos.some((a) => a.i === i)) quebras.push(i);
    let ref = 0;
    [...acertos].sort((x, y) => x.i - y.i).forEach(({ i, delta }) => {
      quebras.forEach((q) => { if (q < i && q > ref) ref = q; });
      const L = pos[i - 1] + sinal * esp - pos[ref]; // distância (com sinal) que o sistema marcou até a placa
      if (Math.abs(L) < 1) { ref = i; return; }
      const f = (L + delta) / L;
      for (let j = ref; j < i; j++) p[j] = pos[ref] + (pos[j] - pos[ref]) * f;
      ref = i;
    });
    return p;
  };

  /**
   * Correção do km ponto a ponto pela geometria (ver ajusteVariavelBase).
   * Os acertos de km na placa são só identificados (placa: [{ i, km, de, delta, chave, confirmado, ref, L }]);
   * só entram no cálculo os que o usuário mandou tratar (opcoes.acertosPlaca = [chave, …]).
   * confirmado: a geometria indica que foi acerto (corrigindo só pelas curvas, o km da geometria quase não
   * pula naquele ponto: |pulo| ≤ máx(5 m, |Δ|/2)); senão pode ser falta de medição de verdade.
   */
  B.ajusteVariavel = (pos, curv, els, opcoes = {}) => {
    const candidatos = B.acertosDePlaca(pos, opcoes);
    const r0 = ajusteVariavelBase(pos, curv, els, opcoes);
    if (!candidatos.length || !els.length) return { ...r0, placa: [], aplicados: 0 };
    const esp = B.espacamento(pos) || 0.25;
    const sinal = pos[pos.length - 1] < pos[0] ? -1 : 1;
    const pedidos = new Set(opcoes.acertosPlaca || []);
    const placa = candidatos.map(({ i, delta }) => {
      const pulo = (pos[i] + r0.ajustes[i]) - (pos[i - 1] + r0.ajustes[i - 1]) - sinal * esp;
      const chave = B.chaveAcerto(pos[i - 1], pos[i]);
      return { i, km: pos[i], de: pos[i - 1], delta, chave, pulo, confirmado: Math.abs(pulo) <= Math.max(5, Math.abs(delta) / 2), tratado: pedidos.has(chave) };
    });
    // trecho onde a diferença seria distribuída (para mostrar antes de tratar)
    const n = pos.length; let ref = 0;
    const quebra = (i) => Math.abs(pos[i] - pos[i - 1] - sinal * esp) > 5 * esp;
    for (let i = 1, k = 0; i < n && k < placa.length; i++) {
      if (i === placa[k].i) { placa[k].ref = ref; placa[k].kmRef = pos[ref]; placa[k].L = pos[i - 1] + sinal * esp - pos[ref]; ref = i; k++; continue; }
      if (quebra(i)) ref = i;
    }
    const aplicar = placa.filter((x) => x.tratado);
    if (!aplicar.length) return { ...r0, placa, aplicados: 0 };
    const pc = B.posComAcertos(pos, aplicar);
    const r = ajusteVariavelBase(pc, curv, els, opcoes);
    // correção final em relação ao km do arquivo = acerto da placa + correção pela geometria
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < n; i++) {
      r.ajustes[i] += pc[i] - pos[i];
      if (r.ajustes[i] < min) min = r.ajustes[i];
      if (r.ajustes[i] > max) max = r.ajustes[i];
    }
    return { ...r, min, max, placa, aplicados: aplicar.length };
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
      if (!Number.isNaN(suave[i])) amostras.push([pos[i], abs(suave[i]) >= B.curvaturaDoRaio(o.raioCurva)]);
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
    for (let i = 0; i < n; i++) ref[i] = achar ? achar(i, pos[i] + aj(ajuste, i)) : naPlanta(els, pos[i] + aj(ajuste, i));
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
        const rh = nomes.rh((pos[p.i0] + pos[p.i1]) / 2 + aj(ajuste, (p.i0 + p.i1) >> 1));
        return { chave: `RH|${rh}`, tipo: 'X', eh: rh, trecho: rh, sigla: 'RH', nome: `${rh} (circuito)`, lado: '', raioPlanta: null };
      }
      const cont = new Map();
      for (let i = p.i0; i <= p.i1; i++) if (ref[i]) cont.set(ref[i], (cont.get(ref[i]) || 0) + 1);
      let el = null; let maior = 0;
      // prefere elemento do mesmo tipo do medido (curva medida → curva da planta)
      cont.forEach((q, e) => { const peso = q * (e.tipo === p.medido ? 1.5 : 1); if (peso > maior) { maior = peso; el = e; } });
      const numero = el.num ? String(el.num).padStart(2, '0') : '';
      const trecho = (el.nomeEh || nomes.eh(el.eh));
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
    const nomeProprio = {}; // geometria: o nome do EH vem pronto ("EH 01/03")
    els.forEach((e) => { if (e.nomeEh && !nomeProprio[e.eh]) nomeProprio[e.eh] = e.nomeEh; });
    return {
      eh: (eh) => nomeProprio[eh] || (eh === '' ? 'EH ?' : `EH ${eh}/${proximo[eh] || '?'}`),
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
    // Mesmo elemento em outra linha da planta (a coluna LINHA mudou no meio dele) continua o mesmo elemento.
    const chaveEl = (e) => (e ? `${e.eh}|${e.tipo}|${e.num}|${e.lado}` : '');
    for (let i = 0; i < n; i++) {
      const el = achar ? achar(i, pos[i] + aj(ajuste, i)) : naPlanta(els, pos[i] + aj(ajuste, i));
      if (!atual || chaveEl(atual.ref) !== chaveEl(el)) {
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
        const rh = nomes.rh((pos[s.i0] + pos[s.i1]) / 2 + aj(ajuste, (s.i0 + s.i1) >> 1));
        return { ...base, tipo: 'X', eh: rh, trecho: rh, sigla: 'RH', nome: `${rh} (circuito)`, lado: '', raioPlanta: null };
      }
      const numero = e.num ? String(e.num).padStart(2, '0') : '';
      const trecho = (e.nomeEh || nomes.eh(e.eh));
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
   * Só curvatura + locais: os elementos (curva/tangente, limites e numeração) são os da curvatura medida,
   * sem alteração. Para cada elemento, olha o km de cada ponto na planta (com a correção de km) e informa:
   *  - EH/RH onde está (o de mais pontos) e todos os EH/RH que ele atravessa;
   *  - o(s) elemento(s) da planta a que aquele km pertence (o de mais pontos primeiro, ex.: "C12 · T13").
   * RH = trecho sem elemento na planta com pelo menos 25 m (circuito): esses pontos saem das estatísticas.
   */
  B.localizarElementos = (elementos, pos, els, ajuste = 0, opcoes = {}, achar = null) => {
    const o = { ...B.PADRAO, ...opcoes };
    const n = pos.length;
    const esp = B.espacamento(pos) || 0.25;
    const nomes = B.nomesTrechos(els);
    const minRh = Math.max(o.comprimentoMin, 25);
    const ref = new Array(n);
    for (let i = 0; i < n; i++) ref[i] = achar ? achar(i, pos[i] + aj(ajuste, i)) : naPlanta(els, pos[i] + aj(ajuste, i));
    const noRh = new Uint8Array(n);
    for (let i = 0; i < n;) {
      if (ref[i]) { i++; continue; }
      let k = i;
      while (k + 1 < n && !ref[k + 1]) k++;
      if (abs(pos[k] - pos[i]) + esp >= minRh) noRh.fill(1, i, k + 1);
      i = k + 1;
    }
    const siglaPlanta = (e) => `${e.tipo}${e.num ? String(e.num).padStart(2, '0') : ''}`;
    elementos.forEach((e) => {
      const locais = new Map(); const plantaEls = new Map();
      for (let i = e.i0; i <= e.i1; i++) {
        const nome = noRh[i] ? nomes.rh(pos[i] + aj(ajuste, i)) : ref[i] ? (ref[i].nomeEh || nomes.eh(ref[i].eh)) : '';
        if (nome) locais.set(nome, (locais.get(nome) || 0) + 1);
        if (ref[i]) plantaEls.set(ref[i], (plantaEls.get(ref[i]) || 0) + 1);
      }
      const porQtd = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
      const loc = porQtd(locais);
      e.eh = loc.length ? loc[0][0] : '';
      e.rh = /^RH/.test(e.eh);
      // locais na ordem do arquivo (ex.: "EH 50/51 · RH-50")
      const ordem = [];
      for (let i = e.i0; i <= e.i1; i += Math.max(1, Math.round(5 / esp))) {
        const nome = noRh[i] ? nomes.rh(pos[i] + aj(ajuste, i)) : ref[i] ? (ref[i].nomeEh || nomes.eh(ref[i].eh)) : '';
        if (nome && ordem[ordem.length - 1] !== nome) ordem.push(nome);
      }
      e.trecho = ordem.join(' · ') || e.eh;
      const pl = porQtd(plantaEls);
      // só os elementos da planta com pelo menos 20% dos pontos (bordas de poucos metros não entram)
      const totalPl = pl.reduce((x, [, q]) => x + q, 0);
      e.elementoPlanta = pl.filter(([, q], k) => k === 0 || q >= totalPl * 0.2).map(([x]) => siglaPlanta(x))
        .filter((v, k, arr) => arr.indexOf(v) === k).join(' · ');
      const principal = pl.length ? pl[0][0] : null;
      e.lado = principal && principal.tipo === 'C' ? principal.lado : '';
      e.tipoPlanta = principal ? principal.tipo : '';
    });
    return { noRh };
  };

  /**
   * Análise completa: elementos, indicadores por elemento, por EH e gerais.
   * opcoes: raioCurva, suavizacao, curvaMin, tangenteMin, comprimentoMin, limitePerda, limiteVariacao, alinhamento (id),
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

    const temPlanta = !!(o.elementosPlanta && o.elementosPlanta.length);
    const modo = temPlanta && (o.modo === 'planta' || o.modo === 'hibrido') ? o.modo : 'curvatura';
    const usarPlanta = modo !== 'curvatura';
    let brutos;
    if (modo === 'planta') brutos = B.segmentarPorPlanta(pos, o.elementosPlanta, o.ajusteKm || 0, o.localizar || null);
    else if (modo === 'hibrido') brutos = B.segmentarHibrido(pos, dados.curv, o.elementosPlanta, o.ajusteKm || 0, o, o.localizar || null);
    else brutos = B.segmentar(pos, dados.curv, o);
    // Só curvatura com planta: os elementos não mudam; ganham EH/RH e o elemento da planta pelo km.
    const locais = modo === 'curvatura' && temPlanta ? B.localizarElementos(brutos, pos, o.elementosPlanta, o.ajusteKm || 0, o, o.localizar || null) : null;
    if (locais) {
      // Numeração dentro de cada EH/RH (como na planta): a 1ª curva do EH 11/12 é C01, não a 70ª do arquivo.
      let ehAtual = null; let cont = { T: 0, C: 0 };
      brutos.forEach((e) => {
        if (e.eh !== ehAtual) { ehAtual = e.eh; cont = { T: 0, C: 0 }; }
        cont[e.tipo] = (cont[e.tipo] || 0) + 1;
        const numero = String(cont[e.tipo]).padStart(2, '0');
        e.sigla = `${e.tipo}${numero}`;
        e.nome = `${e.tipo === 'T' ? 'Tangente' : 'Curva'} ${numero}`;
      });
    }
    // A linha mostrada é a da coluna LINHA do arquivo em cada trecho (só informativa).
    const elementos = brutos.map((e) => ({ ...e, linha: B.linhaDoTrecho(arquivo, e.i0, e.i1), ...resumoTrecho(dados, e.i0, e.i1, o, extras) }));
    // Circuitos (RH) ficam fora das estatísticas gerais (perda de bitola, OGMS × KLD, variação).
    const mascara = new Uint8Array(pos.length).fill(1);
    elementos.forEach((e) => { if (e.tipo === 'X') mascara.fill(0, e.i0, e.i1 + 1); });
    if (locais) {
      locais.noRh.forEach((v, i) => { if (v) mascara[i] = 0; });
      // elemento que passa por um circuito: as contagens dele também desconsideram os pontos no RH
      elementos.forEach((e) => {
        if (e.rh) return;
        const r = resumoTrecho(dados, e.i0, e.i1, o, { ...extras, mascara });
        if (r.pontos < e.pontos) Object.assign(e, { pontosTotal: e.pontos, perdasTotal: e.perdas, pontos: r.pontos, perdas: r.perdas, pctPerda: r.pctPerda });
      });
    }
    // Regra única do que entra na estatística: ponto de uma tangente ou curva (fora de circuito) e fora de RH.
    // Assim o geral é sempre a soma de tangentes + curvas, e a planilha de conferência mostra o mesmo.
    elementos.forEach((e) => { if (e.tipo === 'X' || e.rh) mascara.fill(0, e.i0, e.i1 + 1); });
    const coberto = new Uint8Array(pos.length);
    elementos.forEach((e) => coberto.fill(1, e.i0, e.i1 + 1));
    coberto.forEach((v, i) => { if (!v) mascara[i] = 0; });
    const geral = resumoTrecho(dados, 0, pos.length - 1, o, { ...extras, mascara });
    let foraRh = 0; mascara.forEach((v) => { if (!v) foraRh++; });
    const extensaoRh = foraRh * esp;

    // Totais = soma dos pontos dos elementos (mesma regra do geral) e quantos elementos perderam a bitola.
    const limiteElemento = o.limiteElemento ?? 10;
    elementos.forEach((e) => { e.perdeu = e.tipo !== 'X' && !e.rh && B.elementoPerdeu(e.pctPerda, limiteElemento); });
    const somar = (els) => {
      const soma = (k) => els.reduce((s, e) => s + (e[k] || 0), 0);
      const pontos = soma('pontos'); const perdas = soma('perdas');
      return {
        quantidade: els.length, extensao: soma('extensao'), pontos, perdas,
        pctPerda: pontos ? (perdas / pontos) * 100 : null,
        comPerda: els.filter((e) => e.perdeu).length
      };
    };

    // Resumo por trecho (EH e RH; com planta), na ordem da inspeção.
    const porEh = [];
    if (usarPlanta || locais) {
      elementos.forEach((e) => {
        let g = porEh.find((x) => x.eh === e.eh);
        if (!g) { g = { eh: e.eh, rh: e.tipo === 'X' || !!e.rh, linha: e.linha, els: [] }; porEh.push(g); }
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
      comLocais: usarPlanta || !!locais,
      mascara,
      esp,
      dados,
      elementos,
      porEh,
      geral: { ...geral, extensao: abs(pos[pos.length - 1] - pos[0]) + esp, extensaoRh },
      tangentes: somar(elementos.filter((e) => e.tipo === 'T' && !e.rh)), // elementos dentro de circuito não contam
      curvas: somar(elementos.filter((e) => e.tipo === 'C' && !e.rh)),
      difFT: B.diferenca(dados.bitF, dados.bitT),
      difKld: Float64Array.from(dados.bitF, (f, i) => (abs(dados.kld[i]) < KLD_MAX ? f - dados.kld[i] : NaN)),
      kldValido: Float64Array.from(dados.kld, (k) => (abs(k) < KLD_MAX ? k : NaN)),
      varF,
      varT,
      variacao
    };
  };

  /**
   * Dupla checagem (conferência independente): relê o texto original do CSV linha a linha, sem usar
   * a leitura nem os cálculos da análise, e recalcula com números inteiros (0,0001 mm, a resolução do arquivo):
   * pontos e pontos acima da regra de cada elemento (pela faixa de km dele) e do geral.
   * Compara com a análise e devolve as divergências.
   */
  /** "290", "290+500", "290,5" ou "290.5" → metros (290000, 290500…). Vazio ou inválido → null. */
  B.kmParaMetros = (t) => {
    const v = String(t ?? '').trim();
    if (!v) return null;
    const m = /^(\d+)\s*\+\s*(\d{1,3})$/.exec(v);
    if (m) return Number(m[1]) * 1000 + Number(m[2]);
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
  };

  /**
   * Só os pontos do arquivo com km dentro do trecho [de, ate] (metros; null = sem limite).
   * Serve para descartar o começo/fim do arquivo sem editar o CSV (o Excel altera os números ao salvar).
   */
  B.recortar = (arquivo, de, ate) => {
    if ((de === null || de === undefined) && (ate === null || ate === undefined)) return arquivo;
    const dentro = (p) => (de === null || de === undefined || p >= de) && (ate === null || ate === undefined || p <= ate);
    const manter = [];
    arquivo.pos.forEach((p, i) => { if (dentro(p)) manter.push(i); });
    const filtrar = (arr) => Float64Array.from(manter, (i) => arr[i]);
    const dados = {};
    Object.keys(arquivo.dados).forEach((k) => { dados[k] = filtrar(arquivo.dados[k]); });
    return {
      ...arquivo,
      pos: filtrar(arquivo.pos),
      dados,
      linhaIdx: arquivo.linhaIdx ? Uint16Array.from(manter, (i) => arquivo.linhaIdx[i]) : arquivo.linhaIdx,
      eventos: (arquivo.eventos || []).filter((e) => dentro(e.pos)),
      recorte: { de: de ?? null, ate: ate ?? null, descartados: arquivo.pos.length - manter.length }
    };
  };

  B.conferir = (texto, resultado, limite, faixa = null, offset = null) => {
    // Offset aplicado na análise: a conferência soma o mesmo valor na mesma bitola.
    const offF = offset && offset.aplicar && offset.bitola === 'bitF' ? Math.round((Number(offset.valor) || 0) * 10000) : 0;
    const offT = offset && offset.aplicar && offset.bitola === 'bitT' ? Math.round((Number(offset.valor) || 0) * 10000) : 0;
    const linhas = String(texto || '').split(/\r?\n/);
    let iF = -1; let iT = -1; let iKm = -1; let iLoc = -1;
    const norm = (x) => String(x || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const ler = (v) => {
      const t = String(v || '').trim();
      if (!t || t.includes('*')) return null;
      const n = parseFloat(t.replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n * 10000) : null; // décimos de milésimo de mm (inteiro, o arquivo tem 4 casas)
    };
    const pontos = [];
    for (const ln of linhas) {
      const c = ln.split(';');
      const tipo = (c[0] || '').trim();
      if (tipo === 'H' && iF < 0) {
        const cab = c.map(norm);
        iF = cab.indexOf('BITOLA F'); iT = cab.indexOf('BITOLA T'); iKm = cab.indexOf('KM'); iLoc = cab.indexOf('LOCALIZACAO');
        continue;
      }
      if (tipo !== 'D' || iF < 0) continue;
      const km = parseFloat(String(c[iKm]).replace(',', '.'));
      const loc = parseFloat(String(c[iLoc]).replace(',', '.'));
      if (!Number.isFinite(km) || !Number.isFinite(loc)) continue;
      const metros = km * 1000 + loc;
      if (faixa && ((faixa.de !== null && faixa.de !== undefined && metros < faixa.de) || (faixa.ate !== null && faixa.ate !== undefined && metros > faixa.ate))) continue;
      const f = ler(c[iF]); const t = ler(c[iT]);
      pontos.push({ m: Math.round((km * 1000 + loc) * 100), f: f === null ? null : f + offF, t: t === null ? null : t + offT });
    }
    // Mesma regra da análise, em inteiros: |F − T| arredondada a 0,01 mm > limite.
    // Arredondar a 0,01 mm e passar do limite ⇔ F − T ≥ limite + 0,005 (ou ≤ −(limite + 0,005), excluindo o meio exato).
    const limInt = Math.round(limite * 10000) + 50;
    const acimaDe = (d) => d >= limInt || d < -limInt;
    // Os elementos são conferidos pela posição de cada ponto no arquivo (ordem das linhas "D"),
    // e não pela faixa de km: o mesmo km pode aparecer mais de uma vez no arquivo (km corrigido
    // durante a inspeção, passagem pela outra linha…), e aí a faixa de km pegaria pontos de outro trecho.
    const contar = (i0, i1) => {
      let n = 0; let acima = 0;
      for (let i = i0; i <= i1 && i < pontos.length; i++) {
        const p = pontos[i];
        if (p.f === null || p.t === null) continue;
        n++;
        if (acimaDe(p.f - p.t)) acima++;
      }
      return { pontos: n, perdas: acima };
    };
    // Trechos onde o km volta ou se repete (informativo).
    const sentido = pontos.length > 1 && pontos[pontos.length - 1].m >= pontos[0].m ? 1 : -1;
    const voltas = [];
    for (let i = 1; i < pontos.length; i++) {
      if ((pontos[i].m - pontos[i - 1].m) * sentido < 0) voltas.push({ de: pontos[i - 1].m / 100, para: pontos[i].m / 100 });
    }
    const totalApp = resultado.dados ? resultado.dados.bitF.length : null;
    const divergencias = [];
    let somaPontos = 0; let somaPerdas = 0;
    resultado.elementos.forEach((e) => {
      const c = contar(e.i0, e.i1);
      const fora = e.tipo === 'X' || e.rh;
      // elemento que atravessa um circuito: confere o elemento inteiro (antes de tirar os pontos do RH)
      const anal = e.pontosTotal !== undefined ? { pontos: e.pontosTotal, perdas: e.perdasTotal } : { pontos: e.pontos, perdas: e.perdas };
      if (c.pontos !== anal.pontos || c.perdas !== anal.perdas) divergencias.push({ sigla: e.sigla, ini: e.ini, fim: e.fim, app: anal, conferido: c });
      if (!fora) { somaPontos += c.pontos; somaPerdas += c.perdas; }
    });
    return {
      ok: !divergencias.length && (totalApp === null || totalApp === pontos.length),
      linhas: pontos.length,
      linhasApp: totalApp,
      pontosElementos: somaPontos,
      perdasElementos: somaPerdas,
      voltas,
      divergencias
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
