import test from 'node:test';
import assert from 'node:assert/strict';
import { TalkControl } from '../web/talk-control.js';
function setup(mode) {
  const calls = []; let active = false; const timers = new Map(); let next = 1;
  const control = new TalkControl({
    start: () => { calls.push('start'); active = true; }, stop: () => { calls.push('stop'); active = false; },
    isActive: () => active, onLimit: () => calls.push('limit'), limitMs: 60000,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimer: id => timers.delete(id),
  });
  control.mode = mode;
  return { control, calls, timers, fire: () => { const [[id, t]] = [...timers]; timers.delete(id); t.fn(); } };
}
test('tap mode: first tap starts, second tap stops, release does nothing', () => {
  const { control, calls, timers } = setup('tap');
  control.press(); control.release();
  assert.deepEqual(calls, ['start']); assert.equal(timers.size, 1);
  control.press(); control.release();
  assert.deepEqual(calls, ['start', 'stop']); assert.equal(timers.size, 0);
});
test('tap mode: a forgotten transmission stops after the limit', () => {
  const { control, calls, timers, fire } = setup('tap');
  control.press(); assert.equal([...timers.values()][0].ms, 60000);
  fire();
  assert.deepEqual(calls, ['start', 'limit', 'stop']);
});
test('hold mode: press starts and release stops, with no timer', () => {
  const { control, calls, timers } = setup('hold');
  control.press(); assert.equal(timers.size, 0); control.release();
  assert.deepEqual(calls, ['start', 'stop']);
});
test('cancel always stops and clears the timer', () => {
  const { control, calls, timers } = setup('tap');
  control.press(); control.cancel();
  assert.deepEqual(calls, ['start', 'stop']); assert.equal(timers.size, 0);
});
test('default timers do not depend on the global this binding', async () => {
  const original = globalThis.setTimeout;
  // Simulate a browser, where setTimeout rejects a foreign this.
  globalThis.setTimeout = function (fn, ms) { if (this !== undefined && this !== globalThis) throw TypeError('Illegal invocation'); return original(fn, ms); };
  try {
    const calls = [];
    const control = new TalkControl({ start: () => calls.push('start'), stop: () => calls.push('stop'), isActive: () => false, limitMs: 5 });
    assert.doesNotThrow(() => control.press());
    await new Promise(r => original(r, 20));
    assert.deepEqual(calls, ['start', 'stop']);
  } finally { globalThis.setTimeout = original; }
});
