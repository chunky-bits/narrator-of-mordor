// The contract every TTS engine module implements.
//
// A module has two halves:
//  - EngineMeta: lightweight description (voices, configurable parameters). Imported by
//    the content script, the bar and the options page.
//  - EngineImpl: the actual synthesiser. Only loaded inside the offscreen document,
//    lazily, when a voice of that engine is used (see registry.ts).

/** A configurable engine parameter; the options page renders a form field from it. */
export type ParamSpec =
  | {
      key: string;
      label: string;
      hint?: string;
      type: 'boolean';
      default: boolean;
    }
  | {
      key: string;
      label: string;
      hint?: string;
      type: 'number';
      default: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      key: string;
      label: string;
      hint?: string;
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    };

export type ParamValues = Record<string, boolean | number | string>;

export interface VoiceInfo {
  /** Unique within the engine. */
  id: string;
  name: string;
  /** BCP 47 language tag, e.g. "en-US", "nl-BE". */
  lang: string;
  gender?: 'female' | 'male';
}

export interface EngineMeta {
  id: string;
  name: string;
  description: string;
  /** Model / licence facts shown on the options page. */
  details: string[];
  voices: VoiceInfo[];
  params: ParamSpec[];
  /**
   * Parameters that require reloading the model when changed (e.g. the device);
   * others take effect on the next request.
   */
  reloadParams: string[];
}

/** User configuration of one engine, as stored. */
export interface EngineConfig {
  enabled: boolean;
  params: ParamValues;
}

export interface WordTiming {
  /** Seconds from the start of the returned audio. */
  start: number;
  end: number;
}

/** How the player should size requests for this engine (see player.ts). */
export interface ChunkingHint {
  /** Maximum tokens per request. */
  maxTokens: number;
  /** Each request may be this many times larger than the one playing. */
  growth: number;
}

export interface SynthesisOutput {
  audio: Float32Array;
  sampleRate: number;
  /** One entry per input word. */
  words: WordTiming[];
}

export interface EngineContext {
  /** URL of the folder holding the bundled models, with trailing slash. */
  modelRoot: string;
  /** onnxruntime-web WASM location. */
  wasmPaths: string | { wasm: string };
}

/** A loaded engine, ready to synthesise. */
export interface EngineInstance {
  /** Human-readable runtime description, e.g. "WebGPU (fp32)". */
  readonly status: string;
  synthesize(words: string[], voice: string, speed: number, params: ParamValues): Promise<SynthesisOutput>;
  chunking(params: ParamValues): ChunkingHint;
}

export interface EngineImpl {
  load(params: ParamValues, ctx: EngineContext): Promise<EngineInstance>;
}

/** Default parameter values of an engine. */
export function defaultParams(meta: EngineMeta): ParamValues {
  return Object.fromEntries(meta.params.map((p) => [p.key, p.default]));
}

/** Stored values merged over defaults, with invalid values replaced by defaults. */
export function resolveParams(meta: EngineMeta, stored: ParamValues | undefined): ParamValues {
  const out = defaultParams(meta);
  for (const p of meta.params) {
    const v = stored?.[p.key];
    if (p.type === 'boolean' && typeof v === 'boolean') out[p.key] = v;
    if (p.type === 'number' && typeof v === 'number' && v >= p.min && v <= p.max) out[p.key] = v;
    if (p.type === 'select' && p.options.some((o) => o.value === v)) out[p.key] = v as string;
  }
  return out;
}
