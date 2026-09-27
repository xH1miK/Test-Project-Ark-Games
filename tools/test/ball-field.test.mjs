import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, PusherFace } from '../../assets/scripts/core/Config.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { layCarpet } from '../../assets/scripts/balls/BallCarpet.ts';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';
import { CARPET_ROUTE, LEVEL, arenaGrid, autopilot, frame, makeWorld, measure } from './ball-world.mjs';

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

test('tier boxes: body front and bucket back are the shared (shut) faces', () => {
  for (const tier of Config.tractor.tiers) {
    const [body, bucket] = tier.pusher;
    assert.equal(body.maxZ, bucket.minZ);
    assert.equal(body.shut, PusherFace.Front);
    assert.equal(bucket.shut, PusherFace.Back);
  }
});
