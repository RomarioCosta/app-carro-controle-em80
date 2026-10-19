/*
 * Servidor local para testes de ponta a ponta:
 *  - serve a pasta web/ e o apps-script/Index.html gerado;
 *  - POST /exec executa o Codigo.js real (planilha simulada);
 *  - GET /__planilha devolve o conteúdo das abas para conferência.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarServidor } from './gas-fake.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg'
};

export function iniciarServidor(porta = 8787) {
  let gas = carregarServidor(join(raiz, 'apps-script', 'Codigo.js'));
  gas.ctx.setup();
  const estado = { token: gas.props.get('API_TOKEN'), falharRede: false, chamadas: 0 };

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${porta}`);
    const cors = { 'Access-Control-Allow-Origin': '*' };

    if (req.method === 'POST' && url.pathname === '/exec') {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        estado.chamadas++;
        if (estado.falharRede) {
          res.destroy();
          return;
        }
        try {
          const saida = gas.ctx.doPost({ postData: { contents: corpo } }).getContent();
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(saida);
        } catch (e) {
          res.writeHead(500, cors);
          res.end(String(e));
        }
      });
      return;
    }
    if (url.pathname === '/__planilha') {
      const abas = Object.fromEntries(gas.ss.getSheets().map((s) => [s.nome, s.comoObjetos()]));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(abas, (k, v) => v));
      return;
    }

    let caminho = url.pathname === '/' ? '/web/index.html' : url.pathname;
    if (!caminho.startsWith('/apps-script/')) caminho = caminho.startsWith('/web/') ? caminho : `/web${caminho}`;
    const arquivo = normalize(join(raiz, caminho));
    if (!arquivo.startsWith(raiz) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) {
      res.writeHead(404);
      res.end('não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(arquivo));
  });

  return new Promise((resolve) => {
    servidor.listen(porta, () => resolve({
      servidor,
      estado,
      gas: () => gas,
      reiniciar() {
        gas = carregarServidor(join(raiz, 'apps-script', 'Codigo.js'));
        gas.ctx.setup();
        estado.token = gas.props.get('API_TOKEN');
      },
      fechar: () => new Promise((r) => servidor.close(r))
    }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  iniciarServidor(Number(process.env.PORTA || 8787)).then(({ estado }) => {
    console.log(`Servidor de teste em http://localhost:${process.env.PORTA || 8787}  código: ${estado.token}`);
  });
}
