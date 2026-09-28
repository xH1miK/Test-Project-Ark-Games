import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { BucketLoad } from '../../assets/scripts/tractor/BucketLoad.ts';
import { mulberry32 } from '../../assets/scripts/balls/BallCarpet.ts';
import { BUCKET_SETTINGS, BUCKET_SLOTS, cavityBreach } from './ball-world.mjs';

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
    outside = Math.max(outside, cavityBreach(s, R, load.x[k], load.y[k], load.z[k]));
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
  // The cavity measured on Tractor2's mesh: a mound at most a layer over the heap's top, and the
  // floor layer fills the rounded back corner (balls down there keep off the curve).
  const top = Math.max(...load.y.subarray(0, load.count));
  assert.ok(top < heapTop + 2 * R, `the mound tops out at ${top.toFixed(2)} (heap top ${heapTop.toFixed(2)})`);
  // The back fills up: the floor row lies against the curve, the balls above the rounding against the wall.
  const curveStop = s.minZ + s.backRound;
  let onCurve = 0;
  let onWall = 0;
  for (let k = 0; k < load.count; k++) {
    if (load.y[k] < s.floor + R + 0.05 && load.z[k] < curveStop + 0.1) onCurve++;
    if (load.y[k] > s.floor + s.backRound && load.z[k] < s.minZ + R + 0.05) onWall++;
  }
  assert.ok(onCurve >= 3 && onWall >= 3, `${onCurve} floor balls against the curve, ${onWall} against the wall above it`);
  console.log(`T2 load of 60: top centre ${top.toFixed(2)}, heap top ${heapTop.toFixed(2)}, ${onCurve} floor balls against the curve, ${onWall} against the wall above, asleep after ${took.toFixed(2)} s, worst overlap ${overlap.toFixed(3)}`);
});

test('the rounded back corner: balls thrown back stop against it (a floor ball off the curve, one higher up at the wall plane), no bounce', () => {
  const s = T2.bucket;
  assert.ok(s.backRound > R, 'T2 has a rounded corner');
  const axisZ = s.minZ + s.backRound;
  const axisY = s.floor + s.backRound;
  // Without gravity a ball keeps its height: one on the floor, one above the rounding, both thrown back.
  const flat = new BucketLoad({ ...BUCKET_SETTINGS, gravity: 0 }, BUCKET_SLOTS, s, T2.bucketCapacity);
  flat.take(0, 0, s.floor + R, s.maxZ - R, 0, 0, -7.6);
  flat.take(1, 1, axisY + 0.2, s.maxZ - R, 0, 0, -7.6);
  for (let f = 0; f < 60; f++) flat.step(1 / 60);
  assert.ok(Math.abs(flat.y[0] - (s.floor + R)) < 1e-9, `floor ball at y ${flat.y[0]}`);
  assert.ok(Math.abs(flat.z[0] - axisZ) < 1e-9, `floor ball at z ${flat.z[0].toFixed(4)}, the curve lets it to ${axisZ.toFixed(4)}`);
  assert.ok(Math.abs(flat.y[1] - (axisY + 0.2)) < 1e-9 && Math.abs(flat.z[1] - (s.minZ + R)) < 1e-9, `upper ball at y ${flat.y[1].toFixed(3)} z ${flat.z[1].toFixed(4)}, the wall plane lets it to ${(s.minZ + R).toFixed(4)}`);
  // With gravity, a ball scooped at T2 speed rolls back into the corner and stays there.
  const load = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, s, T2.bucketCapacity);
  load.take(0, 0, s.floor + R, s.maxZ - R, 0, 0, -0.9 * T2.speed);
  let farthest = Infinity;
  let after = -Infinity;
  for (let f = 0; f < 120; f++) {
    load.step(1 / 60);
    farthest = Math.min(farthest, load.z[0]);
    if (f > 30) after = Math.max(after, load.z[0]);
  }
  assert.ok(Math.abs(farthest - axisZ) < 1e-9, `went back to z ${farthest.toFixed(4)}`);
  assert.ok(after < axisZ + 1e-9, `and stayed in the corner (at most z ${after.toFixed(4)} later)`);
  assert.ok(check(load).outside < 1e-9);
  // A ball scooped inside the rounding (the intake is a box) is drawn out of it, not snapped.
  const drawn = new BucketLoad(BUCKET_SETTINGS, BUCKET_SLOTS, s, T2.bucketCapacity);
  drawn.take(0, 0, s.floor + R, s.minZ + R, 0, 0, 0);
  const deep = cavityBreach(s, R, 0, s.floor + R, s.minZ + R);
  assert.ok(deep > 0.1, `the box corner is ${deep.toFixed(3)} into the rounding`);
  drawn.step(1 / 60);
  const first = deep - cavityBreach(s, R, drawn.x[0], drawn.y[0], drawn.z[0]);
  assert.ok(first > 0 && first <= Config.bucket.drawIn / 60 + 1e-9, `first step moved it out by ${first}`);
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
