import { _decorator, AudioClip, AudioSource, Component, warn } from 'cc';
import type { LoopId, SoundBackend } from './AudioManager';

const { ccclass, property } = _decorator;

/** DOM events a browser accepts as "a real user gesture" for starting sound (a touchstart does not count). */
const GESTURES = ['touchend', 'pointerup', 'mouseup', 'click', 'keydown'] as const;

/**
 * The engine side of the sound layer: plays what AudioManager decides (Unity analogy: a component that owns
 * the AudioSources). One-shots go through a single AudioSource (`playOneShot` mixes any number of them); each
 * loop gets an AudioSource of its own. Clips are found by their asset name (ball_1, coin_3, music ...).
 * It also listens for the first real gesture on the page and reports each one, synchronously and before the
 * engine's own listeners (capture phase on the document): a browser resumes an audio context only inside such
 * a handler.
 */
@ccclass('SoundView')
export class SoundView extends Component implements SoundBackend {
  @property({ type: [AudioClip], tooltip: 'Every clip the sounds use (assets/audio); each is found by its asset name.' })
  clips: AudioClip[] = [];

  private readonly byName = new Map<string, AudioClip>();
  private readonly loops = new Map<LoopId, AudioSource>();
  private shots: AudioSource | null = null;
  private readonly missing = new Set<string>();
  private onGesture: (() => void) | null = null;
  private readonly handler = (): void => this.onGesture?.();

  protected onLoad(): void {
    for (const clip of this.clips) if (clip) this.byName.set(clip.name, clip);
    this.shots = this.source();
  }

  protected onEnable(): void {
    const host = globalThis as { document?: Document };
    for (const type of GESTURES) host.document?.addEventListener(type, this.handler, { capture: true, passive: true });
  }

  protected onDisable(): void {
    const host = globalThis as { document?: Document };
    for (const type of GESTURES) host.document?.removeEventListener(type, this.handler, { capture: true });
  }

  /** `callback` runs inside every real user gesture on the page. */
  listenForGestures(callback: () => void): void {
    this.onGesture = callback;
  }

  /** How many clips were found (a scenario checks that all of them arrived). */
  get clipCount(): number {
    return this.byName.size;
  }

  hasClip(name: string): boolean {
    return this.byName.has(name);
  }

  playOneShot(clip: string, volume: number): number {
    const c = this.find(clip);
    if (!c || !this.shots) return 0;
    this.shots.playOneShot(c, volume);
    return c.getDuration();
  }

  startLoop(id: LoopId, clip: string, volume: number): void {
    const c = this.find(clip);
    if (!c) return;
    let source = this.loops.get(id);
    if (!source) {
      source = this.source();
      source.loop = true;
      this.loops.set(id, source);
    }
    if (source.clip !== c) source.clip = c;
    source.volume = volume;
    // Not playing yet also means "waiting for the browser's unlock": asking again is how the retry works.
    if (!source.playing) source.play();
  }

  stopLoop(id: LoopId): void {
    this.loops.get(id)?.stop();
  }

  setLoopVolume(id: LoopId, volume: number): void {
    const source = this.loops.get(id);
    if (source) source.volume = volume;
  }

  loopSounding(id: LoopId): boolean {
    return this.loops.get(id)?.playing ?? false;
  }

  private find(name: string): AudioClip | undefined {
    const clip = this.byName.get(name);
    if (!clip && !this.missing.has(name)) {
      this.missing.add(name);
      warn(`SoundView: no clip named "${name}"`);
    }
    return clip;
  }

  private source(): AudioSource {
    const source = this.node.addComponent(AudioSource);
    source.playOnAwake = false;
    source.volume = 1;
    return source;
  }
}
