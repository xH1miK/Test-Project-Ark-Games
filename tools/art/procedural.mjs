#!/usr/bin/env node
// Textures drawn by code (no GPT-image source): the gate's force-field curtain and its sparks, and the
// confetti piece. Deterministic, so a rerun gives the same bytes.
//
//   node tools/art/procedural.mjs [name ...]
//
// curtain: the sheet in the gateway, 187x126 for a 5.2 x 3.5 unit opening (36 px per unit; the doorway measured on the mesh is 5.06 x 3.3-3.5, the sheet tucks 0.07 behind each post): a violet-pink
// glass with a wavy alpha and a three-layer glowing rim (the example's curtain: sheet colour 232,133,255,
// alpha 0.72 +- 0.216 waves, rim 255,212,255 in three bands 0.16 / 0.065 / 0.022 units wide).
// curtainSparks: 4-point diamonds strewn over the lower two thirds of the sheet, flashed while it opens.
// confetti: a white rounded strip the UI tints per piece.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Sheet size in world units (the opening) and pixels per unit of its texture. */
const SHEET = { width: 5.2, height: 3.5, ppu: 36 };

/** Small seeded PRNG (mulberry32), as the game's. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Straight-alpha RGBA "over" of a colour (0..255) with alpha a (0..1) onto pixel i of data. */
function over(data, i, r, g, b, a) {
  const da = data[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) data[i + c] = Math.round(([r, g, b][c] * a + data[i + c] * da * (1 - a)) / oa);
  data[i + 3] = Math.round(oa * 255);
}

function curtain() {
  const w = Math.round(SHEET.width * SHEET.ppu);
  const h = Math.round(SHEET.height * SHEET.ppu);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Sheet coordinates in the example's 9 x 13 grid units, so the waves have its rhythm.
      const r = (x / (w - 1)) * 8;
      const n = (1 - y / (h - 1)) * 12; // row 0 at the bottom
      const wave = 0.72 + 0.216 * Math.sin(1.4 * r + 0.7 * n) * Math.cos(1.1 * n - 0.4 * r);
      // The example's sheet is 0.42 of that alpha; a texture on a sprite needs a little more to read.
      const a = clamp01(wave * 0.62);
      over(data, i, 232, 133, 255, a);
      // Rim: distance to the nearest edge in world units; bands of decreasing width and rising alpha.
      const dx = Math.min(x + 0.5, w - x - 0.5) / SHEET.ppu;
      const dy = Math.min(y + 0.5, h - y - 0.5) / SHEET.ppu;
      const edge = Math.min(dx, dy);
      const onFloor = dy < dx && y > h / 2; // the bottom rim is dimmer, as the example's (0.65)
      for (const [width, alpha] of [[0.16, 0.12], [0.065, 0.5], [0.022, 0.85]]) {
        // Soft edge over one texel so the thin band does not shimmer.
        const cover = clamp01((width - edge) * SHEET.ppu + 0.5);
        if (cover > 0) over(data, i, 255, 212, 255, alpha * cover * (onFloor ? 0.65 : 1));
      }
    }
  }
  return { data, width: w, height: h };
}

function sparks() {
  const w = Math.round(SHEET.width * SHEET.ppu);
  const h = Math.round(SHEET.height * SHEET.ppu);
  const data = Buffer.alloc(w * h * 4);
  const random = mulberry32(42);
  for (let k = 0; k < 42; k++) {
    const cx = (0.03 + 0.94 * random()) * w;
    const cy = h - random() * h * 0.65 - 2; // lower two thirds
    const size = 1.6 + 3.2 * random(); // half height in px, the diamond is twice as tall as wide
    const tint = [255, 196 + Math.round(59 * random()), 166];
    for (let y = Math.floor(cy - 2 * size - 1); y <= Math.ceil(cy + 2 * size + 1); y++) {
      for (let x = Math.floor(cx - size - 1); x <= Math.ceil(cx + size + 1); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.abs(x + 0.5 - cx) / size + Math.abs(y + 0.5 - cy) / (2 * size);
        const cover = clamp01((1 - d) * size + 0.5);
        if (cover > 0) over(data, (y * w + x) * 4, tint[0], tint[1], tint[2], 0.9 * cover);
      }
    }
  }
  return { data, width: w, height: h };
}

function confetti() {
  const w = 32;
  const h = 20;
  const data = Buffer.alloc(w * h * 4);
  const radius = 5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rounded rectangle, 1 px soft edge.
      const px = Math.abs(x + 0.5 - w / 2) - (w / 2 - radius);
      const py = Math.abs(y + 0.5 - h / 2) - (h / 2 - radius);
      const d = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - radius;
      const a = clamp01(0.5 - d);
      // A little shading along the strip so a turning piece reads as paper.
      const shade = 255 - Math.round(38 * Math.abs(y + 0.5 - h / 2) / (h / 2));
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = shade;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { data, width: w, height: h };
}

const MAKERS = {
  curtain: { make: curtain, out: 'assets/textures/fx/curtain.png' },
  curtainSparks: { make: sparks, out: 'assets/textures/fx/curtain_sparks.png' },
  confetti: { make: confetti, out: 'assets/textures/ui/confetti.png' },
};

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = names.length ? names : Object.keys(MAKERS);
for (const name of todo) if (!MAKERS[name]) throw new Error(`unknown texture ${name}; known: ${Object.keys(MAKERS).join(', ')}`);
for (const name of todo) {
  const { make, out } = MAKERS[name];
  const { data, width, height } = make();
  const path = join(ROOT, out);
  mkdirSync(dirname(path), { recursive: true });
  await sharp(data, { raw: { width, height, channels: 4 } }).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toFile(path);
  console.log(`${name}: ${out} ${width}x${height} (${statSync(path).size} B)`);
}
