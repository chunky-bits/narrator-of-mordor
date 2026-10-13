// Runs engine modules and serves synthesis requests one at a time. Used by the
// offscreen document (and the dev harness). Modules are loaded on first use and
// reloaded when one of their load-time parameters (EngineMeta.reloadParams) changes.
import type { EngineRequest, ErrorResponse, StatusResponse, SynthesizeResponse } from '../shared/messages';
import { ENGINE_LOADERS, engineMeta, parseVoiceKey } from './registry';
import type { EngineContext, EngineInstance, ParamValues } from './types';

interface Job {
  session: string;
  run: () => Promise<SynthesizeResponse>;
  resolve: (r: SynthesizeResponse | ErrorResponse) => void;
}

interface Loaded {
  /** Values of the reload parameters this instance was loaded with. */
  signature: string;
  instance: Promise<EngineInstance>;
}

export class EngineHost {
  private engines = new Map<string, Loaded>();
  private statuses = new Map<string, string>();
  private queue: Job[] = [];
  private busy = false;

  constructor(private ctx: EngineContext) {}

  handle(req: EngineRequest): Promise<SynthesizeResponse | StatusResponse | ErrorResponse> {
    if (req.type === 'status') {
      return Promise.resolve({ ok: true, engines: Object.fromEntries(this.statuses) });
    }
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
          const { engine: engineId, voice } = parseVoiceKey(req.voice);
          const engine = await this.instance(engineId, req.params);
          const t0 = performance.now();
          const r = await engine.synthesize(req.words, voice, req.speed, req.params, req.lang);
          const seconds = r.audio.length / r.sampleRate;
          console.debug(
            `[narmor] ${seconds.toFixed(1)}s of speech in ${((performance.now() - t0) / 1000).toFixed(2)}s (${engineId}, ${engine.status})`,
          );
          return {
            ok: true,
            pcm: encodePcm(r.audio),
            sampleRate: r.sampleRate,
            words: r.words.map((w) => [w.start, w.end] as [number, number]),
            chunking: engine.chunking(req.params),
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

  private instance(engineId: string, params: ParamValues): Promise<EngineInstance> {
    const meta = engineMeta(engineId);
    const load = ENGINE_LOADERS[engineId];
    if (!meta || !load) return Promise.reject(new Error(`Unknown TTS engine "${engineId}"`));
    const signature = JSON.stringify(meta.reloadParams.map((k) => params[k]));
    const current = this.engines.get(engineId);
    if (current && current.signature === signature) return current.instance;

    this.statuses.set(engineId, 'Loading…');
    const instance = load()
      .then((impl) => impl.load(params, this.ctx))
      .then((inst) => {
        this.statuses.set(engineId, inst.status);
        return inst;
      })
      .catch((e) => {
        this.engines.delete(engineId); // allow a retry on the next request
        this.statuses.set(engineId, `Failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      });
    this.engines.set(engineId, { signature, instance });
    return instance;
  }
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
