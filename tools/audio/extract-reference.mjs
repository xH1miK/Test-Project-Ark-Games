// Local analysis aid (S1): pulls the audio entries (kind "a") out of the employer's example page into
// reference/audio/ (gitignored) so their length and level can be MEASURED. Never shipped, never copied into assets/.
//   node tools/audio/extract-reference.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const html = readFileSync('reference/example/index.html', 'utf8');
const start = html.indexOf('__PWDATA__=') + '__PWDATA__='.length;
// The array is JSON; find its end by bracket depth outside strings.
let depth = 0, inStr = false, end = start;
for (let i = start; i < html.length; i++) {
  const c = html[i];
  if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true;
  else if (c === '[') depth++;
  else if (c === ']' && --depth === 0) { end = i + 1; break; }
}
const data = JSON.parse(html.slice(start, end));
mkdirSync('reference/audio', { recursive: true });
for (const [path, kind, mime, b64] of data) {
  if (kind !== 'a') continue;
  const out = `reference/audio/${basename(path)}`;
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(out, mime, Math.round((b64.length * 3) / 4), 'bytes');
}
console.log('entries in total:', data.length);
