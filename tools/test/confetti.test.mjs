import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { Confetti, PieceState } from '../../assets/scripts/fx/Confetti.ts';

const FX = Config.finale.confetti;
const SCREENS = [[1280, 2276], [2000, 2276], [1280, 3000]];

function run(width, height, fps) {
  const c = new Confetti(FX);
  c.burst(width, height);
  const dt = 1 / fps;
  const seen = { flying: 0, nan: 0 };
  let t = 0;
  while (c.busy && t < 10) {
    c.update(dt);
    t += dt;
    seen.flying = Math.max(seen.flying, c.flying);
    for (let i = 0; i < c.count; i++) {
      if (c.state[i] === PieceState.Flying && !Number.isFinite(c.x[i] + c.y[i] + c.rot[i] + c.flip[i])) seen.nan++;
    }
  }
  return { c, t, seen };
}

test('confetti: waits, flies, fades and is done within its longest life (delay + life), at 60 and 4 fps on any screen', () => {
  for (const [w, h] of SCREENS) {
    for (const fps of [60, 4]) {
      const { c, t, seen } = run(w, h, fps);
      assert.ok(!c.busy, `all done (${w}x${h} at ${fps} fps)`);
      assert.ok(t <= Math.max(FX.life.fired + 0.12, FX.rainDelay + FX.life.rain) + 1 / fps + 1e-6, `finished by ${t} s`);
      assert.equal(seen.nan, 0);
      assert.equal(c.flying, 0);
      if (fps === 60) assert.ok(seen.flying > FX.count * 0.5, `most pieces are in the air together (${seen.flying})`);
      for (let i = 0; i < c.count; i++) assert.equal(c.state[i], PieceState.Done);
    }
  }
});

test('confetti: the cannons fire up and inward from the bottom corners, the rest rains from above the top', () => {
  const [w, h] = [1280, 2276];
  const c = new Confetti(FX);
  c.burst(w, h);
  const cannons = Math.round(FX.count * FX.cannonShare);
  for (let i = 0; i < c.count; i++) {
    if (i < cannons) {
      assert.ok(Math.abs(Math.abs(c.x[i]) - (w / 2 - 40)) < 1e-3 && c.y[i] < -h / 2 + 200, `piece ${i} starts in a bottom corner`);
    } else {
      assert.ok(c.y[i] > h / 2, `piece ${i} starts above the top edge`);
    }
    assert.equal(c.state[i], PieceState.Waiting);
  }
  // The fired pieces go up and toward the middle once their (short) delay is up.
  const from = Array.from(c.x);
  for (let k = 0; k < 20; k++) c.update(1 / 60);
  for (let i = 0; i < cannons; i++) {
    assert.equal(c.state[i], PieceState.Flying);
    assert.ok(c.y[i] > -h / 2 + 120, 'fired up');
    assert.ok(Math.abs(c.x[i]) < Math.abs(from[i]), 'toward the middle');
  }
  // The rain has not all started yet (it starts over rainDelay), and none of it is on screen yet.
  const waiting = Array.from(c.state).filter((s) => s === PieceState.Waiting).length;
  assert.ok(waiting > 0 && waiting < FX.count - cannons);
});

test('confetti: the same seed gives the same show; a piece is opaque while young and fades over the last fade seconds', () => {
  const a = run(1280, 2276, 60).c;
  const b = run(1280, 2276, 60).c;
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  const c = new Confetti(FX);
  c.burst(1280, 2276);
  for (let k = 0; k < 12; k++) c.update(1 / 60);
  assert.equal(c.alpha(0), 1, 'full while young');
  // Piece 0 is fired: it lives life.fired seconds (its delay is up within 0.12 s), or lands earlier.
  let t = 12 / 60;
  let faded = false;
  while (c.state[0] === PieceState.Flying) {
    c.update(1 / 60);
    t += 1 / 60;
    const a0 = c.alpha(0);
    if (a0 > 0 && a0 < 1) faded = true;
    if (a0 < 1) assert.ok(t > FX.life.fired - FX.fade - 0.2 || c.y[0] < -1138, 'fading only near the end of its life');
  }
  assert.ok(faded || c.y[0] < -1138 - 80, 'it faded out (or fell off the screen first)');
});
