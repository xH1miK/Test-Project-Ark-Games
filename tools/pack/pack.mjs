#!/usr/bin/env node
// Pack a Cocos Creator 3.8 web-mobile build into ONE self-contained HTML file.
//
//   node tools/pack/pack.mjs [build/web-mobile] [-o dist/ZombieMiner.html] [--title "Zombie Miner"]
//                            [--max-dpr 2] [--budget 5000000]
//
// Layout of the output (see runtime.js for the loader side):
//   <style>      build's style.css + loading overlay
//   <body>       the build's game container markup (GameDiv / GameCanvas)
//   #zm-z        base64(gzip(all compressible files))
//   #zm-r        base64(already-compressed media: png/jpg/webp/mp3/...)
//   <script>     file table + config, then inflate fallback + loader
// index.html, style.css and the import map are not embedded as files: the page replaces them.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, posix } from 'node:path';
import { gzipSync, constants } from 'node:zlib';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
const RAW_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.ogg', '.m4a', '.mp4', '.woff', '.woff2']);
const STRICT_LIMIT = 5_000_000; // "5 MB" read the strict (decimal) way
const TARGET = 4_800_000;

// ---- args -------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : def;
};
const outFile = resolve(opt('-o', 'dist/ZombieMiner.html'));
const title = opt('--title', 'Zombie Miner');
const maxDpr = Number(opt('--max-dpr', '2'));
const budget = Number(opt('--budget', String(STRICT_LIMIT)));
const buildDir = resolve(argv[0] || 'build/web-mobile');

// ---- read the build ---------------------------------------------------------------------------
const walk = (d) =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const all = walk(buildDir).map((f) => relative(buildDir, f).split('\\').join('/')).sort();
const read = (p) => readFileSync(join(buildDir, p));

const indexHtml = read('index.html').toString('utf8');
const attr = (tag, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(tag) || [])[1];
const tags = (re) => [...indexHtml.matchAll(re)].map((m) => m[0]);

const cssFiles = tags(/<link\b[^>]*rel="stylesheet"[^>]*>/g).map((t) => attr(t, 'href'));
const scriptTags = tags(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g);
const importMapFile = scriptTags.filter((t) => attr(t, 'type') === 'systemjs-importmap').map((t) => attr(t, 'src'))[0];
const bootScripts = scriptTags.filter((t) => !attr(t, 'type')).map((t) => attr(t, 'src'));
const entry = (/System\.import\(\s*['"]([^'"]+)['"]\s*\)/.exec(indexHtml) || [])[1];
const bodyMarkup = (/<body[^>]*>([\s\S]*?)<script/.exec(indexHtml) || [])[1]?.trim();
if (!importMapFile || !bootScripts.length || !entry || !bodyMarkup) throw new Error('unexpected index.html layout');

// Import-map targets are relative to the map file; the inline map resolves against the page.
const importMap = JSON.parse(read(importMapFile).toString('utf8'));
const mapDir = posix.dirname(importMapFile);
for (const [k, v] of Object.entries(importMap.imports || {})) {
  if (/^\.\.?\//.test(v)) importMap.imports[k] = './' + posix.normalize(posix.join(mapDir, v));
}

const skip = new Set(['index.html', importMapFile, ...cssFiles]);
const packed = all.filter((p) => !skip.has(p));
for (const s of bootScripts) if (!packed.includes(s)) throw new Error(`boot script missing: ${s}`);

// ---- build the two sections ---------------------------------------------------------------------
const isRaw = (p) => RAW_EXT.has(posix.extname(p).toLowerCase());
const table = [];
const sections = [[], []];
const offsets = [0, 0];
for (const p of packed) {
  const buf = read(p);
  const sec = isRaw(p) ? 1 : 0;
  table.push([p, sec, offsets[sec], buf.length]);
  sections[sec].push(buf);
  offsets[sec] += buf.length;
}
const gzip = (buf) => gzipSync(buf, { level: 9, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY });
const zB64 = gzip(Buffer.concat(sections[0])).toString('base64');
const rB64 = Buffer.concat(sections[1]).toString('base64');

// ---- page -----------------------------------------------------------------------------------------
const css = cssFiles.map((f) => read(f).toString('utf8')).join('\n');
// The page is one canvas that the finger steers on: no scrolling, no pull-to-refresh, no rubber band, no zoom or long-press menu.
const loaderCss = `
html,body{overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-touch-callout:none;-webkit-text-size-adjust:100%}
#zm-loading{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:#334c78;z-index:10}
#zm-loading:after{content:"";width:44px;height:44px;border-radius:50%;border:5px solid rgba(255,255,255,.25);border-top-color:#fff;animation:zm-spin .8s linear infinite}
#zm-loading[data-error]:after{content:attr(data-error);width:auto;height:auto;border:0;border-radius:0;animation:none;color:#fff;font:14px sans-serif;padding:16px}
@keyframes zm-spin{to{transform:rotate(360deg)}}`;
const cfg = { entry, importMap, scripts: bootScripts, maxDpr };
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const runtime = readFileSync(join(HERE, 'inflate.js'), 'utf8') + '\n' + readFileSync(join(HERE, 'runtime.js'), 'utf8');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<style>${css}${loaderCss}</style>
</head>
<body>
${bodyMarkup}
<div id="zm-loading"></div>
<script type="text/plain" id="zm-z">${zB64}</script>
<script type="text/plain" id="zm-r">${rB64}</script>
<script>window.__ZM_FILES__=${JSON.stringify(table)};window.__ZM_CFG__=${esc(JSON.stringify(cfg))};</script>
<script>
${esc(runtime)}
</script>
</body>
</html>
`;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);

// ---- size report ------------------------------------------------------------------------------------
const size = Buffer.byteLength(html);
const b64len = (n) => Math.ceil(n / 3) * 4;
// The game's own code is compiled into the main bundle's index.js; src/chunks/ only holds a loader stub.
const groupOf = (p) =>
  p.startsWith('cocos-js/') ? 'engine  cocos-js/'
  : /^assets\/main\/index(\.[0-9a-f]+)?\.js$/.test(p) ? 'game code  assets/main/index.js'
  : p.startsWith('assets/') ? `bundle  ${p.split('/').slice(0, 2).join('/')}/`
  : p.startsWith('src/chunks/') ? 'chunk stub  src/chunks/'
  : p === 'src/settings.json' ? 'settings  src/settings.json'
  : 'boot  polyfills, SystemJS, index/application.js';
const groups = new Map();
for (const [p, sec, , len] of table) {
  const g = groups.get(groupOf(p)) || { raw: 0, z: [], r: 0, n: 0 };
  g.raw += len;
  g.n++;
  if (sec) g.r += len;
  else g.z.push(read(p));
  groups.set(groupOf(p), g);
}
const kb = (n) => (n / 1024).toFixed(1).padStart(8) + ' KB';
console.log(`packed ${packed.length} files from ${relative(process.cwd(), buildDir)} -> ${relative(process.cwd(), outFile)}\n`);
console.log('group'.padEnd(52) + 'raw'.padStart(11) + 'in HTML ≈'.padStart(12));
let est = 0;
for (const [name, g] of [...groups].sort((a, b) => b[1].raw - a[1].raw)) {
  const inHtml = (g.z.length ? b64len(gzip(Buffer.concat(g.z)).length) : 0) + b64len(g.r);
  est += inHtml;
  console.log(`${name} (${g.n})`.padEnd(52) + kb(g.raw) + kb(inHtml));
}
console.log('shell  html, css, file table, loader'.padEnd(52) + ''.padStart(11) + kb(size - zB64.length - rB64.length));
console.log(`\nTOTAL ${size.toLocaleString('en')} bytes = ${(size / 1e6).toFixed(3)} MB = ${(size / 1048576).toFixed(3)} MiB`);
console.log(`  compressible: ${kb(offsets[0])} raw -> ${kb(zB64.length)} (gzip+base64); media: ${kb(offsets[1])} -> ${kb(rB64.length)}`);
console.log(`  budget ${(budget / 1e6).toFixed(1)} MB: ${size <= budget ? 'OK' : 'OVER'}, headroom ${((budget - size) / 1e6).toFixed(3)} MB` +
  (size > TARGET ? `  (!) above the ${(TARGET / 1e6).toFixed(1)} MB target` : ''));
process.exit(size <= budget ? 0 : 2);
