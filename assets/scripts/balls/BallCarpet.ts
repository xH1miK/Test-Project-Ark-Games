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
  const loX = spec.centerX - spec.halfX + radius;
  const hiX = spec.centerX + spec.halfX - radius;
  const loZ = spec.centerZ - spec.halfZ + radius;
  const hiZ = spec.centerZ + spec.halfZ - radius;
  // Hex lattice step for the coverage: one ball of area pi·r² per (sqrt(3)/2)·step² of floor.
  const step = radius * Math.sqrt((2 * Math.PI) / (Math.sqrt(3) * spec.coverage));
  const rowStep = (step * Math.sqrt(3)) / 2;
  const amplitude = spec.jitter * step;

  const rows = Math.floor((hiZ - loZ) / rowStep) + 1;
  const perRow = Math.floor((hiX - loX) / step) + 1;
  const xs = new Float64Array(rows * perRow);
  const zs = new Float64Array(rows * perRow);
  let n = 0;
  for (let row = 0; row < rows; row++) {
    const z = loZ + row * rowStep;
    for (let x = loX + (row & 1 ? step / 2 : 0); x <= hiX; x += step) {
      const px = clamp(x + (random() - 0.5) * amplitude, loX, hiX);
      const pz = clamp(z + (random() - 0.5) * amplitude, loZ, hiZ);
      if (!isFree(spec, px, pz, radius, obstacles)) continue;
      xs[n] = px;
      zs[n] = pz;
      n++;
    }
  }

  // Only points that start near a rock are checked against the rocks while relaxing (a lattice step
  // of drift is plenty); a point that still wanders into one is dropped by the final check.
  const nearRock = new Uint8Array(n);
  for (let i = 0; i < n; i++) nearRock[i] = obstacles.overlapsCircle(xs[i], zs[i], radius + step, Blocks.Balls) ? 1 : 0;

  const grid = new PointGrid(spec, 2 * radius, n);
  const out: XZ = { x: 0, z: 0 };
  for (let pass = 0; pass < spec.relaxPasses; pass++) {
    grid.build(xs, zs, n);
    pushApart(xs, zs, radius, grid);
    for (let i = 0; i < n; i++) {
      // Back inside the rectangle, out of the holes and the rocks.
      let x = clamp(xs[i], loX, hiX);
      let z = clamp(zs[i], loZ, hiZ);
      for (const hole of spec.holes) {
        pushOutOfHole(hole, x, z, radius, out);
        x = out.x;
        z = out.z;
      }
      if (nearRock[i] && obstacles.resolveCircle(x, z, radius, Blocks.Balls, out) > 0) {
        x = out.x;
        z = out.z;
      }
      xs[i] = x;
      zs[i] = z;
    }
  }

  // Keep what ended up valid, first come first served, then thin out evenly to maxCount.
  grid.build(xs, zs, n);
  const kept = keepValid(xs, zs, n, radius, spec, obstacles, grid, loX, hiX, loZ, hiZ);
  const chosen = kept.length > maxCount ? pick(kept, maxCount, random) : kept;
  const centres = new Float64Array(chosen.length * 2);
  for (let k = 0; k < chosen.length; k++) {
    centres[2 * k] = xs[chosen[k]];
    centres[2 * k + 1] = zs[chosen[k]];
  }
  return centres;
}

/** Uniform grid over the carpet rectangle, refilled before each pass (counting sort into cell ranges). */
class PointGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly invCell: number;
  /** Points of cell c are items[start[c] .. start[c + 1]). */
  readonly start: Int32Array;
  readonly items: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly fill: Int32Array;

  constructor(spec: CarpetSpec, cell: number, capacity: number) {
    this.minX = spec.centerX - spec.halfX;
    this.minZ = spec.centerZ - spec.halfZ;
    this.invCell = 1 / cell;
    this.cols = Math.ceil((2 * spec.halfX) / cell) + 1;
    this.rows = Math.ceil((2 * spec.halfZ) / cell) + 1;
    this.start = new Int32Array(this.cols * this.rows + 1);
    this.fill = new Int32Array(this.cols * this.rows);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  cellAt(x: number, z: number): number {
    let col = Math.floor((x - this.minX) * this.invCell);
    let row = Math.floor((z - this.minZ) * this.invCell);
    col = col < 0 ? 0 : col >= this.cols ? this.cols - 1 : col;
    row = row < 0 ? 0 : row >= this.rows ? this.rows - 1 : row;
    return row * this.cols + col;
  }

  build(xs: Float64Array, zs: Float64Array, n: number): void {
    const { start, fill, items, cellOf } = this;
    const cells = this.cols * this.rows;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellAt(xs[i], zs[i]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    fill.set(start.subarray(0, cells));
    for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
  }
}

/** One relaxation pass: every overlapping pair moves apart, half the overlap each. */
function pushApart(xs: Float64Array, zs: Float64Array, radius: number, grid: PointGrid): void {
  const diameter = 2 * radius;
  const { start, items, cols, rows } = grid;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      for (let s = start[cell]; s < start[cell + 1]; s++) {
        const i = items[s];
        // Neighbours in this cell (later ones) and in the 4 cells ahead; each pair is seen once.
        for (let k = 0; k < 5; k++) {
          const c = col + (k === 0 ? 0 : k === 1 ? 1 : k - 3);
          const r = row + (k < 2 ? 0 : 1);
          if (c < 0 || c >= cols || r >= rows) continue;
          const other = r * cols + c;
          for (let t = other === cell ? s + 1 : start[other]; t < start[other + 1]; t++) {
            const j = items[t];
            const dx = xs[j] - xs[i];
            const dz = zs[j] - zs[i];
            const d2 = dx * dx + dz * dz;
            if (d2 >= diameter * diameter) continue;
            const d = Math.sqrt(d2);
            const half = (diameter - d) / 2;
            const nx = d > 1e-9 ? dx / d : 1;
            const nz = d > 1e-9 ? dz / d : 0;
            xs[i] -= nx * half;
            zs[i] -= nz * half;
            xs[j] += nx * half;
            zs[j] += nz * half;
          }
        }
      }
    }
  }
}

/** Indices of the points that are clear of the rules and of every earlier kept point. */
function keepValid(xs: Float64Array, zs: Float64Array, n: number, radius: number, spec: CarpetSpec, obstacles: CarpetObstacles,
  grid: PointGrid, loX: number, hiX: number, loZ: number, hiZ: number): number[] {
  const minGap2 = (MIN_GAP_SHARE * 2 * radius) ** 2;
  const { start, items, cols, rows } = grid;
  const kept: number[] = [];
  const taken = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const z = zs[i];
    if (x < loX - 1e-9 || x > hiX + 1e-9 || z < loZ - 1e-9 || z > hiZ + 1e-9 || !isFree(spec, x, z, radius, obstacles)) continue;
    const cell = grid.cellAt(x, z);
    const col = cell % cols;
    const row = (cell - col) / cols;
    let clear = true;
    for (let r = Math.max(0, row - 1); clear && r <= Math.min(rows - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); clear && c <= Math.min(cols - 1, col + 1); c++) {
        const other = r * cols + c;
        for (let t = start[other]; t < start[other + 1]; t++) {
          const j = items[t];
          if (taken[j] && (xs[j] - x) ** 2 + (zs[j] - z) ** 2 < minGap2) {
            clear = false;
            break;
          }
        }
      }
    }
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
  if (hole.kind === 'circle') return hole.radius + radius - length(x - hole.x, z - hole.z);
  return Math.min(hole.halfX + radius - Math.abs(x - hole.x), hole.halfZ + radius - Math.abs(z - hole.z));
}

function pushOutOfHole(hole: CarpetHole, x: number, z: number, radius: number, out: XZ): void {
  out.x = x;
  out.z = z;
  const depth = holeDepth(hole, x, z, radius);
  if (depth <= 0) return;
  if (hole.kind === 'circle') {
    const d = length(x - hole.x, z - hole.z);
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

/** sqrt(x² + z²) (Math.hypot is several times slower in V8). */
function length(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
