// Dust and sparks check (J2). Real chain: the first hand-in makes dust where the balls land in the
// shredder and pops the upgrade pad up in a ring of dust; paying the upgrade puts a ring of dust round
// the tractor; paying the gate throws sparks over the doorway. Watched every frame after the frame's
// lateUpdate: the renderer draws exactly the puffs that are born and alive (one quad each), its model
// is on exactly while there is something to draw and its index count matches, nothing is over the
// pool's capacity. At the pauses (game paused mid-effect, close-ups from the side of the camera):
// the puffs cost exactly 1 draw call (the model on vs off) and none at rest. Kinds seen: dust and
// spark. The core loop's ledger and the HUD still hold every frame.
//
//   node tools/check-html.mjs <html|url> --scenario puffs [--gpu]

import { installAutopilot } from './lib/autopilot.mjs';
import { RELEASE_CAMERA, parkCamera } from './lib/camera.mjs';
import { installLoopProbe, setPurse, settleCoins } from './lib/loop-probe.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

const PUFF_PROBE = `(() => {
  if (window.__puffProbe) return 'already';
  const zm = window.__zm, puffs = zm.puffs, view = zm.puffRenderer, cap = zm.config.puffs.capacity;
  // True once some puff has lived age seconds (past its fade-in: a close-up of a just-born puff shows nothing).
  window.__older = (age) => { for (let i = 0; i < puffs.capacity; i++) if (puffs.visible(i) && puffs.age[i] >= age) return true; return false; };
  const q = window.__puffProbe = { frames: 0, drawnOff: 0, drawnOffAt: null, modelOff: 0, indexOff: 0, over: 0, maxDust: 0, maxSpark: 0, maxCount: 0, restFrames: 0, nanOff: 0 };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    q.frames++;
    let visible = 0, dust = 0, spark = 0;
    for (let i = 0; i < puffs.capacity; i++) {
      if (!puffs.visible(i)) continue;
      visible++;
      if (puffs.kind[i] === 1) spark++; else dust++;
      if (!Number.isFinite(puffs.x[i] + puffs.y[i] + puffs.z[i] + puffs.size(i) + puffs.alpha(i))) q.nanOff++;
    }
    q.maxDust = Math.max(q.maxDust, dust); q.maxSpark = Math.max(q.maxSpark, spark); q.maxCount = Math.max(q.maxCount, puffs.count);
    if (view.drawn !== visible) { q.drawnOff++; if (!q.drawnOffAt) q.drawnOffAt = { frame: q.frames, drawn: view.drawn, visible }; }
    const on = view.model && view.model.enabled;
    if (!!on !== (visible > 0)) q.modelOff++;
    if (on && view.model.subModels[0].inputAssembler.indexCount !== visible * 6) q.indexOff++;
    if (puffs.count > cap) q.over++;
    if (puffs.count === 0) q.restFrames++;
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
const ONTO_GATE = [
  { name: 'gate pad: west', kind: 'goto', x: 0.5, z: 2.6, radius: 0.8 },
  { name: 'gate pad: south', kind: 'goto', x: 0.5, z: -9, radius: 0.8 },
  { name: 'gate pad: onto it', kind: 'goto', x: 1.3, z: -11, radius: 0.4 },
  { name: 'gate pad: stand', kind: 'stop', time: 3 },
];

/**
 * Runs legs; pauses once `cond` holds; the camera is parked on (x, z) at `fov` for the shot; checks the
 * draw call cost with the model on and off; resumes. Returns what the pause saw.
 */
async function withShots(t, label, legs, cond, shot, at, fov, expectKind) {
  await t.evaluate(`__loopProbe.pauseWhen = () => ${cond}`);
  await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
  const paused = await t.waitFor('__loopProbe.paused || !__ap.running', 120000).then(() => t.evaluate('__loopProbe.paused'));
  t.check(paused, `${label}: paused with the puffs in the air`);
  if (paused) {
    await t.evaluate(parkCamera(at.x, at.z, fov));
    await t.frames(2);
    const on = await t.evaluate('({ drawn: __zm.puffRenderer.drawn, draws: cc.director.root.device.numDrawCalls, dust: 0 })');
    await t.shot(shot);
    await t.evaluate('__zm.puffRenderer.node.active = false');
    await t.frames(2);
    const off = await t.evaluate('cc.director.root.device.numDrawCalls');
    await t.evaluate('__zm.puffRenderer.node.active = true');
    await t.frames(2);
    const kinds = await t.evaluate('(() => { const p = __zm.puffs, k = [0, 0]; for (let i = 0; i < p.capacity; i++) if (p.visible(i)) k[p.kind[i]]++; return k; })()');
    t.log(`${label}: ${on.drawn} puffs drawn (dust ${kinds[0]}, spark ${kinds[1]}), draw calls ${on.draws} with them, ${off} without`);
    t.check(on.drawn >= 3, `${label}: ${on.drawn} puffs on the screen`);
    t.check(on.draws - off === 1, `${label}: the puffs cost exactly 1 draw call (${on.draws} vs ${off})`);
    t.check(kinds[expectKind] > 0, `${label}: puffs of the kind ${expectKind === 1 ? 'spark' : 'dust'} in the air`);
    await t.evaluate('(() => { __loopProbe.paused = false; __loopProbe.pauseWhen = null; cc.director.resume(); })()');
    await t.evaluate(RELEASE_CAMERA);
  } else {
    await t.evaluate('__loopProbe.pauseWhen = null');
  }
  await t.waitFor('!__ap.running', 120000);
  const results = await t.evaluate('__ap.results');
  t.check(results.every((r) => r.ok), `${label}: every leg finished (${results.filter((r) => r.ok).length}/${legs.length})`);
}

export default async function puffs(t) {
  await t.waitFor('!!(window.__zm && window.__zm.puffRenderer)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(PUFF_PROBE);
  await t.evaluate(RELEASE_CAMERA);
  const shred = await t.evaluate('(() => { const p = cc.find("Level/Shredder").worldPosition; return { x: p.x, z: p.z }; })()');
  const gate = await t.evaluate('(() => { const p = cc.find("Level/GateCurtain").worldPosition; return { x: p.x, z: p.z }; })()');
  const rest0 = await t.evaluate('({ count: __zm.puffs.count, drawn: __zm.puffRenderer.drawn, on: !!__zm.puffRenderer.model.enabled, draws: cc.director.root.device.numDrawCalls })');
  t.check(rest0.count === 0 && rest0.drawn === 0 && !rest0.on, 'at rest there are no puffs and the model is off');

  // 1. The first hand-in: dust where the balls land in the shredder.
  await withShots(t, 'landing', FILL_AND_SELL, '__zm.puffRenderer.drawn >= 3 && __older(0.25)', 'puffs-landing', shred, 30, 0);
  await settleCoins(t, 'first load');
  await t.evaluate('__ap.run(' + JSON.stringify(OUT_OF_ZONE) + ')');
  await t.waitFor('!__ap.running', 60000);
  await settleCoins(t, 'out of the zone');

  // 2. The upgrade pad popped up in a ring of dust: it was shown at the first hand-in (before the
  // pause above ended), so the ring is in the probe's history: the ring has 10 puffs.
  // 3. Pay the upgrade for real: a ring of dust round the tractor.
  await setPurse(t, 100);
  await withShots(t, 'upgrade', ONTO_UPGRADE, '__zm.tractor.tier === 2 && __zm.puffRenderer.drawn >= 6 && __older(0.25)', 'puffs-upgrade',
    { x: 5.2, z: 2.4 }, 30, 0);
  await settleCoins(t, 'upgrade paid');
  const tier = await t.evaluate('__zm.tractor.tier');
  t.check(tier === 2, 'the tractor is tier 2');

  // 4. Pay the gate for real: sparks over the doorway.
  await setPurse(t, 300);
  await withShots(t, 'gate', ONTO_GATE, '__zm.gate.phase === "opening" && __zm.puffRenderer.drawn >= 8 && __older(0.2)', 'puffs-gate', gate, 30, 1);
  await t.waitFor('__zm.gate.phase === "open" && __zm.puffs.count === 0', 20000).catch(() => false);
  const end = await settleCoins(t, 'gate paid');

  // 5. Verdict over every frame.
  const q = await t.evaluate('__puffProbe');
  const rest1 = await t.evaluate('({ count: __zm.puffs.count, drawn: __zm.puffRenderer.drawn, on: !!__zm.puffRenderer.model.enabled, draws: cc.director.root.device.numDrawCalls })');
  t.log(`over ${q.frames} frames: up to ${q.maxCount} puffs alive, ${q.maxDust} dust and ${q.maxSpark} sparks drawn at once; ${q.restFrames} frames at rest; draw calls at rest ${rest0.draws} -> ${rest1.draws}`);
  t.check(q.drawnOff === 0, `every frame the renderer drew exactly the puffs that are born and alive ${q.drawnOffAt ? JSON.stringify(q.drawnOffAt) : ''}`);
  t.check(q.modelOff === 0 && q.indexOff === 0, 'the model was on exactly while there was something to draw, with the right index count');
  t.check(q.over === 0 && q.nanOff === 0, 'the pool never overflowed and every puff was finite');
  t.check(q.maxDust >= 6 && q.maxSpark >= 8, 'dust and sparks were both drawn');
  t.check(rest1.count === 0 && !rest1.on, 'at the end nothing is left in the air and the model is off');
  t.check(end.gate === 'open', 'the gate opened');
  await checkUiOnTop(t);
  await checkFinalLedger(t, end);
}

async function checkFinalLedger(t, end) {
  const p = await t.evaluate('({ ...__loopProbe, pauseWhen: null })');
  t.check(p.coinsOff === 0, `after every frame: purse + coins in the air + on the pads = 2 x shredded + granted (${p.granted})`);
  t.check(p.hudOff === 0 && p.labelOff === 0, 'after every frame the HUD showed the purse');
  t.check(p.stray === 0, 'every held ball was exactly one of carried / flying / shredded');
  t.check(end.held === end.bucket + end.inFlight + end.removed, 'held balls add up');
}
