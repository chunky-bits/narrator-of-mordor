// The bottom navigation bar and its settings menu, isolated in a closed shadow root
// so page styles cannot reach in (and ours cannot leak out).
import type { Settings } from '../shared/settings';
import {
  SCHEMES,
  THEMES,
  type HighlightScheme,
  type Intensity,
  type ModeSetting,
  type SchemeId,
  type ThemeId,
  type ThemeMode,
  type UiTokens,
} from '../shared/themes';
import { makePalette, pageIsDark, type RGB } from './color';
import type { EngineConfigs } from '../engines/config';
import { ENGINES, voiceKey } from '../engines/registry';
import type { PlayerState } from './player';

export const BAR_HEIGHT = 56;

export interface BarCallbacks {
  onPlayPause(): void;
  onBack(): void;
  onRewind(): void;
  onForward(): void;
  onSkip(): void;
  /** Thumb dragged (held still) at this fraction of the bar. */
  onScrub(fraction: number): void;
  /** Thumb released at this fraction of the bar. */
  onScrubEnd(fraction: number): void;
  onSettingsChange(settings: Settings): void;
  /** Open the engine settings (options) page. */
  onOpenEngineSettings(): void;
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5.5" width="2.4" height="13" rx="1"/><path d="M19 6.6v10.8a1 1 0 0 1-1.55.83L9.6 12.83a1 1 0 0 1 0-1.66l7.85-5.4A1 1 0 0 1 19 6.6z"/></svg>',
  rewind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 7.1v9.8a.9.9 0 0 1-1.42.74L3.7 12.74a.9.9 0 0 1 0-1.48l6.38-4.9a.9.9 0 0 1 1.42.74z"/><path d="M20.5 7.1v9.8a.9.9 0 0 1-1.42.74l-6.38-4.9a.9.9 0 0 1 0-1.48l6.38-4.9a.9.9 0 0 1 1.42.74z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.6" y="5.5" width="2.4" height="13" rx="1"/><path d="M5 6.6v10.8a1 1 0 0 0 1.55.83l7.85-5.4a1 1 0 0 0 0-1.66l-7.85-5.4A1 1 0 0 0 5 6.6z"/></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.1v9.8a.9.9 0 0 0 1.42.74l6.38-4.9a.9.9 0 0 0 0-1.48l-6.38-4.9a.9.9 0 0 0-1.42.74z"/><path d="M12.5 7.1v9.8a.9.9 0 0 0 1.42.74l6.38-4.9a.9.9 0 0 0 0-1.48l-6.38-4.9a.9.9 0 0 0-1.42.74z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  eye: '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="nm-iris" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe08a"/><stop offset=".45" stop-color="#ff8a1f"/><stop offset="1" stop-color="#b8300a"/></radialGradient></defs><path d="M2 16C6.5 8.5 11 6 16 6s9.5 2.5 14 10c-4.5 7.5-9 10-14 10S6.5 23.5 2 16z" fill="url(#nm-iris)"/><path d="M16 8.5c1.1 2.2 1.6 4.7 1.6 7.5s-.5 5.3-1.6 7.5c-1.1-2.2-1.6-4.7-1.6-7.5s.5-5.3 1.6-7.5z" fill="#140c08"/></svg>',
};

const tokenCss = (t: UiTokens) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join('');

/** One rule per theme × mode, selected by the host's data-theme / data-mode attributes. */
const THEME_CSS = Object.values(THEMES)
  .flatMap((theme) =>
    (['dark', 'light'] as ThemeMode[]).map(
      (mode) => `:host([data-theme="${theme.id}"][data-mode="${mode}"]){${tokenCss(theme.modes[mode])}color-scheme:${mode};}`,
    ),
  )
  .join('\n');

const CSS = /* css */ `
:host {
  all: initial;
  position: fixed !important;
  left: 0; right: 0; bottom: 0;
  z-index: 2147483647 !important;
  display: block !important;
  ${tokenCss(THEMES.mordor.modes.dark)}
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  color-scheme: dark;
}
${THEME_CSS}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }

.bar {
  position: relative;
  height: ${BAR_HEIGHT}px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: linear-gradient(180deg, var(--bg-top) 0%, var(--bg) 100%);
  border-top: 1px solid var(--line);
  box-shadow: 0 -8px 24px var(--shadow);
}
.bar { --p: 0; }
.progress {
  position: absolute; left: 0; top: -1px; height: 2px; width: 100%;
  background: linear-gradient(90deg, var(--accent-deep), var(--accent));
  box-shadow: 0 0 8px var(--accent-glow);
  /* --p is driven every animation frame from the audio clock; no CSS transition. */
  transform: scaleX(var(--p));
  transform-origin: 0 50%;
}
/* Hover/drag strip along the progress line; the thumb fades in near its end. */
.seek {
  position: absolute; left: 0; right: 0; top: -7px; height: 14px; z-index: 1;
  touch-action: none;
}
.seek.disabled { pointer-events: none; }
.seek.near { cursor: grab; }
.seek.dragging { cursor: grabbing; }
.thumb {
  position: absolute; top: 50%; left: calc(var(--p) * 100%);
  width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--accent-hi), var(--accent) 55%, var(--accent-deep));
  box-shadow: 0 0 10px var(--accent-glow);
  opacity: 0; transform: scale(.5);
  /* Fade-out (transition of the state being entered: back to hidden). */
  transition: opacity .6s ease-in-out, transform .6s ease-in-out;
  pointer-events: none;
}
.seek.near .thumb, .seek.dragging .thumb {
  opacity: 1; transform: scale(1);
  /* Fade-in: quicker, but long enough to read as a fade rather than a pop. */
  transition: opacity .3s ease-out, transform .3s ease-out;
}
.seek.dragging .thumb { transform: scale(1.15); transition-duration: .15s; }

.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand svg, .brand img { width: 28px; height: 28px; flex: none; }
.brand svg { filter: drop-shadow(0 0 6px var(--accent-glow)); }
.brand img { object-fit: contain; filter: drop-shadow(0 1px 3px var(--shadow)); }
.titles { display: flex; flex-direction: column; min-width: 0; }
.title {
  font-weight: 650; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
  white-space: nowrap;
}
.status { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.error { color: var(--error); }

.play {
  width: 42px; height: 42px; border-radius: 50%;
  display: grid; place-items: center;
  border: none; cursor: pointer;
  background: radial-gradient(circle at 35% 30%, var(--accent-hi), var(--accent) 45%, var(--accent-deep));
  color: var(--on-accent);
  box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 0 14px var(--accent-glow);
  transition: transform .12s ease, box-shadow .2s ease;
  position: relative;
}
.play:hover { transform: scale(1.06); box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset, 0 0 22px var(--accent-glow); }
.play:active { transform: scale(.96); }
.play:focus-visible, .icon-btn:focus-visible, .switch:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.play svg { width: 20px; height: 20px; fill: currentColor; }

.transport { display: flex; align-items: center; gap: 6px; }
.skip {
  width: 34px; height: 34px; border-radius: 50%; border: none; padding: 0;
  display: grid; place-items: center; cursor: pointer;
  background: transparent; color: var(--text);
  transition: background .15s, color .15s, opacity .15s;
}
.skip svg { width: 17px; height: 17px; fill: currentColor; }
.skip:hover:not(:disabled) { background: var(--bg-raised); color: var(--accent); }
.skip:active:not(:disabled) { transform: scale(.94); }
.skip:disabled { opacity: .3; cursor: default; }
.skip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.play.loading::after {
  content: ""; position: absolute; inset: -5px; border-radius: 50%;
  border: 2px solid transparent; border-top-color: var(--accent); border-right-color: var(--accent);
  animation: spin .9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.right { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.icon-btn {
  width: 36px; height: 36px; border-radius: 10px; border: 1px solid transparent;
  background: transparent; display: grid; place-items: center; cursor: pointer; color: var(--muted);
  transition: background .15s, color .15s, border-color .15s;
}
.icon-btn:hover, .icon-btn[aria-expanded="true"] { background: var(--bg-raised); color: var(--text); border-color: var(--line); }
.icon-btn svg { width: 19px; height: 19px; }
.icon-btn[aria-expanded="true"] svg { transform: rotate(45deg); transition: transform .3s ease; }

.panel {
  position: absolute; right: 12px; bottom: calc(100% + 10px);
  width: min(344px, calc(100vw - 24px));
  max-height: min(70vh, 560px); overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 48px var(--shadow);
  padding: 6px 0 10px;
  transform-origin: bottom right;
  animation: rise .16s ease-out;
}
.panel[hidden] { display: none; }
@keyframes rise { from { opacity: 0; transform: translateY(6px) scale(.98); } }
.section { padding: 10px 16px 4px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 650; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; }
.row label { cursor: pointer; }
.row .hint { display: block; color: var(--muted); font-size: 11.5px; }
.row.stack { flex-direction: column; align-items: stretch; gap: 6px; }
.row.stack .head { display: flex; justify-content: space-between; }
.value { color: var(--muted); font-variant-numeric: tabular-nums; }

.switch {
  flex: none; width: 38px; height: 22px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--bg-input); position: relative; cursor: pointer; padding: 0;
  transition: background .2s, border-color .2s;
}
.switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--muted); transition: transform .2s ease, background .2s;
}
.switch[aria-checked="true"] { background: var(--accent-deep); border-color: var(--accent); }
.switch[aria-checked="true"]::after { transform: translateX(16px); background: #fff; }

select {
  width: 100%; height: 34px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--bg-input); color: var(--text); padding: 0 10px; font: inherit;
}

.link-btn {
  border: 1px solid var(--line); background: var(--bg-input); color: var(--text); cursor: pointer;
  border-radius: 8px; padding: 6px 10px; font-size: 12px; white-space: nowrap;
}
.link-btn:hover { border-color: var(--accent); color: var(--accent); }
.link-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Appearance: segmented controls and preview cards */
.seg { display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--bg-input); border: 1px solid var(--line); }
.seg button {
  flex: 1; height: 28px; border: none; border-radius: 7px; background: transparent; cursor: pointer;
  color: var(--muted); font-size: 12px;
}
.seg button[aria-checked="true"] { background: var(--bg-raised); color: var(--text); box-shadow: 0 1px 3px var(--shadow); }
.seg button:focus-visible, .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.card {
  display: flex; flex-direction: column; gap: 6px; padding: 6px; text-align: left; cursor: pointer;
  border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text);
}
.card[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card .name { font-size: 12px; font-weight: 600; padding: 0 2px; }
.card .mood { display: block; font-size: 10.5px; color: var(--muted); font-weight: 400; }
/* Miniature bar in the card's own theme */
.mini-bar {
  position: relative; height: 26px; border-radius: 6px; overflow: hidden;
  display: flex; align-items: center; gap: 6px; padding: 0 7px;
  background: linear-gradient(180deg, var(--bg-top), var(--bg)); border: 1px solid var(--line);
}
.mini-bar::before { content: ""; position: absolute; left: 0; top: 0; height: 2px; width: 45%; background: var(--accent); }
.mini-bar .lines { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.mini-bar .lines i { display: block; height: 3px; border-radius: 2px; background: var(--text); width: 70%; }
.mini-bar .lines i + i { background: var(--muted); width: 45%; }
.mini-bar .dot {
  width: 14px; height: 14px; border-radius: 50%; flex: none;
  background: radial-gradient(circle at 35% 30%, var(--accent-hi), var(--accent) 50%, var(--accent-deep));
}
.mini-bar .swatch { width: 9px; height: 9px; border-radius: 3px; background: var(--bg-raised); border: 1px solid var(--line); }
/* Highlight samples on a light and a dark page */
.hl { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.hl span.page {
  display: block; padding: 4px 5px; border-radius: 5px; font: 11px/1.3 Georgia, serif; white-space: nowrap; overflow: hidden;
}
.hl .page.light { background: #ffffff; color: #1f1f1f; border: 1px solid #e3e3e3; }
.hl .page.dark { background: #1d1d1f; color: #e8e8e8; border: 1px solid #333; }
.hl .page b { font-weight: inherit; border-radius: 2px; }
input[type=range] { width: 100%; accent-color: var(--accent); }

@media (max-width: 560px) {
  .title, .count { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

export class Bar {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private playBtn: HTMLButtonElement;
  private skipBtns: HTMLButtonElement[];
  private gearBtn: HTMLButtonElement;
  private panel: HTMLElement;
  private statusEl: HTMLElement;
  private countEl: HTMLElement;
  private barEl: HTMLElement;
  private systemDark = matchMedia('(prefers-color-scheme: dark)');
  private pageModeTimer = 0;
  private seekEl: HTMLElement;
  private position = 0;
  private dragging = false;
  private scrubTimer = 0;
  private settings: Settings;
  private engines: EngineConfigs = {};
  private errorTimer = 0;
  private stateText = 'Ready';

  constructor(settings: Settings, private cb: BarCallbacks) {
    this.settings = settings;
    this.host = document.createElement('narrator-of-mordor');
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `
      <style>${CSS}</style>
      <div class="bar" role="toolbar" aria-label="Narrator of Mordor">
        <div class="progress"></div>
        <div class="seek disabled"><div class="thumb"></div></div>
        <div class="brand">
          <img class="logo" alt="" src="${chrome.runtime.getURL('icons/book-64.png')}">
          <div class="titles">
            <span class="title">Narrator of Mordor</span>
            <span class="status" role="status" aria-live="polite">Ready</span>
          </div>
        </div>
        <div class="transport">
          <button class="skip back" type="button" aria-label="Paragraph start" title="Start of paragraph, or previous paragraph" disabled>${ICONS.back}</button>
          <button class="skip rewind" type="button" aria-label="Rewind" title="Rewind: restart sentence, or previous sentence" disabled>${ICONS.rewind}</button>
          <button class="play" type="button" aria-label="Play">${ICONS.play}</button>
          <button class="skip forward" type="button" aria-label="Next sentence" title="Next sentence" disabled>${ICONS.forward}</button>
          <button class="skip next" type="button" aria-label="Next paragraph" title="Next paragraph" disabled>${ICONS.skip}</button>
        </div>
        <div class="right">
          <span class="count"></span>
          <button class="icon-btn gear" type="button" aria-label="Settings" aria-expanded="false" aria-controls="nm-panel">${ICONS.gear}</button>
        </div>
        <div class="panel" id="nm-panel" role="dialog" aria-label="Narrator settings" hidden></div>
      </div>`;
    this.playBtn = this.root.querySelector('.play')!;
    const backBtn = this.root.querySelector<HTMLButtonElement>('.back')!;
    const rewindBtn = this.root.querySelector<HTMLButtonElement>('.rewind')!;
    const forwardBtn = this.root.querySelector<HTMLButtonElement>('.forward')!;
    const nextBtn = this.root.querySelector<HTMLButtonElement>('.next')!;
    this.skipBtns = [backBtn, rewindBtn, forwardBtn, nextBtn];
    this.gearBtn = this.root.querySelector('.gear')!;
    this.panel = this.root.querySelector('.panel')!;
    this.statusEl = this.root.querySelector('.status')!;
    this.countEl = this.root.querySelector('.count')!;
    this.barEl = this.root.querySelector('.bar')!;
    // Fall back to the inline eye if the page blocks the extension image.
    const logo = this.root.querySelector<HTMLImageElement>('img.logo')!;
    logo.addEventListener('error', () => logo.replaceWith(document.createRange().createContextualFragment(ICONS.eye)), { once: true });
    this.seekEl = this.root.querySelector('.seek')!;
    this.initSeek();

    // Keep the page's text selection when pressing the bar buttons.
    for (const btn of [this.playBtn, this.gearBtn, ...this.skipBtns]) {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    }
    this.playBtn.addEventListener('click', () => this.cb.onPlayPause());
    backBtn.addEventListener('click', () => this.cb.onBack());
    rewindBtn.addEventListener('click', () => this.cb.onRewind());
    forwardBtn.addEventListener('click', () => this.cb.onForward());
    nextBtn.addEventListener('click', () => this.cb.onSkip());
    this.gearBtn.addEventListener('click', () => this.togglePanel());

    // Keys typed in the bar should not trigger the page's own shortcuts.
    this.host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) {
        this.togglePanel(false);
        this.gearBtn.focus();
      }
      e.stopPropagation();
    });
    document.addEventListener('pointerdown', this.onOutsidePointer, true);

    this.applyTheme();
    this.renderPanel();
  }

  mount(): void {
    document.documentElement.append(this.host);
    this.systemDark.addEventListener('change', this.onModeSignal);
    // "Follow page": pages can switch between light and dark (or navigate in-app).
    this.pageModeTimer = window.setInterval(() => {
      if (this.settings.mode === 'page') this.onModeSignal();
    }, 3000);
    this.applyTheme();
  }

  unmount(): void {
    document.removeEventListener('pointerdown', this.onOutsidePointer, true);
    this.systemDark.removeEventListener('change', this.onModeSignal);
    clearInterval(this.pageModeTimer);
    this.host.remove();
  }

  /** The light/dark variant in effect for the current mode setting. */
  private resolveMode(): ThemeMode {
    const m = this.settings.mode;
    if (m === 'light' || m === 'dark') return m;
    if (m === 'system') return this.systemDark.matches ? 'dark' : 'light';
    return pageIsDark() ? 'dark' : 'light';
  }

  private applyTheme(): void {
    const theme = THEMES[this.settings.theme] ? this.settings.theme : 'mordor';
    this.host.dataset.theme = theme;
    this.host.dataset.mode = this.resolveMode();
  }

  private onModeSignal = (): void => {
    const before = this.host.dataset.mode;
    this.applyTheme();
    // Theme cards preview the variant in effect, so refresh them when it flips.
    if (this.host.dataset.mode !== before) this.renderPanel();
  };

  setState(state: PlayerState, detail?: string): void {
    this.host.dataset.state = state;
    const playing = state === 'playing' || state === 'loading';
    this.playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('loading', state === 'loading');
    for (const btn of this.skipBtns) btn.disabled = state === 'idle';
    this.seekEl.classList.toggle('disabled', state === 'idle');
    if (state === 'idle') this.seekEl.classList.remove('near');
    this.stateText =
      detail ?? { idle: 'Ready', loading: 'Preparing speech…', playing: 'Reading', paused: 'Paused' }[state];
    if (state === 'idle') {
      this.setProgress(-1, 0);
      this.setPosition(0);
    }
    if (!this.errorTimer) this.renderStatus(this.stateText);
  }

  setPosition(fraction: number): void {
    if (this.dragging) return; // the thumb follows the pointer until release
    this.renderPosition(fraction);
  }

  private renderPosition(fraction: number): void {
    const f = Math.round(Math.min(1, Math.max(0, fraction)) * 1e5) / 1e5;
    if (f === this.position) return;
    this.position = f;
    this.barEl.style.setProperty('--p', String(f));
  }

  /** Hover-to-reveal thumb at the end of the progress line, draggable to seek. */
  private initSeek(): void {
    const NEAR_PX = 18;
    const fractionAt = (e: PointerEvent) => {
      const r = this.seekEl.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(r.width, 1)));
    };
    const isNear = (e: PointerEvent) => {
      const r = this.seekEl.getBoundingClientRect();
      return Math.abs(e.clientX - (r.left + this.position * r.width)) <= NEAR_PX;
    };

    this.seekEl.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const f = fractionAt(e);
        this.renderPosition(f);
        // Seek once the pointer rests, rather than for every sentence passed over.
        clearTimeout(this.scrubTimer);
        this.scrubTimer = window.setTimeout(() => this.cb.onScrub(f), 200);
        return;
      }
      this.seekEl.classList.toggle('near', isNear(e));
    });
    this.seekEl.addEventListener('pointerleave', () => {
      if (!this.dragging) this.seekEl.classList.remove('near');
    });
    this.seekEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !isNear(e)) return;
      e.preventDefault(); // keep the page's text selection
      this.dragging = true;
      this.seekEl.setPointerCapture(e.pointerId);
      this.seekEl.classList.add('dragging', 'near');
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      clearTimeout(this.scrubTimer);
      this.dragging = false;
      this.seekEl.classList.remove('dragging');
      this.seekEl.classList.toggle('near', isNear(e));
      // The player seeks to the sentence start and reports it, snapping the thumb.
      this.cb.onScrubEnd(fractionAt(e));
    };
    this.seekEl.addEventListener('pointerup', end);
    this.seekEl.addEventListener('pointercancel', end);
  }

  setProgress(index: number, total: number): void {
    this.countEl.textContent = total ? `${index + 1} / ${total}` : '';
  }

  showError(message: string): void {
    clearTimeout(this.errorTimer);
    this.renderStatus(message, true);
    this.errorTimer = window.setTimeout(() => {
      this.errorTimer = 0;
      this.renderStatus(this.stateText);
    }, 5000);
  }

  /** Engine configuration changed: the voice list shows only enabled engines. */
  setEngines(engines: EngineConfigs): void {
    this.engines = engines;
    this.renderPanel();
  }

  setSettings(settings: Settings): void {
    // Ignore echoes of our own changes so sliders aren't re-rendered mid-drag.
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.settings = settings;
    this.applyTheme();
    this.renderPanel();
  }

  private renderStatus(text: string, error = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', error);
  }

  private onOutsidePointer = (e: PointerEvent): void => {
    if (!this.panel.hidden && !e.composedPath().includes(this.host)) this.togglePanel(false);
  };

  private togglePanel(open = this.panel.hidden): void {
    this.panel.hidden = !open;
    this.gearBtn.setAttribute('aria-expanded', String(open));
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.cb.onSettingsChange(this.settings);
    if ('theme' in patch || 'mode' in patch || 'highlightScheme' in patch || 'highlightIntensity' in patch) {
      this.applyTheme();
      this.renderPanel(); // checked states and previews
    }
  }

  // ---- appearance previews ------------------------------------------------------

  /** Sample sentence with its sentence and word highlight, on a light and a dark page. */
  private highlightSample(scheme: HighlightScheme, intensity: Intensity): string {
    const page = (cls: string, bg: RGB, text: RGB) => {
      const p = makePalette(bg, text, scheme, intensity);
      return `<span class="page ${cls}"><b style="background:${p.sentence}">Fire and <b style="background:${p.word}">ash</b> fell</b></span>`;
    };
    return `<div class="hl" aria-hidden="true">${page('light', [255, 255, 255], [31, 31, 31])}${page('dark', [29, 29, 31], [232, 232, 232])}</div>`;
  }

  private themeCard(id: ThemeId, mode: ThemeMode): string {
    const t = THEMES[id];
    const checked = this.settings.theme === id;
    return `
      <button class="card" type="button" role="radio" aria-checked="${checked}" data-theme-id="${id}"
        aria-label="${t.name} theme: ${t.mood}">
        <div class="mini-bar" style="${tokenCss(t.modes[mode])}" aria-hidden="true">
          <span class="lines"><i></i><i></i></span><span class="dot"></span><span class="swatch"></span>
        </div>
        ${this.highlightSample(SCHEMES[t.highlight], this.settings.highlightIntensity)}
        <span class="name">${t.name}<span class="mood">${t.mood}</span></span>
      </button>`;
  }

  private schemeCard(id: SchemeId | 'theme'): string {
    const scheme = id === 'theme' ? SCHEMES[THEMES[this.settings.theme].highlight] : SCHEMES[id];
    const name = id === 'theme' ? `Match theme` : scheme.name;
    const sub = id === 'theme' ? scheme.name : '&nbsp;';
    return `
      <button class="card" type="button" role="radio" aria-checked="${this.settings.highlightScheme === id}"
        data-scheme-id="${id}" aria-label="Highlight scheme: ${name}${id === 'theme' ? ` (${scheme.name})` : ''}">
        ${this.highlightSample(scheme, this.settings.highlightIntensity)}
        <span class="name">${name}<span class="mood">${sub}</span></span>
      </button>`;
  }

  private segmented<T extends string>(key: keyof Settings, label: string, options: [T, string][]): string {
    const current = this.settings[key];
    return `
      <div class="row stack">
        <span>${label}</span>
        <div class="seg" role="radiogroup" aria-label="${label}">
          ${options.map(([v, text]) => `<button type="button" role="radio" data-seg="${key}" data-value="${v}" aria-checked="${current === v}">${text}</button>`).join('')}
        </div>
      </div>`;
  }

  private appearanceSection(): string {
    const mode = this.resolveMode();
    return `
      <div class="section">Appearance</div>
      ${this.segmented<ModeSetting>('mode', 'Mode', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System'], ['page', 'Page']])}
      <div class="row stack">
        <span>Theme</span>
        <div class="cards" role="radiogroup" aria-label="Theme">
          ${(Object.keys(THEMES) as ThemeId[]).map((id) => this.themeCard(id, mode)).join('')}
        </div>
      </div>
      <div class="row stack">
        <span>Highlight colours</span>
        <div class="cards" role="radiogroup" aria-label="Highlight colours">
          ${(['theme', ...Object.keys(SCHEMES)] as (SchemeId | 'theme')[]).map((id) => this.schemeCard(id)).join('')}
        </div>
      </div>
      ${this.segmented<Intensity>('highlightIntensity', 'Highlight intensity', [['subtle', 'Subtle'], ['normal', 'Normal'], ['strong', 'Strong']])}`;
  }

  private renderPanel(): void {
    const s = this.settings;
    // Keep scroll position and keyboard focus across re-renders.
    const scrollTop = this.panel.scrollTop;
    const focused = this.root.activeElement as HTMLElement | null;
    const focusKey = focused && this.panel.contains(focused)
      ? (focused.id ? `#${focused.id}` : focused.dataset.themeId ? `[data-theme-id="${focused.dataset.themeId}"]`
        : focused.dataset.schemeId ? `[data-scheme-id="${focused.dataset.schemeId}"]`
        : focused.dataset.seg ? `[data-seg="${focused.dataset.seg}"][data-value="${focused.dataset.value}"]` : null)
      : null;
    const sw = (key: keyof Settings, label: string, hint: string) => `
      <div class="row">
        <label for="nm-${key}">${label}<span class="hint">${hint}</span></label>
        <button class="switch" id="nm-${key}" type="button" role="switch" data-key="${key}" aria-checked="${s[key]}"></button>
      </div>`;
    // Voices of the enabled engines, grouped by language and engine.
    const languageName = new Intl.DisplayNames(['en'], { type: 'language' });
    const groups = ENGINES.filter((e) => this.engines[e.id]?.enabled !== false)
      .flatMap((engine) =>
        [...new Set(engine.voices.map((v) => v.lang))].map(
          (lang) =>
            `<optgroup label="${languageName.of(lang) ?? lang} — ${engine.name}">` +
            engine.voices
              .filter((v) => v.lang === lang)
              .map((v) => {
                const key = voiceKey(engine.id, v.id);
                return `<option value="${key}" ${key === s.voice ? 'selected' : ''}>${v.name}${v.gender ? ` (${v.gender})` : ''}</option>`;
              })
              .join('') +
            '</optgroup>',
        ),
      )
      .join('');

    this.panel.innerHTML = `
      <div class="section">Highlighting</div>
      ${sw('sentenceHighlight', 'Highlight sentence', 'Tint the sentence being read')}
      ${sw('wordHighlight', 'Highlight word', 'Follow each spoken word')}
      <div class="section">Reading</div>
      ${sw('articleMode', 'Main article only', 'Skip menus, sidebars and footers')}
      ${sw('autoScroll', 'Auto-scroll', 'Keep the spoken text in view')}
      <div class="section">Voice</div>
      <div class="row stack">
        <label for="nm-voice">Voice</label>
        <select id="nm-voice">${groups}</select>
      </div>
      <div class="row">
        <span class="hint">Engines, devices and request sizes</span>
        <button class="link-btn" type="button" id="nm-engines">Engine settings…</button>
      </div>
      <div class="row stack">
        <div class="head"><label for="nm-speed">Speed</label><span class="value" data-for="speed">${s.speed.toFixed(2)}×</span></div>
        <input id="nm-speed" type="range" min="0.5" max="2" step="0.05" value="${s.speed}">
      </div>
      <div class="row stack">
        <div class="head"><label for="nm-volume">Volume</label><span class="value" data-for="volume">${Math.round(s.volume * 100)}%</span></div>
        <input id="nm-volume" type="range" min="0" max="1" step="0.01" value="${s.volume}">
      </div>
      ${this.appearanceSection()}`;

    for (const card of this.panel.querySelectorAll<HTMLButtonElement>('[data-theme-id]')) {
      card.addEventListener('click', () => this.update({ theme: card.dataset.themeId as ThemeId }));
    }
    for (const card of this.panel.querySelectorAll<HTMLButtonElement>('[data-scheme-id]')) {
      card.addEventListener('click', () => this.update({ highlightScheme: card.dataset.schemeId as SchemeId | 'theme' }));
    }
    for (const btn of this.panel.querySelectorAll<HTMLButtonElement>('[data-seg]')) {
      btn.addEventListener('click', () => this.update({ [btn.dataset.seg!]: btn.dataset.value }));
    }

    for (const btn of this.panel.querySelectorAll<HTMLButtonElement>('.switch')) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key as keyof Settings;
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        this.update({ [key]: next });
      });
    }
    this.panel.querySelector<HTMLButtonElement>('#nm-engines')!.addEventListener('click', () => {
      this.togglePanel(false);
      this.cb.onOpenEngineSettings();
    });
    this.panel.querySelector<HTMLSelectElement>('#nm-voice')!.addEventListener('change', (e) => {
      this.update({ voice: (e.target as HTMLSelectElement).value });
    });
    const speed = this.panel.querySelector<HTMLInputElement>('#nm-speed')!;
    const speedValue = this.panel.querySelector<HTMLElement>('[data-for="speed"]')!;
    speed.addEventListener('input', () => (speedValue.textContent = `${Number(speed.value).toFixed(2)}×`));
    speed.addEventListener('change', () => this.update({ speed: Number(speed.value) }));
    const volume = this.panel.querySelector<HTMLInputElement>('#nm-volume')!;
    const volumeValue = this.panel.querySelector<HTMLElement>('[data-for="volume"]')!;
    volume.addEventListener('input', () => {
      volumeValue.textContent = `${Math.round(Number(volume.value) * 100)}%`;
      this.update({ volume: Number(volume.value) });
    });
    this.panel.scrollTop = scrollTop;
    if (focusKey) this.panel.querySelector<HTMLElement>(focusKey)?.focus();
  }
}
