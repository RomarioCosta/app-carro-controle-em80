/*
 * Limites de geometria da via: tabela "Parâmetros EFVM 2026 – bitola métrica", níveis (alerta, restrição,
 * interdição), limites editados pelo usuário e todos os textos dos parâmetros e dos alertas.
 * Um lugar só para a regra: a Tela do carro e os Alertas de geometria da Montagem usam estas mesmas funções.
 */
'use strict';

(function (App) {
  const { U } = App;
  const L = {};

  /* ---------------- Textos ---------------- */

  L.TEXTOS = {
    niveis: { alerta: 'Alerta', restricao: 'Restrição', interdicao: 'Interdição' },
    elemento: { C: 'curva', T: 'tangente', RH: 'RH / pátio' },
    tabela: 'EFVM 2026',
    editados: 'editados',
    alertas: {
      titulo: 'Alertas de geometria',
      explicacao: 'Empeno, nivelamento e superelevação (sem bitola e sem alinhamento), com os mesmos limites da Tela do carro.',
      limites: (vel, editados) => `Limites: ${vel} km/h (${editados ? 'editados' : 'EFVM 2026'}). A velocidade e os limites são escolhidos na Tela do carro, em "Limites".`,
      rh: 'Nas RH (pátios, AMV) vale o limite da tangente, como na Tela do carro.',
      vazio: 'Nenhum trecho passa dos limites nos arquivos deste ciclo.',
      vazioFiltro: 'Nenhum alerta com este filtro.',
      limitado: (n, total) => `Mostrando ${n} de ${total}. Use os filtros.`,
      clique: 'Clique num alerta para rodar o arquivo na Tela do carro naquele km.',
      semNivel: 'Alerta e interdição estão em branco: preencha em "Limites", na Tela do carro, para ver esses níveis.',
      colunas: ['Nível', 'Parâmetro', 'Linha', 'Km (geometria)', 'Ext. (m)', 'EH / RH', 'Elemento', 'Valor', 'Limite', 'Arquivo'],
      resumo: ['Parâmetro', 'Maior valor', 'Limite (curva / tangente)', 'Alerta', 'Restrição', 'Interdição', 'Total'],
      filtroParametro: 'Parâmetro',
      filtroNivel: 'Nível',
      todos: 'Todos',
      nivelMinimo: { 1: 'Alerta ou mais', 2: 'Restrição ou mais', 3: 'Interdição' }
    }
  };

  /* ---------------- Tabela EFVM 2026 ---------------- */

  /** Velocidades da tabela (km/h). */
  L.VELOCIDADES = [15, 20, 30, 35, 40, 45, 50, 60, 68];
  /**
   * Limites em mm por velocidade (mesma ordem de VELOCIDADES), por elemento (curva/tangente).
   * Faixas da tabela ("22 a 28") usam o menor valor. null = sem limite.
   * Bitola: superior = aberta (1000 + valor), inferior = fechada (987 → −13).
   */
  L.TABELA = {
    bitola: { curva: [35, 33, 32, 32, 32, 32, 32, 32, 31], tangente: [35, 33, 32, 32, 32, 32, 32, 32, 31], inferior: -13 },
    alinhamento: { curva: [31, 28, 26, 25, 24, 22, 20, 18, 17], tangente: [31, 28, 26, 25, 24, 22, 20, 18, 17] },
    variacao: { curva: [34, 33, 32, 32, 30, 29, 25, 23, 22], tangente: [34, 33, 32, 32, 30, 29, 25, 23, 22] },
    empeno2: { curva: [18, 17, 16, 15, 14, 13, 12, 11, 10], tangente: [47, 40, 28, 35, 32, 30, 24, 20, 19] },
    nivelamento5: { curva: [28, 22, 22, 22, 21, 21, 21, 21, 21], tangente: [28, 22, 22, 22, 21, 21, 21, 21, 21] },
    empeno10: { curva: [39, 38, 38, 38, 33, 32, 32, 32, 31], tangente: [39, 38, 38, 38, 33, 32, 32, 32, 31] },
    // superelevação = nivelamento transversal; o limite vale só na tangente
    superelevacao: { curva: null, tangente: [48, 39, 36, 33, 32, 31, 30, 28, 27] }
  };

  /**
   * Parâmetros da Tela do carro, na ordem das colunas. campo = coluna lida do arquivo; grupo = linha da tabela;
   * geometria = entra nos Alertas de geometria; escala = meia largura padrão da coluna (mm).
   */
  L.PARAMETROS = [
    { id: 'bitF', nome: 'Bitola F', descricao: 'Bitola F', campo: 'bitF', grupo: 'bitola', cor: '#16a34a', escala: 40 },
    { id: 'bitT', nome: 'Bitola T', descricao: 'Bitola T', campo: 'bitT', grupo: 'bitola', cor: '#1d4ed8', escala: 40 },
    { id: 'kld', nome: 'Bit_KLD', descricao: 'Bitola KLD', campo: 'kld', grupo: 'bitola', cor: '#c026d3', escala: 40 },
    { id: 'val25', nome: 'ALv_B2,5', descricao: 'Alinhamento', campo: 'val25', grupo: 'alinhamento', cor: '#1d4ed8', escala: 40 },
    { id: 'vrbt5', nome: 'VrBTmax5', descricao: 'Variação de bitola em 5 m', campo: 'vrbt5', grupo: 'variacao', cor: '#1d4ed8', escala: 40 },
    { id: 'emp2', nome: 'EMP_2', descricao: 'Empeno em 2 m', campo: 'emp2', grupo: 'empeno2', cor: '#1d4ed8', escala: 50, geometria: true },
    { id: 'nl5', nome: 'NLmax_5', descricao: 'Nivelamento', campo: 'nl5', grupo: 'nivelamento5', cor: '#1d4ed8', escala: 40, geometria: true },
    { id: 'emp10', nome: 'EMP_10', descricao: 'Empeno em 10 m', campo: 'emp10', grupo: 'empeno10', cor: '#1d4ed8', escala: 50, geometria: true },
    { id: 'curv', nome: '10000/R', descricao: 'Raio', campo: 'curv', grupo: null, cor: '#334155', escala: 45 },
    { id: 'sup', nome: 'SUPerABS', descricao: 'Superelevação', campo: 'sup', grupo: 'superelevacao', cor: '#16a34a', escala: 110, geometria: true }
  ];
  L.parametro = (id) => L.PARAMETROS.find((p) => p.id === id) || null;
  /** Parâmetros dos Alertas de geometria (sem bitola, sem alinhamento, sem variação de bitola). */
  L.GEOMETRIA = L.PARAMETROS.filter((p) => p.geometria).map((p) => p.id);
  L.nomeCompleto = (id) => { const p = L.parametro(id); return p ? `${p.nome} (${p.descricao.toLowerCase()})` : id; };

  /** Níveis de limite. A tabela EFVM 2026 preenche a Restrição; Alerta e Interdição são preenchidos à mão. */
  L.NIVEIS = [
    { id: 'alerta', nome: L.TEXTOS.niveis.alerta, grau: 1 },
    { id: 'restricao', nome: L.TEXTOS.niveis.restricao, grau: 2 },
    { id: 'interdicao', nome: L.TEXTOS.niveis.interdicao, grau: 3 }
  ];

  /* ---------------- Velocidade e limites editados ---------------- */

  L.velocidade = () => Number(U.pref.get('telaCarro:velocidade', 68)) || 68;
  L.mudarVelocidade = (v) => U.pref.set('telaCarro:velocidade', Number(v));
  let edicoes = null; // { [vel]: { [param]: { alerta, restricao, interdicao } } }
  L.edicoes = () => { if (!edicoes) edicoes = U.pref.get('telaCarro:limites', {}) || {}; return edicoes; };
  L.editados = (vel) => !!L.edicoes()[vel];
  /** Salva os limites editados de uma velocidade (null = volta à tabela EFVM 2026). */
  L.salvarEdicoes = (vel, valor) => {
    const e = { ...L.edicoes() };
    if (valor) e[vel] = valor; else delete e[vel];
    edicoes = e;
    U.pref.set('telaCarro:limites', e);
  };

  /** Limites padrão de um parâmetro numa velocidade: { C: { sup, inf } | null, T: … }. */
  L.padrao = (p, vel) => {
    const t = p && p.grupo && L.TABELA[p.grupo];
    if (!t) return { C: null, T: null };
    const k = Math.max(0, L.VELOCIDADES.indexOf(Number(vel)));
    const lim = (lista) => {
      if (!lista || lista[k] === null || lista[k] === undefined) return null;
      return { sup: lista[k], inf: t.inferior !== undefined ? t.inferior : -lista[k] };
    };
    return { C: lim(t.curva), T: lim(t.tangente) };
  };

  /** Limites de um parâmetro: { alerta: { C, T }, restricao: { C, T }, interdicao: { C, T } }. */
  L.de = (p, vel) => {
    const e = L.edicoes()[vel] && L.edicoes()[vel][p.id];
    const padrao = { alerta: { C: null, T: null }, restricao: L.padrao(p, vel), interdicao: { C: null, T: null } };
    if (!e) return padrao;
    if (e.C !== undefined || e.T !== undefined) return { ...padrao, restricao: { C: e.C, T: e.T } }; // formato antigo
    return { alerta: e.alerta || padrao.alerta, restricao: e.restricao || padrao.restricao, interdicao: e.interdicao || padrao.interdicao };
  };

  /** Grau do excesso do valor v no elemento el ('C' / 'T'): 0 dentro; 1 alerta; 2 restrição; 3 interdição. */
  L.grau = (lims, el, v) => {
    let g = 0;
    L.NIVEIS.forEach((n) => { const l = lims[n.id][el]; if (l && (v > l.sup || v < l.inf)) g = Math.max(g, n.grau); });
    return g;
  };

  /** Níveis preenchidos de um parâmetro num elemento: [{ grau, nome, sup, inf }]. */
  L.niveis = (id, el, vel = L.velocidade()) => {
    const p = L.parametro(id);
    if (!p) return [];
    const lims = L.de(p, vel);
    return L.NIVEIS.map((n) => (lims[n.id] && lims[n.id][el] ? { grau: n.grau, nome: n.nome, sup: lims[n.id][el].sup, inf: lims[n.id][el].inf } : null)).filter(Boolean);
  };

  /**
   * Função de limites para os Alertas de geometria, com os níveis já calculados (uma vez por parâmetro e elemento).
   * Retorna (id, el) → [{ grau, nome, sup, inf }]; el: 'C' curva, 'T' tangente (RH usa a tangente).
   */
  L.funcaoLimites = (vel = L.velocidade()) => {
    const cache = {};
    return (id, el) => {
      const k = `${id}|${el}`;
      if (!cache[k]) cache[k] = L.niveis(id, el === 'C' ? 'C' : 'T', vel);
      return cache[k];
    };
  };

  App.limites = L;
})(window.App);
