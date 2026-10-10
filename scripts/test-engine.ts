// Node smoke test for the engine: synthesises a sentence, prints word timings and
// writes a WAV so the alignment can be checked by ear.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KokoroEngine, SAMPLE_RATE } from '../src/engine/kokoro';

const root = join(import.meta.dirname, '..', 'public', 'models');
const dtype = (process.argv[2] ?? 'fp32') as 'fp16' | 'fp32';
const text =
  process.argv[3] ||
  'One does not simply walk into Mordor. Its black gates are guarded by more than just orcs, in 1954 and for $3.50.';

const t0 = performance.now();
const engine = await KokoroEngine.load({
  modelRoot: root + '/',
  modelId: 'kokoro',
  device: 'cpu',
  dtype,
  readFile: async (p) => {
    const b = await readFile(join(root, 'kokoro', p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
});
console.log(`loaded in ${(performance.now() - t0).toFixed(0)} ms`);

const words = text.split(/\s+/).filter(Boolean);
const t1 = performance.now();
const r = await engine.synthesize(words, process.env.VOICE ?? 'af_heart', Number(process.env.SPEED ?? 1));
console.log(`synth ${r.duration.toFixed(2)}s audio in ${(performance.now() - t1).toFixed(0)} ms`);
words.forEach((w, i) => console.log(r.words[i].start.toFixed(3), r.words[i].end.toFixed(3), w));

// 16-bit PCM WAV
const pcm = new Int16Array(r.audio.length);
r.audio.forEach((s, i) => (pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.byteLength, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.byteLength, 40);
const out = process.argv[4] ?? 'test.wav';
await writeFile(out, Buffer.concat([header, Buffer.from(pcm.buffer)]));
console.log('wrote', out);
