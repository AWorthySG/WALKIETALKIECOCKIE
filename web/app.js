import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import { Radio } from './radio.js';
import { createVoicePlayback } from './voice-message.js';
import { updateIncomingAudio } from './listening.js';
import { installPlatform, isStandalone } from './install.js';
import { channelFromHash, channelUrl } from './channel.js';

const $ = id => document.getElementById(id);
let busy = false, muted = false, floor = null, pollTimer, refreshTimer, wakeLock, installPrompt;
let pointer = null, spacePressed = false;
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
try {
  $('name').value = localStorage.getItem('relay-name') || '';
  const saved = channelFromHash(`channel=${localStorage.getItem('relay-channel')}`);
  if (saved) $('channel-number').value = String(saved);
} catch { /* private browsing */ }
const linked = channelFromHash(location.hash);
if (linked) $('channel-number').value = String(linked);
if (location.hash) history.replaceState(null, '', location.pathname);

$('entry').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('enter').disabled = true; $('channel-number').disabled = true;
  $('enter').textContent = 'Tuning in…'; message('error');
  const displayName = $('name').value.trim();
  const number = Number($('channel-number').value);
  try {
    if (displayName.length < 2) throw Error('Enter a name of at least two characters.');
    // Ask for the microphone now, so the permission prompt cannot interrupt the first press.
    const microphone = primeMicrophone();
    const session = await api('/v1/channels/tune', { number, displayName });
    radio.session = session;
    await connect(session);
    await microphone;
    try { localStorage.setItem('relay-name', displayName); localStorage.setItem('relay-channel', String(number)); } catch { /* optional */ }
  } catch (error) { await radio.leave(); showError(error); }
  finally {
    busy = false; $('enter').disabled = false; $('channel-number').disabled = false;
    $('enter').innerHTML = 'Tune in <span>↗</span>'; render();
  }
};
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
  room.on(RoomEvent.MediaDevicesError, () => showError(Error('Allow microphone access in your browser settings, then hold the button again.')));
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
  $('lobby').hidden = !!session; $('channel-view').hidden = !session; $('leave').hidden = !session;
  if (!session) return;
  $('channel-title').textContent = session.channel.name;
  $('invite-code').textContent = `${session.channel.name} · shared`;
  $('connection').textContent = connected ? '● Connected' : room?.state === 'reconnecting' || room?.state === 'signalReconnecting' ? 'Reconnecting…' : 'Disconnected';
  $('talk').disabled = !connected || busy || !!voiceJob;
  $('send-voice').disabled = !connected || busy || !!voiceJob || radio.claiming || radio.transmitting || !!radio.ending;
  $('voice-text').disabled = !!voiceJob;
  $('stop-voice').hidden = !voiceJob;
  $('talk').setAttribute('aria-pressed', String(radio.transmitting));
  const isBusy = floor?.busy && floor.participantId !== session.credentials.participantId;
  $('talk').classList.toggle('busy', !!isBusy && !radio.transmitting);
  const active = [...(room?.remoteParticipants.values() || [])].find(p => p.isSpeaking);
  const speaker = active?.name || (isBusy ? floor.speaker : null);
  $('air-status').textContent = radio.transmitting ? (radio.clip ? 'YOUR VOICE MESSAGE IS LIVE' : 'YOU ARE LIVE') : radio.claiming ? 'REQUESTING AIRTIME' : speaker ? 'NOW TRANSMITTING' : 'CHANNEL IS CLEAR';
  $('speaker').textContent = radio.transmitting ? 'You' : radio.claiming ? 'One moment…' : speaker || 'Ready to talk';
  $('talk-label').textContent = radio.transmitting ? 'TRANSMITTING' : radio.claiming ? 'CONNECTING' : 'HOLD TO TALK';
  $('talk-hint').textContent = radio.transmitting ? 'RELEASE TO STOP' : 'RELEASE TO LISTEN';
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
function stopTalking() { pointer = null; spacePressed = false; void radio.end(); }
$('talk').addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer !== null || spacePressed) return;
  event.preventDefault(); pointer = event.pointerId;
  $('talk').setPointerCapture(event.pointerId); void startTalking();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('talk').addEventListener(event, e => { if (pointer === e.pointerId) stopTalking(); });
$('talk').addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('keydown', event => {
  if (!radio.session || event.code !== 'Space' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) && event.target !== $('talk') || event.target.isContentEditable) return;
  event.preventDefault(); if (event.repeat || spacePressed || pointer !== null) return;
  spacePressed = true; void startTalking();
});
window.addEventListener('keyup', event => { if (event.code === 'Space' && spacePressed) { event.preventDefault(); stopTalking(); } });
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
  const text = $('voice-text').value.trim();
  if (!radio.connected || !radio.session || voiceJob || busy || radio.transmitting || radio.claiming || radio.ending) return;
  if (!text || text.length > 300) { showError(Error('Enter a message of 1 to 300 characters.')); return; }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { showError(Error('This browser cannot send generated audio. Try Safari or Chrome.')); return; }
  const context = new AudioContextClass();
  const job = { session: radio.session, context, abort: new AbortController(), playback: null, cancelled: false };
  voiceJob = job; message('error'); $('voice-status').textContent = 'Preparing your voice message…'; render();
  const timer = setTimeout(() => job.abort.abort(), 30000);
  try {
    // Resume within the Send gesture, before network work, for iPhone support.
    await context.resume();
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
    clearTimeout(timer);
    if (job.cancelled || radio.session !== job.session || !radio.connected || document.hidden) return;
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (!buffer.duration || buffer.duration > 60) throw Error('The voice message is too long. Please shorten it to under one minute.');
    if (job.cancelled || radio.session !== job.session || !radio.connected || document.hidden) return;
    if (context.state !== 'running') throw Error('Audio paused. Tap Send again to enable it.');
    job.playback = createVoicePlayback(context, buffer);
    $('voice-status').textContent = 'Connecting your voice message…';
    await radio.playClip(job.playback);
    if (radio.error) throw Error(radio.error);
    if (job.cancelled || !radio.transmitting) return;
    $('voice-status').textContent = 'Sending as audio. Your microphone is off.';
    await job.playback.done;
    if (!job.cancelled && !radio.error) {
      $('voice-text').value = ''; $('voice-count').textContent = '0 / 300 · English';
      $('voice-status').textContent = 'Voice message transmitted to the channel.';
    }
  } catch (error) {
    if (!job.cancelled) {
      const description = error.name === 'AbortError' ? 'Speech generation timed out. Please try again.' : error.message;
      showError(Error(description)); $('voice-status').textContent = 'Message not completed. Your draft is kept below.';
    }
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
};
const shareUrl = () => channelUrl(location.origin, radio.session.channel.number);
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(shareUrl()); message('notice', 'Channel link copied.'); }
  catch { message('notice', `Tune in to ${radio.session.channel.name}.`); }
};
$('share').onclick = async () => {
  const data = { title: 'Join my Cockie Talkie channel', text: `Join ${radio.session.channel.name} on Cockie Talkie.`, url: shareUrl() };
  try { if (navigator.share) await navigator.share(data); else await $('copy').onclick(); }
  catch (error) { if (error.name !== 'AbortError') showError(Error('Unable to share. Use Copy to copy the channel link.')); }
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
