// Full run (M12): the whole game from a fresh load, played by an autopilot the way a careful player
// plays it, with no coin put in from outside (no grantCoins / setPurse; the probe's ledger has 0
// granted): tier-1 rounds (fill up near the next tour point, hand in) until the purse can pay the
// upgrade pad -> onto the pad -> tier 2 -> tier-2 rounds (60 a load) until it can pay the gate pad ->
// onto the gate pad, stand until the gate opens -> "GATE OPEN!" with the confetti. The rounds are
// long-run's (roundLegs / pickFillTarget); the pad visits are this scenario's (upgradeLegs, gateLegs).
// tools/bench/full-run.mjs and tools/test/full-run.test.mjs replay the same run on the pure models.
//
// Recorded: the game time and the state at each milestone (first scoop, first hand-in, the upgrade
// pad showing up, first coin onto each pad, tier 2, both pads paid, the gate opening and open, the
// title), the rounds (balls, coins), the tutorial's steps and targets (lib/tutorial-probe.mjs: the
// rule written down again from the world, checked on every frame), the core loop's invariants on
// every frame (lib/loop-probe.mjs; here the gate ends up open, not shut), FPS / ball step / draw calls
// per phase (lib/run-metrics.mjs), draw calls at every shot, the live JS heap at the start and the
// end. Shots are taken with the game paused at the moments of the run (a page-side trigger pauses
// on a condition, this side takes the shot and resumes), so they show the frame the player saw.
//
// Times are game time (the autopilot's clock: frame times clamped as GameRoot does) from the first
// frames of the page; a leg-switch costs the bot a few frames while this side decides.
//
//   node tools/check-html.mjs <html|url> --scenario full-run [--gpu]

import { installAutopilot } from './lib/autopilot.mjs';
import { FPS } from './lib/camera.mjs';
import { checkLoopProbe, installLoopProbe, loopState, settleCoins } from './lib/loop-probe.mjs';
import { METRICS, installSweep } from './lib/run-metrics.mjs';
import { gateLegs, roundLegs, upgradeLegs } from './lib/sweep.mjs';
import { checkTutorialProbe, installTutorialProbe } from './lib/tutorial-probe.mjs';
import { checkUiOnTop } from './lib/ui-layers.mjs';

/** Budgets: one ball step (as long-run), draw calls at any moment of the run. */
const STEP_BUDGET_MS = 2.5;
const DRAW_BUDGET = 22;
/** The heap may not grow by more than this over the run (a short run: JIT and warm-up included). */
const HEAP_GROWTH_LIMIT = 4_000_000;

/**
 * Page side: the milestone recorder and the shot triggers. `__run.marks[name]` = { clock, shredded,
 * purse, tier } at the first time of each event; `__snaps` pauses the game (after the frame) when the
 * first not-yet-taken shot's condition holds, `pending` names it until this side has taken the shot.
 */
const RUN_PROBE = `(() => {
  if (window.__run) return 'already';
  const zm = window.__zm, ap = window.__ap, pads = zm.pads, device = cc.director.root.device;
  const marks = {}, run = window.__run = { marks, gateTrip: false, granted0: window.__loopProbe ? __loopProbe.granted : 0 };
  const mark = (name) => { if (!marks[name]) marks[name] = { clock: ap.clock, shredded: zm.shredder.shredded, purse: zm.purse.total, tier: zm.tractor.tier }; };
  zm.events.on('ballScooped', () => mark('firstScoop'));
  zm.events.on('purseChanged', () => mark('firstCoins'));
  zm.events.on('loadHandedIn', () => mark('firstHandIn'));
  zm.events.on('coinsSpent', ({ padId }) => mark(padId + 'PayStart'));
  zm.events.on('tierChanged', ({ tier }) => mark('tier' + tier));
  zm.events.on('padPaid', ({ padId }) => mark(padId + 'Paid'));
  zm.events.on('gateOpening', () => mark('gateOpening'));
  zm.events.on('gateOpened', () => mark('gateOpened'));
  const since = (name) => (marks[name] ? ap.clock - marks[name].clock : -1);
  const gatePad = pads.gate, tr = zm.tractor;
  const list = [
    ['run-02-first-scoop', () => tr.tier === 1 && zm.bucket.count >= 5 && !marks.firstHandIn],
    ['run-03-first-handin', () => since('firstHandIn') > 0.3],
    ['run-04-upgrade-pad-shown', () => tr.tier === 1 && since('upgradePad') > 0.6],
    ['run-05-upgrade-paying', () => tr.tier === 1 && pads.upgrade.inFlight > 0],
    ['run-06-tier2-swell', () => since('tier2') > 0.18],
    ['run-07-t2-bucket-full', () => tr.tier === 2 && zm.bucket.count >= 55 && !marks.gatePayStart],
    ['run-08-t2-handin', () => tr.tier === 2 && zm.shredder.inFlight >= 25 && !marks.gatePayStart],
    ['run-09-gate-approach', () => run.gateTrip && zm.gate.phase === 'closed' && Math.hypot(tr.x - gatePad.x, tr.z - gatePad.z) < 8],
    ['run-10-gate-paying', () => zm.gate.phase === 'closed' && gatePad.inFlight > 0],
    ['run-11-gate-opening', () => zm.gate.phase === 'opening' && zm.gate.progress > 0.5],
    ['run-12-finale', () => since('gateOpened') > 0.5],
    ['run-13-end', () => since('gateOpened') > 2.5],
  ].map(([name, when]) => ({ name, when, fired: false }));
  const snaps = window.__snaps = { list, pending: null, taken: [] };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    if (pads.upgrade.shown) mark('upgradePad');
    if (snaps.pending) return;
    for (const s of list) {
      if (s.fired || !s.when()) continue;
      s.fired = true;
      snaps.pending = { name: s.name, clock: ap.clock, tier: tr.tier, step: zm.tutorial.step, purse: zm.purse.total, shredded: zm.shredder.shredded, load: zm.bucket.count };
      snaps.pausedAt = performance.now();
      cc.director.pause(); // logic stops, rendering goes on
      break;
    }
  });
  snaps.draws = () => device.numDrawCalls;
  // Resuming: the FPS window in progress does not count the time spent paused (no update ran in it).
  snaps.resume = () => { const m = window.__runMetrics; if (m) m.windowT0 += performance.now() - snaps.pausedAt; snaps.pending = null; cc.director.resume(); };
  return 'installed';
})()`;

/** The state the round loop decides on. */
const STATE = `(() => { const zm = __zm, up = zm.pads.upgrade, gp = zm.pads.gate, tr = zm.tractor;
  return { gate: zm.gate.phase, tier: tr.tier, x: tr.x, z: tr.z, purse: zm.purse.total, pending: zm.coins.pending,
    upgradeClosed: up.closed, goalShown: up.closed ? gp.shown : up.shown, missing: up.closed ? gp.missing : up.missing }; })()`;

/** Pauses, takes a shot of the frame the player sees, resumes. Returns the draw calls of that frame. */
async function snapNow(t, name, extra = {}) {
  await t.evaluate('cc.director.pause()');
  await t.frames(2);
  const draws = await t.evaluate('__snaps.draws()');
  await t.shot(name);
  await t.evaluate('cc.director.resume()');
  await t.frames(1);
  return { name, draws, ...extra };
}

/**
 * Drives `legs`, and takes a shot whenever a page-side trigger has paused the game; returns the leg
 * results once the autopilot is done. `until` (a page expression) ends the wait instead, for after
 * the legs.
 */
async function pump(t, done, taken, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const s = await t.evaluate('({ pending: window.__snaps.pending, done: !!(' + done + ') })');
    if (s.pending) {
      await t.frames(2); // paused: the same frame drawn again
      const draws = await t.evaluate('__snaps.draws()');
      await t.shot(s.pending.name);
      taken.push({ ...s.pending, draws });
      await t.evaluate('__snaps.resume()');
      continue;
    }
    if (s.done) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${done}`);
    await t.sleep(40);
  }
}

async function drive(t, legs, taken, timeoutMs = 150000) {
  await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
  await pump(t, '!__ap.running', taken, timeoutMs);
  return t.evaluate('__ap.results');
}

export default async function fullRun(t) {
  await t.waitFor('!!(window.__zm && window.__zm.tutorial && window.__zm.finaleView && window.__zm.pads && window.__zm.ballView && window.__zm.coinHud)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await installTutorialProbe(t);
  await t.evaluate(METRICS);
  const shredder = await installSweep(t);
  await t.evaluate(`(() => { __ap.until.upgraded = () => __zm.tractor.tier >= 2; __ap.until.gateOpen = () => __zm.gate.phase !== 'closed'; })()`);
  await t.evaluate(RUN_PROBE);
  const cfg = await t.evaluate('__zm.config.tutorial');
  const eco = await t.evaluate('__zm.config.economy');
  const gateCfg = await t.evaluate('__zm.config.gate');
  const upgradePad = await t.evaluate('({ x: __zm.pads.upgrade.x, z: __zm.pads.upgrade.z })');
  const gatePad = shredder.gate;

  // The start: a fresh scene, T1, purse 0, no upgrade pad yet, the tutorial on its first step.
  await t.frames(10);
  const start = await t.evaluate(`({ ...(${STATE}), step: __zm.tutorial.step, target: __zm.tutorial.target && __zm.tutorial.target.id, count: __zm.balls.count,
    upgradeShown: __zm.pads.upgrade.shown, controls: __zm.input.isLocked, title: cc.find('Canvas/Hud/Finale/Title').active })`);
  t.log(`start: ${JSON.stringify(start)}`);
  t.check(start.gate === 'closed' && start.tier === 1 && start.purse === 0 && !start.upgradeShown && !start.controls && !start.title, 'a fresh start: gate shut, tier 1, purse 0, no upgrade pad yet, controls on, no finale');
  t.check(start.step === 'sell' && start.target === 'shredder', 'the tutorial starts on Sell, pointing at the shredder');
  const taken = [];
  taken.push(await snapNow(t, 'run-01-start'));
  const heap = [{ label: 'start', used: (await t.heap()).usedSize, clock: await t.evaluate('__ap.clock') }];
  await t.evaluate("__runMetrics.begin('T1')");
  const clock0 = await t.evaluate('(__run.clock0 = __ap.clock)'); // the bot's first frame: game time 0 of the tables

  // The run. A pad is visited only when the purse, with the coins still in the air, holds what it lacks.
  const rounds = [];
  const trips = [];
  let round = 0;
  let lastTrip = -1;
  let phase = 'T1';
  const failed = [];
  while (round < 60) {
    const s = await t.evaluate(STATE);
    if (s.gate !== 'closed') break;
    if (lastTrip !== round && s.goalShown && s.purse + s.pending >= s.missing) {
      lastTrip = round;
      const toGate = s.upgradeClosed;
      if (toGate) await t.evaluate('__run.gateTrip = true');
      const legs = toGate ? gateLegs(s, shredder, gatePad) : upgradeLegs(s, shredder, upgradePad);
      const results = await drive(t, legs, taken, 60000);
      trips.push({ pad: toGate ? 'gate' : 'upgrade', round, legs: results });
      t.log(`trip to the ${toGate ? 'gate' : 'upgrade'} pad (purse ${s.purse} + ${s.pending} in the air, pad lacks ${s.missing}): ${results.map((l) => `${l.name} -> ${l.reason} in ${l.t}s`).join('; ')}`);
      if (!toGate && phase === 'T1') {
        await t.evaluate("__runMetrics.end(); __runMetrics.begin('T2')");
        phase = 'T2';
      }
      continue;
    }
    const [fill, sell] = await drive(t, roundLegs(round, s.tier - 1, shredder), taken);
    const now = await loopState(t);
    const ok = fill.ok && fill.reason === 'full' && fill.load === fill.capacity && sell.ok && sell.reason === 'inZone' && sell.sold >= fill.load;
    if (!ok) failed.push(round);
    rounds.push({ round, tier: s.tier, fill, sell, shredded: now.shredded, purse: now.purse });
    t.log(`T${s.tier} round ${String(round).padStart(2)}: ${fill.name} -> ${fill.reason} in ${fill.t}s (${fill.picks} picks), ${fill.load} of ${fill.capacity} in the bucket; ` +
      `sold ${sell.sold} after ${sell.t}s at (${sell.x}, ${sell.z}); shredded ${now.shredded}, purse ${now.purse} + ${now.pending} in the air${ok ? '' : '  <-- not a full load sold whole'}`);
    round++;
  }
  await t.evaluate('__runMetrics.end()');

  // The gate is open (or opening): the finale. Wait for the last shots, then let everything settle.
  await t.evaluate("__runMetrics.begin('finale')");
  await pump(t, "!!(__run.marks.gateOpened && __ap.clock >= __run.marks.gateOpened.clock + 2.8)", taken, 30000);
  await t.evaluate('__runMetrics.end()');
  const end = await settleCoins(t, 'end of the run');
  heap.push({ label: 'end', used: (await t.heap()).usedSize, clock: await t.evaluate('__ap.clock') });
  const fpsRest = await t.evaluate(FPS(2000));
  const drawsRest = await t.evaluate('cc.director.root.device.numDrawCalls');

  // Milestones.
  const run = await t.evaluate('({ marks: __run.marks, granted: __loopProbe.granted, snaps: __snaps.list.map((s) => [s.name, s.fired]) })');
  const m = run.marks;
  const at = (name) => (m[name] ? m[name].clock - clock0 : undefined);
  const row = (label, name) => (m[name] ? `  ${label.padEnd(24)} ${at(name).toFixed(2).padStart(6)} s   shredded ${String(m[name].shredded).padStart(4)}   purse ${String(m[name].purse).padStart(4)}   tier ${m[name].tier}` : `  ${label.padEnd(24)} -`);
  t.log([`milestones (game time from the bot's first frame, ${clock0.toFixed(2)} s after the page's first frames):`,
    row('first ball scooped', 'firstScoop'), row('first hand-in', 'firstHandIn'), row('upgrade pad shows up', 'upgradePad'), row('first coins in purse', 'firstCoins'),
    row('first coin onto upgrade', 'upgradePayStart'), row('upgrade paid = tier 2', 'upgradePaid'), row('first coin onto gate', 'gatePayStart'), row('gate paid', 'gatePaid'),
    row('gate starts to open', 'gateOpening'), row('gate open', 'gateOpened')].join('\n'));
  const per = (tier) => rounds.filter((r) => r.tier === tier);
  t.log(`rounds: ${per(1).length} with tier 1 (loads ${per(1).map((r) => r.sell.sold).join(' ')}), ${per(2).length} with tier 2 (loads ${per(2).map((r) => r.sell.sold).join(' ')}); ` +
    `shredded ${end.shredded} of ${end.count} balls (handed in ${end.handed}, throat ${end.swallowed}), purse ${end.purse} + pads ${end.pads} = ${end.purse + end.pads} coins earned`);

  // Verdicts.
  t.check(failed.length === 0, `every round filled the bucket and sold the full load as it entered the zone${failed.length ? ` (not: rounds ${failed.join(', ')})` : ''}`);
  t.check(trips.length === 2 && trips[0].pad === 'upgrade' && trips[1].pad === 'gate' && trips.every((tr) => tr.legs.every((l) => l.ok)), `two pad visits, the upgrade and then the gate, every leg done (${JSON.stringify(trips.map((tr) => [tr.pad, tr.legs.map((l) => l.reason)]))})`);
  t.check(run.granted === 0, 'no coin came from outside: nothing was granted to the purse');
  const order = ['firstScoop', 'firstHandIn', 'firstCoins', 'upgradePayStart', 'upgradePaid', 'gatePayStart', 'gatePaid', 'gateOpened'];
  t.check(order.every((k) => m[k]), `every milestone happened (${order.filter((k) => !m[k]).join(', ') || 'all'})`);
  t.check(order.every((k, i) => i === 0 || (m[k] && m[order[i - 1]] && at(k) >= at(order[i - 1]))), `the milestones came in the run's order: ${order.map((k) => at(k)?.toFixed(1)).join(' < ')}`);
  t.check(m.upgradePad && m.firstHandIn && at('upgradePad') - at('firstHandIn') < 0.3, 'the upgrade pad shows up with the first hand-in');
  t.check(m.tier2 && m.upgradePaid && Math.abs(at('tier2') - at('upgradePaid')) < 0.3, 'tier 2 comes with the upgrade payment');
  t.check(m.gateOpening && m.gatePaid && Math.abs(at('gateOpening') - at('gatePaid')) < 0.3, 'the gate starts to open with the gate payment');
  t.check(m.gateOpened && m.gateOpening && Math.abs(at('gateOpened') - at('gateOpening') - gateCfg.openTime) < 0.3, `the gate takes ${gateCfg.openTime} s to open (${m.gateOpened && (at('gateOpened') - at('gateOpening')).toFixed(2)} s)`);
  t.check(m.upgradePaid && m.upgradePaid.shredded * 2 >= eco.upgradePrice, `the upgrade was paid from earned coins (${m.upgradePaid && m.upgradePaid.shredded * 2} earned by then)`);
  t.check(m.gatePaid && m.gatePaid.shredded * 2 >= eco.upgradePrice + eco.gatePrice, `both prices (${eco.upgradePrice} + ${eco.gatePrice}) were earned by then (${m.gatePaid && m.gatePaid.shredded * 2} coins)`);

  const fin = await t.evaluate(`(() => { const zm = __zm, u = zm.pads.upgrade, g = zm.pads.gate;
    return { gate: zm.gate.phase, locked: zm.input.isLocked, tier: zm.tractor.tier, upgradePaid: u.paid, upgradeStored: u.stored, gatePaid: g.paid, gateStored: g.stored, step: zm.tutorial.step,
      arrow: cc.find('Tutorial/PathArrow').active, pointer: cc.find('Tutorial/Pointer').active, playing: zm.finaleView.playing, title: cc.find('Canvas/Hud/Finale/Title').active,
      curtain: cc.find('Level/GateCurtain').active, joy: zm.joystick.visibility }; })()`);
  t.log(`end: ${JSON.stringify(fin)}`);
  t.check(fin.gate === 'open' && fin.locked && fin.tier === 2 && fin.upgradePaid && fin.upgradeStored === eco.upgradePrice && fin.gatePaid && fin.gateStored === eco.gatePrice,
    'at the end: gate open, controls off, tier 2, both pads paid in full');
  t.check(fin.step === 'done' && !fin.arrow && !fin.pointer, 'the tutorial is Done and both markers are gone');
  t.check(fin.playing && fin.title && !fin.curtain && fin.joy === 0, 'the finale plays ("GATE OPEN!" up, curtain gone, joystick faded out)');
  t.check(run.snaps.every(([, fired]) => fired) && taken.length === run.snaps.length + 1, `every shot of the run was taken (${taken.length}; not: ${run.snaps.filter(([, f]) => !f).map(([n]) => n).join(', ') || 'none missing'})`);
  t.log(`shots (state at the moment, draw calls): ${taken.map((s) => `${s.name.replace('run-', '')} [${s.clock !== undefined ? `${s.clock.toFixed(1)}s ` : ''}${s.draws} draws]`).join('; ')}`);
  t.check(taken.every((s) => s.draws <= DRAW_BUDGET), `draw calls stayed within ${DRAW_BUDGET} at every shot (most ${Math.max(...taken.map((s) => s.draws))}, fewest ${Math.min(...taken.map((s) => s.draws))})`);

  // Per phase: FPS, ball step, draw calls.
  const summaries = {};
  for (const name of ['T1', 'T2', 'finale']) {
    const s = summaries[name] = await t.evaluate(`__runMetrics.summary('${name}')`);
    t.log(`${name}: ${s.frames} frames, fps ${s.fpsMean.toFixed(1)} mean / ${s.fpsMin.toFixed(1)} worst 2-s window (${s.windows} windows); ball step ${s.stepMean.toFixed(3)} ms mean, ${s.stepP95.toFixed(2)} p95, ${s.stepMax.toFixed(2)} max over ${s.steps} steps; ` +
      `simulated ${s.simMean.toFixed(0)} mean, ${s.simMax} max; draw calls ${s.drawMin}..${s.drawMax} (mostly ${s.drawMode}, mean ${s.drawMean.toFixed(1)}); ball buffer uploaded in ${s.uploads} of ${s.frames} frames (at most ${s.uploadMax})`);
    t.check(s.frames > 0, `${name}: ran ${s.frames} frames`);
    t.check(s.stepP95 < STEP_BUDGET_MS, `${name}: ball step p95 under ${STEP_BUDGET_MS} ms (${s.stepP95.toFixed(2)} ms)`);
    t.check(s.uploadMax <= 1, `${name}: the ball buffer is uploaded at most once a frame`);
    t.check(s.drawMax <= DRAW_BUDGET, `${name}: draw calls at most ${DRAW_BUDGET} (${s.drawMax})`);
  }
  t.log(`at rest after the run: ${drawsRest} draw calls, fps ${fpsRest.toFixed(1)}`);
  const grew = heap[1].used - heap[0].used;
  t.log(`live JS heap after GC: ${heap.map((h) => `${h.label} ${(h.used / 1e6).toFixed(2)} MB at ${(h.clock - clock0).toFixed(1)} s`).join(', ')}; grew ${(grew / 1e3).toFixed(0)} KB over the run`);
  t.check(grew < HEAP_GROWTH_LIMIT, `the live JS heap did not blow up over the run (${(grew / 1e3).toFixed(0)} KB, limit ${HEAP_GROWTH_LIMIT / 1e3} KB)`);

  // The core loop's and the tutorial's verdicts over every frame of the run.
  await checkLoopProbe(t, end, 60, { ended: true });
  await checkTutorialProbe(t, cfg);
  await checkUiOnTop(t);
}
