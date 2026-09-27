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
