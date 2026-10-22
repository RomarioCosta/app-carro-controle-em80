/* Testes da montagem dos dados (cobertura pela geometria). Rodar: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ctx = { console, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.window = ctx; ctx.window.App = {};
vm.createContext(ctx);
['util.js', 'bitola.js', 'cobertura.js'].forEach((f) => vm.runInContext(readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8'), ctx));
const C = ctx.App.cobertura;
const j = (x) => JSON.parse(JSON.stringify(x));

// Geometria: linha 1 de 0 a 10 km, sede GV I até 5 km e GV II depois; elementos de 1 km com RH de 100 m entre eles.
const elementos = [];
for (let k = 0; k < 9; k++) {
  elementos.push({ ramal: 'LT', linha: '1', ini: k * 1100, fim: k * 1100 + 1000, tipo: k % 2 ? 'C' : 'T', eh: String(k), nomeEh: `EH ${k}`, sede: k * 1100 < 5000 ? 'GV I' : 'GV II' });
}
const planta = { elementos, ramais: { LT: ['1'] } };

/** Resumo de arquivo sintético: amostras a cada 1 m de "de" a "ate", sem correção de km. */
function resumo(nome, de, ate, linha = '1') {
  const n = Math.floor(Math.abs(ate - de)) + 1; const s = ate >= de ? 1 : -1;
  return { nome, ramal: 'LT', linhaRef: linha, corretiva: 'GV1', amostras: { pos: Float64Array.from({ length: n }, (_, i) => de + s * i), aj: new Float32Array(n), linha: new Uint8Array(n), linhas: [linha] } };
}
const arq = (nome, de, ate, recorte = null) => ({ id: nome, nome, resumo: resumo(nome, de, ate), recorte });

test('sede: GV I → GV1, NE II → NE2', () => {
  assert.equal(C.normSede('GV I'), 'GV1');
  assert.equal(C.normSede('NE II'), 'NE2');
  assert.equal(C.normSede('gv1'), 'GV1');
  assert.equal(C.normSede('PV'), 'PV');
});

test('intervalos: união, subtração e interseção', () => {
  assert.deepEqual(j(C.uniao([[5, 8], [0, 2], [2.5, 4]], 0.6)), [[0, 4], [5, 8]]);
  assert.deepEqual(j(C.subtrair([[0, 10]], [[2, 3], [5, 6]])), [[0, 2], [3, 5], [6, 10]]);
  assert.deepEqual(j(C.interseccao([[0, 5]], [[3, 8]])), [[3, 5]]);
});

test('necessário = elementos + circuitos (RH) entre eles', () => {
  const nec = C.necessario(planta, 'LT', '1');
  assert.equal(nec.filter((t) => t.tipo === 'RH').length, 8);
  assert.equal(C.extensao(C.uniao(nec.map((t) => [t.ini, t.fim]), 0.5)), 9800);
  assert.deepEqual(j(C.sedes(nec).map((s) => s.sede)), ['GV I', 'GV II']);
});

test('GV1 e GV2 se complementam: sem buraco e divisa ok', () => {
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5600), arq('gv2', 9800, 5500)]); // gv2 em km decrescente
  assert.equal(Math.round(l.pct), 100);
  assert.equal(l.buracos.length, 0);
  assert.equal(l.fronteiras[0].situacao, 'ok');
  assert.equal(l.sobreposicoes.length, 1); // 5500–5600 medido 2×
  assert.ok(Math.abs(l.sobreposicoes[0].fim - l.sobreposicoes[0].ini - 100) < 2);
});

test('buraco entre os arquivos aparece com o km, o EH e os vizinhos', () => {
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5300), arq('gv2', 5450, 9800)]);
  assert.equal(l.buracos.length, 1);
  const b = l.buracos[0];
  assert.ok(Math.abs(b.ini - 5300) < 2 && Math.abs(b.fim - 5450) < 2);
  assert.equal(b.eh, 'EH 4');
  assert.deepEqual(j(b.antes), ['gv1']);
  assert.deepEqual(j(b.depois), ['gv2']);
  assert.equal(l.fronteiras[0].situacao, 'buraco');
  assert.ok(Math.round(l.necessario - l.coberto) >= 145);
});

test('recorte do arquivo tira o trecho da cobertura', () => {
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5600, { de: null, ate: 5500 }), arq('gv2', 5500, 9800)]);
  assert.equal(l.sobreposicoes.length, 0);
  assert.equal(l.buracos.length, 0);
});

test('só GV1: GV2 inteiro falta e a divisa fica aberta', () => {
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5000)]);
  const gv2 = l.sedes.find((s) => s.sede === 'GV II');
  assert.equal(gv2.coberto, 0);
  assert.equal(l.fronteiras[0].situacao, 'buraco');
});

test('arquivo com corretiva diferente da sede onde caiu é avisado', () => {
  const a = arq('cp', 5600, 9800); a.resumo.corretiva = 'CP';
  const [c] = C.conferirArquivos(planta, [a]);
  assert.match(c.avisos[0].texto, /Corretiva do arquivo é CP/);
});

test('resumo guardado como lista volta a ser array tipado', () => {
  const r = resumo('x', 0, 10);
  const salvo = JSON.parse(JSON.stringify({ ...r, amostras: { pos: [...r.amostras.pos], aj: [...r.amostras.aj], linha: [...r.amostras.linha], linhas: ['1'] } }));
  const n = C.normalizarResumo(salvo);
  assert.ok(n.amostras.pos.constructor.name === 'Float64Array');
  assert.equal(n.amostras.pos.length, 11);
});

test('contagem por EH/RH: casada, não detectada, a mais e RH da geometria', () => {
  const p2 = { ...planta, rhs: [{ ramal: 'LT', linha: '1', nome: 'RH-05', ini: 5400, fim: 5500, sede: 'GV II', raio: 900 }] };
  const a = arq('gv', 0, 9800);
  // curvas medidas (km da geometria): casa C de 1100–2100 (EH 1); EH 3 sem medida; uma a mais na tangente do EH 4; a do RH
  a.resumo.curvas = [
    { ini: 1110, fim: 2090, lado: 'D', linha: '1', kmArq: 1110 },
    { ini: 4500, fim: 4700, lado: 'D', linha: '1', kmArq: 4500 },
    { ini: 5410, fim: 5490, lado: 'E', linha: '1', kmArq: 5410 }
  ];
  const [l] = C.montar(p2, 'LT', [a]);
  const g = (nome) => l.contagem.find((x) => x.nome === nome);
  assert.equal(g('EH 1').situacao, 'ok');
  assert.equal(g('EH 1').casadas, 1);
  assert.equal(g('EH 3').situacao, 'divergente');
  assert.equal(g('EH 3').naoDetectadas.length, 1);
  assert.equal(g('EH 4').aMais.length, 1);
  assert.equal(g('RH-05').curvas, 1);
  assert.equal(g('RH-05').casadas, 1);
  // recorte tira a curva do arquivo
  const [l2] = C.montar(p2, 'LT', [{ ...a, recorte: { de: 1500, ate: null } }]);
  assert.equal(l2.contagem.find((x) => x.nome === 'EH 1').situacao, 'incompleto');
});
