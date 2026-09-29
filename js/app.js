/* Task Board 全体の組み立て（個人と会社の切り替え・タスク・メモ・設定・別窓・知らせ） */
(function (global) {
  'use strict';
  var TB = global.TB = global.TB || {};
  var Store = TB.Store, Sync = TB.Sync;

  /* ---------- 小道具 ---------- */
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var U = TB.U = {
    pad: function (n) { return (n < 10 ? '0' : '') + n; },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    iso: function (d) { return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); },
    today: function () { return U.iso(new Date()); },
    addDays: function (n) { var d = new Date(); d.setDate(d.getDate() + n); return U.iso(d); },
    parse: function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); },
    /** 今日から何日先か（過ぎていれば負） */
    daysFrom: function (s) {
      var t = U.parse(U.today()), d = U.parse(s);
      return Math.round((d - t) / 86400000);
    },
    md: function (s) { var d = U.parse(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）'; },
    stamp: function (ms) {
      var d = new Date(ms);
      var s = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
      if (d.getFullYear() !== new Date().getFullYear()) s = d.getFullYear() + '/' + s;
      return s;
    }
  };

  /* ---------- 重要度（3段階）。印の無い前からのタスクは「中」として扱う ---------- */
  var PRIO = { high: { label: '高', rank: 0 }, mid: { label: '中', rank: 1 }, low: { label: '低', rank: 2 } };
  function prioOf(t) { return PRIO[t && t.prio] ? t.prio : 'mid'; }
  function prioBadge(t) {
    var p = prioOf(t);
    return '<span class="prio p-' + p + '">重要度 ' + PRIO[p].label + '</span>';
  }
  function prioSeg(id, cur) {
    return '<div class="seg3" id="' + id + '">' + ['high', 'mid', 'low'].map(function (p) {
      return '<button type="button" data-prio="' + p + '"' + (p === cur ? ' class="on"' : '') + '>' + PRIO[p].label + '</button>';
    }).join('') + '</div>';
  }

  /* ---------- 部署の残りの写し（Mac の 部署の残りを写す.py が入れる。会社の側だけ） ----------
     正本は会社の保管庫の部署のノート。ここは写しなので、済み・直す・消すはできない
     （やっても次の回に元に戻るため）。押すと全文を見るだけ */
  function isDev(t) { return t && (t.src === 'dev' || String(t.id || '').indexOf('dev-') === 0); }

  /** 期限の札。過ぎた・今日・明日を目立たせる */
  function dueBadge(due) {
    if (!due) return '';
    var n = U.daysFrom(due);
    if (n < 0) return '<span class="due over">' + (-n) + '日過ぎ</span>';
    if (n === 0) return '<span class="due now">今日まで</span>';
    if (n === 1) return '<span class="due soon">明日まで</span>';
    return '<span class="due">' + U.md(due) + 'まで</span>';
  }

  /* ---------- いまの入れ物 ---------- */
  function space() { return Store.ui().space; }
  function label(sp) { return APP.spaces[sp || space()].label; }

  /** ★会社のタスクに書かない決まり（金額・氏名・ID）に当たりそうな文字を見つける。
     止めはしない。「本当に書きますか」と一度だけ聞く */
  function looksSensitive(text) {
    return /[¥￥]\s*\d|\d[\d,，]*\s*(円|万円|万)|\d{6,}|\d{2,4}-\d{2,4}-\d{3,4}|@\w/.test(text);
  }
  function confirmWork(text) {
    if (space() !== 'work' || !looksSensitive(text)) return true;
    return global.confirm('金額・番号・IDのような文字が入っています。\n会社のタスクには書かない決まりです。\n\nこのまま残しますか？');
  }

  /* ---------- 別窓 ---------- */
  var modalWrap = null, modalEl = null;
  function modal(html, after) {
    modalEl.innerHTML = html;
    modalWrap.hidden = false;
    document.body.style.overflow = 'hidden';
    if (after) after(modalEl);
    modalEl.scrollTop = 0;
  }
  function closeModal() {
    modalWrap.hidden = true;
    modalEl.innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ---------- 知らせ（「もどす」を付けられる） ---------- */
  var toastTimer = null;
  function toast(msg, undo) {
    var t = document.getElementById('toast');
    t.innerHTML = U.esc(msg) + (undo ? ' <button type="button" class="undo">もどす</button>' : '');
    t.hidden = false;
    if (undo) t.querySelector('.undo').onclick = function () { t.hidden = true; undo(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, undo ? 4000 : 1900);
  }

  /* ---------- 同期の帯（いま開いている側の様子だけを出す） ---------- */
  function paintSync() {
    var el = document.getElementById('syncBar');
    var S = Sync.of[space()];
    var s = S.state();
    var text = { off: '端末の中だけ', busy: '同期中…', pending: '未送信 ' + s.pending + '件', error: '送れません', ok: '同期ずみ' }[s.kind];
    if (s.kind === 'ok' && s.at) {
      var d = new Date(s.at);
      text = '同期ずみ ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
    }
    el.className = 'syncbar ' + s.kind;
    el.textContent = text;
    el.title = s.kind === 'error' ? S.lastError
      : s.kind === 'off' ? '受け口につないでいません。書いたものはこの端末の中だけにあります' : '';
  }

  /** 何か直したら、すこし待ってから、その側の分だけ送る */
  var pushTimers = {};
  function schedulePush(sp) {
    paintSync();
    if (!Sync.enabled()) return;
    clearTimeout(pushTimers[sp]);
    pushTimers[sp] = setTimeout(function () { Sync.of[sp].run(false); }, 1200);
  }

  /* ---------- 見出しの数 ---------- */
  function paintCounts() {
    var open = Store.list(space(), 'task').filter(function (t) { return !t.done && !isDev(t); }).length;
    var memos = Store.list(space(), 'memo').length;
    document.getElementById('cntTask').textContent = open ? open : '';
    document.getElementById('cntMemo').textContent = memos ? memos : '';
  }

  /* ---------- 個人と会社の切り替え ---------- */
  function applySpace() {
    var sp = space();
    document.body.dataset.space = sp;
    document.querySelectorAll('.sp').forEach(function (b) {
      var on = b.dataset.space === sp;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', sp === 'work' ? '#4a3527' : '#2a2433');
    document.getElementById('taskInput').placeholder = label() + 'のタスクを足す';
    document.getElementById('memoInput').placeholder = label() + 'のメモを書く';
    var rule = sp === 'work'
      ? '会社のタスクには、金額・氏名・IDを書かない（例：「◯◯店の締めを確認」）'
      : '';
    ['taskRule', 'memoRule'].forEach(function (id) {
      var el = document.getElementById(id);
      el.textContent = rule; el.hidden = !rule;
    });
  }

  function switchSpace(sp) {
    if (sp === space()) return;
    Store.ui().space = sp;
    Store.saveUi();
    applySpace();
    renderAll();
    toast(label() + 'に切り替えました');
  }

  /* ---------- 画面切り替え ---------- */
  var view = 'task';
  var lastView = 'task';
  function show(v) {
    if (view !== 'set') lastView = view;
    view = v;
    if (v !== 'set') { Store.ui().view = v; Store.saveUi(); }
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    document.getElementById('setBtn').classList.toggle('on', v === 'set');
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'view-' + v); });
    renderAll();
    global.scrollTo(0, 0);
  }

  function renderAll() {
    paintSync();
    paintCounts();
    if (view === 'task') renderTasks();
    if (view === 'memo') renderMemos();
    if (view === 'set') renderSettings();
  }

  /* ================= タスク ================= */
  var showDone = false;

  function sortOpen(a, b) {
    // 期限のあるものが先（近い順）。同じ日の中と、期限の無いものの中は、重要度の高い順 → 新しい順
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    var r = PRIO[prioOf(a)].rank - PRIO[prioOf(b)].rank;
    if (r) return r;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function taskRow(t) {
    var sub = prioBadge(t) + dueBadge(t.due) + (t.note ? '<span class="hasnote">メモあり</span>' : '');
    return '<div class="trow' + (t.done ? ' done' : '') + '" data-id="' + U.esc(t.id) + '" data-prio="' + prioOf(t) + '">'
      + '<button type="button" class="ck" data-act="toggle" aria-label="' + (t.done ? '未完了にもどす' : '済みにする') + '">'
      + '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>'
      + '<button type="button" class="tbody" data-act="edit">'
      + '<span class="ttl">' + U.esc(t.title) + '</span>'
      + (sub ? '<span class="sub">' + sub + '</span>' : '')
      + '</button>'
      + '</div>';
  }

  var showDev = false;

  function devRow(t) {
    return '<div class="trow dev" data-id="' + U.esc(t.id) + '">'
      + '<span class="ck ro" aria-hidden="true"></span>'
      + '<button type="button" class="tbody" data-act="view">'
      + '<span class="ttl">' + U.esc(t.title) + '</span>'
      + '<span class="sub"><span class="busho">' + U.esc(t.busho || '') + '</span>' + prioBadge(t) + '</span>'
      + '</button></div>';
  }

  function renderDev(dev) {
    if (!dev.length) return '';
    var byOrder = function (a, b) { return (a.order || 0) - (b.order || 0); };
    var wait = dev.filter(function (t) { return t.section === 'ko-dai'; }).sort(byOrder);
    var rest = dev.filter(function (t) { return t.section !== 'ko-dai'; }).sort(byOrder);
    var h = '<div class="devhead">アプリ制作（部署の残り）<span>' + dev.length + '件</span></div>'
      + '<div class="devnote">会社の保管庫の部署のノートの写しです。ここでは済みにも直すこともできません（直すのは部署のノート）。</div>';
    if (wait.length) {
      h += '<div class="devsub">★ko-dai さんの返事待ち ' + wait.length + '件</div>'
        + '<div class="card list">' + wait.map(devRow).join('') + '</div>';
    }
    if (rest.length) {
      h += '<button type="button" class="donehead" data-act="showdev">' + (showDev ? '▾' : '▸') + ' 残っていること ' + rest.length + '件</button>';
      if (showDev) {
        var groups = [], at = {};
        rest.forEach(function (t) {
          var b = t.busho || '（部署なし）';
          if (!(b in at)) { at[b] = groups.length; groups.push({ name: b, items: [] }); }
          groups[at[b]].items.push(t);
        });
        groups.forEach(function (g) {
          h += '<div class="devgrp">' + U.esc(g.name) + '<span>' + g.items.length + '件</span></div>'
            + '<div class="card list">' + g.items.map(devRow).join('') + '</div>';
        });
      }
    }
    return h;
  }

  function viewDev(id) {
    var t = Store.get(space(), 'task', id);
    if (!t) return;
    modal('<h2>' + U.esc(t.title) + '</h2>'
      + '<div class="hint"><span class="busho">' + U.esc(t.busho || '') + '</span> ' + prioBadge(t) + '</div>'
      + '<div class="devbody">' + U.esc(t.note || '') + '</div>'
      + '<div class="acts"><button type="button" class="go" id="v-close">閉じる</button></div>',
      function (m) { m.querySelector('#v-close').onclick = closeModal; });
  }

  /* ---------- 今日の帯（日付と、残り・期限切れ・今日まで・重要度 高・返事待ちの数） ---------- */
  var STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><g fill="var(--gold2)">'
    + '<path d="M50 6 58 40 50 47 42 40Z"/><path d="M94 50 60 58 53 50 60 42Z"/>'
    + '<path d="M50 94 42 60 50 53 58 60Z"/><path d="M6 50 40 42 47 50 40 58Z"/></g></svg>';

  function renderToday(open, dev) {
    var d = new Date(), today = U.today();
    var over = open.filter(function (t) { return t.due && t.due < today; }).length;
    var now = open.filter(function (t) { return t.due === today; }).length;
    var high = open.filter(function (t) { return prioOf(t) === 'high'; }).length;
    var wait = dev.filter(function (t) { return t.section === 'ko-dai'; }).length;
    var f = [];
    f.push('<span class="fact calm">' + (open.length ? '残り <b>' + open.length + '</b>' : 'やることはありません') + '</span>');
    if (over) f.push('<span class="fact over">期限切れ <b>' + over + '</b></span>');
    if (now) f.push('<span class="fact now">今日まで <b>' + now + '</b></span>');
    if (high) f.push('<span class="fact high">重要度 高 <b>' + high + '</b></span>');
    if (wait) f.push('<span class="fact wait">返事待ち <b>' + wait + '</b></span>');
    document.getElementById('todayBand').innerHTML =
      '<div class="day"><b>' + d.getDate() + '</b><small>' + (d.getMonth() + 1) + '月・' + DOW[d.getDay()] + '</small></div>'
      + '<div class="facts">' + f.join('') + '</div>';
  }

  function renderTasks() {
    var all = Store.list(space(), 'task');
    var dev = space() === 'work' ? all.filter(isDev) : [];
    all = all.filter(function (t) { return !isDev(t); });
    var open = all.filter(function (t) { return !t.done; }).sort(sortOpen);
    var done = all.filter(function (t) { return t.done; })
      .sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });

    renderToday(open, dev);
    var h = '';
    if (open.length) {
      h += '<div class="card list">' + open.map(taskRow).join('') + '</div>';
    } else {
      h += '<div class="empty art">' + STAR
        + (done.length ? '<b>全部済みました</b>おつかれさまでした' : '<b>まだ何もありません</b>上に書いて足してください') + '</div>';
    }
    h += renderDev(dev);
    if (done.length) {
      h += '<button type="button" class="donehead" data-act="showdone">'
        + (showDone ? '▾' : '▸') + ' 済み ' + done.length + '件</button>';
      if (showDone) {
        var shown = done.slice(0, 50);
        h += '<div class="card list">' + shown.map(taskRow).join('') + '</div>';
        if (done.length > shown.length) h += '<div class="empty">ほか ' + (done.length - shown.length) + '件（古いもの）</div>';
      }
    }
    document.getElementById('taskList').innerHTML = h;
  }

  /* ---------- 足すときに決める重要度と期限 ---------- */
  var addPrio = 'mid', addDue = '';

  function quickDate(q) {
    if (q === '') return '';
    return U.addDays(q === 'we' ? weekendOffset() : Number(q));
  }

  function paintAddOpts() {
    document.querySelectorAll('#addPrio [data-prio]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.prio === addPrio);
    });
    var hit = false;
    document.querySelectorAll('#addDuePick [data-q]').forEach(function (b) {
      var on = !hit && quickDate(b.dataset.q) === addDue;
      if (on) hit = true;                 // 今日が土曜なら「今日」と「週末」が同じ日になる。先の方だけ光らせる
      b.classList.toggle('on', on);
    });
    document.getElementById('addDue').value = addDue;
  }

  function addTask(title) {
    title = title.trim();
    if (!title) return false;
    if (!confirmWork(title)) return false;
    Store.put(space(), 'task', { title: title, due: addDue, prio: addPrio, note: '', done: false });
    addPrio = 'mid'; addDue = '';        // 足したら元に戻す
    paintAddOpts();
    renderAll();
    return true;
  }

  function toggleTask(id) {
    var t = Store.get(space(), 'task', id);
    if (!t || isDev(t)) return;           // 写しは済みにしない
    var sp = space();
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : 0;
    Store.put(sp, 'task', t);
    renderAll();
    if (t.done) {
      toast('済みにしました', function () {
        var cur = Store.get(sp, 'task', id);
        if (!cur) return;
        cur.done = false; cur.doneAt = 0;
        Store.put(sp, 'task', cur);
        renderAll();
      });
    }
  }

  function editTask(id) {
    var sp = space();
    var t = Store.get(sp, 'task', id);
    if (!t) return;
    if (isDev(t)) { viewDev(id); return; } // 写しは直さない。見るだけ
    var quick = [['今日', 0], ['明日', 1], ['週末', weekendOffset()], ['1週間後', 7]];
    modal(
      '<h2>' + U.esc(label(sp)) + 'のタスク</h2>'
      + '<div class="f"><label for="e-title">やること</label><input type="text" id="e-title" value="' + U.esc(t.title) + '"></div>'
      + '<div class="f"><label>重要度</label>' + prioSeg('e-prio', prioOf(t)) + '</div>'
      + '<div class="f"><label for="e-due">期限</label>'
      + '<div class="f2"><input type="date" id="e-due" value="' + U.esc(t.due || '') + '">'
      + '<button type="button" class="mini" data-due="">なし</button></div>'
      + '<div class="quick">' + quick.map(function (q) {
          return '<button type="button" class="chip" data-due="' + U.addDays(q[1]) + '">' + q[0] + '</button>';
        }).join('') + '</div></div>'
      + '<div class="f"><label for="e-note">メモ</label><textarea id="e-note" rows="3">' + U.esc(t.note || '') + '</textarea></div>'
      + '<div class="hint">足した日：' + U.esc(U.stamp(t.createdAt || t.updatedAt))
      + (t.done && t.doneAt ? '　済んだ日：' + U.esc(U.stamp(t.doneAt)) : '') + '</div>'
      + '<div class="acts">'
      + '<button type="button" class="del" id="e-del">消す</button>'
      + '<button type="button" id="e-cancel">やめる</button>'
      + '<button type="button" class="go" id="e-ok">直す</button>'
      + '</div>',
      function (m) {
        var due = m.querySelector('#e-due');
        var prio = prioOf(t);
        m.querySelectorAll('#e-prio [data-prio]').forEach(function (b) {
          b.onclick = function () {
            prio = b.dataset.prio;
            m.querySelectorAll('#e-prio [data-prio]').forEach(function (x) { x.classList.toggle('on', x === b); });
          };
        });
        m.querySelectorAll('[data-due]').forEach(function (b) {
          b.onclick = function () { due.value = b.dataset.due; };
        });
        m.querySelector('#e-cancel').onclick = closeModal;
        m.querySelector('#e-del').onclick = function () {
          Store.remove(sp, 'task', id);
          closeModal(); renderAll();
          toast('消しました', function () {
            var cur = Store.get(sp, 'task', id);
            if (!cur) return;
            delete cur.deleted;
            Store.put(sp, 'task', cur);
            renderAll();
          });
        };
        m.querySelector('#e-ok').onclick = function () {
          var title = m.querySelector('#e-title').value.trim();
          var note = m.querySelector('#e-note').value.trim();
          if (!title) { toast('やることが空です'); return; }
          if (!confirmWork(title + '\n' + note)) return;
          t.title = title; t.due = due.value || ''; t.note = note; t.prio = prio;
          Store.put(sp, 'task', t);
          closeModal(); renderAll();
        };
      }
    );
  }

  /** 次の土曜日まで何日か（今日が土日なら今日） */
  function weekendOffset() {
    var d = new Date().getDay();
    return d === 6 || d === 0 ? 0 : 6 - d;
  }

  /* ================= メモ ================= */
  function renderMemos() {
    var list = Store.list(space(), 'memo')
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var h = list.length
      ? list.map(function (m) {
          return '<button type="button" class="card memo" data-id="' + U.esc(m.id) + '">'
            + '<span class="mtext">' + U.esc(m.text) + '</span>'
            + '<span class="mtime">' + U.esc(U.stamp(m.updatedAt)) + '</span>'
            + '</button>';
        }).join('')
      : '<div class="empty">まだメモはありません</div>';
    document.getElementById('memoList').innerHTML = h;
  }

  function addMemo(text) {
    text = text.trim();
    if (!text) return false;
    if (!confirmWork(text)) return false;
    Store.put(space(), 'memo', { text: text });
    renderAll();
    return true;
  }

  function editMemo(id) {
    var sp = space();
    var memo = Store.get(sp, 'memo', id);
    if (!memo) return;
    modal(
      '<h2>' + U.esc(label(sp)) + 'のメモ</h2>'
      + '<div class="f"><textarea id="m-text" rows="8" maxlength="10000">' + U.esc(memo.text) + '</textarea></div>'
      + '<div class="hint">書いた日：' + U.esc(U.stamp(memo.createdAt || memo.updatedAt)) + '</div>'
      + '<div class="acts">'
      + '<button type="button" class="del" id="m-del">消す</button>'
      + '<button type="button" id="m-task">タスクにする</button>'
      + '<button type="button" class="go" id="m-ok">直す</button>'
      + '</div>',
      function (m) {
        m.querySelector('#m-del').onclick = function () {
          Store.remove(sp, 'memo', id);
          closeModal(); renderAll();
          toast('消しました', function () {
            var cur = Store.get(sp, 'memo', id);
            if (!cur) return;
            delete cur.deleted;
            Store.put(sp, 'memo', cur);
            renderAll();
          });
        };
        m.querySelector('#m-task').onclick = function () {
          // 1行目をやることに、残りをタスクのメモに。★同じ入れ物（個人なら個人）の中だけで動かす
          var text = m.querySelector('#m-text').value.trim();
          if (!text) return;
          var lines = text.split('\n');
          Store.put(sp, 'task', { title: lines[0].trim(), due: '', prio: 'mid', note: lines.slice(1).join('\n').trim(), done: false });
          Store.remove(sp, 'memo', id);
          closeModal();
          show('task');
          toast('タスクにしました');
        };
        m.querySelector('#m-ok').onclick = function () {
          var text = m.querySelector('#m-text').value.trim();
          if (!text) { toast('中身が空です'); return; }
          if (!confirmWork(text)) return;
          memo.text = text;
          Store.put(sp, 'memo', memo);
          closeModal(); renderAll();
        };
      }
    );
  }

  /* ================= 設定 ================= */
  function renderSettings() {
    var h = '';
    var c = Store.conn();
    var pending = 0, errs = [];
    Store.SPACES.forEach(function (sp) {
      pending += Store.outboxCount(sp);
      if (Sync.of[sp].lastError) errs.push(label(sp) + '：' + Sync.of[sp].lastError);
    });
    h += '<div class="secttl">受け口</div><div class="card">'
      + '<div class="setrow"><div><div class="k">つなぎ先と合言葉</div><div class="d">'
      + (Sync.enabled() ? 'つないでいます' + (c.url ? '' : '（アプリに入っているつなぎ先）')
          : (Sync.url() ? '合言葉がまだです' : 'つないでいません（いまは端末の中だけ）'))
      + '</div></div>'
      + '<button type="button" class="mini" id="s-conn">' + (Sync.enabled() ? '直す' : 'つなぐ') + '</button></div>'
      + '<div class="setrow"><div><div class="k">送っていない記録</div><div class="d">電波がない間に書いたものはここに溜まります（個人と会社の合計）</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center"><b style="white-space:nowrap">' + pending + '件</b>'
      + '<button type="button" class="mini" id="s-sync">今すぐ同期</button></div></div>'
      + (errs.length ? '<div class="warnbox">前回うまくいきませんでした：<br>' + errs.map(U.esc).join('<br>') + '</div>' : '')
      + '<div class="note" style="margin-top:6px">受け口は1つです。個人と会社は、受け口のシートの中で別々のタブに入ります。</div>'
      + '</div>';

    h += '<div class="secttl">いまの数</div><div class="card">';
    Store.SPACES.forEach(function (sp) {
      var all = Store.list(sp, 'task');
      var devN = all.filter(isDev).length;
      var tasks = all.filter(function (t) { return !isDev(t); });
      var open = tasks.filter(function (t) { return !t.done; }).length;
      var ss = Sync.of[sp].state();
      h += '<div class="setrow"><div><div class="k">' + U.esc(label(sp)) + '</div>'
        + '<div class="d">タスク ' + open + '件（済み ' + (tasks.length - open) + '件）・メモ ' + Store.list(sp, 'memo').length + '件'
        + (devN ? '・部署の残りの写し ' + devN + '件' : '')
        + '・' + (ss.kind === 'off' ? '端末の中だけ' : ss.kind === 'error' ? '送れていません' : ss.pending ? '未送信 ' + ss.pending + '件' : '同期ずみ')
        + '</div></div></div>';
    });
    h += '</div>';

    h += '<div class="secttl">控え（いま開いている「' + U.esc(label()) + '」の分だけ）</div><div class="card">'
      + '<div class="setrow"><div><div class="k">控えを書き出す</div><div class="d">タスクとメモを1つの文字にします</div></div>'
      + '<button type="button" class="mini" id="s-out">書き出す</button></div>'
      + '<div class="setrow"><div><div class="k">控えから戻す</div><div class="d">書き出した文字を貼って戻します</div></div>'
      + '<button type="button" class="mini" id="s-in">戻す</button></div>'
      + '<div class="setrow"><div><div class="k">この端末から消す</div><div class="d">「' + U.esc(label()) + '」のタスクとメモを、この端末から消します。'
      + (Sync.enabled() ? '受け口の記録は残るので、次の同期で戻ります' : '戻せません') + '</div></div>'
      + '<button type="button" class="mini danger" id="s-wipe">消す</button></div>'
      + '<div class="note" style="margin-top:6px">個人と会社の控えは、混ざらないように別々の1枚にしてあります。</div>'
      + '</div>';

    h += '<div class="secttl">このアプリ</div><div class="card">'
      + '<div class="setrow"><div><div class="k">版</div><div class="d">' + U.esc(APP.version) + '</div></div>'
      + '<button type="button" class="mini" id="s-back">もどる</button></div>'
      + '</div>';

    var body = document.getElementById('setBody');
    body.innerHTML = h;

    body.querySelector('#s-back').onclick = function () { show(lastView); };
    body.querySelector('#s-conn').onclick = connect;
    body.querySelector('#s-sync').onclick = function () {
      if (!Sync.enabled()) { connect(); return; }
      toast('同期しています…');
      Promise.all(Store.SPACES.map(function (sp) { return Sync.of[sp].run(true); }))
        .then(function () { toast('同期しました'); renderAll(); })
        .catch(function (e) { global.alert('うまくいきませんでした：\n' + e.message); renderAll(); });
    };
    body.querySelector('#s-out').onclick = function () {
      var text = Store.exportSpace(space());
      modal('<h2>' + U.esc(label()) + 'の控え</h2>'
        + '<div class="hint">全部選んでコピーし、メモなどに貼って残してください。</div>'
        + '<div class="f"><textarea id="o-text" readonly style="min-height:200px;font-size:11px">' + U.esc(text) + '</textarea></div>'
        + '<div class="acts"><button type="button" id="o-close">閉じる</button><button type="button" class="go" id="o-copy">コピー</button></div>',
        function (m) {
          m.querySelector('#o-close').onclick = closeModal;
          m.querySelector('#o-copy').onclick = function () {
            var ta = m.querySelector('#o-text');
            ta.select();
            (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
              .then(function () { toast('コピーしました'); })
              .catch(function () { try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('選んでコピーしてください'); } });
          };
        });
    };
    body.querySelector('#s-in').onclick = function () {
      modal('<h2>「' + U.esc(label()) + '」に控えから戻す</h2>'
        + '<div class="hint">書き出した文字を貼ってください。新しいほうが残ります。</div>'
        + '<div class="f"><textarea id="i-text" style="min-height:200px;font-size:11px"></textarea></div>'
        + '<div class="acts"><button type="button" id="i-close">やめる</button><button type="button" class="go" id="i-ok">戻す</button></div>',
        function (m) {
          m.querySelector('#i-close').onclick = closeModal;
          m.querySelector('#i-ok').onclick = function () {
            try {
              Store.importSpace(space(), m.querySelector('#i-text').value);
              closeModal(); renderAll(); toast('戻しました');
            } catch (e) { toast(e.message || '戻せませんでした'); }
          };
        });
    };
    body.querySelector('#s-wipe').onclick = function () {
      var sp = space();
      if (Store.outboxCount(sp) && !global.confirm('まだ受け口に送っていない記録が ' + Store.outboxCount(sp) + '件あります。\n消すと、それは戻せません。')) return;
      if (!global.confirm('「' + label() + '」のタスクとメモを、この端末から全部消します。よろしいですか？')) return;
      Store.wipe(sp);
      renderAll(); toast('消しました');
      schedulePush(sp);
    };
  }

  /* ---------- 受け口につなぐ（つなぎ先と合言葉を入れる。受け口は1つ） ---------- */
  function connect() {
    var c = Store.conn();
    modal('<h2>受け口につなぐ</h2>'
      + '<div class="f"><label for="c-url">つなぎ先（…/exec で終わるURL）</label>'
      + '<input type="text" id="c-url" value="' + U.esc(c.url || Sync.url()) + '" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></div>'
      + '<div class="f"><label for="c-pin">合言葉（PIN）</label>'
      + '<input type="text" id="c-pin" value="' + U.esc(c.pin) + '" autocapitalize="off" autocorrect="off" spellcheck="false"></div>'
      + '<div class="hint">つないだあと、この端末の中のもの（個人も会社も）を受け口へ送ります。</div>'
      + '<div class="acts">'
      + (Sync.enabled() ? '<button type="button" class="del" id="c-off">つなぐのをやめる</button>' : '')
      + '<button type="button" id="c-cancel">やめる</button>'
      + '<button type="button" class="go" id="c-ok">つなぐ</button></div>',
      function (root) {
        root.querySelector('#c-cancel').onclick = closeModal;
        var off = root.querySelector('#c-off');
        if (off) off.onclick = function () {
          if (!global.confirm('受け口とのつながりを切ります（受け口の記録は消えません）')) return;
          c.pin = ''; Store.saveConn();
          Store.SPACES.forEach(function (sp) { Sync.of[sp].lastError = ''; });
          closeModal(); renderAll(); toast('つなぐのをやめました');
        };
        root.querySelector('#c-ok').onclick = function () {
          var u = root.querySelector('#c-url').value.trim();
          var p = root.querySelector('#c-pin').value.trim();
          if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { global.alert('つなぎ先は https://script.google.com/…/exec の形です'); return; }
          if (!p) { global.alert('合言葉を入れてください'); return; }
          var btn = this; btn.disabled = true; btn.textContent = 'たしかめています…';
          Sync.test(u, p).then(function () {
            c.url = (u === (APP.syncUrl || '')) ? '' : u;
            c.pin = p;
            Store.saveConn();
            Store.resetSince();          // つなぎ直したら最初から取り込む
            Store.SPACES.forEach(function (sp) { Sync.of[sp].lastError = ''; });
            closeModal();
            toast('つながりました。送っています…');
            return Promise.all(Store.SPACES.map(function (sp) { return Sync.of[sp].run(true); }));
          }).then(function () {
            Sync.start();
            renderAll(); toast('受け口とつながりました');
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = 'つなぐ';
            global.alert('つながりませんでした：\n' + e.message);
            renderAll();
          });
        };
      });
  }

  /* ================= 組み立て ================= */
  function init() {
    Store.init();
    Store.onQuotaError = function () { toast('端末の空きがなくて残せませんでした'); };
    Store.onWrite = schedulePush;
    Sync.init(Store);
    Sync.onChange = function (sp) {
      if (sp === space()) paintSync();
      if (view === 'set') renderSettings();
    };
    Sync.onData = function (sp) { if (sp === space()) renderAll(); };
    modalWrap = document.getElementById('modalWrap');
    modalEl = document.getElementById('modal');

    modalWrap.addEventListener('click', function (e) { if (e.target === modalWrap) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modalWrap.hidden) closeModal(); });

    document.getElementById('spaceSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('.sp');
      if (b) switchSpace(b.dataset.space);
    });
    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) show(b.dataset.view);
    });
    document.getElementById('setBtn').onclick = function () { show(view === 'set' ? lastView : 'set'); };

    document.getElementById('addPrio').addEventListener('click', function (e) {
      var b = e.target.closest('[data-prio]');
      if (b) { addPrio = b.dataset.prio; paintAddOpts(); }
    });
    document.getElementById('addDuePick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (b) { addDue = quickDate(b.dataset.q); paintAddOpts(); }
    });
    document.getElementById('addDue').addEventListener('change', function (e) {
      addDue = e.target.value || ''; paintAddOpts();
    });
    var taskInput = document.getElementById('taskInput');
    document.getElementById('taskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addTask(taskInput.value)) { taskInput.value = ''; taskInput.focus(); }
    });
    document.getElementById('taskList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'showdone') { showDone = !showDone; renderTasks(); return; }
      if (b.dataset.act === 'showdev') { showDev = !showDev; renderTasks(); return; }
      var row = b.closest('.trow');
      if (!row) return;
      if (b.dataset.act === 'view') { viewDev(row.dataset.id); return; }
      if (b.dataset.act === 'toggle') {
        // 済みにするときだけ、金の丸と光を見せてから入れ替える（戻すときはすぐ）
        var cur = Store.get(space(), 'task', row.dataset.id);
        if (cur && !cur.done && !isDev(cur) && !b.classList.contains('pop')) {
          b.classList.add('pop');
          setTimeout(function () { toggleTask(row.dataset.id); }, 380);
        } else if (!b.classList.contains('pop')) {
          toggleTask(row.dataset.id);
        }
      }
      if (b.dataset.act === 'edit') editTask(row.dataset.id);
    });

    var memoInput = document.getElementById('memoInput');
    document.getElementById('memoForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addMemo(memoInput.value)) memoInput.value = '';
    });
    memoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (addMemo(memoInput.value)) memoInput.value = '';
      }
    });
    document.getElementById('memoList').addEventListener('click', function (e) {
      var c = e.target.closest('.memo');
      if (c) editMemo(c.dataset.id);
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    applySpace();
    show(Store.ui().view);
    Sync.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
