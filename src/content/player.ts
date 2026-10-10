// Playback controller. Text is synthesised in chunks of whole sentences (never crossing
// a paragraph): larger chunks give the model more context and noticeably better
// intonation, so after a start or seek the chunk size ramps up from one sentence (fast
// first sound) to a full token budget. Each chunk plays as one continuous audio source
// in the page's AudioContext; the current sentence and word are derived from the audio
// clock, so highlights follow the exact timings reported by the model.
import type { Settings } from '../shared/settings';
import { findArticleRoots } from './article';
import type { EngineClient, Synthesis } from './engine-client';
import { Highlighter } from './highlight';
import { collectSentences, toRange, type Sentence, type Span } from './segment';
import { SelectionKeeper, selectionRange } from './selection';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlayerEvents {
  onState(state: PlayerState, detail?: string): void;
  /** Sentence index changed (for the "3 / 42" counter). */
  onProgress(index: number, total: number): void;
  /** Reading position as a fraction 0–1 (character-weighted); updated every frame. */
  onPosition(fraction: number): void;
  onError(message: string): void;
}

/**
 * Rewind restarts the current sentence (Back: the current paragraph) unless it started
 * less than this long ago, in which case it goes to the previous one.
 */
const REWIND_THRESHOLD = 2;
/** Pre-generated opening chunks kept around (page: first two chunks; recent selections). */
const MAX_PREPARED = 4;
/** Token budget per request: WebGPU is ~7× real time, the WASM fallback only ~2×. */
const BUDGET = { webgpu: 500, wasm: 250 };
/** Silence inserted after a paragraph and after a heading. */
const PARAGRAPH_PAUSE = 0.4;
const HEADING_PAUSE = 0.6;

/**
 * Chunk sizes ramp up after a start or seek: first a single sentence (sound within
 * ~1 s), then each chunk at most GROWTH × the tokens of the one playing, so it can be
 * synthesised before that one ends (WebGPU runs ~7× real time, WASM ~2.2×), up to BUDGET.
 */
const GROWTH = { webgpu: 4, wasm: 1.6 };
const MIN_GROWN_BUDGET = 60;
/** Budget meaning "a single sentence". */
const ONE_SENTENCE = 0;

function sentenceChars(s: Sentence): number {
  return s.words.reduce((n, w) => n + w.text.length + 1, 0);
}

/** Phoneme tokens are roughly one per character of English text. */
const estimateTokens = (s: Sentence) => Math.ceil(sentenceChars(s) * 1.05);

/** A chunk's audio split at its sentence boundaries. */
interface ChunkAudio {
  synthesis: Synthesis;
  buffer?: AudioBuffer;
  /** Start time of each sentence within the chunk audio, plus the total length. */
  bounds: number[];
  /** Word timings per sentence, relative to that sentence's start. */
  words: [number, number][][];
}

interface Chunk {
  start: number;
  /** Exclusive. */
  end: number;
  /** Estimated token count (for sizing the next chunk). */
  tokens: number;
  audio: Promise<ChunkAudio>;
  ready: boolean;
}

function splitChunk(synthesis: Synthesis, counts: number[]): ChunkAudio {
  const bounds: number[] = [];
  const words: [number, number][][] = [];
  let w = 0;
  for (const n of counts) {
    // A sentence starts where its first word starts (the first one at 0, so leading
    // silence belongs to it); the previous sentence's trailing pause stays with it.
    const start = bounds.length === 0 ? 0 : synthesis.words[w][0];
    bounds.push(start);
    words.push(synthesis.words.slice(w, w + n).map(([s, e]) => [s - start, e - start]));
    w += n;
  }
  bounds.push(synthesis.duration);
  return { synthesis, bounds, words };
}

export class Player {
  state: PlayerState = 'idle';
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private sentences: Sentence[] = [];
  private index = 0;
  /** Identifies the current reading; empty when idle. */
  private session = '';
  /** Engine session for requests; renewed on seeks so stale queued requests can be dropped. */
  private epoch = '';
  private chunks = new Map<number, Chunk>();
  /** The chunk whose audio is playing (or paused mid-way). */
  private playing: { chunk: Chunk; audio: ChunkAudio; from: number } | null = null;
  /** AudioContext time corresponding to t = 0 of the playing chunk. */
  private chunkStartedAt = 0;
  private device: keyof typeof BUDGET = 'webgpu';
  private currentWord = -1;
  private raf = 0;
  private highlighter = new Highlighter();
  private selection = new SelectionKeeper();
  /** True when the current reading was started from a user selection. */
  private fromSelection = false;
  /** Opening chunks synthesised ahead of time, keyed by their text, voice and speed. */
  private prepared = new Map<string, { session: string; synthesis: Promise<Synthesis> }>();
  private prepareTimer = 0;
  /** Incremented on every playFrom call so superseded (awaiting) calls can bail out. */
  private playSeq = 0;
  /** Audio length of each sentence synthesised in this reading (for Back's 2 s rule). */
  private durations = new Map<number, number>();
  /**
   * Progress weights: characters before each sentence (prefix sums) and in total.
   * Characters track speaking time much better than word counts do.
   */
  private charOffsets: number[] = [];
  private totalChars = 0;

  constructor(
    private engine: EngineClient,
    private settings: Settings,
    private events: PlayerEvents,
    private bottomInset: () => number,
  ) {
    document.addEventListener('selectionchange', this.onSelectionChange);
  }

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

  /** True while there is a reading to move within (playing, loading or paused). */
  get active(): boolean {
    return Boolean(this.session) && this.state !== 'idle';
  }

  /**
   * Back: go to the start of the current paragraph, or to the start of the previous
   * paragraph when less than REWIND_THRESHOLD seconds of this one have been played.
   */
  back(): void {
    if (!this.active) return;
    const start = this.paragraphStart(this.index);
    // Audio position within the paragraph: earlier sentences + time into this one.
    // Unknown lengths (sentences jumped over) count as past the threshold.
    let position = this.elapsed();
    for (let k = start; k < this.index; k++) position += this.durations.get(k) ?? REWIND_THRESHOLD;
    this.seek(position > REWIND_THRESHOLD || start === 0 ? start : this.paragraphStart(start - 1));
  }

  /**
   * Seek to the start of the sentence at this fraction of the progress bar.
   * With `onlyIfChanged`, staying within the current sentence does nothing (live scrubbing).
   */
  seekToFraction(fraction: number, onlyIfChanged = false): void {
    if (!this.active) return;
    const target = fraction * this.totalChars;
    let i = 0;
    while (i + 1 < this.charOffsets.length && this.charOffsets[i + 1] <= target) i++;
    if (onlyIfChanged && i === this.index) return;
    this.seek(i);
  }

  /** Skip: jump to the start of the next paragraph (finishing after the last one). */
  skip(): void {
    if (!this.active) return;
    const current = this.sentences[this.index].paragraph;
    const next = this.sentences.findIndex((s, k) => k > this.index && s.paragraph !== current);
    if (next < 0) {
      this.stop();
      this.prepare();
      return;
    }
    this.seek(next);
  }

  /**
   * Rewind: restart the current sentence, or go to the previous one when the current
   * sentence started less than REWIND_THRESHOLD seconds ago.
   */
  rewind(): void {
    if (!this.active) return;
    this.seek(this.elapsed() > REWIND_THRESHOLD ? this.index : this.index - 1);
  }

  /** Forward: jump to the start of the next sentence (finishing after the last one). */
  forward(): void {
    if (!this.active) return;
    if (this.index + 1 >= this.sentences.length) {
      this.stop();
      this.prepare();
      return;
    }
    this.seek(this.index + 1);
  }

  stop(): void {
    if (this.epoch) this.engine.cancel(this.epoch);
    this.session = '';
    this.epoch = '';
    this.stopSource();
    cancelAnimationFrame(this.raf);
    this.chunks.clear();
    this.highlighter.clear();
    this.selection.restore();
    this.setState('idle');
  }

  /**
   * Synthesise the opening of what play would read next — the current selection's
   * first sentence, or a full first chunk of the page — so that pressing play starts
   * immediately (this also loads the model). Called when the bar appears, when the
   * selection changes, and whenever the player becomes idle again.
   */
  prepare(delay = 300): void {
    clearTimeout(this.prepareTimer);
    // Debounced: lets the page finish rendering and selections settle while dragging.
    this.prepareTimer = window.setTimeout(() => this.prepareNow(), delay);
  }

  dispose(): void {
    document.removeEventListener('selectionchange', this.onSelectionChange);
    clearTimeout(this.prepareTimer);
    this.clearPrepared();
    this.stop();
    this.highlighter.dispose();
    void this.ctx?.close();
    this.ctx = null;
  }

  updateSettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    if (this.gain) this.gain.gain.value = next.volume;
    const voiceChanged = next.voice !== prev.voice || next.speed !== prev.speed;
    if (voiceChanged) {
      this.clearPrepared();
      if (this.active) {
        // Regenerate from the current sentence right away rather than finishing a
        // chunk (up to ~25 s) in the old voice.
        this.newEpoch(true);
        this.stopSource();
        cancelAnimationFrame(this.raf);
        if (this.state !== 'paused') void this.playFrom(this.index, ONE_SENTENCE);
      }
    }
    if (voiceChanged || next.articleMode !== prev.articleMode) {
      this.prepare(); // what was prepared no longer matches
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
    const sentences = sel ? this.collectSelection(sel) : this.collectPage();
    if (!sentences.length) {
      this.selection.restore();
      this.events.onError(sel ? 'No readable text in the selection.' : 'No readable text found on this page.');
      return;
    }
    // Hide the selection while reading; it is restored on pause / stop / finish.
    this.selection.hide();
    this.sentences = sentences;
    this.durations.clear();
    this.charOffsets = [];
    this.totalChars = 0;
    for (const s of sentences) {
      this.charOffsets.push(this.totalChars);
      this.totalChars += sentenceChars(s);
    }
    this.session = Math.random().toString(36).slice(2);
    this.epoch = `${this.session}-0`;
    void this.playFrom(0, ONE_SENTENCE);
  }

  private lang(): string {
    return document.documentElement.lang || navigator.language || 'en';
  }

  private collectPage(): Sentence[] {
    const roots = (this.settings.articleMode && findArticleRoots()) || [document.body];
    return collectSentences(roots, { articleMode: this.settings.articleMode, lang: this.lang() });
  }

  private collectSelection(sel: Range): Sentence[] {
    return collectSentences([sel.commonAncestorContainer], { clamp: sel, articleMode: false, lang: this.lang() });
  }

  private onSelectionChange = (): void => {
    // Only for real selections (not caret moves while typing), and only when play
    // would start a new reading (idle, or paused with a new selection).
    if ((this.state === 'idle' || this.state === 'paused') && selectionRange()) this.prepare(400);
  };

  // ---- chunk planning ---------------------------------------------------------

  /** Token budget for the chunk that follows `chunk`. */
  private nextBudget(chunk: Chunk): number {
    const full = BUDGET[this.device];
    return Math.min(full, Math.max(MIN_GROWN_BUDGET, chunk.tokens * GROWTH[this.device]));
  }

  /**
   * End (exclusive) of a chunk starting at `start`: whole sentences within one
   * paragraph, as many as fit `budget` tokens (always at least one).
   */
  private planEnd(sentences: Sentence[], start: number, budget: number): number {
    const paragraph = sentences[start].paragraph;
    let end = start + 1;
    let tokens = estimateTokens(sentences[start]);
    while (
      end < sentences.length &&
      sentences[end].paragraph === paragraph &&
      tokens + estimateTokens(sentences[end]) <= budget
    ) {
      tokens += estimateTokens(sentences[end]);
      end++;
    }
    return end;
  }

  /** Identifies a chunk's synthesis: its sentences' words, voice and speed. */
  private chunkKey(sentences: Sentence[], start: number, end: number): string {
    const text = sentences
      .slice(start, end)
      .map((s) => s.words.map((w) => w.text).join(' '))
      .join('\n');
    return `${this.settings.voice}|${this.settings.speed}|${text}`;
  }

  private chunkWords(sentences: Sentence[], start: number, end: number): string[] {
    return sentences.slice(start, end).flatMap((s) => s.words.map((w) => w.text));
  }

  private findChunk(i: number): Chunk | undefined {
    for (const c of this.chunks.values()) if (c.start <= i && i < c.end) return c;
    return undefined;
  }

  /** The chunk containing sentence i, creating (and synthesising) it if needed. */
  private chunkAt(i: number, budget: number): Chunk {
    const existing = this.findChunk(i);
    if (existing) return existing;

    // A prepared opening (a full page chunk or a selection's first sentence) wins. It
    // may have been planned before the device (and so the budget) was known.
    let end = -1;
    let synthesis: Promise<Synthesis> | undefined;
    for (const b of new Set([BUDGET[this.device], BUDGET.webgpu, BUDGET.wasm, budget, ONE_SENTENCE])) {
      const e = this.planEnd(this.sentences, i, b);
      const key = this.chunkKey(this.sentences, i, e);
      const prep = this.prepared.get(key);
      if (prep) {
        this.prepared.delete(key);
        [end, synthesis] = [e, prep.synthesis];
        break;
      }
    }
    if (!synthesis) {
      end = this.planEnd(this.sentences, i, budget);
      synthesis = this.engine.synthesize(
        this.epoch,
        this.chunkWords(this.sentences, i, end),
        this.settings.voice,
        this.settings.speed,
      );
    }

    const counts = this.sentences.slice(i, end).map((s) => s.words.length);
    const chunk: Chunk = {
      start: i,
      end,
      tokens: this.sentences.slice(i, end).reduce((n, s) => n + estimateTokens(s), 0),
      ready: false,
      audio: synthesis.then((syn) => {
        if (syn.device === 'wasm' || syn.device === 'webgpu') this.device = syn.device;
        const audio = splitChunk(syn, counts);
        audio.bounds.slice(0, -1).forEach((b, k) => this.durations.set(i + k, audio.bounds[k + 1] - b));
        chunk.ready = true;
        // Request the following chunk straight away (rather than when this one starts
        // playing) for extra headroom — but stay at most two chunks ahead of playback.
        const current = this.playing?.chunk;
        const nearPlayback = !current || chunk === current || chunk.start === current.end;
        if (this.chunks.get(i) === chunk && nearPlayback && end < this.sentences.length) {
          this.chunkAt(end, this.nextBudget(chunk));
        }
        return audio;
      }),
    };
    chunk.audio.catch(() => {
      if (this.chunks.get(i) === chunk) this.chunks.delete(i);
    });
    this.chunks.set(i, chunk);
    return chunk;
  }

  /**
   * Start a fresh engine session: queued requests of the old one are dropped, and
   * chunks that are not ready yet are forgotten (`all` forgets ready ones too).
   */
  private newEpoch(all = false): void {
    this.engine.cancel(this.epoch);
    this.epoch = `${this.session}-${Math.random().toString(36).slice(2, 8)}`;
    for (const [k, c] of this.chunks) if (all || !c.ready) this.chunks.delete(k);
    if (all) this.playing = null;
  }

  /** Keep only the chunk before, the current one and those after it (memory). */
  private evictChunks(current: Chunk): void {
    for (const [k, c] of this.chunks) {
      if (c !== current && c.end !== current.start && c.start < current.start) this.chunks.delete(k);
    }
  }

  // ---- preparation --------------------------------------------------------------

  private prepareNow(): void {
    if (this.state === 'playing' || this.state === 'loading') return;
    const sel = selectionRange();
    let sentences: Sentence[] = [];
    let budget = BUDGET[this.device];
    if (sel && (this.state === 'idle' || this.selection.hasNewSelection())) {
      // Selections are played soon after they are made: keep it to one quick sentence.
      sentences = this.collectSelection(sel);
      budget = ONE_SENTENCE;
    } else if (this.state === 'idle') {
      // The bar is usually open for a while before play: afford a full chunk.
      sentences = this.collectPage();
    }
    if (!sentences.length) return; // paused without a new selection: play resumes instead

    const end = this.planEnd(sentences, 0, budget);
    this.prepareChunk(sentences, 0, end);
    // For the page there is time to spare: also prepare the second chunk, so a short
    // opening (such as a heading) is not followed by a wait.
    if (budget !== ONE_SENTENCE && end < sentences.length) {
      this.prepareChunk(sentences, end, this.planEnd(sentences, end, BUDGET[this.device]));
    }
  }

  private prepareChunk(sentences: Sentence[], start: number, end: number): void {
    const key = this.chunkKey(sentences, start, end);
    const existing = this.prepared.get(key);
    if (existing) {
      // Mark as most recently used.
      this.prepared.delete(key);
      this.prepared.set(key, existing);
      return;
    }
    const session = `prepare-${Math.random().toString(36).slice(2)}`;
    const synthesis = this.engine.synthesize(
      session,
      this.chunkWords(sentences, start, end),
      this.settings.voice,
      this.settings.speed,
    );
    synthesis.catch(() => {
      if (this.prepared.get(key)?.synthesis === synthesis) this.prepared.delete(key);
    });
    this.prepared.set(key, { session, synthesis });
    while (this.prepared.size > MAX_PREPARED) {
      const [oldKey, old] = this.prepared.entries().next().value!;
      this.engine.cancel(old.session); // drops it if still queued
      this.prepared.delete(oldKey);
    }
  }

  private clearPrepared(): void {
    for (const { session } of this.prepared.values()) this.engine.cancel(session);
    this.prepared.clear();
  }

  // ---- playback -------------------------------------------------------------------

  /** Seconds played of the current sentence (0 if it hasn't started). */
  private elapsed(): number {
    if (!this.source || !this.ctx || !this.playing) return 0;
    const k = this.index - this.playing.chunk.start;
    return Math.max(0, this.ctx.currentTime - this.chunkStartedAt - this.playing.audio.bounds[k]);
  }

  private paragraphStart(i: number): number {
    const p = this.sentences[i].paragraph;
    while (i > 0 && this.sentences[i - 1].paragraph === p) i--;
    return i;
  }

  private seek(i: number): void {
    if (!this.active) return;
    i = Math.max(0, Math.min(i, this.sentences.length - 1));
    this.stopSource();
    cancelAnimationFrame(this.raf);
    // Jumps inside an existing chunk are instant; elsewhere a new chunk is needed and
    // queued look-ahead for the old position is dropped.
    if (!this.findChunk(i)) this.newEpoch();
    if (this.state === 'paused') {
      // Stay paused at the new position; resume() starts it. Synthesise meanwhile.
      this.playSeq++;
      this.showSentence(i);
      this.chunkAt(i, ONE_SENTENCE);
      return;
    }
    void this.playFrom(i, ONE_SENTENCE);
  }

  /** Move the position marker (progress, highlight, scroll) to sentence i. */
  private showSentence(i: number): void {
    this.index = i;
    this.events.onProgress(i, this.sentences.length);
    this.events.onPosition(this.charOffsets[i] / Math.max(this.totalChars, 1));
    const sentence = this.sentences[i];
    this.currentWord = -1;
    this.highlighter.setWord(null);
    this.highlighter.setSentence(this.settings.sentenceHighlight ? sentence.span : null);
    if (this.settings.autoScroll) this.scrollTo(sentence.span);
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
      // Paused before the audio started (still synthesising, or moved while paused).
      // Leave the paused state first, or playFrom would treat us as still paused.
      this.setState('loading');
      void this.playFrom(this.index, ONE_SENTENCE);
    }
  }

  /** Pause before sentence i when reached by natural progression. */
  private pauseBefore(i: number): number {
    if (i === 0) return 0;
    const prev = this.sentences[i - 1];
    if (prev.heading && !this.sentences[i].heading) return HEADING_PAUSE;
    return prev.paragraph !== this.sentences[i].paragraph ? PARAGRAPH_PAUSE : 0;
  }

  private async playFrom(i: number, budget: number, natural = false): Promise<void> {
    const session = this.session;
    const seq = ++this.playSeq;
    if (i >= this.sentences.length) {
      this.finish();
      return;
    }
    this.showSentence(i);
    const chunk = this.chunkAt(i, budget);
    if (this.state !== 'paused' && !chunk.ready) {
      this.setState('loading', i === 0 ? 'Summoning the voice…' : undefined);
    }
    let audio: ChunkAudio;
    try {
      audio = await chunk.audio;
    } catch (e) {
      if (session !== this.session || seq !== this.playSeq || (e as { cancelled?: boolean }).cancelled) return;
      this.events.onError(`Speech failed: ${(e as Error).message}`);
      this.stop();
      return;
    }
    if (session !== this.session || seq !== this.playSeq) return; // superseded by a seek
    if (this.state === 'paused') return; // resume() will call playFrom again

    // Synthesise the next chunk while this one plays.
    if (chunk.end < this.sentences.length) this.chunkAt(chunk.end, this.nextBudget(chunk));
    this.evictChunks(chunk);

    const ctx = this.ctx!;
    audio.buffer ??= audio.synthesis.buffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = audio.buffer;
    source.connect(this.gain!);
    const offset = audio.bounds[i - chunk.start];
    const when = ctx.currentTime + 0.03 + (natural ? this.pauseBefore(i) : 0);
    this.chunkStartedAt = when - offset;
    this.playing = { chunk, audio, from: i - chunk.start };
    source.onended = () => {
      if (this.source !== source || session !== this.session) return;
      this.source = null;
      void this.playFrom(chunk.end, this.nextBudget(chunk), true);
    };
    this.stopSource();
    this.source = source;
    source.start(when, offset);
    this.setState('playing');
    this.tick();
  }

  private tick = (): void => {
    cancelAnimationFrame(this.raf);
    if (this.state !== 'playing' || !this.ctx || !this.playing) return;
    const { chunk, audio, from } = this.playing;
    const tc = this.ctx.currentTime - this.chunkStartedAt;

    // Current sentence within the chunk, from the audio clock (never before the sentence
    // playback started at, which matters during the few ms before the source starts).
    let k = from;
    while (k + 1 < audio.words.length && audio.bounds[k + 1] <= tc) k++;
    if (chunk.start + k !== this.index) this.showSentence(chunk.start + k);

    const t = tc - audio.bounds[k];
    const words = audio.words[k];
    // Last word that has started; it stays lit through the pause that follows it.
    let w = -1;
    for (let j = 0; j < words.length; j++) {
      if (words[j][0] <= t) w = j;
      else break;
    }

    // Constant speed through each sentence's audio (following individual word timings
    // looks jerky), arriving at the sentence's end exactly when its audio ends.
    const duration = audio.bounds[k + 1] - audio.bounds[k];
    const through = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
    const chars = sentenceChars(this.sentences[this.index]);
    this.events.onPosition((this.charOffsets[this.index] + chars * through) / Math.max(this.totalChars, 1));

    if (this.settings.wordHighlight && w !== this.currentWord) {
      this.currentWord = w;
      const span = w >= 0 ? this.sentences[this.index].words[w].highlight : null;
      this.highlighter.setWord(span);
      if (span && this.settings.autoScroll) this.scrollTo(span);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.session = '';
    this.epoch = '';
    this.playing = null;
    this.chunks.clear();
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
