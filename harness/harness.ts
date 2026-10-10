// Dev harness: runs the content script and the engine in one ordinary page, with a
// tiny stand-in for the chrome.* APIs. `npm run dev`, then open /harness/.
import { EngineHost } from '../src/engine/host';
import { ORT_WASM_PATHS } from '../src/engine/ort-wasm';

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
    sendMessage: async (msg: { type: string }) =>
      msg.type === 'narmor:get-tab-state' ? { enabled: true } : { ok: true },
  },
};

// ?device=webgpu|wasm&dtype=fp32|fp16 forces an engine configuration.
const params = new URLSearchParams(location.search);
const force = params.has('device')
  ? { device: params.get('device') as 'webgpu' | 'wasm', dtype: (params.get('dtype') ?? 'fp32') as 'fp32' | 'fp16' }
  : undefined;
const host = new EngineHost({ modelRoot: '/models/', wasmPaths: ORT_WASM_PATHS, force });
// Hook for audio-quality capture scripts.
(window as unknown as { narmorSynth: unknown }).narmorSynth = (words: string[], voice = 'af_heart') =>
  host.handle({ target: 'offscreen', type: 'synthesize', session: 'capture', words, voice, speed: 1 });
const { init } = await import('../src/content/main');
init((req) => host.handle(req));
