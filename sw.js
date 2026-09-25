/* Task Board の読み込み係（Pair Board と同じ形）
   ・いつもサーバーを先に見に行き、取れたときだけ控えを入れ替えます（つながらないときは控えを出す）
   ・res.ok を必ず見ます。見ないと、エラー画面そのものを控えてしまいます
   ・GitHub が落ちていて 500 などが返ったときも、控えがあれば控えを出します */
var VERSION = 'tb-f54e14d2';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === VERSION ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }
      return caches.match(req).then(function (hit) { return hit || res; });
    }).catch(function () {
      // つながらないとき。控えが無ければ、ページを開くときだけ控えの index.html を出す
      // （js や css の代わりに index.html を渡すと、文法の誤りで画面ごと止まるため）
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html').then(function (h) { return h || Response.error(); });
        return Response.error();
      });
    })
  );
});
