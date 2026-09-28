// M3 ball check: the carpet is laid and sleeps untouched; the tractor ploughs through it by autopilot
// (tier 1, then the tier 2 boxes and speed); no ball ever ends a frame inside a rock or outside the
// field; the carpet falls asleep again once the tractor stops; the time of the ball step is measured
// per frame in the browser. Balls are painted by a debug overlay (a 2D canvas over the game, projected
// through the game camera; orange = simulated this step) for the screenshots only; the UI sprites are
// cut out of it, so the joystick stays on top as in the game. The real renderer comes with M4.
//
//   node tools/check-html.mjs <html|url> --scenario balls [--gpu]

import { installAutopilot, runLegs } from './lib/autopilot.mjs';

/** Desktop budget for one ball step (the benchmark: T2 p95 ~1.1 ms); SwiftShader shares the CPU, hence the margin. */
const STEP_BUDGET_MS = 2.5;

/**
 * Worst state over the run, sampled every few frames; the ball step's time per step (a slow frame
 * runs several steps) and per frame.
 */
const PROBES = `(() => {
  if (window.__ballProbe) return 'already';
  const zm = window.__zm, balls = zm.balls, ap = window.__ap;
  const probe = window.__ballProbe = { stepMs: [], ms: [], simulated: [], pending: 0, frame: 0, worst: null };
  const step = balls.step.bind(balls);
  balls.step = (dt, pusher) => {
    const t0 = performance.now();
    step(dt, pusher);
    const ms = performance.now() - t0;
    probe.stepMs.push(ms);
    probe.pending += ms;
  };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    probe.ms.push(probe.pending);
    probe.simulated.push(balls.simulatedCount);
    if (probe.pending > ap.legWorst) ap.legWorst = probe.pending;
    probe.pending = 0;
    if (probe.frame++ % 4 === 0) {
      const a = window.__ballAudit();
      if (!probe.worst) probe.worst = a;
      else for (const k of ['inRock', 'deepest', 'outside', 'nan', 'highest']) probe.worst[k] = Math.max(probe.worst[k], a[k]);
    }
  });
  return 'installed';
})()`;

/**
 * Where every ball is: inside a rock, outside the arena, NaN; the highest one; how many were simulated.
 * The arena is a flood fill (0.1 steps) of where a ball touches no rock, from the tractor start: the
 * rocks close it; the field edges in Config are only a safety net behind them.
 */
const AUDIT = `(() => {
  const g = __zm.obstacles, r = __zm.config.balls.radius, s = cc.find('Level/Spots/TractorStart').worldPosition;
  const { minX, maxX, minZ, maxZ } = g.bounds, step = 0.1;
  const cols = Math.round((maxX - minX) / step), rows = Math.round((maxZ - minZ) / step), seen = new Uint8Array(cols * rows);
  const queue = [Math.floor((s.x - minX) / step) + Math.floor((s.z - minZ) / step) * cols];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop(), c = i % cols, k = (i - c) / cols;
    for (const [dc, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nk = k + dk, j = nc + nk * cols;
      if (nc < 0 || nk < 0 || nc >= cols || nk >= rows || seen[j]) continue;
      if (g.overlapsCircle(minX + nc * step, minZ + nk * step, r, 2)) continue; // 2 = Blocks.Balls
      seen[j] = 1; queue.push(j);
    }
  }
  const inArena = (x, z) => {
    const c = Math.floor((x - minX) / step), k = Math.floor((z - minZ) / step);
    if (c < 0 || k < 0 || c >= cols - 1 || k >= rows - 1) return false;
    return !!(seen[c + k * cols] | seen[c + 1 + k * cols] | seen[c + (k + 1) * cols] | seen[c + 1 + (k + 1) * cols]);
  };
  window.__ballAudit = () => {
    const b = __zm.balls, tmp = { x: 0, z: 0 };
    let inRock = 0, deepest = 0, outside = 0, nan = 0, highest = 0;
    for (let i = 0; i < b.count; i++) {
      const x = b.x[i], y = b.y[i], z = b.z[i];
      if (!Number.isFinite(x + y + z)) { nan++; continue; }
      const d = g.resolveCircle(x, z, r, 2, tmp);
      if (d > 1e-6) inRock++;
      if (d > deepest) deepest = d;
      if (!inArena(x, z) || y < r - 1e-6) outside++;
      if (y > highest) highest = y;
    }
    return { count: b.count, inRock, deepest, outside, nan, highest, simulated: b.simulatedCount, hotCells: b.hotCellCount };
  };
  return 'installed';
})()`;

/** Paints every ball over the game (far ones first); orange = simulated in the last step, lighter = higher up. */
const OVERLAY = `(() => {
  const b = __zm.balls, r = __zm.config.balls.radius, camNode = cc.find('Main Camera'), cam = camNode.getComponent(cc.Camera);
  const game = cc.game.canvas, rect = game.getBoundingClientRect();
  let cv = document.getElementById('ball-overlay');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'ball-overlay'; cv.style.cssText = 'position:fixed;pointer-events:none;z-index:9999'; document.body.appendChild(cv); }
  Object.assign(cv.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block' });
  cv.width = game.width; cv.height = game.height;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const right = camNode.right, fwd = camNode.forward, p = new cc.Vec3(), s = new cc.Vec3(), q = new cc.Vec3(), e = new cc.Vec3();
  const depth = (i) => b.x[i] * fwd.x + b.y[i] * fwd.y + b.z[i] * fwd.z;
  const order = Array.from({ length: b.count }, (_, i) => i).sort((i, j) => depth(j) - depth(i));
  for (const i of order) {
    p.set(b.x[i], b.y[i], b.z[i]); cam.worldToScreen(p, s);
    q.set(b.x[i] + right.x * r, b.y[i] + right.y * r, b.z[i] + right.z * r); cam.worldToScreen(q, e);
    const radius = Math.hypot(e.x - s.x, e.y - s.y);
    const lift = Math.min(1, (b.y[i] - r) / (4 * r));
    ctx.beginPath();
    ctx.arc(s.x, cv.height - s.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = b.isAwake(i) ? 'rgb(240,120,60)' : 'rgb(' + [32 + 120 * lift, 127 + 90 * lift, 151 + 80 * lift].map(Math.round).join(',') + ')';
    ctx.fill();
    ctx.lineWidth = Math.max(1, radius * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }
  // The game draws its screen UI after the world (UI camera): cut every UI sprite out of this
  // overlay by its own alpha, so the joystick shows on top of the balls as it will over the real renderer.
  const uiCam = cc.find('Canvas/Camera').getComponent(cc.Camera);
  const Sprite = cc.js.getClassByName('cc.Sprite'), UITransform = cc.js.getClassByName('cc.UITransform'), UIOpacity = cc.js.getClassByName('cc.UIOpacity');
  const lo = new cc.Vec3(), hi = new cc.Vec3();
  ctx.globalCompositeOperation = 'destination-out';
  for (const sp of cc.find('Canvas').getComponentsInChildren(Sprite)) {
    const f = sp.spriteFrame;
    if (!sp.enabledInHierarchy || !f) continue;
    // Packed into the dynamic atlas: the original texture still has its image and the frame's place in it.
    const src = f.original ? f.original._texture : f.texture, img = src && src.image && src.image.data;
    if (!img) continue;
    const box = sp.node.getComponent(UITransform).getBoundingBoxToWorld();
    uiCam.worldToScreen(lo.set(box.x, box.y, 0), lo);
    uiCam.worldToScreen(hi.set(box.x + box.width, box.y + box.height, 0), hi);
    let alpha = sp.color.a / 255;
    for (let n = sp.node; n; n = n.parent) { const o = n.getComponent(UIOpacity); if (o) alpha *= o.opacity / 255; }
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, f.original ? f.original._x : f.rect.x, f.original ? f.original._y : f.rect.y, f.rect.width, f.rect.height,
      lo.x, cv.height - hi.y, hi.x - lo.x, hi.y - lo.y);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  return order.length;
})()`;
const HIDE_OVERLAY = `(() => { const cv = document.getElementById('ball-overlay'); if (cv) cv.style.display = 'none'; })()`;

// Through the thick of the carpet from TractorStart (9, -11); the start hole has no balls.
const ROUTE_T1 = [
  { name: 'into the carpet', kind: 'goto', x: 12, z: -5 },
  { name: 'east side', kind: 'goto', x: 11, z: 5 },
  { name: 'across', kind: 'goto', x: 1, z: 8 },
  { name: 'west side', kind: 'goto', x: -2, z: 0 },
  { name: 'back through the middle', kind: 'goto', x: 5, z: 3.5 },
  { name: 'stop', kind: 'stop', time: 0.5 },
];
const ROUTE_T2 = [
  { name: 'T2 south', kind: 'goto', x: 10, z: 12 },
  { name: 'T2 west', kind: 'goto', x: -1, z: 13 },
  { name: 'T2 north', kind: 'goto', x: -2, z: -6 },
  { name: 'T2 east', kind: 'goto', x: 10, z: -5 },
  { name: 'T2 stop', kind: 'stop', time: 0.5 },
];

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { mean: values.reduce((s, v) => s + v, 0) / Math.max(1, values.length), p95: at(0.95), max: at(1) };
};

export default async function balls(t) {
  await t.waitFor('window.__zm && window.__zm.balls');
  await t.evaluate(AUDIT);
  await installAutopilot(t);
  await t.evaluate(PROBES);
  const shot = async (name) => {
    await t.evaluate(OVERLAY);
    await t.shot(name);
    await t.evaluate(HIDE_OVERLAY);
  };
  const audit = () => t.evaluate('__ballAudit()');
  const settle = async (label) => {
    const asleep = await t.waitFor('__zm.balls.simulatedCount === 0', 60000).catch(() => false);
    t.check(asleep, `${label}: the carpet is asleep again after the tractor stops`);
  };

  // 1. The carpet as laid.
  const laid = await audit();
  t.log(`carpet: ${laid.count} balls, ${laid.simulated} simulated, highest y ${laid.highest.toFixed(3)}`);
  t.check(laid.count > 1400 && laid.count <= 1600, `carpet laid (${laid.count} balls)`);
  t.check(laid.inRock === 0 && laid.outside === 0 && laid.nan === 0, 'no ball in a rock or outside the field at start');
  t.check(laid.simulated === 0, 'the untouched carpet sleeps (no ball simulated)');
  await shot('carpet');

  // Timing samples of a stretch of the run: per step and per frame (at low FPS a frame runs several steps).
  const mark = () => t.evaluate('({ s: __ballProbe.stepMs.length, f: __ballProbe.ms.length })');
  const since = (m) => t.evaluate(`({ step: __ballProbe.stepMs.slice(${m.s}), frame: __ballProbe.ms.slice(${m.f}), sim: __ballProbe.simulated.slice(${m.f}) })`);

  // 2. Tier 1 ploughs through the carpet, then stops.
  const m1 = await mark();
  await runLegs(t, 'T1', ROUTE_T1.slice(0, 3));
  await shot('t1-plough');
  await runLegs(t, 'T1', ROUTE_T1.slice(3));
  await settle('T1');
  await shot('t1-rest');
  const t1 = await since(m1);

  // 3. Tier 2: bigger boxes, 8.4 u/s (the Tractor2 model itself comes with the progression stage).
  await t.evaluate('__zm.tractor.setTier(__zm.config.tractor.tiers[1])');
  const m2 = await mark();
  await runLegs(t, 'T2', ROUTE_T2.slice(0, 2));
  await shot('t2-plough');
  await runLegs(t, 'T2', ROUTE_T2.slice(2));
  await settle('T2');
  const t2 = await since(m2);
  await shot('t2-rest');

  // 4. Verdict.
  const end = await audit();
  const worst = await t.evaluate('__ballProbe.worst');
  for (const [label, run] of [['T1', t1], ['T2', t2]]) {
    const step = stats(run.step);
    const perFrame = stats(run.frame);
    const sim = stats(run.sim);
    t.log(`${label}: ball step ${step.mean.toFixed(3)} ms mean, ${step.p95.toFixed(3)} p95, ${step.max.toFixed(3)} max over ${run.step.length} steps; ` +
      `per frame ${perFrame.mean.toFixed(3)} mean, ${perFrame.p95.toFixed(3)} p95 over ${run.frame.length} frames; simulated ${sim.mean.toFixed(0)} mean, ${sim.max} max of ${end.count}`);
    t.check(step.p95 < STEP_BUDGET_MS, `${label}: ball step p95 under ${STEP_BUDGET_MS} ms (${step.p95.toFixed(3)} ms)`);
  }
  t.log(`worst over the run (every 4th frame): ${worst.inRock} in rocks (deepest ${worst.deepest.toFixed(4)}), ${worst.outside} outside the arena, ${worst.nan} NaN, highest ball y ${worst.highest.toFixed(2)}`);
  t.check(worst.inRock === 0 && worst.outside === 0 && worst.nan === 0, 'no ball ever ended a frame in a rock, outside the arena or NaN');
  t.check(end.count === laid.count && end.inRock === 0 && end.outside === 0, `all ${end.count} balls still in the arena at the end`);
}
