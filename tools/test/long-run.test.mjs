import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { PHASES } from '../scenarios/lib/sweep.mjs';
import { accountHeld, frame, longRun, makeWorld, measure } from './ball-world.mjs';

// The browser `long-run` scenario's rounds on the pure models, at 30 fps (a phone that cannot hold 60).
test('long run: tier 1 then tier 2 sweep most of the carpet into the shredder, every ball paid exactly once', () => {
  const world = makeWorld({ shredder: true });
  const { balls, shredder, purse, coins } = world;
  const total = balls.count;
  const problems = [];
  const rounds = longRun(world, () => 1 / 30, (r) => {
    const capacity = Config.tractor.tiers[PHASES[r.phase].tier].bucketCapacity;
    if (r.fill.reason !== 'full' || r.filled !== capacity) problems.push(`round ${r.round}: fill ended ${r.fill.reason} with ${r.filled}`);
    if (r.sell.reason !== 'inZone' || r.sold !== capacity) problems.push(`round ${r.round}: sell ended ${r.sell.reason}, sold ${r.sold} of ${capacity}`);
    if (purse.total + coins.pending !== 2 * shredder.shredded) problems.push(`round ${r.round}: purse ${purse.total} + ${coins.pending} vs 2 x ${shredder.shredded}`);
    const held = accountHeld(world);
    if (held.stray || held.twice) problems.push(`round ${r.round}: ${held.stray} stray, ${held.twice} held twice`);
  });
  // Stand still until everything has landed and every coin has arrived.
  for (let f = 0; f < 30 * 5; f++) {
    frame(world, 1 / 30, 0, 0);
    balls.clearMoved();
  }
  const phases = PHASES.map((_, k) => rounds.filter((r) => r.phase === k).length);
  console.log(`long run: ${phases.join(' + ')} rounds, shredded ${shredder.shredded} of ${total} (throat ${shredder.swallowed}), purse ${purse.total}`);
  assert.deepEqual(problems, []);
  assert.ok(phases[0] >= 20 && phases[1] >= 5, `both phases ran several rounds (${phases.join(', ')})`);
  assert.ok(shredder.shredded >= PHASES[PHASES.length - 1].share * total, `the carpet was swept down to the last phase's share (${shredder.shredded} of ${total})`);
  assert.equal(shredder.inFlight, 0);
  assert.equal(coins.pending, 0);
  assert.equal(purse.total, 2 * shredder.shredded);
  const held = accountHeld(world);
  assert.equal(held.held, held.removed);
  assert.equal(held.removed, shredder.shredded);
  const m = measure(world);
  assert.equal(m.outside, 0, 'no free ball left the arena');
  assert.equal(m.nan, 0);
  assert.ok(m.wall < 1e-6, `no free ball inside a rock (${m.wall})`);
});
