/**
 * What the coins buy, in the order of the run. The gate pad is there from the start; the upgrade pad
 * is hidden until the first load is handed in to the shredder, then pops up in the carpet and throws
 * the balls under it clear. A bought upgrade pad closes (its counter reads "MAX") and the machine
 * goes up a tier (it announces `tierChanged` itself). A bought gate pad ends the run: it goes away,
 * the controls are switched off at once and the gate opens. Pure TypeScript: no engine imports.
 */

import type { EventBus, GameEvents } from '../core/Events';
import type { PayPad } from './PayPad';

export interface ProgressionSettings {
  /** The balls under a pad popping up are thrown outward (see BallField.burst). */
  readonly burst: { readonly radius: number; readonly speed: number; readonly hop: number };
}

/** The ground a pad pops up on (the ball field). */
export interface PadGround {
  burst(x: number, z: number, radius: number, speed: number, hop: number): void;
}

/** What the upgrade buys: the machine's next tier (the tractor). */
export interface Upgradable {
  /** Current tier, 1-based. */
  readonly tier: number;
  /** Goes to `tier`; false when there is no such tier. */
  setTier(tier: number): boolean;
}

/** The player's controls: switched off for good when the run is over. */
export interface ControlsLock {
  lock(): void;
}

/** What the gate pad buys: the gate, which opens (and announces the end of the run itself). */
export interface Openable {
  open(): void;
}

/** What the payments act on. */
export interface ProgressionParts {
  readonly ground: PadGround;
  readonly machine: Upgradable;
  readonly controls: ControlsLock;
  readonly gate: Openable;
}

export class Progression {
  readonly upgradePad: PayPad;
  readonly gatePad: PayPad;

  private readonly settings: ProgressionSettings;
  private readonly parts: ProgressionParts;

  constructor(settings: ProgressionSettings, upgradePad: PayPad, gatePad: PayPad, parts: ProgressionParts, events: EventBus<GameEvents>) {
    this.settings = settings;
    this.upgradePad = upgradePad;
    this.gatePad = gatePad;
    this.parts = parts;
    upgradePad.hide();
    events.on('loadHandedIn', () => {
      if (!this.upgradePad.shown && !this.upgradePad.closed) this.reveal(this.upgradePad);
    });
    events.on('padPaid', ({ padId }) => {
      if (padId === this.upgradePad.id) {
        this.upgradePad.close();
        this.parts.machine.setTier(this.parts.machine.tier + 1);
      } else if (padId === this.gatePad.id) {
        // The end of the run: no more driving, the plate and the sign shrink away, the gate opens.
        this.parts.controls.lock();
        this.gatePad.hide();
        this.parts.gate.open();
      }
    });
  }

  /** The pads land their coins and take from the purse (after the purse has been credited this frame). */
  step(dt: number): void {
    this.upgradePad.step(dt);
    this.gatePad.step(dt);
  }

  /** A hidden pad pops up among the balls. */
  private reveal(pad: PayPad): void {
    pad.show();
    const { radius, speed, hop } = this.settings.burst;
    this.parts.ground.burst(pad.x, pad.z, radius, speed, hop);
  }
}
