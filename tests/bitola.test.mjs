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
