/**
 * Where the tutorial's two markers are and how they move. The path arrow floats ahead of the tractor
 * (`forward` units along its own heading, `height` above the ground) and swings round to the target at
 * a limited turn rate (the first frame after it appears it snaps); the pointer hangs over the target and
 * bobs up and down (its clock restarts on a new target). The views only apply these numbers.
 * Pure TypeScript: no engine imports.
 */

import type { TutorialTarget } from './TutorialFlow';

export interface TutorialMarkerSettings {
  readonly arrow: {
    /** How far ahead of the tractor's pivot the arrow floats, units, and how high above the ground. */
    readonly forward: number;
    readonly height: number;
    /** How fast it swings round to a new target, degrees/s. */
    readonly turnSpeed: number;
  };
  readonly pointer: {
    /** Bob amplitude, units, and one up-and-down, s. */
    readonly bob: number;
    readonly period: number;
    /** Height of the pointer's rest position over the shredder and over a pad, units. */
    readonly shredderHeight: number;
    readonly padHeight: number;
  };
}

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export class TutorialMarkers {
  /** The path arrow: shown, where (world), and its heading about +Y in radians (forward = (sin yaw, cos yaw)). */
  arrowShown = false;
  arrowX = 0;
  arrowY = 0;
  arrowZ = 0;
  arrowYaw = 0;
  /** The pointer over the target: shown, and where (world). */
  pointerShown = false;
  pointerX = 0;
  pointerY = 0;
  pointerZ = 0;

  private readonly settings: TutorialMarkerSettings;
  private aimed: string | null = null;
  private pointerTime = 0;

  constructor(settings: TutorialMarkerSettings) {
    this.settings = settings;
  }

  /** Moves the markers for `dt` seconds: `anchorX/anchorZ` is the tractor's pivot, `target` what to point at (null hides both). */
  update(dt: number, anchorX: number, anchorZ: number, target: TutorialTarget | null): void {
    if (!target) {
      this.arrowShown = false;
      this.pointerShown = false;
      this.aimed = null;
      return;
    }
    const { arrow, pointer } = this.settings;
    const dx = target.x - anchorX;
    const dz = target.z - anchorZ;
    // Right after the markers appear the arrow already faces the target, it does not swing to it.
    const first = !this.arrowShown;
    if (dx * dx + dz * dz >= 1e-4) {
      const want = Math.atan2(dx, dz);
      if (first || arrow.turnSpeed <= 0) this.arrowYaw = want;
      else {
        const diff = wrapAngle(want - this.arrowYaw);
        const limit = arrow.turnSpeed * DEG * Math.max(dt, 0);
        this.arrowYaw = wrapAngle(this.arrowYaw + (Math.abs(diff) <= limit ? diff : Math.sign(diff) * limit));
      }
    } else if (first) this.arrowYaw = 0;
    this.arrowShown = true;
    this.arrowX = anchorX + Math.sin(this.arrowYaw) * arrow.forward;
    this.arrowY = arrow.height;
    this.arrowZ = anchorZ + Math.cos(this.arrowYaw) * arrow.forward;

    if (target.id !== this.aimed) {
      this.aimed = target.id;
      this.pointerTime = 0;
    }
    this.pointerTime += Math.max(dt, 0);
    const height = target.id === 'shredder' ? pointer.shredderHeight : pointer.padHeight;
    this.pointerShown = true;
    this.pointerX = target.x;
    this.pointerY = height + Math.sin((this.pointerTime * TWO_PI) / pointer.period) * pointer.bob;
    this.pointerZ = target.z;
  }
}

/** Wraps an angle to (-PI, PI]. */
function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TWO_PI;
  if (r <= 0) r += TWO_PI;
  return r - Math.PI;
}
