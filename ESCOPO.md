# Escopo do App – Carro Controle EM80

Documento de referência do projeto. Reúne tudo o que foi definido antes do início do desenvolvimento.

- **Responsável:** Romário Costa – CMA (Centro de Monitoramento de Ativos)
- **Última atualização:** 18/10/2026 (versão 1.0.0 desenvolvida)

---

## 1. Visão geral

App para uso em campo no Carro Controle EM80, com cinco módulos:

| # | Módulo | Status do escopo |
|---|---|---|
| 1 | Check List de Inspeção | Fechado |
| 2 | Registro de Eventos | Fechado |
| 3 | Produção de OMs | Fechado |
| 4 | Dashboard (BigQuery + IA) | Fase futura |
| 5 | Relatório de Anomalia (aba lateral) | Fechado |
| 6 | Rota do carro controle | Em uso (v1) |

### Requisitos gerais
- Funciona no **celular** e no **navegador do computador** (mesmo link, layout responsivo).
- Funciona **offline** nos módulos 1, 2, 3 e 5. Os registros ficam salvos no aparelho e sincronizam com a planilha quando houver sinal (cerca de 90% do tempo há sinal).
- **Tema claro e escuro**, com botão no topo para alternar. O app lembra a última escolha.
- **Sem login de operador** por enquanto (uso individual). A identificação pode ser adicionada depois.
- Hospedado na **conta Google pessoal** (Drive).

---

## 2. Arquitetura

| Camada | Tecnologia |
|---|---|
| Telas (front-end) | HTML, CSS e JavaScript, como PWA (instalável na tela inicial do celular) |
| Back-end | Google Apps Script (JavaScript), publicado como Web App |
| Banco operacional | Google Sheets (uma aba por módulo) |
| Armazenamento offline | IndexedDB no navegador do aparelho, com fila de sincronização |
| Análise (futuro) | BigQuery para os CSVs grandes (até cerca de 20 milhões de linhas) |
| IA (futuro) | API de IA chamada pelo Apps Script, recebendo dados já agregados |
| Código-fonte | Este repositório, sincronizado com o Apps Script via `clasp` |

### Como fazer alterações
1. **Configuração na planilha:** listas e textos ficam numa aba `Config` e podem ser alterados sem mexer no código.
2. **Código por módulo:** cada tela tem seus próprios arquivos, e só o arquivo da tela alterada muda.
3. **Versionamento:** cada alteração é um commit neste repositório. A publicação atualiza a implantação existente, então o link do app não muda.

---

## 3. Módulo 1 – Check List de Inspeção

### Cabeçalho (preenchimento manual)
- Responsável pelo check
- Data
- Ciclo

### Regras
- Perguntas de **Sim ou Não**.
- Quando a resposta for **Sim**, abre um campo obrigatório para **descrever o que houve**.
- Amostras são **dinâmicas** (botão "+ amostra", quantas forem necessárias) e **apenas salvas**, sem cálculo.

### OGMS
1. O sistema OGMS apresentou dificuldades para conectar? (Sim/Não)
2. O sistema OGMS apresentou falhas ou desconectou durante a inspeção? (Sim/Não)
3. Diferença entre as bitolas medidas em campo e pelo sensor → amostras numéricas (Amostra 01, 02, 03…)
4. Os LEDs da controladora apresentaram alguma instabilidade? (Sim/Não)

### KLD
1. O sistema KLD apresentou dificuldades para conectar? (Sim/Não)
2. O sistema KLD apresentou falhas ou desconectou durante a inspeção? (Sim/Não)
3. Diferença entre as bitolas do KLD e as medidas pelo OGMS → amostras numéricas
4. Desgaste do trilho → pares de valores por amostra: **medida KLD** e **medida em campo (vampiro)**
5. Os LEDs do KLD apresentaram alguma instabilidade ou sinal anômalo de erro? (Sim/Não)

### Aplanix
1. O sistema Aplanix apresentou dificuldades para conectar? (Sim/Não)
2. O sistema Aplanix apresentou falhas ou desconectou durante a inspeção? (Sim/Não)
3. Os LEDs do POS/TG apresentaram alguma instabilidade? (Sim/Não)
4. O comportamento dos parâmetros de nivelamento apresentou alguma perturbação inesperada? (Sim/Não)

### Computadores M1, M2 e M3
1. Os computadores apresentaram alguma falha ou sinistro durante os testes? (Sim/Não)
2. O M1 salvou os dados conforme esperado? (Sim/Não)
3. Os dispositivos de conexão (Bluetooth, teclado e mouse) funcionaram corretamente? (Sim/Não)

---

### Análise do arquivo do carro controle (aba "Análise do arquivo" dentro do Checklist)

Lê o CSV gerado pelo carro (linhas `H` = cabeçalho, `D` = medições a cada 0,25 m, `E` = eventos como AMV e PSUP).
Posição = `KM × 1000 + LOCALIZACAO` (metros). Tudo é calculado no aparelho; o último arquivo fica guardado até ser removido.

- **Planta da linha (EH):** importar a planilha "Planta da linha" (.xls/.xlsx; fica guardada só no aparelho, não vai para o GitHub). Colunas usadas: Ramal, Linha, Eh, C/T, Lado curva, Nº Elemento Eh, km inicial/final, Raio, Superelevação. **Ramal e linha vêm sempre do arquivo CSV** (ex.: ramal `RLT` → `LT` da planta); a planta só fornece os elementos dessa linha. **Correção do km do carro:** o km registrado pelo carro difere alguns metros do km da planta; o app acha essa diferença automaticamente (compara curvas medidas × curvas da planta, de −300 a +300 m). Pode ser digitada se o automático errar. A ferrovia alterna **EH** (~7 km) e **RH** (pátio, ~260 m): o "Eh 43" da planta é o trecho **EH 43/44** e o pátio sem elemento entre o EH 42/43 e o EH 43/44 é a **RH-43** (regra: EH 42/43 → RH-43 → EH 43/44 → RH-44…). Resumo por trecho (EH e RH) com o elemento de maior perda de cada trecho. Tabelas sempre começam por EH/RH e depois a Linha (do arquivo).
- **Tabelas:** sempre do local com maior perda para o com menor; texto centralizado nas colunas. No computador, a tela da análise usa uma área maior (até 1.500 px) para as tabelas caberem sem rolagem lateral.
- **Tangentes e curvas sem planta:** pela coluna `10000/R`, suavizada por média móvel (padrão 10 m). Ponto com |10000/R| ≥ 3 (raio ≈ 3.333 m) é curva; abaixo, tangente. Trechos menores que 20 m são unidos ao vizinho. Numeração na ordem da inspeção: Tangente 01 (T01), Curva 01 (C01), Tangente 02…
- **Perda de bitola:** ponto em que |Bitola F − Bitola T| > 2 mm (só frontal × traseira). Percentual por elemento = pontos com perda ÷ pontos medidos.
- **Bitolas exibidas:** 1000 mm + valor do arquivo (Bitola F, Bitola T e KLD).
- **OGMS × KLD:** diferença Bitola F − Bit_KLD (leituras do KLD acima de 60 mm em módulo são descartadas como erro de sensor). Comparação no gráfico de bitolas, marcando KLD.
- **Variação rápida da bitola:** desvio padrão da bitola F e da T numa janela de 1 m; acima do limite (padrão 1,5 mm, ajustável) indica provável erro de leitura. % por elemento e no geral.
- **Simulação de offset:** soma um valor fixo (mm) à Bitola F, T ou KLD e mostra a perda antes × depois (geral, tangentes, curvas, OGMS − KLD). Sugere o melhor offset (−10 a +10 mm). Opção "Aplicar" leva o offset para gráficos, tabelas e laudo.
- **Gráficos (km no eixo X), nesta ordem:** curvatura com elementos e eventos; bitolas com seleção (Bitola F, Bitola T, KLD ou as 3 juntas; linhas finas e, em trechos longos, faixa mín–máx com a média); alinhamento selecionável (ALR10_10, ALR10_20, AL10_B10, AL20_B10, ALmax_10 ou VAL_B2,5), nivelamento longitudinal (NLmax_5, NLmax_20), empeno e torção (EMP_2, EMP_10, EMP_20, Warp), superelevação (SUPerABS) e VrBTmax5; diferença F − T com os pontos de perda; variação rápida (σ em 1 m); % de perda por elemento. Cursor sincronizado entre os gráficos, com um ponto discreto sobre cada linha; tocar num elemento ou no ranking aproxima o trecho.
- **Tabela de elementos:** início, fim, extensão, raio médio, % perda, maior F − T, OGMS − KLD médio, maior alinhamento e eventos do trecho.
- **Ranking de nivelamento:** 10 maiores valores (em módulo) de NLmax_5, NLmax_20, EMP_2/10/20, Warp, SUPerABS e VrBTmax5; picos a menos de 10 m contam como um só.
- Os limites (curva, perda, variação rápida, suavização e comprimento mínimo) podem ser ajustados em "Critérios da análise".
- **Laudo em PDF (aceite):** botão "Gerar laudo (PDF)". Pede responsável, resultado (Aprovado / Aprovado com ressalvas / Reprovado), parecer e o checklist a incluir. O laudo traz identificação, resultado, indicadores, critérios (planta, ajuste e offset), os 6 gráficos, o resumo por trecho (EH e RH), a tabela de elementos, o ranking de nivelamento (5 maiores por parâmetro), o checklist com respostas e amostras e o campo de assinaturas (responsável, aceite e data). É gerado pela impressão do navegador ("Salvar como PDF"), funciona sem internet. Checklist feito em outro aparelho é buscado na planilha (ação `getChecklist`).

## 4. Módulo 2 – Registro de Eventos

Registro de falhas durante a inspeção.

### Campos
| Campo | Tipo |
|---|---|
| Horário de início | Data/hora |
| Horário de fim | Data/hora |
| Equipamento | Lista (OGMS, KLD, Aplanix, M1, M2, M3…) |
| Parte do equipamento | Texto livre (a lista será construída com o uso) |
| Observação / impacto da falha | Texto livre |

### Atalhos para agilizar o lançamento
- Botão **"Iniciar agora"**: preenche o horário de início com o horário atual.
- Botão **"Finalizar agora"**: preenche o horário de fim de um evento em aberto.
- **Sugestões** a partir dos textos usados com frequência.
- **Duplicar o último evento**, para falhas repetidas.

---

## 5. Módulo 3 – Produção de OMs

### Fluxo por ciclo
1. Exportar a planilha de OMs do SAP (xlsx).
2. Importar o arquivo no app e **digitar o número do ciclo** (a coluna "Ciclo" do SAP é ignorada). A coluna **Data Programada** é opcional.
3. **Programação no app** (aba "Programação" da Produção):
   - calendário do mês com a quantidade de OMs programadas e realizadas por dia; tocar num dia seleciona o dia (e atualiza o painel do dia, da semana e do mês);
   - lista das OMs do dia: marcar várias e **mover para outra data** ou **retirar da programação** (ou o "×" de cada OM);
   - lista para **adicionar** OMs ao dia: "Sem programação" ou "Todas não realizadas" (inclui as de outras datas, que mudam para o dia escolhido), com filtro por ramal, busca e "selecionar todas as visíveis"; ordenada por ramal, linha e km;
   - o painel (meta do dia, semana e mês) é recalculado na hora; funciona sem internet e sincroniza depois.
   - Reimportar a planilha **mantém a programação feita no app**.
   - **Histórico de reprogramação:** toda OM que sai de uma data (movida ou retirada) gera um registro (data anterior → nova data, quando), na aba **Reprogramacoes** da planilha. O dia mostra "Reprogramadas deste dia (N)" com o destino de cada OM e o botão "Voltar"; o calendário marca ↷N. A **programação original** (primeira data) fica guardada na OM (coluna "Programação original") e aparece como "Orig. dd/mm".
   - **Status SAP** visível em cada OM (código do STATUS + status do usuário; detalhes ao passar o mouse). Reimportar a planilha atualiza o status.
   - **Apropriação no SAP:** nas OMs realizadas, o botão "SAP" marca que a OM foi apropriada/confirmada no SAP (com data e hora); a aba "A apropriar" lista as realizadas que faltam confirmar.
4. Em campo, a aba "Execução" mostra as OMs do dia, com filtro por data e por ramal.
5. Ao tocar no botão de uma OM:
   - 1º toque → **Realizado** (grava a data e a hora da realização)
   - 2º toque → **Não realizado** (apaga a data de realização)
6. O app permite **reprogramar** uma OM (mudar a Data Programada) sem reimportar o arquivo.

### Status
Apenas dois: **Realizado** e **Não realizado** (estado inicial). Não é preciso informar o motivo de não realização.

### Colunas do arquivo do SAP
| Coluna | Uso |
|---|---|
| Nº Ordem | Identificador único da OM |
| Texto breve | Nome exibido no botão |
| Denominação do loc. instalação | Descrição complementar |
| Local de instalação, Instalação | Referência |
| Plano de Manutenção, Item de Manutenção | Referência |
| Status do Usuário, Status da Ordem, STATUS | Referência |
| Data Planejada, Tolerância Mín./Máx. | Referência (datas fora do ciclo não importam) |
| Ciclo | Ignorada (o ciclo é digitado na importação) |
| KM, KM2 | Informativo (a meta não é por km) |
| **Data Programada** | **Coluna nova, incluída pelo usuário** |

Referência: o arquivo do 5º ciclo tem 456 OMs, a maioria do ramal LPR (317), seguido de RFA (64) e RBH (42).

### Regras dos gráficos (meta por quantidade de OMs)
A OM conta como produção **no dia em que foi realizada** (lançamento em tempo real).

| Período | Meta | Realizado | % |
|---|---|---|---|
| Dia | OMs programadas para o dia | OMs realizadas no dia | realizado ÷ meta |
| Semana | OMs programadas de segunda a sexta | OMs realizadas de segunda a domingo da semana vigente | realizado ÷ meta |
| Mês | Total de OMs programadas no mês | OMs realizadas no mês até o momento | realizado ÷ meta total do mês |
| Ciclo | Total de OMs importadas no ciclo | Total realizado no ciclo | realizado ÷ total |

- OMs feitas no **sábado ou domingo** contam para a semana vigente.
- O % pode passar de 100% (adiantamento ou recuperação de atraso).
- Exemplo do mês: meta de 300 OMs; no dia 15, com 150 realizadas → 50%.
- Sugestão para o gráfico do mês: linha de referência "meta até hoje" (OMs programadas do dia 1 até a data atual).
- A tela do dia destaca OMs de dias anteriores ainda não realizadas.

### Estrutura no Google Sheets
- **Aba `OMs`:** dados importados + Ciclo + Data Programada.
- **Aba `Execucoes`:** Nº Ordem, Ciclo, Status, Data/hora da realização.
- O vínculo entre as abas é **Nº Ordem + Ciclo**, para que uma reimportação não apague as realizações já lançadas.

---

## 6. Módulo 4 – Dashboard (fase futura)

- Aba do app que consulta o **BigQuery**, onde ficam os CSVs (estrutura fixa, carga manual sem periodicidade, até cerca de 20 milhões de linhas).
- Gráficos e indicadores gerais (tendências e totais).
- Precisa de internet (não funciona offline).
- Evolução: **insights gerados por IA** a partir de dados já agregados (nunca enviar a base bruta).

### A definir
- Indicadores e gráficos desejados.
- Arquivo CSV de exemplo.
- Projeto Google Cloud e permissões de acesso ao BigQuery.

---

## 7. Módulo 5 – Relatório de Anomalia (aba lateral)

### Formato
Gaveta lateral com puxador, acessível de qualquer tela. Ao salvar, grava o registro e gera a mensagem para o WhatsApp.

### Campos (todos digitados manualmente)
1. Ação Tomada
2. Data
3. Local
4. KM Início
5. KM Fim
6. Defeito
7. Amplitude
8. Observação
9. Elemento
10. Latitude
11. Longitude

### Funcionalidades
- Prévia da mensagem, com botão **Copiar**.
- Ao salvar, o formulário é limpo para o próximo defeito, e a mensagem fica no topo com o botão **Copiar mensagem** (para colar no WhatsApp). O botão "Enviar no WhatsApp" foi retirado a pedido.
- Link do mapa montado a partir de latitude e longitude.
- Histórico dos lançamentos (começa do zero, sem migração do Power Apps).

### Fora do escopo por enquanto
- Fotos.
- Captura automática do GPS.

### Formato da mensagem
```
*RELATÓRIO DE ANOMALIA*

*▪ AÇÃO TOMADA:* INTERDIÇÃO

*▪ DATA:* 18/10/2026

*▪ LOCAL:* RH34

*▪ KM INÍCIO:* 000+300

*▪ KM FIM:* 000+300

*▪ DEFEITO:* EMPENO BASE 2

*▪ AMPLITUDE:* 15

*▪ OBSERVAÇÃO:* DEFEITO PERTO DA PONTE

*▪ ELEMENTO:* CVA23

*▪ LINK DO MAPA:* https://www.google.com/maps/search/?api=1&query=LAT,LONG
```

---

## 7b. Módulo 6 – Rota do carro controle

Substitui a planilha "Rota para o ciclo" (abas de Lay Out e de cada dia), onde se desenha e estuda a rota, as interdições e os conflitos.

- **Base:** a malha vem da **planta da linha** (a mesma da análise; importada uma vez em cada aparelho). Cada ramal (LT, FA, BH, TU, OB, AZ) vira uma sequência de **EH** e **RH** (pátios) em ordem de km, com as linhas (L1, L2, L3) que existem em cada trecho. Os pátios aparecem numerados, com o km, como no Lay Out da planilha.
- **Rota por ciclo**, com os dias (1º dia, 2º dia…): data, sentido (Subindo/Descendo), título ("Subindo de TU a GV"), cor do dia.
- **Programação:** no esquema, tocar nos trechos para incluir na rota do dia, em cada linha:
  - "Trecho a trecho" (inclui/retira um trecho) e "De… até…" (todos os trechos entre dois pontos na mesma linha);
  - "Ponto de atenção": interdições, serviços e informações (tipo, gravidade Interdição/Atenção/Informação com cor, trecho, horário e descrição), como as etiquetas vermelhas e roxas e os comentários da planilha;
  - observação da circulação (o quadro verde da planilha) e garageamento no fim do dia;
  - copiar a rota de outro dia; km programado e resumo ("LT: RH-6 → RH-24").
- **Execução:** marcar por onde o carro realmente passou (tracejado = programado, verde = percorrido), "Marcar todo o programado", observação da execução; indicadores de aderência, km percorrido, km que faltou e km fora da programação.
- **Desenho (Linha Tronco):** como o Lay Out da planilha: trilhos com contorno, cada pátio com a caixa do km e o número, desvios acima e abaixo e o **travessão** entre as linhas. Quando a rota chega ao pátio por uma linha e sai por outra, o desenho mostra a troca de linha pelo travessão; se entra e sai pela mesma linha, a passagem pelo pátio é contínua.
- **Futuro:** ligar a rota à Produção (ex.: rota do RH-03 ao RH-12 na L1 → programar as OMs desse trecho para o dia); aperfeiçoar o desenho dos ramais.
- **Visão geral:** todos os dias sobre o esquema, cada um com sua cor (como a aba "Lay Out LT"), com a tabela dos dias.
- **PDF** (paisagem, A4) para enviar às equipes: visão geral e uma página por dia, com a faixa de título, o esquema, a observação da circulação, a tabela de pontos de atenção e o garageamento. Na execução, o PDF mostra programado × percorrido e a aderência.
- Planilha: abas **Rota_Dias** e **Rota_Pontos** (criadas sozinhas). Funciona sem internet.

## 8. Identidade visual

- Baseada no app atual do Power Apps (Report_Defect).
- Cabeçalho com a **foto do carro controle**, o título "Controle de Defeitos – Carro Controle EM80", o **símbolo do CMA** e o texto "Centro de Monitoramento de Ativos".
- Paleta em cinza-azulado escuro, campos claros e botão principal em destaque.
- Temas claro e escuro.
- Com várias fotos do carro disponíveis: uma por tela no cabeçalho ou alternando.

---

## 9. Pendências

| Item | Responsável |
|---|---|
| Enviar o símbolo do CMA (PNG com fundo transparente) | Romário |
| Enviar as fotos do carro controle | Romário |
| Definições do Dashboard (indicadores, CSV de exemplo, acesso ao BigQuery) | Fase futura |
| Identificação de operador | Fase futura |
| Fotos e GPS no Relatório de Anomalia | Fase futura |

---

## 10. Decisões de implementação (versão 1.0.0)

- **Perguntas com sentido positivo:** em "O M1 salvou os dados conforme esperado?" e "Os dispositivos de conexão funcionaram corretamente?", o problema é a resposta **Não**. Nessas duas, a descrição é pedida no "Não"; nas demais, no "Sim". A planilha registra a resposta e uma coluna "Problema?".
- **Dois modos com o mesmo código:** o app abre pelo link do Apps Script (mais simples) ou como site PWA. Páginas do Apps Script não podem abrir sem internet; o PWA abre mesmo sem sinal. Nos dois casos, os registros são salvos no aparelho e enviados depois.
- **Código de acesso:** a API só aceita pedidos com o código gerado pela função `setup()`.
- **Sugestões:** os campos de texto livre (parte do equipamento, ação tomada, local, defeito, elemento) sugerem os valores já usados, sem limitar o que pode ser digitado.
- **Mensagem do WhatsApp:** os valores saem em maiúsculas, como no app atual. Campos vazios aparecem como "-". O link do mapa só é gerado com latitude e longitude preenchidas (aceita vírgula ou ponto; colar "lat, long" no campo de latitude preenche os dois).
- **KM:** formatado automaticamente no padrão 000+000 (ex.: "109440" vira "109+440").
- **OMs:** a trava de 0,7 s evita que um toque duplo acidental desfaça a marcação. Uma reimportação do mesmo ciclo substitui as OMs, mas mantém as realizações já lançadas.
- **Rascunhos:** checklist e relatório de anomalia em preenchimento ficam salvos no aparelho até serem enviados ou limpos.
