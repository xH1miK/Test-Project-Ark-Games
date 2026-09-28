// Bucket check (M5). From the start spot the tractor drives into the carpet: the bucket takes balls
// one at a time (a ballScooped event each) up to its capacity (8), then takes no more, and the full
// bucket pushes like a blade: no free ball ever ends a frame inside the tractor's boxes. The load
// rides along through drives, sharp turns and spins on the spot: every carried ball stays inside the
// cavity (give or take the slack it is still being drawn in by), stays held, and is drawn where the
// field has it. The pile falls asleep and a parked tractor with a full bucket uploads nothing; the
// carried balls turn with the tractor's heading (not with its way). Shots: filling (the game paused
// mid-scoop), full at play distance, close-ups from the camera's side, facing it, in profile and
// mid-spin.
//
//   node tools/check-html.mjs <html|url> --scenario scoop [--gpu]

import { installAutopilot, runLegs } from './lib/autopilot.mjs';
import { FPS, RELEASE_CAMERA, parkCamera as placeCamera } from './lib/camera.mjs';

/** A free ball may end a frame this deep in the tractor's boxes (a box shoves it out within the step). */
const IN_BOX_TOLERANCE = 0.06;
/** Drawn centres are float32 copies of the field's doubles. */
const SYNC_TOLERANCE = 1e-5;

/** Checks after every frame; `pauseWhen` (set by the scenario) pauses the game for a shot. */
const PROBES = `(() => {
  if (window.__scoopProbe) return 'already';
  const zm = window.__zm, b = zm.balls, bucket = zm.bucket, tr = zm.tractor, view = zm.ballView, r = zm.config.balls.radius;
  const p = window.__scoopProbe = { frames: 0, scooped: [], overCapacity: 0, inBox: 0, inBoxAt: null, loadOut: 0, notHeld: 0,
    drawnOff: 0, strayHeld: 0, pauseWhen: null, paused: false };
  zm.events.on('ballScooped', (e) => p.scooped.push({ carried: e.carried, capacity: e.capacity, frame: p.frames }));
  const drawn = { x: 0, y: 0, z: 0, radius: 0 };
  // EVENT_AFTER_UPDATE comes after lateUpdate: the ball view has drawn this frame by then.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    p.frames++;
    const load = bucket.load, s = load.shape, n = load.count;
    if (n > load.capacity) p.overCapacity++;
    const c = Math.cos(tr.yaw), sn = Math.sin(tr.yaw);
    for (let i = 0; i < b.count; i++) {
      if (b.isHeld(i)) continue;
      const dx = b.x[i] - tr.x, dz = b.z[i] - tr.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      for (const box of tr.pusherBoxes) {
        if (b.y[i] - r > box.top || Math.abs(lx) > box.halfX + r || lz < box.minZ - r || lz > box.maxZ + r) continue;
        const qx = Math.max(-box.halfX, Math.min(box.halfX, lx)), qz = Math.max(box.minZ, Math.min(box.maxZ, lz));
        const d = Math.hypot(lx - qx, lz - qz);
        const depth = d > 0 ? r - d : r + Math.min(box.halfX - Math.abs(lx), lz - box.minZ, box.maxZ - lz);
        if (depth > p.inBox) p.inBoxAt = { frame: p.frames, ball: i, lx: +lx.toFixed(3), lz: +lz.toFixed(3), y: +b.y[i].toFixed(3), full: bucket.full };
        p.inBox = Math.max(p.inBox, depth);
      }
    }
    for (let k = 0; k < n; k++) {
      const breach = Math.max(s.floor + r - load.y[k], Math.abs(load.x[k]) - (s.halfX - r), s.minZ + r - load.z[k], load.z[k] - (s.maxZ - r));
      p.loadOut = Math.max(p.loadOut, breach - load.slack[k]);
      const i = load.index[k];
      if (!b.isHeld(i)) p.notHeld++;
      view.data.readBall(i, drawn);
      p.drawnOff = Math.max(p.drawnOff, Math.abs(drawn.x - b.x[i]), Math.abs(drawn.y - b.y[i]), Math.abs(drawn.z - b.z[i]));
    }
    // Held = carried + flying into the shredder + shredded (the route keeps clear of the shredder anyway).
    if (b.heldCount !== n + zm.shredder.inFlight + b.removedCount) p.strayHeld++;
    if (p.pauseWhen && p.pauseWhen()) {
      p.pauseWhen = null;
      p.paused = true;
      cc.director.pause(); // logic stops, rendering goes on
    }
  });
  return 'installed';
})()`;

/** Where the bucket's middle is on the ground (world XZ). */
const BUCKET_MIDDLE = `(() => { const tr = __zm.tractor, s = __zm.bucket.load.shape, m = (s.minZ + s.maxZ) / 2;
  return { x: tr.x + Math.sin(tr.yaw) * m, z: tr.z + Math.cos(tr.yaw) * m }; })()`;

/** Orientation quaternions of the carried balls, the tractor's heading and whether the pile sleeps. */
const SPIN_SNAP = `(() => { const d = __zm.ballView.data, bk = __zm.bucket, n = bk.count, spins = [];
  for (let k = 0; k < n; k++) { const i = bk.index[k]; spins.push(Array.from(d.spin.subarray(4 * i, 4 * i + 4))); }
  return { yaw: __zm.tractor.yaw, spins, settling: bk.load.settling }; })()`;

/** v turned by the unit quaternion q = [x, y, z, w]. */
const rotate = (q, v) => {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
};
/** v turned about +Y by `a` (the tractor's heading convention: +Z goes to (sin a, cos a)). */
const turnY = (a, v) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];

// From the start spot (9, -11, facing +Z) west into the strip of carpet north of the gate apron.
const INTO = [{ name: 'into the carpet', kind: 'goto', x: 3, z: -11 }];
// With a full bucket through the thick of the carpet, clear of the shredder's hand-in zone
// (|dx|, |dz| <= 3.5 around (5.75, -1.85): the bucket would be emptied there).
const FULL_THROUGH = [
  { name: 'full: west', kind: 'goto', x: 3, z: -9 },
  { name: 'full: south-west', kind: 'goto', x: 1, z: -7 },
  { name: 'full: north', kind: 'goto', x: 1, z: 2 },
  { name: 'full: east', kind: 'goto', x: 9, z: 5 },
  { name: 'full: north-east', kind: 'goto', x: 12, z: 8 },
];
// Sharp turns: a zigzag with short legs.
const ZIGZAG = [
  { name: 'zig', kind: 'goto', x: 9, z: 7, radius: 0.5 },
  { name: 'zag', kind: 'goto', x: 11, z: 9, radius: 0.5 },
  { name: 'zig 2', kind: 'goto', x: 8, z: 10, radius: 0.5 },
  { name: 'stop', kind: 'stop', time: 0.3 },
];

export default async function scoop(t) {
  await t.waitFor('!!(window.__zm && window.__zm.bucket && window.__zm.ballView)');
  await installAutopilot(t);
  await t.evaluate(PROBES);
  const probe = () => t.evaluate('__scoopProbe');
  const state = () => t.evaluate(`({ count: __zm.bucket.count, capacity: __zm.bucket.capacity, held: __zm.balls.heldCount,
    settling: __zm.bucket.load.settling, simulated: __zm.balls.simulatedCount, uploads: __zm.ballView.uploadCount,
    x: __zm.tractor.x, z: __zm.tractor.z, yaw: __zm.tractor.yaw })`);
  /** Pauses the game when `condition` holds, parks the camera on the bucket and takes the shots. */
  const pausedShots = async (condition, shots) => {
    await t.evaluate(`__scoopProbe.pauseWhen = () => ${condition}`);
    await t.waitFor('__scoopProbe.paused || !__ap.running', 60000);
    if (!(await t.evaluate('__scoopProbe.paused'))) return false;
    const mid = await t.evaluate(BUCKET_MIDDLE);
    for (const [name, fov] of shots) {
      await t.evaluate(placeCamera(mid.x, mid.z, fov));
      await t.frames(2);
      await t.shot(name);
    }
    await t.evaluate(`(() => { __scoopProbe.paused = false; cc.director.resume(); })()`);
    await t.evaluate(RELEASE_CAMERA);
    return true;
  };
  const closeOnBucket = async (name, fov = 12) => {
    const mid = await t.evaluate(BUCKET_MIDDLE);
    await t.evaluate(placeCamera(mid.x, mid.z, fov));
    await t.frames(3);
    await t.shot(name);
    await t.evaluate(RELEASE_CAMERA);
    await t.frames(2);
  };
  const settle = async (label) => {
    const asleep = await t.waitFor('!__zm.bucket.load.settling && __zm.balls.simulatedCount === 0', 30000).catch(() => false);
    t.check(asleep, `${label}: the load and the carpet fall asleep after the stop`);
  };

  // 1. Start: an empty bucket.
  const s0 = await state();
  t.check(s0.count === 0 && s0.held === 0 && s0.capacity === 8, `empty T1 bucket at start (${s0.count}/${s0.capacity})`);

  // 2. Into the carpet; the game pauses mid-scoop for a close-up.
  await t.evaluate(`__ap.run(${JSON.stringify(INTO)})`);
  const pausedMidScoop = await pausedShots('__zm.bucket.count >= 4', [['scoop-filling', 12]]);
  t.check(pausedMidScoop, 'paused mid-scoop for the close-up');
  await t.waitFor('!__ap.running', 60000);
  const filled = await state();
  const p1 = await probe();
  const fill = p1.scooped.map((e) => e.carried).join(',');
  t.log(`into the carpet: ${filled.count}/${filled.capacity} carried, events ${fill}, over ${p1.scooped.length ? p1.scooped[p1.scooped.length - 1].frame - p1.scooped[0].frame : 0} frames; tractor at (${filled.x.toFixed(2)}, ${filled.z.toFixed(2)})`);
  t.check(filled.count === 8 && filled.held === 8, `the bucket filled up to its capacity (${filled.count}/8, ${filled.held} held)`);
  t.check(fill === '1,2,3,4,5,6,7,8' && p1.scooped.every((e) => e.capacity === 8), 'one ballScooped event per ball, counting up to 8');

  // 3. The load on clean ground (the empty start circle): close-ups from the camera's side, facing
  // it and in profile. Turning the parked tractor turns every carried ball by as much about the
  // vertical (the asleep pile does not move inside the bucket, so nothing rolls).
  await runLegs(t, 'show', [{ name: 'back to the start circle', kind: 'goto', x: 9.6, z: -10.6, radius: 0.5 }, { name: 'stop', kind: 'stop', time: 0.3 }]);
  await settle('on clean ground');
  await t.shot('scoop-full-play');
  await closeOnBucket('scoop-full-close', 12);
  const q0 = await t.evaluate(SPIN_SNAP);
  const here = await state();
  // Facing the camera (it looks from +X+Z): the open side of the bucket toward the viewer.
  await runLegs(t, 'show', [{ name: 'face the camera', kind: 'goto', x: here.x + 1.2, z: here.z + 1.2, radius: 0.4 }, { name: 'stop', kind: 'stop', time: 0.3 }]);
  const q1 = await t.evaluate(SPIN_SNAP);
  let worstTurn = 0;
  const dyaw = q1.yaw - q0.yaw;
  q0.spins.forEach((q, k) => {
    for (const axis of [[1, 0, 0], [0, 1, 0]]) {
      const want = turnY(dyaw, rotate(q, axis));
      const got = rotate(q1.spins[k], axis);
      worstTurn = Math.max(worstTurn, Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]));
    }
  });
  t.log(`the tractor turned by ${(dyaw * 180 / Math.PI).toFixed(1)}°; carried balls' axes off the same turn by ${worstTurn.toExponential(1)} at most; pile ${q1.settling ? 'settling' : 'asleep'}`);
  t.check(!q0.settling && !q1.settling && Math.abs(dyaw) > 0.3 && worstTurn < 1e-3, 'every carried ball turned with the tractor, and only by its turn');
  await closeOnBucket('scoop-facing-camera', 11);
  // In profile: facing +X-Z, across the view.
  const there = await state();
  await runLegs(t, 'show', [{ name: 'profile', kind: 'goto', x: there.x + 1.2, z: there.z - 1.2, radius: 0.4 }, { name: 'stop', kind: 'stop', time: 0.3 }]);
  await closeOnBucket('scoop-profile', 12);

  // 4. Full: back into the thick of the carpet; nothing more is taken, balls are pushed aside.
  const before = await t.evaluate('Array.from(__zm.balls.x).map((x, i) => [x, __zm.balls.z[i]])');
  await runLegs(t, 'full', FULL_THROUGH);
  const after = await t.evaluate('Array.from(__zm.balls.x).map((x, i) => [x, __zm.balls.z[i]])');
  const shoved = after.filter(([x, z], i) => Math.hypot(x - before[i][0], z - before[i][1]) > 0.3).length;
  const s3 = await state();
  const p3 = await probe();
  t.log(`full bucket through the carpet: ${shoved} balls shoved more than 0.3, ${s3.count} carried, ${p3.scooped.length} scoops in all`);
  t.check(s3.count === 8 && p3.scooped.length === 8, 'a full bucket takes no more');
  t.check(shoved > 50, `the full bucket pushes the carpet aside like a blade (${shoved} balls moved)`);
  await t.shot('scoop-full-plough');

  // 5. Sharp turns and spins on the spot, then one close-up mid-spin.
  await runLegs(t, 'turns', ZIGZAG);
  for (const [label, sign] of [['spin left', 1], ['spin right', -1]]) {
    const yaw = (await state()).yaw;
    // A command behind the tractor turns it on the spot (tank-like), then it drives off.
    const back = { name: label, kind: 'push', dx: -Math.sin(yaw) + sign * 0.25 * Math.cos(yaw), dz: -Math.cos(yaw) - sign * 0.25 * Math.sin(yaw), time: 1.2 };
    if (sign > 0) {
      await t.evaluate(`__ap.run(${JSON.stringify([back])})`);
      await pausedShots(`__ap.t > 0.45`, [['scoop-spinning', 14]]);
      await t.waitFor('!__ap.running', 60000);
    } else {
      await runLegs(t, 'turns', [back]);
    }
  }
  await runLegs(t, 'turns', [{ name: 'stop', kind: 'stop', time: 0.3 }]);

  // 6. At rest: the pile sleeps, a parked tractor with a full bucket uploads nothing.
  await settle('after the turns');
  const idle = (await state()).uploads;
  await t.frames(30);
  t.check((await state()).uploads === idle, 'a parked tractor with a full, asleep bucket uploads nothing (30 frames)');

  // 7. FPS with a full bucket (the load is one more path into the same buffer).
  const fps = await t.evaluate(FPS(2000));
  t.log(`fps with a full bucket, parked: ${fps.toFixed(1)}`);

  // 8. Verdict over every frame.
  const p = await probe();
  t.log(`over ${p.frames} frames: free balls at most ${p.inBox.toFixed(4)} into the tractor ${p.inBoxAt ? JSON.stringify(p.inBoxAt) : ''}; ` +
    `load outside its cavity ${p.loadOut.toExponential(1)}, drawn off the field ${p.drawnOff.toExponential(1)}`);
  t.check(p.overCapacity === 0, 'the load never exceeded the capacity');
  t.check(p.inBox <= IN_BOX_TOLERANCE, `no free ball passed into the tractor (deepest ${p.inBox.toFixed(4)} ≤ ${IN_BOX_TOLERANCE})`);
  t.check(p.loadOut < 1e-6, 'every carried ball stayed inside the bucket (walls, floor; the lip while being drawn in)');
  t.check(p.notHeld === 0 && p.strayHeld === 0, 'the carried balls are exactly the held ones');
  t.check(p.drawnOff < SYNC_TOLERANCE, `every carried ball was drawn where the field has it, every frame (worst ${p.drawnOff.toExponential(1)})`);
}
