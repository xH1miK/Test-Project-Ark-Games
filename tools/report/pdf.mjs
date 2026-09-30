// Markdown -> PDF for the submission (the report and the AI log), printed by the same headless Edge the
// page checks use (tools/lib/browser.mjs: one instance, closed as a whole afterwards).
//
//   node tools/report/pdf.mjs <in.md> <out.pdf> [--title "..."] [--small]
//
// Only the Markdown our docs use: #/##/### headings, paragraphs, - and 1. lists, tables, ---, **bold**,
// `code`, [text](url), <url>. A relative link is printed as its text (a PDF has no repository next to it);
// http(s) links stay links. --small: a denser layout for long, table-heavy documents (the AI log).
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowser, sleep } from '../lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : def;
};
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv.splice(i, 1), true) : false;
};
const title = opt('--title', null);
const small = flag('--small');
const [inFile, outFile] = argv;
if (!inFile || !outFile) {
  console.error('usage: node tools/report/pdf.mjs <in.md> <out.pdf> [--title "..."] [--small]');
  process.exit(2);
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline Markdown: code spans are cut out first so nothing inside them is touched. */
function inline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)'); // autolinks
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    /^https?:/.test(url) ? `<a href="${url}">${label}</a>` : label);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

const cells = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0001').split('|').map((c) => c.trim().replace(/\u0001/g, '|'));

function render(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.trimStart().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) rows.push(lines[i++]);
      const head = cells(rows[0]);
      const body = rows.slice(/^\s*\|[\s:|-]+\|\s*$/.test(rows[1] || '') ? 2 : 1).map(cells);
      const empty = head.every((c) => !c);
      // a short first column (times, labels) stays on one line; a long one wraps like the rest
      const firstWidth = Math.max(...[head, ...body].map((r) => (r[0] || '').replace(/[*`]/g, '').length));
      out.push(`<table${firstWidth <= 24 ? ' class="nw"' : ''}>` + (empty ? '' : `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`) +
        `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        items.push(m[3]);
        i++;
        // indented continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(-|\d+\.)\s/.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|---+\s*$|\s*\||\s*(-|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const size = small ? { body: 8.2, table: 7.4, h1: 15, h2: 11.5, h3: 10 } : { body: 10.2, table: 9, h1: 19, h2: 14, h3: 11.5 };
const css = `
  @page { size: A4; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: ${size.body}pt; line-height: 1.42; color: #1d1d24; margin: 0; }
  h1 { font-size: ${size.h1}pt; margin: 0 0 8pt; color: #2b1a4a; }
  h2 { font-size: ${size.h2}pt; margin: 16pt 0 6pt; color: #2b1a4a; border-bottom: 1.5pt solid #d9cff0; padding-bottom: 2pt; break-after: avoid; }
  h3 { font-size: ${size.h3}pt; margin: 12pt 0 4pt; color: #3d2a66; break-after: avoid; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 0 0 7pt; padding-left: 16pt; }
  li { margin: 0 0 3pt; }
  hr { border: 0; border-top: 1pt solid #e2dcef; margin: 12pt 0; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 0.9em; background: #f3f0f9; padding: 0 2pt; border-radius: 2pt; }
  a { color: #5b3cc4; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 9pt; font-size: ${size.table}pt; line-height: 1.33; }
  th, td { border: 0.6pt solid #d6d0e3; padding: 3pt 4.5pt; vertical-align: top; text-align: left; }
  th { background: #efeaf8; font-weight: 600; }
  tr { break-inside: avoid; }
  table.nw td:first-child { white-space: nowrap; }
  strong { font-weight: 650; }
`;

const md = readFileSync(resolve(inFile), 'utf8');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title || basename(inFile))}</title><style>${css}</style></head><body>${render(md)}</body></html>`;
const dir = mkdtempSync(join(tmpdir(), 'zm-pdf-'));
const page = join(dir, 'page.html');
writeFileSync(page, html);

try {
  await withBrowser(async (cdp) => {
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: pathToFileURL(page).href });
    for (let n = 0; n < 100 && (await cdp.evaluate('document.readyState')) !== 'complete'; n++) await sleep(100);
    await cdp.evaluate('document.fonts.ready.then(() => true)');
    const footer = `<div style="font: 7pt 'Segoe UI', Arial; color: #8a84a0; width: 100%; padding: 0 13mm; display: flex; justify-content: space-between;">` +
      `<span>${esc(title || '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
    const { data } = await cdp.send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<div></div>', footerTemplate: footer,
    });
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), Buffer.from(data, 'base64'));
  });
  console.log(`${outFile}: ${readFileSync(resolve(outFile)).length.toLocaleString('en')} bytes`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
