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
}

type Axis = 'x' | 'y' | 'z';

export class CameraRigModel {
  /** Camera position. */
  readonly position: Vec3Like = { x: 0, y: 0, z: 0 };
  /** The point the camera looks at: the followed target, smoothed. */
  readonly focus: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Offset multiplier: 1 = the design framing, larger = further out. */
  zoom = 1;

  private readonly settings: CameraRigSettings;
  private readonly velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  private zoomFrom = 1;
  private zoomTarget = 1;
  private zoomDuration = 0;
  private zoomElapsed = 0;

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

  /** Follows the target (x, y, z) for `dt` seconds. */
  update(dt: number, x: number, y: number, z: number): void {
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
    this.position.x = this.focus.x + offset.x * this.zoom;
    this.position.y = this.focus.y + offset.y * this.zoom;
    this.position.z = this.focus.z + offset.z * this.zoom;
  }
}
