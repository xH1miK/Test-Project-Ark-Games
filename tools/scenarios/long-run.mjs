// Long run (M7): the core loop over most of the carpet, the way a player would play it. Rounds of
// "fill up near the next point of a tour round the carpet, then drive into the shredder's zone"
// (lib/sweep.mjs; tools/bench/long-run.mjs replays the same rounds in Node): tier 1 until 35% of the
// carpet is shredded, then tier 2 with loads of 60 until 70% (Tractor1's model with tier 2's stats and
// camera zoom; Tractor2 comes with the progression stage). Every round must fill the bucket and sell
// the whole load as the pivot enters the zone; the core loop's invariants hold on every frame and
// shredder step (lib/loop-probe.mjs). Measured per phase: FPS (2-second windows), the ball step (per
// step and per frame), draw calls, ball-buffer uploads per frame, balls simulated; the live JS heap
// after a full GC every 8 rounds (it must not grow). At the end: no uploads at rest, FPS with and
// without the balls, the whole carpet from above (same view as at the start).
//
//   node tools/check-html.mjs <html|url> --scenario long-run [--gpu]
//   ZM_LONG_SHARES=0.1,0.2 ... ends the phases at these shares of the carpet (a quick run)
//   ZM_HEAP_DIFF=1 ... also heap snapshots at the baseline and at the end: what the heap grew by, by kind

import { driveLegs, installAutopilot } from './lib/autopilot.mjs';
import { FPS } from './lib/camera.mjs';
import { checkLoopProbe, installLoopProbe, loopState, settleCoins } from './lib/loop-probe.mjs';
import { PHASES, pickFillTarget, roundLegs, sweepFrame } from './lib/sweep.mjs';

/** Desktop budget for one ball step (as the balls scenario): SwiftShader shares the CPU, hence the margin. */
const STEP_BUDGET_MS = 2.5;
/** The live heap may not grow by more than this from the warm-up checkpoint to the end, bytes. */
const HEAP_GROWTH_LIMIT = 1_000_000;
/** A heap checkpoint every this many rounds; the first one after that many is the baseline. */
const HEAP_EVERY = 8;

/**
 * Per phase, allocation-free: the ball step (histogram of 0.02 ms bins, per step and per frame), draw
 * calls (of the frame before: rendering follows EVENT_AFTER_UPDATE), uploads of the ball buffer per
 * frame, balls simulated, FPS per 2-second window. `__runMetrics.begin(name)` starts a phase.
 */
const METRICS = `(() => {
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

/**
 * While the game is paused: the camera straight above the carpet, the screen's long side along the
 * carpet's long side (world Z), the whole carpet in view.
 */
const OVERVIEW = `(() => {
  const node = cc.find('Main Camera'), cam = node.getComponent(cc.js.getClassByName('cc.Camera'));
  const c = __zm.config.balls.carpet, aspect = cc.game.canvas.width / cc.game.canvas.height, fov = 50;
  const tall = aspect < 1, spanUp = tall ? 2 * c.halfZ : 2 * c.halfX, spanAcross = tall ? 2 * c.halfX : 2 * c.halfZ;
  const tan = Math.tan(fov * Math.PI / 360), height = 1.08 * Math.max(spanUp / (2 * tan), spanAcross / (2 * tan * aspect));
  node.setPosition(c.centerX, height, c.centerZ);
  node.lookAt(new cc.Vec3(c.centerX, 0, c.centerZ), tall ? new cc.Vec3(0, 0, -1) : new cc.Vec3(-1, 0, 0));
  cam.fov = fov; // vertical (the camera's fovAxis)
})()`;

/** The page-side point source of the seek legs (lib/sweep.mjs), with the shredder where the scene has it. */
async function installSweep(t) {
  const shredder = await t.evaluate(`(() => { const s = cc.find('Level/Shredder').worldPosition; return { x: s.x, z: s.z, zoneHalf: __zm.config.shredder.zoneHalf }; })()`);
  const frame = sweepFrame(shredder, shredder.zoneHalf);
  await t.evaluate(`(() => {
    const pick = ${pickFillTarget}, frame = ${JSON.stringify(frame)}, tabu = window.__sweepTabu = [];
    __ap.targets.balls = (leg, stalled) => {
      if (stalled) tabu.push(stalled.cell);
      return pick(__zm.balls, __zm.tractor, Object.assign({}, frame, { toward: leg.toward, minMass: leg.minMass, clearance: leg.clearance, tabu, obstacles: __zm.obstacles }));
    };
  })()`);
  return shredder;
}

/** Pauses the game, shows the whole carpet from above, takes a shot, hands the camera back to the rig. */
async function overview(t, name) {
  await t.evaluate('cc.director.pause()');
  await t.evaluate(OVERVIEW);
  await t.frames(2);
  await t.shot(name);
  await t.evaluate(`(() => { cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = 45; cc.director.resume(); })()`);
  await t.frames(2);
}

export default async function longRun(t) {
  await t.waitFor('!!(window.__zm && window.__zm.shredder && window.__zm.coinHud && window.__zm.ballView)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(METRICS);
  const shredder = await installSweep(t);
  const shares = (process.env.ZM_LONG_SHARES || '').split(',').filter(Boolean).map(Number);
  const phases = PHASES.map((p, k) => ({ ...p, share: shares[k] ?? p.share }));
  const start = await loopState(t);
  const total = start.count;
  t.log(`carpet: ${total} balls; phases ${phases.map((p) => `${p.name} to ${Math.round(100 * p.share)}%`).join(', ')}`);

  // Heap checkpoints: live JS heap after a full GC; with ZM_HEAP_DIFF, snapshots at the baseline and the end.
  const heap = [];
  const snapshots = {};
  const checkpoint = async (label) => {
    const h = await t.heap();
    heap.push({ label, used: h.usedSize, clock: await t.evaluate('__ap.clock') });
    if (process.env.ZM_HEAP_DIFF === '1' && (label === `round ${HEAP_EVERY}` || label === 'end')) snapshots[label] = await t.heapSnapshot();
  };
  await overview(t, 'carpet-before');
  await checkpoint('start');

  let round = 0;
  const failed = [];
  const summaries = {};
  for (const phase of phases) {
    if (phase.tier > 0) {
      await t.evaluate(`(() => { __zm.tractor.setTier(__zm.config.tractor.tiers[${phase.tier}]); __zm.events.emit('tierChanged', { tier: ${phase.tier + 1} }); })()`);
    }
    await t.evaluate(`__runMetrics.begin('${phase.name}')`);
    // The bucket takes up the new tier's capacity on its next step: read it from the tier.
    const capacity = await t.evaluate(`__zm.config.tractor.tiers[${phase.tier}].bucketCapacity`);
    const sold = [];
    for (let k = 0; k < phase.maxRounds; k++, round++) {
      const s = await loopState(t);
      if (s.shredded + s.inFlight >= phase.share * total) break;
      const [fill, sell] = await driveLegs(t, roundLegs(round, phase.tier, shredder), 150000);
      const now = await loopState(t);
      sold.push(sell.sold);
      const ok = fill.ok && fill.reason === 'full' && fill.load === capacity && sell.ok && sell.reason === 'inZone' && sell.sold === capacity;
      if (!ok) failed.push(round);
      t.log(`${phase.name} round ${String(round).padStart(2)}: ${fill.name} -> ${fill.reason} in ${fill.t}s (${fill.picks} picks), ${fill.load} in the bucket; ` +
        `sold ${sell.sold} after ${sell.t}s at (${sell.x}, ${sell.z}); shredded ${now.shredded} (${Math.round((100 * now.shredded) / total)}%), purse ${now.purse}${ok ? '' : '  <-- not a full load sold whole'}`);
      if ((round + 1) % HEAP_EVERY === 0) await checkpoint(`round ${round + 1}`);
    }
    await t.evaluate('__runMetrics.end()');
    summaries[phase.name] = await t.evaluate(`__runMetrics.summary('${phase.name}')`);
    summaries[phase.name].rounds = sold.length;
    summaries[phase.name].sold = sold;
    await t.shot(`${phase.name.toLowerCase()}-done`);
  }

  // At rest: everything lands, every coin arrives, the carpet sleeps; then nothing is uploaded.
  const end = await settleCoins(t, 'end of the run');
  const asleep = await t.waitFor('__zm.balls.simulatedCount === 0 && __zm.tractor.speed === 0', 60000).catch(() => false);
  t.check(asleep, 'the carpet is asleep again after the run');
  const idle = await t.evaluate('__zm.ballView.uploadCount');
  await t.frames(30);
  const idleUploads = (await t.evaluate('__zm.ballView.uploadCount')) - idle;
  await checkpoint('end');
  const fpsOn = await t.evaluate(FPS(2000));
  await t.evaluate('__zm.ballView.enabled = false');
  await t.frames(2);
  const fpsOff = await t.evaluate(FPS(2000));
  await t.evaluate('__zm.ballView.enabled = true');
  await t.frames(2);
  const drawsAtRest = await t.evaluate('cc.director.root.device.numDrawCalls');
  await overview(t, 'carpet-after');

  // Verdict.
  for (const phase of phases) {
    const s = summaries[phase.name];
    t.log(`${phase.name}: ${s.rounds} rounds, loads sold ${s.sold.join(' ')}; ${s.frames} frames, fps ${s.fpsMean.toFixed(1)} mean / ${s.fpsMin.toFixed(1)} worst 2-s window; ` +
      `ball step ${s.stepMean.toFixed(3)} ms mean, ${s.stepP95.toFixed(2)} p95, ${s.stepMax.toFixed(2)} max over ${s.steps} steps (per frame ${s.frameMean.toFixed(3)} / ${s.frameP95.toFixed(2)} / ${s.frameMax.toFixed(2)}); ` +
      `simulated ${s.simMean.toFixed(0)} mean, ${s.simMax} max; draw calls ${s.drawMin}..${s.drawMax} (mostly ${s.drawMode}, mean ${s.drawMean.toFixed(1)}); ` +
      `ball buffer uploaded in ${s.uploads} of ${s.frames} frames (at most ${s.uploadMax} a frame)`);
    t.check(s.rounds >= 1, `${phase.name}: ran ${s.rounds} rounds`);
    t.check(s.stepP95 < STEP_BUDGET_MS, `${phase.name}: ball step p95 under ${STEP_BUDGET_MS} ms (${s.stepP95.toFixed(2)} ms)`);
    t.check(s.uploadMax <= 1, `${phase.name}: the ball buffer is uploaded at most once a frame`);
  }
  t.check(failed.length === 0, `every round filled the bucket and sold the whole load as it entered the zone${failed.length ? ` (not: rounds ${failed.join(', ')})` : ''}`);
  const last = phases[phases.length - 1];
  t.log(`end: shredded ${end.shredded} of ${total} (${Math.round((100 * end.shredded) / total)}%; handed in ${end.handed}, throat ${end.swallowed}), purse ${end.purse}; ` +
    `at rest: ${idleUploads} uploads in 30 frames, ${drawsAtRest} draw calls, fps ${fpsOn.toFixed(1)} with the balls / ${fpsOff.toFixed(1)} without`);
  t.check(end.shredded + end.inFlight >= last.share * total, `the carpet was swept down to ${Math.round(100 * last.share)}% (${end.shredded} of ${total})`);
  t.check(end.purse === 2 * end.shredded, `purse ${end.purse} = 2 x ${end.shredded} shredded`);
  t.check(idleUploads === 0, 'at rest the ball buffer is not uploaded (30 frames)');
  await checkLoopProbe(t, end, 60);

  const base = heap.find((h) => h.label === `round ${HEAP_EVERY}`) || heap[0];
  const final = heap[heap.length - 1];
  const minutes = Math.max(1e-6, (final.clock - base.clock) / 60);
  t.log(`live JS heap after GC, MB: ${heap.map((h) => `${h.label} ${(h.used / 1e6).toFixed(2)}`).join(', ')}; ` +
    `from ${base.label} to the end ${((final.used - base.used) / 1e3).toFixed(0)} KB over ${minutes.toFixed(1)} min of game time`);
  const from = snapshots[`round ${HEAP_EVERY}`], to = snapshots.end;
  if (from && to) {
    const grew = (kind) => ({ kind, size: (to[kind]?.size || 0) - (from[kind]?.size || 0), count: (to[kind]?.count || 0) - (from[kind]?.count || 0) });
    const rows = [...new Set([...Object.keys(from), ...Object.keys(to)])].map(grew);
    const byType = {};
    for (const r of rows) {
      const type = r.kind.split(' ')[0];
      byType[type] = (byType[type] || 0) + r.size;
    }
    const kb = (b) => `${b >= 0 ? '+' : ''}${(b / 1e3).toFixed(1)} KB`;
    t.log(`heap growth from round ${HEAP_EVERY} to the end by type: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${kb(v)}`).join(', ')}`);
    t.log(`largest growth by kind: ${rows.sort((a, b) => b.size - a.size).slice(0, 15).map((r) => `${r.kind.trim()} ${kb(r.size)} (${r.count >= 0 ? '+' : ''}${r.count})`).join('; ')}`);
  }
  t.check(final.used - base.used < HEAP_GROWTH_LIMIT, `the live JS heap did not grow (${((final.used - base.used) / 1e3).toFixed(0)} KB from ${base.label} to the end, limit ${HEAP_GROWTH_LIMIT / 1e3} KB)`);
}
