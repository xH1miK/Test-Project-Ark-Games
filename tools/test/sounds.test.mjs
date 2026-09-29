import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLIPS, TARGETS } from '../audio/sounds.mjs';
import { build } from '../audio/make-sounds.mjs';
import { scanFrames, withGaplessTag } from '../audio/lib/mp3tag.mjs';
import { encodeMp3 } from '../audio/lib/encode.mjs';
import { spectrum } from '../audio/lib/spectrum.mjs';
import { activeRms, gainToDb, peakOf } from '../audio/lib/synth.mjs';

// The S1 sounds: synthesized in Node (tools/audio), calibrated to what was MEASURED on the example's clips.
// Rendered once and shared by the tests below.
const rendered = new Map();
const pcmOf = (clip) => {
  if (!rendered.has(clip.name)) rendered.set(clip.name, clip.make());
  return rendered.get(clip.name);
};
const byRole = (role) => CLIPS.filter((c) => c.role === role);
const hash = (x) => createHash('sha1').update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest('hex');

test('the catalogue: what the game needs, each name once, sensible formats', () => {
  const names = CLIPS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(['music', 'engine', 'grind', 'upgrade', 'purchase', 'gate'].filter((n) => !names.includes(n)), []);
  assert.equal(byRole('ball').length, 5);
  assert.equal(byRole('coin').length, 5);
  for (const c of CLIPS) assert.ok(c.format === 'wav' || c.format === 'mp3', c.name);
  // Loops are the three that never end; everything else is a one-shot.
  assert.deepEqual(CLIPS.filter((c) => c.loop).map((c) => c.name), ['music', 'engine', 'grind']);
});

test('every clip is finite, never clips, and is not silent', () => {
  for (const clip of CLIPS) {
    const x = pcmOf(clip);
    assert.ok(x.length > 0, clip.name);
    for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) assert.fail(`${clip.name}: sample ${i} is ${x[i]}`);
    const peak = peakOf(x);
    assert.ok(peak < 1 && peak > 0.05, `${clip.name}: peak ${peak}`);
  }
});

test('rendering is deterministic: the same seed gives the same samples', () => {
  for (const clip of CLIPS.filter((c) => c.name !== 'music')) assert.equal(hash(clip.make()), hash(pcmOf(clip)), clip.name);
  assert.equal(hash(CLIPS.find((c) => c.name === 'music').make()), hash(pcmOf(CLIPS.find((c) => c.name === 'music'))));
});

test('levels are set to the measured counterparts in the example (peak for one-shots, active RMS for the loops)', () => {
  for (const clip of CLIPS) {
    const [kind, db] = TARGETS[clip.role];
    const x = pcmOf(clip);
    const got = kind === 'peak' ? gainToDb(peakOf(x)) : gainToDb(activeRms(x, clip.rate));
    assert.ok(Math.abs(got - db) < 0.3, `${clip.name}: ${kind} ${got.toFixed(2)} dBFS, calibrated to ${db}`);
  }
  // The engine sits near full scale like the example's, but does not clip.
  assert.ok(gainToDb(peakOf(pcmOf(CLIPS.find((c) => c.name === 'engine')))) <= -0.4);
});

test('lengths: clicks are short, coins a little longer, the loops whole numbers of their periods', () => {
  const sec = (name) => { const c = CLIPS.find((k) => k.name === name); return pcmOf(c).length / c.rate; };
  for (const c of byRole('ball')) assert.ok(sec(c.name) >= 0.06 && sec(c.name) <= 0.13, c.name);
  for (const c of byRole('coin')) assert.ok(sec(c.name) >= 0.2 && sec(c.name) <= 0.3, c.name);
  assert.ok(sec('upgrade') > 0.5 && sec('upgrade') < 1);
  assert.ok(sec('purchase') > 0.5 && sec('purchase') < 1);
  assert.ok(sec('gate') > 1.2 && sec('gate') < 2.5, 'longer than the 0.85 s the curtain takes: the whoosh rings out');
  assert.equal(sec('music'), 12);
  assert.equal(sec('engine'), 1.6);
  assert.equal(sec('grind'), 2);
});

test('loops are seamless: the jump from the last sample to the first is no bigger than the sound\'s own largest step', () => {
  for (const clip of CLIPS.filter((c) => c.loop)) {
    const x = pcmOf(clip);
    let maxStep = 0;
    for (let i = 0; i + 1 < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i + 1] - x[i]));
    const jump = Math.abs(x[x.length - 1] - x[0]);
    assert.ok(jump <= maxStep, `${clip.name}: seam ${jump.toFixed(4)} vs largest step ${maxStep.toFixed(4)}`);
  }
});

test('the music loop starts and ends at silence (an MP3 must not see an abrupt start)', () => {
  const x = pcmOf(CLIPS.find((c) => c.name === 'music'));
  assert.ok(Math.abs(x[0]) < 1e-6);
  assert.ok(Math.abs(x[x.length - 1]) < 1e-3);
});

test('timbre follows the measurements of the example (tools/audio/analyze.mjs on its clips)', () => {
  for (const c of byRole('ball')) {
    const s = spectrum(pcmOf(c), c.rate);
    assert.ok(s.centroid > 700 && s.centroid < 1400, `${c.name} centroid ${s.centroid.toFixed(0)}`);
    assert.ok(s.bands[2] > 0.9, `${c.name}: ${(s.bands[2] * 100).toFixed(0)}% in 0.6-2.5 kHz (the example: 94-98%)`);
  }
  for (const c of byRole('coin')) {
    const s = spectrum(pcmOf(c), c.rate);
    assert.ok(s.centroid > 2000 && s.centroid < 3500, `${c.name} centroid ${s.centroid.toFixed(0)} (the example: 2350-2940)`);
  }
  const grind = spectrum(pcmOf(CLIPS.find((c) => c.name === 'grind')), 16000).bands;
  [0.17, 0.51, 0.19, 0.14].forEach((want, i) => assert.ok(Math.abs(grind[i] - want) < 0.07, `grind band ${i}: ${(grind[i] * 100).toFixed(0)}% vs the example ${want * 100}%`));
  const engine = spectrum(pcmOf(CLIPS.find((c) => c.name === 'engine')), 11025);
  assert.ok(engine.bands[0] > 0.7 && engine.centroid < 300, 'the engine is a low rumble');
  const music = spectrum(pcmOf(CLIPS.find((c) => c.name === 'music')), 22050);
  assert.ok(music.centroid > 200 && music.centroid < 400, `music centroid ${music.centroid.toFixed(0)} (the example: 284)`);
  const purchase = spectrum(pcmOf(CLIPS.find((c) => c.name === 'purchase')), 16000);
  assert.ok(purchase.bands[1] > 0.8, 'purchase is a soft chord in the low-mid range');
});

test('coin variants rise in pitch (the pads step through them as they fill)', () => {
  const centroids = byRole('coin').map((c) => spectrum(pcmOf(c), c.rate).centroid);
  for (let i = 1; i < centroids.length; i++) assert.ok(centroids[i] > centroids[i - 1], centroids.map((v) => v.toFixed(0)).join(' < '));
});

test('ball variants go from low to high', () => {
  const centroids = byRole('ball').map((c) => spectrum(pcmOf(c), c.rate).centroid);
  for (let i = 1; i < centroids.length; i++) assert.ok(centroids[i] > centroids[i - 1], centroids.map((v) => v.toFixed(0)).join(' < '));
});

test('the whole set is small: encoded files stay under 400 KB', async () => {
  let total = 0;
  for (const clip of CLIPS) total += (await build(clip)).bytes.length;
  assert.ok(total < 400 * 1024, `${(total / 1024).toFixed(1)} KB`);
});

test('gapless MP3 tag: frames x samples-per-frame - delay - padding = the source length; sizes and marker agree', async () => {
  const rate = 22050, n = rate; // one second
  const pcm = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5);
  const raw = await encodeMp3(pcm, rate, { bitrate: 48 });
  const tagged = withGaplessTag(raw, n);
  const before = scanFrames(raw), after = scanFrames(tagged);
  assert.equal(after.frames, before.frames + 1, 'one extra frame: the tag');
  // Find the tag frame and read it back.
  const at = tagged.indexOf('Info');
  assert.ok(at > 0 && at < 40, `"Info" at ${at}`);
  assert.equal(tagged.readUInt32BE(at + 4), 0x0f);
  assert.equal(tagged.readUInt32BE(at + 8), before.frames, 'frame count excludes the tag frame');
  assert.equal(tagged.readUInt32BE(at + 12), tagged.length, 'byte count = the whole file');
  const lame = at + 4 + 4 + 4 + 4 + 100 + 4;
  assert.equal(tagged.toString('latin1', lame, lame + 4), 'LAME');
  const dp = (tagged[lame + 21] << 16) | (tagged[lame + 22] << 8) | tagged[lame + 23];
  const delay = dp >> 12, padding = dp & 0xfff;
  assert.equal(delay, 576);
  assert.equal(before.frames * 576 - delay - padding, n, 'trimmed length is exactly the source');
  assert.throws(() => withGaplessTag(raw, n * 3), /longer than the frames/);
});
