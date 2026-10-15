import http from 'node:http';
import path from 'node:path';
import { ChannelStore, FloorRegistry, makeTokens, safeLabel, verifyJwt } from './core.mjs';

const json = (res, code, data) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
const error = (res, status, message) => json(res, status, { error: message });
const invalid = (res) => error(res, 400, 'Invalid request');
const channelResponse = (channel, code = null) => ({
  id: channel.id, name: channel.name, ...(code ? { code } : {}),
});

function loadConfig(env = process.env) {
  return {
    livekitUrl: env.LIVEKIT_URL,
    livekitApiKey: env.LIVEKIT_API_KEY,
    livekitApiSecret: env.LIVEKIT_API_SECRET,
    sessionSecret: env.APP_SESSION_SECRET,
    port: Number(env.PORT || 8787),
    dataFile: env.DATA_FILE || path.resolve('data/channels.json'),
  };
}
function validateConfig(config) {
  if (!/^wss:\/\//.test(config.livekitUrl || '')) throw new Error('LIVEKIT_URL must begin with wss://');
  if (!config.livekitApiKey || !config.livekitApiSecret) throw new Error('LiveKit API credentials are required');
  if (!config.sessionSecret || Buffer.byteLength(config.sessionSecret) < 32) throw new Error('APP_SESSION_SECRET must be at least 32 bytes');
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) {
      const err = new Error('Request too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch {
    const err = new Error('Invalid JSON object');
    err.status = 400;
    throw err;
  }
}

export function createApp(config = loadConfig(), { floorRegistry } = {}) {
  validateConfig(config);
  const channels = new ChannelStore(config.dataFile);
  const floors = floorRegistry ?? new FloorRegistry();
  const limits = new Map();
  function allowed(req, key, count, windowMs) {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const index = `${ip}:${key}`;
    const ts = Date.now();
    const state = limits.get(index);
    if (!state || state.expires < ts) {
      limits.set(index, { hits: 1, expires: ts + windowMs });
      if (limits.size > 10000) for (const [k, v] of limits) if (v.expires < ts) limits.delete(k);
      return true;
    }
    state.hits += 1;
    return state.hits <= count;
  }
  function authenticate(req, res) {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) { error(res, 401, 'Missing session token'); return null; }
    try {
      const session = verifyJwt(auth.slice(7), config.sessionSecret, 'floor');
      if (!channels.hasId(session.channelId)) throw new Error('Channel not found');
      return session;
    } catch {
      error(res, 401, 'Invalid or expired session; rejoin the channel');
      return null;
    }
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'relay-walkie' });
      if (req.method === 'POST' && url.pathname === '/v1/channels') {
        if (!allowed(req, 'create', 15, 60 * 60 * 1000)) return error(res, 429, 'Too many channels created');
        const body = await readJson(req);
        const name = safeLabel(body.name, 40);
        const displayName = safeLabel(body.displayName, 24);
        if (name.length < 2 || displayName.length < 2) return invalid(res);
        const { channel, code } = channels.create(name);
        return json(res, 201, { channel: channelResponse(channel, code), credentials: makeTokens(config, channel, displayName) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/channels/join') {
        if (!allowed(req, 'join', 30, 60 * 1000)) return error(res, 429, 'Too many attempts; try again later');
        const body = await readJson(req);
        const displayName = safeLabel(body.displayName, 24);
        if (displayName.length < 2 || typeof body.code !== 'string' || body.code.length > 70) return invalid(res);
        const channel = channels.findByCode(body.code);
        if (!channel) return error(res, 404, 'Channel not found. Check the invite code.');
        return json(res, 200, { channel: channelResponse(channel), credentials: makeTokens(config, channel, displayName) });
      }
      if (url.pathname.startsWith('/v1/floor/')) {
        const session = authenticate(req, res);
        if (!session) return;
        if (req.method === 'GET' && url.pathname === '/v1/floor/status') {
          const lease = floors.current(session.channelId);
          return json(res, 200, { busy: !!lease, speaker: lease?.name ?? null, expiresAt: lease?.expiresAt ?? null });
        }
        if (req.method !== 'POST') return error(res, 405, 'Method not allowed');
        if (!allowed(req, 'floor', 240, 60 * 1000)) return error(res, 429, 'Too many floor requests');
        const body = await readJson(req);
        if (url.pathname === '/v1/floor/claim') {
          const outcome = floors.claim(session.channelId, session.sub, session.name);
          if (!outcome.ok) return json(res, 409, { error: 'Someone else is speaking', speaker: outcome.current.name });
          return json(res, 200, { leaseId: outcome.current.leaseId, expiresAt: outcome.current.expiresAt });
        }
        if (typeof body.leaseId !== 'string') return invalid(res);
        if (url.pathname === '/v1/floor/renew') {
          const lease = floors.renew(session.channelId, session.sub, body.leaseId);
          return lease ? json(res, 200, { expiresAt: lease.expiresAt }) : error(res, 409, 'Your speaking turn has expired');
        }
        if (url.pathname === '/v1/floor/release') {
          return json(res, 200, { released: floors.release(session.channelId, session.sub, body.leaseId) });
        }
      }
      return error(res, 404, 'Not found');
    } catch (err) {
      if (err.status) return error(res, err.status, err.message);
      console.error('Server error:', err);
      return error(res, 500, 'Internal server error');
    }
  });
  return server;
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, '0.0.0.0', () => console.log(`Relay backend listening on port ${config.port}`));
}
