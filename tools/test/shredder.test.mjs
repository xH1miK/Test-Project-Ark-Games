import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { Shredder } from '../../assets/scripts/economy/Shredder.ts';
import { ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';
import { SHREDDER_POSE, SHREDDER_SETTINGS, accountHeld, autopilot, frame, makeWorld, measure } from './ball-world.mjs';

const R = Config.balls.radius;
const { zoneHalf, handIn, throat, rollers } = Config.shredder;
const OPEN = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
/** The shredder in the middle of open ground, turned like the level's (its X across world Z). */
const POSE = { x: 0, y: -0.19, z: 0, yaw: Math.PI / 2 };

/** Open ground: a field, `n` held balls in a stand-in bucket at (x, z), a visitor, the shredder and its events. */
function openShredder({ n = 8, at = { x: 6, z: 0 } } = {}) {
  const field = new BallField({ ...Config.balls, bounds: OPEN }, 128, new ObstacleGrid(OPEN, 1));
  const carried = [];
  for (let k = 0; k < n; k++) {
    const i = field.add(at.x + 0.3 * (k % 3), 0.5 + 0.4 * Math.floor(k / 3), at.z + 0.2 * k);
    field.hold(i);
    carried.push(i);
  }
  const load = {
    get count() { return carried.length; },
    unloadAll(out) { out.set(carried); const m = carried.length; carried.length = 0; return m; },
  };
  const visitor = { bodyX: at.x, bodyZ: at.z };
  const events = new EventBus();
  const heard = { shredded: [], earned: [] };
  events.on('ballsShredded', (e) => heard.shredded.push(e.count));
  events.on('coinsEarned', (e) => heard.earned.push(e));
  const shredder = new Shredder(SHREDDER_SETTINGS, POSE, field, load, visitor, events);
  return { field, load, visitor, shredder, heard, carried: carried.slice() };
}
const sum = (list) => list.reduce((s, v) => s + v, 0);
/** A world point in the pose's axes. */
const at = (pose, lx, lz) => ({ x: pose.x + lx * Math.cos(pose.yaw) + lz * Math.sin(pose.yaw), z: pose.z - lx * Math.sin(pose.yaw) + lz * Math.cos(pose.yaw) });

test('hand-in: only while the visitor stands in the square zone, and the whole load at once', () => {
  const { field, load, visitor, shredder, carried } = openShredder();
  // Just outside each side of the square: nothing is taken.
  for (const [x, z] of [[zoneHalf + 0.01, 0], [-zoneHalf - 0.01, 1], [1, zoneHalf + 0.01], [-2, -zoneHalf - 0.01], [zoneHalf + 0.01, zoneHalf + 0.01]]) {
    visitor.bodyX = x;
    visitor.bodyZ = z;
    shredder.step(1 / 60);
    assert.equal(load.count, 8, `outside at (${x}, ${z})`);
    assert.ok(!shredder.inZone);
  }
  // A corner of the square counts as inside: the whole load flies in one step.
  visitor.bodyX = zoneHalf;
  visitor.bodyZ = -zoneHalf;
  assert.ok(shredder.inZone);
  shredder.step(1 / 60);
  assert.equal(load.count, 0);
  assert.equal(shredder.handedIn, 8);
  assert.equal(shredder.inFlight, 8);
  for (const i of carried) assert.ok(shredder.flights.isFlying(i) && field.isHeld(i));
});

test('the load flies in arcs into the shredder: on time, 2 coins per ball as each lands, then gone', () => {
  const { field, visitor, shredder, heard, carried } = openShredder();
  visitor.bodyX = 2;
  const start = carried.map((i) => ({ x: field.x[i], y: field.y[i], z: field.z[i] }));
  const peak = carried.map(() => -Infinity);
  const last = carried.map(() => null);
  const landedAt = carried.map(() => null);
  const dt = 1 / 60;
  let t = 0;
  for (let f = 0; f < 60; f++) {
    shredder.step(dt);
    t += dt;
    carried.forEach((i, k) => {
      if (field.isRemoved(i)) {
        landedAt[k] ??= t;
        return;
      }
      peak[k] = Math.max(peak[k], field.y[i]);
      last[k] = { x: field.x[i], y: field.y[i], z: field.z[i] };
    });
  }
  const aimY = POSE.y + handIn.aimHeight;
  carried.forEach((i, k) => {
    assert.ok(landedAt[k] >= handIn.time - 1e-9 && landedAt[k] <= handIn.time * (1 + handIn.stagger) + dt + 1e-9, `ball ${k} landed at ${landedAt[k]}`);
    // The hop: at least `arc` above the middle of the line (less a frame's sampling).
    assert.ok(peak[k] > (start[k].y + aimY) / 2 + handIn.arc - 0.1, `ball ${k} peaked at ${peak[k]}`);
    // Its last drawn point before landing is next to the aim: the scatter plus a frame of flight.
    assert.ok(Math.abs(last[k].x - POSE.x) < handIn.spread + 0.6 && Math.abs(last[k].z - POSE.z) < handIn.spread + 0.6, `ball ${k} came down at ${JSON.stringify(last[k])}`);
    assert.ok(field.isRemoved(i) && field.isHeld(i));
  });
  assert.equal(sum(heard.shredded), 8);
  assert.equal(sum(heard.earned.map((e) => e.amount)), 16, '2 coins per ball');
  assert.ok(heard.earned.every((e) => e.amount === 2 * heard.shredded[heard.earned.indexOf(e)]), 'paid for what landed in that step');
  assert.ok(heard.earned.every((e) => e.x === POSE.x && e.z === POSE.z && Math.abs(e.y - aimY) < 1e-12), 'coins come out of the shredder top');
  assert.ok(heard.earned.length > 1, `the load pours in over several steps (${heard.earned.length})`);
  assert.equal(shredder.shredded, 8);
  assert.equal(field.removedCount, 8);
  assert.equal(shredder.inFlight, 0);
});

test('the throat swallows free balls inside its box (shredder axes, up to its height) and pays for them', () => {
  const { field, visitor, shredder, heard } = openShredder({ n: 0 });
  visitor.bodyX = 15; // no load anyway
  const top = POSE.y + throat.height;
  const spots = {
    inside: [[throat.halfX - 0.05, 0, R], [0, throat.halfZ - 0.05, R], [-(throat.halfX - 0.1), -(throat.halfZ - 0.1), R], [0.5, 0.5, top - 0.01]],
    outside: [[throat.halfX + 0.05, 0, R], [0, throat.halfZ + 0.05, R], [-(throat.halfX + 0.05), throat.halfZ - 0.1, R], [0.3, 0.3, top + 0.05]],
  };
  const make = ([lx, lz, y]) => {
    const p = at(POSE, lx, lz);
    return field.add(p.x, y, p.z);
  };
  const inside = spots.inside.map(make);
  const outside = spots.outside.map(make);
  shredder.step(1 / 60);
  assert.equal(shredder.swallowed, inside.length);
  for (const i of inside) assert.ok(field.isHeld(i) && shredder.flights.isFlying(i), `ball ${i} swallowed`);
  for (const i of outside) assert.ok(!field.isHeld(i), `ball ${i} left alone`);
  let t = 1 / 60;
  while (shredder.inFlight > 0 && t < 1) {
    shredder.step(1 / 60);
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - throat.time) <= 1 / 60 + 1e-9, `down the throat in ${t} s`);
  assert.equal(sum(heard.earned.map((e) => e.amount)), 2 * inside.length);
  for (const i of inside) assert.ok(field.isRemoved(i));
  // The mouth is below the pivot: the balls go down into the shredder, not up.
  assert.equal(shredder.shredded, inside.length);
});

test('rollers: spin up while fed, keep turning a while after the last ball, then wind down', () => {
  const { visitor, shredder } = openShredder({ n: 3 });
  const dt = 1 / 60;
  assert.equal(shredder.rollerSpeed, 0);
  visitor.bodyX = 2;
  const speeds = [];
  const angles = [];
  for (let f = 0; f < 150; f++) {
    shredder.step(dt);
    speeds.push(shredder.rollerSpeed);
    angles.push(shredder.rollerAngle);
  }
  const full = speeds.findIndex((s) => s === 1);
  assert.ok(full >= 0 && Math.abs((full + 1) * dt - rollers.spinUp) <= dt + 1e-9, `full speed after ${(full + 1) * dt} s`);
  const lastFed = Math.ceil((handIn.time * (1 + handIn.stagger)) / dt); // the last ball has landed by then
  const slowing = speeds.findIndex((s, f) => f > full && s < 1);
  assert.ok(slowing * dt >= handIn.time + rollers.coast - dt && slowing <= lastFed + Math.ceil(rollers.coast / dt) + 1, `slows down at ${slowing * dt} s`);
  const stopped = speeds.findIndex((s, f) => f > slowing && s === 0);
  assert.ok(Math.abs((stopped - slowing + 1) * dt - rollers.spinDown) <= 2 * dt, `stops ${(stopped - slowing + 1) * dt} s after slowing`);
  // The angle advances by speed x full speed (wrapped to one turn).
  const turned = (angles[full + 10] - angles[full] + 2 * Math.PI) % (2 * Math.PI);
  assert.ok(Math.abs(turned - (10 * dt * rollers.speed * Math.PI) / 180) < 1e-9, `turned ${turned} rad in 10 frames at full speed`);
  assert.equal(angles[angles.length - 1], angles[angles.length - 2], 'still once stopped');
});

test('the real arena: fill the bucket, drive into the zone, the purse gets 2 per ball once the coins arrive', () => {
  const world = makeWorld({ shredder: true });
  const { bucket, shredder, purse, coins, balls } = world;
  const drive = (route, most = 20) => {
    const steer = autopilot(route, 0.5);
    for (let f = 0, s = steer(world.tractor); s && f < most * 60; s = steer(world.tractor), f++) frame(world, 1 / 60, s.x, s.z);
  };
  const idle = (seconds) => {
    for (let f = 0; f < seconds * 60; f++) frame(world, 1 / 60, 0, 0);
  };
  const purseLog = [];
  world.events.on('purseChanged', (e) => purseLog.push(e));
  drive([[3, -11]]);
  assert.equal(bucket.count, 8, 'filled up');
  assert.equal(purse.total, 0);
  // North into the zone from the south-west (away from the throat).
  let entered = null;
  const steer = autopilot([[3, -4.5]], 0.5);
  for (let f = 0, s = steer(world.tractor); s && f < 1200; s = steer(world.tractor), f++) {
    const before = bucket.count;
    frame(world, 1 / 60, s.x, s.z);
    if (entered === null && shredder.handedIn > 0) {
      entered = { z: world.tractor.bodyZ, before, after: bucket.count, inZone: shredder.inZone };
    }
  }
  assert.ok(entered, 'handed in');
  assert.ok(entered.inZone && entered.z >= SHREDDER_POSE.z - zoneHalf - 1e-9 && entered.z < SHREDDER_POSE.z - zoneHalf + 0.1, `taken as the body crossed into the zone (z ${entered.z})`);
  assert.equal(entered.after, 0, 'the whole load at once');
  idle(1.5);
  const shredded = shredder.shredded;
  assert.equal(shredder.handedIn + shredder.swallowed, shredded, 'everything handed in or swallowed has landed');
  assert.ok(shredder.handedIn >= 8, `handed in ${shredder.handedIn}`);
  assert.equal(coins.pending, 0);
  assert.equal(purse.total, 2 * shredded, `purse ${purse.total} for ${shredded} balls`);
  assert.equal(sum(purseLog.map((e) => e.delta)), purse.total);
  assert.ok(purseLog.length > 1, 'the purse fills as the coins arrive, not in one go');
  const a = accountHeld(world);
  assert.deepEqual([a.stray, a.twice], [0, 0], JSON.stringify(a));
  assert.equal(a.held, a.carried + a.flying + a.removed);
  assert.equal(balls.removedCount, shredded);
  // The free balls are all in the arena, none in a rock.
  const m = measure(world);
  assert.equal(m.outside, 0);
  assert.ok(m.wall < 1e-6);
});

test('a full bucket shoves the carpet into the throat: those balls pay 2 each too', () => {
  const world = makeWorld({ shredder: true });
  const { bucket, shredder, purse } = world;
  const drive = (route) => {
    const steer = autopilot(route, 0.5);
    for (let f = 0, s = steer(world.tractor); s && f < 1500; s = steer(world.tractor), f++) frame(world, 1 / 60, s.x, s.z);
  };
  drive([[3, -11]]);
  assert.equal(bucket.count, 8);
  // Round to the east side, then straight at the shredder (-X) through the carpet, stopping short of
  // the zone (braking from 3.6 u/s takes ~0.3 units).
  drive([[11, -8], [12, -1.9]]);
  const zoneEdge = SHREDDER_POSE.x + zoneHalf;
  let f = 0;
  while (world.tractor.bodyX > zoneEdge + 0.5 && f++ < 900) frame(world, 1 / 60, -1, 0);
  for (let k = 0; k < 90; k++) frame(world, 1 / 60, 0, 0);
  assert.equal(shredder.handedIn, 0, 'never in the zone');
  assert.equal(bucket.count, 8, 'still full');
  assert.ok(shredder.swallowed >= 3, `the blade fed the throat ${shredder.swallowed} balls`);
  assert.equal(shredder.shredded, shredder.swallowed);
  assert.equal(purse.total, 2 * shredder.swallowed);
  const a = accountHeld(world);
  assert.deepEqual([a.stray, a.twice], [0, 0], JSON.stringify(a));
});

test('rounds: several loads in a row, every ball paid exactly once', () => {
  const world = makeWorld({ shredder: true });
  const { shredder, purse, balls } = world;
  const drive = (route) => {
    const steer = autopilot(route, 0.6);
    for (let f = 0, s = steer(world.tractor); s && f < 2400; s = steer(world.tractor), f++) frame(world, 1 / 30, s.x, s.z);
  };
  // Fill in the carpet, hand in at the shredder (spots clear of its body), back out: three times, at 30 fps.
  const trips = [[[3, -11], [3, -4.5]], [[0, -2], [2.6, 1]], [[1, 6], [3.5, 1.2]]];
  const handed = [];
  for (const trip of trips) {
    drive(trip);
    handed.push(shredder.handedIn);
    for (let k = 0; k < 45; k++) frame(world, 1 / 30, 0, 0);
  }
  assert.ok(handed[0] >= 8 && handed[1] > handed[0] && handed[2] > handed[1], `hand-ins ${handed}`);
  assert.equal(shredder.inFlight, 0);
  assert.equal(shredder.shredded, shredder.handedIn + shredder.swallowed);
  assert.equal(purse.total, 2 * shredder.shredded);
  assert.equal(balls.removedCount, shredder.shredded);
  const a = accountHeld(world);
  assert.deepEqual([a.stray, a.twice], [0, 0], JSON.stringify(a));
});
