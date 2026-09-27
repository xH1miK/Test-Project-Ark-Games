#!/usr/bin/env node
// Resize and compress the source art (art-src/, GPT-image output, ~1 MB each) into game assets.
// Each entry of SPECS names one output; run again after changing a source or a spec.
//
//   node tools/art/prepare.mjs [name ...] [--preview <dir>]
//
// --preview writes a 2x2 tiled copy of every tiling texture to <dir>, to check the seams.
// Setup once: cd tools/art && npm install

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** name -> { src (in art-src/), out (project path), size (px, square fit), format, quality, tiling } */
const SPECS = {
  ground: { src: 'ground.png', out: 'assets/textures/ground.jpg', size: 512, format: 'jpeg', quality: 82, tiling: true },
};

const argv = process.argv.slice(2);
const previewAt = argv.indexOf('--preview');
const previewDir = previewAt >= 0 ? resolve(argv.splice(previewAt, 2)[1]) : null;
const names = argv.length ? argv : Object.keys(SPECS);

for (const name of names) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`unknown art spec '${name}' (known: ${Object.keys(SPECS).join(', ')})`);
  const out = join(ROOT, spec.out);
  mkdirSync(dirname(out), { recursive: true });
  const image = sharp(join(ROOT, 'art-src', spec.src)).resize(spec.size, spec.size, { fit: 'inside', kernel: 'lanczos3' });
  if (spec.format === 'jpeg') image.jpeg({ quality: spec.quality, mozjpeg: true });
  else image.png({ palette: spec.palette ?? false, quality: spec.quality, compressionLevel: 9 });
  await image.toFile(out);
  console.log(`${name}: ${spec.out}  ${(statSync(out).size / 1024).toFixed(1)} KB`);

  if (previewDir && spec.tiling) {
    mkdirSync(previewDir, { recursive: true });
    const tile = await sharp(out).png().toBuffer();
    const { width, height } = await sharp(tile).metadata();
    const file = join(previewDir, `${name}-tiled.png`);
    await sharp({ create: { width: width * 2, height: height * 2, channels: 3, background: '#000' } })
      .composite([0, 1, 2, 3].map((i) => ({ input: tile, left: (i % 2) * width, top: Math.floor(i / 2) * height })))
      .png()
      .toFile(file);
    console.log(`  tiling preview: ${file}`);
  }
}
