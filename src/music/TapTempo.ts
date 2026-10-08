/**
 * Tap tempo: tempo from the last few taps, robust against one sloppy tap.
 *
 *  • a pause longer than 2 s starts a new measurement
 *  • the last 5 intervals are kept
 *  • intervals more than 35 % away from the median are ignored
 *  • the result is the mean of the remaining intervals
 */
const RESET_MS = 2000;
const KEEP = 5;
const OUTLIER = 0.35;

export class TapTempo {
  private taps: number[] = [];

  /** Register a tap at `nowMs`. Returns a tempo in BPM once two taps exist, else null. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && nowMs - last > RESET_MS) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length > KEEP + 1) this.taps.shift();
    if (this.taps.length < 2) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const kept = intervals.filter((v) => Math.abs(v - median) <= median * OUTLIER);
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    if (!(mean > 0)) return null;
    return 60000 / mean;
  }

  reset(): void {
    this.taps = [];
  }

  get count(): number {
    return this.taps.length;
  }
}
