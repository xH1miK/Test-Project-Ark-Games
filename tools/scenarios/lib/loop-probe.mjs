// The core loop's invariants, watched in the page on every frame and every shredder step (scenarios
// core-loop and long-run). Per shredder step: a load is taken only while the tractor's pivot is in
// the square zone, and all of it at once; throat balls are counted by where the tractor was. Per frame
// (after lateUpdate, so the views have drawn): every shredded ball paid exactly 2 (purse + coins still
// in the air + coins on the pay pads or flying to them = 2 x shredded + coins a scenario granted with
// grantCoins), the HUD shows the purse, every held ball is exactly one of carried /
// flying / shredded, flying balls are drawn where the field has them; every 4th frame every ball is
// drawn where the field has it and the shredded ones are hidden; the counter's swell and the rollers
// are tracked. Allocates nothing per frame, and
// keeps at most HAND_IN_LOG hand-ins, so a long run does not grow the heap by itself.
// `__loopProbe.pauseWhen` (a function) pauses the game after the frame it first returns true.

export const LOOP_PROBE = `(() => {
  if (window.__loopProbe) return 'already';
  const HAND_IN_LOG = 1000;
  const zm = window.__zm, b = zm.balls, sh = zm.shredder, tr = zm.tractor, bucket = zm.bucket, view = zm.ballView, hud = zm.coinHud;
  const half = zm.config.shredder.zoneHalf, at = cc.find('Level/Shredder').worldPosition, pose = { x: at.x, z: at.z };
  const perBall = zm.config.economy.coinsPerBall;
  const pads = [zm.pads.upgrade, zm.pads.gate];
  const p = window.__loopProbe = { granted: 0, frames: 0, handIns: [], handInCount: 0, outOfZone: 0, notWhole: 0, throatOutside: 0, throatInside: 0,
    shreddedEvents: 0, earned: 0, coinsOff: 0, coinsOffAt: null, hudOff: 0, labelOff: 0, stray: 0, strayAt: null,
    drawnOff: 0, syncOff: 0, syncChecks: 0, hiddenWrong: 0, maxPunch: 1, maxRoller: 0, rollerTurned: false, maxInFlight: 0, pauseWhen: null, paused: false };
  zm.events.on('ballsShredded', (e) => { p.shreddedEvents += e.count; });
  zm.events.on('coinsEarned', (e) => { p.earned += e.amount; });
  // Per shredder step: where the tractor's pivot was when a load went or the throat swallowed.
  const step = sh.step.bind(sh);
  sh.step = (dt) => {
    const handed = sh.handedIn, swallowed = sh.swallowed, load = bucket.count;
    step(dt);
    const dx = tr.x - pose.x, dz = tr.z - pose.z, inZone = Math.abs(dx) <= half + 1e-9 && Math.abs(dz) <= half + 1e-9;
    if (sh.handedIn > handed) {
      p.handInCount++;
      if (p.handIns.length < HAND_IN_LOG) {
        p.handIns.push({ frame: p.frames, clock: window.__ap ? window.__ap.clock : 0, count: sh.handedIn - handed, load, left: bucket.count, dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
      }
      if (!inZone) p.outOfZone++;
      if (sh.handedIn - handed !== load || bucket.count !== 0) p.notWhole++;
    }
    if (sh.swallowed > swallowed) {
      if (inZone) p.throatInside += sh.swallowed - swallowed;
      else p.throatOutside += sh.swallowed - swallowed;
    }
  };
  const roller = cc.find('Level/Shredder/SM_Shred/roll_1'), rest = roller.rotation.clone();
  const drawn = { x: 0, y: 0, z: 0, radius: 0 };
  const carried = new Uint8Array(b.capacity);
  // EVENT_AFTER_UPDATE comes after lateUpdate: the views have drawn this frame by then.
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    p.frames++;
    const owed = perBall * sh.shredded + p.granted;
    let have = zm.purse.total + zm.coins.pending;
    for (let k = 0; k < pads.length; k++) have += pads[k].stored + pads[k].inFlight;
    if (owed !== have) { p.coinsOff++; if (!p.coinsOffAt) p.coinsOffAt = { frame: p.frames, owed, have }; }
    if (hud.shown !== zm.purse.total) p.hudOff++;
    if (hud.amount.string !== String(zm.purse.total)) p.labelOff++;
    carried.fill(0);
    for (let k = 0; k < bucket.count; k++) carried[bucket.index[k]] = 1;
    for (let i = 0; i < b.count; i++) {
      const roles = carried[i] + (sh.flights.isFlying(i) ? 1 : 0) + (b.isRemoved(i) ? 1 : 0);
      if (b.isHeld(i) ? roles !== 1 : roles !== 0) { p.stray++; if (!p.strayAt) p.strayAt = { frame: p.frames, i, roles, held: b.isHeld(i) }; }
    }
    for (let k = 0; k < sh.flights.count; k++) {
      const i = sh.flights.index[k];
      view.data.readBall(i, drawn);
      p.drawnOff = Math.max(p.drawnOff, Math.abs(drawn.x - b.x[i]), Math.abs(drawn.y - b.y[i]), Math.abs(drawn.z - b.z[i]));
      if (!(drawn.radius > 0)) p.hiddenWrong++;
    }
    // Every 4th frame all of them: drawn where the field has them (free, carried, flying), shredded hidden.
    if (p.frames % 4 === 0) {
      for (let i = 0; i < b.count; i++) {
        view.data.readBall(i, drawn);
        if (b.isRemoved(i)) {
          if (drawn.radius !== 0) p.hiddenWrong++;
          continue;
        }
        if (!(drawn.radius > 0)) p.hiddenWrong++;
        p.syncOff = Math.max(p.syncOff, Math.abs(drawn.x - b.x[i]), Math.abs(drawn.y - b.y[i]), Math.abs(drawn.z - b.z[i]));
      }
      p.syncChecks++;
    }
    p.maxInFlight = Math.max(p.maxInFlight, sh.inFlight);
    p.maxRoller = Math.max(p.maxRoller, sh.rollerSpeed);
    if (!p.rollerTurned && Math.abs(cc.Quat.dot(roller.rotation, rest)) < 0.999) p.rollerTurned = true;
    p.maxPunch = Math.max(p.maxPunch, hud.punchNode.scale.x);
    if (p.pauseWhen && p.pauseWhen()) {
      p.pauseWhen = null;
      p.paused = true;
      cc.director.pause(); // logic stops, rendering goes on
    }
  });
  return 'installed';
})()`;

/** Installs the probe (once per page load). */
export const installLoopProbe = (t) => t.evaluate(LOOP_PROBE);

/** The loop's state right now. */
export const loopState = (t) => t.evaluate(`({ purse: __zm.purse.total, pending: __zm.coins.pending, shown: __zm.coinHud.shown, handed: __zm.shredder.handedIn,
  swallowed: __zm.shredder.swallowed, shredded: __zm.shredder.shredded, inFlight: __zm.shredder.inFlight, bucket: __zm.bucket.count,
  capacity: __zm.bucket.capacity, count: __zm.balls.count, removed: __zm.balls.removedCount, held: __zm.balls.heldCount,
  x: __zm.tractor.x, z: __zm.tractor.z, inZone: __zm.shredder.inZone,
  pads: __zm.pads.upgrade.stored + __zm.pads.upgrade.inFlight + __zm.pads.gate.stored + __zm.pads.gate.inFlight,
  granted: window.__loopProbe ? __loopProbe.granted : 0 })`);

/** Waits until everything taken has landed and every coin has arrived; returns the state then. */
export async function settleCoins(t, label) {
  const done = await t.waitFor('__zm.shredder.inFlight === 0 && __zm.coins.pending === 0 && __zm.pads.upgrade.inFlight === 0 && __zm.pads.gate.inFlight === 0', 30000)
    .catch(() => false);
  t.check(done, `${label}: every ball landed and every coin arrived`);
  return loopState(t);
}

/**
 * The verdict over every frame and step so far (`end` = loopState once the coins have settled).
 * Logs the hand-in sizes (up to `listed` of them) and returns the probe.
 */
export async function checkLoopProbe(t, end, listed = 40) {
  const p = await t.evaluate(`(() => { const p = __loopProbe; return { ...p, handIns: p.handIns.slice(0, ${listed}).map((h) => h.count), pauseWhen: null }; })()`);
  t.log(`over ${p.frames} frames: ${p.handInCount} hand-ins (${p.handIns.join(', ')}${p.handInCount > p.handIns.length ? ', ...' : ''}), ` +
    `${end.handed} + ${end.swallowed} balls shredded, purse ${end.purse}; drawn off ${p.drawnOff.toExponential(1)}; max punch ${p.maxPunch.toFixed(3)}; rollers up to ${p.maxRoller.toFixed(2)} of full speed`);
  t.check(p.outOfZone === 0, 'a load was taken only while the tractor stood in the zone');
  t.check(p.notWhole === 0, 'every hand-in took the whole load at once');
  t.check(p.shreddedEvents === end.shredded && p.earned === 2 * end.shredded, `events: ballsShredded ${p.shreddedEvents}, coinsEarned ${p.earned}`);
  t.check(p.coinsOff === 0, `after every frame: purse + coins in the air + on the pads = 2 x shredded${p.granted ? ` + ${p.granted} granted` : ''} ` +
    `${p.coinsOffAt ? JSON.stringify(p.coinsOffAt) : ''}`);
  t.check(p.hudOff === 0 && p.labelOff === 0, 'after every frame the HUD showed the purse');
  t.check(p.stray === 0, `every held ball was exactly one of carried / flying / shredded ${p.strayAt ? JSON.stringify(p.strayAt) : ''}`);
  t.check(end.held === end.bucket + end.inFlight + end.removed && end.removed === end.shredded, `held ${end.held} = ${end.bucket} carried + ${end.inFlight} flying + ${end.removed} shredded`);
  t.check(p.drawnOff < 1e-5 && p.hiddenWrong === 0, `flying balls drawn where the field has them (worst ${p.drawnOff.toExponential(1)}), shredded ones hidden`);
  t.check(p.syncChecks > 0 && p.syncOff < 1e-5, `every 4th frame all balls drawn where the field has them (${p.syncChecks} frames, worst ${p.syncOff.toExponential(1)})`);
  t.check(p.maxPunch > 1.1, `the counter swelled when coins arrived (max scale ${p.maxPunch.toFixed(3)})`);
  t.check(p.maxRoller === 1 && p.rollerTurned, 'the rollers spun up to full speed while grinding');
  return p;
}

/**
 * Puts coins straight into the purse, or takes them out for a negative amount (a scenario's shortcut
 * to a price); the probe's ledger counts them as granted.
 */
export const grantCoins = (t, amount) => t.evaluate(`(() => { const n = ${amount};
  const moved = n >= 0 ? (__zm.purse.add(n), n) : -__zm.purse.spend(-n);
  if (window.__loopProbe) __loopProbe.granted += moved; })()`);

/** Sets the purse to `total` coins through grantCoins. */
export async function setPurse(t, total) {
  const now = await t.evaluate('__zm.purse.total');
  if (now !== total) await grantCoins(t, total - now);
}
