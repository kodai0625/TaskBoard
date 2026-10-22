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
       moves: {'もとの日': '動かした先の日'}（今回だけ日を変えた回。先が '' ならその回はお休み。2026-09-29〜）
         ★決まり（曜日・日付）はそのまま。済み（doneDates）は動かした先の日で付く
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
  /** 決まりどおりならその日にやるか（今回だけの変更は見ない） */
  function baseOn(h, iso) {
    var d = U.parse(iso);
    if (h.repeat === 'daily') return true;
    if (h.repeat === 'monthly') return d.getDate() === mdayIn(h, d.getFullYear(), d.getMonth());
    return (h.days || []).indexOf(d.getDay()) >= 0;
  }
  /** 実際にその日にやるか（今回だけ動かした・休んだ回を入れて） */
  function onDay(h, iso) {
    var mv = h.moves || {};
    if (Object.prototype.hasOwnProperty.call(mv, iso)) return false;   // この日の回は、よそへ動かした（か休み）
    if (movedFrom(h, iso)) return true;                                   // よその回を、この日に動かした
    return baseOn(h, iso);
  }
  /** この日に動かしてきた回の、もとの日（無ければ ''） */
  function movedFrom(h, iso) {
    var mv = h.moves || {};
    for (var k in mv) if (Object.prototype.hasOwnProperty.call(mv, k) && mv[k] === iso) return k;
    return '';
  }
  /** 決まりどおりの回を、fromIso から先へ n 回まで */
  function baseUpcoming(h, fromIso, n) {
    var out = [], d = U.parse(fromIso), days = h.repeat === 'monthly' ? 100 : 45;
    for (var i = 0; i <= days && out.length < n; i++) {
      var iso = U.iso(d);
      if (baseOn(h, iso)) out.push(iso);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  /** 今回だけ動かす（to が '' ならお休み。to がもとの日なら元に戻す） */
  function setMove(sp, id, orig, to) {
    var h = Store.get(sp, 'task', id);
    if (!h || !isHabit(h)) return;
    var mv = h.moves || {};
    if (to === orig || to === null) delete mv[orig]; else mv[orig] = to;
    var edge = U.iso(new Date(Date.now() - 120 * 86400000));
    Object.keys(mv).forEach(function (k) { if (k < edge && (!mv[k] || mv[k] < edge)) delete mv[k]; });
    h.moves = mv;
    Store.put(sp, 'task', h);
    renderAll();
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

  /* ---------- やる日（2026-09-29）。期限（いつまでに）とは別に「いつやるか」。doOn: 'YYYY-MM-DD' ----------
     予定タブには「やる日」に出す（やる日が無ければ、これまでどおり期限の日に出す）。時刻は、やる日の時刻 */
  function planDay(t) { return t.doOn || t.due || ''; }
  function doBadge(t) {
    if (!t.doOn || t.done) return '';
    var n = U.daysFrom(t.doOn);
    if (n < 0) return '<span class="dob late">やる日 ' + (-n) + '日過ぎ</span>';
    if (n === 0) return '<span class="dob now">今日やる</span>';
    if (n === 1) return '<span class="dob">明日やる</span>';
    return '<span class="dob">' + U.md(t.doOn) + 'にやる</span>';
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
    appsModal = false;
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
    var buy = buyNeedCount();
    document.getElementById('cntBuy').textContent = buy ? buy : '';
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
    document.getElementById('tabApps').hidden = sp !== APPSP;     // 自作アプリは個人の側だけ
    document.getElementById('tabBuy').hidden = sp !== BUYSP;      // 買い出しは会社の側だけ
    document.getElementById('taskInput').placeholder = label() + 'のタスクを足す';
    document.getElementById('memoInput').placeholder = label() + 'のメモを書く';
    var rule = sp === 'work'
      ? '会社のタスクには、金額・氏名・IDを書かない（例：「◯◯店の締めを確認」）'
      : '';
    ['taskRule', 'memoRule', 'buyRule'].forEach(function (id) {
      var el = document.getElementById(id);
      el.textContent = rule && id === 'buyRule' ? '買い出しにも、金額・氏名・IDは書かない（個数は書いてよい）' : rule;
      el.hidden = !rule;
    });
  }

  function switchSpace(sp) {
    if (sp === space()) return;
    Store.ui().space = sp;
    Store.saveUi();
    applySpace();
    // 自作アプリは個人の側だけ（出たらロックする）。買い出しは会社の側だけ。どちらも、反対の側ではタスクへ移す
    if (view === 'apps' || view === 'buy') show(Store.ui().view === 'buy' ? 'task' : Store.ui().view); else renderAll();
    toast(label() + 'に切り替えました');
  }

  /* ---------- 画面切り替え ---------- */
  var view = 'task';
  var lastView = 'task';
  function show(v) {
    if (v === 'apps' && space() !== APPSP) v = 'task';
    if (v === 'buy' && space() !== BUYSP) v = 'task';
    if (view === 'apps' && v !== 'apps') lockApps();
    if (view !== 'set') lastView = view;
    view = v;
    if (v !== 'set' && v !== 'apps') { Store.ui().view = v; Store.saveUi(); }
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    document.getElementById('setBtn').classList.toggle('on', v === 'set');
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'view-' + v); });
    renderAll();
    global.scrollTo(0, 0);
    if (v === 'apps' && !document.getElementById('apps-locked').hidden) {
      // 生体認証を使っていれば、そのまま生体認証を出す（押した動きの中で呼ぶ必要がある）。使っていなければパスワードの欄へ
      if (bioRec() && bioCan()) bioUnlock(); else document.getElementById('lockPass').focus();
    }
  }

  function renderAll() {
    paintSync();
    paintCounts();
    if (view === 'task') renderTasks();
    if (view === 'plan') { renderPlan(); diemImport(false); }
    if (view === 'memo') renderMemos();
    if (view === 'buy') renderBuy();
    if (view === 'apps') renderApps();
    if (view === 'set') renderSettings();
  }

  /* ================= タスク ================= */
  var showDone = false;

  function nearDay(t) {
    var ds = [t.doOn, t.due].filter(Boolean).sort();
    return ds[0] || '';
  }
  function sortOpen(a, b) {
    // やる日と期限の近いほうの日で並べる（明日やるものは、期限が先でも上に来る）。同じ日・日の無いものは重要度の高い順
    var ad = nearDay(a), bd = nearDay(b);
    if (ad !== bd) { if (!ad) return 1; if (!bd) return -1; return ad < bd ? -1 : 1; }
    var r0 = PRIO[prioOf(a)].rank - PRIO[prioOf(b)].rank;
    if (r0) return r0;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  /** 行の右の「編集」ボタン（2026-10-23 ko-dai さん：行そのものを押すと済み、直すのはこのボタンから） */
  function editBtn(act) {
    return '<button type="button" class="tedit" data-act="' + act + '" aria-label="編集" title="編集">'
      + '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M14.06 4.94 19.06 9.94 9 20H4v-5L14.06 4.94Zm1.41-1.41 1.77-1.77a1.5 1.5 0 0 1 2.12 0l2.88 2.88a1.5 1.5 0 0 1 0 2.12L20.47 8.53l-5-5Z"/></svg>'
      + '</button>';
  }

  function taskRow(t) {
    var sub = prioBadge(t) + doBadge(t) + dueBadge(t.due) + (t.time ? '<span class="due">' + timeLabel(t) + '</span>' : '')
      + (t.note ? '<span class="hasnote">メモあり</span>' : '');
    return '<div class="trow' + (t.done ? ' done' : '') + '" data-id="' + U.esc(t.id) + '" data-prio="' + prioOf(t) + '">'
      + '<button type="button" class="ck" data-act="toggle" aria-label="' + (t.done ? '未完了にもどす' : '済みにする') + '">'
      + '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>'
      + '<button type="button" class="tbody" data-act="toggle" aria-label="' + (t.done ? '未完了にもどす' : '済みにする') + '">'
      + '<span class="ttl">' + U.esc(t.title) + '</span>'
      + (sub ? '<span class="sub">' + sub + '</span>' : '')
      + '</button>'
      + editBtn('edit')
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
    var from = onDay(h, iso) ? movedFrom(h, iso) : '';
    var sub = '<span class="reptag">↻ ' + U.esc(repeatLabel(h)) + '</span>'
      + (from ? '<span class="movetag">↪ ' + U.md(from) + 'の分</span>' : '')
      + (nx ? '<span class="due">次は ' + U.md(nx) + '</span>' : '')
      + (h.time ? '<span class="due">' + timeLabel(h) + '</span>' : '') + prioBadge(h);
    return '<div class="trow habit' + (done ? ' done' : '') + '" data-id="' + U.esc(h.id) + '" data-prio="' + prioOf(h) + '">'
      + '<button type="button" class="ck" data-act="htoggle" aria-label="' + (done ? '今日の済みを取り消す' : '今日は済み') + '">'
      + '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>'
      + '<button type="button" class="tbody" data-act="htoggle" aria-label="' + (done ? '今日の済みを取り消す' : '今日は済み') + '">'
      + '<span class="ttl">' + U.esc(h.title) + '</span><span class="sub">' + sub + '</span>'
      + '</button>' + editBtn('edit') + '</div>';
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
    var todo = open.filter(function (t) { return t.doOn && t.doOn <= today; }).length;
    var high = open.filter(function (t) { return prioOf(t) === 'high'; }).length;
    var wait = dev.filter(function (t) { return t.section === 'ko-dai'; }).length;
    var f = [];
    f.push('<span class="fact calm">' + (open.length ? '残り <b>' + open.length + '</b>' : 'やることはありません') + '</span>');
    if (over) f.push('<span class="fact over">期限切れ <b>' + over + '</b></span>');
    if (todo) f.push('<span class="fact todo">今日やる <b>' + todo + '</b></span>');
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
  var addPrio = 'mid', addDue = '', addDo = '';
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
    var hitDo = false;
    document.querySelectorAll('#addDoPick [data-q]').forEach(function (b) {
      var on = !hitDo && quickDate(b.dataset.q) === addDo;
      if (on) hitDo = true;
      b.classList.toggle('on', on);
    });
    document.getElementById('addDo').value = addDo;
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
    document.getElementById('rowDue').classList.toggle('off', !!addRepeat);
    document.getElementById('rowDo').classList.toggle('off', !!addRepeat);
    document.getElementById('addMoreHint').textContent = addRepeat
      ? '習慣として足します。期限は使いません。済みは日ごとに付けます'
        + (addRepeat === 'monthly' ? '（その月に無い日は、その月の最後の日にします）' : '')
      : (addTime && !addDo ? 'やる日が無いので、今日の予定（今日やる）として足します' : '');
  }

  function addTask(title) {
    title = title.trim();
    if (!title) return false;
    if (!confirmWork(title)) return false;
    if (addRepeat === 'weekly' && !addDaysSel.length) { toast('曜日を選んでください'); return false; }
    var rec = { title: title, due: addRepeat ? '' : addDue, doOn: addRepeat ? '' : addDo, prio: addPrio, note: '', done: false,
                time: addTime, dur: addTime ? addDur : 0, repeat: addRepeat,
                days: addRepeat === 'weekly' ? sortDays(addDaysSel) : [] };
    if (addRepeat === 'monthly') rec.mday = addMday || new Date().getDate();
    if (rec.time && !rec.repeat && !rec.doOn) rec.doOn = U.today();   // 時刻だけ決めたら、今日やる予定
    if (rec.repeat) rec.doneDates = {};
    Store.put(space(), 'task', rec);
    toast(rec.repeat ? '習慣を足しました（' + repeatLabel(rec) + '）' : 'タスクを足しました');
    addPrio = 'mid'; addDue = ''; addDo = '';   // 足したら元に戻す
    addTime = ''; addDur = 30; addRepeat = ''; addDaysSel = []; addMday = '';
    paintAddOpts();
    renderAll();
    return true;
  }

  function toggleTask(id, spIn) {
    var sp = spIn || space();
    var t = Store.get(sp, 'task', id);
    if (!t || isDev(t) || isHabit(t)) return;   // 写しは済みにしない。習慣は日ごと（toggleHabit）
    var prevDone = !!t.done, prevAt = t.doneAt || 0;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : 0;
    Store.put(sp, 'task', t);
    renderAll();
    // 行を押すだけで入れ替わるので、どちら向きでも「もどす」を出す（押しまちがえたとき、すぐ戻せるように）
    toast(t.done ? '済みにしました' : '未完了にもどしました', function () {
      var cur = Store.get(sp, 'task', id);
      if (!cur) return;
      cur.done = prevDone; cur.doneAt = prevAt;
      Store.put(sp, 'task', cur);
      renderAll();
    });
  }

  function editTask(id, spIn, ctxIso) {
    var sp = spIn || space();
    var t = Store.get(sp, 'task', id);
    if (!t) return;
    if (isDev(t)) { viewDev(id); return; } // 写しは直さない。見るだけ
    var rep = isHabit(t) ? t.repeat : '';
    var beforeRule = JSON.stringify([t.repeat || '', sortDays(t.days || []), t.mday || '']);
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
      + mdayOptions(t.mday || (t.due ? U.parse(t.due).getDate() : new Date().getDate())) + '</select></div></div>'
      + (rep ? '<div class="hint rulehint">くり返しの決まりを変えると、「今回だけ」の変更は消えます</div>' : '') + '</div>'
      + (rep ? '<div class="f emove"><label>今回だけ日を変える</label><div class="mvbox"></div></div>' : '')
      + '<div class="f"><label for="e-time">時刻と長さ</label><div class="f2">'
      + '<input type="time" id="e-time" step="300" value="' + U.esc(t.time || '') + '">'
      + '<select id="e-dur">' + durOptions(Number(t.dur) || 30) + '</select>'
      + '<button type="button" class="mini" id="e-notime">なし</button></div></div>'
      + '<div class="f edo"' + (rep ? ' hidden' : '') + '><label for="e-do">やる日</label>'
      + '<div class="f2"><input type="date" id="e-do" value="' + U.esc(t.doOn || '') + '">'
      + '<button type="button" class="mini" data-do="">なし</button></div>'
      + '<div class="quick">' + quick.map(function (q) {
          return '<button type="button" class="chip" data-do="' + U.addDays(q[1]) + '">' + q[0] + '</button>';
        }).join('') + '</div></div>'
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
        autoGrow(m.querySelector('#e-note'));
        var doIn = m.querySelector('#e-do');
        m.querySelectorAll('[data-do]').forEach(function (b) {
          b.onclick = function () { doIn.value = b.dataset.do; };
        });
        m.querySelectorAll('#e-rep [data-rep]').forEach(function (b) {
          b.onclick = function () {
            rep = b.dataset.rep;
            m.querySelectorAll('#e-rep [data-rep]').forEach(function (x) { x.classList.toggle('on', x === b); });
            m.querySelector('.edays').hidden = rep !== 'weekly';
            m.querySelector('.emday').hidden = rep !== 'monthly';
            m.querySelector('.edue').hidden = !!rep;
            m.querySelector('.edo').hidden = !!rep;
          };
        });
        m.querySelectorAll('#e-days [data-day]').forEach(function (b) {
          b.onclick = function () { b.classList.toggle('on'); };
        });
        m.querySelector('#e-notime').onclick = function () { m.querySelector('#e-time').value = ''; };
        // 今回だけ日を変える（押したらすぐ残す。「直す」を押さなくてよい）
        var box = m.querySelector('.mvbox');
        var pick = '';
        function paintMoves() {
          if (!box) return;
          var cur = Store.get(sp, 'task', id) || t;
          var mv = cur.moves || {};
          var today = U.today();
          var occ = baseUpcoming(cur, today, 12);
          Object.keys(mv).forEach(function (k) { if (k >= today && occ.indexOf(k) < 0) occ.push(k); });
          occ.sort();
          if (!pick) {
            var from = ctxIso ? (movedFrom(cur, ctxIso) || (baseOn(cur, ctxIso) ? ctxIso : '')) : '';
            pick = from && occ.indexOf(from) >= 0 ? from : (occ[0] || '');
          }
          var opt = occ.map(function (o) {
            var to = Object.prototype.hasOwnProperty.call(mv, o) ? mv[o] : null;
            return '<option value="' + o + '"' + (o === pick ? ' selected' : '') + '>' + U.md(o) + 'の分'
              + (to === null ? '' : to ? '（→ ' + U.md(to) + ' に移し中）' : '（お休み中）') + '</option>';
          }).join('');
          var moved = Object.keys(mv).filter(function (k) { return k >= today || (mv[k] && mv[k] >= today); }).sort();
          var pickedTo = Object.prototype.hasOwnProperty.call(mv, pick) ? mv[pick] : null;
          box.innerHTML = occ.length
            ? '<div class="f2"><select id="e-occ">' + opt + '</select></div>'
              + '<div class="f2 mvrow"><input type="date" id="e-mvto" value="' + (pickedTo || pick) + '" min="' + today + '">'
              + '<button type="button" class="mini go2" id="e-mv">この日に移す</button>'
              + '<button type="button" class="mini" id="e-skip">この回は休む</button></div>'
              + (moved.length ? '<div class="mvlist">' + moved.map(function (k) {
                  return '<div class="mvitem"><span>' + U.md(k) + 'の分 → <b>' + (mv[k] ? U.md(mv[k]) : 'お休み') + '</b></span>'
                    + '<button type="button" class="mini" data-undo="' + k + '">元に戻す</button></div>';
                }).join('') + '</div>' : '<div class="hint">動かしている回はありません</div>')
            : '<div class="hint">この先の回が見つかりません</div>';
          var sel = box.querySelector('#e-occ');
          if (sel) sel.onchange = function () { pick = sel.value; paintMoves(); };
          var mvb = box.querySelector('#e-mv');
          if (mvb) mvb.onclick = function () {
            var to = box.querySelector('#e-mvto').value;
            if (!to) { toast('移す日を選んでください'); return; }
            setMove(sp, id, pick, to);
            toast(to === pick ? U.md(pick) + 'の分を元に戻しました' : U.md(pick) + 'の分を ' + U.md(to) + ' に移しました');
            paintMoves();
          };
          var sk = box.querySelector('#e-skip');
          if (sk) sk.onclick = function () { setMove(sp, id, pick, ''); toast(U.md(pick) + 'の分はお休みにしました'); paintMoves(); };
          box.querySelectorAll('[data-undo]').forEach(function (b) {
            b.onclick = function () { setMove(sp, id, b.dataset.undo, null); toast(U.md(b.dataset.undo) + 'の分を元に戻しました'); paintMoves(); };
          });
        }
        paintMoves();
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
          var wasTime = t.time || '', wasDo = t.doOn || '';
          t.title = title; t.note = note; t.prio = prio;
          t.time = time; t.dur = time ? +m.querySelector('#e-dur').value : 0;
          if (rep) {
            if (!isHabit(t)) { t.doneDates = {}; t.done = false; t.doneAt = 0; }   // タスクから習慣へ
            t.repeat = rep; t.days = rep === 'weekly' ? sortDays(days) : []; t.due = ''; t.doOn = '';
            var mdv = m.querySelector('#e-mday').value;
            if (rep === 'monthly') t.mday = mdv === 'last' ? 'last' : +mdv; else delete t.mday;
            // くり返しの決まりが変わったら、今回だけの変更は消す（もとの日が合わなくなるため）
            if (JSON.stringify([t.repeat, sortDays(t.days || []), t.mday || '']) !== beforeRule) t.moves = {};
          } else {
            if (isHabit(t)) { t.done = false; t.doneAt = 0; }                    // 習慣からタスクへ
            t.repeat = ''; t.days = []; t.due = due.value || ''; t.doOn = doIn.value || '';
            if (t.time && !t.doOn) t.doOn = U.today();                          // 時刻だけなら今日やる
          }
          // 自分で時刻・やる日を変えたら「自動」の印を外す（組み直しても動かさない）
          if (t.auto && ((t.time || '') !== wasTime || (t.doOn || '') !== wasDo)) delete t.auto;
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

  /** その日に出す時刻。習慣は、自分の時刻が無ければ「自動で組む」が入れたその日だけの時刻（autoAt） */
  function timeOn(t, iso) { return t.time || (isHabit(t) && t.autoAt && t.autoAt[iso]) || ''; }
  /** 「自動で組む」が入れた時刻か（自分で決めた時刻は false。組み直すとき、自動のものだけ動かす） */
  function autoOn(t, iso) { return isHabit(t) ? !t.time && !!(t.autoAt && t.autoAt[iso]) : !!t.time && t.auto === iso; }

  function planItems(iso) {
    var out = [];
    Store.SPACES.forEach(function (sp) {
      Store.list(sp, 'task').forEach(function (t) {
        if (isDev(t)) return;
        var x = null;
        if (isHabit(t)) { if (onDay(t, iso)) x = { sp: sp, t: t, habit: true, done: habitDone(t, iso) }; }
        else if (planDay(t) === iso) x = { sp: sp, t: t, habit: false, done: !!t.done };
        if (x) { x.time = timeOn(t, iso); x.auto = autoOn(t, iso); out.push(x); }
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
    return '<button type="button" class="ck" data-act="ptoggle" aria-label="' + (x.done ? '済みを取り消す' : '済みにする') + '">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>';
  }

  /* ---------- 自動で組む（2026-10-23 ko-dai さんの願い。同じ日に作り直し） ----------
     その日の仕事（職場・時間・通勤）と予定から、何時に起きて何時に寝るかと、時刻の無いタスクをいつやるかを組んで、
     ★そのまま書き込む（自分で直せる）。書いた時刻には「自動」の印（タスクは auto＝日付、習慣は autoAt[日付]）を付ける。
       自分で時刻ややる日を直したタスクは印が外れ、それ以後は組み直しても動かさない
     ・いつ組むか：その日の仕事を入れた・直したとき／「退勤」を押したとき（今から先だけ）／「組み直す」を押したとき／
       Diem の休みを取り込んだとき。今日を組むときは、今より前には入れない
     ・職場・時間の決まり・通勤（片道）は、会社の側の記録 day-conf に持つ（★職場の名前はコードに書かない。公開しているコードから
       勤め先が分からないように）。その日の仕事は day-w-日付（{place, shift, start, end, clockOut, off, from}）
     ・起きる：「いつもの起きる時刻」と「前の晩に帰った時刻＋ゆとり＋睡眠」の遅いほう。ただし、その日の最初の予定
       （仕事なら、家を出る時刻＝出勤−通勤）の「動き出すまで」前までには起きる
     ・寝る：次の日の起きる時刻−睡眠。その日の最後の予定（仕事なら、家に着く時刻＝退勤＋通勤）＋ゆとりより前にはしない
     ・会社のタスクは仕事の時間の中、個人のタスクは仕事と通勤の前後と休みの日へ（ko-dai さんの決定）
     ・入れるもの：やる日・期限がその日のものと、その日の習慣。今日を組むときは、過ぎたものと、空きに期限3日以内・重要度 高も
       （先の日を組むときに、ほかの日のものを連れてこないため）。やる日が先の日に決まっているものは前倒ししない
     ・夜中の0時を越える時刻には入れない（時刻はその日の中だけで持つため）
     ・組み方の数（睡眠7時間など）は、この端末の画面の覚え（tb.ui の planConf） */
  var PLAN_DEF = { sleepH: 7, prepMin: 60, windMin: 30, gapMin: 10, wake: '07:00' };
  var planRuns = {};                 // { 日付: { at, placed, left } } 最後に組んだ結果（この画面を開いている間だけ）

  function planConf() {
    var u = Store.ui(), c = u.planConf || {};
    var out = {};
    Object.keys(PLAN_DEF).forEach(function (k) { out[k] = c[k] != null && c[k] !== '' ? c[k] : PLAN_DEF[k]; });
    out.sleepH = Math.max(3, Math.min(12, Number(out.sleepH) || 7));
    ['prepMin', 'windMin', 'gapMin'].forEach(function (k) { out[k] = Math.max(0, Math.min(240, Number(out[k]) || 0)); });
    if (!/^\d\d:\d\d$/.test(out.wake)) out.wake = PLAN_DEF.wake;
    return out;
  }
  function shiftIso(iso, n) { var d = U.parse(iso); d.setDate(d.getDate() + n); return U.iso(d); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  /* 職場の決まり（会社の側の day-conf）。{ places:[{ id, name, commute:分, shifts:[{ id, name, start, end, startByDow, endByDow }] }] } */
  function dayConf() { var c = Store.get('work', 'day', 'day-conf'); return c && !c.deleted ? c : null; }
  function workplaces() { var c = dayConf(); return ((c && c.places) || []).filter(function (p) { return p && p.id && p.name; }); }
  function placeOf(id) { return workplaces().filter(function (p) { return p.id === id; })[0] || null; }
  function shiftsOf(p) { return ((p && p.shifts) || []).filter(function (s) { return s && s.start && s.end; }); }
  /** 決まりの時間（曜日で終わりが変わるものも。0＝日曜） */
  function ruleTimes(p, shiftId, iso) {
    var list = shiftsOf(p), sh = list.filter(function (s) { return s.id === shiftId; })[0] || list[0];
    if (!sh) return null;
    var dow = String(U.parse(iso).getDay());
    return { shift: sh.id, start: (sh.startByDow && sh.startByDow[dow]) || sh.start, end: (sh.endByDow && sh.endByDow[dow]) || sh.end };
  }

  function workOf(iso) { var r = Store.get('work', 'day', 'day-w-' + iso); return r && !r.deleted ? r : null; }
  /** 仕事の時間（分。0時を越える分は1440を足す）と通勤（片道・分）。休み・未入力は null。退勤を押した日は、退勤の時刻で終わる */
  function workSpan(iso) {
    var w = workOf(iso);
    if (!w || w.off || !w.start || !w.end) return null;
    var s = toMin(w.start), e = toMin(w.clockOut || w.end);
    if (e <= s) e += 1440;
    var p = w.place ? placeOf(w.place) : null;
    return { s: s, e: e, com: Math.max(0, Number(p && p.commute) || 0), out: !!w.clockOut, w: w, p: p };
  }
  function workName(w) {
    var p = w && w.place ? placeOf(w.place) : null, sh = p ? shiftsOf(p).filter(function (s) { return s.id === w.shift; })[0] : null;
    return p ? p.name + (sh && sh.name && shiftsOf(p).length > 1 ? ' ' + sh.name : '') : '仕事';
  }

  /** その日の動かせない予定。仕事は、家を出てから帰るまで（通勤をふくむ）。
      skipAuto を渡すと、その日の「自動」のものは動かせるものとして外す（組み直すとき） */
  function fixedOf(iso, skipAuto) {
    var out = [];
    planItems(iso).forEach(function (x) {
      if (!x.time || (skipAuto && x.auto)) return;
      var s = toMin(x.time);
      out.push({ s: s, e: s + durOf(x.t) });
    });
    var w = workSpan(iso);
    if (w) out.push({ s: w.s - w.com, e: w.e + w.com });
    return out.sort(function (a, b) { return a.s - b.s; });
  }
  function lastEnd(fixed) { return fixed.reduce(function (m, f) { return Math.max(m, f.e); }, -1); }
  /** 起きる時刻（その日の0時からの分） */
  function wakeAt(iso, c) {
    var f = fixedOf(iso), pe = lastEnd(fixedOf(shiftIso(iso, -1)));
    var w = toMin(c.wake);
    if (pe >= 0) w = Math.max(w, pe + c.windMin + c.sleepH * 60 - 1440);   // 前の晩が遅ければ、寝坊してよい
    if (f.length) w = Math.min(w, f[0].s - c.prepMin);                        // 最初の予定（家を出る時刻）には間に合わせる
    return Math.max(0, w);
  }
  function sleepOf(iso) {
    var c = planConf(), fixed = fixedOf(iso);
    var wake = wakeAt(iso, c), nextWake = wakeAt(shiftIso(iso, 1), c) + 1440, le = lastEnd(fixed);
    var bed = nextWake - c.sleepH * 60, short = false;
    if (le >= 0 && bed < le + c.windMin) { bed = le + c.windMin; short = true; }
    if (bed < wake + c.prepMin + 60) bed = wake + c.prepMin + 60;
    if (fixed.length && wake > fixed[0].s - c.prepMin) short = true;
    if (nextWake - bed < c.sleepH * 60) short = true;
    return { wake: wake, bed: bed, sleep: nextWake - bed, short: short };
  }

  function snap(m) { return Math.ceil(m / 5) * 5; }
  /** 窓 [s,e) の並びから、ふさがり [s,e) を切り取る */
  function cut(wins, busy) {
    var out = [];
    wins.forEach(function (w) {
      var parts = [w];
      busy.forEach(function (b) {
        var next = [];
        parts.forEach(function (p) {
          if (b.e <= p.s || b.s >= p.e) { next.push(p); return; }
          if (b.s > p.s) next.push({ s: p.s, e: b.s });
          if (b.e < p.e) next.push({ s: b.e, e: p.e });
        });
        parts = next;
      });
      out = out.concat(parts);
    });
    return out.filter(function (w) { return w.e - w.s >= 5; });
  }

  /** 組む（書かない）。from は入れてよい一番早い時刻（分）。返すのは { placed:[{sp,t,habit,s,e}], left:[{sp,t,why}], freed:[{sp,t,habit}] } */
  function autoPlan(iso, from) {
    var c = planConf(), work = workSpan(iso), sl = sleepOf(iso), today = U.today();
    from = Math.max(from || 0, iso === today ? nowMin() : 0);
    var dayWin = [{ s: snap(Math.max(sl.wake + c.prepMin, from)), e: Math.min(1440, sl.bed - c.windMin) }];
    var busy = [];
    planItems(iso).forEach(function (x) {
      if (!x.time || x.auto) return;                                   // 自動のものは組み直すので、ふさがりにしない
      var s = toMin(x.time);
      busy.push({ s: s - c.gapMin, e: s + durOf(x.t) + c.gapMin });
    });
    var base = cut(dayWin, busy);
    var own = cut(base, work ? [{ s: work.s - work.com - c.gapMin, e: work.e + work.com + c.gapMin }] : []);
    var inWork = work ? cut(base, [{ s: -1e9, e: work.s }, { s: work.e, e: 1e9 }]) : [];

    var soon = shiftIso(iso, 3), cands = [], freed = [];
    Store.SPACES.forEach(function (sp) {
      Store.list(sp, 'task').forEach(function (t) {
        if (isDev(t)) return;
        if (isHabit(t)) {
          if (t.time || !onDay(t, iso)) return;
          if (t.autoAt && t.autoAt[iso]) freed.push({ sp: sp, t: t, habit: true });
          if (!habitDone(t, iso)) cands.push({ sp: sp, t: t, habit: true, tier: 0 });
          return;
        }
        if (t.time && t.auto !== iso) return;                          // 自分で決めた時刻は動かさない
        if (t.time) freed.push({ sp: sp, t: t, habit: false });
        if (t.done || (t.doOn && t.doOn > iso)) return;               // やる日が先に決まっているものは前倒ししない
        var mine = t.doOn === iso || t.due === iso || t.auto === iso;
        var late = iso === today && ((t.doOn && t.doOn < iso) || (t.due && t.due < iso));
        var rush = iso === today && !t.doOn && ((t.due && t.due <= soon) || prioOf(t) === 'high');
        if (mine || late) cands.push({ sp: sp, t: t, habit: false, tier: 0 });
        else if (rush) cands.push({ sp: sp, t: t, habit: false, tier: 1 });
      });
    });
    cands.sort(function (a, b) {
      var oa = a.t.due && a.t.due < iso ? 0 : 1, ob = b.t.due && b.t.due < iso ? 0 : 1;
      return a.tier - b.tier || oa - ob || PRIO[prioOf(a.t)].rank - PRIO[prioOf(b.t)].rank
        || (a.t.due || '9999').localeCompare(b.t.due || '9999') || (a.t.createdAt || 0) - (b.t.createdAt || 0);
    });

    var placed = [], left = [];
    cands.forEach(function (x) {
      var d = durOf(x.t), wins = x.sp === 'work' ? inWork : own;
      if (x.sp === 'work' && !work) {
        if (x.tier === 0) left.push({ sp: x.sp, t: x.t, why: workOf(iso) ? 'この日は仕事が休み' : 'この日の仕事を入れていない' });
        return;
      }
      for (var i = 0; i < wins.length; i++) {
        var s = snap(wins[i].s);
        if (wins[i].e - s >= d) {
          placed.push({ sp: x.sp, t: x.t, habit: x.habit, s: s, e: s + d });
          var rest = [];
          if (s - wins[i].s >= 5) rest.push({ s: wins[i].s, e: s });
          if (wins[i].e - (s + d + c.gapMin) >= 5) rest.push({ s: s + d + c.gapMin, e: wins[i].e });
          wins.splice.apply(wins, [i, 1].concat(rest));
          return;
        }
      }
      if (x.tier === 0) {
        left.push({ sp: x.sp, t: x.t, why: x.sp === 'work' ? (work.out ? 'もう退勤した' : '仕事の時間に空きが足りない') : '空いている時間が足りない' });
      }
    });
    return { placed: placed, left: left, freed: freed };
  }

  function clock(m) { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ':' + U.pad(m % 60); }
  function hoursLabel(m) { var h = Math.floor(m / 60), r = m % 60; return h + '時間' + (r ? r + '分' : ''); }
  function pruneAutoAt(h) {
    var keep = shiftIso(U.today(), -14);
    Object.keys(h.autoAt || {}).forEach(function (k) { if (k < keep) delete h.autoAt[k]; });
  }

  /** 組んで、そのまま書く。自動の印のものは、入らなければ時刻を外す（やる日は残す）。「もどす」で全部前に戻せる */
  function applyPlan(iso, opt) {
    opt = opt || {};
    var r = autoPlan(iso, opt.from), back = [], touched = {};
    function snapOf(sp, t) {
      var k = sp + '/' + t.id;
      if (touched[k]) return;
      touched[k] = true;
      back.push({ sp: sp, id: t.id, time: t.time, dur: t.dur, doOn: t.doOn, auto: t.auto, autoAt: t.autoAt ? JSON.parse(JSON.stringify(t.autoAt)) : undefined });
    }
    // 前に自動で入れた時刻を、いったん外す（入らなかったものは外れたまま）
    r.freed.forEach(function (x) {
      var t = Store.get(x.sp, 'task', x.t.id);
      if (!t) return;
      snapOf(x.sp, t);
      if (x.habit) { if (t.autoAt) delete t.autoAt[iso]; } else { t.time = ''; t.dur = 0; delete t.auto; }
    });
    r.placed.forEach(function (p) {
      var t = Store.get(p.sp, 'task', p.t.id);
      if (!t) return;
      snapOf(p.sp, t);
      if (p.habit) { t.autoAt = t.autoAt || {}; t.autoAt[iso] = fromMin(p.s); pruneAutoAt(t); }
      else { t.time = fromMin(p.s); t.dur = p.e - p.s; t.doOn = iso; t.auto = iso; }
    });
    back.forEach(function (b) { var t = Store.get(b.sp, 'task', b.id); if (t) Store.put(b.sp, 'task', t); });
    planRuns[iso] = { at: Date.now(), placed: r.placed, left: r.left };
    renderAll();
    if (opt.quiet) return r;
    toast((opt.label || '組みました') + '（' + r.placed.length + '件' + (r.left.length ? '・入らない ' + r.left.length + '件' : '') + '）', function () {
      back.forEach(function (b) {
        var t = Store.get(b.sp, 'task', b.id);
        if (!t) return;
        ['time', 'dur', 'doOn', 'auto', 'autoAt'].forEach(function (k) { if (b[k] === undefined) delete t[k]; else t[k] = b[k]; });
        Store.put(b.sp, 'task', t);
      });
      delete planRuns[iso];
      if (opt.undo) opt.undo();
      renderAll();
    });
    return r;
  }

  /** 退勤：今の時刻で仕事を終わりにして、家に着いてからの残りを組む */
  function clockOut(iso) {
    var w = workOf(iso);
    if (!w || w.off) return;
    var now = nowMin(), prev = w.clockOut || '';
    w.clockOut = fromMin(now);
    Store.put('work', 'day', w);
    var sp = workSpan(iso);
    applyPlan(iso, { from: now + (sp ? sp.com : 0), label: '退勤しました。残りを組みました', undo: function () {
      var cur = workOf(iso);
      if (cur) { if (prev) cur.clockOut = prev; else delete cur.clockOut; Store.put('work', 'day', cur); }
    } });
  }

  /** その日の仕事を入れる・直す（会社の側の記録として同期する）。決めたら、その日を組む */
  function editWork(iso) {
    var w = workOf(iso), places = workplaces();
    var d = U.parse(iso), dow = String(d.getDay());
    var cur = { off: !!(w && w.off), place: (w && w.place) || (places[0] && places[0].id) || '', shift: (w && w.shift) || '',
                start: (w && w.start) || '', end: (w && w.end) || '' };
    if (!w && places[0]) { var r0 = ruleTimes(places[0], '', iso); if (r0) { cur.shift = r0.shift; cur.start = r0.start; cur.end = r0.end; } }
    if (!cur.start) { cur.start = '10:00'; cur.end = '22:00'; }
    modal('<h2>' + (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）の仕事</h2>'
      + '<div class="f"><label>どこで働くか</label><div class="seg3 wkplace" id="wk-place">'
      + places.map(function (p) { return '<button type="button" data-place="' + U.esc(p.id) + '"' + (!cur.off && cur.place === p.id ? ' class="on"' : '') + '>' + U.esc(p.name) + '</button>'; }).join('')
      + '<button type="button" data-place=""' + (cur.off ? ' class="on"' : '') + '>休み</button></div>'
      + (places.length ? '' : '<div class="hint" style="margin-top:6px">職場の決まりがまだ届いていません（同期を待つか、時間を手で入れてください）</div>') + '</div>'
      + '<div class="f" id="wk-shiftf" hidden><label>時間帯</label><div class="seg3" id="wk-shift"></div></div>'
      + '<div class="f" id="wk-times"' + (cur.off ? ' hidden' : '') + '><label>出勤 と 退勤</label><div class="f2">'
      + '<input type="time" id="wk-s" step="300" value="' + cur.start + '"><input type="time" id="wk-e" step="300" value="' + cur.end + '"></div>'
      + '<div class="hint" style="margin-top:6px" id="wk-hint"></div></div>'
      + '<div class="hint">決めると、この日の予定を組みます（出勤の前に入れられるものも入れます。あとから自分で直せます）。</div>'
      + '<div class="acts">' + (w ? '<button type="button" class="del" id="wk-del">消す</button>' : '')
      + '<button type="button" id="wk-cancel">やめる</button><button type="button" class="go" id="wk-ok">決める</button></div>',
      function (m) {
        var st = { off: cur.off, place: cur.place, shift: cur.shift };
        function hint() {
          var p = placeOf(st.place), s = m.querySelector('#wk-s').value, e = m.querySelector('#wk-e').value;
          m.querySelector('#wk-hint').textContent = (p ? '通勤は片道 ' + (p.commute || 0) + '分で組みます。' : '')
            + (s && e && toMin(e) <= toMin(s) ? '退勤は次の日の ' + e + ' です。' : '');
        }
        function paintShift(fill) {
          var p = placeOf(st.place), list = shiftsOf(p);
          m.querySelector('#wk-shiftf').hidden = st.off || list.length < 2;
          if (list.length && !list.some(function (s) { return s.id === st.shift; })) st.shift = list[0].id;
          m.querySelector('#wk-shift').innerHTML = list.map(function (s) {
            return '<button type="button" data-shift="' + U.esc(s.id) + '"' + (s.id === st.shift ? ' class="on"' : '') + '>' + U.esc(s.name || '通し') + '</button>';
          }).join('');
          if (fill && p) {
            var r = ruleTimes(p, st.shift, iso);
            if (r) { m.querySelector('#wk-s').value = r.start; m.querySelector('#wk-e').value = r.end; }
          }
          m.querySelector('#wk-times').hidden = st.off;
          hint();
        }
        paintShift(false);
        m.querySelector('#wk-place').addEventListener('click', function (e) {
          var b = e.target.closest('[data-place]');
          if (!b) return;
          st.off = !b.dataset.place; if (!st.off) st.place = b.dataset.place;
          m.querySelectorAll('#wk-place [data-place]').forEach(function (x) { x.classList.toggle('on', x === b); });
          paintShift(true);
        });
        m.querySelector('#wk-shift').addEventListener('click', function (e) {
          var b = e.target.closest('[data-shift]');
          if (!b) return;
          st.shift = b.dataset.shift;
          paintShift(true);
        });
        ['#wk-s', '#wk-e'].forEach(function (id) { m.querySelector(id).addEventListener('change', hint); });
        m.querySelector('#wk-cancel').onclick = closeModal;
        if (w) m.querySelector('#wk-del').onclick = function () { Store.remove('work', 'day', w.id); closeModal(); renderAll(); };
        m.querySelector('#wk-ok').onclick = function () {
          var s = m.querySelector('#wk-s').value, e = m.querySelector('#wk-e').value;
          if (!st.off && (!s || !e)) { toast('出勤と退勤を入れてください'); return; }
          if (!st.off && s === e) { toast('出勤と退勤が同じです'); return; }
          var rec = w || { id: 'day-w-' + iso, type: 'work', date: iso, createdAt: Date.now() };
          rec.off = st.off; rec.place = st.off ? '' : st.place; rec.shift = st.off ? '' : st.shift;
          rec.start = st.off ? '' : s; rec.end = st.off ? '' : e; rec.from = '';      // 手で決めた（Diem の取り込みより強い）
          delete rec.clockOut;
          rec.text = st.off ? '仕事 休み' : '仕事 ' + workName(rec) + ' ' + s + '〜' + e;
          Store.put('work', 'day', rec);
          closeModal();
          applyPlan(iso, { label: 'この日を組みました' });
        };
      });
  }

  /** 組み方の数（この端末だけ） */
  function editPlanConf() {
    var c = planConf();
    modal('<h2>自動で組むときの決まり</h2>'
      + '<div class="f"><label for="pc-sleep">睡眠の時間（時間）</label><input type="text" inputmode="decimal" id="pc-sleep" value="' + c.sleepH + '"></div>'
      + '<div class="f"><label for="pc-wake">予定が遅い日・無い日に起きる時刻</label><input type="time" id="pc-wake" step="300" value="' + c.wake + '"></div>'
      + '<div class="f"><label for="pc-prep">起きてから動き出すまで（分）</label><input type="text" inputmode="numeric" id="pc-prep" value="' + c.prepMin + '"></div>'
      + '<div class="f"><label for="pc-wind">寝る前のゆとり（分）</label><input type="text" inputmode="numeric" id="pc-wind" value="' + c.windMin + '"></div>'
      + '<div class="f"><label for="pc-gap">予定と予定のあいだ（分）</label><input type="text" inputmode="numeric" id="pc-gap" value="' + c.gapMin + '"></div>'
      + '<div class="hint">この端末だけの決まりです。通勤の時間は職場ごとに決まっています。タスクの長さは、タスクの「時刻と長さ」（無ければ30分）を使います。</div>'
      + '<div class="acts"><button type="button" id="pc-reset">はじめの値</button><button type="button" id="pc-cancel">やめる</button><button type="button" class="go" id="pc-ok">決める</button></div>',
      function (m) {
        m.querySelector('#pc-cancel').onclick = closeModal;
        m.querySelector('#pc-reset').onclick = function () { delete Store.ui().planConf; Store.saveUi(); closeModal(); renderAll(); };
        m.querySelector('#pc-ok').onclick = function () {
          var num = function (id) { return Number(String(m.querySelector(id).value).normalize('NFKC')); };
          Store.ui().planConf = { sleepH: num('#pc-sleep'), wake: m.querySelector('#pc-wake').value, prepMin: num('#pc-prep'), windMin: num('#pc-wind'), gapMin: num('#pc-gap') };
          Store.saveUi();
          closeModal(); renderAll();
        };
      });
  }

  /** 予定のページの上の「その日の組み立て」 */
  function planHead(iso, sl) {
    var w = workOf(iso), ws = workSpan(iso), c = planConf(), today = U.today();
    var work;
    if (!w) work = '<span class="pv dim">まだ入れていません</span><button type="button" class="mini" data-act="pwork">入れる</button>';
    else if (w.off) work = '<span class="pv">休み' + (w.from === 'diem' ? '<small>（Diem から）</small>' : '') + '</span><button type="button" class="mini" data-act="pwork">直す</button>';
    else work = '<span class="pv"><b>' + U.esc(workName(w)) + '</b> ' + U.esc(w.start) + '〜' + U.esc(w.clockOut || w.end)
      + (w.clockOut ? '<small>（退勤ずみ）</small>' : toMin(w.end) <= toMin(w.start) ? '<small>（次の日まで）</small>' : '')
      + (ws && ws.com ? '<small>・通勤 片道' + ws.com + '分</small>' : '') + '</span><button type="button" class="mini" data-act="pwork">直す</button>';
    var out = '';
    if (w && !w.off && iso === today) {
      out = w.clockOut
        ? '<div class="prow"><span class="pk"></span><span class="pv dim">' + U.esc(w.clockOut) + ' に退勤しました</span><button type="button" class="linkbtn" data-act="pclockback">取り消す</button></div>'
        : '<button type="button" class="clockout" data-act="pclockout">退勤する<small>（押すと、帰ってからの残りを組みます）</small></button>';
    }
    var run = planRuns[iso];
    var autoN = planItems(iso).filter(function (x) { return x.auto; }).length;
    var h = '<div class="card planhead">'
      + '<div class="prow"><span class="pk">仕事</span>' + work + '</div>' + out
      + '<div class="prow"><span class="pk">睡眠</span><span class="pv">起きる <b>' + clock(sl.wake) + '</b>・寝る <b>' + clock(sl.bed) + '</b>'
      + '<small>（' + hoursLabel(sl.sleep) + (sl.short ? '・<em>目標の' + c.sleepH + '時間に足りません</em>' : '') + '）</small></span></div>'
      + '<div class="pacts"><button type="button" class="mini go2" data-act="pauto">✦ ' + (autoN ? '組み直す' : '自動で組む') + '</button>'
      + '<span class="pauton">' + (autoN ? '自動で入れたもの ' + autoN + '件' : '') + '</span>'
      + '<button type="button" class="linkbtn" data-act="pconf">組み方の決まり</button></div>';
    if (run && run.left.length) {
      h += '<div class="pdleft"><b>入らなかったもの</b>' + run.left.map(function (x) {
        return '<div>・' + U.esc(x.t.title) + '<small>（' + label(x.sp) + '・' + U.esc(x.why) + '）</small></div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function renderPlan() {
    var iso = planDate || U.today();
    var d = U.parse(iso), today = U.today();
    var diff = U.daysFrom(iso);
    document.getElementById('planDate').innerHTML = '<b>' + (d.getMonth() + 1) + '月' + d.getDate() + '日</b>（' + DOW[d.getDay()] + '）'
      + (diff === 0 ? '<span class="rel now">今日</span>' : diff === 1 ? '<span class="rel">明日</span>' : diff === -1 ? '<span class="rel">昨日</span>' : '');
    document.getElementById('planToday').hidden = iso === today;

    var sl = sleepOf(iso), ws = workSpan(iso);
    // 前の日の仕事・通勤・睡眠が0時を越えてこの日にかかる分（例：3:30まで働いた次の日）
    var pw = workSpan(shiftIso(iso, -1)), pbed = sleepOf(shiftIso(iso, -1)).bed - 1440;
    var carry = pw && pw.e + pw.com > 1440 ? { e: pw.e - 1440, home: pw.e + pw.com - 1440, w: pw.w, com: pw.com } : null;
    var all = planItems(iso);
    var loose = all.filter(function (x) { return !x.time; });
    var timed = all.filter(function (x) { return x.time; }).map(function (x) {
      x.s = toMin(x.time); x.e = Math.min(1440, x.s + durOf(x.t)); return x;
    });
    layout(timed);

    var h = planHead(iso, sl);
    // 数の帯
    var doneN = all.filter(function (x) { return x.done; }).length;
    h += '<div class="plansum">' + (all.length
      ? '<span class="fact calm">予定 <b>' + all.length + '</b></span><span class="fact' + (doneN === all.length ? ' wait' : ' calm') + '">済み <b>' + doneN + '</b></span>'
      : '<span class="fact calm">この日の予定はありません</span>')
      + '<span class="legend"><i class="lg personal"></i>個人<i class="lg work"></i>会社<i class="lg habit"></i>習慣</span></div>';

    // 時間を決めていないもの
    if (loose.length) {
      loose.sort(function (a, b) { return (a.done - b.done) || (PRIO[prioOf(a.t)].rank - PRIO[prioOf(b.t)].rank); });
      h += '<div class="habithead">時間を決めていないもの<span>' + loose.length + '件</span></div><div class="card list">'
        + loose.map(function (x) {
            return '<div class="trow pl ' + x.sp + (x.habit ? ' habit' : '') + (x.done ? ' done' : '') + '" data-id="' + U.esc(x.t.id) + '" data-sp="' + x.sp + '" data-prio="' + prioOf(x.t) + '">'
              + planCheck(x)
              + '<button type="button" class="tbody" data-act="ptoggle"><span class="ttl">' + U.esc(x.t.title) + '</span>'
              + '<span class="sub"><span class="sptag ' + x.sp + '">' + label(x.sp) + '</span>'
              + (x.habit ? '<span class="reptag">↻ ' + U.esc(repeatLabel(x.t)) + '</span>' : '')
              + (x.habit && movedFrom(x.t, iso) ? '<span class="movetag">↪ ' + U.md(movedFrom(x.t, iso)) + 'の分</span>' : '')
              + prioBadge(x.t) + '</span></button>' + editBtn('pedit') + '</div>';
          }).join('') + '</div>';
    }

    // タイムテーブル：起きる1時間前から、寝た1時間後まで（0時を越えない）
    var startH = carry ? 0 : Math.max(0, Math.min(7, Math.floor(sl.wake / 60) - 1)), endH = 22;
    timed.forEach(function (x) { startH = Math.min(startH, Math.floor(x.s / 60)); endH = Math.max(endH, Math.ceil(x.e / 60)); });
    endH = Math.max(endH, Math.min(24, Math.ceil(sl.bed / 60) + 1));
    if (ws) { startH = Math.min(startH, Math.floor((ws.s - ws.com) / 60)); endH = Math.max(endH, Math.ceil(Math.min(1440, ws.e + ws.com) / 60)); }
    if (iso === today) {
      var nowM = nowMin();
      startH = Math.min(startH, Math.floor(nowM / 60)); endH = Math.max(endH, Math.ceil((nowM + 1) / 60));
    }
    endH = Math.min(24, endH);
    var top0 = startH * 60, bot0 = endH * 60;
    var px = function (m) { return (m - top0) * HOUR / 60; };
    /** 帯（睡眠・仕事・通勤）。札は予定の枠より上に出す（枠に隠れないように、帯とは別の重なりで） */
    function block(cls, s, e, text) {
      s = Math.max(s, top0); e = Math.min(e, bot0);
      if (e - s < 1) return '';
      return '<div class="' + cls + '" style="top:' + px(s) + 'px;height:' + (px(e) - px(s)) + 'px"></div>'
        + (text ? '<div class="bandlabel ' + cls + '-l" style="top:' + (px(s) + 2) + 'px">' + text + '</div>' : '');
    }
    h += '<div class="tt" style="height:' + ((endH - startH) * HOUR + 1) + 'px">';
    for (var hr = startH; hr < endH; hr++) {
      h += '<button type="button" class="slot" data-act="slot" data-h="' + hr + '" style="top:' + px(hr * 60) + 'px;height:' + HOUR + 'px" aria-label="' + hr + '時に足す">'
        + '<span class="hl">' + hr + ':00</span></button>';
    }
    // 睡眠（個人の色）・仕事と通勤（会社の色）
    h += block('sleepblock', Math.max(top0, pbed > 0 ? pbed : 0), sl.wake, '睡眠') + block('sleepblock', sl.bed, bot0, '睡眠');
    if (carry) {
      if (carry.e > 0) h += block('workband', 0, carry.e, U.esc(workName(carry.w)) + '（前の日から）〜' + clock(carry.e));
      if (carry.com) h += block('commute', Math.max(0, carry.e), carry.home, '通勤 ' + carry.com + '分');
    }
    if (ws) {
      h += block('workband', ws.s, ws.e, U.esc(workName(ws.w)) + ' ' + clock(ws.s) + '〜' + clock(ws.e));
      if (ws.com) h += block('commute', ws.s - ws.com, ws.s, '通勤 ' + ws.com + '分') + block('commute', ws.e, ws.e + ws.com, '通勤 ' + ws.com + '分');
    }
    if (sl.wake >= top0) h += '<div class="sleepline wake" style="top:' + px(sl.wake) + 'px"><span>起きる ' + clock(sl.wake) + '</span></div>';
    if (sl.bed < bot0) h += '<div class="sleepline bed" style="top:' + px(sl.bed) + 'px"><span>寝る ' + clock(sl.bed) + '</span></div>';
    timed.forEach(function (x) {
      var top = px(x.s), height = Math.max(24, px(x.e) - top - 2);
      var w = 100 / x.n;
      h += '<div class="ev ' + x.sp + (x.habit ? ' habit' : '') + (x.done ? ' done' : '') + (x.auto ? ' auto' : '') + (height < 40 ? ' short' : '') + '" data-id="' + U.esc(x.t.id) + '" data-sp="' + x.sp + '" data-prio="' + prioOf(x.t) + '"'
        + ' style="top:' + top + 'px;height:' + height + 'px;left:calc(46px + (100% - 52px) * ' + (x.col * w / 100) + ');width:calc((100% - 52px) * ' + (w / 100) + ' - 3px)">'
        + planCheck(x)
        + '<button type="button" class="evbody" data-act="pedit">'
        + '<span class="evt">' + U.esc(x.t.title) + '</span>'
        + '<span class="evs">' + x.time + '〜' + fromMin(toMin(x.time) + durOf(x.t)) + (x.habit ? ' ・↻' : '') + (x.auto ? ' ・自動' : '') + (x.habit && movedFrom(x.t, iso) ? ' ・↪移した' : '') + '</span>'
        + '</button></div>';
    });
    if (iso === today) {
      var nm = nowMin();
      h += '<div class="nowline" style="top:' + px(nm) + 'px"><span>' + fromMin(nm) + '</span></div>';
    }
    h += '</div>';
    h += '<div class="devnote plannote">空いている時間を押すと、その時刻で予定を足せます。「自動」と付いたものは自動で入れた時刻です。押して直すと、自分で決めた時刻になります。</div>';
    document.getElementById('planBody').innerHTML = h;

    // 今日を開いたら、いまの時刻が見えるところまで送る（初めの1回だけ）
    if (iso === today && !renderPlan.scrolled) {
      renderPlan.scrolled = true;
      var line = document.querySelector('#planBody .nowline');
      if (line) global.scrollTo(0, Math.max(0, line.getBoundingClientRect().top + global.scrollY - 260));
    }
  }

  /** 空いている時間を押したとき：その時刻で予定を足す（個人か会社かを選ぶ。はじめは今開いている側） */
  function addAtSlot(hr) {
    var iso = planDate || U.today(), sp = space();
    modal('<h2>' + (U.parse(iso).getMonth() + 1) + '/' + U.parse(iso).getDate() + ' の予定を足す</h2>'
      + '<div class="f"><label>どちらの予定か</label><div class="seg3" id="s-sp">'
      + Store.SPACES.map(function (x) { return '<button type="button" data-sp="' + x + '"' + (x === sp ? ' class="on"' : '') + '>' + U.esc(label(x)) + '</button>'; }).join('') + '</div></div>'
      + '<div class="f"><label for="s-title">やること</label><input type="text" id="s-title" enterkeyhint="done"></div>'
      + '<div class="f"><label for="s-time">時刻と長さ</label><div class="f2">'
      + '<input type="time" id="s-time" step="300" value="' + U.pad(hr) + ':00"><select id="s-dur">' + durOptions(60) + '</select></div></div>'
      + '<div class="f"><label>重要度</label>' + prioSeg('s-prio', 'mid') + '</div>'
      + '<div class="hint" id="s-rule"' + (sp === 'work' ? '' : ' hidden') + '>会社のタスクには、金額・氏名・IDを書かない</div>'
      + '<div class="acts"><button type="button" id="s-cancel">やめる</button><button type="button" class="go" id="s-ok">足す</button></div>',
      function (m) {
        var prio = 'mid';
        m.querySelectorAll('#s-sp [data-sp]').forEach(function (b) {
          b.onclick = function () {
            sp = b.dataset.sp;
            m.querySelectorAll('#s-sp [data-sp]').forEach(function (x) { x.classList.toggle('on', x === b); });
            m.querySelector('#s-rule').hidden = sp !== 'work';
          };
        });
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
          Store.put(sp, 'task', { title: title, prio: prio, due: '', doOn: iso, time: time, dur: +m.querySelector('#s-dur').value || 60,
                                  note: '', done: false, repeat: '', days: [] });
          closeModal(); renderAll(); toast(label(sp) + 'の予定を足しました');
        };
        m.querySelector('#s-ok').onclick = ok;
        m.querySelector('#s-title').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        setTimeout(function () { m.querySelector('#s-title').focus(); }, 50);
      });
  }

  /* ---------- Diem の休み（2026-10-23 ko-dai さんの願い） ----------
     Diem（2人のカレンダー）に入れた自分の「休み」の予定を読んで、その日を仕事の休みにし、その日を組む。
       ・読むだけ。Diem には何も書かない。読んだ予定の中身も残さない（休みの日付だけを使う）
       ・★Diem の「自分だけ」の予定は、Diem の受け口に送られない（端末の中だけ）ので読めない。「2人で共有」で入れた休みだけが届く
       ・自分の休みかは、予定を入れた人の名前（Diem の「自分の名前」）で見分ける（相手の休みを拾わないため）
       ・題に休みの言葉（はじめは「休み」）がふくまれる予定。何日かにまたがる予定と、くり返し（毎週・毎月・毎年）も読む
       ・今日から30日先まで。手で仕事を入れた日は上書きしない。Diem で消えた休みは、取り込んだ休みだけを外す
       ・つなぎ先は Diem の公開ページ（../Diem/js/config.js）から読む。合言葉と名前は端末ごとに入れる（tb.diem。送らない）
       ・読むのは、アプリを開いたとき・表に戻ったとき・予定のページを開いたとき（10分に1回まで）と、設定の「今すぐ読む」 */
  var KEY_DIEM = 'tb.diem', diemAt = 0, diemBusy = false;
  function diemConf() { try { return JSON.parse(localStorage.getItem(KEY_DIEM)) || {}; } catch (e) { return {}; } }
  function diemSave(c) { try { localStorage.setItem(KEY_DIEM, JSON.stringify(c)); } catch (e) {} }
  function diemOn() { var c = diemConf(); return !!(c.pin && c.me); }
  function diemUrl(c) {
    if (c.url) return Promise.resolve(c.url);
    return fetch('../Diem/js/config.js', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var m = t.match(/syncUrl:\s*'(https:\/\/script\.google\.com\/[^']+\/exec)'/);
      if (!m) throw new Error('Diem のつなぎ先が見つかりません');
      return m[1];
    });
  }
  /** その日に、この Diem の予定があるか（Diem の calendar.js と同じ決め方） */
  function diemOccurs(e, ds) {
    var r = e.repeat || (e.yearly ? 'year' : '');
    if (!r) return ds >= e.start && ds <= (e.end || e.start);
    if (ds < e.start || (e.until && ds > e.until)) return false;
    if (r === 'week') return Math.round((U.parse(ds) - U.parse(e.start)) / 86400000) % 7 === 0;
    var y = +ds.slice(0, 4), mo = r === 'month' ? +ds.slice(5, 7) : +e.start.slice(5, 7);
    var last = new Date(y, mo, 0).getDate();
    return y + '-' + U.pad(mo) + '-' + U.pad(Math.min(+e.start.slice(8, 10), last)) === ds;
  }
  function diemImport(force) {
    var c = diemConf();
    if (!diemOn() || diemBusy || (!force && Date.now() - diemAt < 10 * 60000)) return Promise.resolve(null);
    diemBusy = true; diemAt = Date.now();
    return diemUrl(c).then(function (u) {
      return Sync.call(u, { pin: c.pin, action: 'pull', since: 0 });
    }).then(function (res) {
      var word = String(c.word || '休み').normalize('NFKC').trim() || '休み', me = String(c.me).trim(), events = [];
      (res.rows || []).forEach(function (row) {
        if (row.kind !== 'event' || row.deleted) return;
        var e;
        try { e = JSON.parse(row.json); } catch (er) { return; }
        if (!e || e.deleted || !/^\d{4}-\d\d-\d\d$/.test(e.start || '')) return;
        if (String(e.title || '').normalize('NFKC').indexOf(word) < 0) return;
        if (String(e.owner || row.by || '').trim() !== me) return;
        events.push(e);
      });
      var today = U.today(), end = shiftIso(today, 30), days = {}, added = [], removed = 0;
      for (var i = 0; i <= 30; i++) {
        var ds = shiftIso(today, i);
        if (events.some(function (e) { return diemOccurs(e, ds); })) days[ds] = true;
      }
      Object.keys(days).forEach(function (ds) {
        var w = Store.get('work', 'day', 'day-w-' + ds);
        if (w && !w.deleted) return;                  // 手で入れた日・取り込みずみの日は、そのまま
        Store.put('work', 'day', { id: 'day-w-' + ds, type: 'work', date: ds, off: true, place: '', shift: '', start: '', end: '',
                                   from: 'diem', text: '仕事 休み（Diem）', createdAt: Date.now() });
        added.push(ds);
      });
      Store.list('work', 'day').forEach(function (w) {
        if (w.type === 'work' && w.from === 'diem' && w.date >= today && w.date <= end && !days[w.date]) { Store.remove('work', 'day', w.id); removed++; }
      });
      added.forEach(function (ds) { applyPlan(ds, { quiet: true }); });   // 休みになった日を組む
      c = diemConf(); c.lastAt = Date.now(); c.lastN = Object.keys(days).length; c.err = ''; diemSave(c);
      diemBusy = false;
      if (added.length || removed) {
        renderAll();
        toast('Diem の休みを取り込みました（' + (added.length ? added.length + '日を休みにして組みました' : '') + (removed ? (added.length ? '・' : '') + removed + '日を外しました' : '') + '）');
      } else if (view === 'set') renderSettings();
      return { days: Object.keys(days).length, added: added.length, removed: removed };
    }).catch(function (e) {
      diemBusy = false;
      c = diemConf(); c.err = e.message || String(e); c.lastAt = Date.now(); diemSave(c);
      if (view === 'set') renderSettings();
      if (force) throw e;
      return null;
    });
  }

  /** 設定：Diem とつなぐ（合言葉・自分の名前・休みの言葉。この端末だけ） */
  function diemConnect() {
    var c = diemConf();
    modal('<h2>Diem の休みを読む</h2>'
      + '<div class="hint">Diem に「休み」の予定を入れると、その日を仕事の休みにして、その日を自動で組みます。Diem には何も書きません。<br>'
      + '★Diem で「2人で共有」にした予定だけが読めます（「自分だけ」の予定は、Diem の外に出ないため）。</div>'
      + '<div class="f"><label for="dm-pin">Diem の合言葉</label><input type="text" id="dm-pin" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + U.esc(c.pin || '') + '"></div>'
      + '<div class="f"><label for="dm-me">Diem での自分の名前（Diem の設定の「自分の名前」と同じに）</label><input type="text" id="dm-me" value="' + U.esc(c.me || '') + '"></div>'
      + '<div class="f"><label for="dm-word">休みの予定の言葉（題にこの言葉がふくまれる予定を休みとして読む）</label><input type="text" id="dm-word" value="' + U.esc(c.word || '休み') + '"></div>'
      + '<details class="f"><summary class="hint">つなぎ先を手で入れる（ふだんは空のまま）</summary><input type="text" id="dm-url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="' + U.esc(c.url || '') + '"></details>'
      + '<div class="acts">' + (c.pin ? '<button type="button" class="del" id="dm-off">やめる</button>' : '')
      + '<button type="button" id="dm-cancel">閉じる</button><button type="button" class="go" id="dm-ok">つないで読む</button></div>',
      function (m) {
        m.querySelector('#dm-cancel').onclick = closeModal;
        if (c.pin) m.querySelector('#dm-off').onclick = function () {
          if (!global.confirm('Diem の休みを読むのをやめます（取り込んだ休みの日は、そのまま残ります）')) return;
          localStorage.removeItem(KEY_DIEM); closeModal(); renderAll(); toast('Diem を読むのをやめました');
        };
        m.querySelector('#dm-ok').onclick = function () {
          var n = { pin: m.querySelector('#dm-pin').value.trim(), me: m.querySelector('#dm-me').value.trim(),
                    word: m.querySelector('#dm-word').value.trim() || '休み', url: m.querySelector('#dm-url').value.trim() };
          if (!n.pin || !n.me) { toast('合言葉と自分の名前を入れてください'); return; }
          if (n.url && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(n.url)) { toast('つなぎ先は https://script.google.com/…/exec の形です'); return; }
          diemSave(n);
          var btn = this; btn.disabled = true; btn.textContent = '読んでいます…';
          diemImport(true).then(function (r) {
            closeModal(); renderAll();
            toast('Diem とつなぎました（30日先までの休み ' + (r ? r.days : 0) + '日）');
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = 'つないで読む';
            global.alert('Diem を読めませんでした：\n' + (e.message || e));
          });
        };
      });
  }

  /* ================= メモ ================= */
  /** 書いた分だけ欄を伸ばす。★欄の中では動かさず、全文を出して、ページ（別窓）のほうを動かす（2026-10-14 ko-dai さん）。
      空なら元の高さに戻す。測り直す一瞬だけ欄が縮むので、動かしていた位置を覚えておいて戻す（打つたびに跳ねないように） */
  function grow(el) {
    var sc = el.closest('.modal') || document.scrollingElement || document.documentElement;
    var top = sc.scrollTop;
    el.style.height = '';
    if (el.value) el.style.height = (el.scrollHeight + 2) + 'px';
    sc.scrollTop = top;
  }
  /** 開いたときに伸ばし、打つたびに伸ばし直す */
  function autoGrow(el) {
    if (!el) return;
    grow(el);
    el.addEventListener('input', function () { grow(el); });
  }

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
        autoGrow(m.querySelector('#m-text'));
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

  /* ================= 買い出し（会社の側だけ。2026-10-13 ko-dai さんの願い・2026-10-23 作り直し） =================
     いつも使うものを「買い出し先」（ダイソー・セリア…）ごとに並べた一覧。いつも全部出ている。
     買うものができたら、その品物に店舗ごとの個数を入れる。個数の入ったものが「今回買うもの」。
     買ったらチェック → 個数が消えて、品物は一覧に残る（単発のものは消える）。
       ・記録は memo の入れ物に同居（受け口の GAS は task と memo しか受けないため）。印はどれも src:'buy'・buy- で始まる id。
         type で3つに分ける
           'conf'  … 店舗の名前（id は buy-conf の1つだけ）。{ stores:[{id, name}] }
                     ★店舗の名前はコードに書かない（公開しているコードから、勤め先の店が分からないように）。
                       受け口のシートにだけある。最初の2つは Mac から入れた（2026-10-23）
           'place' … 買い出し先。{ text:名前, once:単発か, order }
           'item'  … 買うもの。{ text:名前, to:買い出し先の id（空ならその他）, once, want:{店舗id:個数}, note, order, lastAt }
       ・単発（once）：買い出し先も買うものも、あとから「今回だけ」のものとして足せる。
         単発の買うものは、買ったら消える。単発の買い出し先は、中の品物が無くなったら消える
       ・絞り込み（今回買うもの・店舗・買い出し先）は、この端末の画面の覚えとして持つ（tb.ui の buyF）
       ・Obsidian へは書き出さない（書き出す.py が飛ばす）。Diem は task しか読まないので、そちらにも出ない */
  var BUYSP = 'work', BUY_CONF = 'buy-conf';

  function buyKey(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }
  /** 個数は min〜999 の整数にそろえる（全角の数字でもよい） */
  function buyCount(v, min) {
    min = min == null ? 1 : min;
    var n = parseInt(String(v == null ? '' : v).normalize('NFKC'), 10);
    return isNaN(n) || n < min ? min : Math.min(n, 999);
  }
  /** −／＋ のボタンで、となりの個数の欄を1つずつ動かす（下限は欄の min） */
  function stepCount(btn) {
    var box = btn.closest('.stepper'), input = box && box.querySelector('input');
    if (!input) return;
    var min = Number(input.min) || 0;
    input.value = buyCount(buyCount(input.value, min) + Number(btn.dataset.step), min);
  }

  function buyType(r) { return r.type || 'item'; }
  function byOrder(a, b) { return (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0); }
  function buyConf() { var c = Store.get(BUYSP, 'buy', BUY_CONF); return c && !c.deleted ? c : null; }
  function buyStores() { var c = buyConf(); return ((c && c.stores) || []).filter(function (x) { return x && x.id && x.name; }); }
  function buyPlaces() { return Store.list(BUYSP, 'buy').filter(function (r) { return buyType(r) === 'place'; }).sort(byOrder); }
  function buyItems() { return Store.list(BUYSP, 'buy').filter(function (r) { return buyType(r) === 'item'; }); }
  /** 個数の入っている分だけ（0や壊れた値は落とす） */
  function wantOf(it) {
    var w = it.want || {}, out = {};
    Object.keys(w).forEach(function (k) { var n = Number(w[k]); if (n > 0) out[k] = Math.min(999, Math.floor(n)); });
    return out;
  }
  function wantN(it, store) {
    var w = wantOf(it);
    return store ? (w[store] || 0) : Object.keys(w).reduce(function (t, k) { return t + w[k]; }, 0);
  }
  function buyNeedCount() { return buyItems().filter(function (it) { return wantN(it) > 0; }).length; }
  function buyF() {
    var u = Store.ui();
    if (!u.buyF || typeof u.buyF !== 'object') u.buyF = { need: false, store: '', place: '' };
    return u.buyF;
  }

  function buyRow(it, stores, onlyStore) {
    var w = wantOf(it), need = Object.keys(w).length > 0, known = {};
    var chips = stores.filter(function (x) { known[x.id] = true; return w[x.id] && (!onlyStore || onlyStore === x.id); })
      .map(function (x) { return '<span class="want">' + U.esc(x.name) + ' <b>' + w[x.id] + '</b></span>'; }).join('');
    // 店舗の名前が消えたあとに残った個数も、数だけは出す（黙って見えなくしない）
    Object.keys(w).forEach(function (k) { if (!known[k] && !onlyStore) chips += '<span class="want">店舗？ <b>' + w[k] + '</b></span>'; });
    return '<div class="trow buy' + (need ? ' need' : '') + '" data-id="' + U.esc(it.id) + '">'
      + (need
        ? '<button type="button" class="ck" data-act="bbought" aria-label="買った">'
          + '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
        : '<button type="button" class="ck ro" data-act="bopen" aria-label="今回買う個数を入れる"></button>')
      + '<button type="button" class="tbody" data-act="bopen">'
      + '<span class="ttl">' + U.esc(it.text) + '</span>'
      + (it.once ? '<span class="oncetag">単発</span>' : '')
      + (it.note ? '<span class="hasnote">メモあり</span>' : '')
      + '<span class="wants">' + (chips || '<span class="wadd">個数</span>') + '</span>'
      + '</button></div>';
  }

  function renderBuy() {
    var f = buyF(), stores = buyStores(), places = buyPlaces(), items = buyItems();
    var known = {};
    places.forEach(function (p) { known[p.id] = true; });
    if (f.store && !stores.some(function (x) { return x.id === f.store; })) f.store = '';
    if (f.place && f.place !== '-' && !known[f.place]) f.place = '';
    var others = items.filter(function (it) { return !it.to || !known[it.to]; });

    var h = '<div class="bfilter">'
      + '<button type="button" class="chip' + (f.need ? ' on' : '') + '" data-fneed="1">今回買うもの <b>' + buyNeedCount() + '</b></button>'
      + (stores.length ? '<div class="seg3 bstore">' + [{ id: '', name: 'すべて' }].concat(stores).map(function (x) {
          return '<button type="button" data-fstore="' + U.esc(x.id) + '"' + (f.store === x.id ? ' class="on"' : '') + '>' + U.esc(x.name) + '</button>';
        }).join('') + '</div>' : '')
      + '</div>'
      + '<div class="bplaces">' + [{ id: '', text: 'すべての買い出し先' }].concat(places, others.length ? [{ id: '-', text: 'その他' }] : []).map(function (p) {
          return '<button type="button" class="chip' + (f.place === p.id ? ' on' : '') + '" data-fplace="' + U.esc(p.id) + '">' + U.esc(p.text) + '</button>';
        }).join('') + '</div>';
    if (!stores.length) {
      h += '<div class="warnbox">店舗の名前がまだありません（個数は店舗ごとに入れます）。 <button type="button" class="mini" data-act="bstores">店舗を決める</button></div>';
    }
    h += '<div class="bacts"><button type="button" class="mini go2" data-act="badd">＋ 買うもの</button>'
      + '<button type="button" class="mini" data-act="baddplace">＋ 買い出し先</button></div>';

    var secs = places.map(function (p) { return { place: p, items: items.filter(function (it) { return it.to === p.id; }) }; });
    if (others.length) secs.push({ place: null, items: others });
    var filtering = f.need || f.store || f.place, shown = 0;
    secs.forEach(function (sec) {
      var pid = sec.place ? sec.place.id : '-';
      if (f.place && f.place !== pid) return;
      var list = sec.items.filter(function (it) {
        if (f.store) return wantN(it, f.store) > 0;
        if (f.need) return wantN(it) > 0;
        return true;
      }).sort(byOrder);
      if (filtering && !list.length) return;
      var need = sec.items.filter(function (it) { return wantN(it) > 0; }).length;
      h += '<div class="agroup bhead">' + U.esc(sec.place ? sec.place.text : 'その他')
        + (sec.place && sec.place.once ? '<span class="oncetag">単発</span>' : '')
        + '<span>' + (need ? '今回 ' + need + '・' : '') + sec.items.length + '品</span>'
        + (sec.place ? '<button type="button" class="bmore" data-act="bplace" data-pid="' + U.esc(pid) + '" aria-label="買い出し先を直す">…</button>' : '<i class="bsp"></i>')
        + '<button type="button" class="bplus" data-act="badd" data-to="' + U.esc(pid) + '" aria-label="ここに買うものを足す">＋</button></div>';
      h += list.length
        ? '<div class="card list">' + list.map(function (it) { return buyRow(it, stores, f.store); }).join('') + '</div>'
        : '<div class="bempty">まだ品物がありません。右の＋で足せます</div>';
      shown += list.length;
    });
    if (filtering && !shown) {
      h += '<div class="empty art">' + STAR + '<b>当てはまるものはありません</b>絞り込みを外すと、全部の品物が出ます</div>';
    } else if (!secs.length) {
      h += '<div class="empty art">' + STAR + '<b>買い出し先がありません</b>上の「＋ 買い出し先」から足してください</div>';
    }
    if (stores.length) h += '<div class="buyfoot"><button type="button" class="linkbtn" data-act="bstores">店舗の名前を直す</button></div>';
    document.getElementById('buyBody').innerHTML = h;
  }

  /** 買った：個数を消す。単発の品物は消し、空になった単発の買い出し先も消す */
  function buyBought(id) {
    var it = Store.get(BUYSP, 'buy', id);
    if (!it) return;
    var before = wantOf(it), lastBefore = it.lastAt || 0, placeGone = '';
    if (it.once) Store.remove(BUYSP, 'buy', id);
    else { it.want = {}; it.lastAt = Date.now(); Store.put(BUYSP, 'buy', it); }
    var p = it.to ? Store.get(BUYSP, 'buy', it.to) : null;
    if (p && !p.deleted && p.once && !buyItems().some(function (x) { return x.to === p.id; })) {
      Store.remove(BUYSP, 'buy', p.id); placeGone = p.id;
    }
    renderAll();
    toast('買いました', function () {
      if (placeGone) { var q = Store.get(BUYSP, 'buy', placeGone); if (q) { delete q.deleted; Store.put(BUYSP, 'buy', q); } }
      var cur = Store.get(BUYSP, 'buy', id);
      if (!cur) return;
      delete cur.deleted; cur.want = before; cur.lastAt = lastBefore;
      Store.put(BUYSP, 'buy', cur);
      renderAll();
    });
  }

  function onceSeg(id, on) {
    return '<div class="seg3 bonce" id="' + id + '">'
      + '<button type="button" data-once="0"' + (on ? '' : ' class="on"') + '>いつもの</button>'
      + '<button type="button" data-once="1"' + (on ? ' class="on"' : '') + '>今回だけ（単発）</button></div>';
  }
  function onceWire(m, id) {
    m.querySelectorAll('#' + id + ' [data-once]').forEach(function (b) {
      b.onclick = function () { m.querySelectorAll('#' + id + ' [data-once]').forEach(function (x) { x.classList.toggle('on', x === b); }); };
    });
  }
  function onceOf(m, id) { var on = m.querySelector('#' + id + ' .on'); return !!(on && on.dataset.once === '1'); }
  function stepperHtml(store, n) {
    return '<div class="stepper" data-store="' + U.esc(store) + '">'
      + '<button type="button" data-step="-1" aria-label="1つ減らす">−</button>'
      + '<input type="number" inputmode="numeric" min="0" max="999" value="' + n + '" aria-label="個数">'
      + '<button type="button" data-step="1" aria-label="1つ増やす">＋</button></div>';
  }

  /** 買うものを足す・直す。id が無ければ足す（toPre はその買い出し先に足すとき） */
  function buyEdit(id, toPre) {
    var it = id ? Store.get(BUYSP, 'buy', id) : null;
    if (id && !it) return;
    var stores = buyStores(), places = buyPlaces(), want = it ? wantOf(it) : {};
    var to = it ? (it.to || '') : (toPre && toPre !== '-' ? toPre : '');
    if (to && !places.some(function (p) { return p.id === to; })) to = '';
    modal('<h2>' + (it ? '買うもの' : '買うものを足す') + '</h2>'
      + '<div class="f"><label for="w-text">買うもの</label><input type="text" id="w-text" maxlength="80" value="' + U.esc(it ? it.text : '') + '"></div>'
      + '<div class="bsec">今回買う個数<span>（0なら買わない）</span></div>'
      + (stores.length
        ? stores.map(function (x) {
            return '<div class="bwrow"><span class="bwname">' + U.esc(x.name) + '</span>' + stepperHtml(x.id, want[x.id] || 0) + '</div>';
          }).join('')
        : '<div class="hint">店舗の名前がまだありません。一覧の「店舗を決める」から決めると、ここで個数を入れられます。</div>')
      + '<div class="bsec">品物</div>'
      + '<div class="f"><label for="w-to">買い出し先</label><select id="w-to">'
      + places.map(function (p) { return '<option value="' + U.esc(p.id) + '"' + (p.id === to ? ' selected' : '') + '>' + U.esc(p.text) + (p.once ? '（単発）' : '') + '</option>'; }).join('')
      + '<option value=""' + (to ? '' : ' selected') + '>その他（決めていない）</option>'
      + '<option value="+">＋ 新しい買い出し先…</option></select></div>'
      + '<div class="f" id="w-np" hidden><label for="w-npname">新しい買い出し先の名前</label><input type="text" id="w-npname" maxlength="40">'
      + '<div style="margin-top:8px">' + onceSeg('w-nponce', false) + '</div></div>'
      + '<div class="f"><label>種類</label>' + onceSeg('w-once', it ? !!it.once : false)
      + '<div class="hint" style="margin-top:6px">「今回だけ」は、買ったら一覧から消えます</div></div>'
      + '<div class="f"><label for="w-note">メモ（売り場・銘柄など。空でもよい）</label><textarea id="w-note" rows="2" maxlength="1000">' + U.esc(it ? it.note || '' : '') + '</textarea></div>'
      + (it && it.lastAt ? '<div class="hint">前に買った日：' + U.esc(U.md(U.iso(new Date(it.lastAt)))) + '</div>' : '')
      + '<div class="acts">' + (it ? '<button type="button" class="del" id="w-del">消す</button>' : '')
      + '<button type="button" id="w-cancel">やめる</button><button type="button" class="go" id="w-ok">' + (it ? '決める' : '足す') + '</button></div>',
      function (m) {
        autoGrow(m.querySelector('#w-note'));
        m.querySelectorAll('[data-step]').forEach(function (b) { b.onclick = function () { stepCount(b); }; });
        onceWire(m, 'w-once'); onceWire(m, 'w-nponce');
        m.querySelector('#w-to').onchange = function () { m.querySelector('#w-np').hidden = this.value !== '+'; };
        m.querySelector('#w-cancel').onclick = closeModal;
        if (it) m.querySelector('#w-del').onclick = function () {
          Store.remove(BUYSP, 'buy', id);
          closeModal(); renderAll();
          toast('消しました', function () {
            var cur = Store.get(BUYSP, 'buy', id);
            if (!cur) return;
            delete cur.deleted;
            Store.put(BUYSP, 'buy', cur);
            renderAll();
          });
        };
        m.querySelector('#w-ok').onclick = function () {
          var text = m.querySelector('#w-text').value.trim(), note = m.querySelector('#w-note').value.trim();
          var dest = m.querySelector('#w-to').value, npName = m.querySelector('#w-npname').value.trim();
          if (!text) { toast('買うものの名前を入れてください'); return; }
          if (dest === '+' && !npName) { toast('新しい買い出し先の名前を入れてください'); return; }
          if (!confirmWork(text + ' ' + note + ' ' + npName, BUYSP)) return;
          var w = {};
          m.querySelectorAll('.stepper[data-store]').forEach(function (box) {
            var n = buyCount(box.querySelector('input').value, 0);
            if (n > 0) w[box.dataset.store] = n;
          });
          if (dest === '+') {
            var np = Store.put(BUYSP, 'buy', { type: 'place', text: npName, once: onceOf(m, 'w-nponce'), order: Date.now() });
            dest = np.id;
          }
          var once = onceOf(m, 'w-once');
          if (!it) {
            // 同じ買い出し先に同じ名前があれば、増やさずにそちらへ個数を入れる
            var same = buyItems().filter(function (x) { return (x.to || '') === dest && buyKey(x.text) === buyKey(text); })[0];
            if (same) {
              Object.keys(w).forEach(function (k) { same.want = same.want || {}; same.want[k] = w[k]; });
              if (note) same.note = note;
              Store.put(BUYSP, 'buy', same);
              closeModal(); renderAll(); toast('もう一覧にありました（個数を入れました）');
              return;
            }
            Store.put(BUYSP, 'buy', { type: 'item', text: text, to: dest, once: once, want: w, note: note, order: Date.now() });
          } else {
            it.text = text; it.to = dest; it.once = once; it.want = w; it.note = note;
            Store.put(BUYSP, 'buy', it);
          }
          closeModal(); renderAll();
        };
        if (!it) setTimeout(function () { var el = m.querySelector('#w-text'); if (el) el.focus(); }, 50);
      });
  }

  /** 買い出し先を足す・直す・消す */
  function placeEdit(id) {
    var p = id ? Store.get(BUYSP, 'buy', id) : null;
    if (id && !p) return;
    var inside = p ? buyItems().filter(function (x) { return x.to === p.id; }) : [];
    modal('<h2>' + (p ? '買い出し先' : '買い出し先を足す') + '</h2>'
      + '<div class="f"><label for="pl-text">名前</label><input type="text" id="pl-text" maxlength="40" value="' + U.esc(p ? p.text : '') + '"></div>'
      + '<div class="f"><label>種類</label>' + onceSeg('pl-once', p ? !!p.once : false)
      + '<div class="hint" style="margin-top:6px">「今回だけ」の買い出し先は、中の品物を全部買うと消えます</div></div>'
      + '<div class="acts">' + (p ? '<button type="button" class="del" id="pl-del">消す</button>' : '')
      + '<button type="button" id="pl-cancel">やめる</button><button type="button" class="go" id="pl-ok">' + (p ? '決める' : '足す') + '</button></div>',
      function (m) {
        onceWire(m, 'pl-once');
        m.querySelector('#pl-cancel').onclick = closeModal;
        if (p) m.querySelector('#pl-del').onclick = function () {
          if (!global.confirm('「' + p.text + '」を消します。' + (inside.length ? '\n中の品物 ' + inside.length + '件も一緒に消えます。' : '') + '\n\nよろしいですか？')) return;
          inside.forEach(function (x) { Store.remove(BUYSP, 'buy', x.id); });
          Store.remove(BUYSP, 'buy', p.id);
          if (buyF().place === p.id) buyF().place = '';
          closeModal(); renderAll(); toast('消しました');
        };
        m.querySelector('#pl-ok').onclick = function () {
          var text = m.querySelector('#pl-text').value.trim();
          if (!text) { toast('名前を入れてください'); return; }
          if (!confirmWork(text, BUYSP)) return;
          if (p) { p.text = text; p.once = onceOf(m, 'pl-once'); Store.put(BUYSP, 'buy', p); }
          else Store.put(BUYSP, 'buy', { type: 'place', text: text, once: onceOf(m, 'pl-once'), order: Date.now() });
          closeModal(); renderAll();
        };
        if (!p) setTimeout(function () { var el = m.querySelector('#pl-text'); if (el) el.focus(); }, 50);
      });
  }

  /** 店舗の名前を決める・直す。名前は記録にだけ持つ（コードには書かない）。個数は店舗の id で持つので、名前を直しても個数は残る */
  function storesEdit() {
    var c = buyConf(), stores = buyStores();
    var rows = stores.concat([{ id: '', name: '' }, { id: '', name: '' }]).slice(0, Math.max(stores.length + 1, 2));
    modal('<h2>店舗の名前</h2>'
      + '<div class="hint">買うものの個数は、ここの店舗ごとに入れます。空にした店舗は外れます。</div>'
      + rows.map(function (x, i) {
          return '<div class="f"><input type="text" class="st-name" data-id="' + U.esc(x.id) + '" maxlength="20" value="' + U.esc(x.name) + '" placeholder="店舗' + (i + 1) + 'の名前"></div>';
        }).join('')
      + '<div class="acts"><button type="button" id="st-cancel">やめる</button><button type="button" class="go" id="st-ok">決める</button></div>',
      function (m) {
        m.querySelector('#st-cancel').onclick = closeModal;
        m.querySelector('#st-ok').onclick = function () {
          var list = [];
          m.querySelectorAll('.st-name').forEach(function (el) {
            var name = el.value.trim();
            if (name) list.push({ id: el.dataset.id || 's' + Date.now().toString(36) + list.length, name: name });
          });
          if (!list.length) { toast('店舗を1つ以上入れてください'); return; }
          var rec = c || { id: BUY_CONF, type: 'conf', text: '買い出しの店舗', createdAt: Date.now() };
          rec.stores = list;
          Store.put(BUYSP, 'buy', rec);
          closeModal(); renderAll();
        };
      });
  }

  /* ================= 自作アプリ（個人の側だけ・ロックつき。2026-10-11 ko-dai さんの願い） =================
     自分で作ったアプリの名称とURLの一覧。★中身は、決めたパスワードで暗号にして持つ（js/lock.js）
       ・★どこにも記録を残さない（2026-10-11 ko-dai さん）。この端末の中（tb.apps）にだけ置く。
         受け口へ送らない・受け口から受け取らない・控えに入れない・Obsidian に書き出さない（js/store.js）
         → 端末ごとに別々の一覧になる。パスワードも端末ごと
       ・app-lock … 鍵のもと（salt・回数）と、パスワードが合っているかを確かめる箱。1つだけ
       ・app-bio … 生体認証で開けるための箱（使うと決めた端末にだけある。下の「生体認証で開ける」）
       ・app-xxxx … アプリ1つ。box に {name, url, group, order, qr} を暗号にして入れる。★暗号でない名称やURLは、端末にも持たない
           group … まとめる見出し（空でもよい）／order … 並び（足した順）
           qr … 自分で入れた QRコードの画像（無ければ、URL からその場で作る。js/qr.js。作った絵は残さない）
       ・★パスワードと鍵は、残さない・送らない。開いている間だけ、下の vault の中にある
       ・ほかのタブに移る／1分より長く裏に回る／5分さわらない → ロックする（開いた中身も画面から消す） */
  var APPSP = 'personal', LOCK_ID = 'app-lock', KEY_FAIL = 'tb.applock.fail';
  var Lock = TB.Lock;
  var vault = null;          // 開いている間だけ { key, salt, items:[{id,name,url,group,order,qr}], bad:[id], touched }
  var appsBusy = false, appsModal = false, appsSeq = 0;

  function lockHead() {
    var h = Store.get(APPSP, 'app', LOCK_ID);
    return h && h.salt && h.box ? h : null;
  }
  function appRecs() { return Store.list(APPSP, 'app').filter(function (r) { return r.id !== LOCK_ID && r.id !== BIO_ID; }); }
  function say(id, text, bad) {
    var el = document.getElementById(id);
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }

  /** ロックする。鍵を捨て、開いた中身と、打ちかけの文字を画面から消す */
  function lockApps() {
    vault = null;
    appsSeq++;
    document.getElementById('appList').innerHTML = '';
    document.getElementById('appsCount').textContent = '';
    document.getElementById('appGroups').innerHTML = '';
    ['appGroup', 'appName', 'appUrl', 'lockPass', 'setPass1', 'setPass2'].forEach(function (id) { document.getElementById(id).value = ''; });
    say('lockMsg', ''); say('setMsg', '');
    if (appsModal) closeModal();
  }

  function appsMode() {
    if (!Lock.ok()) return 'no';
    var h = lockHead();
    // 鍵のもとが替わっていたら（別の窓で変えた・決め直した）、いまの鍵では開かないのでロックに戻す
    if (vault && (!h || h.salt !== vault.salt)) lockApps();
    return !h ? 'setup' : vault ? 'open' : 'locked';
  }

  /* 形（決める／ロック中／開いている）を入れ替えるだけ。欄は index.html に置いてあるので、
     同期で描き直しても、打ちかけのパスワードや名称は消えない */
  function renderApps() {
    var mode = appsMode();
    ['setup', 'locked', 'open', 'no'].forEach(function (m) { document.getElementById('apps-' + m).hidden = m !== mode; });
    bioCheck(); paintBio();
    if (mode === 'open') refreshApps();
  }

  /** 記録を全部開けて、一覧を描き直す。開かないもの（ほかのパスワードで入れたもの）は数だけ出す */
  function refreshApps() {
    var v = vault, seq = ++appsSeq;
    return Promise.all(appRecs().map(function (r) {
      return Lock.open(v.key, r.box).then(function (o) {
        return {
          id: r.id, name: String(o.name || ''), url: String(o.url || ''), group: String(o.group || ''),
          order: Number(o.order) || r.createdAt || 0, qr: okQr(o.qr) ? o.qr : ''
        };
      }, function () { return { id: r.id, bad: true }; });
    })).then(function (all) {
      if (vault !== v || seq !== appsSeq) return;
      v.items = all.filter(function (a) { return !a.bad; }).sort(function (a, b) { return a.order - b.order; });
      v.bad = all.filter(function (a) { return a.bad; }).map(function (a) { return a.id; });
      paintApps();
    });
  }
  function findApp(id) { return vault && vault.items.filter(function (a) { return a.id === id; })[0]; }

  function okUrl(u) {
    try { var x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && !!x.hostname; }
    catch (e) { return false; }
  }
  function normUrl(u) { u = String(u || '').trim(); return !u || /^https?:\/\//i.test(u) ? u : 'https://' + u; }
  /** 入れた画像として出してよい形か（PNG か JPEG を文字にしたものだけ） */
  function okQr(s) { return typeof s === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(s); }
  /** 困りごとの文を返す。なければ '' */
  function checkApp(name, url) {
    if (!name) return '名称を入れてください';
    if (!url) return 'URLを入れてください';
    if (!okUrl(url)) return 'URLの形が違います（https://… の形で入れてください）';
    return '';
  }

  function appRow(a) {
    var ok = okUrl(a.url);                          // http・https のほかは、押せる形にしない
    return '<div class="arow" data-id="' + U.esc(a.id) + '">'
      + (ok ? '<a class="alink" href="' + U.esc(a.url) + '" target="_blank" rel="noopener noreferrer">' : '<span class="alink">')
      + '<span class="aname">' + U.esc(a.name) + '</span>'
      + '<span class="aurl">' + U.esc(a.url.replace(/^https?:\/\//i, '')) + '</span>'
      + (ok ? '</a>' : '</span>')
      + '<button type="button" class="abtn qr" data-act="qr" aria-label="QRコードを出す">QR</button>'
      + '<button type="button" class="abtn" data-act="copy">コピー</button>'
      + '<button type="button" class="abtn" data-act="aedit">直す</button>'
      + '</div>';
  }

  function paintApps() {
    var v = vault;
    if (!v) return;
    // 並びは足した順。同じグループのものは、最初の1件の場所にまとめる。グループの無いものは、続いている分を1枚に
    var secs = [], by = Object.create(null);
    v.items.forEach(function (a) {
      var last = secs[secs.length - 1], sec;
      if (a.group) {
        sec = by[a.group];
        if (!sec) { sec = by[a.group] = { group: a.group, items: [] }; secs.push(sec); }
      } else if (last && !last.group) {
        sec = last;
      } else {
        sec = { group: '', items: [] }; secs.push(sec);
      }
      sec.items.push(a);
    });
    var h = secs.map(function (sec) {
      return (sec.group ? '<div class="agroup">' + U.esc(sec.group) + '<span>' + sec.items.length + '件</span></div>' : '')
        + '<div class="card list">' + sec.items.map(appRow).join('') + '</div>';
    }).join('');
    if (!v.items.length) {
      h = '<div class="empty art">' + STAR + '<b>まだアプリはありません</b>上の欄に、名称とURLを書いて足してください</div>';
    }
    if (v.bad.length) {
      h += '<div class="warnbox">開けない項目が ' + v.bad.length + '件あります（ほかのパスワードで入れたものです）。'
        + ' <button type="button" class="mini danger" data-act="dropbad">消す</button></div>';
    }
    document.getElementById('appList').innerHTML = h;
    document.getElementById('appsCount').textContent = v.items.length ? v.items.length + '件' : '';
    document.getElementById('appGroups').innerHTML = Object.keys(by).map(function (g) { return '<option value="' + U.esc(g) + '">'; }).join('');
  }

  /* ---------- 生体認証で開ける（Face ID・Touch ID。2026-10-11 ko-dai さん） ----------
     パスワードの代わりに、端末の生体認証で開ける。使うかどうかは端末ごとに選ぶ（使わなければ何も変わらない）
       ・しくみ：端末にパスキーを1つ作る。生体認証が通ったときだけ、パスキーが32バイト（PRF）を返す。
         その32バイトから鍵を作り、パスワードを包んで app-bio として端末の中（tb.apps）に置く。開けるときは逆の順
       ・★包んだ箱だけでは開かない（生体認証を通さないと鍵が出てこない）。パスワードそのものは、いままでどおり残さない
       ・★パスキーは、端末の「パスワード」の置き場（iCloud キーチェーンなど）に入る。ここだけは、アプリの外に記録が残る。
         入るのは鍵の材料だけで、一覧もパスワードも入らない。使い始める前に、画面でそう断る
       ・パスワードを変えた・決め直したら app-bio は捨てる（使い直してもらう）
       ・PRF の使えない端末・ブラウザでは、ボタンを出さない／使い始めるときに断る */
  var BIO_ID = 'app-bio', KEY_UID = 'tb.bio.uid';
  var bioOk = null;                  // この端末で使えそうか（まだ調べていなければ null）

  function bioRec() {
    var h = lockHead(), b = Store.get(APPSP, 'app', BIO_ID);
    return h && b && b.cred && b.psalt && b.box && b.lock === h.salt ? b : null;
  }
  function bioCan() { return !!(global.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function bioCheck() {
    if (bioOk !== null || !bioCan()) { if (bioOk === null) bioOk = false; return; }
    var P = global.PublicKeyCredential;
    bioOk = false;
    Promise.resolve(P.isUserVerifyingPlatformAuthenticatorAvailable ? P.isUserVerifyingPlatformAuthenticatorAvailable() : true)
      .then(function (ok) {
        if (!ok) return false;
        if (!P.getClientCapabilities) return true;       // 聞けないブラウザは、使い始めるときに確かめる
        return P.getClientCapabilities().then(function (c) { return !c || c['extension:prf'] !== false; }, function () { return true; });
      })
      .then(function (ok) { bioOk = !!ok; if (view === 'apps') paintBio(); }, function () {});
  }
  function paintBio() {
    var on = !!bioRec(), btn = document.getElementById('appsBio');
    btn.hidden = !(on || bioOk);
    btn.textContent = on ? '生体認証をやめる' : '生体認証を使う';
    document.getElementById('lockBio').hidden = !(on && bioCan());
  }
  /** パスキーに付ける名前と番号。番号は端末ごとに1つ（使い直しても、パスキーが増えていかないように） */
  function bioUser() {
    var ua = navigator.userAgent, s = '';
    var name = APP.name + ' 自作アプリ' + (/iPhone|iPad/.test(ua) ? '（iPhone）' : /Macintosh/.test(ua) ? '（Mac）' : '');
    try { s = localStorage.getItem(KEY_UID) || ''; } catch (e) {}
    if (!s) { s = Lock.b64(Lock.random(16)); try { localStorage.setItem(KEY_UID, s); } catch (e) {} }
    return { id: Lock.unb64(s), name: name, displayName: name };
  }
  function prfOf(cred) {
    var ext = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : null;
    var r = ext && ext.prf && ext.prf.results && ext.prf.results.first;
    return r ? new Uint8Array(r) : null;
  }
  function bioSay(e) {
    if (e && e.noPrf) return e.message;
    if (e && e.name === 'NotAllowedError') return '生体認証が通りませんでした（やめた・時間切れ）';
    return (e && e.message) || '生体認証でうまくいきませんでした';
  }
  /** 生体認証を通して、パスキーから32バイトをもらう */
  function bioAsk(b) {
    var one = { type: 'public-key', id: Lock.unb64(b.cred) };
    if (b.tr && b.tr.length) one.transports = b.tr;
    return navigator.credentials.get({ publicKey: {
      challenge: Lock.random(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: [one], extensions: { prf: { eval: { first: Lock.unb64(b.psalt) } } }
    } }).then(function (c) {
      var out = prfOf(c);
      if (!out) { var e = new Error('この端末（またはブラウザ）では、生体認証での解除は使えません'); e.noPrf = true; throw e; }
      return out;
    });
  }

  function bioUnlock() {
    var h = lockHead(), b = bioRec();
    if (!h || !b || appsBusy || !bioCan()) return;
    appsBusy = true;
    say('lockMsg', '生体認証を待っています…');
    bioAsk(b).then(Lock.keyFromBytes)
      .then(function (k) { return Lock.open(k, b.box); })
      .then(function (o) { return Lock.key(String(o.p), h.salt, h.iter); })
      .then(function (key) { return Lock.open(key, h.box).then(function () { return key; }); })
      .then(function (key) {
        appsBusy = false;
        say('lockMsg', '');
        if (view !== 'apps') return;
        vault = { key: key, salt: h.salt, items: [], bad: [], touched: Date.now() };
        renderApps();
      }, function (e) {
        appsBusy = false;
        say('lockMsg', (e && (e.noPrf || e.name === 'NotAllowedError') ? bioSay(e) : '生体認証では開けられませんでした') + '。パスワードでも開けられます', true);
      });
  }

  /** 使い始める。パスワードを確かめる → パスキーを作る → 32バイトをもらって、パスワードを包む */
  function bioSetup() {
    var h = lockHead(), v = vault;
    if (!h || !v) return;
    var pass = '', made = null, stage = 'pass';
    modal('<h2>生体認証で開けるようにする</h2>'
      + '<div class="hint">次からは、パスワードの代わりに Face ID・Touch ID で開けられます（パスワードも、そのまま使えます）。<br>'
      + '★この端末の「パスワード」の置き場に、パスキーが1つ保存されます（iCloud キーチェーンを使っていれば、そこにも入ります）。'
      + '入るのは鍵の材料だけで、一覧の中身とパスワードは入りません。</div>'
      + '<div class="f" id="bio-f"><label for="bio-pass">いまのパスワード</label><input type="password" id="bio-pass" autocomplete="current-password"></div>'
      + '<div class="lockmsg" id="bio-msg"></div>'
      + '<div class="acts"><button type="button" id="bio-cancel">やめる</button><button type="button" class="go" id="bio-ok">次へ</button></div>',
      function (m) {
        var btn = m.querySelector('#bio-ok');
        function msg(text, bad) { var el = m.querySelector('#bio-msg'); el.textContent = text || ''; el.classList.toggle('bad', !!bad); }
        function fail(e) { btn.disabled = false; msg(bioSay(e), true); }
        function finish(prf) {
          return Lock.keyFromBytes(prf).then(function (k) { return Lock.seal(k, { p: pass }); }).then(function (box) {
            if (vault !== v || lockHead() !== h) throw new Error('ロックがかかりました');
            Store.put(APPSP, 'app', { id: BIO_ID, createdAt: Date.now(), cred: made.cred, tr: made.tr, psalt: made.psalt, lock: h.salt, box: box });
            pass = '';
            closeModal(); renderAll(); toast('生体認証で開けられるようにしました');
          });
        }
        m.querySelector('#bio-cancel').onclick = closeModal;
        btn.onclick = function () {
          if (stage === 'pass') {
            pass = m.querySelector('#bio-pass').value;
            if (!pass) return;
            btn.disabled = true; msg('確かめています…');
            Lock.key(pass, h.salt, h.iter).then(function (k) { return Lock.open(k, h.box); }).then(function () {
              stage = 'make';
              m.querySelector('#bio-pass').value = '';
              m.querySelector('#bio-f').hidden = true;
              btn.disabled = false; btn.textContent = '生体認証を登録する';
              msg('パスワードを確かめました。下のボタンを押して、生体認証を登録してください');
            }, function () { pass = ''; btn.disabled = false; msg('パスワードが違います', true); });
            return;
          }
          btn.disabled = true; msg('生体認証を待っています…');
          if (stage === 'check') { bioAsk(made).then(finish).catch(fail); return; }
          var psalt = Lock.b64(Lock.random(32));
          navigator.credentials.create({ publicKey: {
            challenge: Lock.random(32), rp: { name: APP.name, id: location.hostname }, user: bioUser(),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
            timeout: 60000, attestation: 'none', extensions: { prf: { eval: { first: Lock.unb64(psalt) } } }
          } }).then(function (c) {
            var ext = c.getClientExtensionResults ? c.getClientExtensionResults() : null, prf = prfOf(c);
            made = { cred: Lock.b64(new Uint8Array(c.rawId)), psalt: psalt, tr: (c.response && c.response.getTransports && c.response.getTransports()) || null };
            if (prf) return finish(prf);
            if (ext && ext.prf && ext.prf.enabled === false) {
              var e = new Error('この端末（またはブラウザ）では、生体認証での解除は使えません。いま作られたパスキーは、端末の「パスワード」から消してください');
              e.noPrf = true; throw e;
            }
            // 作ったときには32バイトを返さない端末がある（iPhone など）。続けてもう一度、生体認証でもらう。
            // 押した動きが続いていないと断られる端末もあるので、だめならボタンを押し直してもらう
            return bioAsk(made).then(finish, function (e2) {
              if (e2 && e2.noPrf) throw e2;
              stage = 'check';
              btn.disabled = false; btn.textContent = 'もう一度、生体認証を通す';
              msg('登録できました。仕上げに、もう一度だけ生体認証を通してください');
            });
          }).catch(fail);
        };
        setTimeout(function () { var el = m.querySelector('#bio-pass'); if (el) el.focus(); }, 50);
      });
    appsModal = true;
  }

  function bioToggle() {
    if (!vault) return;
    if (!bioRec()) { bioSetup(); return; }
    if (!global.confirm('生体認証で開けるのをやめます（パスワードでは、そのまま開けられます）。\n\n'
      + '端末の「パスワード」に保存されたパスキーは、アプリからは消せません。要らなければ、そこから消してください。')) return;
    Store.remove(APPSP, 'app', BIO_ID);
    renderAll(); toast('生体認証をやめました');
  }

  /* まちがえた回数（この端末の中だけ）。5回つづけてまちがえると、しばらく待たせる */
  function failState() { try { return JSON.parse(localStorage.getItem(KEY_FAIL)) || {}; } catch (e) { return {}; } }
  function waitLeft() { return Math.max(0, Math.ceil(((failState().until || 0) - Date.now()) / 1000)); }
  function waitText(sec) { return sec < 60 ? sec + '秒' : Math.ceil(sec / 60) + '分'; }
  function noteFail(ok) {
    try {
      if (ok) { localStorage.removeItem(KEY_FAIL); return; }
      var f = failState();
      f.n = (f.n || 0) + 1;
      if (f.n >= 5) f.until = Date.now() + Math.min(10, f.n - 4) * 60000;
      localStorage.setItem(KEY_FAIL, JSON.stringify(f));
    } catch (e) {}
  }

  function unlockApps() {
    var h = lockHead(), input = document.getElementById('lockPass'), pass = input.value;
    if (!h || appsBusy || !pass) return;
    var left = waitLeft();
    if (left) { say('lockMsg', '何度もまちがえたので、あと' + waitText(left) + '待ってください', true); return; }
    appsBusy = true;
    say('lockMsg', '開けています…');
    Lock.key(pass, h.salt, h.iter).then(function (key) {
      return Lock.open(key, h.box).then(function () { return key; });
    }).then(function (key) {
      appsBusy = false;
      noteFail(true);
      input.value = '';
      say('lockMsg', '');
      if (view !== 'apps') return;                  // 待つ間にほかのタブへ移っていたら、開けない
      vault = { key: key, salt: h.salt, items: [], bad: [], touched: Date.now() };
      renderApps();
    }, function () {
      appsBusy = false;
      noteFail(false);
      var w = waitLeft();
      say('lockMsg', 'パスワードが違います' + (w ? '。あと' + waitText(w) + '待ってください' : ''), true);
      input.select();
    });
  }

  function setupApps() {
    var e1 = document.getElementById('setPass1'), e2 = document.getElementById('setPass2');
    var p1 = e1.value, p2 = e2.value;
    if (appsBusy) return;
    if (p1.length < Lock.MIN) { say('setMsg', Lock.MIN + '文字以上にしてください', true); return; }
    if (p1 !== p2) { say('setMsg', '2回の入力が合っていません', true); return; }
    appsBusy = true;
    say('setMsg', '用意しています…');
    var salt = Lock.newSalt();
    Lock.key(p1, salt, Lock.ITER).then(function (key) {
      return Lock.seal(key, { check: APP.name }).then(function (box) {
        Store.put(APPSP, 'app', { id: LOCK_ID, createdAt: Date.now(), salt: salt, iter: Lock.ITER, box: box });
        if (view === 'apps') vault = { key: key, salt: salt, items: [], bad: [], touched: Date.now() };
      });
    }).then(function () {
      appsBusy = false;
      e1.value = ''; e2.value = '';
      say('setMsg', '');
      renderAll(); toast('ロックを用意しました');
    }, function (e) {
      appsBusy = false;
      say('setMsg', 'うまくいきませんでした：' + ((e && e.message) || e), true);
    });
  }

  /** 暗号にする前の形。空のものは入れない */
  function appBody(o) {
    var body = { name: o.name, url: o.url, order: o.order || Date.now() };
    if (o.group) body.group = o.group;
    if (okQr(o.qr)) body.qr = o.qr;
    return body;
  }

  /** 1件を暗号にして残す。id があれば、その1件を直す。o は { name, url, group, order, qr } */
  function putApp(id, o) {
    var v = vault;
    if (!v) return Promise.reject(new Error('ロックがかかっています'));
    return Lock.seal(v.key, appBody(o)).then(function (box) {
      if (vault !== v) throw new Error('ロックがかかりました');
      var cur = id ? Store.get(APPSP, 'app', id) : null;
      var rec = { box: box };
      if (cur) { rec.id = id; rec.createdAt = cur.createdAt; }
      Store.put(APPSP, 'app', rec);
    });
  }

  function addApp() {
    if (!vault) return;
    var g = document.getElementById('appGroup'), n = document.getElementById('appName'), u = document.getElementById('appUrl');
    var name = n.value.trim(), url = normUrl(u.value);
    if (name && !url) { u.focus(); return; }
    var bad = checkApp(name, url);
    if (bad) { toast(bad); (name ? u : n).focus(); return; }
    putApp('', { group: g.value.trim(), name: name, url: url }).then(function () {
      n.value = ''; u.value = '';                  // グループは残す（同じグループに続けて足せるように）
      renderAll(); toast('足しました');
      n.focus();
    }).catch(function (e) { toast(e.message || '残せませんでした'); });
  }

  /** 選んだ画像を、QRコード用に小さくして文字にする（長いほうを600までに。大きすぎるものは断る） */
  function readQrImage(file) {
    return new Promise(function (ok, ng) {
      if (!/^image\//.test(file.type)) { ng(new Error('画像を選んでください')); return; }
      var src = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(src);
        var k = Math.min(1, 600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/png');
        if (out.length > 300000) out = c.toDataURL('image/jpeg', 0.85);
        if (out.length > 400000 || !okQr(out)) { ng(new Error('画像が大きすぎて残せません')); return; }
        ok(out);
      };
      img.onerror = function () { URL.revokeObjectURL(src); ng(new Error('画像を読めませんでした')); };
      img.src = src;
    });
  }

  function editApp(id) {
    var a = findApp(id);
    if (!a) return;
    var qr = a.qr;                                 // 自分で入れた画像。空なら URL から自動で作る
    modal('<h2>自作アプリ</h2>'
      + '<div class="f"><label for="a-group">グループ（空でもよい）</label><input type="text" id="a-group" maxlength="40" list="appGroups" value="' + U.esc(a.group) + '"></div>'
      + '<div class="f"><label for="a-name">名称</label><input type="text" id="a-name" maxlength="80" value="' + U.esc(a.name) + '"></div>'
      + '<div class="f"><label for="a-url">URL</label><input type="text" id="a-url" maxlength="2000" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + U.esc(a.url) + '"></div>'
      + '<div class="f"><label>QRコード</label><div class="qrpick"><img id="a-qrprev" alt="" hidden>'
      + '<div><div class="qrkind" id="a-qrkind"></div><div class="qrbtns">'
      + '<button type="button" class="mini" id="a-qrfile">画像を入れる</button>'
      + '<button type="button" class="mini" id="a-qrauto">自動に戻す</button></div></div></div>'
      + '<input type="file" id="a-qrinput" accept="image/*" hidden></div>'
      + '<div class="acts"><button type="button" class="del" id="a-del">消す</button>'
      + '<button type="button" id="a-cancel">やめる</button><button type="button" class="go" id="a-ok">直す</button></div>',
      function (m) {
        function paintQr() {
          var img = m.querySelector('#a-qrprev');
          img.hidden = !qr;
          if (qr) img.src = qr; else img.removeAttribute('src');
          m.querySelector('#a-qrkind').textContent = qr ? '入れた画像を使います' : 'URLから自動で作ります（何もしなくて大丈夫です）';
          m.querySelector('#a-qrauto').hidden = !qr;
        }
        paintQr();
        m.querySelector('#a-qrfile').onclick = function () { m.querySelector('#a-qrinput').click(); };
        m.querySelector('#a-qrinput').onchange = function () {
          var f = this.files && this.files[0];
          this.value = '';
          if (f) readQrImage(f).then(function (d) { qr = d; paintQr(); }, function (e) { toast(e.message); });
        };
        m.querySelector('#a-qrauto').onclick = function () { qr = ''; paintQr(); };
        m.querySelector('#a-cancel').onclick = closeModal;
        m.querySelector('#a-del').onclick = function () {
          Store.remove(APPSP, 'app', id);
          closeModal(); renderAll();
          // 消したものはどこにも残らないので、戻すときは同じ中身で入れ直す（開いている間だけ）
          toast('消しました', function () {
            putApp('', a).then(renderAll).catch(function (e) { toast(e.message || '戻せませんでした'); });
          });
        };
        m.querySelector('#a-ok').onclick = function () {
          var name = m.querySelector('#a-name').value.trim(), url = normUrl(m.querySelector('#a-url').value);
          var bad = checkApp(name, url);
          if (bad) { toast(bad); return; }
          putApp(id, { group: m.querySelector('#a-group').value.trim(), name: name, url: url, order: a.order, qr: qr })
            .then(function () { closeModal(); renderAll(); })
            .catch(function (e) { toast(e.message || '残せませんでした'); });
        };
      });
    appsModal = true;
  }

  /** QRコードを大きく出す。入れた画像があればそれを、無ければ URL からその場で作る（作った絵は残さない） */
  function showQr(id) {
    var a = findApp(id), src;
    if (!a) return;
    try { src = a.qr || TB.QR.dataUrl(a.url, 720); }
    catch (e) { toast(e.message || 'QRコードを作れませんでした'); return; }
    var title = (a.group ? a.group + '　' : '') + a.name;
    modal('<h2>' + U.esc(title) + '</h2>'
      + '<div class="qrbox"><img alt="' + U.esc(title) + ' のQRコード" src="' + src + '"></div>'
      + '<div class="qrurl">' + U.esc(a.url) + '</div>'
      + '<div class="hint qrhint">' + (a.qr ? '入れた画像を出しています。' : 'URLから自動で作ったQRコードです。') + '替えるときは「直す」から。</div>'
      + '<div class="acts"><button type="button" id="q-close">閉じる</button><button type="button" class="go" id="q-save">画像を保存</button></div>',
      function (m) {
        m.querySelector('#q-close').onclick = closeModal;
        m.querySelector('#q-save').onclick = function () { saveImage(src, 'QR_' + title.replace(/[\\\/:*?"<>|\s　]+/g, '_')); };
      });
    appsModal = true;
  }

  /** 画像を端末に渡す。スマホは共有の画面（写真に保存・AirDrop など）、パソコンはダウンロード */
  function saveImage(dataUrl, name) {
    var jpg = dataUrl.indexOf('data:image/jpeg') === 0, file = null;
    name += jpg ? '.jpg' : '.png';
    try {
      var bin = atob(dataUrl.split(',')[1]), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      file = new File([bytes], name, { type: jpg ? 'image/jpeg' : 'image/png' });
    } catch (e) { file = null; }
    var touch = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
    if (file && touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function () {});
      return;
    }
    var link = document.createElement('a');
    link.href = dataUrl; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
  }

  /** まとめて足す文字を読む。
      ・「名称　URL」の行 … 1件。上にグループの行があれば、そのグループに入る
      ・URLの無い行 … グループの見出し。空の行で、グループはおしまい
      ・URLだけの行 … 上の行（見出し）を名称にする */
  function parseApps(text) {
    var items = [], bad = 0, group = '', used = false;
    text.split('\n').forEach(function (line) {
      line = line.trim().replace(/^[-・*■◆#]+\s*/, '');
      if (!line) { group = ''; return; }
      var hit = line.match(/^(?:(.+?)[\s　,、|｜:：]+)?(https?:\/\/\S+)$/i);
      if (!hit) { group = line; used = false; return; }
      var name = (hit[1] || '').trim(), g = group;
      if (!name && group && !used) { name = group; g = ''; group = ''; }
      if (checkApp(name, hit[2])) { bad++; return; }
      if (g) used = true;
      items.push({ group: g, name: name, url: hit[2] });
    });
    return { items: items, bad: bad };
  }

  /** 何件かを一度に足す。同じURLがもうあるものは、名称とグループを新しいほうに直す（QRの画像はそのまま） */
  function bulkApps() {
    var v = vault;
    if (!v) return;
    modal('<h2>まとめて足す</h2>'
      + '<div class="hint">1行に1つ、「名称　URL」の順で書きます（間は空白）。<br>'
      + 'グループにまとめるときは、上の行にグループの名前だけを書き、終わりを空の行で区切ります。<br>'
      + '同じURLがもうあるものは、名称とグループを新しいほうに直します。</div>'
      + '<div class="f"><textarea id="b-text" rows="10" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="グループの名前&#10;名称 https://…&#10;名称 https://…"></textarea></div>'
      + '<div class="acts"><button type="button" id="b-cancel">やめる</button><button type="button" class="go" id="b-ok">足す</button></div>',
      function (m) {
        m.querySelector('#b-cancel').onclick = closeModal;
        m.querySelector('#b-ok').onclick = function () {
          var read = parseApps(m.querySelector('#b-text').value), have = Object.create(null), seen = Object.create(null);
          var todo = [], add = 0, fix = 0, base = Date.now();
          v.items.forEach(function (a) { have[a.url] = a; });
          read.items.forEach(function (it, i) {
            if (seen[it.url]) return;
            seen[it.url] = true;
            var cur = have[it.url];
            if (!cur) add++;
            else if (cur.name !== it.name || cur.group !== it.group) fix++;
            todo.push({ cur: cur, body: appBody({ group: it.group, name: it.name, url: it.url, order: base + i, qr: cur && cur.qr }) });
          });
          if (!add && !fix) {
            toast(read.bad ? '読めない行が ' + read.bad + '行あります（名称　URL の順で）' : todo.length ? 'もう全部入っています' : '中身が空です');
            return;
          }
          if (read.bad && !global.confirm('読めない行が ' + read.bad + '行あります。\n読めた分だけ足しますか？')) return;
          Promise.all(todo.map(function (t) { return Lock.seal(v.key, t.body); })).then(function (boxes) {
            if (vault !== v) throw new Error('ロックがかかりました');
            Store.putApps(todo.map(function (t, i) {
              var rec = { box: boxes[i] }, old = t.cur && Store.get(APPSP, 'app', t.cur.id);
              if (old) { rec.id = old.id; rec.createdAt = old.createdAt; }
              return rec;
            }));
            closeModal(); renderAll();
            toast([add ? add + '件足しました' : '', fix ? fix + '件直しました' : ''].filter(Boolean).join('・'));
          }).catch(function (e) { toast(e.message || '残せませんでした'); });
        };
      });
    appsModal = true;
  }

  /** パスワードを変える。新しい鍵で、鍵のもとと中身を全部包み直す */
  function changeAppsPass() {
    var h = lockHead(), v = vault;
    if (!h || !v) return;
    modal('<h2>パスワードを変える</h2>'
      + '<div class="f"><label for="p-old">今のパスワード</label><input type="password" id="p-old" autocomplete="current-password"></div>'
      + '<div class="f"><label for="p-new">新しいパスワード（' + Lock.MIN + '文字以上）</label><input type="password" id="p-new" autocomplete="new-password"></div>'
      + '<div class="f"><label for="p-new2">もう一度</label><input type="password" id="p-new2" autocomplete="new-password"></div>'
      + '<div class="hint">変わるのは、この端末のパスワードだけです。</div>'
      + '<div class="acts"><button type="button" id="p-cancel">やめる</button><button type="button" class="go" id="p-ok">変える</button></div>',
      function (m) {
        m.querySelector('#p-cancel').onclick = closeModal;
        m.querySelector('#p-ok').onclick = function () {
          var old = m.querySelector('#p-old').value, p1 = m.querySelector('#p-new').value, p2 = m.querySelector('#p-new2').value;
          if (p1.length < Lock.MIN) { toast(Lock.MIN + '文字以上にしてください'); return; }
          if (p1 !== p2) { toast('2回の入力が合っていません'); return; }
          var btn = this, recs = appRecs(), salt = Lock.newSalt(), key2 = null, kept = [];
          btn.disabled = true; btn.textContent = '変えています…';
          Lock.key(old, h.salt, h.iter).then(function (k) { return Lock.open(k, h.box); })
            .then(null, function () { throw new Error('今のパスワードが違います'); })
            .then(function () {
              // いまの鍵で開くものだけを包み直す（開かないものは、そのまま残る）
              return Promise.all(recs.map(function (r) {
                return Lock.open(v.key, r.box).then(function (o) { kept.push({ rec: r, o: o }); }, function () {});
              }));
            })
            .then(function () { return Lock.key(p1, salt, Lock.ITER); })
            .then(function (k) {
              key2 = k;
              return Promise.all([Lock.seal(k, { check: APP.name })].concat(kept.map(function (x) { return Lock.seal(k, x.o); })));
            })
            .then(function (boxes) {
              if (vault !== v) throw new Error('ロックがかかりました');
              // ★鍵のもとと中身を、1回でまとめて書く（途中で止まると、組が合わなくなるため）
              Store.putApps(kept.map(function (x, i) {
                return { id: x.rec.id, createdAt: x.rec.createdAt, box: boxes[i + 1] };
              }).concat([{ id: LOCK_ID, createdAt: h.createdAt, salt: salt, iter: Lock.ITER, box: boxes[0] }]));
              v.key = key2; v.salt = salt;
              // 生体認証の箱は、前のパスワードを包んだものなので捨てる（使い直してもらう）
              var hadBio = !!Store.get(APPSP, 'app', BIO_ID);
              if (hadBio) Store.remove(APPSP, 'app', BIO_ID);
              closeModal(); renderAll();
              toast('パスワードを変えました' + (hadBio ? '（生体認証は、もう一度「使う」を押してください）' : ''));
            })
            .catch(function (e) {
              btn.disabled = false; btn.textContent = '変える';
              toast(e.message || '変えられませんでした');
            });
        };
      });
    appsModal = true;
  }

  /** パスワードを忘れたとき。暗号は開けられないので、一覧ごと消して決め直す */
  function resetApps() {
    if (!global.confirm('パスワードを決め直します。\n\nこの端末の一覧（' + appRecs().length + '件）は、暗号を開けられないので全部消えます。\n'
      + 'ほかのどこにも残していないので、戻せません。\n\n消してよろしいですか？')) return;
    appRecs().forEach(function (r) { Store.remove(APPSP, 'app', r.id); });
    Store.remove(APPSP, 'app', LOCK_ID);
    Store.remove(APPSP, 'app', BIO_ID);
    noteFail(true);
    lockApps();
    renderAll(); toast('一覧を消しました。パスワードを決め直せます');
  }

  function dropBadApps() {
    if (!vault || !vault.bad.length) return;
    if (!global.confirm('開けない ' + vault.bad.length + '件を消します。中身は確かめられません。よろしいですか？')) return;
    vault.bad.forEach(function (id) { Store.remove(APPSP, 'app', id); });
    renderAll(); toast('消しました');
  }

  function copyText(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast('コピーしました'); }, function () { toast('コピーできませんでした'); });
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

    var dc = diemConf();
    h += '<div class="secttl">Diem の休み</div><div class="card">'
      + '<div class="setrow"><div><div class="k">Diem の「休み」を読む</div><div class="d">'
      + (diemOn()
          ? '読んでいます（名前「' + U.esc(dc.me) + '」・言葉「' + U.esc(dc.word || '休み') + '」）'
            + (dc.lastAt ? '<br>最後に読んだ時刻 ' + U.esc(U.stamp(dc.lastAt)) + (dc.err ? '・<span style="color:var(--danger)">' + U.esc(dc.err) + '</span>' : '・30日先までの休み ' + (dc.lastN || 0) + '日') : '')
          : 'つないでいません。Diem に入れた休みの日を、仕事の休みにして自動で組みます')
      + '</div></div><div style="display:flex;gap:6px">'
      + (diemOn() ? '<button type="button" class="mini" id="s-diemnow">今すぐ読む</button>' : '')
      + '<button type="button" class="mini" id="s-diem">' + (diemOn() ? '直す' : 'つなぐ') + '</button></div></div></div>';

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
        + (sp === BUYSP && buyItems().length ? '・買い出しの品物 ' + buyItems().length + '件（今回 ' + buyNeedCount() + '件）' : '')
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
    body.querySelector('#s-diem').onclick = diemConnect;
    var dn = body.querySelector('#s-diemnow');
    if (dn) dn.onclick = function () {
      toast('Diem を読んでいます…');
      diemImport(true).then(function (r) { if (r && !r.added && !r.removed) toast('変わりはありません（30日先までの休み ' + r.days + '日）'); renderAll(); })
        .catch(function (e) { global.alert('Diem を読めませんでした：\n' + (e.message || e)); });
    };
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

  /* ================= 新しい版の見張り（2026-10-11） =================
     ホーム画面に置いたアプリは、閉じないかぎり何日でも古い版のまま動き続ける。
     公開し直したのに古い画面に新しい書き方を貼って、「読めない行が4行」と出た（2026-10-11 ko-dai さんの iPhone）。
     表に戻ってきたとき・開いたときに index.html の版の印を見て、違っていたら入れ替える。
       ・打ちかけの文字・開いた別窓・開いている自作アプリがあるときは、勝手に入れ替えない（下に知らせを出す）
       ・同じ版への入れ替えは1回だけ試す（うまく入れ替わらなくても、くり返さない） */
  var loadedVer = (function () {
    var el = document.querySelector('script[src*="js/app.js"]');
    var m = el && String(el.getAttribute('src')).match(/[?&]v=([0-9a-zA-Z]+)/);
    return m ? m[1] : '';
  })();
  var newVer = '', verCheckedAt = 0;

  function midWork() {
    if (!modalWrap.hidden || vault) return true;
    return [].some.call(document.querySelectorAll('input[type=text],input[type=password],textarea'),
      function (el) { return el.value.trim() !== ''; });
  }
  function applyUpdate() { location.replace(location.pathname + '?v=' + newVer); }

  /** auto が true なら、手を止めているときに限って、聞かずに入れ替える */
  function checkVersion(auto) {
    if (!loadedVer || location.protocol.indexOf('http') !== 0 || Date.now() - verCheckedAt < 60000) return;
    verCheckedAt = Date.now();
    fetch('index.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var m = t.match(/js\/app\.js\?v=([0-9a-zA-Z]+)/);
      if (!m || m[1] === loadedVer) return;
      newVer = m[1];
      var tried = location.search.indexOf('v=' + newVer) >= 0;
      if (auto && !tried && !midWork()) { applyUpdate(); return; }
      document.getElementById('newVer').hidden = false;
    }).catch(function () {});
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
    document.getElementById('addDoPick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (b) { addDo = quickDate(b.dataset.q); paintAddOpts(); }
    });
    document.getElementById('addDo').addEventListener('change', function (e) {
      addDo = e.target.value || ''; paintAddOpts();
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
      var pIso = planDate || U.today();
      if (b.dataset.act === 'pwork') { editWork(pIso); return; }
      if (b.dataset.act === 'pconf') { editPlanConf(); return; }
      if (b.dataset.act === 'pauto') { applyPlan(pIso, { label: '組みました' }); return; }
      if (b.dataset.act === 'pclockout') { clockOut(pIso); return; }
      if (b.dataset.act === 'pclockback') {
        var wc = workOf(pIso);
        if (wc && wc.clockOut) { delete wc.clockOut; Store.put('work', 'day', wc); renderAll(); toast('退勤を取り消しました'); }
        return;
      }
      var row = b.closest('[data-id]');
      if (!row) return;
      var sp = row.dataset.sp, id = row.dataset.id, t = Store.get(sp, 'task', id);
      if (!t) return;
      if (b.dataset.act === 'pedit') { editTask(id, sp, planDate || U.today()); return; }
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
      // 行の本文を押しても、左の丸を押しても済みになる。光るのはどちらでも左の丸
      var ck = row.querySelector('.ck');
      if (b.dataset.act === 'htoggle') {
        var hb = Store.get(space(), 'task', row.dataset.id);
        if (hb && !habitDone(hb, U.today()) && !ck.classList.contains('pop')) {
          ck.classList.add('pop');
          setTimeout(function () { toggleHabit(space(), row.dataset.id, U.today()); }, 380);
        } else if (!ck.classList.contains('pop')) {
          toggleHabit(space(), row.dataset.id, U.today());
        }
        return;
      }
      if (b.dataset.act === 'toggle') {
        // 済みにするときだけ、金の丸と光を見せてから入れ替える（戻すときはすぐ）
        var cur = Store.get(space(), 'task', row.dataset.id);
        if (cur && !cur.done && !isDev(cur) && !ck.classList.contains('pop')) {
          ck.classList.add('pop');
          setTimeout(function () { toggleTask(row.dataset.id); }, 380);
        } else if (!ck.classList.contains('pop')) {
          toggleTask(row.dataset.id);
        }
      }
      if (b.dataset.act === 'edit') editTask(row.dataset.id);
    });

    var memoInput = document.getElementById('memoInput');
    document.getElementById('memoForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addMemo(memoInput.value)) { memoInput.value = ''; grow(memoInput); }
    });
    memoInput.addEventListener('input', function () { grow(memoInput); });
    memoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (addMemo(memoInput.value)) { memoInput.value = ''; grow(memoInput); }
      }
    });
    document.getElementById('memoList').addEventListener('click', function (e) {
      var c = e.target.closest('.memo');
      if (c) editMemo(c.dataset.id);
    });

    /* 買い出し */
    document.getElementById('buyBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act],[data-fneed],[data-fstore],[data-fplace]');
      if (!b) return;
      var f = buyF();
      if (b.dataset.fneed) { f.need = !f.need; Store.saveUi(); renderBuy(); return; }
      if (b.dataset.fstore != null) { f.store = b.dataset.fstore; Store.saveUi(); renderBuy(); return; }
      if (b.dataset.fplace != null) { f.place = b.dataset.fplace; Store.saveUi(); renderBuy(); return; }
      var act = b.dataset.act;
      if (act === 'badd') { buyEdit('', b.dataset.to || (f.place && f.place !== '-' ? f.place : '')); return; }
      if (act === 'baddplace') { placeEdit(''); return; }
      if (act === 'bplace') { placeEdit(b.dataset.pid); return; }
      if (act === 'bstores') { storesEdit(); return; }
      var row = b.closest('.trow');
      if (!row) return;
      if (act === 'bopen') { buyEdit(row.dataset.id); return; }
      if (act === 'bbought' && !b.classList.contains('pop')) {
        // 買ったときは、金の印と光を見せてから入れ替える
        b.classList.add('pop');
        setTimeout(function () { buyBought(row.dataset.id); }, 380);
      }
    });

    /* 自作アプリ */
    document.getElementById('apps-setup').addEventListener('submit', function (e) { e.preventDefault(); setupApps(); });
    document.getElementById('apps-locked').addEventListener('submit', function (e) { e.preventDefault(); unlockApps(); });
    document.getElementById('lockForgot').onclick = resetApps;
    document.getElementById('appsLockBtn').onclick = function () { lockApps(); renderApps(); toast('ロックしました'); };
    document.getElementById('appForm').addEventListener('submit', function (e) { e.preventDefault(); addApp(); });
    document.getElementById('appsBulk').onclick = bulkApps;
    document.getElementById('appsPass').onclick = changeAppsPass;
    document.getElementById('appsBio').onclick = bioToggle;
    document.getElementById('lockBio').onclick = bioUnlock;
    document.getElementById('appList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || !vault) return;
      if (b.dataset.act === 'dropbad') { dropBadApps(); return; }
      var row = b.closest('.arow');
      var a = row && vault.items.filter(function (x) { return x.id === row.dataset.id; })[0];
      if (!a) return;
      if (b.dataset.act === 'qr') showQr(a.id);
      if (b.dataset.act === 'copy') copyText(a.url);
      if (b.dataset.act === 'aedit') editApp(a.id);
    });
    // 裏に回って1分より長くたったら／5分さわらなかったら、ロックする
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (vault && hiddenAt && Date.now() - hiddenAt > 60000) { lockApps(); if (view === 'apps') renderApps(); }
    });
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (vault) vault.touched = Date.now(); }, true);
    });
    setInterval(function () {
      if (vault && Date.now() - vault.touched > 5 * 60000) {
        lockApps();
        if (view === 'apps') renderApps();
        toast('自作アプリをロックしました');
      }
    }, 15000);

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    document.getElementById('newVer').onclick = applyUpdate;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(true); });
    setInterval(function () { if (!document.hidden) checkVersion(false); }, 30 * 60000);

    applySpace();
    show(Store.ui().view);
    Sync.start();
    checkVersion(true);
    diemImport(false);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) diemImport(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
