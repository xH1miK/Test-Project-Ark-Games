/**
 * Tractor movement on the XZ plane: turns toward the commanded direction, speeds up and brakes,
 * slows down while turning (tank-like), and slides along static obstacles as a circle.
 * No physics engine: explicit kinematics (Unity analogy: a CharacterController driven by hand).
 * Pure TypeScript: no engine imports.
 */

import type { TractorTierConfig } from '../core/Config';
import { Blocks } from '../world/ObstacleGrid';
import type { XZ } from '../world/ObstacleGrid';

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
}

/** What stops the tractor (ObstacleGrid implements it). */
export interface CircleBlocker {
  /** Pushes a circle out of what blocks `mask`; writes the corrected centre to `out`, returns the push distance. */
  resolveCircle(x: number, z: number, radius: number, mask: number, out: XZ): number;
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
  private readonly blocker: CircleBlocker;
  private tier: TractorTierConfig;
  private readonly resolved: XZ = { x: 0, z: 0 };

  constructor(settings: TractorDriveSettings, tier: TractorTierConfig, blocker: CircleBlocker) {
    this.settings = settings;
    this.tier = tier;
    this.blocker = blocker;
  }

  get topSpeed(): number {
    return this.tier.speed;
  }

  get bodyRadius(): number {
    return this.tier.bodyRadius;
  }

  /** Switches the stats (tractor upgrade); position and heading are kept. */
  setTier(tier: TractorTierConfig): void {
    this.tier = tier;
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
    const top = this.tier.speed;
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

    const fromX = this.x;
    const fromZ = this.z;
    let x = fromX + Math.sin(this.yaw) * this.speed * dt;
    let z = fromZ + Math.cos(this.yaw) * this.speed * dt;
    for (let pass = 0; pass < collisionPasses; pass++) {
      if (this.blocker.resolveCircle(x, z, this.tier.bodyRadius, Blocks.Tractor, this.resolved) <= 0) break;
      x = this.resolved.x;
      z = this.resolved.z;
    }
    this.x = x;
    this.z = z;
    this.odometer += Math.sqrt((x - fromX) * (x - fromX) + (z - fromZ) * (z - fromZ));
  }
}

/** Angle wrapped to [-PI, PI). */
function wrapAngle(angle: number): number {
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}
