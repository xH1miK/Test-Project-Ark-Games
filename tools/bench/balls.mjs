#!/usr/bin/env node
// Ball simulation benchmark on the real arena: the carpet from Config, the tractor driving a route
// through it by autopilot, frames split into steps the way GameRoot does. Reports the time of the
// ball step per frame (mean / p95 / max), how many balls were simulated (the rest slept), pair
// checks, and the state quality (overlaps, walls, balls left inside the tractor).
//
//   node --import ./tools/test/register.mjs tools/bench/balls.mjs [--fps 60] [--tier 1|2] [--frames-json out.json]

import { CARPET_ROUTE, autopilot, frame, makeWorld, measure } from '../test/ball-world.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const runs = argv.includes('--fps') || argv.includes('--tier')
  ? [{ fps: Number(opt('--fps', 60)), tier: Number(opt('--tier', 1)) }]
  : [{ fps: 60, tier: 1 }, { fps: 30, tier: 1 }, { fps: 60, tier: 2 }];

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { mean: values.reduce((s, v) => s + v, 0) / values.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
};

for (const { fps, tier } of runs) {
  const t0 = performance.now();
  const world = makeWorld({ tier: tier - 1 });
  const layMs = performance.now() - t0;
  const { balls, tractor } = world;
  const dt = 1 / fps;
  const steer = autopilot(CARPET_ROUTE);
  const ms = [];
  const simulated = [];
  const pairs = [];
  let worst = { overlap: 0, wall: 0, inPusher: 0, outside: 0, nan: 0, above: 0 };
  let frames = 0;
  // Drive the route (with a time limit), then stand still until the carpet sleeps again.
  for (let stick = steer(tractor); stick && frames < fps * 120; stick = steer(tractor), frames++) {
    const a = performance.now();
    frame(world, dt, stick.x, stick.z);
    ms.push(performance.now() - a);
    simulated.push(balls.simulatedCount);
    pairs.push(balls.pairChecks);
    if (frames % 10 === 0) {
      const m = measure(world);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], m[k]);
    }
  }
  const driveFrames = frames;
  let sleepAfter = -1;
  for (let f = 0; f < fps * 10; f++) {
    frame(world, dt, 0, 0);
    if (balls.simulatedCount === 0 && sleepAfter < 0) sleepAfter = (f + 1) / fps;
  }
  const end = measure(world);
  const time = stats(ms);
  const sim = stats(simulated);
  console.log(`\n=== T${tier} at ${fps} fps: ${balls.count} balls (carpet laid in ${layMs.toFixed(0)} ms) ===`);
  console.log(`route: ${driveFrames} frames (${(driveFrames / fps).toFixed(1)} s), tractor odometer ${tractor.odometer.toFixed(1)} u, ended at (${tractor.x.toFixed(1)}, ${tractor.z.toFixed(1)})`);
  console.log(`ball step per frame, ms: mean ${time.mean.toFixed(3)}  p50 ${time.p50.toFixed(3)}  p95 ${time.p95.toFixed(3)}  max ${time.max.toFixed(3)}`);
  console.log(`simulated balls per frame: mean ${sim.mean.toFixed(0)}  p95 ${sim.p95}  max ${sim.max}  (sleeping ${((1 - sim.mean / balls.count) * 100).toFixed(1)}% on average)`);
  console.log(`pair checks per frame: mean ${stats(pairs).mean.toFixed(0)}  max ${stats(pairs).max}`);
  console.log(`while driving (every 10th frame): max overlap ${worst.overlap.toFixed(4)}, in walls ${worst.wall.toFixed(4)}, inside tractor ${worst.inPusher.toFixed(4)}, outside ${worst.outside}, NaN ${worst.nan}, highest ball y ${worst.above.toFixed(2)}`);
  console.log(`after 10 s at rest: all asleep after ${sleepAfter < 0 ? 'never' : sleepAfter.toFixed(2) + ' s'}; max overlap ${end.overlap.toFixed(4)}, in walls ${end.wall.toFixed(4)}, inside tractor ${end.inPusher.toFixed(4)}, outside ${end.outside}, NaN ${end.nan}`);
}
