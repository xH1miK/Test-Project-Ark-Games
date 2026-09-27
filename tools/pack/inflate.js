/* Minimal gzip / RFC 1951 inflate, written after Mark Adler's puff.c.
 * Fallback for browsers without DecompressionStream (iOS < 16.4). Favours size over speed:
 * Huffman codes are decoded bit by bit. Plain ES5, no globals except zmGunzip.
 * Tested against Node's zlib by tools/pack/test-inflate.mjs. */
function zmGunzip(buf) {
  'use strict';
  if (buf[0] !== 0x1f || buf[1] !== 0x8b || buf[2] !== 8) throw Error('gunzip: not a gzip stream');
  var flg = buf[3], p = 10, n = buf.length;
  if (flg & 4) p += 2 + (buf[p] | (buf[p + 1] << 8)); // FEXTRA
  if (flg & 8) while (buf[p++]); // FNAME
  if (flg & 16) while (buf[p++]); // FCOMMENT
  if (flg & 2) p += 2; // FHCRC
  var size = (buf[n - 4] | (buf[n - 3] << 8) | (buf[n - 2] << 16) | (buf[n - 1] << 24)) >>> 0;
  var out = new Uint8Array(size);
  var src = buf.subarray(p, n - 8);
  var ip = 0, op = 0, bitbuf = 0, bitcnt = 0;

  function bits(need) {
    var val = bitbuf;
    while (bitcnt < need) {
      if (ip >= src.length) throw Error('inflate: input overrun');
      val |= src[ip++] << bitcnt;
      bitcnt += 8;
    }
    bitbuf = val >>> need;
    bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  // Canonical Huffman table: count of codes per length + symbols ordered by code.
  function huff(lengths, count) {
    var h = { count: new Uint16Array(16), symbol: new Uint16Array(count) };
    var offs = new Uint16Array(16), i;
    for (i = 0; i < count; i++) h.count[lengths[i]]++;
    h.count[0] = 0;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + h.count[i];
    for (i = 0; i < count; i++) if (lengths[i]) h.symbol[offs[lengths[i]]++] = i;
    return h;
  }

  function decode(h) {
    var code = 0, first = 0, index = 0, len, c;
    for (len = 1; len < 16; len++) {
      if (bitcnt === 0) {
        if (ip >= src.length) throw Error('inflate: input overrun');
        bitbuf = src[ip++];
        bitcnt = 8;
      }
      code |= bitbuf & 1;
      bitbuf >>>= 1;
      bitcnt--;
      c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw Error('inflate: bad code');
  }

  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
    4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function codes(lencode, distcode) {
    for (;;) {
      var sym = decode(lencode);
      if (sym < 256) {
        out[op++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        sym -= 257;
        if (sym >= 29) throw Error('inflate: bad length symbol');
        var len = LBASE[sym] + bits(LEXT[sym]);
        var ds = decode(distcode);
        if (ds >= 30) throw Error('inflate: bad distance symbol');
        var dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > op) throw Error('inflate: distance too far back');
        while (len--) { out[op] = out[op - dist]; op++; }
      }
    }
  }

  function stored() {
    bitbuf = 0; // drop the rest of the current byte
    bitcnt = 0;
    if (ip + 4 > src.length) throw Error('inflate: input overrun');
    var len = src[ip] | (src[ip + 1] << 8);
    if (len !== (~(src[ip + 2] | (src[ip + 3] << 8)) & 0xffff)) throw Error('inflate: bad stored length');
    ip += 4;
    if (ip + len > src.length) throw Error('inflate: input overrun');
    out.set(src.subarray(ip, ip + len), op);
    ip += len;
    op += len;
  }

  var fixedLen = null, fixedDist = null;
  function fixed() {
    if (!fixedLen) {
      var l = new Uint8Array(288), d = new Uint8Array(30), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      for (i = 0; i < 30; i++) d[i] = 5;
      fixedLen = huff(l, 288);
      fixedDist = huff(d, 30);
    }
    codes(fixedLen, fixedDist);
  }

  function dynamic() {
    var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, i;
    if (nlen > 286 || ndist > 30) throw Error('inflate: bad code counts');
    var cl = new Uint8Array(19);
    for (i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
    var clcode = huff(cl, 19);
    var lens = new Uint8Array(nlen + ndist), index = 0;
    while (index < nlen + ndist) {
      var sym = decode(clcode);
      if (sym < 16) {
        lens[index++] = sym;
      } else {
        var len = 0, rep;
        if (sym === 16) {
          if (index === 0) throw Error('inflate: repeat with no previous length');
          len = lens[index - 1];
          rep = 3 + bits(2);
        } else if (sym === 17) {
          rep = 3 + bits(3);
        } else {
          rep = 11 + bits(7);
        }
        if (index + rep > nlen + ndist) throw Error('inflate: too many code lengths');
        while (rep--) lens[index++] = len;
      }
    }
    if (lens[256] === 0) throw Error('inflate: missing end-of-block code');
    codes(huff(lens.subarray(0, nlen), nlen), huff(lens.subarray(nlen), ndist));
  }

  var last;
  do {
    last = bits(1);
    var type = bits(2);
    if (type === 0) stored();
    else if (type === 1) fixed();
    else if (type === 2) dynamic();
    else throw Error('inflate: bad block type');
  } while (!last);
  if (op !== size) throw Error('inflate: size mismatch ' + op + ' != ' + size);
  return out;
}
