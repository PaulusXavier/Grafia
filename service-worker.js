// Aumente o número a cada nova publicação: é a mudança neste arquivo que faz
// os aparelhos detectarem e aplicarem a atualização.
const CACHE_NAME = 'grafia-shell-b9a7f63fb2';

const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './paulus.v1.js',
  './paulus-grafia.js',
  './mascote.js',
  './conhecimento.json',
  './manifest.json',
  './icon-192.png',
  './icon-192-maskable.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// SDK do Firebase (mesma versão de app.js e firebase-config.js). Pré-carregado
// para o app abrir offline mesmo se o aparelho ficar sem internet logo após a
// primeira visita. Os módulos internos dele são guardados na primeira abertura
// já controlada pelo service worker.
const SDK_FILES = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Um a um: se um ícone faltar, o resto continua sendo guardado
      // (addAll falharia por inteiro). cache:'reload' ignora o cache HTTP do
      // GitHub Pages e garante arquivos realmente novos.
      Promise.allSettled(
        [...SHELL_FILES, ...SDK_FILES].map((url) =>
          cache.add(new Request(url, { cache: 'reload' }))
        )
      ).then((results) => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') console.warn('Não foi possível guardar em cache:', i, r.reason);
        });
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first com atualização em segundo plano (stale-while-revalidate).
// Chamadas ao Firebase (Auth/Firestore) vão direto à rede: o SDK do Firestore
// cuida do cache/fila offline. O SDK em si (gstatic.com) é guardado acima.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isFirebaseApi = url.hostname.includes('firebase') || url.hostname.includes('googleapis');
  if (isFirebaseApi || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch); // deixa a atualização terminar em segundo plano
        return cached;
      }

      return networkFetch.then((response) => {
        if (response) return response;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
