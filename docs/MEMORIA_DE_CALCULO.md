# Memória de cálculo – Análise do arquivo do carro controle

Este documento descreve como cada número da aba **Análise do arquivo** (tela e laudo em PDF) é calculado.
O código está em `web/js/bitola.js`. Os valores padrão podem ser alterados em **Critérios da análise**.

## 1. Leitura do arquivo

| Item | Regra |
|---|---|
| Linhas usadas | `H` = cabeçalho, `D` = medição, `E` = evento. |
| Posição do ponto | `KM × 1000 + LOCALIZACAO` (metros). Pontos sem posição são descartados. |
| Valor ausente | `*******` → sem leitura (não entra em nenhuma conta daquele parâmetro). |
| Decimal | Aceita ponto ou vírgula (`2.15` ou `2,15`). |
| Nomes de colunas | Reconhecidos sem espaços, acentos e maiúsculas. Nomes alternativos: `VAL_B2,5` ou `ALv_B2,5`. Também lê `NLmax_10` e `AL10mean` (formato novo). Coluna que não existe no arquivo só some do gráfico. |
| Espaçamento | Mediana das distâncias entre pontos seguidos (normalmente 0,25 m). |
| Ramal | Coluna `RAMAL` do arquivo (ex.: `RLT` → `LT` da planta). |
| Linha | Coluna `LINHA`, lida em **todos os pontos**. É só informativa: pode ser 0, 1, 2, 3 ou um texto (ex.: `TESTE01`). |

## 2. Bitolas exibidas

- Bitola exibida = **1000 mm + valor do arquivo** (Bitola F, Bitola T e KLD).
- Leituras do KLD com |valor| ≥ 60 mm são descartadas (erro de sensor).

## 3. Perda de bitola

### 3.1 Ponto acima da regra
1. Diferença no ponto: **D = Bitola F − Bitola T**, arredondada a **0,01 mm** (resolução do arquivo).
   Sem o arredondamento, contas como 4,03 − 2,03 dão 2,0000000000000004 e um ponto de exatamente 2,00 mm seria contado.
2. O ponto está **acima da regra** quando **|D| > limite** (padrão **2 mm**). Exatamente 2,00 mm **não** está acima.
3. Só entram pontos com **Bitola F e Bitola T lidas**.

### 3.2 Percentual de perda
- **% de perda = pontos acima da regra ÷ total de pontos × 100** (contagem de pontos).
- Vale para o elemento, para o trecho (EH/RH), para tangentes, curvas e geral.

### 3.3 Totais
| Indicador | Cálculo |
|---|---|
| Perda de bitola (geral) | Σ pontos acima ÷ Σ pontos, de todo o arquivo **fora dos circuitos (RH)**. |
| Em tangentes | Σ pontos acima ÷ Σ pontos das tangentes (fora dos circuitos). |
| Em curvas | Σ pontos acima ÷ Σ pontos das curvas (fora dos circuitos). |
| Pontos | Total de pontos com F e T lidas no elemento/trecho. |
| Pontos acima | Pontos com \|F − T\| > limite. |
| Ext. acima (m) | Pontos acima × espaçamento (0,25 m). |

**Linha Total das tabelas:** soma só tangentes e curvas fora de circuito; é igual ao cartão "Perda de bitola". As linhas de RH (circuito) aparecem na tabela, mas não entram no total.

**Ponto na estatística:** ponto com F e T lidas, dentro de uma tangente ou curva, fora de circuito (RH). Um elemento tratado como circuito tem todos os pontos fora. Por isso **Perda de bitola (geral) = tangentes + curvas**, nos pontos e nos pontos acima.

### 3.4 Elemento que perdeu a bitola
- Uma curva ou tangente **perdeu a bitola** quando a **% de perda do elemento > 10%** (padrão; ajustável).
- Exatamente 10% não perdeu. Circuitos (RH) não entram.
- Indicador "Elementos que perderam a bitola" = quantidade de tangentes + curvas que perderam ÷ total de tangentes + curvas.

### 3.5 Cobertura de leitura
- Cobertura do elemento = pontos com F e T lidas ÷ pontos do elemento.
- Abaixo de 90%: o elemento é marcado (⚠ na tela, * no laudo), porque o resultado é pouco confiável.

## 4. Tangentes e curvas (pelo raio)

Coluna usada: `10000/R` (R = raio em metros). Raio de 3.000 m → 10000/R = 3,33.

1. **Suavização:** média móvel de **20 m** do 10000/R (ignora pontos sem leitura).
2. **Classificação com histerese** (evita o liga-desliga em curvas abertas e em tangentes com oscilação):
   - entra em curva quando o **raio suavizado ≤ 3.000 m** (raio máximo de curva);
   - só volta a tangente quando o **raio passa de 6.000 m** (o dobro);
   - o sinal do 10000/R separa curvas para lados opostos (curva reversa).
3. **Limpeza**, sempre pelo trecho mais curto primeiro, até não sobrar nenhum:
   - curva com menos de **50 m**, ou com raio médio maior que 3.000 m, vira tangente;
   - tangente com menos de **20 m** entre duas curvas: do mesmo lado, une as curvas; de lados opostos, é dividida entre as duas.
4. **Início e fim da curva:** ajustados no 10000/R pouco suavizado (5 m), no ponto onde ele cruza o raio de saída (6.000 m), até 20 m do limite encontrado no passo 2.
5. **Extensão:** distância percorrida entre os pontos (não usa o km). Se o km volta ou salta (correção em campo), conta só o espaçamento normal.
6. **Inversão de sentido** (o km passa a andar ao contrário por pelo menos 10 m, ex.: ida pela L1 e volta pela L2): o elemento é cortado ali, em todos os modos. Uma volta de km isolada (correção em campo) não conta.
7. Numeração na ordem do arquivo: Tangente 01 (T01), Curva 01 (C01), Tangente 02…

Todos os valores em **negrito** podem ser alterados em Critérios da análise.

## 5. Modos de identificar os elementos

| Modo | Limites dos elementos | Nome / local |
|---|---|---|
| **Só raio** | Raio (item 4), sem nenhuma alteração. | Com a planta: para cada elemento, o km de cada ponto é procurado na planta e o elemento recebe o **EH/RH** (o de mais pontos), os **EH/RH que atravessa** e o(s) **elemento(s) da planta** a que o km pertence (os que têm ≥ 20% dos pontos, o maior primeiro). Sem planta: só a numeração pelo raio. |
| **Raio + planta** | Raio medido, cortado onde entra/sai de um circuito. | Nome do elemento da planta com mais pontos (preferindo o do mesmo tipo). |
| **Pelo km da planta** | Início e fim de cada elemento da planta. | Nome da planta. |

### 5.1 Localização pelo km
- Posição na planta = posição do arquivo + **correção de km** (item 6).
- A linha do ponto só escolhe qual linha da planta consultar primeiro; se não existir ou não houver elemento naquele km, usa as outras linhas do ramal. **Nunca deixa de localizar por causa da linha.**
- Nome do EH: o "Eh 43" da planta é o trecho **EH 43/44** (o próximo número da sequência).

## 6. Circuito (RH)

| Modo | Regra do ponto de RH |
|---|---|
| Pelo km da planta | Ponto cujo km (com a correção) **não cai em nenhum elemento da planta**. |
| Raio + planta e Só raio | Ponto sem elemento na planta, num trecho contínuo sem elemento de **pelo menos 25 m** (buracos menores são tratados como falha da planta). |

- Nome: **RH-n**, onde n é o número do EH logo acima no km (ex.: entre o EH 49/50 e o EH 50/51 → RH-50).
- Pontos de RH ficam **fora de todas as estatísticas gerais** (perda, tangentes, curvas, OGMS × KLD, variação, offset).
- No modo Só raio, o elemento cuja maioria dos pontos está em RH é tratado como do circuito. Um elemento que só atravessa parte do circuito conta apenas os pontos fora do RH.

## 7. Correção do km (automática)

1. Amostras a cada 1 m: classe pelo raio suavizado (curva à esquerda, curva à direita ou tangente).
2. Para cada deslocamento de −300 a +300 m (passo de 2 m), compara a classe medida com a da planta no km deslocado.
3. Testa também a convenção de sinal invertida (esquerda/direita).
4. Escolhe o deslocamento com mais coincidências (empate: o menor em módulo); depois refina em passos de 0,5 m (±2 m).
5. Só vale se pelo menos 30% das amostras caírem dentro da planta.
6. "% coincidente" = amostras com a mesma classe ÷ amostras dentro da planta.

### 7.1 Conferência do ramal
- Compara só as **curvas** (F1 entre amostras em curva medidas e em curva na planta), a cada 5 m, com deslocamentos de −300 a +300 m (passo de 10 m), em todos os ramais/linhas da planta.
- Aviso quando outro ramal tem nota ≥ 60% e pelo menos 20 pontos acima da nota do ramal do arquivo.

## 8. OGMS × KLD

- Diferença no ponto = Bitola F − KLD (arredondada a 0,01 mm), só com KLD válido (|KLD| < 60 mm).
- **OGMS − KLD médio** = média das diferenças (com sinal), fora dos circuitos.

## 9. Variação rápida da bitola

1. Desvio padrão móvel (σ) da Bitola F e da Bitola T, janela centrada de **1 m** (mínimo 3 pontos com leitura).
2. σ do ponto = maior entre σF e σT.
3. Ponto com variação rápida: σ > **1,5 mm**.
4. **% variação rápida** = pontos com variação rápida ÷ pontos com σ calculado, fora dos circuitos.

## 10. Simulação de offset

- Soma um valor fixo (mm) a uma das bitolas (F, T ou KLD) e recalcula a perda com a **mesma regra** do item 3.
- **Melhor offset**: testa de −10 a +10 mm (passo 0,1 mm) e escolhe o que deixa **menos pontos acima da regra**; em empate, o de menor módulo.
- **Laudo:** tabela "Melhor offset e resultado se aplicado", uma linha para a Bitola F e outra para a Bitola T: melhor offset e, sem offset → com offset, a perda de bitola, a perda em tangentes, em curvas e os elementos com perda (a análise é refeita com o offset, mesmos elementos e mesma regra).

## 11. Ranking de nivelamento

- Para cada parâmetro (NLmax_5, NLmax_20, EMP_2/10/20, Warp, SUPerABS, VrBTmax5): os N maiores valores em módulo.
- Picos a menos de **10 m** de um já escolhido contam como o mesmo defeito.

## 12. Resumo por trecho (EH e RH)

- Agrupa os elementos pelo EH/RH **e pela passada**: se o arquivo passa duas vezes pelo mesmo EH (ida e volta, ou outra passada no mesmo km), cada passada é uma linha ("EH 42/43 (2ª passada)"). Muda de grupo quando muda o EH/RH ou o sentido do km.
- **Medidos (T + C)** × **Na planta (T + C)**: tangentes e curvas encontradas no arquivo e as que a planta tem no mesmo trecho percorrido.
- Pontos, pontos acima, extensão acima e % de perda: soma dos elementos do trecho (item 3.3).
- "Perderam": quantos elementos do trecho passaram de 10%.
- "Maior perda": elemento do trecho com a maior % de perda.
- Ordem das tabelas: maior perda primeiro; circuitos (RH) por último.

## 13. Dupla checagem (conferência)

- **Conferência automática:** a cada análise, o app relê o **texto original do CSV** linha a linha, sem usar a leitura nem as contas da análise, e recalcula com números inteiros (centésimos de mm): para cada elemento, total de pontos com F e T lidas e pontos com |F − T| > limite.
  - Os pontos de cada elemento são tomados **pela ordem das linhas do arquivo** (do primeiro ao último ponto do elemento), não pela faixa de km. O km pode voltar ou repetir no arquivo (km corrigido durante a inspeção, nova passada no mesmo km); contar pela faixa de km puxaria pontos de outro trecho.
  - Confere também se o número de linhas de medição lidas pelo app é igual ao do arquivo.
  - Tudo igual: selo **✓ Conferido** na tabela de elementos.
  - Diferente: botão **⚠ N divergência(s)** com o elemento, os pontos e os pontos acima pelo app e pela conferência, e a lista dos pontos onde o km volta.
  - Elemento que atravessa um circuito é conferido inteiro (antes de tirar os pontos do RH).
- **Cartão Perda de bitola:** mostra também quantos pontos com F e T lidas estão em circuito (fora da estatística). Pontos do cartão + pontos em circuito = linhas da planilha com F − T preenchida.
- **Planilha de conferência (CSV para o Excel):** um ponto por linha, com KM, LOCALIZACAO, Linha, Bitola F, Bitola T, F − T (arredondada), **|F − T| (módulo)**, "Acima do limite" (1 = sim), Elemento, **Tipo** (Tangente, Curva ou Circuito), EH/RH e **"Na estatística"** (1 = sim).
  - Cartões: filtre **Na estatística = 1**. **Pontos** = quantidade de linhas; **pontos acima** = soma de "Acima do limite". Para "Em tangentes" / "Em curvas", filtre também o Tipo.
  - Um elemento (tabela de elementos): filtre a coluna Elemento; pontos = linhas com F − T preenchida (e Na estatística = 1, se ele atravessa um circuito); pontos acima = soma de "Acima do limite".
