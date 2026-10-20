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
    TU: 'Pátio de Tubarão',
    AZ: 'Ramal AZ',
    OB: 'Ramal de OB'
  };
  M.ORDEM_RAMAL = ['LT', 'FA', 'BH', 'TU', 'OB', 'AZ'];
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
          atual = { eh, chave: ocorr[eh] > 1 ? `${eh}#${ocorr[eh]}` : eh, ini: e.ini, fim: e.fim };
          const u = unidadesEh.get(atual.chave);
          if (u) {
            u.ini = Math.min(u.ini, atual.ini);
            u.linhas.add(linha);
            u.trechos.push(atual);
          } else {
            unidadesEh.set(atual.chave, { eh, chave: atual.chave, ini: atual.ini, fim: atual.fim, linhas: new Set([linha]), trechos: [atual] });
          }
        });
      });
      unidadesEh.forEach((u) => { u.fim = Math.max(...u.trechos.map((t) => t.fim)); });
      const ehs = [...unidadesEh.values()].sort((a, b) => a.ini - b.ini || a.fim - b.fim);

      // 2) Nome dos EH: "EH 49/50" (o próximo número da sequência).
      const nomeEh = (u, k) => {
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
            rotulo: Number.isFinite(n) ? `RH-${n}` : `RH ${ant.eh}/${u.eh}`,
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
    const indice = new Map();
    ramais.forEach((r) => r.unidades.forEach((u, i) => indice.set(u.id, { ramal: r, unidade: u, i })));
    return { ramais, indice };
  };

  /** Trecho da rota: unidade + linha (ex.: "LT:EH:49@1"). */
  M.trecho = (idUnidade, linha) => `${idUnidade}@${linha}`;
  M.separar = (trecho) => {
    const i = String(trecho).lastIndexOf('@');
    return i < 0 ? { id: trecho, linha: '' } : { id: trecho.slice(0, i), linha: trecho.slice(i + 1) };
  };

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
    const x = malha.indice.get(M.separar(t).id);
    return s + (x ? Math.max(0, x.unidade.fim - x.unidade.ini) : 0);
  }, 0);

  /** Descrição curta de um trecho: "LT · EH 49/50 · L1". */
  M.descrever = (malha, trecho) => {
    const { id, linha } = M.separar(trecho);
    const x = malha.indice.get(id);
    if (!x) return trecho;
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
