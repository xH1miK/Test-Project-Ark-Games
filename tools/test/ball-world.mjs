// The real arena for ball tests and the benchmark: obstacles from tools/test/fixtures/level.json
// (dumped from Main.scene), the carpet laid with the game's Config, a tractor and an autopilot.
// Not a test file itself (no .test suffix); needs the register hook for the .ts imports.

import { readFileSync } from 'node:fs';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { layCarpet } from '../../assets/scripts/balls/BallCarpet.ts';
import { CoinFlights } from '../../assets/scripts/economy/CoinFlights.ts';
import { PayPad } from '../../assets/scripts/economy/PayPad.ts';
import { Progression } from '../../assets/scripts/economy/Progression.ts';
import { Purse } from '../../assets/scripts/economy/Purse.ts';
import { Shredder } from '../../assets/scripts/economy/Shredder.ts';
import { Bucket } from '../../assets/scripts/tractor/Bucket.ts';
import { TractorModel } from '../../assets/scripts/tractor/TractorModel.ts';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';
import { PHASES, pickFillTarget, roundLegs, sweepFrame, upgradeLegs } from '../scenarios/lib/sweep.mjs';

/** The bucket's settings the way GameRoot builds them. */
export const BUCKET_SETTINGS = { ...Config.bucket, radius: Config.balls.radius, gravity: Config.balls.gravity };
/** Most balls any tier's bucket holds. */
export const BUCKET_SLOTS = Math.max(...Config.tractor.tiers.map((t) => t.bucketCapacity));
/** The shredder's settings the way GameRoot builds them. */
export const SHREDDER_SETTINGS = { ...Config.shredder, coinsPerBall: Config.economy.coinsPerBall };

export const LEVEL = JSON.parse(readFileSync(new URL('./fixtures/level.json', import.meta.url), 'utf8'));

/** Where the shredder stands in the level (Level/Shredder), heading in radians. */
export const SHREDDER_POSE = (() => {
  const s = LEVEL.spots.shredder;
  return { x: s.x, y: s.y, z: s.z, yaw: (s.yaw * Math.PI) / 180 };
})();

/**
 * How far a carried ball's centre (x, y, z in the bucket's axes) is outside the cavity of shape `s`
 * (negative inside): under the floor, past a side wall, the back or the lip, or into the rounded edge
 * between the floor and the back. The heap above the rim is not limited here.
 */
export function cavityBreach(s, r, x, y, z) {
  let out = Math.max(s.floor + r - y, Math.abs(x) - (s.halfX - r), s.minZ + r - z, z - (s.maxZ - r));
  const round = s.backRound ?? 0;
  if (round > r) {
    const dz = z - (s.minZ + round);
    const dy = y - (s.floor + round);
    if (dz < 0 && dy < 0) out = Math.max(out, Math.hypot(dz, dy) - (round - r));
  }
  return out;
}

/** A pad's plate grown by the clear margin: the zone balls are kept off (as GameRoot builds it). */
export const clearRect = (plate, margin = Config.pads.clearMargin) =>
  ({ minX: plate.minX - margin, maxX: plate.maxX + margin, minZ: plate.minZ - margin, maxZ: plate.maxZ + margin });

export function arenaGrid() {
  const grid = new ObstacleGrid(LEVEL.bounds, LEVEL.cellSize);
  for (const o of LEVEL.obstacles) grid.add(o, o.mask);
  return grid;
}

/**
 * Arena + carpet + tractor on its start spot, and the bucket unless `bucket: false` (then the bucket
 * box only pushes, as before M5). With `shredder: true` also the shredder on its spot, the purse and
 * the coins in the air; with `pads: true` (needs the shredder) also the pay pads on their spots with
 * their plates from the fixture and the progression (the gate's plate is a hole in the carpet): all
 * wired the way GameRoot wires them (an event bus is made if none is given). `settings` overrides
 * Config.balls.
 */
export function makeWorld({ tier = 0, settings = {}, carpet = true, bucket = true, shredder = false, pads = false, events = null } = {}) {
  const grid = arenaGrid();
  const ballSettings = { ...Config.balls, ...settings };
  let carpetSpec = ballSettings.carpet;
  if (pads) {
    const r = clearRect(LEVEL.plates.gate);
    const k = ballSettings.radius; // a carpet hole keeps centres a radius off its edge: the zone's edge then
    carpetSpec = { ...carpetSpec, holes: [...carpetSpec.holes, { kind: 'box', x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, halfX: (r.maxX - r.minX) / 2 - k, halfZ: (r.maxZ - r.minZ) / 2 - k }] };
  }
  const centres = carpet ? layCarpet(carpetSpec, ballSettings.radius, ballSettings.maxCount, grid) : new Float64Array(0);
  const balls = new BallField(ballSettings, Math.max(64, centres.length / 2 + 64), grid);
  for (let k = 0; k < centres.length; k += 2) balls.add(centres[k], ballSettings.radius, centres[k + 1]);
  const bus = events ?? (shredder ? new EventBus() : null);
  const tractor = new TractorModel(Config.tractor, Config.tractor.tiers, grid, bus);
  tractor.setTier(tier + 1);
  const start = LEVEL.spots.tractorStart;
  tractor.place(start.x, start.z, (start.yaw * Math.PI) / 180);
  const scoop = bucket ? new Bucket({ ...BUCKET_SETTINGS, radius: ballSettings.radius, gravity: ballSettings.gravity }, balls, tractor, BUCKET_SLOTS, bus) : null;
  const world = { grid, balls, tractor, bucket: scoop, settings: ballSettings, events: bus, shredder: null, purse: null, coins: null, pads: null, progression: null };
  if (shredder) {
    world.shredder = new Shredder(SHREDDER_SETTINGS, SHREDDER_POSE, balls, scoop, tractor, bus);
    world.purse = new Purse(bus);
    world.coins = new CoinFlights(Config.coinFx, world.purse);
    bus.on('coinsEarned', ({ amount, x, y, z }) => world.coins.launch(amount, x, y, z));
  }
  if (pads) {
    const { upgradePrice, gatePrice } = Config.economy;
    const spots = LEVEL.spots;
    const upgrade = new PayPad('upgrade', Config.pads, spots.upgradePad, upgradePrice, world.purse, tractor, Config.coinFx, bus,
      { shown: false, plate: clearRect(LEVEL.plates.upgrade) });
    const gate = new PayPad('gate', Config.pads, spots.gatePad, gatePrice, world.purse, tractor, Config.coinFx, bus,
      { shown: true, plate: clearRect(LEVEL.plates.gate) });
    balls.addClearZone(upgrade.clearZone);
    balls.addClearZone(gate.clearZone);
    world.pads = { upgrade, gate };
    world.progression = new Progression(Config.pads, upgrade, gate, balls, tractor, bus);
  }
  return world;
}

/**
 * One frame the way GameRoot runs it: split into steps of at most Config.time.maxStep (tractor, scoop,
 * balls, carry, shredder), then the coins in the air, then the pay pads.
 */
export function frame(world, dt, inputX, inputZ, onStep) {
  const steps = Math.ceil(dt / Config.time.maxStep - 1e-9);
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    world.tractor.update(h, inputX, inputZ);
    world.bucket?.scoop();
    world.balls.step(h, world.tractor);
    world.bucket?.carry(h);
    world.shredder?.step(h);
    onStep?.();
  }
  world.coins?.update(dt);
  world.progression?.step(dt);
}

/** Steers toward waypoints in turn: returns the stick for this frame, or null when the route is done. */
export function autopilot(route, reach = 1) {
  let leg = 0;
  return (tractor) => {
    while (leg < route.length) {
      const [x, z] = route[leg];
      const dx = x - tractor.x;
      const dz = z - tractor.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) return { x: dx / d, z: dz / d, leg };
      leg++;
    }
    return null;
  };
}

/** A drive through the thick of the carpet and back to the start (world XZ waypoints). */
export const CARPET_ROUTE = [
  [12, -6], [11, 10], [-1, 12], [-2, -6], [3, 2], [12, 4], [8, 14], [0, 6], [9, -8],
];

/**
 * Where a ball centre can be inside the arena: a flood fill from the tractor start over the positions
 * where a ball touches no rock (the rocks close the arena; the field edges are only a safety net).
 * Returns inArena(x, z).
 */
export function arenaMask(grid, radius, step = 0.1) {
  const { minX, maxX, minZ, maxZ } = grid.bounds;
  const cols = Math.round((maxX - minX) / step);
  const rows = Math.round((maxZ - minZ) / step);
  const seen = new Uint8Array(cols * rows);
  const start = LEVEL.spots.tractorStart;
  const queue = [Math.floor((start.x - minX) / step) + Math.floor((start.z - minZ) / step) * cols];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop();
    const c = i % cols;
    const k = (i - c) / cols;
    for (const [dc, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nk = k + dk;
      const j = nc + nk * cols;
      if (nc < 0 || nk < 0 || nc >= cols || nk >= rows || seen[j]) continue;
      if (grid.overlapsCircle(minX + nc * step, minZ + nk * step, radius, Blocks.Balls)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  // A ball touching a rock sits between samples: inside when any of the 4 samples around it is.
  return (x, z) => {
    const c = Math.floor((x - minX) / step);
    const k = Math.floor((z - minZ) / step);
    if (c < 0 || k < 0 || c >= cols - 1 || k >= rows - 1) return false;
    return !!(seen[c + k * cols] | seen[c + 1 + k * cols] | seen[c + (k + 1) * cols] | seen[c + 1 + (k + 1) * cols]);
  };
}

/**
 * Worst overlaps and escapes of the free balls (for checks; held balls are the bucket's, see
 * measureLoad). `outside` = left the arena or sank under the floor.
 */
export function measure(world) {
  const { balls, grid, tractor, settings } = world;
  const r = settings.radius;
  const n = balls.count;
  const tmp = { x: 0, z: 0 };
  world.inArena ??= arenaMask(grid, r);
  let overlap = 0;
  let contacts = 0;
  let deep = 0;
  let wall = 0;
  let inPusher = 0;
  let outside = 0;
  let nan = 0;
  let above = 0;
  const cos = Math.cos(tractor.yaw);
  const sin = Math.sin(tractor.yaw);
  for (let i = 0; i < n; i++) {
    if (balls.isHeld(i)) continue;
    const x = balls.x[i], y = balls.y[i], z = balls.z[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan++;
    if (!world.inArena(x, z) || y < r - 1e-9) outside++;
    wall = Math.max(wall, grid.resolveCircle(x, z, r, Blocks.Balls, tmp));
    above = Math.max(above, y);
    // Depth inside the tractor's boxes (pusher axes).
    const dx = x - tractor.x, dz = z - tractor.z;
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    for (const box of tractor.pusherBoxes) {
      if (y - r > box.top) continue;
      const qx = Math.max(-box.halfX, Math.min(box.halfX, lx));
      const qz = Math.max(box.minZ, Math.min(box.maxZ, lz));
      const d = Math.hypot(lx - qx, lz - qz);
      const depth = d > 0 ? r - d : r + Math.min(box.halfX - Math.abs(lx), lz - box.minZ, box.maxZ - lz);
      inPusher = Math.max(inPusher, depth);
    }
  }
  // Ball-ball overlap through a simple grid.
  const b = settings.bounds, cell = 2 * r, cols = Math.ceil((b.maxX - b.minX) / cell), rows = Math.ceil((b.maxZ - b.minZ) / cell);
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    if (balls.isHeld(i)) continue;
    const key = Math.floor((balls.x[i] - b.minX) / cell) + Math.floor((balls.z[i] - b.minZ) / cell) * cols;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  for (let i = 0; i < n; i++) {
    if (balls.isHeld(i)) continue;
    const c = Math.floor((balls.x[i] - b.minX) / cell), k = Math.floor((balls.z[i] - b.minZ) / cell);
    for (let kk = k - 1; kk <= k + 1; kk++) for (let cc = c - 1; cc <= c + 1; cc++) {
      if (cc < 0 || kk < 0 || cc >= cols || kk >= rows) continue;
      for (const j of buckets.get(cc + kk * cols) || []) {
        if (j <= i) continue;
        const d = Math.hypot(balls.x[j] - balls.x[i], balls.y[j] - balls.y[i], balls.z[j] - balls.z[i]);
        overlap = Math.max(overlap, 2 * r - d);
        if (d < 2 * r) contacts++;
        if (d < 2 * r - DEEP) deep++;
      }
    }
  }
  return { overlap, contacts, deep, wall, inPusher: Math.max(0, inPusher), outside, nan, above };
}

/** Ball-ball overlap that counts as deep (visible interpenetration), units. */
export const DEEP = 0.1;

/**
 * The bucket's load right now: how far a carried ball is outside the cavity beyond the slack it is
 * still being drawn in by (below the floor, past a side, the back wall or the lip; the heap above the
 * rim is allowed), the worst overlap of two carried balls, the lowest carried ball, whether the field
 * has each carried ball at pose ⊗ local, and whether every carried ball is held.
 */
export function measureLoad(world) {
  const { balls, tractor, bucket, settings } = world;
  const r = settings.radius;
  const load = bucket.load;
  const s = load.shape;
  const cos = Math.cos(tractor.yaw);
  const sin = Math.sin(tractor.yaw);
  let outside = 0;
  let overlap = 0;
  let lowest = Infinity;
  let placed = 0;
  let notHeld = 0;
  for (let k = 0; k < load.count; k++) {
    const x = load.x[k], y = load.y[k], z = load.z[k];
    outside = Math.max(outside, cavityBreach(s, r, x, y, z) - load.slack[k]);
    lowest = Math.min(lowest, y + load.slack[k]);
    for (let j = k + 1; j < load.count; j++) overlap = Math.max(overlap, 2 * r - Math.hypot(load.x[j] - x, load.y[j] - y, load.z[j] - z));
    const i = load.index[k];
    if (!balls.isHeld(i)) notHeld++;
    placed = Math.max(placed, Math.abs(balls.x[i] - (tractor.x + x * cos + z * sin)), Math.abs(balls.y[i] - y), Math.abs(balls.z[i] - (tractor.z - x * sin + z * cos)));
  }
  return { count: load.count, outside: Math.max(0, outside), overlap: Math.max(0, overlap), lowest, placed, notHeld, heldTotal: balls.heldCount };
}

/**
 * Who holds each held ball: every one must be exactly one of carried (in the bucket), flying (into the
 * shredder) or removed (shredded). `stray`: held by nobody; `twice`: claimed twice, or claimed while free.
 */
export function accountHeld(world) {
  const { balls, bucket, shredder } = world;
  const carried = new Uint8Array(balls.count);
  for (let k = 0; k < (bucket?.count ?? 0); k++) carried[bucket.index[k]]++;
  let held = 0;
  let stray = 0;
  let twice = 0;
  for (let i = 0; i < balls.count; i++) {
    const roles = carried[i] + (shredder?.flights.isFlying(i) ? 1 : 0) + (balls.isRemoved(i) ? 1 : 0);
    if (!balls.isHeld(i)) {
      if (roles > 0) twice++;
      continue;
    }
    held++;
    if (roles === 0) stray++;
    else if (roles > 1) twice++;
  }
  return { held, carried: bucket?.count ?? 0, flying: shredder?.inFlight ?? 0, removed: balls.removedCount, stray, twice };
}

/**
 * Drives legs in the format of the browser scenarios' autopilot (tools/scenarios/lib/autopilot.mjs),
 * with its rules: { kind: 'goto', x, z, radius? } | { kind: 'push', dx, dz, time } |
 * { kind: 'stop', time } (ends once the tractor stands still) | { kind: 'seek', target, radius?, stall? },
 * each with an optional `until` and timeout (s, default 20), plus { kind: 'tier', index }. `nextDt()`
 * gives each frame's time; `targets` are the seek legs' point sources, (leg, stalled) => point | null;
 * `until` adds conditions to the built-in `full` and `inZone`. Returns one result per driven leg.
 */
export function driveLegs(world, legs, nextDt, { targets = {}, until = {} } = {}) {
  const { tractor, balls } = world;
  const conditions = { full: () => world.bucket.full, inZone: () => world.shredder.inZone, ...until };
  const results = [];
  for (const leg of legs) {
    if (leg.kind === 'tier') {
      tractor.setTier(leg.index + 1);
      continue;
    }
    const radius = leg.radius || 1;
    let t = 0;
    let point = leg;
    let fromX = tractor.x;
    let fromZ = tractor.z;
    let best = Infinity;
    let bestAt = 0;
    let picks = 0;
    const aim = (stalled) => {
      point = targets[leg.target](leg, stalled);
      picks++;
      if (!point) return false;
      fromX = tractor.x;
      fromZ = tractor.z;
      best = Infinity;
      bestAt = t;
      return true;
    };
    let reason = leg.kind === 'seek' && !aim(null) ? 'none left' : null;
    while (!reason) {
      let x = 0;
      let z = 0;
      if (leg.until && conditions[leg.until]()) {
        reason = leg.until;
        break;
      }
      if (leg.kind === 'goto' || leg.kind === 'seek') {
        let dx = point.x - tractor.x;
        let dz = point.z - tractor.z;
        let d = Math.hypot(dx, dz);
        const passed = dx * (point.x - fromX) + dz * (point.z - fromZ) <= 0;
        if (leg.kind === 'goto') {
          if (d <= radius || passed) {
            reason = d <= radius ? 'reached' : 'passed';
            break;
          }
        } else {
          if (d < best - 0.25) {
            best = d;
            bestAt = t;
          }
          const stalled = t - bestAt > (leg.stall || 1.5);
          if (d <= radius || passed || stalled) {
            if (!aim(stalled ? point : null)) {
              reason = 'none left';
              break;
            }
            dx = point.x - tractor.x;
            dz = point.z - tractor.z;
            d = Math.hypot(dx, dz);
          }
        }
        x = dx / d;
        z = dz / d;
      } else if (leg.kind === 'push') {
        if (t >= leg.time) {
          reason = 'time';
          break;
        }
        x = leg.dx;
        z = leg.dz;
      } else if (t >= leg.time && tractor.speed === 0) {
        reason = 'stopped';
        break;
      }
      if (t > (leg.timeout || 20)) {
        reason = 'timeout';
        break;
      }
      const dt = nextDt();
      frame(world, dt, x, z);
      balls.clearMoved();
      t += dt;
    }
    results.push({ name: leg.name, ok: reason !== 'timeout', reason, t, picks });
  }
  return results;
}

/**
 * The browser `long-run` scenario on the pure models (tools/scenarios/lib/sweep.mjs): rounds of a
 * fill-up near the next tour point and a hand-in at the shredder until the phase's share of the
 * carpet is shredded, a phase per tier. Tier 2 is bought on the upgrade pad, usually on the way (the
 * tier-1 phase ends then), else by driving onto it before the tier-2 phase. The world needs the
 * shredder and the pads. `nextDt()` gives each frame's time; `onRound(round)` sees every round as it
 * ends. Returns the rounds: { phase, round, fill, sell (leg results), filled (balls when the fill-up
 * ended), capacity (the bucket's then), sold (the hand-in as the body entered the zone) } and, as
 * `rounds.upgrade`, how tier 2 came: { round (the first round on tier 2), onTheWay, legs }.
 */
export function longRun(world, nextDt, onRound) {
  const { balls, bucket, shredder, tractor, pads } = world;
  const until = { upgraded: () => tractor.tier >= 2 };
  let round = 0;
  let upgradedIn = -1;
  world.events.on('tierChanged', () => { if (upgradedIn < 0) upgradedIn = round; });
  const frameOptions = sweepFrame(SHREDDER_POSE, Config.shredder.zoneHalf);
  const tabu = [];
  const targets = {
    balls: (leg, stalled) => {
      if (stalled) tabu.push(stalled.cell);
      return pickFillTarget(balls, tractor, { ...frameOptions, toward: leg.toward, minMass: leg.minMass, clearance: leg.clearance, tabu, obstacles: world.grid });
    },
  };
  const rounds = [];
  for (const [phase, { tier, share, maxRounds }] of PHASES.entries()) {
    if (tractor.tier < tier + 1) {
      const legs = driveLegs(world, upgradeLegs(tractor, SHREDDER_POSE, pads.upgrade), nextDt, { until });
      rounds.upgrade = { round, onTheWay: false, legs };
    }
    for (let k = 0; k < maxRounds && shredder.shredded + shredder.inFlight < share * balls.count; k++, round++) {
      // A phase ends when the tractor has moved on to another tier (bought on the way).
      if (phase < PHASES.length - 1 && tractor.tier !== tier + 1) break;
      const [fillLeg, sellLeg] = roundLegs(round, tractor.tier - 1, SHREDDER_POSE);
      const [fill] = driveLegs(world, [fillLeg], nextDt, { targets, until });
      const filled = bucket.count;
      const capacity = tractor.bucketCapacity;
      const handed = shredder.handedIn;
      const [sell] = driveLegs(world, [sellLeg], nextDt, { until });
      const entry = { phase, round, fill, sell, filled, capacity, sold: shredder.handedIn - handed };
      rounds.push(entry);
      onRound?.(entry);
    }
  }
  rounds.upgrade ??= { round: upgradedIn + 1, onTheWay: true, legs: [] };
  return rounds;
}

/** The route of the browser `balls` scenario on 28.09: a short push into the carpet, T1 through it, then T2. */
export const BALLS_SCENARIO_ROUTE = [
  { kind: 'goto', x: 8.3, z: -11, radius: 0.3 }, { kind: 'push', dx: -1, dz: 0, time: 0.9 }, { kind: 'stop', time: 0.3 },
  { kind: 'goto', x: 12, z: -5 }, { kind: 'goto', x: 11, z: 5 }, { kind: 'goto', x: 1, z: 8 }, { kind: 'goto', x: -2, z: 0 },
  { kind: 'goto', x: 5, z: 3.5 }, { kind: 'stop', time: 0.5 },
  { kind: 'tier', index: 1 },
  { kind: 'goto', x: 10, z: 12 }, { kind: 'goto', x: -1, z: 13 }, { kind: 'goto', x: -2, z: -6 }, { kind: 'goto', x: 10, z: -5 },
  { kind: 'stop', time: 0.5 },
];
