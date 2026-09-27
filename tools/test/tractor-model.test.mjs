import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TractorModel } from '../../assets/scripts/tractor/TractorModel.ts';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';

const SETTINGS = { turnSpeed: 240, accel: 14, brake: 22, collisionPasses: 2, maxStep: 1 / 30 };
const T1 = { speed: 3.6, bucketCapacity: 8, bodyRadius: 1.2, bodyOffset: 0.55 };
const T2 = { speed: 8.4, bucketCapacity: 60, bodyRadius: 1.8, bodyOffset: 0 };
const BOUNDS = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
const DEG = Math.PI / 180;
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

const make = (...boxes) => {
  const grid = new ObstacleGrid(BOUNDS, 1);
  for (const b of boxes) grid.add({ kind: 'box', angle: 0, ...b });
  const tractor = new TractorModel(SETTINGS, T1, grid);
  tractor.place(0, 0, 0);
  return { tractor, grid };
};
const run = (tractor, seconds, x, z, fps = 60) => {
  for (let i = 0, n = Math.round(seconds * fps); i < n; i++) tractor.update(1 / fps, x, z);
};
/** How deep the tractor's body circle still sits inside the obstacles. */
const penetration = (tractor, grid) =>
  grid.resolveCircle(tractor.bodyX, tractor.bodyZ, tractor.bodyRadius, Blocks.Tractor, { x: 0, z: 0 });

test('model faces +Z at yaw 0 and drives straight ahead', () => {
  const { tractor } = make();
  run(tractor, 1, 0, 1);
  near(tractor.x, 0);
  assert.ok(tractor.z > 3 && tractor.z < 3.6, `z ${tractor.z}`);
  near(tractor.yaw, 0);
});

test('accelerates at 14 u/s² to top speed, brakes at 22 u/s²', () => {
  const { tractor } = make();
  run(tractor, 0.1, 0, 1);
  near(tractor.speed, 1.4, 1e-9);
  run(tractor, 0.2, 0, 1);
  near(tractor.speed, 3.6);
  run(tractor, 0.1, 0, 0);
  near(tractor.speed, 3.6 - 2.2, 1e-9);
  run(tractor, 0.1, 0, 0);
  near(tractor.speed, 0);
});

test('partial stick = partial speed', () => {
  const { tractor } = make();
  run(tractor, 1, 0, 0.5);
  near(tractor.speed, 1.8);
});

test('turns toward the command: +X is yaw +90° (Cocos Y rotation)', () => {
  const { tractor } = make();
  run(tractor, 2, 1, 0);
  near(tractor.yaw, 90 * DEG, 1e-9);
  assert.ok(tractor.x > 2, `x ${tractor.x}`);
});

test('tank-like: a command behind the tractor turns it on the spot at 75% turn rate', () => {
  const { tractor } = make();
  run(tractor, 0.25, 0, -1);
  near(Math.abs(tractor.yaw), 45 * DEG, 1e-6); // 240 * 0.75 = 180°/s
  near(tractor.speed, 0);
  near(tractor.x, 0);
  near(tractor.z, 0);
});

test('slows down in a turn: cos of the heading error', () => {
  const { tractor } = make();
  run(tractor, 1, 0, 1); // full speed along +Z
  tractor.update(1 / 60, 1, 0); // now a 90° command
  assert.ok(tractor.speed < 3.6 - 0.3, `braking in the turn: ${tractor.speed}`);
});

test('the body circle sits bodyOffset ahead of the pivot', () => {
  const { tractor } = make();
  near(tractor.bodyX, 0);
  near(tractor.bodyZ, 0.55);
  tractor.place(2, 3, Math.PI / 2);
  near(tractor.bodyX, 2.55);
  near(tractor.bodyZ, 3, 1e-9);
});

test('a wall stops the body (bucket included) at its surface, no penetration', () => {
  // Wall face at z = 5.
  const { tractor, grid } = make({ x: 0, z: 6, halfX: 10, halfZ: 1 });
  run(tractor, 3, 0, 1);
  near(tractor.bodyZ, 5 - 1.2, 1e-6);
  near(tractor.z, 5 - 1.2 - 0.55, 1e-6); // the pivot stays behind
  assert.ok(penetration(tractor, grid) <= 1e-6);
  const before = tractor.odometer;
  run(tractor, 1, 0, 1); // keep ramming
  near(tractor.odometer, before, 1e-6);
});

test('slides along a wall when driving into it at an angle', () => {
  const { tractor, grid } = make({ x: 0, z: 6, halfX: 20, halfZ: 1 });
  run(tractor, 2, 0, 1); // reach the wall
  const x0 = tractor.x;
  run(tractor, 1, 1, 1); // 45° into the wall
  assert.ok(tractor.x > x0 + 1.5, `slid ${tractor.x - x0}`);
  near(tractor.bodyZ, 3.8, 1e-6);
  assert.ok(penetration(tractor, grid) <= 1e-6);
});

test('ramming a corner keeps penetration under 0.05, even at 4 fps', () => {
  for (const fps of [60, 4]) {
    const { tractor, grid } = make({ x: 0, z: 6, halfX: 10, halfZ: 1 }, { x: 4, z: 0, halfX: 1, halfZ: 10 });
    let worst = 0;
    for (let i = 0; i < fps * 4; i++) {
      tractor.update(1 / fps, 1, 1);
      worst = Math.max(worst, penetration(tractor, grid));
    }
    assert.ok(worst <= 0.05, `${fps} fps: penetration ${worst}`);
    near(tractor.bodyX, 3 - 1.2, 0.05);
    near(tractor.bodyZ, 5 - 1.2, 0.05);
  }
});

test('turning on the spot at a wall: the swinging body pushes the pivot off, never into the wall', () => {
  const { tractor, grid } = make({ x: 0, z: 6, halfX: 10, halfZ: 1 });
  run(tractor, 3, 0, 1); // bucket against the wall
  const z0 = tractor.z;
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    tractor.update(1 / 60, 0, -1); // turn round
    worst = Math.max(worst, penetration(tractor, grid));
  }
  assert.ok(worst <= 1e-6, `penetration ${worst}`);
  assert.ok(tractor.z <= z0 + 1e-9, 'the pivot never moves toward the wall');
});

test('a long frame is split into steps: 4 fps lands where 60 fps does', () => {
  const a = make().tractor;
  const b = make().tractor;
  run(a, 2, 1, 1, 60);
  run(b, 2, 1, 1, 4);
  near(a.x, b.x, 0.1);
  near(a.z, b.z, 0.1);
  near(a.yaw, b.yaw, 1e-6);
});

test('odometer counts the distance driven', () => {
  const { tractor } = make();
  run(tractor, 2, 0, 1);
  near(tractor.odometer, tractor.z, 1e-9);
});

test('setTier switches top speed and body radius', () => {
  const { tractor } = make();
  tractor.setTier(T2);
  assert.equal(tractor.topSpeed, 8.4);
  assert.equal(tractor.bodyRadius, 1.8);
  run(tractor, 1, 0, 1);
  near(tractor.speed, 8.4);
});

test('place resets speed and wraps the heading', () => {
  const { tractor } = make();
  run(tractor, 1, 0, 1);
  tractor.place(9, -11, 3 * Math.PI);
  assert.equal(tractor.speed, 0);
  near(Math.abs(tractor.yaw), Math.PI, 1e-9);
  assert.equal(tractor.x, 9);
});
