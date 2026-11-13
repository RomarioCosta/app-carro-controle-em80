/* Testes do planejamento mensal (Rota). Rodar: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ctx = { console, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.window = ctx; ctx.window.App = {};
vm.createContext(ctx);
['util.js', 'malha.js', 'mensal.js'].forEach((f) => vm.runInContext(readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8'), ctx));
const { malha: M, mensal: X } = ctx.App;
const j = (x) => JSON.parse(JSON.stringify(x));

const CAB = ['DATA ÍNICIO', 'DATA FIM', 'HORA INÍCIO', 'HORA FIM', 'QTD DE HORAS', 'INTERDIÇÃO', 'DETALHE INTERD.', 'SEDE', 'LOCAL', 'LINHA', 'TAREFAS', 'DESCRIÇÃO/OBS.', 'AMV', 'TRILHO', 'JIC', 'KM INICIO', 'KM FIM', 'ATIVO IMPACTO', 'RECURSO', 'RECURSO PADRÃO', 'QTD SERVIÇO', 'UNID.', 'LTR', 'ELETRO', 'EVP', 'TIPO FINANCEIRO', 'VALOR FINANCEIRO', 'ID SERVIÇO FLASH', 'STATUS'];
const linha = (ini, fim, hi, hf, local, l, tarefa, status, km = '') => {
  const r = Array(CAB.length).fill('');
  Object.assign(r, { 0: ini, 1: fim, 2: hi, 3: hf, 5: 'PRINCIPAL', 7: 'GV', 8: local, 9: l, 10: tarefa, 15: km, 28: status });
  return r;
};

test('lê só os aprovados, com data (série do Excel) e hora (fração do dia)', () => {
  const s12 = 46338; // 12/11/2026 no Excel
  const linhas = [
    [s12 - 11, s12 + 18], ['INTERDIÇÃO FERROVIA'], CAB,
    linha(s12, s12, 0.375, 0.625, '49/50', 2, 'SUBSTITUIR TRILHO DE ENCOSTO', 'APROVADO', 321.7),
    linha(s12, s12 + 2, 0.395833, 0.645833, 'RH-50', '1 e 2', 'SOCARIA MECANIZADA DE LINHA', 'ALTERADO/APROVADO'),
    linha(s12, s12, 0.375, 0.625, 'VCS', 'W62B', 'SUBSTITUIÇÃO DE DORMENTE', 'INCLUÍDO/APROVADO'),
    linha(s12, s12, 0.375, 0.625, '48/49', 1, 'ROÇADA', 'REPROVADO'),
    linha(s12, s12, 0.375, 0.625, '48/49', 1, 'ROÇADA', 'CANCELADO'),
    linha(s12, s12, 0.375, 0.625, '48/49', 1, 'ROÇADA', '')
  ];
  const { servicos, total } = X.ler(linhas);
  assert.equal(total, 6);
  assert.equal(servicos.length, 3);
  assert.deepEqual(j(servicos.map((s) => [s.dataIni, s.dataFim, s.horaIni, s.horaFim])), [
    ['2026-11-12', '2026-11-12', '09:00', '15:00'], ['2026-11-12', '2026-11-14', '09:30', '15:30'], ['2026-11-12', '2026-11-12', '09:00', '15:00']]);
  assert.equal(servicos[0].kmIni, 321.7);
  assert.equal(X.tipoCurto(servicos[0]), 'Subst. TR');
  assert.equal(X.horario(servicos[1]), '09:30 às 15:30');
  // dia: a faixa de datas inclui o dia
  assert.equal(X.doDia(servicos, '2026-11-13').length, 1);
  assert.equal(X.doDia(servicos, '2026-11-15').length, 0);
  assert.throws(() => X.ler([['x']]), /Tarefas Mensal/);
});

test('localiza o LOCAL e a LINHA na malha da Rota (EH, RH e pátios sem EH)', () => {
  const el = (ramal, linha, eh, ini, fim, nomeEh) => ({ ramal, linha: String(linha), eh: String(eh), ini, fim, tipo: 'T', nomeEh });
  const m = M.montar({ elementos: [
    el('LT', 1, 49, 0, 4000, 'EH 49/50'), el('LT', 2, 49, 0, 4000, 'EH 49/50'),
    el('LT', 1, 50, 4300, 8000, 'EH 50/51'), el('LT', 2, 50, 4300, 8000, 'EH 50/51'),
    el('FA', 1, '12V', 0, 1000, 'EH 12V/13I'), el('FA', 1, '13I', 1300, 2000, 'EH 13I/13V'), el('FA', 2, '13I', 1300, 2000, 'EH 13I/13V')
  ] });
  const loc = (local, linha) => { const r = X.localizar(m, { local, linha }); return r && r.trecho; };
  assert.equal(loc('49/50', '2'), 'LT:EH:49@2');
  assert.equal(loc('49/50', 'SINGELA'), 'LT:EH:49@1');
  assert.equal(loc('RH-50', '1 e 2'), 'LT:RH:49>50@1');
  assert.equal(loc('RH 50 T21/T22', '2'), 'LT:RH:49>50@2');
  assert.equal(loc('12/13I', '1'), 'FA:EH:12V@1');
  assert.equal(loc('13I', '1'), 'FA:RH:12V>13I@1');
  assert.equal(loc('VCS', 'W62B'), null);
  assert.equal(loc('TORRE "A"', 'W14'), null);
  assert.deepEqual(j(X.linhasDe('1 e 2')), ['1', '2']);
  assert.deepEqual(j(X.linhasDe('PÁTIO')), []);
});

test('mesmo nome em dois ramais (EH 11/12 da Tronco e 11I/12V de Fábrica): separa pelo km e pela sede', () => {
  const el = (ramal, linha, eh, ini, fim, nomeEh) => ({ ramal, linha: String(linha), eh: String(eh), ini, fim, tipo: 'T', nomeEh });
  const m = M.montar({ elementos: [
    el('LT', 1, 11, 49800, 56800, 'EH 11/12'), el('LT', 1, 12, 57000, 64000, 'EH 12/13'),
    el('FA', 1, '11I', 89000, 91000, 'EH 11I/12V'), el('FA', 1, '12V', 91200, 95000, 'EH 12V/13I')
  ] });
  assert.equal(X.candidatos(m, '11/12 (SING)').length, 2);
  const sv = (local, sede, kmIni) => ({ local, sede, kmIni, linha: '1' });
  const servicos = [sv('12/13', 'JN', null), sv('12/13', 'JN', null), sv('12V/13I', 'FU', null), sv('12V/13I', 'FU', null)];
  const st = X.telasPorSede(m, servicos);
  assert.deepEqual(j(st), { JN: 'LT', FU: 'FA' });
  assert.equal(X.localizar(m, sv('11/12 (SING)', 'FU', 90.2), st).id, 'FA:EH:11I'); // pelo km
  assert.equal(X.localizar(m, sv('11/12', 'JN', 52), st).id, 'LT:EH:11');
  assert.equal(X.localizar(m, sv('11/12 (SING)', 'FU', null), st).id, 'FA:EH:11I'); // sem km: pela sede
  assert.equal(X.localizar(m, sv('11/12', 'JN', null), st).id, 'LT:EH:11');
});

test('semanal: lê aprovados e condicionados e compara com a mensal (novo, alterado, retirado)', () => {
  const CAB_S = ['', 'Cor', 'Data', 'Local', 'Linha', 'Hrini', 'Tempo', 'Hrfim', 'Tipo', 'Serviço', 'Descrição', 'Trem de serviço?', 'TURMA', 'STATUS', 'OBSERVAÇÕES PCM', 'OBSERVAÇÕES COI'];
  const ls = (data, local, linha, hi, hf, servico, status, desc = '') => ['', 'TRECHO 11', data, local, linha, hi, '', hf, 'PRINCIPAL', servico, desc, 0, 'TURMA X', status, 0, 0];
  const d = '2026-11-16';
  const { servicos: sem } = X.lerSemanal([[], [], CAB_S,
    ls(d, '49/50', 1, '09:00', '15:00', 'ROÇADA', 'APROVADO'),
    ls(d, '49/50', 2, '08:00', '16:00', 'SUBSTITUIÇÃO DE TRILHO - 68', 'CONDICIONADO', 'TR1 DO KM 11.155 AO 11.479'),
    ls(d, '50/51', 1, '09:00', '15:00', 'SOCARIA MECANIZADA DE LINHA', 'APROVADO'),
    ls(d, '51/52', 1, '09:00', '15:00', 'DESCARGA DE BRITA', 'REPROVADO')
  ]);
  assert.equal(sem.length, 4);
  assert.deepEqual(j(sem.map((s) => s.vale)), [true, true, true, false]);
  assert.equal(sem[1].kmIni, 11.155);
  const men = [
    { id: 'm1', dataIni: d, dataFim: d, local: '49/50', linha: '1', horaIni: '09:00', horaFim: '15:00', tarefa: 'ROÇADA' },
    { id: 'm2', dataIni: d, dataFim: d, local: '49/50', linha: '2', horaIni: '08:30', horaFim: '15:00', tarefa: 'SUBSTITUIÇÃO DE TRILHO - 68 - COM ALÍVIO' },
    { id: 'm3', dataIni: d, dataFim: d, local: '51/52', linha: '1', horaIni: '09:00', horaFim: '15:00', tarefa: 'DESCARGA DE BRITA' },
    { id: 'm4', dataIni: d, dataFim: d, local: '60/61', linha: '1', horaIni: '09:00', horaFim: '15:00', tarefa: 'ROÇADA' }
  ];
  const c = X.comparar(men, sem);
  const por = (local, tarefa) => c.find((x) => x.s.local === local && x.s.tarefa.startsWith(tarefa));
  assert.equal(por('49/50', 'ROÇADA').mudanca, null); // igual
  const alt = por('49/50', 'SUBSTITUIÇÃO DE TRILHO - 68');
  assert.equal(alt.mudanca, 'alterado');
  assert.match(alt.antes, /horário 08:30 às 15:00/);
  assert.equal(por('50/51', 'SOCARIA').mudanca, 'novo');
  assert.equal(por('51/52', 'DESCARGA').mudanca, 'retirado'); // reprovado na semanal
  assert.match(por('51/52', 'DESCARGA').antes, /REPROVADO na semanal/);
  assert.equal(por('60/61', 'ROÇADA').mudanca, 'retirado'); // não está na semanal
  assert.equal(c.length, 5);
});
