/*
 * Teste de ponta a ponta no navegador (Chromium/Playwright), com o servidor real simulado.
 * Cobre: configuração, checklist, eventos, importação e marcação de OMs (online e offline),
 * relatório de anomalia, tema claro/escuro, persistência após recarregar e o modo Apps Script.
 * Rodar: TZ=America/Sao_Paulo node tests/e2e.mjs   (capturas de tela em tests/saida/)
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { iniciarServidor } from './servidor-teste.mjs';
import { gerarCSV } from './csv-sintetico.mjs';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  playwright = require('/opt/npm-tools/node_modules/playwright');
}

const PORTA = 8787;
const BASE = `http://localhost:${PORTA}`;
const SAIDA = fileURLToPath(new URL('./saida/', import.meta.url));
mkdirSync(SAIDA, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = new Date();
const diaRel = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d; };
const serialExcel = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);

/** Planilha sintética no formato do SAP (sem dados reais). */
function linhasSintéticas() {
  const cab = ['Nº Ordem', 'Texto breve', 'Denominação do loc.instalação', 'Local de instalação', 'INSTALÇÃO', 'Plano de Manutenção', 'Item de Manutenção', 'Status do Usuario', 'Status da Ordem', 'Data Planejada', 'Data de Tolerância Mínima', 'Data de Tolerância Máxima', 'Ciclo', 'KM', 'KM2', 'STATUS', 'Data Programada'];
  const ramais = ['LPR', 'LPR', 'LPR', 'RFA', 'RBH'];
  const deslocamentos = [0, 0, 0, 0, 0, 0, -1, -1, -2, 1, 1, 2, 3, 4, 5, 7, 8, 9, 10, 14];
  const linhas = [cab];
  for (let i = 0; i < 40; i++) {
    const prog = i < deslocamentos.length ? serialExcel(diaRel(deslocamentos[i])) : '';
    linhas.push([202600000000 + i, `${ramais[i % 5]} ${10 + i}I/${10 + i}V L${(i % 2) + 1}`, `TRECHO TESTE ${i}`, '03-XX', 'EFVM-TESTE', 383503, 1000 + i, 'VPTS AGDO', 'LIB', serialExcel(diaRel(10)), '', '', 2, 1000 * i, 1000 * i + 500, 'LIB: Autorizada p/ execução', prog]);
  }
  return linhas;
}

const PLANTA_E2E = [
  ['Ramal', 'Linha', 'Eh', 'C/T', 'Lado curva', 'Nº Elemento Eh', 'Quilometragem', '', 'Raio'],
  ['', '', '', '', '', '', 'Inicial', 'Final', ''],
  ['TST', 1, 10, 'C', 'E', 1, 1.530, 1.730, 667],
  ['TST', 1, 11, 'T', '', 1, 1.760, 2.030, ''],
  ['TST', 1, 11, 'C', 'D', 1, 2.030, 2.230, 500],
  ['TST', 1, 11, 'T', '', 2, 2.230, 2.531, '']
];
const xlsxFalso = `window.XLSX = { read: () => ({ SheetNames: ['Planilha1'], Sheets: { Planilha1: {} } }), utils: { sheet_to_json: () => window.__linhasXlsx || ${JSON.stringify(linhasSintéticas())} } };`;

async function aguardar(fn, msg, ms = 15000) {
  const ini = Date.now();
  let ultimo;
  while (Date.now() - ini < ms) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) { ultimo = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Tempo esgotado: ${msg} (${ultimo && ultimo.message ? ultimo.message : ultimo})`);
}

const planilha = async () => (await fetch(`${BASE}/__planilha`)).json();

function vigiarErros(page, erros) {
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR_/.test(t)) return; // esperados no teste offline
    erros.push(`console: ${t}`);
  });
}

async function passo(nome, fn) {
  process.stdout.write(`• ${nome} … `);
  await fn();
  console.log('ok');
}

async function main() {
  const srv = await iniciarServidor(PORTA);
  const browser = await playwright.chromium.launch();
  const erros = [];
  let falhou = false;

  try {
    /* ============ Celular, modo site (PWA) ============ */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: xlsxFalso }));
    const page = await ctx.newPage();
    vigiarErros(page, erros);

    await passo('abre na tela de Ajustes quando não configurado', async () => {
      await page.goto(BASE);
      await page.getByRole('heading', { name: 'Ajustes' }).waitFor();
      await page.screenshot({ path: `${SAIDA}01-ajustes.png` });
    });

    await passo('código errado é recusado; certo conecta', async () => {
      await page.fill('input[name="url"]', `${BASE}/exec`);
      await page.fill('input[name="token"]', 'ERRADO');
      await page.getByRole('button', { name: 'Salvar e testar' }).click();
      await page.getByText(/Falhou: Código de acesso inválido/).waitFor();
      // fecha o pedido automático de código
      const depois = page.getByRole('button', { name: 'Depois' });
      if (await depois.isVisible()) await depois.click();
      await page.fill('input[name="token"]', srv.estado.token.toLowerCase());
      await page.getByRole('button', { name: 'Salvar e testar' }).click();
      await page.getByText(/Conectado\. Servidor versão/).waitFor();
    });

    await passo('checklist: validação aponta campos faltando', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Checklist' }).click();
      await page.getByRole('heading', { name: 'Check List de Inspeção' }).waitFor();
      await page.fill('input[name="responsavel"]', '');
      await page.getByRole('button', { name: 'Salvar checklist' }).click();
      await page.locator('.msg-erro').first().waitFor();
      const n = await page.locator('.msg-erro').count();
      assert.ok(n >= 15, `esperava muitos erros, veio ${n}`);
    });

    await passo('checklist: preenche, descreve problemas e salva', async () => {
      await page.fill('input[name="responsavel"]', 'Romário');
      await page.fill('input[name="ciclo"]', '5');
      const ids = await page.locator('.pergunta[data-id]').evaluateAll((els) => els.filter((e) => e.querySelector('.seg')).map((e) => e.dataset.id));
      for (const id of ids) {
        const resp = id === 'comp_m1_salvou' || id === 'comp_perifericos' ? 'Sim' : 'Não';
        await page.locator(`.pergunta[data-id="${id}"] .seg-opcao`, { hasText: resp }).click();
      }
      await page.locator('.pergunta[data-id="ogms_conexao"] .seg-opcao', { hasText: 'Sim' }).click();
      await page.locator('.pergunta[data-id="ogms_conexao"] textarea').fill('Demorou 5 minutos para conectar');
      await page.locator('.pergunta[data-id="comp_m1_salvou"] .seg-opcao', { hasText: 'Não' }).click();
      // descrição obrigatória quando a resposta indica problema
      await page.getByRole('button', { name: 'Salvar checklist' }).click();
      await page.locator('.pergunta[data-id="comp_m1_salvou"] .msg-erro').waitFor();
      await page.locator('.pergunta[data-id="comp_m1_salvou"] textarea').fill('Arquivo do trecho 3 não gravou');
      const bitola = page.locator('.pergunta[data-id="ogms_bitola"] input');
      await bitola.nth(0).fill('1,5');
      await bitola.nth(1).fill('-0,8');
      await page.locator('.pergunta[data-id="ogms_bitola"]').getByRole('button', { name: 'Adicionar amostra' }).click();
      assert.equal(await bitola.count(), 4);
      await bitola.nth(3).fill('2');
      const desgaste = page.locator('.pergunta[data-id="kld_desgaste"] input');
      await desgaste.nth(0).fill('10,2');
      await desgaste.nth(1).fill('10,5');
      await page.screenshot({ path: `${SAIDA}02-checklist.png`, fullPage: true });
      await page.getByRole('button', { name: 'Salvar checklist' }).click();
      await page.getByText('Checklist salvo.').waitFor();
      const p = await aguardar(async () => { const x = await planilha(); return x.Checklists.length === 1 && x; }, 'checklist na planilha');
      assert.equal(p.Checklists[0]['Qtd. problemas'], 2);
      assert.equal(p.Checklists[0]['Ciclo'], '5');
      assert.equal(p.Checklist_Respostas.length, 13);
      assert.equal(p.Checklist_Amostras.length, 4);
      const m1 = p.Checklist_Respostas.find((r) => r['ID Pergunta'] === 'comp_m1_salvou');
      assert.equal(m1['Resposta'], 'Não');
      assert.equal(m1['Problema?'], 'Sim');
      // formulário limpo, mas mantém responsável e ciclo
      assert.equal(await page.inputValue('input[name="responsavel"]'), 'Romário');
      assert.equal(await page.inputValue('input[name="ciclo"]'), '5');
      await page.getByText('2 problema(s)').waitFor();
    });

    await passo('checklist: rascunho sobrevive a recarregar a página', async () => {
      await page.locator('.pergunta[data-id="kld_falha"] .seg-opcao', { hasText: 'Não' }).click();
      await page.waitForTimeout(600);
      await page.reload();
      await page.getByRole('heading', { name: 'Check List de Inspeção' }).waitFor();
      assert.equal(await page.locator('.pergunta[data-id="kld_falha"] .seg-opcao.ativo').textContent(), 'Não');
      await page.getByRole('button', { name: 'Limpar' }).click();
      await page.locator('.modal').getByRole('button', { name: 'Limpar' }).click();
      assert.equal(await page.locator('.pergunta .seg-opcao.ativo').count(), 0);
    });

    await passo('eventos: iniciar agora, finalizar e salvar com horários', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Eventos' }).click();
      await page.getByRole('heading', { name: 'Registro de Eventos' }).waitFor();
      await page.getByRole('button', { name: 'Iniciar agora' }).click();
      await page.locator('[name="equipamento"]').locator('xpath=..').locator('.msg-erro').waitFor();
      await page.selectOption('select[name="equipamento"]', 'KLD');
      await page.fill('input[name="parte"]', 'Sensor laser');
      await page.getByRole('button', { name: 'Iniciar agora' }).click();
      await page.getByText(/iniciado às/).waitFor();
      await page.locator('.item-aberto').first().waitFor();
      await page.screenshot({ path: `${SAIDA}03-eventos-aberto.png`, fullPage: true });
      await page.getByRole('button', { name: 'Finalizar agora' }).click();
      await page.getByText('Evento finalizado.').waitFor();
      assert.equal(await page.locator('.item-aberto').count(), 0);

      await page.getByRole('button', { name: 'Duplicar último' }).click();
      assert.equal(await page.inputValue('select[name="equipamento"]'), 'KLD');
      assert.equal(await page.inputValue('input[name="parte"]'), 'Sensor laser');
      const d = isoLocal(hoje);
      await page.fill('input[name="inicio"]', `${d}T08:00`);
      await page.fill('input[name="fim"]', `${d}T07:00`);
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.getByText('O fim não pode ser antes do início.').waitFor();
      await page.fill('input[name="fim"]', `${d}T09:35`);
      await page.fill('textarea[name="observacao"]', 'Parou a medição de bitola');
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.getByText(/Evento EV-\d{6}-\w{4} salvo\./).waitFor();

      // Outro equipamento
      await page.selectOption('select[name="equipamento"]', 'Outro');
      await page.fill('input[name="outro"]', 'Gerador');
      await page.fill('input[name="inicio"]', `${d}T10:00`);
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.getByText(/salvo \(em aberto\)\./).waitFor();

      const p = await aguardar(async () => { const x = await planilha(); return x.Eventos.length === 3 && x; }, 'eventos na planilha');
      const manual = p.Eventos.find((e) => e['Observação / impacto'] === 'Parou a medição de bitola');
      assert.equal(manual['Duração (min)'], 95);
      assert.ok(p.Eventos.some((e) => e['Equipamento'] === 'Gerador'));
    });

    await passo('eventos: editar evento existente atualiza a mesma linha', async () => {
      await page.locator('.item', { hasText: 'Gerador' }).getByRole('button', { name: 'Editar' }).click();
      assert.equal(await page.inputValue('input[name="outro"]'), 'Gerador');
      await page.fill('input[name="parte"]', 'Partida');
      await page.getByRole('button', { name: 'Salvar alterações' }).click();
      await page.getByText('Evento atualizado.').waitFor();
      const p = await aguardar(async () => { const x = await planilha(); return x.Eventos.some((e) => e['Parte do equipamento'] === 'Partida') && x; }, 'edição na planilha');
      assert.equal(p.Eventos.length, 3);
    });

    await passo('eventos: evento sem equipamento com impacto, painel, exclusão e PDF', async () => {
      const d = isoLocal(hoje);
      await page.selectOption('select[name="categoria"]', 'Atraso da equipe');
      assert.equal(await page.locator('select[name="equipamento"]').count(), 0); // sem equipamento
      await page.fill('input[name="descricao"]', 'Manutenção liberou o carro com atraso');
      await page.fill('input[name="inicio"]', `${d}T06:00`);
      await page.fill('input[name="fim"]', `${d}T11:00`);
      // dois dias de impacto: ontem (83 OMs, 1 dia) e hoje (10 OMs)
      const ontem = isoLocal(new Date(hoje.getTime() - 86400000));
      await page.getByRole('button', { name: 'Adicionar impacto' }).click();
      await page.fill('input[name="impData0"]', ontem);
      await page.fill('input[name="impOms0"]', '83');
      await page.fill('input[name="impValor0"]', '1');
      await page.selectOption('select[name="impUnidade0"]', 'd');
      await page.getByRole('button', { name: 'Adicionar outro dia de impacto' }).click();
      assert.equal(await page.inputValue('input[name="impData1"]'), d); // dia seguinte ao anterior
      await page.fill('input[name="impOms1"]', '10');
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.getByText(/Evento EV-\d{6}-\w{4} salvo\./).waitFor();
      const item = page.locator('.item', { hasText: 'Manutenção liberou o carro com atraso' });
      await item.getByText('83 OMs perdidas').waitFor();
      assert.match(await item.locator('.ev-codigo').textContent(), /^EV-\d{6}-\w{4} · Atraso da equipe$/);
      // painel: indicadores e gráficos
      const painel = page.locator('.cartao', { has: page.getByRole('heading', { name: 'Painel de eventos' }) });
      assert.equal(await painel.locator('.kpi', { hasText: 'OMs perdidas' }).locator('.kpi-valor').textContent(), '93');
      assert.equal(await painel.locator('.kpi', { hasText: 'Impacto no tempo' }).locator('.kpi-valor').textContent(), '24 h (1 dia)');
      assert.ok(await painel.locator('svg.graf-largo').count() >= 3);
      // outro evento, excluído em seguida
      await page.selectOption('select[name="categoria"]', 'Chuva');
      await page.fill('input[name="inicio"]', `${d}T13:00`);
      await page.fill('input[name="fim"]', `${d}T14:00`);
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.getByText(/Evento EV-\d{6}-\w{4} salvo\./).waitFor();
      await page.locator('.item', { hasText: 'Chuva' }).getByRole('button', { name: /Excluir/ }).click();
      await page.locator('.modal').getByRole('button', { name: 'Excluir' }).click();
      await page.getByText(/excluído\./).waitFor();
      assert.equal(await page.locator('.item', { hasText: 'Chuva' }).count(), 0);
      const p = await aguardar(async () => { const x = await planilha(); return x.Eventos.some((e) => e['Tipo de evento'] === 'Chuva' && e['Excluído em']) && x; }, 'exclusão na planilha');
      const atraso = p.Eventos.find((e) => e['Tipo de evento'] === 'Atraso da equipe');
      assert.equal(atraso['OMs perdidas'], 93);
      const porDia = p.Eventos_Impactos.filter((i) => i['ID Evento'] === atraso['ID']);
      assert.deepEqual(porDia.map((i) => i['OMs perdidas']).sort((a, b) => a - b), [10, 83]);
      assert.equal(atraso['Impacto (h)'], 24);
      assert.equal(atraso['Descrição'], 'Manutenção liberou o carro com atraso');
      assert.match(atraso['Código do evento'], /^EV-\d{6}-\w{4}$/);
      assert.ok(String(atraso['Data do impacto']).startsWith(isoLocal(new Date(hoje.getTime() - 86400000))), `data do impacto ${atraso['Data do impacto']}`);
      await item.getByText(/\d{2}\/\d{2}: 10 OMs perdidas/).waitFor();
      // PDF (impressão simulada)
      await page.evaluate(() => { window.__impressoes = 0; window.print = () => { window.__impressoes++; }; });
      await painel.getByRole('button', { name: 'Exportar PDF' }).click();
      await page.waitForFunction(() => window.__impressoes === 1);
      const pdf = page.locator('#laudo');
      assert.ok((await pdf.textContent()).includes('Relatório de Eventos'));
      assert.ok((await pdf.textContent()).includes('Manutenção liberou o carro com atraso'));
      assert.ok(!(await pdf.textContent()).includes('Chuva'), 'evento excluído fora do PDF');
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: `${SAIDA}04-eventos.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.screenshot({ path: `${SAIDA}04-eventos-painel.png`, fullPage: true });
    });

    await passo('produção: importa planilha do SAP (ciclo digitado)', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Produção' }).click();
      await page.getByRole('heading', { name: 'Produção de OMs' }).waitFor();
      await page.locator('.vazio-grande').getByRole('button', { name: 'Importar planilha' }).click();
      const modal = page.locator('.modal');
      await modal.locator('input[type="file"]').setInputFiles({ name: 'OM_5_CICLO.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('falso') });
      await modal.getByText('40 OMs encontradas').waitFor();
      assert.equal(await modal.getByRole('button', { name: 'Importar' }).isDisabled(), true); // falta o ciclo
      await modal.locator('input[inputmode="numeric"]').fill('5');
      await modal.getByRole('button', { name: 'Importar' }).click();
      await page.getByText('40 OMs importadas no ciclo 5.').waitFor();
      const p = await planilha();
      assert.equal(p.OMs.length, 40);
      assert.equal(p.OMs[0]['Ciclo'], '5');
      await page.locator('.kpi:visible').first().waitFor();
      await page.screenshot({ path: `${SAIDA}04-producao.png`, fullPage: true });
    });

    await passo('produção: marcar, desfazer e metas do dia', async () => {
      const textoKpi = () => page.locator('.kpi:visible').first().locator('.kpi-sub').textContent();
      assert.equal(await textoKpi(), '0 de 6 OMs');
      const oms = page.locator('.lista-om .om-botao');
      assert.equal(await oms.count(), 6);
      await oms.nth(0).click();
      await page.waitForTimeout(800);
      await oms.nth(1).click();
      await page.waitForTimeout(800);
      await oms.nth(2).click();
      await aguardar(async () => (await textoKpi()) === '3 de 6 OMs', 'kpi 3 de 6');
      assert.equal(await page.locator('.kpi:visible').first().locator('.kpi-valor').textContent(), '50%');
      // toque duplo rápido não desfaz sem querer
      await oms.nth(3).click();
      await oms.nth(3).click();
      await aguardar(async () => (await textoKpi()) === '4 de 6 OMs', 'trava de toque duplo');
      await page.waitForTimeout(800);
      await oms.nth(3).click(); // desfaz de propósito
      await aguardar(async () => (await textoKpi()) === '3 de 6 OMs', 'desfazer');
      const p = await aguardar(async () => {
        const x = await planilha();
        return x.Execucoes.length === 4 && x.Execucoes.filter((e) => e['Status'] === 'Realizado').length === 3 && x;
      }, 'execuções na planilha');
      assert.ok(p.Execucoes.every((e) => e['Status'] === 'Não realizado' ? e['Data/hora realização'] === '' : e['Data/hora realização'] !== ''));
    });

    await passo('produção: atrasadas, filtro por ramal e busca', async () => {
      await page.getByRole('button', { name: /^Atrasadas \(3\)$/ }).click();
      assert.equal(await page.locator('.lista-om .om').count(), 3);
      await page.getByRole('button', { name: /^Todas \(40\)$/ }).click();
      await page.selectOption('select[aria-label="Ramal"]', 'RFA');
      assert.equal(await page.locator('.lista-om .om').count(), 8);
      await page.fill('input[type="search"]', 'trecho teste 13');
      await aguardar(async () => (await page.locator('.lista-om .om').count()) === 1, 'busca');
      await page.fill('input[type="search"]', '');
      await page.selectOption('select[aria-label="Ramal"]', '');
      await page.getByRole('button', { name: /^Hoje \(\d+\)$/ }).click();
    });

    await passo('produção: offline marca no aparelho e envia quando volta', async () => {
      await ctx.setOffline(true);
      const oms = page.locator('.lista-om .om-botao');
      await oms.nth(4).click();
      await page.locator('.sync-badge.pendente, .sync-badge.erro').waitFor();
      await page.screenshot({ path: `${SAIDA}05-offline.png` });
      await page.waitForTimeout(2000);
      let p = await planilha();
      assert.equal(p.Execucoes.filter((e) => e['Status'] === 'Realizado').length, 3);
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      p = await aguardar(async () => { const x = await planilha(); return x.Execucoes.filter((e) => e['Status'] === 'Realizado').length === 4 && x; }, 'sincronizar ao voltar');
      await page.locator('.sync-badge.ok').waitFor();
    });

    await passo('produção: falha de rede no meio do envio não perde dados', async () => {
      srv.estado.falharRede = true;
      const oms = page.locator('.lista-om .om-botao');
      await oms.nth(5).click();
      await page.locator('.sync-badge.erro, .sync-badge.pendente').waitFor();
      await page.waitForTimeout(2500);
      srv.estado.falharRede = false;
      await page.locator('.sync-badge').click(); // vai para Ajustes
      await page.getByRole('button', { name: 'Sincronizar agora' }).click();
      await aguardar(async () => { const x = await planilha(); return x.Execucoes.filter((e) => e['Status'] === 'Realizado').length === 5; }, 'reenvio após falha');
      await page.getByText('Tudo enviado para a planilha.').waitFor();
    });

    await passo('produção: reprogramar OM', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Produção' }).click();
      await page.getByRole('button', { name: /^Atrasadas \(\d+\)$/ }).click();
      const antes = await page.locator('.lista-om .om').count();
      await page.locator('.lista-om .om').first().getByRole('button', { name: /Reprogramar/ }).click();
      await page.locator('.modal input[type="date"]').fill(isoLocal(diaRel(3)));
      await page.locator('.modal').getByRole('button', { name: 'Salvar' }).click();
      await page.getByText(/OM reprogramada/).waitFor();
      assert.equal(await page.locator('.lista-om .om').count(), antes - 1);
      await aguardar(async () => { const x = await planilha(); return x.OMs.filter((o) => o['Data programada'] === isoLocal(diaRel(3))).length === 2; }, 'reprogramação na planilha');
    });

    await passo('produção: programação no calendário (adicionar, mover, retirar)', async () => {
      await page.locator('.seg-modo').getByRole('button', { name: 'Programação' }).click();
      await page.locator('.cal-dia.sel').waitFor();
      const kpiDia = () => page.locator('.kpi:visible').first().locator('.kpi-sub').textContent();
      assert.equal(await kpiDia(), '5 de 6 OMs');
      await page.getByRole('heading', { name: /^Programadas para .* \(6\)$/ }).waitFor();
      const cartaoAdd = page.locator('section.cartao').filter({ hasText: 'Adicionar OMs em' });
      await cartaoAdd.getByRole('button', { name: 'Sem programação (20)' }).waitFor();
      await cartaoAdd.locator('select[aria-label="Ramal"]').selectOption('RFA');
      assert.equal(await cartaoAdd.locator('.om-sel').count(), 4);
      await cartaoAdd.getByLabel('Selecionar todas as visíveis').check();
      await cartaoAdd.getByRole('button', { name: /^Programar 4 em/ }).click();
      await page.getByText('4 OM(s) programada(s)', { exact: false }).waitFor();
      await aguardar(async () => (await kpiDia()) === '5 de 10 OMs', 'kpi após programar');
      await page.screenshot({ path: `${SAIDA}16-programacao.png`, fullPage: true });

      // mover uma para outra data (amanhã, padrão do campo)
      const cartaoDia = page.locator('section.cartao').filter({ hasText: 'Programadas para' });
      await cartaoDia.locator('.om-sel').filter({ hasText: 'RFA 43I' }).locator('input[type="checkbox"]').check();
      await cartaoDia.getByRole('button', { name: 'Mover' }).click();
      await page.getByText('1 OM(s) movida(s)', { exact: false }).waitFor();
      await aguardar(async () => (await kpiDia()) === '5 de 9 OMs', 'kpi após mover');
      // retirar uma da programação
      await page.locator('section.cartao').filter({ hasText: 'Programadas para' }).locator('.om-sel').filter({ hasText: 'RFA 48I' }).getByRole('button', { name: /^Retirar/ }).click();
      await aguardar(async () => (await kpiDia()) === '5 de 8 OMs', 'kpi após retirar');
      // o dia seguinte mostra a OM movida; a planilha recebe tudo
      const amanha = isoLocal(diaRel(1));
      await aguardar(async () => {
        const x = await planilha();
        const por = (n) => x.OMs.find((o) => o['Nº Ordem'] === String(202600000000 + n))['Data programada'];
        return por(23) === isoLocal(diaRel(0)) && por(33) === amanha && por(38) === '' && por(28) === isoLocal(diaRel(0));
      }, 'programação na planilha');
      // histórico: as 2 OMs que saíram de hoje ficam registradas
      const saidas = page.locator('details.saidas');
      await saidas.locator('summary', { hasText: 'Reprogramadas deste dia (2)' }).waitFor();
      assert.ok((await saidas.textContent()).includes('1 retirada(s)'));
      await aguardar(async () => {
        const x = await planilha();
        return x.Reprogramacoes && x.Reprogramacoes.length === 3 // + a reprogramação do passo anterior
          && x.Reprogramacoes.some((h) => h['Tipo'] === 'Movida' && h['Nova data'] === amanha)
          && x.Reprogramacoes.some((h) => h['Tipo'] === 'Retirada');
      }, 'histórico de reprogramação na planilha');
      await page.locator('.seg-modo').getByRole('button', { name: 'Execução' }).click();
      await page.getByRole('button', { name: /^Hoje \(\d+\)$/ }).waitFor();
    });

    await passo('produção: status SAP visível e apropriação das realizadas', async () => {
      assert.ok((await page.locator('.lista-om .om').first().textContent()).includes('LIB: Autorizada p/ execução'));
      const aba = page.getByRole('button', { name: /^A apropriar \(\d+\)$/ });
      const n0 = Number((await aba.textContent()).match(/\((\d+)\)/)[1]);
      assert.ok(n0 > 0);
      await aba.click();
      await page.locator('.lista-om .om').first().getByRole('button', { name: /não apropriada no SAP/ }).click();
      await aguardar(async () => (await page.getByRole('button', { name: /^A apropriar \(\d+\)$/ }).textContent()) === `A apropriar (${n0 - 1})`, 'contador a apropriar');
      await aguardar(async () => { const x = await planilha(); return x.Execucoes.filter((e) => e['Apropriada no SAP em']).length === 1; }, 'apropriação na planilha');
      await page.getByRole('button', { name: /^Hoje \(\d+\)$/ }).click();
    });

    await passo('anomalia: gaveta lateral gera a mensagem e limpa o formulário', async () => {
      await page.getByRole('button', { name: 'Abrir relatório de anomalia' }).click();
      const g = page.locator('.gaveta');
      await g.getByRole('heading', { name: 'Relatório de Anomalia' }).waitFor();
      await g.getByRole('button', { name: 'Salvar e gerar mensagem' }).click();
      await g.locator('.msg-erro').first().waitFor();
      await g.locator('[name="acaoTomada"]').fill('Interdição');
      await g.locator('[name="local"]').fill('RH34');
      await g.locator('[name="kmInicio"]').fill('300');
      await g.locator('[name="kmFim"]').fill('0+300');
      await g.locator('[name="defeito"]').fill('Empeno base 2');
      await g.locator('[name="amplitude"]').fill('15');
      await g.locator('[name="observacao"]').fill('Defeito perto da ponte');
      await g.locator('[name="elemento"]').fill('cva23');
      await g.locator('[name="latitude"]').fill('-19,9312');
      await g.locator('[name="longitude"]').fill('-43.9401');
      await page.screenshot({ path: `${SAIDA}06-anomalia-form.png` });
      await g.getByRole('button', { name: 'Salvar e gerar mensagem' }).click();
      const msg = await g.locator('pre.mensagem').textContent();
      const esperado = [
        '*RELATÓRIO DE ANOMALIA*', '', '*▪ AÇÃO TOMADA:* INTERDIÇÃO', '', `*▪ DATA:* ${isoLocal(hoje).split('-').reverse().join('/')}`, '',
        '*▪ LOCAL:* RH34', '', '*▪ KM INÍCIO:* 000+300', '', '*▪ KM FIM:* 000+300', '', '*▪ DEFEITO:* EMPENO BASE 2', '',
        '*▪ AMPLITUDE:* 15', '', '*▪ OBSERVAÇÃO:* DEFEITO PERTO DA PONTE', '', '*▪ ELEMENTO:* CVA23', '',
        '*▪ LINK DO MAPA:* https://www.google.com/maps/search/?api=1&query=-19.9312,-43.9401'
      ].join('\n');
      assert.equal(msg, esperado);
      assert.equal(await g.getByRole('link', { name: /WhatsApp/ }).count(), 0);
      assert.equal(await g.getByRole('button', { name: 'Copiar mensagem' }).count(), 1);
      // formulário já limpo para o próximo defeito (data de hoje mantida)
      assert.equal(await g.locator('[name="local"]').inputValue(), '');
      assert.equal(await g.locator('[name="defeito"]').inputValue(), '');
      assert.equal(await g.locator('[name="latitude"]').inputValue(), '');
      assert.equal(await g.locator('[name="data"]').inputValue(), isoLocal(hoje));
      await page.screenshot({ path: `${SAIDA}07-anomalia-mensagem.png` });
      const p = await aguardar(async () => { const x = await planilha(); return x.Anomalias.length === 1 && x; }, 'anomalia na planilha');
      assert.equal(p.Anomalias[0]['KM início'], '000+300');
      await g.getByRole('button', { name: 'Ocultar mensagem' }).click();
      assert.equal(await g.locator('pre.mensagem').count(), 0);
      await g.getByRole('button', { name: 'Fechar' }).click();
      await page.getByRole('button', { name: 'Abrir relatório de anomalia' }).waitFor();
    });

    await passo('tema escuro e claro', async () => {
      await page.getByRole('button', { name: 'Mudar para tema escuro' }).click();
      assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
      await page.getByRole('navigation').getByRole('button', { name: 'Produção' }).click();
      await page.getByRole('button', { name: /^Hoje \(\d+\)$/ }).click();
      await page.screenshot({ path: `${SAIDA}08-producao-escuro.png`, fullPage: true });
      await page.reload();
      assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
      await page.getByRole('button', { name: 'Mudar para tema claro' }).click();
      assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    });

    await passo('dados continuam no aparelho após recarregar', async () => {
      await page.reload();
      await page.getByRole('navigation').getByRole('button', { name: 'Eventos' }).click();
      await page.getByText('Partida').first().waitFor();
      // Sem internet: o app abre pela cópia guardada (service worker).
      await ctx.setOffline(true);
      await page.reload();
      await page.getByRole('heading', { name: 'Registro de Eventos' }).waitFor();
      await page.getByText('Partida').first().waitFor();
      await ctx.setOffline(false);
    });

    await passo('análise do arquivo do carro: elementos, perda de bitola e ranking', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Checklist' }).click();
      await page.getByRole('tab', { name: 'Análise do arquivo' }).click();
      await page.locator('input[type="file"][accept=".csv,.txt"]').setInputFiles({ name: 'TESTE.csv', mimeType: 'text/csv', buffer: Buffer.from(gerarCSV(), 'latin1') });
      await page.locator('.graf-km svg').first().waitFor();
      assert.deepEqual(await page.locator('.tabela:not(.tabela-offset)').first().locator('tbody .el-tag').allTextContents(), ['T02', 'T01', 'C01', 'C02']); // maior perda primeiro
      assert.equal(await page.locator('.kpi:visible').first().locator('.kpi-valor').textContent(), '5,0%');
      await page.locator('.conf-ok', { hasText: 'Conferido' }).waitFor(); // dupla checagem independente
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Planilha de conferência' }).click()]);
      const planilhaConf = await (async () => { const st = await download.createReadStream(); const parts = []; for await (const ch of st) parts.push(ch); return Buffer.concat(parts).toString('utf8'); })();
      const linhasConf = planilhaConf.trim().split(/\r?\n/);
      assert.equal(linhasConf.length, 4001); // cabeçalho + 4.000 pontos
      assert.equal(linhasConf.slice(1).filter((l) => l.split(';')[7] === '1').length, 200); // pontos acima da regra
      // os cartões batem com a planilha: pontos = soma de "Na estatística"; acima = acima e na estatística
      const naEst = linhasConf.slice(1).map((l) => l.split(';')).filter((c) => c[11] === '1');
      const cartao = await page.locator('.kpi:visible').first().locator('.kpi-sub').textContent();
      assert.equal(cartao, `${naEst.filter((c) => c[7] === '1').length.toLocaleString('pt-BR')} de ${naEst.length.toLocaleString('pt-BR')} pontos`);
      const rk = page.locator('.tabela:not(.tabela-offset)').nth(1).locator('tbody tr').first();
      assert.equal(await rk.locator('td').nth(1).textContent(), '1+700');
      await page.screenshot({ path: `${SAIDA}13-analise.png`, fullPage: true });
      await page.locator('.tabela:not(.tabela-offset)').first().locator('tbody tr').nth(2).click();
      await page.getByRole('button', { name: 'Ver tudo' }).waitFor();

      // Laudo em PDF: a janela de impressão é simulada; confere o conteúdo montado.
      await page.evaluate(() => { window.__impressoes = 0; window.print = () => { window.__impressoes++; }; });
      await page.getByRole('button', { name: 'Gerar laudo (PDF)' }).click();
      const modalLaudo = page.locator('.modal');
      await modalLaudo.locator('select').first().selectOption('Reprovado');
      await modalLaudo.locator('textarea').fill('Teste de parecer');
      await modalLaudo.getByRole('button', { name: 'Gerar PDF' }).click();
      await page.waitForFunction(() => window.__impressoes === 1);
      const laudo = page.locator('#laudo');
      assert.equal(await laudo.locator('.laudo-resultado strong').textContent(), 'Reprovado');
      assert.equal(await laudo.locator('.laudo-grafico svg').count(), 6);
      assert.ok((await laudo.textContent()).includes('Checklist de inspeção'), 'checklist incluído no laudo');
      assert.ok((await laudo.textContent()).includes('TGT 02'));
      assert.ok((await laudo.textContent()).includes('Melhor offset e resultado se aplicado'), 'tabela de melhor offset no laudo');
      assert.ok((await laudo.textContent()).includes('% c/ offset'), 'coluna de perda com offset por elemento');
      assert.ok((await laudo.textContent()).includes('TGT 02'), 'elemento abreviado (TGT/CVA)');
      assert.ok(!(await laudo.textContent()).includes('Gerado pelo App'), 'sem rodapé de texto');
      assert.equal(await laudo.locator('.laudo-cab .laudo-foto').count(), 1);
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: `${SAIDA}14-laudo.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      assert.equal(await page.locator('#laudo').count(), 0);
      // Planta da linha: elementos por EH, com ajuste automático do km (+30 m nos dados inventados).
      await page.evaluate((linhas) => { window.__linhasXlsx = linhas; }, PLANTA_E2E);
      await page.locator('input[type="file"][accept=".xls,.xlsx"]').setInputFiles({ name: 'Planta.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('falso') });
      await page.getByText('Planta importada').waitFor();
      await page.evaluate(() => { delete window.__linhasXlsx; });
      // Ramal e linha vêm do arquivo CSV (sem escolha na planta).
      const criterios = page.locator('details').filter({ hasText: 'Critérios da análise' });
      assert.equal(await criterios.getByLabel('Linha').count(), 0);
      const tabEls = page.locator('.tabela:not(.tabela-offset)').filter({ hasText: 'Lado' });
      assert.deepEqual(await tabEls.locator('tbody .el-tag').allTextContents(), ['T01', 'T02', 'C01', 'C01', 'RH']); // maior perda primeiro; pátio (RH) por último
      const trechos = await tabEls.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.children[0].textContent)); // EH/RH primeiro
      assert.deepEqual(trechos, ['EH 11/12', 'EH 11/12', 'EH 11/12', 'EH 10/11', 'RH-11']);
      assert.equal(await tabEls.locator('tbody tr').first().locator('td').nth(1).textContent(), '1'); // depois a linha do arquivo
      // Gráfico de bitolas: escolher quais aparecem (F, T, KLD).
      const selBit = page.locator('.bitolas-sel');
      await selBit.getByLabel('KLD').check();
      await page.locator('.graf-km-item').filter({ hasText: 'Bitolas (mm): Bitola F, Bitola T e KLD' }).waitFor();
      await page.locator('.bitolas-sel').getByLabel('Bitola F').uncheck();
      await page.locator('.graf-km-item').filter({ hasText: 'Bitolas (mm): Bitola T e KLD' }).waitFor();
      // Gráfico selecionável: empeno, nivelamento, superelevação além do alinhamento.
      await page.getByLabel(/Parâmetro do gráfico/).selectOption('emp10');
      await page.locator('.graf-km-item h3', { hasText: 'Empeno e torção: EMP_10 (empeno)' }).waitFor();
      await page.getByLabel(/Parâmetro do gráfico/).selectOption('sup');
      await page.locator('.graf-km-item h3', { hasText: 'Superelevação: SUPerABS' }).waitFor();
      await page.getByLabel(/Parâmetro do gráfico/).selectOption('alr10');
      // Offset: o melhor valor na bitola T zera a perda.
      const cartaoOff = page.locator('details').filter({ hasText: 'Simulação de offset' });
      await cartaoOff.locator('summary').click();
      await cartaoOff.locator('select').selectOption('bitT');
      await page.locator('details').filter({ hasText: 'Simulação de offset' }).getByRole('button', { name: /Usar melhor offset/ }).click();
      await page.locator('details').filter({ hasText: 'Simulação de offset' }).locator('input[type="checkbox"]').check();
      await page.waitForFunction(() => document.querySelector('.kpi .kpi-valor')?.textContent === '0,0%');
      await page.locator('.graf-alvo').first().hover();
      await page.screenshot({ path: `${SAIDA}15-analise-planta.png`, fullPage: true });
      await page.locator('details').filter({ hasText: 'Simulação de offset' }).locator('input[type="checkbox"]').uncheck();
      // o arquivo fica guardado no aparelho
      await page.reload();
      await page.getByRole('tab', { name: 'Análise do arquivo' }).waitFor();
      await page.getByText('TESTE.csv').waitFor();
      await page.getByRole('tab', { name: 'Checklist' }).click();
    });

    await passo('rota: programação dia a dia, ponto de atenção, execução e PDF', async () => {
      await page.getByRole('navigation').getByRole('button', { name: 'Rota' }).click();
      await page.getByRole('heading', { name: 'Rota do carro controle' }).waitFor();
      // a planta já foi importada na análise (mesmo aparelho): o esquema usa a malha dela
      await page.locator('.vazio-grande').getByRole('button', { name: 'Nova rota' }).click();
      await page.locator('.modal input').fill('3');
      await page.locator('.modal').getByRole('button', { name: 'Criar' }).click();
      await page.locator('.esquema').first().waitFor();
      const alvos = await page.locator('.esq-alvo').evaluateAll((els) => els.map((e) => e.dataset.trecho));
      assert.deepEqual(alvos, ['TST:EH:10@1', 'TST:RH:10>11@1', 'TST:EH:11@1']);
      assert.ok((await page.locator('.esq-num').allTextContents()).includes('11')); // pátio RH-11
      // de… até…: inclui os 3 trechos
      await page.getByRole('button', { name: 'De… até…' }).click();
      await page.locator('.esq-alvo[data-trecho="TST:EH:10@1"]').click();
      await page.locator('.esq-alvo[data-trecho="TST:EH:11@1"]').click();
      await page.getByText('3 trecho(s) incluído(s) na rota.').waitFor();
      assert.equal(await page.locator('.esq-camada').count(), 3);
      // trecho a trecho: retira o pátio
      await page.getByRole('button', { name: 'Trecho a trecho' }).click();
      await page.locator('.esq-alvo[data-trecho="TST:RH:10>11@1"]').click();
      // o carro continua passando pelo pátio (entre dois EH da rota na mesma linha): o desenho segue contínuo
      await page.getByText(/km programados/).waitFor();
      assert.equal(await page.locator('.esq-camada').count(), 3);
      // ponto de atenção pelo esquema
      await page.getByRole('button', { name: 'Ponto de atenção' }).click();
      await page.locator('.esq-alvo[data-trecho="TST:EH:11@1"]').click();
      await page.locator('.modal input[list="tipos-ponto"]').fill('Subst. TR');
      await page.locator('.modal input[placeholder^="Ex.: 08:30"]').fill('08:30 a 13:00');
      await page.locator('.modal textarea').fill('TR2 - substituição de trilho');
      await page.locator('.modal').getByRole('button', { name: 'Salvar' }).click();
      await page.getByText('Ponto de atenção salvo.').waitFor();
      await page.locator('.esq-ponto').first().waitFor();
      await page.locator('textarea[placeholder^="Ex.: Circulação"]').fill('Circulação de teste');
      await page.locator('input[placeholder^="Ex.: EH-30/31"]').fill('EH-30/31 L02');
      await page.locator('input[placeholder^="Ex.: EH-30/31"]').press('Tab');
      await page.screenshot({ path: `${SAIDA}17-rota-programacao.png`, fullPage: true });
      await aguardar(async () => {
        const x = await planilha();
        return x.Rota_Dias && x.Rota_Dias.length === 1 && x.Rota_Dias[0]['Trechos programados'] === 'TST:EH:10@1,TST:EH:11@1'
          && x.Rota_Dias[0]['Garageamento'] === 'EH-30/31 L02' && x.Rota_Pontos && x.Rota_Pontos[0]['Tipo'] === 'Subst. TR';
      }, 'rota na planilha');
      // execução: marca o percorrido e mede a aderência
      await page.locator('.seg-modo').getByRole('button', { name: 'Execução' }).click();
      await page.locator('.esq-alvo[data-trecho="TST:EH:10@1"]').click();
      await aguardar(async () => (await page.locator('section[aria-label="Rota"] .kpi').first().locator('.kpi-valor').textContent()) !== '0%', 'aderência');
      const ader = await page.locator('section[aria-label="Rota"] .kpi').first().locator('.kpi-valor').textContent();
      assert.ok(/^\d+%$/.test(ader) && ader !== '100%', ader);
      await page.getByRole('button', { name: 'Marcar todo o programado' }).click();
      await aguardar(async () => (await page.locator('section[aria-label="Rota"] .kpi').first().locator('.kpi-valor').textContent()) === '100%', 'aderência 100%');
      await aguardar(async () => { const x = await planilha(); return x.Rota_Dias[0]['Trechos executados'] === 'TST:EH:10@1,TST:EH:11@1'; }, 'execução na planilha');
      // PDF (impressão simulada): uma página por dia + visão geral
      await page.evaluate(() => { window.__impressoes = 0; window.print = () => { window.__impressoes++; }; });
      await page.getByRole('button', { name: 'PDF da execução' }).click();
      await page.locator('.modal').getByLabel(/Visão geral/).check();
      await page.locator('.modal').getByRole('button', { name: 'Gerar PDF' }).click();
      await page.waitForFunction(() => window.__impressoes === 1);
      assert.equal(await page.locator('#laudo .rota-pagina').count(), 2);
      assert.ok((await page.locator('#laudo').textContent()).includes('ROTA PARA O 1º DIA DE INSPEÇÃO'));
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: `${SAIDA}18-rota.pdf`, printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.locator('.seg-modo').getByRole('button', { name: 'Programação' }).click();
    });

    await ctx.close();

    /* ============ Computador ============ */
    await passo('computador: layout largo e gráficos com dica ao passar o mouse', async () => {
      const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
      const pd = await ctxD.newPage();
      vigiarErros(pd, erros);
      await pd.addInitScript(([url, token]) => {
        localStorage.setItem('em80:apiUrl', JSON.stringify(url));
        localStorage.setItem('em80:apiToken', JSON.stringify(token));
        localStorage.setItem('em80:cicloAtivo', JSON.stringify('5'));
        localStorage.setItem('em80:aba', JSON.stringify('producao'));
      }, [`${BASE}/exec`, srv.estado.token]);
      await pd.goto(BASE);
      await pd.locator('.kpi:visible').first().waitFor();
      await pd.locator('.graf-alvo').first().hover();
      await pd.locator('.graf-tip:not([hidden])').waitFor();
      await pd.screenshot({ path: `${SAIDA}09-computador.png`, fullPage: true });
      await pd.getByRole('navigation').getByRole('button', { name: 'Checklist' }).click();
      await pd.screenshot({ path: `${SAIDA}10-computador-checklist.png` });
      // Versão nova publicada: o app avisa e oferece atualizar.
      await pd.route(/js\/config\.js\?v=/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: "build: 'em80-nova12345'" }));
      await pd.evaluate(() => App.versao.verificar());
      await pd.locator('.aviso-versao').getByRole('button', { name: 'Atualizar agora' }).waitFor();
      await pd.locator('.aviso-versao').getByRole('button', { name: 'Fechar aviso' }).click();
      await pd.unroute(/js\/config\.js\?v=/);
      await pd.getByRole('button', { name: 'Abrir relatório de anomalia' }).click();
      await pd.locator('.gaveta.aberta').waitFor();
      await pd.waitForTimeout(300);
      await pd.screenshot({ path: `${SAIDA}11-computador-gaveta.png` });
      await ctxD.close();
    });

    /* ============ Modo Apps Script (Index.html gerado) ============ */
    await passo('modo Apps Script: Index.html único funciona com google.script.run', async () => {
      const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
      const pa = await ctxA.newPage();
      vigiarErros(pa, erros);
      await pa.addInitScript((execUrl) => {
        // Simula o google.script.run chamando o servidor de teste.
        const criar = () => {
          let ok = null; let falha = null;
          const runner = {
            withSuccessHandler(f) { ok = f; return runner; },
            withFailureHandler(f) { falha = f; return runner; },
            apiCall(pedido) {
              fetch(execUrl, { method: 'POST', body: JSON.stringify(pedido) })
                .then((r) => r.json()).then((r) => ok && ok(r)).catch((e) => falha && falha(e));
            }
          };
          return runner;
        };
        window.google = { script: { get run() { return criar(); } } };
      }, `${BASE}/exec`);
      await pa.goto(`${BASE}/apps-script/Index.html`);
      await pa.getByRole('heading', { name: /Check List|Ajustes/ }).waitFor();
      const src = await pa.locator('.cab-foto').getAttribute('src');
      assert.ok(src.startsWith('data:image/jpeg;base64,'), 'imagem embutida');
      // Sem código salvo: o app pede o código logo ao abrir. "Depois" deixa usar offline.
      await pa.getByRole('dialog', { name: 'Código de acesso' }).waitFor();
      await pa.locator('.modal').getByRole('button', { name: 'Depois' }).click();
      await pa.getByRole('navigation').getByRole('button', { name: 'Eventos' }).click();
      await pa.selectOption('select[name="equipamento"]', 'OGMS');
      await pa.getByRole('button', { name: 'Iniciar agora' }).click();
      await pa.getByText(/iniciado às/).waitFor();
      await pa.locator('.sync-badge.erro, .sync-badge.pendente').waitFor();
      await pa.waitForTimeout(3500); // o pedido de código não reaparece em sequência
      await pa.locator('.sync-badge').click();
      await pa.fill('input[name="token"]', srv.estado.token);
      await pa.getByRole('button', { name: 'Salvar e testar' }).click();
      await aguardar(async () => { const x = await planilha(); return x.Eventos.some((e) => e['Equipamento'] === 'OGMS'); }, 'evento via google.script.run');
      await pa.screenshot({ path: `${SAIDA}12-apps-script.png` });
      await ctxA.close();
    });
  } catch (e) {
    falhou = true;
    console.log('FALHOU');
    console.error(e);
  } finally {
    await browser.close();
    await srv.fechar();
  }

  if (erros.length) {
    falhou = true;
    console.error('\nErros no navegador:\n' + [...new Set(erros)].join('\n'));
  }
  console.log(falhou ? '\nRESULTADO: FALHA' : '\nRESULTADO: todos os testes passaram');
  process.exit(falhou ? 1 : 0);
}

main();
