// Stored per-engine configuration (enabled + parameter values), shared by the content
// script and the options page via chrome.storage.sync.
import { ENGINES } from './registry';
import { resolveParams, type EngineConfig } from './types';

const KEY = 'engines';

export type EngineConfigs = Record<string, EngineConfig>;

function normalize(stored: Partial<Record<string, Partial<EngineConfig>>> | undefined): EngineConfigs {
  const out: EngineConfigs = {};
  for (const meta of ENGINES) {
    const s = stored?.[meta.id];
    out[meta.id] = { enabled: s?.enabled !== false, params: resolveParams(meta, s?.params) };
  }
  // At least one engine must stay usable.
  if (!Object.values(out).some((c) => c.enabled)) out[ENGINES[0].id].enabled = true;
  return out;
}

export async function loadEngineConfigs(): Promise<EngineConfigs> {
  return normalize((await chrome.storage.sync.get(KEY))[KEY] as EngineConfigs | undefined);
}

export async function saveEngineConfigs(configs: EngineConfigs): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: configs });
}

export function onEngineConfigsChanged(cb: (configs: EngineConfigs) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) cb(normalize(changes[KEY].newValue as EngineConfigs));
  });
}
