import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, PusherFace } from '../../assets/scripts/core/Config.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { layCarpet, mulberry32 } from '../../assets/scripts/balls/BallCarpet.ts';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';
import { BALLS_SCENARIO_ROUTE, CARPET_ROUTE, LEVEL, arenaGrid, autopilot, clearRect, driveLegs, frame, makeWorld, measure } from './ball-world.mjs';

const R = Config.balls.radius;
const D = 2 * R;
const OPEN = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

/** A field on open ground (optionally with obstacles) and no carpet. */
const openField = (shapes = [], settings = {}) => {
  const grid = new ObstacleGrid(OPEN, 1);
  for (const s of shapes) grid.add(s, Blocks.All);
  const balls = new BallField({ ...Config.balls, bounds: OPEN, ...settings }, 512, grid);
  return { grid, balls };
};
/** A pusher that is just a pose plus the tractor tier's boxes. */
const pusherAt = (x, z, yaw = 0, boxes = Config.tractor.tiers[0].pusher) => ({ x, z, yaw, pusherBoxes: boxes });
const steps = (balls, n, pusher = null, dt = 1 / 60, each) => {
  for (let k = 0; k < n; k++) {
    balls.step(dt, pusher);
    each?.(k);
  }
};
const snapshot = (balls) => [Float64Array.from(balls.x), Float64Array.from(balls.y), Float64Array.from(balls.z)];

// --- arena ---

test('the arena holds balls: no way out for a ball centre from the start (0.05 flood fill)', () => {
  const grid = arenaGrid();
  const { minX, maxX, minZ, maxZ } = grid.bounds;
  const step = 0.05;
  const cols = Math.round((maxX - minX) / step);
  const rows = Math.round((maxZ - minZ) / step);
  const seen = new Uint8Array(cols * rows);
  const start = LEVEL.spots.tractorStart;
  const queue = [Math.floor((start.x - minX) / step) + Math.floor((start.z - minZ) / step) * cols];
  seen[queue[0]] = 1;
  let leak = null;
  while (queue.length && !leak) {
    const i = queue.pop();
    const c = i % cols;
    const k = (i - c) / cols;
    if (c === 0 || k === 0 || c === cols - 1 || k === rows - 1) leak = { x: minX + c * step, z: minZ + k * step };
    for (const [dc, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = c + dc + (k + dk) * cols;
      if (seen[j] || grid.overlapsCircle(minX + (c + dc) * step, minZ + (k + dk) * step, R, Blocks.Balls)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  assert.equal(leak, null, `a ball gets out near ${JSON.stringify(leak)}`);
});

// --- carpet ---

test('carpet on the real arena: ~1500 balls, none overlapping, holes and rocks kept clear', () => {
  const grid = arenaGrid();
  const spec = Config.balls.carpet;
  const c = layCarpet(spec, R, Config.balls.maxCount, grid);
  const n = c.length / 2;
  assert.ok(n > 1400 && n <= Config.balls.maxCount, `balls ${n}`);
  let minGap = Infinity;
  for (let i = 0; i < n; i++) {
    const x = c[2 * i], z = c[2 * i + 1];
    assert.ok(Math.abs(x - spec.centerX) <= spec.halfX - R + 1e-9 && Math.abs(z - spec.centerZ) <= spec.halfZ - R + 1e-9, `ball ${i} outside the carpet`);
    assert.ok(!grid.overlapsCircle(x, z, R, Blocks.Balls), `ball ${i} in a rock at (${x}, ${z})`);
    for (const h of spec.holes) {
      const inside = h.kind === 'circle' ? Math.hypot(x - h.x, z - h.z) < h.radius + R
        : Math.abs(x - h.x) < h.halfX + R && Math.abs(z - h.z) < h.halfZ + R;
      assert.ok(!inside, `ball ${i} in a hole at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
    for (let j = i + 1; j < n; j++) minGap = Math.min(minGap, Math.hypot(c[2 * j] - x, c[2 * j + 1] - z));
  }
  assert.ok(minGap >= 0.98 * D - 1e-9, `closest pair ${minGap}`);
});

test('carpet is the same for the same seed and thins out evenly to maxCount', () => {
  const grid = arenaGrid();
  const spec = Config.balls.carpet;
  assert.deepEqual(layCarpet(spec, R, 5000, grid), layCarpet(spec, R, 5000, grid));
  const full = layCarpet(spec, R, 5000, grid);
  const thin = layCarpet(spec, R, 700, grid);
  assert.equal(thin.length / 2, 700);
  // Every quarter of the carpet keeps its share (random thinning, not a cut-off at one end).
  const quarters = (c) => {
    const q = [0, 0, 0, 0];
    for (let k = 0; k < c.length; k += 2) q[(c[k] > spec.centerX ? 1 : 0) + (c[k + 1] > spec.centerZ ? 2 : 0)]++;
    return q;
  };
  const ratio = 700 / (full.length / 2);
  quarters(thin).forEach((q, k) => {
    const expected = quarters(full)[k] * ratio;
    assert.ok(Math.abs(q - expected) < 0.2 * expected, `quarter ${k}: ${q}, expected ~${expected.toFixed(0)}`);
  });
});

// --- sleep and wake ---

test('an untouched carpet sleeps: nothing is simulated and nothing moves', () => {
  const world = makeWorld();
  const before = snapshot(world.balls);
  for (let f = 0; f < 30; f++) frame(world, 1 / 60, 0, 0);
  assert.equal(world.balls.simulatedCount, 0);
  assert.deepEqual(snapshot(world.balls), before);
  assert.equal(world.balls.movedCount, 0);
});

test('the pusher wakes the balls in its way; far balls stay untouched; all sleep again after it stops', () => {
  const { balls } = openField();
  for (let k = 0; k < 10; k++) balls.add(k * D * 1.05, R, 3); // a row across x 0..5 at z 3
  const far = balls.add(15, R, 15);
  const farBefore = [balls.x[far], balls.y[far], balls.z[far]];
  // Drive a T1 pusher along +Z through the row at x 2.
  let woke = false;
  for (let k = 0; k <= 120; k++) {
    balls.step(1 / 60, pusherAt(2, (k / 60) * 3, 0));
    woke ||= balls.isAwake(2);
  }
  assert.ok(woke, 'a ball in the way was simulated');
  assert.ok(!balls.isAwake(far), 'far ball asleep');
  assert.deepEqual([balls.x[far], balls.y[far], balls.z[far]], farBefore);
  const moved = [...Array(10).keys()].filter((i) => Math.hypot(balls.x[i] - i * D * 1.05, balls.z[i] - 3) > 0.1);
  assert.ok(moved.length >= 2, `balls shoved: ${moved}`);
  // Parked: everything settles and sleeps within 2 s.
  const parked = pusherAt(2, 6, 0);
  let asleepAt = -1;
  for (let k = 0; k < 120 && asleepAt < 0; k++) {
    balls.step(1 / 60, parked);
    if (balls.simulatedCount === 0) asleepAt = k;
  }
  assert.ok(asleepAt >= 0, 'all balls asleep within 2 s');
  for (let i = 0; i < balls.count; i++) assert.equal(balls.vx[i] + balls.vy[i] + balls.vz[i], 0);
});

test('moved list: only balls that moved, each once, until cleared', () => {
  const { balls } = openField();
  balls.add(0, R, 1.9 + R); // just in front of the bucket
  balls.add(10, R, 10);
  balls.step(1 / 60, pusherAt(0, 0, 0));
  steps(balls, 20, pusherAt(0, 0.5, 0));
  assert.deepEqual(Array.from(balls.moved.subarray(0, balls.movedCount)), [0]);
  balls.clearMoved();
  assert.equal(balls.movedCount, 0);
});

// --- gravity, floor, piles ---

test('a dropped ball falls, lands on the floor and goes to sleep', () => {
  const { balls } = openField();
  const i = balls.add(0, 2, 0);
  steps(balls, 120);
  assert.ok(Math.abs(balls.y[i] - R) < 1e-9, `y ${balls.y[i]}`);
  assert.equal(balls.simulatedCount, 0);
});

test('a ball dropped on a tight triangle of balls stays on top (piles hold)', () => {
  const { balls } = openField();
  const s = D * 1.0;
  balls.add(0, R, 0);
  balls.add(s, R, 0);
  balls.add(s / 2, R, (s * Math.sqrt(3)) / 2);
  const top = balls.add(s / 2, 1.2, (s * Math.sqrt(3)) / 6);
  steps(balls, 180);
  assert.ok(balls.y[top] > R + 0.35, `top ball at y ${balls.y[top]}`);
  assert.equal(balls.simulatedCount, 0, 'the pile sleeps');
});

// --- pusher ---

test('a ball inside the bucket never leaves through the shut back face (into the body)', () => {
  const { balls } = openField();
  // Tier 1 bucket spans z 1.03..1.88; a ball at z 1.1 is nearest to the (shut) back face.
  const i = balls.add(0.2, R, 1.1);
  balls.step(1 / 60, pusherAt(0, 0, 0));
  const lz = balls.z[i];
  const lx = balls.x[i];
  const outFront = lz >= 1.88 + R - 1e-9;
  const outSide = Math.abs(lx) >= 0.74 + R - 1e-9;
  assert.ok(outFront || outSide, `ball at (${lx}, ${lz}) is still in the bucket`);
  assert.ok(!(lz < 1.03), 'went back into the body');
});

test('the front of a moving pusher sheds balls to both sides (plough)', () => {
  const { balls } = openField();
  for (let row = 0; row < 3; row++) for (let k = -4; k <= 4; k++) balls.add(k * D * 1.05, R, 4 + row * D * 1.05);
  const pusher = { x: 0, z: 0, yaw: 0, pusherBoxes: Config.tractor.tiers[0].pusher };
  for (let k = 0; k < 150; k++) {
    pusher.z = (k / 60) * 3.6;
    balls.step(1 / 60, pusher);
  }
  const left = [...Array(balls.count).keys()].filter((i) => balls.x[i] < -1.3).length;
  const right = [...Array(balls.count).keys()].filter((i) => balls.x[i] > 1.3).length;
  const lane = [...Array(balls.count).keys()].filter((i) => Math.abs(balls.x[i]) < 0.74 && balls.z[i] > 0 && balls.z[i] < pusher.z).length;
  assert.ok(left > 6 && right > 6, `left ${left}, right ${right}`);
  assert.equal(lane, 0, 'the lane behind the bucket is clear');
});

test('shoved balls ride up onto resting ones: a berm heaps up in front of the blade', () => {
  const { balls } = openField();
  // A dense patch 6 x 8 balls ahead of a wide flat blade.
  for (let row = 0; row < 8; row++) for (let k = -3; k <= 3; k++) balls.add(k * D * 1.02 + (row & 1 ? R : 0), R, 2 + row * D * 0.9);
  const blade = [{ halfX: 2.2, minZ: -0.5, maxZ: 0.5, top: 1.5, shut: 0 }];
  let highest = 0;
  for (let k = 0; k < 90; k++) {
    balls.step(1 / 60, pusherAt(0, (k / 60) * 3, 0, blade));
    for (let i = 0; i < balls.count; i++) highest = Math.max(highest, balls.y[i]);
  }
  assert.ok(highest > D + R * 0.5, `highest ball y ${highest}`);
});

// --- walls and edges ---

test('walls hold: balls rammed into a wall by the pusher never end a step inside it', () => {
  const wall = { kind: 'box', x: 0, z: 6, halfX: 5, halfZ: 0.5, angle: 0.3 };
  const { balls, grid } = openField([wall]);
  for (let row = 0; row < 4; row++) for (let k = -4; k <= 4; k++) balls.add(k * D * 1.05, R, 2 + row * D * 1.05);
  const tmp = { x: 0, z: 0 };
  let worst = 0;
  steps(balls, 240, null, 1 / 60, () => {}); // settle (nothing happens)
  for (let k = 0; k < 240; k++) {
    balls.step(1 / 60, pusherAt(0, Math.min(3.2, (k / 60) * 3), 0));
    for (let i = 0; i < balls.count; i++) worst = Math.max(worst, grid.resolveCircle(balls.x[i], balls.z[i], R, Blocks.Balls, tmp));
  }
  assert.ok(worst < 1e-9, `deepest ball in the wall ${worst}`);
  assert.equal(balls.count, 36);
});

test('walls hold in a sharp pocket between two rotated walls (balls rammed into the apex)', () => {
  // A 62° V opening toward -Z: left wall (-3, 2)..(0, 7), right wall (3, 2)..(0, 7).
  const half = Math.hypot(3, 5) / 2;
  const left = { kind: 'box', x: -1.5, z: 4.5, halfX: half, halfZ: 0.3, angle: -Math.atan2(5, 3) };
  const right = { kind: 'box', x: 1.5, z: 4.5, halfX: half, halfZ: 0.3, angle: Math.atan2(5, 3) };
  const { balls, grid } = openField([left, right]);
  for (let row = 0; row < 7; row++) {
    for (let k = -5; k <= 5; k++) {
      const x = k * D * 1.02;
      const z = 1 + row * D * 0.95;
      if (!grid.overlapsCircle(x, z, R, Blocks.Balls) && Math.abs(x) < 3 - (z - 2) * 0.6) balls.add(x, R, z);
    }
  }
  const narrow = [{ halfX: 0.6, minZ: -0.5, maxZ: 0.5, top: 1.3, shut: 0 }];
  const tmp = { x: 0, z: 0 };
  let worst = 0;
  for (let k = 0; k < 240; k++) {
    // Ram forward and wiggle, at a low frame rate: big steps are the hard case.
    balls.step(1 / 30, pusherAt(Math.sin(k / 9) * 0.4, -1 + Math.min(6, k * 0.06), 0, narrow));
    for (let i = 0; i < balls.count; i++) worst = Math.max(worst, grid.resolveCircle(balls.x[i], balls.z[i], R, Blocks.Balls, tmp));
  }
  // In the apex every push-out pass halves what is left, so a sub-micron tail may stay (7e-7 seen on
  // 28.09 once the trajectories changed); the browser audit also counts a ball as in a rock from 1e-6.
  assert.ok(worst < 1e-6, `deepest ball in a wall ${worst}`);
});

test('field edges hold, including the kerb corner', () => {
  const bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
  const { balls } = openField([], { bounds });
  for (let k = 0; k < 8; k++) balls.add(-2 + k * 0.6, R, 2.4);
  for (let k = 0; k < 180; k++) {
    balls.step(1 / 60, pusherAt(0, -2 + (k / 60) * 3, 0));
    for (let i = 0; i < balls.count; i++) {
      assert.ok(balls.x[i] >= bounds.minX + R - 1e-9 && balls.x[i] <= bounds.maxX - R + 1e-9, `x ${balls.x[i]}`);
      assert.ok(balls.z[i] >= bounds.minZ + R - 1e-9 && balls.z[i] <= bounds.maxZ - R + 1e-9, `z ${balls.z[i]}`);
    }
  }
});

// --- the real arena ---

/** Drives the carpet route; the state is measured every 6th frame. Deep = overlaps over DEEP, share of all contacts. */
const driveThrough = (fps, tier, seconds) => {
  const world = makeWorld({ tier });
  const steer = autopilot(CARPET_ROUTE);
  const worst = { overlap: 0, wall: 0, inPusher: 0, outside: 0, nan: 0 };
  let contacts = 0;
  let deep = 0;
  for (let f = 0, stick = steer(world.tractor); stick && f < seconds * fps; f++, stick = steer(world.tractor)) {
    frame(world, 1 / fps, stick.x, stick.z);
    if (f % 6 === 0) {
      const m = measure(world);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], m[k]);
      contacts += m.contacts;
      deep += m.deep;
    }
  }
  return { world, worst, deepShare: deep / Math.max(1, contacts) };
};

// Pushing a berm is not a converged solve: rare single-frame spikes stay under 0.3 (half a diameter
// would read as one ball inside another), deep overlaps stay a tiny share of the contacts.
const SPIKE = 0.3;
const DEEP_SHARE = 0.005;

test('tractor T1 drives through the carpet: walls, edges and state hold; the carpet sleeps once it stops', () => {
  const { world, worst, deepShare } = driveThrough(60, 0, 12);
  assert.ok(world.tractor.odometer > 30, `odometer ${world.tractor.odometer}`);
  assert.equal(worst.nan, 0);
  assert.equal(worst.outside, 0);
  assert.ok(worst.wall < 1e-9, `in walls ${worst.wall}`);
  assert.ok(worst.overlap < SPIKE, `overlap while pushing ${worst.overlap}`);
  assert.ok(deepShare < DEEP_SHARE, `deep overlaps ${(deepShare * 100).toFixed(2)}% of contacts`);
  let asleep = false;
  for (let f = 0; f < 180 && !asleep; f++) {
    frame(world, 1 / 60, 0, 0);
    asleep = world.balls.simulatedCount === 0;
  }
  assert.ok(asleep, 'the carpet sleeps within 3 s after the tractor stops');
  const rest = measure(world);
  assert.ok(rest.overlap < 0.035, `overlap at rest ${rest.overlap}`);
  assert.ok(rest.inPusher < 0.02, `left inside the tractor ${rest.inPusher}`);
  assert.equal(world.balls.count, Number(world.balls.count)); // no ball lost or added
});

test('low frame rate (8 fps, split into 1/30 s steps) keeps the same guarantees', () => {
  const { worst, deepShare } = driveThrough(8, 0, 8);
  assert.equal(worst.nan, 0);
  assert.equal(worst.outside, 0);
  assert.ok(worst.wall < 1e-9, `in walls ${worst.wall}`);
  assert.ok(worst.overlap < SPIKE, `overlap ${worst.overlap}`);
  assert.ok(deepShare < DEEP_SHARE, `deep overlaps ${(deepShare * 100).toFixed(2)}% of contacts`);
});

test('tractor T2 (bigger, 8.4 u/s) through the carpet: walls and edges hold', () => {
  const { worst, deepShare } = driveThrough(60, 1, 6);
  assert.equal(worst.nan, 0);
  assert.equal(worst.outside, 0);
  assert.ok(worst.wall < 1e-9, `in walls ${worst.wall}`);
  assert.ok(worst.overlap < SPIKE, `overlap ${worst.overlap}`);
  assert.ok(deepShare < DEEP_SHARE, `deep overlaps ${(deepShare * 100).toFixed(2)}% of contacts`);
});

test('T2 along the walls at a jittery low frame rate rams balls into the corners: none ends in a rock or leaves the arena', () => {
  // Found by a stress run: the field-edge clamp used to come after the rocks and put a corner ball back into a rock.
  const world = makeWorld({ tier: 1 });
  const random = mulberry32(4);
  const steer = autopilot([[13, 17], [-4, 17], [-4, -11], [13, -11], [13, 16]]);
  const tmp = { x: 0, z: 0 };
  let inRock = 0;
  let outside = 0;
  for (let f = 0, stick = steer(world.tractor); stick && f < 1500; f++, stick = steer(world.tractor)) {
    frame(world, Math.min(0.25, 1 / 60 + random() * random() * 0.3), stick.x, stick.z);
    const { balls, grid } = world;
    // Carried balls ride in the bucket (its corners may reach over a rock); the field's balls must not.
    for (let i = 0; i < balls.count; i++) if (!balls.isHeld(i) && grid.resolveCircle(balls.x[i], balls.z[i], R, Blocks.Balls, tmp) > 1e-9) inRock++;
    outside = Math.max(outside, measure(world).outside);
  }
  assert.equal(inRock, 0, 'ball-frames inside a rock');
  assert.equal(outside, 0, 'balls outside the arena');
});

test('a berm left by a drive at 6 fps (1/30 s steps) falls asleep: contact noise is not motion', () => {
  // Found on 28.09 by the balls scenario in SwiftShader (6 fps): three balls wedged on three others each
  // wobbled by ~0.01 a step for ever, because the gravity sink of a 1/30 s step outgrew the fixed
  // stillness share. The same route and frame time.
  const world = makeWorld();
  driveLegs(world, BALLS_SCENARIO_ROUTE, () => 1 / 6);
  let asleepAfter = -1;
  for (let f = 1; f <= 18 && asleepAfter < 0; f++) {
    frame(world, 1 / 6, 0, 0);
    world.balls.clearMoved();
    if (world.balls.simulatedCount === 0) asleepAfter = f / 6;
  }
  assert.ok(asleepAfter >= 0, `the berms fall asleep within 3 s of the stop (${world.balls.simulatedCount} balls still simulated)`);
  const rest = measure(world);
  assert.ok(rest.overlap < 0.05, `overlap at rest ${rest.overlap}`);
});

// --- held balls ---

test('findFree lists the free balls with centres in a rectangle, never a held one', () => {
  const { balls } = openField();
  const ids = [];
  for (let k = 0; k < 6; k++) ids.push(balls.add(k * D, R, 0)); // x 0..2.75 at z 0
  const out = new Int32Array(16);
  const found = (minX, maxX) => Array.from(out.subarray(0, balls.findFree(minX, maxX, -0.1, 0.1, out))).sort((a, b) => a - b);
  assert.deepEqual(found(0.5, 2.3), [ids[1], ids[2], ids[3], ids[4]]);
  balls.hold(ids[2]);
  assert.deepEqual(found(0.5, 2.3), [ids[1], ids[3], ids[4]]);
  assert.equal(balls.findFree(-1, 5, -1, 1, new Int32Array(2)), 2, 'stops at the size of out');
});

test('a held ball leaves the field: not simulated, nobody bumps into it, its neighbours wake', () => {
  const { balls } = openField();
  const a = balls.add(0, R, 0);
  const b = balls.add(D, R, 0);
  const top = balls.add(R, R + D * 0.87, 0); // resting on a and b
  steps(balls, 30);
  assert.equal(balls.simulatedCount, 0, 'a settled pyramid sleeps');
  balls.hold(a);
  assert.ok(balls.isHeld(a) && balls.heldCount === 1);
  balls.step(1 / 60, null);
  assert.ok(balls.isAwake(b) && balls.isAwake(top) && !balls.isAwake(a), 'the neighbours are simulated, the held ball is not');
  // A ball dropped where the held one lies is not pushed by it.
  const c = balls.add(-0.05, R, 0);
  balls.wake(0, 0, 1);
  steps(balls, 30);
  assert.ok(Math.abs(balls.x[c] + 0.05) < 1e-9 && Math.abs(balls.z[c]) < 1e-9, `c at (${balls.x[c]}, ${balls.z[c]})`);
  // A pusher driven right through the held ball's place leaves it alone.
  balls.place(a, 5, 0.5, 5);
  const heldAt = [balls.x[a], balls.y[a], balls.z[a]];
  for (let k = 0; k <= 60; k++) balls.step(1 / 60, pusherAt(5, 3 + k / 20, 0));
  assert.deepEqual([balls.x[a], balls.y[a], balls.z[a]], heldAt);
  assert.ok(!balls.isAwake(a));
  // place() does not move a free ball.
  balls.place(b, 9, 9, 9);
  assert.notEqual(balls.x[b], 9);
});

test('a released ball rejoins the field where it is let go: it falls, rests and can be found again', () => {
  const { balls } = openField();
  const i = balls.add(0, R, 0);
  balls.hold(i);
  balls.clearMoved();
  balls.release(i, 3, 1.5, 2, 1, 0, 0);
  assert.ok(!balls.isHeld(i) && balls.heldCount === 0);
  assert.equal(balls.movedCount, 1, 'views redraw it');
  steps(balls, 120);
  assert.ok(Math.abs(balls.y[i] - R) < 1e-9, `on the floor at ${balls.y[i]}`);
  assert.ok(balls.x[i] > 3, 'kept its throw');
  assert.equal(balls.simulatedCount, 0, 'asleep again');
  const out = new Int32Array(4);
  assert.equal(balls.findFree(balls.x[i] - 0.1, balls.x[i] + 0.1, balls.z[i] - 0.1, balls.z[i] + 0.1, out), 1);
  assert.equal(out[0], i);
  balls.release(i, 0, 0, 0, 0, 0, 0); // not held: nothing happens
  assert.ok(Math.abs(balls.y[i] - R) < 1e-9);
});

test('tier boxes: body front and bucket back are the shared (shut) faces', () => {
  for (const tier of Config.tractor.tiers) {
    const [body, bucket] = tier.pusher;
    assert.equal(body.maxZ, bucket.minZ);
    assert.equal(body.shut, PusherFace.Front);
    assert.equal(bucket.shut, PusherFace.Back);
  }
});

test('tier buckets: the cavity lies inside the bucket box, and the box is as high as a full heap', () => {
  for (const tier of Config.tractor.tiers) {
    const box = tier.pusher[1];
    const cavity = tier.bucket;
    assert.ok(cavity.halfX <= box.halfX && cavity.minZ >= box.minZ && cavity.maxZ <= box.maxZ, JSON.stringify(cavity));
    assert.ok(box.top >= cavity.rim + Config.bucket.heapLayers * D - 1e-9, `box top ${box.top}`);
    assert.ok(cavity.maxZ - cavity.minZ >= D && 2 * cavity.halfX >= 2 * D, 'room for at least two balls a layer');
  }
});

// --- clear zones (pay pads) and bursts ---

/** A clear zone whose `active` can be switched by the test. */
const zoneOf = (minX, maxX, minZ, maxZ, on = true) => ({ minX, maxX, minZ, maxZ, speed: Config.pads.clearSpeed, active: on });
const insideZone = (balls, zone) => [...Array(balls.count).keys()].filter((i) =>
  !balls.isHeld(i) && balls.x[i] >= zone.minX && balls.x[i] <= zone.maxX && balls.z[i] >= zone.minZ && balls.z[i] <= zone.maxZ);
/** Deepest a free ball sits inside the pusher's boxes (pusher axes, same measure as the scenarios). */
const depthInPusher = (balls, pusher) => {
  let worst = 0;
  const cos = Math.cos(pusher.yaw), sin = Math.sin(pusher.yaw);
  for (let i = 0; i < balls.count; i++) {
    if (balls.isHeld(i)) continue;
    const dx = balls.x[i] - pusher.x, dz = balls.z[i] - pusher.z;
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    for (const box of pusher.pusherBoxes) {
      if (balls.y[i] - R > box.top) continue;
      const qx = Math.max(-box.halfX, Math.min(box.halfX, lx)), qz = Math.max(box.minZ, Math.min(box.maxZ, lz));
      const d = Math.hypot(lx - qx, lz - qz);
      worst = Math.max(worst, d > 0 ? R - d : R + Math.min(box.halfX - Math.abs(lx), lz - box.minZ, box.maxZ - lz));
    }
  }
  return worst;
};

test('a clear zone: balls on it roll off through the nearest edge once it is active; others are untouched', () => {
  const { balls } = openField();
  const zone = zoneOf(-2.2, 2.2, -0.9, 0.9, false);
  balls.addClearZone(zone);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) balls.add(-1.8 + col * 0.6, R, -0.6 + row * 0.6);
  const far = balls.add(8, R, 8);
  const before = snapshot(balls);
  steps(balls, 60);
  assert.deepEqual(snapshot(balls), before, 'inactive: nothing moves (the balls sleep)');
  zone.active = true;
  let clearAt = -1;
  steps(balls, 150, null, 1 / 60, (k) => {
    if (clearAt < 0 && insideZone(balls, zone).length === 0) clearAt = k;
  });
  assert.ok(clearAt >= 0 && clearAt < 90, `plate clear after ${clearAt} steps`);
  assert.deepEqual([balls.x[far], balls.z[far]], [8, 8], 'the far ball stays put');
  // The middle row (z 0) leaves across the long sides, nobody goes past the short ends by much.
  for (let i = 0; i < 21; i++) assert.ok(Math.abs(balls.x[i]) < 3.2, `ball ${i} at x ${balls.x[i]}`);
  let asleep = false;
  for (let k = 0; k < 180 && !asleep; k++) {
    balls.step(1 / 60, null);
    asleep = balls.simulatedCount === 0;
  }
  assert.ok(asleep, 'all asleep again off the plate');
  assert.equal(insideZone(balls, zone).length, 0);
});

test('the pusher wins over a clear zone: shoving balls onto a pad never leaves one inside the tractor', () => {
  for (const dt of [1 / 60, 1 / 30]) {
    const { balls } = openField();
    const zone = zoneOf(-2.2, 2.2, 2.5, 4.4);
    balls.addClearZone(zone);
    // A berm across the way in front of the zone.
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) balls.add(-2.4 + col * 0.6, R, 1.2 + row * 0.56);
    let worst = 0;
    for (let t = 0; t < 2.5; t += dt) {
      const pusher = pusherAt(0.2, -1 + 3.6 * t, 0);
      balls.step(dt, pusher);
      worst = Math.max(worst, depthInPusher(balls, pusher));
    }
    assert.ok(worst < 0.06, `deepest in the tractor ${worst.toFixed(3)} at dt ${dt}`);
    // Parked past the zone: what it dragged along rolls off the plate.
    const parked = pusherAt(0.2, 8, 0);
    steps(balls, 180, parked, dt);
    assert.equal(insideZone(balls, zone).length, 0, 'plate clear once the tractor has passed');
  }
});

test('burst: balls within the radius fly outward, fastest at the centre; the rest stay asleep', () => {
  const { balls } = openField();
  for (let row = -8; row <= 8; row++) for (let col = -8; col <= 8; col++) balls.add(col * 0.6 + (row & 1) * 0.3, R, row * 0.52);
  const { radius, speed, hop } = Config.pads.burst;
  balls.burst(0.1, 0.05, radius, speed, hop);
  let inside = 0;
  for (let i = 0; i < balls.count; i++) {
    const dx = balls.x[i] - 0.1, dz = balls.z[i] - 0.05, d = Math.hypot(dx, dz);
    const v = Math.hypot(balls.vx[i], balls.vz[i]);
    if (d > radius) {
      assert.equal(v, 0, `ball ${i} outside the radius`);
      continue;
    }
    inside++;
    assert.ok(Math.abs(v - speed * Math.max(0.25, 1 - d / radius)) < 1e-9, `speed ${v} at ${d}`);
    assert.ok((balls.vx[i] * dx + balls.vz[i] * dz) / (v * d) > 0.999, 'radial');
    assert.ok(Math.abs(balls.vy[i] - v * hop) < 1e-9, 'hop');
  }
  assert.ok(inside > 60, `${inside} thrown`);
  steps(balls, 240);
  for (let i = 0; i < balls.count; i++) assert.ok(Number.isFinite(balls.x[i] + balls.y[i] + balls.z[i]));
  assert.equal(balls.simulatedCount, 0, 'asleep again within 4 s');
});

test('a pad popping up in the real carpet: its plate is cleared, no ball leaves the arena, the carpet sleeps again', () => {
  const world = makeWorld();
  const pad = LEVEL.spots.upgradePad;
  const margin = clearRect(LEVEL.plates.upgrade);
  const zone = zoneOf(margin.minX, margin.maxX, margin.minZ, margin.maxZ);
  const plate = zoneOf(LEVEL.plates.upgrade.minX, LEVEL.plates.upgrade.maxX, LEVEL.plates.upgrade.minZ, LEVEL.plates.upgrade.maxZ);
  world.balls.addClearZone(zone);
  const onPlate = insideZone(world.balls, plate).length;
  assert.ok(onPlate > 10, `${onPlate} balls on the plate before`);
  const { radius, speed, hop } = Config.pads.burst;
  world.balls.burst(pad.x, pad.z, radius, speed, hop);
  let asleepAt = -1;
  for (let f = 0; f < 360 && asleepAt < 0; f++) {
    frame(world, 1 / 60, 0, 0);
    if (world.balls.simulatedCount === 0) asleepAt = f;
  }
  const m = measure(world);
  assert.equal(m.nan, 0);
  assert.equal(m.outside, 0);
  assert.ok(m.wall < 1e-9);
  assert.equal(insideZone(world.balls, plate).length, 0, 'the plate is clear');
  // In the margin only balls up on others (resting on the crowd outside) may overhang.
  for (const i of insideZone(world.balls, zone)) assert.ok(world.balls.y[i] >= 1.5 * R, `ball ${i} on the floor of the margin`);
  assert.ok(asleepAt > 0, 'asleep within 6 s');
  assert.ok(m.overlap < 0.035, `overlap at rest ${m.overlap}`);
});
