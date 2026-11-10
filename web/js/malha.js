/*
 * Malha ferroviária para a Rota do carro controle, montada a partir da planta da linha.
 * A ferrovia alterna EH (entre pátios) e RH (pátio): EH 49/50 → RH-50 → EH 50/51…
 * Cada ramal vira uma sequência de unidades (EH e RH) em ordem de km, com as linhas (L1, L2…) de cada uma.
 * Funções puras (sem tela) para facilitar testes.
 */
'use strict';

(function (App) {
  const M = {};

  M.NOMES_RAMAL = {
    LT: 'Linha Tronco',
    FA: 'Ramal de Fábrica',
    BH: 'Ramal de BH',
    IT: 'Ramal de Itabira',
    TU: 'Pátio de Tubarão',
    AZ: 'Ramal AZ',
    OB: 'Ramal de OB'
  };
  M.ORDEM_RAMAL = ['LT', 'FA', 'BH', 'IT', 'TU', 'OB', 'AZ'];
  const GAP_RH = 30; // metros: intervalo entre EHs a partir do qual existe um pátio (RH)

  const numero = (eh) => (/^\d+$/.test(String(eh)) ? Number(eh) : NaN);
  M.fmtKm = (m) => {
    if (!Number.isFinite(m)) return '';
    const r = Math.round(m);
    return `${Math.floor(r / 1000)}+${String(r % 1000).padStart(3, '0')}`;
  };

  /**
   * Monta a malha. planta = { elementos: [{ ramal, linha, eh, ini, fim }] } (ini/fim em metros).
   * Retorna { ramais: [{ ramal, nome, linhas, unidades: [{ id, tipo, rotulo, curto, eh, ini, fim, linhas }] }] }.
   */
  M.montar = (planta) => {
    const rhs = (planta && planta.rhs) || [];
    const porRamal = new Map();
    (planta && planta.elementos ? planta.elementos : []).forEach((e) => {
      if (!e.ramal || e.eh === '' || e.eh === null || e.eh === undefined) return;
      if (!porRamal.has(e.ramal)) porRamal.set(e.ramal, []);
      porRamal.get(e.ramal).push(e);
    });

    const ramais = [];
    porRamal.forEach((els, ramal) => {
      // 1) Trechos contínuos do mesmo EH em cada linha.
      const unidadesEh = new Map();
      const porLinha = new Map();
      els.forEach((e) => {
        const l = String(e.linha);
        if (!porLinha.has(l)) porLinha.set(l, []);
        porLinha.get(l).push(e);
      });
      porLinha.forEach((lista, linha) => {
        lista.sort((a, b) => a.ini - b.ini);
        const ocorr = {};
        let atual = null;
        lista.forEach((e) => {
          const eh = String(e.eh).trim();
          if (atual && atual.eh === eh) { // elementos seguidos do mesmo EH formam um só trecho
            atual.fim = Math.max(atual.fim, e.fim);
            return;
          }
          ocorr[eh] = (ocorr[eh] || 0) + 1;
          atual = { eh, chave: ocorr[eh] > 1 ? `${eh}#${ocorr[eh]}` : eh, ini: e.ini, fim: e.fim, nomeEh: e.nomeEh || '' };
          const u = unidadesEh.get(atual.chave);
          if (u) {
            u.ini = Math.min(u.ini, atual.ini);
            u.linhas.add(linha);
            u.trechos.push(atual);
          } else {
            unidadesEh.set(atual.chave, { eh, chave: atual.chave, ini: atual.ini, fim: atual.fim, linhas: new Set([linha]), trechos: [atual], nomeEh: atual.nomeEh });
          }
        });
      });
      unidadesEh.forEach((u) => { u.fim = Math.max(...u.trechos.map((t) => t.fim)); });
      const ehs = [...unidadesEh.values()].sort((a, b) => a.ini - b.ini || a.fim - b.fim);

      // 2) Nome dos EH: "EH 49/50" (o próximo número da sequência).
      const nomeEh = (u, k) => {
        if (u.nomeEh) return u.nomeEh; // geometria: o nome vem pronto ("EH 86/09I")
        const n = numero(u.eh);
        if (Number.isNaN(n)) return `EH ${u.eh}`;
        const prox = ehs.slice(k + 1).map((x) => numero(x.eh)).find((x) => Number.isFinite(x) && x > n);
        return `EH ${n}/${prox !== undefined ? prox : n + 1}`;
      };

      // 3) Unidades em ordem: EH, e RH (pátio) nos intervalos entre EHs.
      const unidades = [];
      // RH da geometria (quando houver): garante o pátio mesmo quando uma linha do EH começa antes do fim do anterior (ex.: a L3 na 76).
      const rhGeo = (eh) => M.rhKm(rhs, ramal, `RH-${eh}`);
      ehs.forEach((u, k) => {
        const ant = ehs[k - 1];
        const geo = ant && u.ini - ant.fim < GAP_RH ? rhGeo(u.eh) : null;
        if (ant && (u.ini - ant.fim >= GAP_RH || geo)) {
          const n = numero(u.eh);
          const curto = Number.isFinite(n) ? String(n).padStart(2, '0') : u.eh;
          unidades.push({
            id: `${ramal}:RH:${ant.chave}>${u.chave}`,
            tipo: 'RH',
            rotulo: Number.isFinite(n) ? `RH-${n}` : (u.nomeEh ? `RH-${u.eh}` : `RH ${ant.eh}/${u.eh}`),
            curto,
            eh: '',
            ini: geo ? geo.ini : ant.fim,
            fim: geo ? geo.fim : u.ini,
            linhas: [...new Set([...ant.linhas, ...u.linhas])].sort()
          });
        }
        unidades.push({
          id: `${ramal}:EH:${u.chave}`,
          tipo: 'EH',
          rotulo: nomeEh(u, k),
          curto: nomeEh(u, k).replace(/^EH /, ''),
          eh: u.eh,
          ini: u.ini,
          fim: u.fim,
          linhas: [...u.linhas].sort()
        });
      });
      const linhas = [...new Set(unidades.flatMap((u) => u.linhas))].sort();
      ramais.push({ ramal, nome: M.NOMES_RAMAL[ramal] || `Ramal ${ramal}`, linhas, unidades });
    });

    const pos = (r) => { const i = M.ORDEM_RAMAL.indexOf(r.ramal); return i < 0 ? 99 : i; };
    ramais.sort((a, b) => pos(a) - pos(b) || a.ramal.localeCompare(b.ramal));
    const originais = new Map();
    ramais.forEach((r) => r.unidades.forEach((u) => originais.set(u.id, u)));
    const telas = M.telas(ramais, rhs);
    if (telas.length) { ramais.length = 0; ramais.push(...telas); }
    const indice = new Map();
    ramais.forEach((r) => r.unidades.forEach((u, i) => indice.set(u.id, { ramal: r, unidade: u, i })));
    // Colunas do desenho cujas linhas são de outro EH (ex.: no começo da Linha Tronco, L1 = EH 01/03 e L2 = EH 04/06 lado a lado):
    // o trecho continua com o id do EH original, que aponta para a primeira coluna onde ele aparece.
    ramais.forEach((r) => r.unidades.forEach((u, i) => [...Object.values(u.ref || {}), ...(u.extras || [])].forEach((ref) => {
      if (!indice.has(ref.id)) indice.set(ref.id, { ramal: r, unidade: originais.get(ref.id) || { tipo: u.tipo, ...ref }, i });
    })));
    return { ramais, indice };
  };

  /**
   * Telas da Rota (uma por ramal, como o painel do CCO). Só estas aparecem:
   *  - Linha Tronco: LT até a RH-77 e segue pelo trecho 77 → 86 (na geometria está no ramal FA) até a RH-86;
   *  - Ramal de Fábrica: da RH-86 até a RH-19I;
   *  - Ramal de BH: da RH-86 até a RH-210V;
   *  - Ramal de Itabira: da RH-77 até a 540 (IT, linhas 1, 2 e 3) e, acima da 540, Conceição (CE) e João Paulo (JP).
   * As unidades guardam o id original (ex.: "FA:EH:78"): a rota já programada continua valendo.
   * As RH de ligação (77 e 86 no começo de um ramal) são marcadores sem extensão.
   * Sem LT na planta (outra planta, testes), não monta telas e a Rota mostra os ramais como vieram.
   */
  M.telas = (ramais, rhs = []) => {
    const de = (cod) => ramais.find((r) => r.ramal === cod);
    const lt = de('LT');
    if (!lt) return [];
    const fa = de('FA'); const bh = de('BH'); const it = de('IT'); const ce = de('CE'); const jp = de('JP');
    const idxEh = (r, eh) => (r ? r.unidades.findIndex((u) => u.tipo === 'EH' && String(u.eh).toUpperCase() === eh) : -1);
    const marcador = (id, curto, base, linhas) => ({ id, tipo: 'RH', rotulo: `RH-${curto}`, curto, eh: '', ini: base, fim: base, linhas: [...linhas].sort(), ligacao: true });
    const tela = (ramal, unidades) => ({ ramal, nome: M.NOMES_RAMAL[ramal] || `Ramal ${ramal}`, linhas: [...new Set(unidades.flatMap((u) => u.linhas))].sort(), unidades });
    const out = [];
    // Linha Tronco: LT + FA até a RH-86
    const i86 = idxEh(fa, '86'); // EH 86/09I: a RH antes dele é a 86
    const faTronco = fa && i86 > 0 ? fa.unidades.slice(0, i86 - 1) : [];
    const ultLt = lt.unidades[lt.unidades.length - 1];
    const unidLt = M.inicioTronco(lt.unidades, rhs);
    const mudar = (id, extra) => { const n = unidLt.findIndex((u) => u.id === id); if (n >= 0) unidLt[n] = { ...unidLt[n], ...extra }; return n >= 0; };
    // Da RH-75 à 77, como no painel: a L3 nasce na 75 a partir da L1 e fica acima dela.
    const i75 = unidLt.findIndex((u) => u.tipo === 'EH' && String(u.eh) === '75');
    const tem3 = i75 > 0 && unidLt[i75].linhas.includes('3');
    if (tem3) {
      for (let n = i75 - 1; n < unidLt.length; n++) if (unidLt[n].linhas.includes('3')) unidLt[n] = { ...unidLt[n], slot: { 3: -1 } };
      // RH-75: a L3 sai da L1 (W20); travessões L2/L1 (W21, W22) e L1/L3 (W23); toco da linha 15.
      if (unidLt[i75 - 1].tipo === 'RH') {
        unidLt[i75 - 1] = { ...unidLt[i75 - 1], slot: undefined, larg: 1.5, casaFx: 0.55, casaSlot: -1,
          via: { 3: [[0.06, 0], [0.16, -1], [1, -1]] },
          tvs: [{ lado: 'E', la: '1', lb: '2', fx: [0.22, 0.32] }, { lado: 'D', la: '1', lb: '2', fx: [0.38, 0.48] }, { lado: 'E', la: '3', lb: '1', fx: [0.52, 0.62] }],
          deco: [{ pts: [[0.68, -1], [0.78, -1.7]], fino: true, t: 'Linha 15 (pátio)' }] };
      }
      // RH-76: linha 14 do pátio e a escada de travessões 14 → L3 → L1 → L2 (W20, W21, W22); desvio que sai da L2 (W23).
      mudar('LT:RH:75>76', { larg: 1.4, casaFx: 0.66,
        tvs: [{ lado: 'D', la: '3', lb: '1', fx: [0.42, 0.52] }, { lado: 'D', la: '1', lb: '2', fx: [0.56, 0.66] }],
        deco: [{ pts: [[0.02, -2], [0.28, -2], [0.38, -1]], t: 'Linha 14 (pátio)' }, { pts: [[0.72, 1], [0.8, 1.8]], fino: true, t: 'Desvio (pátio)' }] });
    }
    const slotFa = { 1: -2, 2: -1 };
    if (faTronco.length && ultLt && ultLt.tipo === 'EH' && faTronco[0].tipo === 'EH') {
      // RH-77, como no painel: a linha 13 nasce no pátio e segue para a 78 como L1; a L3 segue como L2;
      // a L1 e a L2 da Tronco descem para Itabira. Travessões W20 a W26.
      const ita = it && it.unidades.find((u) => u.tipo === 'EH');
      const rh77 = M.rhKm(rhs, 'LT', 'RH-77'); const fa77 = M.rhKm(rhs, 'FA', 'RH-77');
      const fimRh = ita ? ita.ini : rh77 ? rh77.fim : ultLt.fim;
      const tres = ultLt.linhas.includes('3');
      const base = { id: 'LT:RH:77', tipo: 'RH', rotulo: 'RH-77', curto: '77', eh: '', ini: ultLt.fim, fim: Math.max(ultLt.fim, fimRh) };
      if (tres) {
        unidLt.push({ ...base, linhas: ['1', '2', '3'], slot: { 3: -1 }, larg: 2.6, casaFx: 0.3, casaSlot: -2,
          via: { 1: [[0, 0], [0.8, 0], [0.9, 1], [1, 1]], 2: [[0, 1], [0.74, 1], [0.84, 2], [1, 2]] },
          livres: it ? ['1', '2'] : [],
          extras: [{ ch: 'A', linha: '1', id: 'FA:RH:77', rotulo: 'RH-77 (linha 13, segue para a 78)', ini: fa77 ? fa77.ini : 0, fim: faTronco[0].ini, pts: [[0.05, -2], [1, -2]] }],
          tvs: [
            { lado: 'D', la: 'A', lb: '3', fx: [0.1, 0.15] }, { lado: 'E', la: '3', lb: '1', fx: [0.24, 0.29] }, { lado: 'D', la: '3', lb: '1', fx: [0.33, 0.38] },
            { lado: 'E', la: 'A', lb: '3', fx: [0.4, 0.45] }, { lado: 'D', la: '1', lb: '2', fx: [0.48, 0.53] }, { lado: 'E', la: '1', lb: '2', fx: [0.56, 0.61] }
          ],
          deco: [{ pts: [[0.65, 0], [0.7, -1]], fino: true, t: 'Travessão W26 (L1 → linha para a 78)' }],
          textos: it ? [{ fx: 1, slot: 2, dy: 13, txt: 'Itabira →' }] : [] });
      } else {
        unidLt.push({ ...base, linhas: [...new Set([...ultLt.linhas, ...faTronco[0].linhas])].sort(), ligacao: true });
      }
    }
    const comSlot = tem3;
    faTronco.forEach((u) => unidLt.push(comSlot ? { ...u, slot: slotFa } : u));
    if (comSlot) {
      // RH-85: desvio (linha 51) que sai da L2.
      const i85 = idxEh(fa, '85');
      if (i85 > 0) mudar(fa.unidades[i85 - 1].id, { deco: [{ pts: [[0.46, -1], [0.54, 0], [0.7, 0]], fino: true, t: 'Linha 51 (pátio)' }] });
    }
    if (fa && i86 > 0) {
      // RH-86, como no painel: a L1 segue para Fábrica; a L2 desce para BH (L1 do 86/201);
      // a linha 73 nasce no pátio e desce para BH (L2 do 86/201); travessões W21 a W25 e o toco da linha 58.
      const rh = fa.unidades[i86 - 1];
      const k1 = comSlot ? -2 : 0; const k2 = k1 + 1; const k3 = k1 + 2; const k4 = k1 + 3; const k5 = k1 + 4;
      unidLt.push(bh ? { ...rh, id: 'LT:RH:86', slot: comSlot ? slotFa : undefined, larg: 2.4, casaFx: 0.2,
        via: rh.linhas.includes('2') ? { 2: [[0, k2], [0.62, k2], [0.82, k4], [1, k4]] } : undefined,
        livres: rh.linhas,
        tvs: rh.linhas.includes('2') ? [{ lado: 'D', la: '1', lb: '2', fx: [0.08, 0.14] }, { lado: 'E', la: '1', lb: '2', fx: [0.22, 0.28] }] : [],
        deco: rh.linhas.includes('2') ? [
          { pts: [[0.03, k3], [0.55, k3], [0.75, k5], [1, k5]], t: 'Linha 73 (nasce no pátio e segue para BH como L2)' },
          { pts: [[0.03, k4], [0.1, k4], [0.16, k3]], fino: true, t: 'Linha 58 (pátio)' },
          { pts: [[0.16, k3], [0.22, k2]], fino: true, t: 'Travessão W23' },
          { pts: [[0.34, k2], [0.4, k3]], fino: true, t: 'Travessão W24' }
        ] : [],
        textos: [{ fx: 1, slot: k1, dy: -7, txt: 'Fábrica →' }, ...(rh.linhas.includes('2') ? [{ fx: 1, slot: k5, dy: 13, txt: 'BH →' }] : [])]
      } : { ...rh, id: 'LT:RH:86', ligacao: true });
    }
    out.push(tela('LT', unidLt));
    // Ramal de Fábrica: RH-86 até a RH-19I (sem o trecho 77 → 86 na planta: o ramal inteiro)
    if (fa && fa.unidades.length) {
      const i19 = idxEh(fa, '19I');
      out.push(tela('FA', fa.unidades.slice(i86 > 0 ? i86 - 1 : 0, i19 > 0 ? i19 : fa.unidades.length)));
    }
    // Ramal de BH: RH-86 até a RH-210V
    if (bh && bh.unidades.length) {
      const i210 = idxEh(bh, '210V');
      const lista = bh.unidades.slice(0, i210 > 0 ? i210 : bh.unidades.length);
      out.push(tela('BH', [marcador('BH:RH:86', '86', lista[0].ini, lista[0].linhas), ...lista]));
    }
    // Ramal de Itabira: RH-77 até a 540; acima dela Conceição e João Paulo
    if (it && it.unidades.length) {
      const lista = [marcador('IT:RH:77', '77', it.unidades[0].ini, it.unidades[0].linhas), ...it.unidades];
      const fimIt = it.unidades[it.unidades.length - 1];
      [[ce, 'CE', 'Conceição'], [jp, 'JP', 'João Paulo']].forEach(([r, cod, nome]) => {
        if (!r || !r.unidades.length) return;
        lista.push({ ...marcador(`IT:RH:${cod}`, cod, fimIt.fim, r.unidades[0].linhas), rotulo: `Entrada de ${nome}` });
        r.unidades.forEach((u) => lista.push(u.tipo === 'EH' && r.unidades.length === 1 ? { ...u, rotulo: nome, curto: cod } : u));
      });
      out.push(tela('IT', lista));
    }
    return out;
  };

  /** Km de uma RH da geometria (todas as linhas): { ini, fim, linhas }. */
  M.rhKm = (rhs, ramal, nome) => {
    const l = rhs.filter((x) => x.ramal === ramal && x.nome === nome);
    return l.length ? { ini: Math.min(...l.map((x) => x.ini)), fim: Math.max(...l.map((x) => x.fim)), linhas: [...new Set(l.map((x) => String(x.linha)))].sort() } : null;
  };

  /**
   * Começo da Linha Tronco como no painel: L1 vem da RH-01 (EH 01/03, RH-03, EH 03/06) e a L2 nasce na RH-04 (EH 04/06),
   * as duas lado a lado até a RH-06. As colunas do meio apontam (ref) para o EH original de cada linha: o trecho
   * continua "LT:EH:01@1", "LT:EH:04@2"… Sem esses EH na planta, a lista fica como veio.
   */
  M.inicioTronco = (unidades, rhs = []) => {
    const ach = (id) => unidades.find((u) => u.id === id);
    const e01 = ach('LT:EH:01'); const e04 = ach('LT:EH:04'); const e03 = ach('LT:EH:03');
    if (!e01 || !e04 || !e03 || !(e04.ini > e01.ini && e04.ini < e01.fim)) return [...unidades];
    const resto = unidades.slice(Math.max(...[e01, e04, e03].map((u) => unidades.indexOf(u))) + 1);
    const r01 = M.rhKm(rhs, 'LT', 'RH-01'); const r04 = M.rhKm(rhs, 'LT', 'RH-04'); const r03 = M.rhKm(rhs, 'LT', 'RH-03');
    const ref = (u) => ({ id: u.id, rotulo: u.rotulo, ini: u.ini, fim: u.fim });
    const k04 = r04 ? r04.ini : e04.ini; const k04f = r04 ? r04.fim : e04.ini;
    const k03 = r03 ? r03.ini : e01.fim; const k03f = r03 ? r03.fim : e03.ini;
    const T = -3; // a linha que vem da 01 fica acima da linha dupla (que começa na 04)
    const tu = 'Linha 1 da 04 para a 03 (Ramal de Tubarão)';
    const rh = (id, n, ini, fim, linhas, extra = {}) => ({ id, tipo: 'RH', rotulo: `RH-${n}`, curto: String(n).padStart(2, '0'), eh: '', ini, fim, linhas, ...extra });
    const eh = (id, rotulo, ini, fim, refs, extra = {}) => ({ id, tipo: 'EH', rotulo, curto: rotulo.replace(/^EH /, ''), eh: '', ini, fim, linhas: Object.keys(refs).sort(), ref: refs, ...extra });
    return [
      // RH-01: linha 13 (segue para trás) e a linha 14 do pátio, que entra no W21.
      rh('LT:RH:01', 1, r01 ? r01.ini : e01.ini, e01.ini, ['1'], { slot: { 1: T }, casaFx: 0.42, tvs: [],
        deco: [{ pts: [[0, T + 1], [0.24, T + 1], [0.42, T]], t: 'Linha 14 (pátio)' }, { pts: [[0.58, T - 0.5], [0.66, T]], fino: true, t: 'Linha 32 (pátio)' }] }),
      // a linha dupla (1E e 2E) começa antes da 04
      eh('LT:COL:01a', e01.rotulo, e01.ini, k04, { 1: ref(e01) }, { slot: { 1: T }, deco: [{ pts: [[0.5, 0], [1, 0]], t: tu }, { pts: [[0.5, 1], [1, 1]], t: 'Linha 2 (antes da 04)' }] }),
      // RH-04: fica na linha dupla; travessões W21 e W22 entre as duas linhas. A L1 (EH 01/03) passa por cima.
      rh('LT:RH:04', 4, k04, k04f, ['1', '2'], { ref: { 1: ref(e01) }, slot: { 1: T }, casaSlot: 0, tvs: [],
        deco: [{ pts: [[0, 0], [1, 0]], t: tu }, { pts: [[0.24, 1], [0.38, 0]], fino: true, t: 'Travessão W21' }, { pts: [[0.52, 0], [0.66, 1]], fino: true, t: 'Travessão W22' }] }),
      eh('LT:COL:01b', `${e01.rotulo} · ${e04.curto}`, k04f, k03, { 1: ref(e01), 2: ref(e04) }, { slot: { 1: T }, deco: [{ pts: [[0, 0], [1, 0]], t: tu }] }),
      // RH-03: a linha que vem da 01 desce e abre em duas pernas (W22): para a 04 (Tubarão) e para a 06 (L1).
      rh('LT:RH:03', 3, k03, k03f, ['1', '2'], { ref: { 2: ref(e04) }, larg: 1.5, casaFx: 0.56, casaSlot: T, tvs: [],
        via: { 1: [[0, T], [0.4, T], [0.48, T + 0.5], [0.76, 0], [1, 0]] },
        deco: [{ pts: [[0, 0], [0.76, 0]], t: tu }, { pts: [[0.2, 0], [0.48, T + 0.5]], t: 'Perna da 03 para a 04 (Ramal de Tubarão)' }] }),
      eh('LT:COL:03', `${e03.rotulo} · ${e04.curto}`, k03f, e03.fim, { 1: ref(e03), 2: ref(e04) }),
      ...resto
    ];
  };

  /** Id do trecho de uma linha numa coluna do desenho (a coluna pode apontar para o EH original daquela linha). */
  M.idDe = (u, l) => (u.ref && u.ref[l] ? u.ref[l].id : u.id);

  /** Trecho da rota: unidade + linha (ex.: "LT:EH:49@1"). */
  M.trecho = (idUnidade, linha) => `${idUnidade}@${linha}`;
  M.separar = (trecho) => {
    const t = String(trecho);
    const i = t.lastIndexOf('@');
    const base = i < 0 ? t : t.slice(0, i);
    const linha = i < 0 ? '' : t.slice(i + 1);
    const m = /^(.*)#TV([ED])$/.exec(base);
    return m ? { id: m[1], linha, tv: m[2] } : { id: base, linha, tv: '' };
  };

  /**
   * Travessão do pátio (troca de linha). Em cada RH há dois, entre cada par de linhas vizinhas:
   *  E (esquerda, "/"): liga a linha de baixo, à esquerda, à de cima, à direita;
   *  D (direita, "\\"): liga a linha de cima, à esquerda, à de baixo, à direita.
   * Código: "LT:RH:37>38#TVE@1-2". Não tem extensão (km) nem OM.
   */
  M.travessao = (idUnidade, lado, linhaCima, linhaBaixo) => `${idUnidade}#TV${lado}@${linhaCima}-${linhaBaixo}`;
  M.ehTravessao = (trecho) => !!M.separar(trecho).tv;

  /** Trechos de uma unidade até outra (inclusive), numa linha, na ordem do ramal. */
  M.intervalo = (malha, idDe, idAte, linha) => {
    const a = malha.indice.get(idDe);
    const b = malha.indice.get(idAte);
    if (!a || !b || a.ramal !== b.ramal) return [];
    const [i0, i1] = a.i <= b.i ? [a.i, b.i] : [b.i, a.i];
    return [...new Set(a.ramal.unidades.slice(i0, i1 + 1)
      .filter((u) => u.linhas.includes(String(linha)))
      .map((u) => M.trecho(M.idDe(u, String(linha)), linha)))];
  };

  /** Extensão (m) de uma lista de trechos. Trechos que não existem na malha são ignorados. */
  M.extensao = (malha, trechos) => trechos.reduce((s, t) => {
    if (M.ehTravessao(t)) return s; // travessão: só a troca de linha
    const x = malha.indice.get(M.separar(t).id);
    return s + (x ? Math.max(0, x.unidade.fim - x.unidade.ini) : 0);
  }, 0);

  /** Descrição curta de um trecho: "LT · EH 49/50 · L1". */
  M.descrever = (malha, trecho) => {
    const { id, linha, tv } = M.separar(trecho);
    const x = malha.indice.get(id);
    if (!x) return trecho;
    if (tv) {
      const [a, b] = linha.split('-');
      return `${x.ramal.ramal} · ${x.unidade.rotulo} · travessão L${tv === 'E' ? b : a}→L${tv === 'E' ? a : b}`;
    }
    return `${x.ramal.ramal} · ${x.unidade.rotulo}${linha ? ` · L${linha}` : ''}`;
  };

  /** Resumo da rota: de onde a onde vai em cada ramal (ex.: "LT: RH-05 → EH 50/51"). */
  M.resumo = (malha, trechos) => {
    const por = new Map();
    trechos.forEach((t) => {
      const x = malha.indice.get(M.separar(t).id);
      if (!x) return;
      const r = x.ramal.ramal;
      const atual = por.get(r) || { min: x, max: x };
      if (x.i < atual.min.i) atual.min = x;
      if (x.i > atual.max.i) atual.max = x;
      por.set(r, atual);
    });
    return [...por.entries()].map(([r, { min, max }]) => (min === max ? `${r}: ${min.unidade.rotulo}` : `${r}: ${min.unidade.rotulo} → ${max.unidade.rotulo}`)).join(' · ');
  };

  App.malha = M;
})(window.App);
