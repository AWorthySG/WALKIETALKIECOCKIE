import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
export const normalizeCode = (value) => String(value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export function newCode() {
  const bytes = crypto.randomBytes(16);
  return [...bytes].map((n) => alphabet[n % alphabet.length]).join('').match(/.{4}/g).join('-');
}
export function safeLabel(value, max = 38) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}
const base64url = (value) => Buffer.from(value).toString('base64url');
export function signJwt(payload, secret) {
  const h = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const b = base64url(JSON.stringify(payload));
  const content = `${h}.${b}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}
export function verifyJwt(token, secret, purpose) {
  if (typeof token !== 'string') throw new Error('Invalid session token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid session token');
  const computed = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let received;
  try { received = Buffer.from(parts[2], 'base64url'); } catch { throw new Error('Invalid session token'); }
  if (computed.length !== received.length || !crypto.timingSafeEqual(computed, received)) {
    throw new Error('Invalid session token');
  }
  let body;
  try { body = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { throw new Error('Invalid session token'); }
  if (body.purpose !== purpose || !Number.isInteger(body.exp) || body.exp <= nowSeconds() || !body.sub || !body.channelId) {
    throw new Error('Expired or invalid session token');
  }
  return body;
}
export function makeTokens(config, channel, displayName) {
  const ts = nowSeconds();
  const identity = crypto.randomUUID();
  const mediaToken = signJwt({
    iss: config.livekitApiKey, sub: identity, name: displayName, iat: ts,
    nbf: ts - 5, exp: ts + 7200,
    video: {
      room: `relay_${channel.id}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ['microphone'],
    },
  }, config.livekitApiSecret);
  const sessionToken = signJwt({
    purpose: 'floor', sub: identity, name: displayName, channelId: channel.id,
    iat: ts, exp: ts + 7200,
  }, config.sessionSecret);
  return {
    serverUrl: config.livekitUrl,
    participantToken: mediaToken,
    sessionToken,
    participantId: identity,
  };
}
export class ChannelStore {
  constructor(file) {
    this.file = file;
    this.channels = [];
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(saved.channels)) throw new Error('Invalid channel file');
      this.channels = saved.channels;
    }
  }
  create(name) {
    const id = crypto.randomUUID();
    let code;
    do { code = newCode(); } while (this.findByCode(code));
    const channel = { id, name, codeHash: hashCode(normalizeCode(code)), createdAt: new Date().toISOString() };
    this.channels.push(channel);
    this.save();
    return { channel, code };
  }
  findByCode(code) {
    const hash = hashCode(normalizeCode(code));
    return this.channels.find((entry) => entry.codeHash === hash);
  }
  hasId(id) { return this.channels.some((entry) => entry.id === id); }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ channels: this.channels }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
}
export class FloorRegistry {
  constructor({ leaseMs = 12000, clock = () => Date.now() } = {}) {
    this.leaseMs = leaseMs;
    this.clock = clock;
    this.floors = new Map();
  }
  current(channelId) {
    const lease = this.floors.get(channelId);
    if (lease && lease.expiresAt > this.clock()) return lease;
    this.floors.delete(channelId);
    return null;
  }
  claim(channelId, identity, name) {
    const old = this.current(channelId);
    if (old && old.identity !== identity) return { ok: false, current: old };
    const lease = old ?? { identity, name, leaseId: crypto.randomUUID() };
    lease.expiresAt = this.clock() + this.leaseMs;
    this.floors.set(channelId, lease);
    return { ok: true, current: lease };
  }
  renew(channelId, identity, leaseId) {
    const lease = this.current(channelId);
    if (!lease || lease.identity !== identity || lease.leaseId !== leaseId) return null;
    lease.expiresAt = this.clock() + this.leaseMs;
    return lease;
  }
  release(channelId, identity, leaseId) {
    const lease = this.current(channelId);
    if (lease && lease.identity === identity && lease.leaseId === leaseId) {
      this.floors.delete(channelId);
      return true;
    }
    return false;
  }
}
