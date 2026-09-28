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
  /** Where each ball was when last written: rolling follows the way from there. */
  private readonly lastX: Float64Array;
  private readonly lastZ: Float64Array;

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

  /** Writes every ball of `src` (and hides the unused slots). Call once before the first upload. */
  writeAll(src: BallSource): void {
    for (let i = 0; i < this.capacity; i++) {
      if (i < src.count) {
        this.lastX[i] = src.x[i];
        this.lastZ[i] = src.z[i];
        this.write(i, src.x[i], src.y[i], src.z[i], this.radius[i]);
      } else {
        this.write(i, 0, 0, 0, 0);
      }
    }
  }

  /**
   * Rolls and rewrites the balls in src.moved; returns how many were rewritten (0: nothing to upload).
   * A ball turns about up × its way on the ground by (way / radius), so its pattern rolls along.
   */
  writeMoved(src: BallSource): number {
    const { moved, movedCount } = src;
    for (let k = 0; k < movedCount; k++) {
      const i = moved[k];
      const x = src.x[i];
      const z = src.z[i];
      // Tiny moves add up until they are worth a turn.
      if (this.roll(i, x - this.lastX[i], z - this.lastZ[i])) {
        this.lastX[i] = x;
        this.lastZ[i] = z;
      }
      this.write(i, x, src.y[i], z, this.radius[i]);
    }
    return movedCount;
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
    const ax = dz * s;
    const az = -dx * s;
    const aw = Math.cos(half);
    // spin = turn * spin (the turn happens in world axes, after the current orientation).
    const q = this.spin;
    const o = 4 * i;
    const bx = q[o];
    const by = q[o + 1];
    const bz = q[o + 2];
    const bw = q[o + 3];
    let x = aw * bx + ax * bw - az * by;
    let y = aw * by + az * bx - ax * bz;
    let z = aw * bz + az * bw + ax * by;
    let w = aw * bw - ax * bx - az * bz;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    x *= inv;
    y *= inv;
    z *= inv;
    w *= inv;
    q[o] = x;
    q[o + 1] = y;
    q[o + 2] = z;
    q[o + 3] = w;
    return true;
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
