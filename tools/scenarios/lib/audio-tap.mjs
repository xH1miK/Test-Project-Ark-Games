// Listening in on the page's audio without ears: a script for a scenario's `initScript` (run before anything else)
// that taps every node connected to an AudioContext's destination with an AnalyserNode and keeps the highest
// sample seen since the last reset, and counts the AudioBufferSourceNodes started. What reaches the output is then
// a number, not a promise that a play() call was made.
//   window.__audio.peek() -> { state, peak, starts, connections }     window.__audio.reset() zeroes the peak
// Proven on the packed file:// page in S0 (peak 0.475 for a 0.5 amplitude clip, 0.000 when silent).

export const TAP_SCRIPT = `(() => {
  const audio = (window.__audio = { ctx: null, tap: null, connections: 0, starts: 0, maxPeak: 0 });
  const taps = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    const r = connect.apply(this, arguments);
    if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      let tap = taps.get(ctx);
      if (!tap) {
        tap = ctx.createAnalyser();
        tap.fftSize = 2048;
        taps.set(ctx, tap);
        audio.ctx = ctx;
        audio.tap = tap;
      }
      connect.call(this, tap);
      audio.connections++;
    }
    return r;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { audio.starts++; return start.apply(this, arguments); };
  const buf = new Float32Array(2048);
  setInterval(() => {
    if (!audio.tap) return;
    audio.tap.getFloatTimeDomainData(buf);
    let p = 0;
    for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
    audio.maxPeak = Math.max(audio.maxPeak, p);
  }, 20);
  audio.reset = () => { audio.maxPeak = 0; };
  audio.peek = () => ({ state: audio.ctx ? audio.ctx.state : 'none', peak: audio.maxPeak, starts: audio.starts, connections: audio.connections });
})();`;

/** Page-side recorder: every call of the manager's play (accepted or dropped) with the game time and frame. */
export const RECORDER = `(() => {
  if (window.__soundRec) return 'already';
  const s = window.__zm.sound, rec = (window.__soundRec = { calls: [], maxVoices: 0, frames: 0 });
  const play = s.play.bind(s);
  s.play = (id, progress) => {
    const ok = play(id, progress);
    rec.calls.push({ id, ok, progress, now: s.now, frame: s.frame });
    return ok;
  };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    rec.frames++;
    rec.maxVoices = Math.max(rec.maxVoices, s.voiceCount);
  });
  return 'installed';
})()`;

/** What the rules say about a recorded list of calls (used by the `audio` and `full-run` scenarios). */
export function judgeCalls(calls, shots, maxPerFrame) {
  const problems = [];
  const accepted = calls.filter((c) => c.ok);
  const byId = {};
  for (const c of accepted) (byId[c.id] ||= []).push(c);
  for (const [id, list] of Object.entries(byId)) {
    const min = shots[id].minInterval;
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].now - list[i - 1].now;
      if (gap < min - 1e-6) problems.push(`${id}: two plays ${gap.toFixed(3)} s apart (min ${min})`);
    }
  }
  const perFrame = {};
  for (const c of accepted) perFrame[c.frame] = (perFrame[c.frame] || 0) + 1;
  const worst = Math.max(0, ...Object.values(perFrame));
  if (worst > maxPerFrame) problems.push(`${worst} one-shots started in one frame (max ${maxPerFrame})`);
  return { problems, worst, counts: Object.fromEntries(Object.entries(byId).map(([id, l]) => [id, l.length])) };
}
