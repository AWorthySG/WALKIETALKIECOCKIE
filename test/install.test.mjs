import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlatform,isStandalone} from '../web/install.js';
test('installation guide recognises iPhone and desktop-mode iPad',()=>{
 assert.equal(installPlatform('Mozilla iPhone','iPhone',5),'ios');
 assert.equal(installPlatform('Mozilla Macintosh','MacIntel',5),'ios');
 assert.equal(installPlatform('Mozilla Macintosh','MacIntel',0),'desktop');
});
test('Android installation guidance stays separate from iOS',()=>{
 assert.equal(installPlatform('Mozilla Android 16','Linux armv8',5),'android');
 assert.equal(installPlatform('Mozilla Windows','Win32',0),'desktop');
});
test('standalone detection supports Android display mode and iOS navigator flag',()=>{
 assert.equal(isStandalone(true,undefined),true);assert.equal(isStandalone(false,true),true);
 assert.equal(isStandalone(false,undefined),false);assert.equal(isStandalone(false,false),false);
});
