/**
 * The path of a flying coin sprite on the screen: a quadratic Bezier from `a` to `b` whose control
 * point sits off the middle of the chord by `arc` * lane (sideways to it), eased with smoothstep,
 * spinning and swelling on the way. Pure TypeScript: no engine imports; CoinFlightView draws it.
 */

export interface CoinArcSettings {
  readonly arc: number;
  readonly spin: number;
  readonly size: number;
  readonly pop: number;
  readonly startScale: number;
  readonly growth: number;
}

/** Where a sprite is at progress t: position (UI units), rotation (degrees) and width (UI units). */
export interface CoinPose {
  x: number;
  y: number;
  rot: number;
  size: number;
}

/** Fills `out` for progress `t` (0..1) of a coin flying from (ax, ay) to (bx, by) on `lane` (-1..1). */
export function coinPose(out: CoinPose, s: CoinArcSettings, t: number, lane: number, ax: number, ay: number, bx: number, by: number): CoinPose {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const e = u * u * (3 - 2 * u);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  // Left normal of the chord (zero for a zero-length chord: the coin then just spins on the spot).
  const nx = len > 1e-6 ? -dy / len : 0;
  const ny = len > 1e-6 ? dx / len : 0;
  const cx = (ax + bx) / 2 + nx * s.arc * lane;
  const cy = (ay + by) / 2 + ny * s.arc * lane;
  const k = 1 - e;
  out.x = k * k * ax + 2 * k * e * cx + e * e * bx;
  out.y = k * k * ay + 2 * k * e * cy + e * e * by;
  out.rot = s.spin * u;
  const grow = s.growth > 0 ? Math.min(1, u / s.growth) : 1;
  out.size = s.size * (s.startScale + (1 - s.startScale) * grow) * (1 + (s.pop - 1) * Math.sin(Math.PI * u));
  return out;
}
