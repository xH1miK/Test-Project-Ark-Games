// Camera framing check (J3). (1) At the start the camera framing follows the screen shape (further out
// on a tall phone, closer on a wide one) and the shredder, the target of the first tutorial step, is
// on the screen. (2) The first hand-in pops the upgrade pad up: the camera leans toward it and pulls
// out (peek), the pad is on the screen at the height of the beat, then the camera comes back to the
// tractor and to the normal distance. (3) The gate opening (the event, as the payment would send it)
// pulls the camera out toward the gate and keeps it there: the doorway and the tractor are on the
// screen. Screen positions are the world points projected through the main camera, as a share of the
// screen (0..1).
//
//   node tools/check-html.mjs <html|url> --scenario camera [--gpu]

import { gameWait, installAutopilot } from './lib/autopilot.mjs';
import { installLoopProbe } from './lib/loop-probe.mjs';

/** Where a world point is on the screen, as shares of its width and height (y down). */
const SCREEN_OF = (x, y, z) => `(() => { const cam = cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')), out = new cc.Vec3();
  cam.worldToScreen(new cc.Vec3(${x}, ${y}, ${z}), out); const w = cam.camera.width, h = cam.camera.height;
  return { x: out.x / w, y: 1 - out.y / h }; })()`;

const inside = (p, margin) => p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

const FILL_AND_SELL = [
  { name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 },
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];

export default async function cameraFrame(t) {
  await t.waitFor('!!(window.__zm && window.__zm.camera)');
  await installAutopilot(t);
  await installLoopProbe(t);
  const cfg = await t.evaluate('__zm.config.camera');

  // 1. The start: the beat toward the shredder is on (the page has no nopeek flag for this scenario).
  // The game started the beat at load (the scenario begins some seconds later: it is over by now); play it again from the same place.
  t.check((await t.evaluate('__zm.camera.peeksStarted')) >= 1, 'the game started the start beat at load');
  await gameWait(t, 0.5);
  await t.evaluate(`(() => { const sh = cc.find('Level/Shredder').worldPosition; __zm.camera.peek(sh.x, sh.z, __zm.config.camera.peekStart); })()`);
  await t.waitFor('__zm.camera.peekWeight > 0.99', 10000);
  await gameWait(t, 0.8);
  const s = await t.evaluate(`(() => { const c = __zm.camera, a = innerWidth / innerHeight, k = __zm.config.camera.aspect;
    const sh = cc.find('Level/Shredder').worldPosition, tr = __zm.tractor;
    return { framing: c.framing, aspect: a, want: Math.min(k.max, Math.max(k.min, Math.pow(k.ref / a, k.power))), boost: c.boost,
      shredder: [sh.x, sh.y, sh.z], tractor: [tr.x, 0.5, tr.z] }; })()`);
  const shredder = await t.evaluate(SCREEN_OF(...s.shredder));
  const tractor = await t.evaluate(SCREEN_OF(...s.tractor));
  t.log(`start: aspect ${s.aspect.toFixed(3)}, framing ${s.framing.toFixed(3)}; shredder on screen at ${fmt(shredder)}, tractor at ${fmt(tractor)}`);
  t.check(Math.abs(s.framing - s.want) < 1e-6 && Math.abs(s.boost - cfg.peekStart.zoom) < 1e-6, 'the framing follows the screen shape, the start beat pulls out');
  t.check(inside(tractor, 0.05), 'the tractor is on the screen');
  t.check(inside(shredder, 0.02), 'the shredder, the target of the first step, is on the screen at the start');
  await t.shot('start');
  await gameWait(t, cfg.peekStart.holdTime + cfg.peekStart.outTime + 1.5);
  const back = await t.evaluate(`(() => { const c = __zm.camera, tr = __zm.tractor; return { w: c.peekWeight, boost: c.boost, lag: Math.hypot(c.focus.x - tr.x, c.focus.z - tr.z) }; })()`);
  t.check(back.w === 0 && back.boost === 1 && back.lag < 0.05, `the start beat is over: the camera is back on the tractor (lag ${back.lag.toFixed(3)})`);

  // 2. The first hand-in pops the pad up; the camera peeks.
  await t.evaluate(`(() => { const c = __zm.camera, pad = __zm.pads.upgrade; window.__cam = { peak: 0, atPeak: null, frames: 0, shownAt: -1, start: null };
    cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
      const q = window.__cam; q.frames++;
      if (pad.shown && q.shownAt < 0) { q.shownAt = q.frames; q.start = { x: c.focus.x, z: c.focus.z }; }
      if (c.peekWeight > q.peak) { q.peak = c.peekWeight; if (c.peekWeight > 0.999 && !q.atPeak) q.atPeak = { boost: c.boost, tx: __zm.tractor.x, tz: __zm.tractor.z, fx: c.focus.x, fz: c.focus.z, frame: q.frames }; }
    }); })()`);
  await t.evaluate(`__ap.run(${JSON.stringify(FILL_AND_SELL)})`);
  await t.waitFor('__cam.atPeak !== null', 60000);
  const pad = await t.evaluate('(() => { const p = __zm.pads.upgrade; return [p.x, 0.1, p.z]; })()');
  const atPeak = await t.evaluate('__cam');
  const padOn = await t.evaluate(SCREEN_OF(...pad));
  const trOn = await t.evaluate(SCREEN_OF(...(await t.evaluate('[__zm.tractor.x, 0.5, __zm.tractor.z]'))));
  t.log(`peek at its height: boost ${atPeak.atPeak.boost.toFixed(3)}, pad on screen at ${fmt(padOn)}, tractor at ${fmt(trOn)}`);
  t.check(Math.abs(atPeak.atPeak.boost - cfg.peekPad.zoom) < 1e-6, `the beat pulls out by ${cfg.peekPad.zoom}`);
  t.check(inside(padOn, 0.04), 'at the height of the beat the upgrade pad is on the screen');
  await t.shot('peek-pad');
  await t.waitFor('!__ap.running', 60000);
  await gameWait(t, cfg.peekPad.inTime + cfg.peekPad.holdTime + cfg.peekPad.outTime + 1.5);
  const after = await t.evaluate(`(() => { const c = __zm.camera, tr = __zm.tractor; return { w: c.peekWeight, boost: c.boost, lag: Math.hypot(c.focus.x - tr.x, c.focus.z - tr.z) }; })()`);
  t.check(after.w === 0 && after.boost === 1 && after.lag < 0.05, `the beat is over: the camera is back on the tractor (lag ${after.lag.toFixed(3)})`);

  // 3. The gate opening: pulled out toward the gate for good.
  await t.evaluate(`__zm.events.emit('gateOpening', { padId: 'gate' })`);
  await gameWait(t, cfg.peekGate.inTime + 1.2);
  const g = await t.evaluate(`(() => { const c = __zm.camera, tr = __zm.tractor, cu = cc.find('Level/GateCurtain').worldPosition;
    return { w: c.peekWeight, boost: c.boost, curtain: [cu.x, cu.y + 1.7, cu.z], tractor: [tr.x, 0.5, tr.z] }; })()`);
  const curtain = await t.evaluate(SCREEN_OF(...g.curtain));
  const trG = await t.evaluate(SCREEN_OF(...g.tractor));
  t.log(`finale: boost ${g.boost.toFixed(3)}, doorway at ${fmt(curtain)}, tractor at ${fmt(trG)}`);
  t.check(g.w === 1 && Math.abs(g.boost - cfg.peekGate.zoom) < 1e-6, 'the gate beat holds at its height');
  t.check(inside(curtain, 0.05), 'the doorway is on the screen, well inside');
  t.check(inside(trG, 0.03), 'the tractor is still on the screen');
  await t.shot('finale');
}
