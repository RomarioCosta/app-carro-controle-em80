/*
 * Montagem dos dados: cobertura dos arquivos do carro em relação à geometria da linha.
 * Funções puras (sem tela), para testar:
 *  - o que precisa ser medido (geometria: tangentes, curvas e circuitos entre elas), por ramal, linha e sede;
 *  - o que cada arquivo cobre (km corrigido pela geometria, ponto a ponto);
 *  - buracos, sobreposições entre arquivos e inconsistências de km de cada arquivo.
 */
'use strict';

(function (App) {
  const C = {};
  const B = () => App.bitola;

  /** "GV I" → "GV1", "NE II" → "NE2", "gv1" → "GV1", "PV" → "PV". */
  C.normSede = (s) => {
    const romanos = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
    const t = String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const m = /^([A-Z]+)\s*(I{1,3}|IV|V|\d+)?$/.exec(t);
    if (!m) return t.replace(/\s/g, '');
    const n = m[2] ? (romanos[m[2]] || Number(m[2])) : '';
    return `${m[1]}${n}`;
  };

  /* ---------------- Intervalos [ini, fim] em metros ---------------- */

  /** União de intervalos; junta os que estão a até "folga" m um do outro. */
  C.uniao = (lista, folga = 0) => {
    const ord = lista.filter((x) => x[1] >= x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    ord.forEach((x) => {
      const u = out[out.length - 1];
      if (u && x[0] <= u[1] + folga) u[1] = Math.max(u[1], x[1]);
      else out.push(x);
    });
    return out;
  };
  /** a − b (ambos já unidos). */
  C.subtrair = (a, b) => {
    const out = [];
    a.forEach(([i0, f0]) => {
      let ini = i0;
      b.forEach(([i1, f1]) => {
        if (f1 < ini || i1 > f0) return;
        if (i1 > ini) out.push([ini, Math.min(i1, f0)]);
        ini = Math.max(ini, f1);
      });
      if (ini < f0) out.push([ini, f0]);
    });
    return out.filter((x) => x[1] - x[0] > 1e-6);
  };
  C.interseccao = (a, b) => {
    const out = [];
    a.forEach(([i0, f0]) => b.forEach(([i1, f1]) => { const i = Math.max(i0, i1); const f = Math.min(f0, f1); if (f > i) out.push([i, f]); }));
    return C.uniao(out);
  };
  C.extensao = (lista) => lista.reduce((s, x) => s + (x[1] - x[0]), 0);

  /* ---------------- O que precisa ser medido ---------------- */

  /**
   * Trechos necessários de um ramal e linha, pela geometria: cada tangente e curva, e os circuitos (RH)
   * entre elas (vão de até "rhMax" m entre dois elementos). Retorna [{ ini, fim, sede, eh, tipo }] em ordem.
   */
  C.necessario = (planta, ramal, linha, { rhMax = 1000, incluirRH = true } = {}) => {
    const els = B().elementosDaPlanta(planta, ramal, linha);
    const nomeEh = (e) => e.nomeEh || `EH ${e.eh}`;
    const out = els.map((e) => ({ ini: e.ini, fim: e.fim, sede: e.sede || '', eh: nomeEh(e), tipo: e.tipo, lado: e.lado || '', num: e.num || '', raio: e.raio || null }));
    if (incluirRH) {
      // circuitos da geometria (linhas RH, com o km); sem elas, o vão de até rhMax entre dois elementos
      const rhs = (planta.rhs || []).filter((r) => r.ramal === ramal && String(r.linha) === String(linha));
      rhs.forEach((r) => {
        const depois = els.find((e) => e.ini >= r.fim - 1) || els[els.length - 1];
        out.push({ ini: r.ini, fim: r.fim, sede: r.sede || (depois && depois.sede) || '', eh: r.nome, tipo: 'RH', lado: '', num: '', curva: !!r.raio, raio: r.raio || null });
      });
      els.forEach((e, k) => {
        const ant = els[k - 1];
        if (!ant || e.ini - ant.fim <= 0.5 || e.ini - ant.fim > rhMax) return;
        if (rhs.some((r) => r.fim > ant.fim && r.ini < e.ini)) return;
        out.push({ ini: ant.fim, fim: e.ini, sede: e.sede || ant.sede || '', eh: `RH antes do ${nomeEh(e)}`, tipo: 'RH', lado: '', num: '' });
      });
    }
    return out.sort((x, y) => x.ini - y.ini);
  };

  /** Sedes (corretivas) de um ramal e linha, em ordem de km: [{ sede, ini, fim, trechos }]. */
  C.sedes = (necessario) => {
    const out = [];
    necessario.forEach((t) => {
      const u = out[out.length - 1];
      if (u && u.sede === t.sede) { u.fim = Math.max(u.fim, t.fim); u.trechos.push(t); } else out.push({ sede: t.sede, ini: t.ini, fim: t.fim, trechos: [t] });
    });
    return out;
  };

  /* ---------------- O que cada arquivo cobre ---------------- */

  /**
   * Resumo de um arquivo do carro para a montagem (não guarda o arquivo inteiro):
   * amostras a cada ~1 m com o km do arquivo, a correção do km pela geometria e a linha; e as inconsistências.
   */
  C.resumirArquivo = (arquivo, planta, nome, opcoes = {}) => {
    const b = B();
    const { pos, meta } = arquivo;
    const n = pos.length;
    const esp = b.espacamento(pos) || 0.25;
    const ramal = b.ramalDaPlanta(meta.ramal, planta.ramais);
    const inconsistencias = [];
    const avisar = (tipo, texto, km = null) => inconsistencias.push({ tipo, texto, km });
    if (!ramal) avisar('erro', `Ramal do arquivo (${meta.ramal || '—'}) não existe na geometria.`);
    const linhasPlanta = ramal ? (planta.ramais[ramal] || []).map(String) : [];
    // linha de cada ponto: coluna LINHA; valor que não é linha (ex.: TESTE01) → a linha válida mais frequente
    const valores = arquivo.linhasValores || [String(meta.linha || '')];
    const validas = valores.map((v) => b.linhaDaPlanta(v, linhasPlanta));
    const cont = new Map();
    (arquivo.linhaIdx || []).forEach((k) => { if (validas[k]) cont.set(validas[k], (cont.get(validas[k]) || 0) + 1); });
    const linhaRef = [...cont.entries()].sort((a, c) => c[1] - a[1]).map(([l]) => l)[0] || (linhasPlanta.includes('1') ? '1' : linhasPlanta[0] || '1');
    const invalidas = valores.filter((v, k) => !validas[k]);
    if (invalidas.length) {
      let q = 0; (arquivo.linhaIdx || []).forEach((k) => { if (!validas[k]) q++; });
      avisar('alerta', `Coluna LINHA com valor que não é linha (${invalidas.join(', ')}) em ${q.toLocaleString('pt-BR')} pontos: considerada a linha ${linhaRef}.`);
    }
    // correção do km pela geometria (ponto a ponto)
    const els = ramal ? b.elementosDaPlanta(planta, ramal, linhaRef) : [];
    const aj = els.length ? b.ajusteVariavel(pos, arquivo.dados.curv, els, opcoes) : { ajustes: new Float64Array(n), casadas: 0, curvas: 0, min: 0, max: 0 };
    if (els.length && aj.curvas && aj.casadas / aj.curvas < 0.7) avisar('alerta', `Só ${Math.round((aj.casadas / aj.curvas) * 100)}% das curvas casaram com a geometria: confira o ramal, a linha e o km.`);
    // inconsistências de km no arquivo
    const voltas = []; const saltos = []; let parados = 0;
    const sinal = n > 1 && pos[n - 1] < pos[0] ? -1 : 1; // arquivo em km decrescente
    const placa = aj.placa || [];
    const candidatoEm = new Set(placa.map((x) => x.i));
    for (let i = 1; i < n; i++) {
      if (candidatoEm.has(i)) continue; // possíveis acertos de placa: listados à parte, com botão para tratar
      const d = (pos[i] - pos[i - 1]) * sinal;
      if (d === 0) parados++;
      else if (d < -1) voltas.push({ de: pos[i - 1], para: pos[i] });
      else if (d > Math.max(5, 20 * esp)) saltos.push({ de: pos[i - 1], para: pos[i] });
    }
    const fmt = b.fmtKm;
    voltas.forEach((v) => avisar('alerta', `Km volta de ${fmt(v.de)} para ${fmt(v.para)} (${Math.round(Math.abs(v.de - v.para))} m medidos de novo).`, v.de));
    saltos.forEach((v) => avisar('alerta', `Km salta de ${fmt(v.de)} para ${fmt(v.para)} (${Math.round(Math.abs(v.para - v.de))} m sem medição no arquivo).`, v.de));
    if (parados > 40) avisar('info', `${parados.toLocaleString('pt-BR')} pontos com o km parado (carro parado).`);
    (arquivo.avisos || []).forEach((t) => avisar('alerta', t));
    if (!(arquivo.eventos || []).some((e) => !e.ex)) avisar('info', 'Arquivo sem eventos (linhas "E").');
    // amostras a cada ~1 m (o suficiente para a cobertura e para recortar depois)
    const passo = Math.max(1, Math.round(1 / esp));
    const qtd = n ? Math.ceil(n / passo) + ((n - 1) % passo ? 1 : 0) : 0;
    const linhas = [linhaRef];
    const amostras = { pos: new Float64Array(qtd), aj: new Float32Array(qtd), linha: new Uint8Array(qtd), linhas };
    let q = 0;
    const amostrar = (i) => {
      const l = validas[arquivo.linhaIdx ? arquivo.linhaIdx[i] : 0] || linhaRef;
      let li = linhas.indexOf(l); if (li < 0) { li = linhas.length; linhas.push(l); }
      amostras.pos[q] = pos[i]; amostras.aj[q] = aj.ajustes[i]; amostras.linha[q] = li; q++;
    };
    for (let i = 0; i < n; i += passo) amostrar(i);
    if (n && (n - 1) % passo) amostrar(n - 1);
    // curvas medidas pelo raio (para a contagem por EH), já no km da geometria
    const curvas = n > 10 ? b.segmentar(pos, arquivo.dados.curv, opcoes).filter((e) => e.tipo === 'C').map((e) => {
      const g0 = pos[e.i0] + aj.ajustes[e.i0]; const g1 = pos[e.i1] + aj.ajustes[e.i1];
      return { ini: Math.min(g0, g1), fim: Math.max(g0, g1), lado: e.lado, linha: validas[arquivo.linhaIdx ? arquivo.linhaIdx[Math.round((e.i0 + e.i1) / 2)] : 0] || linhaRef, kmArq: pos[e.i0] };
    }) : [];
    return {
      nome,
      meta: { ...meta },
      ramal,
      linhaRef,
      corretiva: C.normSede(meta.corretiva || ''),
      pontos: n,
      kmIni: pos[0], kmFim: pos[n - 1],
      correcao: { min: aj.min, max: aj.max, casadas: aj.casadas, curvas: aj.curvas },
      placa: placa.map(({ i, km, de, delta, chave, pulo, confirmado, tratado, kmRef, L }) => ({ i, km, de, delta, chave, pulo, confirmado, tratado, kmRef, L })),
      curvas,
      amostras,
      inconsistencias
    };
  };

  /** Volta as amostras para arrays tipados (quando o armazenamento as gravou como objeto/lista). */
  C.normalizarResumo = (r) => {
    const a = r.amostras;
    const tipar = (x, T) => (x instanceof T ? x : T.from(Array.isArray(x) ? x : Object.values(x || {})));
    r.amostras = { pos: tipar(a.pos, Float64Array), aj: tipar(a.aj, Float32Array), linha: tipar(a.linha, Uint8Array), linhas: a.linhas || [r.linhaRef] };
    return r;
  };

  /** Intervalos cobertos por um arquivo resumido, por linha, já no km da geometria. recorte = { de, ate } no km do arquivo. */
  C.coberturaDoArquivo = (r, recorte = null, folga = 3) => {
    const { pos, aj, linha, linhas } = r.amostras;
    const porLinha = {};
    let atual = null;
    const fechar = () => { if (atual && atual.f > atual.i) (porLinha[atual.l] = porLinha[atual.l] || []).push([atual.i, atual.f]); atual = null; };
    for (let k = 0; k < pos.length; k++) {
      const p = pos[k];
      if (recorte && ((recorte.de !== null && recorte.de !== undefined && p < recorte.de) || (recorte.ate !== null && recorte.ate !== undefined && p > recorte.ate))) { fechar(); continue; }
      const g = p + aj[k];
      const l = linhas[linha[k]];
      if (atual && atual.l === l && Math.abs(g - atual.ult) <= folga) {
        atual.i = Math.min(atual.i, g); atual.f = Math.max(atual.f, g); atual.ult = g;
      } else { fechar(); atual = { l, i: g, f: g, ult: g }; }
    }
    fechar();
    Object.keys(porLinha).forEach((l) => { porLinha[l] = C.uniao(porLinha[l], folga); });
    return porLinha;
  };

  /* ---------------- Montagem: buracos e sobreposições ---------------- */

  /**
   * arquivos: [{ id, nome, resumo, recorte }]. Retorna por linha do ramal:
   * { linha, necessario (m), coberto (m), pct, sedes: [{ sede, necessario, coberto, pct, buracos, arquivos }],
   *   buracos: [{ ini, fim, sede, eh }], sobreposicoes: [{ ini, fim, arquivos }] }.
   */
  C.montar = (planta, ramal, arquivos, { toleranciaBuraco = 5, incluirRH = true, rhMax = 1000 } = {}) => {
    const linhas = (planta.ramais[ramal] || []).map(String);
    const cob = arquivos.filter((a) => a.resumo.ramal === ramal).map((a) => ({ a, porLinha: C.coberturaDoArquivo(a.resumo, a.recorte) }));
    return linhas.map((linha) => {
      const nec = C.necessario(planta, ramal, linha, { incluirRH, rhMax });
      const necU = C.uniao(nec.map((t) => [t.ini, t.fim]), 0.5);
      const doArquivo = cob.map((c) => ({ a: c.a, iv: C.interseccao(c.porLinha[linha] || [], necU) })).filter((c) => c.iv.length);
      const cobertos = C.uniao(doArquivo.flatMap((c) => c.iv), toleranciaBuraco);
      const buracosBrutos = C.subtrair(necU, cobertos).filter((x) => x[1] - x[0] > toleranciaBuraco);
      const ondeEsta = (p) => nec.find((t) => p >= t.ini && p <= t.fim) || nec.reduce((m, t) => (Math.abs((t.ini + t.fim) / 2 - p) < Math.abs((m.ini + m.fim) / 2 - p) ? t : m), nec[0]);
      const buracos = buracosBrutos.map(([ini, fim]) => {
        const t = ondeEsta((ini + fim) / 2) || {};
        const antes = doArquivo.filter((c) => c.iv.some((x) => Math.abs(x[1] - ini) <= toleranciaBuraco)).map((c) => c.a.nome);
        const depois = doArquivo.filter((c) => c.iv.some((x) => Math.abs(x[0] - fim) <= toleranciaBuraco)).map((c) => c.a.nome);
        return { ini, fim, sede: t.sede || '', eh: t.eh || '', antes, depois };
      });
      // sobreposições: trechos cobertos por dois ou mais arquivos
      const sobreposicoes = [];
      for (let x = 0; x < doArquivo.length; x++) {
        for (let y = x + 1; y < doArquivo.length; y++) {
          C.interseccao(doArquivo[x].iv, doArquivo[y].iv).filter((s) => s[1] - s[0] > toleranciaBuraco)
            .forEach(([ini, fim]) => sobreposicoes.push({ ini, fim, arquivos: [doArquivo[x].a.nome, doArquivo[y].a.nome], sede: (ondeEsta((ini + fim) / 2) || {}).sede || '' }));
        }
      }
      const sedes = C.sedes(nec).map((s) => {
        const faixa = C.uniao(s.trechos.map((t) => [t.ini, t.fim]), 0.5);
        const necS = C.extensao(faixa);
        const cobS = C.extensao(C.interseccao(faixa, cobertos));
        const arqs = doArquivo.filter((c) => C.interseccao(c.iv, faixa).length).map((c) => c.a.nome);
        return {
          sede: s.sede, ini: s.ini, fim: s.fim, necessario: necS, coberto: cobS, pct: necS ? (cobS / necS) * 100 : 0,
          buracos: buracos.filter((b) => b.sede === s.sede), arquivos: arqs,
          cobertos: C.interseccao(faixa, cobertos),
          sobreposicoes: sobreposicoes.filter((o) => o.sede === s.sede)
        };
      });
      // divisa entre sedes vizinhas (ex.: GV1 → GV2): o arquivo de uma tem que encostar no da outra, sem buraco
      const contem = (iv, p) => iv.some((x) => x[0] <= p + toleranciaBuraco && x[1] >= p - toleranciaBuraco);
      const fronteiras = sedes.slice(1).map((s, k) => {
        const ant = sedes[k];
        if (s.ini - ant.fim > rhMax) return null; // sedes que não se encostam nesta linha
        const km = s.ini;
        const arqs = doArquivo.filter((c) => contem(c.iv, km)).map((c) => c.a.nome);
        const coberta = contem(cobertos, km);
        // buraco: há arquivo terminando perto da divisa (até 2 km) mas sem encostar no vizinho
        const perto = C.interseccao(cobertos, [[km - 2000, km + 2000]]).length > 0;
        const situacao = coberta ? 'ok' : (perto ? 'buraco' : 'pendente');
        return { km, de: ant.sede, para: s.sede, coberta, situacao, arquivos: arqs };
      }).filter(Boolean);
      const necT = C.extensao(necU); const cobT = C.extensao(C.interseccao(necU, cobertos));
      const medidas = cob.flatMap((c) => C.curvasDoArquivo(c.a, linha));
      const contagem = C.contagem(nec, cobertos, medidas);
      return { linha, necessario: necT, coberto: cobT, pct: necT ? (cobT / necT) * 100 : 0, sedes, buracos, sobreposicoes, fronteiras, contagem };
    });
  };

  /** Curvas medidas (pelo raio) de um arquivo numa linha, respeitando o recorte do arquivo. */
  C.curvasDoArquivo = (a, linha) => {
    const rc = a.recorte;
    return (a.resumo.curvas || []).filter((c) => String(c.linha) === String(linha)
      && !(rc && ((rc.de !== null && rc.de !== undefined && c.kmArq < rc.de) || (rc.ate !== null && rc.ate !== undefined && c.kmArq > rc.ate))))
      .map((c) => ({ ini: c.ini, fim: c.fim, lado: c.lado, arquivo: a.nome }));
  };

  /**
   * Contagem e conferência por EH e RH: elementos da geometria × o que os arquivos mediram.
   * Curva da geometria "casada" = alguma curva medida pelo raio cobre ≥ 50% dela (ou ela cobre ≥ 50% da medida).
   * Retorna [{ nome, tipo: 'EH'|'RH', sede, ini, fim, tangentes, curvas, necessario, coberto, pct,
   *   medidas, casadas, naoDetectadas: [curva], aMais: [medida], semLeitura, situacao, itens }].
   */
  C.contagem = (nec, cobertos, medidas) => {
    // medidas de arquivos que se sobrepõem viram uma só
    const unicas = C.uniao(medidas.map((m) => [m.ini, m.fim]), 0).map(([ini, fim]) => ({ ini, fim }));
    const grupos = [];
    nec.forEach((t) => {
      const tipo = t.tipo === 'RH' ? 'RH' : 'EH';
      const u = grupos[grupos.length - 1];
      if (u && tipo === 'EH' && u.tipo === 'EH' && u.nome === t.eh) { u.trechos.push(t); u.fim = Math.max(u.fim, t.fim); } else grupos.push({ nome: t.eh, tipo, sede: t.sede, ini: t.ini, fim: t.fim, trechos: [t] });
    });
    const sobre = (a, b) => Math.max(0, Math.min(a.fim, b.fim) - Math.max(a.ini, b.ini));
    return grupos.map((g) => {
      const faixa = C.uniao(g.trechos.map((t) => [t.ini, t.fim]), 0.5);
      const necessario = C.extensao(faixa);
      const coberto = C.extensao(C.interseccao(faixa, cobertos));
      const pct = necessario ? (coberto / necessario) * 100 : 0;
      // curvas esperadas: as da geometria; numa RH, uma curva quando a geometria dá o raio dela
      const curvasGeo = g.trechos.filter((t) => t.tipo === 'C' || (t.tipo === 'RH' && t.curva));
      const meio = (m) => (m.ini + m.fim) / 2;
      const medidasG = unicas.filter((m) => meio(m) >= g.ini && meio(m) < g.fim);
      const casa = (c, m) => { const o = sobre(c, m); return o >= 0.5 * (c.fim - c.ini) || o >= 0.5 * (m.fim - m.ini); };
      // um para um: cada curva medida casa com uma curva da geometria (a de maior sobreposição)
      const usadas = new Set();
      const pares = [];
      curvasGeo.forEach((c, k) => medidasG.forEach((m, q) => { if (casa(c, m)) pares.push({ k, q, o: sobre(c, m) }); }));
      pares.sort((x, y) => y.o - x.o);
      const parDe = new Map();
      pares.forEach(({ k, q }) => { if (!parDe.has(k) && !usadas.has(q)) { parDe.set(k, q); usadas.add(q); } });
      const itens = curvasGeo.map((c, k) => {
        const ext = c.fim - c.ini;
        const lido = C.extensao(C.interseccao([[c.ini, c.fim]], cobertos));
        const par = parDe.has(k) ? medidasG[parDe.get(k)] : null;
        const tocada = !par && medidasG.some((m) => sobre(c, m) > 0);
        const situacao = par ? 'casada' : lido < 0.9 * ext ? 'sem leitura' : tocada ? 'unida' : 'nao detectada';
        return { ini: c.ini, fim: c.fim, lado: c.lado, num: c.num, raio: c.raio, rh: c.tipo === 'RH', medida: par || null, situacao };
      });
      const aMais = medidasG.filter((m, q) => !usadas.has(q) && !curvasGeo.some((c) => sobre(c, m) > 0));
      const naoDetectadas = itens.filter((x) => x.situacao === 'nao detectada' || x.situacao === 'unida');
      const casadas = itens.filter((x) => x.situacao === 'casada').length;
      const situacao = coberto === 0 ? 'sem arquivo' : pct < 99.5 ? 'incompleto' : naoDetectadas.length || aMais.length || medidasG.length !== curvasGeo.length ? 'divergente' : 'ok';
      return {
        nome: g.nome, tipo: g.tipo, sede: g.sede, ini: g.ini, fim: g.fim,
        tangentes: g.trechos.filter((t) => t.tipo === 'T').length, curvas: curvasGeo.length,
        unidas: itens.filter((x) => x.situacao === 'unida').length,
        necessario, coberto, pct, medidas: medidasG.length, casadas, naoDetectadas, aMais,
        semLeitura: itens.filter((x) => x.situacao === 'sem leitura').length, situacao, itens
      };
    });
  };

  /**
   * Onde cada arquivo caiu na geometria: [{ id, nome, trechos: [{ linha, sede, m }], avisos }].
   * Avisa quando a corretiva do arquivo não é a sede onde ele caiu, ou quando ele não cai em nada da geometria.
   */
  C.conferirArquivos = (planta, arquivos) => arquivos.map((a) => {
    const r = a.resumo;
    const avisos = [];
    if (!r.ramal) return { id: a.id, nome: a.nome, trechos: [], avisos };
    const porLinha = C.coberturaDoArquivo(r, a.recorte);
    const trechos = [];
    Object.entries(porLinha).forEach(([linha, iv]) => {
      const sedes = C.sedes(C.necessario(planta, r.ramal, linha));
      sedes.forEach((s) => {
        const m = C.extensao(C.interseccao(iv, C.uniao(s.trechos.map((t) => [t.ini, t.fim]), 0.5)));
        if (m >= 50) trechos.push({ linha, sede: s.sede, m });
      });
    });
    if (!trechos.length) avisos.push({ tipo: 'erro', texto: 'O arquivo não cai em nenhum trecho da geometria (confira ramal, linha e km).' });
    const total = trechos.reduce((x, t) => x + t.m, 0);
    if (r.corretiva && trechos.length) {
      const daSede = trechos.filter((t) => C.normSede(t.sede) === r.corretiva).reduce((x, t) => x + t.m, 0);
      if (daSede / total < 0.5) {
        const onde = [...new Set(trechos.sort((x, y) => y.m - x.m).map((t) => t.sede))].join(', ');
        avisos.push({ tipo: 'alerta', texto: `Corretiva do arquivo é ${r.corretiva}, mas o trecho medido é da sede ${onde}.` });
      }
    }
    return { id: a.id, nome: a.nome, trechos, avisos };
  });

  App.cobertura = C;
})(window.App);
