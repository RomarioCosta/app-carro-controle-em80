# Objetivo futuro – Tela de curvas horizontais (estilo AutoCAD)

> Status: **ideia registrada, ainda não desenvolvida** (conversa de 25/10/2026). Voltar a discutir antes de começar.

## O que se quer

Uma tela para **ver a via em planta** com os dados do carro controle, mostrando:

- cada curva horizontal e o seu **ângulo central**;
- os **dados geométricos** da curva;
- **onde termina a tangente e começa a curva**, com marcações e textos, de um jeito parecido com um desenho do AutoCAD.

## Fontes de dados

| Fonte | Para que serve | Observação |
|---|---|---|
| `10000/R` (curvatura) | Raio, ângulo central, início/fim da curva, espirais | É a fonte **mais precisa** para a geometria. O app já usa essa coluna para achar tangentes e curvas (memória de cálculo, item 4). |
| `Lat` / `Long` (coordenadas) | Desenho da via em planta, na posição real | Precisão do GPS: alguns metros. Serve para o desenho, **não** para medir o raio. |
| Geometria de projeto (planilha) | Comparar o medido com o projeto | Raio, km inicial e km final de cada elemento. |

**Atenção ao formato das coordenadas.** No arquivo do GV1 (14/08/2026), Lat/Long aparecem como `-188.762.504.586.032`, com pontos no lugar dos separadores e sem a vírgula decimal. O valor certo é −18,876…. Antes de desenhar, é preciso:

- confirmar esse formato em outros arquivos;
- confirmar a frequência das coordenadas (se vêm em todo ponto ou de tempos em tempos);
- tratar a leitura no `lerCSV`.

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
6. **Fundo de mapa (satélite)** opcional. Precisa de internet; o desenho sozinho funciona offline.

## Etapas sugeridas

1. **Tabela de curvas**: R, Δ, TE/EC/CE/ET, espirais e desenvolvimento, por EH. É só cálculo, sem desenho, e já é útil sozinha, inclusive no laudo.
2. **Leitura das coordenadas**: corrigir o formato de Lat/Long e validar com um arquivo real.
3. **Planta da via** (desenho em SVG, com marcações e etiquetas).
4. **Comparação com o projeto** (geometria).
5. **Exportação DXF**.

## Para começar, falta

- Um arquivo do carro com Lat/Long preenchidos em todo o trecho (uns 10 minutos de medição bastam), para confirmar o formato e a frequência.
- Definir se o fundo de mapa é necessário.
- Definir as tolerâncias da comparação com o projeto (ex.: diferença de raio, de km, de Δ).
