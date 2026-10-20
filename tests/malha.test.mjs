/* Testes da malha (EH/RH) usada na Rota. Rodar: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function carregar() {
  const ctx = { console, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx;
  ctx.window.App = {};
  vm.createContext(ctx);
  ['util.js', 'malha.js'].forEach((f) => vm.runInContext(readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8'), ctx));
  return ctx.App.malha;
}
const M = carregar();
const j = (x) => JSON.parse(JSON.stringify(x));

// Linha tronco inventada: EH 48, 49 e 50 nas linhas 1 e 2 (EH 48 só na linha 1), com pátios entre eles.
const el = (ramal, linha, eh, ini, fim) => ({ ramal, linha: String(linha), eh: String(eh), ini, fim, tipo: 'T' });
const planta = {
  elementos: [
    el('LT', 1, 48, 0, 4000), el('LT', 1, 48, 4000, 7000),
    el('LT', 1, 49, 7260, 9000), el('LT', 1, 49, 9000, 14000),
    el('LT', 2, 49, 7260, 14000),
    el('LT', 1, 50, 14300, 21000), el('LT', 2, 50, 14300, 21000),
    el('FA', 1, '09I', 0, 1000), el('FA', 1, '09V', 1200, 2000),
    el('LT', 1, '', 21000, 21100) // sem EH: ignorado
  ]
};

test('monta EH e RH em ordem de km, com as linhas de cada um', () => {
  const m = M.montar(planta);
  assert.deepEqual(j(m.ramais.map((r) => r.ramal)), ['LT', 'FA']);
  const lt = m.ramais[0];
  assert.deepEqual(j(lt.unidades.map((u) => u.rotulo)), ['EH 48/49', 'RH-49', 'EH 49/50', 'RH-50', 'EH 50/51']);
  assert.deepEqual(j(lt.unidades.map((u) => u.linhas)), [['1'], ['1', '2'], ['1', '2'], ['1', '2'], ['1', '2']]);
  const rh = lt.unidades[1];
  assert.equal(rh.ini, 7000);
  assert.equal(rh.fim, 7260);
  assert.equal(rh.curto, '49');
  assert.deepEqual(j(lt.linhas), ['1', '2']);
  // ramal com EH não numérico
  assert.deepEqual(j(m.ramais[1].unidades.map((u) => u.rotulo)), ['EH 09I', 'RH 09I/09V', 'EH 09V']);
});

test('intervalo, extensão, resumo e descrição dos trechos', () => {
  const m = M.montar(planta);
  const [eh48, , eh49, rh50, eh50] = m.ramais[0].unidades.map((u) => u.id);
  // de EH 48/49 até EH 50/51 na linha 2: EH 48/49 não tem linha 2
  const t = M.intervalo(m, eh50, eh48, '2');
  assert.equal(t.length, 4);
  assert.equal(t[0], M.trecho(m.ramais[0].unidades[1].id, '2'));
  assert.equal(M.extensao(m, t), 260 + 6740 + 300 + 6700);
  assert.equal(M.resumo(m, t), 'LT: RH-49 → EH 50/51');
  assert.equal(M.descrever(m, M.trecho(rh50, '1')), 'LT · RH-50 · L1');
  assert.equal(M.descrever(m, M.trecho(eh49, '2')), 'LT · EH 49/50 · L2');
  assert.deepEqual(j(M.separar('LT:EH:49@2')), { id: 'LT:EH:49', linha: '2', tv: '' });
  assert.equal(M.fmtKm(326935.4), '326+935');
});

test('travessão: código, descrição e sem extensão (troca de linha no pátio)', () => {
  const m = M.montar(planta);
  const rh = m.ramais[0].unidades[3]; // RH-50
  const tv = M.travessao(rh.id, 'D', '1', '2');
  assert.equal(tv, `${rh.id}#TVD@1-2`);
  assert.deepEqual(j(M.separar(tv)), { id: rh.id, linha: '1-2', tv: 'D' });
  assert.equal(M.ehTravessao(tv), true);
  assert.equal(M.ehTravessao(M.trecho(rh.id, '1')), false);
  assert.equal(M.descrever(m, tv), 'LT · RH-50 · travessão L1→L2');
  assert.equal(M.descrever(m, M.travessao(rh.id, 'E', '1', '2')), 'LT · RH-50 · travessão L2→L1');
  assert.equal(M.extensao(m, [tv, M.trecho(rh.id, '1')]), 300);
});
