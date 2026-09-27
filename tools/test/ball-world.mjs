// The real arena for ball tests and the benchmark: obstacles from tools/test/fixtures/level.json
// (dumped from Main.scene), the carpet laid with the game's Config, a tractor and an autopilot.
// Not a test file itself (no .test suffix); needs the register hook for the .ts imports.

import { readFileSync } from 'node:fs';
import { Config } from '../../assets/scripts/core/Config.ts';
import { BallField } from '../../assets/scripts/balls/BallField.ts';
import { layCarpet } from '../../assets/scripts/balls/BallCarpet.ts';
import { TractorModel } from '../../assets/scripts/tractor/TractorModel.ts';
import { Blocks, ObstacleGrid } from '../../assets/scripts/world/ObstacleGrid.ts';

export const LEVEL = JSON.parse(readFileSync(new URL('./fixtures/level.json', import.meta.url), 'utf8'));

export function arenaGrid() {
  const grid = new ObstacleGrid(LEVEL.bounds, LEVEL.cellSize);
  for (const o of LEVEL.obstacles) grid.add(o, o.mask);
  return grid;
}

/** Arena + carpet + tractor on its start spot. `settings` overrides Config.balls. */
export function makeWorld({ tier = 0, settings = {}, carpet = true } = {}) {
  const grid = arenaGrid();
  const ballSettings = { ...Config.balls, ...settings };
  const centres = carpet ? layCarpet(ballSettings.carpet, ballSettings.radius, ballSettings.maxCount, grid) : new Float64Array(0);
  const balls = new BallField(ballSettings, Math.max(64, centres.length / 2 + 64), grid);
  for (let k = 0; k < centres.length; k += 2) balls.add(centres[k], ballSettings.radius, centres[k + 1]);
  const tractor = new TractorModel(Config.tractor, Config.tractor.tiers[tier], grid);
  const start = LEVEL.spots.tractorStart;
  tractor.place(start.x, start.z, (start.yaw * Math.PI) / 180);
  return { grid, balls, tractor, settings: ballSettings };
}

/** One frame the way GameRoot runs it: split into steps of at most Config.time.maxStep. */
export function frame(world, dt, inputX, inputZ, onStep) {
  const steps = Math.ceil(dt / Config.time.maxStep - 1e-9);
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    world.tractor.update(h, inputX, inputZ);
    world.balls.step(h, world.tractor);
    onStep?.();
  }
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

/** Worst overlaps and escapes of the current state (for checks). `outside` = left the arena or sank under the floor. */
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
    const key = Math.floor((balls.x[i] - b.minX) / cell) + Math.floor((balls.z[i] - b.minZ) / cell) * cols;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  for (let i = 0; i < n; i++) {
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
