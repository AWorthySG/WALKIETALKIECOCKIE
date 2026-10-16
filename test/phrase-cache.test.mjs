import test from 'node:test';
import assert from 'node:assert/strict';
import { PhraseCache } from '../web/phrase-cache.js';
test('cache returns copies and evicts the least recently used phrase', () => {
  const cache = new PhraseCache(2);
  cache.set('a', new Uint8Array([1])); cache.set('b', new Uint8Array([2]));
  const a = cache.get('a'); a[0] = 9;
  assert.deepEqual([...cache.get('a')], [1]);
  cache.set('c', new Uint8Array([3]));
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual([...cache.get('a')], [1]); assert.deepEqual([...cache.get('c')], [3]);
});
