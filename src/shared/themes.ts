// Colour themes. UI themes colour the bar and settings menu (each in a light and a dark
// variant); highlight schemes parameterise how sentence/word highlights are derived from
// the page's own background colour. Each UI theme has a matching highlight scheme.

export type ThemeId = 'mordor' | 'shire' | 'rivendell' | 'gondor';
export type ThemeMode = 'light' | 'dark';
/** User choice: a fixed mode, follow the OS, or follow the page's background. */
export type ModeSetting = ThemeMode | 'system' | 'page';
export type SchemeId = 'classic' | 'ember' | 'forest' | 'mono';
export type Intensity = 'subtle' | 'normal' | 'strong';

/** CSS custom properties of the bar (without the leading "--"). */
export interface UiTokens {
  bg: string;
  'bg-top': string;
  'bg-raised': string;
  'bg-input': string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  'accent-deep': string;
  'accent-hi': string;
  'accent-glow': string;
  'on-accent': string;
  error: string;
  shadow: string;
}

export interface UiTheme {
  id: ThemeId;
  name: string;
  mood: string;
  highlight: SchemeId;
  modes: Record<ThemeMode, UiTokens>;
}

const darkShadow = 'rgba(0, 0, 0, .45)';
const lightShadow = 'rgba(40, 30, 20, .16)';

export const THEMES: Record<ThemeId, UiTheme> = {
  mordor: {
    id: 'mordor',
    name: 'Mordor',
    mood: 'Obsidian and ember',
    highlight: 'ember',
    modes: {
      dark: {
        bg: '#15110e', 'bg-top': '#1b1612', 'bg-raised': '#1f1915', 'bg-input': '#2a221c',
        line: '#3a2e25', text: '#f3e9df', muted: '#a8968a',
        accent: '#ff7a1a', 'accent-deep': '#c2410c', 'accent-hi': '#ffb15c',
        'accent-glow': 'rgba(255, 122, 26, .45)', 'on-accent': '#1a0d05', error: '#ff9b7a', shadow: darkShadow,
      },
      light: {
        bg: '#f6efe7', 'bg-top': '#fbf6f0', 'bg-raised': '#ffffff', 'bg-input': '#f1e7dc',
        line: '#e0cfbf', text: '#2a1d14', muted: '#76604f',
        accent: '#d9480f', 'accent-deep': '#a8340a', 'accent-hi': '#ff8a3d',
        'accent-glow': 'rgba(217, 72, 15, .30)', 'on-accent': '#fff7f0', error: '#b42318', shadow: lightShadow,
      },
    },
  },
  shire: {
    id: 'shire',
    name: 'Shire',
    mood: 'Parchment and moss',
    highlight: 'forest',
    modes: {
      dark: {
        bg: '#161a12', 'bg-top': '#1c2116', 'bg-raised': '#20261a', 'bg-input': '#283020',
        line: '#353f2a', text: '#eef0e0', muted: '#a3a88c',
        accent: '#8cc35e', 'accent-deep': '#5a8a35', 'accent-hi': '#b5e08a',
        'accent-glow': 'rgba(140, 195, 94, .35)', 'on-accent': '#11180b', error: '#ff9b7a', shadow: darkShadow,
      },
      light: {
        bg: '#f4f1e4', 'bg-top': '#faf8ee', 'bg-raised': '#fffdf5', 'bg-input': '#ece7d3',
        line: '#d8d1b5', text: '#2b2a1a', muted: '#6b6749',
        accent: '#4d7c2f', 'accent-deep': '#365a1f', 'accent-hi': '#7fae55',
        'accent-glow': 'rgba(77, 124, 47, .30)', 'on-accent': '#fbfff5', error: '#b42318', shadow: lightShadow,
      },
    },
  },
  rivendell: {
    id: 'rivendell',
    name: 'Rivendell',
    mood: 'Slate and silver',
    highlight: 'mono',
    modes: {
      dark: {
        bg: '#12161b', 'bg-top': '#171c22', 'bg-raised': '#1b2129', 'bg-input': '#232a33',
        line: '#2f3945', text: '#e8eef4', muted: '#93a1b0',
        accent: '#8fb8de', 'accent-deep': '#5a87b0', 'accent-hi': '#c3dcf2',
        'accent-glow': 'rgba(143, 184, 222, .35)', 'on-accent': '#0d1620', error: '#ff9b7a', shadow: darkShadow,
      },
      light: {
        bg: '#eef2f6', 'bg-top': '#f6f8fb', 'bg-raised': '#ffffff', 'bg-input': '#e4eaf0',
        line: '#cdd6e0', text: '#1a2430', muted: '#5a6878',
        accent: '#3e6f9c', 'accent-deep': '#2c5379', 'accent-hi': '#77a3cc',
        'accent-glow': 'rgba(62, 111, 156, .28)', 'on-accent': '#f5f9fd', error: '#b42318', shadow: lightShadow,
      },
    },
  },
  gondor: {
    id: 'gondor',
    name: 'Gondor',
    mood: 'White stone and royal blue',
    highlight: 'classic',
    modes: {
      dark: {
        bg: '#10131c', 'bg-top': '#151a26', 'bg-raised': '#19202e', 'bg-input': '#212a3b',
        line: '#2c3850', text: '#eef1f7', muted: '#98a2b8',
        accent: '#6f9cf2', 'accent-deep': '#3e68c0', 'accent-hi': '#a9c4ff',
        'accent-glow': 'rgba(111, 156, 242, .35)', 'on-accent': '#0b1224', error: '#ff9b7a', shadow: darkShadow,
      },
      light: {
        bg: '#f7f7f4', 'bg-top': '#fdfdfb', 'bg-raised': '#ffffff', 'bg-input': '#eeeeea',
        line: '#d9d9d2', text: '#1b1f2a', muted: '#5c6270',
        accent: '#1f4fa8', 'accent-deep': '#163a7d', 'accent-hi': '#4f7fd6',
        'accent-glow': 'rgba(31, 79, 168, .28)', 'on-accent': '#ffffff', error: '#b42318', shadow: lightShadow,
      },
    },
  },
};

/**
 * How highlight colours are derived from the page background. On neutral (white,
 * off-white, grey, black) backgrounds there is no hue to vary, so the scheme's hues are
 * used. On coloured backgrounds the sentence keeps the page's own hue; the word keeps the
 * scheme's hue (`anchorWord`) unless that is too close to the page's, in which case — and
 * for non-anchored schemes — it is the page hue rotated by `wordHueShift`.
 */
export interface HighlightScheme {
  id: SchemeId;
  name: string;
  /** [hue°, saturation] used on neutral backgrounds. */
  neutralSentence: [number, number];
  neutralWord: [number, number];
  /** Keep the word in the scheme's own hue on coloured backgrounds. */
  anchorWord: boolean;
  /** Hue rotation of the word highlight on coloured backgrounds (fallback when anchored). */
  wordHueShift: number;
  /** Saturation added to the page's own (sentence / word) on coloured backgrounds. */
  sentenceSatBoost: number;
  wordSatBoost: number;
  /** Lightness shift away from the background at normal intensity. */
  sentenceShift: number;
  wordShift: number;
}

export const SCHEMES: Record<SchemeId, HighlightScheme> = {
  classic: {
    id: 'classic', name: 'Classic',
    neutralSentence: [215, 0.55], neutralWord: [35, 0.95],
    anchorWord: true, wordHueShift: 150, sentenceSatBoost: 0.15, wordSatBoost: 0.35, sentenceShift: 0.09, wordShift: 0.22,
  },
  ember: {
    id: 'ember', name: 'Ember',
    neutralSentence: [38, 0.6], neutralWord: [14, 0.95],
    anchorWord: true, wordHueShift: 150, sentenceSatBoost: 0.15, wordSatBoost: 0.4, sentenceShift: 0.09, wordShift: 0.24,
  },
  forest: {
    id: 'forest', name: 'Forest',
    neutralSentence: [105, 0.4], neutralWord: [48, 0.95],
    anchorWord: true, wordHueShift: 150, sentenceSatBoost: 0.12, wordSatBoost: 0.35, sentenceShift: 0.09, wordShift: 0.22,
  },
  mono: {
    id: 'mono', name: 'Mono',
    neutralSentence: [210, 0.06], neutralWord: [210, 0.1],
    anchorWord: false, wordHueShift: 0, sentenceSatBoost: 0, wordSatBoost: 0, sentenceShift: 0.08, wordShift: 0.24,
  },
};

/** Multiplier on the lightness shifts. */
export const INTENSITY: Record<Intensity, number> = { subtle: 0.6, normal: 1, strong: 1.6 };
