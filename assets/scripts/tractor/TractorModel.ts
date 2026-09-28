/**
 * Tractor movement on the XZ plane: turns toward the commanded direction, speeds up and brakes,
 * slows down while turning (tank-like), and slides along static obstacles as a circle.
 * No physics engine: explicit kinematics (Unity analogy: a CharacterController driven by hand).
 * Pure TypeScript: no engine imports.
 */

import type { BucketShape, PusherBox, TractorTierConfig } from '../core/Config';
import type { EventBus, GameEvents } from '../core/Events';
import { Blocks } from '../world/ObstacleGrid';
import type { CircleBlocker, XZ } from '../world/ObstacleGrid';

export interface TractorDriveSettings {
  /** Maximum turn rate, degrees/s (reached at top speed; 75% of it when standing). */
  readonly turnSpeed: number;
  /** Acceleration and braking, units/s². */
  readonly accel: number;
  readonly brake: number;
  /** Circle-vs-obstacle resolve passes per step. */
  readonly collisionPasses: number;
  /** Longest simulation step, s; longer frames are split so collisions stay tight at low FPS. */
  readonly maxStep: number;
  /**
   * A new tier arrives over `time` seconds: a bigger body that overlaps an obstacle then grows into
   * its size, pushed clear over that time instead of in one jump (the view swells the model alike).
   */
  readonly swell: { readonly time: number };
}

const TWO_PI = Math.PI * 2;

export class TractorModel {
  x = 0;
  z = 0;
  /** Heading about +Y in radians, Cocos convention: forward = (sin yaw, cos yaw) on XZ (the model faces +Z at 0). */
  yaw = 0;
  /** Forward speed, units/s (never negative: the tractor does not reverse). */
  speed = 0;
  /** Distance actually travelled, after collisions (drives tread scrolling, QA). */
  odometer = 0;

  private readonly settings: TractorDriveSettings;
  private readonly tiers: readonly TractorTierConfig[];
  private readonly blocker: CircleBlocker;
  private readonly events: EventBus<GameEvents> | null;
  /** Current tier, 0-based index into `tiers`. */
  private level = 0;
  private stats: TractorTierConfig;
  /** How deep the body may still overlap the obstacles after a tier change, and how fast that shrinks. */
  private grace = 0;
  private graceRate = 0;
  private readonly resolved: XZ = { x: 0, z: 0 };

  /** `tiers`: the stats of every tier, tier 1 first; the tractor starts on tier 1. */
  constructor(settings: TractorDriveSettings, tiers: readonly TractorTierConfig[], blocker: CircleBlocker, events: EventBus<GameEvents> | null = null) {
    if (tiers.length === 0) throw new Error('TractorModel: no tiers');
    this.settings = settings;
    this.tiers = tiers;
    this.stats = tiers[0];
    this.blocker = blocker;
    this.events = events;
  }

  /** Current tier, 1-based (as `tierChanged` announces it). */
  get tier(): number {
    return this.level + 1;
  }

  get maxTier(): number {
    return this.tiers.length;
  }

  get topSpeed(): number {
    return this.stats.speed;
  }

  get bodyRadius(): number {
    return this.stats.bodyRadius;
  }

  /** Boxes that shove balls aside, in the tractor's axes (the tractor is the balls' BallPusher). */
  get pusherBoxes(): readonly PusherBox[] {
    return this.stats.pusher;
  }

  /** Inside of the current tier's bucket and how many balls it holds (the tractor carries the Bucket). */
  get bucketShape(): BucketShape {
    return this.stats.bucket;
  }

  get bucketCapacity(): number {
    return this.stats.bucketCapacity;
  }

  /** Centre of the body circle (what collides): bodyOffset ahead of the pivot. */
  get bodyX(): number {
    return this.x + Math.sin(this.yaw) * this.stats.bodyOffset;
  }

  get bodyZ(): number {
    return this.z + Math.cos(this.yaw) * this.stats.bodyOffset;
  }

  /**
   * Switches to tier `tier` (1-based, clamped to the tiers there are): the stats change, position,
   * heading and speed are kept. Announces `tierChanged` when the tier did change; returns whether it did.
   */
  setTier(tier: number): boolean {
    const level = Math.min(Math.max(Math.floor(tier), 1), this.tiers.length) - 1;
    if (level === this.level) return false;
    this.level = level;
    this.stats = this.tiers[level];
    const overlap = this.blocker.resolveCircle(this.bodyX, this.bodyZ, this.stats.bodyRadius, Blocks.Tractor, this.resolved);
    this.grace = overlap;
    this.graceRate = this.settings.swell.time > 0 ? overlap / this.settings.swell.time : Infinity;
    this.events?.emit('tierChanged', { tier: level + 1 });
    return true;
  }

  /** Puts the tractor at rest at (x, z) facing `yaw`. */
  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = wrapAngle(yaw);
    this.speed = 0;
  }

  /** Advances by `dt` seconds toward the command (inputX, inputZ): world XZ direction, length 0..1. */
  update(dt: number, inputX: number, inputZ: number): void {
    if (dt <= 0) return;
    const steps = Math.ceil(dt / this.settings.maxStep);
    const step = dt / steps;
    for (let i = 0; i < steps; i++) this.step(step, inputX, inputZ);
  }

  private step(dt: number, inputX: number, inputZ: number): void {
    const { accel, brake, turnSpeed, collisionPasses } = this.settings;
    const top = this.stats.speed;
    const amount = Math.min(1, Math.sqrt(inputX * inputX + inputZ * inputZ));

    let targetSpeed = 0;
    if (amount > 1e-4) {
      const error = wrapAngle(Math.atan2(inputX, inputZ) - this.yaw);
      // Full speed only when facing the command; nothing while it points sideways or behind.
      targetSpeed = top * amount * Math.max(0, Math.cos(error));
      // Turning is a bit sluggish when standing and sharpest at top speed.
      const maxTurn = ((turnSpeed * Math.PI) / 180) * (0.75 + (0.25 * this.speed) / top) * dt;
      this.yaw = wrapAngle(this.yaw + (error < -maxTurn ? -maxTurn : error > maxTurn ? maxTurn : error));
    }
    this.speed = this.speed < targetSpeed ? Math.min(targetSpeed, this.speed + accel * dt) : Math.max(targetSpeed, this.speed - brake * dt);

    // Move the body circle (it swings round the pivot while turning), push it out of the obstacles,
    // then put the pivot back behind it.
    const fromX = this.x;
    const fromZ = this.z;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const ahead = this.speed * dt + this.stats.bodyOffset;
    let x = fromX + forwardX * ahead;
    let z = fromZ + forwardZ * ahead;
    if (this.grace > 0) this.grace = Math.max(0, this.grace - this.graceRate * dt);
    const radius = this.stats.bodyRadius - this.grace;
    for (let pass = 0; pass < collisionPasses; pass++) {
      if (this.blocker.resolveCircle(x, z, radius, Blocks.Tractor, this.resolved) <= 0) break;
      x = this.resolved.x;
      z = this.resolved.z;
    }
    this.x = x - forwardX * this.stats.bodyOffset;
    this.z = z - forwardZ * this.stats.bodyOffset;
    const movedX = this.x - fromX;
    const movedZ = this.z - fromZ;
    this.odometer += Math.sqrt(movedX * movedX + movedZ * movedZ);
  }
}

/** Angle wrapped to [-PI, PI). */
function wrapAngle(angle: number): number {
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}
