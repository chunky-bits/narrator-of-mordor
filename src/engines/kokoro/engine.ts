// Kokoro module implementation (loaded in the offscreen document only).
import type { EngineImpl, EngineInstance, ParamValues } from '../types';
import { KokoroEngine } from './model';

/** Each request may be this many times larger than the one playing (see player.ts). */
const GROWTH = { webgpu: 4, wasm: 1.6 };

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Guards against GPU drivers that run the model but produce NaNs, silence or
 * numerically degraded audio. Clean Kokoro speech has a zero-crossing rate around
 * 0.15; precision-broken output collapses into flat steps (around 0.03).
 */
async function soundsHealthy(engine: KokoroEngine): Promise<boolean> {
  const words = 'The quick brown fox jumps over the lazy dog.'.split(' ');
  const { audio } = await engine.synthesize(words, 'af_heart', 1);
  let peak = 0;
  let crossings = 0;
  for (let i = 0; i < audio.length; i++) {
    const s = audio[i];
    if (!Number.isFinite(s)) return false;
    peak = Math.max(peak, Math.abs(s));
    if (i > 0 && s < 0 !== audio[i - 1] < 0) crossings++;
  }
  const zcr = crossings / Math.max(audio.length, 1);
  return peak > 0.05 && zcr > 0.07;
}

export const kokoroImpl: EngineImpl = {
  async load(params, ctx): Promise<EngineInstance> {
    const readFile = async (p: string) => {
      const res = await fetch(ctx.modelRoot + 'kokoro/' + p);
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    const base = { modelRoot: ctx.modelRoot, modelId: 'kokoro', readFile, wasmPaths: ctx.wasmPaths };
    // fp32 everywhere: Kokoro's fp16 export runs on WebGPU but produces heavily degraded
    // ("bitcrushed") audio there. `dtype` is a hidden dev override for quality tests.
    const dtype = params.dtype === 'fp16' ? 'fp16' : 'fp32';
    const wanted = params.device;

    let engine: KokoroEngine | null = null;
    if (wanted !== 'wasm' && (await hasWebGPU())) {
      try {
        const gpu = await KokoroEngine.load({ ...base, device: 'webgpu', dtype });
        // A forced device skips the check (dev quality tests compare raw output).
        if (wanted === 'webgpu' || (await soundsHealthy(gpu))) engine = gpu;
        else console.warn('[narmor] WebGPU output degraded, falling back to WASM');
      } catch (e) {
        console.warn('[narmor] WebGPU unavailable, falling back to WASM', e);
      }
    }
    engine ??= await KokoroEngine.load({ ...base, device: 'wasm', dtype });
    const device = engine.device as 'webgpu' | 'wasm';
    const status = `${device === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'}, ${dtype}`;
    console.info(`[narmor] Kokoro running on ${status}`);

    return {
      status,
      synthesize: async (words, voice, speed, p: ParamValues) => {
        const r = await engine.synthesize(words, voice, speed, {
          reduceFunctionWords: p.naturalFunctionWords !== false,
        });
        return { audio: r.audio, sampleRate: r.sampleRate, words: r.words };
      },
      chunking: (p) => ({
        maxTokens: Number(device === 'webgpu' ? p.maxTokensGpu : p.maxTokensCpu) || 250,
        growth: GROWTH[device],
      }),
    };
  },
};
