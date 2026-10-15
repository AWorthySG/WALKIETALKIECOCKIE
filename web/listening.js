// Only remote audio elements use this policy. No idle sounds or keep-alive audio.
export function shouldPlayIncoming({ muted, hidden, backgroundListening }) {
  return !muted && (!hidden || backgroundListening);
}
export function updateIncomingAudio(elements, settings) {
  const audible = shouldPlayIncoming(settings);
  for (const element of elements) element.muted = !audible;
  return audible;
}
