import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { BucketLoad } from '../../assets/scripts/tractor/BucketLoad.ts';
import { mulberry32 } from '../../assets/scripts/balls/BallCarpet.ts';
import { BUCKET_SETTINGS, BUCKET_SLOTS } from './ball-world.mjs';

const R = Config.balls.radius;
const [T1, T2] = Config.tractor.tiers;
/** Overlap a settled load keeps by design (its contact slop), units. */
const SQUEEZE = Config.bucket.contactSlop * 2 * R;

/** How far ball k is outside the cavity (heap above the rim allowed), and the worst pair overlap. */
const check = (load) => {
  const s = load.shape;
  let outside = 0;
  let overlap = 0;
  for (let k = 0; k < load.count; k++) {
    outside = Math.max(outside, s.floor + R - load.y[k], Math.abs(load.x[k]) - (s.halfX - R), s.minZ + R - load.z[k], load.z[k] - (s.maxZ - R));
    for (let j = k + 1; j < load.count; j++) {
      overlap = Math.max(overlap, 2 * R - Math.hypot(load.x[j] - load.x[k], load.y[j] - load.y[k], load.z[j] - load.z[k]));
    }
  }
  return { outside: Math.max(0, outside), overlap: Math.max(0, overlap) };
};
/** Steps until the pile sleeps; returns the time it took (or Infinity). */
const settle = (load, dt = 1 / 60, most = 5) => {
  for (let t = 0; t < most; t += dt) if (!load.step(dt) && !load.settling) return t;
  return Infinity;
};
/** Drops `n` balls into the bucket the way the scoop does: at the lip, moving back into it. */
const scoopInto = (load, n, tier, seed = 1) => {
  const random = mulberry32(seed);
  const s = tier.bucket;
  for (let k = 0; k < n; k++) {
    const x = (2 * random() - 1) * (s.halfX - R);
    load.take(k, x, R + random() * 0.3, s.maxZ + R * random(), 0, 0, -0.9 * tier.speed);
    for (let f = 0; f < 3; f++) load.step(1 / 60);
  }
};

test('a T1 load of 8 scooped at the lip settles inside the bucket and falls asleep', () => {
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T1.bucket, T1.bucketCapacity);
  scoopInto(load, 8, T1);
  assert.equal(load.count, 8);
  const took = settle(load);
  assert.ok(took < 1.5, `asleep ${took.toFixed(2)} s after the last ball`);
  const { outside, overlap } = check(load);
  assert.ok(outside < 1e-9, `outside the bucket by ${outside}`);
  assert.ok(overlap < SQUEEZE + 0.02, `balls overlap by ${overlap}`);
  // Low and compact like the example's load (three layers, top centre ~1.3), not a tower.
  const top = Math.max(...load.y.subarray(0, 8));
  assert.ok(top < T1.bucket.rim + 3 * R, `top ball centre at ${top.toFixed(2)}`);
  // Asleep: nothing moves any more.
  const y = Float64Array.from(load.y);
  for (let f = 0; f < 60; f++) assert.equal(load.step(1 / 60), false);
  assert.deepEqual(load.y, y);
});

test('the pile does not fall through the floor or out through the walls at a low frame rate', () => {
  for (const dt of [1 / 60, 1 / 30]) {
    const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T1.bucket, T1.bucketCapacity);
    for (let k = 0; k < 8; k++) load.take(k, 0, 2 + k * 0.1, 1.5, 3, -5, 2); // a flung heap
    let worst = 0;
    for (let t = 0; t < 1.5; t += dt) {
      load.step(dt);
      worst = Math.max(worst, check(load).outside);
    }
    assert.ok(worst < 1e-9, `dt ${dt.toFixed(3)}: outside by ${worst}`);
  }
});

test('a ball taken outside the walls is drawn in over a few frames, not snapped', () => {
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T1.bucket, T1.bucketCapacity);
  const s = T1.bucket;
  const lip = s.maxZ + R; // centre one radius past the lip: 2 radii past its wall
  load.take(0, 0, R + s.floor, lip, 0, 0, 0);
  load.step(1 / 60);
  const first = lip - load.z[0];
  assert.ok(first > 0 && first <= Config.bucket.drawIn / 60 + 1e-9, `first step moved it ${first}`);
  let frames = 1;
  while (load.z[0] > s.maxZ - R + 1e-9 && frames < 60) {
    load.step(1 / 60);
    frames++;
  }
  assert.ok(frames > 5 && frames < 15, `inside after ${frames} frames`);
});

test('a full load takes no more; pop and handOver give the balls back', () => {
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T1.bucket, 3);
  for (let k = 0; k < 3; k++) assert.ok(load.take(10 + k, 0, 0.5, 1.5, 0, 0, 0));
  assert.ok(load.full);
  assert.equal(load.take(99, 0, 0.5, 1.5, 0, 0, 0), false);
  assert.equal(load.pop(), 12);
  assert.equal(load.count, 2);
  const out = new Int32Array(8);
  assert.equal(load.handOver(out), 2);
  assert.deepEqual(Array.from(out.subarray(0, 2)), [10, 11]);
  assert.equal(load.count, 0);
  assert.equal(load.settling, false);
  assert.equal(load.step(1 / 60), false, 'an empty load does nothing');
});

test('T2 holds 60: the heap narrows into a mound above the rim and sleeps', () => {
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T2.bucket, T2.bucketCapacity);
  scoopInto(load, 60, T2, 3);
  assert.equal(load.count, 60);
  const took = settle(load);
  assert.ok(took < 2, `asleep ${took.toFixed(2)} s after the last ball`);
  const { outside, overlap } = check(load);
  assert.ok(outside < 1e-9, `outside the bucket by ${outside}`);
  assert.ok(overlap < SQUEEZE + 0.05, `balls overlap by ${overlap}`);
  // Above the straight part of the heap the pile is narrower than the bucket.
  const heapTop = T2.bucket.rim + Config.bucket.heapLayers * 2 * R;
  const s = T2.bucket;
  for (let k = 0; k < load.count; k++) {
    const over = load.y[k] - heapTop;
    if (over <= 0) continue;
    const narrow = Config.bucket.heapSlope * over;
    assert.ok(Math.abs(load.x[k]) <= Math.max(0, s.halfX - R - narrow) + 1e-9, `ball ${k} at y ${load.y[k].toFixed(2)} x ${load.x[k].toFixed(2)}`);
  }
  // The example's cavity (Tractor2 is not in yet; its bucket gets measured with the model).
  const top = Math.max(...load.y.subarray(0, load.count));
  assert.ok(top < heapTop + 2 * R, `the mound tops out at ${top.toFixed(2)} (heap top ${heapTop.toFixed(2)})`);
});

test('setShape (upgrade): the pile keeps its balls, stretched into the new bucket, and settles there', () => {
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, T1.bucket, T1.bucketCapacity);
  scoopInto(load, 8, T1);
  settle(load);
  load.setShape(T2.bucket, T2.bucketCapacity);
  assert.equal(load.capacity, 60);
  assert.equal(load.count, 8);
  assert.ok(load.settling, 'woken by the new shape');
  settle(load);
  const { outside, overlap } = check(load);
  assert.ok(outside < 1e-9, `outside the T2 bucket by ${outside}`);
  assert.ok(overlap < SQUEEZE + 0.02, `overlap ${overlap}`);
  assert.throws(() => load.setShape(T2.bucket, BUCKET_SLOTS + 1), /slots/);
});
