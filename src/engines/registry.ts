// The list of available TTS engine modules. To add an engine: create
// src/engines/<id>/meta.ts and engine.ts, then register both halves here.
import { kokoroMeta } from './kokoro/meta';
import { supertonicMeta } from './supertonic/meta';
import type { EngineImpl, EngineMeta, VoiceInfo } from './types';

export const ENGINES: EngineMeta[] = [kokoroMeta, supertonicMeta];

/**
 * Implementations, loaded on demand (dynamic import keeps them — and their model
 * runtimes — out of the content script and options page bundles).
 */
export const ENGINE_LOADERS: Record<string, () => Promise<EngineImpl>> = {
  kokoro: async () => (await import('./kokoro/engine')).kokoroImpl,
  supertonic: async () => (await import('./supertonic/engine')).supertonicImpl,
};

/** Display name of a voice language; "mul" marks voices that speak every language. */
export function languageLabel(lang: string): string {
  if (lang === 'mul') return 'Any language';
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
}

export function engineMeta(id: string): EngineMeta | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** Global voice ids are "<engine>:<voice>", e.g. "kokoro:af_heart". */
export function voiceKey(engineId: string, voiceId: string): string {
  return `${engineId}:${voiceId}`;
}

export function parseVoiceKey(key: string): { engine: string; voice: string } {
  const i = key.indexOf(':');
  // Pre-modular settings stored bare Kokoro voice ids.
  return i < 0 ? { engine: 'kokoro', voice: key } : { engine: key.slice(0, i), voice: key.slice(i + 1) };
}

export function findVoice(key: string): { meta: EngineMeta; voice: VoiceInfo } | undefined {
  const { engine, voice } = parseVoiceKey(key);
  const meta = engineMeta(engine);
  const v = meta?.voices.find((x) => x.id === voice);
  return meta && v ? { meta, voice: v } : undefined;
}
