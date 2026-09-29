// Spectral balance of a PCM clip in Node: the same figures analyze.mjs gets from the browser's decoder (Hann windows
// of 2048, energy-weighted; bands < 150 / < 600 / < 2.5k / < 8k / above), so a sound can be tuned without a browser.
const N = 2048;
export const BAND_EDGES = [150, 600, 2500, 8000];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
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
}

/** { centroid (Hz), bands: 5 shares summing to 1 }. */
export function spectrum(x, rate) {
  const bands = [0, 0, 0, 0, 0], re = new Float64Array(N), im = new Float64Array(N);
  let cNum = 0, cDen = 0;
  for (let s = 0; s + N <= x.length; s += N) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const e = re[k] * re[k] + im[k] * im[k], f = (k * rate) / N;
      cNum += f * e; cDen += e;
      let b = 0;
      while (b < BAND_EDGES.length && f >= BAND_EDGES[b]) b++;
      bands[b] += e;
    }
  }
  const sum = bands.reduce((a, v) => a + v, 0) || 1;
  return { centroid: cDen ? cNum / cDen : 0, bands: bands.map((v) => v / sum) };
}
