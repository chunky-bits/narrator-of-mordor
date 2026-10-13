// Supertonic 3 module implementation (loaded in the offscreen document only).
//
// Pipeline (after the reference implementation): text -> duration predictor (one total
// duration) -> text encoder -> N flow-matching denoising steps -> vocoder (44.1 kHz).
//
// Word timing: Supertonic predicts no per-character durations, but its vector estimator
// aligns latent frames to characters with cross-attention. The bundled model is patched
// (scripts/patch-supertonic.py) to expose two of those attention maps ("attn9",
// "attn15"); a monotonic path through them gives each character's time, which is then
// refined using the pauses in the generated audio.
//
// Voices: shipped presets, or custom voices whose recipe (see voices.ts) arrives with
// each request in params.voiceRecipe and is built from the presets.
import * as ort from 'onnxruntime-web';
import type { EngineImpl, EngineInstance, ParamValues, SynthesisOutput, WordTiming } from '../types';
import { splitSpeed, stretchOutput } from '../stretch';
import { SUPERTONIC_LANGS } from './meta';
import { isPreset, parseStyle, PRESETS, VoiceSpace, type StyleData, type VoiceRecipe } from './voices';

const GROWTH = { webgpu: 4, wasm: 1.6 };
/** Matches the reference implementation's default pace at speed 1. */
const BASE_SPEED = 1.05;
/**
 * Supertonic's speed only scales the total duration it must fit the text into; beyond a
 * natural range it drops syllables instead of speaking faster. Speeds outside this range
 * are reached by time-stretching the generated audio (pitch-preserving) instead.
 */
const MODEL_SPEED = { min: 0.85, max: 1.2 };
const ATTN_OUTPUTS = ['attn9', 'attn15'];

interface Config {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

// ---- text preparation ------------------------------------------------------------------

const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const REPLACE: Record<string, string> = {
  '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'",
  '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
};

interface Prepared {
  ids: BigInt64Array;
  /** [start, end) character span of each input word in the id sequence. */
  spans: [number, number][];
}

/**
 * Normalise like the reference preprocessor, but word by word so each character stays
 * attributed to its word. Characters the model does not know are dropped.
 */
function prepare(words: string[], lang: string, indexer: number[]): Prepared {
  const known = (c: string) => (indexer[c.codePointAt(0)!] ?? -1) >= 0;
  let body = '';
  const spans: [number, number][] = [];
  for (const word of words) {
    let t = word.normalize('NFKD').replace(EMOJI, '');
    t = [...t].map((c) => REPLACE[c] ?? c).join('').replace(/[♥☆♡©\\]/g, '').replace(/@/g, ' at ');
    t = [...t.replace(/\s+/g, ' ').trim()].filter(known).join('');
    if (!t) {
      spans.push([body.length, body.length]);
      continue;
    }
    // Lone punctuation attaches to the previous word ("word ," -> "word,").
    if (body && !/^[.,!?;:'")\]}…]+$/.test(t)) body += ' ';
    spans.push([body.length, body.length + t.length]);
    body += t;
  }
  if (!/[.!?;:,'")\]}…]$/.test(body)) body += '.';
  const open = `<${lang}>`;
  const full = `${open}${body}</${lang}>`;
  return {
    ids: BigInt64Array.from([...full].map((c) => BigInt(indexer[c.codePointAt(0)!] ?? 0))),
    spans: spans.map(([s, e]) => [s + open.length, e + open.length]),
  };
}

// ---- word timing from attention --------------------------------------------------------------

/** Pauses in the audio: [start, end] seconds of stretches below 3% of peak RMS (≥ 60 ms). */
function silences(wav: Float32Array, sr: number): [number, number][] {
  const win = Math.round(sr / 100);
  const rms: number[] = [];
  for (let i = 0; i + win <= wav.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += wav[j] * wav[j];
    rms.push(Math.sqrt(s / win));
  }
  const th = Math.max(...rms) * 0.03;
  const out: [number, number][] = [];
  let start = -1;
  rms.forEach((r, i) => {
    if (r < th && start < 0) start = i;
    if (r >= th && start >= 0) {
      if (i - start >= 6) out.push([start / 100, i / 100]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start / 100, rms.length / 100]);
  return out;
}

function alignWords(
  maps: Float32Array[],
  frames: number,
  chars: number,
  spans: [number, number][],
  frameSec: number,
  wav: Float32Array,
  sr: number,
): WordTiming[] {
  const T = frames;
  const N = chars;
  const heads = maps[0].length / (2 * T * N);
  // Average over layers and heads (conditional branch, batch index 0): frames x chars.
  const M = new Float64Array(T * N);
  for (const a of maps) {
    for (let h = 0; h < heads; h++) {
      const base = h * 2 * T * N;
      for (let i = 0; i < T * N; i++) M[i] += a[base + i];
    }
  }
  // Attention sinks (characters attended everywhere): normalise each column by its median.
  const col = new Float64Array(T);
  for (let n = 0; n < N; n++) {
    for (let t = 0; t < T; t++) col[t] = M[t * N + n];
    const median = Float64Array.from(col).sort()[T >> 1] + 1e-9;
    for (let t = 0; t < T; t++) M[t * N + n] = Math.log(M[t * N + n] / median + 1e-9);
  }
  // Monotonic path: each frame attends one character; it may advance up to J per frame.
  const J = 6;
  const score = new Float64Array(T * N).fill(-Infinity);
  const back = new Int32Array(T * N);
  for (let n = 0; n < Math.min(J, N); n++) score[n] = M[n];
  for (let t = 1; t < T; t++) {
    for (let n = 0; n < N; n++) {
      let best = -Infinity;
      let arg = 0;
      for (let k = Math.max(0, n - J); k <= n; k++) {
        const v = score[(t - 1) * N + k];
        if (v > best) {
          best = v;
          arg = k;
        }
      }
      score[t * N + n] = best + M[t * N + n];
      back[t * N + n] = arg;
    }
  }
  const path = new Int32Array(T);
  let bestEnd = 0;
  for (let n = 1; n < N; n++) if (score[(T - 1) * N + n] > score[(T - 1) * N + bestEnd]) bestEnd = n;
  path[T - 1] = bestEnd;
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t * N + path[t]];

  const charTime = (c: number) => {
    let t = 0;
    while (t < T && path[t] < c) t++;
    if (t >= T) return T * frameSec;
    if (t === 0) return 0;
    const p0 = path[t - 1];
    const p1 = path[t];
    return (t - 1 + (c - p0) / Math.max(p1 - p0, 1)) * frameSec;
  };

  // Words cannot start or end inside a pause.
  const pauses = silences(wav, sr);
  const total = wav.length / sr;
  const snapStart = (x: number) => pauses.find(([a, b]) => a - 0.03 <= x && x < b)?.[1] ?? x;
  const snapEnd = (x: number) => pauses.find(([a, b]) => a < x && x <= b + 0.03)?.[0] ?? x;

  const timings: WordTiming[] = spans.map(([s, e]) => {
    if (e <= s) return { start: -1, end: -1 };
    const start = Math.min(snapStart(charTime(s)), total);
    return { start, end: Math.max(snapEnd(charTime(e)), start + 0.05) };
  });

  // Words squashed together (e.g. right after a long silence the attention maps several
  // words onto one frame): spread each such cluster by character length.
  const idx = timings.map((w, i) => i).filter((i) => timings[i].start >= 0);
  for (let a = 0; a < idx.length; ) {
    let b = a;
    while (b + 1 < idx.length && timings[idx[b + 1]].start - timings[idx[b]].start < 0.06) b++;
    if (b > a) {
      const from = timings[idx[a]].start;
      const to = b + 1 < idx.length ? timings[idx[b + 1]].start : Math.max(timings[idx[b]].end, from + 0.1 * (b - a + 1));
      const lens = idx.slice(a, b + 1).map((i) => Math.max(1, spans[i][1] - spans[i][0]));
      const sum = lens.reduce((x, y) => x + y, 0);
      let t = from;
      idx.slice(a, b + 1).forEach((i, k) => {
        timings[i].start = t;
        t += ((to - from) * lens[k]) / sum;
        timings[i].end = Math.max(timings[i].end, t);
      });
    }
    a = b + 1;
  }
  // Empty words (dropped characters) take the previous word's end.
  let last = 0;
  for (const w of timings) {
    if (w.start < 0) w.start = w.end = last;
    last = w.end;
  }
  return timings;
}

// ---- engine -------------------------------------------------------------------------------------

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function randn(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-10, Math.random());
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }
  return out;
}

export const supertonicImpl: EngineImpl = {
  async load(params, ctx): Promise<EngineInstance> {
    ort.env.wasm.wasmPaths = ctx.wasmPaths;
    ort.env.logLevel = 'error';
    const root = ctx.modelRoot + 'supertonic/';
    const getJson = async <T>(p: string): Promise<T> => {
      const res = await fetch(root + p);
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
      return res.json() as Promise<T>;
    };
    const [cfg, indexer] = await Promise.all([getJson<Config>('onnx/tts.json'), getJson<number[]>('onnx/unicode_indexer.json')]);
    const sr = cfg.ae.sample_rate;
    const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
    const ldim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;

    const createSessions = (device: 'webgpu' | 'wasm') =>
      Promise.all(
        ['duration_predictor', 'text_encoder', 'vector_estimator.timed', 'vocoder'].map((f) =>
          ort.InferenceSession.create(`${root}onnx/${f}.onnx`, { executionProviders: [device], logSeverityLevel: 3 }),
        ),
      );

    const presetStyle = (id: string) => getJson<Parameters<typeof parseStyle>[0]>(`voice_styles/${id}.json`).then(parseStyle);
    const presets = new Map<string, Promise<StyleData>>();
    const loadPreset = (id: string) => {
      let s = presets.get(id);
      if (!s) presets.set(id, (s = presetStyle(id)));
      return s;
    };
    let space: Promise<VoiceSpace> | null = null;
    const built = new Map<string, StyleData>();

    /** A shipped voice, or a custom voice built from the recipe sent with the request. */
    const styleFor = async (voice: string, p: ParamValues): Promise<StyleData> => {
      if (isPreset(voice)) return loadPreset(voice);
      const recipe = typeof p.voiceRecipe === 'string' ? p.voiceRecipe : '';
      if (!recipe) {
        console.warn(`[narmor] Supertonic voice "${voice}" has no recipe; using F1`);
        return loadPreset('F1');
      }
      let style = built.get(recipe);
      if (!style) {
        space ??= Promise.all(PRESETS.map(loadPreset)).then((s) => new VoiceSpace(s));
        style = (await space).build(JSON.parse(recipe) as VoiceRecipe);
        if (built.size > 20) built.clear();
        built.set(recipe, style);
      }
      return style;
    };

    const run = async (
      sessions: ort.InferenceSession[],
      words: string[],
      voice: string,
      speed: number,
      p: ParamValues,
      lang: string,
      withTiming: boolean,
    ): Promise<SynthesisOutput> => {
      const [dpS, teS, veS, vocS] = sessions;
      const { ids, spans } = prepare(words, lang, indexer);
      const N = ids.length;
      const style = await styleFor(voice, p);
      const textIds = new ort.Tensor('int64', ids, [1, N]);
      const textMask = new ort.Tensor('float32', new Float32Array(N).fill(1), [1, 1, N]);
      const styleTtl = new ort.Tensor('float32', style.ttl, style.ttlDims);
      const styleDp = new ort.Tensor('float32', style.dp, style.dpDims);

      const { model: modelSpeed, stretch } = splitSpeed(speed, MODEL_SPEED);
      const dur = ((await dpS.run({ text_ids: textIds, style_dp: styleDp, text_mask: textMask })).duration.data as Float32Array)[0] /
        (BASE_SPEED * modelSpeed);
      const emb = (await teS.run({ text_ids: textIds, style_ttl: styleTtl, text_mask: textMask })).text_emb;
      const T = Math.max(1, Math.ceil((dur * sr) / chunk));
      let latent = randn(ldim * T);
      const latentMask = new ort.Tensor('float32', new Float32Array(T).fill(1), [1, 1, T]);
      const steps = Math.round(Number(p.steps ?? 8));
      const totalStep = new ort.Tensor('float32', Float32Array.from([steps]), [1]);
      let maps: Float32Array[] = [];
      for (let step = 0; step < steps; step++) {
        const last = step === steps - 1;
        const out = await veS.run(
          {
            noisy_latent: new ort.Tensor('float32', latent, [1, ldim, T]),
            text_emb: emb,
            style_ttl: styleTtl,
            latent_mask: latentMask,
            text_mask: textMask,
            current_step: new ort.Tensor('float32', Float32Array.from([step]), [1]),
            total_step: totalStep,
          },
          // Attention maps are only needed (and copied back) on the final step.
          last && withTiming ? ['denoised_latent', ...ATTN_OUTPUTS] : ['denoised_latent'],
        );
        latent = out.denoised_latent.data as Float32Array;
        if (last && withTiming) maps = ATTN_OUTPUTS.map((k) => out[k].data as Float32Array);
      }
      const full = (await vocS.run({ latent: new ort.Tensor('float32', latent, [1, ldim, T]) })).wav_tts.data as Float32Array;
      const raw = full.slice(0, Math.min(full.length, Math.round(dur * sr)));
      // Align on the model's own audio, then stretch audio and timings together.
      const timings = withTiming
        ? alignWords(maps, T, N, spans, chunk / sr, raw, sr)
        : words.map(() => ({ start: 0, end: 0 }));
      return stretchOutput({ audio: raw, sampleRate: sr, words: timings }, stretch);
    };

    /** Guards against GPU drivers that run the model but produce NaNs or silence. */
    const healthy = async (sessions: ort.InferenceSession[]) => {
      const { audio } = await run(sessions, 'This is a short test of the voice.'.split(' '), 'F1', 1, {}, 'en', false);
      let peak = 0;
      let crossings = 0;
      for (let i = 0; i < audio.length; i++) {
        if (!Number.isFinite(audio[i])) return false;
        peak = Math.max(peak, Math.abs(audio[i]));
        if (i > 0 && audio[i] < 0 !== audio[i - 1] < 0) crossings++;
      }
      return peak > 0.05 && crossings / Math.max(audio.length, 1) > 0.03;
    };

    let sessions: ort.InferenceSession[] | null = null;
    let device: 'webgpu' | 'wasm' = 'wasm';
    if (params.device !== 'wasm' && (await hasWebGPU())) {
      try {
        const gpu = await createSessions('webgpu');
        if (params.device === 'webgpu' || (await healthy(gpu))) {
          sessions = gpu;
          device = 'webgpu';
        } else console.warn('[narmor] Supertonic WebGPU output invalid, falling back to WASM');
      } catch (e) {
        console.warn('[narmor] Supertonic WebGPU unavailable, falling back to WASM', e);
      }
    }
    const ready: ort.InferenceSession[] = sessions ?? (await createSessions('wasm'));
    const status = device === 'webgpu' ? 'WebGPU' : 'CPU (WASM)';
    console.info(`[narmor] Supertonic running on ${status}`);

    return {
      status,
      synthesize: (words, voice, speed, p, lang) => {
        const wanted = String(p.language ?? 'auto');
        const pageLang = lang.toLowerCase().split('-')[0];
        const code = wanted !== 'auto' ? wanted : SUPERTONIC_LANGS.includes(pageLang) ? pageLang : 'en';
        return run(ready, words, voice, speed, p, code, true);
      },
      chunking: (p) => ({
        maxTokens: Number(device === 'webgpu' ? p.maxTokensGpu : p.maxTokensCpu) || 200,
        growth: GROWTH[device],
      }),
    };
  },
};
