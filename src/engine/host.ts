// Loads the engine on the best available device and serves synthesis requests one
// at a time. Used by the offscreen document (and by the dev harness).
import { KokoroEngine } from './kokoro';
import type { EngineRequest, ErrorResponse, SynthesizeResponse } from '../shared/messages';

export interface HostOptions {
  /** URL of the folder that contains the `kokoro` model folder, with trailing slash. */
  modelRoot: string;
  wasmPaths: string | { wasm: string };
  /** Skip device detection (dev harness / quality testing). */
  force?: { device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'fp16' };
}

interface Job {
  session: string;
  run: () => Promise<SynthesizeResponse>;
  resolve: (r: SynthesizeResponse | ErrorResponse) => void;
}

export class EngineHost {
  private engine: Promise<KokoroEngine> | null = null;
  private queue: Job[] = [];
  private busy = false;

  constructor(private opts: HostOptions) {}

  handle(req: EngineRequest): Promise<SynthesizeResponse | ErrorResponse> {
    if (req.type === 'cancel') {
      this.queue = this.queue.filter((job) => {
        if (job.session !== req.session) return true;
        job.resolve({ ok: false, error: 'cancelled', cancelled: true });
        return false;
      });
      return Promise.resolve({ ok: false, error: 'cancelled', cancelled: true });
    }
    return new Promise((resolve) => {
      this.queue.push({
        session: req.session,
        resolve,
        run: async () => {
          const engine = await this.getEngine();
          const t0 = performance.now();
          const r = await engine.synthesize(req.words, req.voice, req.speed);
          console.debug(
            `[narmor] ${r.duration.toFixed(1)}s of speech in ${((performance.now() - t0) / 1000).toFixed(2)}s (${engine.device})`,
          );
          return {
            ok: true,
            pcm: encodePcm(r.audio),
            sampleRate: r.sampleRate,
            words: r.words.map((w) => [w.start, w.end] as [number, number]),
          };
        },
      });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      try {
        job.resolve(await job.run());
      } catch (e) {
        console.error('[narmor] synthesis failed', e);
        job.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.busy = false;
  }

  private getEngine(): Promise<KokoroEngine> {
    this.engine ??= this.loadBest().catch((e) => {
      this.engine = null; // allow a retry on the next request
      throw e;
    });
    return this.engine;
  }

  private async loadBest(): Promise<KokoroEngine> {
    const readFile = async (p: string) => {
      const res = await fetch(this.opts.modelRoot + 'kokoro/' + p);
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    const base = { modelRoot: this.opts.modelRoot, modelId: 'kokoro', readFile, wasmPaths: this.opts.wasmPaths };
    if (this.opts.force) {
      const engine = await KokoroEngine.load({ ...base, ...this.opts.force });
      console.info(`[narmor] Kokoro forced to ${this.opts.force.device} (${this.opts.force.dtype})`);
      return engine;
    }

    // fp32 everywhere: Kokoro's fp16 export runs on WebGPU but produces heavily
    // degraded ("bitcrushed") audio there, and fp32 is just as fast on WASM.
    if (await hasWebGPU()) {
      try {
        const engine = await KokoroEngine.load({ ...base, device: 'webgpu', dtype: 'fp32' });
        if (await soundsHealthy(engine)) {
          console.info('[narmor] Kokoro running on WebGPU (fp32)');
          return engine;
        }
        console.warn('[narmor] WebGPU output degraded, falling back to WASM');
      } catch (e) {
        console.warn('[narmor] WebGPU unavailable, falling back to WASM', e);
      }
    }
    const engine = await KokoroEngine.load({ ...base, device: 'wasm', dtype: 'fp32' });
    console.info('[narmor] Kokoro running on WASM (fp32)');
    return engine;
  }
}

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

function encodePcm(audio: Float32Array): string {
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
