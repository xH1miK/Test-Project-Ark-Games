// Writes the level's collision and key spots from the running game to tools/test/fixtures/level.json,
// so Node tests and benchmarks run on the real arena. Re-run after changing the level layout.
//
//   node tools/check-html.mjs http://localhost:7456/ --size 390x844 --scenario dump-level

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve('tools/test/fixtures/level.json');

export default async function dumpLevel(t) {
  await t.waitFor('window.__zm && window.__zm.obstacles');
  const level = await t.evaluate(`(() => {
    const g = __zm.obstacles, round = (v) => +v.toFixed(4);
    const spot = (path) => { const n = cc.find(path), p = n.worldPosition, e = n.eulerAngles;
      return { x: round(p.x), y: round(p.y), z: round(p.z), yaw: round(e.y) }; };
    return {
      bounds: g.bounds, cellSize: g.cellSize,
      // ObstacleGrid internals: angle in radians, Cocos Y-rotation convention (see ObstacleGrid.ts).
      obstacles: g.obstacles.map((o) => o.isBox
        ? { kind: 'box', x: round(o.x), z: round(o.z), halfX: round(o.halfX), halfZ: round(o.halfZ), angle: round(Math.atan2(o.sin, o.cos)), mask: o.mask }
        : { kind: 'circle', x: round(o.x), z: round(o.z), radius: round(o.radius), mask: o.mask }),
      spots: { tractorStart: spot('Level/Spots/TractorStart'), shredder: spot('Level/Shredder'),
               upgradePad: spot('Level/Spots/UpgradePad'), gatePad: spot('Level/Spots/GatePad') },
    };
  })()`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ capturedFrom: 'Main.scene via tools/scenarios/dump-level.mjs', ...level }, null, 1) + '\n');
  t.log(`${level.obstacles.length} obstacles, spots ${Object.keys(level.spots).join(', ')} -> ${OUT}`);
  t.check(level.obstacles.length > 2, 'level collision dumped');
}
