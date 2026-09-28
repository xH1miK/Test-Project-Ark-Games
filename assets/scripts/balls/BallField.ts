/**
 * The ball carpet: a position-based simulation of a few thousand equal balls, in 3D so that shoved
 * balls heap up into a berm (Unity analogy: a hand-written particle system instead of thousands of
 * Rigidbodies). Pure TypeScript: no engine imports.
 *
 * Data-oriented: one typed array per property, indexed by ball. Neighbours come from a uniform XZ
 * grid (cell = one diameter, a cell holds the whole column above it). Only balls in "hot" cells are
 * simulated: cells under a moving pusher and around a moving ball stay hot for a few steps; the
 * rest of the carpet sleeps and costs nothing.
 *
 * One step: predict (gravity, friction, kerb, clear zones) -> contact passes (ball-ball, floor, pusher,
 * static obstacles, field edges) -> velocity from the displacement -> rest and heat. Clear zones (pay
 * pads) are soft: a ball on one rolls off it, but the pusher and the walls still win.
 *
 * A ball can be held out of the field (the bucket carries it, it flies into the shredder): it keeps
 * its index but leaves the grid, so it is neither simulated nor anyone's neighbour; its holder moves
 * it with place() (a carrier that draws it itself) or moveHeld() (views draw it as a loose ball) and
 * may release() it back. A ball can also be removed for good (the shredder ate it): it stays held by
 * nobody and views stop drawing it. Indices never change, so views can key per-ball data by them.
 */

import type { PusherBox, XZBounds } from '../core/Config';
import { PusherFace } from '../core/Config';
import { Blocks } from '../world/ObstacleGrid';
import type { CircleBlocker, XZ } from '../world/ObstacleGrid';

export interface BallFieldSettings {
  readonly radius: number;
  /** Units/s². */
  readonly gravity: number;
  /** Share of a fall that bounces back off the floor. */
  readonly restitution: number;
  /** Constant braking on the ground, units/s². */
  readonly groundFriction: number;
  /** Shares of horizontal speed lost per second on the ground (after the friction) and in the air. */
  readonly groundDrag: number;
  readonly airDrag: number;
  /** How readily a ball shoved into a resting one rides up onto it, 0..1. */
  readonly climb: number;
  /** Share of the closing speed handed to a struck ball. */
  readonly knock: number;
  /** Extra speed a ball is thrown off the pusher with, units/s, and the sideways share at its front. */
  readonly pushSpeed: number;
  readonly plough: number;
  /** Field edges: no ball centre gets closer than one radius to them. */
  readonly bounds: XZBounds;
  /** Kerb along the edges: width, and the push toward the middle at the edge itself, units/s². */
  readonly edgeBand: number;
  readonly edgePush: number;
  /** Contact passes per step. */
  readonly iterations: number;
  /** Share of the diameter two balls may overlap without being pushed apart. */
  readonly contactSlop: number;
  /** Share of the diameter a resting ball lets a slow neighbour sink in before it gives way. */
  readonly jamDepth: number;
  /** Below this speed, units/s, a supported ball stops. */
  readonly restSpeed: number;
  /** Steps a disturbed cell stays hot. */
  readonly hotFrames: number;
}

/** Something that shoves balls aside (the tractor): a pose on the ground plus solid boxes in its own axes. */
export interface BallPusher {
  readonly x: number;
  readonly z: number;
  /** Heading about +Y, Cocos convention: local +Z points to (sin yaw, cos yaw), local +X to (cos yaw, -sin yaw). */
  readonly yaw: number;
  readonly pusherBoxes: readonly PusherBox[];
}

/**
 * A rectangle on the ground (world XZ) balls are kept off while it is active, e.g. a pay pad's plate:
 * a ball whose centre is inside rolls off toward the nearest edge at least `speed` units/s. It works
 * before the pusher, so the tractor can still shove balls onto it (and never into itself).
 */
export interface ClearZone {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly speed: number;
  readonly active: boolean;
}

/** Ball flags. */
const ON_FLOOR = 1;
/** Resting on the floor or on another ball: ground friction applies and the ball may stop. */
const SUPPORTED = 2;

/** A ball that moved less than this share of its diameter in a step counts as still. */
const STILL_SHARE = 0.02;
/** Contact normals steeper than this (their y): one ball sits on the other, so the upper one gives way. */
const STACKED = 0.4;
/** Contact normals steeper than this hold the upper ball up (a ball wedged between others is supported too). */
const HOLDS = 0.1;
/** Closing speed, units/s, above which a hit knocks the struck ball along. */
const KNOCK_SPEED = 0.7;
/** Horizontal speed, units/s, above which a ball rides over resting balls instead of shoving them. */
const FAST_SPEED = 1;
/** Upward speed position corrections may give a ball, units/s (deep contacts must not launch balls). */
const MAX_LIFT_SPEED = 0.5;
/** The pusher's throw also hops the ball up by this share of the throw, at most MAX_LIFT_SPEED. */
const HOP_SHARE = 0.25;
/** A pusher that jumps farther than this in one step was teleported: no speed is derived from the jump. */
const TELEPORT = 3;
/** Most push-out passes against the static obstacles per constraint (pockets between rotated rocks). */
const OBSTACLE_PASSES = 4;

export class BallField {
  /** Ball centres, world units (views read them). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Velocities, units/s. */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  /** Balls moved since the last clearMoved(), in moved[0 .. movedCount): a view redraws only these. */
  readonly moved: Int32Array;
  movedCount = 0;
  /** 1 for a ball removed from the game for good (views hide it); see remove(). */
  readonly removed: Uint8Array;
  /** Neighbour pairs tested in the last step (profiling). */
  pairChecks = 0;

  private readonly settings: BallFieldSettings;
  private readonly blocker: CircleBlocker;
  private readonly radius: number;
  private ballCount = 0;
  // Per ball: position at the start of the step, knock impulses gathered in it, flags, bookkeeping.
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sz: Float64Array;
  private readonly kx: Float64Array;
  private readonly kz: Float64Array;
  private readonly flags: Uint8Array;
  /** 1 for a ball held out of the field (see hold()); removed balls stay held. */
  private readonly held: Uint8Array;
  private heldTotal = 0;
  private removedTotal = 0;
  /** Step in which a ball was last simulated; equals `stepNo` for the balls of the current step. */
  private readonly stamp: Int32Array;
  private readonly movedMark: Uint8Array;
  // Grid: a doubly linked list of balls per cell.
  private readonly cellSize: number;
  private readonly invCell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly prev: Int32Array;
  private readonly cellOf: Int32Array;
  // Hot cells: a countdown per cell plus the list of the hot ones.
  private readonly hot: Uint8Array;
  private readonly hotList: Int32Array;
  private hotCount = 0;
  // Balls simulated in the current step.
  private readonly active: Int32Array;
  private activeCount = 0;
  private stepNo = 0;
  // The pusher as seen by the current step.
  private pusherKnown = false;
  private pusherX = 0;
  private pusherZ = 0;
  private pusherYaw = 0;
  private pusherCos = 1;
  private pusherSin = 0;
  private pusherSpeed = 0;
  private readonly resolved: XZ = { x: 0, z: 0 };
  private readonly faceGap = { value: 0 };
  private readonly zones: ClearZone[] = [];
  /** Whether each zone was active in the last step, and the ones active in this step. */
  private readonly zoneWasActive: boolean[] = [];
  private readonly liveZones: ClearZone[] = [];

  constructor(settings: BallFieldSettings, capacity: number, blocker: CircleBlocker) {
    this.settings = settings;
    this.blocker = blocker;
    this.radius = settings.radius;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.vz = new Float64Array(capacity);
    this.sx = new Float64Array(capacity);
    this.sy = new Float64Array(capacity);
    this.sz = new Float64Array(capacity);
    this.kx = new Float64Array(capacity);
    this.kz = new Float64Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.held = new Uint8Array(capacity);
    this.removed = new Uint8Array(capacity);
    this.stamp = new Int32Array(capacity);
    this.moved = new Int32Array(capacity);
    this.movedMark = new Uint8Array(capacity);
    this.next = new Int32Array(capacity);
    this.prev = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
    this.active = new Int32Array(capacity);

    const { bounds } = settings;
    this.cellSize = 2 * settings.radius;
    this.invCell = 1 / this.cellSize;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * this.invCell));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) * this.invCell));
    const cells = this.cols * this.rows;
    this.head = new Int32Array(cells).fill(-1);
    this.hot = new Uint8Array(cells);
    this.hotList = new Int32Array(cells);
  }

  get count(): number {
    return this.ballCount;
  }

  get capacity(): number {
    return this.x.length;
  }

  /** Balls simulated in the last step; all the others slept. */
  get simulatedCount(): number {
    return this.activeCount;
  }

  get hotCellCount(): number {
    return this.hotCount;
  }

  /** True when ball `i` was simulated in the last step. */
  isAwake(i: number): boolean {
    return this.stamp[i] === this.stepNo && this.stepNo > 0;
  }

  /** Adds a ball and returns its index. On the floor it starts asleep; above it, it falls. */
  add(x: number, y: number, z: number): number {
    if (this.ballCount >= this.capacity) throw new Error(`BallField: capacity ${this.capacity} reached`);
    const i = this.ballCount++;
    const { bounds } = this.settings;
    const r = this.radius;
    this.x[i] = clamp(x, bounds.minX + r, bounds.maxX - r);
    this.y[i] = Math.max(y, r);
    this.z[i] = clamp(z, bounds.minZ + r, bounds.maxZ - r);
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.flags[i] = this.y[i] <= r ? ON_FLOOR | SUPPORTED : 0;
    this.stamp[i] = 0;
    this.link(i, this.cellAt(this.x[i], this.z[i]));
    if (this.flags[i] === 0) this.heatAround(this.cellOf[i]);
    return i;
  }

  /** Wakes every ball within a square of half size `half` around (x, z), e.g. before a burst. */
  wake(x: number, z: number, half: number): void {
    this.heatRect(x - half, x + half, z - half, z + half);
  }

  /** Keeps balls off `zone` whenever it is active (it is read every step). */
  addClearZone(zone: ClearZone): void {
    this.zones.push(zone);
    this.zoneWasActive.push(false);
  }

  /**
   * Throws the free balls within `radius` of (x, z) outward, as when something pops up among them:
   * `speed` units/s at the centre, less toward the rim (a quarter of it there), and upward by `hop`
   * times that. They and their surroundings wake.
   */
  burst(x: number, z: number, radius: number, speed: number, hop: number): void {
    const { head, next } = this;
    const a = this.cellAt(x - radius, z - radius);
    const b = this.cellAt(x + radius, z + radius);
    const c0 = a % this.cols;
    const c1 = b % this.cols;
    const r0 = (a - c0) / this.cols;
    const r1 = (b - c1) / this.cols;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        for (let i = head[rr * this.cols + cc]; i >= 0; i = next[i]) {
          const dx = this.x[i] - x;
          const dz = this.z[i] - z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > radius) continue;
          // A ball right at the centre goes its own way (golden-angle spread by index).
          const angle = i * 2.399963;
          const nx = d > 1e-6 ? dx / d : Math.sin(angle);
          const nz = d > 1e-6 ? dz / d : Math.cos(angle);
          const v = speed * Math.max(0.25, 1 - d / radius);
          this.vx[i] = nx * v;
          this.vz[i] = nz * v;
          this.vy[i] = Math.max(this.vy[i], v * hop);
        }
      }
    }
    const margin = this.cellSize;
    this.heatRect(x - radius - margin, x + radius + margin, z - radius - margin, z + radius + margin);
  }

  /** Balls held out of the field right now (carried, flying or removed for good). */
  get heldCount(): number {
    return this.heldTotal;
  }

  /** Balls removed from the game for good (they count as held too). */
  get removedCount(): number {
    return this.removedTotal;
  }

  /** True when ball i is held out of the field (carried, flying, removed), not simulated by it. */
  isHeld(i: number): boolean {
    return this.held[i] === 1;
  }

  /** True when ball i was removed from the game for good. */
  isRemoved(i: number): boolean {
    return this.removed[i] === 1;
  }

  /**
   * Free balls whose centres lie in the XZ rectangle, written to `out` (at most out.length of them);
   * returns how many. Held balls are not in the field, so they are never found.
   */
  findFree(minX: number, maxX: number, minZ: number, maxZ: number, out: Int32Array): number {
    const { x, z, head, next } = this;
    const a = this.cellAt(minX, minZ);
    const b = this.cellAt(maxX, maxZ);
    const c0 = a % this.cols;
    const c1 = b % this.cols;
    const r0 = (a - c0) / this.cols;
    const r1 = (b - c1) / this.cols;
    let n = 0;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        for (let i = head[rr * this.cols + cc]; i >= 0; i = next[i]) {
          if (x[i] < minX || x[i] > maxX || z[i] < minZ || z[i] > maxZ) continue;
          if (n === out.length) return n;
          out[n++] = i;
        }
      }
    }
    return n;
  }

  /**
   * Takes ball i out of the field: it is no longer simulated nor anyone's neighbour, and its
   * neighbours wake (the ones resting on it fall into the gap). Its holder moves it with place().
   */
  hold(i: number): void {
    if (this.held[i]) return;
    this.held[i] = 1;
    this.heldTotal++;
    this.heatAround(this.cellOf[i]);
    this.unlink(i);
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.kx[i] = this.kz[i] = 0;
  }

  /**
   * Moves a held ball whose holder draws it (the bucket: views turn carried balls with it); it is not
   * listed in `moved`. Free and removed balls are left alone.
   */
  place(i: number, x: number, y: number, z: number): void {
    if (!this.held[i] || this.removed[i]) return;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
  }

  /**
   * Moves a held ball and lists it in `moved`, so views redraw it as a loose ball (one in flight rolls
   * along its way). Free and removed balls are left alone.
   */
  moveHeld(i: number, x: number, y: number, z: number): void {
    if (!this.held[i] || this.removed[i]) return;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.markMoved(i);
  }

  /**
   * Removes ball i from the game for good (the shredder ate it): it stays out of the field, held by
   * nobody, keeps its index, and is listed in `moved` once so views stop drawing it.
   */
  remove(i: number): void {
    if (this.removed[i]) return;
    this.hold(i);
    this.removed[i] = 1;
    this.removedTotal++;
    this.markMoved(i);
  }

  /** Puts a held ball back into the field at (x, y, z) with a velocity; it and its neighbours wake. */
  release(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    if (!this.held[i] || this.removed[i]) return;
    this.held[i] = 0;
    this.heldTotal--;
    const { bounds } = this.settings;
    const r = this.radius;
    this.x[i] = clamp(x, bounds.minX + r, bounds.maxX - r);
    this.y[i] = Math.max(y, r);
    this.z[i] = clamp(z, bounds.minZ + r, bounds.maxZ - r);
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.flags[i] = 0; // the contact passes find its floor or support again
    this.link(i, this.cellAt(this.x[i], this.z[i]));
    this.heatAround(this.cellOf[i]);
    this.markMoved(i);
  }

  /** Forgets the moved list once a view has redrawn it. */
  clearMoved(): void {
    for (let k = 0; k < this.movedCount; k++) this.movedMark[this.moved[k]] = 0;
    this.movedCount = 0;
  }

  /** Advances the carpet by `dt` seconds (at most ~1/30: the caller splits long frames). */
  step(dt: number, pusher: BallPusher | null): void {
    if (dt <= 0 || this.ballCount === 0) return;
    this.stepNo++;
    this.activeCount = 0;
    this.pairChecks = 0;
    if (this.trackPusher(dt, pusher)) this.heatPusher(pusher!);
    this.updateZones();
    this.gather();
    if (this.activeCount > 0) {
      this.predict(dt);
      this.refileActive();
      const passes = this.settings.iterations;
      for (let pass = 0; pass < passes; pass++) {
        this.project(pass === 0, dt, pusher);
        this.refileActive();
      }
      // Neighbours moved after their own turn may sit in a wall or in the pusher: the hard limits get the last word.
      for (let a = 0; a < this.activeCount; a++) this.constrain(this.active[a], pusher, false, dt);
      this.refileActive();
      this.finish(dt);
    }
    this.cool();
  }

  /** Reads the pusher's pose; returns true when it moved or turned (its cells need waking). */
  private trackPusher(dt: number, pusher: BallPusher | null): boolean {
    if (!pusher) {
      this.pusherKnown = false;
      this.pusherSpeed = 0;
      return false;
    }
    let moved = true;
    let speed = 0;
    if (this.pusherKnown) {
      const dx = pusher.x - this.pusherX;
      const dz = pusher.z - this.pusherZ;
      const d2 = dx * dx + dz * dz;
      if (d2 <= TELEPORT * TELEPORT) speed = Math.sqrt(d2) / dt;
      moved = d2 > 0 || pusher.yaw !== this.pusherYaw;
    }
    this.pusherKnown = true;
    this.pusherX = pusher.x;
    this.pusherZ = pusher.z;
    this.pusherYaw = pusher.yaw;
    this.pusherCos = Math.cos(pusher.yaw);
    this.pusherSin = Math.sin(pusher.yaw);
    this.pusherSpeed = speed;
    return moved;
  }

  /** Heats the cells under the pusher's boxes plus a margin, so balls wake before they are hit. */
  private heatPusher(pusher: BallPusher): void {
    const cos = this.pusherCos;
    const sin = this.pusherSin;
    const ac = Math.abs(cos);
    const as = Math.abs(sin);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const boxes = pusher.pusherBoxes;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      const midZ = (box.minZ + box.maxZ) / 2;
      const halfZ = (box.maxZ - box.minZ) / 2;
      const cx = pusher.x + midZ * sin;
      const cz = pusher.z + midZ * cos;
      const ex = ac * box.halfX + as * halfZ;
      const ez = as * box.halfX + ac * halfZ;
      minX = Math.min(minX, cx - ex);
      maxX = Math.max(maxX, cx + ex);
      minZ = Math.min(minZ, cz - ez);
      maxZ = Math.max(maxZ, cz + ez);
    }
    const margin = this.radius + this.cellSize;
    this.heatRect(minX - margin, maxX + margin, minZ - margin, maxZ + margin);
  }

  /** Lists the clear zones active in this step; a zone that has just turned on wakes the balls on it. */
  private updateZones(): void {
    const { zones, zoneWasActive, liveZones } = this;
    liveZones.length = 0;
    for (let k = 0; k < zones.length; k++) {
      const zone = zones[k];
      const on = zone.active;
      if (on && !zoneWasActive[k]) this.heatRect(zone.minX, zone.maxX, zone.minZ, zone.maxZ);
      zoneWasActive[k] = on;
      if (on) liveZones.push(zone);
    }
  }

  /** The first active clear zone holding the point, or null. */
  private zoneAt(x: number, z: number): ClearZone | null {
    const live = this.liveZones;
    for (let k = 0; k < live.length; k++) {
      const zone = live[k];
      if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return zone;
    }
    return null;
  }

  /** Puts every ball of the hot cells into the simulated set. */
  private gather(): void {
    const { hotList, head, next } = this;
    for (let k = 0; k < this.hotCount; k++) {
      for (let i = head[hotList[k]]; i >= 0; i = next[i]) this.activate(i);
    }
  }

  private activate(i: number): void {
    if (this.stamp[i] === this.stepNo) return;
    this.stamp[i] = this.stepNo;
    this.sx[i] = this.x[i];
    this.sy[i] = this.y[i];
    this.sz[i] = this.z[i];
    this.active[this.activeCount++] = i;
  }

  /** Gravity, ground friction or air drag, the kerb; then moves each ball by its velocity. */
  private predict(dt: number): void {
    const { x, y, z, vx, vy, vz, flags, active } = this;
    const s = this.settings;
    const r = this.radius;
    const fall = s.gravity * dt;
    const friction = s.groundFriction * dt;
    const groundKeep = Math.max(0, 1 - s.groundDrag * dt);
    const airKeep = Math.max(0, 1 - s.airDrag * dt);
    const band = s.edgeBand;
    const kerb = band > 0 ? s.edgePush * dt : 0;
    const loX = s.bounds.minX + r;
    const hiX = s.bounds.maxX - r;
    const loZ = s.bounds.minZ + r;
    const hiZ = s.bounds.maxZ - r;
    const maxMove = 1.6 * r;
    for (let a = 0; a < this.activeCount; a++) {
      const i = active[a];
      let bx = vx[i];
      const by = vy[i] - fall;
      let bz = vz[i];
      if (flags[i] & SUPPORTED) {
        const speed = Math.sqrt(bx * bx + bz * bz);
        if (speed <= friction) {
          bx = 0;
          bz = 0;
        } else {
          const keep = ((speed - friction) / speed) * groundKeep;
          bx *= keep;
          bz *= keep;
        }
      } else {
        bx *= airKeep;
        bz *= airKeep;
      }
      flags[i] = 0; // floor and support are found again by the contact passes
      // The kerb bends moving balls away from the edges; resting balls stay put.
      if (kerb > 0 && (bx !== 0 || bz !== 0)) {
        bx += kerbPush(x[i] - loX, band, kerb) - kerbPush(hiX - x[i], band, kerb);
        bz += kerbPush(z[i] - loZ, band, kerb) - kerbPush(hiZ - z[i], band, kerb);
      }
      // A ball on a kept-clear zone rolls off it through the nearest edge, resting or not.
      const zone = this.liveZones.length > 0 ? this.zoneAt(x[i], z[i]) : null;
      if (zone) {
        const toMinX = x[i] - zone.minX;
        const toMaxX = zone.maxX - x[i];
        const toMinZ = z[i] - zone.minZ;
        const toMaxZ = zone.maxZ - z[i];
        let ex = -1;
        let ez = 0;
        let best = toMinX;
        if (toMaxX < best) {
          best = toMaxX;
          ex = 1;
        }
        if (toMinZ < best) {
          best = toMinZ;
          ex = 0;
          ez = -1;
        }
        if (toMaxZ < best) {
          ex = 0;
          ez = 1;
        }
        const along = bx * ex + bz * ez;
        if (along < zone.speed) {
          bx += (zone.speed - along) * ex;
          bz += (zone.speed - along) * ez;
        }
      }
      let mx = bx * dt;
      let my = by * dt;
      let mz = bz * dt;
      const m2 = mx * mx + my * my + mz * mz;
      if (m2 > maxMove * maxMove) {
        const k = maxMove / Math.sqrt(m2);
        mx *= k;
        my *= k;
        mz *= k;
      }
      vx[i] = bx;
      vy[i] = by;
      vz[i] = bz;
      x[i] += mx;
      y[i] += my;
      z[i] += mz;
    }
  }

  /**
   * One contact pass over the simulated balls: ball-ball, floor, pusher, static obstacles, edges
   * (in that order, so walls and edges always win).
   */
  private project(first: boolean, dt: number, pusher: BallPusher | null): void {
    const { x, y, z, vx, vy, vz, kx, kz, flags, stamp, head, next, cellOf, active, cols, rows } = this;
    const s = this.settings;
    const r = this.radius;
    const contact = 2 * r * (1 - s.contactSlop);
    const contact2 = contact * contact;
    const jam = s.jamDepth * 2 * r;
    const rest2 = s.restSpeed * s.restSpeed;
    const fast2 = FAST_SPEED * FAST_SPEED;
    const climb = s.climb;
    const climbNorm = 1 / Math.sqrt(1 + climb * climb);
    const knock = first ? s.knock : 0;
    const stepNo = this.stepNo;
    let pairs = 0;
    // Balls woken during the pass are appended and handled in it too, so none ends a pass in a wall.
    for (let a = 0; a < this.activeCount; a++) {
      const i = active[a];
      const cell = cellOf[i];
      const col = cell % cols;
      const row = (cell - col) / cols;
      const c0 = col > 0 ? col - 1 : 0;
      const c1 = col < cols - 1 ? col + 1 : col;
      const r1 = row < rows - 1 ? row + 1 : row;
      const iSpeed2 = vx[i] * vx[i] + vz[i] * vz[i];
      const iRests = iSpeed2 < rest2;
      const iFast = iSpeed2 > fast2;
      for (let rr = row > 0 ? row - 1 : 0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          for (let j = head[rr * cols + cc]; j >= 0; j = next[j]) {
            if (j === i) continue;
            const jAwake = stamp[j] === stepNo;
            // A pair of simulated balls is handled once, by the higher index.
            if (jAwake && j < i) continue;
            pairs++;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const dz = z[j] - z[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= contact2) continue;
            const d = Math.sqrt(d2);
            // Unit normal from i to j.
            let nx = 1;
            let ny = 0;
            let nz = 0;
            if (d > 1e-6) {
              nx = dx / d;
              ny = dy / d;
              nz = dz / d;
            } else if (j < i) {
              nx = -1;
            }
            const depth = contact - d;

            if (knock > 0) {
              const closing = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny + (vz[i] - vz[j]) * nz;
              if (closing > KNOCK_SPEED) {
                const kick = knock * closing;
                kx[j] += kick * nx;
                kz[j] += kick * nz;
                kx[i] -= kick * nx;
                kz[i] -= kick * nz;
                if (!jAwake) this.activate(j);
              }
            }

            if (ny > HOLDS) flags[j] |= SUPPORTED;
            else if (ny < -HOLDS) flags[i] |= SUPPORTED;

            // Share of the correction ball j takes (i takes the rest), and who may climb.
            let jShare: number;
            let climber = 0; // +1: i rides up onto j, -1: j rides up onto i
            if (ny > STACKED) {
              // j sits on i: the upper ball gives way, unless it sleeps and the overlap is shallow.
              jShare = !jAwake && depth <= jam ? 0 : 1;
            } else if (ny < -STACKED) {
              jShare = 0;
            } else {
              const jSpeed2 = vx[j] * vx[j] + vz[j] * vz[j];
              const jRests = !jAwake || jSpeed2 < rest2;
              if (iRests === jRests) {
                // Both resting or both rolling: split, but a sleeping ball ignores a shallow overlap.
                jShare = jAwake || depth > jam ? 0.5 : 0;
              } else if (jRests) {
                // i runs into a resting ball: it rides up on it rather than shoving it, unless slow and deep.
                jShare = iSpeed2 <= fast2 && depth > jam ? 0.5 : 0;
                climber = y[i] < 2 * r ? 1 : 0;
              } else {
                jShare = jSpeed2 <= fast2 && depth > jam ? 0.5 : 1;
                climber = y[j] < 2 * r ? -1 : 0;
              }
              if (climber !== 0 && climb > 0) {
                // Tilt the normal so the climber's way out points up: i moves along -n, j along +n.
                nx *= climbNorm;
                nz *= climbNorm;
                ny = (ny - climber * climb) * climbNorm;
              }
            }

            const iMove = depth * (1 - jShare);
            x[i] -= nx * iMove;
            y[i] -= ny * iMove;
            z[i] -= nz * iMove;
            if (jShare > 0) {
              if (!jAwake) this.activate(j);
              const jMove = depth * jShare;
              x[j] += nx * jMove;
              y[j] += ny * jMove;
              z[j] += nz * jMove;
            }
          }
        }
      }

      this.constrain(i, pusher, first, dt);
    }
    this.pairChecks += pairs;
  }

  /**
   * The hard limits of one ball, the last word last: floor, pusher, field edges, then the static
   * obstacles (a ball sunk in a rock would show; the edges are only a safety net behind the rocks).
   */
  private constrain(i: number, pusher: BallPusher | null, first: boolean, dt: number): void {
    const { x, y, z } = this;
    const r = this.radius;
    if (y[i] < r) {
      y[i] = r;
      this.flags[i] |= ON_FLOOR | SUPPORTED;
    }
    if (pusher) this.shove(i, pusher.pusherBoxes, first, dt);
    const { bounds } = this.settings;
    x[i] = clamp(x[i], bounds.minX + r, bounds.maxX - r);
    z[i] = clamp(z[i], bounds.minZ + r, bounds.maxZ - r);
    // Pushed out of one rock into its neighbour in a sharp pocket: go round again (each pass halves the rest).
    for (let pass = 0; pass < OBSTACLE_PASSES; pass++) {
      if (this.blocker.resolveCircle(x[i], z[i], r, Blocks.Balls, this.resolved) <= 0) break;
      x[i] = this.resolved.x;
      z[i] = this.resolved.z;
    }
  }

  /**
   * Pushes ball i out of the pusher's boxes (sideways, never onto a top). On the first pass a ball
   * struck by a moving pusher is also thrown off it, and sideways at its front (the plough).
   */
  private shove(i: number, boxes: readonly PusherBox[], first: boolean, dt: number): void {
    const { x, y, z } = this;
    const r = this.radius;
    const cos = this.pusherCos;
    const sin = this.pusherSin;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (y[i] - r > box.top) continue;
      // World -> pusher axes (inverse rotation about Y).
      const dx = x[i] - this.pusherX;
      const dz = z[i] - this.pusherZ;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const hx = box.halfX;
      if (lx < -hx - r || lx > hx + r || lz < box.minZ - r || lz > box.maxZ + r) continue;
      const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
      const qz = lz < box.minZ ? box.minZ : lz > box.maxZ ? box.maxZ : lz;
      let ox = lx - qx;
      let oz = lz - qz;
      let depth: number;
      let front: boolean;
      const o2 = ox * ox + oz * oz;
      if (o2 > 0) {
        // Centre outside the box, touching a face or a corner.
        if (o2 >= r * r) continue;
        const o = Math.sqrt(o2);
        depth = r - o;
        ox = (ox / o) * depth;
        oz = (oz / o) * depth;
        front = oz > 0 && oz >= Math.abs(ox);
      } else {
        // Centre inside: leave through the nearest face that is open.
        const face = nearestOpenFace(box.shut, lx + hx, hx - lx, lz - box.minZ, box.maxZ - lz, this.faceGap);
        if (face === 0) continue;
        depth = this.faceGap.value + r;
        ox = face === PusherFace.Left ? -depth : face === PusherFace.Right ? depth : 0;
        oz = face === PusherFace.Back ? -depth : face === PusherFace.Front ? depth : 0;
        front = face === PusherFace.Front;
      }
      // Pusher axes -> world.
      const wx = ox * cos + oz * sin;
      const wz = -ox * sin + oz * cos;
      x[i] += wx;
      z[i] += wz;
      if (first && this.pusherSpeed > 0.05) this.throwOff(i, wx, wz, depth, front, lx / hx, dt);
    }
  }

  /**
   * Gives a ball the pusher just moved some extra speed away from it, as a displacement (the
   * velocity is taken from the displacement at the end of the step). A ball pushed out of the
   * front face is also shed sideways; `side` is where along that face it sits (-1..1).
   */
  private throwOff(i: number, wx: number, wz: number, depth: number, front: boolean, side: number, dt: number): void {
    const { x, y, z, vx, vy, vz } = this;
    const s = this.settings;
    const speedShare = this.pusherSpeed > 1 ? 1 : this.pusherSpeed;
    const len = Math.sqrt(wx * wx + wz * wz);
    if (len > 1e-9) {
      const nx = wx / len;
      const nz = wz / len;
      const want = s.pushSpeed * Math.min(1, depth / (2 * this.radius)) * speedShare;
      const along = vx[i] * nx + vz[i] * nz;
      if (along < want) {
        const add = (want - along) * dt;
        x[i] += nx * add;
        z[i] += nz * add;
        const hop = Math.min(HOP_SHARE * (want - along), MAX_LIFT_SPEED);
        if (vy[i] < hop) y[i] += (hop - vy[i]) * dt;
      }
    }
    if (front && s.plough > 0) {
      // The front sheds balls sideways, harder the farther out along the face they sit.
      const bias = side > 0 ? 1 : side < 0 ? -1 : i & 1 ? 1 : -1;
      const reach = side < 0 ? -side : side;
      const want = bias * (0.4 + 0.6 * (reach > 1 ? 1 : reach)) * s.pushSpeed * s.plough * speedShare;
      // Current sideways speed along the pusher's local +X = (cos, -sin).
      const current = vx[i] * this.pusherCos - vz[i] * this.pusherSin;
      const add = want - current;
      if (bias > 0 ? add > 0 : add < 0) {
        x[i] += add * this.pusherCos * dt;
        z[i] -= add * this.pusherSin * dt;
      }
    }
  }

  /** Velocities from the step's displacement; stops supported slow balls; heats around moving ones. */
  private finish(dt: number): void {
    const { x, y, z, vx, vy, vz, sx, sy, sz, kx, kz, flags, active, cellOf } = this;
    const s = this.settings;
    const inv = 1 / dt;
    const rest2 = s.restSpeed * s.restSpeed;
    // A supported ball that moved less than this in a step is at rest; its move was contact noise:
    // gravity sinks a resting ball about g·dt² into its supports every step and the contact passes
    // push it only nearly back. With 1/30 s steps that noise outgrew the fixed share and a ball
    // wedged on three others wobbled for ever instead of falling asleep (found at 6 fps, 28.09).
    const still = Math.max(STILL_SHARE * 2 * this.radius, s.gravity * dt * dt);
    const still2 = still * still;
    const throwCap = this.pusherSpeed + s.pushSpeed + 1;
    for (let a = 0; a < this.activeCount; a++) {
      const i = active[a];
      const ddx = x[i] - sx[i];
      const ddy = y[i] - sy[i];
      const ddz = z[i] - sz[i];
      const moved2 = ddx * ddx + ddy * ddy + ddz * ddz;
      const f = flags[i];
      const supported = (f & SUPPORTED) !== 0;
      // Contact noise gives a supported ball no speed; a knock from a neighbour still does.
      const noise = supported && moved2 <= still2 ? 0 : inv;
      let nvx = ddx * noise + kx[i];
      let nvy = ddy * noise;
      let nvz = ddz * noise + kz[i];
      kx[i] = 0;
      kz[i] = 0;
      if (f & ON_FLOOR) {
        // Landing: a hard fall bounces a little, anything else stays on the floor.
        nvy = vy[i] < -2 && s.restitution > 0 ? -vy[i] * s.restitution : 0;
      } else {
        const lift = vy[i] > MAX_LIFT_SPEED ? vy[i] : MAX_LIFT_SPEED;
        if (nvy > lift) nvy = lift;
      }
      // Corrections must not fling balls: horizontal speed stays within what could have caused it.
      const before = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]);
      const cap = before > throwCap ? before : throwCap;
      const h2 = nvx * nvx + nvz * nvz;
      if (h2 > cap * cap) {
        const k = cap / Math.sqrt(h2);
        nvx *= k;
        nvz *= k;
      }
      if (supported && h2 + nvy * nvy < rest2) {
        nvx = 0;
        nvy = 0;
        nvz = 0;
      }
      vx[i] = nvx;
      vy[i] = nvy;
      vz[i] = nvz;
      if (moved2 > 0) this.markMoved(i);
      // A ball still on a kept-clear zone (jammed by its neighbours) stays awake until it is off.
      const onZone = this.liveZones.length > 0 && this.zoneAt(x[i], z[i]) !== null;
      if (!supported || moved2 > still2 || nvx !== 0 || nvy !== 0 || nvz !== 0 || onZone) this.heatAround(cellOf[i]);
    }
  }

  private markMoved(i: number): void {
    if (this.movedMark[i]) return;
    this.movedMark[i] = 1;
    this.moved[this.movedCount++] = i;
  }

  // --- grid ---

  private cellAt(x: number, z: number): number {
    const { bounds } = this.settings;
    let col = Math.floor((x - bounds.minX) * this.invCell);
    let row = Math.floor((z - bounds.minZ) * this.invCell);
    col = col < 0 ? 0 : col >= this.cols ? this.cols - 1 : col;
    row = row < 0 ? 0 : row >= this.rows ? this.rows - 1 : row;
    return row * this.cols + col;
  }

  private link(i: number, cell: number): void {
    const first = this.head[cell];
    this.cellOf[i] = cell;
    this.prev[i] = -1;
    this.next[i] = first;
    if (first >= 0) this.prev[first] = i;
    this.head[cell] = i;
  }

  private unlink(i: number): void {
    const p = this.prev[i];
    const n = this.next[i];
    if (p >= 0) this.next[p] = n;
    else this.head[this.cellOf[i]] = n;
    if (n >= 0) this.prev[n] = p;
  }

  /** Moves the simulated balls that changed cell to their new cell list. */
  private refileActive(): void {
    const { x, z, active, cellOf } = this;
    for (let a = 0; a < this.activeCount; a++) {
      const i = active[a];
      const cell = this.cellAt(x[i], z[i]);
      if (cell !== cellOf[i]) {
        this.unlink(i);
        this.link(i, cell);
      }
    }
  }

  // --- hot cells ---

  private heat(cell: number): void {
    if (this.hot[cell] === 0) this.hotList[this.hotCount++] = cell;
    this.hot[cell] = this.settings.hotFrames;
  }

  /** Heats a cell and its 8 neighbours. */
  private heatAround(cell: number): void {
    const col = cell % this.cols;
    const row = (cell - col) / this.cols;
    const c0 = col > 0 ? col - 1 : 0;
    const c1 = col < this.cols - 1 ? col + 1 : col;
    const r1 = row < this.rows - 1 ? row + 1 : row;
    for (let rr = row > 0 ? row - 1 : 0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) this.heat(rr * this.cols + cc);
    }
  }

  private heatRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const a = this.cellAt(minX, minZ);
    const b = this.cellAt(maxX, maxZ);
    const c0 = a % this.cols;
    const c1 = b % this.cols;
    const r0 = (a - c0) / this.cols;
    const r1 = (b - c1) / this.cols;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) this.heat(rr * this.cols + cc);
    }
  }

  /** Counts every hot cell down by one step and drops the cold ones from the list. */
  private cool(): void {
    const { hot, hotList } = this;
    let kept = 0;
    for (let k = 0; k < this.hotCount; k++) {
      const cell = hotList[k];
      if (--hot[cell] > 0) hotList[kept++] = cell;
    }
    this.hotCount = kept;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The face of a box nearest to a point inside it among the faces not in `shut` (PusherFace bits),
 * given the distances to each face. Returns the face (0 if all are shut) and writes its distance to `gap`.
 */
function nearestOpenFace(shut: number, toLeft: number, toRight: number, toBack: number, toFront: number, gap: { value: number }): number {
  let face = 0;
  let best = Infinity;
  if (!(shut & PusherFace.Left) && toLeft < best) {
    best = toLeft;
    face = PusherFace.Left;
  }
  if (!(shut & PusherFace.Right) && toRight < best) {
    best = toRight;
    face = PusherFace.Right;
  }
  if (!(shut & PusherFace.Back) && toBack < best) {
    best = toBack;
    face = PusherFace.Back;
  }
  if (!(shut & PusherFace.Front) && toFront < best) {
    best = toFront;
    face = PusherFace.Front;
  }
  gap.value = best;
  return face;
}

/** Kerb push toward the middle for a ball `gap` away from an edge: full at the edge, none past the band. */
function kerbPush(gap: number, band: number, push: number): number {
  return gap >= band ? 0 : gap <= 0 ? push : push * (1 - gap / band);
}
