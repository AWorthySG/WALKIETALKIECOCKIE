// Independent of the page so microphone/lease races can be tested directly.
export class Radio {
  constructor({ api, onChange = () => {}, now = Date.now }) {
    this.api = api; this.onChange = onChange; this.now = now;
    this.room = null; this.session = null; this.pressed = false;
    this.claiming = false; this.transmitting = false; this.lease = null;
    this.ending = null; this.pending = null; this.error = ''; this.deadline = null; this.heartbeat = null;
  }
  get connected() { return this.room?.state === 'connected'; }
  change() { this.onChange(); }
  hardMute() {
    // Synchronous cut-off even if an SDK operation or network request is pending.
    for (const publication of this.room?.localParticipant.audioTrackPublications.values() || []) {
      if (publication.track?.mediaStreamTrack) publication.track.mediaStreamTrack.enabled = false;
    }
  }
  // Time the lease with the local clock; a phone clock ahead of the server must not cancel every press.
  leaseExpiry(result) { return Number.isFinite(result.leaseDurationMs) ? this.now() + result.leaseDurationMs : result.expiresAt; }
  begin() {
    if (!this.connected || !this.session || this.claiming || this.transmitting) return Promise.resolve();
    if (this.ending) {
      // A quick re-press while the previous turn is still being released starts once that release settles.
      this.pressed = true;
      return this.ending.then(() => (this.pressed ? this.begin() : undefined));
    }
    this.pressed = true; this.claiming = true; this.error = ''; this.change();
    this.pending = this.acquire().finally(() => { this.claiming = false; this.pending = null; this.change(); });
    return this.pending;
  }
  async acquire() {
    const session = this.session, room = this.room;
    try {
      const result = await this.api('/v1/floor/claim', {}, session.credentials.sessionToken);
      this.lease = { id: result.leaseId, expiresAt: this.leaseExpiry(result), session, room };
      this.scheduleDeadline();
      if (!this.pressed || !this.connected || this.session !== session || this.lease.expiresAt <= this.now()) return;
      await room.localParticipant.setMicrophoneEnabled(true);
      if (!this.pressed || !this.connected || this.session !== session || !this.lease || this.lease.expiresAt <= this.now()) return;
      this.transmitting = true; this.change();
      this.heartbeat = setTimeout(() => void this.renew(), 4000);
    } catch (error) { this.transmitting = false; this.error = error.message; }
    finally { if (!this.transmitting) await this.finish(); }
  }
  playClip(playback) {
    if (!this.connected || !this.session || this.claiming || this.transmitting || this.ending) return Promise.reject(Error('Wait until the channel is ready.'));
    this.pressed = true; this.claiming = true; this.error = ''; this.clip = playback; this.change();
    this.pending = this.acquireClip(playback).finally(() => { this.claiming = false; this.pending = null; this.change(); });
    return this.pending;
  }
  async acquireClip(playback) {
    const session = this.session, room = this.room;
    try {
      const result = await this.api('/v1/floor/claim', {}, session.credentials.sessionToken);
      this.lease = { id: result.leaseId, expiresAt: this.leaseExpiry(result), session, room };
      this.scheduleDeadline();
      if (!this.pressed || !this.connected || this.session !== session || this.lease.expiresAt <= this.now()) return;
      await playback.prepare(room);
      if (!this.pressed || !this.connected || this.session !== session || !this.lease || this.lease.expiresAt <= this.now()) return;
      this.transmitting = true; this.change();
      this.heartbeat = setTimeout(() => void this.renew(), 4000);
      playback.start();
      void playback.done.then(() => this.end()).catch(() => this.end());
    } catch (error) { this.transmitting = false; this.error = error.message; }
    finally { if (!this.transmitting) await this.finish(); }
  }
  scheduleDeadline() {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => {
      this.error = 'Transmission stopped. The speaking turn expired.';
      void this.end();
    }, Math.max(0, this.lease.expiresAt - this.now() - 500));
  }
  async renew() {
    const lease = this.lease;
    if (!lease || !this.transmitting) return;
    try {
      const result = await this.api('/v1/floor/renew', { leaseId: lease.id }, lease.session.credentials.sessionToken);
      if (this.lease !== lease || !this.pressed || !this.transmitting) return;
      lease.expiresAt = this.leaseExpiry(result); this.scheduleDeadline();
      this.heartbeat = setTimeout(() => void this.renew(), 4000);
    } catch {
      if (this.lease !== lease) return;
      this.error = 'Transmission stopped. Check your connection.';
      await this.end();
    }
  }
  async end() {
    this.pressed = false; this.transmitting = false; this.hardMute(); this.change();
    // acquire() owns cleanup until its publish operation settles.
    if (this.claiming) return;
    await this.finish();
  }
  finish() {
    if (this.ending) return this.ending;
    clearTimeout(this.heartbeat); clearTimeout(this.deadline);
    this.transmitting = false; this.hardMute();
    const lease = this.lease; this.lease = null;
    const clip = this.clip; this.clip = null;
    clip?.stop();
    this.ending = (async () => {
      try {
        if (clip) await clip.dispose(lease?.room || this.room);
        else await (lease?.room || this.room)?.localParticipant.setMicrophoneEnabled(false);
      }
      catch {
        // A failed mute must not leave a live local capture track.
        for (const p of (lease?.room || this.room)?.localParticipant.audioTrackPublications.values() || []) p.track?.stop();
      }
      if (lease) {
        try { await this.api('/v1/floor/release', { leaseId: lease.id }, lease.session.credentials.sessionToken); }
        catch { /* Server lease will expire. Microphone is already off. */ }
      }
    })().finally(() => { this.ending = null; this.change(); });
    return this.ending;
  }
  async leave() {
    await this.end();
    if (this.pending) await this.pending;
    if (this.ending) await this.ending;
    const room = this.room; this.room = null; this.session = null;
    await room?.disconnect(); this.change();
  }
}
