/**
 * A pay pad: while the tractor's pivot is inside the square zone around it, coins stream from the
 * purse onto the pad (PayPace: the first at once, faster and faster) until its price is met. A
 * partial payment is kept when the tractor drives off. Coins fly for a while (CoinFlights with the
 * pad as the receiver, what the "juice" stage draws) and count on the pad when they land, so its
 * counter (`owed`) ticks down as they arrive. A hidden or closed pad takes nothing; while it takes
 * coins, balls are kept off its plate (`clearZone`). Pure TypeScript: no engine imports.
 */

import type { ClearZone } from '../balls/BallField';
import type { EventBus, GameEvents } from '../core/Events';
import { CoinFlights } from './CoinFlights';
import type { CoinFlightSettings, CoinReceiver } from './CoinFlights';
import { PayPace } from './PayPace';

export interface PayPadSettings {
  /** Half size of the square zone (world axes) the visitor's pivot has to be in. */
  readonly zoneHalf: number;
  /** The whole remaining price leaves the purse within this time, s. */
  readonly fillTime: number;
  /** Seconds between the first coins (the stream speeds up from there). */
  readonly interval: number;
  /** A ball on the plate rolls off it at least this fast, units/s. */
  readonly clearSpeed: number;
}

/** Where the coins come from (the purse). */
export interface CoinSource {
  readonly total: number;
  spend(amount: number): number;
}

/** Who pays (the tractor): its pivot on the ground. */
export interface PadVisitor {
  readonly x: number;
  readonly z: number;
}

/** A rectangle on the ground, world XZ. */
export interface GroundRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PayPadOptions {
  /** Shown from the start (default true); a hidden pad appears with show(). */
  readonly shown?: boolean;
  /** The plate on the ground balls are kept off while the pad takes coins; none by default. */
  readonly plate?: GroundRect | null;
}

export class PayPad implements CoinReceiver {
  readonly id: string;
  /** Where it stands: the middle of its zone, where the coins land. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly price: number;
  /** Coins on their way from the purse (the pad receives them as they land). */
  readonly flights: CoinFlights;
  /** The plate as a zone balls are kept off while the pad takes coins (a zero rect if it has no plate). */
  readonly clearZone: ClearZone;
  /** Coins that have landed on the pad. */
  stored = 0;

  private readonly settings: PayPadSettings;
  private readonly source: CoinSource;
  private readonly visitor: PadVisitor;
  private readonly events: EventBus<GameEvents> | null;
  private readonly pace = new PayPace();
  private visible: boolean;
  private done = false;

  constructor(id: string, settings: PayPadSettings, at: { readonly x: number; readonly y: number; readonly z: number }, price: number,
    source: CoinSource, visitor: PadVisitor, coinFx: CoinFlightSettings, events: EventBus<GameEvents> | null = null, options: PayPadOptions = {}) {
    this.id = id;
    this.settings = settings;
    this.x = at.x;
    this.y = at.y;
    this.z = at.z;
    this.price = Math.max(1, Math.floor(price));
    this.source = source;
    this.visitor = visitor;
    this.events = events;
    this.visible = options.shown ?? true;
    this.flights = new CoinFlights(coinFx, this);
    const plate = options.plate ?? null;
    const pad = this;
    this.clearZone = {
      minX: plate ? plate.minX : at.x,
      maxX: plate ? plate.maxX : at.x,
      minZ: plate ? plate.minZ : at.z,
      maxZ: plate ? plate.maxZ : at.z,
      speed: settings.clearSpeed,
      get active(): boolean {
        return plate !== null && pad.open;
      },
    };
  }

  get shown(): boolean {
    return this.visible;
  }

  /** Bought: the pad reads its done text and takes nothing more. */
  get closed(): boolean {
    return this.done;
  }

  /** What the counter reads: the price less what has landed. */
  get owed(): number {
    return Math.max(0, this.price - this.stored);
  }

  /** Coins in the air toward the pad. */
  get inFlight(): number {
    return this.flights.pending;
  }

  /** Coins still to be taken from the purse. */
  get missing(): number {
    return Math.max(0, this.owed - this.flights.pending);
  }

  get paid(): boolean {
    return this.stored >= this.price;
  }

  /** True while the pad takes coins: shown, not closed and not yet paid. */
  get open(): boolean {
    return this.visible && !this.done && this.stored < this.price;
  }

  /** True while the visitor's pivot is inside the pad's zone. */
  get inZone(): boolean {
    const half = this.settings.zoneHalf;
    return Math.abs(this.visitor.x - this.x) <= half && Math.abs(this.visitor.z - this.z) <= half;
  }

  show(): void {
    this.visible = true;
  }

  /** Takes the pad away (coins already in the air still land on it). */
  hide(): void {
    this.visible = false;
    this.pace.stop();
  }

  /** Nothing more to buy here. */
  close(): void {
    this.done = true;
    this.pace.stop();
  }

  /** Lands the coins in the air, then takes from the purse while the visitor stands in the zone. */
  step(dt: number): void {
    if (dt <= 0) return;
    this.flights.update(dt);
    const missing = this.missing;
    if (!this.open || missing <= 0 || !this.inZone) {
      this.pace.stop();
      return;
    }
    // An empty purse holds the pace: the stream goes on where it was when coins come in.
    if (this.source.total <= 0) return;
    const { interval, fillTime } = this.settings;
    if (!this.pace.running) this.pace.start(missing, interval, fillTime);
    const want = Math.min(this.pace.due(dt), missing);
    if (want <= 0) return;
    const taken = this.source.spend(want);
    if (taken <= 0) return;
    this.pace.took(taken);
    this.flights.launch(taken, this.x, this.y, this.z);
    this.events?.emit('coinsSpent', { padId: this.id, amount: taken });
  }

  /** Coins landing on the pad (CoinReceiver); `padPaid` once the price is met. */
  add(amount: number): void {
    const n = Math.min(Math.floor(amount), this.owed);
    if (n <= 0) return;
    this.stored += n;
    if (this.stored >= this.price) this.events?.emit('padPaid', { padId: this.id });
  }
}
