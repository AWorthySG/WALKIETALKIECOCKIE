export const CHANNEL_COUNT = 20;
// Accepts "#channel=7" or "channel=7"; anything outside 1–20 is ignored.
export function channelFromHash(hash) {
  const value = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('channel');
  if (!/^\d{1,2}$/.test(value || '')) return null;
  const number = Number(value);
  return number >= 1 && number <= CHANNEL_COUNT ? number : null;
}
export const channelUrl = (origin, number) => `${origin}/#channel=${number}`;
