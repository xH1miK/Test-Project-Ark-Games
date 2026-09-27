import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoveInput } from '../../assets/scripts/input/MoveInput.ts';

const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);
const H = Math.SQRT1_2;

test('no camera yaw: stick up drives toward -Z, right toward +X', () => {
  const m = new MoveInput();
  m.setFromStick(0, 1, 0);
  near(m.x, 0);
  near(m.z, -1);
  m.setFromStick(1, 0, 0);
  near(m.x, 1);
  near(m.z, 0);
});

test('isometric camera (yaw 45): stick up drives away from the camera', () => {
  // The camera sits at +X +Z from its target and looks toward -X -Z.
  const m = new MoveInput();
  m.setFromStick(0, 1, 45);
  near(m.x, -H);
  near(m.z, -H);
  m.setFromStick(1, 0, 45); // screen right
  near(m.x, H);
  near(m.z, -H);
  m.setFromStick(0.3, -0.4, 45); // length is kept
  near(Math.hypot(m.x, m.z), 0.5);
});

test('override wins over the joystick until release', () => {
  const m = new MoveInput();
  m.override(3, 4);
  assert.equal(m.isOverridden, true);
  near(m.x, 0.6); // cut to length 1
  near(m.z, 0.8);
  m.setFromStick(0, 1, 45);
  near(m.x, 0.6);
  m.override(0.2, 0);
  near(m.x, 0.2); // shorter than 1 stays as is
  m.release();
  assert.equal(m.isOverridden, false);
  assert.equal(m.x, 0);
  m.setFromStick(0, 1, 0);
  near(m.z, -1);
});
