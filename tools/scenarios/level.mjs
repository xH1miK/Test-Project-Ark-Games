// M1 level check: the obstacle grid is built from the scene, the arena is closed for the tractor and
// for balls, and the key spots are reachable. Prints an ASCII map of the collision (1 char = 1 unit).
//
//   node tools/check-html.mjs <html|url> --scenario level

const SAMPLE = `(() => {
  const grid = __zm.obstacles;
  const B = { tractor: 1, balls: 2 };
  const { minX, maxX, minZ, maxZ } = grid.bounds;
  const spot = (path) => { const n = cc.find(path); return n && { x: n.worldPosition.x, z: n.worldPosition.z }; };
  const spots = { S: spot('Level/Spots/TractorStart'), U: spot('Level/Spots/UpgradePad'), G: spot('Level/Spots/GatePad'),
                  H: spot('Level/Shredder') };

  // Flood fill of the positions a circle of radius r can reach from the start; reaching the grid
  // border means the arena leaks.
  const flood = (r, mask, step) => {
    const cols = Math.round((maxX - minX) / step), rows = Math.round((maxZ - minZ) / step);
    const free = (c, k) => !grid.overlapsCircle(minX + (c + 0.5) * step, minZ + (k + 0.5) * step, r, mask);
    const seen = new Uint8Array(cols * rows);
    const c0 = Math.floor((spots.S.x - minX) / step), k0 = Math.floor((spots.S.z - minZ) / step);
    const queue = [c0 + k0 * cols];
    seen[queue[0]] = 1;
    let leak = false, count = 0;
    while (queue.length) {
      const i = queue.pop(), c = i % cols, k = (i - c) / cols;
      count++;
      if (c === 0 || k === 0 || c === cols - 1 || k === rows - 1) leak = true;
      for (const [dc, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nk = k + dk;
        if (nc < 0 || nk < 0 || nc >= cols || nk >= rows) continue;
        const j = nc + nk * cols;
        if (!seen[j] && free(nc, nk)) { seen[j] = 1; queue.push(j); }
      }
    }
    const reached = (p) => seen[Math.floor((p.x - minX) / step) + Math.floor((p.z - minZ) / step) * cols] === 1;
    return { leak, area: count * step * step, reached, seen, cols, rows, step };
  };

  const tractor = flood(1.2, B.tractor, 0.5);
  const balls = flood(0.275, B.balls, 0.5);

  // Shredder hand-in zone (square +-3.5 around its pivot) must contain reachable tractor positions.
  let shredderZone = 0;
  for (let x = -3.5; x <= 3.5; x += 0.5) for (let z = -3.5; z <= 3.5; z += 0.5)
    if (tractor.reached({ x: spots.H.x + x, z: spots.H.z + z })) shredderZone++;

  // ASCII map, 1 unit per char, north (-Z) at the top: '#' solid, '.' tractor can drive, ',' only balls fit.
  const lines = [];
  for (let z = minZ; z < maxZ; z++) {
    let line = '';
    for (let x = minX; x < maxX; x++) {
      const p = { x: x + 0.5, z: z + 0.5 };
      const mark = Object.entries(spots).find(([, s]) => s && Math.floor(s.x) === x && Math.floor(s.z) === z);
      line += mark ? mark[0] : grid.overlapsCircle(p.x, p.z, 0.01, 3) ? '#' : tractor.reached(p) ? '.' : balls.reached(p) ? ',' : ' ';
    }
    lines.push(line);
  }
  return {
    count: grid.count,
    tractor: { leak: tractor.leak, area: tractor.area },
    balls: { leak: balls.leak, area: balls.area },
    reached: { U: tractor.reached(spots.U), G: tractor.reached(spots.G) },
    shredderZone,
    map: lines.join(String.fromCharCode(10)),
  };
})()`;

export default async function level(t) {
  await t.waitFor('window.__zm && window.__zm.obstacles');
  const r = await t.evaluate(SAMPLE);
  t.log(`obstacles ${r.count}; tractor area ${r.tractor.area} u², ball area ${r.balls.area} u²`);
  t.log(`collision map (S start, U upgrade pad, G gate pad, H shredder; # solid, . tractor, , balls only):\n${r.map}`);
  t.check(r.count >= 40, `obstacle grid built from the scene (${r.count} blockers)`);
  t.check(!r.tractor.leak, 'arena closed for the tractor (radius 1.2)');
  t.check(!r.balls.leak, 'arena closed for balls (radius 0.275)');
  t.check(r.reached.U, 'upgrade pad spot reachable from the start');
  t.check(r.reached.G, 'gate pad spot reachable from the start');
  t.check(r.shredderZone > 10, `shredder hand-in zone reachable (${r.shredderZone} sample points)`);
  await t.shot('level');

  // Overview for layout review: pull the camera back along its own view direction, then restore it.
  await t.evaluate(`(() => {
    const cam = cc.find('Main Camera');
    window.__zmCamBackup = { pos: cam.position.clone(), rot: cam.rotation.clone() };
    cam.setPosition(40, 56, 34);
    cam.setRotationFromEuler(-50, 45, 0);
  })()`);
  await t.frames(3);
  await t.shot('overview');
  await t.evaluate(`(() => { const cam = cc.find('Main Camera'), b = window.__zmCamBackup;
    cam.setPosition(b.pos); cam.setRotation(b.rot); })()`);
}
