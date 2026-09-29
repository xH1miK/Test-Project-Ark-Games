#!/usr/bin/env node
// The full run (M12) on the pure models: a fresh start, tier 1 until the purse pays the upgrade pad,
// tier 2 until it pays the gate pad, the gate opens. No coin comes from outside. Prints every round,
// the visits to the pads, the milestones (game time), and the wallet at the end.
//
//   node --import ./tools/test/register.mjs tools/bench/full-run.mjs [--fps 60]

import { accountHeld, frame, fullRun, makeWorld } from '../test/ball-world.mjs';

const argv = process.argv.slice(2);
const fps = Number(argv[argv.indexOf('--fps') + 1] || 60);
const world = makeWorld({ shredder: true, pads: true });
const { balls, shredder, purse, coins, pads, tractor } = world;
const wall0 = performance.now();
const run = fullRun(world, () => 1 / fps, (r) => {
  console.log(`T${r.tier} round ${String(r.round).padStart(2)}: ${r.fill.name} -> ${r.fill.reason} in ${r.fill.t.toFixed(1)} s (${r.fill.picks} picks), ${r.filled} of ${r.capacity} in the bucket; ` +
    `sold ${r.sold} after ${r.sell.t.toFixed(1)} s; shredded ${shredder.shredded}, purse ${purse.total} + ${coins.pending} in the air; clock ${r.clock.toFixed(1)} s`);
});
for (const trip of run.trips) {
  console.log(`trip to the ${trip.pad} pad before round ${trip.round}: ${trip.legs.map((l) => `${l.name} ${l.reason} ${l.t.toFixed(1)}s`).join('; ')}`);
}
for (let f = 0; f < fps * 3; f++) {
  frame(world, 1 / fps, 0, 0);
  balls.clearMoved();
}
console.log(`\n=== full run at ${fps} fps: ${run.rounds.length} rounds, ${run.clock.toFixed(1)} s of game time (${((performance.now() - wall0) / 1000).toFixed(1)} s wall), ended ${run.ended} ===`);
for (const [name, m] of Object.entries(run.marks)) console.log(`  ${name.padEnd(12)} ${m.clock.toFixed(2).padStart(7)} s   shredded ${String(m.shredded).padStart(4)}   purse ${String(m.purse).padStart(4)}   tier ${m.tier}`);
const held = accountHeld(world);
console.log(`shredded ${shredder.shredded} of ${balls.count}; purse ${purse.total}, pads ${pads.upgrade.stored} + ${pads.gate.stored}, in the air ${coins.pending}; ` +
  `ledger ${purse.total + coins.pending + pads.upgrade.stored + pads.gate.stored} vs 2 x shredded ${2 * shredder.shredded}; tier ${tractor.tier}; held ${held.held} (removed ${held.removed}), gate ${world.gate.phase}, locked ${world.input.isLocked}`);
