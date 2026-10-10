// Messages between the content script, the background service worker and the
// offscreen document that runs the TTS model.

/** content → background */
export type BackgroundRequest =
  | { type: 'narmor:get-tab-state' }
  | { type: 'narmor:ensure-engine' };

/** background → content */
export type ContentMessage = { type: 'narmor:set-enabled'; enabled: boolean };

/** content → offscreen (sent with chrome.runtime.sendMessage, ignored by background) */
export type EngineRequest =
  | {
      target: 'offscreen';
      type: 'synthesize';
      session: string;
      words: string[];
      voice: string;
      speed: number;
    }
  | { target: 'offscreen'; type: 'cancel'; session: string };

export interface SynthesizeResponse {
  ok: true;
  /** Little-endian 16-bit PCM, base64 encoded (runtime messages are JSON). */
  pcm: string;
  sampleRate: number;
  /** [start, end] in seconds for each input word. */
  words: [number, number][];
  /** Device the engine runs on ('webgpu' or 'wasm'); the player sizes requests by it. */
  device: string;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  cancelled?: boolean;
}

export const OFFSCREEN_PATH = 'offscreen.html';
