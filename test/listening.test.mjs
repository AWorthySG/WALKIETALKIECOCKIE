import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPlayIncoming,updateIncomingAudio} from '../web/listening.js';
test('foreground incoming audio follows the sound control',()=>{
 for(const backgroundListening of [true,false]) {
  assert.equal(shouldPlayIncoming({hidden:false,muted:false,backgroundListening}),true);
  assert.equal(shouldPlayIncoming({hidden:false,muted:true,backgroundListening}),false);
 }
});
test('switching away silences incoming audio unless background listening was enabled',()=>{
 assert.equal(shouldPlayIncoming({hidden:true,muted:false,backgroundListening:false}),false);
 assert.equal(shouldPlayIncoming({hidden:true,muted:false,backgroundListening:true}),true);
 assert.equal(shouldPlayIncoming({hidden:true,muted:true,backgroundListening:true}),false);
});
test('background policy updates existing receivers and restores sound on return',()=>{
 const elements=[{muted:false},{muted:false}];
 updateIncomingAudio(elements,{hidden:true,muted:false,backgroundListening:false});assert.ok(elements.every(e=>e.muted));
 updateIncomingAudio(elements,{hidden:false,muted:false,backgroundListening:false});assert.ok(elements.every(e=>!e.muted));
 updateIncomingAudio(elements,{hidden:true,muted:false,backgroundListening:true});assert.ok(elements.every(e=>!e.muted));
 updateIncomingAudio(elements,{hidden:true,muted:true,backgroundListening:true});assert.ok(elements.every(e=>e.muted));
});
