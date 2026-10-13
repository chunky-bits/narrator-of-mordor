// Dev harness: runs the content script and the engine in one ordinary page, with a
// tiny stand-in for the chrome.* APIs. `npm run dev`, then open /harness/.
import { EngineHost } from '../src/engines/host';
import { ORT_WASM_PATHS } from '../src/engines/ort-wasm';
import type { EngineRequest } from '../src/shared/messages';
import type { ParamValues } from '../src/engines/types';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const store: Record<string, unknown> = JSON.parse(localStorage.getItem('narmor-harness') ?? '{}');
const listeners: Listener[] = [];

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    sync: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
        localStorage.setItem('narmor-harness', JSON.stringify(store));
        const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
        listeners.forEach((l) => l(changes, 'sync'));
      },
    },
    onChanged: { addListener: (l: Listener) => listeners.push(l) },
  },
  runtime: {
    onMessage: { addListener: () => {} },
    getURL: (path: string) => `/${path}`,
    sendMessage: async (msg: { type: string }) =>
      msg.type === 'narmor:get-tab-state' ? { enabled: true } : { ok: true },
  },
};

// ?device=webgpu|wasm&dtype=fp32|fp16 forces Kokoro's device / precision (quality tests).
const query = new URLSearchParams(location.search);
const forced: ParamValues = query.has('device') ? { device: query.get('device')!, dtype: query.get('dtype') ?? 'fp32' } : {};
const host = new EngineHost({ modelRoot: '/models/', wasmPaths: ORT_WASM_PATHS });
const send = (req: EngineRequest) =>
  host.handle(req.type === 'synthesize' ? { ...req, params: { ...req.params, ...forced } } : req);
// Hook for audio-quality capture scripts.
(window as unknown as { narmorSynth: unknown }).narmorSynth = (words: string[], voice = 'kokoro:af_heart') =>
  send({ target: 'offscreen', type: 'synthesize', session: 'capture', words, voice, speed: 1, params: { ...forced }, lang: 'en' });
const { init } = await import('../src/content/main');
init(send as Parameters<typeof init>[0]);
