import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCompleteModule } from '../scripts/check_bundle.mjs';
test('bundle check rejects truncated or unparseable output', () => {
  assert.doesNotThrow(() => assertCompleteModule('export const a = 1;', 'ok'));
  assert.throws(() => assertCompleteModule('const a = f(1,\n... 71755 bytes omitted ...\n2);', 'cut'), /truncation marker/);
  assert.throws(() => assertCompleteModule('const a = f(1,', 'broken'), /not valid JavaScript/);
});
