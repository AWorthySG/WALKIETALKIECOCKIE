import assert from 'node:assert/strict';
import { SignalResponse } from '@livekit/protocol';
import { assertCompleteModule } from './check_bundle.mjs';
const base = process.env.RELAY_URL || 'https://relay-walkie-api.jeremylimguanfong.workers.dev';
async function post(path,body={},token) {
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:r.status,data:await r.json()};
}
const health=await fetch(base+'/health'); assert.equal(health.status,200);assert.equal((await health.json()).version,'2.6.0');
for(const path of ['/','/app.js','/app.css','/icon-192.png','/manifest.webmanifest','/sw.js']) {
 const r=await fetch(base+path);assert.equal(r.status,200,path);assert.ok((await r.arrayBuffer()).byteLength>50);
}
assertCompleteModule(await (await fetch(base+'/app.js')).text(),'deployed /app.js');
console.log('PASS: deployed app shell, icons, manifest, service worker and health.');
const tuned=await post('/v1/channels/tune',{number:20,displayName:'Test Tuner'});assert.equal(tuned.status,200,JSON.stringify(tuned.data));assert.equal(tuned.data.channel.number,20);
const a=await post('/v1/channels',{name:'Relay release check',displayName:'Test Alice'});assert.equal(a.status,201,JSON.stringify(a.data));
const b=await post('/v1/channels/join',{code:a.data.channel.code,displayName:'Test Bob'});assert.equal(b.status,200);assert.equal(a.data.channel.id,b.data.channel.id);
const token=a.data.credentials.sessionToken;
const claim=await post('/v1/floor/claim',{},token);assert.equal(claim.status,200);assert.equal(claim.data.leaseDurationMs,12000);
assert.equal((await post('/v1/floor/claim',{},b.data.credentials.sessionToken)).status,409);
assert.equal((await post('/v1/floor/renew',{leaseId:claim.data.leaseId},token)).status,200);
assert.equal((await post('/v1/floor/release',{leaseId:claim.data.leaseId},token)).data.released,true);
const refreshed=await post('/v1/session/refresh',{},token);assert.equal(refreshed.status,200);assert.equal(refreshed.data.credentials.participantId,a.data.credentials.participantId);
assert.equal((await post('/v1/floor/claim',{},'invalid')).status,401);
console.log('PASS: live channel creation, joining, floor exclusion, renewal, release and session refresh.');
async function checkSignal(credentials) {
 const url=new URL('/rtc',credentials.serverUrl);url.search=new URLSearchParams({access_token:credentials.participantToken,protocol:'15',auto_subscribe:'1',sdk:'js',version:'2.22.4'});
 const socket=new WebSocket(url);socket.binaryType='arraybuffer';
 try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{reject(Error('LiveKit signalling timed out'));},15000);
  const fail=error=>{clearTimeout(timer);reject(error)};
  socket.onerror=()=>fail(Error('LiveKit signalling failed'));
  socket.onclose=e=>fail(Error(`LiveKit signalling closed: ${e.code}`));
  socket.onmessage=event=>{
   try {
    const message=SignalResponse.fromBinary(new Uint8Array(event.data));
    if(message.message.case==='join') {assert.ok(message.message.value.participant.identity);clearTimeout(timer);resolve();}
    else if(message.message.case==='leave') fail(Error('LiveKit rejected session'));
   }catch(error){fail(error)}
  };
 });
 } finally {socket.onclose=null;socket.onerror=null;socket.close();}
}
await checkSignal(a.data.credentials);
console.log('PASS: LiveKit accepted a deployed-server token and returned a real room join response.');
console.log('Physical phone audio and Flutter compilation remain unverified.');
