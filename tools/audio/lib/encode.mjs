// PCM (mono Float32Array, -1..1) -> file bytes. MP3 and Ogg Vorbis through wasm-media-encoders (LAME /
// libvorbis compiled to WebAssembly: no native ffmpeg needed), WAV written by hand.
import { createMp3Encoder, createOggEncoder } from 'wasm-media-encoders';

function drain(encoder, pcm) {
  const parts = [];
  const chunk = 1 << 16;
  for (let i = 0; i < pcm.length; i += chunk) {
    // The returned view is owned by the encoder: copy it.
    parts.push(Buffer.from(encoder.encode([pcm.subarray(i, i + chunk)])));
  }
  parts.push(Buffer.from(encoder.finalize()));
  return Buffer.concat(parts);
}

/** options: { bitrate } (CBR, kbps) or { vbrQuality } (0 best .. 9 smallest). sampleRate: 16000..48000 (MPEG-1/2). */
export async function encodeMp3(pcm, sampleRate, options = {}) {
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate, channels: 1, ...(options.bitrate ? { bitrate: options.bitrate } : { vbrQuality: options.vbrQuality ?? 4 }) });
  return drain(encoder, pcm);
}

/** options: { vbrQuality } (-1 smallest .. 10 best). */
export async function encodeOgg(pcm, sampleRate, options = {}) {
  const encoder = await createOggEncoder();
  encoder.configure({ sampleRate, channels: 1, vbrQuality: options.vbrQuality ?? 0 });
  return drain(encoder, pcm);
}

/** PCM WAV, mono; bits = 16 or 8 (unsigned). */
export function encodeWav(pcm, sampleRate, bits = 16) {
  const bytes = bits / 8;
  const data = Buffer.alloc(pcm.length * bytes);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    if (bits === 16) data.writeInt16LE(Math.round(v * 32767), i * 2);
    else data.writeUInt8(Math.round(v * 127 + 128), i);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * bytes, 28);
  head.writeUInt16LE(bytes, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
