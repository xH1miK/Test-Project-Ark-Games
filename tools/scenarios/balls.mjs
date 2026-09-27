// M3 ball check: the carpet is laid and sleeps untouched; the tractor ploughs through it by autopilot
// (tier 1, then the tier 2 boxes and speed); no ball ever ends a frame inside a rock or outside the
// field; the carpet falls asleep again once the tractor stops; the time of the ball step is measured
// per frame in the browser. Balls are painted by a debug overlay (a 2D canvas over the game, projected
// through the game camera; orange = simulated this step) for the screenshots only; the real renderer
// comes with M4.
//
//   node tools/check-html.mjs <html|url> --scenario balls [--gpu]

import { installAutopilot, runLegs } from './lib/autopilot.mjs';

/** Worst state over the run, sampled every few frames, plus the ball step's time per frame. */
const PROBES = `(() => {
  if (window.__ballProbe) return 'already';
  const zm = window.__zm, balls = zm.balls, ap = window.__ap;
  const probe = window.__ballProbe = { ms: [], simulated: [], pending: 0, frame: 0, worst: null };
  const step = balls.step.bind(balls);
  balls.step = (dt, pusher) => { const t0 = performance.now(); step(dt, pusher); probe.pending += performance.now() - t0; };
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

/** Where every ball is: inside a rock, outside the field, NaN; the highest one; how many were simulated. */
const AUDIT = `window.__ballAudit = () => {
  const b = __zm.balls, g = __zm.obstacles, cfg = __zm.config.balls, r = cfg.radius, e = cfg.bounds, tmp = { x: 0, z: 0 };
  let inRock = 0, deepest = 0, outside = 0, nan = 0, highest = 0;
  for (let i = 0; i < b.count; i++) {
    const x = b.x[i], y = b.y[i], z = b.z[i];
    if (!Number.isFinite(x + y + z)) { nan++; continue; }
    const d = g.resolveCircle(x, z, r, 2, tmp); // 2 = Blocks.Balls
    if (d > 1e-6) inRock++;
    if (d > deepest) deepest = d;
    if (x < e.minX + r - 1e-6 || x > e.maxX - r + 1e-6 || z < e.minZ + r - 1e-6 || z > e.maxZ - r + 1e-6 || y < r - 1e-6) outside++;
    if (y > highest) highest = y;
  }
  return { count: b.count, inRock, deepest, outside, nan, highest, simulated: b.simulatedCount, hotCells: b.hotCellCount };
}`;

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

  // 2. Tier 1 ploughs through the carpet, then stops.
  const msBefore = (await t.evaluate('__ballProbe.ms.length'));
  await runLegs(t, 'T1', ROUTE_T1.slice(0, 3));
  await shot('t1-plough');
  await runLegs(t, 'T1', ROUTE_T1.slice(3));
  await settle('T1');
  await shot('t1-rest');
  const t1 = await t.evaluate(`({ ms: __ballProbe.ms.slice(${msBefore}), sim: __ballProbe.simulated.slice(${msBefore}) })`);

  // 3. Tier 2: bigger boxes, 8.4 u/s (the Tractor2 model itself comes with the progression stage).
  await t.evaluate('__zm.tractor.setTier(__zm.config.tractor.tiers[1])');
  const msT2 = (await t.evaluate('__ballProbe.ms.length'));
  await runLegs(t, 'T2', ROUTE_T2.slice(0, 2));
  await shot('t2-plough');
  await runLegs(t, 'T2', ROUTE_T2.slice(2));
  await settle('T2');
  const t2 = await t.evaluate(`({ ms: __ballProbe.ms.slice(${msT2}), sim: __ballProbe.simulated.slice(${msT2}) })`);
  await shot('t2-rest');

  // 4. Verdict.
  const end = await audit();
  const worst = await t.evaluate('__ballProbe.worst');
  for (const [label, run] of [['T1', t1], ['T2', t2]]) {
    const ms = stats(run.ms);
    const sim = stats(run.sim);
    t.log(`${label}: ball step per frame ${ms.mean.toFixed(3)} ms mean, ${ms.p95.toFixed(3)} p95, ${ms.max.toFixed(3)} max over ${run.ms.length} frames; ` +
      `simulated ${sim.mean.toFixed(0)} mean, ${sim.max} max of ${end.count}`);
    t.check(ms.p95 < 4, `${label}: ball step p95 under 4 ms per frame (${ms.p95.toFixed(3)} ms)`);
  }
  t.log(`worst over the run (every 4th frame): ${worst.inRock} in rocks (deepest ${worst.deepest.toFixed(4)}), ${worst.outside} outside, ${worst.nan} NaN, highest ball y ${worst.highest.toFixed(2)}`);
  t.check(worst.inRock === 0 && worst.outside === 0 && worst.nan === 0, 'no ball ever ended a frame in a rock, outside the field or NaN');
  t.check(end.count === laid.count && end.inRock === 0 && end.outside === 0, `all ${end.count} balls still in the arena at the end`);
}
