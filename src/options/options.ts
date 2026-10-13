// Engine settings page: one card per TTS engine module, with an enable switch, a form
// generated from the module's parameter specs, voice previews and live engine status.
import './options.css';
import { chromeEngineSend, EngineClient } from '../content/engine-client';
import { loadEngineConfigs, onEngineConfigsChanged, saveEngineConfigs, type EngineConfigs } from '../engines/config';
import { ENGINES, languageLabel, voiceKey } from '../engines/registry';
import { defaultParams, type EngineMeta, type ParamSpec } from '../engines/types';
import { diagnostics, issueUrl, type FeedbackKind } from '../shared/feedback';
import type { StatusResponse } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings, type Settings } from '../shared/settings';
import { THEMES, type ThemeMode } from '../shared/themes';
import {
  customVoiceParams,
  loadCustomVoices,
  onCustomVoicesChanged,
  recipeJson,
  saveCustomVoices,
  type CustomVoice,
} from '../engines/supertonic/voices';
import { bindVoiceBuilder, voiceBuilderHtml, type VoiceBuilderHost } from './voice-builder';

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

/** Preview sentence per language (prefix match). */
const SAMPLES: Record<string, string> = {
  en: 'Welcome, traveller. This is how I sound when I read to you.',
  nl: 'Welkom, reiziger. Zo klink ik als ik je voorlees.',
  de: 'Willkommen, Reisender. So klinge ich, wenn ich dir vorlese.',
  fr: 'Bienvenue, voyageur. Voici ma voix quand je te fais la lecture.',
  es: 'Bienvenido, viajero. Así sueno cuando te leo en voz alta.',
  it: 'Benvenuto, viaggiatore. Ecco come suono quando ti leggo ad alta voce.',
};

let configs: EngineConfigs;
let customVoices: CustomVoice[] = [];
let voicesSaveTimer = 0;
let settings: Settings;
let statuses: Record<string, string> = {};
let saveTimer = 0;
let audio: AudioContext | null = null;
// Custom Supertonic voices travel with each request as their recipe.
const client = new EngineClient(chromeEngineSend, () => configs, (voice) => customVoiceParams(customVoices, voice));

const builderHost: VoiceBuilderHost = {
  voices: () => customVoices,
  setVoices: (voices) => {
    customVoices = voices;
    clearTimeout(voicesSaveTimer);
    voicesSaveTimer = window.setTimeout(() => void saveCustomVoices(customVoices), 250);
  },
  voiceInUse: () => settings.voice,
  useVoice: (key) => {
    settings = { ...settings, voice: key };
    void saveSettings(settings);
    render();
  },
  preview: (key) => previewVoice(key, 'mul'),
  toast: (message) => toast('supertonic', message),
  rerender: () => render(),
};
const root = document.getElementById('engines')!;

// ---- theme --------------------------------------------------------------------------

const systemDark = matchMedia('(prefers-color-scheme: dark)');

function applyTheme(): void {
  const theme = THEMES[settings.theme] ?? THEMES.mordor;
  // "Follow page" has no page here; follow the system instead.
  const mode: ThemeMode =
    settings.mode === 'light' || settings.mode === 'dark' ? settings.mode : systemDark.matches ? 'dark' : 'light';
  for (const [k, v] of Object.entries(theme.modes[mode])) document.documentElement.style.setProperty(`--${k}`, v);
  document.documentElement.style.colorScheme = mode;
}

// ---- rendering ----------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function paramField(engine: EngineMeta, p: ParamSpec): string {
  const id = `${engine.id}-${p.key}`;
  const value = configs[engine.id].params[p.key];
  let control = '';
  if (p.type === 'boolean') {
    control = `<button class="switch" id="${id}" type="button" role="switch" aria-checked="${value === true}" data-engine="${engine.id}" data-param="${p.key}"></button>`;
  } else if (p.type === 'select') {
    control = `<select id="${id}" data-engine="${engine.id}" data-param="${p.key}">${p.options
      .map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>`;
  } else {
    control = `<input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" data-engine="${engine.id}" data-param="${p.key}">
      <span class="value" data-value-for="${id}">${value}${p.unit ? ` ${p.unit}` : ''}</span>`;
  }
  return `
    <div class="param">
      <label for="${id}">${esc(p.label)}</label>
      ${p.hint ? `<span class="hint">${esc(p.hint)}</span>` : ''}
      <div class="control">${control}</div>
    </div>`;
}

function engineCard(engine: EngineMeta): string {
  const cfg = configs[engine.id];
  const status = statuses[engine.id];
  const voices = engine.voices
    .map((v) => {
      const key = voiceKey(engine.id, v.id);
      const meta = [languageLabel(v.lang), v.gender].filter(Boolean).join(', ');
      return `
        <div class="voice ${settings.voice === key ? 'current' : ''}">
          <button class="play" type="button" data-preview="${key}" data-lang="${v.lang}" aria-label="Play a sample of ${esc(v.name)}" title="Play a sample">${PLAY_ICON}</button>
          <span class="name">${esc(v.name)}<span class="meta">${esc(meta)}${settings.voice === key ? ' · in use' : ''}</span></span>
        </div>`;
    })
    .join('');
  return `
    <section class="engine ${cfg.enabled ? '' : 'disabled'}" aria-labelledby="h-${engine.id}">
      <div class="engine-head">
        <div class="grow">
          <h2 id="h-${engine.id}">${esc(engine.name)}</h2>
          <p class="desc">${esc(engine.description)}</p>
          <span class="status ${status && !status.startsWith('Failed') && status !== 'Loading…' ? 'live' : ''}">
            ${esc(status ? `Engine: ${status}` : 'Engine: not loaded yet')}
          </span>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="${cfg.enabled}" data-enable="${engine.id}"
          aria-label="Enable ${esc(engine.name)}"></button>
      </div>
      <div class="body">
        <ul class="details">${engine.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        <h3>Settings</h3>
        ${engine.params.map((p) => paramField(engine, p)).join('')}
        ${
          engine.id === 'supertonic'
            ? `<div class="vb-root">${voiceBuilderHtml(builderHost)}</div>`
            : `<h3>Voices (${engine.voices.length})</h3><div class="voices">${voices}</div>`
        }
        <div class="toast" data-toast="${engine.id}" role="status"></div>
        <div class="actions"><button class="btn" type="button" data-reset="${engine.id}">Reset to defaults</button></div>
      </div>
    </section>`;
}

function render(): void {
  const focused = document.activeElement as HTMLElement | null;
  const focusId = focused?.id || (focused?.dataset.preview ? `[data-preview="${focused.dataset.preview}"]` : '');
  root.innerHTML = ENGINES.map(engineCard).join('');
  bind();
  if (focusId) (focusId.startsWith('[') ? root.querySelector<HTMLElement>(focusId) : document.getElementById(focusId))?.focus();
}

// ---- interaction ----------------------------------------------------------------------

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveEngineConfigs(configs), 250);
}

function setParam(engineId: string, key: string, value: boolean | number | string): void {
  configs = { ...configs, [engineId]: { ...configs[engineId], params: { ...configs[engineId].params, [key]: value } } };
  save();
}

function bind(): void {
  for (const sw of root.querySelectorAll<HTMLButtonElement>('[data-enable]')) {
    sw.addEventListener('click', () => {
      const id = sw.dataset.enable!;
      const enabled = sw.getAttribute('aria-checked') !== 'true';
      if (!enabled && Object.entries(configs).every(([k, c]) => k === id || !c.enabled)) {
        toast(id, 'At least one engine has to stay enabled.');
        return;
      }
      configs = { ...configs, [id]: { ...configs[id], enabled } };
      save();
      render();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-param]')) {
    const engine = el.dataset.engine!;
    const key = el.dataset.param!;
    if (el instanceof HTMLButtonElement) {
      el.addEventListener('click', () => {
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(next));
        setParam(engine, key, next);
      });
    } else if (el instanceof HTMLSelectElement) {
      el.addEventListener('change', () => setParam(engine, key, el.value));
    } else if (el instanceof HTMLInputElement) {
      const spec = ENGINES.find((e) => e.id === engine)!.params.find((p) => p.key === key)!;
      const label = root.querySelector<HTMLElement>(`[data-value-for="${el.id}"]`)!;
      el.addEventListener('input', () => {
        label.textContent = `${el.value}${spec.type === 'number' && spec.unit ? ` ${spec.unit}` : ''}`;
      });
      el.addEventListener('change', () => setParam(engine, key, Number(el.value)));
    }
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-reset]')) {
    btn.addEventListener('click', () => {
      const meta = ENGINES.find((e) => e.id === btn.dataset.reset)!;
      configs = { ...configs, [meta.id]: { ...configs[meta.id], params: defaultParams(meta) } };
      save();
      render();
    });
  }
  const vbRoot = root.querySelector<HTMLElement>('.vb-root');
  if (vbRoot) bindVoiceBuilder(vbRoot, builderHost);
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
    btn.addEventListener('click', () => void preview(btn));
  }
  // Clicking a voice (outside its play button) makes it the voice in use.
  for (const tile of root.querySelectorAll<HTMLElement>('.voice')) {
    tile.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.play')) return;
      const key = tile.querySelector<HTMLElement>('[data-preview]')!.dataset.preview!;
      settings = { ...settings, voice: key };
      void saveSettings(settings);
      render();
    });
  }
}

function toast(engineId: string, message: string): void {
  const el = root.querySelector<HTMLElement>(`[data-toast="${engineId}"]`);
  if (!el) return;
  el.textContent = message;
  setTimeout(() => (el.textContent = ''), 5000);
}

async function preview(btn: HTMLButtonElement): Promise<void> {
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  try {
    await previewVoice(btn.dataset.preview!, btn.dataset.lang ?? 'en');
  } finally {
    btn.classList.remove('busy');
  }
}

let previewSource: AudioBufferSourceNode | null = null;

/** Synthesise and play a sample sentence with a voice (stopping any previous sample). */
async function previewVoice(voice: string, voiceLang: string): Promise<void> {
  let lang = voiceLang;
  if (lang === 'mul') {
    // Multilingual voices: preview in the engine's language, or the browser's on Auto.
    const chosen = String(configs[voice.split(':')[0]]?.params.language ?? 'auto');
    lang = chosen !== 'auto' ? chosen : navigator.language;
  }
  const text = SAMPLES[lang.slice(0, 2)] ?? SAMPLES.en;
  audio ??= new AudioContext();
  void audio.resume(); // created/resumed within the click gesture
  try {
    const synthesis = await client.synthesize(`preview-${voice}`, text.split(' '), voice, settings.speed, lang);
    previewSource?.stop();
    const source = audio.createBufferSource();
    source.buffer = synthesis.buffer(audio);
    source.connect(audio.destination);
    source.start();
    previewSource = source;
    void refreshStatus();
  } catch (e) {
    toast(voice.split(':')[0], `Preview failed: ${(e as Error).message}`);
  }
}

/** Pre-fill the footer's feedback links with the current diagnostics. */
async function updateFeedbackLinks(): Promise<void> {
  const diag = await diagnostics({ settings, engineStatus: statuses });
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-feedback]')) {
    link.href = issueUrl(link.dataset.feedback as FeedbackKind, diag);
  }
}

/** Ask the offscreen document which engines are loaded and on what device. */
async function refreshStatus(): Promise<void> {
  let next: Record<string, string> = {};
  try {
    const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'status' })) as StatusResponse | undefined;
    if (res?.ok) next = res.engines;
  } catch {
    // no offscreen document: nothing loaded yet
  }
  if (JSON.stringify(next) !== JSON.stringify(statuses)) {
    statuses = next;
    render();
  }
  void updateFeedbackLinks(); // also picks up settings changes
}

const recipesOf = (voices: CustomVoice[]) => voices.map((v) => v.id + recipeJson(v, v.name)).join('|');

// ---- start ------------------------------------------------------------------------------

[configs, settings, customVoices] = await Promise.all([loadEngineConfigs(), loadSettings(), loadCustomVoices()]);
onCustomVoicesChanged((voices) => {
  // Changed elsewhere (another options tab); ignore echoes of our own saves.
  if (recipesOf(voices) === recipesOf(customVoices)) return;
  customVoices = voices;
  render();
});
applyTheme();
render();
void refreshStatus();
setInterval(refreshStatus, 2000);
systemDark.addEventListener('change', applyTheme);
onSettingsChanged((s) => {
  const voiceChanged = s.voice !== settings.voice;
  settings = s;
  applyTheme();
  if (voiceChanged) render();
});
onEngineConfigsChanged((c) => {
  // Ignore echoes of our own saves.
  if (JSON.stringify(c) === JSON.stringify(configs)) return;
  configs = c;
  render();
});
