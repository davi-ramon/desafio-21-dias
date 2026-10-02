/* ════════════════════════════════════════════════════════════
   firebase-messaging-sw.js — Service Worker do Desafio 21 Dias
   ------------------------------------------------------------
   Faz duas coisas: recebe as notificações em segundo plano e
   serve uma casca mínima quando a internet cai.

   Fica na RAIZ de propósito. O Firebase Messaging procura este
   arquivo em /firebase-messaging-sw.js por padrão, e o escopo
   precisa cobrir /app — um SW registrado dentro de /app não
   controlaria a raiz.

   A configuração vem de /__/firebase/init.json, servido pelo
   próprio Firebase Hosting. Assim a chave nunca é digitada em
   dois lugares e não sai de sincronia quando o projeto muda.
   ════════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const CACHE = 'd21-casca-v1';
const CASCA = ['/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CASCA).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) { return n === CACHE ? null : caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Só os ícones saem do cache. O HTML e as chamadas ao Apps Script
// SEMPRE vão à rede: servir uma tela de progresso velha seria pior
// que mostrar erro de conexão.
self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.indexOf('/icons/') < 0) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) { return hit || fetch(e.request); })
  );
});

// ── Notificações ───────────────────────────────────────────
firebase.initializeApp(
  (function () {
    try {
      var r = new XMLHttpRequest();
      r.open('GET', '/__/firebase/init.json', false);
      r.send(null);
      return JSON.parse(r.responseText);
    } catch (e) { return {}; }
  })()
);

try {
  var messaging = firebase.messaging();

  messaging.onBackgroundMessage(function (payload) {
    var d = payload.data || {};
    var titulo = d.titulo || 'Desafio 21 Dias';
    self.registration.showNotification(titulo, {
      body: d.corpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // A tag junta avisos do mesmo assunto: se a pessoa ficou
      // 3 horas fora, ela volta com UM lembrete de água, não seis.
      tag: d.grupo || 'geral',
      renotify: false,
      data: { url: d.url || '/app' },
      actions: d.acao ? [{ action: 'abrir', title: d.acao }] : []
    });
  });
} catch (e) {}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var destino = (e.notification.data && e.notification.data.url) || '/app';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      // Se o app já está aberto, foca a aba em vez de abrir outra — e
      // manda o destino por mensagem em vez de recarregar. Um reload
      // aqui custa o cold start do Apps Script inteiro, e a pessoa
      // ficaria olhando spinner depois de tocar na notificação.
      for (var i = 0; i < lista.length; i++) {
        var c = lista[i];
        if (c.url.indexOf('/app') < 0) continue;
        try { c.postMessage({ tipo: 'atalho', url: destino }); } catch (err) {}
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(destino);
    })
  );
});
