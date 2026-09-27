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

/**
 * name -> { src (in art-src/), out (project path), size (px, square fit), format, quality, palette, tiling, crop }
 * crop 'circle': a square centred on the solid shape (alpha > 128) that still holds its soft glow and
 * shadow (alpha > 10), so a round sprite is centred on its node and fills it edge to edge.
 */
const SPECS = {
  ground: { src: 'ground.png', out: 'assets/textures/ground.jpg', size: 512, format: 'jpeg', quality: 82, tiling: true },
  joystickBase: { src: 'joystick_base.png', out: 'assets/textures/ui/joystick_base.png', size: 320, format: 'png', palette: true, quality: 90, crop: 'circle' },
  joystickKnob: { src: 'joystick_knob.png', out: 'assets/textures/ui/joystick_knob.png', size: 160, format: 'png', palette: true, quality: 90, crop: 'circle' },
};

/** Square region around a round sprite: centre of the solid part, half size reaching every visible pixel. */
async function circleCrop(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bounds = (threshold) => {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * channels + 3] <= threshold) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return { x0, y0, x1, y1 };
  };
  const solid = bounds(128);
  const visible = bounds(10);
  const cx = (solid.x0 + solid.x1 + 1) / 2;
  const cy = (solid.y0 + solid.y1 + 1) / 2;
  const half = Math.ceil(Math.max(cx - visible.x0, visible.x1 + 1 - cx, cy - visible.y0, visible.y1 + 1 - cy));
  const left = Math.round(cx - half);
  const top = Math.round(cy - half);
  // Pad with transparency where the square sticks out of the source.
  const pad = { top: Math.max(0, -top), left: Math.max(0, -left),
    bottom: Math.max(0, top + 2 * half - height), right: Math.max(0, left + 2 * half - width) };
  const padded = await sharp(file).extend({ ...pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp(padded).extract({ left: left + pad.left, top: top + pad.top, width: 2 * half, height: 2 * half });
}

const argv = process.argv.slice(2);
const previewAt = argv.indexOf('--preview');
const previewDir = previewAt >= 0 ? resolve(argv.splice(previewAt, 2)[1]) : null;
const names = argv.length ? argv : Object.keys(SPECS);

for (const name of names) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`unknown art spec '${name}' (known: ${Object.keys(SPECS).join(', ')})`);
  const out = join(ROOT, spec.out);
  mkdirSync(dirname(out), { recursive: true });
  const src = join(ROOT, 'art-src', spec.src);
  const source = spec.crop === 'circle' ? sharp(await (await circleCrop(src)).png().toBuffer()) : sharp(src);
  const image = source.resize(spec.size, spec.size, { fit: 'inside', kernel: 'lanczos3' });
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
