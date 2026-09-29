/**
 * Follow camera: a fixed isometric angle, the position trailing the target with critically damped
 * smoothing (Unity analogy: Vector3.SmoothDamp), and a timed zoom along the offset (tier upgrades).
 * Pure TypeScript: no engine imports.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraRigSettings {
  /** Camera position relative to the focus point at zoom 1. */
  readonly offset: Readonly<Vec3Like>;
  /** Fixed view angles, degrees (Cocos Euler: pitch about X, yaw about Y). */
  readonly pitch: number;
  readonly yaw: number;
  /** Follow smoothing time, s: roughly how long the camera takes to catch up. */
  readonly smoothTime: number;
  /**
   * Framing by screen shape: the vertical field of view is fixed, so a narrow screen sees little
   * across and a wide one little up and down. The offset is scaled by (ref / aspect) ^ power, kept
   * within [min, max]: further out on a tall phone, closer on a wide one.
   */
  readonly aspect?: { readonly ref: number; readonly power: number; readonly min: number; readonly max: number };
}

/** A look-away beat: the camera leans toward a point and pulls out, holds, then comes back. */
export interface PeekSettings {
  /** How far toward the point the focus goes (0 = not at all, 1 = onto it). */
  readonly share: number;
  /** Extra zoom-out at the height of the beat (1 = none). */
  readonly zoom: number;
  readonly inTime: number;
  /** Seconds it stays; Infinity = for good (the end of the run). */
  readonly holdTime: number;
  readonly outTime: number;
}

type Axis = 'x' | 'y' | 'z';

export class CameraRigModel {
  /** Camera position. */
  readonly position: Vec3Like = { x: 0, y: 0, z: 0 };
  /** The point the camera looks at: the followed target, smoothed. */
  readonly focus: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Offset multiplier of the tier: 1 = the design framing, larger = further out. */
  zoom = 1;
  /** Offset multiplier of the screen shape (setAspect) and of a look-away beat in progress. */
  framing = 1;
  boost = 1;

  private readonly settings: CameraRigSettings;
  private readonly velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  private zoomFrom = 1;
  private zoomTarget = 1;
  private zoomDuration = 0;
  private zoomElapsed = 0;
  private peekSettings: PeekSettings | null = null;
  private peekX = 0;
  private peekZ = 0;
  private peekElapsed = 0;
  private started = 0;

  constructor(settings: CameraRigSettings) {
    this.settings = settings;
  }

  get pitch(): number {
    return this.settings.pitch;
  }

  get yaw(): number {
    return this.settings.yaw;
  }

  /** Jumps straight to the target, no smoothing (start of the game). */
  snap(x: number, y: number, z: number): void {
    this.focus.x = x;
    this.focus.y = y;
    this.focus.z = z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.place();
  }

  /** Eases the zoom to `factor` over `duration` seconds (smoothstep); 0 = at once. */
  zoomTo(factor: number, duration: number): void {
    this.zoomFrom = this.zoom;
    this.zoomTarget = factor;
    this.zoomDuration = Math.max(duration, 0);
    this.zoomElapsed = 0;
    if (this.zoomDuration === 0) this.zoom = factor;
  }

  /** Frames for a screen of this width / height. */
  setAspect(aspect: number): void {
    const a = this.settings.aspect;
    if (!a || !(aspect > 0)) return;
    this.framing = Math.min(a.max, Math.max(a.min, Math.pow(a.ref / aspect, a.power)));
  }

  /** Starts a look-away beat toward the ground point (x, z); a new one replaces the one in progress. */
  peek(x: number, z: number, settings: PeekSettings): void {
    this.peekSettings = settings;
    this.peekX = x;
    this.peekZ = z;
    this.peekElapsed = 0;
    this.started++;
  }

  /** How many beats were started so far (QA checks read it). */
  get peeksStarted(): number {
    return this.started;
  }

  /** 0..1: how far the beat in progress has taken the camera (0 = none). */
  get peekWeight(): number {
    const p = this.peekSettings;
    if (!p) return 0;
    const t = this.peekElapsed;
    const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
    if (t < p.inTime) return ease(t / p.inTime);
    if (t < p.inTime + p.holdTime) return 1;
    return ease(1 - (t - p.inTime - p.holdTime) / p.outTime);
  }

  /** Follows the target (x, y, z) for `dt` seconds. */
  update(dt: number, x: number, y: number, z: number): void {
    const p = this.peekSettings;
    if (p && dt > 0) {
      this.peekElapsed += dt;
      if (this.peekElapsed >= p.inTime + p.holdTime + p.outTime) this.peekSettings = null;
    }
    const w = this.peekWeight;
    const share = p ? p.share * w : 0;
    this.boost = 1 + (p ? (p.zoom - 1) * w : 0);
    if (share > 0) {
      x += (this.peekX - x) * share;
      z += (this.peekZ - z) * share;
    }
    if (dt > 0) {
      const omega = 2 / this.settings.smoothTime;
      const k = omega * dt;
      const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
      this.follow('x', x, omega, dt, decay);
      this.follow('y', y, omega, dt, decay);
      this.follow('z', z, omega, dt, decay);
      if (this.zoomElapsed < this.zoomDuration) {
        this.zoomElapsed = Math.min(this.zoomElapsed + dt, this.zoomDuration);
        const t = this.zoomElapsed / this.zoomDuration;
        this.zoom = this.zoomFrom + (this.zoomTarget - this.zoomFrom) * t * t * (3 - 2 * t);
      }
    }
    this.place();
  }

  /** One axis of the critically damped spring (Game Programming Gems 4, 1.10). */
  private follow(axis: Axis, target: number, omega: number, dt: number, decay: number): void {
    const change = this.focus[axis] - target;
    const temp = (this.velocity[axis] + omega * change) * dt;
    this.velocity[axis] = (this.velocity[axis] - omega * temp) * decay;
    this.focus[axis] = target + (change + temp) * decay;
  }

  private place(): void {
    const { offset } = this.settings;
    const k = this.zoom * this.framing * this.boost;
    this.position.x = this.focus.x + offset.x * k;
    this.position.y = this.focus.y + offset.y * k;
    this.position.z = this.focus.z + offset.z * k;
  }
}
