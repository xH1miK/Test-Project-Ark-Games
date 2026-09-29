import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Config } from '../../assets/scripts/core/Config.ts';
import { AudioManager } from '../../assets/scripts/audio/AudioManager.ts';
import { mulberry32 } from '../../assets/scripts/balls/BallCarpet.ts';
import { CLIPS } from '../audio/sounds.mjs';

/** A backend that behaves like the browser: a loop started while the context is suspended waits for the unlock. */
class FakeBackend {
  constructor() {
    this.calls = [];
    this.contextRunning = false;
    this.running = new Set(); // asked to run
    this.volumes = {};
    this.lengths = {};
  }
  playOneShot(clip, volume) {
    this.calls.push(['shot', clip, volume]);
    return this.lengths[clip] ?? 0.2;
  }
  startLoop(id, clip, volume) {
    this.calls.push(['start', id, clip, volume]);
    this.running.add(id);
    this.volumes[id] = volume;
  }
  stopLoop(id) {
    this.calls.push(['stop', id]);
    this.running.delete(id);
  }
  setLoopVolume(id, volume) {
    this.calls.push(['volume', id, volume]);
    this.volumes[id] = volume;
  }
  loopSounding(id) {
    return this.contextRunning && this.running.has(id);
  }
  unlock() {
    this.contextRunning = true;
  }
  count(kind, id) {
    return this.calls.filter((c) => c[0] === kind && (id === undefined || c[1] === id)).length;
  }
}

const make = (settings = Config.sound, seed = 1) => {
  const backend = new FakeBackend();
  const sound = new AudioManager(settings, backend, mulberry32(seed));
  return { backend, sound };
};
/** A manager that is past the browser's lock: the music runs. */
const unlocked = (settings) => {
  const it = make(settings);
  it.sound.setLoop('music', true);
  it.sound.update(0.016);
  it.sound.gesture();
  it.backend.unlock();
  it.sound.update(0.016);
  assert.ok(it.sound.unlocked);
  return it;
};
const tick = (sound, seconds, dt = 0.016) => { for (let t = 0; t < seconds - 1e-9; t += dt) sound.update(dt); };

test('locked: the loops are asked to start at once (the browser keeps them waiting) and one-shots are dropped, not queued', () => {
  const { backend, sound } = make();
  sound.setLoop('music', true);
  sound.update(0.016);
  assert.equal(backend.count('start', 'music'), 1, 'the first ask, with no gesture');
  tick(sound, 0.3);
  assert.equal(sound.unlocked, false, 'the context is suspended: nothing sounds yet');
  assert.equal(sound.play('ball'), false);
  assert.equal(sound.dropped.locked, 1);
  assert.equal(backend.count('shot'), 0, 'nothing is handed to the audio context to be queued');
});

test('where the browser allows autoplay the music sounds without any gesture', () => {
  const { backend, sound } = make();
  backend.unlock();
  sound.setLoop('music', true);
  sound.update(0.016);
  sound.update(0.016);
  assert.equal(sound.unlocked, true);
  assert.equal(sound.play('ball'), true);
});

test('a gesture asks again at once, inside the handler; the sound counts as unlocked only when a loop really sounds', () => {
  const { backend, sound } = make();
  sound.setLoop('music', true);
  tick(sound, 0.3);
  const before = backend.count('start', 'music');
  sound.gesture();
  assert.equal(backend.count('start', 'music'), before + 1, 'asked synchronously inside the gesture');
  sound.update(0.016);
  assert.equal(sound.unlocked, false, 'the context is still suspended');
  assert.equal(sound.play('ball'), false);
  backend.unlock();
  sound.update(0.016);
  assert.equal(sound.unlocked, true);
  assert.equal(sound.play('ball'), true);
});

test('until the sound goes, the ask is repeated every 0.5 s; once it sounds the retries stop', () => {
  const { backend, sound } = make();
  sound.setLoop('music', true);
  tick(sound, 2.05);
  const asks = backend.count('start', 'music');
  assert.ok(asks >= 4 && asks <= 5, `${asks} asks in 2 s (the first plus one per 0.5 s)`);
  backend.unlock();
  sound.update(0.016);
  const before = backend.count('start', 'music');
  tick(sound, 2);
  assert.equal(backend.count('start', 'music'), before, 'no retries once unlocked');
});

test('a loop that is switched off while still locked is cancelled, not left waiting', () => {
  const { backend, sound } = make();
  sound.setLoop('engine', true);
  tick(sound, 0.4);
  assert.equal(sound.loopRunning('engine'), true);
  sound.setLoop('engine', false);
  tick(sound, 0.4);
  assert.equal(sound.loopRunning('engine'), false);
  assert.equal(backend.count('stop', 'engine'), 1);
});

test('throttle: after a play the next is allowed min..max seconds later (ball 55-125 ms)', () => {
  const { sound } = unlocked();
  const { minInterval, maxInterval } = Config.sound.shots.ball;
  const dt = 0.01;
  for (let i = 0; i < 1000; i++) {
    sound.update(dt);
    sound.play('ball');
  }
  const times = sound.history.map((r) => r.time);
  assert.ok(sound.played.ball > 40, `${sound.played.ball} clicks`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= minInterval - 1e-9 && gap <= maxInterval + dt + 1e-9, `gap ${gap.toFixed(3)}`);
  }
  assert.ok(sound.dropped.throttled > 0);
});

test('coins: 200 ms apart, however many land', () => {
  const { sound } = unlocked();
  for (let i = 0; i < 200; i++) {
    sound.update(0.016);
    sound.play('coin');
    sound.play('coin');
  }
  const gaps = sound.history.slice(1).map((r, i) => r.time - sound.history[i].time);
  assert.ok(gaps.every((g) => g >= 0.2 - 1e-9), 'gaps ' + gaps.slice(0, 5).map((g) => g.toFixed(3)));
});

test('the gate whoosh plays at most once a second', () => {
  const { sound } = unlocked();
  let played = 0;
  for (let i = 0; i < 300; i++) { sound.update(0.016); if (sound.play('gate')) played++; }
  assert.ok(played >= 4 && played <= 5, `${played} in ~4.8 s`);
});

test('a variant never repeats the last one and every variant is used', () => {
  const { sound } = unlocked();
  for (let i = 0; i < 400; i++) { sound.update(0.3); sound.play('ball'); }
  const clips = sound.history.map((r) => r.clip);
  assert.ok(sound.played.ball > 300);
  for (let i = 1; i < clips.length; i++) assert.notEqual(clips[i], clips[i - 1], `repeat at ${i}`);
  const used = new Set(sound.history.map((r) => r.clip));
  assert.equal(used.size, 5);
});

test('volume = table x a random factor within the jitter', () => {
  const { sound } = unlocked();
  const { volume, jitter } = Config.sound.shots.ball;
  for (let i = 0; i < 200; i++) { sound.update(0.3); sound.play('ball'); }
  const vs = sound.history.map((r) => r.volume / volume);
  assert.ok(vs.every((v) => v >= jitter[0] - 1e-9 && v <= jitter[1] + 1e-9));
  assert.ok(Math.min(...vs) < 0.9 && Math.max(...vs) > 1.1, 'it really varies');
  const { sound: s2 } = unlocked();
  s2.update(0.3);
  s2.play('upgrade');
  assert.equal(s2.history[0].volume, Config.sound.shots.upgrade.volume);
});

test('the pad spend sound steps up through its variants as the price fills', () => {
  const { sound } = unlocked();
  const picks = [];
  for (const progress of [0, 0.19, 0.2, 0.5, 0.79, 0.8, 0.999, 1, 1.5]) {
    sound.update(0.3);
    sound.play('spend', progress);
    picks.push(sound.history[sound.history.length - 1].clip);
  }
  assert.deepEqual(picks, ['coin_1', 'coin_1', 'coin_2', 'coin_3', 'coin_4', 'coin_5', 'coin_5', 'coin_5', 'coin_5']);
});

test('at most 4 one-shots start in a frame; the next frame has room again', () => {
  const { sound } = unlocked();
  sound.update(0.016);
  const started = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => sound.play('upgrade')).filter(Boolean).length;
  assert.equal(started, Config.sound.maxShotsPerFrame);
  assert.equal(sound.dropped.frameCap, 10 - Config.sound.maxShotsPerFrame);
  sound.update(0.016);
  assert.equal(sound.play('upgrade'), true);
});

test('the pool: loops and live one-shots together never exceed maxVoices; room returns as sounds end', () => {
  const settings = { ...Config.sound, maxVoices: 6 };
  const { backend, sound } = unlocked(settings);
  sound.setLoop('engine', true);
  sound.setLoop('grind', true);
  sound.update(0.016);
  assert.equal(sound.voiceCount, 3, 'three loops');
  for (const clip of ['upgrade', 'purchase']) backend.lengths[clip] = 10;
  let ok = 0;
  for (let i = 0; i < 6; i++) { sound.update(0.016); if (sound.play('upgrade')) ok++; }
  assert.equal(ok, 3, 'only three more fit');
  assert.ok(sound.dropped.pool >= 3);
  assert.equal(sound.voiceCount, 6);
  tick(sound, 10.5);
  assert.equal(sound.voiceCount, 3);
  assert.equal(sound.play('upgrade'), true);
});

test('mute stops every loop, drops one-shots, remembers the loops; unmute brings back the wanted ones', () => {
  const { backend, sound } = unlocked();
  sound.setLoop('engine', true);
  tick(sound, 0.5);
  assert.ok(sound.loopRunning('music') && sound.loopRunning('engine'));
  sound.setMuted(true);
  assert.equal(backend.count('stop', 'music'), 1);
  assert.equal(backend.count('stop', 'engine'), 1);
  assert.equal(sound.play('upgrade'), false);
  assert.equal(sound.dropped.muted, 1);
  tick(sound, 1);
  assert.equal(sound.loopRunning('music'), false, 'stays stopped while muted');
  assert.ok(sound.loopWanted('music') && sound.loopWanted('engine'), 'remembered');
  sound.setLoop('engine', false); // the tractor stops while the sound is muted
  tick(sound, 1);
  sound.setMuted(false);
  tick(sound, 0.1);
  assert.equal(sound.loopRunning('music'), true);
  assert.equal(sound.loopRunning('engine'), false, 'not brought back: it was switched off meanwhile');
  assert.equal(sound.toggleMute(), true);
  assert.equal(sound.toggleMute(), false);
});

test('loops fade: the engine ramps up over 0.15 s and stops when it has faded out', () => {
  const { backend, sound } = unlocked();
  sound.setLoop('engine', true);
  const base = Config.sound.loops.engine.volume;
  sound.update(0.05);
  assert.ok(Math.abs(backend.volumes.engine - base / 3) < 1e-6, 'one third of the way after 50 ms');
  tick(sound, 0.2);
  assert.ok(Math.abs(backend.volumes.engine - base) < 1e-9);
  sound.setLoop('engine', false);
  sound.update(0.075);
  assert.ok(Math.abs(backend.volumes.engine - base / 2) < 1e-6);
  assert.equal(sound.loopRunning('engine'), true);
  tick(sound, 0.2);
  assert.equal(sound.loopRunning('engine'), false);
  assert.equal(backend.count('stop', 'engine'), 1);
});

test('the grind is as loud as its level: base x level, and it stops when the rollers stop', () => {
  const { backend, sound } = unlocked();
  sound.setLoop('grind', true);
  sound.setLoopLevel('grind', 0.5);
  sound.update(0.016);
  assert.ok(Math.abs(backend.volumes.grind - 0.22 * 0.5) < 1e-9);
  sound.setLoopLevel('grind', 1);
  sound.update(0.016);
  assert.ok(Math.abs(backend.volumes.grind - 0.22) < 1e-9);
  sound.setLoopLevel('grind', 0);
  sound.update(0.016);
  assert.equal(sound.loopRunning('grind'), false);
  sound.setLoopLevel('grind', 7);
  sound.update(0.016);
  assert.ok(Math.abs(backend.volumes.grind - 0.22) < 1e-9, 'a level above 1 counts as 1');
});

test('the music fades in while it waits for the unlock: when the sound goes it is already at full level', () => {
  const { backend, sound } = make();
  sound.setLoop('music', true);
  tick(sound, 1);
  assert.ok(Math.abs(backend.volumes.music - Config.sound.loops.music.volume) < 1e-9, 'the waiting loop already has its full volume');
  backend.unlock();
  sound.update(0.016);
  assert.equal(sound.unlocked, true);
  assert.ok(Math.abs(backend.volumes.music - Config.sound.loops.music.volume) < 1e-9);
});

test('a loop volume is only sent when it changes', () => {
  const { backend, sound } = unlocked();
  tick(sound, 1);
  const before = backend.count('volume', 'music');
  tick(sound, 1);
  assert.equal(backend.count('volume', 'music'), before);
});

test('the same seed gives the same plays; the history is capped', () => {
  const run = (seed) => {
    const { sound } = unlocked(Config.sound);
    void seed;
    for (let i = 0; i < 300; i++) { sound.update(0.2); sound.play('ball'); sound.play('coin'); }
    return sound.history.map((r) => `${r.clip}@${r.volume.toFixed(5)}`).join();
  };
  assert.equal(run(1), run(1));
  const { sound } = unlocked();
  for (let i = 0; i < 300; i++) { sound.update(0.3); sound.play('ball'); }
  assert.equal(sound.history.length, Config.sound.historySize);
});

test('the sound table matches the clips that exist: every name is a synthesized clip with an imported asset', () => {
  const names = new Set(CLIPS.map((c) => c.name));
  const used = [];
  for (const loop of Object.values(Config.sound.loops)) used.push(loop.clip);
  for (const shot of Object.values(Config.sound.shots)) used.push(...shot.clips);
  for (const name of used) {
    assert.ok(names.has(name), `${name} is in the catalogue`);
    const clip = CLIPS.find((c) => c.name === name);
    assert.ok(existsSync(`assets/audio/${name}.${clip.format}`), `assets/audio/${name}.${clip.format}`);
    assert.ok(existsSync(`assets/audio/${name}.${clip.format}.meta`), `${name} has a .meta (imported by the editor)`);
  }
  // Loops are the catalogue's loop clips.
  for (const [id, loop] of Object.entries(Config.sound.loops)) assert.ok(CLIPS.find((c) => c.name === loop.clip).loop, `${id} is a loop clip`);
});

test('the numbers are those of the example\'s sound table', () => {
  const { loops, shots } = Config.sound;
  assert.ok(Math.abs(loops.music.volume - 0.105) < 1e-9);
  assert.equal(loops.engine.volume, 0.040095);
  assert.equal(loops.grind.volume, 0.22);
  assert.deepEqual([shots.ball.volume, shots.ball.minInterval, shots.ball.maxInterval], [0.28, 0.055, 0.125]);
  assert.deepEqual([shots.coin.volume, shots.coin.minInterval], [0.055, 0.2]);
  assert.deepEqual([shots.spend.volume, shots.spend.minInterval, shots.spend.maxInterval], [0.08, 0.09, 0.16]);
  assert.deepEqual([shots.upgrade.volume, shots.purchase.volume, shots.gate.volume, shots.gate.minInterval], [0.65, 0.65, 0.55, 1]);
  assert.equal(Config.sound.maxVoices, 24);
  assert.equal(Config.sound.maxShotsPerFrame, 4);
  assert.equal(Config.sound.unlockRetry, 0.5);
});
