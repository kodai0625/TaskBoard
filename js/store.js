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
   ・送信箱（outbox）に積んだものを、js/sync.js が「その側」の印を付けて送ります
   ・★自作アプリの一覧（個人の側だけ・ロックつき）は、別の入れ物です（2026-10-11 ko-dai さん「どこにも記録を残さない」）
       tb.apps … この端末の中だけ。★送信箱に積まない・受け口から受け取らない・控えにも入れない
     中身は暗号（js/lock.js）なので、ここでは読めません。
     同じ日の最初の版だけ、memo の入れ物に入れて受け口へ送っていました（印は src:'app' と、app- で始まる id）。
     その印の付いたものは、いまも「メモではない」として、一覧・受け取り・控えから外します
   ・★買い出しリスト（2026-10-13）は、memo の入れ物に同居しています。受け口の GAS が task と memo しか
     受けないためです（貼り直しを増やさない）。印は src:'buy' と、buy- で始まる id。
     ここでは 'buy' という種類として出し入れし、メモの一覧（list(…,'memo')）には出しません。
     こちらは自作アプリと違って、ふつうに同期します（送信箱に積む・受け取る・控えにも入る） */
(function (global) {
  'use strict';

  var SPACES = ['personal', 'work'];
  var KINDS = ['task', 'memo'];
  var APP_SPACE = 'personal', APP_PREFIX = 'app-', KEY_APPS = 'tb.apps';
  var BUY_PREFIX = 'buy-';
  var KEY_UI = 'tb.ui';

  var bags = {};      // { personal: {task:{}, memo:{}, outbox:[]}, work: {...} }
  var metas = {};     // { personal: {since, lastSyncAt}, work: {...} }
  var conn = null;    // { url, pin } 受け口は1つ
  var apps = {};      // 自作アプリの一覧（暗号）。この端末の中だけ
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
    loadApps();
    conn = read(KEY_CONN, null);
    if (!conn) {
      // 2026-09-26 より前は側ごとに持っていた。個人の側に入っていたものを引き継ぐ
      var old = metas.personal;
      conn = { url: old.url || '', pin: old.pin || '' };
    }
    SPACES.forEach(function (sp) { delete metas[sp].url; delete metas[sp].pin; });
    ui = read(KEY_UI, null) || {};
    if (SPACES.indexOf(ui.space) < 0) ui.space = 'personal';
    if (['task', 'plan', 'memo', 'buy'].indexOf(ui.view) < 0) ui.view = 'task';
  }

  function save(space) { write(key(space), bags[space]); }

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* 自作アプリの一覧の印（最初の版が memo の入れ物に入れたもの。いまは tb.apps に置く） */
  function isApp(r) { return !!r && (r.src === 'app' || String(r.id || '').indexOf(APP_PREFIX) === 0); }
  /* 買い出しリストは memo の入れ物に同居している（上の説明）。'buy' と言われたら memo の入れ物を見る */
  function isBuy(r) { return !!r && (r.src === 'buy' || String(r.id || '').indexOf(BUY_PREFIX) === 0); }
  function bagOf(kind) { return kind === 'buy' ? 'memo' : kind; }

  function checkApp(space) {
    if (space !== APP_SPACE) throw new Error('自作アプリの一覧は個人の側だけです');
  }

  function loadApps() {
    apps = read(KEY_APPS, null) || {};
    /* 最初の版（memo の入れ物に入れて、受け口へも送っていた）から引っ越す。
       ・中身はこの端末の中（tb.apps）へ移す
       ・受け口へ送ったことのある端末では、同じ id を「消した」印だけにして送る
         （シートの行を上書きして、暗号の中身を残さないため）。一度も同期していなければ、送らずに捨てる */
    var b = bags[APP_SPACE], synced = !!metas[APP_SPACE].lastSyncAt, moved = 0;
    Object.keys(b.memo).forEach(function (id) {
      var r = b.memo[id];
      if (!isApp(r) || r.deleted) return;
      if (!apps[id]) { apps[id] = r; delete r.src; }
      if (synced) {
        b.memo[id] = { id: id, src: 'app', deleted: true, createdAt: r.createdAt, updatedAt: Date.now() };
        queue(APP_SPACE, 'memo', id);
      } else {
        delete b.memo[id];
        b.outbox = b.outbox.filter(function (o) { return !(o.kind === 'memo' && o.id === id); });
      }
      moved++;
    });
    // ★先にこちらを書く（途中で止まっても、中身がどちらにも無い状態にしない）
    if (moved && write(KEY_APPS, apps)) save(APP_SPACE);
  }

  function queue(space, kind, id) {
    var ob = bags[space].outbox;
    for (var i = 0; i < ob.length; i++) {
      if (ob[i].kind === kind && ob[i].id === id) return;
    }
    ob.push({ kind: kind, id: id });
  }

  /** 控えに入れるメモ（自作アプリの印の付いたものを除く） */
  function plainMemos(m) {
    var out = {};
    Object.keys(m).forEach(function (id) { if (!isApp(m[id])) out[id] = m[id]; });
    return out;
  }

  var Store = {
    SPACES: SPACES,
    KINDS: KINDS,

    init: function () { load(); },

    ui: function () { return ui; },
    saveUi: function () { write(KEY_UI, ui); },

    /** 一覧（消したものは除く）。'app' は自作アプリの一覧（この端末の中だけ）。
        'memo' には買い出しの分を出さず、'buy' にはその分だけを出す */
    list: function (space, kind) {
      check(space);
      if (kind === 'app') { checkApp(space); return Object.keys(apps).map(function (id) { return apps[id]; }); }
      var m = bags[space][bagOf(kind)] || {};
      return Object.keys(m).map(function (id) { return m[id]; })
        .filter(function (r) { return !r.deleted && !isApp(r) && isBuy(r) === (kind === 'buy'); });
    },

    get: function (space, kind, id) {
      check(space);
      if (kind === 'app') { checkApp(space); return apps[id] || null; }
      return (bags[space][bagOf(kind)] || {})[id] || null;
    },

    /** 足す・直す。id がなければ新しく作る */
    put: function (space, kind, rec) {
      check(space);
      var now = Date.now();
      if (kind === 'app') { checkApp(space); Store.putApps([rec]); return rec; }
      if (kind === 'buy') rec.src = 'buy';
      if (!rec.id) { rec.id = (kind === 'buy' ? BUY_PREFIX : '') + newId(); rec.createdAt = now; }
      rec.updatedAt = now;
      bags[space][bagOf(kind)][rec.id] = rec;
      queue(space, bagOf(kind), rec.id);
      save(space);
      Store.onWrite && Store.onWrite(space);
      return rec;
    },

    /** 自作アプリの分を、何件かまとめて書く。★送信箱に積まない（受け口へ送らない）。この端末の中に書くだけ。
        1回で書くので、途中で止まって半分だけ書かれることがない。書けなかったら元に戻して知らせる */
    putApps: function (recs) {
      var now = Date.now(), before = JSON.stringify(apps);
      recs.forEach(function (rec) {
        if (!rec.id) { rec.id = APP_PREFIX + newId(); rec.createdAt = now; }
        rec.updatedAt = now;
        apps[rec.id] = rec;
      });
      if (!write(KEY_APPS, apps)) {
        apps = JSON.parse(before);
        throw new Error('端末の空きがなくて残せませんでした');
      }
    },

    /** 消す（記録は残して deleted の印を付ける。受け口に「消した」を伝えるため） */
    remove: function (space, kind, id) {
      check(space);
      if (kind === 'app') {            // どこにも送っていないので、印を残さずにそのまま消す
        checkApp(space);
        delete apps[id];
        write(KEY_APPS, apps);
        return;
      }
      var rec = bags[space][bagOf(kind)][id];
      if (!rec) return;
      rec.deleted = true;
      rec.updatedAt = Date.now();
      queue(space, bagOf(kind), id);
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
        if (isApp(rec)) return;        // 自作アプリの分（古い版が送ったもの）は受け取らない
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
        data: { task: b.task, memo: plainMemos(b.memo) }
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
          if (isApp(rec)) return;      // 古い控えに自作アプリの分が入っていても、戻さない
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

    /** この端末の中身だけ消す。つなぎ先と合言葉は残し、次の同期で受け口から全部取り直す。
        ★自作アプリの一覧（tb.apps）は消さない。受け口に無いので、消すと取り直せないため */
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
