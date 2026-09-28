import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../../assets/scripts/core/Config.ts';
import { EventBus } from '../../assets/scripts/core/Events.ts';
import { CoinFlights } from '../../assets/scripts/economy/CoinFlights.ts';
import { Purse } from '../../assets/scripts/economy/Purse.ts';

const FX = Config.coinFx;
const live = (coins) => coins.coins.slice(0, coins.count);

test('purse: starts empty, adds and spends whole coins, announces every change', () => {
  const events = new EventBus();
  const heard = [];
  events.on('purseChanged', (e) => heard.push(e));
  const purse = new Purse(events);
  assert.equal(purse.total, 0);
  purse.add(16);
  purse.add(0.5); // not a coin
  purse.add(-3);
  assert.equal(purse.total, 16);
  assert.equal(purse.spend(10), 10);
  assert.equal(purse.spend(10), 6, 'only what is there');
  assert.equal(purse.spend(1), 0);
  assert.deepEqual(heard, [{ total: 16, delta: 16 }, { total: 6, delta: -10 }, { total: 0, delta: -6 }]);
});

test('a payout flies as a few coins sharing its amount; the purse gets each coin when it arrives', () => {
  const purse = new Purse();
  const coins = new CoinFlights(FX, purse);
  coins.launch(16, 5, 1, -2);
  assert.equal(coins.count, FX.spritesPerPayout);
  assert.deepEqual(live(coins).map((c) => c.value).sort(), [2, 2, 3, 3, 3, 3], '16 shared by 6');
  assert.ok(live(coins).every((c) => c.x === 5 && c.y === 1 && c.z === -2), 'from where it was earned');
  assert.ok(live(coins).every((c) => Math.abs(c.duration / FX.flightTime - 1) <= FX.jitter + 1e-12), 'flight time within its jitter');
  assert.equal(coins.pending, 16);
  assert.equal(purse.total, 0, 'nothing before the coins arrive');
  const dt = 1 / 60;
  const seen = [];
  for (let t = 0; t < 1; t += dt) {
    coins.update(dt);
    seen.push(purse.total);
    for (const c of live(coins)) assert.ok(c.time < c.duration);
  }
  assert.equal(purse.total, 16);
  assert.equal(coins.pending, 0);
  assert.equal(coins.count, 0);
  const firstIn = seen.findIndex((v) => v > 0);
  assert.ok((firstIn + 1) * dt >= FX.flightTime * (1 - FX.jitter) - 1e-9, `first coin in at ${(firstIn + 1) * dt} s`);
  assert.ok(seen.findIndex((v) => v === 16) * dt <= FX.flightTime * (1 + FX.jitter) + dt, 'all in by the longest flight');
  assert.ok(new Set(seen).size > 2, 'arrive one by one, not in one go');
});

test('small payouts: one coin per coin; nothing for zero', () => {
  const purse = new Purse();
  const coins = new CoinFlights(FX, purse);
  coins.launch(2, 0, 0, 0);
  assert.deepEqual(live(coins).map((c) => c.value), [1, 1]);
  coins.launch(0, 0, 0, 0);
  coins.launch(-5, 0, 0, 0);
  assert.equal(coins.count, 2);
});

test('with the sky full (maxAlive), a payout is credited at once; the pool is reused', () => {
  const purse = new Purse();
  const coins = new CoinFlights(FX, purse);
  const payouts = Math.ceil(FX.maxAlive / FX.spritesPerPayout);
  for (let k = 0; k < payouts; k++) coins.launch(12, 0, 0, 0);
  assert.equal(coins.count, FX.maxAlive, 'capped');
  assert.equal(purse.total, 0);
  // The last payout got only the room that was left, and flew with its whole amount.
  assert.equal(coins.pending, 12 * payouts);
  coins.launch(7, 0, 0, 0);
  assert.equal(purse.total, 7, 'no room: credited at once');
  for (let t = 0; t < 1; t += 1 / 60) coins.update(1 / 60);
  assert.equal(purse.total, 7 + 12 * payouts);
  const pool = new Set(coins.coins);
  coins.launch(6, 0, 0, 0);
  assert.ok(live(coins).every((c) => pool.has(c)), 'same coin objects');
});
