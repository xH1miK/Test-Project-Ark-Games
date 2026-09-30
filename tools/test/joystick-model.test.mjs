import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoystickModel } from '../../assets/scripts/input/JoystickModel.ts';

const SETTINGS = { radius: 220, deadZone: 0.08, restHeight: 300, edgeMargin: 160, returnTime: 0.25 };
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

/** Portrait area 1280 x 2770 (UiFit on a 390x844 phone): bottom edge at y = -1385. */
const make = () => {
  const j = new JoystickModel(SETTINGS);
  j.setArea(1280, 2770);
  return j;
};

test('rests bottom-centre, restHeight above the bottom edge', () => {
  const j = make();
  near(j.base.x, 0);
  near(j.base.y, -1385 + 300);
  assert.equal(j.isHeld, false);
  assert.deepEqual(j.stick, { x: 0, y: 0 });
});

test('a touch away from the base moves the base under the finger', () => {
  const j = make();
  j.press(200, 100);
  near(j.base.x, 200);
  near(j.base.y, 100);
  assert.deepEqual(j.stick, { x: 0, y: 0 });
  assert.equal(j.engaged, 1);
});

test('a touch on the resting base keeps it and deflects the knob', () => {
  const j = make();
  j.press(110, -1085); // 110 right of the rest point, inside the radius
  near(j.base.x, 0);
  near(j.knob.x, 110);
  near(j.stick.x, (0.5 - 0.08) / 0.92);
  near(j.stick.y, 0);
});

test('the base keeps edgeMargin from the area edges', () => {
  const j = make();
  j.press(-640, -1385); // bottom-left corner
  near(j.base.x, -640 + 160);
  near(j.base.y, -1385 + 160);
});

test('drag: direction and amount, clamped at the radius', () => {
  const j = make();
  j.press(0, 0);
  j.drag(0, 110); // half way up
  near(j.stick.x, 0);
  near(j.stick.y, (0.5 - 0.08) / 0.92);
  j.drag(300, 400); // far beyond the radius, 3-4-5 direction
  near(j.knob.x, 220 * 0.6);
  near(j.knob.y, 220 * 0.8);
  near(Math.hypot(j.stick.x, j.stick.y), 1);
  near(j.stick.x / j.stick.y, 0.75);
});

test('dead zone: tiny deflections read as zero', () => {
  const j = make();
  j.press(0, 0);
  j.drag(15, 0); // 0.068 of the radius
  assert.deepEqual(j.stick, { x: 0, y: 0 });
  near(j.knob.x, 15); // the knob still shows the finger
});

test('release zeroes the stick and glides back to rest', () => {
  const j = make();
  j.press(300, 200);
  j.drag(300, 420);
  j.release();
  assert.deepEqual(j.stick, { x: 0, y: 0 });
  assert.equal(j.isHeld, false);
  for (let t = 0; t < 0.25; t += 1 / 60) j.update(1 / 60);
  // About 95% of the way back after returnTime.
  assert.ok(Math.abs(j.base.x) < 0.06 * 300, `base x ${j.base.x}`);
  assert.ok(Math.abs(j.base.y - -1085) < 0.06 * 1285, `base y ${j.base.y}`);
  assert.ok(Math.abs(j.knob.y) < 0.06 * 220, `knob ${j.knob.y}`);
  assert.ok(j.engaged < 0.06, `engaged ${j.engaged}`);
  for (let t = 0; t < 2; t += 1 / 60) j.update(1 / 60);
  near(j.base.y, -1085, 1e-3);
});

test('drag without a press does nothing; update while held does not move the base', () => {
  const j = make();
  j.drag(100, 100);
  assert.deepEqual(j.stick, { x: 0, y: 0 });
  j.press(300, 0);
  j.update(1);
  near(j.base.x, 300);
});

test('resize moves the rest point: a released base jumps there, a held one stays', () => {
  const j = make();
  j.setArea(4926, 2276); // landscape
  near(j.base.y, -1138 + 300);
  j.press(500, 0);
  j.setArea(1280, 2770);
  near(j.base.x, 500);
  j.release();
  for (let t = 0; t < 3; t += 1 / 60) j.update(1 / 60);
  near(j.base.y, -1385 + 300, 1e-3);
});

test('insets: the rest point is centred in the safe area and lifted above the bottom gap', () => {
  const j = make();
  j.setInsets(120, 40, 60, 110);
  near(j.base.x, (120 - 40) / 2);
  near(j.base.y, -1385 + 110 + 300);
  j.setInsets(0, 0, 0, 0);
  near(j.base.x, 0);
  near(j.base.y, -1385 + 300);
});

test('insets: a touch never puts the base nearer the safe area\'s edge than the margin', () => {
  const j = make();
  j.setInsets(100, 60, 80, 90);
  // Far into the bottom-left corner of the area: the base stops at the safe area's edge + the margin.
  j.press(-640, -1385);
  near(j.base.x, -640 + 100 + SETTINGS.edgeMargin);
  near(j.base.y, -1385 + 90 + SETTINGS.edgeMargin);
  j.release();
  j.press(640, 1385);
  near(j.base.x, 640 - 60 - SETTINGS.edgeMargin);
  near(j.base.y, 1385 - 80 - SETTINGS.edgeMargin);
});

test('insets: a released base glides to the new rest point; a held one stays where the finger put it', () => {
  const j = make();
  j.press(200, 300);
  const held = { x: j.base.x, y: j.base.y };
  j.setInsets(0, 0, 0, 200);
  assert.deepEqual({ x: j.base.x, y: j.base.y }, held);
  j.release();
  for (let i = 0; i < 200; i++) j.update(0.016);
  near(j.base.y, -1385 + 200 + 300, 1e-3);
});
