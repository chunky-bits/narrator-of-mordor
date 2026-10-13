// Messages between the content script / options page, the background service worker
// and the offscreen document that runs the TTS engines.
import type { ChunkingHint, ParamValues } from '../engines/types';

/** content / options page → background */
export type BackgroundRequest =
  | { type: 'narmor:get-tab-state' }
  | { type: 'narmor:ensure-engine' }
  | { type: 'narmor:open-options' }
  /** Open a pre-filled feedback issue on GitHub in a new tab. */
  | { type: 'narmor:open-feedback'; url: string };

/** background → content */
export type ContentMessage = { type: 'narmor:set-enabled'; enabled: boolean };

/**
 * → offscreen (sent with chrome.runtime.sendMessage, ignored by background). The
 * offscreen document cannot read chrome.storage, so each request carries the
 * parameters of the engine it targets.
 */
export type EngineRequest =
  | {
      target: 'offscreen';
      type: 'synthesize';
      session: string;
      words: string[];
      /** Global voice id, "<engine>:<voice>". */
      voice: string;
      speed: number;
      params: ParamValues;
      /** BCP 47 language of the text (the page's), for multilingual engines. */
      lang: string;
    }
  | { target: 'offscreen'; type: 'cancel'; session: string }
  | { target: 'offscreen'; type: 'status' };

export interface SynthesizeResponse {
  ok: true;
  /** Little-endian 16-bit PCM, base64 encoded (runtime messages are JSON). */
  pcm: string;
  sampleRate: number;
  /** [start, end] in seconds for each input word. */
  words: [number, number][];
  /** How the player should size requests for this engine. */
  chunking: ChunkingHint;
}

export interface StatusResponse {
  ok: true;
  /** Runtime status per loaded engine, e.g. { kokoro: "WebGPU, fp32" }. */
  engines: Record<string, string>;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  cancelled?: boolean;
}

export const OFFSCREEN_PATH = 'offscreen.html';
