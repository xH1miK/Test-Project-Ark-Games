// Size study for the sound stage: three representative signals (a short click, a 1-second loop, a 20-second
// music loop) in every candidate format. Prints bytes; writes nothing.
//   node tools/audio/size-study.mjs
import { encodeMp3, encodeOgg, encodeWav } from './lib/encode.mjs';

const TAU = Math.PI * 2;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function make(seconds, rate, fn) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / rate, seconds);
  return out;
}

// A billiard-ish click: a decaying pair of sines with a noise transient.
const click = (rate) => make(0.14, rate, (t) => (Math.sin(TAU * 1900 * t) * 0.5 + Math.sin(TAU * 3100 * t) * 0.3 + rnd() * 0.2 * Math.exp(-t * 200)) * Math.exp(-t * 28));
// A motor: low buzz + harmonics + a little noise (exactly periodic in 1 s for the tones).
const motor = (rate) => make(1, rate, (t) => (Math.sin(TAU * 55 * t) * 0.5 + Math.sin(TAU * 110 * t) * 0.3 + Math.sin(TAU * 165 * t) * 0.15 + rnd() * 0.05) * 0.8);
// Music: a pentatonic arpeggio over a soft pad.
const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
const music = (rate) => make(20, rate, (t) => {
  const step = Math.floor(t * 4), f = scale[(step * 3 + (step >> 2)) % scale.length], u = (t * 4) % 1;
  return Math.sin(TAU * f * t) * 0.3 * Math.exp(-u * 3) + Math.sin(TAU * (scale[0] / 2) * t) * 0.12 + Math.sin(TAU * (scale[2] / 2) * t) * 0.08;
});

const kb = (b) => (b.length / 1024).toFixed(1).padStart(7) + ' KB';
const signals = [['click 0.14 s', click], ['motor loop 1 s', motor], ['music loop 20 s', music]];

for (const [name, gen] of signals) {
  console.log(`\n${name}`);
  for (const rate of [22050, 32000, 44100]) {
    const pcm = gen(rate);
    const row = [`  ${String(rate).padStart(5)} Hz`];
    for (const bitrate of [32, 48, 64]) row.push(`mp3 ${bitrate}k ${kb(await encodeMp3(pcm, rate, { bitrate }))}`);
    row.push(`mp3 vbr6 ${kb(await encodeMp3(pcm, rate, { vbrQuality: 6 }))}`);
    row.push(`ogg q0 ${kb(await encodeOgg(pcm, rate, { vbrQuality: 0 }))}`);
    row.push(`wav16 ${kb(encodeWav(pcm, rate, 16))}`);
    console.log(row.join('  '));
  }
  const pcm11 = gen(11025);
  console.log(`  11025 Hz  wav8 ${kb(encodeWav(pcm11, 11025, 8))}  wav16 ${kb(encodeWav(pcm11, 11025, 16))}`);
}
