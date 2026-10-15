#!/usr/bin/env python3
"""Idempotent, conservative platform permission configuration after flutter create."""
from pathlib import Path
import plistlib
import shutil
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
manifest = root / 'android/app/src/main/AndroidManifest.xml'
debug_manifest = root / 'android/app/src/debug/AndroidManifest.xml'
info_plist = root / 'ios/Runner/Info.plist'

if not (manifest.exists() and info_plist.exists()):
    raise SystemExit('Missing native projects. Run flutter create first (see README).')

ANDROID_NS = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID_NS)
android_key = '{%s}name' % ANDROID_NS
root_xml = ET.parse(manifest)
manifest_el = root_xml.getroot()
required = [
    ('android.permission.INTERNET', {}),
    ('android.permission.FOREGROUND_SERVICE', {}),
    ('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', {}),
    ('android.permission.RECORD_AUDIO', {}),
    ('android.permission.ACCESS_NETWORK_STATE', {}),
    ('android.permission.CHANGE_NETWORK_STATE', {}),
    ('android.permission.MODIFY_AUDIO_SETTINGS', {}),
    ('android.permission.BLUETOOTH', {'{%s}maxSdkVersion' % ANDROID_NS: '30'}),
]
existing = {entry.attrib.get(android_key) for entry in manifest_el.findall('uses-permission')}
for name, extra_attrs in required:
    if name not in existing:
        manifest_el.insert(0, ET.Element('uses-permission', {android_key: name, **extra_attrs}))
app_el = manifest_el.find('application')
if app_el is not None:
    app_el.set('{%s}label' % ANDROID_NS, 'Cockie Talkie')
    service_name = 'de.julianassmann.flutter_background.IsolateHolderService'
    service = next((s for s in app_el.findall('service') if s.attrib.get(android_key) == service_name), None)
    if service is None:
        service = ET.SubElement(app_el, 'service', {android_key: service_name})
    service.set('{%s}exported' % ANDROID_NS, 'false')
    service.set('{%s}foregroundServiceType' % ANDROID_NS, 'mediaPlayback')
ET.indent(root_xml, space='    ')
root_xml.write(manifest, encoding='utf-8', xml_declaration=True)

# Development HTTP is allowed only in Android's *debug* manifest.
if debug_manifest.exists():
    tree = ET.parse(debug_manifest)
    app = tree.getroot().find('application')
    if app is None:
        app = ET.SubElement(tree.getroot(), 'application')
    app.set('{%s}usesCleartextTraffic' % ANDROID_NS, 'true')
    ET.indent(tree, space='    ')
    tree.write(debug_manifest, encoding='utf-8', xml_declaration=True)

with open(info_plist, 'rb') as f:
    config = plistlib.load(f)
config['CFBundleDisplayName'] = 'Cockie Talkie'
config['CFBundleName'] = 'Cockie Talkie'
config['NSMicrophoneUsageDescription'] = 'Cockie Talkie uses your microphone only while you hold Push to Talk.'
config['UIBackgroundModes'] = list(dict.fromkeys([*config.get('UIBackgroundModes', []), 'audio']))
# Local network exceptions enable simulator/dev testing; production uses HTTPS.
transport = config.get('NSAppTransportSecurity', {})
transport['NSAllowsLocalNetworking'] = True
config['NSAppTransportSecurity'] = transport
with open(info_plist, 'wb') as f:
    plistlib.dump(config, f, sort_keys=False)
print('Configured Android permissions and iOS microphone/background-audio settings.')

# Copy the supplied sticker launcher assets after flutter create.
icon_root = root / 'assets/app-icons'
android_icons = icon_root / 'android'
if android_icons.exists():
    for density in android_icons.iterdir():
        if density.is_dir():
            target = root / 'android/app/src/main/res' / density.name
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(density / 'ic_launcher.png', target / 'ic_launcher.png')
ios_icons = icon_root / 'ios'
if ios_icons.exists():
    target = root / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
    target.mkdir(parents=True, exist_ok=True)
    for asset in ios_icons.iterdir():
        if asset.is_file():
            shutil.copy2(asset, target / asset.name)
