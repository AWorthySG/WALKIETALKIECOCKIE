import test from 'node:test';
import assert from 'node:assert/strict';
import { channelFromHash, channelUrl } from '../web/channel.js';
test('channel links accept only channels 1 to 20', () => {
  assert.equal(channelFromHash('#channel=7'), 7);
  assert.equal(channelFromHash('channel=20'), 20);
  for (const hash of ['', '#channel=0', '#channel=21', '#channel=3.5', '#channel=abc', '#invite=AAAA', '#channel=007']) assert.equal(channelFromHash(hash), null);
  assert.equal(channelUrl('https://x.example', 4), 'https://x.example/#channel=4');
});
