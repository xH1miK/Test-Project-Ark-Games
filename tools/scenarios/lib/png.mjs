// Minimal PNG reader for scenario pixel checks: 8-bit greyscale/RGB/RGBA (+ alpha), non-interlaced,
// which is what the DevTools screenshots are. Returns { width, height, rgba: Uint8Array }.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function readPng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || !CHANNELS[type]) throw new Error(`${file}: unsupported PNG (depth ${data[8]}, type ${type}, interlace ${data[12]})`);
    } else if (kind === 'IDAT') {
      idat.push(data);
    } else if (kind === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = CHANNELS[type];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0;
      const b = y > 0 ? pixels[out - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[out - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[out + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const grey = channels <= 2;
    rgba[i * 4] = pixels[s];
    rgba[i * 4 + 1] = grey ? pixels[s] : pixels[s + 1];
    rgba[i * 4 + 2] = grey ? pixels[s] : pixels[s + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[s + 3] : channels === 2 ? pixels[s + 1] : 255;
  }
  return { width, height, rgba };
}

/** Largest per-channel difference of pixel (x, y) between two images of the same size. */
export function pixelDiff(a, b, x, y) {
  const i = (y * a.width + x) * 4;
  return Math.max(Math.abs(a.rgba[i] - b.rgba[i]), Math.abs(a.rgba[i + 1] - b.rgba[i + 1]), Math.abs(a.rgba[i + 2] - b.rgba[i + 2]));
}
