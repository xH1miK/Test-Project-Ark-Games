// The long run (browser scenario `long-run`, Node replay `longRun` in tools/test/ball-world.mjs):
// rounds of "fill the bucket near the next point of a tour round the carpet, then drive into the
// shredder's zone", tier 1 and then tier 2, until most of the carpet is shredded. The tour sends the
// tractor across the field every round (the far corners first), so the whole carpet gets ploughed and
// the full bucket shoves berms on its way back. pickFillTarget is self-contained (no imports, no
// outer names): the browser scenario injects its source into the page (`${pickFillTarget}`).

/** Points the rounds fill up near, in turn (world XZ): corners and sides of the carpet, crossing the field. */
export const TOUR = [[-2, 12], [12, -9], [12, 12], [-1, -10], [5, 13], [-2.5, -2], [12.5, 3], [5, 7]];

/** Tier-1 rounds until 35% of the carpet is shredded, then tier-2 rounds (60 a load) until 70%. */
export const PHASES = [
  { name: 'T1', tier: 0, share: 0.35, maxRounds: 45 },
  { name: 'T2', tier: 1, share: 0.7, maxRounds: 14 },
];

/** Where balls are counted (world XZ): the arena inside its rocks. */
export const SWEEP_AREA = { minX: -7, maxX: 17, minZ: -23, maxZ: 20 };

/**
 * The two legs of round `round` for tier index `tier`: fill up near the tour point (the tier's bucket
 * wants denser spots, its bigger body more room), then drive at the shredder's pivot until the
 * tractor's pivot enters the zone (the load goes then).
 */
export function roundLegs(round, tier, shredder) {
  const [x, z] = TOUR[round % TOUR.length];
  return [
    { name: `fill near (${x}, ${z})`, kind: 'seek', target: 'balls', until: 'full', toward: { x, z },
      minMass: tier === 0 ? 6 : 10, clearance: tier === 0 ? 0.9 : 1.4, timeout: 60 },
    { name: 'sell', kind: 'goto', x: shredder.x, z: shredder.z, until: 'inZone', timeout: 30 },
  ];
}

/**
 * pickFillTarget's options besides the leg's own: the area, the shredder's zone grown by 0.8 (the
 * pivot keeps out of it while filling), the shredder's body (a way out of the zone must not cross it).
 */
export function sweepFrame(shredder, zoneHalf) {
  return {
    area: SWEEP_AREA,
    keepOut: { x: shredder.x, z: shredder.z, half: zoneHalf + 0.8 },
    body: { x: shredder.x, z: shredder.z, half: 2.6 },
    towardShare: 0.25,
    turnCost: 0,
    minDistance: 2.5,
  };
}

/**
 * The next place to fill the bucket: free balls are counted on a 1-unit grid over `o.area`, each cell
 * weighs the balls in the 3x3 block round it; of the cells with at least `o.minMass`, the cheapest
 * (distance + `o.turnCost` per radian of turn; with `o.toward`, the distance from that point plus
 * `o.towardShare` of the distance from the tractor: a tour of such points sweeps the whole carpet) that
 *  - is at least `o.minDistance` away (the bucket is ahead of the pivot: what is under it is taken),
 *  - lies outside `o.keepOut` (the shredder's zone grown by a margin: the pivot must not sell early),
 *  - is not in `o.tabu` (cells the tractor could not get to),
 *  - has room for the tractor (`o.obstacles` free within `o.clearance`, as tractor collision),
 *  - is reached in a straight line that does not cross `o.keepOut` (or, while the tractor is still
 *    inside it after a hand-in, does not cross `o.body`, the shredder itself).
 * Returns { x, z, mass, cell } or null when no cell qualifies.
 */
export function pickFillTarget(balls, tractor, o) {
  const { minX, minZ, maxX, maxZ } = o.area;
  const cols = Math.ceil(maxX - minX);
  const rows = Math.ceil(maxZ - minZ);
  const counts = new Int32Array(cols * rows);
  for (let i = 0; i < balls.count; i++) {
    if (balls.isHeld(i)) continue;
    const c = Math.floor(balls.x[i] - minX);
    const k = Math.floor(balls.z[i] - minZ);
    if (c >= 0 && k >= 0 && c < cols && k < rows) counts[c + k * cols]++;
  }
  const inside = (x, z, sq) => Math.abs(x - sq.x) < sq.half && Math.abs(z - sq.z) < sq.half;
  // Slab test: does the segment (x0, z0) -> (x1, z1) pass through the square?
  const crosses = (x0, z0, x1, z1, sq) => {
    let t0 = 0;
    let t1 = 1;
    const axes = [[x0, x1 - x0, sq.x], [z0, z1 - z0, sq.z]];
    for (let a = 0; a < 2; a++) {
      const p = axes[a][0], d = axes[a][1], lo = axes[a][2] - sq.half, hi = axes[a][2] + sq.half;
      if (Math.abs(d) < 1e-9) {
        if (p <= lo || p >= hi) return false;
        continue;
      }
      let u = (lo - p) / d;
      let v = (hi - p) / d;
      if (u > v) { const w = u; u = v; v = w; }
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 >= t1) return false;
    }
    return true;
  };
  const wall = inside(tractor.x, tractor.z, o.keepOut) ? o.body : o.keepOut;
  let best = null;
  let bestCost = Infinity;
  for (let k = 0; k < rows; k++) {
    for (let c = 0; c < cols; c++) {
      let mass = 0;
      for (let kk = Math.max(0, k - 1); kk <= Math.min(rows - 1, k + 1); kk++) {
        for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) mass += counts[cc + kk * cols];
      }
      if (mass < o.minMass) continue;
      const cell = c + k * cols;
      const x = minX + c + 0.5;
      const z = minZ + k + 0.5;
      const distance = Math.hypot(x - tractor.x, z - tractor.z);
      if (distance < o.minDistance || inside(x, z, o.keepOut) || (o.tabu && o.tabu.indexOf(cell) >= 0)) continue;
      if (o.obstacles && o.obstacles.overlapsCircle(x, z, o.clearance, 1)) continue;
      if (crosses(tractor.x, tractor.z, x, z, wall)) continue;
      const turn = Math.atan2(x - tractor.x, z - tractor.z) - tractor.yaw;
      const way = o.toward ? Math.hypot(x - o.toward.x, z - o.toward.z) + o.towardShare * distance : distance;
      const cost = way + o.turnCost * Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, z, mass, cell };
      }
    }
  }
  return best;
}
