// Upgrade check (M9). The first hand-in pops the upgrade pad up; with its price in the purse (granted)
// the tractor rounds the shredder onto it and buys tier 2 there (lib/sweep.mjs upgradeLegs). From the
// purchase on, every frame: Tractor2's model shown and Tractor1's hidden; the new model's scale follows
// swell.from + (1 - swell.from) x backOut(elapsed / swell.time) (the tween runs on the raw frame time,
// from the frame after the purchase); the camera's zoom follows 1 + 0.2 x smoothstep(elapsed /
// zoomTime) (the rig's clamped frame time, from the purchase frame); the body circle never deeper in
// an obstacle than the overlap it arrived with, shrinking over swell.time, and at most 0.05 after it.
// `tierChanged` 2 exactly once, the pad reads MAX. Then tier 2 at work: 8.4 u/s, fills 60 and hands
// them in whole (the loop probe checks the ledger, the whole load and the zone every frame and step).
// Close-ups: Tractor2 mid-swell (paused), its full bucket from above and from the side (paused), the
// load of 60 in the air. Draw calls with Tractor1 and with Tractor2 at rest.
//
//   node tools/check-html.mjs <html|url> --scenario upgrade [--gpu]

import { driveLegs, installAutopilot, runLegs } from './lib/autopilot.mjs';
import { RELEASE_CAMERA, parkCamera } from './lib/camera.mjs';
import { checkLoopProbe, installLoopProbe, loopState, setPurse, settleCoins } from './lib/loop-probe.mjs';
import { pickFillTarget, roundLegs, sweepFrame, upgradeLegs } from './lib/sweep.mjs';

const UPGRADE_PROBE = `(() => {
  if (window.__upgradeProbe) return 'already';
  const zm = window.__zm, tr = zm.tractor, models = zm.tractorView.models, tmp = { x: 0, z: 0 };
  const rest = models.map((m) => m.scale.x);
  const q = window.__upgradeProbe = { rest, tiers: [], at: -1, frames: [], deepDuring: 0, deepAfter: 0, overlap: 0, topSpeed: 0,
    shownWrong: 0, t1Frames: 0, pauseWhen: null, paused: false };
  zm.events.on('tierChanged', ({ tier }) => {
    q.tiers.push(tier);
    if (q.at < 0) {
      q.at = __ap.clock;
      q.overlap = zm.obstacles.resolveCircle(tr.bodyX, tr.bodyZ, tr.bodyRadius, 1, tmp);
    }
  });
  // After lateUpdate: the views have drawn this frame. Runs after the autopilot's clock (registered later).
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    const deep = zm.obstacles.resolveCircle(tr.bodyX, tr.bodyZ, tr.bodyRadius, 1, tmp);
    if (q.at < 0) {
      q.t1Frames++;
      if (!models[0].active || models[1].active) q.shownWrong++;
      return;
    }
    if (models[0].active || !models[1].active) q.shownWrong++;
    const since = __ap.clock - q.at;
    if (since <= zm.config.tractor.swell.time) q.deepDuring = Math.max(q.deepDuring, deep - q.overlap * (1 - since / zm.config.tractor.swell.time));
    else q.deepAfter = Math.max(q.deepAfter, deep);
    q.topSpeed = Math.max(q.topSpeed, tr.speed);
    if (q.frames.length < 90) q.frames.push({ dt: cc.game.deltaTime, scale: models[1].scale.x / rest[1], zoom: zm.camera.zoom });
    if (q.pauseWhen && q.pauseWhen()) {
      q.pauseWhen = null;
      q.paused = true;
      cc.director.pause(); // logic and tweens stop, rendering goes on
    }
  });
  return 'installed';
})()`;

/** Camera low beside the tractor (on the +X+Z side the rig looks from), looking at the bucket. */
const SIDE_OF_BUCKET = `(() => {
  const tr = __zm.tractor, s = __zm.tractor.bucketShape, reach = (s.minZ + s.maxZ) / 2;
  const fx = Math.sin(tr.yaw), fz = Math.cos(tr.yaw), bx = tr.x + fx * reach, bz = tr.z + fz * reach;
  let nx = fz, nz = -fx;
  if (nx + nz < 0) { nx = -nx; nz = -nz; }
  const cam = cc.find('Main Camera');
  cam.setPosition(bx + nx * 7 + fx * 2, 2.6, bz + nz * 7 + fz * 2);
  cam.lookAt(new cc.Vec3(bx, 1, bz));
  cam.getComponent(cc.js.getClassByName('cc.Camera')).fov = 32;
})()`;

const smoothstep = (k) => k * k * (3 - 2 * k);
const backOut = (k) => {
  const s = 1.70158;
  const m = k - 1;
  return k === 0 ? 0 : m * m * ((s + 1) * m + s) + 1;
};

// From the start spot (9, -11) west into the carpet, then north into the shredder's zone: the first
// hand-in (it pops the upgrade pad up).
const FIRST_SALE = [
  { name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 },
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];

/**
 * Pauses when `condition` (page JS) first holds, parks the camera for the shots, resumes. `missed`
 * (page JS) says the moment has passed without a pause.
 */
async function pausedShots(t, label, condition, missed, shots) {
  await t.evaluate(`__upgradeProbe.pauseWhen = () => ${condition}`);
  const paused = await t.waitFor(`__upgradeProbe.paused || (${missed})`, 90000).catch(() => false).then(() => t.evaluate('__upgradeProbe.paused'));
  t.check(paused, `${label}: paused for the close-ups`);
  if (!paused) {
    await t.evaluate('__upgradeProbe.pauseWhen = null');
    return;
  }
  for (const [name, camera] of shots) {
    await t.evaluate(camera);
    await t.frames(2);
    await t.shot(name);
  }
  await t.evaluate(`(() => { __upgradeProbe.paused = false; cc.director.resume(); })()`);
  await t.evaluate(RELEASE_CAMERA);
}

export default async function upgrade(t) {
  await t.waitFor('!!(window.__zm && window.__zm.pads && window.__zm.tractorView)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(UPGRADE_PROBE);
  const cfg = await t.evaluate('({ swell: __zm.config.tractor.swell, zoomTime: __zm.config.camera.zoomTime, tierZoom: __zm.config.camera.tierZoom, maxFrameDt: __zm.config.time.maxFrameDt, tiers: __zm.config.tractor.tiers.map((x) => ({ speed: x.speed, capacity: x.bucketCapacity })) })');
  const shredder = await t.evaluate(`(() => { const s = cc.find('Level/Shredder').worldPosition; return { x: s.x, z: s.z, zoneHalf: __zm.config.shredder.zoneHalf }; })()`);
  const models = await t.evaluate('__zm.tractorView.models.map((m) => ({ name: m.name, active: m.active, scale: m.scale.x }))');
  t.log(`tier models: ${models.map((m) => `${m.name} (active ${m.active}, scale ${m.scale})`).join(', ')}`);
  t.check(models.length === 2 && models[0].active && !models[1].active, 'start: Tractor1 shown, Tractor2 hidden');
  const drawsT1 = await t.evaluate('cc.director.root.device.numDrawCalls');

  // 1. The first hand-in pops the upgrade pad up.
  await runLegs(t, 'first sale', FIRST_SALE);
  await t.waitFor('__zm.pads.upgrade.shown', 10000);
  await settleCoins(t, 'first sale');

  // 2. With the price in the purse, onto the pad: tier 2. Paused ~0.1 s into the swell for a close-up.
  await setPurse(t, 150);
  const from = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z })');
  const pad = await t.evaluate('({ x: __zm.pads.upgrade.x, z: __zm.pads.upgrade.z })');
  await t.evaluate(`__ap.until.upgraded = () => __zm.tractor.tier >= 2`);
  await t.evaluate(`__ap.run(${JSON.stringify(upgradeLegs(from, shredder, pad))})`);
  await pausedShots(t, 'swell', '__upgradeProbe.at >= 0 && __ap.clock - __upgradeProbe.at >= 0.1', '__upgradeProbe.at >= 0 && __ap.clock - __upgradeProbe.at > 1', [
    ['t2-swelling', parkCamera(pad.x, pad.z, 22)],
  ]);
  await t.waitFor('!__ap.running', 60000);
  const legs = await t.evaluate('__ap.results');
  for (const r of legs) t.log(`onto the pad | ${r.name}: ${r.reason} at (${r.x}, ${r.z}) in ${r.t}s`);
  t.check(legs.every((r) => r.ok) && legs[legs.length - 1].reason === 'upgraded', 'drove onto the upgrade pad and bought tier 2 there');
  await t.frames(40); // the rest of the swell and the zoom (0.5 s)
  const q = await t.evaluate('(() => { const q = __upgradeProbe; return { ...q, pauseWhen: null }; })()');
  const s = await t.evaluate(`({ tier: __zm.tractor.tier, speed: __zm.tractor.topSpeed, capacity: __zm.bucket.capacity, closed: __zm.pads.upgrade.closed,
    label: cc.find('Level/Spots/UpgradePad/Plate/Amount').getComponent(cc.js.getClassByName('cc.Label')).string })`);
  t.log(`bought: tierChanged ${JSON.stringify(q.tiers)}; top speed ${s.speed}, bucket ${s.capacity}, pad "${s.label}"; T2 arrived overlapping by ${q.overlap.toFixed(3)}`);
  t.check(q.tiers.length === 1 && q.tiers[0] === 2 && s.tier === 2, 'tierChanged 2, once');
  t.check(s.speed === cfg.tiers[1].speed && s.capacity === cfg.tiers[1].capacity, `tier 2 stats: ${s.speed} u/s, a bucket of ${s.capacity}`);
  t.check(s.closed && s.label === 'MAX', 'the upgrade pad reads MAX');
  t.check(q.shownWrong === 0, `every frame only the tier's model was shown (${q.t1Frames} frames of Tractor1, then Tractor2)`);

  // The swell and the zoom, frame by frame (frames[0] = the purchase frame). The camera rig zooms from
  // the purchase frame's lateUpdate on (clamped frame time). The view starts the tween in that same
  // lateUpdate, after the frame's tween step (director.ts: update, systems, lateUpdate); the tween's first
  // step, next frame, counts as 0 (action-interval.ts: _firstTick) -> it advances from frames[2] on, by
  // the raw frame time.
  const { from: swellFrom, time: swellTime } = cfg.swell;
  let tween = 0;
  let swellOff = 0;
  let swellEnd = null;
  for (const [k, f] of q.frames.entries()) {
    if (k >= 2) tween += Math.min(f.dt, 1);
    swellOff = Math.max(swellOff, Math.abs(f.scale - (swellFrom + (1 - swellFrom) * backOut(Math.min(1, tween / swellTime)))));
    if (swellEnd === null && tween >= swellTime) swellEnd = { scale: f.scale };
  }
  let rig = 0;
  let zoomOff = 0;
  let peak = 0;
  let zoomEnd = null;
  const curve = [];
  for (const f of q.frames) {
    rig += Math.min(f.dt, cfg.maxFrameDt);
    const wantZoom = 1 + (cfg.tierZoom - 1) * smoothstep(Math.min(1, rig / cfg.zoomTime));
    zoomOff = Math.max(zoomOff, Math.abs(f.zoom - wantZoom));
    peak = Math.max(peak, f.scale);
    if (zoomEnd === null && rig >= cfg.zoomTime) zoomEnd = { t: rig, zoom: f.zoom };
    if (curve.length < 30) curve.push(`${rig.toFixed(3)}:${f.scale.toFixed(3)}/${f.zoom.toFixed(3)}`);
  }
  t.log(`swell/zoom per frame (s: scale/zoom): ${curve.join(' ')}`);
  t.check(q.frames.length > 0 && Math.abs(q.frames[0].scale - swellFrom) < 1e-4, `the new model starts at ${swellFrom} of its size (${q.frames[0]?.scale.toFixed(4)})`);
  t.check(swellOff < 2e-3, `its scale follows backOut over ${swellTime} s (worst ${swellOff.toExponential(1)})`);
  t.check(swellEnd && Math.abs(swellEnd.scale - 1) < 1e-4, `and rests at its size after ${swellTime} s (${swellEnd ? swellEnd.scale.toFixed(4) : 'not reached'})`);
  const samples = q.frames.filter((_, k) => k > 0).length;
  if (samples >= 8) t.check(peak > 1.01, `it overshoots on the way (peak ${peak.toFixed(3)})`);
  else t.log(`only ${samples} frames in the swell: overshoot not sampled (peak seen ${peak.toFixed(3)})`);
  t.check(zoomOff < 1e-4, `the camera zooms out along smoothstep over ${cfg.zoomTime} s (worst ${zoomOff.toExponential(1)})`);
  t.check(zoomEnd && Math.abs(zoomEnd.zoom - cfg.tierZoom) < 1e-6, `to x${cfg.tierZoom} (${zoomEnd ? zoomEnd.zoom.toFixed(4) : 'not reached'})`);
  t.check(q.deepDuring <= 0.05 && q.deepAfter <= 0.05, `the body grew into its size: at most ${q.deepDuring.toFixed(3)} over the shrinking overlap, then ${q.deepAfter.toFixed(3)} deep`);
  const drawsT2 = await t.evaluate('cc.director.root.device.numDrawCalls');
  t.log(`draw calls at the start with Tractor1 ${drawsT1}, now with Tractor2 ${drawsT2} (the camera further out)`);
  await t.shot('t2-on-pad');

  // 3. Tier 2 at work: fill 60 near the carpet's north-west, then into the zone; paused with the full
  // bucket (above, side) and with the load in the air.
  const frame = sweepFrame(shredder, shredder.zoneHalf);
  await t.evaluate(`(() => {
    const pick = ${pickFillTarget}, frame = ${JSON.stringify(frame)}, tabu = [];
    __ap.targets.balls = (leg, stalled) => {
      if (stalled) tabu.push(stalled.cell);
      return pick(__zm.balls, __zm.tractor, Object.assign({}, frame, { toward: leg.toward, minMass: leg.minMass, clearance: leg.clearance, tabu, obstacles: __zm.obstacles }));
    };
  })()`);
  const [fillLeg, sellLeg] = roundLegs(0, 1, shredder);
  const [fill] = await driveLegs(t, [fillLeg], 90000);
  t.log(`T2 fill | ${fill.name}: ${fill.reason} in ${fill.t}s (${fill.picks} picks), ${fill.load} of ${fill.capacity} in the bucket at (${fill.x}, ${fill.z})`);
  t.check(fill.ok && fill.reason === 'full' && fill.load === 60 && fill.capacity === 60, 'tier 2 filled its bucket with 60');
  await t.frames(60); // the pile settles
  const bucket = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z, yaw: __zm.tractor.yaw })');
  const reach = 2.7;
  const bx = bucket.x + Math.sin(bucket.yaw) * reach;
  const bz = bucket.z + Math.cos(bucket.yaw) * reach;
  await t.evaluate('cc.director.pause()');
  await t.evaluate(parkCamera(bx, bz, 16));
  await t.frames(2);
  await t.shot('t2-full-top');
  await t.evaluate(SIDE_OF_BUCKET);
  await t.frames(2);
  await t.shot('t2-full-side');
  await t.evaluate('cc.director.resume()');
  await t.evaluate(RELEASE_CAMERA);
  const handed0 = await t.evaluate('__zm.shredder.handedIn');
  await t.evaluate(`__ap.run(${JSON.stringify([sellLeg])})`);
  await pausedShots(t, 'the load in the air', `__zm.shredder.handedIn > ${handed0} && __zm.shredder.inFlight > 40`, '!__ap.running', [
    ['t2-load-flying', parkCamera(shredder.x, shredder.z + 1, 24)],
  ]);
  await t.waitFor('!__ap.running', 60000);
  const [sell] = await t.evaluate('__ap.results');
  t.log(`T2 sell | ${sell.name}: ${sell.reason} in ${sell.t}s at (${sell.x}, ${sell.z}), sold ${sell.sold}`);
  t.check(sell.ok && sell.reason === 'inZone' && sell.sold >= 60, 'and handed all 60 in as its body entered the zone');
  const end = await settleCoins(t, 'the T2 load');
  const probe = await t.evaluate('({ topSpeed: __upgradeProbe.topSpeed })');
  t.check(probe.topSpeed > cfg.tiers[0].speed + 1, `tier 2 drove faster than tier 1 could (top ${probe.topSpeed.toFixed(2)} u/s)`);
  await checkLoopProbe(t, end, 10);
  const state = await loopState(t);
  t.log(`end: purse ${state.purse}, shredded ${state.shredded}, on the pads ${state.pads}, granted ${state.granted}`);
}
