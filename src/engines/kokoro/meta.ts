// Kokoro module description: voices and configurable parameters.
import type { EngineMeta, VoiceInfo } from '../types';

const voice = (id: string, name: string): VoiceInfo => ({
  id,
  name,
  lang: id[0] === 'a' ? 'en-US' : 'en-GB',
  gender: id[1] === 'f' ? 'female' : 'male',
});

/** Bundled English voices (see scripts/fetch-model.mjs), roughly by quality grade. */
const VOICES: VoiceInfo[] = [
  voice('af_heart', 'Heart'),
  voice('af_bella', 'Bella'),
  voice('af_nicole', 'Nicole'),
  voice('bf_emma', 'Emma'),
  voice('am_fenrir', 'Fenrir'),
  voice('am_michael', 'Michael'),
  voice('am_puck', 'Puck'),
  voice('bm_george', 'George'),
  voice('bm_fable', 'Fable'),
  voice('af_aoede', 'Aoede'),
  voice('af_kore', 'Kore'),
  voice('af_sarah', 'Sarah'),
  voice('bf_isabella', 'Isabella'),
  voice('af_alloy', 'Alloy'),
  voice('af_nova', 'Nova'),
  voice('af_sky', 'Sky'),
  voice('af_jessica', 'Jessica'),
  voice('af_river', 'River'),
  voice('am_echo', 'Echo'),
  voice('am_eric', 'Eric'),
  voice('am_liam', 'Liam'),
  voice('am_onyx', 'Onyx'),
  voice('am_adam', 'Adam'),
  voice('bf_alice', 'Alice'),
  voice('bf_lily', 'Lily'),
  voice('bm_daniel', 'Daniel'),
  voice('bm_lewis', 'Lewis'),
];

export const kokoroMeta: EngineMeta = {
  id: 'kokoro',
  name: 'Kokoro',
  description: 'High-quality English voices from the 82M-parameter Kokoro model, running locally.',
  details: [
    'Model: Kokoro-82M v1.0, timestamped ONNX export, fp32 (~325 MB, bundled)',
    'Languages: American and British English',
    'Licence: Apache-2.0 (model); phonemes by eSpeak NG (GPL-3.0)',
    'Exact word timing from the model\'s phoneme durations',
  ],
  voices: VOICES,
  params: [
    {
      key: 'device',
      label: 'Device',
      hint: 'Auto uses WebGPU when available and falls back to the CPU (WASM).',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'webgpu', label: 'WebGPU' },
        { value: 'wasm', label: 'CPU (WASM)' },
      ],
    },
    {
      key: 'maxTokensGpu',
      label: 'Request size on WebGPU',
      hint: 'More context gives more natural intonation, but jumps to unprepared text wait longer.',
      type: 'number',
      default: 500,
      min: 50,
      max: 500,
      step: 10,
      unit: 'tokens',
    },
    {
      key: 'maxTokensCpu',
      label: 'Request size on CPU',
      hint: 'The CPU is ~3× slower than WebGPU; keep this lower to avoid long waits.',
      type: 'number',
      default: 250,
      min: 50,
      max: 500,
      step: 10,
      unit: 'tokens',
    },
    {
      key: 'naturalFunctionWords',
      label: 'Natural function words',
      hint: 'Say “the, a, to, of…” unstressed, as in running speech.',
      type: 'boolean',
      default: true,
    },
  ],
  reloadParams: ['device'],
};
