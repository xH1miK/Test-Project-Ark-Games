// Measures audio files by decoding them in the headless browser (the same decoder the game uses).
//   node tools/audio/analyze.mjs <file|dir>... [--json out.json]
// Per file: length, channels, peak and RMS (dBFS), where the sound starts and ends (below 1% of the peak = silence),
// spectral centroid and how the energy splits over bands, a 16-step loudness shape, and the "seam" of a loop
// (the jump from the last sample to the first, and the level of the last vs the first 30 ms).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { withBrowser } from '../lib/browser.mjs';

const PAGE_FN = `(() => {
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  };
  const db = (v) => (v > 1e-9 ? 20 * Math.log10(v) : -180);
  window.__analyze = async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels;
    const x = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / ch; }
    let peak = 0, sum = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; }
    const thr = peak * 0.01;
    let first = 0, last = n - 1;
    while (first < n && Math.abs(x[first]) < thr) first++;
    while (last > 0 && Math.abs(x[last]) < thr) last--;
    // RMS over the windows that are not near-silent (within 40 dB of the loudest window).
    const win = Math.round(sr * 0.05), rmsList = [];
    for (let s = 0; s + win <= n; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += x[i] * x[i]; rmsList.push(Math.sqrt(e / win)); }
    const top = Math.max(...rmsList, 1e-9);
    const act = rmsList.filter((r) => r > top * 0.01);
    const rmsActive = act.length ? Math.sqrt(act.reduce((a, r) => a + r * r, 0) / act.length) : 0;
    // Spectrum: Hann windows of 2048, hop 2048, energy-weighted.
    const N = 2048, edges = [150, 600, 2500, 8000], bands = [0, 0, 0, 0, 0];
    let cNum = 0, cDen = 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let s = 0; s + N <= n; s += N) {
      for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const e = re[k] * re[k] + im[k] * im[k], f = k * sr / N;
        cNum += f * e; cDen += e;
        let b = 0; while (b < edges.length && f >= edges[b]) b++;
        bands[b] += e;
      }
    }
    const bsum = bands.reduce((a, v) => a + v, 0) || 1;
    // Loudness shape: 16 equal steps, RMS in dB relative to the loudest step.
    const step = Math.max(1, Math.floor(n / 16)), shape = [];
    for (let s = 0; s < 16; s++) { let e = 0, c = 0; for (let i = s * step; i < Math.min(n, (s + 1) * step); i++) { e += x[i] * x[i]; c++; } shape.push(Math.sqrt(e / Math.max(1, c))); }
    const smax = Math.max(...shape, 1e-9);
    // The seam of a loop: the jump from the last sample to the first, in units of the signal's own largest sample-to-sample
    // step (<= 1 means the loop point is no rougher than the sound itself; a resampled sharp waveform reads high on p99).
    const steps = new Float32Array(n - 1);
    for (let i = 0; i + 1 < n; i++) steps[i] = Math.abs(x[i + 1] - x[i]);
    steps.sort();
    const seamRatio = Math.abs(x[n - 1] - x[0]) / Math.max(1e-9, steps[steps.length - 1]);
    const ms30 = Math.round(sr * 0.03);
    const rmsOf = (a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
    return {
      sr, ch, dur: n / sr, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), rmsActiveDb: db(rmsActive),
      leadMs: first / sr * 1000, tailMs: (n - 1 - last) / sr * 1000,
      centroid: cDen ? cNum / cDen : 0, bands: bands.map((v) => v / bsum),
      shape: shape.map((v) => Math.round(db(v / smax))),
      seamJump: seamRatio,
      headDb: db(rmsOf(0, ms30)), tailDb: db(rmsOf(n - ms30, n)),
    };
  };
  return true;
})()`;

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args.splice(jsonIdx, 2)[1] : null;
const files = args.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a).map((f) => join(a, f)) : [a]))
  .filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f)).sort();
if (!files.length) throw new Error('no audio files');

const rows = [];
await withBrowser(async (cdp) => {
  await cdp.evaluate(PAGE_FN);
  for (const f of files) {
    const bytes = readFileSync(f);
    try {
      const r = await cdp.evaluate(`window.__analyze(${JSON.stringify(bytes.toString('base64'))})`);
      rows.push({ file: basename(f), bytes: bytes.length, ...r });
    } catch (e) {
      rows.push({ file: basename(f), bytes: bytes.length, error: String(e.message || e).split('\n')[0] });
    }
  }
});

const f1 = (v, w = 6) => v.toFixed(1).padStart(w);
console.log('file'.padEnd(40) + 'KB'.padStart(6) + 'dur s'.padStart(7) + ' ch' + 'peak'.padStart(7) + 'rms'.padStart(7) + 'rmsAct'.padStart(7) + 'lead ms'.padStart(8) + 'tail ms'.padStart(8) + 'centroid'.padStart(9) + '  bands <150/<600/<2.5k/<8k/>8k %   seam/max  head/tail dB   shape');
for (const r of rows) {
  if (r.error) { console.log(r.file.padEnd(40) + ` ERROR ${r.error}`); continue; }
  console.log(r.file.slice(0, 39).padEnd(40) + f1(r.bytes / 1024) + r.dur.toFixed(3).padStart(7) + String(r.ch).padStart(3) + f1(r.peakDb, 7) + f1(r.rmsDb, 7) + f1(r.rmsActiveDb, 7) +
    f1(r.leadMs, 8) + f1(r.tailMs, 8) + f1(r.centroid, 9) + '  ' + r.bands.map((b) => (b * 100).toFixed(0).padStart(3)).join('/') +
    '  ' + r.seamJump.toFixed(3) + '  ' + r.headDb.toFixed(0).padStart(4) + '/' + r.tailDb.toFixed(0).padStart(4) + '  ' + r.shape.join(' '));
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
