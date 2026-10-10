// Content script entry: shows/hides the bar for this tab and wires it to the player.
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
  let saveTimer = 0;

  const show = async () => {
    if (narrator) return;
    settings = await loadSettings();
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
    });
    const player: Player = new Player(
      new EngineClient(send),
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
