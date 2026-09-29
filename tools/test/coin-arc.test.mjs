import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { coinPose } from '../../assets/scripts/fx/CoinArc.ts';
import { CoinFlights } from '../../assets/scripts/economy/CoinFlights.ts';

const S = Config.coinFx.sprite;
const pose = () => ({ x: 0, y: 0, rot: 0, size: 0 });

test('coin arc: starts at a, ends at b, monotone along the chord for lane 0, and clamps t', () => {
  const p = pose();
  coinPose(p, S, 0, 0.3, 10, 20, 400, -300);
  assert.equal(p.x, 10);
  assert.equal(p.y, 20);
  assert.equal(p.size, S.size * S.startScale);
  coinPose(p, S, 1, 0.3, 10, 20, 400, -300);
  assert.ok(Math.abs(p.x - 400) < 1e-9 && Math.abs(p.y + 300) < 1e-9);
  assert.equal(p.size, S.size);
  assert.equal(p.rot, S.spin);
  coinPose(p, S, 2, 0, 10, 20, 400, -300);
  assert.equal(p.x, 400);
  let last = -1;
  for (let t = 0; t <= 1; t += 0.05) {
    coinPose(p, S, t, 0, 0, 0, 100, 0);
    assert.ok(p.x >= last - 1e-9 && Math.abs(p.y) < 1e-9);
    last = p.x;
  }
});

test('coin arc: lanes bulge to opposite sides of the chord by at most arc/2; the mid-flight size is the pop', () => {
  const a = pose();
  const b = pose();
  coinPose(a, S, 0.5, 1, 0, 0, 400, 0);
  coinPose(b, S, 0.5, -1, 0, 0, 400, 0);
  assert.ok(Math.abs(a.y + b.y) < 1e-9 && Math.abs(a.y - S.arc / 2) < 1e-9);
  assert.ok(Math.abs(a.size - S.size * S.pop) < 1e-9);
  // No NaN for a zero-length chord.
  coinPose(a, S, 0.4, 1, 5, 5, 5, 5);
  assert.ok(Number.isFinite(a.x + a.y + a.size));
});

test('coin flights: a payout fans its coins out over the lanes', () => {
  const got = [];
  const f = new CoinFlights(Config.coinFx, { add: (n) => got.push(n) });
  f.launch(12, 0, 0, 0);
  const lanes = f.coins.slice(0, f.count).map((c) => c.lane);
  assert.equal(lanes.length, Config.coinFx.spritesPerPayout);
  assert.equal(Math.min(...lanes), -1);
  assert.equal(Math.max(...lanes), 1);
  f.update(2);
  assert.equal(got.reduce((a, b) => a + b, 0), 12);
});
