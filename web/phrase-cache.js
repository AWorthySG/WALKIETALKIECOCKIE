// Keeps generated speech for the quick messages, so a repeated phrase plays at once.
export class PhraseCache {
  constructor(max = 8) { this.max = max; this.items = new Map(); }
  get(text) {
    const bytes = this.items.get(text);
    if (!bytes) return undefined;
    this.items.delete(text); this.items.set(text, bytes);
    return bytes.slice();
  }
  set(text, bytes) {
    this.items.delete(text); this.items.set(text, bytes.slice());
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
  }
}
