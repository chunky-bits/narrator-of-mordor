// Renders A/B listening samples of different narration strategies into samples/.
//   npx tsx scripts/make-samples.ts
// Then open samples/index.html to compare them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KokoroEngine, SAMPLE_RATE } from '../src/engines/kokoro/model';
import { phonemizeChunk } from '../src/engines/kokoro/phonemize';

const ROOT = join(import.meta.dirname, '..');
const MODELS = join(ROOT, 'public', 'models');
const OUT = join(ROOT, 'samples');

// Original test passage. "# " marks a heading, *word* marks author emphasis (<em>).
// Paragraph 2 is deliberately long (> 500 tokens) so the token budgets differ.
const PASSAGE = `# The Road to the Black Gate

The company left the river at dawn, and for a long while nobody spoke. Mist clung to the reeds, and the only sounds were the creak of packs and the soft tread of boots on wet stone. By midmorning the land had begun to change: the grass grew thin and grey, the trees stood bare, and a bitter smell drifted in on the wind. Was this really the way? Frodo asked himself that question a dozen times, and each time the answer was the same. There was no other road. Somewhere ahead, beyond the broken hills, the mountains were waiting, and in their shadow stood the gate that no traveller had passed in a hundred years. He tightened the straps of his pack and kept walking, one step and then another, because stopping would have been worse.

Sam caught up with him at the top of the ridge. "You did *not* come all this way to turn back now," he said, still out of breath. "And I'm *not* letting you go on alone!" Frodo laughed, for the first time in days.

They walked on together. The light was fading, but the path ahead was clear.`;

interface Word {
  text: string;
  em: boolean;
}
interface Sentence {
  words: Word[];
  paragraph: number;
  heading: boolean;
}

function parse(passage: string): Sentence[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: Sentence[] = [];
  passage.split(/\n\s*\n/).forEach((block, paragraph) => {
    const heading = block.startsWith('# ');
    const text = heading ? block.slice(2) : block;
    for (const { segment } of seg.segment(text)) {
      const words = segment
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ text: w.replace(/\*/g, ''), em: /\*/.test(w) }));
      if (words.length) out.push({ words, paragraph, heading });
    }
  });
  return out;
}

async function tokenCount(s: Sentence): Promise<number> {
  let n = 0;
  for (const w of s.words) n += (await phonemizeChunk(w.text, 'a')).length + 1;
  return n;
}

interface Variant {
  file: string;
  title: string;
  description: string;
  /** Split sentences into model requests. */
  chunk: (sentences: Sentence[], tokens: number[]) => Sentence[][];
  paragraphPauses: boolean;
  emphasis?: boolean;
  reduce?: boolean;
  /** Phonemise whole requests at once (contextual stress, but no per-word timing). */
  wholeText?: boolean;
  voice?: string;
}

const perSentence = (s: Sentence[]) => s.map((x) => [x]);

/** Up to `max` sentences per request, never crossing a paragraph. */
const bySentenceCount = (max: number) => (s: Sentence[]) => {
  const out: Sentence[][] = [];
  for (const x of s) {
    const last = out.at(-1);
    if (last && last.length < max && last[0].paragraph === x.paragraph) last.push(x);
    else out.push([x]);
  }
  return out;
};

/** Pack whole sentences up to `budget` tokens per request, never crossing a paragraph. */
const byTokens = (budget: number) => (s: Sentence[], tokens: number[]) => {
  const out: Sentence[][] = [];
  let used = 0;
  s.forEach((x, i) => {
    const last = out.at(-1);
    if (last && last[0].paragraph === x.paragraph && used + tokens[i] <= budget) {
      last.push(x);
      used += tokens[i];
    } else {
      out.push([x]);
      used = tokens[i];
    }
  });
  return out;
};

const VARIANTS: Variant[] = [
  { file: 'A-current.wav', title: 'A — Current (reference)', description: 'One sentence per request, the same short gap between every sentence, every word fully stressed.', chunk: perSentence, paragraphPauses: false },
  { file: 'F1-sentence.wav', title: 'F1 — Natural function words, 1 sentence per request', description: 'Unstressed “the, a, to, for, of, and…”, paragraph/heading pauses, one sentence per request.', chunk: perSentence, paragraphPauses: true, reduce: true },
  { file: 'F-unstressed.wav', title: 'F — Natural function words, 3 sentences per request', description: 'As F1, with up to three sentences of a paragraph per request.', chunk: bySentenceCount(3), paragraphPauses: true, reduce: true },
  { file: 'FT100.wav', title: 'F-T100 — 100-token requests', description: 'As F1, packing whole sentences into requests of at most 100 tokens.', chunk: byTokens(100), paragraphPauses: true, reduce: true },
  { file: 'FT250.wav', title: 'F-T250 — 250-token requests', description: 'As F1, packing whole sentences into requests of at most 250 tokens.', chunk: byTokens(250), paragraphPauses: true, reduce: true },
  { file: 'FT500.wav', title: 'F-T500 — 500-token requests', description: 'As F1, packing whole sentences into requests of at most 500 tokens (whole paragraphs where they fit).', chunk: byTokens(500), paragraphPauses: true, reduce: true },
  { file: 'G-whole-sentence.wav', title: 'G — Reference: whole-sentence phonemes', description: 'Each request (3 sentences) phonemised as one text, as kokoro-js does. Natural stress but no exact per-word timing — for comparison only.', chunk: bySentenceCount(3), paragraphPauses: true, wholeText: true },
  { file: 'D-emphasis.wav', title: 'D — F plus emphasis', description: 'F, plus stress on words the author emphasised (the italic “not”s in paragraph 3).', chunk: bySentenceCount(3), paragraphPauses: true, reduce: true, emphasis: true },
];

function wav(samples: Float32Array): Buffer {
  const pcm = new Int16Array(samples.length);
  samples.forEach((s, i) => (pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.byteLength, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer)]);
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE));

const engine = await KokoroEngine.load({
  modelRoot: MODELS + '/',
  modelId: 'kokoro',
  device: 'cpu',
  dtype: 'fp32',
  readFile: async (p) => {
    const b = await readFile(join(MODELS, 'kokoro', p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
});
await engine.blendVoices('af_heart_bella', [['af_heart', 0.7], ['af_bella', 0.3]]);

const sentences = parse(PASSAGE);
const tokens = await Promise.all(sentences.map(tokenCount));
console.log(`passage: ${sentences.length} sentences, tokens per paragraph:`,
  [...new Set(sentences.map((s) => s.paragraph))].map((p) =>
    sentences.reduce((n, s, i) => n + (s.paragraph === p ? tokens[i] : 0), 0)));
await mkdir(OUT, { recursive: true });

const rows: { v: Variant; requests: number[]; seconds: number }[] = [];
for (const v of VARIANTS) {
  const chunks = v.chunk(sentences, tokens);
  const parts: Float32Array[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const words = chunk.flatMap((s) => s.words);
    const texts = v.wholeText ? [words.map((w) => w.text).join(' ')] : words.map((w) => w.text);
    const r = await engine.synthesize(texts, v.voice ?? 'af_heart', 1, {
      emphasis: v.emphasis ? words.map((w) => w.em) : undefined,
      reduceFunctionWords: v.reduce,
    });
    parts.push(r.audio);
    const next = chunks[c + 1];
    const last = chunk.at(-1)!;
    // The extension's natural gap between sentence buffers is ~30 ms.
    let gap = 0.03;
    if (v.paragraphPauses && next) {
      if (last.heading) gap = 0.6;
      else if (next[0].paragraph !== last.paragraph) gap = 0.4;
    }
    if (next) parts.push(silence(gap));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const audio = new Float32Array(total);
  let pos = 0;
  for (const p of parts) {
    audio.set(p, pos);
    pos += p.length;
  }
  await writeFile(join(OUT, v.file), wav(audio));
  const requests = chunks.map((ch) => ch.reduce((n, s) => n + tokens[sentences.indexOf(s)], 0));
  rows.push({ v, requests, seconds: total / SAMPLE_RATE });
  console.log(`${v.file.padEnd(18)} ${chunks.length} requests [${requests.join(', ')}] tokens, ${(total / SAMPLE_RATE).toFixed(1)} s`);
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Narration samples</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; background: #15110e; color: #f3e9df; }
  h1 { font-size: 20px; letter-spacing: .08em; text-transform: uppercase; color: #ff7a1a; }
  .card { background: #1f1915; border: 1px solid #3a2e25; border-radius: 12px; padding: 14px 16px; margin: 12px 0; }
  .card h2 { font-size: 15px; margin: 0 0 4px; } .card p { margin: 0 0 10px; color: #a8968a; }
  .meta { font-size: 12px; color: #a8968a; } audio { width: 100%; }
  details { margin-top: 24px; color: #a8968a; } pre { white-space: pre-wrap; }
</style></head><body>
<h1>Narration samples</h1>
<p>Round 2 — same passage, voice Heart, speed 1. Headphones recommended.</p>
${rows.map(({ v, requests, seconds }) => `<div class="card"><h2>${v.title}</h2><p>${v.description}</p>
<audio controls preload="none" src="${v.file}"></audio>
<div class="meta">${requests.length} requests · tokens per request: ${requests.join(', ')} · ${seconds.toFixed(1)} s</div></div>`).join('\n')}
<details><summary>Passage</summary><pre>${PASSAGE.replace(/</g, '&lt;')}</pre></details>
</body></html>`;
await writeFile(join(OUT, 'index.html'), html);
console.log('wrote', join(OUT, 'index.html'));
