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
2. Adicionar a coluna **Data Programada** com o dia previsto de cada OM. A programação é feita no próprio arquivo, antes da importação.
3. Importar o arquivo no app e **digitar o número do ciclo** (a coluna "Ciclo" do SAP é ignorada).
4. Em campo, a tela mostra as OMs do dia, com filtro por data e por ramal.
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
