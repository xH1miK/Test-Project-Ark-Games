// Coin sprites check (J1). Coins in the air are drawn on the screen: from the shredder to the coin
// counter (a hand-in) and from the counter onto a pay pad (a visit). Watched every frame after the
// frame's lateUpdate: one sprite per coin in the air (shredder + both pads), none for the spare ones,
// each where the arc formula puts it (written down again here from the flight's progress, the world
// end projected through the camera, the other end the counter's icon), all on the screen, in the HUD
// group after the counter (drawn over it), on UI_2D, at most one pooled node per possible coin. The
// game is paused mid-flight twice for close-ups (with the sprites on and off: the draw calls must be
// equal: they share the UI's one batch). The core loop's ledger and the HUD still hold every frame.
//
//   node tools/check-html.mjs <html|url> --scenario coin-fx [--gpu]

import { installAutopilot } from './lib/autopilot.mjs';
import { RELEASE_CAMERA } from './lib/camera.mjs';
import { checkLoopProbe, installLoopProbe, loopState, setPurse, settleCoins } from './lib/loop-probe.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

const COIN_PROBE = `(() => {
  if (window.__coinProbe) return 'already';
  const zm = window.__zm, view = zm.coinFlightView, pool = view.node, cfg = zm.config.coinFx.sprite;
  const Cam = cc.js.getClassByName('cc.Camera'), cam = cc.find('Main Camera').getComponent(Cam), UIT = cc.js.getClassByName('cc.UITransform');
  const size = cc.find('Canvas/Hud').getComponent(UIT), icon = cc.find('Canvas/Hud/CoinHud/Plate/Icon');
  const routes = [{ f: zm.coins, toHud: true }, { f: zm.pads.upgrade.flights, toHud: false }, { f: zm.pads.gate.flights, toHud: false }];
  const q = window.__coinProbe = { frames: 0, countOff: 0, countOffAt: null, poseOff: 0, worstPose: 0, worstSize: 0, offScreen: 0, maxVisible: 0, toHudSeen: 0, toPadSeen: 0,
    rotOff: 0, layerOff: 0, poolSize: pool.children.length, maxShown: 0 };
  const w = new cc.Vec3(), a = new cc.Vec3(), b = new cc.Vec3();
  const pose = (t, lane, ax, ay, bx, by) => {
    const u = Math.min(1, Math.max(0, t)), e = u * u * (3 - 2 * u), dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    const cx = (ax + bx) / 2 - dy / len * cfg.arc * lane, cy = (ay + by) / 2 + dx / len * cfg.arc * lane, k = 1 - e;
    return { x: k * k * ax + 2 * k * e * cx + e * e * bx, y: k * k * ay + 2 * k * e * cy + e * e * by, rot: cfg.spin * u,
      size: cfg.size * (cfg.startScale + (1 - cfg.startScale) * Math.min(1, u / cfg.growth)) * (1 + (cfg.pop - 1) * Math.sin(Math.PI * u)) };
  };
  const angleOff = (x, y) => { const d = ((x - y) % 360 + 540) % 360 - 180; return Math.abs(d); };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    q.frames++;
    icon.getWorldPosition(w);
    pool.inverseTransformPoint(b, w);
    let n = 0;
    for (const r of routes) {
      for (let k = 0; k < r.f.count; k++) {
        const c = r.f.coins[k];
        w.set(c.x, c.y, c.z);
        cam.convertToUINode(w, pool, a);
        const p = r.toHud ? pose(c.time / c.duration, c.lane, a.x, a.y, b.x, b.y) : pose(c.time / c.duration, c.lane, b.x, b.y, a.x, a.y);
        const node = pool.children[n++];
        if (!node || !node.active) { q.poseOff++; continue; }
        q.worstPose = Math.max(q.worstPose, Math.hypot(node.position.x - p.x, node.position.y - p.y));
        q.worstSize = Math.max(q.worstSize, Math.abs(node.scale.x * 100 - p.size));
        if (angleOff(node.eulerAngles.z, p.rot) > 0.01) q.rotOff++;
        if (Math.abs(node.position.x) > size.width / 2 + 150 || Math.abs(node.position.y) > size.height / 2 + 150) q.offScreen++;
        if (r.toHud) q.toHudSeen++; else q.toPadSeen++;
        if (node.layer !== cc.Layers.Enum.UI_2D) q.layerOff++;
      }
    }
    let shown = 0;
    for (const c of pool.children) if (c.active) shown++;
    q.maxShown = Math.max(q.maxShown, shown);
    q.maxVisible = Math.max(q.maxVisible, n);
    if (shown !== n || view.visible !== n) { q.countOff++; if (!q.countOffAt) q.countOffAt = { frame: q.frames, coins: n, active: shown, visible: view.visible }; }
  });
  return 'installed';
})()`;

const FILL_AND_SELL = [
  { name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 },
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];
const OUT_OF_ZONE = [
  { name: 'west out of the zone', kind: 'goto', x: 0.8, z: -4.8, radius: 0.6 },
  { name: 'west: stop', kind: 'stop', time: 0.3 },
];
const ONTO_UPGRADE = [
  { name: 'upgrade pad: north', kind: 'goto', x: 0.8, z: 2.4, radius: 0.6 },
  { name: 'upgrade pad: onto it', kind: 'goto', x: 5.2, z: 2.4, radius: 0.4 },
  { name: 'upgrade pad: stand', kind: 'stop', time: 2.5 },
];

const draws = (t) => t.evaluate('cc.director.root.device.numDrawCalls');

/** Runs legs; pauses the game once `cond` holds; shoots with the sprites on and off; resumes. */
async function withShots(t, label, legs, cond, shot) {
  await t.evaluate(`__loopProbe.pauseWhen = () => ${cond}`);
  await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
  const paused = await t.waitFor('__loopProbe.paused || !__ap.running', 90000).then(() => t.evaluate('__loopProbe.paused'));
  t.check(paused, `${label}: paused with coins in the air`);
  if (paused) {
    await t.frames(2);
    const on = await t.evaluate('({ visible: __zm.coinFlightView.visible, draws: cc.director.root.device.numDrawCalls })');
    await t.shot(shot);
    await t.evaluate('__zm.coinFlightView.node.active = false');
    await t.frames(2);
    const off = await draws(t);
    await t.evaluate('__zm.coinFlightView.node.active = true');
    t.log(`${label}: ${on.visible} coin sprites, draw calls ${on.draws} with them, ${off} without`);
    t.check(on.visible >= 3, `${label}: ${on.visible} sprites on the screen`);
    t.check(on.draws === off, `${label}: the sprites cost no draw call (${on.draws} vs ${off})`);
    await t.evaluate('(() => { __loopProbe.paused = false; __loopProbe.pauseWhen = null; cc.director.resume(); })()');
  } else {
    await t.evaluate('__loopProbe.pauseWhen = null');
  }
  await t.waitFor('!__ap.running', 90000);
  const results = await t.evaluate('__ap.results');
  t.check(results.every((r) => r.ok), `${label}: every leg finished (${results.filter((r) => r.ok).length}/${legs.length})`);
}

export default async function coinFx(t) {
  await t.waitFor('!!(window.__zm && window.__zm.coinFlightView)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(COIN_PROBE);
  await t.evaluate(RELEASE_CAMERA);

  // 1. A hand-in: coins fly from the shredder to the counter.
  await withShots(t, 'hand-in', FILL_AND_SELL, '__zm.coins.count >= 4 && __zm.coins.coins[0].time > 0.1', 'coins-to-counter');
  await settleCoins(t, 'first load');
  await t.evaluate('__ap.run(' + JSON.stringify(OUT_OF_ZONE) + ')');
  await t.waitFor('!__ap.running', 60000);
  await settleCoins(t, 'out of the zone');
  const s1 = await loopState(t);
  t.check(s1.purse >= 16, `the purse holds the load's coins (${s1.purse})`);

  // 2. A visit to the upgrade pad: coins fly from the counter onto it.
  await setPurse(t, 60);
  await withShots(t, 'pad visit', ONTO_UPGRADE, '__zm.pads.upgrade.flights.count >= 3 && __zm.pads.upgrade.flights.coins[0].time > 0.1', 'coins-to-pad');
  const end = await settleCoins(t, 'pad visit');
  t.check(end.pads >= 60, `the pad took the coins (${end.pads})`);

  // 3. Verdict over every frame.
  const q = await t.evaluate('__coinProbe');
  t.log(`over ${q.frames} frames: up to ${q.maxVisible} sprites at once (${q.maxShown} nodes active, ${q.poolSize} in the pool); seen ${q.toHudSeen} coin-frames to the counter, ${q.toPadSeen} to a pad; ` +
    `worst position error ${q.worstPose.toExponential(1)} units, size ${q.worstSize.toExponential(1)}`);
  t.check(q.countOff === 0, `every frame: one active sprite per coin in the air, no more ${q.countOffAt ? JSON.stringify(q.countOffAt) : ''}`);
  t.check(q.poseOff === 0 && q.worstPose < 1e-3 && q.worstSize < 1e-3 && q.rotOff === 0, 'every sprite sits where the arc formula puts it (position, size, spin)');
  t.check(q.toHudSeen > 20 && q.toPadSeen > 20, 'both directions were drawn');
  t.check(q.offScreen === 0, 'every sprite stayed on the screen (the world end is projected sanely)');
  t.check(q.layerOff === 0, 'every sprite is on UI_2D');
  t.check(q.poolSize <= 60 && q.maxShown <= 60, `a pool of at most 60 nodes (${q.poolSize})`);
  const order = await t.evaluate(`(() => { const kids = cc.find('Canvas/Hud').children.map((c) => c.name);
    return { kids, coinsAfterHud: kids.indexOf('CoinFlights') > kids.indexOf('CoinHud') }; })()`);
  t.check(order.coinsAfterHud, `the coin sprites are drawn over the counter (Hud children: ${order.kids.join(', ')})`);
  await checkUiOnTop(t);
  await checkLoopProbe(t, end);
}
