import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { PuffKind, Puffs } from '../../assets/scripts/fx/Puffs.ts';
import { FLOATS_PER_QUAD, FLOATS_PER_VERTEX, quadIndices, writeQuads } from '../../assets/scripts/fx/PuffQuads.ts';

const C = Config.puffs;
const R = C.recipes;
const LOOK = { colors: [C.dust.color, C.spark.color], tiles: [{ u0: 0, u1: 0.5 }, { u0: 0.5, u1: 1 }] };

test('puffs: emit makes the asked count on a ring, flying outward; a full pool skips the rest', () => {
  const p = new Puffs({ ...C, capacity: 20 });
  assert.equal(p.emit(R.upgrade, 5, 0, -3), 12);
  assert.equal(p.count, 12);
  for (let i = 0; i < p.capacity; i++) {
    if (!p.live[i]) continue;
    const d = Math.hypot(p.x[i] - 5, p.z[i] + 3);
    assert.ok(d >= R.upgrade.ring * 0.7 - 1e-4 && d <= R.upgrade.ring + 1e-4, `on the ring (${d})`);
    assert.ok(Math.abs(p.y[i] - R.upgrade.y) < 1e-6);
    assert.equal(p.kind[i], PuffKind.Dust);
  }
  assert.equal(p.emit(R.upgrade, 0, 0, 0), 8, 'only 8 slots left');
  assert.equal(p.count, 20);
  assert.equal(p.emit(R.landing, 0, 0, 0), 0);
});

test('puffs: a puff waits for its delay, lives its life and leaves; dust rises and spreads, alpha fades in then out', () => {
  const p = new Puffs(C);
  p.emit(R.gate, 1.17, 0, -14.4);
  assert.equal(p.count, R.gate.count);
  assert.ok(p.kind.every((k, i) => !p.live[i] || k === PuffKind.Spark));
  let visibleMax = 0;
  let t = 0;
  const dt = 1 / 60;
  while (p.count > 0 && t < 5) {
    p.update(dt);
    t += dt;
    let v = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.visible(i)) continue;
      v++;
      assert.ok(p.alpha(i) >= 0 && p.alpha(i) <= C.spark.alpha + 1e-9);
      assert.ok(Number.isFinite(p.x[i] + p.y[i] + p.z[i] + p.size(i) + p.rotation(i)));
    }
    visibleMax = Math.max(visibleMax, v);
  }
  assert.equal(p.count, 0);
  assert.ok(t <= R.gate.delay + R.gate.life[1] + 2 * dt, `all gone by delay + life (${t})`);
  assert.ok(visibleMax > R.gate.count * 0.5, `most are in the air together (${visibleMax})`);

  const d = new Puffs(C);
  d.emit({ ...R.upgrade, delay: 0 }, 0, 0, 0, 1);
  const i = d.live.findIndex((v) => v === 1);
  const y0 = d.y[i];
  const r0 = Math.hypot(d.x[i], d.z[i]);
  const a0 = d.alpha(i);
  const peak = [];
  for (let k = 0; k < 30; k++) { d.update(dt); peak.push(d.alpha(i)); }
  assert.ok(a0 < peak[10], 'fades in');
  assert.ok(d.y[i] > y0 && Math.hypot(d.x[i], d.z[i]) > r0, 'rises and spreads');
  assert.ok(d.size(i) > 0);
  // Same seed, same puffs.
  const e = new Puffs(C);
  const f = new Puffs(C);
  e.emit(R.landing, 1, 2, 3);
  f.emit(R.landing, 1, 2, 3);
  assert.deepEqual([...e.x], [...f.x]);
});

test('puff quads: only visible puffs, packed; corners a right/up square of the puff size round its centre; index buffer is 2 triangles a quad', () => {
  const p = new Puffs(C);
  p.emit({ ...R.upgrade, delay: 0 }, 0, 0, 0, 3);
  p.emit({ ...R.gate, delay: 5 }, 0, 0, 0, 2);
  p.update(0.1);
  const out = new Float32Array(p.capacity * FLOATS_PER_QUAD);
  // Camera axes: right = +x, up = +y.
  const q = writeQuads(out, p, LOOK, 1, 0, 0, 0, 1, 0);
  assert.equal(q, 3, 'the two waiting sparks are left out');
  for (let k = 0; k < q; k++) {
    const o = k * FLOATS_PER_QUAD;
    const xs = [0, 1, 2, 3].map((v) => out[o + v * FLOATS_PER_VERTEX]);
    const ys = [0, 1, 2, 3].map((v) => out[o + v * FLOATS_PER_VERTEX + 1]);
    const zs = [0, 1, 2, 3].map((v) => out[o + v * FLOATS_PER_VERTEX + 2]);
    // A turned square: its diagonal is size * sqrt(2), its z is the puff's z on all four.
    const diag = Math.hypot(xs[0] - xs[2], ys[0] - ys[2]);
    assert.ok(Math.abs(zs[0] - zs[3]) < 1e-6 && Math.abs(zs[1] - zs[2]) < 1e-6);
    const cx = xs.reduce((a, b) => a + b) / 4;
    const cy = ys.reduce((a, b) => a + b) / 4;
    const alpha = out[o + 8];
    assert.ok(alpha > 0 && alpha <= 1);
    assert.ok(diag > 0.1 && Number.isFinite(cx + cy));
    // uv inside the dust tile; colour = the dust's.
    for (let v = 0; v < 4; v++) {
      const u = out[o + v * FLOATS_PER_VERTEX + 3];
      assert.ok(u >= 0 && u <= 0.5);
      assert.ok(Math.abs(out[o + v * FLOATS_PER_VERTEX + 5] - C.dust.color[0] / 255) < 1e-6);
    }
  }
  const idx = quadIndices(4);
  assert.equal(idx.length, 24);
  assert.deepEqual([...idx.slice(6, 12)], [4, 5, 6, 4, 6, 7]);
});
