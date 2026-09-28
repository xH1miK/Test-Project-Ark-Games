/**
 * The balls a bucket carries: a small pile simulated in the bucket's own axes (x to the side, y up,
 * z forward), so it rides along with the tractor and turns with it (Unity analogy: particles in local
 * simulation space). Pure TypeScript: no engine imports.
 *
 * Position-based like the carpet, but tiny (8..60 balls, every pair tested): gravity and damping,
 * then a few passes that push overlapping balls apart and keep every ball inside the cavity, then the
 * velocity from the displacement. Above the heap's top the cavity narrows, so an overfull load forms
 * a mound instead of a tower. A ball taken at the lip may start outside the walls: its slack shrinks
 * steadily, so it is drawn inside over a few frames instead of snapping. The pile sleeps once it has
 * been left alone for a while.
 */

import type { BucketShape } from '../core/Config';

export interface BucketLoadSettings {
  readonly radius: number;
  /** Units/s². */
  readonly gravity: number;
  /** Share of horizontal speed lost per second. */
  readonly damping: number;
  /** Contact passes per step. */
  readonly passes: number;
  /** The pile sleeps once nothing disturbed it for this long, s. */
  readonly settleTime: number;
  /** How fast a ball taken outside the walls is drawn inside them, units/s. */
  readonly drawIn: number;
  /** Fastest a carried ball moves, units/s. */
  readonly maxSpeed: number;
  /** Ball layers the pile may heap above the rim before it narrows. */
  readonly heapLayers: number;
  /** How much the cavity narrows per unit of height above the heap's top (each side). */
  readonly heapSlope: number;
  /** Share of the diameter two carried balls may overlap without being pushed apart (a squeezed, compact load). */
  readonly contactSlop: number;
}

export class BucketLoad {
  /** Field index of each carried ball, in [0 .. count). */
  readonly index: Int32Array;
  /** Ball centres in the bucket's axes. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** How far outside its walls a ball may still be (one taken at the lip); shrinks by drawIn. */
  readonly slack: Float64Array;

  private readonly settings: BucketLoadSettings;
  private readonly radius: number;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly vz: Float64Array;
  /** Position at the start of the step. */
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sz: Float64Array;
  private ballCount = 0;
  private room = 0;
  private cavity: BucketShape;
  /** Height where the heap stops being straight and starts to narrow. */
  private heapTop = 0;
  /** Time left before the pile sleeps, s. */
  private settle = 0;

  /** `slots`: most balls any shape will hold (arrays are sized once). */
  constructor(settings: BucketLoadSettings, slots: number, shape: BucketShape, capacity: number) {
    this.settings = settings;
    this.radius = settings.radius;
    this.index = new Int32Array(slots);
    this.x = new Float64Array(slots);
    this.y = new Float64Array(slots);
    this.z = new Float64Array(slots);
    this.vx = new Float64Array(slots);
    this.vy = new Float64Array(slots);
    this.vz = new Float64Array(slots);
    this.sx = new Float64Array(slots);
    this.sy = new Float64Array(slots);
    this.sz = new Float64Array(slots);
    this.slack = new Float64Array(slots);
    this.cavity = shape;
    this.setShape(shape, capacity);
  }

  get count(): number {
    return this.ballCount;
  }

  get capacity(): number {
    return this.room;
  }

  get full(): boolean {
    return this.ballCount >= this.room;
  }

  get shape(): BucketShape {
    return this.cavity;
  }

  /** True while the pile is still moving (it sleeps settleTime after the last disturbance). */
  get settling(): boolean {
    return this.ballCount > 0 && this.settle > 0;
  }

  /**
   * Switches to another bucket (tractor upgrade). The pile keeps its balls, stretched from the old
   * cavity into the new one, and settles again; a smaller capacity is the caller's to enforce (pop()).
   */
  setShape(shape: BucketShape, capacity: number): void {
    const from = this.cavity;
    if (capacity > this.index.length) throw new Error(`BucketLoad: capacity ${capacity} over ${this.index.length} slots`);
    this.room = capacity;
    this.cavity = shape;
    this.heapTop = shape.rim + this.settings.heapLayers * 2 * this.radius;
    if (from === shape) return;
    const kx = shape.halfX / from.halfX;
    const ky = (shape.rim - shape.floor) / (from.rim - from.floor);
    const kz = (shape.maxZ - shape.minZ) / (from.maxZ - from.minZ);
    for (let k = 0; k < this.ballCount; k++) {
      this.x[k] *= kx;
      this.y[k] = shape.floor + (this.y[k] - from.floor) * ky;
      this.z[k] = shape.minZ + (this.z[k] - from.minZ) * kz;
      this.vx[k] = this.vy[k] = this.vz[k] = 0;
      this.slack[k] = this.breach(k);
    }
    this.disturb();
  }

  /**
   * Adds a ball at (x, y, z) in the bucket's axes, moving at (vx, vy, vz); false when full. A ball
   * outside the walls is drawn in rather than snapped in.
   */
  take(ball: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): boolean {
    if (this.ballCount >= this.room) return false;
    const k = this.ballCount++;
    this.index[k] = ball;
    this.x[k] = x;
    this.y[k] = y;
    this.z[k] = z;
    this.vx[k] = vx;
    this.vy[k] = vy;
    this.vz[k] = vz;
    this.slack[k] = this.breach(k);
    this.disturb();
    return true;
  }

  /** Removes the last ball taken and returns its field index (-1 when empty). */
  pop(): number {
    if (this.ballCount === 0) return -1;
    this.disturb();
    return this.index[--this.ballCount];
  }

  /** Empties the load: writes the field indices of all its balls to `out`, returns how many. */
  handOver(out: Int32Array): number {
    const n = this.ballCount;
    if (out.length < n) throw new Error(`BucketLoad: handOver needs room for ${n} balls`);
    out.set(this.index.subarray(0, n));
    this.ballCount = 0;
    this.settle = 0;
    return n;
  }

  /** Advances the pile by `dt` seconds; returns true when it moved (false while asleep or empty). */
  step(dt: number): boolean {
    if (dt <= 0 || this.ballCount === 0 || this.settle <= 0) return false;
    this.settle -= dt;
    const n = this.ballCount;
    const { x, y, z, vx, vy, vz, sx, sy, sz, slack } = this;
    const s = this.settings;
    const fall = s.gravity * dt;
    const keep = Math.max(0, 1 - s.damping * dt);
    const shrink = s.drawIn * dt;
    for (let k = 0; k < n; k++) {
      slack[k] = slack[k] > shrink ? slack[k] - shrink : 0;
      vx[k] *= keep;
      vz[k] *= keep;
      vy[k] -= fall;
      sx[k] = x[k];
      sy[k] = y[k];
      sz[k] = z[k];
      x[k] += vx[k] * dt;
      y[k] += vy[k] * dt;
      z[k] += vz[k] * dt;
    }
    for (let pass = 0; pass < s.passes; pass++) {
      this.separate();
      for (let k = 0; k < n; k++) this.contain(k);
    }
    // No ball jumps farther than maxSpeed allows (a squeezed pile must not fling one); the walls get
    // the last word.
    const most = s.maxSpeed * dt;
    const inv = 1 / dt;
    let moved = false;
    for (let k = 0; k < n; k++) {
      let dx = x[k] - sx[k];
      let dy = y[k] - sy[k];
      let dz = z[k] - sz[k];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > most * most) {
        const f = most / Math.sqrt(d2);
        dx *= f;
        dy *= f;
        dz *= f;
        x[k] = sx[k] + dx;
        y[k] = sy[k] + dy;
        z[k] = sz[k] + dz;
        this.contain(k);
      }
      vx[k] = (x[k] - sx[k]) * inv;
      vy[k] = (y[k] - sy[k]) * inv;
      vz[k] = (z[k] - sz[k]) * inv;
      if (d2 > 0) moved = true;
    }
    if (this.settle <= 0) {
      // Asleep: it starts from rest when something disturbs it again.
      vx.fill(0, 0, n);
      vy.fill(0, 0, n);
      vz.fill(0, 0, n);
    }
    return moved;
  }

  /** Wakes the pile for another settleTime. */
  private disturb(): void {
    this.settle = this.settings.settleTime;
  }

  /** Pushes every overlapping pair apart, half each (the speeds follow from the displacement). */
  private separate(): void {
    const { x, y, z } = this;
    const n = this.ballCount;
    const contact = 2 * this.radius * (1 - this.settings.contactSlop);
    const contact2 = contact * contact;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const dz = z[b] - z[a];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= contact2) continue;
        let nx = 0;
        let ny = 1;
        let nz = 0;
        let d = 0;
        if (d2 > 1e-12) {
          d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          nz = dz / d;
        }
        const half = 0.5 * (contact - d);
        x[a] -= nx * half;
        y[a] -= ny * half;
        z[a] -= nz * half;
        x[b] += nx * half;
        y[b] += ny * half;
        z[b] += nz * half;
      }
    }
  }

  /**
   * Keeps ball k inside the cavity, give or take its slack: on the floor, between the side walls,
   * between the back wall and the lip. Above the heap's top the walls close in (a mound).
   */
  private contain(k: number): void {
    const { x, y, z } = this;
    const s = this.cavity;
    const r = this.radius;
    const slack = this.slack[k];
    const floor = s.floor + r - slack;
    if (y[k] < floor) y[k] = floor;
    const over = y[k] - this.heapTop - slack;
    const narrow = over > 0 ? this.settings.heapSlope * over : 0;
    const hx = s.halfX - r + slack - narrow;
    x[k] = hx <= 0 ? 0 : x[k] < -hx ? -hx : x[k] > hx ? hx : x[k];
    const z0 = s.minZ + r - slack + narrow;
    const z1 = s.maxZ - r + slack - narrow;
    z[k] = z1 <= z0 ? 0.5 * (z0 + z1) : z[k] < z0 ? z0 : z[k] > z1 ? z1 : z[k];
  }

  /** How far ball k is outside its walls (0 when inside): below the floor, past a side, the back or the lip. */
  private breach(k: number): number {
    const s = this.cavity;
    const r = this.radius;
    let out = s.floor + r - this.y[k];
    out = Math.max(out, Math.abs(this.x[k]) - (s.halfX - r));
    out = Math.max(out, s.minZ + r - this.z[k]);
    out = Math.max(out, this.z[k] - (s.maxZ - r));
    return out > 0 ? out : 0;
  }
}
