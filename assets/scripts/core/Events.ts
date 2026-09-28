/**
 * Typed publish/subscribe. Systems announce facts ("coins earned", "tier changed") and the UI,
 * audio, FX and tutorial react to them without the systems knowing who listens.
 * Pure TypeScript: no engine imports.
 */

export type Listener<T> = (payload: T) => void;

export class EventBus<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Listener<never>[]>();

  /** Subscribes and returns a function that unsubscribes. */
  on<K extends keyof TEvents>(type: K, listener: Listener<TEvents[K]>): () => void {
    let list = this.listeners.get(type);
    if (!list) this.listeners.set(type, (list = []));
    list.push(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  off<K extends keyof TEvents>(type: K, listener: Listener<TEvents[K]>): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(listener as Listener<never>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    const list = this.listeners.get(type);
    if (!list) return;
    // Walk backwards so a listener may unsubscribe itself while being called.
    for (let i = list.length - 1; i >= 0; i--) (list[i] as Listener<TEvents[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Events of the game and their payloads. */
export interface GameEvents {
  /** A ball went into the bucket. */
  ballScooped: { readonly carried: number; readonly capacity: number };
  /** The shredder took the bucket's whole load (`count` balls fly in). */
  loadHandedIn: { readonly count: number };
  /** Balls were fed to the shredder (bucket unload or shoved into its throat). */
  ballsShredded: { readonly count: number };
  /** Coins were earned at a world point; the purse is credited when they arrive. */
  coinsEarned: { readonly amount: number; readonly x: number; readonly y: number; readonly z: number };
  /** The purse total changed. */
  purseChanged: { readonly total: number; readonly delta: number };
  /** The tractor reached a new tier (1-based). */
  tierChanged: { readonly tier: number };
  /** Coins left the purse for a pay pad (they count on the pad when they land). */
  coinsSpent: { readonly padId: string; readonly amount: number };
  /** A pay pad received its full price. */
  padPaid: { readonly padId: string };
  /** The gate finished opening: the end of the run. */
  gateOpened: { readonly padId: string };
}
