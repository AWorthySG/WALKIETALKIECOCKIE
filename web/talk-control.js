// Turns button and Space presses into start/stop calls for the two talk modes.
// Tap mode: one tap starts, the next tap stops, and a forgotten transmission ends after limitMs.
export const TAP_LIMIT_MS = 60000;

export class TalkControl {
  constructor({ start, stop, isActive, onLimit = () => {}, limitMs = TAP_LIMIT_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    // Wrapped: browsers throw "Illegal invocation" when setTimeout runs with this = TalkControl.
    Object.assign(this, { start, stop, isActive, onLimit, limitMs, setTimer, clearTimer });
    this.mode = 'tap'; this.timer = null;
  }
  press() {
    if (this.mode === 'hold') return this.start();
    if (this.isActive()) return this.cancel();
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = null; this.onLimit(); this.cancel(); }, this.limitMs);
    return this.start();
  }
  release() { if (this.mode === 'hold') this.cancel(); }
  cancel() { this.clearTimer(this.timer); this.timer = null; this.stop(); }
}
