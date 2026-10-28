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

## 10. Simulação de offset

**O que é.** Soma um valor fixo a uma das bitolas e refaz a conta do item 3.

```
D com offset = (Bitola F + offset) − Bitola T
```

**Melhor offset.** O app testa de −10 a +10 mm, de 0,1 em 0,1, e fica com o que deixa **menos pontos acima da regra**.

**Exemplo (RLT_CP).** A Bitola F lia cerca de 1,15 mm a menos que a T.

| Situação | Perda |
|---|---|
| Sem offset | 13,1% |
| Com +1,3 mm na Bitola F | **3,4%** |

No laudo aparecem a tabela "Melhor offset e resultado se aplicado" e a coluna **"% c/ offset"**.

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
| LINHA inválida | valor como TESTE01: vale a linha mais frequente do arquivo (corrija em "Linha do arquivo", item 15.5) |
| Deslocamento | pontos com LINHA = LOCOM: desconsiderados (item 15.5) |
| Corretiva diferente | menos da metade do arquivo cai na sede da coluna CORRETIVA |
| Poucas curvas casadas | menos de 70% (item 7) |

### 15.4 Data, sentido e RH nas barras

- Cada arquivo mostra a **data da inspeção** (coluna DATA) e o **sentido** (coluna SEQUÊNCIA, C ou D, e se o km cresce ou decresce no arquivo).
- **Filtro da lista de arquivos** por **sede** (coluna CORRETIVA: GV1, GV2, CP, CS…; sem ela, a sede onde o arquivo caiu na geometria) e por **data da inspeção** (só as datas que existem nos arquivos, da mais recente para a mais antiga). O filtro vale só para a lista; a cobertura, os buracos e os alertas continuam com o ciclo todo.
- Nas barras de cada linha e de cada sede, um **traço fino marca cada RH (pátio)**: o vão entre dois EH diferentes (a RH-43 fica entre o EH 42/43 e o EH 43/44). Passando o dedo ou o mouse, aparece o nome e o km do RH.
- Abrindo uma sede, cada trecho medido mostra **de qual RH até qual RH** ele vai (ex.: "Medido 320+100 – 334+500 (14,4 km) · RH-40 → RH-42").

### 15.5 Linha do arquivo: LOCOM e correção da linha

**LOCOM.** Na coluna LINHA, "LOCOM" quer dizer que o carro só passou em deslocamento: esses pontos **não contam** como medido, não geram alerta de geometria e ficam fora da Análise, do laudo e da Tela do carro (a Análise mostra quantos pontos foram desconsiderados).

**Correção.** O operador pode errar ou confundir a linha. Em "Linha do arquivo", cada arquivo permite:

1. **Trocar um valor da coluna LINHA** para uma linha da geometria ou para "Desconsiderar (deslocamento)". Ex.: "TESTE01" → Linha 2; "LOCOM" → Linha 1 (se o carro estava medindo).
2. **Definir a linha num trecho de km** (km do arquivo, o mesmo do recorte). Ex.: de 320+100 a 321+400 → Linha 2.

Ordem: primeiro a troca de valor; depois os trechos (o trecho vale mais; entre dois trechos, o último).

**Onde vale.** Cobertura, buracos, sobreposições, alertas de geometria, Tela do carro e Análise/laudo abertos pela Montagem. O CSV nunca é alterado; desfazer é voltar o valor para "Automático" ou remover o trecho.

**Arquivos adicionados antes desta versão.** Ao abrir a Montagem, o app recalcula sozinho, a partir do CSV guardado, os arquivos calculados numa versão anterior (mantendo recorte, compensações e correções) e mostra o andamento ("Atualizando os arquivos… 3 de 12"). Arquivos de versões bem antigas, sem o CSV guardado, precisam ser adicionados de novo (o app avisa).

**Exemplo.** Arquivo de 0 a 3.000 m: até 1.000 m com LINHA = 1, de 1.000 a 1.500 m com LOCOM e de 1.500 a 3.000 m com TESTE01.

| Situação | Linha 1 | Linha 2 |
|---|---|---|
| Sem correção (TESTE01 vale a linha mais frequente, 1; LOCOM fora) | 2.500 m | 0 |
| TESTE01 → Linha 2 e o trecho 1.000–1.500 → Linha 1 | 1.500 m | 1.500 m |

---

## 16. Compensação de saltos e voltas do km (botão "Compensar")

### 16.1 O problema

O operador acerta o km do sistema quando passa pela placa. No arquivo, isso aparece como um **pulo** do km entre dois pontos seguidos:

- **Km salta** (ex.: 20+100 → 20+150): o sistema estava **atrasado**. Fica um **buraco** de 50 m sem medição, mas a via não tem buraco: o km é que estava errado.
- **Km volta** (ex.: 47+055 → 47+000): o sistema estava **adiantado**. Fica uma **sobreposição** de 55 m, mas o carro não passou duas vezes: de novo, o km estava errado.

O erro não aconteceu de uma vez: o odômetro foi errando aos poucos **desde o último acerto do km** (o pulo anterior ou o início do arquivo). Por isso a correção é espalhada por **todos os pontos desde o último acerto**, um pouquinho em cada ponto. Assim cada ponto muda **o mínimo possível**, e o local de um defeito não "anda" de uma vez.

### 16.2 A regra

1. **Até 2 m não mexe.** Está dentro da margem de erro.
2. **Trecho da compensação:** todos os pontos desde o último acerto do km até o ponto antes do pulo. Último acerto = o pulo anterior (qualquer pulo acima de 1 m, compensado ou não) ou o início do arquivo.
3. **Quanto cada ponto muda:**

```
% por ponto = tamanho do pulo ÷ extensão do trecho (desde o último acerto)
km novo = km do arquivo + tamanho do pulo × (distância percorrida desde o último acerto ÷ extensão do trecho)
```

   A correção cresce aos poucos: perto do último acerto é quase zero; no último ponto antes do pulo é o pulo inteiro. É pela **distância percorrida**, então pontos com o carro parado recebem a mesma correção.
4. **O km depois do pulo não muda**, porque é o da placa. O km fica contínuo: sem buraco e sem sobreposição.
5. **Máximo por ponto (1% do espaçamento).** Se o % por ponto passar de 1%, o pulo é grande demais para o trecho: pode ser passada repetida ou arquivo faltando, e não acerto de km. O app avisa e o botão vira **"Compensar mesmo assim (x% por ponto)"**. A decisão é sua.
6. **Pulos maiores que 300 m** não são acerto de km: é passada repetida ou falta de arquivo. Use o recorte.
7. **Carro parado logo depois do pulo** não impede o pulo de ser reconhecido.
8. **Nada é automático.** Cada pulo tem o botão **Compensar** e, depois, **Desfazer**. O CSV nunca é alterado.

Os três valores (2 m, 1% e 300 m) podem ser mudados em **"Regras da compensação do km"**, na Montagem. Ao mudar uma regra, todos os arquivos da Montagem são recalculados na hora, e a Tela do carro e a Análise passam a usar as mesmas regras de cada arquivo.

### 16.3 Exemplo 1: salto de 50 m depois de 15 km sem acerto

O carro sai do km 5+100 e, no km 20+100, o operador acerta o km para 20+150.

| Conta | Resultado |
|---|---|
| Pontos do buraco | 50 ÷ 0,25 = **200 pontos** |
| Trecho da compensação | 5+100 → 20+100 = **15.000 m** (60.000 pontos) |
| % por ponto | 50 ÷ 15.000 = **0,33%** do espaçamento (dentro de 1%) |
| Cada ponto | ganha 50 ÷ 60.000 = **0,00083 m** a mais que o anterior |

| Ponto | Km do arquivo | Ganha | Km novo |
|---|---|---|---|
| 1º do trecho | 5+100,00 | 0,0008 m | 5+100,00 |
| 3 km depois | 8+100,00 | 10 m | 8+110,00 |
| metade | 12+600,00 | 25 m | 12+625,00 |
| último antes do salto | 20+099,75 | **50 m** | **20+149,75** |
| 1º depois do salto | 20+150,00 | 0 | 20+150,00 (não muda) |

- **Entre um ponto e o vizinho**, a distância passa de 0,25 m para 0,25083 m (só 0,33% a mais).
- **Por que não concentrar perto do pulo?** Com a regra antiga (só os pontos logo antes do pulo, a 1% cada), os 5 km antes do salto recebiam toda a correção e os 10 km anteriores nenhuma. Como o odômetro erra aos poucos desde o último acerto, espalhar pelo trecho todo é o mais fiel e muda menos cada ponto.

### 16.4 Exemplo 2: volta de 5 m (sobreposição)

O sistema marcava 324+634 quando o carro passou pela placa 324+629. O último acerto foi 4 km antes.

| Conta | Resultado |
|---|---|
| Pontos da sobreposição | 5 ÷ 0,25 = **20 pontos** |
| % por ponto | 5 ÷ 4.000 = **0,125%** |
| Último ponto antes da volta | perde **5 m**: fica em 324+628,75 |

O ponto seguinte (324+629) continua igual, e a sobreposição some. Entre vizinhos, a distância passa de 0,25 m para 0,2497 m.

### 16.5 Exemplo 3: volta de 55 m que passa de 1%

**Seu caso real (RFA_CS, volta de 47+055 para 47+000).** O arquivo começa em 45+429, então há cerca de 1.626 m (6.500 pontos) antes da volta.

| Conta | Resultado |
|---|---|
| % por ponto | 55 ÷ 1.626 ≈ **3,4%** do espaçamento: passa de 1% |
| Botão | **"Compensar mesmo assim (3,4% por ponto)"** |
| Distância entre vizinhos | se compensar, passa de 0,25 m para cerca de 0,2415 m |

Uma volta de 55 m em 1,6 km é muito para erro de odômetro: vale conferir se não é passada repetida (recorte) antes de compensar.

### 16.6 Onde a compensação vale

A compensação vale para:
- a cobertura e os buracos da Montagem;
- os alertas de geometria;
- a correção pela geometria (item 7, refeita sobre o km compensado);
- o arquivo rodando na Tela do carro;
- a Análise do arquivo e o laudo, quando o arquivo é aberto pela Montagem (a Análise avisa: "Km compensado em N salto(s)/volta(s)").

### 16.7 O que continua no km do arquivo

Para o km compensado não levar a um lugar errado:
- **Recorte** ("Usar a partir do km / Até o km" na Montagem e "Analisar a partir do km" na Análise): é sempre no **km do arquivo**, o mesmo que aparece na tela do carro durante a inspeção. O mesmo recorte pega os mesmos pontos na Montagem, na Tela do carro, na Análise e na conferência.
- **Alerta de geometria → Tela do carro:** o alerta guarda o **ponto do arquivo** onde está o maior valor. A Tela vai direto nesse ponto, e não procura pelo km (que mudou com a compensação ou pode se repetir numa volta).
- **Eventos** (AMV, travador, EX…): ficam presos ao ponto em que foram gravados e andam junto com ele.
- **Salto ou volta fora do recorte** (um dos lados do pulo ficou fora do trecho usado): sai da lista de compensação. Ex.: arquivo que começa em 326+807 e salta de 326+987 para 327+000 na primeira placa; com "Usar a partir do km" = 327+000, o salto deixa de aparecer.

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
