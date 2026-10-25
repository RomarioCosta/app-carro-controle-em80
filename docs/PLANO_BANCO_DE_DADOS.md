# Plano – Banco de arquivos do carro (consulta da Tela do carro no celular)

Situação: **em espera** (combinado em 24/10/2026; retomar depois).

## Objetivo

Consultar a **Tela do carro (Offboard)** no celular, a qualquer hora e sem internet, com os arquivos da Montagem
já ajustados (recorte, compensação de km e correção pela geometria).

Hoje os arquivos da Montagem ficam só no aparelho onde foram adicionados (IndexedDB do computador).
Para o celular, eles precisam de um lugar central: o "banco".

## Opções avaliadas

| | A. Google Drive pelo Apps Script (escolhida para começar) | B. BigQuery (previsto no escopo, módulo Dashboard) |
|---|---|---|
| O que é | Um arquivo compacto por CSV, gravado no Drive da conta do app | Tabela com todos os pontos de todos os arquivos |
| Configuração | Nenhuma nova (mesmo Apps Script e mesma conta) | Projeto no Google Cloud, BigQuery, permissões, conta de cobrança |
| Celular | Lista os arquivos do ciclo, baixa e roda na Tela do carro | Consulta o trecho por km na hora |
| Sem internet | Sim, depois de baixado | Não |
| Bom para | Consultar a Tela do carro e os alertas | Painéis, tendências entre ciclos, IA |

A opção B continua sendo o caminho do Dashboard: os pacotes do Drive podem ser carregados no BigQuery depois.

## Estrutura da opção A

### 1. Pacote de cada arquivo (gerado na Montagem, no computador)

Já com recorte, compensações, correção do km pela geometria, elementos e eventos.

| Parte | Conteúdo |
|---|---|
| Cabeçalho | ciclo, ramal, linha, sede, data, km inicial/final (arquivo e geometria), recorte, compensações, versão |
| Pontos (0,25 m) | km compensado, correção pela geometria e os 10 parâmetros da Tela (Bitola F/T, KLD, ALv_B2,5, VrBTmax5, EMP_2, NLmax_5, EMP_10, 10000/R, SUPerABS), em binário |
| Elementos e eventos | tangentes, curvas, RH (EH/RH), AMV, travador, EX |

Estimativa: ~6 MB sem compactar para 56 km; ~3–4 MB compactado (o CSV tem dezenas de MB).

### 2. Onde fica

Drive (pasta criada sozinha):

```
EM80 – Banco de arquivos/
  Ciclo 5/
    RLT_GV2_20261022_0811_01.em80
  Ciclo 6/
    ...
```

Planilha, aba **Banco_Arquivos** (índice): ciclo, nome, ramal, linha, sede, km inicial/final, data da inspeção,
pontos, tamanho, versão, publicado em, id do arquivo no Drive.

Opcional: **Banco_Alertas** (alertas de geometria de todos os arquivos do ciclo) e **Banco_Cobertura**
(% medido, buracos e sobreposições por ramal, linha e sede).

### 3. Publicar (Montagem, computador)

Botão **"Publicar no banco"** no ciclo:

1. Gera o pacote de cada arquivo.
2. Envia em partes de ~2 MB (limite do Apps Script por envio); se a internet cair, continua da parte que faltou.
3. O servidor junta as partes, grava no Drive e atualiza a aba Banco_Arquivos.
4. Publicar de novo **substitui** a versão (sem duplicar). A Montagem mostra "publicado" / "mudou desde a publicação".

Servidor (Apps Script): `publicarInicio`, `publicarParte`, `publicarFim`, `listarBanco`, `baixarParte`.

### 4. Consultar (celular, Tela do carro)

1. Seletor **"Banco"**: ciclos e arquivos por linha e km.
2. Toca no arquivo → baixa (barra de progresso) → roda.
3. Arquivos baixados ficam no celular e abrem sem internet; versão nova no banco aparece como "atualizar".
4. **Ir para o km** no ciclo inteiro: abre o arquivo que cobre o km, já na posição.
5. Anterior / Próximo / "Rodar o próximo" também com os arquivos do banco.
6. Layout da Tela do carro para celular (escolher colunas; em pé cabem 4–5 parâmetros).

### Etapas

| Etapa | Entrega |
|---|---|
| 1 | Pacote + "Publicar no banco" + pasta no Drive + aba Banco_Arquivos |
| 2 | Tela do carro lendo o banco (download, offline, ir para o km no ciclo) |
| 3 | Layout da Tela do carro para celular |
| 4 (opcional) | Abas Banco_Alertas e Banco_Cobertura |

### Limites e custo

- Grátis (15 GB do Drive; ~4 MB por arquivo → milhares de arquivos).
- Mesmo código de acesso do app; arquivos na conta do app.

## Pendências para retomar

1. Tamanho típico de um CSV (ex.: `RLT_GV2_20261022_0811_01.csv`) e quantos arquivos tem um ciclo.
2. Incluir ou não as abas Banco_Alertas e Banco_Cobertura.
3. Confirmar o início pela etapa 1.
