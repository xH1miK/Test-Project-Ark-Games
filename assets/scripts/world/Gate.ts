/**
 * The gate at the end of the run: closed until its pad is paid, then it opens for `openTime` seconds
 * (the force-field curtain holds for the first `hold` share, then folds away) and announces
 * `gateOpened`. A pure clock with two curves the view maps to what it draws (Unity analogy: the
 * state and the animation curve of a door, without the Animator). Pure TypeScript: no engine imports.
 */

import type { EventBus, GameEvents } from '../core/Events';

export interface GateSettings {
  /** How long the opening takes, s. */
  readonly openTime: number;
  /** Share of the opening the curtain holds before it starts to fold (0..1). */
  readonly hold: number;
}

export type GatePhase = 'closed' | 'opening' | 'open';

export class Gate {
  readonly id: string;

  private readonly settings: GateSettings;
  private readonly events: EventBus<GameEvents> | null;
  private state: GatePhase = 'closed';
  private elapsed = 0;

  constructor(id: string, settings: GateSettings, events: EventBus<GameEvents> | null = null) {
    this.id = id;
    this.settings = settings;
    this.events = events;
  }

  get phase(): GatePhase {
    return this.state;
  }

  /** Share of the opening time gone: 0 closed, 1 open. */
  get progress(): number {
    if (this.state === 'closed') return 0;
    return Math.min(1, this.elapsed / this.settings.openTime);
  }

  /** How far the curtain has folded away: 0 during the hold, then a smoothstep to 1. */
  get fold(): number {
    const { hold } = this.settings;
    const s = Math.min(1, Math.max(0, (this.progress - hold) / (1 - hold)));
    return s * s * (3 - 2 * s);
  }

  /** The sparks' flash: rises and falls once over the opening, 0 when closed and when open. */
  get flash(): number {
    return this.state === 'opening' ? Math.sin(Math.PI * this.progress) : 0;
  }

  /** Starts opening; nothing happens unless it is closed. */
  open(): void {
    if (this.state !== 'closed') return;
    this.state = 'opening';
    this.elapsed = 0;
    this.events?.emit('gateOpening', { padId: this.id });
  }

  step(dt: number): void {
    if (this.state !== 'opening' || dt <= 0) return;
    this.elapsed += dt;
    if (this.elapsed < this.settings.openTime) return;
    this.state = 'open';
    this.events?.emit('gateOpened', { padId: this.id });
  }
}
