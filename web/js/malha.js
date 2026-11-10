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
      ehs.forEach((u, k) => {
        const ant = ehs[k - 1];
        if (ant && u.ini - ant.fim >= GAP_RH) {
          const n = numero(u.eh);
          const curto = Number.isFinite(n) ? String(n).padStart(2, '0') : u.eh;
          unidades.push({
            id: `${ramal}:RH:${ant.chave}>${u.chave}`,
            tipo: 'RH',
            rotulo: Number.isFinite(n) ? `RH-${n}` : (u.nomeEh ? `RH-${u.eh}` : `RH ${ant.eh}/${u.eh}`),
            curto,
            eh: '',
            ini: ant.fim,
            fim: u.ini,
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
    const telas = M.telas(ramais);
    if (telas.length) { ramais.length = 0; ramais.push(...telas); }
    const indice = new Map();
    ramais.forEach((r) => r.unidades.forEach((u, i) => indice.set(u.id, { ramal: r, unidade: u, i })));
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
  M.telas = (ramais) => {
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
    const unidLt = [...lt.unidades];
    if (faTronco.length && ultLt && ultLt.tipo === 'EH' && faTronco[0].tipo === 'EH') unidLt.push(marcador('LT:RH:77', '77', ultLt.fim, new Set([...ultLt.linhas, ...faTronco[0].linhas])));
    unidLt.push(...faTronco);
    if (fa && i86 > 0) { const rh = fa.unidades[i86 - 1]; unidLt.push({ ...rh, id: 'LT:RH:86', ligacao: true }); }
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
    return a.ramal.unidades.slice(i0, i1 + 1)
      .filter((u) => u.linhas.includes(String(linha)))
      .map((u) => M.trecho(u.id, linha));
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
