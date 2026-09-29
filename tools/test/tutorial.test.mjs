import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { PayPad } from '../../assets/scripts/economy/PayPad.ts';
import { Progression } from '../../assets/scripts/economy/Progression.ts';
import { Purse } from '../../assets/scripts/economy/Purse.ts';
import { TutorialFlow } from '../../assets/scripts/tutorial/TutorialFlow.ts';
import { TutorialMarkers } from '../../assets/scripts/tutorial/TutorialMarkers.ts';
import { Gate } from '../../assets/scripts/world/Gate.ts';

const PADS = Config.pads;
const FX = Config.coinFx;
const MARKS = Config.tutorial;
const SHREDDER = { x: 5.75, z: -1.85 };
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

/** The run in miniature: real pads, purse, progression and gate; the tractor is a stub that can be moved and upgraded. */
function world() {
  const events = new EventBus();
  const purse = new Purse(events);
  const tractor = { x: 100, z: 100, tier: 1, maxTier: 2, setTier(n) {
    if (n < 1 || n > 2 || n === this.tier) return false;
    this.tier = n;
    events.emit('tierChanged', { tier: n });
    return true;
  } };
  const make = (id, x, z, price, shown) => new PayPad(id, PADS, { x, y: 0.02, z }, price, purse, tractor, FX, events, { shown });
  const upgrade = make('upgrade', 5.65, 2.33, Config.economy.upgradePrice, false);
  const gatePad = make('gate', 1.3, -12.2, Config.economy.gatePrice, true);
  const gate = new Gate('gate', Config.gate, events);
  const progression = new Progression(PADS, upgrade, gatePad,
    { ground: { burst() {} }, machine: tractor, controls: { lock() {} }, gate }, events);
  const flow = new TutorialFlow({ purse, shredder: SHREDDER, upgradePad: upgrade, gatePad, machine: tractor, gate });
  /** One frame in GameRoot's order: coins and pads, then the tutorial. */
  const frame = (dt = 1 / 60) => {
    gate.step(dt);
    progression.step(dt);
    flow.update();
  };
  const frames = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) frame(dt); };
  return { events, purse, tractor, upgrade, gatePad, gate, progression, flow, frame, frames };
}

const is = (flow, step, id) => {
  assert.equal(flow.step, step);
  assert.equal(flow.target?.id ?? null, id, `step ${step} aims at ${id}`);
};

test('flow: off until begin(), then Sell aims at the shredder', () => {
  const w = world();
  is(w.flow, 'off', null);
  assert.equal(w.flow.isRunning, false);
  w.frames(1);
  is(w.flow, 'off', null); // nothing starts it but begin()
  w.flow.begin();
  is(w.flow, 'sell', 'shredder');
  assert.equal(w.flow.isRunning, true);
  assert.deepEqual([w.flow.target.x, w.flow.target.z], [SHREDDER.x, SHREDDER.z]);
  w.flow.begin(); // once
  is(w.flow, 'sell', 'shredder');
});

test('flow: the first hand-in shows the upgrade pad -> Upgrade; a load of coins there aims at the pad', () => {
  const w = world();
  w.flow.begin();
  w.purse.add(500); // coins alone do not end Sell: the pad has to be there
  w.frames(1);
  is(w.flow, 'sell', 'shredder');
  w.events.emit('ballsShredded', { count: 4 }); // shoved into the throat: not a hand-in
  w.frames(0.2);
  is(w.flow, 'sell', 'shredder');
  w.events.emit('loadHandedIn', { count: 8 });
  assert.equal(w.upgrade.shown, true);
  w.frame();
  is(w.flow, 'upgrade', 'upgrade');
  assert.deepEqual([w.flow.target.x, w.flow.target.z], [w.upgrade.x, w.upgrade.z]);
});

test('flow: aimPad - an empty purse with a pad still to pay sends the way to the shredder; coins in the air do not count as needed', () => {
  const w = world();
  w.flow.begin();
  w.events.emit('loadHandedIn', { count: 8 });
  w.frame();
  is(w.flow, 'upgrade', 'shredder'); // purse 0, the pad needs 100
  w.purse.add(30);
  w.frame();
  is(w.flow, 'upgrade', 'upgrade');
  // The tractor stands on the pad: the 30 stream out of the purse, the pad is the way while there are coins
  // and the shredder once the purse is empty with 70 still missing (the 30 in the air are not needed any more).
  w.tractor.x = w.upgrade.x;
  w.tractor.z = w.upgrade.z;
  for (let k = 0; k < 400 && w.purse.total > 0; k++) {
    w.frame();
    assert.equal(w.flow.target.id, w.purse.total > 0 ? 'upgrade' : 'shredder', `purse ${w.purse.total}`);
  }
  assert.equal(w.purse.total, 0);
  assert.equal(w.upgrade.missing, 70);
  is(w.flow, 'upgrade', 'shredder');
  w.frames(1);
  is(w.flow, 'upgrade', 'shredder');
  assert.equal(w.upgrade.stored, 30, 'the partial payment stays');
  // 70 more come in and stream out: whether they are in the purse or already in the air, nothing is missing
  // any more or there are coins to pay with -> the pad stays the way until it is paid, then the gate is next.
  w.purse.add(70);
  for (let k = 0; k < 600 && !w.upgrade.closed; k++) {
    w.frame();
    if (!w.upgrade.closed) assert.equal(w.flow.target.id, 'upgrade', `purse ${w.purse.total}, missing ${w.upgrade.missing}`);
  }
  assert.equal(w.upgrade.closed, true);
  is(w.flow, 'gate', 'shredder');
});

test('flow: paying the upgrade (or reaching the last tier) -> Gate; the same aimPad rule for the gate pad', () => {
  const w = world();
  w.flow.begin();
  w.events.emit('loadHandedIn', { count: 8 });
  w.purse.add(100);
  w.tractor.x = w.upgrade.x;
  w.tractor.z = w.upgrade.z;
  for (let k = 0; k < 600 && !w.upgrade.closed; k++) w.frame();
  assert.equal(w.tractor.tier, 2, 'bought');
  assert.equal(w.upgrade.closed, true);
  is(w.flow, 'gate', 'shredder'); // purse empty, the gate needs 300
  w.tractor.x = 100;
  w.purse.add(20);
  w.frame();
  is(w.flow, 'gate', 'gate');
  assert.deepEqual([w.flow.target.x, w.flow.target.z], [w.gatePad.x, w.gatePad.z]);

  // The tier alone does it too (a QA setTier(2), no payment): the pad is not the way any more.
  const q = world();
  q.flow.begin();
  q.tractor.setTier(2);
  q.frame();
  is(q.flow, 'gate', 'shredder');
  q.purse.add(300);
  q.frame();
  is(q.flow, 'gate', 'gate');
});

test('flow: the gate starting to open ends it - Done, the markers go, and nothing brings it back', () => {
  const w = world();
  w.flow.begin();
  w.events.emit('loadHandedIn', { count: 8 });
  w.tractor.setTier(2);
  w.purse.add(300);
  w.tractor.x = w.gatePad.x;
  w.tractor.z = w.gatePad.z;
  const seen = [];
  w.events.on('gateOpening', () => seen.push(`opening: gate ${w.gate.phase}, step ${w.flow.step}`));
  for (let k = 0; k < 300 && w.gate.phase === 'closed'; k++) {
    assert.ok(w.flow.isRunning, 'running until the gate opens');
    w.frame();
  }
  assert.equal(w.gate.phase, 'opening');
  assert.deepEqual(seen, ['opening: gate opening, step gate'], 'the event comes first, the tutorial follows in the same frame');
  is(w.flow, 'done', null);
  assert.equal(w.flow.isRunning, false);
  w.frames(2);
  is(w.flow, 'done', null);
  w.purse.add(500);
  w.events.emit('loadHandedIn', { count: 8 });
  w.frames(1);
  is(w.flow, 'done', null);
});

test('flow: the step only moves forward', () => {
  const parts = {
    purse: { total: 10 },
    shredder: SHREDDER,
    upgradePad: { x: 1, z: 2, shown: true, closed: false, missing: 5 },
    gatePad: { x: 3, z: 4, shown: true, closed: false, missing: 300 },
    machine: { tier: 1, maxTier: 2 },
    gate: { phase: 'closed' },
  };
  const flow = new TutorialFlow(parts);
  flow.begin();
  is(flow, 'upgrade', 'upgrade');
  parts.upgradePad.shown = false; // e.g. a pad taken away: the tutorial does not go back to Sell
  flow.update();
  is(flow, 'upgrade', 'upgrade');
  parts.upgradePad.closed = true;
  flow.update();
  is(flow, 'gate', 'gate');
  parts.upgradePad.closed = false;
  parts.upgradePad.shown = true;
  flow.update();
  is(flow, 'gate', 'gate');
  parts.gate.phase = 'open';
  flow.update();
  is(flow, 'done', null);
});

/** Markers over a target at (tx, tz), the tractor at (ax, az). */
const at = (id, x, z) => ({ id, x, z });

test('arrow: it snaps to the target when it appears, then turns no faster than turnSpeed, by the short way round', () => {
  for (const dt of [1 / 60, 1 / 30, 0.25]) {
    const m = new TutorialMarkers(MARKS);
    m.update(dt, 0, 0, at('shredder', 10, 0)); // due east
    near(m.arrowYaw, Math.PI / 2);
    assert.equal(m.arrowShown, true);
    // The target swings to due west (180 degrees away): half a second at 540 deg/s is 270, so a turn takes 1/3 s.
    let turned = 0;
    let time = 0;
    let last = m.arrowYaw;
    let frames = 0;
    while (Math.abs(m.arrowYaw + Math.PI / 2) > 1e-9) {
      m.update(dt, 0, 0, at('shredder', -10, 0));
      time += dt;
      frames++;
      let step = m.arrowYaw - last;
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      assert.ok(Math.abs(step) <= MARKS.arrow.turnSpeed * Math.PI / 180 * dt + 1e-9, `a step of ${step} rad at dt ${dt}`);
      turned += Math.abs(step);
      last = m.arrowYaw;
      if (frames > 200) break;
    }
    near(turned, Math.PI, 1e-6);
    assert.ok(time >= 1 / 3 - 1e-9 && time <= 1 / 3 + dt + 1e-9, `180 degrees took ${time} s at dt ${dt}`);
    near(Math.abs(m.arrowYaw), Math.PI / 2, 1e-9); // west = -90 degrees (yaw is wrapped, so -pi/2 here)
  }
});

test('arrow: it floats `forward` ahead of the tractor along its own heading, at `height`, and follows the tractor', () => {
  const m = new TutorialMarkers(MARKS);
  m.update(1 / 60, 3, -4, at('upgrade', 3, 10)); // due +z
  near(m.arrowYaw, 0);
  near(m.arrowX, 3);
  near(m.arrowZ, -4 + MARKS.arrow.forward);
  near(m.arrowY, MARKS.arrow.height);
  m.update(1 / 60, 8, 2, at('upgrade', 3, 10)); // the tractor moved; the target is now to the north-west
  const yaw = m.arrowYaw;
  near(m.arrowX, 8 + Math.sin(yaw) * MARKS.arrow.forward);
  near(m.arrowZ, 2 + Math.cos(yaw) * MARKS.arrow.forward);
  // Standing on the target: no direction to turn to, the heading stays.
  const before = m.arrowYaw;
  m.update(1 / 60, 3, 10, at('upgrade', 3, 10));
  assert.equal(m.arrowYaw, before);
});

test('arrow: a null target hides both; the next one appears facing it again (no swing from the old heading)', () => {
  const m = new TutorialMarkers(MARKS);
  m.update(1 / 60, 0, 0, at('shredder', 10, 0));
  m.update(1 / 60, 0, 0, null);
  assert.equal(m.arrowShown, false);
  assert.equal(m.pointerShown, false);
  m.update(1 / 60, 0, 0, at('gate', -10, 0));
  assert.equal(m.arrowShown, true);
  near(Math.abs(m.arrowYaw), Math.PI / 2);
  assert.ok(m.arrowYaw < 0, 'due west, at once');
});

test('pointer: over the target at its own height, bobbing by the amplitude with the period; the clock restarts on a new target', () => {
  const m = new TutorialMarkers(MARKS);
  const P = MARKS.pointer;
  let lo = Infinity;
  let hi = -Infinity;
  let time = 0;
  const dt = 1 / 120;
  m.update(0, 0, 0, at('shredder', 5.75, -1.85));
  near(m.pointerY, P.shredderHeight, 1e-9); // the clock starts at 0: no bob yet
  assert.equal(m.pointerShown, true);
  near(m.pointerX, 5.75);
  near(m.pointerZ, -1.85);
  for (; time < P.period * 3 - 1e-9; time += dt) {
    m.update(dt, 0, 0, at('shredder', 5.75, -1.85));
    lo = Math.min(lo, m.pointerY);
    hi = Math.max(hi, m.pointerY);
    near(m.pointerY, P.shredderHeight + Math.sin(((time + dt) * 2 * Math.PI) / P.period) * P.bob, 1e-9);
  }
  near(hi, P.shredderHeight + P.bob, 1e-3);
  near(lo, P.shredderHeight - P.bob, 1e-3);
  // A new target: a pad's own height, and the bob starts again from its rest position.
  m.update(0, 0, 0, at('upgrade', 5.65, 2.33));
  near(m.pointerY, P.padHeight);
  m.update(P.period / 4, 0, 0, at('upgrade', 5.65, 2.33));
  near(m.pointerY, P.padHeight + P.bob, 1e-9);
  // The same target with a different frame rate reads the same bob (it is a clock, not a per-frame step).
  const a = new TutorialMarkers(MARKS);
  const b = new TutorialMarkers(MARKS);
  a.update(0, 0, 0, at('gate', 1, 1));
  b.update(0, 0, 0, at('gate', 1, 1));
  for (let k = 0; k < 60; k++) a.update(1 / 60, 0, 0, at('gate', 1, 1));
  for (let k = 0; k < 4; k++) b.update(0.25, 0, 0, at('gate', 1, 1));
  near(a.pointerY, b.pointerY, 1e-9);
});
