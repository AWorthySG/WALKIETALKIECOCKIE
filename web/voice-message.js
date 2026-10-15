import { Track } from 'livekit-client';

// Web Audio feeds a generated track into the same LiveKit microphone source.
// It is deliberately never connected to context.destination (local speakers).
export function createVoicePlayback(context, buffer) {
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource(); source.buffer = buffer;
  source.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  let resolve, stopped = false, published = false;
  const done = new Promise(r => { resolve = r; });
  source.onended = () => resolve();
  return {
    done,
    async prepare(room) {
      // The previous physical microphone remains off and is removed before the
      // synthetic track takes its place. Normal PTT recreates it on next use.
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.source === Track.Source.Microphone && publication.track) {
          await room.localParticipant.unpublishTrack(publication.track, true);
        }
      }
      if (stopped) return;
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'typed-voice-message' });
      published = true;
    },
    start() { if (!stopped) source.start(); },
    stop() {
      if (stopped) return; stopped = true;
      track.enabled = false;
      try { source.stop(); } catch { /* never started */ }
      track.stop(); source.disconnect(); resolve();
    },
    async dispose(room) {
      this.stop();
      if (published) await room?.localParticipant.unpublishTrack(track, true);
    },
  };
}
