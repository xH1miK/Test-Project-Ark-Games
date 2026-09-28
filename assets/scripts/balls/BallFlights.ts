/**
 * Balls flying in arcs (into the shredder). Each flying ball is held out of the field and moves on a
 * straight line from where it was launched to its target plus a hop at the middle
 * (lerp + sin(πt)·arc); when it lands it is removed from the game. Pure TypeScript: no engine
 * imports (Unity analogy: a tiny tween system over ball indices instead of a coroutine per ball).
 * The balls are moved with moveHeld, so views draw them as loose balls rolling along their way.
 */

/** The ball field as the flights see it. */
export interface FlightField {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  isHeld(i: number): boolean;
  isRemoved(i: number): boolean;
  moveHeld(i: number, x: number, y: number, z: number): void;
  remove(i: number): void;
}

export class BallFlights {
  /** Field index of each flying ball, in [0 .. count). */
  readonly index: Int32Array;

  private readonly field: FlightField;
  private readonly fromX: Float64Array;
  private readonly fromY: Float64Array;
  private readonly fromZ: Float64Array;
  private readonly toX: Float64Array;
  private readonly toY: Float64Array;
  private readonly toZ: Float64Array;
  private readonly arc: Float64Array;
  private readonly time: Float64Array;
  private readonly duration: Float64Array;
  /** 1 for a field index that is in flight. */
  private readonly flying: Uint8Array;
  private flightCount = 0;
  private landedTotal = 0;

  /** `capacity`: the field's capacity (any ball may be in the air). */
  constructor(field: FlightField, capacity: number) {
    this.field = field;
    this.index = new Int32Array(capacity);
    this.fromX = new Float64Array(capacity);
    this.fromY = new Float64Array(capacity);
    this.fromZ = new Float64Array(capacity);
    this.toX = new Float64Array(capacity);
    this.toY = new Float64Array(capacity);
    this.toZ = new Float64Array(capacity);
    this.arc = new Float64Array(capacity);
    this.time = new Float64Array(capacity);
    this.duration = new Float64Array(capacity);
    this.flying = new Uint8Array(capacity);
  }

  /** Balls in the air. */
  get count(): number {
    return this.flightCount;
  }

  /** Balls landed (and removed) so far. */
  get landed(): number {
    return this.landedTotal;
  }

  isFlying(i: number): boolean {
    return this.flying[i] === 1;
  }

  /**
   * Launches held ball i from where it is toward (x, y, z): it lands after `duration` seconds and
   * hops `arc` units above the straight line at the middle. False if the ball is not held, already
   * removed or already flying.
   */
  launch(i: number, x: number, y: number, z: number, duration: number, arc: number): boolean {
    const field = this.field;
    if (!field.isHeld(i) || field.isRemoved(i) || this.flying[i]) return false;
    const k = this.flightCount++;
    this.index[k] = i;
    this.fromX[k] = field.x[i];
    this.fromY[k] = field.y[i];
    this.fromZ[k] = field.z[i];
    this.toX[k] = x;
    this.toY[k] = y;
    this.toZ[k] = z;
    this.arc[k] = arc;
    this.time[k] = 0;
    this.duration[k] = duration > 1e-6 ? duration : 1e-6;
    this.flying[i] = 1;
    return true;
  }

  /** Advances every flight by `dt` seconds; landed balls are removed from the game. Returns how many landed. */
  step(dt: number): number {
    if (dt <= 0) return 0;
    const field = this.field;
    let landed = 0;
    for (let k = 0; k < this.flightCount; ) {
      const t = (this.time[k] += dt) / this.duration[k];
      const i = this.index[k];
      if (t >= 1) {
        field.remove(i);
        this.flying[i] = 0;
        landed++;
        this.drop(k); // the last flight moves into slot k: handle it next
        continue;
      }
      const hop = this.arc[k] * Math.sin(Math.PI * t);
      field.moveHeld(
        i,
        this.fromX[k] + (this.toX[k] - this.fromX[k]) * t,
        this.fromY[k] + (this.toY[k] - this.fromY[k]) * t + hop,
        this.fromZ[k] + (this.toZ[k] - this.fromZ[k]) * t,
      );
      k++;
    }
    this.landedTotal += landed;
    return landed;
  }

  /** Removes flight k by moving the last one into its slot. */
  private drop(k: number): void {
    const last = --this.flightCount;
    if (k === last) return;
    this.index[k] = this.index[last];
    this.fromX[k] = this.fromX[last];
    this.fromY[k] = this.fromY[last];
    this.fromZ[k] = this.fromZ[last];
    this.toX[k] = this.toX[last];
    this.toY[k] = this.toY[last];
    this.toZ[k] = this.toZ[last];
    this.arc[k] = this.arc[last];
    this.time[k] = this.time[last];
    this.duration[k] = this.duration[last];
  }
}
