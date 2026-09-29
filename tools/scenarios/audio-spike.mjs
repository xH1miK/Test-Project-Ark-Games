// S0 spike: does sound really play from the packed file:// page? (throwaway, replaced by the real `audio`
// scenario in S1). Loads assets/resources/spike/beep.mp3 (0.5 s, 440 Hz) out of the embedded package, plays it
// through the engine's AudioSource, and measures the signal that reaches the AudioContext destination:
// initScript taps every node connected to `destination` with an AnalyserNode and keeps the peak seen.
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario audio-spike [--locked-audio]

export const initScript = `(() => {
  const audio = (window.__audio = { ctx: null, tap: null, connections: 0, starts: 0, maxPeak: 0, contexts: 0 });
  const NativeCtx = window.AudioContext || window.webkitAudioContext;
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
    audio.lastPeak = p;
  }, 20);
  window.__audioReset = () => { audio.maxPeak = 0; };
})();`;

export default async function (t) {
  const locked = t.lockedAudio;
  t.log(`mode: ${locked ? 'locked until a gesture' : 'autoplay allowed'}`);

  // 1. The clip is inside the package and loads through the engine's downloader.
  t.check(await t.evaluate(`window.__ZM_FILES__.some((e) => /resources\\/.*\\.mp3$/.test(e[0]))`), 'the mp3 is embedded in the package');
  await t.evaluate(`new Promise((ok) => {
    cc.resources.load('spike/beep', cc.AudioClip, (err, clip) => {
      window.__clip = clip; window.__loadErr = err ? String(err) : null; ok(true);
    });
  })`);
  t.check(await t.evaluate('!!window.__clip'), 'AudioClip loaded from the embedded bundle');
  t.log('load error: ' + (await t.evaluate('window.__loadErr')));
  const duration = await t.evaluate('window.__clip ? window.__clip.getDuration() : -1');
  t.check(Math.abs(duration - 0.5) < 0.1, `decoded duration ${duration.toFixed(3)} s (expected ~0.5)`);
  t.log('audio context after load: ' + (await t.evaluate('cc.sys.__audioSupport ? JSON.stringify(cc.sys.__audioSupport) : "n/a"')));

  // 2. A node with an AudioSource.
  await t.evaluate(`(() => {
    const AudioSource = cc.AudioSource || cc.js.getClassByName('cc.AudioSource');
    const n = new cc.Node('spike-audio');
    cc.director.getScene().addChild(n);
    const s = n.addComponent(AudioSource);
    s.clip = window.__clip; s.volume = 1; s.loop = false;
    window.__src = s;
    return true;
  })()`);
  await t.sleep(300); // the player is created asynchronously

  const peek = () => t.evaluate(`({ state: window.__audio.ctx && window.__audio.ctx.state, peak: window.__audio.maxPeak, starts: window.__audio.starts,
    connections: window.__audio.connections, time: window.__audio.ctx && window.__audio.ctx.currentTime })`);

  if (locked) {
    await t.evaluate('window.__audioReset(); window.__src.play(); true');
    await t.sleep(600);
    const before = await peek();
    t.log('before any gesture: ' + JSON.stringify(before));
    t.check(before.state !== 'running', `context locked before a gesture (state ${before.state})`);
    t.check(before.peak < 0.01, `silence before a gesture (peak ${before.peak.toFixed(4)})`);
    // A real touch on the canvas (the engine listens for touchend on it).
    const [w, h] = t.size.split('x').map(Number);
    await t.touch('touchStart', w / 2, h / 2);
    await t.sleep(80);
    await t.touch('touchEnd', w / 2, h / 2);
    await t.sleep(700);
    const after = await peek();
    t.log('after a real touch: ' + JSON.stringify(after));
    t.check(after.state === 'running', `context running after the touch (state ${after.state})`);
    t.check(after.peak > 0.05, `the queued sound plays once unlocked (peak ${after.peak.toFixed(3)})`);
  } else {
    await t.evaluate('window.__audioReset(); window.__src.play(); true');
    await t.sleep(250);
    const a = await peek();
    t.log('AudioSource.play: ' + JSON.stringify(a));
    t.check(a.state === 'running', `context running (state ${a.state})`);
    t.check(a.peak > 0.05, `AudioSource.play reaches the output (peak ${a.peak.toFixed(3)})`);
    await t.sleep(600);
    await t.evaluate('window.__audioReset(); true');
    await t.sleep(200);
    const quiet = await peek();
    t.check(quiet.peak < 0.01, `silent after the clip ended (peak ${quiet.peak.toFixed(4)})`);

    await t.evaluate('window.__audioReset(); window.__src.playOneShot(window.__clip, 1); true');
    await t.sleep(250);
    const o = await peek();
    t.check(o.peak > 0.05, `playOneShot reaches the output (peak ${o.peak.toFixed(3)}, starts ${o.starts})`);
    await t.sleep(600);

    // A loop keeps sounding past the clip's length; stop() silences it.
    await t.evaluate('window.__src.loop = true; window.__audioReset(); window.__src.play(); true');
    await t.sleep(1400);
    await t.evaluate('window.__audioReset(); true');
    await t.sleep(120);
    const looping = await peek();
    t.check(looping.peak > 0.05, `loop still sounds after 1.4 s (> the 0.5 s clip): peak ${looping.peak.toFixed(3)}`);
    // The page goes to the background (AppLovin / a tab switch): does the engine silence a playing loop by itself?
    const setHidden = (hidden) => t.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${hidden ? "'hidden'" : "'visible'"} });
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    })()`);
    await setHidden(true);
    await t.sleep(300);
    await t.evaluate('window.__audioReset(); true');
    await t.sleep(200);
    const hidden = await peek();
    t.log('hidden: ' + JSON.stringify(hidden) + ' game paused: ' + (await t.evaluate('cc.game.isPaused()')));
    t.check(hidden.peak < 0.01, `a playing loop falls silent while the page is hidden (peak ${hidden.peak.toFixed(4)})`);
    await setHidden(false);
    await t.sleep(300);
    await t.evaluate('window.__audioReset(); true');
    await t.sleep(200);
    const shown = await peek();
    t.log('shown again: ' + JSON.stringify(shown) + ' game paused: ' + (await t.evaluate('cc.game.isPaused()')));
    t.check(shown.peak > 0.05, `the loop comes back when the page is shown again (peak ${shown.peak.toFixed(3)})`);
    await t.evaluate('window.__src.stop(); true');
    await t.sleep(200);
    await t.evaluate('window.__audioReset(); true');
    await t.sleep(150);
    const stopped = await peek();
    t.check(stopped.peak < 0.01, `stop() silences the loop (peak ${stopped.peak.toFixed(4)})`);
  }
}
