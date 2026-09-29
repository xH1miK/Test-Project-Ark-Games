// The tutorial watched in the page on every frame (scenarios tutorial and full-run): the step and the
// target against the rule written down again from the world (not from TutorialFlow), the markers'
// nodes against the model, the arrow's turn rate, the arrow on screen. Needs the ?qa hooks.

const TUT_PROBE = `(() => {
  if (window.__tutProbe) return 'already';
  const zm = window.__zm, tut = zm.tutorial, mk = zm.markers, tr = zm.tractor, cfg = zm.config.tutorial, maxDt = zm.config.time.maxFrameDt;
  const arrow = cc.find('Tutorial/PathArrow'), pointer = cc.find('Tutorial/Pointer');
  const cam = cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera'));
  const shredderAt = cc.find('Level/Shredder').worldPosition;
  const fwd = new cc.Vec3(), scr = new cc.Vec3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // The rule, written down again from the world (not from TutorialFlow): what the markers should point at.
  const expect = () => {
    if (zm.gate.phase !== 'closed') return null;
    const up = zm.pads.upgrade, gp = zm.pads.gate, coins = zm.purse.total;
    const aim = (pad, id) => (coins <= 0 && pad.missing > 0 ? 'shredder' : id);
    if (up.closed || tr.tier >= tr.maxTier) return aim(gp, 'gate');
    if (up.shown) return aim(up, 'upgrade');
    return 'shredder';
  };
  const q = window.__tutProbe = { frames: 0, clock: 0, steps: [], targets: [], lastStep: null, lastTarget: undefined, lastYaw: 0, lastShown: false,
    targetOff: 0, targetOffAt: null, shownOff: 0, arrowNodeOff: 0, pointerNodeOff: 0, arrowPosOff: 0, arrowAnchorOff: 0, arrowRotOff: 0, pointerPosOff: 0,
    pointerHeightOff: 0, turnOff: 0, turnWorst: 0, offscreen: 0, shownFrames: 0, pointerFrames: 0, doneShown: 0, minY: 1e9, maxY: -1e9 };
  // After lateUpdate: the markers have moved and the views have applied them.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    const dt = Math.min(cc.game.deltaTime, maxDt);
    q.frames++;
    q.clock += dt;
    const id = tut.target ? tut.target.id : null;
    if (tut.step !== q.lastStep) { q.steps.push({ step: tut.step, frame: q.frames, clock: +q.clock.toFixed(3) }); q.lastStep = tut.step; }
    if (id !== q.lastTarget) {
      if (q.targets.length < 60) q.targets.push({ id, frame: q.frames, clock: +q.clock.toFixed(3), purse: zm.purse.total });
      q.lastTarget = id;
    }
    const want = expect();
    if (id !== want) { q.targetOff++; if (!q.targetOffAt) q.targetOffAt = { frame: q.frames, id, want, step: tut.step }; }
    if (mk.arrowShown !== (id !== null) || mk.pointerShown !== (id !== null)) q.shownOff++;
    if (arrow.active !== mk.arrowShown) q.arrowNodeOff++;
    if (pointer.active !== mk.pointerShown) q.pointerNodeOff++;
    if (tut.step === 'done' && (arrow.active || pointer.active)) q.doneShown++;
    if (mk.arrowShown) {
      q.shownFrames++;
      const p = arrow.worldPosition;
      if (Math.hypot(p.x - mk.arrowX, p.y - mk.arrowY, p.z - mk.arrowZ) > 1e-4) q.arrowPosOff++;
      const ax = tr.x + Math.sin(mk.arrowYaw) * cfg.arrow.forward, az = tr.z + Math.cos(mk.arrowYaw) * cfg.arrow.forward;
      if (Math.hypot(p.x - ax, p.z - az) > 1e-4 || Math.abs(p.y - cfg.arrow.height) > 1e-4) q.arrowAnchorOff++;
      cc.Vec3.transformQuat(fwd, cc.Vec3.UNIT_Z, arrow.worldRotation);
      if (Math.abs(fwd.x - Math.sin(mk.arrowYaw)) > 1e-4 || Math.abs(fwd.z - Math.cos(mk.arrowYaw)) > 1e-4 || Math.abs(fwd.y) > 1e-4) q.arrowRotOff++;
      if (q.lastShown && dt > 0) {
        const rate = Math.abs(wrap(mk.arrowYaw - q.lastYaw)) / dt; // rad/s
        q.turnWorst = Math.max(q.turnWorst, rate);
        if (rate > cfg.arrow.turnSpeed * Math.PI / 180 + 1e-4) q.turnOff++;
      }
      cam.worldToScreen(p, scr);
      const cw = cam.camera.width, ch = cam.camera.height;
      if (scr.x < 0 || scr.x > cw || scr.y < 0 || scr.y > ch) q.offscreen++;
    }
    q.lastShown = mk.arrowShown;
    q.lastYaw = mk.arrowYaw;
    if (mk.pointerShown && id) {
      q.pointerFrames++;
      const at = id === 'shredder' ? shredderAt : zm.pads[id], pp = pointer.worldPosition;
      if (Math.abs(pp.x - at.x) > 1e-4 || Math.abs(pp.z - at.z) > 1e-4) q.pointerPosOff++;
      const h = id === 'shredder' ? cfg.pointer.shredderHeight : cfg.pointer.padHeight;
      if (Math.abs(pp.y - h) > cfg.pointer.bob + 1e-4) q.pointerHeightOff++;
      q.minY = Math.min(q.minY, pp.y - h);
      q.maxY = Math.max(q.maxY, pp.y - h);
    }
  });
  return 'installed';
})()`;

/** Installs the probe (once per page load). */
export const installTutorialProbe = (t) => t.evaluate(TUT_PROBE);

/**
 * The verdict over every frame so far: the steps came in order and once each, the target was the
 * rule's on every frame, the nodes agreed with the model, the arrow turned no faster than its limit
 * (and did turn), the pointer bobbed, the arrow stayed on screen. Returns the probe.
 */
export async function checkTutorialProbe(t, cfg) {
  const q = await t.evaluate('__tutProbe');
  const steps = q.steps.map((s) => s.step).join(' -> ');
  t.log(`steps: ${q.steps.map((s) => `${s.step}@${s.clock}s`).join(' -> ')}`);
  t.log(`targets: ${q.targets.map((x) => `${x.id}@${x.clock}s(purse ${x.purse})`).join(' -> ')}`);
  t.log(`over ${q.frames} frames (${q.clock.toFixed(1)} s): the arrow was up in ${q.shownFrames}, the pointer in ${q.pointerFrames}; the arrow turned at most ${(q.turnWorst * 180 / Math.PI).toFixed(0)} deg/s; ` +
    `the pointer bobbed ${q.minY.toFixed(3)} .. ${q.maxY.toFixed(3)} around its height; off screen in ${q.offscreen} frames`);
  t.check(steps === 'sell -> upgrade -> gate -> done', `the steps came in order, once each: ${steps}`);
  t.check(q.targetOff === 0, `every frame the target was the rule's (${q.targetOffAt ? JSON.stringify(q.targetOffAt) : 'never off'})`);
  t.check(q.shownOff === 0 && q.arrowNodeOff === 0 && q.pointerNodeOff === 0 && q.doneShown === 0, 'the markers were shown exactly while there was a target, and their nodes agreed');
  t.check(q.arrowPosOff === 0 && q.arrowAnchorOff === 0 && q.arrowRotOff === 0,
    `every frame the arrow node was where the model has it: ahead of the tractor by ${cfg.arrow.forward}, ${cfg.arrow.height} up, facing its yaw (${q.arrowPosOff}/${q.arrowAnchorOff}/${q.arrowRotOff} off)`);
  t.check(q.turnOff === 0, `the arrow never turned faster than ${cfg.arrow.turnSpeed} deg/s (fastest ${(q.turnWorst * 180 / Math.PI).toFixed(1)})`);
  t.check(q.turnWorst * 180 / Math.PI > 60, 'and it did turn: the route made it swing');
  t.check(q.pointerPosOff === 0 && q.pointerHeightOff === 0, 'every frame the pointer stood over its target at its height +- the bob');
  t.check(q.maxY - q.minY > cfg.pointer.bob, `the pointer bobbed (${(q.maxY - q.minY).toFixed(3)} peak to peak of ${2 * cfg.pointer.bob})`);
  t.check(q.offscreen === 0, 'the arrow was on screen every frame it was shown');
  return q;
}
