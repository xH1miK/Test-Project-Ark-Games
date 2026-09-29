import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { PayPad } from '../../assets/scripts/economy/PayPad.ts';
import { Progression } from '../../assets/scripts/economy/Progression.ts';
import { Purse } from '../../assets/scripts/economy/Purse.ts';
import { JoystickModel } from '../../assets/scripts/input/JoystickModel.ts';
import { MoveInput } from '../../assets/scripts/input/MoveInput.ts';
import { Gate } from '../../assets/scripts/world/Gate.ts';
import { pickFillTarget, sweepFrame } from '../scenarios/lib/sweep.mjs';
import { LEVEL, driveLegs, frame, makeWorld } from './ball-world.mjs';

const GATE = Config.gate;
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

test('move input: locked, the stick and an autopilot both read zero, and nothing unlocks it', () => {
  const m = new MoveInput();
  m.setFromStick(0, 1, 0);
  near(m.z, -1);
  assert.equal(m.isLocked, false);
  m.lock();
  assert.equal(m.isLocked, true);
  assert.equal(m.x, 0);
  assert.equal(m.z, 0, 'zero at once');
  m.setFromStick(1, 1, 45);
  assert.deepEqual([m.x, m.z], [0, 0], 'the stick is ignored');
  m.override(1, 0);
  assert.deepEqual([m.x, m.z], [0, 0], 'so is an autopilot');
  m.release();
  m.setFromStick(0, 1, 0);
  assert.deepEqual([m.x, m.z], [0, 0], 'letting go of an override does not give the controls back');
  assert.equal(m.isLocked, true);
});

test('joystick: switched off, the finger is let go, new touches do nothing and the picture fades away', () => {
  const stick = new JoystickModel(Config.joystick);
  stick.setArea(1280, 2276);
  stick.press(50, -600);
  stick.drag(200, -600);
  assert.ok(stick.stick.x > 0.5 && stick.isHeld);
  assert.equal(stick.visibility, 1);
  stick.disable();
  assert.equal(stick.isEnabled, false);
  assert.equal(stick.isHeld, false);
  assert.deepEqual([stick.stick.x, stick.stick.y], [0, 0], 'reads zero at once');
  stick.press(0, -600);
  stick.drag(200, -600);
  assert.deepEqual([stick.stick.x, stick.stick.y], [0, 0], 'a new touch is ignored');
  assert.equal(stick.isHeld, false);
  for (let f = 0; f < 60; f++) stick.update(1 / 60);
  assert.ok(stick.visibility < 0.01, `faded away within a second (${stick.visibility})`);
});

test('gate: closed until told, opens over openTime (60 fps or 4 fps alike), announces the start and the end once', () => {
  for (const dt of [1 / 60, 1 / 30, 0.25]) {
    const events = new EventBus();
    const gate = new Gate('gate', GATE, events);
    const log = [];
    events.on('gateOpening', ({ padId }) => log.push(`opening ${padId}`));
    events.on('gateOpened', ({ padId }) => log.push(`opened ${padId}`));
    gate.step(1);
    assert.equal(gate.phase, 'closed', 'time alone opens nothing');
    assert.deepEqual([gate.progress, gate.fold, gate.flash], [0, 0, 0]);
    gate.open();
    gate.open();
    assert.deepEqual(log, ['opening gate'], 'announced once');
    assert.equal(gate.phase, 'opening');
    let t = 0;
    while (gate.phase === 'opening') {
      gate.step(dt);
      t += dt;
      assert.ok(t < GATE.openTime + dt + 1e-9, 'never later than one frame after openTime');
    }
    assert.ok(t >= GATE.openTime - 1e-9, `not before openTime (${t})`);
    assert.deepEqual(log, ['opening gate', 'opened gate']);
    gate.step(1);
    gate.open();
    assert.deepEqual(log, ['opening gate', 'opened gate'], 'once');
    assert.equal(gate.phase, 'open');
    assert.deepEqual([gate.progress, gate.fold, gate.flash], [1, 1, 0]);
  }
});

test('gate: the curtain holds for the first 15%, then folds on a smoothstep; the sparks flash like sin(pi t)', () => {
  const gate = new Gate('gate', GATE, null);
  gate.open();
  const at = (share) => {
    const g = new Gate('gate', GATE, null);
    g.open();
    g.step(share * GATE.openTime);
    return g;
  };
  assert.equal(at(0.1).fold, 0);
  assert.equal(at(GATE.hold).fold, 0, 'still holding at the end of the hold');
  const mid = at(GATE.hold + (1 - GATE.hold) / 2);
  near(mid.fold, 0.5, 1e-9);
  const late = at(0.9);
  assert.ok(late.fold > 0.9 && late.fold < 1);
  let last = 0;
  for (let k = 0; k <= 100; k++) {
    const g = at(k / 100 * 0.999);
    assert.ok(g.fold >= last - 1e-12, 'folds only forward');
    last = g.fold;
  }
  near(at(0.5).flash, 1, 1e-9);
  near(at(0.25).flash, Math.SQRT1_2, 1e-9);
  assert.ok(gate.flash === 0 && gate.progress === 0, 'nothing has moved yet');
});

test('progression: the gate pad paid ends the run: controls off, the pad away, the gate told to open, in that order and once', () => {
  const events = new EventBus();
  const purse = new Purse(events);
  const log = [];
  const tractor = { x: 100, z: 100, tier: 1, setTier: () => { log.push('tier'); return true; } };
  const make = (id, x, z, price) => new PayPad(id, Config.pads, { x, y: 0.02, z }, price, purse, tractor, Config.coinFx, events);
  const upgrade = make('upgrade', 5.65, 2.33, Config.economy.upgradePrice);
  const gatePad = make('gate', 1.3, -12.2, Config.economy.gatePrice);
  const parts = {
    ground: { burst() {} },
    machine: tractor,
    controls: { lock: () => log.push(`lock (gate pad shown: ${gatePad.shown})`) },
    gate: { open: () => log.push(`open (gate pad shown: ${gatePad.shown})`) },
  };
  const progression = new Progression(Config.pads, upgrade, gatePad, parts, events);
  purse.add(1000);
  upgrade.show();
  tractor.x = upgrade.x;
  tractor.z = upgrade.z;
  for (let k = 0; k < 180; k++) progression.step(1 / 60);
  assert.deepEqual(log, ['tier'], 'the upgrade ends nothing');
  tractor.x = gatePad.x;
  tractor.z = gatePad.z;
  for (let k = 0; k < 180; k++) progression.step(1 / 60);
  assert.ok(gatePad.paid);
  assert.deepEqual(log, ['tier', 'lock (gate pad shown: true)', 'open (gate pad shown: false)']);
  assert.equal(gatePad.shown, false, 'the plate and the sign shrink away');
  assert.equal(gatePad.clearZone.active, false, 'balls are not kept off it any more');
  assert.equal(purse.total, 600, 'it took its price and no more');
});

test('the real arena at 60 and 10 fps: the gate paid -> controls off from that frame, the tractor brakes to a halt, the gate opens over 0.85 s, gateOpened once', () => {
  for (const fps of [60, 10]) {
    const world = makeWorld({ shredder: true, pads: true });
    const { events, purse, tractor, pads, gate, input } = world;
    const log = [];
    let now = 0;
    for (const type of ['coinsSpent', 'padPaid', 'gateOpening', 'gateOpened']) events.on(type, (p) => log.push({ type, t: now, p }));
    purse.add(Config.economy.gatePrice + 20);
    const results = [];
    const dt = () => {
      now += 1 / fps;
      return 1 / fps;
    };
    // Onto the pad and stand there until it is paid (the price leaves the purse within fillTime, lands 0.45 s later).
    results.push(...driveLegs(world, [{ kind: 'goto', x: 3, z: -11, radius: 0.4 }, { kind: 'stop', time: 4, until: 'locked' }], dt, { until: { locked: () => input.isLocked } }));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    const paid = log.find((e) => e.type === 'padPaid');
    assert.ok(paid && paid.p.padId === 'gate', 'the gate pad was paid');
    assert.equal(input.isLocked, true);
    assert.equal(purse.total, 20, 'took exactly its price');
    assert.equal(pads.gate.shown, false);
    // Let the gate open: nothing else moves it.
    while (gate.phase !== 'open' && now < 10) driveLegs(world, [{ kind: 'stop', time: 1 / fps }], dt);
    const opening = log.find((e) => e.type === 'gateOpening');
    const opened = log.filter((e) => e.type === 'gateOpened');
    assert.equal(log.filter((e) => e.type === 'gateOpening').length, 1);
    assert.equal(opened.length, 1, 'gateOpened once');
    assert.ok(opening.t >= paid.t && opening.t - paid.t < 2 / fps, 'it starts opening in the frame the pad is paid');
    const took = opened[0].t - opening.t;
    assert.ok(took >= GATE.openTime - 1e-9 && took <= GATE.openTime + 1 / fps + 1e-9, `opened in ${took} s at ${fps} fps`);
    assert.ok(log.indexOf(paid) < log.indexOf(opening) && log.indexOf(opening) < log.indexOf(opened[0]));
    // The controls stay off: an autopilot pushing west moves nothing.
    const at = { x: tractor.x, z: tractor.z };
    driveLegs(world, [{ kind: 'push', dx: -1, dz: 0, time: 1 }, { kind: 'stop', time: 0.5 }], dt);
    assert.deepEqual({ x: tractor.x, z: tractor.z }, at, 'the tractor stands where it stopped');
    assert.equal(tractor.speed, 0);
  }
});

test('the tractor brakes at full speed the frame the controls go off, whatever an autopilot keeps asking', () => {
  for (const fps of [60, 10]) {
    const world = makeWorld({ carpet: false, shredder: true, pads: true });
    const { tractor, input, events } = world;
    tractor.place(9, -3, Math.PI / 2 + Math.PI); // facing -X on open ground
    const h = 1 / fps;
    for (let f = 0; f < fps; f++) frame(world, h, -1, 0);
    assert.ok(tractor.speed > 3.5, `up to speed (${tractor.speed})`);
    const x0 = tractor.x;
    events.emit('padPaid', { padId: 'gate' });
    assert.equal(input.isLocked, true, 'locked in the frame of the payment');
    let last = tractor.speed;
    let t = 0;
    while (tractor.speed > 0 && t < 2) {
      frame(world, h, -1, 0); // the autopilot keeps pushing
      t += h;
      assert.ok(tractor.speed < last, 'slowing down every frame');
      last = tractor.speed;
    }
    assert.equal(tractor.speed, 0);
    const braking = Config.tractor.tiers[0].speed / Config.tractor.brake;
    assert.ok(t <= braking + h + 1e-9, `stopped within ${t} s (${braking} s of braking)`);
    const stopped = tractor.x;
    assert.ok(Math.abs(stopped - x0) <= Config.tractor.tiers[0].speed ** 2 / (2 * Config.tractor.brake) + h * 3.6, `rolled ${Math.abs(stopped - x0)}`);
    for (let f = 0; f < fps; f++) frame(world, h, -1, 0);
    assert.equal(tractor.x, stopped, 'and stays');
  }
});

test('long-run policy: no fill-up target inside the gate pad zone, none across it (paying the gate would end the run)', () => {
  const world = makeWorld({ shredder: true, pads: true });
  const { balls, tractor } = world;
  const gatePad = LEVEL.spots.gatePad;
  const frameOptions = sweepFrame(LEVEL.spots.shredder, Config.shredder.zoneHalf, gatePad, Config.pads.zoneHalf);
  assert.deepEqual(frameOptions.avoid, [{ x: gatePad.x, z: gatePad.z, half: Config.pads.zoneHalf + 0.8 }]);
  assert.deepEqual(sweepFrame(LEVEL.spots.shredder, Config.shredder.zoneHalf).avoid, [], 'no gate, nothing to avoid');
  const square = frameOptions.avoid[0];
  const inside = (p) => Math.abs(p.x - square.x) < square.half && Math.abs(p.z - square.z) < square.half;
  // From a spot on the far side of the gate: with the same options minus `avoid` the cheapest fill-up is right there.
  tractor.place(-4, -12, 0);
  const options = { ...frameOptions, toward: { x: gatePad.x, z: gatePad.z }, minMass: 6, clearance: 0.9, obstacles: world.grid };
  const without = pickFillTarget(balls, tractor, { ...options, avoid: [] });
  const target = pickFillTarget(balls, tractor, options);
  assert.ok(without && target);
  assert.ok(!inside(target), `target (${target.x}, ${target.z}) is outside the gate zone`);
  // Every cell the policy would ever pick, from anywhere on a grid of starting points, keeps out of it too.
  for (let x = -4; x <= 14; x += 3) {
    for (let z = -14; z <= 14; z += 4) {
      tractor.place(x, z, 0);
      if (inside({ x, z })) continue;
      const pick = pickFillTarget(balls, tractor, { ...options, toward: undefined });
      if (pick) assert.ok(!inside(pick), `from (${x}, ${z}) the target (${pick.x}, ${pick.z}) is outside the gate zone`);
    }
  }
});
