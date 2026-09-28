#!/usr/bin/env node
// Bake a bitmap font (AngelCode text .fnt + one PNG page) from a system font, drawn with the browser's
// canvas the way the engine draws a Label: the outline stroked (round joins, twice its width), the
// fill over it. A Label with this font packs the page into the dynamic atlas once and batches with
// the sprites, and a new number only moves quads. A system-font Label draws its own texture, remade
// on every change; in BITMAP cache mode it re-packs into the atlas on every change and clogs it
// (tools/scenarios/hud-atlas.mjs measures both).
//
//   node tools/art/font.mjs [name ...]
//
// The page stays within the dynamic atlas' largest frame (512 px), or it would not be packed. Headless
// Edge draws canvas text without antialiasing, so the page is drawn SUPERSAMPLE times larger and
// shrunk (box average): the edges get SUPERSAMPLE² levels of coverage.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withBrowser } from '../lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_PAGE = 512;
const SUPERSAMPLE = 4;

/**
 * name -> { out (project path without extension), chars, family, bold, size (px), lineHeight (px),
 * fill, outline { color, width (px, as Label.outlineWidth) }, columns }. The glyphs' ink is centred
 * in the line, so a centred Label puts the digits in the middle of its box.
 */
const FONTS = {
  // The HUD coin counter (and later prices): what CoinHud's Label drew as Arial bold 100, outline 5.
  'hud-digits': {
    out: 'assets/fonts/hud-digits', chars: '0123456789', family: 'Arial', bold: true, size: 100, lineHeight: 100,
    fill: '#ffffff', outline: { color: '#000000', width: 5 }, columns: 5,
  },
};

/** Draws the glyphs into cells of a canvas in the page; returns the PNG as a data URL and each glyph's box and metrics. */
const DRAW = (spec) => `(() => {
  const spec = ${JSON.stringify(spec)}, S = ${SUPERSAMPLE};
  const font = (spec.bold ? 'bold ' : '') + spec.size + 'px ' + spec.family;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  ctx.font = font;
  const glyphs = Array.from(spec.chars, (ch) => {
    const m = ctx.measureText(ch);
    return { ch, advance: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
  });
  // Every glyph shares the line's ink top and bottom (so they share yoffset); the outline and 1 px of
  // antialiasing round each glyph.
  const pad = spec.outline.width + 1, ascent = Math.max(...glyphs.map((g) => g.ascent)), descent = Math.max(0, ...glyphs.map((g) => g.descent));
  const top = Math.ceil(pad + ascent), height = top + Math.ceil(descent + pad), gap = 2;
  const widths = glyphs.map((g) => Math.ceil(pad + g.left) + Math.ceil(g.right + pad));
  const cellW = Math.max(...widths) + gap, cellH = height + gap, cols = spec.columns, rows = Math.ceil(glyphs.length / cols);
  canvas.width = cols * cellW * S; canvas.height = rows * cellH * S;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * spec.outline.width; ctx.strokeStyle = spec.outline.color; ctx.fillStyle = spec.fill;
  const cells = glyphs.map((g, k) => {
    const x = (k % cols) * cellW, y = Math.floor(k / cols) * cellH, lead = Math.ceil(pad + g.left);
    ctx.strokeText(g.ch, x + lead, y + top);
    ctx.fillText(g.ch, x + lead, y + top);
    return { id: g.ch.codePointAt(0), x, y, width: widths[k], height, xoffset: -lead, advance: g.advance };
  });
  // The ink sits in the middle of the line: base = where the baseline falls for that.
  const base = Math.round((spec.lineHeight + ascent - descent) / 2);
  return { png: canvas.toDataURL('image/png'), width: cols * cellW, height: rows * cellH, base, top, cells };
})()`;

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = names.length ? names : Object.keys(FONTS);
for (const name of todo) if (!FONTS[name]) throw new Error(`unknown font ${name}; known: ${Object.keys(FONTS).join(', ')}`);

await withBrowser(async (cdp) => {
  for (const name of todo) {
    const spec = FONTS[name];
    const page = await cdp.evaluate(DRAW(spec));
    if (page.width > MAX_PAGE || page.height > MAX_PAGE) throw new Error(`${name}: page ${page.width}x${page.height} exceeds ${MAX_PAGE} (more columns/rows?)`);
    const out = join(ROOT, spec.out);
    mkdirSync(dirname(out), { recursive: true });
    const png = await sharp(Buffer.from(page.png.split(',')[1], 'base64')).resize(page.width, page.height).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
    writeFileSync(`${out}.png`, png);
    // yoffset: from the line's top to the glyph box's top (the ink top is `top` below the box top).
    const lines = [
      `info face="${spec.family}" size=${spec.size} bold=${spec.bold ? 1 : 0} italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=2,2 outline=${spec.outline.width}`,
      `common lineHeight=${spec.lineHeight} base=${page.base} scaleW=${page.width} scaleH=${page.height} pages=1 packed=0`,
      `page id=0 file="${basename(out)}.png"`,
      `chars count=${page.cells.length}`,
      ...page.cells.map((c) => `char id=${c.id} x=${c.x} y=${c.y} width=${c.width} height=${c.height} xoffset=${c.xoffset} ` +
        `yoffset=${page.base - page.top} xadvance=${Math.round(c.advance)} page=0 chnl=15`),
    ];
    writeFileSync(`${out}.fnt`, `${lines.join('\n')}\n`);
    console.log(`${name}: ${spec.out}.png ${page.width}x${page.height} (${png.length} B), ${page.cells.length} glyphs, base ${page.base}, ` +
      `advance ${[...new Set(page.cells.map((c) => Math.round(c.advance)))].join('/')} px`);
  }
});
