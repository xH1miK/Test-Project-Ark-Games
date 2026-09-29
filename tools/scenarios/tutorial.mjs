// Tutorial check (M11). The run from start to finish with the arrow and the pointer watched every frame:
//  - the step and the target follow the rule, recomputed here from the world independently of
//    TutorialFlow (sell -> upgrade once the upgrade pad is shown -> gate once it is bought or tier 2 is
//    reached -> done once the gate starts to open; a pad that still needs coins with an empty purse
//    sends the way to the shredder), on every frame;
//  - the markers are shown exactly while there is a target, and their nodes are where the model says:
//    the arrow floats `forward` ahead of the tractor along its own heading at `height`, its node faces
//    its yaw, the yaw never turns faster than turnSpeed, it is on screen; the pointer stands over the
//    target's XZ at its height +- the bob, tipped `pointerPitch` down towards the camera's yaw;
//  - the markers are real 3D nodes of the main camera's world (Default layer, no shadows, one mesh and
//    one green material shared), and they really draw: the screenshot has green pixels where the
//    Tutorial node switched off has none; what they cost in draw calls is logged (Sell step with tier 1,
//    Gate step with tier 2, and after Done: none).
// The route: at the start (Sell, purse 0) -> the first hand-in (Upgrade: the pad is the way while there
// are coins) -> the purse emptied (the way leads to the shredder) -> 40 coins onto the pad (partial
// payment: the pad while there are coins, the shredder once the purse is empty) -> 60 more (tier 2:
// Gate, the shredder again with an empty purse) -> 300 granted (the gate pad) -> drives to the gate and
// pays it (Done in the frame of the payment: both markers gone, and they stay gone).
//
//   node tools/check-html.mjs <html|url> --scenario tutorial [--gpu]

import { installAutopilot, runLegs, gameWait } from './lib/autopilot.mjs';
import { installLoopProbe, loopState, setPurse, settleCoins } from './lib/loop-probe.mjs';
import { readPng } from './lib/png.mjs';
import { upgradeLegs } from './lib/sweep.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

const TUT_PROBE = `(() => {
  if (window.__tutProbe) return 'already';
  const zm = window.__zm, tut = zm.tutorial, mk = zm.markers, tr = zm.tractor, cfg = zm.config.tutorial, maxDt = zm.config.time.maxFrameDt;
  const arrow = cc.find('Tutorial/PathArrow'), pointer = cc.find('Tutorial/Pointer');
  const cam = cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera'));
  const shredderAt = cc.find('Level/Shredder').worldPosition;
  const fwd = new cc.Vec3(), scr = new cc.Vec3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // The rule, written down again from the world (not from TutorialFlow): what the markers should point at.
  const expect = () => {
    if (zm.gate.phase !== 'closed') return null;
    const up = zm.pads.upgrade, gp = zm.pads.gate, coins = zm.purse.total;
    const aim = (pad, id) => (coins <= 0 && pad.missing > 0 ? 'shredder' : id);
    if (up.closed || tr.tier >= tr.maxTier) return aim(gp, 'gate');
    if (up.shown) return aim(up, 'upgrade');
    return 'shredder';
  };
  const q = window.__tutProbe = { frames: 0, clock: 0, steps: [], targets: [], lastStep: null, lastTarget: undefined, lastYaw: 0, lastShown: false,
    targetOff: 0, targetOffAt: null, shownOff: 0, arrowNodeOff: 0, pointerNodeOff: 0, arrowPosOff: 0, arrowAnchorOff: 0, arrowRotOff: 0, pointerPosOff: 0,
    pointerHeightOff: 0, turnOff: 0, turnWorst: 0, offscreen: 0, shownFrames: 0, pointerFrames: 0, doneShown: 0, minY: 1e9, maxY: -1e9 };
  // After lateUpdate: the markers have moved and the views have applied them.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    const dt = Math.min(cc.game.deltaTime, maxDt);
    q.frames++;
    q.clock += dt;
    const id = tut.target ? tut.target.id : null;
    if (tut.step !== q.lastStep) { q.steps.push({ step: tut.step, frame: q.frames, clock: +q.clock.toFixed(3) }); q.lastStep = tut.step; }
    if (id !== q.lastTarget) {
      if (q.targets.length < 60) q.targets.push({ id, frame: q.frames, clock: +q.clock.toFixed(3), purse: zm.purse.total });
      q.lastTarget = id;
    }
    const want = expect();
    if (id !== want) { q.targetOff++; if (!q.targetOffAt) q.targetOffAt = { frame: q.frames, id, want, step: tut.step }; }
    if (mk.arrowShown !== (id !== null) || mk.pointerShown !== (id !== null)) q.shownOff++;
    if (arrow.active !== mk.arrowShown) q.arrowNodeOff++;
    if (pointer.active !== mk.pointerShown) q.pointerNodeOff++;
    if (tut.step === 'done' && (arrow.active || pointer.active)) q.doneShown++;
    if (mk.arrowShown) {
      q.shownFrames++;
      const p = arrow.worldPosition;
      if (Math.hypot(p.x - mk.arrowX, p.y - mk.arrowY, p.z - mk.arrowZ) > 1e-4) q.arrowPosOff++;
      const ax = tr.x + Math.sin(mk.arrowYaw) * cfg.arrow.forward, az = tr.z + Math.cos(mk.arrowYaw) * cfg.arrow.forward;
      if (Math.hypot(p.x - ax, p.z - az) > 1e-4 || Math.abs(p.y - cfg.arrow.height) > 1e-4) q.arrowAnchorOff++;
      cc.Vec3.transformQuat(fwd, cc.Vec3.UNIT_Z, arrow.worldRotation);
      if (Math.abs(fwd.x - Math.sin(mk.arrowYaw)) > 1e-4 || Math.abs(fwd.z - Math.cos(mk.arrowYaw)) > 1e-4 || Math.abs(fwd.y) > 1e-4) q.arrowRotOff++;
      if (q.lastShown && dt > 0) {
        const rate = Math.abs(wrap(mk.arrowYaw - q.lastYaw)) / dt; // rad/s
        q.turnWorst = Math.max(q.turnWorst, rate);
        if (rate > cfg.arrow.turnSpeed * Math.PI / 180 + 1e-4) q.turnOff++;
      }
      cam.worldToScreen(p, scr);
      const cw = cam.camera.width, ch = cam.camera.height;
      if (scr.x < 0 || scr.x > cw || scr.y < 0 || scr.y > ch) q.offscreen++;
    }
    q.lastShown = mk.arrowShown;
    q.lastYaw = mk.arrowYaw;
    if (mk.pointerShown && id) {
      q.pointerFrames++;
      const at = id === 'shredder' ? shredderAt : zm.pads[id], pp = pointer.worldPosition;
      if (Math.abs(pp.x - at.x) > 1e-4 || Math.abs(pp.z - at.z) > 1e-4) q.pointerPosOff++;
      const h = id === 'shredder' ? cfg.pointer.shredderHeight : cfg.pointer.padHeight;
      if (Math.abs(pp.y - h) > cfg.pointer.bob + 1e-4) q.pointerHeightOff++;
      q.minY = Math.min(q.minY, pp.y - h);
      q.maxY = Math.max(q.maxY, pp.y - h);
    }
  });
  return 'installed';
})()`;

/** How far the arrow is from facing the target right now, and what it points at. */
const AIM = `(() => { const zm = __zm, m = zm.markers, tg = zm.tutorial.target, tr = zm.tractor;
  if (!tg || !m.arrowShown) return null;
  const want = Math.atan2(tg.x - tr.x, tg.z - tr.z), d = Math.atan2(Math.sin(m.arrowYaw - want), Math.cos(m.arrowYaw - want));
  return { id: tg.id, err: Math.abs(d), yaw: m.arrowYaw, want, step: zm.tutorial.step, purse: zm.purse.total }; })()`;

const NODES = `(() => { const a = cc.find('Tutorial/PathArrow'), p = cc.find('Tutorial/Pointer');
  return { step: __zm.tutorial.step, target: __zm.tutorial.target ? __zm.tutorial.target.id : null, running: __zm.tutorial.isRunning,
    arrow: a.active, pointer: p.active, purse: __zm.purse.total, tier: __zm.tractor.tier, gate: __zm.gate.phase }; })()`;

const DRAWS = 'cc.director.root.device.numDrawCalls';

/** Pixels whose green clearly beats red and blue: the markers (the balls are turquoise: blue >= green). */
function greenPixels(file) {
  const { width, height, rgba } = readPng(file);
  let n = 0;
  for (let k = 0; k < width * height; k++) {
    const r = rgba[k * 4];
    const g = rgba[k * 4 + 1];
    const b = rgba[k * 4 + 2];
    if (g >= 110 && g - r >= 55 && g - b >= 55) n++;
  }
  return n;
}

/** Draw calls with the markers and with the Tutorial node switched off, and the two screenshots. */
async function markerCost(t, name) {
  await t.frames(3);
  const on = await t.evaluate(DRAWS);
  const shotOn = await t.shot(`tutorial-${name}`);
  await t.evaluate(`cc.find('Tutorial').active = false`);
  await t.frames(3);
  const off = await t.evaluate(DRAWS);
  const shotOff = await t.shot(`tutorial-${name}-markers-off`);
  await t.evaluate(`cc.find('Tutorial').active = true`);
  await t.frames(3);
  return { on, off, green: greenPixels(shotOn), greenOff: greenPixels(shotOff) };
}

/**
 * Empties the purse for good. A stray coin can still be on its way (a big body shoves a ball into the
 * shredder's throat, it pays when it lands), so wait for the air to clear, empty it, and look again.
 */
async function emptyPurse(t) {
  for (let k = 0; k < 6; k++) {
    await t.waitFor('__zm.shredder.inFlight === 0 && __zm.coins.pending === 0', 20000).catch(() => false);
    await setPurse(t, 0);
    await t.frames(4);
    if ((await t.evaluate('__zm.purse.total')) === 0) return;
  }
}

/** The arrow faces `id` once everything has settled. */
async function checkAim(t, label, id) {
  await gameWait(t, 1);
  const a = await t.evaluate(AIM);
  t.log(`${label}: ${JSON.stringify(a)}`);
  t.check(a && a.id === id && a.err < 1e-6, `${label}: the arrow faces the ${id} (off by ${a ? a.err.toExponential(1) : 'no arrow'})`);
  return a;
}

// From the start spot (9, -11) west into the carpet, then north into the shredder's zone: the first hand-in.
const FIRST_SALE = [
  { name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 },
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];

export default async function tutorial(t) {
  await t.waitFor('!!(window.__zm && window.__zm.tutorial && window.__zm.markers && window.__zm.pads)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(TUT_PROBE);
  await t.evaluate(`(() => { __ap.until.upgraded = () => __zm.tractor.tier >= 2; __ap.until.gateOpen = () => __zm.gate.phase !== 'closed'; })()`);
  const cfg = await t.evaluate('__zm.config.tutorial');
  const eco = await t.evaluate('__zm.config.economy');
  const shredder = await t.evaluate(`(() => { const s = cc.find('Level/Shredder').worldPosition; return { x: s.x, z: s.z, zoneHalf: __zm.config.shredder.zoneHalf }; })()`);
  const upgradePad = await t.evaluate('({ x: __zm.pads.upgrade.x, z: __zm.pads.upgrade.z })');
  const gatePad = await t.evaluate('({ x: __zm.pads.gate.x, z: __zm.pads.gate.z, half: __zm.config.pads.zoneHalf })');

  // 1. The start: Sell, the way leads to the shredder, both markers up, real nodes that really draw.
  await t.frames(20);
  const s0 = await t.evaluate(NODES);
  t.log(`start: ${JSON.stringify(s0)}`);
  t.check(s0.step === 'sell' && s0.target === 'shredder' && s0.running && s0.arrow && s0.pointer, 'start: the Sell step, the arrow and the pointer aim at the shredder');
  const look = await t.evaluate(`(() => { const MR = cc.js.getClassByName('cc.MeshRenderer'), a = cc.find('Tutorial/PathArrow'), p = cc.find('Tutorial/Pointer');
    const ra = a.getComponent(MR), rp = p.getComponent(MR), c = ra.sharedMaterial.getProperty('albedo');
    const want = cc.Quat.fromEuler(new cc.Quat(), __zm.config.tutorial.look.pointerPitch, __zm.config.camera.yaw, 0);
    return { layers: [a.layer, p.layer, cc.Layers.Enum.DEFAULT], shadow: [ra.shadowCastingMode, rp.shadowCastingMode, ra.receiveShadow, rp.receiveShadow],
      shared: ra.sharedMaterial === rp.sharedMaterial && ra.mesh === rp.mesh && !!ra.mesh, color: [c.r, c.g, c.b], scale: [a.scale.x, p.scale.x],
      tilt: Math.abs(cc.Quat.dot(p.rotation, want)), parent: a.parent.name + '/' + p.parent.name }; })()`);
  t.log(`look: ${JSON.stringify(look)}`);
  t.check(look.layers[0] === look.layers[2] && look.layers[1] === look.layers[2], 'both markers are on the Default layer (the main camera draws them, the UI camera does not)');
  t.check(look.shadow.every((v) => v === 0), 'no shadows cast or received');
  t.check(look.shared, 'one mesh and one material for both');
  t.check(look.color.join() === cfg.look.color.join(), `the material is green ${cfg.look.color.join(',')}`);
  t.check(Math.abs(look.scale[0] - cfg.look.arrowScale) < 1e-6 && Math.abs(look.scale[1] - cfg.look.pointerScale) < 1e-6, `scales ${look.scale.join(' / ')}`);
  t.check(look.tilt > 1 - 1e-6, `the pointer is tipped ${cfg.look.pointerPitch} degrees and faces the camera's yaw`);
  await checkAim(t, 'start', 'shredder');
  const c1 = await markerCost(t, 'sell');
  t.log(`draw calls, Sell with tier 1: ${c1.on} with the markers, ${c1.off} without; green pixels ${c1.green} with, ${c1.greenOff} without`);
  // Both share the mesh and the material with instancing on: one draw call (two on a device that cannot instance).
  t.check(c1.on - c1.off >= 1 && c1.on - c1.off <= 2, `the markers cost ${c1.on - c1.off} draw call(s) (arrow + pointer, instanced)`);
  t.check(c1.green - c1.greenOff > 300, `the markers really draw: ${c1.green - c1.greenOff} green pixels more with them than without`);

  // 2. The first hand-in shows the upgrade pad: Upgrade, the pad is the way while there are coins.
  await runLegs(t, 'first sale', FIRST_SALE);
  await t.waitFor('__zm.pads.upgrade.shown', 10000);
  await settleCoins(t, 'first sale');
  const s1 = await t.evaluate(NODES);
  t.log(`after the first hand-in: ${JSON.stringify(s1)}`);
  t.check(s1.step === 'upgrade' && s1.purse > 0 && s1.target === 'upgrade', `Upgrade after the first hand-in; ${s1.purse} coins in the purse -> the way leads to the pad`);
  await checkAim(t, 'upgrade with coins', 'upgrade');
  await t.shot('tutorial-upgrade');

  // 3. An empty purse with the pad unpaid: back to the shredder; the pad again once there are coins.
  await emptyPurse(t);
  const s2 = await t.evaluate(NODES);
  t.check(s2.step === 'upgrade' && s2.purse === 0 && s2.target === 'shredder', 'purse empty, the pad unpaid: still Upgrade, but the arrow leads to the shredder');
  await checkAim(t, 'empty purse', 'shredder');
  await t.shot('tutorial-empty-purse');
  await setPurse(t, 40);
  await t.frames(3);
  const s3 = await t.evaluate(NODES);
  t.check(s3.target === 'upgrade', 'with 40 coins again the way leads to the pad');

  // 4. A partial payment on the pad: the pad while there are coins in the purse, the shredder once it is empty.
  const from = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z })');
  await runLegs(t, 'partial payment', upgradeLegs(from, shredder, upgradePad));
  await settleCoins(t, 'partial payment');
  const s4 = await t.evaluate(`({ ...(${NODES}), stored: __zm.pads.upgrade.stored, missing: __zm.pads.upgrade.missing })`);
  t.log(`partial payment: ${JSON.stringify(s4)}`);
  // (The route round the shredder can earn a few coins on the way: the pad holds at least the 40 granted.)
  t.check(s4.stored >= 40 && s4.stored < eco.upgradePrice && s4.missing === eco.upgradePrice - s4.stored && s4.purse === 0 && s4.step === 'upgrade' && s4.target === 'shredder',
    `${s4.stored} of ${eco.upgradePrice} paid, the purse is empty: Upgrade, the arrow leads to the shredder`);

  // 5. The rest: tier 2 -> Gate; the gate pad needs 300 and the purse is empty -> the shredder; 300 coins -> the gate pad.
  await setPurse(t, s4.missing);
  await t.waitFor('__zm.tractor.tier === 2', 20000);
  await settleCoins(t, 'the rest of the price');
  await gameWait(t, 0.6); // the swell and the zoom
  await emptyPurse(t);
  const s5 = await t.evaluate(NODES);
  t.log(`tier 2: ${JSON.stringify(s5)}`);
  t.check(s5.step === 'gate' && s5.tier === 2 && s5.purse === 0 && s5.target === 'shredder', 'tier 2 bought: the Gate step; the purse is empty, so the arrow leads to the shredder');
  await checkAim(t, 'gate step, empty purse', 'shredder');
  await setPurse(t, eco.gatePrice);
  await t.frames(3);
  const s6 = await t.evaluate(NODES);
  t.check(s6.step === 'gate' && s6.target === 'gate', `${eco.gatePrice} coins in the purse: the way leads to the gate pad`);

  // 6. Round the shredder and down the east side, stopping short of the gate pad's zone (paying ends the run).
  const shortOfZone = { x: 7.5, z: gatePad.z + gatePad.half + 1.1 };
  await runLegs(t, 'to the gate', [
    { name: 'gate: round the shredder (east)', kind: 'goto', x: shredder.x + 4.55, z: upgradePad.z, radius: 0.9 },
    { name: 'gate: down the east side', kind: 'goto', x: shredder.x + 4.55, z: shortOfZone.z, radius: 0.9 },
    { name: 'gate: west, short of the zone', kind: 'goto', x: shortOfZone.x, z: shortOfZone.z, radius: 0.6 },
    { name: 'gate: stand', kind: 'stop', time: 0.5 },
  ]);
  const at = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z, gate: __zm.gate.phase })');
  const outside = Math.abs(at.x - gatePad.x) > gatePad.half || Math.abs(at.z - gatePad.z) > gatePad.half;
  t.check(at.gate === 'closed' && outside, `stopped at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}), outside the gate pad's zone, the gate shut`);
  await checkAim(t, 'at the gate', 'gate');
  const c2 = await markerCost(t, 'gate');
  t.log(`draw calls, Gate with tier 2: ${c2.on} with the markers, ${c2.off} without; green pixels ${c2.green} with, ${c2.greenOff} without`);
  t.check(c2.on - c2.off >= 1 && c2.on - c2.off <= 2, `the markers cost ${c2.on - c2.off} draw call(s) with tier 2`);
  t.check(c2.green - c2.greenOff > 300, `and they draw at the gate: ${c2.green - c2.greenOff} green pixels more`);

  // 7. Drive into the zone and pay: the gate starts to open -> Done in that very frame, both markers gone.
  await runLegs(t, 'pay the gate', [
    { name: 'gate: into the zone and pay', kind: 'goto', x: gatePad.x, z: gatePad.z, radius: 0.4, until: 'gateOpen', timeout: 20 },
  ]);
  await t.frames(5);
  const s7 = await t.evaluate(NODES);
  t.log(`gate opening: ${JSON.stringify(s7)}`);
  t.check(s7.gate !== 'closed' && s7.step === 'done' && s7.target === null && !s7.running && !s7.arrow && !s7.pointer, 'the gate opens: Done, no target, both markers gone');
  await gameWait(t, 1.5);
  const s8 = await t.evaluate(NODES);
  t.check(s8.step === 'done' && !s8.arrow && !s8.pointer && s8.gate === 'open', 'and they stay gone once the gate is open');
  const c3 = await markerCost(t, 'done');
  t.log(`draw calls after Done: ${c3.on} with the (hidden) markers, ${c3.off} without`);
  t.check(c3.on === c3.off, 'after Done the markers cost no draw call');

  // 8. The verdict over every frame.
  const q = await t.evaluate('__tutProbe');
  const steps = q.steps.map((s) => s.step).join(' -> ');
  t.log(`steps: ${q.steps.map((s) => `${s.step}@${s.clock}s`).join(' -> ')}`);
  t.log(`targets: ${q.targets.map((x) => `${x.id}@${x.clock}s(purse ${x.purse})`).join(' -> ')}`);
  t.log(`over ${q.frames} frames (${q.clock.toFixed(1)} s): the arrow was up in ${q.shownFrames}, the pointer in ${q.pointerFrames}; the arrow turned at most ${(q.turnWorst * 180 / Math.PI).toFixed(0)} deg/s; ` +
    `the pointer bobbed ${q.minY.toFixed(3)} .. ${q.maxY.toFixed(3)} around its height; off screen in ${q.offscreen} frames`);
  t.check(steps === 'sell -> upgrade -> gate -> done', `the steps came in order, once each: ${steps}`);
  t.check(q.targetOff === 0, `every frame the target was the rule's (${q.targetOffAt ? JSON.stringify(q.targetOffAt) : 'never off'})`);
  t.check(q.shownOff === 0 && q.arrowNodeOff === 0 && q.pointerNodeOff === 0 && q.doneShown === 0, 'the markers were shown exactly while there was a target, and their nodes agreed');
  t.check(q.arrowPosOff === 0 && q.arrowAnchorOff === 0 && q.arrowRotOff === 0,
    `every frame the arrow node was where the model has it: ahead of the tractor by ${cfg.arrow.forward}, ${cfg.arrow.height} up, facing its yaw (${q.arrowPosOff}/${q.arrowAnchorOff}/${q.arrowRotOff} off)`);
  t.check(q.turnOff === 0, `the arrow never turned faster than ${cfg.arrow.turnSpeed} deg/s (fastest ${(q.turnWorst * 180 / Math.PI).toFixed(1)})`);
  t.check(q.turnWorst * 180 / Math.PI > 60, 'and it did turn: the route made it swing');
  t.check(q.pointerPosOff === 0 && q.pointerHeightOff === 0, 'every frame the pointer stood over its target at its height +- the bob');
  t.check(q.maxY - q.minY > cfg.pointer.bob, `the pointer bobbed (${(q.maxY - q.minY).toFixed(3)} peak to peak of ${2 * cfg.pointer.bob})`);
  t.check(q.offscreen === 0, 'the arrow was on screen every frame it was shown');
  const end = await loopState(t);
  const loop = await t.evaluate('({ coinsOff: __loopProbe.coinsOff, coinsOffAt: __loopProbe.coinsOffAt, hudOff: __loopProbe.hudOff })');
  t.check(loop.coinsOff === 0 && loop.hudOff === 0, `the coin ledger held every frame (purse ${end.purse}, pads ${end.pads})`);
  await checkUiOnTop(t);
}
