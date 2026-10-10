/* Task Board QRコード（URL から、その場で作る。2026-10-11）
   ・外の道具もネットも使いません。作った絵は、どこにも送りません・残しません
   ・8ビットの文字（UTF-8）／誤り訂正 M／型番 1〜40。マスクは8通り試して、一番読みやすいものを選びます
   ・確かめかた：QRを確かめる.swift（Mac の読み取り機能で、全部の型番を読み戻す） */
(function (global) {
  'use strict';

  // 誤り訂正 M の表（型番ごとの「1かたまりの訂正の語数」と「かたまりの数」）
  var ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  /** 決まった模様を除いた、中身を置けるマスの数 */
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC[ver] * BLOCKS[ver]; }

  /* 誤り訂正（リード・ソロモン） */
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(deg) {
    var res = [], root = 1, i, j;
    for (i = 0; i < deg - 1; i++) res.push(0);
    res.push(1);
    for (i = 0; i < deg; i++) {
      for (j = 0; j < res.length; j++) {
        res[j] = mul(res[j], root);
        if (j + 1 < res.length) res[j] ^= res[j + 1];
      }
      root = mul(root, 0x02);
    }
    return res;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift();
      res.push(0);
      div.forEach(function (c, i) { res[i] ^= mul(c, f); });
    });
    return res;
  }

  function utf8(text) {
    var s = unescape(encodeURIComponent(String(text))), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  /** 文字を、誤り訂正つきの語の並びにする。返すのは { ver, words } */
  function codewords(text) {
    var bytes = utf8(text), ver = 1, cap, i;
    for (; ; ver++) {
      if (ver > 40) throw new Error('長すぎてQRコードにできません');
      cap = dataCodewords(ver) * 8;
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
    }
    var bits = [];
    function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4);                                   // 8ビットの文字、の印
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      data.push(v);
    }

    // かたまりに分けて訂正の語を付け、かたまりをまたいで1語ずつ並べ直す
    var nb = BLOCKS[ver], el = ECC[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], div = rsDivisor(el), at = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(at, at + shortLen - el + (i < nShort ? 0 : 1));
      at += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var words = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (block, j) {
        if (i !== shortLen - el || j >= nShort) words.push(block[i]);
      });
    }
    return { ver: ver, words: words };
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  /** 読みにくさの点（低いほどよい）。同じ色の並び・2×2のかたまり・目印に似た並び・黒白のかたより */
  function penalty(m, size) {
    var p = 0, dark = 0, x, y;
    for (y = 0; y < size; y++) {
      var row = '', col = '';
      for (x = 0; x < size; x++) {
        row += m[y][x] ? '1' : '0';
        col += m[x][y] ? '1' : '0';
        if (m[y][x]) dark++;
      }
      [row, col].forEach(function (s) {
        (s.match(/0{5,}|1{5,}/g) || []).forEach(function (r) { p += r.length - 2; });
        for (var i = 0; i + 11 <= size; i++) {
          var t = s.substr(i, 11);
          if (t === '10111010000' || t === '00001011101') p += 40;
        }
      });
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    return p + Math.max(0, Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
  }

  /** QRコードを作る。返すのは { ver, size, rows }（rows[y][x] が true なら黒） */
  function make(text) {
    var cw = codewords(text), ver = cw.ver, size = ver * 4 + 17;
    var mod = [], fn = [], x, y, i, j;
    for (y = 0; y < size; y++) {
      mod.push([]); fn.push([]);
      for (x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); }
    }
    function set(px, py, dark) { mod[py][px] = !!dark; fn[py][px] = true; }
    function bit(v, k) { return ((v >>> k) & 1) !== 0; }

    // 決まった模様：点線・3すみの目印・位置合わせの小さな目印
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
        }
      }
    });
    var pos = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2;
      var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      pos = [6];
      for (var q = size - 7; pos.length < na; q -= step) pos.splice(1, 0, q);
    }
    for (i = 0; i < pos.length; i++) {
      for (j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
        for (var ay = -2; ay <= 2; ay++) {
          for (var ax = -2; ax <= 2; ax++) set(pos[i] + ax, pos[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
        }
      }
    }
    function drawFormat(mask) {              // 誤り訂正 M の印は 0 なので、入れるのはマスクの番号だけ
      var rem = mask, k;
      for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var b = (mask << 10 | rem) ^ 0x5412;
      for (k = 0; k <= 5; k++) set(8, k, bit(b, k));
      set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
      for (k = 9; k < 15; k++) set(14 - k, 8, bit(b, k));
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(b, k));
      for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(b, k));
      set(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var vr = ver;
      for (i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vb = ver << 12 | vr;
      for (i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, b2 = Math.floor(i / 3);
        set(a, b2, bit(vb, i)); set(b2, a, bit(vb, i));
      }
    }

    // 中身を、右下からジグザグに置く
    var n = 0, total = cw.words.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (!fn[y][x] && n < total) {
            mod[y][x] = bit(cw.words[n >>> 3], 7 - (n & 7));
            n++;
          }
        }
      }
    }

    // マスクを8通り試して、一番読みやすいものにする
    function flip(mask) {
      for (var yy = 0; yy < size; yy++) {
        for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && MASKS[mask](xx, yy)) mod[yy][xx] = !mod[yy][xx];
      }
    }
    var best = 0, bestP = Infinity;
    for (i = 0; i < 8; i++) {
      flip(i); drawFormat(i);
      var p = penalty(mod, size);
      if (p < bestP) { bestP = p; best = i; }
      flip(i);
    }
    flip(best); drawFormat(best);
    return { ver: ver, size: size, rows: mod };
  }

  /** 絵にする（白い余白つき）。px はだいたいの1辺の大きさ。返すのは PNG の data URL */
  function dataUrl(text, px) {
    var q = make(text), quiet = 4;
    var scale = Math.max(2, Math.floor((px || 480) / (q.size + quiet * 2)));
    var c = document.createElement('canvas');
    c.width = c.height = (q.size + quiet * 2) * scale;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (var y = 0; y < q.size; y++) {
      for (var x = 0; x < q.size; x++) if (q.rows[y][x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
    return c.toDataURL('image/png');
  }

  global.TB = global.TB || {};
  global.TB.QR = { make: make, dataUrl: dataUrl, _cap: dataCodewords };
})(typeof window !== 'undefined' ? window : this);
