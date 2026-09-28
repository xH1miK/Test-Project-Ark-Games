/**
 * The player's coins. Starts empty; coins are added when they arrive (CoinFlights) and spent on pay
 * pads. Every change is announced with `purseChanged`, which the coin counter shows.
 * Pure TypeScript: no engine imports.
 */

import type { EventBus, GameEvents } from '../core/Events';

export class Purse {
  private readonly events: EventBus<GameEvents> | null;
  private coins = 0;

  constructor(events: EventBus<GameEvents> | null = null) {
    this.events = events;
  }

  get total(): number {
    return this.coins;
  }

  /** Adds whole coins (anything below 1 is ignored). */
  add(amount: number): void {
    const n = Math.floor(amount);
    if (n <= 0) return;
    this.coins += n;
    this.events?.emit('purseChanged', { total: this.coins, delta: n });
  }

  /** Takes up to `amount` whole coins, as many as there are; returns how many were taken. */
  spend(amount: number): number {
    const n = Math.min(Math.floor(amount), this.coins);
    if (n <= 0) return 0;
    this.coins -= n;
    this.events?.emit('purseChanged', { total: this.coins, delta: -n });
    return n;
  }
}
