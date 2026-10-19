/* Testes do back-end (Codigo.js) com a planilha simulada. Rodar: TZ=America/Sao_Paulo node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { carregarServidor } from './gas-fake.mjs';

const CODIGO = fileURLToPath(new URL('../apps-script/Codigo.js', import.meta.url));

function novo(opcoes) {
  const s = carregarServidor(CODIGO, opcoes);
  s.ctx.setup();
  const token = s.props.get('API_TOKEN');
  const post = (acao, dados, tk = token) => JSON.parse(s.ctx.doPost({ postData: { contents: JSON.stringify({ acao, dados, token: tk }) } }).getContent());
  const aba = (n) => s.ss.getSheetByName(n).comoObjetos();
  return { ...s, token, post, aba };
}

test('setup cria abas, remove a aba vazia padrão e gera código', () => {
  const s = novo();
  const nomes = s.ss.getSheets().map((x) => x.nome);
  assert.deepEqual(nomes.sort(), ['Anomalias', 'Checklist_Amostras', 'Checklist_Respostas', 'Checklists', 'Eventos', 'Execucoes', 'OMs'].sort());
  assert.match(s.token, /^[0-9A-F]{12}$/);
  s.ctx.setup(); // rodar de novo não quebra
  assert.equal(s.ss.getSheets().length, 7);
});

test('código de acesso é exigido', () => {
  const s = novo();
  const r = s.post('ping', {}, 'ERRADO');
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'AUTH');
  assert.equal(s.post('ping', {}).ok, true);
  // google.script.run: dono logado passa sem código; anônimo não.
  assert.equal(s.ctx.apiCall({ acao: 'ping' }).ok, false);
  const dono = novo({ emailUsuario: 'dono@exemplo.com' });
  assert.equal(dono.ctx.apiCall({ acao: 'ping' }).ok, true);
});

test('evento: idempotente, duração calculada e versão mais nova prevalece', () => {
  const s = novo();
  const ev = { id: 'e1', inicio: '2026-10-19T08:00:00', fim: '', equipamento: 'KLD', parte: 'Sensor', observacao: '=SOMA(A1)', criadoEm: '2026-10-19T08:00:00', atualizadoEm: '2026-10-19T08:00:00' };
  let r = s.post('sync', { itens: [{ key: 'evento:e1', tipo: 'evento', dados: ev }] });
  assert.equal(r.dados.resultados[0].ok, true);
  r = s.post('sync', { itens: [{ key: 'evento:e1', tipo: 'evento', dados: ev }] }); // reenvio
  assert.equal(s.aba('Eventos').length, 1);
  assert.equal(s.aba('Eventos')[0]['Observação / impacto'], '=SOMA(A1)');

  const fechado = { ...ev, fim: '2026-10-19T09:35:00', atualizadoEm: '2026-10-19T09:35:00' };
  s.post('sync', { itens: [{ key: 'evento:e1', tipo: 'evento', dados: fechado }] });
  assert.equal(s.aba('Eventos')[0]['Duração (min)'], 95);

  // versão antiga chegando depois não sobrescreve
  s.post('sync', { itens: [{ key: 'evento:e1', tipo: 'evento', dados: ev }] });
  const rec = s.post('getRecentes', { tipo: 'evento' }).dados;
  assert.equal(rec[0].fim, '2026-10-19T09:35:00');
  assert.equal(rec[0].criadoEm, '2026-10-19T08:00:00');
});

test('evento inválido retorna erro só daquele item', () => {
  const s = novo();
  const r = s.post('sync', {
    itens: [
      { key: 'evento:x', tipo: 'evento', dados: { id: 'x', inicio: '2026-10-19T10:00:00', fim: '2026-10-19T09:00:00', equipamento: 'OGMS' } },
      { key: 'evento:y', tipo: 'evento', dados: { id: 'y', inicio: '2026-10-19T10:00:00', equipamento: 'OGMS', atualizadoEm: '2026-10-19T10:00:00' } },
      { key: 'zzz:1', tipo: 'zzz', dados: {} }
    ]
  });
  const res = r.dados.resultados;
  assert.equal(res[0].ok, false);
  assert.match(res[0].erro, /fim não pode ser antes/);
  assert.equal(res[1].ok, true);
  assert.equal(res[2].ok, false);
});

test('checklist grava cabeçalho, respostas e amostras sem duplicar no reenvio', () => {
  const s = novo();
  const ck = {
    id: 'c1', data: '2026-10-19', ciclo: '5', responsavel: 'Romário', criadoEm: '2026-10-19T07:00:00', atualizadoEm: '2026-10-19T07:00:00',
    respostas: [
      { grupo: 'OGMS', perguntaId: 'ogms_conexao', pergunta: 'Conectar?', resposta: 'Sim', problema: 'Sim', descricao: 'Demorou' },
      { grupo: 'OGMS', perguntaId: 'ogms_falha', pergunta: 'Falhou?', resposta: 'Não', problema: 'Não', descricao: '' }
    ],
    amostras: [
      { grupo: 'OGMS', medicaoId: 'ogms_bitola', medicao: 'Bitola', amostra: 1, valor: 1.5, rotulo2: '', valor2: '' },
      { grupo: 'KLD', medicaoId: 'kld_desgaste', medicao: 'Desgaste', amostra: 1, valor: -0.8, rotulo2: 'Vampiro', valor2: 2 }
    ]
  };
  s.post('sync', { itens: [{ key: 'checklist:c1', tipo: 'checklist', dados: ck }] });
  s.post('sync', { itens: [{ key: 'checklist:c1', tipo: 'checklist', dados: ck }] });
  assert.equal(s.aba('Checklists').length, 1);
  assert.equal(s.aba('Checklists')[0]['Qtd. problemas'], 1);
  assert.equal(s.aba('Checklist_Respostas').length, 2);
  assert.equal(s.aba('Checklist_Amostras').length, 2);
  assert.equal(s.aba('Checklist_Amostras')[1]['Valor'], -0.8);
});

test('importação de OMs substitui o ciclo e preserva as realizações', () => {
  const s = novo();
  const oms = [
    { nOrdem: '100', textoBreve: 'LPR 1', dataProgramada: '2026-10-19', km: 10 },
    { nOrdem: '200', textoBreve: 'RFA 2', dataProgramada: '2026-10-20' },
    { nOrdem: '200', textoBreve: 'duplicada' }
  ];
  let r = s.post('importarOMs', { ciclo: '5', oms });
  assert.equal(r.dados.importadas, 2);
  s.post('importarOMs', { ciclo: '4', oms: [{ nOrdem: '999', textoBreve: 'antiga' }] });

  s.post('sync', { itens: [{ key: 'execucao:5|100', tipo: 'execucao', dados: { ciclo: '5', nOrdem: '100', status: 'Realizado', dataRealizacao: '2026-10-19T10:15:00', atualizadoEm: '2026-10-19T10:15:00' } }] });
  s.post('sync', { itens: [{ key: 'reprogramacao:5|200', tipo: 'reprogramacao', dados: { ciclo: '5', nOrdem: '200', dataProgramada: '2026-10-22' } }] });

  // reimporta o ciclo 5 com uma OM a mais
  r = s.post('importarOMs', { ciclo: '5', oms: [...oms.slice(0, 2), { nOrdem: '300', textoBreve: 'RBH 3', dataProgramada: '2026-10-21' }] });
  assert.equal(r.dados.importadas, 3);

  const d = s.post('getOMs', { ciclo: '5' }).dados;
  assert.equal(d.oms.length, 3);
  assert.equal(d.execucoes.length, 1);
  assert.equal(d.execucoes[0].dataRealizacao, '2026-10-19T10:15:00');
  assert.equal(d.oms.find((o) => o.nOrdem === '100').dataProgramada, '2026-10-19');
  assert.equal(s.post('getOMs', { ciclo: '4' }).dados.oms.length, 1);
  assert.deepEqual(s.post('getCiclos').dados.map((c) => c.ciclo), ['5', '4']);

  // desfazer: Não realizado limpa a data
  s.post('sync', { itens: [{ key: 'execucao:5|100', tipo: 'execucao', dados: { ciclo: '5', nOrdem: '100', status: 'Não realizado', dataRealizacao: '2026-10-19T10:15:00', atualizadoEm: '2026-10-19T10:16:00' } }] });
  const x = s.post('getOMs', { ciclo: '5' }).dados.execucoes[0];
  assert.equal(x.status, 'Não realizado');
  assert.equal(x.dataRealizacao, '');
});

test('importação valida ciclo e reprogramação de OM inexistente falha', () => {
  const s = novo();
  assert.equal(s.post('importarOMs', { ciclo: 'abc', oms: [{ nOrdem: '1' }] }).ok, false);
  assert.equal(s.post('importarOMs', { ciclo: '5', oms: [] }).ok, false);
  const r = s.post('sync', { itens: [{ key: 'reprogramacao:5|1', tipo: 'reprogramacao', dados: { ciclo: '5', nOrdem: '1', dataProgramada: '2026-10-22' } }] });
  assert.equal(r.dados.resultados[0].ok, false);
});

test('anomalia grava textos como texto (KM e coordenadas)', () => {
  const s = novo();
  const a = { id: 'a1', acaoTomada: 'INTERDIÇÃO', data: '2026-10-18', local: 'RH34', kmInicio: '000+300', kmFim: '000+300', defeito: 'EMPENO', amplitude: '15', latitude: '-19.93', longitude: '-43.94', linkMapa: 'x', criadoEm: '2026-10-18T10:00:00', atualizadoEm: '2026-10-18T10:00:00' };
  s.post('sync', { itens: [{ key: 'anomalia:a1', tipo: 'anomalia', dados: a }] });
  const rec = s.post('getRecentes', { tipo: 'anomalia' }).dados[0];
  assert.equal(rec.kmInicio, '000+300');
  assert.equal(rec.latitude, '-19.93');
  assert.equal(rec.data, '2026-10-18');
});

test('muitas linhas: planilha cresce além do tamanho inicial', () => {
  const s = novo();
  const oms = Array.from({ length: 1500 }, (_, i) => ({ nOrdem: String(10000 + i), textoBreve: `LPR ${i}`, dataProgramada: '2026-11-03' }));
  assert.equal(s.post('importarOMs', { ciclo: '6', oms }).dados.importadas, 1500);
  const itens = Array.from({ length: 100 }, (_, i) => ({ key: `execucao:6|${10000 + i}`, tipo: 'execucao', dados: { ciclo: '6', nOrdem: String(10000 + i), status: 'Realizado', dataRealizacao: '2026-11-03T09:00:00', atualizadoEm: '2026-11-03T09:00:00' } }));
  const r = s.post('sync', { itens });
  assert.ok(r.dados.resultados.every((x) => x.ok));
  assert.equal(s.post('getOMs', { ciclo: '6' }).dados.execucoes.length, 100);
});
