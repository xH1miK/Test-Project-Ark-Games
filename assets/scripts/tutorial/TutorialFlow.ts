/**
 * The tutorial's script: which step of the run the player is on (Off -> Sell -> Upgrade -> Gate ->
 * Done) and what the two markers should point at. The step is re-evaluated every frame from the world
 * (the upgrade pad shown or bought, the tier, the gate) and only ever moves forward. Where the marker
 * points follows one rule (`aimPad`): a pad that still needs coins while the purse is empty is not
 * worth going to yet, the way leads to the shredder instead (coins already in the air toward a pad do
 * not count as needed: `PayPad.missing`). Pure TypeScript: no engine imports.
 */

import type { GatePhase } from '../world/Gate';

export type TutorialStep = 'off' | 'sell' | 'upgrade' | 'gate' | 'done';
export type TutorialTargetId = 'shredder' | 'upgrade' | 'gate';

/** Something the markers point at: a point on the ground (world XZ). */
export interface TutorialTarget {
  readonly id: TutorialTargetId;
  readonly x: number;
  readonly z: number;
}

/** The player's coins. */
export interface TutorialPurse {
  readonly total: number;
}

/** A pay pad as the tutorial sees it (PayPad). */
export interface TutorialPad {
  readonly x: number;
  readonly z: number;
  readonly shown: boolean;
  readonly closed: boolean;
  /** Coins still to be taken from the purse (the price less what has landed or is in the air). */
  readonly missing: number;
}

/** The machine that gets upgraded (the tractor). */
export interface TutorialMachine {
  readonly tier: number;
  readonly maxTier: number;
}

/** The gate: the tutorial is over once it starts to open. */
export interface TutorialGate {
  readonly phase: GatePhase;
}

export interface TutorialParts {
  readonly purse: TutorialPurse;
  /** Where the hand-in zone is centred (the shredder). */
  readonly shredder: { readonly x: number; readonly z: number };
  readonly upgradePad: TutorialPad;
  readonly gatePad: TutorialPad;
  readonly machine: TutorialMachine;
  readonly gate: TutorialGate;
}

const ORDER: readonly TutorialStep[] = ['off', 'sell', 'upgrade', 'gate', 'done'];

export class TutorialFlow {
  private readonly parts: TutorialParts;
  private readonly shredderTarget: TutorialTarget;
  private readonly upgradeTarget: TutorialTarget;
  private readonly gateTarget: TutorialTarget;
  private state: TutorialStep = 'off';
  private aim: TutorialTarget | null = null;

  constructor(parts: TutorialParts) {
    this.parts = parts;
    this.shredderTarget = { id: 'shredder', x: parts.shredder.x, z: parts.shredder.z };
    this.upgradeTarget = { id: 'upgrade', x: parts.upgradePad.x, z: parts.upgradePad.z };
    this.gateTarget = { id: 'gate', x: parts.gatePad.x, z: parts.gatePad.z };
  }

  get step(): TutorialStep {
    return this.state;
  }

  /** What the markers point at now; null while the tutorial is off or done. */
  get target(): TutorialTarget | null {
    return this.aim;
  }

  /** True between `begin()` and the gate starting to open. */
  get isRunning(): boolean {
    return this.state !== 'off' && this.state !== 'done';
  }

  /** Starts the tutorial (once the player has control). */
  begin(): void {
    if (this.state !== 'off') return;
    this.state = 'sell';
    this.update();
  }

  /** Re-evaluates the step and the target from the world (call it every frame, after the pads have stepped). */
  update(): void {
    if (!this.isRunning) return;
    const { upgradePad, gatePad, machine, gate } = this.parts;
    let next: TutorialStep;
    if (gate.phase !== 'closed' || !gatePad.shown || gatePad.closed) next = 'done';
    else if (upgradePad.closed || machine.tier >= machine.maxTier) next = 'gate';
    else if (upgradePad.shown) next = 'upgrade';
    else next = 'sell';
    if (ORDER.indexOf(next) > ORDER.indexOf(this.state)) this.state = next;
    switch (this.state) {
      case 'sell':
        this.aim = this.shredderTarget;
        break;
      case 'upgrade':
        this.aim = this.aimPad(upgradePad, this.upgradeTarget);
        break;
      case 'gate':
        this.aim = this.aimPad(gatePad, this.gateTarget);
        break;
      default:
        this.aim = null;
    }
  }

  /** A pad needing coins with an empty purse is out of reach for now: go and earn some. */
  private aimPad(pad: TutorialPad, target: TutorialTarget): TutorialTarget {
    return this.parts.purse.total <= 0 && pad.missing > 0 ? this.shredderTarget : target;
  }
}
