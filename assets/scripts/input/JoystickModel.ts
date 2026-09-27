/**
 * Floating virtual joystick, pure state: where the base and the knob are and what the stick reads.
 * Coordinates are UI units in the touch area's local space (origin at the area centre, +Y up).
 * JoystickView feeds it touches and draws it (Unity analogy: the logic of an on-screen stick,
 * without the rendering). Pure TypeScript: no engine imports.
 */

export interface JoystickSettings {
  /** Base radius: the knob travels this far at full deflection. */
  readonly radius: number;
  /** Stick readings below this fraction of the radius count as zero. */
  readonly deadZone: number;
  /** Rest point: this far above the bottom edge of the area, horizontally centred. */
  readonly restHeight: number;
  /** A touch never puts the base centre closer than this to an edge of the area. */
  readonly edgeMargin: number;
  /** After release the base glides back to rest over about this time, s. */
  readonly returnTime: number;
}

export interface Vec2Like {
  x: number;
  y: number;
}

export class JoystickModel {
  /** Stick reading: x right, y up; length 0..1 after the dead zone. */
  readonly stick: Vec2Like = { x: 0, y: 0 };
  /** Base centre. */
  readonly base: Vec2Like = { x: 0, y: 0 };
  /** Knob offset from the base centre, length <= radius. */
  readonly knob: Vec2Like = { x: 0, y: 0 };
  /** 1 while held; fades to 0 as the joystick glides back to rest (the view maps it to opacity). */
  engaged = 0;

  private readonly settings: JoystickSettings;
  private readonly rest: Vec2Like = { x: 0, y: 0 };
  private halfWidth = 0;
  private halfHeight = 0;
  private held = false;

  constructor(settings: JoystickSettings) {
    this.settings = settings;
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** Size of the touch area (on start and on every resize). A released base jumps to the new rest point. */
  setArea(width: number, height: number): void {
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.rest.x = 0;
    this.rest.y = Math.min(-this.halfHeight + this.settings.restHeight, this.halfHeight);
    if (!this.held) {
      this.base.x = this.rest.x;
      this.base.y = this.rest.y;
    }
  }

  /** A finger went down at (x, y). Outside the base the base jumps under the finger. */
  press(x: number, y: number): void {
    this.held = true;
    this.engaged = 1;
    const dx = x - this.base.x;
    const dy = y - this.base.y;
    if (dx * dx + dy * dy > this.settings.radius * this.settings.radius) {
      this.base.x = clampToEdges(x, this.halfWidth, this.settings.edgeMargin);
      this.base.y = clampToEdges(y, this.halfHeight, this.settings.edgeMargin);
    }
    this.drag(x, y);
  }

  /** The held finger moved to (x, y). */
  drag(x: number, y: number): void {
    if (!this.held) return;
    const { radius, deadZone } = this.settings;
    let dx = x - this.base.x;
    let dy = y - this.base.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > radius) {
      dx *= radius / length;
      dy *= radius / length;
    }
    this.knob.x = dx;
    this.knob.y = dy;
    // Radial dead zone, rescaled so the reading grows from 0 right at its edge.
    const amount = Math.min(length, radius) / radius;
    const scaled = amount <= deadZone ? 0 : (amount - deadZone) / (1 - deadZone);
    this.stick.x = amount > 0 ? (dx / radius / amount) * scaled : 0;
    this.stick.y = amount > 0 ? (dy / radius / amount) * scaled : 0;
  }

  /** The finger went up (or the touch was cancelled). */
  release(): void {
    this.held = false;
    this.stick.x = 0;
    this.stick.y = 0;
  }

  /** Glide back to rest while released. */
  update(dt: number): void {
    if (this.held) return;
    // Exponential approach: about 95% of the way after returnTime.
    const k = 1 - Math.exp((-3 * dt) / Math.max(this.settings.returnTime, 1e-6));
    this.base.x += (this.rest.x - this.base.x) * k;
    this.base.y += (this.rest.y - this.base.y) * k;
    this.knob.x -= this.knob.x * k;
    this.knob.y -= this.knob.y * k;
    this.engaged -= this.engaged * k;
  }
}

function clampToEdges(value: number, half: number, margin: number): number {
  const limit = Math.max(half - margin, 0);
  return value < -limit ? -limit : value > limit ? limit : value;
}
