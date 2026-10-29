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
    const nomes = B().nomesTrechos(els);
    // geometria com as RH (aba elementos_revia): usa as RH como estão nela, com o km de cada linha,
    // inclusive no início e no fim do ramal; sem elas (planta antiga), deduz pelos vãos entre elementos
    const rhsGeo = (planta.rhs || []).filter((x) => x.ramal === ramal && String(x.linha) === String(linha));
    if (rhsGeo.length) {
      const sedePerto = (x) => x.sede || (els.find((e) => e.ini >= x.fim - 1) || els[els.length - 1] || {}).sede || '';
      return [
        ...els.map((e) => ({ ini: e.ini, fim: e.fim, sede: e.sede || '', eh: e.nomeEh || `EH ${e.eh}`, tipo: e.tipo })),
        ...(incluirRH ? rhsGeo.map((x) => ({ ini: x.ini, fim: x.fim, sede: sedePerto(x), eh: x.eh ? `EH ${x.eh}` : '', tipo: 'RH', patio: true, nome: x.nome || nomes.rh((x.ini + x.fim) / 2) })) : [])
      ].sort((a, c) => a.ini - c.ini);
    }
    const out = [];
    els.forEach((e, k) => {
      const ant = els[k - 1];
      if (incluirRH && ant && e.ini - ant.fim > 0.5 && e.ini - ant.fim <= rhMax) {
        // pátio = vão entre dois EH diferentes (RH-43 entre o EH 42/43 e o EH 43/44)
        const patio = ant.eh !== e.eh;
        out.push({ ini: ant.fim, fim: e.ini, sede: e.sede || ant.sede || '', eh: e.nomeEh || `EH ${e.eh}`, tipo: 'RH', patio, nome: patio ? nomes.rh((ant.fim + e.ini) / 2) : '' });
      }
      out.push({ ini: e.ini, fim: e.fim, sede: e.sede || '', eh: e.nomeEh || `EH ${e.eh}`, tipo: e.tipo });
    });
    return out;
  };

  /**
   * Conferência da geometria: por ramal e linha, início, fim, extensão (tangentes + curvas + RH),
   * quantidades e sedes, para comparar com a planilha. rhDaGeometria = as RH vieram da própria geometria.
   */
  C.resumoGeometria = (planta) => Object.keys(planta.ramais).sort().flatMap((ramal) => planta.ramais[ramal].map((linha) => {
    const nec = C.necessario(planta, ramal, linha);
    const conta = (t) => nec.filter((x) => x.tipo === t).length;
    return {
      ramal, linha,
      ini: nec.length ? Math.min(...nec.map((x) => x.ini)) : null,
      fim: nec.length ? Math.max(...nec.map((x) => x.fim)) : null,
      extensao: C.extensao(C.uniao(nec.map((x) => [x.ini, x.fim]), 0.5)),
      tangentes: conta('T'), curvas: conta('C'), rh: conta('RH'),
      rhDaGeometria: (planta.rhs || []).some((x) => x.ramal === ramal && String(x.linha) === String(linha)),
      sedes: C.sedes(nec).map((x) => ({ sede: C.normSede(x.sede), ini: x.ini, fim: x.fim }))
    };
  }));

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
  /**
   * Versão do cálculo do resumo. Sobe quando o cálculo muda (ex.: 2 = LOCOM e correção da linha):
   * a Montagem recalcula sozinha, a partir do CSV guardado, os arquivos com versão anterior.
   */
  C.VERSAO_RESUMO = 2;

  C.resumirArquivo = (arquivoOriginal, planta, nome, opcoes = {}) => {
    const b = B();
    // valores da coluna LINHA como vieram do carro (para a tela de correção): pontos e km de cada valor
    const valoresLinha = C.valoresDaLinha(arquivoOriginal);
    // correção da linha feita na Montagem (valor trocado / linha num trecho de km)
    const arquivo = b.corrigirLinhas(arquivoOriginal, opcoes.linhas);
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
    const desloc = valores.map(b.ehDeslocamento); // LOCOM: carro em deslocamento, desconsiderado
    const cont = new Map();
    (arquivo.linhaIdx || []).forEach((k) => { if (validas[k]) cont.set(validas[k], (cont.get(validas[k]) || 0) + 1); });
    const linhaRef = [...cont.entries()].sort((a, c) => c[1] - a[1]).map(([l]) => l)[0] || (linhasPlanta.includes('1') ? '1' : linhasPlanta[0] || '1');
    const invalidas = valores.filter((v, k) => !validas[k] && !desloc[k]);
    if (invalidas.length) {
      let q = 0; (arquivo.linhaIdx || []).forEach((k) => { if (!validas[k] && !desloc[k]) q++; });
      avisar('alerta', `Coluna LINHA com valor que não é linha (${invalidas.join(', ')}) em ${q.toLocaleString('pt-BR')} pontos: considerada a linha ${linhaRef}. Corrija em "Linha do arquivo".`);
    }
    let qDesloc = 0; (arquivo.linhaIdx || []).forEach((k) => { if (desloc[k]) qDesloc++; });
    if (qDesloc) avisar('info', `${qDesloc.toLocaleString('pt-BR')} pontos em deslocamento (LINHA = LOCOM): desconsiderados na cobertura e nos alertas.`);
    // saltos/voltas pequenos do km: compensados só quando o usuário pede (botão "Compensar")
    const compensaveis = b.saltosCompensaveis(pos, opcoes.compensacao || {});
    const pedidos = new Set(opcoes.compensar || []);
    const aplicar = b.compensacoesPedidas(compensaveis, [...pedidos]);
    compensaveis.forEach((c) => { c.tratado = aplicar.some((x) => x.chave === c.chave); });
    const posC = aplicar.length ? b.compensarPos(pos, aplicar) : pos;
    // correção do km pela geometria (ponto a ponto), sobre o km já compensado
    const els = ramal ? b.elementosDaPlanta(planta, ramal, linhaRef) : [];
    const aj = els.length ? b.ajusteVariavel(posC, arquivo.dados.curv, els, opcoes) : { ajustes: new Float64Array(n), casadas: 0, curvas: 0, min: 0, max: 0 };
    if (aplicar.length) for (let i = 0; i < n; i++) aj.ajustes[i] += posC[i] - pos[i]; // correção total em relação ao km do arquivo
    if (els.length && aj.curvas && aj.casadas / aj.curvas < 0.7) avisar('alerta', `Só ${Math.round((aj.casadas / aj.curvas) * 100)}% das curvas casaram com a geometria: confira o ramal, a linha e o km.`);
    // inconsistências de km no arquivo
    const voltas = []; const saltos = []; let parados = 0;
    const sinal = n > 1 && pos[n - 1] < pos[0] ? -1 : 1; // arquivo em km decrescente
    const margem = (opcoes.compensacao && opcoes.compensacao.margem) ?? b.COMPENSACAO.margem;
    const candidato = new Set(compensaveis.map((c) => c.i));
    for (let i = 1; i < n; i++) {
      if (candidato.has(i)) continue; // listado à parte, com o botão Compensar
      const d = (pos[i] - pos[i - 1]) * sinal;
      const delta = d - esp;
      if (d === 0) parados++;
      else if (Math.abs(delta) <= margem) continue; // até 2 m: dentro da margem de erro
      else if (d < 0) voltas.push({ de: pos[i - 1], para: pos[i] });
      else if (delta > 0) saltos.push({ de: pos[i - 1], para: pos[i] });
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
      const kv = arquivo.linhaIdx ? arquivo.linhaIdx[i] : 0;
      const l = desloc[kv] ? b.DESLOCAMENTO : (validas[kv] || linhaRef);
      let li = linhas.indexOf(l); if (li < 0) { li = linhas.length; linhas.push(l); }
      amostras.pos[q] = pos[i]; amostras.aj[q] = aj.ajustes[i]; amostras.linha[q] = li; q++;
    };
    for (let i = 0; i < n; i += passo) amostrar(i);
    if (n && (n - 1) % passo) amostrar(n - 1);
    // parâmetros de geometria (alertas): em cada amostra, o valor de maior módulo dos pontos dela
    const geometria = {};
    C.PARAMETROS_GEOMETRIA.forEach((id) => {
      const v = arquivo.dados[id];
      if (!v) return;
      const g = new Float32Array(qtd).fill(NaN);
      for (let k = 0; k < qtd; k++) {
        const i0 = k * passo; const i1 = Math.min(n, i0 + passo);
        let m = NaN;
        for (let i = i0; i < i1; i++) if (!Number.isNaN(v[i]) && (Number.isNaN(m) || Math.abs(v[i]) > Math.abs(m))) m = v[i];
        g[k] = m;
      }
      geometria[id] = g;
    });
    return {
      versao: C.VERSAO_RESUMO,
      nome,
      meta: { ...meta },
      ramal,
      linhaRef,
      corretiva: C.normSede(meta.corretiva || ''),
      pontos: n,
      kmIni: pos[0], kmFim: pos[n - 1],
      correcao: { min: aj.min, max: aj.max, casadas: aj.casadas, curvas: aj.curvas },
      espacamento: esp,
      compensaveis: compensaveis.map(({ i, de, km, desde, delta, tipo, pontosFaltando, N, disponiveis, extensao, pct, cabe, porPonto, chave, tratado }) => ({ i, de, km, desde, delta, tipo, pontosFaltando, N, disponiveis, extensao, pct, cabe, porPonto, chave, tratado })),
      amostras,
      geometria,
      inconsistencias,
      valoresLinha
    };
  };

  /** Valores da coluna LINHA do arquivo: [{ valor, pontos, de, ate }] (km do arquivo), do mais frequente ao menos. */
  C.valoresDaLinha = (arquivo) => {
    const valores = arquivo.linhasValores || [String((arquivo.meta && arquivo.meta.linha) || '')];
    const st = valores.map((valor) => ({ valor, pontos: 0, de: Infinity, ate: -Infinity }));
    const idx = arquivo.linhaIdx;
    arquivo.pos.forEach((p, i) => {
      const x = st[idx ? idx[i] : 0];
      x.pontos++; if (p < x.de) x.de = p; if (p > x.ate) x.ate = p;
    });
    return st.filter((x) => x.pontos).sort((a, c) => c.pontos - a.pontos);
  };

  /** Volta as amostras para arrays tipados (quando o armazenamento as gravou como objeto/lista). */
  C.normalizarResumo = (r) => {
    const a = r.amostras;
    const tipar = (x, T) => (x instanceof T ? x : T.from(Array.isArray(x) ? x : Object.values(x || {})));
    r.amostras = { pos: tipar(a.pos, Float64Array), aj: tipar(a.aj, Float32Array), linha: tipar(a.linha, Uint8Array), linhas: a.linhas || [r.linhaRef] };
    Object.keys(r.geometria || {}).forEach((id) => { r.geometria[id] = tipar(r.geometria[id], Float32Array); });
    r.compensaveis = r.compensaveis || [];
    return r;
  };

  /* ---------------- Alertas de geometria ---------------- */

  /** Parâmetros de geometria com limite (sem bitola, sem alinhamento e sem variação de bitola). */
  C.PARAMETROS_GEOMETRIA = ['emp2', 'nl5', 'emp10', 'sup'];
  C.NOMES_GEOMETRIA = { emp2: 'EMP_2 (empeno em 2 m)', nl5: 'NLmax_5 (nivelamento)', emp10: 'EMP_10 (empeno em 10 m)', sup: 'SUPerABS (superelevação)' };

  /**
   * Trechos que passam dos limites, por arquivo e parâmetro, no km da geometria.
   * limites(id, 'C' | 'T') → [{ grau, nome, sup, inf }] (níveis de alerta da Tela do carro), ou [] sem limite.
   * Amostras seguidas acima do limite (até 3 m de folga) viram um alerta só, com o maior valor e o maior nível.
   * Retorna [{ arquivo, id, param, linha, ini, fim, kmArq, iArq, valor, limite, grau, nivel, eh, elemento, tipo }].
   */
  C.alertasGeometria = (planta, ramal, arquivos, limites) => {
    const out = [];
    arquivos.filter((a) => a.resumo.ramal === ramal).forEach((a) => {
      const r = a.resumo;
      const { pos, aj, linha, linhas } = r.amostras;
      const rc = a.recorte;
      // amostra k = ponto k × passo do arquivo (a última é o último ponto)
      const passo = Math.max(1, Math.round(1 / (r.espacamento || 0.25)));
      const pontoDa = (k) => (r.pontos ? Math.min(k * passo, r.pontos - 1) : k * passo);
      const porLinha = {};
      const elsDe = (l) => { if (!porLinha[l]) porLinha[l] = B().elementosDaPlanta(planta, ramal, l); return porLinha[l]; };
      const elemento = (els, y) => {
        let lo = 0; let hi = els.length - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (els[m].fim < y) lo = m + 1; else if (els[m].ini > y) hi = m - 1; else return els[m]; }
        return null;
      };
      C.PARAMETROS_GEOMETRIA.forEach((id) => {
        const v = r.geometria && r.geometria[id];
        if (!v) return;
        let atual = null;
        const fechar = () => { if (atual) out.push(atual); atual = null; };
        for (let k = 0; k < pos.length; k++) {
          const x = pos[k];
          if (rc && ((rc.de !== null && rc.de !== undefined && x < rc.de) || (rc.ate !== null && rc.ate !== undefined && x > rc.ate))) { fechar(); continue; }
          const val = v[k];
          if (Number.isNaN(val)) continue;
          const y = x + aj[k];
          const l = linhas[linha[k]];
          if (B().ehDeslocamento(l)) { fechar(); continue; } // deslocamento: sem alerta
          const el = elemento(elsDe(l), y);
          if (!el) continue; // fora de tangente/curva (circuito): sem limite
          const niveis = limites(id, el.tipo === 'C' ? 'C' : 'T') || [];
          let g = null;
          niveis.forEach((n) => { if (n && ((n.sup !== null && n.sup !== undefined && val > n.sup) || (n.inf !== null && n.inf !== undefined && val < n.inf)) && (!g || n.grau > g.grau)) g = n; });
          if (!g) { if (atual && Math.abs(y - atual.ultimo) > 3) fechar(); continue; }
          if (atual && (atual.linha !== l || Math.abs(y - atual.ultimo) > 3)) fechar();
          const limite = val > 0 ? g.sup : g.inf;
          if (!atual) {
            atual = { arquivo: a.nome, idArquivo: a.id, id, param: C.NOMES_GEOMETRIA[id], linha: l, ini: y, fim: y, kmArq: x, iArq: pontoDa(k), valor: val, limite, grau: g.grau, nivel: g.nome, eh: el.nomeEh || `EH ${el.eh}`, elemento: `${el.tipo === 'C' ? 'C' : 'T'}${String(el.num || '').padStart(2, '0')}`, tipo: el.tipo, ultimo: y };
          } else {
            atual.ini = Math.min(atual.ini, y); atual.fim = Math.max(atual.fim, y); atual.ultimo = y;
            if (Math.abs(val) > Math.abs(atual.valor)) { atual.valor = val; atual.limite = limite; atual.kmArq = x; atual.iArq = pontoDa(k); }
            if (g.grau > atual.grau) { atual.grau = g.grau; atual.nivel = g.nome; }
          }
        }
        fechar();
      });
    });
    return out.map(({ ultimo, ...x }) => x).sort((p, q) => q.grau - p.grau || p.linha.localeCompare(q.linha) || p.ini - q.ini);
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
      if (B().ehDeslocamento(l)) { fechar(); continue; } // carro em deslocamento: não conta como medido
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
          sobreposicoes: sobreposicoes.filter((o) => o.sede === s.sede),
          rh: s.trechos.filter((t) => t.tipo === 'RH' && t.patio).map((t) => ({ ini: t.ini, fim: t.fim, nome: t.nome }))
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
      return { linha, necessario: necT, coberto: cobT, pct: necT ? (cobT / necT) * 100 : 0, sedes, buracos, sobreposicoes, fronteiras };
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
