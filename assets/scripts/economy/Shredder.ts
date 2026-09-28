/**
 * The shredder, where balls become coins. Pure TypeScript: no engine imports.
 *
 * Hand-in: while the tractor's pivot is inside the square zone around the shredder, the bucket hands
 * over its whole load at once and every ball flies into the shredder in an arc. Throat: free balls
 * shoved into the box around the shredder go down into its mouth as well. Every ball pays when it
 * lands inside (`ballsShredded`, `coinsEarned` at the shredder's top, coins per ball); the purse is
 * credited later, when the coins arrive (CoinFlights). The rollers turn while the shredder is fed.
 * Where it stands comes from the scene (GameRoot reads the Level/Shredder node).
 */

import type { EventBus, GameEvents } from '../core/Events';
import { mulberry32 } from '../balls/BallCarpet';
import { BallFlights } from '../balls/BallFlights';
import type { FlightField } from '../balls/BallFlights';

export interface ShredderSettings {
  /** Half size of the square hand-in zone (world axes) the visitor's pivot has to be in. */
  readonly zoneHalf: number;
  /** The load's flight: seconds (× 1 .. 1 + stagger), hop, aim above the pivot, scatter (world X/Z). */
  readonly handIn: { readonly time: number; readonly stagger: number; readonly arc: number; readonly aimHeight: number; readonly spread: number };
  /** The throat box (shredder axes; from `depth` below to `height` above the pivot) and the way down into the mouth. */
  readonly throat: {
    readonly halfX: number; readonly halfZ: number; readonly height: number; readonly depth: number;
    readonly mouthHeight: number; readonly spread: number; readonly time: number; readonly arc: number;
  };
  /** Rollers: full speed (degrees/s), seconds to spin up and down, how long a feed keeps them turning. */
  readonly rollers: { readonly speed: number; readonly spinUp: number; readonly spinDown: number; readonly coast: number };
  readonly seed: number;
  /** Coins one shredded ball pays. */
  readonly coinsPerBall: number;
}

/** Where the shredder stands: its pivot and heading about +Y (Cocos convention: local +Z points to (sin yaw, cos yaw)). */
export interface ShredderPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** The load the shredder takes (the bucket): hands over all its balls, which stay held where they are. */
export interface ShredderLoad {
  readonly count: number;
  unloadAll(out: Int32Array): number;
}

/** Who brings the load (the tractor): its pivot on the ground. */
export interface ShredderVisitor {
  readonly x: number;
  readonly z: number;
}

/** The ball field as the shredder sees it. */
export interface ShredderField extends FlightField {
  readonly capacity: number;
  findFree(minX: number, maxX: number, minZ: number, maxZ: number, out: Int32Array): number;
  hold(i: number): void;
}

/** Most free balls looked at in the throat's cells per step. */
const MAX_CANDIDATES = 256;

export class Shredder {
  /** The balls on their way in. */
  readonly flights: BallFlights;
  /** Balls taken from the bucket, swallowed by the throat, and shredded (landed) so far. */
  handedIn = 0;
  swallowed = 0;
  shredded = 0;
  /** Roller turn so far, radians (wrapped), and their speed as a share of full speed (0..1). */
  rollerAngle = 0;
  rollerSpeed = 0;

  private readonly settings: ShredderSettings;
  private readonly pose: ShredderPose;
  private readonly field: ShredderField;
  private readonly load: ShredderLoad;
  private readonly visitor: ShredderVisitor;
  private readonly events: EventBus<GameEvents> | null;
  private readonly random: () => number;
  private readonly cos: number;
  private readonly sin: number;
  /** Where the load is aimed (and the coins start from). */
  private readonly aimX: number;
  private readonly aimY: number;
  private readonly aimZ: number;
  private readonly handedOver: Int32Array;
  private readonly candidates = new Int32Array(MAX_CANDIDATES);
  /** Seconds the rollers keep being fed. */
  private feed = 0;

  constructor(settings: ShredderSettings, pose: ShredderPose, field: ShredderField, load: ShredderLoad, visitor: ShredderVisitor,
    events: EventBus<GameEvents> | null = null) {
    this.settings = settings;
    this.pose = pose;
    this.field = field;
    this.load = load;
    this.visitor = visitor;
    this.events = events;
    this.random = mulberry32(settings.seed);
    this.cos = Math.cos(pose.yaw);
    this.sin = Math.sin(pose.yaw);
    this.aimX = pose.x;
    this.aimY = pose.y + settings.handIn.aimHeight;
    this.aimZ = pose.z;
    this.flights = new BallFlights(field, field.capacity);
    this.handedOver = new Int32Array(field.capacity);
  }

  /** True while the visitor's pivot is inside the hand-in zone. */
  get inZone(): boolean {
    const half = this.settings.zoneHalf;
    return Math.abs(this.visitor.x - this.pose.x) <= half && Math.abs(this.visitor.z - this.pose.z) <= half;
  }

  /** Balls in the air on their way in. */
  get inFlight(): number {
    return this.flights.count;
  }

  /**
   * One step (after the bucket carried its load): takes the load in the zone, swallows what is in the
   * throat, moves the flights and pays for the balls that landed.
   */
  step(dt: number): void {
    if (dt <= 0) return;
    if (this.load.count > 0 && this.inZone) this.takeLoad();
    this.swallowThroat();
    const landed = this.flights.step(dt);
    if (landed > 0) {
      this.shredded += landed;
      this.events?.emit('ballsShredded', { count: landed });
      this.events?.emit('coinsEarned', { amount: landed * this.settings.coinsPerBall, x: this.aimX, y: this.aimY, z: this.aimZ });
    }
    this.turnRollers(dt, this.flights.count > 0 || landed > 0);
  }

  /** The whole load flies in: each ball in its own arc and time, aimed at the shredder's top. */
  private takeLoad(): void {
    const n = this.load.unloadAll(this.handedOver);
    const { time, stagger, arc, spread } = this.settings.handIn;
    for (let k = 0; k < n; k++) {
      const i = this.handedOver[k];
      this.flights.launch(i, this.aimX + this.scatter(spread), this.aimY, this.aimZ + this.scatter(spread), time * (1 + stagger * this.random()), arc);
    }
    this.handedIn += n;
    if (n > 0) this.events?.emit('loadHandedIn', { count: n });
  }

  /** Free balls inside the throat box go down into the mouth. */
  private swallowThroat(): void {
    const { halfX, halfZ, height, depth, mouthHeight, spread, time, arc } = this.settings.throat;
    const { x: px, y: py, z: pz } = this.pose;
    const cos = this.cos;
    const sin = this.sin;
    // The box's bounding rectangle in the world.
    const ex = Math.abs(cos) * halfX + Math.abs(sin) * halfZ;
    const ez = Math.abs(sin) * halfX + Math.abs(cos) * halfZ;
    const found = this.field.findFree(px - ex, px + ex, pz - ez, pz + ez, this.candidates);
    if (found === 0) return;
    const { x, y, z } = this.field;
    const top = py + height;
    const bottom = py - depth;
    let taken = 0;
    for (let k = 0; k < found; k++) {
      const i = this.candidates[k];
      if (y[i] > top || y[i] < bottom) continue;
      const dx = x[i] - px;
      const dz = z[i] - pz;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (lx < -halfX || lx > halfX || lz < -halfZ || lz > halfZ) continue;
      this.field.hold(i);
      this.flights.launch(i, px + this.scatter(spread), py + mouthHeight, pz + this.scatter(spread), time, arc);
      taken++;
    }
    this.swallowed += taken;
  }

  /** The rollers spin up while fed (and `coast` seconds after), then wind down. */
  private turnRollers(dt: number, fed: boolean): void {
    const { speed, spinUp, spinDown, coast } = this.settings.rollers;
    if (fed) this.feed = coast;
    else if (this.feed > 0) this.feed -= dt;
    const target = this.feed > 0 ? 1 : 0;
    const rate = dt / (target > this.rollerSpeed ? spinUp : spinDown);
    const gap = target - this.rollerSpeed;
    this.rollerSpeed = Math.abs(gap) <= rate ? target : this.rollerSpeed + (gap > 0 ? rate : -rate);
    const TWO_PI = 2 * Math.PI;
    const angle = this.rollerAngle + ((this.rollerSpeed * speed * Math.PI) / 180) * dt;
    this.rollerAngle = angle - TWO_PI * Math.floor(angle / TWO_PI);
  }

  /** A random offset in [-half, half]. */
  private scatter(half: number): number {
    return (2 * this.random() - 1) * half;
  }
}
