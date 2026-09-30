import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFrame } from '../../assets/scripts/ui/FrameFit.ts';

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

test('portrait phone: frame width kept, height grows', () => {
  const r = fitFrame(390, 844, 1280, 2276);
  near(r.width, 1280);
  near(r.height, (844 * 1280) / 390);
});

test('landscape phone: frame height kept, width grows', () => {
  const r = fitFrame(844, 390, 1280, 2276);
  near(r.height, 2276);
  near(r.width, (844 * 2276) / 390);
});

test('exact frame aspect: the frame itself', () => {
  const r = fitFrame(640, 1138, 1280, 2276);
  near(r.width, 1280);
  near(r.height, 2276);
});

import { safeInsets } from '../../assets/scripts/ui/FrameFit.ts';

test('safe insets: a screen with no cut-out has none', () => {
  assert.deepEqual(safeInsets({ x: 0, y: 0, width: 1280, height: 2770 }, 1280, 2770), { left: 0, right: 0, top: 0, bottom: 0 });
});

test('safe insets: the gaps are the design area minus the safe rectangle (origin bottom-left)', () => {
  // A notch on top (150), a home indicator at the bottom (110), rounded sides (20 / 30).
  const r = safeInsets({ x: 20, y: 110, width: 1230, height: 2770 - 150 - 110 }, 1280, 2770);
  assert.deepEqual(r, { left: 20, right: 30, top: 150, bottom: 110 });
});

test('safe insets: never negative, and rounding noise counts as none', () => {
  const r = safeInsets({ x: -3, y: 0.004, width: 1283.004, height: 2770 }, 1280, 2770);
  assert.deepEqual(r, { left: 0, right: 0, top: 0, bottom: 0 });
});
