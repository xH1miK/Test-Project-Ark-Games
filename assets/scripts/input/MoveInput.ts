/**
 * The drive command of the current frame: the desired direction on the ground (world XZ), length 0..1.
 * Normally it is the joystick read relative to the camera, so pushing the stick up drives away from
 * the camera whatever way the world is turned. An autopilot (QA scenarios) can take over.
 * Pure TypeScript: no engine imports.
 */
export class MoveInput {
  x = 0;
  z = 0;
  private overridden = false;
  private locked = false;

  get isOverridden(): boolean {
    return this.overridden;
  }

  /** True once the controls are off for good (the run is over). */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Switches the controls off for good: the drive command is zero from now on, from the joystick and
   * from an autopilot alike (the tractor brakes to a stop). This is the only place that does it.
   */
  lock(): void {
    this.locked = true;
    this.x = 0;
    this.z = 0;
  }

  /**
   * Stick reading (x right, y up) seen through a camera turned by `cameraYawDeg` about +Y.
   * Ignored while an override is active or the controls are locked.
   */
  setFromStick(stickX: number, stickY: number, cameraYawDeg: number): void {
    if (this.overridden || this.locked) return;
    const yaw = (cameraYawDeg * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // On the ground the camera's right is (cos, -sin) and "away from the camera" is (-sin, -cos).
    this.x = stickX * cos - stickY * sin;
    this.z = -stickX * sin - stickY * cos;
  }

  /** Autopilot: drive toward world direction (x, z) until release(); longer than 1 is cut to 1. */
  override(x: number, z: number): void {
    this.overridden = true;
    if (this.locked) return;
    const length = Math.sqrt(x * x + z * z);
    const scale = length > 1 ? 1 / length : 1;
    this.x = x * scale;
    this.z = z * scale;
  }

  /** Hands control back to the joystick. */
  release(): void {
    this.overridden = false;
    this.x = 0;
    this.z = 0;
  }
}
