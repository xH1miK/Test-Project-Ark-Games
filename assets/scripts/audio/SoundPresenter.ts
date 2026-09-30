/**
 * Which game facts make which sound (the table of the example, docs/reference-example-teardown.md §7):
 *   ballScooped -> ball click            purseChanged (a coin landed in the counter) -> coin
 *   coinsSpent (onto a pad) -> spend, the variant stepping up as the price fills
 *   tierChanged (> 1) -> upgrade         gateOpening -> purchase and the gate whoosh
 *   the tractor moving -> engine loop    the shredder's rollers turning -> grind loop, as loud as they are fast
 *   the music from the start (it actually begins at the first gesture).
 * Pure: the game's models stay unaware of sound; this listens to their events.
 */
import type { EventBus } from '../core/Events';
import type { GameEvents } from '../core/Events';
import type { AudioManager } from './AudioManager';

export interface SoundPresenterSettings {
  /** The tractor counts as moving above this speed, units/s. */
  readonly engineMinSpeed: number;
  /** Price per pad id: the spend sound steps through its variants as `spent / price` grows. */
  readonly prices: Readonly<Record<string, number>>;
}

export class SoundPresenter {
  private readonly events: EventBus<GameEvents>;
  private readonly sound: AudioManager;
  private readonly tractor: { readonly speed: number };
  private readonly shredder: { readonly rollerSpeed: number };
  private readonly settings: SoundPresenterSettings;
  private readonly spent = new Map<string, number>();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    events: EventBus<GameEvents>,
    sound: AudioManager,
    sources: { readonly tractor: { readonly speed: number }; readonly shredder: { readonly rollerSpeed: number } },
    settings: SoundPresenterSettings,
  ) {
    this.events = events;
    this.sound = sound;
    this.tractor = sources.tractor;
    this.shredder = sources.shredder;
    this.settings = settings;
  }

  /** Subscribes to the bus and switches the music on. */
  start(): void {
    const { events, sound } = this;
    this.unsubscribe.push(
      events.on('ballScooped', () => sound.play('ball')),
      events.on('purseChanged', ({ delta }) => { if (delta > 0) sound.play('coin'); }),
      events.on('coinsSpent', ({ padId, amount }) => {
        const total = (this.spent.get(padId) ?? 0) + amount;
        this.spent.set(padId, total);
        const price = this.settings.prices[padId] ?? 0;
        sound.play('spend', price > 0 ? total / price : 0);
      }),
      events.on('tierChanged', ({ tier }) => { if (tier > 1) sound.play('upgrade'); }),
      events.on('gateOpening', () => {
        sound.play('purchase');
        sound.play('gate');
      }),
    );
    sound.setLoop('music', true);
  }

  stop(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** Once per frame: the loops that follow the world. */
  update(): void {
    const { sound } = this;
    sound.setLoop('engine', this.tractor.speed > this.settings.engineMinSpeed);
    const rollers = this.shredder.rollerSpeed;
    sound.setLoop('grind', rollers > 0);
    sound.setLoopLevel('grind', rollers);
  }
}
