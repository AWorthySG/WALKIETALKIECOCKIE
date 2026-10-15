import test from 'node:test';
import assert from 'node:assert/strict';
import { Radio } from '../web/radio.js';
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; }
function fixture(api, publish) {
 const track = { enabled: false }, calls = [];
 const room = { state:'connected',localParticipant:{audioTrackPublications:new Map([['mic',{track:{mediaStreamTrack:track,stop:()=>{track.enabled=false}}}]]),setMicrophoneEnabled:async enabled=>{calls.push(enabled);if(publish)await publish(enabled);track.enabled=enabled;}},disconnect:async()=>{room.state='disconnected'}};
 const radio = new Radio({api});radio.room=room;radio.session={credentials:{sessionToken:'token'}};
 return {radio,track,room,calls};
}
test('releasing before claim resolves never enables microphone',async()=>{
 const claim=deferred(),released=[];
 const {radio,calls}=fixture(async(route,body)=>{if(route.endsWith('/claim'))return claim.promise;released.push(body);return {}});
 const pending=radio.begin();await radio.end();claim.resolve({leaseId:'L',expiresAt:Date.now()+12000});await pending;
 assert.equal(calls.includes(true),false);assert.equal(radio.transmitting,false);assert.equal(released[0].leaseId,'L');
});
test('release while publishing immediately cuts track and mutes after publish resolves',async()=>{
 const publishing=deferred(),started=deferred();
 const {radio,track,calls}=fixture(async()=>({leaseId:'L',expiresAt:Date.now()+12000}),async enabled=>{if(enabled){started.resolve();await publishing.promise;}});
 const pending=radio.begin();await started.promise;track.enabled=true;await radio.end();assert.equal(track.enabled,false);
 publishing.resolve();await pending;assert.equal(track.enabled,false);assert.equal(radio.transmitting,false);assert.deepEqual(calls,[true,false]);
});
test('lease expiry while microphone permission is pending cannot start late transmission',async()=>{
 const publishing=deferred(),started=deferred();
 const {radio,track}=fixture(async()=>({leaseId:'L',expiresAt:Date.now()+12000}),async enabled=>{if(enabled){started.resolve();await publishing.promise;}});
 const pending=radio.begin();await started.promise;
 radio.lease.expiresAt=Date.now()-1;publishing.resolve();await pending;
 assert.equal(track.enabled,false);assert.equal(radio.transmitting,false);
});
test('renewal failure mutes and releases the speaking turn',async()=>{
 const routes=[];
 const {radio,track}=fixture(async route=>{routes.push(route);if(route.endsWith('/renew'))throw Error('offline');return {leaseId:'L',expiresAt:Date.now()+12000}});
 await radio.begin();assert.equal(track.enabled,true);await radio.renew();assert.equal(track.enabled,false);assert.equal(radio.transmitting,false);assert.ok(routes.includes('/v1/floor/release'));
});
test('disconnect during claim releases the lease without publishing',async()=>{
 const claim=deferred();const {radio,room,calls}=fixture(async route=>route.endsWith('/claim')?claim.promise:{});
 const pending=radio.begin();room.state='reconnecting';claim.resolve({leaseId:'L',expiresAt:Date.now()+12000});await pending;
 assert.equal(calls.includes(true),false);assert.equal(radio.lease,null);
});
test('leave waits for pending claim cleanup before disconnecting',async()=>{
 const claim=deferred();const {radio,room}=fixture(async route=>route.endsWith('/claim')?claim.promise:{});
 const pending=radio.begin();const leaving=radio.leave();claim.resolve({leaseId:'L',expiresAt:Date.now()+12000});await Promise.all([pending,leaving]);
 assert.equal(room.state,'disconnected');assert.equal(radio.session,null);assert.equal(radio.lease,null);
});
function clipFixture() {
 const finished=deferred();const calls=[];
 return {calls,done:finished.promise,prepare:async()=>{calls.push('prepare')},start(){calls.push('start')},stop(){calls.push('stop');finished.resolve()},dispose:async()=>{calls.push('dispose')}};
}
test('generated voice uses a speaking lease without enabling the physical microphone',async()=>{
 const routes=[];const {radio,calls}=fixture(async route=>{routes.push(route);return {leaseId:'voice',expiresAt:Date.now()+12000}});
 const clip=clipFixture();await radio.playClip(clip);assert.equal(radio.transmitting,true);assert.deepEqual(calls,[]);assert.ok(clip.calls.includes('start'));
 await radio.end();assert.equal(radio.transmitting,false);assert.ok(clip.calls.includes('stop'));assert.ok(clip.calls.includes('dispose'));assert.ok(routes.includes('/v1/floor/release'));
});
test('stopping a generated message before its lease arrives never starts playback',async()=>{
 const claim=deferred();const {radio}=fixture(async route=>route.endsWith('/claim')?claim.promise:{});const clip=clipFixture();
 const pending=radio.playClip(clip);await radio.end();claim.resolve({leaseId:'voice',expiresAt:Date.now()+12000});await pending;
 assert.equal(clip.calls.includes('prepare'),false);assert.equal(clip.calls.includes('start'),false);assert.ok(clip.calls.includes('stop'));
});
test('publishing failure releases generated voice lease and disposes its track',async()=>{
 const {radio}=fixture(async()=>({leaseId:'voice',expiresAt:Date.now()+12000}));const clip=clipFixture();clip.prepare=async()=>{throw Error('publish failed')};
 await radio.playClip(clip);assert.equal(radio.error,'publish failed');assert.equal(radio.lease,null);assert.equal(radio.transmitting,false);assert.ok(clip.calls.includes('dispose'));
});
test('generated playback start failure cannot leave a latched transmission',async()=>{
 const {radio}=fixture(async()=>({leaseId:'voice',expiresAt:Date.now()+12000}));const clip=clipFixture();clip.start=()=>{throw Error('start failed')};
 await radio.playClip(clip);assert.equal(radio.transmitting,false);assert.equal(radio.lease,null);assert.ok(clip.calls.includes('stop'));
});
test('generated voice cannot claim over a live microphone transmission',async()=>{
 const {radio}=fixture(async()=>({leaseId:'voice',expiresAt:Date.now()+12000}));await radio.begin();
 const clip=clipFixture();await assert.rejects(radio.playClip(clip),/Wait/);assert.equal(clip.calls.length,0);await radio.end();
});
test('phone clock ahead of the server still transmits when lease duration is supplied',async()=>{
 const {radio,track}=fixture(async route=>route.endsWith('/claim')?{leaseId:'L',expiresAt:Date.now()-60000,leaseDurationMs:12000}:{});
 radio.now=()=>Date.now();
 await radio.begin();assert.equal(radio.transmitting,true);assert.equal(track.enabled,true);
 assert.ok(radio.lease.expiresAt>Date.now()+11000);
 await radio.end();
});
test('pressing again while the previous release is pending starts a new turn',async()=>{
 const release=deferred(),routes=[];
 const {radio,track}=fixture(async route=>{routes.push(route);if(route.endsWith('/release'))return release.promise;return {leaseId:'L'+routes.length,expiresAt:Date.now()+12000,leaseDurationMs:12000}});
 await radio.begin();const ending=radio.end();
 const second=radio.begin();assert.equal(radio.transmitting,false);
 release.resolve({released:true});await ending;await second;
 assert.equal(radio.transmitting,true);assert.equal(track.enabled,true);
 assert.deepEqual(routes.filter(r=>r.endsWith('/claim')).length,2);
 await radio.end();
});
test('releasing while the previous release is pending does not start a turn',async()=>{
 const release=deferred();let claims=0;
 const {radio}=fixture(async route=>{if(route.endsWith('/release'))return release.promise;claims++;return {leaseId:'L',expiresAt:Date.now()+12000,leaseDurationMs:12000}});
 await radio.begin();const ending=radio.end();
 const second=radio.begin();const released=radio.end();
 release.resolve({});await ending;await second;await released;
 assert.equal(claims,1);assert.equal(radio.transmitting,false);
});
