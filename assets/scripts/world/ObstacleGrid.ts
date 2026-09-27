/**
 * Static collision world on the XZ plane: circles and oriented boxes bucketed into a uniform grid.
 * Stands in for physics colliders (the build has no physics module): the tractor and the balls
 * resolve their circles against it. Pure TypeScript: no engine imports.
 */

import type { XZBounds } from '../core/Config';

/** Bit mask of what an obstacle stops. */
export const Blocks = {
  Tractor: 1,
  Balls: 2,
  All: 3,
} as const;

export interface CircleShape {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface BoxShape {
  readonly kind: 'box';
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** Rotation about +Y in radians, Cocos convention: local +X maps to (cos a, -sin a) in world XZ. */
  readonly angle: number;
}

export type ObstacleShape = CircleShape | BoxShape;

export interface XZ {
  x: number;
  z: number;
}

/** Internal record: one monomorphic class keeps the per-ball hot loop fast. */
class Obstacle {
  enabled = true;
  readonly mask: number;
  readonly isBox: boolean;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly cos: number;
  readonly sin: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  constructor(shape: ObstacleShape, mask: number) {
    this.mask = mask;
    this.x = shape.x;
    this.z = shape.z;
    if (shape.kind === 'circle') {
      this.isBox = false;
      this.radius = shape.radius;
      this.halfX = this.halfZ = 0;
      this.cos = 1;
      this.sin = 0;
      this.minX = shape.x - shape.radius;
      this.maxX = shape.x + shape.radius;
      this.minZ = shape.z - shape.radius;
      this.maxZ = shape.z + shape.radius;
    } else {
      this.isBox = true;
      this.radius = 0;
      this.halfX = shape.halfX;
      this.halfZ = shape.halfZ;
      this.cos = Math.cos(shape.angle);
      this.sin = Math.sin(shape.angle);
      const extentX = Math.abs(this.cos) * shape.halfX + Math.abs(this.sin) * shape.halfZ;
      const extentZ = Math.abs(this.sin) * shape.halfX + Math.abs(this.cos) * shape.halfZ;
      this.minX = shape.x - extentX;
      this.maxX = shape.x + extentX;
      this.minZ = shape.z - extentZ;
      this.maxZ = shape.z + extentZ;
    }
  }
}

export class ObstacleGrid {
  readonly bounds: XZBounds;
  readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly obstacles: Obstacle[] = [];
  /** Cell -> obstacle ids, compressed: ids of cell c are cellItems[cellStart[c] .. cellStart[c + 1]). */
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  private dirty = true;
  /** Per-obstacle stamp so an obstacle spanning several cells is handled once per query. */
  private visited = new Int32Array(0);
  private stamp = 0;
  /** Cell range of the current query, inclusive (set by setRange). */
  private col0 = 0;
  private col1 = 0;
  private row0 = 0;
  private row1 = 0;
  /** Push vector written by the shape tests (no per-query allocations). */
  private readonly push: XZ = { x: 0, z: 0 };

  constructor(bounds: XZBounds, cellSize: number) {
    this.bounds = bounds;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  }

  get count(): number {
    return this.obstacles.length;
  }

  /** Adds an obstacle and returns its id. */
  add(shape: ObstacleShape, blocks: number = Blocks.All): number {
    this.obstacles.push(new Obstacle(shape, blocks));
    this.dirty = true;
    return this.obstacles.length - 1;
  }

  /** Switches an obstacle on or off (e.g. the gate blocker once the gate opens). */
  setEnabled(id: number, enabled: boolean): void {
    this.obstacles[id].enabled = enabled;
  }

  /**
   * Pushes a circle out of every enabled obstacle that blocks `mask`. One pass; run it again for
   * tight corners. Writes the corrected centre to `out` and returns the total push distance.
   */
  resolveCircle(x: number, z: number, radius: number, mask: number, out: XZ): number {
    let px = x;
    let pz = z;
    let pushed = 0;
    const stamp = this.beginQuery(x - radius, x + radius, z - radius, z + radius);
    for (let row = this.row0; row <= this.row1; row++) {
      for (let col = this.col0; col <= this.col1; col++) {
        const cell = row * this.cols + col;
        for (let k = this.cellStart[cell], end = this.cellStart[cell + 1]; k < end; k++) {
          const id = this.cellItems[k];
          if (this.visited[id] === stamp) continue;
          this.visited[id] = stamp;
          const o = this.obstacles[id];
          if (!o.enabled || (o.mask & mask) === 0) continue;
          const depth = this.penetration(o, px, pz, radius);
          if (depth > 0) {
            px += this.push.x;
            pz += this.push.z;
            pushed += depth;
          }
        }
      }
    }
    out.x = px;
    out.z = pz;
    return pushed;
  }

  /** True when a circle overlaps any enabled obstacle that blocks `mask`. */
  overlapsCircle(x: number, z: number, radius: number, mask: number): boolean {
    const stamp = this.beginQuery(x - radius, x + radius, z - radius, z + radius);
    for (let row = this.row0; row <= this.row1; row++) {
      for (let col = this.col0; col <= this.col1; col++) {
        const cell = row * this.cols + col;
        for (let k = this.cellStart[cell], end = this.cellStart[cell + 1]; k < end; k++) {
          const id = this.cellItems[k];
          if (this.visited[id] === stamp) continue;
          this.visited[id] = stamp;
          const o = this.obstacles[id];
          if (o.enabled && (o.mask & mask) !== 0 && this.penetration(o, x, z, radius) > 0) return true;
        }
      }
    }
    return false;
  }

  private beginQuery(minX: number, maxX: number, minZ: number, maxZ: number): number {
    if (this.dirty) this.rebuild();
    this.setRange(minX, maxX, minZ, maxZ);
    return ++this.stamp;
  }

  /** Cell range covering an XZ rectangle, clamped to the grid (edge cells also hold what lies beyond). */
  private setRange(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const { bounds, cellSize } = this;
    this.col0 = clampIndex(Math.floor((minX - bounds.minX) / cellSize), this.cols);
    this.col1 = clampIndex(Math.floor((maxX - bounds.minX) / cellSize), this.cols);
    this.row0 = clampIndex(Math.floor((minZ - bounds.minZ) / cellSize), this.rows);
    this.row1 = clampIndex(Math.floor((maxZ - bounds.minZ) / cellSize), this.rows);
  }

  private rebuild(): void {
    const cells = this.cols * this.rows;
    const start = new Int32Array(cells + 1);
    const eachCell = (o: Obstacle, visit: (cell: number) => void): void => {
      this.setRange(o.minX, o.maxX, o.minZ, o.maxZ);
      for (let row = this.row0; row <= this.row1; row++) {
        for (let col = this.col0; col <= this.col1; col++) visit(row * this.cols + col);
      }
    };
    for (const o of this.obstacles) eachCell(o, (cell) => start[cell + 1]++);
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const next = start.slice(0, cells);
    const items = new Int32Array(start[cells]);
    this.obstacles.forEach((o, id) => eachCell(o, (cell) => (items[next[cell]++] = id)));
    this.cellStart = start;
    this.cellItems = items;
    this.visited = new Int32Array(this.obstacles.length);
    this.stamp = 0;
    this.dirty = false;
  }

  /** Penetration depth of a circle into an obstacle (0 = apart); the way out goes to this.push. */
  private penetration(o: Obstacle, x: number, z: number, radius: number): number {
    return o.isBox ? pushOutOfBox(o, x, z, radius, this.push) : pushOutOfCircle(o, x, z, radius, this.push);
  }
}

function clampIndex(i: number, size: number): number {
  return i < 0 ? 0 : i >= size ? size - 1 : i;
}

function pushOutOfCircle(o: Obstacle, x: number, z: number, radius: number, out: XZ): number {
  const dx = x - o.x;
  const dz = z - o.z;
  const reach = o.radius + radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach) return 0;
  const d = Math.sqrt(d2);
  const depth = reach - d;
  if (d > 1e-9) {
    out.x = (dx / d) * depth;
    out.z = (dz / d) * depth;
  } else {
    out.x = depth;
    out.z = 0;
  }
  return depth;
}

function pushOutOfBox(o: Obstacle, x: number, z: number, radius: number, out: XZ): number {
  const dx = x - o.x;
  const dz = z - o.z;
  // World -> box local (inverse rotation about Y).
  const lx = dx * o.cos - dz * o.sin;
  const lz = dx * o.sin + dz * o.cos;
  const qx = lx < -o.halfX ? -o.halfX : lx > o.halfX ? o.halfX : lx;
  const qz = lz < -o.halfZ ? -o.halfZ : lz > o.halfZ ? o.halfZ : lz;
  let nx = lx - qx;
  let nz = lz - qz;
  const d2 = nx * nx + nz * nz;
  let depth: number;
  if (d2 > 0) {
    if (d2 >= radius * radius) return 0;
    const d = Math.sqrt(d2);
    nx /= d;
    nz /= d;
    depth = radius - d;
  } else {
    // Centre inside the box: leave through the nearest face.
    const gapX = o.halfX - Math.abs(lx);
    const gapZ = o.halfZ - Math.abs(lz);
    if (gapX < gapZ) {
      nx = lx < 0 ? -1 : 1;
      nz = 0;
      depth = gapX + radius;
    } else {
      nx = 0;
      nz = lz < 0 ? -1 : 1;
      depth = gapZ + radius;
    }
  }
  // Box local -> world.
  out.x = (nx * o.cos + nz * o.sin) * depth;
  out.z = (-nx * o.sin + nz * o.cos) * depth;
  return depth;
}
