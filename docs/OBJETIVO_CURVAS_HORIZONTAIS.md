# Objetivo futuro – Tela de curvas horizontais (estilo AutoCAD)

> Status: **ideia registrada, ainda não desenvolvida** (conversa de 25/10/2026). Voltar a discutir antes de começar.

## O que se quer

Uma tela para **ver a via em planta** com os dados do carro controle, mostrando:

- cada curva horizontal e o seu **ângulo central**;
- os **dados geométricos** da curva;
- **onde termina a tangente e começa a curva**, com marcações e textos, de um jeito parecido com um desenho do AutoCAD.

## Fontes de dados

O desenho vem da **trajetória medida pela IMU** (unidade inercial) do carro, e não do GPS. A IMU mede a rotação do carro (rumo/guinada, rolagem, arfagem). Juntando isso com a distância do odômetro, sai a trajetória em **coordenadas locais (x, y, em metros)**, relativas ao início do arquivo. Essas não são coordenadas geográficas (lat/long), mas é exatamente o que um desenho tipo AutoCAD precisa.

| Fonte | Para que serve | Observação |
|---|---|---|
| IMU: rumo (heading) ou taxa de guinada | Trajetória em planta (x, y), ângulo central | Canal a confirmar no export do Offboard. |
| `10000/R` (curvatura, já vem no CSV) | Raio, início/fim da curva, espirais e também a trajetória | A curvatura do carro já vem da IMU com o odômetro. Se o rumo não vier no arquivo, a trajetória pode ser montada só com ela (fórmulas abaixo). |
| IMU: rolagem / `SUPerABS` | Superelevação | Já vem no CSV. |
| Geometria de projeto (planilha) | Comparar o medido com o projeto | Raio, km inicial e km final de cada elemento. |
| `Lat` / `Long` (GPS) | **Opcional**: girar e posicionar o desenho no mapa | Todos os arquivos têm. No GV1 vieram sem a vírgula decimal (`-188.762.504.586.032` = −18,876…). O mapa de fundo é opcional. |

### Trajetória a partir da IMU (coordenadas locais)

Com o rumo θ de cada ponto (direto da IMU, ou calculado pela curvatura) e `ds` = distância entre pontos (0,25 m):

```
θ(s) = θ0 + Σ (c ÷ 10000) × ds        (rumo, em rad; c = 10000/R; só se a IMU não der o rumo)
x(s) = Σ cos θ × ds
y(s) = Σ sin θ × ds
```

- **Início:** x = 0, y = 0 e θ0 = 0. A trajetória é **relativa**: dá a forma exata da via, só que sem posição no mapa.
- **Com o GPS** (opcional): o desenho é girado e encaixado na posição real usando dois pontos distantes.
- **Erro acumulado:** pequenos erros de rumo se somam ao longo de quilômetros. Para curvas isoladas não faz diferença. Para trechos longos, o desenho é corrigido trecho a trecho, pelas tangentes e pela geometria de projeto.

**Exemplo.** Curva circular de raio 500 m (c = 20) com 400 m: o rumo gira 0,8 rad (45,8°) do início ao fim. A trajetória (x, y) descreve um arco de 400 m que, no desenho, une as duas tangentes com esse ângulo entre elas.

## Cálculos previstos

Com `c = 10000/R`, em cada ponto, e `ds` = distância entre pontos (0,25 m):

| Dado | Fórmula / regra |
|---|---|
| Raio da curva circular | média de `10000 ÷ c` no trecho circular (sem as espirais) |
| Ângulo central Δ (rad) | `Δ = Σ (c ÷ 10000) × ds` ao longo da curva inteira (espirais + circular) |
| Ângulo central Δ (graus) | `Δ × 180 ÷ π` |
| Espirais de transição | trechos em que a curvatura cresce (ou diminui) aos poucos, entre 0 e `10000/R` |
| Pontos notáveis | **TE** (tangente → espiral), **EC** (espiral → circular), **CE** (circular → espiral), **ET** (espiral → tangente), com o km de cada um |
| Comprimento das espirais | km(EC) − km(TE) e km(ET) − km(CE) |
| Desenvolvimento da curva | km(ET) − km(TE) |
| Tangente externa | `T = R × tan(Δ ÷ 2)` (curva circular simples) |
| Superelevação | `SUPerABS` medida no trecho circular |

**Exemplo.** Curva de raio 500 m com 400 m de desenvolvimento circular:

```
Δ = 400 ÷ 500 = 0,8 rad = 45,8°
T = 500 × tan(22,9°) = 211 m
```

## Como seria a tela

1. **Planta da via**, com zoom e arraste. Tangentes em preto; curvas coloridas por lado (esquerda / direita).
2. **Marcações** de TE, EC, CE e ET, com o km.
3. **Etiqueta de cada curva**: número, R, Δ, desenvolvimento, T, comprimento das espirais e superelevação.
4. **Comparação com a geometria de projeto**: raio e km medidos × projeto, destacando onde passa de uma tolerância.
5. **Exportação DXF**, que abre no AutoCAD, com camadas separadas para tangentes, curvas, espirais, pontos notáveis e textos.
6. **Fundo de mapa (satélite):** opcional. Precisa de internet; o desenho sozinho funciona offline.

## Etapas sugeridas

1. **Tabela de curvas**: R, Δ, TE/EC/CE/ET, espirais e desenvolvimento, por EH. É só cálculo, sem desenho, e já é útil sozinha, inclusive no laudo.
2. **Trajetória pela IMU**: (x, y) locais pelo rumo da IMU ou pela curvatura, validada com a geometria de projeto.
3. **Planta da via** (desenho em SVG, com marcações e etiquetas). Lat/Long e mapa de fundo são opcionais.
4. **Comparação com o projeto** (geometria).
5. **Exportação DXF**.

## Para começar, falta

- Ver no Offboard quais **canais da IMU** podem ser exportados no CSV: rumo/heading, taxa de guinada (yaw rate), rolagem, arfagem. Se algum vier com coordenadas próprias da IMU, precisa saber a unidade e o referencial (metros locais, graus, origem).
- Um arquivo de exemplo com esses canais (uns 10 minutos de medição bastam), para validar.
- O mapa de fundo é **opcional** (decidido em 25/10/2026).
- Definir as tolerâncias da comparação com o projeto (ex.: diferença de raio, de km, de Δ).
