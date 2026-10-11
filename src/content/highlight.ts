// Sentence and word highlighting with the CSS Custom Highlight API: the page's DOM is
// never modified, so the "original colour" is always what the site itself renders.
//
// Colours are derived from the effective background behind the text (see makePalette
// in color.ts) according to the active highlight scheme and intensity.
import { INTENSITY, SCHEMES, type HighlightScheme, type Intensity } from '../shared/themes';
import { effectiveBackground, makePalette, parseColor, type Palette } from './color';
import { toRange, type Span } from './segment';

const SENTENCE = 'narmor-sentence';
const WORD = 'narmor-word';

export class Highlighter {
  private style: HTMLStyleElement | null = null;
  private sentenceHl = new Highlight();
  private wordHl = new Highlight();
  private palettes = new Map<Element, Palette>();
  private sentenceColor = '';
  private wordColor = '';
  private scheme: HighlightScheme = SCHEMES.classic;
  private intensity: Intensity = 'normal';
  private sentenceSpan: Span | null = null;
  private wordSpan: Span | null = null;

  constructor() {
    this.wordHl.priority = 1;
  }

  /** Change colour scheme / intensity; current highlights are recoloured. */
  configure(scheme: HighlightScheme, intensity: Intensity): void {
    if (scheme === this.scheme && intensity === this.intensity) return;
    this.scheme = scheme;
    this.intensity = intensity in INTENSITY ? intensity : 'normal';
    this.palettes.clear();
    this.setSentence(this.sentenceSpan);
    this.setWord(this.wordSpan);
  }

  setSentence(span: Span | null): void {
    this.sentenceSpan = span;
    this.sentenceHl.clear();
    if (!span) return;
    this.sentenceHl.add(toRange(span));
    this.sentenceColor = this.paletteFor(span.start.node).sentence;
    this.install();
  }

  setWord(span: Span | null): void {
    this.wordSpan = span;
    this.wordHl.clear();
    if (!span) return;
    this.wordHl.add(toRange(span));
    this.wordColor = this.paletteFor(span.start.node).word;
    this.install();
  }

  clear(): void {
    this.sentenceSpan = this.wordSpan = null;
    this.sentenceHl.clear();
    this.wordHl.clear();
  }

  dispose(): void {
    this.clear();
    CSS.highlights.delete(SENTENCE);
    CSS.highlights.delete(WORD);
    this.style?.remove();
    this.style = null;
  }

  private install(): void {
    if (!CSS.highlights.has(SENTENCE)) CSS.highlights.set(SENTENCE, this.sentenceHl);
    if (!CSS.highlights.has(WORD)) CSS.highlights.set(WORD, this.wordHl);
    if (!this.style || !this.style.isConnected) {
      this.style = document.createElement('style');
      this.style.dataset.narmor = '';
      (document.head ?? document.documentElement).append(this.style);
    }
    const css =
      `::highlight(${SENTENCE}){background-color:${this.sentenceColor};}` +
      `::highlight(${WORD}){background-color:${this.wordColor};}`;
    if (this.style.textContent !== css) this.style.textContent = css;
  }

  private paletteFor(node: Node): Palette {
    const el = node.parentElement ?? document.documentElement;
    let p = this.palettes.get(el);
    if (!p) {
      const text = parseColor(getComputedStyle(el).color) ?? [0, 0, 0];
      p = makePalette(effectiveBackground(el), text, this.scheme, this.intensity);
      this.palettes.set(el, p);
    }
    return p;
  }
}
