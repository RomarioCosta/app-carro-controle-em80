/* Testes da análise do arquivo do carro controle. Rodar: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { gerarCSV } from './csv-sintetico.mjs';

function carregar() {
  const ctx = { console, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx;
  ctx.window.App = {};
  vm.createContext(ctx);
  ['util.js', 'bitola.js'].forEach((f) => vm.runInContext(readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8'), ctx));
  return ctx.App.bitola;
}
const B = carregar();
const j = (x) => JSON.parse(JSON.stringify(x));

test('lê o CSV: posição em metros, valores ausentes e eventos', () => {
  const a = B.lerCSV(gerarCSV());
  assert.equal(a.pos.length, 4000);
  assert.equal(a.pos[0], 2500);
  assert.equal(a.pos[1], 2499.75);
  assert.equal(a.meta.ramal, 'TST');
  assert.equal(a.meta.sentido, 'D');
  assert.ok(Number.isNaN(a.dados.curv[7]));
  assert.equal(a.dados.bitF[0], 3);
  assert.deepEqual(j(a.eventos.map((e) => e.texto)), ['REAR DESK ON', 'INICIO AMV']);
});

test('arquivo inválido dá erro claro', () => {
  assert.throws(() => B.lerCSV('qualquer;coisa\n1;2'), /Cabeçalho/);
});

test('km formatado como km+metros', () => {
  assert.equal(B.fmtKm(328364), '328+364');
  assert.equal(B.fmtKm(326004.75), '326+005');
  assert.equal(B.fmtKm(1999.8), '2+000');
});

test('divide em tangentes e curvas na ordem da inspeção', () => {
  const a = B.lerCSV(gerarCSV());
  const els = B.segmentar(a.pos, a.dados.curv);
  assert.deepEqual(j(els.map((e) => e.sigla)), ['T01', 'C01', 'T02', 'C02']);
  // A suavização desloca as transições em poucos metros (curvas reais têm espirais).
  [300, 200, 300, 200].forEach((esperado, k) => assert.ok(Math.abs(els[k].extensao - esperado) <= 10, `${els[k].sigla}: ${els[k].extensao}`));
  assert.equal(els[1].nome, 'Curva 01');
});

test('trechos curtos são unidos ao vizinho', () => {
  const pos = Float64Array.from({ length: 2000 }, (_, i) => 1000 - i * 0.25);
  const curv = Float64Array.from({ length: 2000 }, (_, i) => (i >= 800 && i < 830 ? 20 : 0)); // 7,5 m de "curva"
  const els = B.segmentar(pos, curv, { comprimentoMin: 20 });
  assert.deepEqual(j(els.map((e) => e.sigla)), ['T01']);
});

test('perda de bitola por elemento e OGMS × KLD', () => {
  const a = B.lerCSV(gerarCSV());
  const r = B.analisar(a);
  const t02 = r.elementos.find((e) => e.sigla === 'T02');
  assert.ok(Math.abs(t02.pctPerda - (50 / t02.extensao) * 100) < 1, `perda T02 = ${t02.pctPerda}`);
  assert.equal(r.elementos.find((e) => e.sigla === 'T01').pctPerda, 0);
  assert.ok(Math.abs(r.elementos.find((e) => e.sigla === 'C01').raioMedio - 500) < 30);
  assert.ok(Math.abs(r.geral.difKldMedia - 1) < 1e-9);
  assert.equal(r.curvas.quantidade, 2);
  assert.ok(Math.abs(r.geral.pctPerda - 5) < 0.2);
});

test('ranking separa picos e indica o elemento', () => {
  const a = B.lerCSV(gerarCSV());
  const r = B.analisar(a);
  const rk = B.ranking(a, r.elementos, 'nl20', { limite: 3 });
  assert.equal(rk[0].valor, -12);
  assert.equal(rk[0].km, '1+700');
  assert.equal(rk[0].elemento, 'C02');
  assert.equal(rk[1].valor, 9);
  assert.equal(rk[1].elemento, 'T01');
  assert.ok(Math.abs(rk[2].pos - rk[0].pos) >= 10 && Math.abs(rk[2].pos - rk[1].pos) >= 10);
});

test('índice mais próximo em posições decrescentes', () => {
  const pos = Float64Array.from([10, 9.75, 9.5, 9.25]);
  assert.equal(B.indicePerto(pos, 9.6), 2);
  assert.equal(B.indicePerto(pos, 20), 0);
  assert.equal(B.indicePerto(pos, 0), 3);
});

/* ---------------- Planta da linha (dados inventados) ---------------- */
// Coordenadas da planta = posição do arquivo + 30 m. RH (pátio, sem elemento) entre 1+730 e 1+760.
function plantaSintetica() {
  return [
    ['PLANTA DA LINHA — TESTE'],
    ['Ramal', 'Linha', 'Eh', 'C/T', 'Lado curva', 'Nº Elemento Eh', 'Quilometragem', '', 'Raio', 'Superelevação'],
    ['', '', '', '', '', '', 'Inicial', 'Final', '', ''],
    ['TST', 1, 10, 'C', 'E', 1, 1.530, 1.730, 667, 80],
    ['TST', 1, 11, 'T', '', 1, 1.760, 2.030, '', ''],
    ['TST', 1, 11, 'C', 'D', 1, 2.030, 2.230, 500, 100],
    ['TST', 1, 11, 'T', '', 2, 2.230, 2.531, '', ''],
    ['TST', 2, 10, 'T', '', 1, 2.000, 3.000, '', ''],
    ['LT', 1, 50, 'T', '', 1, 'x', 1, '', ''] // km inválido: ignorada com aviso
  ];
}

test('lê a planta: cabeçalho em duas linhas, km em metros, ramais e linhas', () => {
  const p = B.lerPlanta(plantaSintetica());
  assert.equal(p.elementos.length, 5);
  assert.deepEqual(j(p.ramais), { TST: ['1', '2'] });
  assert.equal(p.avisos.length, 1);
  const c = p.elementos[0];
  assert.equal(c.ini, 1530);
  assert.equal(c.fim, 1730);
  assert.equal(c.tipo, 'C');
  assert.equal(c.lado, 'E');
  assert.equal(c.eh, '10');
  assert.equal(c.raio, 667);
  assert.equal(B.ramalDaPlanta('RTST', p.ramais), 'TST');
  assert.equal(B.elementosDaPlanta(p, 'TST', 1).length, 4);
});

test('planta sem cabeçalho dá erro claro', () => {
  assert.throws(() => B.lerPlanta([['a', 'b'], [1, 2]]), /cabeçalho da planta/);
});

test('ajuste automático do km encontra o deslocamento da planta', () => {
  const a = B.lerCSV(gerarCSV());
  const els = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  const r = B.ajusteAutomatico(a.pos, a.dados.curv, els);
  assert.ok(Math.abs(r.ajuste - 30) <= 6, `ajuste = ${r.ajuste}`);
  assert.ok(r.acerto > 95, `acerto = ${r.acerto}`);
});

test('elementos pela planta: trechos EH x/y, RH entre eles e linha', () => {
  const a = B.lerCSV(gerarCSV());
  const els = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  const r = B.analisar(a, { modo: 'planta', elementosPlanta: els, ajusteKm: 30 });
  assert.equal(r.modo, 'planta');
  assert.deepEqual(j(r.elementos.map((e) => e.sigla)), ['T02', 'C01', 'T01', 'RH', 'C01']);
  assert.deepEqual(j(r.elementos.map((e) => e.eh)), ['EH 11/12', 'EH 11/12', 'EH 11/12', 'RH-11', 'EH 10/11']);
  assert.equal(r.elementos[1].nome, 'EH 11/12 · Curva 01');
  assert.equal(r.elementos[0].linha, '1');
  assert.ok(Math.abs(r.elementos[3].extensao - 30) <= 0.5);
  assert.deepEqual(j(r.porEh.map((g) => [g.eh, g.tangentes, g.curvas])), [['EH 11/12', 2, 1], ['RH-11', 0, 0], ['EH 10/11', 0, 1]]);
  // A perda (50 m dentro da tangente do meio) fica toda nela.
  assert.equal(r.elementos[2].perdas, 200);
  assert.equal(r.elementos[0].perdas + r.elementos[1].perdas + r.elementos[4].perdas, 0);
  assert.equal(r.porEh[0].perdas, 200);
  assert.equal(r.porEh[0].pior.sigla, 'T01'); // elemento com maior perda do trecho
  assert.equal(r.porEh[1].pior.sigla, 'RH');
});

test('nomes dos trechos: EH com o próximo da planta e RH pelo EH acima', () => {
  const els = [
    { eh: '38', ini: 0, fim: 100 }, { eh: '40', ini: 360, fim: 500 }, { eh: '41', ini: 760, fim: 900 }
  ];
  const n = B.nomesTrechos(els);
  assert.equal(n.eh('38'), 'EH 38/40');
  assert.equal(n.eh('41'), 'EH 41/42');
  assert.equal(n.rh(200), 'RH-40');
  assert.equal(n.rh(600), 'RH-41');
  assert.equal(n.rh(1000), 'RH-42');
});

test('desvio padrão em 1 m marca a variação rápida', () => {
  const arr = Float64Array.from({ length: 40 }, (_, i) => (i === 20 ? 10 : 0));
  const s = B.desvioMovel(arr, 5);
  assert.equal(s[0], 0);
  assert.ok(s[20] > 3.9 && s[20] < 4.1, `σ = ${s[20]}`); // 5 pontos: um com 10 → σ = 4
  assert.equal(s[25], 0);
  // Bitola T cai 3 mm em degrau: σ em 1 m (5 pontos) ≈ 1,47 mm — abaixo de 1,5, acima de 1.
  const a = B.lerCSV(gerarCSV());
  assert.equal(B.analisar(a).geral.pctVariacao, 0);
  const r = B.analisar(a, { limiteVariacao: 1 });
  assert.ok(r.geral.pctVariacao > 0 && r.geral.pctVariacao < 0.5, `var = ${r.geral.pctVariacao}`);
});

test('offset: aplicado numa bitola e melhor valor que zera a perda', () => {
  const a = B.lerCSV(gerarCSV());
  const ajustado = B.dadosComOffset(a.dados, { bitola: 'bitT', valor: 3 });
  assert.equal(ajustado.bitT[0], 6);
  assert.equal(a.dados.bitT[0], 3); // original não muda
  assert.equal(B.dadosComOffset(a.dados, { bitola: 'bitT', valor: 0 }), a.dados);
  const antes = B.perdaTotal(a.dados, 2);
  assert.equal(antes.perdas, 200);
  const m = B.melhorOffset(a.dados, 'bitT', 2);
  assert.equal(m.valor, 1);
  assert.equal(m.perdas, 0);
  const r = B.analisar(a, { offset: { bitola: 'bitT', valor: 1.5, aplicar: true } });
  assert.equal(r.geral.perdas, 0);
});

test('curvatura + planta: limites medidos, nomes da planta e RH fora da estatística', () => {
  const a = B.lerCSV(gerarCSV());
  const els = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  const r = B.analisar(a, { modo: 'hibrido', elementosPlanta: els, ajusteKm: 30 });
  assert.equal(r.modo, 'hibrido');
  assert.deepEqual(j(r.elementos.map((e) => e.sigla)), ['T02', 'C01', 'T01', 'RH', 'C01']);
  assert.deepEqual(j(r.elementos.map((e) => e.eh)), ['EH 11/12', 'EH 11/12', 'EH 11/12', 'RH-11', 'EH 10/11']);
  // a curva C01 do EH 11/12 tem os limites da curvatura medida (200 m), com a suavização de poucos metros
  assert.ok(Math.abs(r.elementos[1].extensao - 200) <= 12, `C01 = ${r.elementos[1].extensao}`);
  // RH-11 (30 m = 120 pontos) fica fora da estatística geral
  const rh = r.elementos[3];
  assert.ok(rh.pontos > 100);
  assert.equal(r.geral.pontos, 4000 - rh.pontos);
  assert.equal(r.geral.perdas, 200);
  assert.ok(Math.abs(r.geral.extensaoRh - 30) <= 1);
  assert.equal(B.perdaTotal(a.dados, 2, 0, 3999, r.mascara).pontos, r.geral.pontos);
});

test('conferência do ramal pelas curvas (ramais com o mesmo km)', () => {
  const a = B.lerCSV(gerarCSV());
  const certo = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  const errado = [{ ramal: 'OUT', linha: '1', eh: '1', tipo: 'T', ini: 1000, fim: 3000 }]; // mesmo km, sem curvas
  const c1 = B.compatibilidade(a.pos, a.dados.curv, certo);
  const c2 = B.compatibilidade(a.pos, a.dados.curv, errado);
  assert.ok(c1.nota >= 90, `certo = ${c1.nota}`);
  assert.equal(c2.nota, 0);
  assert.ok(Math.abs(c1.ajuste - 30) <= 10);
  assert.equal(B.ramalDaPlanta('RTU', { TU: ['1'], LT: ['1'] }), 'TU');
  assert.equal(B.ramalDaPlanta('RLT', { TU: ['1'], LT: ['1'] }), 'LT');
});

test('linha do arquivo muda ou é texto (TESTE01): EH e elemento continuam pelo km', () => {
  const a = B.lerCSV(gerarCSV());
  assert.deepEqual(j(a.linhasValores), ['1']);
  // metade do arquivo com a coluna LINHA = "TESTE01"
  a.linhasValores = ['1', 'TESTE01'];
  a.linhaIdx = Uint16Array.from(a.pos, (_, i) => (i >= 2400 ? 1 : 0)); // muda no meio da T01
  const planta = B.lerPlanta(plantaSintetica());
  const localizar = B.localizador(planta, 'TST', a, '1');
  const els = B.elementosDaPlanta(planta, 'TST', '1');
  const r = B.analisar(a, { modo: 'planta', elementosPlanta: els, localizar, ajusteKm: 30 });
  assert.deepEqual(j(r.elementos.map((e) => e.sigla)), ['T02', 'C01', 'T01', 'RH', 'C01']);
  assert.deepEqual(j(r.elementos.map((e) => e.linha)), ['1', '1', 'TESTE01 / 1', 'TESTE01', 'TESTE01']);
  assert.equal(r.elementos[4].eh, 'EH 10/11');
  assert.equal(B.linhaDaPlanta('L2', ['1', '2']), '2');
  assert.equal(B.linhaDaPlanta('02', ['1', '2']), '2');
  assert.equal(B.linhaDaPlanta('TESTE01', ['1', '2']), null);
  assert.equal(B.linhaDaPlanta('3', ['1', '2']), null);
});

/* ---------------- Regra da perda de bitola ---------------- */

const arquivoSimples = (difs, { pos = null } = {}) => {
  const n = difs.length;
  const p = pos || Float64Array.from({ length: n }, (_, i) => 1000 - i * 0.25);
  const t = new Float64Array(n).fill(0.7);
  const f = Float64Array.from(difs, (d) => (Number.isNaN(d) ? NaN : 0.7 + d));
  const vazio = () => new Float64Array(n).fill(0);
  return { pos: p, eventos: [], meta: {}, dados: { bitF: f, bitT: t, kld: new Float64Array(n).fill(NaN), curv: vazio(), alr10: vazio() } };
};

test('perda: diferença arredondada a 0,01 mm; exatamente 2,00 mm não é perda', () => {
  assert.equal(4.03 - 2.03 > 2, true); // a conta "crua" dá 2,0000000000000004 e erraria
  assert.equal(B.difBitola(4.03, 2.03), 2);
  assert.equal(B.ehPerda(B.difBitola(4.03, 2.03), 2), false);
  assert.equal(B.ehPerda(B.difBitola(2.71, 0.7), 2), true);
  assert.equal(B.ehPerda(B.difBitola(0.7, 2.71), 2), true); // em módulo
  assert.equal(B.ehPerda(B.difBitola(NaN, 0.7), 2), false);
  const r = B.avaliarPerda({ bitF: Float64Array.of(2.7, 2.71, NaN, 0.7), bitT: Float64Array.of(0.7, 0.7, 0.7, 0.7) }, 2);
  assert.deepEqual(j({ pontos: r.pontos, perdas: r.perdas }), { pontos: 3, perdas: 1 }); // sem leitura não conta
});

test('perda: % = pontos acima ÷ total de pontos; geral = tangentes + curvas; regra dos 10%', () => {
  const a = B.lerCSV(gerarCSV());
  const r = B.analisar(a);
  assert.equal(r.geral.pontos, 4000); // todos os pontos do arquivo
  assert.equal(r.geral.perdas, 200);
  assert.equal(r.geral.pctPerda, 5);
  assert.equal(r.geral.perdas, r.tangentes.perdas + r.curvas.perdas);
  assert.equal(r.geral.pontos, r.tangentes.pontos + r.curvas.pontos);
  const t02 = r.elementos.find((e) => e.sigla === 'T02');
  assert.ok(Math.abs(t02.pctPerda - (200 / t02.pontos) * 100) < 1e-9);
  // T02 tem ~16,7% de perda (> 10%): perdeu a bitola; as outras não
  assert.equal(t02.perdeu, true);
  assert.equal(r.tangentes.comPerda, 1);
  assert.equal(r.curvas.comPerda, 0);
  assert.equal(B.analisar(a, { limiteElemento: 20 }).tangentes.comPerda, 0);
  assert.equal(B.elementoPerdeu(10, 10), false); // exatamente 10% não perdeu
  assert.equal(B.elementoPerdeu(10.01, 10), true);
  const m = B.melhorOffset(a.dados, 'bitT', 2);
  const depois = B.avaliarPerda(B.dadosComOffset(a.dados, { bitola: 'bitT', valor: m.valor }), 2);
  assert.ok(Math.abs(depois.pct - m.pct) < 1e-9);
  assert.equal(depois.perdas, 0);
});

test('só curvatura com planta: elementos iguais, com EH/RH e elemento da planta pelo km', () => {
  const a = B.lerCSV(gerarCSV());
  const els = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  const pura = B.analisar(a);
  const r = B.analisar(a, { modo: 'curvatura', elementosPlanta: els, ajusteKm: 30 });
  assert.equal(r.modo, 'curvatura');
  assert.equal(r.comLocais, true);
  // mesmos elementos (limites do raio); a numeração recomeça em cada EH/RH
  assert.deepEqual(j(r.elementos.map((e) => [e.i0, e.i1])), j(pura.elementos.map((e) => [e.i0, e.i1])));
  assert.deepEqual(j(r.elementos.map((e) => e.sigla)), ['T01', 'C01', 'T02', 'C01']);
  // EH (o de mais pontos) e elemento da planta a que o km pertence
  assert.deepEqual(j(r.elementos.map((e) => e.eh)), ['EH 11/12', 'EH 11/12', 'EH 11/12', 'EH 10/11']);
  assert.deepEqual(j(r.elementos.map((e) => e.elementoPlanta.split(' · ')[0])), ['T02', 'C01', 'T01', 'C01']);
  assert.ok(r.elementos[3].trecho.startsWith('RH-11'), r.elementos[3].trecho); // atravessa o circuito
  // o circuito (30 m) sai das estatísticas
  assert.ok(Math.abs(r.geral.extensaoRh - 30) <= 1);
  assert.equal(r.geral.perdas, 200);
  assert.ok(r.geral.pontos < pura.geral.pontos);
  assert.equal(r.porEh.length >= 2, true);
});

test('dupla checagem: recontagem independente do CSV bate com a análise e acusa divergência', () => {
  const texto = gerarCSV();
  const a = B.lerCSV(texto);
  const r = B.analisar(a);
  const c = B.conferir(texto, r, 2);
  assert.equal(c.ok, true, JSON.stringify(c.divergencias));
  assert.equal(c.linhas, 4000);
  assert.equal(c.perdasElementos, 200);
  // se a análise tivesse contado errado, a conferência mostra o elemento
  r.elementos[2].perdas += 1;
  const c2 = B.conferir(texto, r, 2);
  assert.equal(c2.ok, false);
  assert.equal(c2.divergencias[0].sigla, r.elementos[2].sigla);
  // com planta e circuito, também confere
  const els = B.elementosDaPlanta(B.lerPlanta(plantaSintetica()), 'TST', '1');
  for (const modo of ['curvatura', 'hibrido', 'planta']) {
    const rp = B.analisar(a, { modo, elementosPlanta: els, ajusteKm: 30 });
    assert.equal(B.conferir(texto, rp, 2).ok, true, modo);
    // cartões = tangentes + curvas = pontos marcados na estatística (mesma conta da planilha)
    assert.equal(rp.geral.pontos, rp.tangentes.pontos + rp.curvas.pontos, modo);
    assert.equal(rp.geral.perdas, rp.tangentes.perdas + rp.curvas.perdas, modo);
    let naEst = 0; rp.mascara.forEach((v, i) => { if (v && !Number.isNaN(B.difBitola(a.dados.bitF[i], a.dados.bitT[i]))) naEst++; });
    assert.equal(naEst, rp.geral.pontos, modo);
  }
});

test('dupla checagem com km que volta (correção de km no meio da inspeção): sem falsa divergência', () => {
  // a partir do ponto 2000 o km "volta" 50 m (ex.: 231+200 → 231+250), como num ajuste de km em campo
  let k = 0;
  const texto = gerarCSV().split('\r\n').map((l) => {
    const c = l.split(';');
    if (c[0] !== 'D') return l;
    if (k++ >= 2000) {
      const pos = Number(c[7]) * 1000 + Number(c[9]) + 50;
      c[7] = String(Math.floor(pos / 1000)); c[9] = `${(pos - Math.floor(pos / 1000) * 1000).toFixed(2)}  `;
    }
    return c.join(';');
  }).join('\r\n');
  const a = B.lerCSV(texto);
  const r = B.analisar(a);
  const c = B.conferir(texto, r, 2);
  assert.equal(c.ok, true, JSON.stringify(c.divergencias));
  assert.equal(c.voltas.length, 1);
  assert.equal(c.linhas, 4000);
  // vírgula decimal também é lida pela análise
  assert.equal(B.lerCSV(texto.replace(/(;\s*)3\.00(\s*;)/, '$13,00$2')).dados.bitF.some((v) => v === 3), true);
});

test('formato novo do CSV: ALv_B2,5, NLmax_10 e AL10mean reconhecidos; sem ALR10 não quebra', () => {
  const texto = gerarCSV().replace('VAL_B2,5', 'ALv_B2,5').replace('ALR10_10', 'AL10mean').replace('ALR10_20', 'NLmax_10');
  const a = B.lerCSV(texto);
  assert.ok(a.dados.val25.some((v) => !Number.isNaN(v)), 'ALv_B2,5');
  assert.ok(a.dados.al10mean.some((v) => !Number.isNaN(v)), 'AL10mean');
  assert.ok(a.dados.nl10.some((v) => !Number.isNaN(v)), 'NLmax_10');
  assert.ok(a.dados.alr10.every((v) => Number.isNaN(v)));
  const r = B.analisar(a);
  assert.equal(r.geral.perdas, 200);
});

test('elementos pelo raio: oscilação na tangente e curva aberta com ruído não fragmentam; curva reversa separa', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ruido = () => (rnd() - 0.5) * 4;
  const n = 8000; // 2 km a cada 0,25 m
  const pos = Float64Array.from({ length: n }, (_, i) => 100000 + i * 0.25);
  const curv = Float64Array.from({ length: n }, (_, i) => {
    const d = i * 0.25;
    if (d >= 600 && d < 900) return 10000 / 2500 + ruido(); // curva aberta (R 2.500 m) com ruído
    if (d >= 1300 && d < 1500) return 25 + ruido(); // curva à direita…
    if (d >= 1500 && d < 1700) return -25 + ruido(); // …seguida de curva à esquerda (reversa)
    return 5 * Math.sin((2 * Math.PI * d) / 30) + ruido(); // tangente com oscilação de 5 (período 30 m)
  });
  const els = B.segmentar(pos, curv);
  assert.deepEqual(j(els.map((e) => e.tipo)), ['T', 'C', 'T', 'C', 'C', 'T']);
  assert.ok(Math.abs(els[1].extensao - 300) <= 25, `curva aberta: ${els[1].extensao}`);
  assert.equal(els[3].lado === els[4].lado, false);
  // km que volta no meio (correção em campo) não aumenta a extensão
  const pos2 = Float64Array.from(pos, (p, i) => (i >= 2000 ? p - 50 : p));
  const els2 = B.segmentar(pos2, curv);
  assert.equal(els2.length, els.length);
  assert.ok(Math.abs(els2.reduce((s, e) => s + e.extensao, 0) - 2000) < 2);
});

test('geometria do carro controle: lida como planta (RH fora, nome do EH pronto, ramal sem o R)', () => {
  const linhas = [
    [],
    ['', 'ramal', 'ga', 'sede', 'elemento', 'nomenclatura', 'tipo_ativo', 'sentido', 'km_inicial', 'km_final', 'ext', 'raio', 'grau', 'index_elemento', 'rh_eh', 'Plano_de_Regra', 'eh_linha', 'trecho'],
    ['', 'RTS', 'VP1', 'X', 'RH-11', 'RH-11 L1', 'RH', '', 1000, 1250, 250, '', '', 1, 'RH-11 L1', 65, '10/11 L1', ''],
    ['', 'RTS', 'VP1', 'X', 'TANGENTE 1', '11/13 L1 - TANGENTE 1', 'TANGENTE', '', 1250, 1600, 350, '', '', 2, '11/13 L1', 65, '11/13 L1', ''],
    ['', 'RTS', 'VP1', 'X', 'CURVA 1', '11/13 L1 - CURVA 1', 'CURVA', 'Direita', 1600, 1800, 200, 500, 2, 3, '11/13 L1', 65, '11/13 L1', ''],
    ['', 'RTS', 'VP1', 'X', 'TANGENTE 2', '11/13 L1 - TANGENTE 2', 'TANGENTE', '', 1800, 2300, 500, '', '', 4, '11/13 L1', 65, '11/13 L1', '']
  ];
  const g = B.lerPlanta(linhas);
  assert.equal(g.fonte, 'geometria');
  assert.equal(g.elementos.length, 3);
  assert.equal(g.circuitos, 1);
  assert.deepEqual(j(g.ramais), { TS: ['1'] });
  const c = g.elementos[1];
  assert.deepEqual([c.tipo, c.lado, c.num, c.ini, c.fim, c.raio, c.eh, c.nomeEh], ['C', 'D', '1', 1600, 1800, 500, '11', 'EH 11/13']);
  // pelo km: nomes do EH vindos da geometria; antes do 1º elemento é circuito (RH)
  const pos = Float64Array.from({ length: 4800 }, (_, i) => 1100 + i * 0.25);
  const els = B.segmentarPorPlanta(pos, B.elementosDaPlanta(g, 'TS', '1'));
  assert.deepEqual(j(els.map((e) => `${e.sigla}@${e.eh}`)), ['RH@RH-11', 'T01@EH 11/13', 'C01@EH 11/13', 'T02@EH 11/13']);
});

test('correção do km ponto a ponto: odômetro que escorrega e km acertado em campo', () => {
  // planta inventada: curvas de 300 m a cada 1.000 m, lados alternados
  const els = [];
  for (let k = 0; k < 12; k++) {
    els.push({ ramal: 'X', linha: '1', eh: '1', tipo: 'T', lado: '', num: String(k + 1), ini: k * 1000, fim: k * 1000 + 700 });
    els.push({ ramal: 'X', linha: '1', eh: '1', tipo: 'C', lado: k % 2 ? 'E' : 'D', num: String(k + 1), ini: k * 1000 + 700, fim: k * 1000 + 1000 });
  }
  // carro: anda 12 km reais, mas o odômetro marca 2% a menos; no km real 6.000 o km é acertado em campo
  const pos = []; const curv = []; const real = [];
  for (let r = 0; r < 12000; r += 0.25) {
    const odo = r < 6000 ? 30 + r * 0.98 : r - 40 + (r - 6000) * -0.02; // começa 30 m à frente; depois do acerto, −40 m
    pos.push(odo); real.push(r);
    const e = els.find((x) => r >= x.ini && r < x.fim);
    curv.push(e.tipo === 'C' ? (e.lado === 'D' ? 20 : -20) : 0);
  }
  const v = B.ajusteVariavel(Float64Array.from(pos), Float64Array.from(curv), els);
  assert.ok(v.casadas >= 10, `casadas ${v.casadas}`);
  // erro da correção em cada curva casada: até 15 m
  v.ancoras.forEach((a) => assert.ok(Math.abs(pos[a.i] + a.ajuste - real[a.i]) <= 15, `${pos[a.i]}: ${a.ajuste}`));
  // com uma correção única, o erro passaria de 100 m em algum ponto
  assert.ok(v.max - v.min > 100);
});

test('trecho analisado: recorta pelo km sem editar o CSV e a conferência acompanha', () => {
  assert.equal(B.kmParaMetros('290'), 290000);
  assert.equal(B.kmParaMetros('290+500'), 290500);
  assert.equal(B.kmParaMetros('290,5'), 290500);
  assert.equal(B.kmParaMetros(''), null);
  assert.equal(B.kmParaMetros('abc'), null);
  const texto = gerarCSV();
  const a = B.lerCSV(texto);
  const de = a.pos[0] + 300; const ate = a.pos[0] + 700; // posições crescentes no CSV sintético
  const lo = Math.min(de, ate); const hi = Math.max(de, ate);
  const r = B.recortar(a, lo, hi);
  assert.ok(r.pos.every((p) => p >= lo && p <= hi));
  assert.equal(r.pos.length + r.recorte.descartados, a.pos.length);
  assert.equal(r.dados.bitF.length, r.pos.length);
  const res = B.analisar(r);
  const c = B.conferir(texto, res, 2, { de: lo, ate: hi });
  assert.equal(c.ok, true, JSON.stringify(c.divergencias.slice(0, 2)));
  assert.equal(c.linhas, r.pos.length);
  assert.equal(B.recortar(a, null, null), a);
});

test('aviso de arquivo alterado (números multiplicados ao salvar no Excel)', () => {
  const linhas = gerarCSV().split('\r\n');
  const cab = linhas.find((l) => l.startsWith('H;')).split(';').map((x) => x.trim());
  const iF = cab.indexOf('Bitola F');
  const alterado = linhas.map((l) => {
    if (!l.startsWith('D;')) return l;
    const c = l.split(';'); const v = Number(c[iF]); if (Number.isFinite(v)) c[iF] = String(v * 100); return c.join(';');
  }).join('\r\n');
  assert.ok(B.lerCSV(alterado).avisos.some((a) => a.includes('Excel')));
  assert.ok(!B.lerCSV(gerarCSV()).avisos.some((a) => a.includes('Excel')));
});
