import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { Bucket } from '../../assets/scripts/tractor/Bucket.ts';
import { ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';
import { BUCKET_SETTINGS, BUCKET_SLOTS, autopilot, frame, makeWorld, measure, measureLoad } from './ball-world.mjs';

const R = Config.balls.radius;
const [T1, T2] = Config.tractor.tiers;
const OPEN = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

/** Drives waypoints (or a fixed stick for `seconds`) at `fps`; `each(world)` after every frame. */
const drive = (world, route, { fps = 60, most = 30, each } = {}) => {
  const steer = autopilot(route, 0.5);
  let frames = 0;
  for (let stick = steer(world.tractor); stick && frames < most * fps; stick = steer(world.tractor), frames++) {
    frame(world, 1 / fps, stick.x, stick.z);
    each?.(world);
  }
  return frames;
};
const hold = (world, x, z, seconds, { fps = 60, each } = {}) => {
  for (let f = 0; f < seconds * fps; f++) {
    frame(world, 1 / fps, x, z);
    each?.(world);
  }
};
/** A tractor stand-in: a pose and a tier (the bucket reads nothing else). */
const carrier = (x, z, yaw = 0, tier = T1, speed = 0) => ({
  x, z, yaw, speed, get bucketShape() { return this.tier.bucket; }, get bucketCapacity() { return this.tier.bucketCapacity; }, tier,
});
/** Open ground, no rocks: a field, a stand-in tractor and its bucket. */
const openBucket = (pose = carrier(0, 0)) => {
  const balls = new BallField({ ...Config.balls, bounds: OPEN }, 256, new ObstacleGrid(OPEN, 1));
  const bucket = new Bucket(BUCKET_SETTINGS, balls, pose, BUCKET_SLOTS);
  return { balls, bucket, pose };
};
/** A world point in the pose's axes. */
const at = (pose, lx, lz) => ({ x: pose.x + lx * Math.cos(pose.yaw) + lz * Math.sin(pose.yaw), z: pose.z - lx * Math.sin(pose.yaw) + lz * Math.cos(pose.yaw) });

// Into the carpet from the start spot (9, -11): west through the strip north of the gate apron, then
// up the east side, across and back (every leg through balls).
const INTO_CARPET = [[3, -11]];
const THROUGH_CARPET = [[3, -11], [2, -5], [8, -3], [12, 4], [2, 6]];

test('T1 scoops up to 8 and takes no more; every scoop is announced', () => {
  const events = new EventBus();
  const heard = [];
  events.on('ballScooped', (e) => heard.push(e));
  const world = makeWorld({ events });
  drive(world, INTO_CARPET);
  assert.equal(world.bucket.count, 8);
  assert.equal(world.balls.heldCount, 8, 'the field holds exactly the carried balls out');
  assert.deepEqual(heard.map((e) => e.carried), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(heard.every((e) => e.capacity === 8));
  drive(world, THROUGH_CARPET.slice(1));
  assert.equal(world.bucket.count, 8, 'a full bucket takes nothing more');
  assert.equal(heard.length, 8);
});

test('a full bucket pushes like a blade: nothing passes into it, the berm grows in front', () => {
  const world = makeWorld();
  drive(world, INTO_CARPET);
  assert.ok(world.bucket.full);
  let inPusher = 0;
  let load = { outside: 0, placed: 0, notHeld: 0 };
  drive(world, THROUGH_CARPET.slice(1), {
    each: (w) => {
      inPusher = Math.max(inPusher, measure(w).inPusher);
      const m = measureLoad(w);
      load = { outside: Math.max(load.outside, m.outside), placed: Math.max(load.placed, m.placed), notHeld: Math.max(load.notHeld, m.notHeld) };
    },
  });
  // A ball the box shoves out stays within a step's travel of its face (M3 limit for the moving tractor).
  assert.ok(inPusher < 0.2, `a free ball got ${inPusher.toFixed(3)} into the tractor`);
  assert.ok(load.outside < 1e-9 && load.placed < 1e-9 && load.notHeld === 0, `load ${JSON.stringify(load)}`);
  // Parked: nothing is left inside the tractor's boxes.
  hold(world, 0, 0, 2);
  assert.ok(measure(world).inPusher < 0.02, `left inside the tractor ${measure(world).inPusher}`);
});

test('the load rides in the bucket through turns, spins on the spot and a low frame rate', () => {
  for (const fps of [60, 30, 8]) {
    const world = makeWorld();
    const worst = { outside: 0, placed: 0, lowest: Infinity, overlap: 0 };
    const each = (w) => {
      const m = measureLoad(w);
      worst.outside = Math.max(worst.outside, m.outside);
      worst.placed = Math.max(worst.placed, m.placed);
      if (m.count) worst.lowest = Math.min(worst.lowest, m.lowest);
      worst.overlap = Math.max(worst.overlap, m.overlap);
    };
    drive(world, THROUGH_CARPET, { fps, each });
    // Spin on the spot both ways (a command straight behind turns a tank in place).
    const back = (sign) => [-Math.sin(world.tractor.yaw) + sign * 0.2, -Math.cos(world.tractor.yaw)];
    hold(world, ...back(1), 1.5, { fps, each });
    hold(world, ...back(-1), 1.5, { fps, each });
    assert.equal(world.bucket.count, 8, `fps ${fps}`);
    assert.ok(worst.outside < 1e-9, `fps ${fps}: a carried ball ${worst.outside} outside the bucket`);
    assert.ok(worst.lowest >= T1.bucket.floor + R - 1e-9, `fps ${fps}: a carried ball sank to ${worst.lowest}`);
    assert.ok(worst.placed < 1e-9, `fps ${fps}: the field lost track of a carried ball by ${worst.placed}`);
    // A settled load keeps its squeeze (contactSlop); a ball dropping into a full layer may jam for a frame or two.
    assert.ok(worst.overlap < Config.bucket.contactSlop * 2 * R + 0.2, `fps ${fps}: carried balls overlap by ${worst.overlap}`);
  }
});

test('the pile sleeps: once settled it keeps its place in the bucket while the tractor drives', () => {
  const world = makeWorld();
  drive(world, INTO_CARPET);
  // Out of the carpet into the empty start circle, then around it.
  drive(world, [[7, -11]]);
  const load = world.bucket.load;
  let t = 0;
  while (load.settling && t < 3) {
    frame(world, 1 / 60, 0, 0);
    t += 1 / 60;
  }
  assert.ok(!load.settling, 'asleep');
  const local = [Float64Array.from(load.x), Float64Array.from(load.y), Float64Array.from(load.z)];
  world.bucket.clearMoved();
  drive(world, [[10, -9], [9, -12]], {
    each: (w) => {
      assert.ok(w.bucket.moved, 'moved with the tractor');
      w.bucket.clearMoved();
    },
  });
  assert.deepEqual([load.x, load.y, load.z], local, 'an asleep pile does not move in the bucket');
  // Standing still: nothing to redraw.
  hold(world, 0, 0, 0.5);
  world.bucket.clearMoved();
  hold(world, 0, 0, 0.5);
  assert.equal(world.bucket.moved, false);
});

test('only the mouth scoops: balls at the sides, behind or above the heap stay in the field', () => {
  const { balls, bucket, pose } = openBucket(carrier(0, 0));
  const s = T1.bucket;
  const heapTop = s.rim + Config.bucket.heapLayers * 2 * R;
  const spots = [
    [s.halfX + 0.05, 1.5, R], // beside the cavity, against the side wall
    [-(s.halfX + 0.05), 1.5, R],
    [0, s.maxZ + R + 0.05, R], // just past the mouth
    [0, s.minZ - 0.05, R], // behind the bucket's back wall
    [0, 1.5, heapTop + 0.05], // above the heap
  ];
  const ids = spots.map(([lx, lz, y]) => {
    const p = at(pose, lx, lz);
    return balls.add(p.x, y, p.z);
  });
  const inside = at(pose, 0.2, s.maxZ + R - 0.01);
  const taken = balls.add(inside.x, R, inside.z);
  assert.equal(bucket.scoop(), 1);
  assert.ok(balls.isHeld(taken));
  for (const i of ids) assert.ok(!balls.isHeld(i), `ball ${i} left alone`);
});

test('a scooped ball keeps its speed relative to the tractor (90%) and is carried in the tractor axes', () => {
  const pose = carrier(2, 3, Math.PI / 2, T1, 3.6); // facing +X at full speed
  const { balls, bucket } = openBucket(pose);
  // Already inside the cavity (no slack to draw it in), in the air.
  const z0 = 1.5;
  const p = at(pose, 0, z0);
  const i = balls.add(p.x, 0.8, p.z);
  assert.equal(bucket.scoop(), 1);
  // A resting ball met at 3.6 u/s goes back into the bucket at 0.9 * 3.6 (less a step of damping).
  bucket.carry(1 / 60);
  const load = bucket.load;
  const speed = (load.z[0] - z0) * 60;
  const want = -0.9 * 3.6 * (1 - Config.bucket.damping / 60);
  assert.ok(Math.abs(speed - want) < 1e-6 && Math.abs(load.x[0]) < 1e-9, `in at ${speed} u/s, want ${want}`);
  const w = at(pose, load.x[0], load.z[0]);
  assert.ok(Math.abs(balls.x[i] - w.x) < 1e-12 && Math.abs(balls.z[i] - w.z) < 1e-12 && balls.y[i] === load.y[0]);
  assert.ok(bucket.moved);
  assert.equal(bucket.yaw, Math.PI / 2);
});

test('upgrade: the bucket follows the tractor tier (T2: 60 balls) and keeps its load', () => {
  const world = makeWorld();
  drive(world, INTO_CARPET);
  assert.equal(world.bucket.count, 8);
  const carried = Array.from(world.bucket.index.subarray(0, 8));
  world.tractor.setTier(T2);
  frame(world, 1 / 60, 0, 0);
  assert.equal(world.bucket.capacity, 60);
  assert.deepEqual(Array.from(world.bucket.index.subarray(0, 8)), carried, 'same balls');
  const worst = { outside: 0, placed: 0 };
  drive(world, [[2, -3], [10, 2], [4, 10], [-2, 4]], {
    each: (w) => {
      const m = measureLoad(w);
      worst.outside = Math.max(worst.outside, m.outside);
      worst.placed = Math.max(worst.placed, m.placed);
    },
  });
  assert.equal(world.bucket.count, 60, 'T2 filled up');
  assert.equal(world.balls.heldCount, 60);
  assert.ok(worst.outside < 1e-9 && worst.placed < 1e-9, JSON.stringify(worst));
});

test('unloadAll hands the load over: the balls stay held where they are, the bucket scoops again', () => {
  const world = makeWorld();
  drive(world, INTO_CARPET);
  const carried = Array.from(world.bucket.index.subarray(0, 8)).sort((a, b) => a - b);
  const where = carried.map((i) => [world.balls.x[i], world.balls.y[i], world.balls.z[i]]);
  const out = new Int32Array(BUCKET_SLOTS);
  assert.equal(world.bucket.unloadAll(out), 8);
  assert.deepEqual(Array.from(out.subarray(0, 8)).sort((a, b) => a - b), carried);
  assert.equal(world.bucket.count, 0);
  hold(world, -1, 0, 0.5); // drive on into the carpet
  for (let k = 0; k < 8; k++) {
    const i = carried[k];
    assert.ok(world.balls.isHeld(i), 'still held (the receiver owns them)');
    assert.deepEqual([world.balls.x[i], world.balls.y[i], world.balls.z[i]], where[k], 'nobody moves them');
  }
  assert.equal(world.bucket.count, 8, 'scooped a new load');
  assert.equal(world.balls.heldCount, 16);
});

test('a smaller bucket drops what it cannot hold back into the field', () => {
  const world = makeWorld({ tier: 1 });
  drive(world, INTO_CARPET);
  const before = world.bucket.count;
  assert.ok(before > 8, `T2 took ${before}`);
  world.tractor.setTier(T1);
  frame(world, 1 / 60, 0, 0);
  assert.equal(world.bucket.count, 8);
  assert.equal(world.balls.heldCount, 8, `${before - 8} balls went back to the field`);
  hold(world, 0, 0, 2);
  const m = measure(world);
  assert.equal(m.outside, 0);
  assert.ok(m.wall < 1e-9);
});
