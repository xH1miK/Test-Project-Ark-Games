/**
 * The rules of the sound layer, as pure logic (no engine): what may play now and what may not.
 * A backend (SoundView on the engine's AudioSource, or a fake in tests) does the actual playing.
 *
 * One-shots (`play`): dropped while the page is locked (a browser lets sound start only after a real user
 * gesture; a one-shot started earlier would be queued by the audio context and burst out at unlock) or muted;
 * each sound has a min/max interval (after a play the next is allowed a random `min..max` seconds later), a
 * volume with jitter, and a variant that never repeats the last one (or steps with progress); at most
 * `maxShotsPerFrame` start in one frame and at most `maxVoices` sound at once (loops count).
 * Loops (`setLoop` on/off, `setLoopLevel` 0..1): the volume follows `base x gain`, the gain ramps to its
 * target over `fade` seconds, a loop is only really started when it can be heard; mute stops every loop
 * and remembers which ones are wanted, so unmuting brings back exactly those.
 * Unlock: the DOM gesture handler calls `gesture()` synchronously (browsers only accept the resume inside the
 * handler); until a loop is really sounding the start is retried every `unlockRetry` seconds after a gesture.
 */

export type LoopId = 'music' | 'engine' | 'grind';
export type ShotId = 'ball' | 'coin' | 'spend' | 'upgrade' | 'purchase' | 'gate';

export interface LoopSettings {
  readonly clip: string;
  /** Volume at gain 1. */
  readonly volume: number;
  /** Seconds to go from silence to full and back (0 = at once). */
  readonly fade: number;
}

export interface ShotSettings {
  readonly clips: readonly string[];
  readonly volume: number;
  /** The volume is multiplied by a random factor in this range. */
  readonly jitter: readonly [number, number];
  /** After a play the next one is allowed a random min..max seconds later. */
  readonly minInterval: number;
  readonly maxInterval: number;
  /** `random`: any variant but the last one; `progress`: `play(id, progress)` picks by progress 0..1. */
  readonly pick: 'random' | 'progress';
}

export interface SoundSettings {
  readonly maxVoices: number;
  readonly maxShotsPerFrame: number;
  readonly unlockRetry: number;
  readonly historySize: number;
  readonly loops: Readonly<Record<LoopId, LoopSettings>>;
  readonly shots: Readonly<Record<ShotId, ShotSettings>>;
}

export interface SoundBackend {
  /** Starts a one-shot; returns its length in seconds (0 when the clip is missing). */
  playOneShot(clip: string, volume: number): number;
  /** Starts (or, if it is waiting for the browser's unlock, asks again) a looping clip. */
  startLoop(id: LoopId, clip: string, volume: number): void;
  stopLoop(id: LoopId): void;
  setLoopVolume(id: LoopId, volume: number): void;
  /** True while the loop is really sounding (the audio context is running). */
  loopSounding(id: LoopId): boolean;
}

export interface PlayRecord {
  readonly time: number;
  readonly frame: number;
  readonly id: ShotId;
  readonly clip: string;
  readonly volume: number;
}

interface LoopState {
  wanted: boolean;
  level: number;
  gain: number;
  /** The backend was told to run it. */
  started: boolean;
  /** The last volume sent. */
  sent: number;
}

const LOOP_IDS: readonly LoopId[] = ['music', 'engine', 'grind'];
const SHOT_IDS: readonly ShotId[] = ['ball', 'coin', 'spend', 'upgrade', 'purchase', 'gate'];
/** A clip that reports no length still occupies a voice for a moment. */
const MIN_VOICE_TIME = 0.05;

export class AudioManager {
  /** Some loop has really started sounding: the browser let the page make sound. */
  unlocked = false;
  muted = false;
  /** Game time and frame count, from `update`. */
  now = 0;
  frame = 0;
  readonly played: Record<ShotId, number> = { ball: 0, coin: 0, spend: 0, upgrade: 0, purchase: 0, gate: 0 };
  readonly dropped = { locked: 0, muted: 0, throttled: 0, frameCap: 0, pool: 0 };
  /** The most recent plays (up to `historySize`), for the QA scenarios. */
  readonly history: PlayRecord[] = [];

  private readonly settings: SoundSettings;
  private readonly backend: SoundBackend;
  private readonly random: () => number;
  private readonly loops: Record<LoopId, LoopState>;
  private readonly nextAllowed: Record<ShotId, number> = { ball: 0, coin: 0, spend: 0, upgrade: 0, purchase: 0, gate: 0 };
  private readonly lastVariant: Record<ShotId, number> = { ball: -1, coin: -1, spend: -1, upgrade: -1, purchase: -1, gate: -1 };
  /** End times of the one-shots that may still be sounding. */
  private voices: number[] = [];
  private shotsThisFrame = 0;
  private gestureSeen = false;
  private retryClock = 0;

  constructor(settings: SoundSettings, backend: SoundBackend, random: () => number) {
    this.settings = settings;
    this.backend = backend;
    this.random = random;
    const fresh = (): LoopState => ({ wanted: false, level: 1, gain: 0, started: false, sent: -1 });
    this.loops = { music: fresh(), engine: fresh(), grind: fresh() };
  }

  /** Loops that are running plus one-shots that may still be sounding. */
  get voiceCount(): number {
    let n = this.voices.length;
    for (const id of LOOP_IDS) if (this.loops[id].started) n++;
    return n;
  }

  loopWanted(id: LoopId): boolean {
    return this.loops[id].wanted;
  }

  /** The loop's fade gain now (0..1). */
  loopGain(id: LoopId): number {
    return this.loops[id].gain;
  }

  loopRunning(id: LoopId): boolean {
    return this.loops[id].started;
  }

  /** Switches a loop on or off (it fades in or out); the state is remembered through mute. */
  setLoop(id: LoopId, on: boolean): void {
    this.loops[id].wanted = on;
  }

  /** How loud the loop wants to be, 0..1 (the grind follows the rollers' speed). */
  setLoopLevel(id: LoopId, level: number): void {
    this.loops[id].level = level < 0 ? 0 : level > 1 ? 1 : level;
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (!muted) return; // loops come back through update()
    for (const id of LOOP_IDS) this.stopLoop(id);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * A real user gesture is happening. Called synchronously from the DOM handler: it is the only moment a
   * browser accepts the start of sound (and, on some, the resume of the audio context).
   */
  gesture(): void {
    this.gestureSeen = true;
    this.retryClock = 0;
    if (this.unlocked || this.muted) return;
    for (const id of LOOP_IDS) if (this.shouldRun(id)) this.startLoop(id);
  }

  /** Once per frame, before the frame's events. */
  update(dt: number): void {
    this.frame++;
    this.now += dt;
    this.shotsThisFrame = 0;
    if (this.voices.length > 0) this.voices = this.voices.filter((end) => end > this.now);

    for (const id of LOOP_IDS) {
      const s = this.settings.loops[id];
      const loop = this.loops[id];
      const target = loop.wanted ? loop.level : 0;
      if (s.fade <= 0) loop.gain = target;
      else {
        const step = dt / s.fade;
        loop.gain = loop.gain < target ? Math.min(target, loop.gain + step) : Math.max(target, loop.gain - step);
      }
      if (!this.shouldRun(id)) {
        if (loop.started) this.stopLoop(id);
      } else if (!loop.started && this.unlocked) {
        this.startLoop(id);
      }
      if (loop.started) {
        const volume = s.volume * loop.gain;
        if (Math.abs(volume - loop.sent) > 1e-4) {
          loop.sent = volume;
          this.backend.setLoopVolume(id, volume);
        }
      }
    }

    if (!this.unlocked) {
      for (const id of LOOP_IDS) {
        if (this.loops[id].started && this.backend.loopSounding(id)) this.unlocked = true;
      }
    }
    // After a gesture that did not get the sound going, ask again now and then.
    if (this.gestureSeen && !this.unlocked && !this.muted) {
      this.retryClock += dt;
      if (this.retryClock >= this.settings.unlockRetry) {
        this.retryClock = 0;
        for (const id of LOOP_IDS) if (this.shouldRun(id)) this.startLoop(id);
      }
    }
  }

  /**
   * Plays a one-shot if the rules allow. `progress` (0..1) picks the variant of a `progress` sound.
   * Returns whether it was started.
   */
  play(id: ShotId, progress = 0): boolean {
    if (!this.unlocked) return this.drop('locked');
    if (this.muted) return this.drop('muted');
    const s = this.settings.shots[id];
    if (this.now < this.nextAllowed[id]) return this.drop('throttled');
    if (this.shotsThisFrame >= this.settings.maxShotsPerFrame) return this.drop('frameCap');
    if (this.voiceCount >= this.settings.maxVoices) return this.drop('pool');

    const n = s.clips.length;
    let variant: number;
    if (s.pick === 'progress') {
      variant = Math.min(n - 1, Math.max(0, Math.floor(progress * n)));
    } else {
      variant = Math.floor(this.random() * n);
      // Never the last one again: skip over it.
      if (n > 1 && variant === this.lastVariant[id]) variant = (variant + 1 + Math.floor(this.random() * (n - 1))) % n;
    }
    this.lastVariant[id] = variant;
    const [lo, hi] = s.jitter;
    const volume = s.volume * (lo + this.random() * (hi - lo));
    const clip = s.clips[variant];
    const seconds = this.backend.playOneShot(clip, volume);

    this.nextAllowed[id] = this.now + s.minInterval + this.random() * (s.maxInterval - s.minInterval);
    this.shotsThisFrame++;
    this.voices.push(this.now + Math.max(seconds, MIN_VOICE_TIME));
    this.played[id]++;
    this.history.push({ time: this.now, frame: this.frame, id, clip, volume });
    if (this.history.length > this.settings.historySize) this.history.shift();
    return true;
  }

  private drop(reason: keyof AudioManager['dropped']): false {
    this.dropped[reason]++;
    return false;
  }

  /** A loop runs while it is wanted or still fading out, and the sound is not muted. */
  private shouldRun(id: LoopId): boolean {
    const loop = this.loops[id];
    return !this.muted && ((loop.wanted && loop.level > 0) || loop.gain > 0);
  }

  private startLoop(id: LoopId): void {
    const s = this.settings.loops[id];
    const loop = this.loops[id];
    const volume = s.volume * loop.gain;
    loop.started = true;
    loop.sent = volume;
    this.backend.startLoop(id, s.clip, volume);
  }

  private stopLoop(id: LoopId): void {
    const loop = this.loops[id];
    if (!loop.started) return;
    loop.started = false;
    loop.sent = -1;
    this.backend.stopLoop(id);
  }
}

export { LOOP_IDS, SHOT_IDS };
