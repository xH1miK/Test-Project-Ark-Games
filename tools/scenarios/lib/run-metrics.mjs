// Page-side helpers shared by the long scenarios (long-run, full-run): per-phase run metrics (ball
// step, draw calls, uploads, FPS windows) and the source of the seek legs' points (lib/sweep.mjs).
// Need the ?qa hooks (window.__zm) and the autopilot (lib/autopilot.mjs).

import { pickFillTarget, sweepFrame } from './sweep.mjs';

/**
 * Per phase, allocation-free: the ball step (histogram of 0.02 ms bins, per step and per frame), draw
 * calls (of the frame before: rendering follows EVENT_AFTER_UPDATE), uploads of the ball buffer per
 * frame, balls simulated, FPS per 2-second window. `__runMetrics.begin(name)` starts a phase.
 */
export const METRICS = `(() => {
  if (window.__runMetrics) return 'already';
  const zm = window.__zm, balls = zm.balls, view = zm.ballView, device = cc.director.root.device;
  const BIN = 0.02, BINS = 1000, WINDOWS = 1024, WINDOW_MS = 2000;
  const make = () => ({ frames: 0, steps: 0, stepSum: 0, stepMax: 0, stepHist: new Uint32Array(BINS + 1), frameSum: 0, frameMax: 0,
    frameHist: new Uint32Array(BINS + 1), draws: new Uint32Array(256), drawSum: 0, drawMin: 1e9, drawMax: 0, uploads: 0, uploadMax: 0,
    simSum: 0, simMax: 0, fps: new Float32Array(WINDOWS), windows: 0 });
  const m = window.__runMetrics = { phases: {}, current: null, pending: 0, uploads: view.uploadCount, frames: 0, windowT0: 0, windowF0: 0 };
  m.begin = (name) => { m.current = m.phases[name] = make(); m.windowT0 = performance.now(); m.windowF0 = m.frames; };
  m.end = () => { m.current = null; };
  const bin = (ms) => Math.min(BINS, Math.floor(ms / BIN));
  const step = balls.step.bind(balls);
  balls.step = (dt, pusher) => {
    const t0 = performance.now();
    step(dt, pusher);
    const ms = performance.now() - t0, p = m.current;
    m.pending += ms;
    if (!p) return;
    p.steps++; p.stepSum += ms; if (ms > p.stepMax) p.stepMax = ms; p.stepHist[bin(ms)]++;
  };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    m.frames++;
    const p = m.current, ms = m.pending, up = view.uploadCount - m.uploads;
    m.pending = 0; m.uploads = view.uploadCount;
    if (!p) return;
    p.frames++; p.frameSum += ms; if (ms > p.frameMax) p.frameMax = ms; p.frameHist[bin(ms)]++;
    const d = device.numDrawCalls;
    p.draws[Math.min(255, d)]++; p.drawSum += d; if (d < p.drawMin) p.drawMin = d; if (d > p.drawMax) p.drawMax = d;
    p.uploads += up; if (up > p.uploadMax) p.uploadMax = up;
    const sim = balls.simulatedCount; p.simSum += sim; if (sim > p.simMax) p.simMax = sim;
    const now = performance.now();
    if (now - m.windowT0 >= WINDOW_MS) {
      if (p.windows < WINDOWS) p.fps[p.windows++] = (m.frames - m.windowF0) * 1000 / (now - m.windowT0);
      m.windowT0 = now; m.windowF0 = m.frames;
    }
  });
  const at = (hist, n, q) => { let seen = 0; for (let i = 0; i <= BINS; i++) { seen += hist[i]; if (seen >= q * n) return i * BIN; } return BINS * BIN; };
  m.summary = (name) => {
    const p = m.phases[name], fps = Array.from(p.fps.subarray(0, p.windows));
    let mode = 0;
    for (let d = 0; d < 256; d++) if (p.draws[d] > p.draws[mode]) mode = d;
    return { frames: p.frames, steps: p.steps, stepMean: p.stepSum / Math.max(1, p.steps), stepP95: at(p.stepHist, p.steps, 0.95), stepMax: p.stepMax,
      frameMean: p.frameSum / Math.max(1, p.frames), frameP95: at(p.frameHist, p.frames, 0.95), frameMax: p.frameMax,
      drawMin: p.drawMin, drawMax: p.drawMax, drawMean: p.drawSum / Math.max(1, p.frames), drawMode: mode,
      uploads: p.uploads, uploadMax: p.uploadMax, simMean: p.simSum / Math.max(1, p.frames), simMax: p.simMax,
      fpsMean: fps.reduce((s, v) => s + v, 0) / Math.max(1, fps.length), fpsMin: fps.length ? Math.min(...fps) : 0, windows: fps.length };
  };
  return 'installed';
})()`;

/** The page-side point source of the seek legs (lib/sweep.mjs), with the shredder where the scene has it. */
export async function installSweep(t) {
  const shredder = await t.evaluate(`(() => { const s = cc.find('Level/Shredder').worldPosition, g = __zm.pads.gate;
    return { x: s.x, z: s.z, zoneHalf: __zm.config.shredder.zoneHalf, gate: { x: g.x, z: g.z }, padZoneHalf: __zm.config.pads.zoneHalf }; })()`);
  // The gate pad's zone is off limits: paying the gate ends the run (M10).
  const frame = sweepFrame(shredder, shredder.zoneHalf, shredder.gate, shredder.padZoneHalf);
  await t.evaluate(`(() => {
    const pick = ${pickFillTarget}, frame = ${JSON.stringify(frame)}, tabu = window.__sweepTabu = [];
    __ap.targets.balls = (leg, stalled) => {
      if (stalled) tabu.push(stalled.cell);
      return pick(__zm.balls, __zm.tractor, Object.assign({}, frame, { toward: leg.toward, minMass: leg.minMass, clearance: leg.clearance, tabu, obstacles: __zm.obstacles }));
    };
  })()`);
  return shredder;
}
