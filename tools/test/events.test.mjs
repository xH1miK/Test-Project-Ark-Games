import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../assets/scripts/core/Events.ts';

test('listeners receive typed payloads; the disposer unsubscribes', () => {
  const bus = new EventBus();
  const got = [];
  const off = bus.on('purseChanged', (e) => got.push(e.total));
  bus.emit('purseChanged', { total: 4, delta: 4 });
  off();
  bus.emit('purseChanged', { total: 6, delta: 2 });
  assert.deepEqual(got, [4]);
});

test('a listener can unsubscribe itself while being called', () => {
  const bus = new EventBus();
  const calls = [];
  const once = () => {
    calls.push('once');
    bus.off('tierChanged', once);
  };
  bus.on('tierChanged', once);
  bus.on('tierChanged', () => calls.push('always'));
  bus.emit('tierChanged', { tier: 2 });
  bus.emit('tierChanged', { tier: 3 });
  assert.deepEqual(calls.sort(), ['always', 'always', 'once']);
});

test('emitting an event nobody listens to is a no-op', () => {
  new EventBus().emit('gateOpened', { padId: 'gate' });
});
