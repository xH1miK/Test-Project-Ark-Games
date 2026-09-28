import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import {
  BallQuads, DYNAMIC_STRIDE, INDICES_PER_BALL, STATIC_STRIDE, VERTS_PER_BALL,
} from '../../assets/scripts/balls/BallQuads.ts';
import { CARPET_ROUTE, autopilot, frame, makeWorld } from './ball-world.mjs';

const R = Config.balls.radius;
const LOOK = { sizeJitter: 0.05, shadeJitter: 0.04, seed: 3 };

/** A hand-made ball source: positions plus a moved list. */
const source = (n) => ({
  count: n,
  x: new Float64Array(n), y: new Float64Array(n).fill(R), z: new Float64Array(n),
  moved: new Int32Array(n), movedCount: 0,
});
const move = (src, i, dx, dz) => {
  src.x[i] += dx;
  src.z[i] += dz;
  src.moved[src.movedCount++] = i;
};

/** Rotates v by the unit quaternion q = [x, y, z, w]. */
const rotate = (q, v) => {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
};
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const spinOf = (quads, i) => Array.from(quads.spin.subarray(4 * i, 4 * i + 4));
const close = (a, b, eps, msg) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < eps, `${msg}: ${a} vs ${b}`));

test('static stream: four corners and two triangles per ball; size and shade within their spreads; seeded', () => {
  const quads = new BallQuads(10, R, LOOK);
  assert.equal(quads.staticBytes.length, 10 * VERTS_PER_BALL * STATIC_STRIDE);
  assert.equal(quads.dynamicBytes.byteLength, 10 * VERTS_PER_BALL * DYNAMIC_STRIDE);
  for (let i = 0; i < 10; i++) {
    const corners = [];
    for (let k = 0; k < 4; k++) {
      const s = (4 * i + k) * STATIC_STRIDE;
      corners.push([quads.staticBytes[s] / 255, quads.staticBytes[s + 1] / 255]);
      const shade = 0.5 + quads.staticBytes[s + 2] / 255;
      assert.ok(Math.abs(shade - 1) <= LOOK.shadeJitter + 1 / 255, `shade ${shade}`);
    }
    assert.deepEqual(corners, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    assert.deepEqual(Array.from(quads.indices.subarray(6 * i, 6 * i + 6)), [0, 1, 2, 0, 2, 3].map((k) => 4 * i + k));
    assert.ok(Math.abs(quads.radius[i] / R - 1) <= LOOK.sizeJitter + 1e-6);
    const q = spinOf(quads, i);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-12, 'orientation is a unit quaternion');
  }
  assert.equal(quads.indices.length, 10 * INDICES_PER_BALL);
  const again = new BallQuads(10, R, LOOK);
  assert.deepEqual(again.radius, quads.radius);
  assert.deepEqual(again.spin, quads.spin);
  assert.notDeepEqual(new BallQuads(10, R, { ...LOOK, seed: 4 }).spin, quads.spin, 'another seed, other orientations');
});

test('writeAll writes every ball; slots past the count are hidden (radius 0)', () => {
  const quads = new BallQuads(5, R, LOOK);
  const src = source(3);
  src.x.set([1, 2, 3]);
  src.z.set([-1, -2, -3]);
  quads.writeAll(src);
  const b = { x: 0, y: 0, z: 0, radius: 0 };
  for (let i = 0; i < 3; i++) {
    quads.readBall(i, b);
    assert.deepEqual([b.x, b.y, b.z], [i + 1, Math.fround(R), -(i + 1)]);
    assert.equal(b.radius, quads.radius[i]);
  }
  for (const i of [3, 4]) {
    quads.readBall(i, b);
    assert.equal(b.radius, 0);
  }
  // All four vertices of a ball carry the same data.
  const f = new Float32Array(quads.dynamicBytes);
  const stride = DYNAMIC_STRIDE / 4;
  for (let k = 1; k < 4; k++) assert.deepEqual(Array.from(f.subarray(k * stride, k * stride + 4)), Array.from(f.subarray(0, 4)));
});

test('writeMoved rewrites only the balls in the moved list', () => {
  const quads = new BallQuads(4, R, LOOK);
  const src = source(4);
  quads.writeAll(src);
  const before = new Uint8Array(quads.dynamicBytes.slice(0));
  for (let i = 0; i < 4; i++) src.x[i] += 1; // every ball moved, but only 1 and 3 are listed
  src.moved[0] = 1;
  src.moved[1] = 3;
  src.movedCount = 2;
  assert.equal(quads.writeMoved(src), 2);
  const after = new Uint8Array(quads.dynamicBytes);
  const perBall = VERTS_PER_BALL * DYNAMIC_STRIDE;
  for (let i = 0; i < 4; i++) {
    const changed = after.subarray(i * perBall, (i + 1) * perBall).some((v, k) => v !== before[i * perBall + k]);
    assert.equal(changed, i === 1 || i === 3, `ball ${i}`);
  }
  src.movedCount = 0;
  assert.equal(quads.writeMoved(src), 0, 'nothing moved, nothing to upload');
});

test('rolling: a quarter turn per quarter circumference, the top rolls forward along the way', () => {
  for (const [dx, dz, ahead] of [[1, 0, [1, 0, 0]], [0, 1, [0, 0, 1]], [-1, 0, [-1, 0, 0]], [Math.SQRT1_2, -Math.SQRT1_2, [Math.SQRT1_2, 0, -Math.SQRT1_2]]]) {
    const quads = new BallQuads(1, R, LOOK);
    const src = source(1);
    quads.writeAll(src);
    const r = quads.radius[0];
    // The ball's own point that is on top now: after a quarter circumference it faces the way ahead.
    const top = rotate(conj(spinOf(quads, 0)), [0, 1, 0]);
    const way = (Math.PI / 2) * r;
    move(src, 0, dx * way, dz * way);
    quads.writeMoved(src);
    close(rotate(spinOf(quads, 0), top), ahead, 1e-9, `rolled toward (${dx}, ${dz})`);
    // A point on the axis (up × way) does not move.
    const axis = [dz, 0, -dx];
    const local = rotate(conj(spinOf(quads, 0)), axis);
    close(rotate(spinOf(quads, 0), local), axis, 1e-9, 'axis point');
  }
});

test('rolling in steps along a line adds up to one roll; vertical moves and tiny jitter do not roll', () => {
  const one = new BallQuads(1, R, LOOK);
  const many = new BallQuads(1, R, LOOK);
  const a = source(1);
  const b = source(1);
  one.writeAll(a);
  many.writeAll(b);
  move(a, 0, 0.9, -0.4);
  one.writeMoved(a);
  for (let k = 0; k < 30; k++) {
    move(b, 0, 0.03, -0.4 / 30);
    many.writeMoved(b);
    b.movedCount = 0;
  }
  close(spinOf(many, 0), spinOf(one, 0), 1e-9, 'stepwise roll');

  const still = new BallQuads(1, R, LOOK);
  const c = source(1);
  still.writeAll(c);
  const q0 = spinOf(still, 0);
  c.y[0] += 0.5; // a fall is not a roll
  c.x[0] += 1e-7; // nor is sub-pixel jitter
  c.moved[0] = 0;
  c.movedCount = 1;
  still.writeMoved(c);
  assert.deepEqual(spinOf(still, 0), q0);
  // ...but a creep of tiny moves adds up to the same roll as one move.
  const creep = new BallQuads(1, R, LOOK);
  const d = source(1);
  creep.writeAll(d);
  for (let k = 0; k < 400; k++) {
    move(d, 0, 5e-6, 0);
    creep.writeMoved(d);
    d.movedCount = 0;
  }
  const jump = new BallQuads(1, R, LOOK);
  const e = source(1);
  jump.writeAll(e);
  move(e, 0, 400 * 5e-6, 0);
  jump.writeMoved(e);
  // Up to one roll threshold (1e-5 of way) may still be pending; a lost creep would differ by ~4e-3.
  close(spinOf(creep, 0), spinOf(jump, 0), 5e-5, 'creep');
});

test('the uploaded quaternion is the orientation in normalised int16', () => {
  const quads = new BallQuads(3, R, LOOK);
  const src = source(3);
  quads.writeAll(src);
  move(src, 2, 0.7, 0.2);
  quads.writeMoved(src);
  const shorts = new Int16Array(quads.dynamicBytes);
  const perVert = DYNAMIC_STRIDE / 2;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 4; k++) {
      const s = (4 * i + k) * perVert + 8;
      const q = Array.from(shorts.subarray(s, s + 4), (v) => v / 32767);
      close(q, spinOf(quads, i), 1 / 32767, `ball ${i} vertex ${k}`);
    }
  }
});

test('a drive through the real carpet: after each frame the quads show every ball where the field has it', () => {
  const world = makeWorld();
  const { balls } = world;
  const quads = new BallQuads(balls.capacity, world.settings.radius, LOOK);
  quads.writeAll(balls);
  const steer = autopilot(CARPET_ROUTE.slice(0, 3));
  const b = { x: 0, y: 0, z: 0, radius: 0 };
  let rewritten = 0;
  let frames = 0;
  for (let stick = steer(world.tractor); stick && frames < 1500; stick = steer(world.tractor), frames++) {
    frame(world, 1 / 30, stick.x, stick.z);
    rewritten += quads.writeMoved(balls);
    balls.clearMoved();
  }
  assert.ok(frames > 100 && rewritten > 1000, `the drive moved balls (${rewritten} ball rewrites in ${frames} frames)`);
  let worst = 0;
  for (let i = 0; i < balls.count; i++) {
    quads.readBall(i, b);
    worst = Math.max(worst, Math.abs(b.x - balls.x[i]), Math.abs(b.y - balls.y[i]), Math.abs(b.z - balls.z[i]));
  }
  assert.ok(worst < 1e-5, `drawn centres match the field (worst ${worst})`);
  for (let i = balls.count; i < balls.capacity; i++) {
    quads.readBall(i, b);
    assert.equal(b.radius, 0, 'unused slot hidden');
  }
});
