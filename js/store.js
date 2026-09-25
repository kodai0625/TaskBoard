/* Task Board データの入れ物
   ・すべて端末の localStorage に持ちます（電波がなくても書けます）
   ・★個人と会社は、入れ物も送信箱も別々です。キーの名前から分けてあります
       tb.personal.data … 個人のタスクとメモ
       tb.work.data     … 会社のタスクとメモ
     1つの入れ物に「どちらか」の印を付ける形にはしません。印を付け忘れた1件が、
     反対側のタブ（保管庫）に入る事故を、形の上で起こせなくするためです（設計.md）
   ・受け口は1つ（2026-09-26 決定。個人の Google アカウントに1つ）。つなぎ先と合言葉は1組だけ
       tb.conn … { url, pin }
   ・同期の目印は側ごとに別のキーです（受け口の中でも側ごとに別のタブに入ります）
       tb.personal.meta／tb.work.meta … { since, lastSyncAt }
   ・送信箱（outbox）に積んだものを、js/sync.js が「その側」の印を付けて送ります */
(function (global) {
  'use strict';

  var SPACES = ['personal', 'work'];
  var KINDS = ['task', 'memo'];
  var KEY_UI = 'tb.ui';

  var bags = {};      // { personal: {task:{}, memo:{}, outbox:[]}, work: {...} }
  var metas = {};     // { personal: {since, lastSyncAt}, work: {...} }
  var conn = null;    // { url, pin } 受け口は1つ
  var KEY_CONN = 'tb.conn';
  var ui = null;      // { space, view }

  function key(space) { return 'tb.' + space + '.data'; }
  function metaKey(space) { return 'tb.' + space + '.meta'; }
  function emptyMeta() { return { since: 0, lastSyncAt: 0 }; }

  function empty() { return { task: {}, memo: {}, outbox: [] }; }

  function read(k, fallback) {
    try {
      var s = localStorage.getItem(k);
      if (!s) return fallback;
      var v = JSON.parse(s);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }

  function write(k, value) {
    try { localStorage.setItem(k, JSON.stringify(value)); return true; }
    catch (e) { Store.onQuotaError && Store.onQuotaError(e); return false; }
  }

  function check(space) {
    if (SPACES.indexOf(space) < 0) throw new Error('知らない入れ物です: ' + space);
  }

  function load() {
    SPACES.forEach(function (sp) {
      var b = read(key(sp), null) || empty();
      KINDS.forEach(function (k) { if (!b[k]) b[k] = {}; });
      if (!Array.isArray(b.outbox)) b.outbox = [];
      bags[sp] = b;
      var m = read(metaKey(sp), null) || emptyMeta();
      var def = emptyMeta();
      Object.keys(def).forEach(function (k) { if (!(k in m)) m[k] = def[k]; });
      metas[sp] = m;
    });
    conn = read(KEY_CONN, null);
    if (!conn) {
      // 2026-09-26 より前は側ごとに持っていた。個人の側に入っていたものを引き継ぐ
      var old = metas.personal;
      conn = { url: old.url || '', pin: old.pin || '' };
    }
    SPACES.forEach(function (sp) { delete metas[sp].url; delete metas[sp].pin; });
    ui = read(KEY_UI, null) || {};
    if (SPACES.indexOf(ui.space) < 0) ui.space = 'personal';
    if (['task', 'memo'].indexOf(ui.view) < 0) ui.view = 'task';
  }

  function save(space) { write(key(space), bags[space]); }

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function queue(space, kind, id) {
    var ob = bags[space].outbox;
    for (var i = 0; i < ob.length; i++) {
      if (ob[i].kind === kind && ob[i].id === id) return;
    }
    ob.push({ kind: kind, id: id });
  }

  var Store = {
    SPACES: SPACES,
    KINDS: KINDS,

    init: function () { load(); },

    ui: function () { return ui; },
    saveUi: function () { write(KEY_UI, ui); },

    /** 一覧（消したものは除く） */
    list: function (space, kind) {
      check(space);
      var m = bags[space][kind] || {};
      return Object.keys(m).map(function (id) { return m[id]; })
        .filter(function (r) { return !r.deleted; });
    },

    get: function (space, kind, id) {
      check(space);
      return (bags[space][kind] || {})[id] || null;
    },

    /** 足す・直す。id がなければ新しく作る */
    put: function (space, kind, rec) {
      check(space);
      var now = Date.now();
      if (!rec.id) { rec.id = newId(); rec.createdAt = now; }
      rec.updatedAt = now;
      bags[space][kind][rec.id] = rec;
      queue(space, kind, rec.id);
      save(space);
      Store.onWrite && Store.onWrite(space);
      return rec;
    },

    /** 消す（記録は残して deleted の印を付ける。受け口に「消した」を伝えるため） */
    remove: function (space, kind, id) {
      check(space);
      var rec = bags[space][kind][id];
      if (!rec) return;
      rec.deleted = true;
      rec.updatedAt = Date.now();
      queue(space, kind, id);
      save(space);
      Store.onWrite && Store.onWrite(space);
    },

    outboxCount: function (space) { check(space); return bags[space].outbox.length; },

    /* ---------------- 同期の受け口（js/sync.js から使う） ---------------- */

    conn: function () { return conn; },
    saveConn: function () { write(KEY_CONN, conn); },

    /** つなぎ直したときは、両方の側を最初から取り込み直す */
    resetSince: function () {
      SPACES.forEach(function (sp) { metas[sp].since = 0; write(metaKey(sp), metas[sp]); });
    },

    meta: function (space) { check(space); return metas[space]; },
    saveMeta: function (space) { check(space); write(metaKey(space), metas[space]); },

    /** 送る分の中身を取り出す */
    outboxPayload: function (space) {
      check(space);
      var b = bags[space], ops = [];
      b.outbox.forEach(function (o) {
        var rec = (b[o.kind] || {})[o.id];
        if (rec) ops.push({ kind: o.kind, id: o.id, rec: rec });
      });
      return ops;
    },

    /** 送れた分を送信箱から外す。送ったあとに直したものは残す */
    outboxDone: function (space, sent) {
      check(space);
      var b = bags[space], map = {};
      sent.forEach(function (x) { map[x.kind + '/' + x.id] = x.updatedAt; });
      b.outbox = b.outbox.filter(function (o) {
        var k = o.kind + '/' + o.id;
        if (!(k in map)) return true;
        var rec = (b[o.kind] || {})[o.id];
        return !!(rec && rec.updatedAt > map[k]);
      });
      save(space);
    },

    /** 受け口から来た分を取り込む。送信箱に残っている id は手元を優先する */
    applyRows: function (space, rows) {
      check(space);
      var b = bags[space], pending = {}, changed = 0;
      b.outbox.forEach(function (o) { pending[o.kind + '/' + o.id] = true; });
      rows.forEach(function (row) {
        if (KINDS.indexOf(row.kind) < 0) return;
        if (pending[row.kind + '/' + row.id]) return;
        var rec;
        try { rec = JSON.parse(row.json); } catch (e) { return; }
        rec.id = row.id;
        rec.updatedAt = Number(rec.updatedAt) || Number(row.updatedAt) || Date.now();
        if (row.deleted) rec.deleted = true;
        b[row.kind][row.id] = rec;
        changed++;
      });
      if (changed) save(space);
      return changed;
    },

    setSince: function (space, now) {
      check(space);
      metas[space].since = now;
      metas[space].lastSyncAt = Date.now();
      write(metaKey(space), metas[space]);
    },

    /* ---------------- 持ち出し・持ち込み ----------------
       ★控えも個人と会社で別の1枚にします。混ぜた1枚を作らない */

    exportSpace: function (space) {
      check(space);
      var b = bags[space];
      return JSON.stringify({
        app: 'Task Board', space: space,
        version: (global.APP && APP.version) || '',
        exportedAt: new Date().toISOString(),
        data: { task: b.task, memo: b.memo }
      }, null, 1);
    },

    importSpace: function (space, text) {
      check(space);
      var obj = JSON.parse(text);
      if (!obj || !obj.data) throw new Error('中身が読めません');
      if (obj.space && obj.space !== space) {
        throw new Error('これは「' + (APP.spaces[obj.space] || {}).label + '」の控えです。いまの画面には戻せません');
      }
      var b = bags[space];
      KINDS.forEach(function (k) {
        var m = obj.data[k] || {};
        Object.keys(m).forEach(function (id) {
          var rec = m[id];
          rec.id = id;
          var cur = b[k][id];
          if (!cur || (rec.updatedAt || 0) >= (cur.updatedAt || 0)) {
            b[k][id] = rec;
            queue(space, k, id);
          }
        });
      });
      save(space);
      Store.onWrite && Store.onWrite(space);
    },

    /** この端末の中身だけ消す。つなぎ先と合言葉は残し、次の同期で受け口から全部取り直す */
    wipe: function (space) {
      check(space);
      bags[space] = empty();
      save(space);
      metas[space].since = 0;
      write(metaKey(space), metas[space]);
    }
  };

  global.TB = global.TB || {};
  global.TB.Store = Store;
})(window);
