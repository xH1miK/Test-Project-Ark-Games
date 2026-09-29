#!/usr/bin/env node
// The long run on the pure models (the browser `long-run` scenario's rounds, tools/scenarios/lib/sweep.mjs):
// tier 1 fills near a tour point and sells until 35% of the carpet is shredded or tier 2 is bought on
// the upgrade pad on the way, then tier 2 (60 a load) until 70%. Reports every round, the ball step per phase (mean / p95 / max), the accounting at the
// end (purse and coins in the air vs shredded balls, who holds each held ball, balls outside the
// arena) and a map of what is left of the carpet.
//
//   node --import ./tools/test/register.mjs tools/bench/long-run.mjs [--fps 60]

import { PHASES } from '../scenarios/lib/sweep.mjs';
import { accountHeld, frame, longRun, makeWorld, measure } from '../test/ball-world.mjs';

const argv = process.argv.slice(2);
const fps = Number(argv[argv.indexOf('--fps') + 1] || 60);
const dt = 1 / fps;

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { mean: values.reduce((s, v) => s + v, 0) / Math.max(1, values.length), p95: at(0.95), max: at(1) };
};

const world = makeWorld({ shredder: true, pads: true });
const { balls, bucket, shredder, purse, coins, tractor, grid, pads } = world;
const total = balls.count;
// Time of every ball step, per phase.
const stepMs = PHASES.map(() => []);
let phaseNow = 0;
const step = balls.step.bind(balls);
balls.step = (h, pusher) => {
  const t0 = performance.now();
  step(h, pusher);
  stepMs[phaseNow].push(performance.now() - t0);
};

let clock = 0;
const nextDt = () => {
  clock += dt;
  return dt;
};
const wall0 = performance.now();
const rounds = longRun(world, nextDt, (r) => {
  phaseNow = r.phase;
  const tier = PHASES[r.phase].name;
  console.log(`${tier} round ${String(r.round).padStart(2)}: ${r.fill.name} -> ${r.fill.reason} in ${r.fill.t.toFixed(1)} s (${r.fill.picks} picks), ` +
    `${r.filled} of ${r.capacity} in the bucket; sold ${r.sold} after ${r.sell.t.toFixed(1)} s; shredded ${shredder.shredded}, purse ${purse.total} + ${coins.pending} in the air; clock ${clock.toFixed(0)} s`);
});
// Stand still until everything has landed, every coin has arrived and the carpet sleeps.
for (let f = 0; f < fps * 5; f++) {
  frame(world, nextDt(), 0, 0);
  balls.clearMoved();
}
const wall = performance.now() - wall0;

const held = accountHeld(world);
const m = measure(world);
console.log(`\n=== long run at ${fps} fps: ${rounds.length} rounds, ${clock.toFixed(0)} s of game time (${(wall / 1000).toFixed(1)} s wall), odometer ${tractor.odometer.toFixed(0)} u ===`);
for (const [k, phase] of PHASES.entries()) {
  const own = rounds.filter((r) => r.phase === k);
  const s = stats(stepMs[k]);
  console.log(`${phase.name}: ${own.length} rounds, loads sold ${own.map((r) => r.sold).join(' ')}; ball step ${s.mean.toFixed(3)} ms mean, ${s.p95.toFixed(3)} p95, ${s.max.toFixed(3)} max over ${stepMs[k].length} steps`);
}
const onPads = pads.upgrade.stored + pads.upgrade.inFlight + pads.gate.stored + pads.gate.inFlight;
console.log(`tier 2 from round ${rounds.upgrade.round} (${rounds.upgrade.onTheWay ? 'bought on the way' : 'drove onto the pad'}); upgrade pad ${pads.upgrade.stored} of ${pads.upgrade.price}`);
console.log(`shredded ${shredder.shredded} of ${total} (${((100 * shredder.shredded) / total).toFixed(0)}%): handed in ${shredder.handedIn}, throat ${shredder.swallowed}; ` +
  `purse ${purse.total} + ${coins.pending} in the air + ${onPads} on the pads = 2 x ${shredder.shredded}: ${purse.total + coins.pending + onPads === 2 * shredder.shredded ? 'yes' : 'NO'}`);
console.log(`held ${held.held} = ${held.carried} carried + ${held.flying} flying + ${held.removed} removed; stray ${held.stray}, twice ${held.twice}; ` +
  `free balls outside the arena ${m.outside}, NaN ${m.nan}, in rocks ${m.wall.toFixed(4)}; simulated at rest ${balls.simulatedCount}; bucket ${bucket.count}`);

// What is left of the carpet: free balls per 1x1 cell (. none, : 1-2, o 3-5, O 6+), # rock.
const counts = new Map();
for (let i = 0; i < balls.count; i++) {
  if (balls.isHeld(i)) continue;
  const key = `${Math.floor(balls.x[i])},${Math.floor(balls.z[i])}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}
for (let z = -13; z <= 16; z++) {
  let line = `${String(z).padStart(4)} `;
  for (let x = -6; x <= 16; x++) {
    const n = counts.get(`${x},${z}`) || 0;
    line += grid.overlapsCircle(x + 0.5, z + 0.5, 0.05, 1) ? '#' : n === 0 ? '.' : n < 3 ? ':' : n < 6 ? 'o' : 'O';
  }
  console.log(line);
}
