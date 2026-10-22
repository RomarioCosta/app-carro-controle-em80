# Memória de cálculo – Arquivo do carro controle

Este documento descreve como cada número da aba **Análise do arquivo** (tela e laudo em PDF), da **Tela do carro** e da **Montagem dos dados** é calculado, com as fórmulas usadas.
O código está em `web/js/bitola.js` (análise) e `web/js/cobertura.js` (montagem). Os valores padrão podem ser alterados em **Critérios da análise**.

**Notação usada nas fórmulas**

| Símbolo | Significado |
|---|---|
| $i$ | índice do ponto, na ordem das linhas do arquivo ($i = 0 \dots n-1$) |
| $x_i$ | km do ponto no arquivo, em metros |
| $e$ | espaçamento entre pontos (normalmente 0,25 m) |
| $s$ | sentido do arquivo: $+1$ se o km cresce, $-1$ se decresce |
| $F_i,\ T_i,\ K_i$ | valores do arquivo de Bitola F, Bitola T e Bit_KLD (mm, em relação a 1000 mm) |
| $c_i$ | valor da coluna `10000/R` (curvatura) |
| $a_i$ | correção do km do ponto (m): km na geometria $= x_i + a_i$ |
| $L$ | limite de perda de bitola (padrão 2 mm) |
| $\lvert A \rvert$ | quantidade de elementos do conjunto $A$ |

## 1. Leitura do arquivo

| Item | Regra |
|---|---|
| Linhas usadas | `H` = cabeçalho, `D` = medição, `E` = evento. |
| Posição do ponto | $x_i = \text{KM} \times 1000 + \text{LOCALIZACAO}$ (metros). Pontos sem posição são descartados. |
| Valor ausente | `*******` → sem leitura (não entra em nenhuma conta daquele parâmetro). |
| Decimal | Aceita ponto ou vírgula (`2.15` ou `2,15`). |
| Eventos | Linhas "E" do arquivo (formato antigo). No formato novo não há linhas "E": os trechos com código na coluna **EX** (ex.: 5) viram eventos "INICIO EX 5" / "FIM EX 5". |
| Trecho analisado | "Analisar a partir do km" / "até o km": só os pontos com $x_i$ dentro do trecho entram na análise, nos gráficos, no laudo e na conferência. O CSV não é alterado. |
| Arquivo alterado | Se mais de 1% das leituras de Bitola F/T tiverem $\lvert F_i \rvert > 60$ ou $\lvert T_i \rvert > 60$ mm, o app avisa (arquivo salvo no Excel costuma ter os números trocados). |
| Nomes de colunas | Reconhecidos sem espaços, acentos e maiúsculas. Nomes alternativos: `VAL_B2,5` ou `ALv_B2,5`. Também lê `NLmax_10` e `AL10mean` (formato novo). Coluna que não existe no arquivo só some do gráfico. |
| Espaçamento | $e = \operatorname{mediana}(\lvert x_i - x_{i-1} \rvert)$. |
| Sentido | $s = +1$ se $x_{n-1} \ge x_0$; senão $s = -1$. |
| Ramal | Coluna `RAMAL` do arquivo (ex.: `RLT` → `LT` da planta/geometria). |
| Linha | Coluna `LINHA`, lida em **todos os pontos**. Pode ser 0, 1, 2, 3 ou um texto (ex.: `TESTE01`). |

## 2. Bitolas exibidas

```math
\text{Bitola exibida} = 1000 + F_i \quad (\text{igual para } T_i \text{ e } K_i)
```

Leituras do KLD com $\lvert K_i \rvert \ge 60$ mm são descartadas (erro de sensor).

## 3. Perda de bitola

### 3.1 Ponto acima da regra

Diferença no ponto, arredondada à resolução do arquivo (0,01 mm):

```math
D_i = \frac{\operatorname{round}\big(100\,(F_i - T_i)\big)}{100}
```

O ponto está **acima da regra** quando:

```math
\lvert D_i \rvert > L \qquad (L = 2\ \text{mm})
```

- Exatamente 2,00 mm **não** está acima. Sem o arredondamento, $4{,}03 - 2{,}03 = 2{,}0000000000000004$ e o ponto seria contado.
- Só entram pontos com **Bitola F e Bitola T lidas**.

### 3.2 Percentual de perda

Para um conjunto de pontos $P$ (elemento, trecho EH/RH, tangentes, curvas ou geral):

```math
\%\,\text{perda} = \frac{\lvert \{\, i \in P : \lvert D_i \rvert > L \,\} \rvert}{\lvert P \rvert} \times 100
```

### 3.3 Totais

Seja $E$ o conjunto dos pontos **na estatística**: com F e T lidas, dentro de uma tangente ou curva e fora de circuito (RH).

| Indicador | Fórmula |
|---|---|
| Perda de bitola (geral) | $\dfrac{\lvert\{i \in E : \lvert D_i\rvert > L\}\rvert}{\lvert E\rvert} \times 100$ |
| Em tangentes | mesma fórmula com $E_T = \{i \in E : \text{ponto em tangente}\}$ |
| Em curvas | mesma fórmula com $E_C = \{i \in E : \text{ponto em curva}\}$ |
| Pontos | $\lvert P \rvert$ |
| Pontos acima | $\lvert\{i \in P : \lvert D_i\rvert > L\}\rvert$ |
| Ext. acima (m) | $\text{pontos acima} \times e$ |

Como $E = E_T \cup E_C$ (sem pontos em comum), **geral = tangentes + curvas**, nos pontos e nos pontos acima. É o mesmo número da **linha Total** das tabelas. As linhas de RH aparecem na tabela, mas não entram no total.

### 3.4 Elemento que perdeu a bitola

```math
\text{perdeu} \iff \%\,\text{perda do elemento} > 10\%
```

- Exatamente 10% não perdeu. Circuitos (RH) não entram.
- Indicador:

```math
\text{Elementos que perderam} = \frac{\text{tangentes} + \text{curvas que perderam}}{\text{total de tangentes} + \text{curvas}} \times 100
```

### 3.5 Cobertura de leitura

```math
\text{Cobertura do elemento} = \frac{\text{pontos com F e T lidas}}{\text{pontos do elemento}} \times 100
```

Abaixo de 90%, o elemento é marcado (⚠ na tela, * no laudo), porque o resultado é pouco confiável.

## 4. Tangentes e curvas (pelo raio)

Coluna usada: `10000/R` (R = raio em metros). O limite de curva em curvatura é:

```math
c_{\lim} = \frac{10000}{R_{\max}} = \frac{10000}{3000} = 3{,}33
```

1. **Suavização:** média móvel centrada de **20 m**, ignorando pontos sem leitura.

```math
\bar c_i = \frac{1}{\lvert J_i \rvert} \sum_{j \in J_i} c_j, \qquad J_i = \{\, j : \lvert j - i \rvert \le \tfrac{20}{2e},\ c_j \text{ lido} \,\}
```

2. **Classificação com histerese** (evita o liga-desliga em curvas abertas e em tangentes com oscilação):
   - entra em curva quando $\lvert \bar c_i \rvert \ge 10000/3000$ (raio ≤ 3.000 m);
   - só volta a tangente quando $\lvert \bar c_i \rvert < 10000/6000$ (raio > 6.000 m, o dobro);
   - o sinal de $\bar c_i$ dá o lado: positivo = direita (D), negativo = esquerda (E). Troca de sinal = curva reversa.
3. **Limpeza**, sempre pelo trecho mais curto primeiro, até não sobrar nenhum:
   - curva com menos de **50 m**, ou com raio médio maior que 3.000 m, vira tangente;
   - tangente com menos de **20 m** entre duas curvas: do mesmo lado, une as curvas; de lados opostos, é dividida entre as duas.
4. **Início e fim da curva:** ajustados no 10000/R pouco suavizado (5 m), no ponto onde ele cruza o raio de saída (6.000 m), até 20 m do limite encontrado no passo 2.
5. **Extensão** (distância percorrida, não usa o km):

```math
\text{ext} = \sum_{i=i_0+1}^{i_1} d_i, \qquad d_i = \begin{cases} \lvert x_i - x_{i-1} \rvert & \text{se } \lvert x_i - x_{i-1} \rvert \le 5e \\ e & \text{se o km volta ou salta (acerto em campo)} \end{cases}
```

6. **Numeração:** com planta/geometria, recomeça em cada EH/RH (a 1ª curva do EH 11/12 é C01); sem planta, segue a ordem do arquivo.

Todos os valores em **negrito** podem ser alterados em Critérios da análise.

## 4.1 Geometria do carro controle (substitui a planta)

A tabela "Geometria da EFVM – Carro Controle" (aba `elementos_revia`) é importada no mesmo lugar da planta e reconhecida sozinha.

| Coluna | Uso |
|---|---|
| `ramal` | Ramal do elemento (`RLT` → `LT`), igual à coluna RAMAL do CSV. |
| `eh_linha` | EH e linha (`49/50 L1` → EH 49/50, linha 1). O nome do EH vem pronto. |
| `tipo_ativo` | `TANGENTE` → T, `CURVA` → C. `RH` não vira elemento na análise (o trecho fica como circuito, item 6). O km do RH é guardado para a Montagem dos dados (itens 15 e 16). A mesma RH vem repetida, uma vez para cada EH vizinho, e é contada uma vez só. |
| `elemento` | Número do elemento no EH (`CURVA 3` → C03) e nome do RH (`RH-03`). |
| `sentido` | Lado da curva (Esquerda/Direita). |
| `km_inicial`, `km_final` | Início e fim, em metros. |
| `raio` | Raio da curva. Num RH com raio, o circuito tem uma curva. |
| `sede` | Corretiva do trecho (`GV I` → GV1). |

Ao importar a geometria, o modo passa para **Pelo km da geometria**. A correção automática do km (item 7) continua valendo.

## 5. Modos de identificar os elementos

| Modo | Limites dos elementos | Nome / local |
|---|---|---|
| **Só raio** | Raio (item 4), sem nenhuma alteração. | Com a planta, procura na planta o km de cada ponto, $x_i + a_i$. O elemento recebe: o **EH/RH** com mais pontos; os **EH/RH que atravessa**; o(s) **elemento(s) da planta** a que o km pertence (os que têm ≥ 20% dos pontos, o maior primeiro). Sem planta, recebe só a numeração pelo raio. |
| **Raio + planta** | Raio medido, cortado onde entra/sai de um circuito. | Nome do elemento da planta com mais pontos (preferindo o do mesmo tipo). |
| **Pelo km da planta** | Início e fim de cada elemento da planta. | Nome da planta. |

### 5.1 Localização pelo km
- Posição na planta: $x_i + a_i$ (com a correção do item 7).
- A linha do ponto só escolhe qual linha da planta consultar primeiro. Se ela não existir, ou não tiver elemento naquele km, o app usa as outras linhas do ramal. **Nunca deixa de localizar por causa da linha.**
- Nome do EH: o "Eh 43" da planta é o trecho **EH 43/44** (o próximo número da sequência).

## 6. Circuito (RH)

| Modo | Regra do ponto de RH |
|---|---|
| Pelo km da planta | Ponto cujo km $x_i + a_i$ **não cai em nenhum elemento da planta**. |
| Raio + planta e Só raio | Ponto sem elemento na planta, num trecho contínuo sem elemento de **pelo menos 25 m** (buracos menores são tratados como falha da planta). |

- **Nome:** RH-n, onde n é o número do EH logo acima no km. Exemplo: entre o EH 49/50 e o EH 50/51 fica a RH-50.
- Pontos de RH ficam **fora de todas as estatísticas gerais**: perda, tangentes, curvas, OGMS × KLD, variação e offset.
- **No modo Só raio:**
  - o elemento com a maioria dos pontos em RH é tratado como do circuito;
  - o elemento que só atravessa parte do circuito conta apenas os pontos fora do RH.

## 7. Correção do km (ponto a ponto)

O odômetro do carro escorrega aos poucos. No arquivo RLT_PV de 20/10/2026, a correção foi de −62 m a +223 m ao longo de 38 km. Por isso a correção $a_i$ não é um valor único para o arquivo.

1. **Partes:** o arquivo é dividido onde o km pula, ou seja, onde $\lvert x_i - x_{i-1} \rvert > 5e$.
2. **Correção inicial de cada parte**, calculada nos primeiros 3 km. Para cada deslocamento $\delta$ de −300 a +300 m (passo 2 m, depois refinado em 0,5 m), com uma amostra $p$ a cada 1 m:

```math
\text{nota}(\delta) = \frac{\lvert\{\, p : \text{classe medida}(p) = \text{classe da geometria}(x_p + \delta) \,\}\rvert}{\lvert\{\, p : x_p + \delta \text{ cai num elemento} \,\}\rvert}
```

   - A classe medida é T, D ou E, pelo $\bar c$ (item 4); a classe da geometria vem do tipo e do lado do elemento.
   - Fica o $\delta$ de maior nota. Em empate, o de menor módulo.
   - O app testa também com os lados trocados.

3. **Curvas casadas:** cada curva medida (item 4), de centro $m$, é casada com a curva da geometria de centro $g$ mais próxima do km previsto $m + a_{\text{atual}}$. Condições:
   - $\lvert g - (m + a_{\text{atual}}) \rvert \le 100$ m;
   - mesmo lado;
   - extensão medida entre a metade e o dobro da extensão da geometria.

   A correção naquela curva (âncora $k$, no ponto $i_k$) é:

```math
a_{i_k} = g_k - m_k
```

4. **Interpolação** entre duas âncoras seguidas $k$ e $k+1$:

```math
a_i = a_{i_k} + \big(a_{i_{k+1}} - a_{i_k}\big)\,\frac{i - i_k}{i_{k+1} - i_k}, \qquad i_k \le i \le i_{k+1}
```

   Antes da primeira âncora e depois da última, a correção fica constante.

5. Indicador de curvas casadas:

```math
\%\,\text{casadas} = \frac{\text{curvas medidas casadas}}{\text{curvas medidas}} \times 100
```

Uma correção digitada em Critérios (um número só) vale para o arquivo todo: $a_i = \text{valor}$.

### 7.1 Acerto do km na placa (tratado só pelo botão)

**O caso.** O operador passa pela placa 366+000 com o sistema marcando 366+015 e acerta o km. No arquivo aparece um único passo de volta, de 366+015 para 366+000. Quando o sistema está atrasado, aparece um salto (ex.: 20+870 → 21+000).

**Candidato a acerto.** O passo no ponto $i$ é candidato quando cumpre as três condições:

```math
\Delta = x_i - \big(x_{i-1} + s\,e\big), \qquad 1 \le \lvert \Delta \rvert \le 300\ \text{m}
```

```math
\min\big(x_i \bmod 1000,\ 1000 - x_i \bmod 1000\big) \le 0{,}5\ \text{m} \quad (\text{cai num km inteiro: a placa})
```

```math
\big\lvert x_k - x_{k-1} - s\,e \big\rvert \le 0{,}6\,e \quad \text{para } k = i+1 \dots i+8 \quad (\text{o km segue normal depois})
```

**Confirmação pela geometria (indicação, não decide sozinha).** Com a correção do item 7 *sem* tratar o acerto, mede-se quanto o km da geometria pula no ponto:

```math
\text{pulo} = \big(x_i + a_i\big) - \big(x_{i-1} + a_{i-1}\big) - s\,e
```

```math
\text{confirmado} \iff \lvert \text{pulo} \rvert \le \max\big(5\ \text{m},\ \lvert \Delta \rvert / 2\big)
```

- **Confirmado:** a via não pulou, só o km do sistema. É acerto de placa.
- **Não confirmado:** a geometria pulou quase o mesmo que o km. Pode ser **falta de medição de verdade**, e a tela avisa.

**Nada é feito automaticamente.** Cada acerto aparece com a prévia e o botão **Tratar** (e **Desfazer**), na Montagem e na Análise.

**Tratamento: distribuição no trecho anterior.** O km depois da placa já é o certo e não muda. Antes dela, o odômetro foi errando aos poucos, desde a referência anterior $r$. A referência é o acerto anterior, a última quebra do km (volta ou salto que não é acerto) ou o início do arquivo.

Distância que o sistema marcou desde a referência até a placa:

```math
D = \big(x_{i-1} + s\,e\big) - x_r
```

Fator de escala do trecho:

```math
f = \frac{D + \Delta}{D}
```

Novo km de cada ponto do trecho:

```math
x'_j = x_r + \big(x_j - x_r\big)\cdot f, \qquad r \le j < i
```

O km depois da placa não muda ($x'_j = x_j$ para $j \ge i$). A correção pela geometria (item 7) é refeita sobre $x'$, e a correção final do ponto fica:

```math
a_j^{\text{final}} = \big(x'_j - x_j\big) + a'_j
```

- **Faltou km** ($\Delta$ com o mesmo sinal de $D$, ex.: sistema em 20+870 na placa 21+000): $f > 1$. Os metros que faltaram são **somados ao trecho todo**, proporcionalmente: cada km medido ganha $(f - 1)\times 1000$ m.
- **Passou** ($\Delta$ com sinal contrário, ex.: sistema em 366+015 na placa 366+000): $f < 1$. Os metros a mais são **tirados do trecho todo**, proporcionalmente: cada km medido perde $(1 - f)\times 1000$ m.
- No ponto da placa, $x'_{i-1} + s\,e\,f \approx x_i$: o km fica contínuo, sem repetir nem pular medição.
- O CSV não é alterado. O acerto tratado fica guardado junto do arquivo e vale para a cobertura, a contagem e a análise.

**Exemplo (RLT_PV, placa 21+000).**

| Valor | Conta | Resultado |
|---|---|---|
| Diferença na placa | sistema em 20+870, placa 21+000 | $\Delta = +130$ m |
| Distância desde a referência | referência em 10+000 | $D = 10.870$ m |
| Fator | $(10.870 + 130) / 10.870$ | $f = 1{,}01196$ |
| Por km | $(f - 1) \times 1000$ | cada km do trecho ganha 11,96 m |

### 7.2 Conferência do ramal

A comparação usa só as **curvas**, com uma amostra a cada 5 m. Os deslocamentos $\delta$ vão de −300 a +300 m (passo de 10 m), em todos os ramais e linhas da planta.

```math
\text{nota}(\delta) = \frac{2\,VP}{M + G}
```

- $VP$ = amostras em curva no arquivo e na geometria ao mesmo tempo.
- $M$ = amostras em curva no arquivo.
- $G$ = amostras em curva na geometria.

O app avisa quando outro ramal tem nota ≥ 60% e pelo menos 20 pontos acima da nota do ramal do arquivo.

## 8. OGMS × KLD

```math
\text{OGMS} - \text{KLD médio} = \frac{1}{\lvert E_K \rvert} \sum_{i \in E_K} \frac{\operatorname{round}\big(100\,(F_i - K_i)\big)}{100}
```

$E_K$ = pontos na estatística com KLD válido ($\lvert K_i \rvert < 60$ mm). A média é feita com sinal.

## 9. Variação rápida da bitola

1. Desvio padrão móvel, em janela centrada de **1 m** (mínimo 3 pontos com leitura):

```math
\sigma F_i = \sqrt{\frac{1}{\lvert W_i\rvert}\sum_{j \in W_i} \big(F_j - \bar F_{W_i}\big)^2}, \qquad W_i = \{\, j : \lvert j - i \rvert \le \tfrac{1}{2e},\ F_j \text{ lido} \,\}
```

   O mesmo vale para $\sigma T_i$.

2. Ponto com variação rápida:

```math
\sigma_i = \max(\sigma F_i,\ \sigma T_i) > 1{,}5\ \text{mm}
```

3. Indicador:

```math
\%\,\text{variação} = \frac{\text{pontos com } \sigma_i > 1{,}5}{\text{pontos com } \sigma_i \text{ calculado}} \times 100 \quad (\text{fora dos circuitos})
```

## 10. Simulação de offset

**Offset aplicado.** Soma um valor fixo $o$ a uma das bitolas e recalcula a perda com a **mesma regra** do item 3. Exemplo com offset na Bitola F:

```math
D_i(o) = \frac{\operatorname{round}\big(100\,(F_i + o - T_i)\big)}{100}
```

**Melhor offset.** O app testa $o$ de −10 a +10 mm (passo 0,1 mm) e escolhe:

```math
o^{*} = \arg\min_{o}\ \lvert\{\, i \in E : \lvert D_i(o)\rvert > L \,\}\rvert
```

Em empate, fica o de menor $\lvert o \rvert$.

**No laudo:**
- A tabela "Melhor offset e resultado se aplicado" tem uma linha para a Bitola F e outra para a Bitola T.
- Cada linha mostra o melhor offset e, sem offset → com offset:
  - a perda de bitola;
  - a perda em tangentes;
  - a perda em curvas;
  - os elementos com perda.
- A análise é refeita com o offset, nos mesmos elementos e com a mesma regra.
- As tabelas de trechos e de elementos ganham a coluna **"% c/ offset"**: a % de perda de cada linha com o melhor offset (da bitola com menor perda geral). A linha Total mostra o total com o offset.

## 10.1 Travadores (TRAV)

- Eventos do arquivo com TRAV/TRV/TRAVADOR no texto aparecem em todos os gráficos por km: faixa roxa com o símbolo ▼ e o texto TRAV.
- "INICIO TRV" seguido de "FIM TRV" a até 300 m vira uma faixa só. Nesses locais a perda de bitola é esperada.

## 11. Ranking de nivelamento

- Vale para cada parâmetro: NLmax_5, NLmax_20, EMP_2/10/20, Warp, SUPerABS e VrBTmax5.
- O ranking traz os N maiores $\lvert v_i \rvert$.
- Um pico a menos de **10 m** de um já escolhido conta como o mesmo defeito: $\lvert x_i - x_j \rvert < 10$ m.

## 12. Resumo por trecho (EH e RH)

- **Agrupamento:** os elementos são agrupados pelo EH/RH.
- **Totais do trecho:** pontos, pontos acima e extensão acima são a soma dos elementos do trecho. A % de perda usa a fórmula do item 3.2 sobre essa soma.
- **"Perderam":** quantos elementos do trecho passaram de 10%.
- **"Maior perda":** o elemento do trecho com a maior % de perda.
- **Ordem das tabelas:** maior perda primeiro; circuitos (RH) por último.

## 13. Dupla checagem (conferência)

### Conferência automática
A cada análise, o app relê o **texto original do CSV** linha a linha, sem usar a leitura nem as contas da análise. Para cada elemento, recalcula em inteiros:
- o total de pontos com F e T lidas;
- os pontos acima da regra.

As contas usam inteiros de 0,0001 mm, a resolução do arquivo:

```math
d_i = \operatorname{round}\big(10000\,(F_i - T_i)\big), \qquad \ell = \operatorname{round}(10000\,L) + 50
```

```math
\text{acima} \iff d_i \ge \ell \ \text{ ou } \ d_i < -\ell
```

Isso é exatamente "$\lvert F - T \rvert$ arredondada a 0,01 mm $> L$". O $+50$ é meio centésimo: 0,005 mm.

**Como os pontos são tomados**
- Os pontos de cada elemento seguem **a ordem das linhas do arquivo**, do primeiro ao último ponto do elemento, e não a faixa de km.
- O motivo: o km pode voltar ou repetir no arquivo (km corrigido durante a inspeção, nova passada no mesmo km). Contar pela faixa de km puxaria pontos de outro trecho.
- O app confere também se o número de linhas de medição lidas por ele é igual ao do arquivo.
- Com **offset aplicado**, a conferência soma o mesmo offset na mesma bitola. A planilha de conferência traz as bitolas já com o offset, indicado no cabeçalho da coluna.
- Elemento que atravessa um circuito é conferido inteiro, antes de tirar os pontos do RH.

**Resultado**
- Tudo igual: selo **✓ Conferido** na tabela de elementos.
- Diferente: botão **⚠ N divergência(s)**. Ele mostra:
  - o elemento;
  - os pontos e os pontos acima pelo app e pela conferência;
  - a lista dos pontos onde o km volta.

### Planilha de conferência (CSV para o Excel)
Um ponto por linha, com as colunas:
- KM e LOCALIZACAO;
- Linha;
- Bitola F e Bitola T;
- F − T (arredondada) e **|F − T| (módulo)**;
- "Acima do limite" (1 = sim);
- Elemento, **Tipo** (Tangente, Curva ou Circuito) e EH/RH;
- **"Na estatística"** (1 = sim).

**Como conferir no Excel**
- **Cartões:** filtre **Na estatística = 1**.
  - Pontos = quantidade de linhas.
  - Pontos acima = soma de "Acima do limite".
  - Para "Em tangentes" / "Em curvas", filtre também o Tipo.
- **Um elemento** (tabela de elementos): filtre a coluna Elemento.
  - Pontos = linhas com F − T preenchida. Se o elemento atravessa um circuito, filtre também Na estatística = 1.
  - Pontos acima = soma de "Acima do limite".

## 14. Tela do carro

**Arquivo e colunas.** Usa o mesmo arquivo da Análise do arquivo, ou um arquivo da Montagem, aberto pelo botão "Abrir na Tela do carro". O km fica na vertical, com uma coluna por parâmetro, nesta ordem:
- Bitola F, Bitola T e Bit_KLD;
- ALv_B2,5 (alinhamento);
- VrBTmax5 (variação de bitola em 5 m);
- EMP_2, NLmax_5 e EMP_10;
- 10000/R (raio, sem limite);
- SUPerABS (superelevação).

**Limites.** Vêm da tabela "Parâmetros EFVM 2026 – bitola métrica", pela velocidade escolhida (15 a 68 km/h). Quando a tabela dá uma faixa ("22 a 28"), vale o menor valor.
- Bitola (F, T e KLD):
  - superior = bitola estática aberta − 1000 (ex.: 1031 a 68 km/h → +31);
  - inferior = fechada 987 − 1000 = −13.
- EMP_2: curva e tangente têm limites diferentes; a linha do limite muda quando o elemento muda.
- SUPerABS: limite do nivelamento transversal máximo, só nas tangentes.
- 10000/R: sem limite.
- Os limites podem ser editados em **Limites** (por velocidade; em branco = sem limite). "Restaurar tabela EFVM 2026" volta à tabela.

**Excesso.** O ponto passa do limite quando:

```math
v_i > \text{lim}_{\text{sup}} \quad\text{ou}\quad v_i < \text{lim}_{\text{inf}}
```

- Fica marcado com uma caixa vermelha na coluna.
- A coluna EX fica vermelha onde algum parâmetro passa do limite.
- O trecho do traçado que passa do limite fica **vermelho**.

**Três níveis de limite.**
- Alerta (laranja) e Interdição (vermelho tracejado) começam em branco e são preenchidos em Limites.
- Restrição (cinza) é o padrão, igual à tabela EFVM 2026.
- O traçado e a coluna EX ficam laranja, vermelhos ou vinho conforme o maior nível ultrapassado.

**Escala automática por coluna.** Os botões + e − aproximam ou afastam. Limites fora da escala não aparecem; o excesso continua marcado.

```math
\text{meia largura} = 1{,}3 \times P_{98}\big(\lvert v_i \rvert\big)
```

**Reprodução.**
- Ao abrir, a tela fica vazia. Com o play, o traçado é desenhado de baixo para cima, como o carro andando.
- Velocidade 1×, 2×, 3×, 5×, 10× ou 20×, onde 1× = 10 m de arquivo por segundo.
- "Ir para o km" mostra o traçado até aquele km; "Reiniciar" volta ao início com a tela vazia.

**Desenho.**
- Valor positivo à esquerda da linha zero.
- Sem grade: só o km na lateral, a linha zero, os limites (pontilhado), os traçados e as marcas.
- **Bitola F e T juntas** (opcional): as duas bitolas na mesma coluna.

**Coluna T/E e eventos.**
- A coluna T/E mostra: tangente (linha preta), curva (barra azul) e RH (barra cinza).
- Eventos são escritos na vertical, à esquerda da coluna T/E.
- "INICIO X" + "FIM X" vira uma barra lateral em toda a extensão.

**Ordem e tamanho.**
- O botão "Ordem" sobe, desce e esconde colunas.
- Arraste a borda de baixo (altura) ou a da direita (largura). Dois cliques na borda voltam ao tamanho padrão.

## 15. Montagem dos dados (cobertura pela geometria)

Aba **Montagem** do Checklist. Junta os arquivos do carro de um ciclo e mostra quanto do trecho já está medido antes de subir para o banco. Cada arquivo fica guardado no aparelho de duas formas:
- um **resumo**: amostras a cada ~1 m, com $x$, $a$ e a linha;
- o **CSV comprimido** (gzip), usado para abrir na Tela do carro e para recalcular quando um acerto de placa é tratado.

### 15.1 O que precisa ser medido

Para o ramal e a linha, pela geometria:
- cada tangente e curva $[g_{\text{ini}}, g_{\text{fim}}]$;
- cada circuito RH da geometria $[r_{\text{ini}}, r_{\text{fim}}]$;
- sem a linha RH na geometria, o vão de até 1.000 m entre dois elementos seguidos.

```math
N = \bigcup_{\text{elementos e RH}} [\,\text{ini},\ \text{fim}\,]
```

Cada trecho carrega a sede (corretiva) da geometria, com `GV I` → GV1 e `NE II` → NE2.

### 15.2 O que cada arquivo cobre

Amostra $k$ (a cada ~1 m), já no km da geometria, com os acertos de placa tratados:

```math
y_k = x_k + a_k^{\text{final}}
```

Amostras seguidas da mesma linha, com $\lvert y_k - y_{k-1} \rvert \le 3$ m, formam um intervalo. A cobertura do arquivo é a união dos intervalos, por linha:

```math
\text{Cob}_{\text{arq}} = \bigcup \,[\min y,\ \max y]
```

**Recorte do arquivo** ("Usar a partir do km / Até o km"): as amostras com $x_k$ fora do recorte não entram.

### 15.3 Medido, falta, buraco e sobreposição

Cobertura de todos os arquivos (intervalos a até 5 m são unidos):

```math
\text{Cob} = \bigcup_{\text{arquivos}} \text{Cob}_{\text{arq}}
```

```math
\%\,\text{medido} = \frac{\lvert N \cap \text{Cob} \rvert}{\lvert N \rvert} \times 100, \qquad \text{Falta} = \lvert N \rvert - \lvert N \cap \text{Cob} \rvert
```

$\lvert \cdot \rvert$ aqui é a soma das extensões, em metros. Valem por sede, por linha e no total.

- **Buraco:** cada intervalo de $N \setminus \text{Cob}$ com mais de 5 m. A tela mostra:
  - o km e o EH/RH;
  - se é salto do km dentro de um arquivo, vão entre dois arquivos, ou trecho antes ou depois deles.

  Em sede sem arquivo, o trecho todo conta como "falta medir".
- **Sobreposição:** $\text{Cob}_A \cap \text{Cob}_B$ com mais de 5 m, para dois arquivos $A$ e $B$. Recorte um dos arquivos para tirar a sobra.

### 15.4 Divisa entre sedes (GV1 → GV2…)

No km da divisa $k_d$ (início da sede seguinte):

| Situação | Regra |
|---|---|
| **encosta** | algum intervalo de Cob contém $[k_d - 5,\ k_d + 5]$ |
| **buraco** | não encosta, mas há cobertura em $[k_d - 2000,\ k_d + 2000]$ (arquivo terminando perto sem encostar no vizinho) |
| **falta arquivo** | nenhuma cobertura até 2 km da divisa |

### 15.5 Inconsistências do arquivo

| Inconsistência | Regra |
|---|---|
| Ramal fora da geometria | ramal do arquivo não existe na geometria |
| Corretiva diferente da sede | menos de 50% da cobertura do arquivo cai na sede da sua coluna CORRETIVA |
| Km volta | $s\,(x_i - x_{i-1}) < -1$ m (que não seja candidato a acerto de placa) |
| Km salta | $s\,(x_i - x_{i-1}) > \max(5,\ 20e)$ m (que não seja candidato a acerto de placa) |
| Km parado | mais de 40 pontos com $x_i = x_{i-1}$ |
| Acerto de placa | item 7.1: lista com a prévia e os botões Tratar / Desfazer |
| LINHA inválida | valor que não é linha (ex.: TESTE01): vale a linha válida mais frequente do arquivo |
| Poucas curvas casadas | $\%\,\text{casadas} < 70\%$ |
| Excel / sem eventos | itens 1 |

## 16. Contagem e conferência por EH e RH

Para cada EH (elementos com o mesmo `eh_linha`) e cada RH da geometria, na linha.

**Da geometria:** quantidade de tangentes e de curvas. Num RH, conta uma curva quando a geometria dá o raio dele.

**Medido:**

```math
\%\,\text{medido} = \frac{\lvert [\text{EH}] \cap \text{Cob} \rvert}{\lvert [\text{EH}] \rvert} \times 100
```

**Curvas medidas:**
- São as curvas pelo raio (item 4) dos arquivos, no km da geometria $[y_{i_0},\ y_{i_1}]$, contadas no EH onde fica o centro.
- Curvas medidas que se sobrepõem, vindas de arquivos diferentes, contam uma vez só.

**Casamento um para um.** Uma curva da geometria $G$ e uma medida $M$ podem casar quando:

```math
\lvert G \cap M \rvert \ge 0{,}5\,\lvert G \rvert \quad\text{ou}\quad \lvert G \cap M \rvert \ge 0{,}5\,\lvert M \rvert
```

Os pares são escolhidos pela maior sobreposição, e cada medida casa com uma só curva.

**Situação de cada curva da geometria**

| Situação | Regra |
|---|---|
| casada | tem par |
| sem leitura | $\lvert G \cap \text{Cob} \rvert < 0{,}9\,\lvert G \rvert$ |
| unida à vizinha | sem par, mas tocada por uma medida já casada com a vizinha (o raio juntou duas curvas) |
| não detectada | lida, sem nenhuma medida. Comum em curva de raio grande, perto do limite de 3.000 m |

**Curva medida a mais:** medida que não toca nenhuma curva da geometria do EH.

**Diferença:**

```math
\text{Diferença} = \text{curvas medidas} - \text{curvas da geometria}
```

**Situação do EH/RH**

| Situação | Regra |
|---|---|
| sem arquivo | $\lvert [\text{EH}] \cap \text{Cob} \rvert = 0$ |
| incompleto | $\%\,\text{medido} < 99{,}5\%$ |
| diverge | medido, mas com curva não detectada/unida, curva a mais ou diferença ≠ 0 |
| confere | medido, todas as curvas casadas e diferença = 0 |

Clique na linha para ver cada curva com km, lado, raio da geometria e a curva medida correspondente.
