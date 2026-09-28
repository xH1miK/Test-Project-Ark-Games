import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { PayPace } from '../../assets/scripts/economy/PayPace.ts';
import { PayPad } from '../../assets/scripts/economy/PayPad.ts';
import { Progression } from '../../assets/scripts/economy/Progression.ts';
import { Purse } from '../../assets/scripts/economy/Purse.ts';
import { LEVEL, driveLegs, makeWorld } from './ball-world.mjs';

const PADS = Config.pads;
const FX = Config.coinFx;
/** Longest a coin can be in the air. */
const LONGEST_FLIGHT = FX.flightTime * (1 + FX.jitter);

/** Runs a pace like a pad does: `due` every frame, everything due taken; returns the time each coin went. */
function runPace(amount, dt, { window = PADS.fillTime, interval = PADS.interval } = {}) {
  const pace = new PayPace();
  pace.start(amount, interval, window);
  const times = [];
  for (let t = dt; pace.running && t < 10; t += dt) {
    const n = pace.due(dt);
    for (let k = 0; k < n; k++) times.push(t);
    pace.took(n);
  }
  return times;
}

test('pace: the first coin at once, then one every interval, the whole amount within the window', () => {
  for (const dt of [1 / 60, 1 / 30, 0.2]) {
    for (const amount of [1, 5, 16, 100, 300, 1000]) {
      const times = runPace(amount, dt);
      assert.equal(times.length, amount, `${amount} at dt ${dt}`);
      assert.ok(times[0] <= dt + 1e-9, 'the first coin in the first frame');
      assert.ok(times[amount - 1] <= PADS.fillTime + dt + 1e-9, `${amount} within the window at dt ${dt}: ${times[amount - 1]}`);
    }
  }
  // A small amount goes at the slow start rate: one every interval.
  const five = runPace(5, 1 / 600);
  for (let k = 1; k < 5; k++) assert.ok(Math.abs(five[k] - five[k - 1] - PADS.interval) < 0.002, `gap ${five[k] - five[k - 1]}`);
  // A big one speeds up: the last tenth goes much faster than the first.
  const big = runPace(300, 1 / 600);
  assert.ok(big[29] - big[0] > 5 * (big[299] - big[270]), 'accelerates');
});

test('pace: coins not taken stay due; stop() forgets the stream', () => {
  const pace = new PayPace();
  pace.start(100, PADS.interval, PADS.fillTime);
  const first = pace.due(0.5);
  assert.ok(first > 5);
  pace.took(2);
  assert.equal(pace.due(0), first - 2, 'the rest is still due');
  pace.stop();
  assert.equal(pace.running, false);
  assert.equal(pace.due(1), 0);
});

/** A pad at the origin with a purse holding `coins`, a visitor that can be moved, and the events heard. */
function padWorld({ coins = 0, price = 100, shown = true, plate = null } = {}) {
  const events = new EventBus();
  const heard = [];
  for (const type of ['coinsSpent', 'padPaid']) events.on(type, (e) => heard.push({ type, ...e }));
  const purse = new Purse(events);
  purse.add(coins);
  const visitor = { x: 0, z: 0 };
  const pad = new PayPad('upgrade', PADS, { x: 0, y: 0.02, z: 0 }, price, purse, visitor, FX, events, { shown, plate });
  return { events, heard, purse, visitor, pad };
}

/** Steps the pad for `seconds` at `dt`, checking the ledger every frame. */
function run(world, seconds, dt = 1 / 60, each) {
  const { pad, purse } = world;
  const total = purse.total + pad.inFlight + pad.stored;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    pad.step(dt);
    assert.equal(purse.total + pad.inFlight + pad.stored, total, 'purse + in the air + on the pad stays the same');
    assert.ok(pad.stored <= pad.price && purse.total >= 0);
    each?.(t + dt);
  }
}

test('pad: coins stream only while the visitor stands in the square zone', () => {
  const w = padWorld({ coins: 500 });
  w.visitor.x = PADS.zoneHalf + 0.01;
  run(w, 1);
  assert.equal(w.purse.total, 500, 'outside: nothing taken');
  w.visitor.x = PADS.zoneHalf - 0.01;
  w.visitor.z = -(PADS.zoneHalf - 0.01);
  run(w, 1 / 60);
  assert.equal(w.purse.total, 499, 'inside (the corner): the first coin at once');
});

test('pad: the full price leaves the purse within fillTime and lands within one flight more; paid once', () => {
  for (const dt of [1 / 60, 0.2]) {
    const w = padWorld({ coins: 250 });
    let allTaken = null;
    let allLanded = null;
    const counter = [];
    run(w, 3, dt, (t) => {
      if (allTaken === null && w.purse.total === 150) allTaken = t;
      if (allLanded === null && w.pad.stored === 100) allLanded = t;
      counter.push(w.pad.owed);
    });
    assert.ok(allTaken <= PADS.fillTime + dt + 1e-9, `taken by ${allTaken} at dt ${dt}`);
    assert.ok(allLanded <= allTaken + LONGEST_FLIGHT + dt + 1e-9, `landed by ${allLanded}`);
    assert.equal(w.purse.total, 150, 'never more than the price');
    assert.equal(w.pad.owed, 0);
    assert.ok(w.pad.paid && !w.pad.open);
    assert.deepEqual(w.heard.filter((e) => e.type === 'padPaid'), [{ type: 'padPaid', padId: 'upgrade' }], 'padPaid once');
    assert.equal(w.heard.filter((e) => e.type === 'coinsSpent').reduce((s, e) => s + e.amount, 0), 100, 'coinsSpent adds up');
    for (let k = 1; k < counter.length; k++) assert.ok(counter[k] <= counter[k - 1], 'the counter only counts down');
    if (dt < 0.1) assert.ok(counter.findIndex((v) => v < 100) * dt >= FX.flightTime * (1 - FX.jitter) - dt, 'it counts when coins land, not when they leave');
  }
});

test('pad: a partial payment is kept when the visitor drives off; coming back pays the rest', () => {
  const w = padWorld({ coins: 40 });
  run(w, 2);
  assert.equal(w.purse.total, 0);
  assert.equal(w.pad.stored, 40, 'all 40 landed');
  assert.equal(w.pad.owed, 60);
  w.visitor.x = 10;
  w.purse.add(100);
  run(w, 2);
  assert.equal(w.pad.stored, 40, 'kept while away');
  assert.equal(w.purse.total, 100, 'nothing taken while away');
  w.visitor.x = 0;
  run(w, 1 / 60);
  assert.equal(w.purse.total, 99, 'back on the pad: the first coin at once again');
  run(w, 3);
  assert.equal(w.pad.stored, 100);
  assert.equal(w.purse.total, 40);
});

test('pad: an empty purse holds the stream; coins coming in are paid on', () => {
  const w = padWorld({ coins: 0 });
  run(w, 1);
  assert.equal(w.pad.stored, 0);
  w.purse.add(16);
  run(w, 1);
  assert.equal(w.pad.stored, 16);
  w.purse.add(84);
  run(w, 2);
  assert.ok(w.pad.paid);
});

test('pad: hidden or closed takes nothing; coins in the air still land', () => {
  const w = padWorld({ coins: 100, shown: false });
  run(w, 1);
  assert.equal(w.purse.total, 100, 'hidden');
  w.pad.show();
  run(w, 0.3);
  const taken = 100 - w.purse.total;
  assert.ok(taken > 0);
  w.pad.hide();
  run(w, 1);
  assert.equal(w.pad.stored, taken, 'what was in the air landed');
  assert.equal(w.purse.total, 100 - taken);
  w.pad.show();
  w.pad.close();
  run(w, 1);
  assert.equal(w.purse.total, 100 - taken, 'closed');
  assert.equal(w.pad.open, false);
});

test('pad: its plate is a clear zone only while it takes coins', () => {
  const plate = { minX: -2, maxX: 2, minZ: -1, maxZ: 1 };
  const w = padWorld({ coins: 100, shown: false, plate });
  const zone = w.pad.clearZone;
  assert.deepEqual([zone.minX, zone.maxX, zone.minZ, zone.maxZ], [-2, 2, -1, 1]);
  assert.equal(zone.speed, PADS.clearSpeed);
  assert.equal(zone.active, false, 'hidden');
  w.pad.show();
  assert.equal(zone.active, true, 'shown and unpaid');
  run(w, 3);
  assert.equal(zone.active, false, 'paid');
  assert.equal(padWorld({ plate: null }).pad.clearZone.active, false, 'no plate, no zone');
});

test('progression: the upgrade pad hides until the first hand-in, pops up once and throws the balls clear; bought, it closes and the machine goes up a tier', () => {
  const events = new EventBus();
  const purse = new Purse(events);
  const tiers = [];
  events.on('tierChanged', ({ tier }) => tiers.push(tier));
  // The visitor and the machine the upgrade buys (the tractor), as the Upgradable contract says.
  const tractor = { x: 100, z: 100, tier: 1, setTier(n) {
    if (n < 1 || n > 2 || n === this.tier) return false;
    this.tier = n;
    events.emit('tierChanged', { tier: n });
    return true;
  } };
  const make = (id, x, z, price) => new PayPad(id, PADS, { x, y: 0.02, z }, price, purse, tractor, FX, events);
  const upgrade = make('upgrade', 5.65, 2.33, Config.economy.upgradePrice);
  const gate = make('gate', 1.3, -12.2, Config.economy.gatePrice);
  const bursts = [];
  const progression = new Progression(PADS, upgrade, gate, { burst: (...args) => bursts.push(args) }, tractor, events);
  assert.equal(upgrade.shown, false);
  assert.equal(gate.shown, true);
  events.emit('ballsShredded', { count: 3 }); // balls shoved into the throat are not a hand-in
  assert.equal(upgrade.shown, false);
  events.emit('loadHandedIn', { count: 8 });
  assert.equal(upgrade.shown, true);
  const { radius, speed, hop } = PADS.burst;
  assert.deepEqual(bursts, [[5.65, 2.33, radius, speed, hop]]);
  events.emit('loadHandedIn', { count: 8 });
  assert.equal(bursts.length, 1, 'once');
  // Paid: the upgrade pad closes (MAX); the gate pad just takes its coins (the gate opens in M10).
  purse.add(1000);
  tractor.x = upgrade.x;
  tractor.z = upgrade.z;
  assert.equal(tractor.tier, 1, 'not before it is paid');
  for (let k = 0; k < 180; k++) progression.step(1 / 60);
  assert.ok(upgrade.paid && upgrade.closed);
  assert.equal(purse.total, 900);
  assert.equal(tractor.tier, 2, 'the upgrade bought tier 2');
  assert.deepEqual(tiers, [2], 'once');
  tractor.x = gate.x;
  tractor.z = gate.z;
  for (let k = 0; k < 180; k++) progression.step(1 / 60);
  assert.ok(gate.paid);
  assert.equal(purse.total, 600);
  assert.equal(tractor.tier, 2, 'the gate buys no tier');
});

/** Free balls with centres in a rectangle. */
const ballsIn = (balls, r) => { let n = 0; for (let i = 0; i < balls.count; i++) if (!balls.isHeld(i) && balls.x[i] >= r.minX && balls.x[i] <= r.maxX && balls.z[i] >= r.minZ && balls.z[i] <= r.maxZ) n++; return n; };

test('the real arena at 60 and 10 fps: sell, the upgrade pad pops up clear, a partial payment stays, the rest, MAX; the ledger every frame', () => {
  for (const fps of [60, 10]) {
    const world = makeWorld({ shredder: true, pads: true });
    const { balls, purse, coins, shredder, pads, tractor } = world;
    const spent = { upgrade: 0, gate: 0 };
    world.events.on('coinsSpent', ({ padId, amount }) => { spent[padId] += amount; });
    let granted = 0;
    const setPurse = (total) => {
      const diff = total - purse.total;
      if (diff >= 0) purse.add(diff);
      granted += diff >= 0 ? diff : -purse.spend(-diff);
    };
    const have = () => purse.total + coins.pending + pads.upgrade.stored + pads.upgrade.inFlight + pads.gate.stored + pads.gate.inFlight;
    let worst = 0;
    // What the upgrade pad held (landed + flying to it) when the tractor last left its zone.
    let wasIn = false;
    let leftWith = -1;
    // Checked before every frame, i.e. after the previous one.
    const nextDt = () => {
      worst = Math.max(worst, Math.abs(have() - (Config.economy.coinsPerBall * shredder.shredded + granted)));
      if (wasIn && !pads.upgrade.inZone) leftWith = pads.upgrade.stored + pads.upgrade.inFlight;
      wasIn = pads.upgrade.inZone;
      return 1 / fps;
    };
    const drive = (legs) => {
      const results = driveLegs(world, legs, nextDt);
      assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    };
    // A plate itself must be bare; balls up on others may overhang the clear margin round it.
    assert.equal(ballsIn(balls, pads.gate.clearZone), 0, 'the gate plate and its margin are bare from the start');
    assert.ok(!pads.upgrade.shown && pads.gate.shown);
    const onUpgradePlate = ballsIn(balls, LEVEL.plates.upgrade);
    drive([{ kind: 'goto', x: 3, z: -11 }, { kind: 'goto', x: 3, z: -4.8, radius: 0.4 }, { kind: 'stop', time: 0.3 }]);
    assert.ok(pads.upgrade.shown, 'the first hand-in shows the upgrade pad');
    drive([{ kind: 'goto', x: 0.8, z: -4.8, radius: 0.6 }, { kind: 'stop', time: 2 }]);
    assert.ok(onUpgradePlate > 10);
    assert.equal(ballsIn(balls, LEVEL.plates.upgrade), 0, `the ${onUpgradePlate} balls on its plate were thrown clear (${fps} fps)`);
    assert.equal(balls.simulatedCount, 0, 'and everything is asleep again');
    setPurse(40);
    drive([{ kind: 'goto', x: 0.8, z: 2.4, radius: 0.6 }, { kind: 'goto', x: 5.2, z: 2.4, radius: 0.4 }, { kind: 'stop', time: 2.5 }]);
    // Driving off it takes until the pivot is out of the zone (coins the throat paid late go on too).
    drive([{ kind: 'goto', x: -1, z: 3, radius: 0.6 }, { kind: 'stop', time: 1.5 }]);
    const partial = pads.upgrade.stored;
    assert.ok(partial >= 40 && partial < 100 && !pads.upgrade.closed, `partial payment ${partial} at ${fps} fps`);
    assert.equal(partial, leftWith, 'kept as it was when the tractor left the zone');
    assert.equal(pads.upgrade.owed, 100 - partial);
    setPurse(150);
    drive([{ kind: 'goto', x: 5, z: 2.5, radius: 0.4 }, { kind: 'stop', time: 3 }]);
    assert.ok(pads.upgrade.paid && pads.upgrade.closed, 'paid and closed');
    // The purse also gets what the throat swallows: T2 appears on the pad next to the shredder and its
    // bigger body shoves balls in. What the pad took is counted by its own events.
    assert.equal(spent.upgrade, 100, 'the pad took exactly its price from the purse, over both visits');
    assert.equal(tractor.tier, 2, 'the upgrade bought tier 2');
    assert.equal(pads.upgrade.clearZone.active, false);
    assert.equal(worst, 0, `purse + coins in the air + on the pads = 2 x shredded + granted, every frame (${fps} fps)`);
  }
});
