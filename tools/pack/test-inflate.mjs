// Checks the fallback inflate (tools/pack/inflate.js) against Node's zlib.
//   node tools/pack/test-inflate.mjs [extra files...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, constants } from 'node:zlib';
import vm from 'node:vm';

const ctx = { Uint8Array, Uint16Array, Error };
vm.runInNewContext(readFileSync(new URL('./inflate.js', import.meta.url), 'utf8'), ctx);
const { zmGunzip } = ctx;

const cases = [
  ['empty', Buffer.alloc(0)],
  ['one byte', Buffer.from('a')],
  ['short text', Buffer.from('hello hello hello hello world')],
  ['random 200 KB (stored blocks)', randomBytes(200_000)],
  ['zeros 1 MB (long matches)', Buffer.alloc(1 << 20)],
  ['mixed', Buffer.concat([randomBytes(5000), Buffer.from('abc'.repeat(30_000)), randomBytes(70_000)])],
];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
try {
  for (const f of walk('build/web-mobile')) cases.push([f, readFileSync(f)]);
} catch { /* no build yet */ }
for (const f of process.argv.slice(2)) cases.push([f, readFileSync(f)]);

let failed = 0;
for (const [name, data] of cases) {
  for (const level of [1, 6, 9]) {
    for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FIXED, constants.Z_HUFFMAN_ONLY]) {
      const gz = gzipSync(data, { level, strategy });
      let ok = false;
      let err = '';
      try {
        ok = Buffer.from(zmGunzip(new Uint8Array(gz))).equals(data);
      } catch (e) {
        err = e.message;
      }
      if (!ok) {
        failed++;
        console.log(`FAIL ${name} level=${level} strategy=${strategy} ${err}`);
      }
    }
  }
}
const t0 = performance.now();
const big = Buffer.concat(cases.map((c) => c[1]));
zmGunzip(new Uint8Array(gzipSync(big, { level: 9 })));
console.log(`${cases.length} inputs x 9 settings, ${failed} failures; ${(big.length / 1e6).toFixed(2)} MB in ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(failed ? 1 : 0);
