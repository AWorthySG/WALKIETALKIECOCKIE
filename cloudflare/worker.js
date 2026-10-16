import { assets } from './assets.js';

const encoder = new TextEncoder();
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = value => base64(encoder.encode(JSON.stringify(value)));
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const key = (secret, usage) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
async function sign(payload, secret) {
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${message}.${base64(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(message)))}`;
}
async function verify(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [a, b, c] = parts;
    const header = JSON.parse(new TextDecoder().decode(decode(a)));
    if (header.alg !== 'HS256' || !await crypto.subtle.verify('HMAC', await key(secret, 'verify'), decode(c), encoder.encode(`${a}.${b}`))) return null;
    const p = JSON.parse(new TextDecoder().decode(decode(b)));
    return p.purpose === 'floor' && p.exp > Date.now() / 1000 && typeof p.channelId === 'string' && typeof p.sub === 'string' ? p : null;
  } catch { return null; }
}
// Shared numbered channels; the lease duration lets clients time it with their own clock.
const CHANNELS = 20, LEASE_MS = 12000;
const clean = (s, max) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const normalise = s => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const hash = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))), x => x.toString(16).padStart(2, '0')).join('');
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), x => alphabet[x % alphabet.length]).join('').match(/.{4}/g).join('-');
}
async function credentials(env, channel, name, identity = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000), expiresAt = (now + 7200) * 1000;
  return {
    serverUrl: env.LIVEKIT_URL, participantId: identity, expiresAt,
    participantToken: await sign({ iss: env.LIVEKIT_API_KEY, sub: identity, name, iat: now, nbf: now - 5, exp: now + 7200, video: { room: `relay_${channel.id}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: ['microphone'] } }, env.LIVEKIT_API_SECRET),
    sessionToken: await sign({ purpose: 'floor', sub: identity, name, channelId: channel.id, iat: now, exp: now + 7200 }, env.APP_SESSION_SECRET),
  };
}

// The existing namespace and channel keys are preserved across this upgrade.
export class RelayState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
    const path = new URL(req.url).pathname;
    let v;
    try { v = await req.json(); } catch { return out({ error: 'Invalid JSON' }, 400); }
    if (path === '/limit') {
      return this.state.storage.transaction(async storage => {
        const where = `rate:${v.key}`, now = Date.now();
        let bucket = await storage.get(where);
        if (!bucket || bucket.reset <= now) bucket = { count: 0, reset: now + 60000 };
        if (bucket.count >= (v.max || 20)) return out({ error: 'Too many attempts. Please wait a minute.' }, 429);
        bucket.count++;
        await storage.put(where, bucket);
        if (!await storage.getAlarm()) await storage.setAlarm(now + 120000);
        return out({ ok: true });
      });
    }
    if (path === '/tune') {
      if (!Number.isInteger(v.number) || v.number < 1 || v.number > CHANNELS) return out({ error: `Choose a channel from 1 to ${CHANNELS}.` }, 400);
      const channel = { id: `numbered-${String(v.number).padStart(2, '0')}`, name: `Channel ${v.number}`, number: v.number, shared: true };
      await this.state.storage.transaction(async storage => {
        if (!await storage.get(`ch:${channel.id}`)) await storage.put(`ch:${channel.id}`, channel);
      });
      return out({ channel });
    }
    if (path === '/create') {
      const id = crypto.randomUUID(), code = newCode();
      const channel = { id, name: v.name, codeHash: await hash(normalise(code)) };
      await this.state.storage.transaction(async storage => {
        await storage.put(`ch:${id}`, channel);
        await storage.put(`code:${channel.codeHash}`, id);
      });
      return out({ channel: { id, name: v.name, code } }, 201);
    }
    if (path === '/join') {
      const id = await this.state.storage.get(`code:${await hash(normalise(v.code))}`);
      if (!id) return out({ error: 'Channel not found. Check the invite code.' }, 404);
      const ch = await this.state.storage.get(`ch:${id}`);
      if (!ch) return out({ error: 'Channel not found.' }, 404);
      return out({ channel: { id: ch.id, name: ch.name } });
    }
    if (path === '/channel') {
      const ch = await this.state.storage.get(`ch:${v.channelId}`);
      return ch ? out({ channel: { id: ch.id, name: ch.name } }) : out({ error: 'Channel not found' }, 404);
    }
    if (!path.startsWith('/floor/')) return out({ error: 'Not found' }, 404);
    return this.state.storage.transaction(async storage => {
      const where = `floor:${v.channelId}`;
      if (!await storage.get(`ch:${v.channelId}`)) return out({ error: 'Channel not found' }, 404);
      let floor = await storage.get(where);
      if (floor && floor.expiresAt <= Date.now()) { await storage.delete(where); floor = null; }
      if (path === '/floor/status') return out({ busy: !!floor, speaker: floor?.name || null, participantId: floor?.identity || null, expiresAt: floor?.expiresAt || null });
      if (path === '/floor/claim') {
        if (floor && floor.identity !== v.identity) return out({ error: 'Someone else is speaking', speaker: floor.name }, 409);
        floor ||= { identity: v.identity, name: v.name, leaseId: crypto.randomUUID() };
        floor.expiresAt = Date.now() + LEASE_MS;
        await storage.put(where, floor);
        return out({ leaseId: floor.leaseId, expiresAt: floor.expiresAt, leaseDurationMs: LEASE_MS });
      }
      const owns = floor && floor.identity === v.identity && floor.leaseId === v.leaseId;
      if (path === '/floor/renew') {
        if (!owns) return out({ error: 'Your speaking turn has expired' }, 409);
        floor.expiresAt = Date.now() + LEASE_MS;
        await storage.put(where, floor);
        return out({ expiresAt: floor.expiresAt, leaseDurationMs: LEASE_MS });
      }
      if (path === '/floor/release') {
        if (owns) await storage.delete(where);
        return out({ released: !!owns });
      }
      return out({ error: 'Not found' }, 404);
    });
  }
  async alarm() {
    const buckets = await this.state.storage.list({ prefix: 'rate:' });
    const expired = [...buckets].filter(([, v]) => v.reset <= Date.now()).map(([k]) => k);
    if (expired.length) await this.state.storage.delete(expired);
    if (expired.length < buckets.size) await this.state.storage.setAlarm(Date.now() + 120000);
  }
}

async function readBody(req) {
  // Limit bytes actually received; Content-Length alone can be omitted or forged.
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw Object.assign(new Error('Invalid JSON object'), { status: 400 }); }
}

export default {
  async fetch(req, env) {
    try {
      const u = new URL(req.url);
      if ((req.method === 'GET' || req.method === 'HEAD') && assets[u.pathname]) {
        const asset = assets[u.pathname];
        return new Response(req.method === 'HEAD' ? null : asset.body, { headers: {
          'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'permissions-policy': 'camera=(), microphone=(self)',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        } });
      }
      if (u.pathname === '/health' && req.method === 'GET') return out({ ok: true, service: 'relay-walkie', platform: 'cloudflare', version: '2.6.0' });
      if (!u.pathname.startsWith('/v1/')) return out({ error: 'Not found' }, 404);
      if (req.method !== 'POST') return out({ error: 'Method not allowed' }, 405);
      if (req.headers.get('origin') && req.headers.get('origin') !== u.origin) return out({ error: 'Origin not allowed' }, 403);
      if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.APP_SESSION_SECRET) return out({ error: 'Backend not configured' }, 503);
      const v = await readBody(req);
      const stub = env.RELAY_STATE.get(env.RELAY_STATE.idFromName('relay-global'));
      const send = (path, body) => stub.fetch('https://internal' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (u.pathname === '/v1/channels/tune') {
        const displayName = clean(v.displayName, 24);
        if (displayName.length < 2 || !Number.isInteger(v.number) || v.number < 1 || v.number > CHANNELS) return out({ error: `Enter your name and choose a channel from 1 to ${CHANNELS}.` }, 400);
        const ip = req.headers.get('CF-Connecting-IP');
        if (ip) {
          const limited = await send('/limit', { key: await hash(ip) });
          if (!limited.ok) return limited;
        }
        const r = await send('/tune', { number: v.number });
        if (!r.ok) return r;
        const data = await r.json();
        return out({ ...data, credentials: await credentials(env, data.channel, displayName) });
      }
      if (u.pathname === '/v1/channels' || u.pathname === '/v1/channels/join') {
        const displayName = clean(v.displayName, 24), name = clean(v.name, 40);
        if (displayName.length < 2 || (u.pathname.endsWith('/join') ? typeof v.code !== 'string' || normalise(v.code).length !== 16 : name.length < 2)) return out({ error: 'Enter a name and a valid channel name or invite code.' }, 400);
        const ip = req.headers.get('CF-Connecting-IP');
        if (ip) {
          const limited = await send('/limit', { key: await hash(ip) });
          if (!limited.ok) return limited;
        }
        const r = await send(u.pathname.endsWith('/join') ? '/join' : '/create', { name, code: v.code });
        if (!r.ok) return r;
        const data = await r.json();
        return out({ ...data, credentials: await credentials(env, data.channel, displayName) }, r.status);
      }
      const auth = req.headers.get('authorization') || '';
      const session = auth.startsWith('Bearer ') ? await verify(auth.slice(7), env.APP_SESSION_SECRET) : null;
      if (!session) return out({ error: 'Your session has expired. Leave and rejoin the channel.' }, 401);
      if (u.pathname === '/v1/speech') {
        if (typeof v.text !== 'string' || !v.text.trim() || v.text.trim().length > 300) return out({ error: 'Enter a message of 1 to 300 characters.' }, 400);
        if (!env.AI) return out({ error: 'Voice messages are not configured on this server.' }, 503);
        const exists = await send('/channel', { channelId: session.channelId });
        if (!exists.ok) return exists;
        // Shared channel bucket prevents bypassing limits by repeatedly rejoining.
        const limited = await send('/limit', { key: `speech:${session.channelId}`, max: 6 });
        if (!limited.ok) return limited;
        try {
          const response = await env.AI.run('@cf/deepgram/aura-2-en', { text: v.text.trim(), speaker: 'luna', encoding: 'mp3' }, { returnRawResponse: true });
          if (!response.ok) {
            await response.body?.cancel();
            return out({ error: 'Speech generation is unavailable. Please try again shortly.' }, 502);
          }
          return new Response(response.body, { headers: { ...headers, 'content-type': 'audio/mpeg' } });
        } catch (error) {
          console.error(JSON.stringify({ event: 'speech_failed', name: error.name }));
          return out({ error: 'Speech generation is unavailable. Please try again shortly.' }, 502);
        }
      }
      if (u.pathname === '/v1/session/refresh') {
        const r = await send('/channel', { channelId: session.channelId });
        if (!r.ok) return r;
        const data = await r.json();
        return out({ credentials: await credentials(env, data.channel, session.name, session.sub) });
      }
      const action = u.pathname.slice(3);
      if (!['/floor/status', '/floor/claim', '/floor/renew', '/floor/release'].includes(action)) return out({ error: 'Not found' }, 404);
      return send(action, { channelId: session.channelId, identity: session.sub, name: session.name, leaseId: v.leaseId });
    } catch (error) {
      if (error.status === 400 || error.status === 413) return out({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'request_failed', name: error.name }));
      return out({ error: 'The server could not complete that request. Please try again.' }, 500);
    }
  },
};
