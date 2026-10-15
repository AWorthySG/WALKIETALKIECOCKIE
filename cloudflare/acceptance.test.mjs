import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker, { RelayState } from './worker.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const data = new Map();
let queue = Promise.resolve();
const store = {transaction: fn => { const next = queue.then(() => fn(store)); queue = next.catch(() => {}); return next; }, getAlarm: async () => null, setAlarm: async () => {}, get: async k => data.get(k), put: async (k,v) => {data.set(k,v)}, delete: async k => {data.delete(k)}};
const state = new RelayState({storage:store},{});
const env = {LIVEKIT_URL:'wss://sample.livekit.cloud',LIVEKIT_API_KEY:'TEST_PUBLIC_KEY',LIVEKIT_API_SECRET:'local-test-secret',APP_SESSION_SECRET:'local-test-session-secret',RELAY_STATE:{idFromName: x=>x,get:()=>({fetch:(url,options)=>state.fetch(new Request(url,options))})}};
const request = (path,body={},token)=>worker.fetch(new Request('https://example.com'+path,{method:'POST',headers:{'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env);
const parse = async p=>({status:p.status, data:await p.json()});
test('create, join, signed JWT identity, exclusive floor, renew, release and takeover',async()=>{
 let a=await parse(await request('/v1/channels',{name:'Test group',displayName:'Alice'}));assert.equal(a.status,201);assert.ok(a.data.channel.code);assert.equal(a.data.credentials.serverUrl,env.LIVEKIT_URL);
 let b=await parse(await request('/v1/channels/join',{code:a.data.channel.code,displayName:'Bob'}));assert.equal(b.status,200);assert.equal(b.data.channel.id,a.data.channel.id);
 for (const actor of [a,b]) {let jwt=actor.data.credentials.participantToken;assert.equal(jwt.split('.').length,3);let payload=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());assert.equal(payload.video.room,'relay_'+a.data.channel.id);assert.equal(payload.video.roomJoin,true);assert.equal(payload.video.canPublishSources[0],'microphone');}
 const alice=a.data.credentials.sessionToken,bob=b.data.credentials.sessionToken;
 assert.equal((await parse(await request('/v1/floor/claim',{},'bad.jwt'))).status,401);
 const claim=await parse(await request('/v1/floor/claim',{},alice));assert.equal(claim.status,200);assert.ok(claim.data.leaseId);
 assert.equal((await parse(await request('/v1/floor/claim',{},bob))).status,409);
 assert.equal((await parse(await request('/v1/floor/renew',{leaseId:claim.data.leaseId},alice))).status,200);
 assert.equal((await parse(await request('/v1/floor/release',{leaseId:claim.data.leaseId},alice))).data.released,true);
 assert.equal((await parse(await request('/v1/floor/claim',{},bob))).status,200);
});
test('invalid invitation rejected',async()=>{const x=await parse(await request('/v1/channels/join',{code:'AAAAAAAAAAAAAAAA',displayName:'Charlie'}));assert.equal(x.status,404)});
test('simultaneous claims grant only one speaking lease', async () => {
 const a = (await parse(await request('/v1/channels',{name:'Race room',displayName:'Alice'}))).data;
 const b = (await parse(await request('/v1/channels/join',{code:a.channel.code,displayName:'Bob'}))).data;
 const responses = await Promise.all([request('/v1/floor/claim',{},a.credentials.sessionToken),request('/v1/floor/claim',{},b.credentials.sessionToken)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
});
test('session refresh preserves participant identity and channel', async () => {
 const a = (await parse(await request('/v1/channels',{name:'Refresh room',displayName:'Alice'}))).data;
 const refreshed = await parse(await request('/v1/session/refresh',{},a.credentials.sessionToken));
 assert.equal(refreshed.status,200);
 assert.equal(refreshed.data.credentials.participantId,a.credentials.participantId);
 const token = refreshed.data.credentials.sessionToken;
 assert.equal((await request('/v1/floor/claim',{},token)).status,200);
 assert.equal((await request('/v1/session/refresh',{},'invalid')).status,401);
});
test('expired lease can be reclaimed and wrong lease cannot release it', async () => {
 const a = (await parse(await request('/v1/channels',{name:'Expired room',displayName:'Alice'}))).data;
 const b = (await parse(await request('/v1/channels/join',{code:a.channel.code,displayName:'Bob'}))).data;
 await request('/v1/floor/claim',{},a.credentials.sessionToken);
 const floor = data.get(`floor:${a.channel.id}`); floor.expiresAt = Date.now()-1;
 const claim = await parse(await request('/v1/floor/claim',{},b.credentials.sessionToken));
 assert.equal(claim.status,200);
 assert.equal((await parse(await request('/v1/floor/release',{leaseId:claim.data.leaseId},a.credentials.sessionToken))).data.released,false);
 assert.equal((await request('/v1/floor/claim',{},a.credentials.sessionToken)).status,409);
});
test('actual body bytes, JSON shape, origin and JWT segments are validated', async () => {
 assert.equal((await request('/v1/channels',{name:'a'.repeat(5000),displayName:'Alice'})).status,413);
 assert.equal((await request('/v1/channels',[])).status,400);
 const r = await worker.fetch(new Request('https://example.com/v1/channels',{method:'POST',headers:{origin:'https://foreign.example'},body:'{}'}),env);
 assert.equal(r.status,403);
 const a = (await parse(await request('/v1/channels',{name:'Token room',displayName:'Alice'}))).data;
 assert.equal((await request('/v1/floor/claim',{},a.credentials.sessionToken+'.extra')).status,401);
});
test('persistent limiter stops repeated channel attempts',async()=>{
 for(let i=0;i<20;i++) assert.equal((await state.fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({key:'test-ip'})}))).status,200);
 assert.equal((await state.fetch(new Request('https://internal/limit',{method:'POST',body:JSON.stringify({key:'test-ip'})}))).status,429);
});
test('app shell and install assets are served without backend secrets',async()=>{
 for(const path of ['/','/app.js','/app.css','/sw.js','/manifest.webmanifest','/icon-192.png','/icon-512.png']) {
  const r = await worker.fetch(new Request('https://example.com'+path),{});
  assert.equal(r.status,200,path); assert.ok(r.headers.get('content-security-policy'));
 }
 const health = await worker.fetch(new Request('https://example.com/health'),{});assert.equal(health.status,200);
});
test('speech requires authentication, validates input and returns uncached audio', async () => {
 const a = (await parse(await request('/v1/channels',{name:'Speech room',displayName:'Alice'}))).data;
 const calls=[];
 env.AI={run:async(model,input,options)=>{calls.push({model,input,options});return new Response(new Uint8Array([0x49,0x44,0x33,0x04]),{headers:{'content-type':'audio/mpeg'}})}};
 assert.equal((await request('/v1/speech',{text:'Hello'})).status,401);
 for(const text of ['', '   ', 'x'.repeat(301), null]) assert.equal((await request('/v1/speech',{text},a.credentials.sessionToken)).status,400);
 const audio=await request('/v1/speech',{text:' Meet me downstairs. '},a.credentials.sessionToken);
 assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.equal(audio.headers.get('cache-control'),'no-store');
 assert.equal((await audio.arrayBuffer()).byteLength,4);assert.equal(calls.length,1);assert.equal(calls[0].input.text,'Meet me downstairs.');
 delete env.AI;
 assert.equal((await request('/v1/speech',{text:'Hello'},a.credentials.sessionToken)).status,503);
});
test('speech model failures are handled without leaking service details', async () => {
 const a=(await parse(await request('/v1/channels',{name:'Speech failure',displayName:'Alice'}))).data;
 env.AI={run:async()=>new Response('private upstream error',{status:500})};
 const failure=await request('/v1/speech',{text:'Hello'},a.credentials.sessionToken);assert.equal(failure.status,502);assert.equal((await failure.text()).includes('private upstream'),false);
 delete env.AI;
});
test('speech generation has a shared channel limit across participants',async()=>{
 const a=(await parse(await request('/v1/channels',{name:'Speech limit',displayName:'Alice'}))).data;
 const b=(await parse(await request('/v1/channels/join',{code:a.channel.code,displayName:'Bob'}))).data;
 let calls=0;env.AI={run:async()=>{calls++;return new Response('audio')}};
 for(let i=0;i<6;i++) assert.equal((await request('/v1/speech',{text:'Hello'},i%2?a.credentials.sessionToken:b.credentials.sessionToken)).status,200);
 assert.equal((await request('/v1/speech',{text:'Hello'},b.credentials.sessionToken)).status,429);assert.equal(calls,6);
 delete env.AI;
});
test('installation manifest and platform icons are available without authentication',async()=>{
 const manifestResponse=await worker.fetch(new Request('https://example.com/manifest.webmanifest'),{});
 const manifest=await manifestResponse.json();assert.equal(manifest.name,'Cockie Talkie');assert.equal(manifest.display,'standalone');assert.equal(manifest.id,'/');assert.equal(manifest.prefer_related_applications,false);assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
 for(const path of ['/apple-touch-icon.png','/icon-maskable.png']) {
  const r=await worker.fetch(new Request('https://example.com'+path),{});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
  const bytes=new Uint8Array(await r.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
 }
});
test('numbered channels are shared and report lease duration', async () => {
 const a = await parse(await request('/v1/channels/tune',{number:7,displayName:'Alice'}));
 const b = await parse(await request('/v1/channels/tune',{number:7,displayName:'Bob'}));
 assert.equal(a.status,200); assert.equal(a.data.channel.id,'numbered-07'); assert.equal(a.data.channel.number,7); assert.equal(b.data.channel.id,a.data.channel.id);
 assert.notEqual(a.data.credentials.participantId,b.data.credentials.participantId);
 const claim = await parse(await request('/v1/floor/claim',{},a.data.credentials.sessionToken));
 assert.equal(claim.data.leaseDurationMs,12000);
 assert.equal((await request('/v1/floor/claim',{},b.data.credentials.sessionToken)).status,409);
 const renewed = await parse(await request('/v1/floor/renew',{leaseId:claim.data.leaseId},a.data.credentials.sessionToken));
 assert.equal(renewed.data.leaseDurationMs,12000);
 assert.equal((await parse(await request('/v1/session/refresh',{},a.data.credentials.sessionToken))).status,200);
});
test('numbered channel input is validated', async () => {
 for (const number of [0,21,1.5,'3',null]) assert.equal((await request('/v1/channels/tune',{number,displayName:'Alice'})).status,400);
 assert.equal((await request('/v1/channels/tune',{number:3,displayName:'A'})).status,400);
});
