import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { SoundPresenter } from '../../assets/scripts/audio/SoundPresenter.ts';

/** A stand-in for AudioManager that only records what the presenter asks for. */
const fakeSound = () => {
  const log = [];
  return {
    log,
    loops: {},
    play: (id, progress) => { log.push(progress === undefined ? [id] : [id, progress]); return true; },
    setLoop(id, on) { this.loops[id] = { ...this.loops[id], on }; },
    setLoopLevel(id, level) { this.loops[id] = { ...this.loops[id], level }; },
  };
};
const setup = () => {
  const events = new EventBus();
  const sound = fakeSound();
  const tractor = { speed: 0 };
  const shredder = { rollerSpeed: 0 };
  const presenter = new SoundPresenter(events, sound, { tractor, shredder }, { engineMinSpeed: 0.3, prices: { upgrade: 100, gate: 300 } });
  presenter.start();
  return { events, sound, tractor, shredder, presenter };
};

test('start: the music is wanted from the beginning', () => {
  const { sound } = setup();
  assert.equal(sound.loops.music.on, true);
});

test('a ball scooped clicks; a coin landing in the counter (the purse grows) chimes; spending does not', () => {
  const { events, sound } = setup();
  events.emit('ballScooped', { carried: 1, capacity: 8 });
  events.emit('purseChanged', { total: 2, delta: 2 });
  events.emit('purseChanged', { total: 0, delta: -2 });
  events.emit('purseChanged', { total: 0, delta: 0 });
  assert.deepEqual(sound.log, [['ball'], ['coin']]);
});

test('coins onto a pad: the variant follows spent / price, per pad', () => {
  const { events, sound } = setup();
  for (let i = 0; i < 4; i++) events.emit('coinsSpent', { padId: 'upgrade', amount: 25 });
  events.emit('coinsSpent', { padId: 'gate', amount: 30 });
  events.emit('coinsSpent', { padId: 'gate', amount: 30 });
  events.emit('coinsSpent', { padId: 'mystery', amount: 5 });
  assert.deepEqual(sound.log, [['spend', 0.25], ['spend', 0.5], ['spend', 0.75], ['spend', 1], ['spend', 0.1], ['spend', 0.2], ['spend', 0]]);
});

test('upgrade: only a tier above 1; the gate: purchase then the whoosh', () => {
  const { events, sound } = setup();
  events.emit('tierChanged', { tier: 1 });
  events.emit('tierChanged', { tier: 2 });
  events.emit('gateOpening', { padId: 'gate' });
  events.emit('padPaid', { padId: 'gate' });
  events.emit('gateOpened', { padId: 'gate' });
  assert.deepEqual(sound.log, [['upgrade'], ['purchase'], ['gate']]);
});

test('the engine loop follows "moving" (above the threshold)', () => {
  const { sound, tractor, presenter } = setup();
  presenter.update();
  assert.equal(sound.loops.engine.on, false);
  tractor.speed = 0.29;
  presenter.update();
  assert.equal(sound.loops.engine.on, false);
  tractor.speed = 3;
  presenter.update();
  assert.equal(sound.loops.engine.on, true);
  tractor.speed = 0;
  presenter.update();
  assert.equal(sound.loops.engine.on, false);
});

test('the grind loop runs while the rollers turn, at their speed share', () => {
  const { sound, shredder, presenter } = setup();
  presenter.update();
  assert.equal(sound.loops.grind.on, false);
  shredder.rollerSpeed = 0.4;
  presenter.update();
  assert.deepEqual(sound.loops.grind, { on: true, level: 0.4 });
  shredder.rollerSpeed = 1;
  presenter.update();
  assert.equal(sound.loops.grind.level, 1);
  shredder.rollerSpeed = 0;
  presenter.update();
  assert.deepEqual(sound.loops.grind, { on: false, level: 0 });
});

test('stop unsubscribes', () => {
  const { events, sound, presenter } = setup();
  presenter.stop();
  events.emit('ballScooped', { carried: 1, capacity: 8 });
  events.emit('gateOpening', { padId: 'gate' });
  assert.deepEqual(sound.log, []);
});
