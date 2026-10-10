/* Task Board ロック（自作アプリの一覧を、決めたパスワードで暗号にする。2026-10-11）
   ・鍵はパスワードから作ります（PBKDF2-SHA256）。中身は AES-GCM で包みます
   ・★パスワードも鍵も、どこにも残しません・送りません。開いている間だけ、端末の記憶の中にあります
   ・端末（localStorage）と受け口のシートに入るのは、包んだあとの文字（box）だけです
   ・鍵を作るのをわざと重くしてあります（ITER）。箱を手に入れた人が総当たりするのを遅くするためです */
(function (global) {
  'use strict';

  var subtle = global.crypto && global.crypto.subtle;   // https か localhost でしか使えません

  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  var Lock = {
    ITER: 600000,
    MIN: 6,            // パスワードの短さの下限

    ok: function () { return !!subtle; },

    newSalt: function () { return b64(global.crypto.getRandomValues(new Uint8Array(16))); },

    /** パスワードから鍵を作る。全角で打っても同じ鍵になるように、字の形をそろえてから使う */
    key: function (pass, salt, iter) {
      iter = Math.max(100000, Math.min(5000000, Number(iter) || Lock.ITER));
      return Promise.resolve().then(function () {
        return subtle.importKey('raw', new TextEncoder().encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
      }).then(function (base) {
        return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    },

    /** 生体認証（パスキー）が返す32バイトから、箱を開ける鍵を作る（js/app.js「生体認証で開ける」） */
    keyFromBytes: function (bytes) {
      return subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']).then(function (base) {
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('Task Board apps bio v1') },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    },

    random: function (n) { return global.crypto.getRandomValues(new Uint8Array(n)); },
    b64: b64,
    unb64: unb64,

    /** 包む。返すのは「毎回ちがう頭の12バイト＋暗号」を文字にしたもの */
    seal: function (key, obj) {
      var iv = global.crypto.getRandomValues(new Uint8Array(12));
      return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)))
        .then(function (ct) {
          var out = new Uint8Array(12 + ct.byteLength);
          out.set(iv, 0);
          out.set(new Uint8Array(ct), 12);
          return b64(out);
        });
    },

    /** 開ける。鍵が違う・中身が壊れているときは失敗する（まちがった中身が出てくることはない） */
    open: function (key, box) {
      return Promise.resolve().then(function () {
        var raw = unb64(String(box || ''));
        return subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
      }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
    }
  };

  global.TB = global.TB || {};
  global.TB.Lock = Lock;
})(window);
