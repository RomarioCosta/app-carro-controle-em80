# App Carro Controle EM80

App para uso em campo no Carro Controle EM80 (CMA – Centro de Monitoramento de Ativos):
checklist de inspeção, registro de eventos, produção de OMs e relatório de anomalia para o WhatsApp.
Os dados vão para uma planilha do Google Sheets.

- **Escopo e regras:** [ESCOPO.md](ESCOPO.md)
- **Instalação passo a passo:** [INSTALACAO.md](INSTALACAO.md)

## Estrutura

| Pasta / arquivo | Conteúdo |
|---|---|
| `web/` | Código-fonte do app (HTML, CSS e JavaScript, sem bibliotecas) |
| `web/js/config.js` | Perguntas do checklist e lista de equipamentos |
| `web/js/modulos/` | Uma tela por arquivo |
| `apps-script/Codigo.js` | Servidor (Google Apps Script): API e gravação na planilha |
| `apps-script/Index.html` | App em arquivo único, **gerado** pelo build (não editar à mão) |
| `tools/build.mjs` | Gera o `Index.html` e a versão do cache do PWA |
| `tests/` | Testes automáticos (servidor, regras e navegador) |

## Comandos

```bash
npm run build      # gera apps-script/Index.html a partir de web/
npm test           # testes do servidor e das regras
npm run test:e2e   # teste completo no navegador (Playwright/Chromium)
```

## Como funciona

- **Offline primeiro:** tudo é salvo no aparelho (IndexedDB) e entra numa fila de envio.
- **Envio seguro:** cada registro tem um identificador único; reenviar não duplica linhas, e a versão mais recente prevalece.
- **Dois modos com o mesmo código:** servido pelo Apps Script (link `/exec`) ou como site PWA, que abre sem internet.
