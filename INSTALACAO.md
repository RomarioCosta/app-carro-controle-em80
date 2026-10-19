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

## Atualizar para uma nova versão

Quando o código mudar no GitHub:

1. Copie de novo os arquivos que mudaram (normalmente `Codigo.js` e `Index.html`).
2. **Implantar → Gerenciar implantações → ✏️ (editar)** → em "Versão", escolha **Nova versão** → **Implantar**.

O link continua o mesmo. Os dados não são afetados.

---

## Sobre o funcionamento sem internet

- Depois de aberto, o app **salva tudo no celular** mesmo sem sinal e envia para a planilha
  quando a conexão volta (o ícone de nuvem no topo mostra quantos registros estão pendentes).
- Pelo link do Apps Script, o app **precisa de internet para abrir**. Se ele for fechado e o celular estiver sem sinal,
  só abre de novo quando houver conexão. Os dados já salvos não se perdem.
- Para abrir **mesmo sem sinal**, o app pode ser publicado também como site (PWA), usando o mesmo código da pasta `web/`.
  Nesse modo, em **Ajustes** informe a URL `/exec` e o código de acesso.

## Roteiro de teste

1. **Checklist:** preencha responsável, data e ciclo; responda todas as perguntas; marque um "Sim" e veja o campo de descrição; adicione amostras; salve. Confira as abas `Checklists`, `Checklist_Respostas` e `Checklist_Amostras`.
2. **Eventos:** escolha um equipamento e toque em **Iniciar agora**; depois **Finalizar agora**. Teste também **Duplicar último** e o preenchimento manual dos horários.
3. **Produção:** em **Importar**, informe o número do ciclo e escolha a planilha do SAP com a coluna **Data Programada**. Toque nas OMs do dia, veja os percentuais e os gráficos. Teste um toque duplo para desfazer.
4. **Sem sinal:** ative o modo avião, marque uma OM e salve um evento; desative e veja o envio automático.
5. **Anomalia:** toque na aba amarela **Anomalia** na lateral, preencha, salve e use **Copiar** ou **Enviar no WhatsApp**.
6. **Tema:** use o botão de lua/sol no topo.
