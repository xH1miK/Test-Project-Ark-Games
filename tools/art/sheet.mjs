#!/usr/bin/env node
// Contact sheet of screenshots for a visual review: node tools/art/sheet.mjs <out.png> <scale> <cols> <a.png> <b.png> ...
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'));
const sharp = require('sharp');
const [out, scaleArg, colsArg, ...files] = process.argv.slice(2);
const scale = Number(scaleArg), cols = Number(colsArg);
const tiles = [];
for (const f of files) {
  const buf = await sharp(f).resize({ width: null, height: null }).metadata();
  const w = Math.round(buf.width * scale), h = Math.round(buf.height * scale);
  tiles.push({ input: await sharp(f).resize(w, h).toBuffer(), w, h });
}
const cw = Math.max(...tiles.map((t) => t.w)), ch = Math.max(...tiles.map((t) => t.h));
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cw * cols, height: ch * rows, channels: 3, background: '#222' } })
  .composite(tiles.map((t, i) => ({ input: t.input, left: (i % cols) * cw, top: Math.floor(i / cols) * ch })))
  .png().toFile(out);
console.log(`${out}: ${tiles.length} tiles ${cw}x${ch}, ${cols} cols`);
