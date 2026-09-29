/**
 * Coins on their way from where they were earned to the purse. A payout flies as a few coins sharing
 * its amount (at most `spritesPerPayout`, at most `maxAlive` in the air over the whole screen; with
 * no room left it is credited at once); each coin is credited to the purse when it arrives, so coins
 * still in the air do not count yet. Pure TypeScript: no engine imports. The coin sprites (a view of
 * the "juice" stage) draw `coins[0 .. count)` by their progress `time / duration`.
 */

import { mulberry32 } from '../balls/BallCarpet';

export interface CoinFlightSettings {
  /** Seconds a coin takes, ± jitter (share of it). */
  readonly flightTime: number;
  readonly jitter: number;
  /** Most coins one payout puts in the air, and most coins in the air at once. */
  readonly spritesPerPayout: number;
  readonly maxAlive: number;
  readonly seed: number;
}

/** Where arriving coins go (the purse). */
export interface CoinReceiver {
  add(amount: number): void;
}

/** One coin in the air (pooled: read it, do not keep it). */
export interface CoinFlight {
  /** World point it was earned at. */
  x: number;
  y: number;
  z: number;
  /** Coins it carries. */
  value: number;
  /** Seconds in the air so far, and its whole flight. */
  time: number;
  duration: number;
  /** -1..1: which side of the straight line a sprite bulges to (a payout's coins fan out). */
  lane: number;
}

export class CoinFlights {
  /** Coins in the air in coins[0 .. count); the rest of the pool is spare. */
  readonly coins: readonly CoinFlight[];

  private readonly settings: CoinFlightSettings;
  private readonly receiver: CoinReceiver;
  private readonly random: () => number;
  private readonly pool: CoinFlight[];
  private alive = 0;
  private inAir = 0;

  constructor(settings: CoinFlightSettings, receiver: CoinReceiver) {
    this.settings = settings;
    this.receiver = receiver;
    this.random = mulberry32(settings.seed);
    this.pool = [];
    for (let k = 0; k < settings.maxAlive; k++) this.pool.push({ x: 0, y: 0, z: 0, value: 0, time: 0, duration: 1, lane: 0 });
    this.coins = this.pool;
  }

  /** Coins in the air. */
  get count(): number {
    return this.alive;
  }

  /** Sum of the coins still in the air (not in the purse yet). */
  get pending(): number {
    return this.inAir;
  }

  /** Sends `amount` coins earned at world point (x, y, z) to the purse. */
  launch(amount: number, x: number, y: number, z: number): void {
    const total = Math.floor(amount);
    if (total <= 0) return;
    const s = this.settings;
    const room = Math.min(total, s.spritesPerPayout, s.maxAlive - this.alive);
    if (room <= 0) {
      this.receiver.add(total);
      return;
    }
    // Shared out evenly; the first coins carry the remainder.
    const share = Math.floor(total / room);
    let extra = total - share * room;
    for (let k = 0; k < room; k++) {
      const coin = this.pool[this.alive++];
      coin.x = x;
      coin.y = y;
      coin.z = z;
      coin.value = share + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      coin.time = 0;
      coin.lane = room === 1 ? 0.5 : (2 * k) / (room - 1) - 1;
      coin.duration = s.flightTime * (1 + s.jitter * (2 * this.random() - 1));
    }
    this.inAir += total;
  }

  /** Advances the coins; each one that arrives is credited to the purse. */
  update(dt: number): void {
    if (dt <= 0) return;
    for (let k = 0; k < this.alive; ) {
      const coin = this.pool[k];
      coin.time += dt;
      if (coin.time < coin.duration) {
        k++;
        continue;
      }
      // Arrived: swap it with the last live coin (the pool keeps its objects).
      const last = --this.alive;
      this.pool[k] = this.pool[last];
      this.pool[last] = coin;
      this.inAir -= coin.value;
      this.receiver.add(coin.value);
    }
  }
}
