/**
 * How fast a price streams off the purse onto a pay pad: the first coin goes at once, then one every
 * `interval` seconds, speeding up evenly so that the whole amount has gone within `window` seconds
 * (a big price fills as fast as a small one). Its clock only runs while coins are paid: a pad
 * waiting for coins holds it, a tractor leaving the pad stops it.
 * Pure TypeScript: no engine imports.
 */
export class PayPace {
  private total = 0;
  private given = 0;
  private time = 0;
  private rate = 0;
  private accel = 0;

  /** True from start() until the whole amount has gone or stop(). */
  get running(): boolean {
    return this.given < this.total;
  }

  /** Coins reported as gone since start(). */
  get paid(): number {
    return this.given;
  }

  /** Starts paying `amount` whole coins: the first at once, the last within `window` seconds. */
  start(amount: number, interval: number, window: number): void {
    this.total = Math.max(0, Math.floor(amount));
    this.given = 0;
    this.time = 0;
    this.rate = interval > 0 ? 1 / interval : 1e9;
    // Coins due by time t: 1 + rate·t + accel·t²/2; the acceleration brings it to `total` at `window`.
    const w = Math.max(window, 1e-3);
    const late = this.total - 1 - this.rate * w;
    this.accel = late > 0 ? (2 * late) / (w * w) : 0;
  }

  /** Runs the clock `dt` seconds on; returns how many more coins may go now (report them with took()). */
  due(dt: number): number {
    if (!this.running) return 0;
    this.time += Math.max(0, dt);
    const t = this.time;
    const by = Math.min(this.total, Math.floor(1 + this.rate * t + 0.5 * this.accel * t * t + 1e-9));
    return Math.max(0, by - this.given);
  }

  /** Reports coins that went (fewer than due when the purse ran short: they are due on the next call). */
  took(n: number): void {
    this.given += Math.max(0, Math.floor(n));
  }

  stop(): void {
    this.total = 0;
    this.given = 0;
    this.time = 0;
  }
}
