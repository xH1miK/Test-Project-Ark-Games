// Throwaway (S0 spike): a 0.5 s 440 Hz tone as MP3 into assets/resources/spike/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeMp3 } from './lib/encode.mjs';

const rate = 22050;
const pcm = new Float32Array(rate / 2);
for (let i = 0; i < pcm.length; i++) {
  const t = i / rate;
  pcm[i] = Math.sin(2 * Math.PI * 440 * t) * 0.5 * Math.min(1, t * 200, (0.5 - t) * 200);
}
mkdirSync('assets/resources/spike', { recursive: true });
const mp3 = await encodeMp3(pcm, rate, { bitrate: 48 });
writeFileSync('assets/resources/spike/beep.mp3', mp3);
console.log('assets/resources/spike/beep.mp3', mp3.length, 'bytes');
