// Private family channels. Invite codes are 16 letters or digits, shown in groups of four.
const SAVED_KEY = 'ct-family';

export function normaliseCode(value) {
  const code = String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return code.length === 16 ? code : null;
}
export const formatCode = code => code.match(/.{4}/g).join('-');
export function inviteFromHash(hash) {
  return normaliseCode(new URLSearchParams(String(hash || '').replace(/^#/, '')).get('invite'));
}
export const inviteUrl = (origin, code) => `${origin}/#invite=${formatCode(code)}`;

// The saved invite lets the app reopen straight into the channel. It is a bearer credential,
// kept only on this device; leaving the channel deletes it.
export function loadSaved(storage) {
  try {
    const value = JSON.parse(storage.getItem(SAVED_KEY));
    const code = normaliseCode(value?.code), name = typeof value?.name === 'string' ? value.name.trim() : '';
    return code && name.length >= 2 ? { code, name: name.slice(0, 24) } : null;
  } catch { return null; }
}
export function saveChannel(storage, { code, name }) {
  try { storage.setItem(SAVED_KEY, JSON.stringify({ code: normaliseCode(code), name })); } catch { /* private browsing */ }
}
export function forgetChannel(storage) {
  try { storage.removeItem(SAVED_KEY); } catch { /* private browsing */ }
}
