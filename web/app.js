import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import { Radio } from './radio.js';
import { createVoicePlayback } from './voice-message.js';
import { updateIncomingAudio } from './listening.js';
import { installPlatform, isStandalone } from './install.js';
import { normaliseCode, formatCode, inviteFromHash, inviteUrl, loadSaved, saveChannel, forgetChannel } from './family.js';
import { TalkControl } from './talk-control.js';
import { PhraseCache } from './phrase-cache.js';

const $ = id => document.getElementById(id);
let busy = false, muted = false, floor = null, pollTimer, refreshTimer, wakeLock, installPrompt;
let pointer = null, spacePressed = false, creating = true, familyCode = null;
const audioElements = new Map();
let voiceJob = null;
let backgroundListening = false;
function message(id, value = '') { $(id).textContent = value; $(id).hidden = !value; }
const showError = error => message('error', error?.message || String(error));
async function api(route, body = {}, token) {
  let response;
  try {
    response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(7000) });
  } catch { throw Error('Cannot reach Cockie Talkie. Check your internet connection and try again.'); }
  const data = await response.json();
  if (!response.ok) { const e = Error(data.error || 'Please try again.'); e.status = response.status; throw e; }
  return data;
}
const radio = new Radio({ api, onChange: render });
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const QUICK_MESSAGES = ['Can you come here, please?', 'Please bring me some water.', 'Baby is asleep. Please be quiet.', 'I am okay. No need to come.'];
const phrases = new PhraseCache();
const talk = new TalkControl({
  start: () => void startTalking(), stop: () => { pointer = null; spacePressed = false; void radio.end(); },
  isActive: () => radio.transmitting || radio.claiming,
  onLimit: () => message('notice', 'Stopped after one minute. Tap again to keep talking.'),
});

function setMode(create) {
  creating = create;
  $('create-mode').setAttribute('aria-pressed', String(create)); $('join-mode').setAttribute('aria-pressed', String(!create));
  $('channel-field').hidden = !create; $('code-field').hidden = create;
  $('channel').required = create; $('code').required = !create;
  $('enter-label').textContent = create ? 'Start channel' : 'Join channel';
  message('error');
}
$('create-mode').onclick = () => setMode(true); $('join-mode').onclick = () => setMode(false);
function setNight(on) {
  document.documentElement.classList.toggle('night', on);
  $('night').setAttribute('aria-pressed', String(on)); $('night').textContent = on ? 'Day mode' : 'Night mode';
  try { store?.setItem('ct-night', on ? '1' : '0'); } catch { /* optional */ }
}
$('night').onclick = () => setNight(!document.documentElement.classList.contains('night'));
function setHoldMode(hold) {
  talk.cancel(); talk.mode = hold ? 'hold' : 'tap'; $('hold-mode').checked = hold;
  try { store?.setItem('ct-hold', hold ? '1' : '0'); } catch { /* optional */ }
  render();
}
$('hold-mode').onchange = () => setHoldMode($('hold-mode').checked);
try {
  setNight(store?.getItem('ct-night') === '1');
  talk.mode = store?.getItem('ct-hold') === '1' ? 'hold' : 'tap'; $('hold-mode').checked = talk.mode === 'hold';
  $('name').value = store?.getItem('relay-name') || '';
} catch { /* private browsing */ }
for (const text of QUICK_MESSAGES) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'quick-message'; button.textContent = text;
  button.onclick = () => void sendVoice(text);
  $('quick-grid').append(button);
}

const linkedCode = inviteFromHash(location.hash);
// The invite is kept in memory and out of referrers and browser history.
if (location.hash) history.replaceState(null, '', location.pathname);
const saved = store ? loadSaved(store) : null;
if (linkedCode && linkedCode !== saved?.code) { $('code').value = formatCode(linkedCode); setMode(false); }
else if (saved) void enter({ join: true, code: saved.code, displayName: saved.name, automatic: true });

$('entry').onsubmit = event => {
  event.preventDefault();
  const displayName = $('name').value.trim();
  if (creating) void enter({ join: false, name: $('channel').value.trim(), displayName });
  else void enter({ join: true, code: $('code').value, displayName });
};
async function enter({ join, code, name, displayName, automatic = false }) {
  if (busy) return;
  busy = true; $('enter').disabled = true; $('create-mode').disabled = true; $('join-mode').disabled = true;
  $('enter-label').textContent = 'Connecting…'; message('error');
  try {
    if (displayName.length < 2) throw Error('Enter a name of at least two characters.');
    const normalised = join ? normaliseCode(code) : null;
    if (join && !normalised) throw Error('Enter the 16-character invite code, for example ABCD-EFGH-JKMN-PQ23.');
    // Ask for the microphone now, so the permission prompt cannot interrupt the first press.
    const microphone = primeMicrophone();
    const session = await api(join ? '/v1/channels/join' : '/v1/channels', join ? { code: normalised, displayName } : { name, displayName });
    familyCode = normalised || normaliseCode(session.channel.code);
    radio.session = session;
    await connect(session);
    await microphone;
    if (store) { saveChannel(store, { code: familyCode, name: displayName }); try { store.setItem('relay-name', displayName); } catch { /* optional */ } }
    if (!join) message('notice', 'Your channel is ready. Open More options to share the invite with your family.');
  } catch (error) {
    await radio.leave(); familyCode = null;
    // A deleted or mistyped saved channel should not retry on every launch.
    if (automatic && error.status === 404 && store) forgetChannel(store);
    showError(automatic && error.status === 404 ? Error('The saved channel no longer exists. Start a new one or join with a code.') : error);
  } finally {
    busy = false; $('enter').disabled = false; $('create-mode').disabled = false; $('join-mode').disabled = false;
    setMode(creating); render();
  }
}
async function primeMicrophone() {
  try { if ((await navigator.permissions?.query({ name: 'microphone' }))?.state === 'granted') return; } catch { /* query unsupported */ }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch { message('notice', 'Microphone access is blocked. Allow it in your browser settings to talk. You can still listen.'); }
}
async function connect(session) {
  const room = new Room({ adaptiveStream: true, disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: true });
  radio.room = room;
  room.on(RoomEvent.TrackSubscribed, track => {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach(); element.muted = muted || (document.hidden && !backgroundListening);
    $('audio').append(element); audioElements.set(track.sid, element); render();
  });
  room.on(RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(element => element.remove()); audioElements.delete(track.sid); });
  for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged]) room.on(event, render);
  room.on(RoomEvent.ConnectionStateChanged, state => {
    if (state !== ConnectionState.Connected) { cancelVoice(); void radio.end(); }
    render();
  });
  room.on(RoomEvent.MediaDevicesError, () => showError(Error('Allow microphone access in your browser settings, then tap the button again.')));
  try { await room.connect(session.credentials.serverUrl, session.credentials.participantToken); }
  catch (error) { await room.disconnect(); throw Error('Unable to join the voice channel. Please check your connection and try again.'); }
  startTimers(); await pollFloor(); void requestWakeLock(); render();
}
function startTimers() {
  clearTimeout(pollTimer); clearTimeout(refreshTimer);
  pollTimer = setTimeout(() => void pollLoop(), 1500);
  refreshTimer = setTimeout(() => void refreshSession(), 50 * 60000);
}
async function pollFloor() {
  const session = radio.session;
  if (!session || !radio.connected) return;
  try {
    const result = await api('/v1/floor/status', {}, session.credentials.sessionToken);
    if (radio.session !== session) return;
    floor = result; render();
  } catch (error) {
    if (error.status === 401) { await radio.end(); showError(error); }
  }
}
async function pollLoop() {
  await pollFloor();
  if (radio.session) pollTimer = setTimeout(() => void pollLoop(), document.hidden ? 7000 : 1500);
}
async function refreshSession() {
  const session = radio.session;
  if (!session) return;
  try {
    const result = await api('/v1/session/refresh', {}, session.credentials.sessionToken);
    if (radio.session !== session) return;
    session.credentials = result.credentials;
    refreshTimer = setTimeout(() => void refreshSession(), 50 * 60000);
  } catch (error) {
    if (error.status === 401) { await radio.end(); showError(error); }
    else refreshTimer = setTimeout(() => void refreshSession(), 30000);
  }
}
function render() {
  const session = radio.session, room = radio.room, connected = radio.connected;
  $('lobby').hidden = !!session; $('channel-view').hidden = !session;
  if (!session) return;
  $('channel-title').textContent = session.channel.name;
  $('invite-code').textContent = familyCode ? formatCode(familyCode) : '';
  const state = room?.state;
  $('connection').textContent = connected ? '● Connected' : state === 'connecting' || !state && busy ? 'Connecting…' : state === 'reconnecting' || state === 'signalReconnecting' ? 'Reconnecting…' : 'Disconnected';
  $('talk').disabled = !connected || busy || !!voiceJob;
  const voiceBlocked = !connected || busy || !!voiceJob || radio.claiming || radio.transmitting || !!radio.ending;
  $('send-voice').disabled = voiceBlocked;
  for (const button of $('quick-grid').children) button.disabled = voiceBlocked;
  $('voice-text').disabled = !!voiceJob;
  $('stop-voice').hidden = !voiceJob;
  $('talk').setAttribute('aria-pressed', String(radio.transmitting));
  const isBusy = floor?.busy && floor.participantId !== session.credentials.participantId;
  $('talk').classList.toggle('busy', !!isBusy && !radio.transmitting);
  const active = [...(room?.remoteParticipants.values() || [])].find(p => p.isSpeaking);
  const speaker = active?.name || (isBusy ? floor.speaker : null);
  $('air-status').textContent = radio.transmitting ? (radio.clip ? 'YOUR VOICE MESSAGE IS LIVE' : 'YOU ARE LIVE') : radio.claiming ? 'REQUESTING AIRTIME' : speaker ? 'NOW TRANSMITTING' : 'CHANNEL IS CLEAR';
  $('speaker').textContent = radio.transmitting ? 'You' : radio.claiming ? 'One moment…' : speaker || 'Ready to talk';
  const tap = talk.mode === 'tap';
  $('talk-label').textContent = radio.transmitting ? (tap ? 'TAP TO STOP' : 'TRANSMITTING') : radio.claiming ? 'CONNECTING' : tap ? 'TAP TO TALK' : 'HOLD TO TALK';
  $('talk-hint').textContent = radio.transmitting ? (tap ? 'YOU ARE LIVE' : 'RELEASE TO STOP') : tap ? 'TAP AGAIN TO STOP' : 'RELEASE TO LISTEN';
  $('talk').setAttribute('aria-label', tap ? (radio.transmitting ? 'Tap to stop talking' : 'Tap to talk') : 'Hold to talk; release to listen');
  $('mic-status').textContent = radio.transmitting && !radio.clip ? 'Microphone live' : 'Microphone off';
  $('enable-audio').hidden = !connected || room.canPlaybackAudio || muted;
  $('reconnect').hidden = connected || busy || !['disconnected', undefined].includes(room?.state);
  const people = connected ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  $('online-count').textContent = `${people.length} online`;
  $('participants').replaceChildren(...people.map(p => {
    const li = document.createElement('li');
    li.textContent = (p.name || 'Participant') + (p === room.localParticipant ? ' (you)' : '');
    li.className = p.isSpeaking || p === room.localParticipant && radio.transmitting ? 'speaking' : ''; return li;
  }));
  if (radio.error) message('error', radio.error);
}
async function startTalking() {
  if (document.hidden || !radio.connected || busy || voiceJob) return;
  message('error'); radio.error = '';
  // User-gesture call also unlocks Safari audio playback.
  void radio.room.startAudio().catch(() => {});
  await radio.begin();
  if (radio.error) showError(Error(radio.error));
}
function stopTalking() { talk.cancel(); }
$('talk').addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer !== null || spacePressed) return;
  event.preventDefault(); pointer = event.pointerId;
  if (talk.mode === 'hold') $('talk').setPointerCapture(event.pointerId);
  talk.press();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('talk').addEventListener(event, e => {
  if (pointer !== e.pointerId) return;
  pointer = null;
  // A cancelled touch in hold mode must stop; in tap mode only a tap toggles.
  if (talk.mode === 'hold') talk.release();
});
$('talk').addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('keydown', event => {
  if (!radio.session || event.code !== 'Space' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) && event.target !== $('talk') || event.target.isContentEditable) return;
  event.preventDefault(); if (event.repeat || spacePressed || pointer !== null) return;
  spacePressed = true; talk.press();
});
window.addEventListener('keyup', event => { if (event.code === 'Space' && spacePressed) { event.preventDefault(); spacePressed = false; talk.release(); } });
window.addEventListener('blur', () => { stopTalking(); cancelVoice(); });
window.addEventListener('pagehide', () => { cancelVoice(); stopTalking(); void radio.room?.disconnect(); });
window.addEventListener('offline', () => { cancelVoice(); stopTalking(); message('error', 'You are offline. Waiting for your connection…'); });
window.addEventListener('online', () => { message('error'); void pollFloor(); render(); });
document.addEventListener('visibilitychange', () => {
  applyListening();
  if (document.hidden) { cancelVoice(); stopTalking(); void wakeLock?.release(); }
  else if (radio.session) {
    void requestWakeLock(); void pollFloor();
    if (radio.session.credentials.expiresAt - Date.now() < 20 * 60000) { clearTimeout(refreshTimer); void refreshSession(); }
  }
});
async function requestWakeLock() {
  if (!radio.session || document.hidden || backgroundListening || wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported on every device */ }
}
$('enable-audio').onclick = async () => { try { await radio.room?.startAudio(); render(); } catch { showError(Error('Sound could not start. Tap again.')); } };
$('sound').onclick = () => {
  muted = !muted; applyListening();
  $('sound').textContent = muted ? 'Sound off' : 'Sound on'; $('sound').setAttribute('aria-pressed', String(muted));
  if (!muted) void radio.room?.startAudio().catch(showError); render();
};
$('leave').onclick = async () => {
  if (busy) return; busy = true; $('leave').disabled = true;
  if (store) forgetChannel(store); familyCode = null; $('code').value = '';
  clearTimeout(pollTimer); clearTimeout(refreshTimer); cancelVoice(); stopTalking();
  await radio.leave(); clearTimeout(pollTimer); clearTimeout(refreshTimer); await wakeLock?.release();
  backgroundListening = false; $('background-listening').checked = false; applyListening();
  floor = null; audioElements.clear(); $('audio').replaceChildren();
  message('error'); message('notice'); busy = false; $('leave').disabled = false; render();
};
$('reconnect').onclick = async () => {
  if (busy || !radio.session) return; busy = true; render();
  try {
    const session = radio.session;
    const result = await api('/v1/session/refresh', {}, session.credentials.sessionToken);
    await radio.leave(); session.credentials = result.credentials; radio.session = session;
    audioElements.clear(); $('audio').replaceChildren(); await connect(session); message('error');
  } catch (error) { showError(error); }
  finally { busy = false; render(); }
};
function applyListening() {
  updateIncomingAudio(audioElements.values(), { muted, hidden: document.hidden, backgroundListening });
  $('background-status').textContent = backgroundListening
    ? 'On · incoming speech only. Your browser may still suspend listening.'
    : 'Off · incoming audio pauses when you switch away.';
}
$('background-listening').onchange = async () => {
  backgroundListening = $('background-listening').checked;
  applyListening();
  if (backgroundListening) {
    // Unlock remote audio in the explicit toggle gesture. No microphone capture.
    try { await radio.room?.startAudio(); } catch { showError(Error('Tap Enable sound to hear incoming transmissions.')); }
    await wakeLock?.release();
  } else void requestWakeLock();
  render();
};
$('voice-text').addEventListener('input', () => {
  $('voice-count').textContent = `${$('voice-text').value.length} / 300 · English`;
});
function cancelVoice() {
  if (!voiceJob) return;
  voiceJob.cancelled = true; voiceJob.abort.abort();
  voiceJob.playback?.stop(); void radio.end();
  $('voice-status').textContent = 'Voice message stopped.';
}
$('stop-voice').onclick = cancelVoice;
$('voice-form').onsubmit = async event => {
  event.preventDefault();
  if (await sendVoice($('voice-text').value.trim())) { $('voice-text').value = ''; $('voice-count').textContent = '0 / 300 · English'; }
};
async function readSpeech(text, job) {
  const cached = phrases.get(text);
  if (cached) return cached;
  const response = await fetch('/v1/speech', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${job.session.credentials.sessionToken}` }, body: JSON.stringify({ text }), signal: job.abort.signal });
  if (!response.ok) {
    const error = await response.json(); throw Error(error.error || 'Unable to prepare the voice message.');
  }
  // Bound the response before decoding untrusted audio into memory.
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Error('The generated audio is too large. Please shorten the message.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (QUICK_MESSAGES.includes(text)) phrases.set(text, bytes);
  return bytes;
}
// Returns true when the message was transmitted.
async function sendVoice(text) {
  if (!radio.connected || !radio.session || voiceJob || busy || radio.transmitting || radio.claiming || radio.ending) return false;
  if (!text || text.length > 300) { showError(Error('Enter a message of 1 to 300 characters.')); return false; }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { showError(Error('This browser cannot send generated audio. Try Safari or Chrome.')); return false; }
  const context = new AudioContextClass();
  const job = { session: radio.session, context, abort: new AbortController(), playback: null, cancelled: false };
  voiceJob = job; message('error'); $('voice-status').textContent = 'Preparing your voice message…'; render();
  const timer = setTimeout(() => job.abort.abort(), 30000);
  try {
    // Resume within the Send gesture, before network work, for iPhone support.
    await context.resume();
    const bytes = await readSpeech(text, job);
    clearTimeout(timer);
    if (job.cancelled || radio.session !== job.session || !radio.connected || document.hidden) return false;
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (!buffer.duration || buffer.duration > 60) throw Error('The voice message is too long. Please shorten it to under one minute.');
    if (job.cancelled || radio.session !== job.session || !radio.connected || document.hidden) return false;
    if (context.state !== 'running') throw Error('Audio paused. Tap Send again to enable it.');
    job.playback = createVoicePlayback(context, buffer);
    $('voice-status').textContent = 'Connecting your voice message…';
    await radio.playClip(job.playback);
    if (radio.error) throw Error(radio.error);
    if (job.cancelled || !radio.transmitting) return false;
    $('voice-status').textContent = 'Sending as audio. Your microphone is off.';
    await job.playback.done;
    if (job.cancelled || radio.error) return false;
    $('voice-status').textContent = `Sent: “${text}”`;
    return true;
  } catch (error) {
    if (!job.cancelled) {
      const description = error.name === 'AbortError' ? 'Speech generation timed out. Please try again.' : error.message;
      showError(Error(description)); $('voice-status').textContent = 'Message not sent. Please try again.';
    }
    return false;
  } finally {
    clearTimeout(timer); job.playback?.stop();
    if (radio.session === job.session) {
      await radio.end();
      if (radio.pending) await radio.pending;
      if (radio.ending) await radio.ending;
    }
    await context.close().catch(() => {});
    if (voiceJob === job) voiceJob = null;
    render();
  }
}
const shareUrl = () => inviteUrl(location.origin, familyCode);
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(shareUrl()); message('notice', 'Invite link copied.'); }
  catch { message('notice', `Share this invite code: ${formatCode(familyCode)}`); }
};
$('share').onclick = async () => {
  const data = { title: 'Join my Cockie Talkie channel', text: `Join ${radio.session.channel.name} on Cockie Talkie.`, url: shareUrl() };
  try { if (navigator.share) await navigator.share(data); else await $('copy').onclick(); }
  catch (error) { if (error.name !== 'AbortError') showError(Error('Unable to share. Use Copy link instead.')); }
};
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
let installedHere = isStandalone(standaloneQuery.matches, navigator.standalone);
function updateInstallUI() {
  $('install').hidden = installedHere;
  $('install-main').hidden = installedHere;
  $('install-heading').textContent = installedHere ? 'Cockie Talkie is installed' : 'Cockie Talkie on your Home Screen';
  $('install-description').textContent = installedHere ? 'You are using the standalone app.' : 'Install on iPhone or Android. Open from its own icon, in a standalone app window.';
  $('native-install').hidden = !installPrompt || installedHere;
}
function installTab(platform) {
  const ios = platform === 'ios';
  $('ios-instructions').hidden = !ios; $('android-instructions').hidden = ios;
  $('install-ios').setAttribute('aria-pressed', String(ios));
  $('install-android').setAttribute('aria-pressed', String(!ios));
}
function showInstallGuide() {
  installTab(installPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) === 'ios' ? 'ios' : 'android');
  updateInstallUI();
  $('install-guide').showModal();
}
$('install').onclick = showInstallGuide;
$('install-main').onclick = showInstallGuide;
$('install-ios').onclick = () => installTab('ios');
$('install-android').onclick = () => installTab('android');
$('close-install').onclick = () => $('install-guide').close();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; updateInstallUI();
});
$('native-install').onclick = async () => {
  if (!installPrompt) return;
  const prompt = installPrompt; installPrompt = null; updateInstallUI();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    $('install-feedback').textContent = choice.outcome === 'accepted'
      ? 'Installation accepted. Open Cockie Talkie from your Home Screen once its icon appears.'
      : 'Installation cancelled. You can use the browser menu to install later.';
  } catch { $('install-feedback').textContent = 'Use your browser menu to install, following the steps above.'; }
};
window.addEventListener('appinstalled', () => {
  installedHere = true; installPrompt = null; updateInstallUI();
  $('install-feedback').textContent = 'Cockie Talkie is installed. Open it from your Home Screen.';
});
standaloneQuery.addEventListener('change', () => {
  installedHere = isStandalone(standaloneQuery.matches, navigator.standalone); updateInstallUI();
});
updateInstallUI();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
