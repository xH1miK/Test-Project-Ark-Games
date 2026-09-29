// Sound layer check (S2), on the packed file:// page and the real chain, with the audio output tapped (lib/audio-tap.mjs:
// what reaches the AudioContext's destination is a number). Run in both browser modes:
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario audio                   autoplay allowed
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario audio --locked-audio    the browser's default policy: locked until a gesture
// Checks: every clip of the table arrived (found by its asset name); locked = silence, one-shots dropped and not queued,
// then a REAL touch unlocks and the music sounds; autoplay = the music sounds with no gesture at all; a one-shot is heard;
// mute silences everything and unmute brings the music back; a hidden page falls silent and the game stops counting;
// then the tractor drives (autopilot): fills the bucket (ball clicks), drives to the shredder (coins, the grind loop
// as loud as the rollers are fast), the engine loop follows the drive; every call of the sound rules is recorded and
// judged (throttle intervals, at most 4 one-shots a frame, the pool of 24, a variant never repeated); a tier-up plays
// the upgrade sound. The full run (gate: purchase + whoosh, pad coins stepping up) is judged in `full-run`.

import { installAutopilot, runLegs } from './lib/autopilot.mjs';
import { RECORDER, TAP_SCRIPT, judgeCalls } from './lib/audio-tap.mjs';

export const initScript = TAP_SCRIPT;

const FILL = [{ name: 'fill: into the carpet', kind: 'goto', x: 3, z: -11 }];
const TO_SHREDDER = [
  { name: 'to the shredder: north', kind: 'goto', x: 3, z: -4.8, radius: 0.4 },
  { name: 'to the shredder: stop', kind: 'stop', time: 0.3 },
];

export default async function (t) {
  const locked = t.lockedAudio;
  const peek = () => t.evaluate('window.__audio.peek()');
  const reset = () => t.evaluate('window.__audio.reset(), true');
  const sound = (expr) => t.evaluate(`__zm.sound.${expr}`);
  t.log(`mode: ${locked ? 'locked until a gesture' : 'autoplay allowed'}`);

  // 1. The clips of the table are in the scene and found by name.
  const wiring = await t.evaluate(`(() => {
    const zm = __zm, cfg = zm.config.sound;
    const names = [...Object.values(cfg.loops).map((l) => l.clip), ...Object.values(cfg.shots).flatMap((s) => [...s.clips])];
    return { clips: zm.soundView.clipCount, missing: [...new Set(names)].filter((n) => !zm.soundView.hasClip(n)) };
  })()`);
  t.check(wiring.clips === 16, `the sound node holds all 16 clips (${wiring.clips})`);
  t.check(wiring.missing.length === 0, `every clip the table names is found by its asset name${wiring.missing.length ? ' (missing ' + wiring.missing + ')' : ''}`);
  t.check(await sound("loopWanted('music')"), 'the music is wanted from the start');

  // 2. The lock.
  if (locked) {
    await t.sleep(1200);
    const before = await peek();
    t.log('before any gesture: ' + JSON.stringify(before));
    t.check(!(await sound('unlocked')), 'locked: the sound layer knows nothing sounds yet');
    t.check(before.state !== 'running' && before.peak < 0.001 && before.starts === 0, `locked: silence, nothing started (state ${before.state}, peak ${before.peak.toFixed(4)}, starts ${before.starts})`);
    const droppedBefore = await sound('dropped.locked');
    await t.evaluate(`(() => { for (let i = 0; i < 3; i++) __zm.events.emit('ballScooped', { carried: i + 1, capacity: 8 }); })()`);
    await t.frames(2);
    t.check((await sound('dropped.locked')) === droppedBefore + 3, 'locked: three one-shots were dropped, not queued');
    t.check((await peek()).starts === 0, 'locked: the audio context was handed nothing to blow out at the unlock');
    // A REAL touch on the canvas (DevTools input events, as a finger).
    const [w, h] = t.size.split('x').map(Number);
    await t.touch('touchStart', w / 2, h / 2);
    await t.sleep(80);
    await t.touch('touchEnd', w / 2, h / 2);
    await t.waitFor('__zm.sound.unlocked', 5000);
    await t.sleep(500);
    const after = await peek();
    t.log('after a real touch: ' + JSON.stringify(after));
    t.check((await sound('gestures')) >= 1, 'the sound layer heard the touch as a gesture');
    t.check(after.state === 'running' && after.peak > 0.005, `a real touch unlocks: the music sounds (state ${after.state}, peak ${after.peak.toFixed(3)})`);
  } else {
    await t.waitFor('__zm.sound.unlocked', 5000);
    await t.sleep(500);
    const now = await peek();
    t.check(now.state === 'running' && now.peak > 0.005, `autoplay: the music sounds with no gesture (state ${now.state}, peak ${now.peak.toFixed(3)})`);
  }
  t.check(await sound("loopRunning('music')"), 'the music loop is running');
  t.check(await t.evaluate("__zm.soundView.loopSounding('music')"), 'the music AudioSource reports it is playing');

  // 3. A one-shot is heard (the music is switched off for it, so the peak is the click's).
  await t.evaluate("__zm.sound.setLoop('music', false), true");
  await t.sleep(700);
  await reset();
  await t.sleep(100);
  t.check((await peek()).peak < 0.005, 'with the music off it is quiet');
  await reset();
  const playedBefore = await sound('played.ball');
  await t.evaluate("__zm.events.emit('ballScooped', { carried: 1, capacity: 8 }), true");
  await t.sleep(250);
  const click = await peek();
  t.check((await sound('played.ball')) === playedBefore + 1, 'a ball scooped plays one click');
  t.check(click.peak > 0.02, `the click reaches the output (peak ${click.peak.toFixed(3)})`);
  await t.evaluate("__zm.sound.setLoop('music', true), true");

  // 4. Mute: everything falls silent and the loops are remembered; unmute brings the music back.
  await t.sleep(700);
  await reset();
  await t.sleep(150);
  t.check((await peek()).peak > 0.005, 'the music is back and audible');
  await t.evaluate('__zm.sound.setMuted(true), true');
  await t.sleep(500);
  await reset();
  await t.sleep(200);
  t.check((await peek()).peak < 0.002, 'muted: silence');
  t.check(!(await sound("loopRunning('music')")) && (await sound("loopWanted('music')")), 'muted: the loop is stopped but remembered');
  const droppedMuted = await sound('dropped.muted');
  await t.evaluate("__zm.events.emit('ballScooped', { carried: 1, capacity: 8 }), true");
  await t.frames(2);
  t.check((await sound('dropped.muted')) === droppedMuted + 1, 'muted: a one-shot is dropped');
  await t.evaluate('__zm.sound.setMuted(false), true');
  await t.sleep(700);
  await reset();
  await t.sleep(200);
  t.check((await peek()).peak > 0.005, 'unmuted: the music is back');

  // 5. The page goes to the background (a tab switch, an ad network hiding the view): sound stops, time stops, both come back.
  const setHidden = (hidden) => t.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${hidden ? "'hidden'" : "'visible'"} });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await setHidden(true);
  await t.sleep(400);
  const timeHidden = await sound('now');
  await reset();
  await t.sleep(300);
  t.check((await peek()).peak < 0.002, 'hidden: silence');
  t.check((await sound('now')) === timeHidden, 'hidden: the game is not counting time');
  await setHidden(false);
  await t.sleep(600);
  await reset();
  await t.sleep(250);
  t.check((await peek()).peak > 0.005, 'shown again: the music is back');
  t.check((await sound('now')) > timeHidden, 'shown again: the game counts time again');

  // 6. The real chain: the tractor drives, scoops, sells. Every call of the rules is recorded.
  await installAutopilot(t);
  await t.evaluate(RECORDER);
  await t.evaluate('__ap.run(' + JSON.stringify(FILL) + ')');
  await t.waitFor('__zm.tractor.speed > 2', 15000);
  await t.sleep(500);
  t.check(await sound("loopWanted('engine')"), 'driving: the engine loop is wanted');
  t.check((await sound("loopRunning('engine')")) && (await t.evaluate("__zm.soundView.loopSounding('engine')")), 'driving: the engine AudioSource is playing');
  t.check((await sound("loopGain('engine')")) > 0.9, `driving: the engine is at full gain (${(await sound("loopGain('engine')")).toFixed(2)})`);
  await t.waitFor('!__ap.running', 60000);
  t.check(await t.evaluate('__zm.bucket.count === 8'), 'the bucket is full: 8 balls were scooped');
  await runLegs(t, 'to the shredder', TO_SHREDDER);
  await t.waitFor('__zm.sound.loopRunning("grind")', 8000).catch(() => null);
  const grindNow = await t.evaluate('({ running: __zm.sound.loopRunning("grind"), sounding: __zm.soundView.loopSounding("grind"), gain: __zm.sound.loopGain("grind"), rollers: __zm.shredder.rollerSpeed })');
  t.log('grind: ' + JSON.stringify(grindNow));
  t.check(grindNow.running && grindNow.sounding, 'the shredder is fed: the grind loop is running and its AudioSource is playing');
  t.check(Math.abs(grindNow.gain - grindNow.rollers) < 0.35, `the grind is as loud as the rollers are fast (gain ${grindNow.gain.toFixed(2)}, rollers ${grindNow.rollers.toFixed(2)})`);
  await t.waitFor('__zm.purse.total >= 16 && __zm.coins.pending === 0', 30000);
  await t.sleep(400);
  const engineOff = await t.evaluate('({ speed: __zm.tractor.speed, running: __zm.sound.loopRunning("engine") })');
  t.check(engineOff.speed === 0 && !engineOff.running, 'stopped: the engine loop is off');

  // 7. Judge the record against the rules.
  const rec = await t.evaluate('window.__soundRec');
  const verdict = judgeCalls(rec.calls, await t.evaluate('__zm.config.sound.shots'), await t.evaluate('__zm.config.sound.maxShotsPerFrame'));
  t.log(`calls: ${JSON.stringify(verdict.counts)}; dropped ${JSON.stringify(await sound('dropped'))}; at most ${verdict.worst} one-shots in a frame; most voices ${rec.maxVoices}`);
  t.check(verdict.problems.length === 0, `the rules hold for every recorded call${verdict.problems.length ? ': ' + verdict.problems.slice(0, 3).join('; ') : ''}`);
  t.check((verdict.counts.ball ?? 0) >= 3, `the scooped balls clicked (${verdict.counts.ball ?? 0} clicks)`);
  t.check((verdict.counts.coin ?? 0) >= 1, `the coins landing in the counter chimed (${verdict.counts.coin ?? 0})`);
  t.check(rec.maxVoices <= 24, `never more than 24 voices (${rec.maxVoices})`);
  const history = await sound('history');
  for (const id of ['ball', 'coin']) {
    const clips = history.filter((h) => h.id === id).map((h) => h.clip);
    t.check(clips.every((c, i) => i === 0 || c !== clips[i - 1]), `${id}: a variant is never repeated (${clips.length} plays)`);
  }

  // 8. A tier-up plays the upgrade sound.
  const upgradesBefore = await sound('played.upgrade');
  await t.evaluate('__zm.tractor.setTier(2), true');
  await t.frames(3);
  t.check((await sound('played.upgrade')) === upgradesBefore + 1, 'the tier-up plays the upgrade sound once');
}
