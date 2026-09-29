// Renders every sound of tools/audio/sounds.mjs into assets/audio/ (WAV or gapless MP3) and prints what it made.
//   node tools/audio/make-sounds.mjs [name ...]     (no names = all)
// Deterministic: running it twice gives identical files. The preview page is a separate step (preview.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { CLIPS } from './sounds.mjs';
import { encodeMp3, encodeWav } from './lib/encode.mjs';
import { withGaplessTag } from './lib/mp3tag.mjs';
import { activeRms, gainToDb, peakOf } from './lib/synth.mjs';

export const OUT_DIR = 'assets/audio';

/** Renders and encodes one clip: { file, bytes: Buffer, pcm, rate }. */
export async function build(clip) {
  const pcm = clip.make();
  let bytes;
  if (clip.format === 'wav') bytes = encodeWav(pcm, clip.rate, 16);
  else bytes = withGaplessTag(await encodeMp3(pcm, clip.rate, { bitrate: clip.bitrate }), pcm.length);
  return { file: `${clip.name}.${clip.format}`, bytes, pcm, rate: clip.rate };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const only = process.argv.slice(2);
  const clips = only.length ? CLIPS.filter((c) => only.includes(c.name)) : CLIPS;
  mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  console.log('file'.padEnd(16) + 'rate'.padStart(7) + 'sec'.padStart(7) + 'KB'.padStart(8) + 'peak dB'.padStart(9) + 'rms dB'.padStart(8));
  for (const clip of clips) {
    const t0 = performance.now();
    const out = await build(clip);
    writeFileSync(`${OUT_DIR}/${out.file}`, out.bytes);
    total += out.bytes.length;
    console.log(out.file.padEnd(16) + String(out.rate).padStart(7) + (out.pcm.length / out.rate).toFixed(2).padStart(7) + (out.bytes.length / 1024).toFixed(1).padStart(8) +
      gainToDb(peakOf(out.pcm)).toFixed(1).padStart(9) + gainToDb(activeRms(out.pcm, out.rate)).toFixed(1).padStart(8) + `   ${(performance.now() - t0).toFixed(0)} ms`);
  }
  console.log(`\n${clips.length} files, ${(total / 1024).toFixed(1)} KB`);
}
