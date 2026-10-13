// Supertonic 3 module description: voices and configurable parameters.
import type { EngineMeta, VoiceInfo } from '../types';
import { PRESETS, presetName } from './voices';

/** Languages Supertonic 3 speaks (ISO 639-1), see the model card. */
export const SUPERTONIC_LANGS = [
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu',
  'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
];

/** Shipped voices; custom voices (recipes built from these) live in voices.ts. */
const voices: VoiceInfo[] = PRESETS.map((id) => ({
  id,
  name: presetName(id),
  // Every voice speaks every supported language.
  lang: 'mul',
  gender: id[0] === 'F' ? 'female' : 'male',
}));

const languageName = (code: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;

export const supertonicMeta: EngineMeta = {
  id: 'supertonic',
  name: 'Supertonic',
  description: 'Natural multilingual voices (31 languages, including Dutch) from Supertonic 3, running locally.',
  details: [
    'Model: Supertonic 3, ~99M parameters, ONNX fp32 (~380 MB, bundled), 44.1 kHz',
    'One model for all languages; any voice speaks any language',
    'Licence: BigScience Open RAIL-M (model weights)',
    'Word timing from the model\'s text-to-speech attention (±70 ms)',
  ],
  voices,
  params: [
    {
      key: 'device',
      label: 'Device',
      hint: 'WebGPU is ~10× faster than the CPU (WASM).',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'webgpu', label: 'WebGPU' },
        { value: 'wasm', label: 'CPU (WASM)' },
      ],
    },
    {
      key: 'language',
      label: 'Language',
      hint: 'Auto follows the page’s language (English if the page’s language is not supported).',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (page language)' },
        ...SUPERTONIC_LANGS.map((l) => ({ value: l, label: languageName(l) })).sort((a, b) => a.label.localeCompare(b.label)),
      ],
    },
    {
      key: 'steps',
      label: 'Quality steps',
      hint: 'Denoising steps per request. More is slightly cleaner but proportionally slower.',
      type: 'number',
      default: 8,
      min: 2,
      max: 16,
      step: 1,
      unit: 'steps',
    },
    {
      key: 'maxTokensGpu',
      label: 'Request size on WebGPU',
      hint: 'Characters per request; longer requests give more natural intonation.',
      type: 'number',
      default: 300,
      min: 50,
      max: 300,
      step: 10,
      unit: 'chars',
    },
    {
      key: 'maxTokensCpu',
      label: 'Request size on CPU',
      hint: 'The CPU is much slower; keep this lower to avoid long waits.',
      type: 'number',
      default: 200,
      min: 50,
      max: 300,
      step: 10,
      unit: 'chars',
    },
  ],
  reloadParams: ['device'],
};
