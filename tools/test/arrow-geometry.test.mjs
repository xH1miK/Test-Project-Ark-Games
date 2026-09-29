import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARROW_SHAPE, buildArrowGeometry } from '../../assets/scripts/tutorial/ArrowGeometry.ts';

const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

test('arrow geometry: sizes of the arrays agree, indices are in range, the bounds are the arrow', () => {
  const g = buildArrowGeometry();
  const count = g.positions.length / 3;
  assert.equal(g.normals.length, count * 3);
  assert.equal(g.uvs.length, count * 2);
  assert.equal(g.indices.length % 3, 0);
  assert.ok(g.indices.every((i) => Number.isInteger(i) && i >= 0 && i < count));
  const xs = g.positions.filter((_, k) => k % 3 === 0);
  const ys = g.positions.filter((_, k) => k % 3 === 1);
  const zs = g.positions.filter((_, k) => k % 3 === 2);
  near(Math.min(...zs), 0);
  near(Math.max(...zs), ARROW_SHAPE.shaftLength + ARROW_SHAPE.headLength);
  near(Math.max(...xs), ARROW_SHAPE.headRadius);
  near(Math.min(...xs), -ARROW_SHAPE.headRadius);
  near(Math.max(...ys), ARROW_SHAPE.headRadius, 0.06); // 16 segments: a vertex at 90 degrees exists
  assert.deepEqual([g.minPos.z, g.maxPos.z], [0, ARROW_SHAPE.shaftLength + ARROW_SHAPE.headLength]);
  assert.ok(g.boundingRadius >= Math.hypot(ARROW_SHAPE.headRadius, ARROW_SHAPE.headRadius, (ARROW_SHAPE.shaftLength + ARROW_SHAPE.headLength) / 2) - 1e-9);
  assert.ok(count < 200, `a light mesh (${count} vertices)`);
});

test('arrow geometry: unit normals, every triangle counter-clockwise seen from outside (its face normal agrees with its vertex normals)', () => {
  const g = buildArrowGeometry();
  for (let v = 0; v < g.normals.length; v += 3) near(Math.hypot(g.normals[v], g.normals[v + 1], g.normals[v + 2]), 1, 1e-9);
  const at = (i) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
  const nrm = (i) => [g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]];
  let area = 0;
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
    const [pa, pb, pc] = [at(a), at(b), at(c)];
    const u = pb.map((v, k) => v - pa[k]);
    const w = pc.map((v, k) => v - pa[k]);
    const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const size = Math.hypot(...face);
    assert.ok(size > 1e-9, `triangle ${t / 3} is not degenerate`);
    area += size / 2;
    const avg = [0, 1, 2].map((k) => nrm(a)[k] + nrm(b)[k] + nrm(c)[k]);
    const dot = (face[0] * avg[0] + face[1] * avg[1] + face[2] * avg[2]) / (size * Math.hypot(...avg));
    assert.ok(dot > 0.5, `triangle ${t / 3} faces ${dot.toFixed(2)} of its normals (winding)`);
  }
  // The surface of a shaft + head (tail cap, side, underside, cone): a rough check on the area.
  const { shaftRadius: rs, shaftLength: ls, headRadius: rh, headLength: lh } = ARROW_SHAPE;
  const exact = Math.PI * rs * rs + 2 * Math.PI * rs * ls + Math.PI * (rh * rh - rs * rs) + Math.PI * rh * Math.hypot(rh, lh);
  assert.ok(Math.abs(area - exact) / exact < 0.03, `area ${area.toFixed(3)} vs ${exact.toFixed(3)}`);
});

test('arrow geometry: the cone is the widest part and the tip is a point on the axis', () => {
  const g = buildArrowGeometry();
  const tip = [];
  for (let v = 0; v < g.positions.length; v += 3) {
    if (Math.abs(g.positions[v + 2] - (ARROW_SHAPE.shaftLength + ARROW_SHAPE.headLength)) < 1e-9) tip.push([g.positions[v], g.positions[v + 1]]);
  }
  assert.ok(tip.length > 0 && tip.every(([x, y]) => x === 0 && y === 0), 'every vertex at the top is the apex');
});
