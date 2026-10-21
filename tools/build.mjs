#!/usr/bin/env node
/*
 * Gera os arquivos de publicação a partir da pasta web/:
 *  - apps-script/Index.html: página única (CSS, JS e imagem embutidos) servida pelo Apps Script.
 *  - web/sw.js e web/js/config.js: número da versão (muda quando algum arquivo muda).
 *
 * Uso: node tools/build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(raiz, 'web');
const ler = (p) => readFileSync(join(web, p), 'utf8');

// 1) Versão = hash do conteúdo dos arquivos (o próprio número da versão é ignorado no cálculo,
//    para que rodar o build duas vezes gere sempre o mesmo resultado).
const swOriginal = ler('sw.js');
const lista = [...swOriginal.matchAll(/^\s+'([^']+)',?$/gm)].map((m) => m[1]).filter((p) => p !== './');
const hash = createHash('sha256');
const normalizar = (p, conteudo) => {
  if (p === 'js/config.js') return Buffer.from(conteudo.toString('utf8').replace(/build: '[^']*'/, "build: ''").replace(/versao: '[^']*'/, "versao: ''"));
  return conteudo;
};
lista.forEach((p) => hash.update(normalizar(p, readFileSync(join(web, p)))));
const versao = `em80-${hash.digest('hex').slice(0, 10)}`;
writeFileSync(join(web, 'sw.js'), swOriginal.replace(/const VERSAO = '[^']*';/, `const VERSAO = '${versao}';`));
// O mesmo código aparece em Ajustes, para conferir qual versão está aberta.
// Versão mostrada em Ajustes: data do build (AAAA.MM.DD), trocada só quando o conteúdo muda.
const configPath = join(web, 'js', 'config.js');
let config = readFileSync(configPath, 'utf8');
const buildAnterior = (/build: '([^']*)'/.exec(config) || [])[1];
if (buildAnterior !== versao) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(/-/g, '.');
  config = config.replace(/versao: '[^']*'/, `versao: '${hoje}'`);
}
writeFileSync(configPath, config.replace(/build: '[^']*'/, `build: '${versao}'`));

// 2) Index.html do Apps Script (com a versão já preenchida).
let html = ler('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const estilos = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

const dataUri = (arquivo, tipo) => `data:${tipo};base64,${readFileSync(join(web, arquivo)).toString('base64')}`;
const imagemCarro = dataUri('img/carro.jpg', 'image/jpeg');

// Evita fechar a tag <script> por engano dentro do código.
const seguro = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let saida = html.replace(/\s*<!--pwa-->[\s\S]*?<!--\/pwa-->/, '');
estilos.forEach((href) => {
  saida = saida.replace(`<link rel="stylesheet" href="${href}">`, () => `<style>\n${ler(href)}\n</style>`);
});
scripts.forEach((src) => {
  let js = ler(src);
  if (src.endsWith('app.js')) js = js.replace("'img/carro.jpg'", () => `'${imagemCarro}'`);
  saida = saida.replace(`<script src="${src}"></script>`, () => `<script>\n/* ${src} */\n${seguro(js)}\n</script>`);
});

if (/<script src=|<link rel="stylesheet"/.test(saida)) throw new Error('Sobrou referência externa no Index.html');
if (saida.includes("'img/carro.jpg'")) throw new Error('Imagem do cabeçalho não foi embutida');
writeFileSync(join(raiz, 'apps-script', 'Index.html'), saida);

console.log(`Index.html gerado (${(saida.length / 1024).toFixed(0)} KB). Cache do PWA: ${versao}`);
