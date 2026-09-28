/**
 * The tractor's bucket: scoops balls from the carpet into its load while there is room, carries the
 * load along and hands it over (to the shredder, M6). Glue between three models: the carrier (the
 * tractor's pose and tier), the ball field (free balls) and the load (the pile in the bucket's axes).
 * Pure TypeScript: no engine imports.
 *
 * Scooping: the intake is the bucket's cavity stretched forward by one ball radius (the lip). Every
 * step, after the tractor moved and before the balls do, each free ball whose centre is in the intake
 * is taken out of the field into the load, keeping most of its speed relative to the tractor, until
 * the load is full. The bucket's pusher box stays solid, so while there is room a ball in front of
 * the bucket is always taken before the box could shove it, and a full bucket pushes like a blade.
 * Carrying: after the balls' step the load settles in its own axes and every carried ball is placed
 * in the world with the tractor's pose (the field keeps where every ball is, carried or not).
 */

import type { BucketShape } from '../core/Config';
import type { EventBus, GameEvents } from '../core/Events';
import type { BallField } from '../balls/BallField';
import { BucketLoad } from './BucketLoad';
import type { BucketLoadSettings } from './BucketLoad';

/** What carries the bucket (the tractor): a pose on the ground, a speed and the current tier's bucket. */
export interface BucketCarrier {
  readonly x: number;
  readonly z: number;
  /** Heading about +Y, Cocos convention: local +Z points to (sin yaw, cos yaw). */
  readonly yaw: number;
  /** Forward speed, units/s. */
  readonly speed: number;
  readonly bucketShape: BucketShape;
  readonly bucketCapacity: number;
}

export interface BucketSettings extends BucketLoadSettings {
  /** Share of its speed relative to the tractor a scooped ball keeps. */
  readonly keep: number;
}

/** Most free balls looked at in the intake's cells per step. */
const MAX_CANDIDATES = 256;

export class Bucket {
  readonly load: BucketLoad;

  private readonly settings: BucketSettings;
  private readonly field: BallField;
  private readonly carrier: BucketCarrier;
  private readonly events: EventBus<GameEvents> | null;
  private readonly radius: number;
  private readonly candidates = new Int32Array(MAX_CANDIDATES);
  private shape: BucketShape;
  // Pose the carried balls were last placed with.
  private poseX = NaN;
  private poseZ = NaN;
  private poseYaw = NaN;
  /** The load changed (balls taken, handed over, reshaped): place the balls even if nothing moved. */
  private dirty = false;
  private carriedMoved = false;

  /** `slots`: the most balls any tier's bucket holds. */
  constructor(settings: BucketSettings, field: BallField, carrier: BucketCarrier, slots: number, events: EventBus<GameEvents> | null = null) {
    this.settings = settings;
    this.field = field;
    this.carrier = carrier;
    this.events = events;
    this.radius = settings.radius;
    this.shape = carrier.bucketShape;
    this.load = new BucketLoad(settings, slots, this.shape, carrier.bucketCapacity);
  }

  get count(): number {
    return this.load.count;
  }

  get capacity(): number {
    return this.load.capacity;
  }

  get full(): boolean {
    return this.load.full;
  }

  // --- what the ball renderer reads (BallQuads' CarriedSource) ---

  /** Field indices of the carried balls, in [0 .. count). */
  get index(): Int32Array {
    return this.load.index;
  }

  /** Carried ball centres in the bucket's axes. */
  get localX(): Float64Array {
    return this.load.x;
  }

  get localZ(): Float64Array {
    return this.load.z;
  }

  /** Heading the carried balls were last placed with. */
  get yaw(): number {
    return this.poseYaw;
  }

  /** True when a carried ball moved (in the bucket or with the tractor) since the last clearMoved(). */
  get moved(): boolean {
    return this.carriedMoved;
  }

  /** Forgets the moved flag once the view has redrawn the load. */
  clearMoved(): void {
    this.carriedMoved = false;
  }

  /**
   * Takes the free balls in the intake into the load while there is room (call after the tractor
   * moved, before the ball field steps); returns how many were taken.
   */
  scoop(): number {
    this.followTier();
    const load = this.load;
    if (load.full) return 0;
    const c = this.carrier;
    const s = this.shape;
    const r = this.radius;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const ceiling = s.rim + this.settings.heapLayers * 2 * r;
    // The intake in the bucket's axes, and its bounding rectangle in the world.
    const hx = s.halfX;
    const z0 = s.minZ;
    const z1 = s.maxZ + r;
    const midZ = 0.5 * (z0 + z1);
    const halfZ = 0.5 * (z1 - z0);
    const cx = c.x + midZ * sin;
    const cz = c.z + midZ * cos;
    const ex = Math.abs(cos) * hx + Math.abs(sin) * halfZ;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * halfZ;
    const found = this.field.findFree(cx - ex, cx + ex, cz - ez, cz + ez, this.candidates);
    if (found === 0) return 0;

    const { x, y, z, vx, vy, vz } = this.field;
    // The tractor's velocity: a scooped ball keeps most of its speed relative to it, at most the tractor's.
    const tvx = c.speed * sin;
    const tvz = c.speed * cos;
    const keep = this.settings.keep;
    let taken = 0;
    for (let k = 0; k < found && !load.full; k++) {
      const i = this.candidates[k];
      if (y[i] > ceiling) continue;
      const dx = x[i] - c.x;
      const dz = z[i] - c.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (lx < -hx || lx > hx || lz < z0 || lz > z1) continue;
      let rx = vx[i] - tvx;
      let ry = vy[i];
      let rz = vz[i] - tvz;
      const rel = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const most = c.speed * keep;
      const k2 = rel > 1e-9 ? Math.min(keep, most / rel) : 0;
      rx *= k2;
      ry *= k2;
      rz *= k2;
      load.take(i, lx, y[i], lz, rx * cos - rz * sin, ry, rx * sin + rz * cos);
      this.field.hold(i);
      this.dirty = true;
      taken++;
      this.events?.emit('ballScooped', { carried: load.count, capacity: load.capacity });
    }
    return taken;
  }

  /** Settles the load and places every carried ball in the world (call after the ball field stepped). */
  carry(dt: number): void {
    const settled = this.load.step(dt);
    const c = this.carrier;
    const posed = c.x !== this.poseX || c.z !== this.poseZ || c.yaw !== this.poseYaw;
    if (!settled && !posed && !this.dirty) return;
    this.poseX = c.x;
    this.poseZ = c.z;
    this.poseYaw = c.yaw;
    this.dirty = false;
    const { index, x, y, z } = this.load;
    const n = this.load.count;
    if (n === 0) return;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    for (let k = 0; k < n; k++) {
      this.field.place(index[k], c.x + x[k] * cos + z[k] * sin, y[k], c.z - x[k] * sin + z[k] * cos);
    }
    this.carriedMoved = true;
  }

  /**
   * Hands the whole load over (the shredder takes it): writes the field indices to `out` and returns
   * how many. The balls stay held out of the field where they are; the receiver moves them from now on.
   */
  unloadAll(out: Int32Array): number {
    const n = this.load.handOver(out);
    if (n > 0) this.dirty = true;
    return n;
  }

  /** Follows the carrier's tier: a new bucket shape and capacity (balls over the new capacity drop out). */
  private followTier(): void {
    const c = this.carrier;
    if (c.bucketShape === this.shape && c.bucketCapacity === this.load.capacity) return;
    this.shape = c.bucketShape;
    const load = this.load;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    while (load.count > c.bucketCapacity) {
      const k = load.count - 1;
      const lx = load.x[k];
      const lz = load.z[k];
      const i = load.pop();
      this.field.release(i, c.x + lx * cos + lz * sin, load.y[k], c.z - lx * sin + lz * cos, 0, 0, 0);
    }
    load.setShape(c.bucketShape, c.bucketCapacity);
    this.dirty = true;
  }
}
