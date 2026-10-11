// Kokoro TTS engine with exact word timings.
//
// The "timestamped" Kokoro export returns, next to the waveform, the predicted
// duration of every input token. Each word is phonemised and tokenised on its own,
// so we know exactly which tokens belong to which word and can turn the durations
// into word start/end times in the generated audio.
import { env, StyleTextToSpeech2Model, Tensor } from '@huggingface/transformers';
import { phonemizeChunk, reduceFunctionWord, type Lang } from './phonemize';

export const SAMPLE_RATE = 24000;
const PAD_ID = 0;
const MAX_TOKENS = 510; // context is 512 incl. the two pad tokens
const STYLE_DIM = 256;

export interface EngineOptions {
  /** Directory containing the model folder (URL in the browser, path in Node). */
  modelRoot: string;
  /** Folder name of the model inside modelRoot. */
  modelId: string;
  device: 'webgpu' | 'wasm' | 'cpu';
  dtype: 'fp32' | 'fp16' | 'q8';
  /** Reads a file relative to the model folder (voices, tokenizer). */
  readFile: (relativePath: string) => Promise<ArrayBuffer>;
  /** Where onnxruntime-web finds its .wasm/.mjs files (browser only). */
  wasmPaths?: string | { wasm: string };
}

export interface WordTiming {
  /** Seconds from the start of the returned audio. */
  start: number;
  end: number;
}

export interface SynthesisResult {
  audio: Float32Array;
  sampleRate: number;
  /** One entry per input word, in input order. */
  words: WordTiming[];
  duration: number;
}

/**
 * Promote a word to primary stress (like misaki's "+2" emphasis): words espeak leaves
 * unstressed — typically function words such as "not" or "you" — gain a stress mark.
 */
function emphasize(ph: string): string {
  if (ph.includes('ˈ')) return ph;
  if (ph.includes('ˌ')) return ph.replace('ˌ', 'ˈ');
  const vowel = ph.search(/[aeiouæɑɐɒɔəɛɜɪʊʌɚᵻ]/);
  return vowel < 0 ? ph : `${ph.slice(0, vowel)}ˈ${ph.slice(vowel)}`;
}

export class KokoroEngine {
  private model!: StyleTextToSpeech2Model;
  private vocab = new Map<string, number>();
  private spaceId = 0;
  private voices = new Map<string, Float32Array>();
  readonly device: string;

  private constructor(private opts: EngineOptions) {
    this.device = opts.device;
  }

  static async load(opts: EngineOptions): Promise<KokoroEngine> {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.localModelPath = opts.modelRoot;
    if (opts.wasmPaths && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = opts.wasmPaths as string;

    const engine = new KokoroEngine(opts);
    const tokenizer = JSON.parse(new TextDecoder().decode(await opts.readFile('tokenizer.json')));
    for (const [ch, id] of Object.entries(tokenizer.model.vocab as Record<string, number>)) {
      engine.vocab.set(ch, id);
    }
    engine.spaceId = engine.vocab.get(' ')!;
    engine.model = await StyleTextToSpeech2Model.from_pretrained(opts.modelId, {
      dtype: opts.dtype,
      device: opts.device,
      // ORT logs benign node-placement warnings at console.error level, which would
      // show up as extension errors in chrome://extensions. 3 = errors only.
      session_options: { logSeverityLevel: 3 },
    });
    return engine;
  }

  private async voice(id: string): Promise<Float32Array> {
    let v = this.voices.get(id);
    if (!v) {
      v = new Float32Array(await this.opts.readFile(`voices/${id}.bin`));
      this.voices.set(id, v);
    }
    return v;
  }

  /** Register a voice mixed from others, e.g. [['af_heart', 0.7], ['af_bella', 0.3]]. */
  async blendVoices(id: string, parts: [string, number][]): Promise<void> {
    const sources = await Promise.all(parts.map(([v]) => this.voice(v)));
    const total = parts.reduce((n, [, w]) => n + w, 0);
    const mix = new Float32Array(sources[0].length);
    sources.forEach((src, k) => {
      const w = parts[k][1] / total;
      for (let i = 0; i < mix.length; i++) mix[i] += src[i] * w;
    });
    this.voices.set(id, mix);
  }

  private tokenize(phonemes: string): number[] {
    const ids: number[] = [];
    for (const ch of phonemes) {
      const id = this.vocab.get(ch);
      if (id !== undefined && id !== PAD_ID) ids.push(id);
    }
    return ids;
  }

  /**
   * Synthesise a list of words (whitespace-delimited chunks of a sentence, punctuation
   * attached). Returns audio plus the exact time span of every word.
   */
  async synthesize(
    words: string[],
    voice: string,
    speed: number,
    opts: {
      /** Per word: give it primary stress (author emphasis such as <em>). */
      emphasis?: boolean[];
      /** Use unstressed running-speech forms of function words ("the", "to", …). */
      reduceFunctionWords?: boolean;
    } = {},
  ): Promise<SynthesisResult> {
    const lang: Lang = voice.startsWith('b') ? 'b' : 'a';
    const tokenized = await Promise.all(
      words.map(async (w, i) => {
        let ph = await phonemizeChunk(w, lang);
        if (opts.emphasis?.[i]) ph = emphasize(ph);
        else if (opts.reduceFunctionWords) ph = reduceFunctionWord(w, ph, lang);
        return this.tokenize(ph);
      }),
    );

    // Group words into model calls that fit the context window.
    const groups: number[][] = [];
    let current: number[] = [];
    let len = 0;
    tokenized.forEach((ids, i) => {
      let cost = ids.length + (current.length ? 1 : 0);
      if (current.length && len + cost > MAX_TOKENS) {
        groups.push(current);
        current = [];
        len = 0;
        cost = ids.length;
      }
      current.push(i);
      len += cost;
    });
    if (current.length) groups.push(current);

    const chunks: Float32Array[] = [];
    const timings: WordTiming[] = new Array(words.length);
    let offset = 0;
    for (const group of groups) {
      const r = await this.run(group.map((i) => tokenized[i]), voice, speed);
      group.forEach((wordIdx, j) => {
        timings[wordIdx] = { start: offset + r.words[j].start, end: offset + r.words[j].end };
      });
      chunks.push(r.audio);
      offset += r.audio.length / SAMPLE_RATE;
    }

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(total);
    let pos = 0;
    for (const c of chunks) {
      audio.set(c, pos);
      pos += c.length;
    }
    return { audio, sampleRate: SAMPLE_RATE, words: timings, duration: total / SAMPLE_RATE };
  }

  private async run(wordTokens: number[][], voice: string, speed: number) {
    // Build the token sequence and remember where each word's tokens sit.
    const seq: number[] = [];
    const spans: [number, number][] = [];
    for (const ids of wordTokens) {
      if (seq.length) seq.push(this.spaceId);
      const start = seq.length;
      // A single word longer than the window is truncated rather than dropped.
      seq.push(...ids.slice(0, Math.max(0, MAX_TOKENS - seq.length)));
      spans.push([start, seq.length]);
    }
    const inputIds = [PAD_ID, ...seq, PAD_ID];

    const voiceData = await this.voice(voice);
    const styleRow = Math.min(Math.max(inputIds.length - 2, 0), 509) * STYLE_DIM;
    const style = voiceData.slice(styleRow, styleRow + STYLE_DIM);

    const out = await this.model({
      input_ids: new Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', [speed], [1]),
    });
    const audio = out.waveform.data as Float32Array;
    const durations = Array.from(out.durations.data as ArrayLike<number | bigint>, Number);

    // Durations are in model frames; derive the frame size from the audio itself.
    const totalFrames = durations.reduce((a, b) => a + b, 0);
    const secondsPerFrame = audio.length / SAMPLE_RATE / Math.max(totalFrames, 1);
    const cum = [0];
    for (const d of durations) cum.push(cum[cum.length - 1] + d);
    // Input index = sequence index + 1 (leading pad token).
    const words = spans.map(([s, e]) => ({
      start: cum[s + 1] * secondsPerFrame,
      end: cum[e + 1] * secondsPerFrame,
    }));
    return { audio, words, totalFrames };
  }
}
