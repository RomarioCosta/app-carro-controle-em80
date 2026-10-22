# Memória de cálculo – Carro Controle EM80

Este documento explica, de forma simples e com exemplos, como o app chega em cada número das telas:

- **Análise do arquivo** (tela e laudo em PDF);
- **Tela do carro** (Offboard);
- **Montagem dos dados**.

Cada item segue o mesmo roteiro: **o que é**, **como o app calcula** e um **exemplo com números**.

O código está em `web/js/bitola.js` (análise), `web/js/cobertura.js` (montagem) e `web/js/modulos/tela-carro.js` (Tela do carro). Os valores padrão (em **negrito**) podem ser alterados no app.

---

## Palavras usadas neste documento

| Palavra | Significado |
|---|---|
| **Ponto** | Uma linha de medição do arquivo (linha que começa com `D`). |
| **Espaçamento** | Distância entre dois pontos seguidos. Normalmente **0,25 m**: 4 pontos por metro, 4.000 pontos por km. |
| **Km do ponto** | `KM × 1000 + LOCALIZACAO`, em metros. Ex.: KM = 240 e LOCALIZACAO = 100,25 → 240.100,25 m = **240+100,25**. |
| **Sentido** | Se o km cresce ou diminui ao longo do arquivo. |
| **Elemento** | Uma tangente (reta) ou uma curva. |
| **EH** | Trecho entre pátios (ex.: EH 49/50). |
| **RH** | Circuito / pátio entre dois EH (ex.: RH-50). |
| **Geometria** | A planilha "Geometria da EFVM – Carro Controle", com o km de cada tangente, curva e RH. |

---

## 1. Leitura do arquivo

**O que é.** O app lê o CSV do carro (ou o CSV de dentro de um .zip).

| Item | Regra |
|---|---|
| Linhas | `H` = cabeçalho, `D` = medição, `E` = evento. |
| Valor ausente | `*******` = sem leitura. O ponto não entra na conta daquele parâmetro. |
| Decimal | Aceita ponto ou vírgula (`2.15` ou `2,15`). |
| Eventos | Linhas `E`. No formato novo (sem linhas `E`), os trechos com código na coluna **EX** viram "INICIO EX 5" / "FIM EX 5". |
| Espaçamento | A distância mais comum entre pontos seguidos (a mediana). |
| Ramal | Coluna `RAMAL` (ex.: `RLT` → `LT` da geometria). |
| Linha | Coluna `LINHA`, lida em todos os pontos. Pode ser 0, 1, 2, 3 ou texto (ex.: `TESTE01`). |
| Arquivo alterado no Excel | Se mais de 1% das bitolas passarem de ±60 mm, o app avisa (o Excel costuma trocar os números). **Nunca edite o CSV no Excel**: use "Analisar a partir do km". |

**Exemplo.** Linha `D;RLT;GV1;...;KM=325;...;LOCALIZACAO=354,00;...` → ponto em **325+354** (325.354 m).

---

## 2. Bitolas exibidas

**Como calcula.** O arquivo traz só a diferença para 1000 mm:

```
Bitola exibida = 1000 + valor do arquivo
```

**Exemplo.** Bitola F = 3,48 no arquivo → **1003,48 mm**.

Leituras do KLD com módulo ≥ 60 mm são descartadas (erro de sensor).

---

## 3. Perda de bitola

### 3.1 Ponto acima da regra

**Como calcula.**

```
D = Bitola F − Bitola T   (arredondado em 0,01 mm)
Ponto acima da regra quando |D| > 2 mm
```

- Exatamente 2,00 mm **não** está acima.
- Só entram pontos com as duas bitolas lidas.

**Exemplo.**

| Bitola F | Bitola T | D | Acima? |
|---|---|---|---|
| 4,03 | 2,03 | 2,00 | Não (igual ao limite) |
| 4,05 | 2,03 | 2,02 | **Sim** |
| 1,00 | 3,50 | −2,50 | **Sim** (vale o módulo: 2,50) |

O arredondamento existe porque, no computador, 4,03 − 2,03 dá 2,0000000000000004 e o ponto seria contado errado.

### 3.2 Percentual de perda

```
% de perda = pontos acima da regra ÷ total de pontos × 100
```

**Exemplo.** Uma curva com 1.200 pontos, dos quais 150 acima da regra → 150 ÷ 1.200 × 100 = **12,5%**.

### 3.3 Totais (cartões)

**Quem entra na conta.** Só os pontos com F e T lidas, dentro de tangente ou curva e **fora de RH**.

| Cartão | Conta |
|---|---|
| Perda de bitola (geral) | pontos acima ÷ pontos (tangentes + curvas) |
| Em tangentes | só os pontos das tangentes |
| Em curvas | só os pontos das curvas |
| Ext. acima (m) | pontos acima × 0,25 m |

**Exemplo.**

| Grupo | Pontos | Pontos acima | % |
|---|---|---|---|
| Tangentes | 60.000 | 1.200 | 2,0% |
| Curvas | 40.000 | 3.000 | 7,5% |
| **Geral** | **100.000** | **4.200** | **4,2%** |

Extensão acima = 4.200 × 0,25 = **1.050 m**.

A **linha Total** das tabelas é igual ao cartão "Perda de bitola". As linhas de RH aparecem na tabela, mas não entram no total.

### 3.4 Elemento que perdeu a bitola

```
Perdeu quando % de perda do elemento > 10%
```

**Exemplo.**
- A curva C03 tem 12,5% de perda: **perdeu**.
- A tangente T04 tem 10,0%: **não perdeu**, porque precisa passar de 10.
- Indicador: 8 elementos que perderam, de 40 tangentes + curvas → 8 ÷ 40 = **20%**.

### 3.5 Cobertura de leitura

```
Cobertura = pontos com F e T lidas ÷ pontos do elemento × 100
```

Abaixo de 90%, o elemento ganha ⚠ na tela e * no laudo: tem leitura de menos para confiar no resultado.

**Exemplo.** 1.000 pontos, 850 com F e T lidas → **85%** (⚠).

---

## 4. Tangentes e curvas pelo raio

**O que é.** O app descobre onde começa e termina cada curva olhando a coluna `10000/R` (R = raio em metros).

```
10000/R = 10000 ÷ raio
Raio 3.000 m → 10000/R = 3,33      Raio 500 m → 10000/R = 20
```

**Passo a passo.**

1. **Suaviza** o 10000/R com uma média de **20 m**, para tirar o "ruído".
2. **Entra em curva** quando o raio fica **≤ 3.000 m** (10000/R ≥ 3,33).
3. **Só volta para tangente** quando o raio passa de **6.000 m** (o dobro, 10000/R < 1,67). Essa folga evita que uma curva aberta fique "liga-desliga".
4. O **sinal** dá o lado: positivo = direita (D), negativo = esquerda (E). Mudou o sinal = curva reversa.
5. **Limpeza:**
   - curva com menos de **50 m** vira tangente;
   - tangente com menos de **20 m** entre duas curvas do mesmo lado une as curvas.
6. **Extensão:** soma das distâncias entre os pontos. Se o km pula (acerto em campo), conta só 0,25 m naquele passo.
7. **Numeração:** recomeça em cada EH (a 1ª curva do EH 11/12 é C01).

**Exemplo.**

| Trecho | 10000/R suavizado | Raio | Classificação |
|---|---|---|---|
| A | 1,0 | 10.000 m | tangente |
| B | 4,0 | 2.500 m | **entra em curva** (≤ 3.000 m) |
| C | 2,0 | 5.000 m | **continua curva** (ainda não passou de 6.000 m) |
| D | 1,2 | 8.300 m | volta a tangente |

---

## 5. Geometria e modos de identificar os elementos

### 5.1 Geometria

A planilha de geometria é importada no lugar da planta.

| Coluna | Uso |
|---|---|
| `ramal` | `RLT` → `LT` |
| `eh_linha` | `49/50 L1` → EH 49/50, linha 1 |
| `tipo_ativo` | `TANGENTE` → T, `CURVA` → C, `RH` → circuito |
| `elemento` | `CURVA 3` → C03 |
| `sentido` | Esquerda / Direita |
| `km_inicial`, `km_final` | início e fim em metros |
| `raio` | raio da curva |
| `sede` | corretiva do trecho (`GV I` → GV1) |

### 5.2 Modos

| Modo | De onde vêm o início e o fim | Nome |
|---|---|---|
| **Só raio** | do raio medido (item 4) | EH/RH pelo km na geometria |
| **Raio + planta** | do raio, cortado na entrada e saída dos circuitos | nome da geometria |
| **Pelo km da geometria** | da geometria | nome da geometria |

O km do arquivo é corrigido antes de procurar na geometria (item 7). A linha do ponto só diz qual linha consultar primeiro: o app nunca deixa de localizar por causa da linha.

---

## 6. Circuito (RH)

- **Pelo km da geometria:** ponto que não cai em nenhuma tangente ou curva da geometria.
- **Raio:** ponto sem elemento num trecho contínuo de pelo menos **25 m**.
- **Nome:** RH-n, onde n é o número do EH logo à frente. Ex.: entre o EH 49/50 e o EH 50/51 → RH-50.
- **Os pontos de RH ficam fora de todas as estatísticas gerais.**

---

## 7. Correção do km pela geometria (ponto a ponto)

**O que é.** O odômetro do carro vai errando aos poucos. No RLT_PV de 20/10/2026, o erro foi de −62 m a +223 m em 38 km. Por isso cada ponto recebe a sua própria correção:

```
km na geometria = km do arquivo + correção do ponto
```

**Passo a passo.**

1. **Correção inicial**, nos primeiros 3 km. O app testa deslocar o arquivo de −300 m a +300 m, de 2 em 2 m, e fica com o deslocamento em que tangentes e curvas medidas mais coincidem com as da geometria.
2. **Casar as curvas.** Cada curva medida é casada com a curva da geometria mais próxima. Precisa estar a até 100 m, do mesmo lado e ter extensão entre metade e o dobro.
3. **Correção daquela curva:**

```
correção = centro da curva na geometria − centro da curva medida
```

4. **Entre duas curvas casadas**, a correção vai mudando aos poucos, em linha reta (interpolação).

**Exemplo.**

| Curva | Centro medido | Centro na geometria | Correção |
|---|---|---|---|
| C01 | 300+000 | 300+040 | **+40 m** |
| C02 | 302+000 | 302+060 | **+60 m** |

Um ponto no meio das duas (301+000) recebe a média: **+50 m**, e fica em 301+050 na geometria.

```
% casadas = curvas medidas casadas ÷ curvas medidas × 100
```

Ex.: 34 de 35 curvas casadas → **97%**. Abaixo de 70%, a Montagem avisa para conferir ramal, linha e km.

---

## 8. OGMS × KLD

```
Diferença no ponto = Bitola F − KLD   (arredondada em 0,01 mm)
OGMS − KLD médio = média das diferenças (com sinal), fora dos RH
```

**Exemplo.** Diferenças +1,0, +1,2 e +0,8 → média **+1,0 mm**.

---

## 9. Variação rápida da bitola

1. Em cada ponto, o app calcula o **desvio padrão** da bitola em **1 m** (cerca de 4 pontos), separado para F e para T.
2. Fica o maior dos dois.
3. Acima de **1,5 mm**, o ponto tem variação rápida (provável erro de leitura).

**Exemplo.**
- F = 3,0 / 3,1 / 2,9 / 3,0 → desvio ≈ 0,07 mm: normal.
- F = 3,0 / 7,0 / −1,0 / 3,0 → desvio ≈ 2,8 mm: **variação rápida**.

---

## 10. Offset por elemento (Dif. F − T)

**O que é.** Cada elemento (tangente ou curva) tem a sua **diferença sistemática** entre os dois sensores, a Bitola F e a Bitola T. O app calcula essa diferença e, se você marcar a caixa, desconta dela.

**Como calcula a Dif. F − T de um elemento.**

1. Pega os pontos do elemento com F e T lidas.
2. Tira os pontos com |F − T| ≥ **10 mm**, que são leitura errada.
3. Fica com a **mediana** das diferenças F − T, arredondada em 0,01 mm. A mediana é o valor do meio da lista em ordem; a média seria puxada por defeitos e juntas.

```
Dif. F − T do elemento = mediana de (F − T) nos pontos do elemento
```

**Exemplo.** Uma curva com as diferenças −1,0 / −1,1 / −1,2 / −1,1 / +4,0 (defeito):
- em ordem: −1,2 / −1,1 / −1,1 / −1,0 / +4,0 → a mediana é **−1,1 mm**;
- a média daria −0,08 mm, puxada pelo defeito.

**Caixa "Aplicar offset por elemento".** Fica em cima da tabela de elementos.
- **Desmarcada:** nada muda. A coluna **Dif. F − T (mm)** só mostra o valor de cada elemento.
- **Marcada:** em cada ponto do elemento, a diferença passa a ser:

```
D com offset = (F − T) − Dif. F − T do elemento
```

  Com essa nova diferença, o app refaz tudo com a mesma regra do item 3: cartões, tabelas, gráficos, laudo e conferência. A coluna **"% sem offset"** mostra o valor antigo, para comparar.

**Exemplo de um ponto.** A curva tem Dif. F − T = −1,1 mm.

| Ponto | F − T | Sem offset | Com offset: (F − T) − (−1,1) |
|---|---|---|---|
| A | −2,5 | acima (2,5 > 2) | −1,4 → **dentro** |
| B | −3,4 | acima | −2,3 → **acima** (defeito real) |

**Exemplo real (RLT_CP, a partir do km 290).**

| | Sem offset | Com offset por elemento |
|---|---|---|
| Perda de bitola | 13,1% | **3,6%** |
| Em tangentes | 9,6% | 4,0% |
| Em curvas | 19,3% | 2,9% |
| Curva C04 | 47,7% | 1,7% (Dif. F − T = −1,99 mm) |

As diferenças dos elementos foram de −2,23 a −0,27 mm, com mediana de −1,05 mm.

**Cuidado.** Um defeito que pega o elemento **inteiro** também vira "diferença sistemática" e some com o offset. Por isso a caixa fica a seu critério e o laudo informa quando ela está marcada.

**Conferência (item 13).** Com o offset marcado, a recontagem a partir do CSV soma o mesmo offset do elemento na Bitola T de cada ponto. A planilha de conferência traz a coluna "Offset do elemento".

**Travadores (TRAV).** Eventos com TRAV/TRV/TRAVADOR viram uma faixa roxa ▼ nos gráficos. Ali a perda de bitola é esperada.

---

## 11. Ranking de nivelamento

- **O que lista:** para cada parâmetro (NLmax_5, NLmax_20, EMP_2/10/20, Warp, SUPerABS e VrBTmax5), os maiores valores em módulo.
- **Picos próximos:** dois picos a menos de **10 m** um do outro contam como o mesmo defeito.

**Exemplo.** Picos de 9,1 em 300+010 e de 8,7 em 300+015 contam como um só defeito: o de 9,1.

---

## 12. Resumo por trecho (EH e RH)

- **Totais do trecho:** soma dos elementos do trecho (pontos, pontos acima, extensão).
- **% de perda:** a fórmula do item 3.2, aplicada a essa soma.
- **"Perderam":** quantos elementos passaram de 10%.
- **Ordem:** maior perda primeiro; os RH por último.

---

## 13. Dupla checagem (conferência)

**O que é.** O app relê o **texto original do CSV**, sem usar as contas da análise, e refaz a contagem com números inteiros.

**Como confere.**
1. Para cada elemento, conta os pontos com F e T lidas e os pontos acima da regra.
2. Os pontos são tomados **pela ordem das linhas do arquivo**, não pela faixa de km, porque o km pode voltar ou repetir.
3. A conta é em inteiros de 0,0001 mm:

```
ponto acima quando F − T ≥ 2,005 mm  ou  F − T < −2,005 mm
```

   Isso é o mesmo que "|F − T| arredondado > 2,00".

**Resultado.**
- Tudo igual: **✓ Conferido**.
- Diferente: **⚠ N divergência(s)**, com o elemento e as duas contagens.

**Planilha de conferência.** Tem um ponto por linha, com Bitola F, Bitola T, F − T, |F − T|, "Acima do limite", Elemento, Tipo, EH/RH e "Na estatística". Para conferir no Excel:
- filtre **Na estatística = 1**;
- **pontos** = quantidade de linhas;
- **pontos acima** = soma de "Acima do limite".

---

## 14. Tela do carro (Offboard)

**O que é.** O arquivo desenhado como na tela do carro: km na vertical, uma coluna por parâmetro, nesta ordem: Bitola F, Bitola T, Bit_KLD, ALv_B2,5, VrBTmax5, EMP_2, NLmax_5, EMP_10, 10000/R e SUPerABS.

### 14.1 Qual arquivo roda

- **O arquivo aberto na Análise do arquivo**, ou
- **Os arquivos carregados na Montagem dos dados.** No alto da tela ficam:
  - o seletor **Arquivos da Montagem** (ciclo atual, em ordem de linha e km);
  - os botões **Anterior** e **Próximo**;
  - a opção **"Ao terminar, rodar o próximo arquivo"**: quando o play chega ao fim de um arquivo, o próximo abre e continua rodando.

  Cada arquivo roda com o recorte e as compensações de km feitos na Montagem.

### 14.2 Limites

Os limites vêm da tabela **"Parâmetros EFVM 2026 – bitola métrica"**, pela velocidade escolhida (15 a 68 km/h). Quando a tabela dá uma faixa ("22 a 28"), vale o menor valor.

| Parâmetro | Limite a 68 km/h |
|---|---|
| Bitola F/T/KLD | +31 (1031 mm aberta) e −13 (987 mm fechada) |
| EMP_2 | curva 10 / tangente 19 |
| NLmax_5 | 21 |
| EMP_10 | 31 |
| SUPerABS | 27, só na tangente |

**Três níveis.**
- **Alerta** (laranja) e **Interdição** (vermelho) começam em branco e são preenchidos em "Limites".
- **Restrição** (cinza) já vem com a tabela EFVM 2026.

**Excesso.** Valor acima do limite de cima ou abaixo do limite de baixo. O traçado fica colorido e a coluna EX é marcada.

**Exemplo.** EMP_2 = 12 mm numa curva a 68 km/h → passa de 10: **restrição**. Na tangente, o limite é 19: dentro.

### 14.3 Reprodução

- Ao abrir, a tela fica vazia. O play desenha o traçado de baixo para cima, como o carro andando.
- Velocidade 1× = 10 m de arquivo por segundo; 5× = 50 m por segundo.
- **Escala automática:** 98% dos valores cabem na coluna, com folga de 30%.

  Exemplo: se 98% dos valores de EMP_2 estão abaixo de 4 mm, a coluna mostra cerca de ±5 mm.

---

## 15. Montagem dos dados

**O que é.** Junta os arquivos de um ciclo para saber quanto do trecho já está medido antes de subir para o banco.

Cada arquivo fica guardado no aparelho de duas formas:
- um resumo, com um ponto a cada 1 m;
- o CSV comprimido, usado para rodar na Tela do carro e para recalcular a compensação.

### 15.1 O que precisa ser medido

Pela geometria, o app junta tudo o que precisa de medição, por ramal e linha:
- as tangentes e curvas;
- os RH, pelo km da geometria ou, sem ele, pelo vão de até 1.000 m entre dois elementos.

### 15.2 Medido, falta, buraco e sobreposição

```
% medido = metros medidos ÷ metros que precisam ser medidos × 100
Falta = metros que precisam ser medidos − metros medidos
```

| Situação | Quando |
|---|---|
| **Buraco** | trecho sem nenhum arquivo, com mais de 5 m |
| **Sobreposição** | trecho em 2 arquivos, com mais de 5 m (use o recorte "Usar a partir do km / Até o km") |

**Divisa entre sedes** (ex.: GV1 → GV2):

| Situação | Quando |
|---|---|
| **encosta** | algum arquivo cobre o km da divisa |
| **buraco** | um arquivo termina a até 2 km da divisa sem encostar no vizinho |
| **falta arquivo** | nenhum arquivo perto da divisa |

**Exemplo.**
- A sede GV1 precisa de 58,7 km e os arquivos cobrem 37,1 km.
- Medido = 37,1 ÷ 58,7 = **63,2%**.
- Falta **21,6 km**.

### 15.3 Inconsistências do arquivo

| Aviso | Quando |
|---|---|
| Km volta | o km anda para trás mais de 2 m (no sentido do arquivo) |
| Km salta | o km pula mais de 2 m para frente |
| Km parado | mais de 40 pontos com o mesmo km |
| LINHA inválida | valor como TESTE01: vale a linha mais frequente do arquivo |
| Corretiva diferente | menos da metade do arquivo cai na sede da coluna CORRETIVA |
| Poucas curvas casadas | menos de 70% (item 7) |

---

## 16. Compensação de saltos e voltas do km (botão "Compensar")

### 16.1 O problema

O operador acerta o km do sistema quando passa pela placa. No arquivo, isso aparece como um **pulo** do km entre dois pontos seguidos:

- **Km salta** (ex.: 314+621 → 314+634): o sistema estava **atrasado**. Fica um **buraco** de 13 m sem medição, mas a via não tem buraco: o km é que estava errado.
- **Km volta** (ex.: 47+055 → 47+000): o sistema estava **adiantado**. Fica uma **sobreposição** de 55 m, mas o carro não passou duas vezes: de novo, o km estava errado.

O erro não aconteceu de uma vez: o odômetro foi errando aos poucos. Por isso a correção é espalhada **pelos pontos anteriores ao pulo**, um pouquinho em cada ponto.

### 16.2 A regra, por pontos

1. **Até 2 m não mexe.** Está dentro da margem de erro.
2. **Quantos pontos faltam ou sobram:**

```
pontos do pulo = tamanho do pulo ÷ espaçamento
```

3. **Quantos pontos recebem a compensação.** Cada ponto pode mudar no máximo **1% do espaçamento** (1% de 0,25 m = **0,0025 m**):

```
pontos da compensação = tamanho do pulo ÷ 0,0025
```

4. **Cada ponto ganha (salto) ou perde (volta) 0,0025 m a mais que o anterior.** O acréscimo vai **acumulando** até chegar ao tamanho do pulo no último ponto antes dele:

```
km novo do ponto k = km do arquivo + k × (tamanho do pulo ÷ pontos da compensação)
k = 1 no primeiro ponto da compensação … até o último ponto antes do pulo
```

5. **O km depois do pulo não muda**, porque é o da placa. Com isso o km fica contínuo: sem buraco e sem sobreposição.
6. **E quando não cabe?** Se não houver pontos suficientes antes do pulo (início do arquivo ou outro pulo no caminho), o app avisa e mostra quanto cada ponto teria que mudar. O botão vira **"Compensar mesmo assim (x% por ponto)"**: usa todos os pontos que existem antes do pulo, e cada ponto muda mais que 1%. A decisão é sua.
7. **Pulos maiores que 300 m** não são acerto de km: é passada repetida ou falta de arquivo. Use o recorte.
8. **Nada é automático.** Cada pulo tem o botão **Compensar** e, depois, **Desfazer**. O CSV nunca é alterado.

Os três valores (2 m, 1% e 300 m) podem ser mudados em **"Regras da compensação do km"**, na Montagem.

### 16.3 Exemplo 1: salto de 13 m (buraco)

| Conta | Resultado |
|---|---|
| Pontos do buraco | 13 ÷ 0,25 = **52 pontos** |
| Pontos da compensação | 13 ÷ 0,0025 = **5.200 pontos** (5.200 × 0,25 = 1.300 m) |
| Cada ponto | ganha **0,0025 m** a mais que o anterior |

| Ponto | Km do arquivo | Ganha | Km novo |
|---|---|---|---|
| 1º da compensação | 313+321,00 | 0,0025 m | 313+321,0025 |
| 2º | 313+321,25 | 0,0050 m | 313+321,2550 |
| 1.000º | 313+570,75 | 2,5 m | 313+573,25 |
| 2.600º (metade) | 313+970,75 | 6,5 m | 313+977,25 |
| 5.200º (último antes do salto) | 314+620,75 | **13 m** | **314+633,75** |
| 1º depois do salto | 314+634,00 | 0 | 314+634,00 (não muda) |

- **Antes de compensar:** do último ponto para o seguinte, o km pulava 13,25 m.
- **Depois:** o passo é de 0,25 m, sem buraco.
- **Entre um ponto e o vizinho**, a distância passou de 0,25 m para **0,2525 m** (só 1% a mais). É essa mudança pequena que garante que nenhum ponto fique "longe" do vizinho.

### 16.4 Exemplo 2: volta de 5 m (sobreposição)

| Conta | Resultado |
|---|---|
| Pontos da sobreposição | 5 ÷ 0,25 = **20 pontos** |
| Pontos da compensação | 5 ÷ 0,0025 = **2.000 pontos** (500 m) |
| Cada ponto | perde **0,0025 m** a mais que o anterior; o último antes da volta perde **5 m** |

**Exemplo.** O sistema marcava 324+634 quando o carro passou pela placa 324+629.
- Depois da compensação, o último ponto antes da volta fica em 324+628,75.
- O ponto seguinte (324+629) continua igual, e a sobreposição some.
- Entre vizinhos, a distância passa de 0,25 m para **0,2475 m**.

### 16.5 Exemplo 3: volta de 55 m que não cabe

| Conta | Resultado |
|---|---|
| Pontos da compensação | 55 ÷ 0,0025 = **22.000 pontos** (5,5 km) |
| Pontos que existem antes da volta | 12.000 (3 km) |
| % por ponto que seria preciso | 55 ÷ 3.000 m ≈ 1,8% |

Resultado: com 1% não cabe. O botão mostra **"Compensar mesmo assim (1,8% por ponto)"**.

- Se usar o botão, os 12.000 pontos anteriores perdem cada um 55 ÷ 12.000 = **0,0046 m** a mais que o anterior.
- A distância entre vizinhos passa de 0,25 m para 0,2454 m.

**Seu caso real (RFA_CS, volta de 47+055 para 47+000).** O arquivo começa em 45+429, então há cerca de 1.626 m (6.500 pontos) antes da volta.

| Conta | Resultado |
|---|---|
| Quanto cada ponto perde | 55 ÷ 6.500 ≈ **0,0085 m** (3,4% do espaçamento) |
| Distância entre vizinhos | passa de 0,25 m para cerca de 0,2415 m |

### 16.6 Onde a compensação vale

A compensação vale para:
- a cobertura e os buracos da Montagem;
- os alertas de geometria;
- a correção pela geometria (item 7, refeita sobre o km compensado);
- o arquivo rodando na Tela do carro.

---

## 17. Alertas de geometria (Montagem)

**O que é.** A aba **"Alertas de geometria"** da Montagem lista os trechos em que os arquivos do ciclo passam dos limites da Tela do carro, **só nos parâmetros de geometria da via**:

| Entra | Não entra |
|---|---|
| EMP_2 (empeno em 2 m) | Bitola F, Bitola T, KLD |
| NLmax_5 (nivelamento) | ALv_B2,5 e demais alinhamentos |
| EMP_10 (empeno em 10 m) | VrBTmax5 (variação de bitola) |
| SUPerABS (superelevação, só na tangente) | 10000/R (raio) |

**Como calcula.**

1. Em cada metro do arquivo, o app pega o valor de **maior módulo** dos 4 pontos daquele metro.
2. Com o km corrigido (itens 7 e 16), descobre se o metro está numa **curva ou tangente** da geometria. No RH não há limite.
3. Compara com os limites da velocidade escolhida (os mesmos da Tela do carro, item 14.2). Fica o **maior nível** passado: alerta, restrição ou interdição.
4. Metros seguidos acima do limite (até 3 m de folga) viram **um alerta só**, com o maior valor.
5. O recorte do arquivo é respeitado.

**Exemplo (68 km/h, curva).**

| Km (geometria) | EMP_2 | Limite na curva | Resultado |
|---|---|---|---|
| 320+100 | 8,0 | 10 | dentro |
| 320+101 | 11,5 | 10 | acima |
| 320+102 | 12,8 | 10 | acima |
| 320+103 | 10,4 | 10 | acima |
| 320+104 | 9,0 | 10 | dentro |

Vira **1 alerta**: EMP_2, 320+101 – 320+103, 3 m, valor **12,8**, limite 10, nível **Restrição**.

Clicando no alerta, o arquivo roda na **Tela do carro** naquele km.
