import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('native bootstrap is idempotent and sets app names and background audio capabilities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cockie-native-'));
 try {
  for(const path of ['tool','android/app/src/main','android/app/src/debug','ios/Runner'])await mkdir(join(root,path),{recursive:true});
  await copyFile('mobile/tool/configure_native.py',join(root,'tool/configure_native.py'));
  await writeFile(join(root,'android/app/src/main/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="old"/></manifest>');
  await writeFile(join(root,'android/app/src/debug/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>');
  execFileSync('python3',['-c',"import plistlib,sys;plistlib.dump({},open(sys.argv[1],'wb'))",join(root,'ios/Runner/Info.plist')]);
  for(let i=0;i<2;i++)execFileSync('python3',[join(root,'tool/configure_native.py')]);
  const result=execFileSync('python3',['-c',`import xml.etree.ElementTree as E,plistlib,json,sys
from pathlib import Path
r=Path(sys.argv[1]);m=E.parse(r/'android/app/src/main/AndroidManifest.xml').getroot();a='{http://schemas.android.com/apk/res/android}'
p=plistlib.load(open(r/'ios/Runner/Info.plist','rb'));app=m.find('application');s=app.findall('service')
print(json.dumps({'android':app.get(a+'label'),'services':len(s),'type':s[0].get(a+'foregroundServiceType'),'exported':s[0].get(a+'exported'),'permissions':[v.get(a+'name') for v in m.findall('uses-permission')],'ios':p['CFBundleDisplayName'],'modes':p['UIBackgroundModes']}))`,root],{encoding:'utf8'});
  const v=JSON.parse(result);assert.equal(v.android,'Cockie Talkie');assert.equal(v.ios,'Cockie Talkie');assert.equal(v.services,1);assert.equal(v.type,'mediaPlayback');assert.equal(v.exported,'false');assert.ok(v.modes.includes('audio'));assert.ok(v.permissions.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'));assert.equal(v.permissions.length,new Set(v.permissions).size);
 } finally {await rm(root,{recursive:true,force:true});}
});
