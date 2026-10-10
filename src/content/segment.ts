// Turns page content into sentences and words that point back into the live DOM.
// Nothing in the page is modified: positions are stored as (text node, offset)
// pairs and turned into Ranges only when they need to be highlighted.

export interface Pos {
  node: Text;
  offset: number;
}

export interface Span {
  start: Pos;
  end: Pos;
}

export interface Word {
  /** Text sent to the TTS engine (word with attached punctuation). */
  text: string;
  /** Part of the word to highlight (punctuation trimmed); null for pure punctuation. */
  highlight: Span | null;
}

export interface Sentence {
  span: Span;
  words: Word[];
}

export function toRange(span: Span): Range {
  const r = document.createRange();
  r.setStart(span.start.node, span.start.offset);
  r.setEnd(span.end.node, span.end.offset);
  return r;
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'INPUT',
  'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'NARRATOR-OF-MORDOR',
]);

/** Never read aloud: screen-reader-only text and footnote markers such as "[12]". */
const ALWAYS_SKIP = [
  '.sr-only', '.visually-hidden', '.screen-reader-text', '.mw-editsection',
  'sup:has(> a[href^="#"])', 'sup.reference',
].join(', ');

/** Extra elements skipped (inside the article root) when reading the main article. */
const ARTICLE_SKIP = [
  'nav', 'aside', 'footer', 'button', 'table', 'figure', 'form[role="search"]',
  '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]', '[role="note"]',
  // Wikipedia / MediaWiki furniture
  '.hatnote', '.infobox', '.navbox', '.metadata', '.toc', '#toc', '.reflist', '.references', '.thumb',
].join(', ');

const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby', 'ruby-text']);

interface Run {
  text: string;
  /** String offset → DOM position mapping, one entry per contributing text node. */
  parts: { start: number; node: Text; nodeOffset: number; length: number }[];
}

export interface CollectOptions {
  /** Restrict reading to this range (the user's selection). */
  clamp?: Range;
  articleMode: boolean;
  lang: string;
}

export function collectSentences(roots: Node[], opts: CollectOptions): Sentence[] {
  const runs = collectRuns(roots, opts);
  const sentences: Sentence[] = [];
  const segmenter = new Intl.Segmenter(opts.lang, { granularity: 'sentence' });
  for (const run of runs) {
    let pending: { start: number; end: number } | null = null;
    const flush = (seg: { start: number; end: number }) => {
      const s = buildSentence(run, seg.start, seg.end);
      if (s) sentences.push(s);
    };
    for (const seg of segmenter.segment(run.text)) {
      const start = seg.index;
      const end = seg.index + seg.segment.length;
      const merged: { start: number; end: number } = { start: pending ? pending.start : start, end };
      // Intl.Segmenter splits after abbreviations such as "Mr." — glue those back.
      if (endsWithAbbreviation(run.text.slice(merged.start, merged.end))) {
        pending = merged;
        continue;
      }
      pending = null;
      flush(merged);
    }
    if (pending) flush(pending);
  }
  return sentences;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig',
  'inc', 'ltd', 'co', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

function endsWithAbbreviation(text: string): boolean {
  const m = /(?:^|\s)\(?([A-Za-z](?:\.?[A-Za-z])*)\.\s*$/.exec(text);
  if (!m) return false;
  const word = m[1].toLowerCase();
  return ABBREVIATIONS.has(word) || /^[a-z]$/.test(word); // single initials: "J. R. R. Tolkien"
}

function buildSentence(run: Run, start: number, end: number): Sentence | null {
  const text = run.text.slice(start, end);
  if (!/[\p{L}\p{N}]/u.test(text)) return null;

  const words: Word[] = [];
  let first = -1;
  let last = -1;
  for (const m of text.matchAll(/\S+/g)) {
    const wStart = start + (m.index ?? 0);
    const wEnd = wStart + m[0].length;
    if (first < 0) first = wStart;
    last = wEnd;
    // Highlight from the first to the last letter/digit of the chunk.
    const inner = /[\p{L}\p{N}](?:.*[\p{L}\p{N}])?/u.exec(m[0]);
    const highlight = inner
      ? span(run, wStart + (inner.index ?? 0), wStart + (inner.index ?? 0) + inner[0].length)
      : null;
    words.push({ text: m[0], highlight });
  }
  if (first < 0) return null;
  return { span: span(run, first, last), words };
}

function span(run: Run, start: number, end: number): Span {
  return { start: locate(run, start, false), end: locate(run, end, true) };
}

/** Map a string offset back to a DOM position. `isEnd` prefers the earlier node at boundaries. */
function locate(run: Run, index: number, isEnd: boolean): Pos {
  const parts = run.parts;
  let lo = 0;
  let hi = parts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const p = parts[mid];
    if (p.start < index || (!isEnd && p.start === index)) lo = mid;
    else hi = mid - 1;
  }
  const p = parts[lo];
  const within = Math.max(0, Math.min(p.length, index - p.start));
  return { node: p.node, offset: p.nodeOffset + within };
}

function collectRuns(roots: Node[], opts: CollectOptions): Run[] {
  const runs: Run[] = [];
  const blockOf = new Map<Element, Element>();
  const skipCache = new Map<Element, boolean>();
  let current: Run | null = null;
  let currentBlock: Element | null = null;

  const rootSet = new Set(roots);
  const isSkipped = (el: Element): boolean => {
    let cached = skipCache.get(el);
    if (cached !== undefined) return cached;
    const isRoot = rootSet.has(el);
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.getAttribute('aria-hidden') === 'true' || (el as HTMLElement).hidden) {
      cached = true;
    } else if (el.matches(ALWAYS_SKIP) || (opts.articleMode && !isRoot && el.matches(ARTICLE_SKIP))) {
      cached = true;
    } else if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) {
      cached = true;
    } else {
      // Article-only rules apply inside the root, never to its ancestors (the article
      // may legitimately live inside a <table> layout or similar).
      cached = !isRoot && el.parentElement ? isSkipped(el.parentElement) : false;
    }
    skipCache.set(el, cached);
    return cached;
  };

  const findBlock = (el: Element): Element => {
    const hit = blockOf.get(el);
    if (hit) return hit;
    const display = getComputedStyle(el).display;
    const block = INLINE_DISPLAYS.has(display) && el.parentElement ? findBlock(el.parentElement) : el;
    blockOf.set(el, block);
    return block;
  };

  const endRun = () => {
    if (current && /\S/.test(current.text)) runs.push(current);
    current = null;
    currentBlock = null;
  };

  const addText = (text: Text) => {
    const parent = text.parentElement;
    if (!parent || isSkipped(parent)) return;

    let startOffset = 0;
    let endOffset = text.data.length;
    if (opts.clamp) {
      if (!opts.clamp.intersectsNode(text)) return;
      if (text === opts.clamp.startContainer) startOffset = opts.clamp.startOffset;
      if (text === opts.clamp.endContainer) endOffset = opts.clamp.endOffset;
      if (endOffset <= startOffset) return;
    }

    const block = findBlock(parent);
    if (block !== currentBlock) {
      endRun();
      current = { text: '', parts: [] };
      currentBlock = block;
    }
    const run = current!;
    run.parts.push({ start: run.text.length, node: text, nodeOffset: startOffset, length: endOffset - startOffset });
    run.text += text.data.slice(startOffset, endOffset);
  };

  for (const root of roots) {
    if (root.nodeType === Node.TEXT_NODE) {
      addText(root as Text);
      endRun();
      continue;
    }
    if (root.nodeType === Node.ELEMENT_NODE && isSkipped(root as Element)) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && isSkipped(node as Element)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) addText(node as Text);
      else if ((node as Element).tagName === 'BR' && current) (current as Run).text += '\n';
    }
    endRun();
  }
  return runs;
}
