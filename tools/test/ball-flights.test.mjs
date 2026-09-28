import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { BallFlights } from '../../assets/scripts/balls/BallFlights.ts';
import { BallQuads } from '../../assets/scripts/balls/BallQuads.ts';
import { ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';

const R = Config.balls.radius;
const OPEN = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
const openField = (capacity = 64) => new BallField({ ...Config.balls, bounds: OPEN }, capacity, new ObstacleGrid(OPEN, 1));
const listed = (field) => Array.from(field.moved.subarray(0, field.movedCount));

test('moveHeld lists a held ball as moved, place does not; neither touches a free ball', () => {
  const field = openField();
  const a = field.add(0, R, 0);
  const b = field.add(2, R, 0);
  field.hold(a);
  field.hold(b);
  field.clearMoved();
  field.place(a, 1, 2, 3);
  assert.deepEqual([field.x[a], field.y[a], field.z[a]], [1, 2, 3]);
  assert.deepEqual(listed(field), [], 'a carrier draws what it places');
  field.moveHeld(b, 4, 5, 6);
  field.moveHeld(b, 4, 5, 7);
  assert.deepEqual([field.x[b], field.y[b], field.z[b]], [4, 5, 7]);
  assert.deepEqual(listed(field), [b], 'listed once');
  const free = field.add(-3, R, 0);
  field.moveHeld(free, 9, 9, 9);
  assert.deepEqual([field.x[free], field.z[free]], [-3, 0], 'a free ball is the field\'s');
});

test('remove: the ball is out of the game for good; held by nobody, never found, never released, listed once', () => {
  const field = openField();
  const i = field.add(0, R, 0);
  const j = field.add(0.6, R, 0);
  field.clearMoved();
  field.remove(i); // a free ball leaves the field first
  assert.ok(field.isRemoved(i) && field.isHeld(i));
  assert.equal(field.removedCount, 1);
  assert.equal(field.heldCount, 1, 'a removed ball counts as held');
  assert.deepEqual(listed(field), [i], 'views are told to hide it');
  const out = new Int32Array(8);
  assert.deepEqual(Array.from(out.subarray(0, field.findFree(-1, 1, -1, 1, out))), [j], 'never found again');
  field.release(i, 0, R, 0, 0, 0, 0);
  field.moveHeld(i, 5, 5, 5);
  field.place(i, 5, 5, 5);
  assert.ok(field.isRemoved(i) && field.isHeld(i) && field.x[i] === 0, 'no way back');
  field.remove(i);
  assert.equal(field.removedCount, 1, 'removing twice counts once');
  // The field steps on without it: its neighbour is alone.
  field.step(1 / 60, null);
  assert.ok(!field.isHeld(j));
});

test('a flight: straight line plus a hop of `arc` at the middle, lands on time and removes the ball', () => {
  const field = openField();
  const i = field.add(0, R, 0);
  field.hold(i);
  const flights = new BallFlights(field, field.capacity);
  assert.ok(flights.launch(i, 4, 1, -2, 0.4, 1.4));
  assert.ok(flights.isFlying(i) && flights.count === 1);
  assert.equal(flights.launch(i, 0, 0, 0, 1, 0), false, 'already flying');
  field.clearMoved();
  // Half way: the middle of the line, `arc` above it.
  for (let k = 0; k < 4; k++) assert.equal(flights.step(0.05), 0);
  const close = (v, want, what) => assert.ok(Math.abs(v - want) < 1e-9, `${what}: ${v} vs ${want}`);
  close(field.x[i], 2, 'x at the middle');
  close(field.y[i], (R + 1) / 2 + 1.4, 'y at the middle');
  close(field.z[i], -1, 'z at the middle');
  assert.deepEqual(listed(field), [i], 'a flying ball is drawn as a loose one');
  // A quarter of the way: sin(pi/4) of the hop.
  const at = new BallFlights(field, field.capacity);
  const j = field.add(10, R, 10);
  field.hold(j);
  at.launch(j, 14, R, 10, 0.4, 1.4);
  at.step(0.1);
  close(field.y[j], R + 1.4 * Math.SQRT1_2, 'y a quarter of the way');
  close(field.x[j], 11, 'x a quarter of the way');
  // Lands after 0.4 s: removed, listed for hiding, no longer flying.
  let landed = 0;
  let t = 0.2;
  while (!landed) {
    landed = flights.step(0.05);
    t += 0.05;
  }
  assert.ok(Math.abs(t - 0.4) < 0.05 + 1e-9, `landed at ${t}`);
  assert.ok(field.isRemoved(i) && !flights.isFlying(i) && flights.count === 0 && flights.landed === 1);
});

test('flights of different lengths land in their own time; only held balls fly', () => {
  const field = openField();
  const flights = new BallFlights(field, field.capacity);
  const free = field.add(-5, R, -5);
  assert.equal(flights.launch(free, 0, 0, 0, 0.3, 1), false, 'a free ball cannot fly');
  const durations = [0.3, 0.1, 0.5, 0.2];
  const ids = durations.map((d, k) => {
    const i = field.add(k, R, 0);
    field.hold(i);
    assert.ok(flights.launch(i, k, 1, 3, d, 0.5));
    return i;
  });
  const landedAt = new Map();
  for (let step = 1; step <= 40 && flights.count > 0; step++) {
    flights.step(0.02);
    for (const i of ids) if (field.isRemoved(i) && !landedAt.has(i)) landedAt.set(i, step * 0.02);
  }
  ids.forEach((i, k) => assert.ok(Math.abs(landedAt.get(i) - durations[k]) < 0.02 + 1e-9, `ball ${k} landed at ${landedAt.get(i)}`));
  assert.equal(field.removedCount, 4);
  assert.ok(!field.isHeld(free));
});

test('the view hides a removed ball (radius 0) and only rewrites it once', () => {
  const field = openField();
  const i = field.add(1, R, 1);
  field.add(2, R, 2);
  const quads = new BallQuads(field.capacity, R, { sizeJitter: 0, shadeJitter: 0, seed: 1 });
  quads.writeAll(field);
  field.clearMoved();
  const flights = new BallFlights(field, field.capacity);
  field.hold(i);
  flights.launch(i, 3, 1, 3, 0.1, 0.5);
  const b = { x: 0, y: 0, z: 0, radius: 0 };
  flights.step(0.05);
  assert.equal(quads.writeMoved(field), 1);
  field.clearMoved();
  quads.readBall(i, b);
  assert.ok(b.radius > 0 && Math.abs(b.x - field.x[i]) < 1e-6 && Math.abs(b.y - field.y[i]) < 1e-6, 'drawn in flight');
  flights.step(0.05);
  assert.ok(field.isRemoved(i));
  assert.equal(quads.writeMoved(field), 1);
  field.clearMoved();
  quads.readBall(i, b);
  assert.equal(b.radius, 0, 'hidden once it landed');
  field.step(1 / 60, null);
  assert.equal(quads.writeMoved(field), 0, 'nothing more to upload');
  // A view built later (writeAll) hides it too.
  const later = new BallQuads(field.capacity, R, { sizeJitter: 0, shadeJitter: 0, seed: 1 });
  later.writeAll(field);
  later.readBall(i, b);
  assert.equal(b.radius, 0);
});
