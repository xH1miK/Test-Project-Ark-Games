/**
 * Dust and sparks: a pool of short-lived puffs that rise, slow down, grow and fade. A pure simulation
 * (no engine imports): PuffQuads turns it into camera-facing quads and PuffRenderer draws them in one
 * draw call. A puff has a kind (dust: soft and grey-violet, spark: small and bright), a delay before
 * it is born, a life and a size that eases from `size0` to `size1`. Emit with a recipe from Config.puffs.
 */

import { mulberry32 } from '../balls/BallCarpet';

export const PuffKind = { Dust: 0, Spark: 1 } as const;

/** What to emit and where; positions are world units. */
export interface PuffRecipe {
  readonly kind: 'dust' | 'spark';
  readonly count: number;
  readonly y: number;
  /** Spawn on a ring of this radius round the point (and fly outward), or in a box of these half sizes. */
  readonly ring?: number;
  readonly box?: readonly [number, number, number];
  readonly speed: number;
  readonly up: readonly [number, number];
  readonly life: readonly [number, number];
  readonly size: readonly [number, number];
  readonly delay: number;
  readonly spin: number;
}

export interface KindLook {
  readonly color: readonly [number, number, number];
  readonly alpha: number;
  readonly gravity: number;
  readonly drag: number;
}

export interface PuffSettings {
  readonly capacity: number;
  readonly seed: number;
  readonly dust: KindLook;
  readonly spark: KindLook;
  readonly attack: number;
}

export class Puffs {
  readonly capacity: number;
  /** 1 while the slot holds a puff (waiting or flying). */
  readonly live: Uint8Array;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Seconds since birth; negative while the puff is still waiting for its delay. */
  readonly age: Float32Array;
  readonly life: Float32Array;

  private readonly settings: PuffSettings;
  private readonly random: () => number;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly rot0: Float32Array;
  private readonly spinRate: Float32Array;
  private cursor = 0;
  private used = 0;

  constructor(settings: PuffSettings) {
    this.settings = settings;
    this.random = mulberry32(settings.seed);
    const n = (this.capacity = settings.capacity);
    this.live = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n).fill(1);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.rot0 = new Float32Array(n);
    this.spinRate = new Float32Array(n);
  }

  /** Puffs in the pool (waiting or in the air). */
  get count(): number {
    return this.used;
  }

  /** Emits `count` puffs (the recipe's number by default) round (x, y, z); a full pool skips the rest. Returns how many were made. */
  emit(recipe: PuffRecipe, x: number, y: number, z: number, count: number = recipe.count): number {
    const r = this.random;
    const kind = recipe.kind === 'spark' ? PuffKind.Spark : PuffKind.Dust;
    let made = 0;
    for (let k = 0; k < count; k++) {
      const i = this.free();
      if (i < 0) break;
      made++;
      this.live[i] = 1;
      this.used++;
      this.kind[i] = kind;
      let dx = 0;
      let dz = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
      if (recipe.ring) {
        // Evenly round the ring with a little jitter, flying outward.
        const a = ((k + 0.5 * r()) / count) * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
        px = dx * recipe.ring * (0.7 + 0.3 * r());
        pz = dz * recipe.ring * (0.7 + 0.3 * r());
      } else if (recipe.box) {
        px = (2 * r() - 1) * recipe.box[0];
        py = (2 * r() - 1) * recipe.box[1];
        pz = (2 * r() - 1) * recipe.box[2];
        const a = r() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
      }
      this.x[i] = x + px;
      this.y[i] = y + recipe.y + py;
      this.z[i] = z + pz;
      const out = recipe.speed * (0.6 + 0.8 * r());
      this.vx[i] = dx * out;
      this.vz[i] = dz * out;
      this.vy[i] = recipe.up[0] + (recipe.up[1] - recipe.up[0]) * r();
      this.life[i] = recipe.life[0] + (recipe.life[1] - recipe.life[0]) * r();
      this.age[i] = -recipe.delay * r();
      const grow = 0.85 + 0.3 * r();
      this.size0[i] = recipe.size[0] * grow;
      this.size1[i] = recipe.size[1] * grow;
      this.rot0[i] = r() * 360;
      this.spinRate[i] = recipe.spin * (2 * r() - 1);
    }
    return made;
  }

  /** Moves the puffs on; the ones that reach the end of their life leave the pool. */
  update(dt: number): void {
    if (dt <= 0 || this.used === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.live[i]) continue;
      const age = (this.age[i] += dt);
      if (age < 0) continue;
      if (age >= this.life[i]) {
        this.live[i] = 0;
        this.used--;
        continue;
      }
      const look = this.kind[i] === PuffKind.Spark ? this.settings.spark : this.settings.dust;
      const keep = Math.exp(-look.drag * dt);
      this.vx[i] *= keep;
      this.vz[i] *= keep;
      this.vy[i] = this.vy[i] * keep + look.gravity * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
    }
  }

  /** True while puff i is born and not dead. */
  visible(i: number): boolean {
    return this.live[i] === 1 && this.age[i] >= 0;
  }

  /** Width of puff i: eases out from size0 to size1 over its life. */
  size(i: number): number {
    const t = Math.min(1, Math.max(0, this.age[i] / this.life[i]));
    const e = 1 - (1 - t) * (1 - t);
    return this.size0[i] + (this.size1[i] - this.size0[i]) * e;
  }

  /** Opacity 0..1 of puff i: fades in over `attack` of its life, then out. */
  alpha(i: number): number {
    const t = Math.min(1, Math.max(0, this.age[i] / this.life[i]));
    const look = this.kind[i] === PuffKind.Spark ? this.settings.spark : this.settings.dust;
    const inn = this.settings.attack > 0 ? Math.min(1, t / this.settings.attack) : 1;
    return look.alpha * inn * (1 - t) * (1 - t);
  }

  /** Turn of puff i about the view axis, degrees. */
  rotation(i: number): number {
    return this.rot0[i] + this.spinRate[i] * Math.max(0, this.age[i]);
  }

  private free(): number {
    const n = this.capacity;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      if (!this.live[i]) {
        this.cursor = (i + 1) % n;
        return i;
      }
    }
    return -1;
  }
}
