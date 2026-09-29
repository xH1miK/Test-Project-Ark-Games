import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { upgradeLegs } from '../scenarios/lib/sweep.mjs';
import { Blocks } from '../../assets/scripts/world/ObstacleGrid.ts';
import { LEVEL, SHREDDER_POSE, driveLegs, frame, makeWorld, measure } from './ball-world.mjs';

const [T1, T2] = Config.tractor.tiers;
/** How deep the tractor's body circle sits inside the level's obstacles. */
const penetration = ({ tractor, grid }) =>
  grid.resolveCircle(tractor.bodyX, tractor.bodyZ, tractor.bodyRadius, Blocks.Tractor, { x: 0, z: 0 });
/** The ledger of the core loop with the pads: every coin is in the purse, in the air or on a pad. */
const ledger = ({ purse, coins, pads }) =>
  purse.total + coins.pending + pads.upgrade.stored + pads.upgrade.inFlight + pads.gate.stored + pads.gate.inFlight;

test('upgradeLegs: from south-west or south-east of the shredder the tractor rounds it onto the pad and buys tier 2 (60 and 10 fps)', () => {
  for (const fps of [60, 10]) {
    for (const [x, z] of [[2.5, -6.5], [9.5, -6.5], [3, 5]]) {
      const world = makeWorld({ shredder: true, pads: true });
      const { tractor, purse, pads, shredder } = world;
      const tiers = [];
      world.events.on('tierChanged', ({ tier }) => tiers.push(tier));
      pads.upgrade.show();
      purse.add(150);
      tractor.place(x, z, 0);
      const until = { upgraded: () => tractor.tier >= 2 };
      let worst = 0;
      const results = driveLegs(world, upgradeLegs(tractor, SHREDDER_POSE, LEVEL.spots.upgradePad), () => {
        worst = Math.max(worst, penetration(world));
        return 1 / fps;
      }, { until });
      assert.ok(results.every((r) => r.ok), `from (${x}, ${z}) at ${fps} fps: ${JSON.stringify(results)}`);
      assert.equal(results[results.length - 1].reason, 'upgraded');
      assert.deepEqual(tiers, [2], 'tierChanged once, to 2');
      assert.ok(pads.upgrade.paid && pads.upgrade.closed);
      assert.equal(ledger(world), 150 + 2 * shredder.shredded, 'every coin accounted for');
      assert.ok(worst <= 0.05, `body in the obstacles at most ${worst.toFixed(4)} (from (${x}, ${z}), ${fps} fps)`);
    }
  }
});

test('tier 2 arrives next to the shredder: its bigger body grows into its size (pushed clear over the swell time, not in a jump), the bucket takes up 60 and the T2 boxes', () => {
  for (const fps of [60, 10]) {
    const world = makeWorld({ shredder: true, pads: true });
    const { tractor, bucket } = world;
    // T1 on the pad's zone, driven south until the shredder stops it.
    tractor.place(SHREDDER_POSE.x, 3, Math.PI);
    for (let f = 0; f < 2 * fps; f++) frame(world, 1 / fps, 0, -1);
    assert.ok(penetration(world) < 1e-6);
    const before = { x: tractor.x, z: tractor.z };
    tractor.setTier(2);
    const overlap = penetration(world);
    const time = Config.tractor.swell.time;
    // Still pushing into it: the overlap shrinks evenly over the swell time, then the body stays clear.
    let firstFrame = -1;
    let late = 0;
    let t = 0;
    for (let f = 0; f < fps; f++) {
      frame(world, 1 / fps, 0, -1);
      t += 1 / fps;
      if (firstFrame < 0) firstFrame = Math.hypot(tractor.x - before.x, tractor.z - before.z);
      const deep = penetration(world);
      assert.ok(deep <= overlap * Math.max(0, 1 - t / time) + 0.05, `${deep.toFixed(3)} deep ${t.toFixed(2)} s after the upgrade (${fps} fps)`);
      if (t > time) late = Math.max(late, deep);
    }
    console.log(`${fps} fps: T1 stopped by the shredder with its pivot at z ${before.z.toFixed(2)}; T2's body overlapped it by ${overlap.toFixed(2)}, ` +
      `pushed back ${firstFrame.toFixed(3)} in the first frame; after ${time} s at most ${late.toFixed(4)} deep`);
    assert.ok(overlap > 0.3, 'the bigger body did overlap');
    assert.ok(firstFrame <= (overlap / time) / fps + 0.05, 'no jump');
    assert.ok(late <= 0.05);
    assert.equal(bucket.capacity, T2.bucketCapacity);
    assert.equal(tractor.pusherBoxes, T2.pusher);
    assert.equal(tractor.bucketShape, T2.bucket);
    const m = measure(world);
    assert.equal(m.outside, 0);
    assert.ok(m.inPusher <= 0.06, `no free ball deep in the T2 boxes (${m.inPusher.toFixed(3)})`);
  }
  assert.ok(T1.bodyOffset < T2.bodyOffset);
});
