// Small DSP toolbox for the game's sounds. Everything is plain Float32Array mono PCM at a chosen rate,
// deterministic (a seeded generator, no Math.random), so a rebuild gives byte-identical files.

/** mulberry32: a seeded generator returning [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const midi = (n) => 440 * 2 ** ((n - 69) / 12);
export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g > 1e-9 ? 20 * Math.log10(g) : -180);

/** Renders `seconds` of sound: fn(t, i) -> sample. */
export function render(seconds, rate, fn) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / rate, i);
  return out;
}

/** White noise in -1..1 from a generator. */
export const white = (r) => r() * 2 - 1;

/** One-pole low-pass. */
export class OnePole {
  constructor(freq, rate) {
    this.a = 1 - Math.exp((-TAU * freq) / rate);
    this.y = 0;
  }
  process(x) {
    return (this.y += this.a * (x - this.y));
  }
}

/** Chamberlin state-variable filter: cutoff and Q may change every sample. */
export class Svf {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.high = 0;
  }
  run(x, freq, q) {
    const f = 2 * Math.sin((Math.PI * Math.min(freq, this.rate * 0.15)) / this.rate); // Chamberlin: stable well below fs/4
    this.low += f * this.band;
    this.high = x - this.low - this.band / q;
    this.band += f * this.high;
  }
  lp(x, freq, q = 0.7) { this.run(x, freq, q); return this.low; }
  bp(x, freq, q = 1) { this.run(x, freq, q); return this.band / q; }
  hp(x, freq, q = 0.7) { this.run(x, freq, q); return this.high; }
}

/** A tiny Schroeder reverb (four combs, two all-passes), mono, wet signal only. */
export class Reverb {
  constructor(rate, { size = 1, feedback = 0.8, damping = 0.35 } = {}) {
    const s = (rate / 44100) * size;
    this.combs = [1557, 1617, 1491, 1422].map((n) => ({ buf: new Float32Array(Math.round(n * s)), i: 0, lp: 0 }));
    this.aps = [556, 441].map((n) => ({ buf: new Float32Array(Math.round(n * s)), i: 0 }));
    this.feedback = feedback;
    this.damping = damping;
  }
  process(x) {
    let sum = 0;
    for (const c of this.combs) {
      const y = c.buf[c.i];
      c.lp += (1 - this.damping) * (y - c.lp);
      c.buf[c.i] = x + c.lp * this.feedback;
      if (++c.i >= c.buf.length) c.i = 0;
      sum += y;
    }
    sum *= 0.25;
    for (const a of this.aps) {
      const y = a.buf[a.i];
      const v = sum + y * 0.5;
      a.buf[a.i] = v;
      sum = y - sum * 0.5;
      if (++a.i >= a.buf.length) a.i = 0;
    }
    return sum;
  }
}

// ---- level tools ----------------------------------------------------------------------------------

export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** RMS in linear units over the windows that are not near-silent (within 40 dB of the loudest 50 ms window) — the
 *  same figure analyze.mjs prints as `rmsAct`. */
export function activeRms(x, rate) {
  const win = Math.max(1, Math.round(rate * 0.05)), list = [];
  for (let s = 0; s + win <= x.length; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += x[i] * x[i];
    list.push(e / win);
  }
  if (!list.length) list.push(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));
  const top = Math.max(...list, 1e-18);
  const act = list.filter((e) => e > top * 1e-4);
  return Math.sqrt(act.reduce((a, e) => a + e, 0) / act.length);
}

export function scale(x, gain) {
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  return x;
}

export const scalePeak = (x, db) => scale(x, dbToGain(db) / Math.max(peakOf(x), 1e-9));
export const scaleRms = (x, rate, db) => scale(x, dbToGain(db) / Math.max(activeRms(x, rate), 1e-9));

/**
 * For sounds that sit near full scale (the engine): soft-clips with tanh, choosing the drive so that the active RMS
 * reaches `rmsDb` while the peak stays at `peakDb`.
 */
export function shapeToRms(x, rate, rmsDb, peakDb) {
  const peak = peakOf(x) || 1;
  const src = Float32Array.from(x, (v) => v / peak);
  let lo = 0.05, hi = 40, out = src;
  for (let k = 0; k < 40; k++) {
    const drive = Math.sqrt(lo * hi);
    out = Float32Array.from(src, (v) => Math.tanh(drive * v));
    scalePeak(out, peakDb);
    if (gainToDb(activeRms(out, rate)) < rmsDb) lo = drive;
    else hi = drive;
  }
  x.set(out);
  return x;
}

/** Linear fade-in / fade-out (seconds), in place. */
export function fade(x, rate, inS, outS) {
  const a = Math.round(inS * rate), b = Math.round(outS * rate);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

/**
 * Makes a seamless loop of `loopLen` samples from a render that is `xfade` samples longer: the head is blended with
 * the surplus tail (equal power), so the jump from the last sample to the first is an ordinary step of the signal.
 */
export function loopFrom(x, loopLen, xfade) {
  const out = x.slice(0, loopLen);
  for (let i = 0; i < xfade; i++) {
    const u = i / xfade;
    out[i] = x[i] * Math.sin((u * Math.PI) / 2) + x[loopLen + i] * Math.cos((u * Math.PI) / 2);
  }
  return out;
}

/** A soft ceiling: values above `ceil` are squeezed by tanh so nothing clips. */
export function softLimit(x, ceil = 0.95) {
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > ceil * 0.6) x[i] = Math.sign(x[i]) * (ceil * 0.6 + (ceil * 0.4) * Math.tanh((a - ceil * 0.6) / (ceil * 0.4)));
  }
  return x;
}
