import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCode, formatCode, inviteFromHash, inviteUrl, loadSaved, saveChannel, forgetChannel } from '../web/family.js';
const memory = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
test('invite codes are normalised and validated', () => {
  assert.equal(normaliseCode('abcd-efgh-jkmn-pq23'), 'ABCDEFGHJKMNPQ23');
  assert.equal(normaliseCode(' ABCD EFGH JKMN PQ23 '), 'ABCDEFGHJKMNPQ23');
  for (const bad of ['', 'ABCD', 'ABCDEFGHJKMNPQ234', null, undefined]) assert.equal(normaliseCode(bad), null);
  assert.equal(formatCode('ABCDEFGHJKMNPQ23'), 'ABCD-EFGH-JKMN-PQ23');
});
test('invite links round-trip', () => {
  const url = inviteUrl('https://x.example', 'ABCDEFGHJKMNPQ23');
  assert.equal(url, 'https://x.example/#invite=ABCD-EFGH-JKMN-PQ23');
  assert.equal(inviteFromHash(new URL(url).hash), 'ABCDEFGHJKMNPQ23');
  assert.equal(inviteFromHash('#channel=4'), null);
});
test('saved channel survives reload and is removed on leave', () => {
  const s = memory();
  assert.equal(loadSaved(s), null);
  saveChannel(s, { code: 'abcd-efgh-jkmn-pq23', name: 'Mum' });
  assert.deepEqual(loadSaved(s), { code: 'ABCDEFGHJKMNPQ23', name: 'Mum' });
  forgetChannel(s);
  assert.equal(loadSaved(s), null);
});
test('corrupt or unavailable storage is ignored', () => {
  const s = memory(); s.setItem('ct-family', '{not json');
  assert.equal(loadSaved(s), null);
  s.setItem('ct-family', JSON.stringify({ code: 'ABCDEFGHJKMNPQ23', name: 'M' }));
  assert.equal(loadSaved(s), null);
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(loadSaved(broken), null);
  assert.doesNotThrow(() => { saveChannel(broken, { code: 'ABCDEFGHJKMNPQ23', name: 'Mum' }); forgetChannel(broken); });
});
