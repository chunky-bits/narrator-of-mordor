// Playback controller: synthesises sentence by sentence (with look-ahead), plays the
// audio in the page's AudioContext and drives highlighting from the audio clock, so
// word highlights follow the exact timings reported by the model.
import type { Settings } from '../shared/settings';
import { findArticleRoots } from './article';
import type { EngineClient, Synthesis } from './engine-client';
import { Highlighter } from './highlight';
import { collectSentences, toRange, type Sentence, type Span } from './segment';
import { SelectionKeeper } from './selection';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlayerEvents {
  onState(state: PlayerState, detail?: string): void;
  onProgress(index: number, total: number): void;
  onError(message: string): void;
}

const LOOKAHEAD = 2;

export class Player {
  state: PlayerState = 'idle';
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private sentences: Sentence[] = [];
  private index = 0;
  private session = '';
  private cache = new Map<number, Promise<Synthesis>>();
  private synthKey = '';
  private words: [number, number][] = [];
  private startedAt = 0;
  private currentWord = -1;
  private raf = 0;
  private highlighter = new Highlighter();
  private selection = new SelectionKeeper();
  /** True when the current reading was started from a user selection. */
  private fromSelection = false;
  /** First sentence synthesised ahead of time, keyed by its text, voice and speed. */
  private prepared: { key: string; session: string; synthesis: Promise<Synthesis> } | null = null;
  private prepareTimer = 0;

  constructor(
    private engine: EngineClient,
    private settings: Settings,
    private events: PlayerEvents,
    private bottomInset: () => number,
  ) {}

  /** Play/pause button. Must be called from a user gesture (creates the AudioContext). */
  toggle(): void {
    this.ensureAudio();
    if (this.state === 'playing' || this.state === 'loading') {
      this.pause();
      return;
    }
    // A fresh selection while paused starts a new reading of that selection.
    if (this.state === 'paused' && !this.selection.hasNewSelection()) {
      this.resume();
      return;
    }
    this.start();
  }

  stop(): void {
    if (this.session) this.engine.cancel(this.session);
    this.session = '';
    this.stopSource();
    cancelAnimationFrame(this.raf);
    this.cache.clear();
    this.highlighter.clear();
    this.selection.restore();
    this.setState('idle');
  }

  /**
   * Synthesise the page's first sentence in the background so that pressing play
   * starts immediately (this also loads the model). Called when the bar appears and
   * whenever the player becomes idle again.
   */
  prepare(): void {
    clearTimeout(this.prepareTimer);
    // Let the page finish rendering first; segmentation reads computed styles.
    this.prepareTimer = window.setTimeout(() => {
      if (this.state !== 'idle') return;
      const first = this.collectPage()[0];
      if (!first) return;
      const words = first.words.map((w) => w.text);
      const key = this.textKey(words);
      if (this.prepared?.key === key) return;
      if (this.prepared) this.engine.cancel(this.prepared.session);
      const session = `prepare-${Math.random().toString(36).slice(2)}`;
      const synthesis = this.engine.synthesize(session, words, this.settings.voice, this.settings.speed);
      synthesis.catch(() => {
        if (this.prepared?.synthesis === synthesis) this.prepared = null;
      });
      this.prepared = { key, session, synthesis };
    }, 300);
  }

  dispose(): void {
    clearTimeout(this.prepareTimer);
    if (this.prepared) this.engine.cancel(this.prepared.session);
    this.prepared = null;
    this.stop();
    this.highlighter.dispose();
    void this.ctx?.close();
    this.ctx = null;
  }

  updateSettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    if (this.gain) this.gain.gain.value = next.volume;
    if (next.voice !== prev.voice || next.speed !== prev.speed) {
      // Already-synthesised look-ahead uses the old voice/speed; drop it.
      for (const i of [...this.cache.keys()]) if (i > this.index) this.cache.delete(i);
      if (this.session) this.prefetch(this.index + 1);
    }
    if (
      this.state === 'idle' &&
      (next.voice !== prev.voice || next.speed !== prev.speed || next.articleMode !== prev.articleMode)
    ) {
      this.prepare(); // the prepared sentence no longer matches
    }
    if (!next.sentenceHighlight) this.highlighter.setSentence(null);
    else if (this.state !== 'idle') this.highlighter.setSentence(this.sentences[this.index]?.span ?? null);
    if (!next.wordHighlight) {
      this.highlighter.setWord(null);
      this.currentWord = -1;
    }
  }

  // ---------------------------------------------------------------------------

  private ensureAudio(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.settings.volume;
      this.gain.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  private start(): void {
    this.stop();
    const sel = this.selection.capture();
    this.fromSelection = Boolean(sel);
    const lang = document.documentElement.lang || navigator.language || 'en';
    let sentences: Sentence[];
    if (sel) {
      sentences = collectSentences([sel.commonAncestorContainer], { clamp: sel, articleMode: false, lang });
    } else {
      sentences = this.collectPage();
    }
    if (!sentences.length) {
      this.selection.restore();
      this.events.onError(sel ? 'No readable text in the selection.' : 'No readable text found on this page.');
      return;
    }
    // Hide the selection while reading; it is restored on pause / stop / finish.
    this.selection.hide();
    this.sentences = sentences;
    this.session = Math.random().toString(36).slice(2);
    this.cache.clear();
    void this.playIndex(0);
  }

  private collectPage(): Sentence[] {
    const lang = document.documentElement.lang || navigator.language || 'en';
    const roots = (this.settings.articleMode && findArticleRoots()) || [document.body];
    return collectSentences(roots, { articleMode: this.settings.articleMode, lang });
  }

  private textKey(words: string[]): string {
    return `${this.settings.voice}|${this.settings.speed}|${words.join(' ')}`;
  }

  private pause(): void {
    if (!this.ctx) return;
    void this.ctx.suspend();
    cancelAnimationFrame(this.raf);
    this.selection.restore();
    this.setState('paused');
  }

  private resume(): void {
    this.selection.hide();
    void this.ctx!.resume();
    if (this.source) {
      this.setState('playing');
      this.tick();
    } else {
      // Paused while the sentence was still being synthesised.
      void this.playIndex(this.index);
    }
  }

  private synth(i: number): Promise<Synthesis> {
    const key = `${this.settings.voice}|${this.settings.speed}`;
    if (key !== this.synthKey) {
      this.cache.clear();
      this.synthKey = key;
    }
    let p = this.cache.get(i);
    if (!p) {
      const words = this.sentences[i].words.map((w) => w.text);
      // Matched by text, so it is still used correctly if the page changed meanwhile.
      if (this.prepared?.key === this.textKey(words)) {
        p = this.prepared.synthesis;
        this.prepared = null;
      } else {
        p = this.engine.synthesize(this.session, words, this.settings.voice, this.settings.speed);
      }
      p.catch(() => {}); // handled where awaited
      this.cache.set(i, p);
    }
    return p;
  }

  private prefetch(from: number): void {
    for (let i = from; i < Math.min(from + LOOKAHEAD, this.sentences.length); i++) void this.synth(i);
  }

  private async playIndex(i: number): Promise<void> {
    const session = this.session;
    if (i >= this.sentences.length) {
      this.finish();
      return;
    }
    this.index = i;
    this.events.onProgress(i, this.sentences.length);
    const sentence = this.sentences[i];
    this.currentWord = -1;
    this.highlighter.setWord(null);
    this.highlighter.setSentence(this.settings.sentenceHighlight ? sentence.span : null);
    if (this.settings.autoScroll) this.scrollTo(sentence.span);

    let synthesis: Synthesis;
    const pending = this.synth(i);
    this.prefetch(i + 1);
    if (this.state !== 'paused') this.setState('loading', i === 0 ? 'Summoning the voice…' : undefined);
    try {
      synthesis = await pending;
    } catch (e) {
      if (session !== this.session || (e as { cancelled?: boolean }).cancelled) return;
      this.events.onError(`Speech failed: ${(e as Error).message}`);
      this.stop();
      return;
    }
    this.cache.delete(i - 1);
    if (session !== this.session) return;
    if (this.state === 'paused') return; // resume() will call playIndex again

    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = synthesis.buffer(ctx);
    source.connect(this.gain!);
    this.words = synthesis.words;
    this.startedAt = ctx.currentTime + 0.03;
    source.onended = () => {
      if (this.source !== source || session !== this.session) return;
      this.source = null;
      void this.playIndex(i + 1);
    };
    this.stopSource();
    this.source = source;
    source.start(this.startedAt);
    this.setState('playing');
    this.tick();
  }

  private tick = (): void => {
    cancelAnimationFrame(this.raf);
    if (this.state !== 'playing' || !this.ctx) return;
    if (this.settings.wordHighlight) {
      const t = this.ctx.currentTime - this.startedAt;
      // Last word that has started; it stays lit through the pause that follows it.
      let w = -1;
      for (let k = 0; k < this.words.length; k++) {
        if (this.words[k][0] <= t) w = k;
        else break;
      }
      if (w !== this.currentWord) {
        this.currentWord = w;
        const span = w >= 0 ? this.sentences[this.index].words[w].highlight : null;
        this.highlighter.setWord(span);
        if (span && this.settings.autoScroll) this.scrollTo(span);
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.session = '';
    this.highlighter.clear();
    this.selection.restore();
    this.fromSelection = false;
    this.setState('idle');
    this.prepare(); // ready for the next play
  }

  private stopSource(): void {
    if (!this.source) return;
    const s = this.source;
    this.source = null;
    s.onended = null;
    try {
      s.stop();
    } catch {
      // not started yet
    }
    s.disconnect();
  }

  private scrollTo(span: Span): void {
    const rect = toRange(span).getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    const top = 60;
    const bottom = window.innerHeight - this.bottomInset() - 40;
    if (rect.top >= top && rect.bottom <= bottom) return;
    // Bring nested scroll containers along, then place the text in the upper third.
    span.start.node.parentElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    const fresh = toRange(span).getBoundingClientRect();
    window.scrollBy({ top: fresh.top - window.innerHeight / 3, behavior: 'smooth' });
  }

  private setState(state: PlayerState, detail?: string): void {
    this.state = state;
    const reading = this.fromSelection ? 'Reading selection' : 'Reading page';
    this.events.onState(state, detail ?? (state === 'playing' ? reading : undefined));
  }
}
