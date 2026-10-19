/* Testes das regras do app (datas, KM, importação e metas). Rodar: TZ=America/Sao_Paulo node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function carregar() {
  const ctx = { console, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx;
  ctx.window.App = { store: {}, api: {}, sync: {} };
  vm.createContext(ctx);
  ['util.js', 'om.js'].forEach((f) => vm.runInContext(readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8'), ctx));
  return ctx.App;
}
const { U, OM } = carregar();
// Objetos criados no contexto isolado: converte antes de comparar.
const j = (x) => JSON.parse(JSON.stringify(x));

test('datas: semana vigente começa na segunda (sábado e domingo incluídos)', () => {
  assert.equal(U.inicioSemana('2026-10-19'), '2026-10-19'); // segunda
  assert.equal(U.inicioSemana('2026-10-23'), '2026-10-19'); // sexta
  assert.equal(U.inicioSemana('2026-10-24'), '2026-10-19'); // sábado
  assert.equal(U.inicioSemana('2026-10-25'), '2026-10-19'); // domingo
  assert.equal(U.inicioSemana('2026-11-01'), '2026-10-26'); // domingo em outro mês
  assert.equal(U.fimMes('2026-02-10'), '2026-02-28');
  assert.equal(U.fimMes('2028-02-10'), '2028-02-29');
  assert.equal(U.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(U.parseData('2026-02-31'), null);
});

test('KM no padrão 000+000', () => {
  assert.equal(U.formatarKm('109440'), '109+440');
  assert.equal(U.formatarKm('300'), '000+300');
  assert.equal(U.formatarKm('0+300'), '000+300');
  assert.equal(U.formatarKm('109+44'), '109+044');
  assert.equal(U.formatarKm('109,44'), '109+440');
  assert.equal(U.formatarKm('12+100'), '012+100');
  assert.equal(U.formatarKm(''), '');
  assert.equal(U.formatarKm('abc'), 'ABC');
});

test('números e coordenadas aceitam vírgula', () => {
  assert.equal(U.numero('1,5'), 1.5);
  assert.equal(U.numero('-0,8'), -0.8);
  assert.equal(U.numero('1,2,3'), null);
  assert.equal(U.numero(''), null);
  assert.equal(U.coordenada('-19,93', 90), '-19.93');
  assert.equal(U.coordenada('200', 180), null);
  assert.equal(U.coordenada('', 90), '');
});

test('leitura de datas da planilha', () => {
  assert.equal(OM.lerData(46327), '2026-11-01'); // número de série do Excel
  assert.equal(OM.lerData(46327.75), '2026-11-01');
  assert.equal(OM.lerData('05/11/2026'), '2026-11-05');
  assert.equal(OM.lerData('5/11/26'), '2026-11-05');
  assert.equal(OM.lerData('2026-11-05'), '2026-11-05');
  assert.equal(OM.lerData('31/02/2026'), null);
  assert.equal(OM.lerData(''), '');
  assert.equal(OM.lerData('amanhã'), null);
});

test('importação reconhece as colunas do SAP (inclusive "INSTALÇÃO")', () => {
  const linhas = [
    ['Relatório SAP'],
    ['Nº Ordem', 'Texto breve', 'Denominação do loc.instalação', 'Local de instalação', 'INSTALÇÃO', 'Plano de Manutenção', 'Item de Manutenção', 'Status do Usuario', 'Status da Ordem', 'Data Planejada', 'Data de Tolerância Mínima', 'Data de Tolerância Máxima', 'Ciclo', 'KM', 'KM2', 'STATUS', 'Data Programada'],
    [202600001234, 'RFA 01V/02I L1 ', '18V19IL1, RAMAL', '03-FA', 'EFVM-RFA', 383503, 1096733, 'VPTS AGPL', 'SCDM', 46327, 46297, 46357, 2, 152908, 166542, 'ABER', 46330],
    [202600005678, 'LPR 09i/09v L2', 'RAMAL 2', '', '', '', '', '', '', 46327, '', '', 2, '', '', 'LIB', '04/11/2026'],
    [202600005678, 'duplicada', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [202600009999, 'RBH X', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'xx/yy']
  ];
  const r = OM.processarLinhas(linhas);
  assert.deepEqual(j(r.erros), []);
  assert.equal(r.oms.length, 3);
  assert.equal(r.temColunaProgramada, true);
  const [a, b, c] = r.oms;
  assert.equal(a.nOrdem, '202600001234');
  assert.equal(a.textoBreve, 'RFA 01V/02I L1');
  assert.equal(a.instalacao, 'EFVM-RFA');
  assert.equal(a.plano, '383503');
  assert.equal(a.dataProgramada, '2026-11-04');
  assert.equal(a.dataPlanejada, '2026-11-01');
  assert.equal(a.km, 152908);
  assert.equal(b.dataProgramada, '2026-11-04');
  assert.equal(c.dataProgramada, '');
  assert.equal(r.semDataProgramada, 1);
  assert.ok(r.avisos.some((x) => x.includes('repetida')));
  assert.ok(r.avisos.some((x) => x.includes('inválida')));
});

test('importação sem a coluna Nº Ordem dá erro claro', () => {
  const r = OM.processarLinhas([['A', 'B'], [1, 2]]);
  assert.equal(r.oms.length, 0);
  assert.match(r.erros[0], /Nº Ordem/);
});

test('metas: dia, semana (seg–sex / seg–dom), mês e ciclo', () => {
  const oms = [
    { nOrdem: '1', dataProgramada: '2026-10-19' }, // seg
    { nOrdem: '2', dataProgramada: '2026-10-19' },
    { nOrdem: '3', dataProgramada: '2026-10-21' }, // qua
    { nOrdem: '4', dataProgramada: '2026-10-23' }, // sex
    { nOrdem: '5', dataProgramada: '2026-10-30' }, // semana seguinte
    { nOrdem: '6', dataProgramada: '2026-11-03' }, // outro mês
    { nOrdem: '7', dataProgramada: '' }
  ].map((o) => ({ ...o, textoBreve: `OM ${o.nOrdem}`, ramal: 'LPR' }));
  const exec = {
    1: { status: 'Realizado', dataRealizacao: '2026-10-19T09:00:00' },
    3: { status: 'Realizado', dataRealizacao: '2026-10-19T15:00:00' }, // adiantada
    4: { status: 'Realizado', dataRealizacao: '2026-10-24T08:00:00' }, // sábado: conta na semana vigente
    5: { status: 'Não realizado', dataRealizacao: '' },
    6: { status: 'Realizado', dataRealizacao: '2026-10-20T10:00:00' } // de novembro, feita em outubro
  };
  const dados = { ciclo: '5', oms, exec };

  let m = OM.metricas(dados, '2026-10-19');
  assert.deepEqual([m.dia.meta, m.dia.realizado], [2, 2]);
  assert.equal(Math.round(m.dia.pct), 100);
  assert.deepEqual([m.semana.meta, m.semana.realizado], [4, 2]);
  assert.deepEqual([m.mes.meta, m.mes.metaAteHoje, m.mes.realizado], [5, 2, 2]);
  assert.deepEqual([m.ciclo.meta, m.ciclo.realizado], [7, 2]);

  m = OM.metricas(dados, '2026-10-25'); // domingo
  assert.deepEqual([m.semana.meta, m.semana.realizado], [4, 4]);
  assert.equal(m.serieSemana.length, 7);
  assert.equal(m.serieSemana[5].realizado, 1); // sábado
  assert.equal(m.serieSemana[5].meta, 0);
  assert.equal(m.serieMes.length, 31);
  assert.equal(m.serieMes[30].realizado, null); // dia 31 ainda não chegou
  assert.equal(m.serieMes[24].realizado, 4);
  assert.equal(m.serieMes[30].meta, 5);

  m = OM.metricas(dados, '2026-10-26'); // dia sem meta
  assert.equal(m.dia.meta, 0);
  assert.equal(m.dia.pct, null);
});

test('listas: do dia, atrasadas e todas', () => {
  const oms = [
    { nOrdem: '1', textoBreve: 'B', dataProgramada: '2026-10-19' },
    { nOrdem: '2', textoBreve: 'A', dataProgramada: '2026-10-15' },
    { nOrdem: '3', textoBreve: 'C', dataProgramada: '2026-10-25' },
    { nOrdem: '4', textoBreve: 'D', dataProgramada: '2026-10-14' }
  ];
  const exec = {
    3: { status: 'Realizado', dataRealizacao: '2026-10-19T10:00:00' },
    4: { status: 'Realizado', dataRealizacao: '2026-10-16T10:00:00' }
  };
  const l = OM.listas({ oms, exec }, '2026-10-19');
  assert.deepEqual(j(l.doDia.map((o) => o.nOrdem)), ['1', '3']);
  assert.deepEqual(j(l.atrasadas.map((o) => o.nOrdem)), ['2']);
  assert.equal(l.todas.length, 4);
});
