# Instalação – App Carro Controle EM80

Tempo estimado: 15 minutos. Faça pelo **computador** (fica mais fácil copiar os arquivos).

## 1. Criar a planilha

1. No Google Drive, crie uma planilha nova: **Novo → Planilhas Google**.
2. Dê um nome, por exemplo **EM80 – Dados do App**.

## 2. Colar o código no Apps Script

1. Na planilha, abra **Extensões → Apps Script**.
2. No editor, apague o conteúdo do arquivo `Código.gs` e cole todo o conteúdo de
   [`apps-script/Codigo.js`](apps-script/Codigo.js) (no GitHub, abra o arquivo e use o botão **Copy raw file**).
3. Clique na engrenagem **Configurações do projeto** e marque
   **Mostrar arquivo de manifesto "appsscript.json" no editor**.
   Volte ao editor, abra o `appsscript.json` e substitua o conteúdo por
   [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Clique no **+** ao lado de "Arquivos" → **HTML**, dê o nome **Index** (sem ".html")
   e substitua o conteúdo por [`apps-script/Index.html`](apps-script/Index.html).
5. Salve (ícone de disquete ou Ctrl+S).

## 3. Preparar a planilha e gerar o código de acesso

1. Na barra do editor, escolha a função **setup** e clique em **Executar**.
2. O Google vai pedir autorização. Como o script é seu, aparece o aviso
   "O Google não verificou este app": clique em **Avançado → Acessar (não seguro)** e **Permitir**.
3. No **Registro de execução** aparece: `Código de acesso do app: XXXXXXXXXXXX`.
   **Anote esse código.** Se não aparecer ou se você perder, o código também fica em
   **Configurações do projeto** (engrenagem ⚙ à esquerda) → **Propriedades do script** → valor de `API_TOKEN`.
4. Volte à planilha: as abas Checklists, Eventos, Anomalias, OMs, Execucoes etc. foram criadas.

## 4. Publicar o app

1. No editor, clique em **Implantar → Nova implantação**.
2. Em "Selecionar tipo", escolha **App da Web**.
3. Configure:
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
4. Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).

> "Qualquer pessoa" é necessário para o app funcionar no celular sem login extra.
> Os dados ficam protegidos pelo código de acesso: sem ele, nada é lido nem gravado.

## 5. Usar no celular

1. Abra o link `/exec` no Chrome do celular.
2. Na primeira vez, o app pede o **código de acesso**: digite o código anotado.
3. No menu do Chrome (⋮), toque em **Adicionar à tela inicial**.

## Usar como site (recomendado: atualiza sozinho e abre sem sinal)

Com o site no GitHub Pages, cada correção aprovada no GitHub chega ao app **sem copiar código**.
O Apps Script continua sendo o servidor que grava na planilha.

**Configuração (uma vez só):**

1. No GitHub, abra o repositório → **Settings** → **General** → no fim da página, em **Danger Zone**,
   clique em **Change visibility → Make public** e confirme.
2. Ainda em **Settings**, abra **Pages** (menu da esquerda). Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Abra a aba **Actions** do repositório, clique em **Publicar app** → **Run workflow** → **Run workflow**.
   Em cerca de 1 minuto o site fica no ar em:
   **https://romariocosta.github.io/app-carro-controle-em80/**
4. Abra esse endereço no celular. O app abre em **Ajustes**: informe
   - **URL do servidor:** o link `/exec` da implantação do Apps Script;
   - **Código de acesso:** o mesmo de antes (`API_TOKEN`);
   e toque em **Salvar e testar**.
5. No menu do Chrome (⋮), toque em **Adicionar à tela inicial** (ou **Instalar app**).

> **O que fica público:** apenas o código do app e a documentação. Os dados continuam na sua planilha,
> protegidos pelo código de acesso, que **não** está no repositório. O nome e o e-mail usados nos commits
> também ficam visíveis no histórico.

**Atualizações:** quando uma correção é aprovada (Merge) no GitHub, o site é republicado sozinho.
No celular, basta abrir o app com internet para receber a versão nova.

## Atualizar a versão do Apps Script

Só é necessário quando o arquivo `Codigo.js` mudar (o servidor), ou se você usar o app pelo link `/exec`:

1. Copie de novo os arquivos que mudaram (normalmente `Codigo.js` e `Index.html`).
2. **Implantar → Gerenciar implantações → ✏️ (editar)** → em "Versão", escolha **Nova versão** → **Implantar**.

O link continua o mesmo. Os dados não são afetados.

---

## Sobre o funcionamento sem internet

- Depois de aberto, o app **salva tudo no celular** mesmo sem sinal e envia para a planilha
  quando a conexão volta (o ícone de nuvem no topo mostra quantos registros estão pendentes).
- Pelo link do Apps Script, o app **precisa de internet para abrir**. Se ele for fechado e o celular estiver sem sinal,
  só abre de novo quando houver conexão. Os dados já salvos não se perdem.
- Pelo **site** (GitHub Pages), o app **abre mesmo sem sinal**, depois de ter sido aberto uma vez com internet.

## Roteiro de teste

1. **Checklist:** preencha responsável, data e ciclo; responda todas as perguntas; marque um "Sim" e veja o campo de descrição; adicione amostras; salve. Confira as abas `Checklists`, `Checklist_Respostas` e `Checklist_Amostras`.
2. **Eventos:** escolha um equipamento e toque em **Iniciar agora**; depois **Finalizar agora**. Teste também **Duplicar último** e o preenchimento manual dos horários.
3. **Produção:** em **Importar**, informe o número do ciclo e escolha a planilha do SAP com a coluna **Data Programada**. Toque nas OMs do dia, veja os percentuais e os gráficos. Teste um toque duplo para desfazer.
4. **Sem sinal:** ative o modo avião, marque uma OM e salve um evento; desative e veja o envio automático.
5. **Anomalia:** toque na aba amarela **Anomalia** na lateral (ou no ícone de alerta no topo), preencha, salve e use **Copiar mensagem**. O formulário fica limpo para o próximo defeito.
6. **Tema:** use o botão de lua/sol no topo.
