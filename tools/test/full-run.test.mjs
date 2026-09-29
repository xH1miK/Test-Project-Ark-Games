import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { TutorialFlow } from '../../assets/scripts/tutorial/TutorialFlow.ts';
import { SHREDDER_POSE, accountHeld, frame, fullRun, makeWorld, measure } from './ball-world.mjs';

// The M12 run on the pure models: a fresh start, no coin from outside, tier 1 -> the upgrade pad ->
// tier 2 -> the gate pad -> the gate opens. At several frame rates (a phone that cannot hold 60).
for (const fps of [60, 30, 15]) {
  test(`full run at ${fps} fps: fresh start to the open gate, the purse and the tutorial right on every frame`, () => {
    const world = makeWorld({ shredder: true, pads: true });
    const { balls, shredder, purse, coins, pads, tractor, gate, input } = world;
    const dt = 1 / fps;
    const tutorial = new TutorialFlow({ purse, shredder: SHREDDER_POSE, upgradePad: pads.upgrade, gatePad: pads.gate, machine: tractor, gate });
    tutorial.begin();
    const problems = [];
    const ledger = () => purse.total + coins.pending + pads.upgrade.stored + pads.upgrade.inFlight + pads.gate.stored + pads.gate.inFlight;
    const steps = [];
    let frames = 0;
    let clock = 0;
    let gateShutEarly = 0;
    // Called at the start of every frame: it sees what the last one left.
    const nextDt = () => {
      frames++;
      clock += dt;
      if (ledger() !== 2 * shredder.shredded && problems.length < 5) problems.push(`frame ${frames}: purse ${purse.total} + ${coins.pending} + pads = ${ledger()}, 2 x shredded ${2 * shredder.shredded}`);
      tutorial.update();
      if (steps.length === 0 || steps[steps.length - 1].step !== tutorial.step) steps.push({ step: tutorial.step, clock });
      if (gate.phase !== 'closed' && !pads.gate.paid) gateShutEarly++;
      return dt;
    };
    const run = fullRun(world, nextDt, (r) => {
      // A full bucket at the end of the fill-up (the tier may change on the way) is handed in whole.
      if (r.fill.reason !== 'full' || r.filled !== r.capacity) problems.push(`round ${r.round}: fill ended ${r.fill.reason} with ${r.filled} of ${r.capacity}`);
      if (r.sell.reason !== 'inZone' || r.sold < r.filled) problems.push(`round ${r.round}: sell ended ${r.sell.reason}, sold ${r.sold} of ${r.filled}`);
    });
    // Everything lands, every coin arrives, the carpet settles (the controls are off; nothing drives).
    for (let f = 0; f < fps * 5; f++) {
      frame(world, dt, 0, 0);
      balls.clearMoved();
    }
    tutorial.update();
    const { marks, trips, rounds } = run;
    const at = (name) => marks[name]?.clock;
    console.log(`full run at ${fps} fps: ${rounds.length} rounds (${rounds.filter((r) => r.tier === 1).length} + ${rounds.filter((r) => r.tier === 2).length}), gate open at ${at('gateOpened')} s; ` +
      `first hand-in ${at('firstHandIn')}, tier 2 ${at('tier2')}, gate paid ${at('gatePaid')}; shredded ${shredder.shredded}, purse ${purse.total}`);

    assert.deepEqual(problems, []);
    assert.ok(run.ended && gate.phase === 'open', 'the gate opened');
    assert.ok(input.isLocked, 'the controls are off after the gate is paid');
    assert.equal(gateShutEarly, 0, 'the gate did not start opening before its pad was paid');
    // Two visits to a pad, in that order, each finished; the upgrade one is not the gate one.
    assert.deepEqual(trips.map((t) => t.pad), ['upgrade', 'gate']);
    assert.ok(trips[0].legs.every((l) => l.ok) && trips[1].legs.every((l) => l.ok), JSON.stringify(trips));
    // The milestones came in the run's order, and each one once.
    const order = ['firstScoop', 'firstHandIn', 'firstCoins', 'upgradePaid', 'gatePaid', 'gateOpened'];
    for (const name of order) assert.ok(marks[name], `${name} happened`);
    for (let k = 1; k < order.length; k++) assert.ok(at(order[k]) > at(order[k - 1]), `${order[k - 1]} (${at(order[k - 1])}) before ${order[k]} (${at(order[k])})`);
    assert.ok(at('upgradePad') >= at('firstHandIn') && at('upgradePad') <= at('firstHandIn') + 2 * dt, 'the upgrade pad shows up with the first hand-in');
    assert.equal(at('tier2'), at('upgradePaid'), 'tier 2 comes with the upgrade payment');
    assert.equal(marks.tier2.tier, 2);
    assert.equal(at('gateOpening'), at('gatePaid'), 'the gate starts to open in the frame of the payment');
    assert.ok(Math.abs(at('gateOpened') - at('gateOpening') - Config.gate.openTime) <= 1.5 * dt, `the gate takes ${Config.gate.openTime} s to open (${(at('gateOpened') - at('gateOpening')).toFixed(3)})`);
    assert.ok(marks.gateOpened.clock < 45, `a run of about 20 s takes ${marks.gateOpened.clock} s`);
    // Both prices paid in full, once; tier 2 bought once.
    assert.ok(pads.upgrade.paid && pads.upgrade.closed && pads.gate.paid);
    assert.equal(pads.upgrade.stored, Config.economy.upgradePrice);
    assert.equal(pads.gate.stored, Config.economy.gatePrice);
    assert.equal(tractor.tier, 2);
    // The tutorial walked its steps in order, once each, and is done.
    assert.deepEqual(steps.map((s) => s.step), ['sell', 'upgrade', 'gate', 'done']);
    assert.ok(Math.abs(steps[1].clock - at('upgradePad')) <= 2 * dt, 'Upgrade when the pad shows up');
    assert.ok(Math.abs(steps[2].clock - at('upgradePaid')) <= 2 * dt, 'Gate when the upgrade is bought');
    assert.ok(Math.abs(steps[3].clock - at('gateOpening')) <= 2 * dt, 'Done when the gate starts to open');
    assert.equal(tutorial.target, null);
    // The wallet: nothing was granted, so what the purse and the pads hold is exactly what was shredded.
    assert.equal(shredder.inFlight, 0);
    assert.equal(coins.pending, 0);
    assert.equal(ledger(), 2 * shredder.shredded);
    const held = accountHeld(world);
    assert.equal(held.stray, 0);
    assert.equal(held.twice, 0);
    assert.equal(held.removed, shredder.shredded);
    const m = measure(world);
    assert.equal(m.outside, 0, 'no free ball left the arena');
    assert.equal(m.nan, 0);
    assert.ok(m.wall < 1e-6, `no free ball inside a rock (${m.wall})`);
  });
}
