#!/usr/bin/env node
// Resize and compress the source art (art-src/, GPT-image output, ~1 MB each) into game assets.
// Each entry of SPECS names one output; run again after changing a source or a spec.
//
//   node tools/art/prepare.mjs [name ...] [--preview <dir>] [--set key=value ...] [--out <dir>]
//
// --preview writes a 2x2 tiled copy of every tiling texture to <dir>, to check the seams.
// --set overrides a spec field for this run and --out writes the results to <dir> instead of
// assets/, for trying variants (e.g. --set ring=0.08 --out <scratch>).
// Setup once: cd tools/art && npm install

import { mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * name -> { src (in art-src/), out (project path), size (px, square fit) or height (px, width by the
 * aspect), format, quality, palette, tiling, crop, ring }
 * crop 'circle': a square centred on the solid shape (alpha > 128) that still holds its soft glow and
 * shadow (alpha > 10), so a round sprite is centred on its node and fills it edge to edge.
 * crop 'trim': the smallest box holding every visible pixel (alpha > 10), e.g. a panel with a shadow.
 * ring: squeeze a ring sprite toward its outer edge until its band is this fraction of the outer radius
 * thick (shading, outlines and glow are kept, just narrower). Needs crop 'circle'.
 */
const SPECS = {
  ground: { src: 'ground.png', out: 'assets/textures/ground.jpg', size: 512, format: 'jpeg', quality: 82, tiling: true },
  // The generated ring's band is 0.33 of its radius; the user asked for a thin one (27.09).
  joystickBase: { src: 'joystick_base.png', out: 'assets/textures/ui/joystick_base.png', size: 320, format: 'png', palette: true, quality: 90, crop: 'circle', ring: 0.12 },
  joystickKnob: { src: 'joystick_knob.png', out: 'assets/textures/ui/joystick_knob.png', size: 160, format: 'png', palette: true, quality: 90, crop: 'circle' },
  // HUD coin counter: icon 128 (the coin flights of the juice stage reuse it), plate 90 high (drawn
  // sliced: its rounded ends keep their shape at any width).
  coin: { src: 'coin.png', out: 'assets/textures/ui/coin.png', size: 128, format: 'png', palette: true, quality: 90, crop: 'circle' },
  coinPlate: { src: 'coin_plate.png', out: 'assets/textures/ui/coin_plate.png', height: 90, format: 'png', palette: true, quality: 90, crop: 'trim' },
};

/**
 * Radially squeezes a centred ring toward its outer edge: the band [inner, outer] becomes
 * [outer - band * outer, outer]. Samples the source along the same angle, premultiplied bilinear.
 */
async function thinRing(image, band) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = info.width;
  const channels = info.channels;
  const c = size / 2;
  const alpha = (x, y) => data[(Math.floor(y) * size + Math.floor(x)) * channels + 3];
  // Median solid edges over 72 rays (stray specks in the hole do not move a median).
  const inner = [];
  const outer = [];
  for (let k = 0; k < 72; k++) {
    const dx = Math.cos((k * Math.PI) / 36);
    const dy = Math.sin((k * Math.PI) / 36);
    let first = -1;
    let last = -1;
    for (let r = 0; r < c - 1; r += 0.5) {
      if (alpha(c + dx * r, c + dy * r) <= 128) continue;
      if (first < 0) first = r;
      last = r;
    }
    inner.push(first);
    outer.push(last);
  }
  const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
  const rIn = median(inner) - 3; // keep the anti-aliased inner edge
  const rOut = median(outer);
  const squeeze = (band * rOut) / (rOut - rIn);
  const sample = (x, y, out) => {
    // Premultiplied bilinear: transparent neighbours must not darken the edges.
    const x0 = Math.max(0, Math.min(size - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(size - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    out.fill(0);
    for (const [px, py, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
      const i = (py * size + px) * channels;
      const a = (data[i + 3] / 255) * w;
      out[0] += data[i] * a;
      out[1] += data[i + 1] * a;
      out[2] += data[i + 2] * a;
      out[3] += a;
    }
  };
  const pixel = [0, 0, 0, 0];
  const result = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.sqrt(dx * dx + dy * dy);
      const rSrc = rOut - (rOut - r) / squeeze;
      if (r < 1e-6 || rSrc < rIn || rSrc > c - 1) continue;
      sample(c + (dx * rSrc) / r - 0.5, c + (dy * rSrc) / r - 0.5, pixel);
      if (pixel[3] <= 0) continue;
      const o = (y * size + x) * 4;
      result[o] = Math.round(pixel[0] / pixel[3]);
      result[o + 1] = Math.round(pixel[1] / pixel[3]);
      result[o + 2] = Math.round(pixel[2] / pixel[3]);
      result[o + 3] = Math.round(pixel[3] * 255);
    }
  }
  return sharp(result, { raw: { width: size, height: size, channels: 4 } });
}

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

/** The smallest box around every visible pixel (alpha > 10). */
async function trimCrop(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] <= 10) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return sharp(file).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
}

const argv = process.argv.slice(2);
const takeOption = (flag) => {
  const values = [];
  for (let i = argv.indexOf(flag); i >= 0; i = argv.indexOf(flag)) values.push(argv.splice(i, 2)[1]);
  return values;
};
const previewDir = takeOption('--preview').map((d) => resolve(d))[0] ?? null;
// Trying variants: --set key=value overrides spec fields, --out <dir> writes there instead of into assets/.
const overrides = Object.fromEntries(takeOption('--set').map((kv) => {
  const [key, value] = kv.split('=');
  return [key, Number.isNaN(Number(value)) ? value : Number(value)];
}));
const outDir = takeOption('--out').map((d) => resolve(d))[0] ?? null;
const names = argv.length ? argv : Object.keys(SPECS);

for (const name of names) {
  if (!SPECS[name]) throw new Error(`unknown art spec '${name}' (known: ${Object.keys(SPECS).join(', ')})`);
  const spec = { ...SPECS[name], ...overrides };
  const out = outDir ? join(outDir, basename(spec.out)) : join(ROOT, spec.out);
  mkdirSync(dirname(out), { recursive: true });
  const src = join(ROOT, 'art-src', spec.src);
  const crops = { circle: circleCrop, trim: trimCrop };
  let source = spec.crop ? sharp(await (await crops[spec.crop](src)).png().toBuffer()) : sharp(src);
  if (spec.ring) source = sharp(await (await thinRing(source, spec.ring)).png().toBuffer());
  const image = spec.height
    ? source.resize({ height: spec.height, kernel: 'lanczos3' })
    : source.resize(spec.size, spec.size, { fit: 'inside', kernel: 'lanczos3' });
  if (spec.format === 'jpeg') image.jpeg({ quality: spec.quality, mozjpeg: true });
  else image.png({ palette: spec.palette ?? false, quality: spec.quality, compressionLevel: 9 });
  await image.toFile(out);
  console.log(`${name}: ${outDir ? out : spec.out}  ${(statSync(out).size / 1024).toFixed(1)} KB`);

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
