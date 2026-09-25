/* Task Board 同期（Pair Board と同じ形を、側ごとに1つずつ）
   ・受け口は1つ（つなぎ先と合言葉も1組）。同期の係は側ごとに1つずつ動きます
   ・★毎回「どちら側か（space）」を添えて送ります。受け口はその側のタブだけを読み書きするので、
     プライベートと仕事は受け口の中でも混ざりません（gas/コード.gs）
   ・次に受け取る目印（since）は必ず受け口が返した now を使います。
     手元の時計はGoogleの時計とズレるので、自分の時計を使うと取りこぼします */
(function (global) {
  'use strict';

  var Store = null;

  function explain(obj) {
    if (obj.error === 'bad_pin') return '合言葉が違います';
    if (obj.error === 'locked') return '合言葉を何度もまちがえたので、10分止まっています';
    if (obj.error === 'bad_space') return 'どちら側かが分からないので断られました（アプリが古いかもしれません）';
    if (obj.error === 'not_setup') return '受け口の用意（setup）がまだです';
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

    var url = Sync.url, pin = Sync.pin, enabled = Sync.enabled;

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

    };
    return S;
  }

  var timer = null;
  var Sync = {
    of: {},

    /** 受け口は1つ。設定で入れた値が優先。無ければ公開のときに入れたもの（config.js） */
    url: function () {
      var c = Store.conn();
      return (c.url || (global.APP && APP.syncUrl) || '').trim();
    },
    pin: function () { return (Store.conn().pin || '').trim(); },
    enabled: function () { return !!Sync.url() && !!Sync.pin(); },

    /** つながるか確かめるだけ（設定で入れた直後に使う） */
    test: function (u, p) {
      return post(u.trim(), { pin: (p || '').trim(), action: 'ping' });
    },

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
