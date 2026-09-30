// The game's sounds, synthesized from scratch (nothing is taken from the example): what each one is, how it is
// built, and the level it is calibrated to.
//
// Levels: the example's clips were MEASURED (tools/audio/analyze.mjs on reference/audio, docs/PLAN.md, S1) and each
// of ours is set to the level of its counterpart, so the gains of the example's sound table (docs/reference-
// example-teardown.md §7, copied into Config in S2) make the same mix: the three loops end up near -35 dBFS RMS
// at their game gains, the one-shot events (upgrade, gate) are the loud ones.
//   ball click   peak -10   | coin  peak -12  | upgrade peak -3 | purchase peak -12 | gate whoosh peak -2
//   engine       RMS  -7.5  | grind RMS -22.4 | music   RMS -12.6
//
// Formats: one-shots and the two short loops are 16-bit mono WAV (exact start, no decoder delay, no loop gap in any
// browser; they are small at these rates); the music is MP3 (CBR, 22.05 kHz mono) with a gapless tag (lib/mp3tag.mjs).
import { OnePole, Reverb, Svf, TAU, activeRms, fade, loopFrom, midi, render, rng, scalePeak, scaleRms, shapeToRms, smooth, softLimit, white } from './lib/synth.mjs';

// ---- ball click: a billiard-ish "tok" (5 variants, low to high) -----------------------------------------
const BALL_PITCH = [780, 880, 1000, 1120, 1250];
const BALL_DECAY = [0.03, 0.027, 0.025, 0.022, 0.02];
const BALL_TICK = [0.35, 0.35, 0.15, 0.4, 0.45]; // the third is the "soft" one

function ball(i) {
  const rate = 22050, f = BALL_PITCH[i], r = rng(100 + i);
  const x = render(0.11, rate, (t) => {
    const body = Math.sin(TAU * f * t + 0.3) * Math.exp(-t / BALL_DECAY[i]);
    const over = 0.32 * Math.sin(TAU * f * 2.32 * t) * Math.exp(-t / 0.011);
    const thump = 0.25 * Math.sin(TAU * f * 0.5 * t) * Math.exp(-t / 0.018);
    const tick = BALL_TICK[i] * white(r) * Math.exp(-t / 0.0007);
    return (body + over + thump + tick) * Math.min(1, t / 0.0004);
  });
  fade(x, rate, 0, 0.012);
  return scalePeak(x, -10);
}

// ---- coin: a small metallic clink, three quick hits; five pitches, rising (also used, in order, for the pads) ------
const COIN_PITCH = [0.92, 1.0, 1.08, 1.17, 1.27];

function coin(i) {
  const rate = 22050, s = COIN_PITCH[i], r = rng(200 + i);
  const hits = [[0, 1], [0.05, 0.55], [0.115, 0.3]];
  const partials = [[1, 0.6, 0.05], [1.51, 1, 0.035], [2.4, 0.8, 0.025], [3.3, 0.5, 0.018]];
  const detune = hits.map(() => 1 + (r() - 0.5) * 0.06);
  const x = render(0.26, rate, (t) => {
    let v = 0;
    hits.forEach(([t0, a], h) => {
      const u = t - t0;
      if (u < 0) return;
      let sum = 0;
      for (const [m, pa, tau] of partials) sum += pa * Math.sin(TAU * 1550 * s * detune[h] * m * u) * Math.exp(-u / tau);
      v += a * sum * Math.min(1, u / 0.0004);
    });
    return v;
  });
  fade(x, rate, 0, 0.015);
  return scalePeak(x, -12);
}

// ---- upgrade: a warm chord that glides up a fourth and blooms, then two sparkles ---------------------
function upgrade() {
  const rate = 16000, notes = [55, 62, 67].map(midi);
  const phases = notes.map(() => 0);
  const x = render(0.75, rate, (t, n) => {
    const glide = 2 ** ((-5 + 5 * smooth(t / 0.28)) / 12);
    const env = smooth(t / 0.18) * Math.exp(-Math.max(0, t - 0.2) / 0.22);
    let v = 0;
    notes.forEach((f, k) => {
      phases[k] += (TAU * f * glide) / rate;
      const p = phases[k];
      v += (Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.22 * Math.sin(3 * p)) / notes.length;
    });
    v *= env;
    for (const [t0, f] of [[0.3, 1568], [0.36, 2093]]) {
      const u = t - t0;
      if (u > 0) v += 0.22 * Math.sin(TAU * f * u) * Math.exp(-u / 0.09) * Math.min(1, u / 0.003);
    }
    return v;
  });
  fade(x, rate, 0, 0.03);
  return scalePeak(x, -3);
}

// ---- purchase: a soft marimba-like opening chord, D major with a lifted top ---------------------------
function purchase() {
  const rate = 16000, chord = [[62, 1, 0.34], [69, 0.8, 0.3], [74, 0.55, 0.24], [78, 0.3, 0.2]];
  const x = render(0.8, rate, (t) => {
    let v = 0;
    chord.forEach(([m, a, tau], k) => {
      const u = t - k * 0.018;
      if (u < 0) return;
      const f = midi(m);
      v += a * (Math.sin(TAU * f * u) * Math.exp(-u / tau) + 0.3 * Math.sin(TAU * f * 3.9 * u) * Math.exp(-u / (tau / 4))) * Math.min(1, u / 0.002);
    });
    return v;
  });
  fade(x, rate, 0, 0.05);
  return scalePeak(x, -12);
}

// ---- gate whoosh: filtered noise sweeping up and back down under a swell, with a low thump at the start -----
export const GATE_WEIGHTS = { air: 3, rumble: 20, thump: 0.8 };

export function gate(w = GATE_WEIGHTS) {
  const rate = 16000, D = 1.7, r = rng(300), bp = new Svf(rate), lp = new OnePole(180, rate);
  const x = render(D, rate, (t) => {
    const centre = t < 0.75 ? 200 * (1300 / 200) ** smooth(t / 0.75) : 1300 * (500 / 1300) ** smooth((t - 0.75) / 0.95);
    const env = Math.sin(Math.PI * (t / D) ** 0.75) ** 1.6;
    const air = bp.bp(white(r), centre, 1.3) * env;
    const rumble = lp.process(white(r)) * env * (1 - t / D);
    const thump = Math.sin(TAU * 55 * t) * Math.exp(-t / 0.25) * Math.min(1, t / 0.002);
    return air * w.air + rumble * w.rumble + thump * w.thump;
  });
  fade(x, rate, 0.004, 0.08);
  return scalePeak(x, -2);
}

// ---- engine: a diesel idle, seamless 1.6 s (70 cycles of 43.75 Hz, 16 chugs) ------------------------------
export const ENGINE_WEIGHTS = { buzz: 3, putt: 0.6, tick: 30, noise: 0.15 };

export function engine(w = ENGINE_WEIGHTS) {
  const rate = 11025, L = Math.round(1.6 * rate), X = Math.round(0.08 * rate), r = rng(400);
  const f0 = 43.75, buzzLp = [1, 2, 3].map(() => new OnePole(220, rate)), nlp = new OnePole(250, rate), tickLp = [1, 2].map(() => new OnePole(700, rate));
  const raw = render(1.6 + 0.08, rate, (t) => {
    let saw = 0;
    for (let k = 1; k <= 12; k++) saw += Math.sin(TAU * k * f0 * t) / (k <= 3 ? k : k ** 2.4 / 4); // strong 44/88/131 Hz, faint above
    let buzz = saw;
    for (const p of buzzLp) buzz = p.process(buzz);
    const ph = (t * 10) % 1; // 10 chugs a second
    const sincePulse = ph / 10;
    const chug = 0.55 + 0.45 * Math.exp(-ph / 0.22);
    const putt = Math.sin(TAU * 130 * sincePulse) * Math.exp(-sincePulse / 0.03);
    let tick = white(r) * Math.exp(-sincePulse / 0.004);
    for (const p of tickLp) tick = p.process(tick);
    const wobble = 1 + 0.08 * Math.sin(TAU * 1.25 * t);
    return (buzz * chug * w.buzz + putt * w.putt + tick * w.tick + nlp.process(white(r)) * w.noise) * wobble;
  });
  const x = loopFrom(raw, L, X);
  return shapeToRms(x, rate, -7.5, -0.5);
}

// ---- grind: the shredder's rollers biting, seamless 2 s ---------------------------------------------------
export const GRIND_WEIGHTS = { rumble: 12, body: 13.2, crunch: 0.2, sizzle: 0.07, grain: 3.7, ping: 0.15 };

export function grind(w = GRIND_WEIGHTS) {
  const rate = 16000, L = 2 * rate, X = Math.round(0.08 * rate), r = rng(500);
  const rumble = [1, 2, 3].map(() => new OnePole(120, rate)), body = [new Svf(rate), new Svf(rate)], crunch = new Svf(rate), sizzle = new Svf(rate);
  // random grains: short band-passed noise bursts
  const grains = [];
  for (let k = 0; k < 130; k++) grains.push({ t0: (k / 130) * 2.1 + (r() - 0.5) * 0.012, len: 0.006 + r() * 0.014, f: 500 + r() * 1800, a: 0.4 + r() * 0.6 });
  const gf = new Svf(rate);
  const pings = [];
  for (let k = 0; k < 9; k++) pings.push({ t0: r() * 2.1, f: 1500 + r() * 1700, a: 0.05 + r() * 0.1 });
  const raw = render(2 + 0.08, rate, (t) => {
    const n = white(r);
    let low = n;
    for (const p of rumble) low = p.process(low); // steep enough to stay under ~250 Hz
    let v = low * w.rumble + body[1].bp(body[0].bp(n, 350, 1.6), 350, 1.6) * w.body + crunch.bp(n, 1400, 1) * w.crunch + sizzle.hp(n, 2400, 0.7) * w.sizzle;
    v *= 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 15 * t)); // teeth: 15 bites a second
    for (const g of grains) {
      const u = t - g.t0;
      if (u >= 0 && u < g.len) v += gf.bp(white(r), g.f, 2) * g.a * w.grain * 1.8 * Math.sin((Math.PI * u) / g.len) ** 2;
    }
    for (const p of pings) {
      const u = t - p.t0;
      if (u >= 0) v += p.a * w.ping * Math.sin(TAU * p.f * u) * Math.exp(-u / 0.05);
    }
    return v;
  });
  const x = loopFrom(raw, L, X);
  scaleRms(x, rate, -22.4);
  return softLimit(x, 0.95);
}

// ---- music C: a quiet ambient pad, 12 s loop (4 chords of 3 s) with a few sparse bells ------------------------
const CHORDS = [
  { bass: 41, pad: [57, 60, 64, 67] }, // F maj7 (F A C E G)
  { bass: 48, pad: [55, 59, 64, 67] }, // C maj7
  { bass: 45, pad: [55, 60, 64, 71] }, // A m9
  { bass: 43, pad: [50, 59, 64, 69] }, // G 6/9
];
const BELLS = [[0.6, 76], [2.1, 79], [3.9, 74], [5.4, 72], [6.9, 79], [8.4, 76], [10.2, 81], [11.1, 74]];

export function music(loops = 2) {
  const rate = 22050, LOOP = 12; // pass 1 warms every tail up; the last pass is the steady state we keep
  // Every oscillator runs on absolute time, so its frequency is rounded to a multiple of 1/12 Hz: a whole number of
  // cycles fits the loop and the seam has no phase jump (the shift is at most 0.04 Hz).
  const q = (f) => Math.round(f * LOOP) / LOOP;
  // A rotating phasor is a sine without calling Math.sin: sin(2*pi*f*t) for t = 0, 1/rate, ...
  const phasor = (freq, amp) => ({ s: 0, c: 1, ds: Math.sin((TAU * q(freq)) / rate), dc: Math.cos((TAU * q(freq)) / rate), amp });
  const detune = [2 ** (-7 / 1200), 1, 2 ** (7 / 1200)];
  const bank = CHORDS.map((c) => ({
    pad: c.pad.flatMap((m) => detune.flatMap((dt) => [1, 2, 3, 4].map((k) => phasor(midi(m) * dt * k, 0.05 / k ** 1.3)))),
    bass: [phasor(midi(c.bass), 0.16), phasor(2 * midi(c.bass), 0.064)],
  }));
  const rot = (o) => {
    const v = o.s * o.amp;
    const s = o.s * o.dc + o.c * o.ds;
    o.c = o.c * o.dc - o.s * o.ds;
    o.s = s;
    return v;
  };
  const filter = new Svf(rate), reverb = new Reverb(rate, { size: 1.4, feedback: 0.84, damping: 0.4 });
  const envOf = (d) => (d < 0 ? 0 : smooth(d / 1.1) * (d < 3 ? 1 : Math.exp(-(d - 3) / 0.9)));
  const total = render(LOOP * loops, rate, (t) => {
    const u = t % LOOP;
    let pad = 0, bass = 0;
    bank.forEach((voices, ci) => {
      // this pass's chord plus the same chord still ringing from the previous pass
      const d = u - ci * 3, dPrev = u - (ci * 3 - LOOP);
      const e0 = envOf(d), e1 = envOf(dPrev), env = e0 + e1;
      let p = 0;
      for (const o of voices.pad) p += rot(o); // every oscillator keeps running, sounding or not, to stay on absolute time
      const b = rot(voices.bass[0]) + rot(voices.bass[1]);
      if (env < 1e-4) return;
      pad += p * env;
      bass += b * (smooth(d / 0.3) * e0 + e1);
    });
    pad *= 0.85 + 0.15 * Math.sin((TAU * t) / 6);
    const padded = filter.lp(pad, 650 + 250 * Math.sin((TAU * t) / LOOP), 0.9);
    // bells: every event of this pass and the earlier ones, by absolute time
    let bell = 0;
    for (let pass = 0; pass <= Math.floor(t / LOOP); pass++) {
      for (const [tb, m] of BELLS) {
        const d = t - (pass * LOOP + tb);
        if (d < 0 || d > 6) continue;
        const f = midi(m);
        bell += 0.14 * (Math.sin(TAU * f * d) * Math.exp(-d / 0.9) + 0.25 * Math.sin(TAU * 2.76 * f * d) * Math.exp(-d / 0.25)) * Math.min(1, d / 0.003);
      }
    }
    return padded + bass + bell * 0.5 + reverb.process(bell * 0.9) * 0.9;
  });
  const x = total.slice(LOOP * (loops - 1) * rate);
  scaleRms(x, rate, -12.6);
  softLimit(x, 0.96);
  // An MP3 smears an abrupt start and a decoder then plays a different first sample than the last one; a few ms of
  // fade at both ends keeps the seam clean (the gapless tag takes care of the length).
  return fade(x, rate, 0.02, 0.02);
}

// ---- the catalogue --------------------------------------------------------------------------------------
/** name, format, rate, loop?, make(). Order = the order in the preview page. */
export const CLIPS = [
  { name: 'music', role: 'music', format: 'mp3', rate: 22050, bitrate: 48, loop: true, make: music },
  { name: 'engine', role: 'engine', format: 'wav', rate: 11025, loop: true, make: () => engine() },
  { name: 'grind', role: 'grind', format: 'wav', rate: 16000, loop: true, make: () => grind() },
  ...[0, 1, 2, 3, 4].map((i) => ({ name: `ball_${i + 1}`, role: 'ball', format: 'wav', rate: 22050, make: () => ball(i) })),
  ...[0, 1, 2, 3, 4].map((i) => ({ name: `coin_${i + 1}`, role: 'coin', format: 'wav', rate: 22050, make: () => coin(i) })),
  { name: 'upgrade', role: 'upgrade', format: 'wav', rate: 16000, make: upgrade },
  { name: 'purchase', role: 'purchase', format: 'wav', rate: 16000, make: purchase },
  { name: 'gate', role: 'gate', format: 'wav', rate: 16000, make: () => gate() },
];

/** What the calibration above promises, for the tests: [measure, dBFS]. */
export const TARGETS = {
  ball: ['peak', -10], coin: ['peak', -12], upgrade: ['peak', -3], purchase: ['peak', -12], gate: ['peak', -2],
  engine: ['rms', -7.5], grind: ['rms', -22.4], music: ['rms', -12.6],
};

export { activeRms };
