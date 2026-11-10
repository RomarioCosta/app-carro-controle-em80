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

test('telas da Rota: Linha Tronco até a 86, Fábrica, BH e Itabira (com Conceição e João Paulo)', () => {
  const e = (ramal, linha, eh, ini, fim, nomeEh) => ({ ramal, linha: String(linha), eh: String(eh), ini, fim, tipo: 'T', nomeEh });
  const p = { elementos: [
    e('LT', 1, 75, 0, 1000, 'EH 75/76'), e('LT', 1, 76, 1100, 2000, 'EH 76/77'),
    e('FA', 1, 77, 0, 1000, 'EH 77/78'), e('FA', 1, 85, 1100, 2000, 'EH 85/86'), e('FA', 1, 86, 2100, 3000, 'EH 86/09I'),
    e('FA', 1, '09I', 3100, 4000, 'EH 09I/09V'), e('FA', 1, '19I', 9000, 9500, 'EH 19I/19V'),
    e('BH', 1, 86, 0, 1000, 'EH 86/201'), e('BH', 1, '210V', 5000, 6000, 'EH 210V/ALC'),
    e('IT', 1, 77, 500000, 501000, 'EH 77/90'), e('CE', 1, 'RCE', 0, 500, 'EH RCE'), e('JP', 1, 'RJP', 0, 400, 'EH RJP'),
    e('TU', 1, 3, 0, 500, 'EH 03/04')
  ] };
  const m = M.montar(p);
  assert.deepEqual(j(m.ramais.map((r) => r.ramal)), ['LT', 'FA', 'BH', 'IT']); // TU fica de fora
  const rot = (r) => m.ramais.find((x) => x.ramal === r).unidades.map((u) => u.rotulo);
  assert.deepEqual(j(rot('LT')), ['EH 75/76', 'RH-76', 'EH 76/77', 'RH-77', 'EH 77/78', 'RH-85', 'EH 85/86', 'RH-86']);
  const lt = m.ramais.find((x) => x.ramal === 'LT').unidades;
  // RH-86: as linhas terminam na tela (seguem para Fábrica e BH)
  assert.deepEqual(j(lt.find((u) => u.id === 'LT:RH:86').textos.map((x) => x.txt)), ['Fábrica →']);
  assert.deepEqual(j(rot('FA')), ['RH-86', 'EH 86/09I', 'RH-09I', 'EH 09I/09V', 'RH-19I']);
  assert.deepEqual(j(rot('BH')), ['RH-86', 'EH 86/201', 'RH-210V']);
  assert.deepEqual(j(rot('IT')), ['RH-77', 'EH 77/90', 'Entrada de Conceição', 'Conceição', 'Entrada de João Paulo', 'João Paulo']);
  // o trecho 77 → 86 guarda o id original (FA) e aparece na tela da Linha Tronco
  assert.equal(m.indice.get('FA:EH:77').ramal.ramal, 'LT');
  assert.equal(M.resumo(m, ['FA:EH:77@1']), 'LT: EH 77/78');
});

test('Linha Tronco: começo 01–06 com L1 e L2 lado a lado e RH da geometria quando as linhas se sobrepõem', () => {
  const e = (linha, eh, ini, fim, nomeEh) => ({ ramal: 'LT', linha: String(linha), eh: String(eh), ini, fim, tipo: 'T', nomeEh });
  const rh = (linha, nome, ini, fim) => ({ ramal: 'LT', linha: String(linha), nome, ini, fim });
  const p = {
    elementos: [
      e(1, '01', 3100, 14700, 'EH 01/03'), e(2, '04', 11000, 18000, 'EH 04/06'), e(1, '03', 15500, 18000, 'EH 03/06'),
      e(1, '06', 18300, 21500, 'EH 06/07'), e(2, '06', 18300, 21500, 'EH 06/07'),
      e(1, '07', 21800, 25000, 'EH 07/08'), e(3, '07', 21790, 24000, 'EH 07/08'), e(1, '08', 25010, 26000, 'EH 08/09'), e(3, '08', 24100, 26000, 'EH 08/09')
    ],
    rhs: [rh(1, 'RH-01', 3000, 3100), rh(2, 'RH-04', 10700, 11000), rh(1, 'RH-03', 14700, 15500), rh(1, 'RH-08', 25000, 25010), rh(3, 'RH-08', 24000, 24100)]
  };
  const m = M.montar(p);
  const lt = m.ramais.find((x) => x.ramal === 'LT').unidades;
  assert.deepEqual(j(lt.slice(0, 7).map((u) => u.rotulo)), ['RH-1', 'EH 01/03', 'RH-4', 'EH 01/03 · 04/06', 'RH-3', 'EH 03/06 · 04/06', 'RH-6']);
  // as colunas do meio apontam para o EH original: o trecho continua "LT:EH:01@1", "LT:EH:04@2"
  assert.equal(M.idDe(lt[3], '1'), 'LT:EH:01');
  assert.equal(M.idDe(lt[3], '2'), 'LT:EH:04');
  assert.equal(M.idDe(lt[4], '1'), 'LT:RH:03');
  assert.equal(m.indice.get('LT:EH:04').unidade.rotulo, 'EH 04/06');
  assert.deepEqual(j(M.intervalo(m, 'LT:RH:01', 'LT:RH:03>06', '1')), ['LT:RH:01@1', 'LT:EH:01@1', 'LT:RH:03@1', 'LT:EH:03@1', 'LT:RH:03>06@1']);
  assert.equal(M.extensao(m, ['LT:EH:04@2']), 7000);
  // RH-08: a L3 do EH 08/09 começa antes do fim do 07/08; o pátio vem da geometria
  const r8 = lt.find((u) => u.rotulo === 'RH-8');
  assert.ok(r8);
  assert.deepEqual([r8.ini, r8.fim], [24000, 25010]);
});

test('Linha Tronco 75 a 86 como no painel: L3 acima da L1, linha 13 na 77, saídas para Itabira, Fábrica e BH', () => {
  const e = (ramal, linha, eh, ini, fim, nomeEh) => ({ ramal, linha: String(linha), eh: String(eh), ini, fim, tipo: 'T', nomeEh });
  const p = { elementos: [
    ...[1, 2].map((l) => e('LT', l, 74, 0, 1000, 'EH 74/75')),
    ...[1, 2, 3].flatMap((l) => [e('LT', l, 75, 1100, 2000, 'EH 75/76'), e('LT', l, 76, 2100, 3000, 'EH 76/77')]),
    ...[1, 2].flatMap((l) => [e('FA', l, 77, 300, 1000, 'EH 77/78'), e('FA', l, 85, 1100, 2000, 'EH 85/86'), e('BH', l, 86, 0, 900, 'EH 86/201'), e('IT', l, 77, 3100, 4000, 'EH 77/90')]),
    e('FA', 1, 86, 2100, 3000, 'EH 86/09I')
  ] };
  const m = M.montar(p);
  const lt = m.ramais.find((x) => x.ramal === 'LT').unidades;
  const u = (id) => lt.find((x) => x.id === id);
  assert.deepEqual(j(u('LT:EH:75').slot), { 3: -1 });
  assert.ok(u('LT:RH:74>75').via['3']); // a L3 nasce na 75, saindo da L1
  const r77 = u('LT:RH:77');
  assert.deepEqual(j(r77.livres), ['1', '2']); // L1 e L2 descem para Itabira
  assert.equal(r77.extras[0].id, 'FA:RH:77'); // linha 13: nasce no pátio e segue para a 78 como L1
  assert.equal(m.indice.get('FA:RH:77').ramal.ramal, 'LT');
  assert.equal(r77.tvs.length, 6);
  assert.deepEqual(j(u('FA:EH:77').slot), { 1: -2, 2: -1 });
  const r86 = u('LT:RH:86');
  assert.deepEqual(j(r86.textos.map((x) => x.txt)), ['Fábrica →', 'BH →']);
  assert.ok(r86.via['2']); // a L2 desce para BH
  assert.equal(M.descrever(m, M.travessao('LT:RH:77', 'D', '1', '3')), 'LT · RH-77 · travessão L1→L3');
});
