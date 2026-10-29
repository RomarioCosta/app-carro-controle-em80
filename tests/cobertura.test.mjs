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
  assert.equal(al[0].kmArq, 105);
  // ponto do arquivo onde está o maior valor (amostra 105 × 4 pontos de 0,25 m): a Tela do carro vai direto nele
  assert.equal(C.alertasGeometria(planta, 'LT', [{ id: 'a', nome: 'a', resumo: { ...r, espacamento: 0.25, pontos: n * 4 }, recorte: null }], lim)[0].iArq, 420);
  assert.equal(Math.round(al[0].fim - al[0].ini), 10);
  assert.equal(al[1].tipo, 'C');
  assert.equal(al[1].limite, -10);
  // recorte tira o primeiro
  assert.equal(C.alertasGeometria(planta, 'LT', [{ id: 'a', nome: 'a', resumo: r, recorte: { de: 1000, ate: null } }], lim).length, 1);
});

/* Arquivo do carro sintético (já lido): 0 a 3.000 m, a cada 0,25 m, com a coluna LINHA por trecho. */
function arquivoLido(trechos) {
  const n = 12001;
  const pos = Float64Array.from({ length: n }, (_, i) => i * 0.25);
  const linhasValores = [];
  const linhaIdx = new Uint16Array(n);
  pos.forEach((p, i) => {
    const v = trechos.find((t) => p >= t[0] && p < t[1])[2];
    if (!linhasValores.includes(v)) linhasValores.push(v);
    linhaIdx[i] = linhasValores.indexOf(v);
  });
  const emp2 = new Float64Array(n).fill(1);
  for (let i = 4400; i < 4440; i++) emp2[i] = 50; // pico em 1.100–1.110 m (dentro do deslocamento)
  return { meta: { ramal: 'LT', linha: '1', sentido: 'C', data: '22/10/2026', corretiva: 'GV1' }, pos, dados: { curv: new Float64Array(n), emp2 }, eventos: [{ pos: 0, texto: 'X' }], avisos: [], linhaIdx, linhasValores };
}
// Geometria com 2 linhas iguais (0–1.000, 1.100–2.100, 2.200–3.200…), para a correção da linha
const planta2 = { elementos: [...elementos, ...elementos.map((e) => ({ ...e, linha: '2' }))], ramais: { LT: ['1', '2'] } };
const medidoNa = (r, linha) => C.extensao(C.coberturaDoArquivo(r)[linha] || []);

test('LOCOM: deslocamento fica fora da cobertura e dos alertas; correção por valor e por trecho', () => {
  const arq = arquivoLido([[0, 1000, '1'], [1000, 1500, 'LOCOM'], [1500, 3001, 'TESTE01']]);
  const r = C.resumirArquivo(arq, planta2, 'teste.csv');
  assert.deepEqual(j(r.valoresLinha.map((x) => [x.valor, x.pontos])), [['TESTE01', 6001], ['1', 4000], ['LOCOM', 2000]]);
  assert.ok(r.inconsistencias.some((x) => /2\.000 pontos em deslocamento \(LINHA = LOCOM\)/.test(x.texto)));
  assert.ok(Math.abs(medidoNa(r, '1') - 2500) < 10); // 0–1.000 e 1.500–3.000 (TESTE01 → linha 1)
  const lim = (id) => (id === 'emp2' ? [{ grau: 2, nome: 'Restrição', sup: 12, inf: -12 }] : []);
  assert.equal(C.alertasGeometria(planta2, 'LT', [{ id: 'a', nome: 'a', resumo: r, recorte: null }], lim).length, 0);
  // TESTE01 era a linha 2, e o deslocamento entre 1.000 e 1.500 foi na verdade medição na linha 1
  const r2 = C.resumirArquivo(arq, planta2, 'teste.csv', { linhas: { valores: { TESTE01: '2' }, trechos: [{ de: 1000, ate: 1499.75, linha: '1' }] } });
  assert.ok(Math.abs(medidoNa(r2, '1') - 1500) < 10);
  assert.ok(Math.abs(medidoNa(r2, '2') - 1500) < 10);
  assert.equal(C.alertasGeometria(planta2, 'LT', [{ id: 'a', nome: 'a', resumo: r2, recorte: null }], lim).length, 1); // agora conta
  assert.deepEqual(j(r2.valoresLinha.map((x) => x.valor)), ['TESTE01', '1', 'LOCOM']); // a tabela mostra os valores originais
});

test('RH (pátio) de cada sede, com o nome, para as marcas nas barras', () => {
  const nec = C.necessario(planta, 'LT', '1');
  const rh = nec.filter((t) => t.tipo === 'RH');
  assert.ok(rh.every((t) => t.patio));
  assert.equal(rh[0].nome, 'RH-1'); // entre o EH 0 e o EH 1
  const [l] = C.montar(planta, 'LT', [arq('gv1', 0, 5600)]);
  assert.deepEqual(j(l.sedes[0].rh.map((p) => p.nome)), ['RH-1', 'RH-2', 'RH-3', 'RH-4']);
  assert.ok(Math.abs(l.sedes[0].rh[0].ini - 1000) < 1e-9 && Math.abs(l.sedes[0].rh[0].fim - 1100) < 1e-9);
});

test('geometria: RH da planilha (inclusive no km 0) e km diferentes por linha (RBH)', () => {
  const B = ctx.App.bitola;
  const linhas = [
    ['Geometria da EFVM'],
    ['ramal', 'sede', 'elemento', 'tipo_ativo', 'sentido', 'km_inicial', 'km_final', 'raio', 'eh_linha'],
    ['RBH', 'GV I', 'RH-1', 'RH', '', 0, 300, '', '00/01 L1'],
    ['RBH', 'GV I', 'TANGENTE 1', 'TANGENTE', '', 300, 1000, '', '01/02 L1'],
    ['RBH', 'GV I', 'CURVA 1', 'CURVA', 'Direita', 1000, 1400, 500, '01/02 L1'],
    ['RBH', 'GV I', 'RH-2', 'RH', '', 1400, 1700, '', '01/02 L1'],
    ['RBH', 'GV I', 'RH-2', 'RH', '', 1400, 1700, '', '02/03 L1'], // a mesma RH repetida no EH seguinte
    ['RBH', 'GV I', 'TANGENTE 1', 'TANGENTE', '', 5300, 6000, '', '01/02 L 2'],
    ['RBH', 'GV I', 'CURVA 1', 'CURVA', 'Esquerda', 6000, 6500, 400, '01/02 L02'],
    ['RBH', '', 'RH-2', 'RH', '', 6500, 6800, '', '01/02 LINHA 2']
  ];
  const p = B.lerPlanta(linhas);
  assert.deepEqual(j(p.ramais), { BH: ['1', '2'] });
  assert.equal(p.rhs.length, 3);
  assert.equal(p.avisos.length, 0); // todas as linhas identificadas
  const nec1 = C.necessario(p, 'BH', '1');
  assert.equal(nec1[0].tipo, 'RH'); // o ramal começa no km 0, numa RH
  assert.equal(nec1[0].ini, 0);
  assert.equal(nec1[0].nome, 'RH-1');
  const [g1, g2] = C.resumoGeometria(p);
  assert.deepEqual(j([g1.ramal, g1.linha, g1.ini, g1.fim, g1.extensao, g1.tangentes, g1.curvas, g1.rh, g1.rhDaGeometria]), ['BH', '1', 0, 1700, 1700, 1, 1, 2, true]);
  assert.deepEqual(j([g2.linha, g2.ini, g2.fim, g2.extensao, g2.rh]), ['2', 5300, 6800, 1500, 1]);
  assert.equal(g2.sedes[0].sede, 'GV1'); // RH sem sede fica com a do elemento vizinho
  assert.equal(g2.sedes.length, 1);
  // linha não identificada é avisada
  const p2 = B.lerPlanta([...linhas, ['RBH', 'GV I', 'TANGENTE 9', 'TANGENTE', '', 9000, 9500, '', '09/10']]);
  assert.match(p2.avisos[0], /1 linha\(s\) da geometria sem a linha identificada/);
});
