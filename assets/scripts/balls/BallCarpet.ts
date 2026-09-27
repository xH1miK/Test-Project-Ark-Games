/**
 * Lays the ball carpet once at start: a hexagonal lattice over a rectangle with holes, each point
 * jittered, then relaxed so that neighbours stop overlapping: an even but organic-looking carpet.
 * Seeded, so tests, the benchmark and the game get the same field. Pure TypeScript: no engine imports.
 */

import { Blocks } from '../world/ObstacleGrid';
import type { CircleBlocker, XZ } from '../world/ObstacleGrid';

export type CarpetHole =
  | { readonly kind: 'circle'; readonly x: number; readonly z: number; readonly radius: number }
  | { readonly kind: 'box'; readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number };

export interface CarpetSpec {
  /** The carpet rectangle in world XZ: centre and half sizes. */
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** Areas left bare (spots where something stands or starts). */
  readonly holes: readonly CarpetHole[];
  /** Share of the floor the balls cover before the jitter. */
  readonly coverage: number;
  /** Random offset of each lattice point, share of the lattice step. */
  readonly jitter: number;
  /** Passes that push jittered neighbours apart. */
  readonly relaxPasses: number;
  readonly seed: number;
}

/** The static level the carpet keeps clear of (ObstacleGrid implements it). */
export interface CarpetObstacles extends CircleBlocker {
  overlapsCircle(x: number, z: number, radius: number, mask: number): boolean;
}

/** Two balls of the finished carpet are at least this share of a diameter apart. */
const MIN_GAP_SHARE = 0.98;

/** Ball centres as [x0, z0, x1, z1, ...]: at most `maxCount` balls, clear of holes and obstacles, not overlapping. */
export function layCarpet(spec: CarpetSpec, radius: number, maxCount: number, obstacles: CarpetObstacles): Float64Array {
  const random = mulberry32(spec.seed);
  const area = { loX: spec.centerX - spec.halfX + radius, hiX: spec.centerX + spec.halfX - radius,
                 loZ: spec.centerZ - spec.halfZ + radius, hiZ: spec.centerZ + spec.halfZ - radius };
  // Hex lattice step for the coverage: one ball of area pi·r² per (sqrt(3)/2)·step² of floor.
  const step = radius * Math.sqrt((2 * Math.PI) / (Math.sqrt(3) * spec.coverage));
  const rowStep = (step * Math.sqrt(3)) / 2;
  const amplitude = spec.jitter * step;

  const xs: number[] = [];
  const zs: number[] = [];
  for (let row = 0; area.loZ + row * rowStep <= area.hiZ; row++) {
    const z = area.loZ + row * rowStep;
    for (let x = area.loX + (row & 1 ? step / 2 : 0); x <= area.hiX; x += step) {
      const px = clamp(x + (random() - 0.5) * amplitude, area.loX, area.hiX);
      const pz = clamp(z + (random() - 0.5) * amplitude, area.loZ, area.hiZ);
      if (!isFree(spec, px, pz, radius, obstacles)) continue;
      xs.push(px);
      zs.push(pz);
    }
  }

  const grid = new PointGrid(spec, 2 * radius);
  for (let pass = 0; pass < spec.relaxPasses; pass++) relax(xs, zs, radius, spec, area, obstacles, grid);

  // Keep what ended up valid, first come first served, then thin out evenly to maxCount.
  const kept = keepValid(xs, zs, radius, spec, obstacles, grid);
  const chosen = kept.length > maxCount ? pick(kept, maxCount, random) : kept;
  const out = new Float64Array(chosen.length * 2);
  chosen.forEach((i, k) => {
    out[2 * k] = xs[i];
    out[2 * k + 1] = zs[i];
  });
  return out;
}

/** Uniform grid over the carpet rectangle, rebuilt for each pass (counting sort). */
class PointGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly invCell: number;
  start = new Int32Array(0);
  items = new Int32Array(0);

  constructor(spec: CarpetSpec, cell: number) {
    this.minX = spec.centerX - spec.halfX;
    this.minZ = spec.centerZ - spec.halfZ;
    this.invCell = 1 / cell;
    this.cols = Math.ceil((2 * spec.halfX) / cell) + 1;
    this.rows = Math.ceil((2 * spec.halfZ) / cell) + 1;
  }

  cellAt(x: number, z: number): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) * this.invCell)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) * this.invCell)));
    return row * this.cols + col;
  }

  build(xs: readonly number[], zs: readonly number[], ids: readonly number[]): void {
    const cells = this.cols * this.rows;
    const start = new Int32Array(cells + 1);
    for (const i of ids) start[this.cellAt(xs[i], zs[i]) + 1]++;
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    const items = new Int32Array(ids.length);
    for (const i of ids) items[fill[this.cellAt(xs[i], zs[i])]++] = i;
    this.start = start;
    this.items = items;
  }

  /** Calls `visit` for every point filed in the 3x3 cells around (x, z). */
  forNear(x: number, z: number, visit: (j: number) => void): void {
    const cell = this.cellAt(x, z);
    const col = cell % this.cols;
    const row = (cell - col) / this.cols;
    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(this.cols - 1, col + 1); c++) {
        const k = r * this.cols + c;
        for (let s = this.start[k]; s < this.start[k + 1]; s++) visit(this.items[s]);
      }
    }
  }
}

interface Area {
  readonly loX: number;
  readonly hiX: number;
  readonly loZ: number;
  readonly hiZ: number;
}

/** One relaxation pass: overlapping neighbours move apart, then every point goes back inside the rules. */
function relax(xs: number[], zs: number[], radius: number, spec: CarpetSpec, area: Area, obstacles: CarpetObstacles, grid: PointGrid): void {
  const diameter = 2 * radius;
  grid.build(xs, zs, xs.map((_, i) => i));
  for (let i = 0; i < xs.length; i++) {
    grid.forNear(xs[i], zs[i], (j) => {
      if (j <= i) return;
      const dx = xs[j] - xs[i];
      const dz = zs[j] - zs[i];
      const d2 = dx * dx + dz * dz;
      if (d2 >= diameter * diameter) return;
      const d = Math.sqrt(d2);
      const half = (diameter - d) / 2;
      const nx = d > 1e-9 ? dx / d : 1;
      const nz = d > 1e-9 ? dz / d : 0;
      xs[i] -= nx * half;
      zs[i] -= nz * half;
      xs[j] += nx * half;
      zs[j] += nz * half;
    });
  }
  const out: XZ = { x: 0, z: 0 };
  for (let i = 0; i < xs.length; i++) {
    let x = clamp(xs[i], area.loX, area.hiX);
    let z = clamp(zs[i], area.loZ, area.hiZ);
    for (const hole of spec.holes) {
      pushOutOfHole(hole, x, z, radius, out);
      x = out.x;
      z = out.z;
    }
    if (obstacles.resolveCircle(x, z, radius, Blocks.Balls, out) > 0) {
      x = out.x;
      z = out.z;
    }
    xs[i] = x;
    zs[i] = z;
  }
}

/** Indices of the points that are clear of the rules and of every earlier kept point. */
function keepValid(xs: number[], zs: number[], radius: number, spec: CarpetSpec, obstacles: CarpetObstacles, grid: PointGrid): number[] {
  const minGap = MIN_GAP_SHARE * 2 * radius;
  const kept: number[] = [];
  const taken = new Uint8Array(xs.length);
  grid.build(xs, zs, xs.map((_, i) => i));
  for (let i = 0; i < xs.length; i++) {
    const inside = Math.abs(xs[i] - spec.centerX) <= spec.halfX - radius + 1e-9 && Math.abs(zs[i] - spec.centerZ) <= spec.halfZ - radius + 1e-9;
    if (!inside || !isFree(spec, xs[i], zs[i], radius, obstacles)) continue;
    let clear = true;
    grid.forNear(xs[i], zs[i], (j) => {
      if (clear && taken[j] && Math.hypot(xs[j] - xs[i], zs[j] - zs[i]) < minGap) clear = false;
    });
    if (!clear) continue;
    taken[i] = 1;
    kept.push(i);
  }
  return kept;
}

function isFree(spec: CarpetSpec, x: number, z: number, radius: number, obstacles: CarpetObstacles): boolean {
  for (const hole of spec.holes) if (holeDepth(hole, x, z, radius) > 0) return false;
  return !obstacles.overlapsCircle(x, z, radius, Blocks.Balls);
}

/** How deep a ball at (x, z) reaches into a hole (<= 0: clear of it). */
function holeDepth(hole: CarpetHole, x: number, z: number, radius: number): number {
  if (hole.kind === 'circle') return hole.radius + radius - Math.hypot(x - hole.x, z - hole.z);
  return Math.min(hole.halfX + radius - Math.abs(x - hole.x), hole.halfZ + radius - Math.abs(z - hole.z));
}

function pushOutOfHole(hole: CarpetHole, x: number, z: number, radius: number, out: XZ): void {
  out.x = x;
  out.z = z;
  const depth = holeDepth(hole, x, z, radius);
  if (depth <= 0) return;
  if (hole.kind === 'circle') {
    const d = Math.hypot(x - hole.x, z - hole.z);
    const nx = d > 1e-9 ? (x - hole.x) / d : 1;
    const nz = d > 1e-9 ? (z - hole.z) / d : 0;
    out.x = x + nx * depth;
    out.z = z + nz * depth;
  } else if (hole.halfX + radius - Math.abs(x - hole.x) < hole.halfZ + radius - Math.abs(z - hole.z)) {
    out.x = x + (x < hole.x ? -depth : depth);
  } else {
    out.z = z + (z < hole.z ? -depth : depth);
  }
}

/** `count` of the `ids`, chosen at random but kept in their original order. */
function pick(ids: number[], count: number, random: () => number): number[] {
  const pool = ids.slice();
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(random() * (pool.length - k));
    const t = pool[k];
    pool[k] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Small seeded PRNG (mulberry32): uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
