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
  /** 1 while the joystick is on; fades to 0 after disable() (the view multiplies its opacity by it). */
  visibility = 1;

  private readonly settings: JoystickSettings;
  private readonly rest: Vec2Like = { x: 0, y: 0 };
  private halfWidth = 0;
  private halfHeight = 0;
  /** Gaps of the safe area inside the touch area (a cut-out, a home indicator): the rest point and the base stay inside them. */
  private readonly insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private held = false;
  private enabled = true;

  constructor(settings: JoystickSettings) {
    this.settings = settings;
  }

  get isHeld(): boolean {
    return this.held;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Switches the stick off for good (the run is over): the finger is let go, new touches do nothing, the picture fades away. */
  disable(): void {
    this.enabled = false;
    this.release();
  }

  /** Size of the touch area (on start and on every resize). A released base jumps to the new rest point. */
  setArea(width: number, height: number): void {
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.layout();
  }

  /**
   * The gaps between the touch area's edges and the safe area (design units). The rest point is centred in the safe
   * area and lifted above the bottom gap; a touch never puts the base nearer to the safe area's edge than `edgeMargin`.
   */
  setInsets(left: number, right: number, top: number, bottom: number): void {
    this.insets.left = left;
    this.insets.right = right;
    this.insets.top = top;
    this.insets.bottom = bottom;
    this.layout();
  }

  private layout(): void {
    const { left, right, top, bottom } = this.insets;
    this.rest.x = (left - right) / 2;
    this.rest.y = Math.min(-this.halfHeight + bottom + this.settings.restHeight, this.halfHeight - top);
    if (!this.held) {
      this.base.x = this.rest.x;
      this.base.y = this.rest.y;
    }
  }

  /** A finger went down at (x, y). Outside the base the base jumps under the finger. */
  press(x: number, y: number): void {
    if (!this.enabled) return;
    this.held = true;
    this.engaged = 1;
    const dx = x - this.base.x;
    const dy = y - this.base.y;
    if (dx * dx + dy * dy > this.settings.radius * this.settings.radius) {
      const { edgeMargin } = this.settings;
      const { left, right, top, bottom } = this.insets;
      this.base.x = clampBetween(x, -this.halfWidth + left, this.halfWidth - right, edgeMargin);
      this.base.y = clampBetween(y, -this.halfHeight + bottom, this.halfHeight - top, edgeMargin);
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
    if (!this.enabled) this.visibility = this.visibility < 0.004 ? 0 : this.visibility - this.visibility * k;
    this.base.x += (this.rest.x - this.base.x) * k;
    this.base.y += (this.rest.y - this.base.y) * k;
    this.knob.x -= this.knob.x * k;
    this.knob.y -= this.knob.y * k;
    this.engaged -= this.engaged * k;
  }
}

/** Value kept `margin` inside [low, high]; when the range is narrower than that, its middle. */
function clampBetween(value: number, low: number, high: number, margin: number): number {
  const lo = low + margin;
  const hi = high - margin;
  if (lo > hi) return (low + high) / 2;
  return value < lo ? lo : value > hi ? hi : value;
}
