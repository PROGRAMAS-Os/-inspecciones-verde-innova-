// Service worker: guarda el "cascarón" de la app (HTML/CSS/JS) para que abra
// sin conexión desde el segundo uso en adelante. La primera vez sí necesita
// internet, como cualquier página web nueva.

const CACHE_NAME = 'vi-inspecciones-v2';
const RUTA_BASE = self.location.pathname.replace(/sw\.js$/, '');

const ARCHIVOS_CASCARON = [
  '', 'index.html', 'checklist.html', 'reporte.html', 'config.html',
  'css/app.css', 'js/app.js', 'js/checklist.js', 'js/reporte.js',
].map((f) => RUTA_BASE + f);

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_CASCARON)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Red primero (para ver siempre la versión más nueva en cuanto haya señal);
// si no hay conexión, cae de respaldo a lo último guardado en caché.
self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;
  if (!evento.request.url.startsWith(self.location.origin)) return;
  evento.respondWith(
    fetch(evento.request)
      .then((respuesta) => {
        if (respuesta && respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(evento.request))
  );
});
