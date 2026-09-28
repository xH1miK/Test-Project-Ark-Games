// Ball check (M3 simulation + M4 rendering). The carpet is laid and sleeps untouched; the tractor
// ploughs through it by autopilot (tier 1, then the tier 2 boxes and speed); no ball ever ends a frame
// inside a rock or outside the field; the carpet falls asleep again once the tractor stops; the time
// of the ball step is measured per frame in the browser.
// Rendering: the balls are one render model with one pass (exactly +1 draw call); after every frame
// the vertex data shows every ball where the field has it (only moved balls are rewritten, so a missed
// one would show); an asleep carpet uploads nothing; balls that rolled turned and the others did not;
// the joystick is drawn over the balls (pixels of screenshots with and without balls/joystick); FPS
// with and without the balls; close-ups of rolling and of balls against the tractor and the rocks.
//
//   node tools/check-html.mjs <html|url> --scenario balls [--gpu]
//   ZM_BALL_OVERLAY=1 ... paints the balls over the game as circles, orange = simulated (debug)

import { installAutopilot, runLegs } from './lib/autopilot.mjs';
import { pixelDiff, readPng } from './lib/png.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

/** Desktop budget for one ball step (the benchmark: T2 p95 ~1.1 ms); SwiftShader shares the CPU, hence the margin. */
const STEP_BUDGET_MS = 2.5;
/** Drawn centres are float32 copies of the field's doubles. */
const SYNC_TOLERANCE = 1e-5;

/**
 * Worst state over the run, sampled every few frames; the ball step's time per step (a slow frame
 * runs several steps) and per frame; whether the drawn balls match the field (after lateUpdate).
 */
const PROBES = `(() => {
  if (window.__ballProbe) return 'already';
  const zm = window.__zm, balls = zm.balls, ap = window.__ap;
  const probe = window.__ballProbe = { stepMs: [], ms: [], simulated: [], pending: 0, frame: 0, worst: null, syncWorst: 0, syncChecks: 0, hidden: 0 };
  const step = balls.step.bind(balls);
  balls.step = (dt, pusher) => {
    const t0 = performance.now();
    step(dt, pusher);
    const ms = performance.now() - t0;
    probe.stepMs.push(ms);
    probe.pending += ms;
  };
  const drawn = { x: 0, y: 0, z: 0, radius: 0 };
  window.__ballSync = () => {
    const data = zm.ballView.data;
    let worst = 0, hidden = 0;
    for (let i = 0; i < balls.count; i++) {
      data.readBall(i, drawn);
      worst = Math.max(worst, Math.abs(drawn.x - balls.x[i]), Math.abs(drawn.y - balls.y[i]), Math.abs(drawn.z - balls.z[i]));
      if (!(drawn.radius > 0)) hidden++;
    }
    return { worst, hidden };
  };
  // EVENT_AFTER_UPDATE comes after lateUpdate: the ball view has drawn this frame by then.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    probe.ms.push(probe.pending);
    probe.simulated.push(balls.simulatedCount);
    if (probe.pending > ap.legWorst) ap.legWorst = probe.pending;
    probe.pending = 0;
    if (probe.frame++ % 4 === 0) {
      const a = window.__ballAudit();
      if (!probe.worst) probe.worst = a;
      else for (const k of ['inRock', 'deepest', 'outside', 'nan', 'highest']) probe.worst[k] = Math.max(probe.worst[k], a[k]);
      const s = window.__ballSync();
      probe.syncWorst = Math.max(probe.syncWorst, s.worst);
      probe.hidden = Math.max(probe.hidden, s.hidden);
      probe.syncChecks++;
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

/** Debug only (ZM_BALL_OVERLAY=1): paints every ball over the game; orange = simulated in the last step. */
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
    ctx.beginPath();
    ctx.arc(s.x, cv.height - s.y, Math.hypot(e.x - s.x, e.y - s.y), 0, Math.PI * 2);
    ctx.fillStyle = b.isAwake(i) ? 'rgb(240,120,60)' : 'rgb(32,127,151)';
    ctx.fill();
  }
  return order.length;
})()`;
const HIDE_OVERLAY = `(() => { const cv = document.getElementById('ball-overlay'); if (cv) cv.style.display = 'none'; })()`;

/** Freezes the camera rig on a ground point (the rig stops following the tractor); fov optional. */
const freezeCamera = (x, z, fov = 45) => `(() => { const c = __zm.camera; c.update = () => {}; c.snap(${x}, 0, ${z});
  cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = ${fov}; })()`;
const RELEASE_CAMERA = `(() => { const c = __zm.camera, tr = __zm.tractor; delete c.update; c.snap(tr.x, 0, tr.z);
  cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = 45; })()`;

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
// A short push into untouched carpet for the rolling close-up: from the start spot turn to -X short of
// the carpet (the start hole ends at x ~6.1 and the bucket reaches 1.9 ahead of the pivot), then push.
const ROLL_PUSH = [
  { name: 'roll: turn to the carpet', kind: 'goto', x: 8.3, z: -11, radius: 0.3 },
  { name: 'roll: push', kind: 'push', dx: -1, dz: 0, time: 0.9 },
  { name: 'roll: stop', kind: 'stop', time: 0.3 },
];

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { mean: values.reduce((s, v) => s + v, 0) / Math.max(1, values.length), p95: at(0.95), max: at(1) };
};

const FPS = (ms) => `new Promise((ok) => { const d = cc.director, f0 = d.getTotalFrames(), t0 = performance.now();
  setTimeout(() => ok((d.getTotalFrames() - f0) * 1000 / (performance.now() - t0)), ${ms}); })`;

/** Draw calls of the last frame with the ball renderer on and off; the render model's shape. */
async function checkDrawCalls(t) {
  const model = await t.evaluate(`(() => { const v = __zm.ballView, m = v.enabled ? v.model : null;
    return m ? { subModels: m.subModels.length, passes: m.subModels[0].passes.length, inScene: !!m.scene, layer: v.node.layer } : null; })()`);
  t.check(model && model.subModels === 1 && model.passes === 1 && model.inScene, `balls are one render model with one pass (${JSON.stringify(model)})`);
  t.check(model && model.layer === 1 << 30, 'the ball node is on the Default layer (drawn by the main camera, not the UI camera)');
  const draws = () => t.evaluate('cc.director.root.device.numDrawCalls');
  await t.frames(3);
  const on = await draws();
  await t.evaluate('__zm.ballView.enabled = false');
  await t.frames(3);
  const off = await draws();
  await t.evaluate('__zm.ballView.enabled = true');
  await t.frames(3);
  const back = await draws();
  t.log(`draw calls: ${on} with the balls, ${off} without, ${back} with again`);
  t.check(on - off === 1 && back === on, `all ${await t.evaluate('__zm.balls.count')} balls cost exactly one draw call (${on} - ${off})`);
}

/** FPS over `ms` with the balls drawn and hidden (same camera, carpet asleep). */
async function measureFps(t, label, ms = 2000) {
  const on = await t.evaluate(FPS(ms));
  await t.evaluate('__zm.ballView.enabled = false');
  await t.frames(2);
  const off = await t.evaluate(FPS(ms));
  await t.evaluate('__zm.ballView.enabled = true');
  await t.frames(2);
  t.log(`fps (${label}): ${on.toFixed(1)} with the balls, ${off.toFixed(1)} without`);
  return { on, off };
}

/**
 * The joystick is drawn over the real balls. The camera is parked so that the carpet lies under the
 * resting joystick; three shots: A balls + joystick, B balls only, D neither. Inside the knob, B differs
 * from D (balls are behind it) and A differs from B nearly everywhere (the knob covers the balls; were
 * the balls drawn over it, A and B would agree wherever a ball is); along the ring, A differs from B.
 */
async function checkJoystickOverBalls(t) {
  // Park the camera so that the ground point under the joystick's rest position is inside the carpet.
  const target = { x: 5, z: 9 };
  const place = await t.evaluate(`(() => {
    const cam = cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')), ui = cc.find('Canvas/Camera').getComponent(cc.js.getClassByName('cc.Camera'));
    const base = cc.find('Canvas/Joystick/Base'), s = new cc.Vec3();
    ui.worldToScreen(base.worldPosition, s);
    const ray = cam.screenPointToRay(s.x, s.y), o = ray.o, d = ray.d, k = -o.y / d.y;
    const ground = { x: o.x + d.x * k, z: o.z + d.z * k }, focus = __zm.camera.focus;
    return { dx: ground.x - focus.x, dz: ground.z - focus.z };
  })()`);
  await t.evaluate(freezeCamera(target.x - place.dx, target.z - place.dz));
  await t.frames(3);
  // Knob and ring on screen, in screenshot pixels (the canvas may sit inside a page, e.g. the editor preview).
  const geo = await t.evaluate(`(() => {
    const ui = cc.find('Canvas/Camera').getComponent(cc.js.getClassByName('cc.Camera')), UIT = cc.js.getClassByName('cc.UITransform');
    const canvas = cc.game.canvas, rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio;
    const toShot = (node) => {
      const box = node.getComponent(UIT).getBoundingBoxToWorld(), lo = new cc.Vec3(), hi = new cc.Vec3();
      ui.worldToScreen(new cc.Vec3(box.x, box.y, 0), lo); ui.worldToScreen(new cc.Vec3(box.x + box.width, box.y + box.height, 0), hi);
      const sx = rect.width / canvas.width * dpr, sy = rect.height / canvas.height * dpr;
      return { x: (rect.left * dpr) + (lo.x + hi.x) / 2 * sx, y: (rect.top * dpr) + (canvas.height - (lo.y + hi.y) / 2) * sy, r: (hi.x - lo.x) / 2 * sx };
    };
    return { knob: toShot(cc.find('Canvas/Joystick/Base/Knob')), ring: toShot(cc.find('Canvas/Joystick/Base')) };
  })()`);
  const shots = {};
  shots.A = readPng(await t.shot('joystick-over-balls'));
  await t.evaluate(`cc.find('Canvas/Joystick/Base').active = false`);
  await t.frames(3);
  shots.B = readPng(await t.shot('joystick-hidden'));
  await t.evaluate('__zm.ballView.enabled = false');
  await t.frames(3);
  shots.D = readPng(await t.shot('joystick-hidden-no-balls'));
  await t.evaluate(`(() => { __zm.ballView.enabled = true; cc.find('Canvas/Joystick/Base').active = true; })()`);
  await t.frames(3);

  const share = (points, a, b, min) => points.filter(([x, y]) => pixelDiff(a, b, x, y) > min).length / points.length;
  const knob = [];
  const { x: kx, y: ky, r: kr } = geo.knob;
  for (let y = Math.ceil(ky - kr); y <= ky + kr; y++) {
    for (let x = Math.ceil(kx - kr); x <= kx + kr; x++) if (Math.hypot(x - kx, y - ky) <= 0.8 * kr) knob.push([x, y]);
  }
  const ring = [];
  const { x: rx, y: ry, r: rr } = geo.ring;
  for (let a = 0; a < 128; a++) {
    const angle = (a / 128) * 2 * Math.PI;
    ring.push([Math.round(rx + Math.cos(angle) * rr * 0.94), Math.round(ry + Math.sin(angle) * rr * 0.94)]);
  }
  const ballsBehindKnob = share(knob, shots.B, shots.D, 20);
  const knobOverBalls = share(knob, shots.A, shots.B, 20);
  const ringOverBalls = share(ring, shots.A, shots.B, 8);
  t.log(`joystick over balls: knob at (${kx.toFixed(0)}, ${ky.toFixed(0)}) r ${kr.toFixed(0)} px, ring r ${rr.toFixed(0)} px; ` +
    `balls behind the knob ${(100 * ballsBehindKnob).toFixed(0)}% of its pixels; knob changes ${(100 * knobOverBalls).toFixed(1)}%, ring ${(100 * ringOverBalls).toFixed(1)}% of theirs`);
  t.check(ballsBehindKnob > 0.5, `the carpet lies under the resting joystick (${(100 * ballsBehindKnob).toFixed(0)}% of the knob)`);
  t.check(knobOverBalls > 0.97, `the knob is drawn over the balls (${(100 * knobOverBalls).toFixed(1)}% of its pixels change with it)`);
  t.check(ringOverBalls > 0.9, `the ring is drawn over the balls (${(100 * ringOverBalls).toFixed(1)}% of its samples change with it)`);
  await t.evaluate(RELEASE_CAMERA);
  await t.frames(3);
}

export default async function balls(t) {
  await t.waitFor('!!(window.__zm && window.__zm.balls && window.__zm.ballView)');
  await t.evaluate(AUDIT);
  await installAutopilot(t);
  await t.evaluate(PROBES);
  const overlay = process.env.ZM_BALL_OVERLAY === '1';
  const shot = async (name) => {
    if (overlay) await t.evaluate(OVERLAY);
    await t.shot(name);
    if (overlay) await t.evaluate(HIDE_OVERLAY);
  };
  const audit = () => t.evaluate('__ballAudit()');
  const settle = async (label) => {
    const asleep = await t.waitFor('__zm.balls.simulatedCount === 0', 60000).catch(() => false);
    t.check(asleep, `${label}: the carpet is asleep again after the tractor stops`);
  };
  const zoomOn = async (name, x, z, fov) => {
    await t.evaluate(freezeCamera(x, z, fov));
    await t.frames(3);
    await t.shot(name);
    await t.evaluate(RELEASE_CAMERA);
    await t.frames(2);
  };

  // 1. The carpet as laid; the render model; the joystick over the balls; FPS.
  const gl = await t.evaluate(`(() => { const c = cc.game.canvas, gl2 = c.getContext('webgl2');
    return gl2 ? 'WebGL 2 (gl_FragDepth)' : 'WebGL 1, EXT_frag_depth ' + (c.getContext('webgl').getExtension('EXT_frag_depth') ? 'on' : 'missing (balls get quad depth)'); })()`);
  t.log(`context: ${gl}`);
  const laid = await audit();
  t.log(`carpet: ${laid.count} balls, ${laid.simulated} simulated, highest y ${laid.highest.toFixed(3)}`);
  t.check(laid.count > 1400 && laid.count <= 1600, `carpet laid (${laid.count} balls)`);
  t.check(laid.inRock === 0 && laid.outside === 0 && laid.nan === 0, 'no ball in a rock or outside the field at start');
  t.check(laid.simulated === 0, 'the untouched carpet sleeps (no ball simulated)');
  const sync0 = await t.evaluate('__ballSync()');
  t.check(sync0.worst < SYNC_TOLERANCE && sync0.hidden === 0, `every ball is drawn where the field has it at start (worst ${sync0.worst.toExponential(1)})`);
  await shot('carpet');
  await checkDrawCalls(t);
  await checkUiOnTop(t);
  await checkJoystickOverBalls(t);
  const idleUploads = await t.evaluate('__zm.ballView.uploadCount');
  await t.frames(30);
  t.check((await t.evaluate('__zm.ballView.uploadCount')) === idleUploads, 'an asleep carpet uploads nothing (30 frames)');
  const fps0 = await measureFps(t, 'carpet at rest');

  // 2. Rolling close-up: the same patch before and after a short push; pushed balls turned, others did not.
  const spinSnap = `(() => { const d = __zm.ballView.data, b = __zm.balls;
    return { spin: Array.from(d.spin.subarray(0, 4 * b.count)), x: Array.from(b.x.subarray(0, b.count)), z: Array.from(b.z.subarray(0, b.count)) }; })()`;
  await runLegs(t, 'roll', ROLL_PUSH.slice(0, 1));
  const before = await t.evaluate(spinSnap);
  await t.evaluate(freezeCamera(3.6, -11, 10)); // just ahead of where the bucket stops
  await t.frames(3);
  await t.shot('roll-before');
  await runLegs(t, 'roll', ROLL_PUSH.slice(1));
  await t.frames(3);
  await t.shot('roll-after');
  await t.evaluate(RELEASE_CAMERA);
  const after = await t.evaluate(spinSnap);
  let rolled = 0, rolledTurned = 0, still = 0, stillTurned = 0;
  for (let i = 0; i < before.x.length; i++) {
    const way = Math.hypot(after.x[i] - before.x[i], after.z[i] - before.z[i]);
    const dot = Math.abs(before.spin.slice(4 * i, 4 * i + 4).reduce((s, v, k) => s + v * after.spin[4 * i + k], 0));
    const turned = 2 * Math.acos(Math.min(1, dot)) > 1e-3;
    if (way > 0.1) { rolled++; if (turned) rolledTurned++; }
    if (way === 0) { still++; if (turned) stillTurned++; }
  }
  t.log(`rolling: ${rolled} balls pushed more than 0.1 (${rolledTurned} turned), ${still} untouched (${stillTurned} turned)`);
  t.check(rolled >= 5 && rolledTurned === rolled && stillTurned === 0, 'pushed balls rolled, untouched balls kept their orientation');

  // Timing samples of a stretch of the run: per step and per frame (at low FPS a frame runs several steps).
  const mark = () => t.evaluate('({ s: __ballProbe.stepMs.length, f: __ballProbe.ms.length })');
  const since = (m) => t.evaluate(`({ step: __ballProbe.stepMs.slice(${m.s}), frame: __ballProbe.ms.slice(${m.f}), sim: __ballProbe.simulated.slice(${m.f}) })`);

  // 3. Tier 1 ploughs through the carpet, then stops.
  const m1 = await mark();
  await runLegs(t, 'T1', ROUTE_T1.slice(0, 2));
  await t.evaluate(`cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = 16`);
  await t.frames(2);
  await t.shot('t1-bucket-close'); // balls against the bucket while it ploughs (depth)
  await t.evaluate(`cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = 45`);
  await runLegs(t, 'T1', ROUTE_T1.slice(2, 3));
  await shot('t1-plough');
  await runLegs(t, 'T1', ROUTE_T1.slice(3));
  await settle('T1');
  await shot('t1-rest');
  const t1 = await since(m1);

  // 4. Tier 2: bigger boxes, 8.4 u/s (the Tractor2 model itself comes with the progression stage).
  await t.evaluate('__zm.tractor.setTier(__zm.config.tractor.tiers[1])');
  const m2 = await mark();
  await runLegs(t, 'T2', ROUTE_T2.slice(0, 2));
  await shot('t2-plough');
  await runLegs(t, 'T2', ROUTE_T2.slice(2));
  await settle('T2');
  const t2 = await since(m2);
  await shot('t2-rest');

  // 5. Close-ups: balls against the west wall (the rocks stand behind them as the camera sees it) and
  // around the tractor at rest.
  const nearRock = await t.evaluate(`(() => {
    const b = __zm.balls, g = __zm.obstacles, r = __zm.config.balls.radius, tmp = { x: 0, z: 0 };
    let best = -1;
    for (let i = 0; i < b.count; i++) if (g.resolveCircle(b.x[i], b.z[i], r + 0.08, 2, tmp) > 0 && (best < 0 || b.x[i] < b.x[best])) best = i;
    return best < 0 ? null : { x: b.x[best], z: b.z[best] };
  })()`);
  if (nearRock) await zoomOn('rocks-close', nearRock.x, nearRock.z, 12);
  const tr = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z })');
  await zoomOn('tractor-close', tr.x, tr.z, 16);

  // 6. Verdict.
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
  const sync = await t.evaluate('({ worst: __ballProbe.syncWorst, checks: __ballProbe.syncChecks, hidden: __ballProbe.hidden, uploads: __zm.ballView.uploadCount, frames: __ballProbe.ms.length })');
  t.log(`drawn vs field: worst ${sync.worst.toExponential(1)} over ${sync.checks} checked frames; ${sync.uploads} uploads in ${sync.frames} frames`);
  t.check(sync.worst < SYNC_TOLERANCE && sync.hidden === 0, 'after every checked frame every ball was drawn where the field had it (only moved balls rewritten)');
  const fps1 = await measureFps(t, 'after the run');
  t.log(`fps summary: at rest ${fps0.on.toFixed(1)} / ${fps0.off.toFixed(1)}, after the run ${fps1.on.toFixed(1)} / ${fps1.off.toFixed(1)} (with / without balls)`);

  // 7. Depth against real meshes (last: it moves balls behind the simulation's back). A few balls are
  // put into the bucket's scoop, through its side walls, into the body top and a track (Tractor1
  // local axes); the impostors must cut into the meshes along curves, as real spheres would.
  await t.evaluate(`(() => {
    const b = __zm.balls, tr = __zm.tractor, c = Math.cos(tr.yaw), s = Math.sin(tr.yaw);
    const spots = [[-0.3, 0.3, 1.45], [0.3, 0.3, 1.5], [-0.74, 0.35, 1.3], [0.74, 0.4, 1.65], [0.2, 1.25, 0.1], [-0.85, 0.3, -0.3]];
    spots.forEach(([x, y, z], i) => {
      b.x[i] = tr.x + x * c + z * s; b.y[i] = y; b.z[i] = tr.z - x * s + z * c;
      b.moved[b.movedCount++] = i;
    });
  })()`);
  await zoomOn('depth-bucket', ...(await t.evaluate('[__zm.tractor.x, __zm.tractor.z]')), 9);
}
