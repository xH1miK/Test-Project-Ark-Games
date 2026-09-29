/**
 * Confetti for the finale: a pool of pieces that are fired from the two bottom corners of the screen
 * or rain from the top, tumble and flutter, and fade out. Coordinates are UI units with the origin in
 * the middle of the screen (+Y up). A pure simulation: a view (FinaleView) draws the pieces. Pure
 * TypeScript: no engine imports.
 */

import { mulberry32 } from '../balls/BallCarpet';

export interface ConfettiSettings {
  readonly count: number;
  readonly cannonShare: number;
  readonly gravity: number;
  readonly rainGravity: number;
  readonly drag: number;
  readonly speed: { readonly min: number; readonly max: number };
  readonly angle: { readonly min: number; readonly max: number };
  readonly rainDelay: number;
  readonly life: { readonly fired: number; readonly rain: number };
  readonly fade: number;
  readonly size: { readonly min: number; readonly max: number };
  readonly spin: number;
  readonly flutter: { readonly min: number; readonly max: number };
  /** The colours to pick from (the view maps a piece's index to one). */
  readonly colors: readonly string[];
  readonly seed: number;
}

/** State of a piece. */
export const PieceState = { Idle: 0, Waiting: 1, Flying: 2, Done: 3 } as const;

export class Confetti {
  readonly count: number;
  readonly state: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Rotation about the view axis, degrees. */
  readonly rot: Float32Array;
  /** Width factor 0..1 of the flutter (the strip turning edge-on), and the size factor. */
  readonly flip: Float32Array;
  readonly size: Float32Array;
  /** Index into `settings.colors`. */
  readonly color: Uint8Array;

  private readonly settings: ConfettiSettings;
  private readonly random: () => number;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly spin: Float32Array;
  private readonly phase: Float32Array;
  private readonly rate: Float32Array;
  private readonly delay: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly rain: Uint8Array;
  private floor = 0;
  private live = 0;

  constructor(settings: ConfettiSettings) {
    this.settings = settings;
    this.random = mulberry32(settings.seed);
    const n = settings.count;
    this.count = n;
    this.state = new Uint8Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.flip = new Float32Array(n).fill(1);
    this.size = new Float32Array(n).fill(1);
    this.color = new Uint8Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.rate = new Float32Array(n);
    this.delay = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.rain = new Uint8Array(n);
  }

  /** Pieces in the air right now (not waiting, not done). */
  get flying(): number {
    return this.live;
  }

  /** True while a piece is still waiting or flying. */
  get busy(): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === PieceState.Waiting || this.state[i] === PieceState.Flying) return true;
    }
    return false;
  }

  /** Opacity 0..1 of piece i: full, then fading over the last `fade` seconds of its life. */
  alpha(i: number): number {
    return Math.max(0, Math.min(1, (this.life[i] - this.age[i]) / this.settings.fade));
  }

  /** Fires the pieces for a screen `width` x `height` units big: the cannons at once, the rain over `rainDelay`. */
  burst(width: number, height: number): void {
    const s = this.settings;
    const r = this.random;
    const cannons = Math.round(s.count * s.cannonShare);
    this.floor = -height / 2 - 80;
    for (let i = 0; i < s.count; i++) {
      const fired = i < cannons;
      this.state[i] = PieceState.Waiting;
      this.rain[i] = fired ? 0 : 1;
      this.color[i] = Math.floor(r() * s.colors.length) % s.colors.length;
      this.size[i] = s.size.min + (s.size.max - s.size.min) * r();
      this.rot[i] = r() * 360;
      this.spin[i] = (r() * 2 - 1) * s.spin;
      this.phase[i] = r() * Math.PI * 2;
      this.rate[i] = s.flutter.min + (s.flutter.max - s.flutter.min) * r();
      this.flip[i] = Math.abs(Math.cos(this.phase[i]));
      this.age[i] = 0;
      if (fired) {
        // From the bottom corners toward the middle and up; the two sides alternate.
        const side = i % 2 === 0 ? -1 : 1;
        const angle = ((s.angle.min + (s.angle.max - s.angle.min) * r()) * Math.PI) / 180;
        const speed = s.speed.min + (s.speed.max - s.speed.min) * r();
        this.x[i] = side * (width / 2 - 40);
        this.y[i] = -height / 2 + 120;
        this.vx[i] = -side * Math.cos(angle) * speed;
        this.vy[i] = Math.sin(angle) * speed;
        this.delay[i] = r() * 0.12;
        this.life[i] = s.life.fired;
      } else {
        this.x[i] = (r() - 0.5) * width;
        this.y[i] = height / 2 + 40 + r() * 200;
        this.vx[i] = (r() * 2 - 1) * 120;
        this.vy[i] = -(150 + r() * 300);
        this.delay[i] = r() * s.rainDelay;
        this.life[i] = s.life.rain;
      }
    }
    this.live = 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const s = this.settings;
    const drag = Math.exp(-s.drag * dt);
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      const st = this.state[i];
      if (st === PieceState.Waiting) {
        this.delay[i] -= dt;
        if (this.delay[i] > 0) continue;
        this.state[i] = PieceState.Flying;
      } else if (st !== PieceState.Flying) {
        continue;
      }
      const gravity = this.rain[i] ? s.rainGravity : s.gravity;
      this.vx[i] *= drag;
      this.vy[i] = this.vy[i] * drag - gravity * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      this.phase[i] += this.rate[i] * dt;
      this.flip[i] = Math.abs(Math.cos(this.phase[i]));
      this.age[i] += dt;
      if (this.age[i] >= this.life[i] || this.y[i] < this.floor) {
        this.state[i] = PieceState.Done;
        continue;
      }
      live++;
    }
    this.live = live;
  }
}
