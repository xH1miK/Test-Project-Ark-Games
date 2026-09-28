// Core loop check (M6): fill the bucket, bring it to the shredder, the load flies in, coins go to the
// purse and the HUD. Watched on every frame: every shredded ball paid exactly 2 (purse + coins still
// in the air = 2 x shredded), the HUD shows the purse, every held ball is exactly one of carried /
// flying / shredded, flying balls are drawn where the field has them and shredded ones are hidden.
// Watched on every shredder step: a load is taken only while the tractor's pivot is in the square
// zone, and all of it at once; balls the throat swallows while the tractor is still outside the zone
// were shoved there. Legs: fill 8 -> into the zone -> coins arrive (HUD shot) -> with a full bucket
// at the shredder from the east through the carpet (the berm feeds the throat, then the load goes) ->
// two more rounds (the first paused mid-flight for close-ups of the arcs, flying across the view).
// The HUD layout (top-right, on screen) is checked where the game fills the page (not in the editor
// preview's frame). Rollers turn while it grinds.
//
//   node tools/check-html.mjs <html|url> --scenario core-loop [--gpu]

import { installAutopilot, runLegs } from './lib/autopilot.mjs';
import { FPS, RELEASE_CAMERA, parkCamera } from './lib/camera.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

/** Drawn centres are float32 copies of the field's doubles. */
const SYNC_TOLERANCE = 1e-5;

const PROBES = `(() => {
  if (window.__loopProbe) return 'already';
  const zm = window.__zm, b = zm.balls, sh = zm.shredder, tr = zm.tractor, bucket = zm.bucket, view = zm.ballView, hud = zm.coinHud;
  const half = zm.config.shredder.zoneHalf, at = cc.find('Level/Shredder').worldPosition, pose = { x: at.x, z: at.z };
  const perBall = zm.config.economy.coinsPerBall;
  const p = window.__loopProbe = { frames: 0, handIns: [], outOfZone: 0, notWhole: 0, throatOutside: 0, throatInside: 0,
    shreddedEvents: 0, earned: 0, coinsOff: 0, coinsOffAt: null, hudOff: 0, labelOff: 0, stray: 0, strayAt: null,
    drawnOff: 0, hiddenWrong: 0, maxPunch: 1, maxRoller: 0, rollerTurned: false, maxInFlight: 0, pauseWhen: null, paused: false };
  zm.events.on('ballsShredded', (e) => { p.shreddedEvents += e.count; });
  zm.events.on('coinsEarned', (e) => { p.earned += e.amount; });
  // Per shredder step: where the tractor's pivot was when a load went or the throat swallowed.
  const step = sh.step.bind(sh);
  sh.step = (dt) => {
    const handed = sh.handedIn, swallowed = sh.swallowed, load = bucket.count;
    step(dt);
    const dx = tr.x - pose.x, dz = tr.z - pose.z, inZone = Math.abs(dx) <= half + 1e-9 && Math.abs(dz) <= half + 1e-9;
    if (sh.handedIn > handed) {
      p.handIns.push({ frame: p.frames, clock: window.__ap ? window.__ap.clock : 0, count: sh.handedIn - handed, load, left: bucket.count, dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
      if (!inZone) p.outOfZone++;
      if (sh.handedIn - handed !== load || bucket.count !== 0) p.notWhole++;
    }
    if (sh.swallowed > swallowed) {
      if (inZone) p.throatInside += sh.swallowed - swallowed;
      else p.throatOutside += sh.swallowed - swallowed;
    }
  };
  const roller = cc.find('Level/Shredder/SM_Shred/roll_1'), rest = roller.rotation.clone();
  const drawn = { x: 0, y: 0, z: 0, radius: 0 };
  // EVENT_AFTER_UPDATE comes after lateUpdate: the views have drawn this frame by then.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    p.frames++;
    const owed = perBall * sh.shredded, have = zm.purse.total + zm.coins.pending;
    if (owed !== have) { p.coinsOff++; if (!p.coinsOffAt) p.coinsOffAt = { frame: p.frames, owed, have }; }
    if (hud.shown !== zm.purse.total) p.hudOff++;
    if (hud.amount.string !== String(zm.purse.total)) p.labelOff++;
    const carried = new Uint8Array(b.count);
    for (let k = 0; k < bucket.count; k++) carried[bucket.index[k]] = 1;
    for (let i = 0; i < b.count; i++) {
      const roles = carried[i] + (sh.flights.isFlying(i) ? 1 : 0) + (b.isRemoved(i) ? 1 : 0);
      if (b.isHeld(i) ? roles !== 1 : roles !== 0) { p.stray++; if (!p.strayAt) p.strayAt = { frame: p.frames, i, roles, held: b.isHeld(i) }; }
    }
    for (let k = 0; k < sh.flights.count; k++) {
      const i = sh.flights.index[k];
      view.data.readBall(i, drawn);
      p.drawnOff = Math.max(p.drawnOff, Math.abs(drawn.x - b.x[i]), Math.abs(drawn.y - b.y[i]), Math.abs(drawn.z - b.z[i]));
      if (!(drawn.radius > 0)) p.hiddenWrong++;
    }
    if (p.frames % 4 === 0) {
      for (let i = 0; i < b.count; i++) {
        if (!b.isRemoved(i)) continue;
        view.data.readBall(i, drawn);
        if (drawn.radius !== 0) p.hiddenWrong++;
      }
    }
    p.maxInFlight = Math.max(p.maxInFlight, sh.inFlight);
    p.maxRoller = Math.max(p.maxRoller, sh.rollerSpeed);
    if (!p.rollerTurned && Math.abs(cc.Quat.dot(roller.rotation, rest)) < 0.999) p.rollerTurned = true;
    p.maxPunch = Math.max(p.maxPunch, hud.punchNode.scale.x);
    if (p.pauseWhen && p.pauseWhen()) {
      p.pauseWhen = null;
      p.paused = true;
      cc.director.pause(); // logic stops, rendering goes on
    }
  });
  return 'installed';
})()`;

/**
 * Where the coin counter (plate and icon) is on the page, CSS px; the part of the page the game shows
 * (the canvas cut to the window). The editor preview draws the game in a frame of its own, larger than
 * the page (`framed`): its layout is judged on the packed HTML.
 */
const HUD_ON_SCREEN = `(() => {
  const ui = cc.find('Canvas/Camera').getComponent(cc.js.getClassByName('cc.Camera')), UIT = cc.js.getClassByName('cc.UITransform');
  const canvas = cc.game.canvas, rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  const onPage = (path) => {
    const box = cc.find(path).getComponent(UIT).getBoundingBoxToWorld(), lo = new cc.Vec3(), hi = new cc.Vec3();
    ui.worldToScreen(new cc.Vec3(box.x, box.y, 0), lo); ui.worldToScreen(new cc.Vec3(box.x + box.width, box.y + box.height, 0), hi);
    return { left: rect.left + lo.x * sx, right: rect.left + hi.x * sx, top: rect.top + (canvas.height - hi.y) * sy, bottom: rect.top + (canvas.height - lo.y) * sy };
  };
  const plate = onPage('Canvas/Hud/CoinHud/Plate'), icon = onPage('Canvas/Hud/CoinHud/Plate/Icon');
  const hud = { left: Math.min(plate.left, icon.left), right: Math.max(plate.right, icon.right), top: Math.min(plate.top, icon.top), bottom: Math.max(plate.bottom, icon.bottom) };
  const shown = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
  const framed = rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1;
  return { ...hud, shown, framed, label: cc.find('Canvas/Hud/CoinHud/Plate/Amount').getComponent(cc.js.getClassByName('cc.Label')).string };
})()`;

/**
 * While the game is paused (the rig does not move the camera then): the camera low and to the side of
 * the flight from the tractor to the shredder, on the usual +X+Z side, looking at the middle of the arcs.
 */
const SIDE_VIEW = `(() => {
  const tr = __zm.tractor, s = cc.find('Level/Shredder').worldPosition;
  const mx = (tr.x + s.x) / 2, mz = (tr.z + s.z) / 2, dx = s.x - tr.x, dz = s.z - tr.z, len = Math.hypot(dx, dz);
  let nx = -dz / len, nz = dx / len;
  if (nx + nz < 0) { nx = -nx; nz = -nz; }
  const cam = cc.find('Main Camera');
  cam.setPosition(mx + nx * 8, 3, mz + nz * 8);
  cam.lookAt(new cc.Vec3(mx, 1, mz));
  cam.getComponent(cc.js.getClassByName('cc.Camera')).fov = 40;
})()`;

// From the start spot (9, -11) west into the carpet: the bucket fills up.
const FILL = [{ name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 }];
// North into the zone (|dx|, |dz| <= 3.5 around the shredder at (5.75, -1.85)); stop just inside.
const TO_SHREDDER = [
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];
// Refill south-east of the shredder, round to its east side, then straight at it through the carpet:
// the full bucket shoves a berm into the throat before the pivot reaches the zone.
const SHOVE = [
  { name: 'shove: refill south-east', kind: 'goto', x: 11, z: -8 },
  { name: 'shove: east of the shredder', kind: 'goto', x: 12, z: -1.9, radius: 0.5 },
  { name: 'shove: at the shredder', kind: 'goto', x: 8.8, z: -1.9, radius: 0.3 },
  { name: 'shove: stop', kind: 'stop', time: 0.3 },
];
// Two more rounds from the shredder's east side: out north past it, fill in the carpet north-west,
// back into the zone north-west of the shredder's body; then once more through the north.
const ROUNDS = [
  [
    { name: 'round 2: out north', kind: 'goto', x: 9, z: 3 },
    { name: 'round 2: fill north-west', kind: 'goto', x: 0, z: 4 },
    { name: 'round 2: to the shredder', kind: 'goto', x: 2.6, z: 1, radius: 0.5 },
    { name: 'round 2: stop', kind: 'stop', time: 0.3 },
  ],
  [
    { name: 'round 3: fill north', kind: 'goto', x: 1, z: 7 },
    { name: 'round 3: to the shredder', kind: 'goto', x: 3.5, z: 1.2, radius: 0.5 },
    { name: 'round 3: stop', kind: 'stop', time: 0.3 },
  ],
];

export default async function coreLoop(t) {
  await t.waitFor('!!(window.__zm && window.__zm.shredder && window.__zm.coinHud && window.__zm.ballView)');
  await installAutopilot(t);
  await t.evaluate(PROBES);
  const probe = () => t.evaluate('__loopProbe');
  const state = () => t.evaluate(`({ purse: __zm.purse.total, pending: __zm.coins.pending, shown: __zm.coinHud.shown, handed: __zm.shredder.handedIn,
    swallowed: __zm.shredder.swallowed, shredded: __zm.shredder.shredded, inFlight: __zm.shredder.inFlight, bucket: __zm.bucket.count,
    removed: __zm.balls.removedCount, held: __zm.balls.heldCount, x: __zm.tractor.x, z: __zm.tractor.z, inZone: __zm.shredder.inZone })`);
  /** Waits until everything taken has landed and every coin has arrived. */
  const settleCoins = async (label) => {
    const done = await t.waitFor('__zm.shredder.inFlight === 0 && __zm.coins.pending === 0', 30000).catch(() => false);
    t.check(done, `${label}: every ball landed and every coin arrived`);
    return state();
  };

  // 1. Start: empty purse, the counter shows 0; the UI layering holds with the HUD in it.
  const s0 = await state();
  t.check(s0.purse === 0 && s0.shown === 0 && s0.bucket === 0, `start: purse ${s0.purse}, HUD ${s0.shown}, bucket ${s0.bucket}`);
  await checkUiOnTop(t);
  const hud = await t.evaluate(HUD_ON_SCREEN);
  const { shown } = hud;
  t.log(`coin counter on the page: x ${hud.left.toFixed(0)}..${hud.right.toFixed(0)}, y ${hud.top.toFixed(0)}..${hud.bottom.toFixed(0)} CSS px; ` +
    `the game shows x ${shown.left.toFixed(0)}..${shown.right.toFixed(0)}, y ${shown.top.toFixed(0)}..${shown.bottom.toFixed(0)}; shows "${hud.label}"`);
  if (hud.framed) {
    t.log('the editor preview frames the game larger than the page: the HUD layout is checked on the packed HTML');
  } else {
    t.check(hud.left >= shown.left && hud.right <= shown.right && hud.top >= shown.top && hud.bottom <= shown.bottom, 'the coin counter is fully on screen');
    t.check(shown.right - hud.right < 0.1 * (shown.right - shown.left) && hud.top - shown.top < 0.1 * (shown.bottom - shown.top),
      'the coin counter sits in the top-right corner');
  }

  // 2. Fill up away from the shredder: no hand-in outside the zone.
  await runLegs(t, 'fill', FILL);
  const s1 = await state();
  t.log(`filled: ${s1.bucket} in the bucket at (${s1.x.toFixed(2)}, ${s1.z.toFixed(2)}), purse ${s1.purse}`);
  t.check(s1.bucket === 8 && s1.handed === 0 && s1.purse === 0, 'the bucket filled up to 8 and nothing was sold outside the zone');

  /**
   * Runs the legs; once a load of 5+ balls goes in (a hand-in after the first `after` ones) and has
   * flown ~0.16 s (about the top of the arcs), pauses the game for close-ups between the tractor and
   * the shredder (from above, and low from the side), then lets it go on.
   */
  const runWithArcShots = async (label, legs, after) => {
    await t.evaluate(`__loopProbe.pauseWhen = () => { const h = __loopProbe.handIns.find((x, k) => k >= ${after} && x.count >= 5);
      return !!h && __ap.clock - h.clock >= 0.16 && __zm.shredder.inFlight > 0; }`);
    await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
    const paused = await t.waitFor('__loopProbe.paused || !__ap.running', 90000).then(() => t.evaluate('__loopProbe.paused'));
    t.check(paused, `${label}: paused mid-flight for the close-ups`);
    if (paused) {
      const mid = await t.evaluate(`(() => { const tr = __zm.tractor, s = cc.find('Level/Shredder').worldPosition; return { x: (tr.x + s.x) / 2, z: (tr.z + s.z) / 2 }; })()`);
      await t.evaluate(parkCamera(mid.x, mid.z, 18));
      await t.frames(2);
      await t.shot('arc-top');
      await t.evaluate(SIDE_VIEW);
      await t.frames(2);
      await t.shot('arc-side');
      await t.evaluate(`(() => { __loopProbe.paused = false; __loopProbe.pauseWhen = null; cc.director.resume(); })()`);
      await t.evaluate(RELEASE_CAMERA);
    } else {
      await t.evaluate('__loopProbe.pauseWhen = null');
    }
    await t.waitFor('!__ap.running', 90000);
    const results = await t.evaluate('__ap.results');
    for (const r of results) t.log(`${label} | ${r.name}: ${r.reason} at (${r.x}, ${r.z}) in ${r.t}s, moved ${r.moved}`);
    t.check(results.every((r) => r.ok), `${label}: every leg finished (${results.filter((r) => r.ok).length}/${legs.length})`);
  };

  // 3. Into the zone from the south-west: the whole load goes at once.
  await runLegs(t, 'to the shredder', TO_SHREDDER);
  const s2 = await settleCoins('first load');
  const p2 = await probe();
  const first = p2.handIns[0];
  t.log(`first hand-in: ${first ? `${first.count} of ${first.load} at pivot offset (${first.dx}, ${first.dz})` : 'none'}; ` +
    `then ${s2.handed - (first ? first.count : 0)} more scooped in the zone, ${s2.swallowed} by the throat; purse ${s2.purse}, HUD ${s2.shown}; up to ${p2.maxInFlight} balls in the air`);
  t.check(first && first.count === 8 && first.left === 0, 'the whole load of 8 went in one step');
  t.check(s2.purse === 2 * s2.shredded && s2.shredded === s2.handed + s2.swallowed && s2.purse >= 16, `+2 per ball: ${s2.shredded} balls, purse ${s2.purse} (the load alone: 16)`);
  t.check(s2.shown === s2.purse, `the HUD shows the purse (${s2.shown})`);
  await t.shot('hud-after-first-load');

  // 4. The throat: a full bucket shoves the berm into it from the east, then the load goes in too.
  const before = await state();
  await runLegs(t, 'shove', SHOVE);
  const s3 = await settleCoins('shove');
  const p3 = await probe();
  t.log(`shove: the throat took ${s3.swallowed - before.swallowed} balls (${p3.throatOutside} of all throat balls so far with the tractor outside the zone), ` +
    `hand-ins ${p3.handIns.length}, purse ${before.purse} -> ${s3.purse}`);
  t.check(p3.throatOutside >= 1, `balls shoved into the throat by the full bucket were taken before the tractor reached the zone (${p3.throatOutside})`);
  t.check(s3.purse === 2 * s3.shredded, `every shredded ball paid 2 (${s3.shredded} balls, purse ${s3.purse})`);
  await t.shot('after-shove');

  // 5. Two more rounds. Round 2 comes back from the north-west: its load flies across the camera's
  // view (it looks from +X+Z), so the game pauses mid-flight for close-ups of the arcs.
  for (const [k, legs] of ROUNDS.entries()) {
    const was = await state();
    if (k === 0) await runWithArcShots(`round ${k + 2}`, legs, (await probe()).handIns.length);
    else await runLegs(t, `round ${k + 2}`, legs);
    const now = await settleCoins(`round ${k + 2}`);
    t.log(`round ${k + 2}: handed in ${now.handed - was.handed}, throat ${now.swallowed - was.swallowed}, purse ${was.purse} -> ${now.purse}`);
    t.check(now.handed > was.handed && now.purse > was.purse && now.purse === 2 * now.shredded, `round ${k + 2}: another load sold, 2 per ball`);
  }
  await t.shot('rounds-done');

  // 6. Verdict over every frame and step.
  const fps = await t.evaluate(FPS(2000));
  const p = await probe();
  const end = await state();
  t.log(`over ${p.frames} frames: ${p.handIns.length} hand-ins (${p.handIns.map((h) => h.count).join(', ')}), ${end.handed} + ${end.swallowed} balls shredded, ` +
    `purse ${end.purse}; drawn off ${p.drawnOff.toExponential(1)}; max punch ${p.maxPunch.toFixed(3)}; rollers up to ${p.maxRoller.toFixed(2)} of full speed; fps ${fps.toFixed(1)}`);
  t.check(p.outOfZone === 0, 'a load was taken only while the tractor stood in the zone');
  t.check(p.notWhole === 0, 'every hand-in took the whole load at once');
  t.check(p.shreddedEvents === end.shredded && p.earned === 2 * end.shredded, `events: ballsShredded ${p.shreddedEvents}, coinsEarned ${p.earned}`);
  t.check(p.coinsOff === 0, `after every frame: purse + coins in the air = 2 x shredded ${p.coinsOffAt ? JSON.stringify(p.coinsOffAt) : ''}`);
  t.check(p.hudOff === 0 && p.labelOff === 0, 'after every frame the HUD showed the purse');
  t.check(p.stray === 0, `every held ball was exactly one of carried / flying / shredded ${p.strayAt ? JSON.stringify(p.strayAt) : ''}`);
  t.check(end.held === end.bucket + end.inFlight + end.removed && end.removed === end.shredded, `held ${end.held} = ${end.bucket} carried + ${end.inFlight} flying + ${end.removed} shredded`);
  t.check(p.drawnOff < SYNC_TOLERANCE && p.hiddenWrong === 0, `flying balls drawn where the field has them (worst ${p.drawnOff.toExponential(1)}), shredded ones hidden`);
  t.check(p.maxPunch > 1.1, `the counter swelled when coins arrived (max scale ${p.maxPunch.toFixed(3)})`);
  t.check(p.maxRoller === 1 && p.rollerTurned, 'the rollers spun up to full speed while grinding');
}
