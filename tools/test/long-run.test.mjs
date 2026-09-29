import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES } from '../scenarios/lib/sweep.mjs';
import { accountHeld, frame, longRun, makeWorld, measure } from './ball-world.mjs';

// The browser `long-run` scenario's rounds on the pure models, at 30 fps (a phone that cannot hold 60).
test('long run: tier 1, the upgrade bought on the pad, tier 2: most of the carpet into the shredder, every ball paid exactly once', () => {
  const world = makeWorld({ shredder: true, pads: true });
  const { balls, shredder, purse, coins, pads, tractor } = world;
  const total = balls.count;
  const problems = [];
  const ledger = () => purse.total + coins.pending + pads.upgrade.stored + pads.upgrade.inFlight + pads.gate.stored + pads.gate.inFlight;
  let inGateZone = 0;
  const rounds = longRun(world, () => {
    if (pads.gate.inZone) inGateZone++;
    return 1 / 30;
  }, (r) => {
    // A full bucket at the end of the fill-up (tier 2 may come half way) is handed in whole.
    if (r.fill.reason !== 'full' || r.filled !== r.capacity) problems.push(`round ${r.round}: fill ended ${r.fill.reason} with ${r.filled} of ${r.capacity}`);
    if (r.sell.reason !== 'inZone' || r.sold !== r.filled) problems.push(`round ${r.round}: sell ended ${r.sell.reason}, sold ${r.sold} of ${r.filled}`);
    if (ledger() !== 2 * shredder.shredded) problems.push(`round ${r.round}: purse ${purse.total} + ${coins.pending} + pads vs 2 x ${shredder.shredded}`);
    const held = accountHeld(world);
    if (held.stray || held.twice) problems.push(`round ${r.round}: ${held.stray} stray, ${held.twice} held twice`);
  });
  // Stand still until everything has landed and every coin has arrived.
  for (let f = 0; f < 30 * 5; f++) {
    frame(world, 1 / 30, 0, 0);
    balls.clearMoved();
  }
  const phases = PHASES.map((_, k) => rounds.filter((r) => r.phase === k).length);
  const { upgrade } = rounds;
  console.log(`long run: ${phases.join(' + ')} rounds, tier 2 from round ${upgrade.round} (${upgrade.onTheWay ? 'bought on the way' : 'drove onto the pad'}), ` +
    `shredded ${shredder.shredded} of ${total} (throat ${shredder.swallowed}), purse ${purse.total}, upgrade pad ${pads.upgrade.stored}`);
  assert.deepEqual(problems, []);
  // Paying the gate ends the run, and the purse holds far more than its price on this tour.
  assert.equal(inGateZone, 0, 'the tractor never set foot on the gate pad');
  assert.ok(!pads.gate.paid && world.gate.phase === 'closed' && !world.input.isLocked, 'the gate stays shut, the controls on');
  assert.equal(tractor.tier, 2, 'tier 2 bought');
  assert.ok(pads.upgrade.paid && pads.upgrade.closed);
  assert.ok(upgrade.legs.every((l) => l.ok), JSON.stringify(upgrade.legs));
  assert.ok(phases[0] >= 5 && phases[1] >= 5, `both phases ran several rounds (${phases.join(', ')})`);
  assert.ok(shredder.shredded >= PHASES[PHASES.length - 1].share * total, `the carpet was swept down to the last phase's share (${shredder.shredded} of ${total})`);
  assert.equal(shredder.inFlight, 0);
  assert.equal(coins.pending, 0);
  assert.equal(ledger(), 2 * shredder.shredded);
  const held = accountHeld(world);
  assert.equal(held.held, held.removed);
  assert.equal(held.removed, shredder.shredded);
  const m = measure(world);
  assert.equal(m.outside, 0, 'no free ball left the arena');
  assert.equal(m.nan, 0);
  assert.ok(m.wall < 1e-6, `no free ball inside a rock (${m.wall})`);
});
