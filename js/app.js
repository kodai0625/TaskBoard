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

  /* ---------- 習慣（くり返すタスク）と時刻（2026-09-29） ----------
     習慣は「repeat の付いた task」として持つ（受け口の GAS は task と memo しか受けないので、貼り直し不要）。
       repeat: 'daily'（毎日）| 'weekly'（毎週）| 'monthly'（毎月。2026-09-29〜）
       days: [0..6]（毎週のときの曜日。0=日）
       mday: 1〜31 か 'last'（毎月のときの日付。その月に無い日は、その月の最後の日にする）
       doneDates: {'YYYY-MM-DD': 済んだ時刻}（日ごとの済み。120日より前は捨てる）
     時刻は task にも習慣にも付けられる。time: 'HH:MM'、dur: 長さ（分） */
  var DURS = [15, 30, 45, 60, 90, 120, 180];
  function isHabit(t) { return !!(t && (t.repeat === 'daily' || t.repeat === 'weekly' || t.repeat === 'monthly')); }
  /** 毎月の習慣が、その月の何日にあたるか（無い日はその月の最後の日） */
  function mdayIn(h, y, m) {
    var last = new Date(y, m + 1, 0).getDate();
    return h.mday === 'last' ? last : Math.min(Number(h.mday) || 1, last);
  }
  function sortDays(ds) { return (ds || []).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }); }   // 月はじまり
  function onDay(h, iso) {
    var d = U.parse(iso);
    if (h.repeat === 'daily') return true;
    if (h.repeat === 'monthly') return d.getDate() === mdayIn(h, d.getFullYear(), d.getMonth());
    return (h.days || []).indexOf(d.getDay()) >= 0;
  }
  /** 次にやる日（今日より後。見つからなければ ''） */
  function nextOn(h, iso) {
    var d = U.parse(iso);
    for (var i = 1; i <= 62; i++) { d.setDate(d.getDate() + 1); if (onDay(h, U.iso(d))) return U.iso(d); }
    return '';
  }
  function mdayLabel(v) { return v === 'last' ? '月末' : v + '日'; }
  function mdayOptions(cur) {
    var o = '';
    for (var i = 1; i <= 31; i++) o += '<option value="' + i + '"' + (String(cur) === String(i) ? ' selected' : '') + '>' + i + '日</option>';
    return o + '<option value="last"' + (cur === 'last' ? ' selected' : '') + '>月末</option>';
  }
  function habitDone(h, iso) { return !!(h.doneDates && h.doneDates[iso]); }
  function repeatLabel(h) {
    if (h.repeat === 'daily') return '毎日';
    if (h.repeat === 'monthly') return '毎月 ' + mdayLabel(h.mday || 1);
    var ds = sortDays(h.days);
    return ds.length === 7 ? '毎日' : '毎週 ' + ds.map(function (d) { return DOW[d]; }).join('・');
  }
  function toMin(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function fromMin(m) { m = Math.max(0, Math.min(1440, m)); return U.pad(Math.floor(m / 60)) + ':' + U.pad(m % 60); }
  function durOf(t) { return Number(t.dur) || 30; }
  function timeLabel(t) { return t.time ? t.time + '〜' + fromMin(toMin(t.time) + durOf(t)) : ''; }
  function durLabel(m) { return m < 60 ? m + '分' : (m % 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : (m / 60) + '時間'); }
  function durOptions(cur) {
    return DURS.map(function (m) { return '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + durLabel(m) + '</option>'; }).join('');
  }
  function daysPicker(id, cur) {
    return '<div class="days" id="' + id + '">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<button type="button" data-day="' + d + '"' + ((cur || []).indexOf(d) >= 0 ? ' class="on"' : '') + '>' + DOW[d] + '</button>';
    }).join('') + '</div>';
  }

  /** 習慣のその日の済みを入れ替える（受け口には習慣の1行をまるごと送る） */
  function toggleHabit(sp, id, iso) {
    var h = Store.get(sp, 'task', id);
    if (!h || !isHabit(h)) return;
    var dd = h.doneDates || {};
    if (dd[iso]) delete dd[iso]; else dd[iso] = Date.now();
    var edge = U.iso(new Date(Date.now() - 120 * 86400000));
    Object.keys(dd).forEach(function (k) { if (k < edge) delete dd[k]; });
    h.doneDates = dd;
    Store.put(sp, 'task', h);
    renderAll();
  }

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
  function confirmWork(text, sp) {
    if ((sp || space()) !== 'work' || !looksSensitive(text)) return true;
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
    var open = Store.list(space(), 'task').filter(function (t) { return !t.done && !isDev(t) && !isHabit(t); }).length;
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
    if (view === 'plan') renderPlan();
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
    var sub = prioBadge(t) + dueBadge(t.due) + (t.time ? '<span class="due">' + timeLabel(t) + '</span>' : '')
      + (t.note ? '<span class="hasnote">メモあり</span>' : '');
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

  /* ---------- 習慣のまとまり（今日の分はチェックできる。今日お休みの分はたたむ） ---------- */
  var showRest = false;

  function habitRow(h, iso) {
    var done = habitDone(h, iso);
    var nx = onDay(h, iso) ? '' : nextOn(h, iso);
    var sub = '<span class="reptag">↻ ' + U.esc(repeatLabel(h)) + '</span>'
      + (nx ? '<span class="due">次は ' + U.md(nx) + '</span>' : '')
      + (h.time ? '<span class="due">' + timeLabel(h) + '</span>' : '') + prioBadge(h);
    return '<div class="trow habit' + (done ? ' done' : '') + '" data-id="' + U.esc(h.id) + '" data-prio="' + prioOf(h) + '">'
      + '<button type="button" class="ck" data-act="htoggle" aria-label="' + (done ? '今日の済みを取り消す' : '今日は済み') + '">'
      + '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>'
      + '<button type="button" class="tbody" data-act="edit">'
      + '<span class="ttl">' + U.esc(h.title) + '</span><span class="sub">' + sub + '</span>'
      + '</button></div>';
  }

  function renderHabits(habits, iso) {
    if (!habits.length) return '';
    var byTime = function (a, b) {
      return (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : PRIO[prioOf(a)].rank - PRIO[prioOf(b)].rank;
    };
    var today = habits.filter(function (h) { return onDay(h, iso); }).sort(byTime);
    var rest = habits.filter(function (h) { return !onDay(h, iso); }).sort(byTime);
    var n = today.filter(function (h) { return habitDone(h, iso); }).length;
    var h = '<div class="habithead">習慣<span>今日 ' + n + ' / ' + today.length + '</span></div>';
    if (today.length) h += '<div class="card list">' + today.map(function (x) { return habitRow(x, iso); }).join('') + '</div>';
    else h += '<div class="devnote">今日は習慣のお休みの日です</div>';
    if (rest.length) {
      h += '<button type="button" class="donehead" data-act="showrest">' + (showRest ? '▾' : '▸') + ' 今日はお休みの習慣 ' + rest.length + '件</button>';
      if (showRest) h += '<div class="card list">' + rest.map(function (x) { return habitRow(x, iso); }).join('') + '</div>';
    }
    return h;
  }

  function renderToday(open, dev, habits) {
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
    var th = (habits || []).filter(function (h) { return onDay(h, today); });
    if (th.length) {
      var hn = th.filter(function (h) { return habitDone(h, today); }).length;
      f.push('<span class="fact' + (hn === th.length ? ' wait' : ' calm') + '">習慣 <b>' + hn + '/' + th.length + '</b></span>');
    }
    document.getElementById('todayBand').innerHTML =
      '<div class="day"><b>' + d.getDate() + '</b><small>' + (d.getMonth() + 1) + '月・' + DOW[d.getDay()] + '</small></div>'
      + '<div class="facts">' + f.join('') + '</div>';
  }

  function renderTasks() {
    var all = Store.list(space(), 'task');
    var dev = space() === 'work' ? all.filter(isDev) : [];
    all = all.filter(function (t) { return !isDev(t); });
    var habits = all.filter(isHabit);
    all = all.filter(function (t) { return !isHabit(t); });
    var open = all.filter(function (t) { return !t.done; }).sort(sortOpen);
    var done = all.filter(function (t) { return t.done; })
      .sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });

    renderToday(open, dev, habits);
    var h = renderHabits(habits, U.today());
    if (habits.length) h += '<div class="habithead">タスク<span>' + open.length + '件</span></div>';
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
  var addTime = '', addDur = 30, addRepeat = '', addDaysSel = [], addMday = '', moreOpen = false;

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
    // 時刻・くり返し
    document.getElementById('addMore').hidden = !moreOpen;
    document.getElementById('addMoreBtn').textContent = (moreOpen ? '▾' : '▸') + ' 時刻・くり返し'
      + (addTime || addRepeat ? '（' + [addTime, { daily: '毎日', weekly: '毎週', monthly: '毎月 ' + mdayLabel(addMday || new Date().getDate()) }[addRepeat] || ''].filter(Boolean).join('・') + '）' : '');
    document.getElementById('addTime').value = addTime;
    document.getElementById('addDur').innerHTML = durOptions(addDur);
    document.getElementById('addDur').disabled = !addTime;
    document.querySelectorAll('#addRepeat [data-rep]').forEach(function (b) { b.classList.toggle('on', b.dataset.rep === addRepeat); });
    document.getElementById('addDaysRow').hidden = addRepeat !== 'weekly';
    document.getElementById('addMdayRow').hidden = addRepeat !== 'monthly';
    document.getElementById('addMday').innerHTML = mdayOptions(addMday || new Date().getDate());
    document.getElementById('addDays').outerHTML = daysPicker('addDays', addDaysSel);
    // くり返すときは期限を使わない（毎日・毎週その日の分がある）
    document.querySelector('#taskOpts .optrow:nth-child(2)').classList.toggle('off', !!addRepeat);
    document.getElementById('addMoreHint').textContent = addRepeat
      ? '習慣として足します。期限は使いません。済みは日ごとに付けます'
        + (addRepeat === 'monthly' ? '（その月に無い日は、その月の最後の日にします）' : '')
      : (addTime && !addDue ? '期限が無いので、今日の予定として足します' : '');
  }

  function addTask(title) {
    title = title.trim();
    if (!title) return false;
    if (!confirmWork(title)) return false;
    if (addRepeat === 'weekly' && !addDaysSel.length) { toast('曜日を選んでください'); return false; }
    var rec = { title: title, due: addRepeat ? '' : addDue, prio: addPrio, note: '', done: false,
                time: addTime, dur: addTime ? addDur : 0, repeat: addRepeat,
                days: addRepeat === 'weekly' ? sortDays(addDaysSel) : [] };
    if (addRepeat === 'monthly') rec.mday = addMday || new Date().getDate();
    if (rec.time && !rec.repeat && !rec.due) rec.due = U.today();     // 時刻だけ決めたら今日の予定
    if (rec.repeat) rec.doneDates = {};
    Store.put(space(), 'task', rec);
    toast(rec.repeat ? '習慣を足しました（' + repeatLabel(rec) + '）' : 'タスクを足しました');
    addPrio = 'mid'; addDue = '';        // 足したら元に戻す
    addTime = ''; addDur = 30; addRepeat = ''; addDaysSel = []; addMday = '';
    paintAddOpts();
    renderAll();
    return true;
  }

  function toggleTask(id, spIn) {
    var sp = spIn || space();
    var t = Store.get(sp, 'task', id);
    if (!t || isDev(t) || isHabit(t)) return;   // 写しは済みにしない。習慣は日ごと（toggleHabit）
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

  function editTask(id, spIn) {
    var sp = spIn || space();
    var t = Store.get(sp, 'task', id);
    if (!t) return;
    if (isDev(t)) { viewDev(id); return; } // 写しは直さない。見るだけ
    var rep = isHabit(t) ? t.repeat : '';
    var quick = [['今日', 0], ['明日', 1], ['週末', weekendOffset()], ['1週間後', 7]];
    modal(
      '<h2>' + U.esc(label(sp)) + 'の' + (rep ? '習慣' : 'タスク') + '</h2>'
      + '<div class="f"><label for="e-title">やること</label><input type="text" id="e-title" value="' + U.esc(t.title) + '"></div>'
      + '<div class="f"><label>重要度</label>' + prioSeg('e-prio', prioOf(t)) + '</div>'
      + '<div class="f"><label>くり返し</label><div class="seg3 rep" id="e-rep">'
      + [['', 'なし'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月']].map(function (r) {
          return '<button type="button" data-rep="' + r[0] + '"' + (r[0] === rep ? ' class="on"' : '') + '>' + r[1] + '</button>';
        }).join('') + '</div>'
      + '<div class="edays"' + (rep === 'weekly' ? '' : ' hidden') + '>' + daysPicker('e-days', t.days || [new Date().getDay()]) + '</div>'
      + '<div class="emday"' + (rep === 'monthly' ? '' : ' hidden') + '><div class="timepick">毎月 <select id="e-mday">'
      + mdayOptions(t.mday || (t.due ? U.parse(t.due).getDate() : new Date().getDate())) + '</select></div></div></div>'
      + '<div class="f"><label for="e-time">時刻と長さ</label><div class="f2">'
      + '<input type="time" id="e-time" step="300" value="' + U.esc(t.time || '') + '">'
      + '<select id="e-dur">' + durOptions(Number(t.dur) || 30) + '</select>'
      + '<button type="button" class="mini" id="e-notime">なし</button></div></div>'
      + '<div class="f edue"' + (rep ? ' hidden' : '') + '><label for="e-due">期限</label>'
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
        m.querySelectorAll('#e-rep [data-rep]').forEach(function (b) {
          b.onclick = function () {
            rep = b.dataset.rep;
            m.querySelectorAll('#e-rep [data-rep]').forEach(function (x) { x.classList.toggle('on', x === b); });
            m.querySelector('.edays').hidden = rep !== 'weekly';
            m.querySelector('.emday').hidden = rep !== 'monthly';
            m.querySelector('.edue').hidden = !!rep;
          };
        });
        m.querySelectorAll('#e-days [data-day]').forEach(function (b) {
          b.onclick = function () { b.classList.toggle('on'); };
        });
        m.querySelector('#e-notime').onclick = function () { m.querySelector('#e-time').value = ''; };
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
          if (!confirmWork(title + '\n' + note, sp)) return;
          var days = [];
          m.querySelectorAll('#e-days [data-day].on').forEach(function (b) { days.push(+b.dataset.day); });
          if (rep === 'weekly' && !days.length) { toast('曜日を選んでください'); return; }
          var time = m.querySelector('#e-time').value || '';
          t.title = title; t.note = note; t.prio = prio;
          t.time = time; t.dur = time ? +m.querySelector('#e-dur').value : 0;
          if (rep) {
            if (!isHabit(t)) { t.doneDates = {}; t.done = false; t.doneAt = 0; }   // タスクから習慣へ
            t.repeat = rep; t.days = rep === 'weekly' ? sortDays(days) : []; t.due = '';
            var mv = m.querySelector('#e-mday').value;
            if (rep === 'monthly') t.mday = mv === 'last' ? 'last' : +mv; else delete t.mday;
          } else {
            if (isHabit(t)) { t.done = false; t.doneAt = 0; }                    // 習慣からタスクへ
            t.repeat = ''; t.days = []; t.due = due.value || '';
            if (t.time && !t.due) t.due = U.today();
          }
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

  /* ================= 予定（その日のタイムテーブル） =================
     ★個人と会社をいっしょに並べる（その日の自分の予定は1つなので）。色で見分ける。中身は別々のまま
     ・その日の期限のタスクと、その日にやる習慣を出す。時刻の無いものは上の「時間を決めていないもの」へ
     ・空いている時間を押すと、その時刻でタスクを足せる（いま開いている側に足す）
     ・部署の残りの写しは出さない（期限も時刻も無いため） */
  var planDate = '';
  var HOUR = 52;                                  // 1時間の高さ（px）

  function planItems(iso) {
    var out = [];
    Store.SPACES.forEach(function (sp) {
      Store.list(sp, 'task').forEach(function (t) {
        if (isDev(t)) return;
        if (isHabit(t)) { if (onDay(t, iso)) out.push({ sp: sp, t: t, habit: true, done: habitDone(t, iso) }); }
        else if (t.due === iso) out.push({ sp: sp, t: t, habit: false, done: !!t.done });
      });
    });
    return out;
  }

  /** 重なる予定を横に並べる（重なりの塊ごとに列の数をそろえる） */
  function layout(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var cluster = [], colsEnd = [], clusterEnd = -1;
    function close() {
      var n = colsEnd.length;
      cluster.forEach(function (x) { x.n = n; });
      cluster = []; colsEnd = [];
    }
    items.forEach(function (x) {
      if (x.s >= clusterEnd && cluster.length) close();
      var c = 0;
      while (c < colsEnd.length && colsEnd[c] > x.s) c++;
      colsEnd[c] = x.e; x.col = c;
      cluster.push(x);
      clusterEnd = Math.max(clusterEnd, x.e);
    });
    if (cluster.length) close();
    return items;
  }

  function planCheck(x) {
    return '<button type="button" class="ck' + (x.done ? '' : '') + '" data-act="ptoggle" aria-label="' + (x.done ? '済みを取り消す' : '済みにする') + '">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>';
  }

  function renderPlan() {
    var iso = planDate || U.today();
    var d = U.parse(iso), today = U.today();
    var diff = U.daysFrom(iso);
    document.getElementById('planDate').innerHTML = '<b>' + (d.getMonth() + 1) + '月' + d.getDate() + '日</b>（' + DOW[d.getDay()] + '）'
      + (diff === 0 ? '<span class="rel now">今日</span>' : diff === 1 ? '<span class="rel">明日</span>' : diff === -1 ? '<span class="rel">昨日</span>' : '');
    document.getElementById('planToday').hidden = iso === today;

    var all = planItems(iso);
    var loose = all.filter(function (x) { return !x.t.time; });
    var timed = all.filter(function (x) { return x.t.time; }).map(function (x) {
      x.s = toMin(x.t.time); x.e = Math.min(1440, x.s + durOf(x.t)); return x;
    });
    layout(timed);

    var h = '';
    // 数の帯
    var doneN = all.filter(function (x) { return x.done; }).length;
    h += '<div class="plansum">' + (all.length
      ? '<span class="fact calm">予定 <b>' + all.length + '</b></span><span class="fact' + (doneN === all.length ? ' wait' : ' calm') + '">済み <b>' + doneN + '</b></span>'
        + '<span class="legend"><i class="lg personal"></i>個人<i class="lg work"></i>会社<i class="lg habit"></i>習慣</span>'
      : '<span class="fact calm">この日の予定はありません</span>') + '</div>';

    // 時間を決めていないもの
    if (loose.length) {
      loose.sort(function (a, b) { return (a.done - b.done) || (PRIO[prioOf(a.t)].rank - PRIO[prioOf(b.t)].rank); });
      h += '<div class="habithead">時間を決めていないもの<span>' + loose.length + '件</span></div><div class="card list">'
        + loose.map(function (x) {
            return '<div class="trow pl ' + x.sp + (x.habit ? ' habit' : '') + (x.done ? ' done' : '') + '" data-id="' + U.esc(x.t.id) + '" data-sp="' + x.sp + '" data-prio="' + prioOf(x.t) + '">'
              + planCheck(x).replace('class="ck"', 'class="ck"')
              + '<button type="button" class="tbody" data-act="pedit"><span class="ttl">' + U.esc(x.t.title) + '</span>'
              + '<span class="sub"><span class="sptag ' + x.sp + '">' + label(x.sp) + '</span>'
              + (x.habit ? '<span class="reptag">↻ ' + U.esc(repeatLabel(x.t)) + '</span>' : '') + prioBadge(x.t) + '</span></button></div>';
          }).join('') + '</div>';
    }

    // タイムテーブル
    var startH = 7, endH = 22;
    timed.forEach(function (x) { startH = Math.min(startH, Math.floor(x.s / 60)); endH = Math.max(endH, Math.ceil(x.e / 60)); });
    if (iso === today) {
      var nowM = new Date().getHours() * 60 + new Date().getMinutes();
      startH = Math.min(startH, Math.floor(nowM / 60)); endH = Math.max(endH, Math.ceil((nowM + 1) / 60));
    }
    endH = Math.min(24, endH);
    var px = function (m) { return (m - startH * 60) * HOUR / 60; };
    h += '<div class="tt" style="height:' + ((endH - startH) * HOUR + 1) + 'px">';
    for (var hr = startH; hr < endH; hr++) {
      h += '<button type="button" class="slot" data-act="slot" data-h="' + hr + '" style="top:' + px(hr * 60) + 'px;height:' + HOUR + 'px" aria-label="' + hr + '時に足す">'
        + '<span class="hl">' + hr + ':00</span></button>';
    }
    timed.forEach(function (x) {
      var top = px(x.s), height = Math.max(24, px(x.e) - top - 2);
      var w = 100 / x.n;
      h += '<div class="ev ' + x.sp + (x.habit ? ' habit' : '') + (x.done ? ' done' : '') + (height < 40 ? ' short' : '') + '" data-id="' + U.esc(x.t.id) + '" data-sp="' + x.sp + '" data-prio="' + prioOf(x.t) + '"'
        + ' style="top:' + top + 'px;height:' + height + 'px;left:calc(46px + (100% - 52px) * ' + (x.col * w / 100) + ');width:calc((100% - 52px) * ' + (w / 100) + ' - 3px)">'
        + planCheck(x)
        + '<button type="button" class="evbody" data-act="pedit">'
        + '<span class="evt">' + U.esc(x.t.title) + '</span>'
        + '<span class="evs">' + timeLabel(x.t) + (x.habit ? ' ・↻' : '') + '</span>'
        + '</button></div>';
    });
    if (iso === today) {
      var nm = new Date().getHours() * 60 + new Date().getMinutes();
      h += '<div class="nowline" style="top:' + px(nm) + 'px"><span>' + fromMin(nm) + '</span></div>';
    }
    h += '</div>';
    h += '<div class="devnote plannote">空いている時間を押すと、その時刻で「' + U.esc(label()) + '」のタスクを足せます。</div>';
    document.getElementById('planBody').innerHTML = h;

    // 今日を開いたら、いまの時刻が見えるところまで送る（初めの1回だけ）
    if (iso === today && !renderPlan.scrolled) {
      renderPlan.scrolled = true;
      var line = document.querySelector('#planBody .nowline');
      if (line) global.scrollTo(0, Math.max(0, line.getBoundingClientRect().top + global.scrollY - 260));
    }
  }

  /** 空いている時間を押したとき：その時刻でタスクを足す（いま開いている側へ） */
  function addAtSlot(hr) {
    var iso = planDate || U.today(), sp = space();
    modal('<h2>' + (U.parse(iso).getMonth() + 1) + '/' + U.parse(iso).getDate() + ' の予定を足す（' + U.esc(label(sp)) + '）</h2>'
      + '<div class="f"><label for="s-title">やること</label><input type="text" id="s-title" enterkeyhint="done"></div>'
      + '<div class="f"><label for="s-time">時刻と長さ</label><div class="f2">'
      + '<input type="time" id="s-time" step="300" value="' + U.pad(hr) + ':00"><select id="s-dur">' + durOptions(60) + '</select></div></div>'
      + '<div class="f"><label>重要度</label>' + prioSeg('s-prio', 'mid') + '</div>'
      + (sp === 'work' ? '<div class="hint">会社のタスクには、金額・氏名・IDを書かない</div>' : '')
      + '<div class="acts"><button type="button" id="s-cancel">やめる</button><button type="button" class="go" id="s-ok">足す</button></div>',
      function (m) {
        var prio = 'mid';
        m.querySelectorAll('#s-prio [data-prio]').forEach(function (b) {
          b.onclick = function () {
            prio = b.dataset.prio;
            m.querySelectorAll('#s-prio [data-prio]').forEach(function (x) { x.classList.toggle('on', x === b); });
          };
        });
        m.querySelector('#s-cancel').onclick = closeModal;
        var ok = function () {
          var title = m.querySelector('#s-title').value.trim();
          if (!title) { toast('やることを書いてください'); return; }
          if (!confirmWork(title, sp)) return;
          var time = m.querySelector('#s-time').value || (U.pad(hr) + ':00');
          Store.put(sp, 'task', { title: title, prio: prio, due: iso, time: time, dur: +m.querySelector('#s-dur').value || 60,
                                  note: '', done: false, repeat: '', days: [] });
          closeModal(); renderAll(); toast('予定を足しました');
        };
        m.querySelector('#s-ok').onclick = ok;
        m.querySelector('#s-title').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        setTimeout(function () { m.querySelector('#s-title').focus(); }, 50);
      });
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
    document.getElementById('addMoreBtn').onclick = function () { moreOpen = !moreOpen; paintAddOpts(); };
    document.getElementById('addTime').addEventListener('change', function (e) { addTime = e.target.value || ''; paintAddOpts(); });
    document.getElementById('addDur').addEventListener('change', function (e) { addDur = +e.target.value || 30; });
    document.getElementById('addRepeat').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rep]');
      if (!b) return;
      addRepeat = b.dataset.rep;
      if (addRepeat === 'weekly' && !addDaysSel.length) addDaysSel = [new Date().getDay()];
      paintAddOpts();
    });
    document.getElementById('addMday').addEventListener('change', function (e) {
      addMday = e.target.value === 'last' ? 'last' : +e.target.value; paintAddOpts();
    });
    document.getElementById('addDaysRow').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      var d = +b.dataset.day, i = addDaysSel.indexOf(d);
      if (i >= 0) addDaysSel.splice(i, 1); else addDaysSel.push(d);
      paintAddOpts();
    });
    document.getElementById('planPrev').onclick = function () {
      var d = U.parse(planDate || U.today()); d.setDate(d.getDate() - 1); planDate = U.iso(d); renderPlan();
    };
    document.getElementById('planNext').onclick = function () {
      var d = U.parse(planDate || U.today()); d.setDate(d.getDate() + 1); planDate = U.iso(d); renderPlan();
    };
    document.getElementById('planToday').onclick = function () { planDate = ''; renderPlan.scrolled = false; renderPlan(); };
    document.getElementById('planBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'slot') { addAtSlot(+b.dataset.h); return; }
      var row = b.closest('[data-id]');
      if (!row) return;
      var sp = row.dataset.sp, id = row.dataset.id, t = Store.get(sp, 'task', id);
      if (!t) return;
      if (b.dataset.act === 'pedit') { editTask(id, sp); return; }
      if (b.dataset.act === 'ptoggle') {
        if (isHabit(t)) toggleHabit(sp, id, planDate || U.today());
        else toggleTask(id, sp);
      }
    });
    // 予定を開いている間は、いまの時刻の線を1分ごとに動かす
    setInterval(function () { if (view === 'plan' && modalWrap.hidden) renderPlan(); }, 60000);
    paintAddOpts();
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
      if (b.dataset.act === 'showrest') { showRest = !showRest; renderTasks(); return; }
      var row = b.closest('.trow');
      if (!row) return;
      if (b.dataset.act === 'view') { viewDev(row.dataset.id); return; }
      if (b.dataset.act === 'htoggle') {
        var hb = Store.get(space(), 'task', row.dataset.id);
        if (hb && !habitDone(hb, U.today()) && !b.classList.contains('pop')) {
          b.classList.add('pop');
          setTimeout(function () { toggleHabit(space(), row.dataset.id, U.today()); }, 380);
        } else if (!b.classList.contains('pop')) {
          toggleHabit(space(), row.dataset.id, U.today());
        }
        return;
      }
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
