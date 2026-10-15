import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { FloorRegistry, normalizeCode, verifyJwt } from '../src/core.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-api-'));
const config = {
  livekitUrl: 'wss://dummy.livekit.cloud', livekitApiKey: 'API-test',
  livekitApiSecret: 'test_secret_only', sessionSecret: 'this-is-a-long-random-enough-test-session-secret',
  dataFile: path.join(tmp, 'channels.json'), port: 0,
};
async function runServer(t) {
  const server = createApp(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (root, route, payload, token) => fetch(`${root}${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(payload),
});

test('a private channel is created, persisted, and joined by code', async (t) => {
  const root = await runServer(t);
  const response = await post(root, '/v1/channels', { name: 'Family group', displayName: 'Alex' });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(result.channel.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(result.channel.name, 'Family group');
  assert.equal(normalizeCode(result.channel.code.toLowerCase()), normalizeCode(result.channel.code));
  const saved = fs.readFileSync(config.dataFile, 'utf8');
  assert.ok(!saved.includes(result.channel.code));
  assert.ok(!saved.includes('Alex'));
  const bad = await post(root, '/v1/channels/join', { code: 'WRONG-WRONG-WRONG-WRONG', displayName: 'Bea' });
  assert.equal(bad.status, 404);
  const joined = await post(root, '/v1/channels/join', { code: result.channel.code.toLowerCase(), displayName: 'Bea' });
  assert.equal(joined.status, 200);
  const buddy = await joined.json();
  assert.equal(buddy.channel.id, result.channel.id);
  assert.notEqual(buddy.credentials.participantId, result.credentials.participantId);
  assert.ok(!buddy.channel.code, 'invite secret never returned to a joining user');
  const claims = JSON.parse(Buffer.from(result.credentials.participantToken.split('.')[1], 'base64url').toString());
  assert.equal(claims.iss, config.livekitApiKey);
  assert.equal(claims.video.room, `relay_${result.channel.id}`);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.video.canSubscribe, true);
  const identity = verifyJwt(buddy.credentials.sessionToken, config.sessionSecret, 'floor');
  assert.equal(identity.sub, buddy.credentials.participantId);
});

test('only one participant can hold the floor; release and renewal are restricted', async (t) => {
  const root = await runServer(t);
  const created = await (await post(root, '/v1/channels', { name: 'Test radio', displayName: 'Alex' })).json();
  const joined = await (await post(root, '/v1/channels/join', { code: created.channel.code, displayName: 'Bea' })).json();
  const alex = created.credentials.sessionToken;
  const bea = joined.credentials.sessionToken;
  const unauthorized = await post(root, '/v1/floor/claim', {});
  assert.equal(unauthorized.status, 401);
  const grant = await (await post(root, '/v1/floor/claim', {}, alex)).json();
  assert.ok(grant.leaseId);
  const conflict = await post(root, '/v1/floor/claim', {}, bea);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).speaker, 'Alex');
  const forgedRelease = await (await post(root, '/v1/floor/release', { leaseId: grant.leaseId }, bea)).json();
  assert.equal(forgedRelease.released, false);
  const renewed = await post(root, '/v1/floor/renew', { leaseId: grant.leaseId }, alex);
  assert.equal(renewed.status, 200);
  const status = await (await fetch(`${root}/v1/floor/status`, { headers: { Authorization: `Bearer ${bea}` } })).json();
  assert.equal(status.speaker, 'Alex');
  assert.equal((await (await post(root, '/v1/floor/release', { leaseId: grant.leaseId }, alex)).json()).released, true);
  assert.equal((await post(root, '/v1/floor/claim', {}, bea)).status, 200);
});

test('a lease expires if heartbeat stops', () => {
  let time = 1000;
  const registry = new FloorRegistry({ leaseMs: 12000, clock: () => time });
  assert.equal(registry.claim('c', 'a', 'Alex').ok, true);
  assert.equal(registry.claim('c', 'b', 'Bea').ok, false);
  time += 12001;
  assert.equal(registry.claim('c', 'b', 'Bea').ok, true);
});

test('session tampering is rejected and channel records survive process restart', async (t) => {
  const root = await runServer(t);
  const created = await (await post(root, '/v1/channels', {
    name: 'Persistence test', displayName: 'Alex',
  })).json();
  const token = created.credentials.sessionToken;
  const parts = token.split('.');
  parts[1] = `${parts[1].slice(0, -2)}zz`;
  const tampered = await post(root, '/v1/floor/claim', {}, parts.join('.'));
  assert.equal(tampered.status, 401);
  const restarted = await runServer(t);
  const response = await post(restarted, '/v1/channels/join', {
    code: created.channel.code, displayName: 'Chris',
  });
  assert.equal(response.status, 200);
  const joined = await response.json();
  assert.equal(joined.channel.id, created.channel.id);
});

test('bad or incomplete channel data is rejected', async (t) => {
  const root = await runServer(t);
  const empty = await post(root, '/v1/channels', { name: 'a', displayName: 'b' });
  assert.equal(empty.status, 400);
  const invalid = await fetch(`${root}/v1/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(invalid.status, 400);
  const health = await (await fetch(`${root}/health`)).json();
  assert.equal(health.ok, true);
});
