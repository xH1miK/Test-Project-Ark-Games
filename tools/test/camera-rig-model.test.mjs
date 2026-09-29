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

const ASPECT = { ...SETTINGS, aspect: { ref: 0.5625, power: 0.5, min: 0.75, max: 1.15 } };
const PEEK = { share: 0.5, zoom: 1.2, inTime: 0.4, holdTime: 0.5, outTime: 0.6 };

test('aspect: the offset scales by (ref / aspect) ^ power within [min, max]: out on a tall phone, in on a wide one', () => {
  const c = new CameraRigModel(ASPECT);
  c.setAspect(0.5625);
  near(c.framing, 1);
  c.setAspect(390 / 844);
  near(c.framing, Math.sqrt(0.5625 / (390 / 844)));
  assert.ok(c.framing > 1 && c.framing <= 1.15);
  c.setAspect(844 / 390);
  near(c.framing, 0.75);
  c.setAspect(0.2);
  near(c.framing, 1.15);
  c.setAspect(0);
  near(c.framing, 1.15, 1e-12);
  c.setAspect(390 / 844);
  c.snap(0, 0, 0);
  near(c.position.y, 24.15 * c.framing);
  // A model without the setting ignores the aspect.
  const d = new CameraRigModel(SETTINGS);
  d.setAspect(3);
  near(d.framing, 1);
});

test('peek: leans toward the point by share, pulls out by zoom, holds, comes back, then is over', () => {
  const c = new CameraRigModel(ASPECT);
  c.snap(0, 0, 0);
  // At 60 fps the follow spring settles inside the hold: the focus sits at target + share * (point - target).
  c.peek(10, -6, PEEK);
  let t = 0;
  const dt = 1 / 60;
  let maxBoost = 1;
  while (t < PEEK.inTime + 0.45) { c.update(dt, 0, 0, 0); t += dt; maxBoost = Math.max(maxBoost, c.boost); }
  near(c.peekWeight, 1);
  near(c.boost, PEEK.zoom, 1e-9);
  near(c.focus.x, 5, 0.05);
  near(c.focus.z, -3, 0.05);
  near(c.position.y - c.focus.y, 24.15 * PEEK.zoom, 1e-9);
  while (t < PEEK.inTime + PEEK.holdTime + PEEK.outTime + 1.5) { c.update(dt, 0, 0, 0); t += dt; }
  near(c.peekWeight, 0);
  near(c.boost, 1);
  near(c.focus.x, 0, 0.01);
  // The weight only rises then falls.
  const w = new CameraRigModel(ASPECT);
  w.peek(1, 1, PEEK);
  let last = 0;
  let rising = true;
  for (let k = 0; k < 200; k++) {
    w.update(dt, 0, 0, 0);
    const x = w.peekWeight;
    if (x < last - 1e-12) rising = false;
    if (!rising) assert.ok(x <= last + 1e-12, 'never rises again after it starts to fall');
    last = x;
  }
  near(last, 0);
});

test('peek with an endless hold stays; a new peek replaces the one in progress; the tier zoom multiplies', () => {
  const c = new CameraRigModel(ASPECT);
  c.snap(0, 0, 0);
  c.zoomTo(1.2, 0);
  c.peek(4, 0, { ...PEEK, holdTime: Infinity });
  for (let k = 0; k < 60 * 20; k++) c.update(1 / 60, 0, 0, 0);
  near(c.peekWeight, 1);
  near(c.focus.x, 2, 0.01);
  near(c.position.y - c.focus.y, 24.15 * 1.2 * PEEK.zoom, 1e-9);
  c.peek(-4, 0, PEEK);
  near(c.peekWeight, 0);
});
