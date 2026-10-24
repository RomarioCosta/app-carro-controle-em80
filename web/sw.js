/*
 * Service worker (somente no modo site/PWA): guarda os arquivos do app
 * para que ele abra mesmo sem internet. Os dados vão pela API, nunca pelo cache.
 * Ao publicar uma versão nova, o build atualiza VERSAO automaticamente.
 */
'use strict';

const VERSAO = 'em80-1585c823be';
const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'img/carro.jpg',
  'img/icone-192.png',
  'img/icone-512.png',
  'js/util.js',
  'js/config.js',
  'js/store.js',
  'js/api.js',
  'js/sync.js',
  'js/dados.js',
  'js/ui.js',
  'js/charts.js',
  'js/om.js',
  'js/bitola.js',
  'js/cobertura.js',
  'js/malha.js',
  'js/esquema.js',
  'js/modulos/analise.js',
  'js/modulos/tela-carro.js',
  'js/modulos/montagem.js',
  'js/modulos/checklist.js',
  'js/modulos/eventos.js',
  'js/modulos/producao.js',
  'js/modulos/rota.js',
  'js/modulos/ajustes.js',
  'js/modulos/anomalia.js',
  'js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Arquivos do app: rede primeiro (pega atualizações). Sem internet ou com sinal
// muito fraco (mais de 4 s sem resposta), usa a cópia guardada.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.search) return; // consultas de versão (?v=...) vão direto para a rede, sem guardar cópia

  const doCache = () => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));

  e.respondWith(new Promise((resolve) => {
    let respondido = false;
    const responder = (r) => {
      if (!respondido && r) {
        respondido = true;
        resolve(r);
      }
    };
    const timer = setTimeout(() => doCache().then(responder), 4000);
    // "no-cache": sempre confere com o servidor se há versão nova (evita esperar o cache de 10 min do GitHub Pages).
    fetch(req, { cache: 'no-cache' })
      .then((resp) => {
        clearTimeout(timer);
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        responder(resp);
      })
      .catch(() => {
        clearTimeout(timer);
        doCache().then((r) => responder(r || Response.error()));
      });
  }));
});
