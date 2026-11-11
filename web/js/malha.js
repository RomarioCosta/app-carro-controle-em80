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
      if (!indice.has(ref.id)) indice.set(ref.id, { ramal: r, unidade: { tipo: u.tipo, ...(originais.get(ref.id) || {}), ...(ref.pts ? { rotulo: ref.rotulo } : {}), id: ref.id, ...(originais.has(ref.id) ? {} : ref) }, i });
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
    /**
     * Pátio da 86 como no painel, para as três telas: a L1 segue para Fábrica; a L2 desce para BH (L1 do 86/201);
     * a linha 73 nasce no pátio e desce para BH (L2 do 86/201); travessões W21 a W24 e o toco da linha 58.
     * k1 = faixa da L1; tipo: 'LT' (fim da tela), 'FA' (a L1 continua) ou 'BH' (as linhas da tela são as que descem).
     */
    const patio86 = (tipo, k1) => {
      const k2 = k1 + 1; const k3 = k1 + 2; const k4 = k1 + 3; const k5 = k1 + 4;
      const M2 = [[0, k2], [0.62, k2], [0.82, k4], [1, k4]]; const L73 = [[0.03, k3], [0.55, k3], [0.75, k5], [1, k5]];
      const toco = { pts: [[0.03, k4], [0.1, k4], [0.16, k3]], fino: true, t: 'Linha 58 (pátio)' };
      if (tipo === 'BH') {
        return { larg: 2.4, casaFx: 0.2, casaSlot: k1, via: { 1: M2, 2: L73 },
          tvs: [{ lado: 'E', la: '1', lb: '2', fx: [0.16, 0.22] }, { lado: 'D', la: '1', lb: '2', fx: [0.34, 0.4] }],
          deco: [{ pts: [[0, k1], [1, k1]], t: 'L1 (segue para Fábrica)' }, toco,
            { pts: [[0.08, k1], [0.14, k2]], fino: true, t: 'Travessão W21' }, { pts: [[0.22, k2], [0.28, k1]], fino: true, t: 'Travessão W22' }],
          textos: [{ fx: 1, slot: k1, dy: -7, txt: 'Fábrica →' }] };
      }
      return { larg: 2.4, casaFx: 0.2, via: { 2: M2 }, livres: tipo === 'LT' ? ['1', '2'] : ['2'],
        tvs: [{ lado: 'D', la: '1', lb: '2', fx: [0.08, 0.14] }, { lado: 'E', la: '1', lb: '2', fx: [0.22, 0.28] }],
        deco: [{ pts: L73, t: 'Linha 73 (nasce no pátio e segue para BH como L2)' }, toco,
          { pts: [[0.16, k3], [0.22, k2]], fino: true, t: 'Travessão W23' }, { pts: [[0.34, k2], [0.4, k3]], fino: true, t: 'Travessão W24' }],
        textos: [...(tipo === 'LT' ? [{ fx: 1, slot: k1, dy: -7, txt: 'Fábrica →' }] : []), { fx: 1, slot: k5, dy: 13, txt: 'BH →' }] };
    };
    const rh86 = fa && i86 > 0 ? fa.unidades[i86 - 1] : null;
    const duas86 = !!rh86 && rh86.linhas.includes('2') && !!bh;
    if (rh86) {
      unidLt.push(duas86 ? { ...rh86, id: 'LT:RH:86', slot: comSlot ? slotFa : undefined, ...patio86('LT', comSlot ? -2 : 0) }
        : bh ? { ...rh86, id: 'LT:RH:86', slot: comSlot ? slotFa : undefined, livres: rh86.linhas, textos: [{ fx: 1, slot: comSlot ? -2 : 0, dy: -7, txt: 'Fábrica →' }] }
          : { ...rh86, id: 'LT:RH:86', ligacao: true });
    }
    out.push(tela('LT', unidLt));

    // Ajustes de desenho por id (só se a unidade existir) e pátios com o desvio acima da linha principal.
    const mudarEm = (lista, id, extra) => { const n = lista.findIndex((u) => u.id === id); if (n >= 0) lista[n] = { ...lista[n], ...extra }; };
    const desvioAcima = (lista, patios) => lista.forEach((u, n) => {
      if (u.linhas.length !== 2 || u.linhas.join('') !== '12') return;
      const nome = u.tipo === 'RH' ? u.rotulo.replace(/^RH-/, '') : String(u.eh);
      const ok = patios.some((p) => (u.tipo === 'RH' ? nome === `${p}I` || nome === `${p}V` : nome === `${p}I`));
      if (ok) lista[n] = { ...u, slot: { 1: 0, 2: -1 } }; // L1 segue reta; a L2 (desvio do pátio) fica acima
    });
    const des = (pts, t = 'Desvio (pátio)', fino = false) => ({ pts, t, fino });

    // Ramal de Fábrica: RH-86 até a RH-19I (sem o trecho 77 → 86 na planta: o ramal inteiro).
    // Linha singela com os desvios dos pátios acima (09, 10, 14, 16, 18) ou abaixo (11–12, 13, 15, 17), como no painel.
    if (fa && fa.unidades.length) {
      const i19 = idxEh(fa, '19I');
      const lista = fa.unidades.slice(i86 > 0 ? i86 - 1 : 0, i19 > 0 ? i19 : fa.unidades.length);
      if (duas86 && lista[0].id === rh86.id) lista[0] = { ...lista[0], ...patio86('FA', 0) };
      desvioAcima(lista, ['09', '10', '14', '16', '18']);
      mudarEm(lista, 'FA:RH:10V>11I', { deco: [des([[0.5, 0], [0.7, 1], [1, 1]])] });
      mudarEm(lista, 'FA:EH:11I', { deco: [des([[0, 1], [1, 1]])] });
      mudarEm(lista, 'FA:RH:11I>12V', { deco: [des([[0, 1], [0.3, 1], [0.5, 0]])] });
      mudarEm(lista, 'FA:EH:14V', { deco: [des([[0.15, 0], [0.3, -1], [0.8, -1]], 'Linha 3 (pátio)')] });
      mudarEm(lista, 'FA:EH:17V', { deco: [des([[0.55, -1], [1, -1]], 'Linha 11 (pátio)')] });
      mudarEm(lista, 'FA:RH:17V>18I', { tvs: [{ lado: 'E', la: '1', lb: '2', fx: [0.3, 0.5] }] });
      mudarEm(lista, 'FA:EH:18I', { deco: [des([[0.45, -1], [0.55, -2], [0.85, -2]], 'Linha 13 (pátio)')] });
      mudarEm(lista, 'FA:RH:18V>19I', { deco: [des([[0.55, 0], [0.8, 1], [1, 1]])] });
      out.push(tela('FA', lista));
    }
    // Ramal de BH: RH-86 até a RH-210V. Linha dupla até a 204V; depois singela com os desvios acima (205, 206, 207, 209)
    // ou abaixo (237, 208, 210), como no painel.
    if (bh && bh.unidades.length) {
      const i210 = idxEh(bh, '210V');
      const lista = bh.unidades.slice(0, i210 > 0 ? i210 : bh.unidades.length);
      const r86 = M.rhKm(rhs, 'BH', 'RH-86');
      const prim = lista[0].linhas.join('') === '12' && duas86
        ? { id: 'BH:RH:86', tipo: 'RH', rotulo: 'RH-86', curto: '86', eh: '', ini: r86 ? r86.ini : lista[0].ini, fim: lista[0].ini, linhas: ['1', '2'], ...patio86('BH', -3) }
        : marcador('BH:RH:86', '86', lista[0].ini, lista[0].linhas);
      desvioAcima(lista, ['205', '206', '209']);
      const E = (fx) => ({ lado: 'E', la: '1', lb: '2', fx }); const D = (fx) => ({ lado: 'D', la: '1', lb: '2', fx });
      mudarEm(lista, 'BH:RH:86>201', { tvs: [E([0.2, 0.34])], deco: [des([[0, 2], [0.06, 2], [0.16, 1]], 'Toco (pátio)'), des([[0.45, 0], [0.55, -1], [0.95, -1]], 'Linha do pátio')] });
      mudarEm(lista, 'BH:RH:201>202', { tvs: [D([0.2, 0.36]), E([0.5, 0.66])] });
      mudarEm(lista, 'BH:RH:202>204I', { tvs: [D([0.2, 0.36]), E([0.5, 0.66])] });
      mudarEm(lista, 'BH:EH:204I', { deco: [des([[0.45, 1], [0.6, 1.8], [0.95, 1.8]]), des([[0.6, 1.8], [0.72, 2.6], [0.95, 2.6]])] });
      mudarEm(lista, 'BH:EH:205V', { deco: [des([[0.3, 0], [0.42, -1], [0.8, -1]], 'Linha 205A (pátio)')] });
      mudarEm(lista, 'BH:EH:206I', { deco: [des([[0.5, -1], [0.65, -2], [0.95, -2]])] });
      mudarEm(lista, 'BH:RH:237V>207I', { deco: [des([[0.5, 0], [0.7, -1], [1, -1]])] });
      mudarEm(lista, 'BH:EH:207I', { deco: [des([[0, -1], [1, -1]]), des([[0.3, -1], [0.45, -2], [0.8, -2]])] });
      mudarEm(lista, 'BH:RH:207I>207V', { deco: [des([[0, -1], [0.3, -1], [0.5, 0]])] });
      mudarEm(lista, 'BH:EH:210I', { deco: [des([[0.45, 1], [0.6, 2], [0.9, 2]])] });
      out.push(tela('BH', [prim, ...lista]));
    }
    // Ramal de Itabira: RH-77 até a 540 e, depois dela, a Estação Itabira (L3), João Paulo (pela L2) e Conceição (pela L1).
    // Laboriaux (92 a 540) segue o painel, no mesmo sentido do resto da tela: L4 e L5 acima da L1, só como desenho.
    if (it && it.unidades.length) {
      const u0 = it.unidades[0];
      const ent = u0.linhas.join('') === '12'
        ? { ...marcador('IT:RH:77', '77', u0.ini, u0.linhas), tvs: [], via: { 1: [[0, -1], [0.35, -1], [0.65, 0], [1, 0]], 2: [[0, 0], [0.25, 0], [0.55, 1], [1, 1]] } }
        : marcador('IT:RH:77', '77', u0.ini, u0.linhas);
      const lista = [ent, ...it.unidades];
      const fimIt = it.unidades[it.unidades.length - 1];
      const lab = lista.some((u) => u.id === 'IT:RH:94>540' && u.linhas.join('') === '123') && fimIt.id === 'IT:EH:540';
      if (lab) {
        const tv = (lado, la, lb, fx) => ({ lado, la, lb, fx });
        const l4 = 'Linha 4 (pátio)'; const l5 = 'Linha 5 (pátio)';
        // 92: travessões W21/W22; a L3 sai da L2 (W23), a L4 sai da L1 (W24) e a L5 sai da L4 (W25).
        mudarEm(lista, 'IT:RH:91>92', { larg: 1.8, casaFx: 0.3, casaSlot: 0,
          via: { 3: [[0.6, 1], [0.72, 2], [1, 2]] },
          tvs: [tv('E', '1', '2', [0.1, 0.22]), tv('D', '1', '2', [0.3, 0.42])],
          deco: [des([[0.6, 0], [0.72, -1], [1, -1]], l4), des([[0.8, -1], [0.9, -2], [1, -2]], l5)] });
        mudarEm(lista, 'IT:EH:92', { deco: [des([[0, -1], [1, -1]], l4), des([[0, -2], [1, -2]], l5)], textos: [{ fx: 0.2, slot: -1, dy: -4, txt: 'L4' }, { fx: 0.2, slot: -2, dy: -4, txt: 'L5' }] });
        // 93: escada de travessões da L5 até a L3 (W25, W24, W21, W22).
        mudarEm(lista, 'IT:RH:92>93', { larg: 1.6, casaSlot: -2,
          tvs: [tv('D', '2', '3', [0.18, 0.28]), tv('D', '1', '2', [0.34, 0.44])],
          deco: [des([[0, -1], [1, -1]], l4), des([[0, -2], [1, -2]], l5), des([[0.5, -1], [0.6, 0]], 'Travessão W24', true), des([[0.66, -2], [0.76, -1]], 'Travessão W25', true)] });
        // 93/94: a L5 termina na L4 (W20).
        mudarEm(lista, 'IT:EH:93', { deco: [des([[0, -1], [1, -1]], l4), des([[0, -2], [0.5, -2], [0.62, -1]], l5)] });
        // 94: a L4 termina na L1 (W21); travessões W23 (L3/L2) e W22 (L1/L2); saem as linhas RBV (acima) e RBN (abaixo).
        mudarEm(lista, 'IT:RH:93>94', { larg: 2, casaFx: 0.3, casaSlot: -1,
          tvs: [tv('E', '2', '3', [0.14, 0.24]), tv('D', '1', '2', [0.32, 0.42])],
          deco: [des([[0, -1], [0.06, -1], [0.14, 0]], l4), des([[0.5, 0], [0.6, -1], [0.85, -1]], 'Linha RBV (pátio)'), des([[0.4, 2], [0.5, 3], [0.8, 3]], 'Linha RBN (pátio)')] });
        // 540: travessões W1 (L2 → L1) e W2 (L3 → L2).
        mudarEm(lista, 'IT:RH:94>540', { larg: 1.4, tvs: [tv('E', '1', '2', [0.2, 0.34]), tv('E', '2', '3', [0.48, 0.62])] });
        // depois da 540: L3 até a Estação Itabira; a L2 segue para João Paulo; a L1 sobe para Conceição.
        const eCe = ce && ce.unidades.find((u) => u.tipo === 'EH'); const eJp = jp && jp.unidades.find((u) => u.tipo === 'EH');
        const extras = []; const deco = []; const textos = [{ fx: 0.11, slot: 2, dy: 13, txt: 'Estação Itabira' }];
        const nome = (fx, slot, txt) => textos.push({ fx, slot, dy: -3, txt });
        /** Pátio em balão, como no painel: linhas em leque a partir de um ponto e fechadas em pares por laços à direita. */
        const balao = (de, grupos, pares, xLaco) => {
          grupos.forEach(([ini, rows]) => rows.forEach((r, n) => deco.push(des([ini, [ini[0] + 0.025 + 0.012 * n, r[0]], [xLaco - 0.02 - 0.015 * pares.findIndex((p) => p.includes(r[0])), r[0]]], r[1]))));
          pares.forEach(([a, b], n) => { const x = xLaco - 0.015 * n; deco.push(des([[x - 0.02, a], [x, a + 0.3], [x, b - 0.3], [x - 0.02, b]], `Laço ${de}`)); });
        };
        if (eCe) {
          // Conceição: a L1 sobe até o W1; R Saída (SP3, SP4) e R Entrada (Silo 3, Silo 4); laços Silo 3–SP3 e Silo 4–SP4.
          extras.push({ ch: 'CE', linha: eCe.linhas[0], id: eCe.id, rotulo: 'Conceição', ini: eCe.ini, fim: eCe.fim, pts: [[0, 0], [0.05, 0], [0.12, -2.5], [0.18, -2.5]] });
          deco.push(des([[0.18, -2.5], [0.21, -3.4], [0.25, -3.4]], 'R Saída'), des([[0.18, -2.5], [0.23, -5], [0.27, -5]], 'R Entrada'));
          balao('de Conceição', [[[0.25, -3.4], [[-3, 'SP3'], [-3.8, 'SP4']]], [[0.27, -5], [[-4.6, 'Silo 4'], [-5.4, 'Silo 3']]]], [[-5.4, -3], [-4.6, -3.8]], 0.6);
          [[-3, 'SP3'], [-3.8, 'SP4'], [-4.6, 'Silo 4'], [-5.4, 'Silo 3']].forEach(([k, t]) => nome(0.5, k, t));
          textos.push({ fx: 0.5, slot: -5.4, dy: -16, txt: 'CONCEIÇÃO' });
        }
        if (eJp) {
          // João Paulo: a L2 desce até o W; leque de cima (M3B, M3A, 1SV-P1, SP1/SP2) e de baixo (Silo 02, Silo Velho, Linha KM, Silo 01);
          // laços M3B–Silo 01, M3A–Linha KM, 1SV-P1–Silo Velho e SP1/SP2–Silo 02; CONVAP sai da Silo 02.
          extras.push({ ch: 'JP', linha: eJp.linhas[0], id: eJp.id, rotulo: 'João Paulo', ini: eJp.ini, fim: eJp.fim, pts: [[0, 1], [0.1, 1], [0.16, 3], [0.22, 3]] });
          deco.push(des([[0.22, 3], [0.28, 3]], 'Ramal VJP'), des([[0.22, 3], [0.26, 7.4]], 'Ramal Vale'));
          const cima = [[3.8, 'M3B'], [4.6, 'M3A'], [5.4, '1SV-P1'], [6.2, 'SP1/SP2']];
          const baixo = [[7.8, 'Silo 02'], [8.6, 'Silo Velho'], [9.4, 'Linha KM'], [10.2, 'Silo 01']];
          balao('de João Paulo', [[[0.28, 3], cima], [[0.26, 7.4], baixo]], [[3.8, 10.2], [4.6, 9.4], [5.4, 8.6], [6.2, 7.8]], 0.98);
          deco.push(des([[0.55, 7.8], [0.58, 7], [0.75, 7]], 'CONVAP', true));
          [...cima, ...baixo].forEach(([k, t]) => nome(0.85, k, t));
          nome(0.75, 7, 'CONVAP');
          textos.push({ fx: 0.85, slot: 10.2, dy: 14, txt: 'JOÃO PAULO' });
        }
        lista[lista.length - 1] = { ...fimIt, id: 'IT:COL:540', rotulo: 'Depois da 540', larg: 9, ref: { 3: { id: fimIt.id, rotulo: 'Estação Itabira (EH 540/IT)', ini: fimIt.ini, fim: fimIt.fim } },
          via: { 3: [[0, 2], [0.12, 2]] }, extras, deco, textos };
      } else {
        [[ce, 'CE', 'Conceição'], [jp, 'JP', 'João Paulo']].forEach(([r, cod, nome]) => {
          if (!r || !r.unidades.length) return;
          lista.push({ ...marcador(`IT:RH:${cod}`, cod, fimIt.fim, r.unidades[0].linhas), rotulo: `Entrada de ${nome}` });
          r.unidades.forEach((u) => lista.push(u.tipo === 'EH' && r.unidades.length === 1 ? { ...u, rotulo: nome, curto: cod } : u));
        });
      }
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
