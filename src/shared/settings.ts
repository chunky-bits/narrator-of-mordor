export interface Settings {
  sentenceHighlight: boolean;
  wordHighlight: boolean;
  /** Read only the detected main article instead of the whole page. */
  articleMode: boolean;
  autoScroll: boolean;
  voice: string;
  /** Speaking rate, 0.5 – 2. */
  speed: number;
  /** Output volume, 0 – 1. */
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sentenceHighlight: true,
  wordHighlight: true,
  articleMode: true,
  autoScroll: true,
  voice: 'af_heart',
  speed: 1,
  volume: 1,
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: settings });
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  });
}
