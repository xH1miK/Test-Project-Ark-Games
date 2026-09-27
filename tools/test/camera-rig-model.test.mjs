import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraRigModel } from '../../assets/scripts/camera/CameraRigModel.ts';

const SETTINGS = { offset: { x: 17.08, y: 24.15, z: 17.08 }, pitch: -45, yaw: 45, smoothTime: 0.18 };
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

test('snap puts the camera at target + offset', () => {
  const c = new CameraRigModel(SETTINGS);
  c.snap(9, 0, -11);
  near(c.position.x, 26.08);
  near(c.position.y, 24.15);
  near(c.position.z, 6.08);
  assert.equal(c.pitch, -45);
  assert.equal(c.yaw, 45);
});

test('follow trails the target and settles without overshoot', () => {
  const c = new CameraRigModel(SETTINGS);
  c.snap(0, 0, 0);
  const dt = 1 / 60;
  c.update(dt, 10, 0, 0);
  assert.ok(c.focus.x > 0 && c.focus.x < 2, `first frame moves a little: ${c.focus.x}`);
  let maxX = 0;
  let t = dt;
  for (; t < 0.18; t += dt) c.update(dt, 10, 0, 0);
  assert.ok(c.focus.x > 5 && c.focus.x < 9.5, `after smoothTime most of the way: ${c.focus.x}`);
  for (; t < 2; t += dt) {
    c.update(dt, 10, 0, 0);
    maxX = Math.max(maxX, c.focus.x);
  }
  near(c.focus.x, 10, 1e-3);
  assert.ok(maxX <= 10 + 1e-3, `overshoot ${maxX}`);
  near(c.position.x, 10 + 17.08, 1e-3);
});

test('same result at 60 and 20 fps (frame-rate independent)', () => {
  const run = (fps) => {
    const c = new CameraRigModel(SETTINGS);
    c.snap(0, 0, 0);
    for (let i = 0; i < fps * 0.3; i++) c.update(1 / fps, 4, 0, -4);
    return c.focus;
  };
  const a = run(60);
  const b = run(20);
  near(a.x, b.x, 0.05);
  near(a.z, b.z, 0.05);
});

test('zoomTo eases the offset over the duration (smoothstep)', () => {
  const c = new CameraRigModel(SETTINGS);
  c.snap(0, 0, 0);
  c.zoomTo(1.2, 0.5);
  c.update(0.25, 0, 0, 0);
  near(c.zoom, 1.1, 1e-9); // smoothstep(0.5) = 0.5
  c.update(0.25, 0, 0, 0);
  near(c.zoom, 1.2);
  near(c.position.y, 24.15 * 1.2);
  c.update(1, 0, 0, 0);
  near(c.zoom, 1.2);
  c.zoomTo(1, 0);
  near(c.zoom, 1);
});
