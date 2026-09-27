import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';

const BOUNDS = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

const grid = (...shapes) => {
  const g = new ObstacleGrid(BOUNDS, 1);
  for (const [shape, mask] of shapes) g.add(shape, mask);
  return g;
};

test('circle is pushed out of a circle along the centre line', () => {
  const g = grid([{ kind: 'circle', x: 0, z: 0, radius: 2 }]);
  const out = { x: 0, z: 0 };
  const depth = g.resolveCircle(2.5, 0, 1, Blocks.All, out);
  near(depth, 0.5);
  near(out.x, 3);
  near(out.z, 0);
});

test('free circle is left alone', () => {
  const g = grid([{ kind: 'circle', x: 0, z: 0, radius: 2 }]);
  const out = { x: 0, z: 0 };
  assert.equal(g.resolveCircle(3.5, 0, 1, Blocks.All, out), 0);
  near(out.x, 3.5);
});

test('rotated box: the push respects the Cocos Y rotation', () => {
  // halfX 3 along local X; rotated 90deg local X runs along world -Z, so the box spans z -3..3, x -1..1.
  const g = grid([{ kind: 'box', x: 0, z: 0, halfX: 3, halfZ: 1, angle: Math.PI / 2 }]);
  const out = { x: 0, z: 0 };
  near(g.resolveCircle(1.5, 0, 1, Blocks.All, out), 0.5); // touches the long side at x = 1
  near(out.x, 2, 1e-9);
  near(out.z, 0, 1e-9);
  assert.equal(g.overlapsCircle(0, 3.9, 0.8, Blocks.All), false); // beyond the far end (z = 3)
  assert.equal(g.overlapsCircle(0, 3.7, 0.8, Blocks.All), true);
});

test('centre inside a box leaves through the nearest face', () => {
  const g = grid([{ kind: 'box', x: 0, z: 0, halfX: 4, halfZ: 1, angle: 0 }]);
  const out = { x: 0, z: 0 };
  g.resolveCircle(3, 0.2, 0.5, Blocks.All, out); // 0.8 to the z = +1 face, 1.0 to the x = +4 face
  near(out.x, 3);
  near(out.z, 1.5); // one radius beyond the nearest face
  g.resolveCircle(3.5, 0.2, 0.5, Blocks.All, out); // now the x face is nearer (0.5)
  near(out.x, 4.5);
  near(out.z, 0.2);
});

test('mask filters obstacles (tractor-only blocker lets balls through)', () => {
  const g = grid([{ kind: 'circle', x: 0, z: 0, radius: 1 }, Blocks.Tractor]);
  assert.equal(g.overlapsCircle(0.5, 0, 0.3, Blocks.Balls), false);
  assert.equal(g.overlapsCircle(0.5, 0, 0.3, Blocks.Tractor), true);
});

test('disabled obstacle does not collide', () => {
  const g = grid([{ kind: 'box', x: 0, z: 0, halfX: 1, halfZ: 1, angle: 0 }]);
  g.setEnabled(0, false);
  assert.equal(g.overlapsCircle(0, 0, 0.5, Blocks.All), false);
  g.setEnabled(0, true);
  assert.equal(g.overlapsCircle(0, 0, 0.5, Blocks.All), true);
});

test('an obstacle spanning many cells is resolved once per query', () => {
  const g = grid([{ kind: 'box', x: 0, z: 0, halfX: 10, halfZ: 0.5, angle: 0 }]);
  const out = { x: 0, z: 0 };
  near(g.resolveCircle(0, 1.2, 1, Blocks.All, out), 0.3);
  near(out.z, 1.5);
});

test('queries outside the bounds hit edge cells and do not throw', () => {
  const g = grid([{ kind: 'circle', x: 25, z: 0, radius: 2 }]); // centre beyond maxX
  assert.equal(g.overlapsCircle(24, 0, 0.5, Blocks.All), true);
  assert.equal(g.overlapsCircle(-40, -40, 0.5, Blocks.All), false);
});

test('two passes settle a circle wedged into a corner', () => {
  const g = grid(
    [{ kind: 'box', x: 0, z: -1, halfX: 5, halfZ: 1, angle: 0 }], // floor wall z in [-2, 0]
    [{ kind: 'box', x: -1, z: 0, halfX: 1, halfZ: 5, angle: 0 }], // side wall x in [-2, 0]
  );
  const p = { x: 0.2, z: 0.2 };
  for (let pass = 0; pass < 2; pass++) g.resolveCircle(p.x, p.z, 0.5, Blocks.All, p);
  assert.equal(g.overlapsCircle(p.x, p.z, 0.5 - 1e-6, Blocks.All), false);
});
