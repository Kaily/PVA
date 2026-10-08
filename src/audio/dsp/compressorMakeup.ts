/**
 * The make-up gain a DynamicsCompressorNode adds by itself.
 *
 * The node has no make-up control: every browser's implementation (they share
 * one origin) boosts its output by a fixed amount derived from threshold,
 * knee and ratio — up to 13 dB with the settings used here. Left alone, that
 * turns "insert a compressor" into "everything gets much louder". This
 * function reproduces the calculation so the boost can be taken out again and
 * a preset's own make-up value is what the player gets.
 *
 * The node computes the static curve's output for a full-scale input and
 * applies (1 / that) ^ 0.6. Checked against the browser for a range of
 * settings: equal to within 0.01 dB.
 */
export function builtInMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const lin = (db: number): number => Math.pow(10, db / 20);
  const dB = (x: number): number => 20 * Math.log10(x);
  const threshold = lin(thresholdDb);
  const kneeCurve = (x: number, k: number): number => (x < threshold ? x : threshold + (1 - Math.exp(-k * (x - threshold))) / k);
  const slopeAt = (x: number, k: number): number => {
    if (x < threshold) return 1;
    const x2 = x * 1.001;
    return (dB(kneeCurve(x2, k)) - dB(kneeCurve(x, k))) / (dB(x2) - dB(x));
  };

  // The knee's shape parameter: found so that the curve reaches the slope 1/ratio at the end of the knee.
  const kneeEnd = lin(thresholdDb + kneeDb);
  let lo = 0.1;
  let hi = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeEnd, k) < 1 / ratio) hi = k;
    else lo = k;
    k = Math.sqrt(lo * hi);
  }
  const fullScaleOut = 1 < kneeEnd ? kneeCurve(1, k) : lin(dB(kneeCurve(kneeEnd, k)) + (0 - (thresholdDb + kneeDb)) / ratio);
  return 0.6 * -dB(fullScaleOut);
}
