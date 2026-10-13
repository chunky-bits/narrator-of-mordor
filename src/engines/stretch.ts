// Pitch-preserving time-stretch (WSOLA: waveform-similarity overlap-add), for engines
// whose own speed control only works within a limited range.
//
// The output is built from overlapping Hann-windowed frames taken from the input at
// `factor` times the output spacing; each frame is chosen within a small search window
// so it continues the previously copied frame as smoothly as possible (maximum
// cross-correlation), which avoids the phasiness and clicks of naive overlap-add.

/**
 * Stretch `input` so it plays `factor` times faster (factor > 1 shortens, < 1 lengthens)
 * without changing pitch. Output length is round(input.length / factor).
 */
export function timeStretch(input: Float32Array, factor: number, sampleRate: number): Float32Array {
  if (Math.abs(factor - 1) < 0.01 || input.length === 0) return input;
  const frame = 2 * Math.round((sampleRate * 0.025) / 2); // ~25 ms frames (even length)
  const synthesisHop = frame / 2;
  const analysisHop = synthesisHop * factor;
  const tolerance = Math.round(sampleRate * 0.012); // ±12 ms search
  const outLength = Math.round(input.length / factor);

  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  // Pad so frames near the edges can always be read.
  const pad = frame + tolerance;
  const x = new Float32Array(input.length + 2 * pad);
  x.set(input, pad);

  const out = new Float32Array(outLength + frame);
  const weight = new Float32Array(outLength + frame);

  // Cross-correlation on a decimated signal for the coarse search, refined at full rate.
  const corr = (a: number, b: number, len: number, step: number) => {
    let s = 0;
    for (let i = 0; i < len; i += step) s += x[a + i] * x[b + i];
    return s;
  };
  const span = frame / 2;

  let previous = pad; // input position of the previously copied frame
  for (let k = 0; k * synthesisHop < outLength; k++) {
    const nominal = pad + Math.round(k * analysisHop);
    let best = nominal;
    if (k > 0) {
      // The natural continuation of the previous frame is where it would have gone on.
      const natural = previous + synthesisHop;
      let bestScore = -Infinity;
      for (let d = -tolerance; d <= tolerance; d += 8) {
        const score = corr(nominal + d, natural, span, 4);
        if (score > bestScore) {
          bestScore = score;
          best = nominal + d;
        }
      }
      const coarse = best;
      for (let d = -8; d <= 8; d++) {
        const score = corr(coarse + d, natural, span, 1);
        if (score > bestScore) {
          bestScore = score;
          best = coarse + d;
        }
      }
      best = Math.max(0, Math.min(x.length - frame, best));
    }
    const at = k * synthesisHop;
    for (let i = 0; i < frame && at + i < out.length; i++) {
      out[at + i] += window[i] * x[best + i];
      weight[at + i] += window[i];
    }
    previous = best;
  }
  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) result[i] = weight[i] > 1e-3 ? out[i] / weight[i] : 0;
  return result;
}
