// Gate and finale check (M10). At the start the gateway is sealed by the force-field curtain, the gate
// pad and the sign read 300, the controls are on and the finale is not there. A partial payment of 290
// is kept; then the tractor drives through the pad at full speed with 30 coins in the purse, pushing
// west all the time (an autopilot that never lets go): the last 10 coins land while it is still moving.
// From the frame `padPaid` fires (watched every frame): the drive command is zero, joystick and
// autopilot alike, the tractor brakes to a halt and stays; the gate opens over openTime (hold, fold and
// flash follow the formulas; the curtain sheet and the sparks follow the gate; the curtain node is off
// when it is open), the plate and the sign shrink away (backIn) and go inactive, the joystick fades
// out, the title pops up with a spring (backOut) and the confetti flies; `gateOpening` in the payment
// frame, `gateOpened` once, one opening time later (give or take a frame). Afterwards a real touch on
// the joystick area and an autopilot push move nothing. The screen UI is still on top of everything
// (Finale sits in the Hud group). Close-ups: the sealed gateway, the curtain folding (game paused),
// the finale in the normal camera (game paused) — the title must read in portrait and in landscape.
//
//   node tools/check-html.mjs <html|url> --scenario gate [--gpu]

import { gameWait, installAutopilot, runLegs } from './lib/autopilot.mjs';
import { FPS, RELEASE_CAMERA, closeUp, parkCamera } from './lib/camera.mjs';
import { installLoopProbe, loopState, setPurse, settleCoins } from './lib/loop-probe.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

const GATE_PROBE = `(() => {
  if (window.__gateProbe) return 'already';
  const zm = window.__zm, gate = zm.gate, tr = zm.tractor, move = zm.input, finale = zm.finaleView, joy = zm.joystick, cfg = zm.config.gate;
  const Sprite = cc.js.getClassByName('cc.Sprite');
  const curtain = cc.find('Level/GateCurtain'), sheet = curtain.getChildByName('Sheet'), sparks = curtain.getChildByName('Sparks');
  const sheetSprite = sheet.getComponent(Sprite), sparkSprite = sparks.getComponent(Sprite);
  const sheetHeight = sheet.getComponent(cc.js.getClassByName('cc.UITransform')).height;
  const plate = cc.find('Level/Spots/GatePad/Plate'), sign = cc.find('Level/Spots/GateSign/Plate');
  const plateRest = plate.scale.x, signRest = sign.scale.x;
  const title = cc.find('Canvas/Hud/Finale/Title'), pieces = cc.find('Canvas/Hud/Finale/Pieces');
  const base = cc.find('Canvas/Joystick/Base'), fade = base.getComponent(cc.js.getClassByName('cc.UIOpacity'));
  const draw = () => cc.director.root.device.numDrawCalls;
  const fold = (p) => { const s = Math.min(1, Math.max(0, (p - cfg.hold) / (1 - cfg.hold))); return s * s * (3 - 2 * s); };
  const q = window.__gateProbe = { frames: 0, clock: 0, paid: null, opening: null, opened: [], openFrame: -1, elapsed: 0,
    lockOff: 0, driveOff: 0, speedUp: 0, lastSpeed: null, speedAtPaid: null, stopClock: null, stopX: null, moved: 0,
    progressOff: 0, foldOff: 0, sheetOff: 0, sheetAlphaOff: 0, sparkOff: 0, sparkYOff: 0, curtainOffEarly: 0, curtainOnLate: 0,
    plateScales: [], signScales: [], plateActive: null, signActive: null, titleScales: [], titleActiveEarly: 0, titleFrom: null,
    maxFlying: 0, joyVisibility: [], drawsBefore: 0, drawsDuring: 0, drawsAfter: 0, maxTitle: 0, pieces: 0, piecesLayerOff: 0, checkedPieces: false };
  zm.events.on('padPaid', (e) => { if (e.padId === 'gate') q.paid = { frame: q.frames + 1, clock: q.clock, speed: tr.speed, x: tr.x, z: tr.z }; });
  zm.events.on('gateOpening', () => { q.opening = { frame: q.frames + 1, clock: q.clock }; q.openFrame = q.frames + 1; });
  zm.events.on('gateOpened', () => { q.opened.push({ frame: q.frames + 1, clock: q.clock, elapsed: q.elapsed }); });
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    const dt = Math.min(cc.game.deltaTime, 0.25);
    q.frames++;
    q.clock += dt;
    if (q.opening === null) q.drawsBefore = draw();
    if (q.paid !== null) {
      // From the frame of the payment on: no drive command, from anyone.
      if (!move.isLocked) q.lockOff++;
      if (move.x !== 0 || move.z !== 0) q.driveOff++;
      if (q.lastSpeed !== null && tr.speed > q.lastSpeed + 1e-9) q.speedUp++;
      q.lastSpeed = tr.speed;
      if (q.stopClock === null && tr.speed === 0) { q.stopClock = q.clock - q.paid.clock; q.stopX = tr.x; q.moved = Math.hypot(tr.x - q.paid.x, tr.z - q.paid.z); }
      if (q.stopX !== null && Math.abs(tr.x - q.stopX) > 1e-9) q.moved = 1e9;
    }
    if (q.openFrame >= 0) {
      if (q.frames > q.openFrame) q.elapsed += dt;
      const p = Math.min(1, q.elapsed / cfg.openTime), f = fold(p), flash = Math.sin(Math.PI * p);
      if (Math.abs(gate.progress - p) > 1e-9) q.progressOff++;
      if (Math.abs(gate.fold - f) > 1e-9) q.foldOff++;
      if (gate.phase === 'opening') {
        // The curtain follows the gate: the sheet folds up into the lintel while it fades, the sparks flash and drift up.
        if (Math.abs(sheet.scale.y - Math.max(0.001, 1 - f)) > 1e-9 || Math.abs(sheet.position.y - sheetHeight * f) > 1e-6) q.sheetOff++;
        const top = 255 * (1 - f);
        if (sheetSprite.color.a > top + 1.01 || sheetSprite.color.a < top * 0.9 - 1.01) q.sheetAlphaOff++;
        if (!sparks.active || Math.abs(sparkSprite.color.a - 255 * flash) > 1.01) q.sparkOff++;
        if (Math.abs(sparks.position.y - sheetHeight * p * 0.55) > 1e-6) q.sparkYOff++;
        if (!curtain.active) q.curtainOffEarly++;
      } else if (gate.phase === 'open') {
        if (curtain.active) q.curtainOnLate++;
      }
      if (q.plateScales.length < 80 && (plate.active || q.plateScales.length === 0)) q.plateScales.push(+(plate.scale.x / plateRest).toFixed(4));
      if (q.signScales.length < 80 && (sign.active || q.signScales.length === 0)) q.signScales.push(+(sign.scale.x / signRest).toFixed(4));
      q.plateActive = plate.active; q.signActive = sign.active;
      if (title.active && q.titleScales.length < 400) q.titleScales.push(+title.scale.x.toFixed(4));
      if (!finale.playing || !title.active) q.titleActiveEarly++;
      q.maxFlying = Math.max(q.maxFlying, finale.show.flying);
      if (finale.show.flying > 0) q.drawsDuring = Math.max(q.drawsDuring, draw());
      if (!q.checkedPieces && finale.show.flying > 0) {
        q.checkedPieces = true;
        q.pieces = pieces.children.length;
        for (const c of pieces.children) if (c.layer !== cc.Layers.Enum.UI_2D) q.piecesLayerOff++;
      }
      if (q.joyVisibility.length < 400) q.joyVisibility.push(+joy.visibility.toFixed(4));
      q.joyOpacity = fade.opacity;
      q.drawsAfter = draw();
    }
  });
  return 'installed';
})()`;

const sealed = () => `(() => { const c = cc.find('Level/GateCurtain'), s = c.getChildByName('Sheet'), p = c.getChildByName('Sparks'),
  Sprite = cc.js.getClassByName('cc.Sprite'), L = cc.js.getClassByName('cc.Label'), g = __zm.gate;
  return { phase: g.phase, curtain: c.active, sheet: s.active, scale: s.scale.y, alpha: s.getComponent(Sprite).color.a, sparks: p.active,
    title: cc.find('Canvas/Hud/Finale/Title').active, locked: __zm.input.isLocked, joy: __zm.joystick.isEnabled, visibility: __zm.joystick.visibility,
    plate: cc.find('Level/Spots/GatePad/Plate/Amount').getComponent(L).string, sign: cc.find('Level/Spots/GateSign/Plate/Amount').getComponent(L).string,
    playing: __zm.finaleView.playing, owed: __zm.pads.gate.owed, stored: __zm.pads.gate.stored, shown: __zm.pads.gate.shown }; })()`;

// Onto the gate pad (1.3, -12.2) from the start spot along z -11 and stand there.
const ONTO_GATE = [
  { name: 'gate pad: west', kind: 'goto', x: 3, z: -11, radius: 0.4 },
  { name: 'gate pad: stand', kind: 'stop', time: 3 },
  { name: 'gate pad: back east, out of the zone', kind: 'goto', x: 7.5, z: -11, radius: 0.6 },
  { name: 'gate pad: stop', kind: 'stop', time: 1 },
];
// Full speed through the pad, never letting go; the payment lands while it is moving.
const THROUGH_THE_PAD = [
  { name: 'through the pad: west', kind: 'push', dx: -1, dz: 0, time: 5 },
  { name: 'through the pad: (stop asked)', kind: 'stop', time: 0.3 },
];

export default async function gate(t) {
  await t.waitFor('!!(window.__zm && window.__zm.gate && window.__zm.finaleView)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(GATE_PROBE);
  const cfg = await t.evaluate('__zm.config.gate');
  cfg.confettiCount = await t.evaluate('__zm.config.finale.confetti.count');
  const price = await t.evaluate('__zm.config.economy.gatePrice');

  // 1. Sealed and waiting.
  const s0 = await t.evaluate(sealed());
  t.log(`start: ${JSON.stringify(s0)}`);
  t.check(s0.phase === 'closed' && s0.curtain && s0.sheet && s0.scale === 1 && s0.alpha >= 229 && !s0.sparks, 'the gateway is sealed: the curtain shown whole, no sparks');
  t.check(!s0.title && !s0.playing && !s0.locked && s0.joy && s0.visibility === 1, 'the finale is not there, the controls are on');
  t.check(s0.plate === String(price) && s0.sign === String(price), `the plate and the sign read ${price}`);
  await closeUp(t, 'gate-closed', 1.2, -13.4, 30);

  // 2. A partial payment of 290 stays; the 10 left are paid on a run through the pad.
  await setPurse(t, price - 10);
  await runLegs(t, 'partial payment', ONTO_GATE);
  const s1 = await settleCoins(t, 'partial payment');
  const p1 = await t.evaluate(sealed());
  t.log(`partial: the pad holds ${p1.stored} of ${price}, reads ${p1.plate}, purse ${s1.purse}`);
  t.check(p1.stored === price - 10 && p1.owed === 10 && p1.plate === '10' && p1.phase === 'closed' && !p1.locked, 'the partial payment stays; the gate is shut, the controls on');
  await setPurse(t, 30);

  // 3. The run through the pad: pause once the curtain is half way, then the finale a while later.
  await t.evaluate('__loopProbe.pauseWhen = () => __zm.gate.progress >= 0.55');
  await t.evaluate(`__ap.run(${JSON.stringify(THROUGH_THE_PAD)})`);
  await t.waitFor('__loopProbe.paused', 120000);
  const mid = await t.evaluate(`({ ...(${sealed()}), progress: __zm.gate.progress, fold: __zm.gate.fold, speed: __zm.tractor.speed, x: __zm.tractor.x, z: __zm.tractor.z,
    plateActive: cc.find('Level/Spots/GatePad/Plate').active, titleScale: cc.find('Canvas/Hud/Finale/Title').scale.x, flying: __zm.finaleView.show.flying })`);
  t.log(`half way: ${JSON.stringify(mid)}`);
  t.check(mid.phase === 'opening' && mid.locked && !mid.joy && mid.curtain && mid.sheet && mid.scale < 1 && mid.scale > 0.001 && mid.sparks,
    `mid-opening: locked, the curtain folding (sheet scale ${mid.scale.toFixed(3)}), the sparks on`);
  t.check(mid.title && mid.playing && mid.flying > 0, 'mid-opening: the title is up and the confetti flies');
  await t.evaluate(parkCamera(1.2, -13.3, 30));
  await t.frames(3);
  await t.shot('gate-folding');
  await t.evaluate(RELEASE_CAMERA);
  await t.frames(2);
  await t.shot('gate-folding-wide');
  await t.evaluate('(() => { __loopProbe.paused = false; cc.director.resume(); })()');
  const opening = await t.evaluate('__gateProbe.opening');
  await t.evaluate(`__loopProbe.pauseWhen = () => __gateProbe.clock >= ${opening.clock} + 1.3`);
  await t.waitFor('__loopProbe.paused', 120000);
  const fin = await t.evaluate(`({ title: cc.find('Canvas/Hud/Finale/Title').active, scale: cc.find('Canvas/Hud/Finale/Title').scale.x, flying: __zm.finaleView.show.flying,
    y: cc.find('Canvas/Hud/Finale/Title').position.y, hud: cc.find('Canvas/Hud').getComponent(cc.js.getClassByName('cc.UITransform')).height, phase: __zm.gate.phase })`);
  t.log(`finale: ${JSON.stringify(fin)}`);
  t.check(fin.title && fin.flying > 10 && fin.phase === 'open', `1.3 s in: the gate is open, the title is up, ${fin.flying} confetti pieces in the air`);
  await t.shot('finale');
  await t.evaluate('(() => { __loopProbe.paused = false; cc.director.resume(); })()');
  await t.waitFor('!__ap.running', 120000);
  await t.waitFor('!__zm.finaleView.show.busy', 60000);
  await gameWait(t, 0.5);
  await settleCoins(t, 'the end');
  await t.shot('finale-end');

  // 4. The verdict over every frame.
  const q = await t.evaluate('__gateProbe');
  const end = await loopState(t);
  const loop = await t.evaluate('({ coinsOff: __loopProbe.coinsOff, coinsOffAt: __loopProbe.coinsOffAt, hudOff: __loopProbe.hudOff })');
  const opened = q.opened[0];
  const took = opened ? opened.clock - q.opening.clock : NaN;
  const frameMax = await t.evaluate('__zm.config.time.maxFrameDt');
  t.log(`padPaid at frame ${q.paid?.frame} moving ${q.paid?.speed.toFixed(2)} u/s at (${q.paid?.x.toFixed(2)}, ${q.paid?.z.toFixed(2)}); opening frame ${q.opening?.frame}; ` +
    `opened ${took.toFixed(3)} s later; stopped ${q.stopClock?.toFixed(3)} s after paying, ${q.moved.toFixed(3)} units on`);
  t.check(!!q.paid && q.paid.speed > 3, `the gate was paid while the tractor was driving at full speed (${q.paid?.speed.toFixed(2)} u/s)`);
  t.check(q.lockOff === 0 && q.driveOff === 0, `from the frame of the payment on every frame: the controls locked, the drive command zero (autopilot never let go)`);
  t.check(q.speedUp === 0 && q.stopClock !== null && q.stopClock < 0.5 && q.moved < 0.6,
    `the tractor braked to a halt (${q.stopClock?.toFixed(3)} s, ${q.moved.toFixed(2)} units) and stayed`);
  t.check(q.opening && q.paid && q.opening.frame === q.paid.frame, 'gateOpening came in the frame of the payment');
  t.check(q.opened.length === 1 && took >= cfg.openTime - frameMax - 1e-9 && took <= cfg.openTime + frameMax + 1e-9,
    `gateOpened once, ${took.toFixed(3)} s after gateOpening (openTime ${cfg.openTime} s, give or take a frame)`);
  t.check(q.progressOff === 0 && q.foldOff === 0, 'every frame the gate progress and fold followed the clock and the formulas');
  t.check(q.sheetOff === 0 && q.sheetAlphaOff === 0 && q.sparkOff === 0 && q.sparkYOff === 0 && q.curtainOffEarly === 0 && q.curtainOnLate === 0,
    `every frame the curtain followed the gate (sheet ${q.sheetOff}, alpha ${q.sheetAlphaOff}, sparks ${q.sparkOff}/${q.sparkYOff}, off early ${q.curtainOffEarly}, on late ${q.curtainOnLate})`);
  const peak = (a) => Math.max(...a);
  t.log(`plate ${q.plateScales.slice(0, 20).join(' ')} | sign peak ${peak(q.signScales)} | active ${q.plateActive}/${q.signActive}`);
  t.check(!q.plateActive && !q.signActive && peak(q.plateScales) > 1 && peak(q.signScales) > 1 && q.plateScales.length > 3,
    `the plate and the sign shrank away with a backIn anticipation (peak ${peak(q.plateScales)}) and went inactive`);
  const ts = q.titleScales;
  t.log(`title scale: ${ts.slice(0, 24).join(' ')} ... last ${ts[ts.length - 1]}`);
  t.check(q.titleActiveEarly === 0 && ts.length > 10 && peak(ts) > 1 && peak(ts) < 1.2 && ts[0] < 0.5, `the title popped up with a spring (from ${ts[0]}, peak ${peak(ts)}) in the payment frame`);
  const settled = ts.slice(Math.floor(ts.length / 2));
  t.check(settled.every((v) => v > 0.99 && v < 1.06), `then it pulses between 1 and 1.05 (${Math.min(...settled)} .. ${Math.max(...settled)})`);
  t.check(q.maxFlying >= 20 && q.pieces === cfg.confettiCount && q.piecesLayerOff === 0, `confetti: up to ${q.maxFlying} pieces in the air, ${q.pieces} pooled, all on UI_2D`);
  const vis = q.joyVisibility;
  t.check(vis[0] <= 1 && vis[vis.length - 1] < 0.01 && vis.every((v, k) => k === 0 || v <= vis[k - 1] + 1e-9) && q.joyOpacity === 0,
    `the joystick faded out (${vis[0]} -> ${vis[vis.length - 1]}, opacity ${q.joyOpacity})`);
  // `drawsBefore` is the last frame before the payment: the tractor is at about the same place as during the finale.
  t.log(`draw calls: ${q.drawsBefore} in the frame before the payment (the gate sealed, the plate and the sign up), up to ${q.drawsDuring} during the finale, ${q.drawsAfter} at the end`);
  t.check(q.drawsDuring <= q.drawsBefore + 1, 'the finale (title and confetti) costs at most one draw call');
  t.check(q.drawsAfter < q.drawsBefore, 'with the curtain, the plate and the sign gone there are fewer draw calls than before');
  t.check(loop.coinsOff === 0 && loop.hudOff === 0, `the coin ledger held every frame (purse ${end.purse}, pads ${end.pads})`);

  // 5. The end is final: a touch on the joystick and an autopilot push move nothing.
  const still = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z, yaw: __zm.tractor.yaw })');
  const view = await t.evaluate(`(() => { const r = cc.game.canvas.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const at = { x: view.left + view.width * 0.5, y: view.top + view.height * 0.8 };
  await t.touch('touchStart', at.x, at.y);
  await t.frames(2);
  await t.touch('touchMove', at.x - 90, at.y - 90);
  await t.frames(2);
  await t.touch('touchMove', at.x - 190, at.y - 190);
  await gameWait(t, 0.8);
  const held = await t.evaluate('({ held: __zm.joystick.isHeld, sx: __zm.joystick.stick.x, sy: __zm.joystick.stick.y, ix: __zm.input.x, iz: __zm.input.z, speed: __zm.tractor.speed })');
  await t.touch('touchEnd', at.x, at.y);
  await runLegs(t, 'push after the end', [{ name: 'push', kind: 'push', dx: 1, dz: 0, time: 0.8 }, { name: 'stop', kind: 'stop', time: 0.3 }]);
  const after = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z, yaw: __zm.tractor.yaw })');
  t.check(!held.held && held.sx === 0 && held.sy === 0 && held.ix === 0 && held.iz === 0 && held.speed === 0, 'a touch dragged on the joystick area reads nothing: no stick, no drive command');
  t.check(after.x === still.x && after.z === still.z && after.yaw === still.yaw, 'and neither it nor an autopilot push moved the tractor');
  await checkUiOnTop(t);
  const fps = await t.evaluate(FPS(2000));
  t.log(`fps ${fps.toFixed(1)}`);
}
