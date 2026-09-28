// Pay pads check (M8). At the start the gate pad (plate on the ground + price sign over the gate) reads
// 300 and the carpet leaves its plate bare; the upgrade pad is hidden. The first load handed in pops
// the upgrade pad up in the carpet (scale 0 -> overshoot -> 1 in popTime) and throws the balls off its
// plate. Standing on it streams the purse onto it: the first coin at once, the counter ticks down as
// coins land; driving off keeps the partial payment; with enough coins (granted) the rest goes within
// fillTime, `padPaid` once, the counter reads MAX and balls may roll over it again. The gate pad takes
// a partial payment the same way (the gate itself opens in M10). Watched every frame: the three views
// read their pad (owed or the done text), pads take coins only while the tractor's pivot is in their
// zone, the ledger (lib/loop-probe.mjs: purse + coins in the air + on the pads = 2 x shredded +
// granted). Close-ups of the pads; draw calls with the pads on screen.
//
//   node tools/check-html.mjs <html|url> --scenario pads [--gpu]

import { gameWait, installAutopilot, runLegs } from './lib/autopilot.mjs';
import { FPS, closeUp } from './lib/camera.mjs';
import { checkLoopProbe, installLoopProbe, loopState, setPurse, settleCoins } from './lib/loop-probe.mjs';

const PAD_PROBE = `(() => {
  if (window.__padProbe) return 'already';
  const zm = window.__zm, tr = zm.tractor, half = zm.config.pads.zoneHalf, Label = cc.js.getClassByName('cc.Label');
  const view = (pad, path, done) => {
    const visual = cc.find(path + '/Plate');
    return { pad, visual, done, rest: visual.scale.x, label: visual.getChildByName('Amount').getComponent(Label) };
  };
  const views = [view(zm.pads.upgrade, 'Level/Spots/UpgradePad', 'MAX'), view(zm.pads.gate, 'Level/Spots/GatePad', 'OPEN'), view(zm.pads.gate, 'Level/Spots/GateSign', '')];
  const q = window.__padProbe = { frames: 0, clock: 0, labelOff: 0, labelOffAt: null, shownOff: 0, takenOutside: 0, spent: { upgrade: 0, gate: 0 }, paid: [],
    pop: [], popping: false, entries: [], maxFirstGap: 0, fill: null };
  zm.events.on('coinsSpent', (e) => { q.spent[e.padId] += e.amount; });
  zm.events.on('padPaid', (e) => { q.paid.push({ padId: e.padId, clock: +q.clock.toFixed(3) }); });
  // Per pad step: coins leave the purse only while the pivot is in that pad's zone; the first one at once.
  for (const pad of [zm.pads.upgrade, zm.pads.gate]) {
    const step = pad.step.bind(pad);
    let entry = null;
    pad.step = (dt) => {
      const before = zm.purse.total, missing = pad.missing;
      const inZone = Math.abs(tr.x - pad.x) <= half && Math.abs(tr.z - pad.z) <= half;
      if (inZone && pad.open && before > 0 && missing > 0 && !entry) {
        entry = { pad: pad.id, at: q.clock, missing, purse: before, firstSpend: null, allTaken: null, landed: null };
        q.entries.push(entry);
      }
      if (!inZone) entry = null;
      step(dt);
      if (zm.purse.total < before) {
        if (!inZone) q.takenOutside++;
        if (entry && entry.firstSpend === null) { entry.firstSpend = q.clock; q.maxFirstGap = Math.max(q.maxFirstGap, q.clock - entry.at); }
      }
      if (entry && entry.allTaken === null && pad.missing === 0) entry.allTaken = q.clock;
      if (entry && entry.landed === null && pad.paid) entry.landed = q.clock;
    };
  }
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    q.frames++;
    q.clock += Math.min(cc.game.deltaTime, 0.25);
    for (const v of views) {
      if (v.pad.shown && !v.visual.active) q.shownOff++;
      if (!v.pad.shown && v.visual.active && !q.popping) q.shownOff++;
      const want = v.pad.closed ? v.done : String(v.pad.owed);
      if (v.visual.active && v.label.string !== want) { q.labelOff++; if (!q.labelOffAt) q.labelOffAt = { frame: q.frames, want, shows: v.label.string }; }
    }
    const up = views[0];
    if (up.visual.active && q.pop.length < 40) q.pop.push(+(up.visual.scale.x / up.rest).toFixed(3));
  });
  return 'installed';
})()`;

/**
 * Free balls whose centres lie on a pad's plate (its clear zone less the margin: balls up on others may
 * overhang the margin).
 */
const onPlate = (pad) => `(() => { const b = __zm.balls, z = __zm.pads.${pad}.clearZone, m = __zm.config.pads.clearMargin; let n = 0;
  for (let i = 0; i < b.count; i++) if (!b.isHeld(i) && b.x[i] >= z.minX + m && b.x[i] <= z.maxX - m && b.z[i] >= z.minZ + m && b.z[i] <= z.maxZ - m) n++;
  return n; })()`;

const padState = (t) => t.evaluate(`(() => { const u = __zm.pads.upgrade, g = __zm.pads.gate, L = cc.js.getClassByName('cc.Label');
  const label = (path) => cc.find(path + '/Plate/Amount').getComponent(L).string;
  return { purse: __zm.purse.total, up: { shown: u.shown, stored: u.stored, owed: u.owed, closed: u.closed, zone: u.clearZone.active, label: label('Level/Spots/UpgradePad') },
    gate: { stored: g.stored, owed: g.owed, label: label('Level/Spots/GatePad'), sign: label('Level/Spots/GateSign') },
    x: +__zm.tractor.x.toFixed(2), z: +__zm.tractor.z.toFixed(2) }; })()`);

// Fill west of the start, then into the shredder's zone from the south-west (as core-loop): the first hand-in.
const FILL_AND_SELL = [
  { name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 },
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];
// Out of the shredder's zone (|dx|, |dz| <= 3.5 round (5.75, -1.85)) to the west, north, then east onto
// the upgrade pad (5.65, 2.33) along z 2.4, north of the zone: no sale on the way changes the purse.
const OUT_OF_ZONE = [
  { name: 'west out of the zone', kind: 'goto', x: 0.8, z: -4.8, radius: 0.6 },
  { name: 'west: stop', kind: 'stop', time: 0.3 },
];
const ONTO_UPGRADE = [
  { name: 'upgrade pad: north', kind: 'goto', x: 0.8, z: 2.4, radius: 0.6 },
  { name: 'upgrade pad: onto it', kind: 'goto', x: 5.2, z: 2.4, radius: 0.4 },
  { name: 'upgrade pad: stand', kind: 'stop', time: 2.5 },
];
const OFF_UPGRADE = [
  { name: 'off the pad: west', kind: 'goto', x: -1, z: 3, radius: 0.6 },
  { name: 'off the pad: stop', kind: 'stop', time: 1.5 },
];
const BACK_ONTO_UPGRADE = [
  { name: 'back onto the pad', kind: 'goto', x: 5, z: 2.5, radius: 0.4 },
  { name: 'back: stand', kind: 'stop', time: 3 },
];
// West, then south along x 0.5 (west of the shredder's zone) to the gate pad (1.3, -12.2), stop on it,
// then off it east.
const ONTO_GATE = [
  { name: 'gate pad: west', kind: 'goto', x: 0.5, z: 2.6, radius: 0.8 },
  { name: 'gate pad: south', kind: 'goto', x: 0.5, z: -9, radius: 0.8 },
  { name: 'gate pad: onto it', kind: 'goto', x: 1.3, z: -11.6, radius: 0.4 },
  { name: 'gate pad: stand', kind: 'stop', time: 2.5 },
  { name: 'gate pad: off east', kind: 'goto', x: 7.5, z: -11, radius: 0.6 },
  { name: 'gate pad: stop', kind: 'stop', time: 1 },
];

export default async function pads(t) {
  await t.waitFor('!!(window.__zm && window.__zm.pads && window.__zm.progression)');
  await installAutopilot(t);
  await installLoopProbe(t);
  await t.evaluate(PAD_PROBE);
  const { fillTime } = await t.evaluate('__zm.config.pads');
  const fx = await t.evaluate('__zm.config.coinFx');
  const longestFlight = fx.flightTime * (1 + fx.jitter);

  // 1. Start: the gate pad and its sign read 300, its plate is bare; the upgrade pad is hidden.
  const s0 = await padState(t);
  t.log(`start: upgrade shown ${s0.up.shown}; gate plate "${s0.gate.label}", sign "${s0.gate.sign}"; ${await t.evaluate(onPlate('gate'))} balls on the gate plate`);
  t.check(!s0.up.shown && s0.gate.label === '300' && s0.gate.sign === '300', 'start: the upgrade pad hidden, the gate pad and its sign read 300');
  t.check((await t.evaluate(onPlate('gate'))) === 0, 'the carpet leaves the gate plate bare');
  const drawsStart = await t.evaluate('cc.director.root.device.numDrawCalls');
  await closeUp(t, 'gate-pad-start', 1.3, -12.5, 30);

  // 2. The first hand-in pops the upgrade pad up in the carpet and throws the balls off its plate.
  const plateBefore = await t.evaluate(onPlate('upgrade'));
  await runLegs(t, 'fill and sell', FILL_AND_SELL);
  await t.waitFor('__zm.pads.upgrade.shown', 10000);
  await gameWait(t, 0.1);
  await closeUp(t, 'upgrade-pad-popping', 5.65, 2.33, 30);
  await gameWait(t, 1.5);
  const pop = await t.evaluate('__padProbe.pop');
  const peak = Math.max(...pop);
  t.log(`upgrade pad popped up: scale ${pop.slice(0, 26).join(' ')}; ${plateBefore} balls on its plate before, ${await t.evaluate(onPlate('upgrade'))} after 1.6 s`);
  t.check(pop[0] < 0.3 && peak > 1.02 && Math.abs(pop[pop.length - 1] - 1) < 1e-3, `pop-in: from ${pop[0]} through ${peak} (backOut) to 1`);
  t.check(plateBefore > 10 && (await t.evaluate(onPlate('upgrade'))) === 0, `the balls on its plate (${plateBefore}) were thrown clear`);
  await closeUp(t, 'upgrade-pad-shown', 5.65, 2.33, 30);
  // Out of the zone first: leaving it sells what the bucket scooped on the way; then 40 coins for the visit.
  await runLegs(t, 'out of the zone', OUT_OF_ZONE);
  const s1 = await settleCoins(t, 'first load');
  t.log(`sold: purse ${s1.purse}, shredded ${s1.shredded}; the purse set to 40 for the first visit`);
  await setPurse(t, 40);

  // 3. On the pad: the purse streams onto it, the first coin at once, the counter ticks down as they land.
  await runLegs(t, 'onto the upgrade pad', ONTO_UPGRADE);
  await settleCoins(t, 'on the upgrade pad');
  const s2 = await padState(t);
  t.log(`on the pad: purse ${s2.purse}, the pad holds ${s2.up.stored}, reads "${s2.up.label}"`);
  // 40 set, plus what the throat may still swallow meanwhile (balls the pad's burst threw toward it).
  t.check(s2.purse === 0 && s2.up.stored >= 40 && s2.up.stored < 100 && s2.up.label === String(100 - s2.up.stored),
    `all the coins (${s2.up.stored}) went onto the pad, which reads ${s2.up.label}`);

  // 4. Off the pad: the partial payment stays.
  await runLegs(t, 'off the pad', OFF_UPGRADE);
  await settleCoins(t, 'off the pad');
  const s3 = await padState(t);
  t.check(s3.up.stored >= s2.up.stored && s3.up.label === String(100 - s3.up.stored) && !s3.up.closed, `off the pad the partial payment stays (${s3.up.stored}, reads ${s3.up.label})`);
  await closeUp(t, 'upgrade-pad-partial', 5.65, 2.33, 30);

  // 5. Back with enough coins: the rest goes within fillTime, padPaid once, MAX.
  await setPurse(t, 150);
  const purseBefore = (await padState(t)).purse;
  await runLegs(t, 'back onto the pad', BACK_ONTO_UPGRADE);
  await settleCoins(t, 'upgrade paid');
  const s4 = await padState(t);
  const entries = await t.evaluate('__padProbe.entries');
  const full = entries.filter((e) => e.pad === 'upgrade' && e.landed !== null).pop();
  t.log(`paid: ${full ? `${full.missing} coins taken in ${(full.allTaken - full.at).toFixed(2)} s, all landed ${(full.landed - full.at).toFixed(2)} s after entering` : 'no full entry'}; ` +
    `purse ${purseBefore} -> ${s4.purse}; reads "${s4.up.label}", clear zone ${s4.up.zone}`);
  t.check(s4.up.stored === 100 && s4.up.closed && s4.up.label === 'MAX' && !s4.up.zone, 'paid: the pad is closed, reads MAX and lets balls over it');
  t.check(s4.purse === purseBefore - (100 - s3.up.stored), `it took exactly the ${100 - s3.up.stored} still owed`);
  t.check(!!full && full.allTaken - full.at <= fillTime + 0.1 && full.landed - full.allTaken <= longestFlight + 0.1, `the rest left within fillTime (${fillTime} s) and landed one flight later`);
  const paid = await t.evaluate('__padProbe.paid');
  t.check(paid.length === 1 && paid[0].padId === 'upgrade', `padPaid once, for the upgrade pad (${JSON.stringify(paid)})`);
  await closeUp(t, 'upgrade-pad-max', 5.65, 2.33, 30);

  // 6. The gate pad takes a partial payment the same way; its plate and sign read the same.
  await setPurse(t, 120);
  await runLegs(t, 'gate pad', ONTO_GATE);
  await settleCoins(t, 'gate pad');
  const s5 = await padState(t);
  t.log(`gate pad: holds ${s5.gate.stored}, plate "${s5.gate.label}", sign "${s5.gate.sign}", purse ${s5.purse}`);
  t.check(s5.gate.stored >= 120 && s5.gate.stored < 300 && s5.gate.label === String(300 - s5.gate.stored) && s5.gate.sign === s5.gate.label,
    'the gate pad took a partial payment; plate and sign read what is still owed');
  await closeUp(t, 'gate-pad-partial', 1.3, -12.8, 34);
  const drawsEnd = await t.evaluate('cc.director.root.device.numDrawCalls');

  // 7. Verdict over every frame.
  const q = await t.evaluate('(() => { const q = __padProbe; return { ...q, pop: null, entries: q.entries.length }; })()');
  const end = await loopState(t);
  t.log(`over ${q.frames} frames: ${q.entries} pad visits, the first coin at most ${q.maxFirstGap.toFixed(3)} s after entering; spent ${JSON.stringify(q.spent)}; ` +
    `draw calls ${drawsStart} at the start, ${drawsEnd} at the end`);
  t.check(q.labelOff === 0, `every frame each pad view read its pad ${q.labelOffAt ? JSON.stringify(q.labelOffAt) : ''}`);
  t.check(q.shownOff === 0, 'every frame a pad view was on screen exactly while its pad was shown');
  t.check(q.takenOutside === 0, 'coins left the purse only while the tractor stood in that pad\'s zone');
  t.check(q.maxFirstGap <= 0.12, 'on entering a pad the first coin went at once');
  t.check(q.spent.upgrade === 100 && q.spent.gate === s5.gate.stored, `coinsSpent adds up to what the pads hold (${JSON.stringify(q.spent)})`);
  await checkLoopProbe(t, end);
  const fps = await t.evaluate(FPS(2000));
  t.log(`fps ${fps.toFixed(1)}`);
}
