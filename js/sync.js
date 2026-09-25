/* Task Board 同期（Pair Board と同じ形を、側ごとに1つずつ）
   ・★個人と会社は、同期の係も別々です。それぞれ自分の側の送信箱だけを、自分の側の受け口へ送ります
   ・毎回「いまどちら側か（space）」を添えて送ります。受け口は反対側の印を断るので、
     URL を入れ違えても中身は混ざりません（gas/コード.gs）
   ・次に受け取る目印（since）は必ず受け口が返した now を使います。
     手元の時計はGoogleの時計とズレるので、自分の時計を使うと取りこぼします */
(function (global) {
  'use strict';

  var Store = null;
  var LABEL = function (sp) { return (APP.spaces[sp] || {}).label || sp; };

  function explain(obj) {
    if (obj.error === 'bad_pin') return '合言葉が違います';
    if (obj.error === 'locked') return '合言葉を何度もまちがえたので、10分止まっています';
    if (obj.error === 'wrong_space') return 'このつなぎ先は「' + LABEL(obj.space) + '」の受け口です。入れる場所が違います';
    if (obj.error === 'not_setup') return '受け口の用意（setupPersonal／setupWork）がまだです';
    return obj.error || '断られました';
  }

  function post(u, payload) {
    return fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) { return r.text(); }).then(function (t) {
      var obj;
      try { obj = JSON.parse(t); }
      catch (e) { throw new Error('返事が読めません（URLがウェブアプリのものか確かめてください）'); }
      if (!obj.ok) throw new Error(explain(obj));
      return obj;
    });
  }

  function make(space) {
    var busy = false;

    function url() {
      var m = Store.meta(space);
      var def = ((global.APP && APP.spaces[space]) || {}).syncUrl || '';
      return (m.url || def || '').trim();
    }
    function pin() { return (Store.meta(space).pin || '').trim(); }
    function enabled() { return !!url() && !!pin(); }

    var S = {
      space: space,
      url: url,
      enabled: enabled,
      lastError: '',

      state: function () {
        var n = Store.outboxCount(space);
        if (!enabled()) return { kind: 'off', pending: n };
        if (busy) return { kind: 'busy', pending: n };
        if (S.lastError) return { kind: 'error', pending: n, message: S.lastError };
        if (n) return { kind: 'pending', pending: n };
        return { kind: 'ok', pending: 0, at: Store.meta(space).lastSyncAt };
      },

      /** 送って受け取る。手で押したときは force=true（失敗を投げる） */
      run: function (force) {
        if (!enabled()) return Promise.resolve({ skipped: 'off' });
        if (busy) return Promise.resolve({ skipped: 'busy' });
        busy = true;
        Sync.onChange && Sync.onChange(space);

        var u = url(), p = pin();
        var ops = Store.outboxPayload(space);
        var step = ops.length
          ? post(u, { space: space, pin: p, action: 'push', ops: ops })
              .then(function (res) { Store.outboxDone(space, res.applied || []); return res; })
          : Promise.resolve(null);

        return step.then(function () {
          return post(u, { space: space, pin: p, action: 'pull', since: Store.meta(space).since || 0 });
        }).then(function (res) {
          var n = Store.applyRows(space, res.rows || []);
          Store.setSince(space, res.now);
          S.lastError = '';
          busy = false;
          Sync.onChange && Sync.onChange(space);
          if (n) Sync.onData && Sync.onData(space, n);
          return { pulled: n };
        }).catch(function (e) {
          busy = false;
          S.lastError = e.message || String(e);
          Sync.onChange && Sync.onChange(space);
          if (force) throw e;
          return { error: S.lastError };
        });
      },

      /** つながるか確かめるだけ（設定で入れた直後に使う） */
      test: function (u, p) {
        return post(u.trim(), { space: space, pin: (p || '').trim(), action: 'ping' });
      }
    };
    return S;
  }

  var timer = null;
  var Sync = {
    of: {},

    init: function (store) {
      Store = store;
      Store.SPACES.forEach(function (sp) { Sync.of[sp] = make(sp); });
    },

    runAll: function () {
      Store.SPACES.forEach(function (sp) { Sync.of[sp].run(false); });
    },

    start: function () {
      if (timer) return;
      var sec = (global.APP && APP.autoSyncSec) || 60;
      timer = setInterval(Sync.runAll, sec * 1000);
      global.addEventListener('online', Sync.runAll);
      global.addEventListener('visibilitychange', function () { if (!document.hidden) Sync.runAll(); });
      Sync.runAll();
    }
  };

  global.TB = global.TB || {};
  global.TB.Sync = Sync;
})(window);
