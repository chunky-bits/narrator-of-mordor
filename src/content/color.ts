// Colour maths shared by the page highlighter and the settings previews.
import { INTENSITY, type HighlightScheme, type Intensity } from '../shared/themes';

export type RGB = [number, number, number];

export interface Palette {
  sentence: string;
  word: string;
}

export function parseColor(css: string): RGB | null {
  const rgba = parseRgba(css);
  return rgba ? [rgba[0], rgba[1], rgba[2]] : null;
}

function parseRgba(css: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith('%')) a /= 100;
  return [+m[1], +m[2], +m[3], a];
}

/** Composite the background layers behind `el` into the colour the user actually sees. */
export function effectiveBackground(el: Element): RGB {
  const layers: [number, number, number, number][] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = parseRgba(getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0) {
      layers.push(c);
      if (c[3] >= 1) break;
    }
  }
  // Canvas colour when nothing is opaque: white, or dark if the page opts into dark.
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  let out: RGB =
    scheme.includes('dark') && !scheme.includes('light') ? [18, 18, 18] : [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) {
    const [r, g, b, a] = layers[i];
    out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
  }
  return out;
}

export function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round) as RGB;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Shift lightness away from the background, then keep moving (towards the side that
 * contrasts with the text) until the text stays readable.
 */
function variant(bg: RGB, text: RGB, hue: number, sat: number, shift: number): string {
  const [, , l] = rgbToHsl(bg);
  const darkBg = luminance(bg) < 0.18;
  const textIsLight = luminance(text) > luminance(bg);
  let light = clamp(darkBg ? l + shift : l - shift, 0.08, 0.94);
  let rgb = hslToRgb(hue, sat, light);
  const target = Math.min(4.5, contrast(text, bg)); // never demand more than the site had
  for (let i = 0; i < 30 && contrast(text, rgb) < target; i++) {
    light = clamp(light + (textIsLight ? -0.02 : 0.02), 0.04, 0.97);
    rgb = hslToRgb(hue, sat, light);
  }
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Sentence and word highlight colours for text of colour `text` on background `bg`:
 * the sentence a lightness variation of the background's own hue, the word a different
 * hue with a stronger shift, both kept readable. On neutral backgrounds (no hue to vary)
 * the scheme's fixed hues are used.
 */
export function makePalette(bg: RGB, text: RGB, scheme: HighlightScheme, intensity: Intensity): Palette {
  const [h, s] = rgbToHsl(bg);
  // Judge "neutral" by chroma: HSL saturation is inflated for near-whites, which would
  // treat off-white and cream pages as coloured.
  const chroma = (Math.max(...bg) - Math.min(...bg)) / 255;
  const neutral = chroma < 0.08;
  const k = INTENSITY[intensity];
  const sat = (boost: number, lo: number, hi: number) => (boost ? clamp(s + boost, lo, hi) : Math.min(s, hi));
  const hueDistance = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  let coloredWordHue = h + scheme.wordHueShift;
  if (scheme.anchorWord && hueDistance(scheme.neutralWord[0], h) >= 45) coloredWordHue = scheme.neutralWord[0];
  const [sentenceHue, sentenceSat] = neutral ? scheme.neutralSentence : [h, sat(scheme.sentenceSatBoost, 0.35, 0.85)];
  const [wordHue, wordSat] = neutral ? scheme.neutralWord : [coloredWordHue, sat(scheme.wordSatBoost, 0.6, 1)];
  return {
    sentence: variant(bg, text, sentenceHue, sentenceSat, scheme.sentenceShift * k),
    word: variant(bg, text, wordHue, wordSat, scheme.wordShift * k),
  };
}

/** True when the page's main background is dark. */
export function pageIsDark(): boolean {
  return luminance(effectiveBackground(document.body ?? document.documentElement)) < 0.18;
}
