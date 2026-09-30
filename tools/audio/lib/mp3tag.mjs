// Gapless MP3: an encoder's output decodes a little longer than its source (LAME's 576-sample delay, the
// decoder's 529, and the padding of the last frame). Decoders that read the "Info" tag written at the front of a
// LAME file (delay + padding) cut exactly that off; wasm-media-encoders does not write it, so we do.
// CBR streams only (one frame's size is then known from its header).

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Header of the MPEG audio frame at `o`, or null. Layer III only. */
function frameAt(b, o) {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[o + 1] >> 1) & 3; // 1 = III
  const brIdx = b[o + 2] >> 4, srIdx = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1;
  if (layer !== 1 || version === 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[brIdx];
  const rate = RATES[version][srIdx];
  return { version, bitrate, rate, mono: ((b[o + 3] >> 6) & 3) === 3, samples: version === 3 ? 1152 : 576, size: Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / rate) + pad };
}

/** Number of frames and the first frame's header. */
export function scanFrames(mp3) {
  let o = 0, frames = 0, first = null;
  while (o < mp3.length) {
    const f = frameAt(mp3, o);
    if (!f) throw new Error(`bad frame at byte ${o} (frame ${frames})`);
    first ||= f;
    frames++;
    o += f.size;
  }
  return { frames, first };
}

// CRC-16 (poly 0x8005 reflected, init 0) as LAME uses for the tag.
function crc16(bytes, end) {
  let crc = 0;
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc & 0xffff;
}

/**
 * Prepends the Info frame. `samples` = length of the source in samples (at the encoder's rate), `delay` = 576
 * (LAME's encoder delay). Returns a new Buffer.
 */
export function withGaplessTag(mp3, samples, delay = 576) {
  const { frames, first } = scanFrames(mp3);
  const { version, rate, mono, samples: spf } = first;
  const infoAt = 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17); // after the header and the side info
  const lameAt = infoAt + 4 + 4 + 4 + 4 + 100 + 4; // "Info", flags, frames, bytes, TOC, quality
  const end = lameAt + 36;
  // A frame just big enough for the tag: the smallest valid bitrate whose frame holds `end` bytes.
  const table = version === 3 ? BITRATES_V1 : BITRATES_V2;
  let brIdx = 1;
  while (brIdx < 14 && Math.floor(((version === 3 ? 144 : 72) * table[brIdx] * 1000) / rate) < end) brIdx++;
  const size = Math.floor(((version === 3 ? 144 : 72) * table[brIdx] * 1000) / rate);
  const frame = Buffer.alloc(size);
  frame[0] = 0xff;
  frame[1] = 0xe0 | (version << 3) | (1 << 1) | 1; // layer III, no CRC
  frame[2] = (brIdx << 4) | (RATES[version].indexOf(rate) << 2); // no padding
  frame[3] = mono ? 0xc0 : 0x00;
  frame.write('Info', infoAt, 'latin1');
  frame.writeUInt32BE(0x0f, infoAt + 4); // frames, bytes, TOC, quality present
  frame.writeUInt32BE(frames, infoAt + 8);
  frame.writeUInt32BE(size + mp3.length, infoAt + 12);
  for (let i = 0; i < 100; i++) frame[infoAt + 16 + i] = Math.floor((i * 256) / 100);
  frame.writeUInt32BE(0, infoAt + 116); // quality
  frame.write('LAME3.100', lameAt, 'latin1');
  frame[lameAt + 9] = 0x01; // revision 0, CBR
  frame[lameAt + 20] = Math.min(255, first.bitrate); // ABR / specified bitrate
  const padding = frames * spf - delay - samples;
  if (padding < 0) throw new Error('source longer than the frames it was encoded in');
  const dp = (delay << 12) | padding;
  frame[lameAt + 21] = dp >> 16;
  frame[lameAt + 22] = (dp >> 8) & 255;
  frame[lameAt + 23] = dp & 255;
  frame.writeUInt32BE(mp3.length, lameAt + 28); // length of the music
  frame.writeUInt16BE(crc16(frame, lameAt + 34), lameAt + 34);
  return Buffer.concat([frame, mp3]);
}
