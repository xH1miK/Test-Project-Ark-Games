/**
 * The CPU side of the ball renderer: vertex data of one camera-facing quad per ball, and the
 * orientation that makes a ball's pattern roll with it. Pure TypeScript (no engine imports), so it
 * runs in Node tests; the Cocos view (BallRenderer) only uploads these arrays to the GPU.
 *
 * Two vertex streams, 4 vertices per ball:
 * - dynamic (rewritten for moved balls): centre xyz + radius as float32, orientation quaternion as
 *   normalised int16, 24 bytes a vertex;
 * - static (written once): quad corner (0/1, 0/1) and a shade as normalised bytes.
 * Indices (two triangles per ball) never change.
 * Two write paths into the dynamic stream: writeMoved for the balls the field moved (they roll along
 * their way on the ground or in flight; a removed ball is written with radius 0, which hides it) and
 * writeCarried for the balls a carrier holds (they turn with it).
 */

import { mulberry32 } from './BallCarpet';

/** What the quads are built from (BallField implements it). */
export interface BallSource {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  /** Balls moved since the last redraw, in moved[0 .. movedCount). */
  readonly moved: ArrayLike<number>;
  readonly movedCount: number;
  /** 1 for a ball that is gone for good: it is not drawn. */
  readonly removed: ArrayLike<number>;
}

/**
 * Balls a carrier holds (the bucket implements it): drawn where the field has them (BallSource
 * positions) but turned with the carrier, and rolled only along their own way inside it.
 */
export interface CarriedSource {
  /** Carried balls: their field indices in index[0 .. count). */
  readonly count: number;
  readonly index: ArrayLike<number>;
  /** Their centres in the carrier's axes (x to the side, z forward). */
  readonly localX: ArrayLike<number>;
  readonly localZ: ArrayLike<number>;
  /** The carrier's heading about +Y (local +Z points to (sin yaw, cos yaw)). */
  readonly yaw: number;
  /** True when some carried ball moved since the carrier's last clearMoved(). */
  readonly moved: boolean;
}

export interface BallLookSettings {
  /** Cosmetic size spread: each ball is drawn 1 ± this share bigger (physics keeps one radius). */
  readonly sizeJitter: number;
  /** Cosmetic brightness spread, share: shade 1 ± this. */
  readonly shadeJitter: number;
  readonly seed: number;
}

/** Bytes per vertex of the dynamic stream: float32 x, y, z, radius + int16 x 4 quaternion. */
export const DYNAMIC_STRIDE = 24;
/** Bytes per vertex of the static stream: corner u, v, shade, spare (normalised bytes). */
export const STATIC_STRIDE = 4;
export const VERTS_PER_BALL = 4;
export const INDICES_PER_BALL = 6;

/** Floats and int16s per vertex in the dynamic stream (through a Float32Array and an Int16Array view). */
const FLOATS_PER_VERT = DYNAMIC_STRIDE / 4;
const SHORTS_PER_VERT = DYNAMIC_STRIDE / 2;
/** The quaternion follows the four floats. */
const SPIN_SHORT = 8;
const SNORM = 32767;
/** Quad corners (u, v) in the order the indices expect: counter-clockwise from bottom-left. */
const CORNERS = [0, 0, 1, 0, 1, 1, 0, 1];
/** A ball rolls only once it moved at least this far sideways, units (sub-pixel jitter stays still). */
const MIN_ROLL = 1e-5;

export class BallQuads {
  readonly capacity: number;
  /** Dynamic stream: `dynamicBytes` is what gets uploaded. */
  readonly dynamicBytes: ArrayBuffer;
  /** Static stream and indices, uploaded once. */
  readonly staticBytes: Uint8Array;
  readonly indices: Uint16Array;
  /** Ball orientation quaternions (x, y, z, w per ball), kept in doubles so rolling does not drift. */
  readonly spin: Float64Array;
  /** Drawn radius of each ball (0 for unused slots). */
  readonly radius: Float32Array;

  private readonly floats: Float32Array;
  private readonly shorts: Int16Array;
  /**
   * Where each ball was when it last rolled: rolling follows the way from there. For a carried ball
   * these are its centre in the carrier's axes, so driving the carrier does not roll it.
   */
  private readonly lastX: Float64Array;
  private readonly lastZ: Float64Array;
  /** 1 while a ball is drawn as carried; the carrier's heading it was last turned to. */
  private readonly carried: Uint8Array;
  private readonly carrierYaw: Float64Array;

  /** `radius` is the physics radius; each ball is drawn within its spread around it. */
  constructor(capacity: number, radius: number, look: BallLookSettings) {
    if (capacity * VERTS_PER_BALL > 65536) throw new Error(`BallQuads: ${capacity} balls need 32-bit indices`);
    this.capacity = capacity;
    this.dynamicBytes = new ArrayBuffer(capacity * VERTS_PER_BALL * DYNAMIC_STRIDE);
    this.floats = new Float32Array(this.dynamicBytes);
    this.shorts = new Int16Array(this.dynamicBytes);
    this.staticBytes = new Uint8Array(capacity * VERTS_PER_BALL * STATIC_STRIDE);
    this.indices = new Uint16Array(capacity * INDICES_PER_BALL);
    this.spin = new Float64Array(capacity * 4);
    this.radius = new Float32Array(capacity);
    this.lastX = new Float64Array(capacity);
    this.lastZ = new Float64Array(capacity);
    this.carried = new Uint8Array(capacity);
    this.carrierYaw = new Float64Array(capacity);

    const random = mulberry32(look.seed);
    for (let i = 0; i < capacity; i++) {
      this.radius[i] = radius * (1 + look.sizeJitter * (2 * random() - 1));
      const shade = 1 + look.shadeJitter * (2 * random() - 1);
      randomRotation(random, this.spin, 4 * i);
      for (let k = 0; k < VERTS_PER_BALL; k++) {
        const s = (i * VERTS_PER_BALL + k) * STATIC_STRIDE;
        this.staticBytes[s] = CORNERS[2 * k] * 255;
        this.staticBytes[s + 1] = CORNERS[2 * k + 1] * 255;
        // Shade 0.5..1.5 maps to bytes 0..255.
        this.staticBytes[s + 2] = Math.round(clamp(shade - 0.5, 0, 1) * 255);
      }
      const v = i * VERTS_PER_BALL;
      const n = i * INDICES_PER_BALL;
      this.indices[n] = v;
      this.indices[n + 1] = v + 1;
      this.indices[n + 2] = v + 2;
      this.indices[n + 3] = v;
      this.indices[n + 4] = v + 2;
      this.indices[n + 5] = v + 3;
    }
  }

  /** Writes every ball of `src` (and hides the unused slots and removed balls). Call once before the first upload. */
  writeAll(src: BallSource): void {
    this.carried.fill(0);
    for (let i = 0; i < this.capacity; i++) {
      if (i < src.count) {
        this.lastX[i] = src.x[i];
        this.lastZ[i] = src.z[i];
        this.write(i, src.x[i], src.y[i], src.z[i], src.removed[i] ? 0 : this.radius[i]);
      } else {
        this.write(i, 0, 0, 0, 0);
      }
    }
  }

  /**
   * Rolls and rewrites the balls in src.moved; returns how many were rewritten (0: nothing to upload).
   * A ball turns about up × its way on the ground by (way / radius), so its pattern rolls along; a
   * removed ball is hidden (radius 0).
   */
  writeMoved(src: BallSource): number {
    const { moved, movedCount } = src;
    for (let k = 0; k < movedCount; k++) {
      const i = moved[k];
      const x = src.x[i];
      const z = src.z[i];
      if (src.removed[i]) {
        this.carried[i] = 0;
        this.write(i, x, src.y[i], z, 0);
        continue;
      }
      if (this.carried[i]) {
        // Back in the field: it rolls on from where it is.
        this.carried[i] = 0;
        this.lastX[i] = x;
        this.lastZ[i] = z;
      }
      // Tiny moves add up until they are worth a turn.
      if (this.roll(i, x - this.lastX[i], z - this.lastZ[i])) {
        this.lastX[i] = x;
        this.lastZ[i] = z;
      }
      this.write(i, x, src.y[i], z, this.radius[i]);
    }
    return movedCount;
  }

  /**
   * Rewrites the carried balls if they moved (centres from `field`); returns how many were rewritten.
   * A carried ball turns with the carrier's heading and rolls only along its own way inside the
   * carrier, never along the carrier's drive.
   */
  writeCarried(src: CarriedSource, field: BallSource): number {
    if (!src.moved || src.count === 0) return 0;
    const yaw = src.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (let k = 0; k < src.count; k++) {
      const i = src.index[k];
      const lx = src.localX[k];
      const lz = src.localZ[k];
      if (!this.carried[i]) {
        // Just taken: from now on it turns with the carrier and rolls in its axes.
        this.carried[i] = 1;
        this.carrierYaw[i] = yaw;
        this.lastX[i] = lx;
        this.lastZ[i] = lz;
      }
      const turn = wrapAngle(yaw - this.carrierYaw[i]);
      if (turn !== 0) {
        const half = 0.5 * turn;
        this.turn(i, 0, Math.sin(half), 0, Math.cos(half));
        this.carrierYaw[i] = yaw;
      }
      // Its way in the carrier's axes, turned into the world's.
      const dx = lx - this.lastX[i];
      const dz = lz - this.lastZ[i];
      if (this.roll(i, dx * cos + dz * sin, -dx * sin + dz * cos)) {
        this.lastX[i] = lx;
        this.lastZ[i] = lz;
      }
      this.write(i, field.x[i], field.y[i], field.z[i], this.radius[i]);
    }
    return src.count;
  }

  /** Centre and radius of ball i as written into the dynamic stream (for checks). */
  readBall(i: number, out: { x: number; y: number; z: number; radius: number }): void {
    const f = i * VERTS_PER_BALL * FLOATS_PER_VERT;
    out.x = this.floats[f];
    out.y = this.floats[f + 1];
    out.z = this.floats[f + 2];
    out.radius = this.floats[f + 3];
  }

  /** Turns ball i as if it rolled (dx, dz) on the ground; false if the way was too short to bother. */
  private roll(i: number, dx: number, dz: number): boolean {
    const way = Math.sqrt(dx * dx + dz * dz);
    if (way < MIN_ROLL) return false;
    // Axis up × way = (dz, 0, -dx) / way; angle = way / radius.
    const half = (0.5 * way) / this.radius[i];
    const s = Math.sin(half) / way;
    this.turn(i, dz * s, 0, -dx * s, Math.cos(half));
    return true;
  }

  /** spin = a * spin: turns ball i by the unit quaternion a (in world axes, after its current orientation). */
  private turn(i: number, ax: number, ay: number, az: number, aw: number): void {
    const q = this.spin;
    const o = 4 * i;
    const bx = q[o];
    const by = q[o + 1];
    const bz = q[o + 2];
    const bw = q[o + 3];
    let x = aw * bx + ax * bw + ay * bz - az * by;
    let y = aw * by - ax * bz + ay * bw + az * bx;
    let z = aw * bz + ax * by - ay * bx + az * bw;
    let w = aw * bw - ax * bx - ay * by - az * bz;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    x *= inv;
    y *= inv;
    z *= inv;
    w *= inv;
    q[o] = x;
    q[o + 1] = y;
    q[o + 2] = z;
    q[o + 3] = w;
  }

  /** Writes ball i's four vertices: the same centre, radius and orientation (the corners live in the static stream). */
  private write(i: number, x: number, y: number, z: number, radius: number): void {
    const { floats, shorts, spin } = this;
    const o = 4 * i;
    const qx = Math.round(spin[o] * SNORM);
    const qy = Math.round(spin[o + 1] * SNORM);
    const qz = Math.round(spin[o + 2] * SNORM);
    const qw = Math.round(spin[o + 3] * SNORM);
    for (let k = 0; k < VERTS_PER_BALL; k++) {
      const v = i * VERTS_PER_BALL + k;
      const f = v * FLOATS_PER_VERT;
      floats[f] = x;
      floats[f + 1] = y;
      floats[f + 2] = z;
      floats[f + 3] = radius;
      const s = v * SHORTS_PER_VERT + SPIN_SHORT;
      shorts[s] = qx;
      shorts[s + 1] = qy;
      shorts[s + 2] = qz;
      shorts[s + 3] = qw;
    }
  }
}

/** A uniformly random rotation quaternion (Shoemake), written at out[o .. o + 4). */
function randomRotation(random: () => number, out: Float64Array, o: number): void {
  const u1 = random();
  const u2 = 2 * Math.PI * random();
  const u3 = 2 * Math.PI * random();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  out[o] = a * Math.sin(u2);
  out[o + 1] = a * Math.cos(u2);
  out[o + 2] = b * Math.sin(u3);
  out[o + 3] = b * Math.cos(u3);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Angle wrapped to [-PI, PI). */
function wrapAngle(angle: number): number {
  const TWO_PI = 2 * Math.PI;
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}
