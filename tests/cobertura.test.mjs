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
  // 5500–5600: pedaço do EH 5 no gv1 não vale (o gv2 tem o EH 5 inteiro), então não há sobreposição
  assert.equal(l.sobreposicoes.length, 0);
  assert.equal(l.incompletos.length, 0);
});

test('buraco entre os arquivos aparece com o km, o EH e os vizinhos', () => {
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5300), arq('gv1b', 5450, 9800)]);
  assert.equal(l.buracos.length, 1);
  const b = l.buracos[0];
  // o gv1 parou no meio do EH 4 (4400–5400): o EH 4 inteiro fica sem medição (EH incompleto)
  assert.ok(Math.abs(b.ini - 4400) < 2 && Math.abs(b.fim - 5450) < 2, `${b.ini} ${b.fim}`);
  assert.ok(b.ehIncompleto);
  assert.deepEqual(j(b.antes), ['gv1']);
  assert.deepEqual(j(b.depois), ['gv1b']);
  assert.equal(l.incompletos.length, 1);
  assert.equal(l.incompletos[0].nome, 'EH 4');
  assert.equal(Math.round(l.incompletos[0].pct), 90);
  assert.equal(l.fronteiras[0].situacao, 'buraco');
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

test('alertas de geometria: trechos acima do limite, agrupados, com o maior nível', () => {
  const r = resumo('a', 0, 3000);
  const n = r.amostras.pos.length;
  const emp2 = new Float32Array(n).fill(5);
  for (let k = 100; k <= 110; k++) emp2[k] = 15; // na tangente (EH 0, 0–1000): limite 12 → restrição
  emp2[105] = 40; // interdição no meio
  for (let k = 1500; k <= 1502; k++) emp2[k] = -13; // na curva (EH 1, 1100–2100): limite 10
  r.geometria = { emp2 };
  const lim = (id, el) => (id === 'emp2' ? [{ grau: 2, nome: 'Restrição', sup: el === 'C' ? 10 : 12, inf: el === 'C' ? -10 : -12 }, { grau: 3, nome: 'Interdição', sup: 30, inf: -30 }] : []);
  const al = C.alertasGeometria(planta, 'LT', [{ id: 'a', nome: 'a', resumo: r, recorte: null }], lim);
  assert.equal(al.length, 2);
  assert.equal(al[0].nivel, 'Interdição');
  assert.equal(al[0].valor, 40);
  assert.equal(Math.round(al[0].fim - al[0].ini), 10);
  assert.equal(al[1].tipo, 'C');
  assert.equal(al[1].limite, -10);
  // recorte tira o primeiro
  assert.equal(C.alertasGeometria(planta, 'LT', [{ id: 'a', nome: 'a', resumo: r, recorte: { de: 1000, ate: null } }], lim).length, 1);
});

test('validação por EH completo: parou no meio do EH, vale até o fim da RH anterior', () => {
  // arquivo de 0 a 5300: EH 0–3 inteiros, parou no EH 4 (4400–5400)
  const a = arq('gv1', 0, 5300);
  const v = C.validacaoDoArquivo(planta, a.resumo);
  assert.equal(v.ehs.filter((e) => e.completo).length, 4);
  assert.equal(v.ehs.find((e) => e.nome === 'EH 4').completo, false);
  assert.equal(v.sugestao.cortadoFim.nome, 'EH 4');
  assert.ok(v.sugestao.ate >= 4398 && v.sugestao.ate < 4400, String(v.sugestao.ate)); // até o fim da RH-4 (início do EH 4)
  assert.equal(v.sugestao.de, 0);
  // começou no meio do EH 1 (1100–2100): vale a partir do fim do EH 1 (início da RH seguinte)
  const b = C.validacaoDoArquivo(planta, arq('x', 1500, 9800).resumo);
  assert.equal(b.sugestao.cortadoIni.nome, 'EH 1');
  assert.ok(b.sugestao.de > 2100 && b.sugestao.de <= 2102, String(b.sugestao.de));
  // arquivo decrescente (9800 → 5300): para no meio do EH 4, vale de 5400 (fim do EH 4) até 9800
  const c = C.validacaoDoArquivo(planta, arq('y', 9800, 5300).resumo);
  assert.equal(c.sugestao.cortadoFim.nome, 'EH 4');
  assert.ok(c.sugestao.de > 5400 && c.sugestao.de <= 5402 && c.sugestao.ate === 9800, `${c.sugestao.de} ${c.sugestao.ate}`);
  // erro do carro no km 3500 (EH 3, 3300–4300): vale até o início do EH 3
  const e = C.validacaoDoArquivo(planta, arq('z', 0, 9800).resumo, 3500);
  assert.equal(e.sugestao.cortadoFim.nome, 'EH 3');
  assert.ok(e.sugestao.ate >= 3298 && e.sugestao.ate < 3300);
  // arquivo só com EH inteiros: nada a cortar
  assert.ok(C.validacaoDoArquivo(planta, arq('w', 0, 9800).resumo).sugestao.inteiro);
});
