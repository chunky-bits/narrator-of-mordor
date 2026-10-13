// Content script entry: shows/hides the bar for this tab and wires it to the player.
import { loadEngineConfigs, onEngineConfigsChanged, type EngineConfigs } from '../engines/config';
import { ENGINES, findVoice, voiceKey } from '../engines/registry';
import {
  customVoiceParams,
  loadCustomVoices,
  onCustomVoicesChanged,
  recipeJson,
  type CustomVoice,
} from '../engines/supertonic/voices';
import type { ContentMessage } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings, type Settings } from '../shared/settings';
import { Bar, BAR_HEIGHT } from './bar';
import { chromeEngineSend, EngineClient, type EngineSend } from './engine-client';
import { Player } from './player';

interface Narrator {
  bar: Bar;
  player: Player;
}

export function init(send: EngineSend = chromeEngineSend): void {
  const w = window as Window & { __narmorLoaded?: boolean };
  if (w.__narmorLoaded) return; // injected twice (manifest + on-demand)
  w.__narmorLoaded = true;

  let narrator: Narrator | null = null;
  let settings: Settings;
  let engines: EngineConfigs = {};
  let customVoices: CustomVoice[] = [];
  let saveTimer = 0;

  /** If the selected voice's engine is disabled (or gone), switch to an available voice. */
  const ensureVoice = (s: Settings): Settings => {
    const found = findVoice(s.voice);
    if (found && engines[found.meta.id]?.enabled !== false) return s;
    const custom = customVoices.some((v) => `supertonic:${v.id}` === s.voice);
    if (custom && engines.supertonic?.enabled !== false) return s;
    const engine = ENGINES.find((e) => engines[e.id]?.enabled !== false) ?? ENGINES[0];
    const next = { ...s, voice: voiceKey(engine.id, engine.voices[0].id) };
    void saveSettings(next);
    return next;
  };

  const show = async () => {
    if (narrator) return;
    [engines, customVoices] = await Promise.all([loadEngineConfigs(), loadCustomVoices()]);
    settings = ensureVoice(await loadSettings());
    const bar: Bar = new Bar(settings, {
      onPlayPause: () => player.toggle(),
      onBack: () => player.back(),
      onRewind: () => player.rewind(),
      onForward: () => player.forward(),
      onSkip: () => player.skip(),
      onScrub: (fraction) => player.seekToFraction(fraction, true),
      onScrubEnd: (fraction) => player.seekToFraction(fraction),
      onSettingsChange: (next) => {
        settings = next;
        player.updateSettings(next);
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => void saveSettings(next), 300);
      },
      onOpenEngineSettings: () => void chrome.runtime.sendMessage({ type: 'narmor:open-options' }),
    });
    bar.setEngines(engines);
    bar.setCustomVoices(customVoices);
    const player: Player = new Player(
      new EngineClient(send, () => engines, (voice) => customVoiceParams(customVoices, voice)),
      settings,
      {
        onState: (state, detail) => bar.setState(state, detail),
        onProgress: (i, total) => bar.setProgress(i, total),
        onPosition: (fraction) => bar.setPosition(fraction),
        onError: (message) => bar.showError(message),
      },
      () => BAR_HEIGHT,
    );
    bar.mount();
    narrator = { bar, player };
    player.prepare(); // pre-generate the first sentence so play starts instantly
  };

  const hide = () => {
    if (!narrator) return;
    narrator.player.dispose();
    narrator.bar.unmount();
    narrator = null;
  };

  onSettingsChanged((next) => {
    // Changes made in another tab.
    settings = next;
    narrator?.player.updateSettings(next);
    narrator?.bar.setSettings(next);
  });

  onCustomVoicesChanged((next) => {
    // Edited in the Voice Builder: a changed recipe of the voice in use makes its audio stale.
    const recipe = (vs: CustomVoice[]) => {
      const v = vs.find((x) => `supertonic:${x.id}` === settings?.voice);
      return v ? recipeJson(v) : '';
    };
    const changed = recipe(next) !== recipe(customVoices);
    customVoices = next;
    if (!narrator) return;
    narrator.bar.setCustomVoices(next);
    const s = ensureVoice(settings);
    if (s !== settings) {
      settings = s;
      narrator.bar.setSettings(s);
      narrator.player.updateSettings(s);
    } else if (changed) narrator.player.engineConfigChanged();
  });

  onEngineConfigsChanged((next) => {
    // Changed on the options page: new parameters apply to newly synthesised audio.
    engines = next;
    if (!narrator) return;
    narrator.bar.setEngines(next);
    const s = ensureVoice(settings);
    if (s !== settings) {
      settings = s;
      narrator.bar.setSettings(s);
      narrator.player.updateSettings(s);
    }
    narrator.player.engineConfigChanged();
  });

  chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
    if (msg?.type === 'narmor:set-enabled') {
      if (msg.enabled) void show();
      else hide();
    }
    return false;
  });

  chrome.runtime
    .sendMessage({ type: 'narmor:get-tab-state' })
    .then((res: { enabled?: boolean } | undefined) => {
      if (res?.enabled) void show();
    })
    .catch(() => {});
}
