import type { EngineRequest, ErrorResponse, SynthesizeResponse } from '../shared/messages';

export interface Synthesis {
  buffer: (ctx: BaseAudioContext) => AudioBuffer;
  /** [start, end] seconds per word. */
  words: [number, number][];
}

export type EngineSend = (req: EngineRequest) => Promise<SynthesizeResponse | ErrorResponse>;

/** Talks to the offscreen document through the runtime messaging bus. */
export const chromeEngineSend: EngineSend = async (req) => {
  const send = () => chrome.runtime.sendMessage(req) as Promise<SynthesizeResponse | ErrorResponse | undefined>;
  await chrome.runtime.sendMessage({ type: 'narmor:ensure-engine' });
  try {
    const res = await send();
    if (res) return res;
  } catch {
    // offscreen document went away between ensure and send
  }
  await chrome.runtime.sendMessage({ type: 'narmor:ensure-engine' });
  return (await send()) ?? { ok: false, error: 'TTS engine did not respond' };
};

export class EngineClient {
  constructor(private send: EngineSend) {}

  async synthesize(session: string, words: string[], voice: string, speed: number): Promise<Synthesis> {
    const res = await this.send({ target: 'offscreen', type: 'synthesize', session, words, voice, speed });
    if (!res.ok) throw Object.assign(new Error(res.error), { cancelled: res.cancelled ?? false });
    const pcm = decodePcm(res.pcm);
    return {
      words: res.words,
      buffer: (ctx) => {
        const buf = ctx.createBuffer(1, pcm.length, res.sampleRate);
        buf.copyToChannel(pcm, 0);
        return buf;
      },
    };
  }

  cancel(session: string): void {
    this.send({ target: 'offscreen', type: 'cancel', session }).catch(() => {});
  }
}

function decodePcm(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}
