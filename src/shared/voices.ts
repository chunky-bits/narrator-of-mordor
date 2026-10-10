// English Kokoro voices bundled with the extension (see scripts/fetch-model.mjs).
// Ordered roughly by quality grade from the Kokoro voice card.
export interface Voice {
  id: string;
  name: string;
  accent: 'US' | 'UK';
  gender: 'female' | 'male';
}

const v = (id: string, name: string): Voice => ({
  id,
  name,
  accent: id[0] === 'a' ? 'US' : 'UK',
  gender: id[1] === 'f' ? 'female' : 'male',
});

export const VOICES: Voice[] = [
  v('af_heart', 'Heart'),
  v('af_bella', 'Bella'),
  v('af_nicole', 'Nicole'),
  v('bf_emma', 'Emma'),
  v('am_fenrir', 'Fenrir'),
  v('am_michael', 'Michael'),
  v('am_puck', 'Puck'),
  v('bm_george', 'George'),
  v('bm_fable', 'Fable'),
  v('af_aoede', 'Aoede'),
  v('af_kore', 'Kore'),
  v('af_sarah', 'Sarah'),
  v('bf_isabella', 'Isabella'),
  v('af_alloy', 'Alloy'),
  v('af_nova', 'Nova'),
  v('af_sky', 'Sky'),
  v('af_jessica', 'Jessica'),
  v('af_river', 'River'),
  v('am_echo', 'Echo'),
  v('am_eric', 'Eric'),
  v('am_liam', 'Liam'),
  v('am_onyx', 'Onyx'),
  v('am_adam', 'Adam'),
  v('bf_alice', 'Alice'),
  v('bf_lily', 'Lily'),
  v('bm_daniel', 'Daniel'),
  v('bm_lewis', 'Lewis'),
];
