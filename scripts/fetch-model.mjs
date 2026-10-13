// Downloads the model files into public/models. Development builds bundle them (Vite
// copies them into dist/); store builds leave them out and download them on first use
// from a GitHub release (scripts/release-models.mjs, src/engines/model-store.ts).
import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'kokoro');

// Keep in sync with src/engines/kokoro/meta.ts
const VOICES = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova',
  'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam',
  'am_michael', 'am_onyx', 'am_puck', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
];

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  // fp32: the fp16 export produces degraded audio on WebGPU.
  'onnx/model.onnx',
  ...VOICES.map((v) => `voices/${v}.bin`),
];

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function download(base, out, files) {
  for (const file of files) {
    const dest = join(out, file);
    if (await exists(dest)) continue;
    process.stdout.write(`fetching ${file} ... `);
    const res = await fetch(`${base}/${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

await download(BASE, OUT, FILES);
console.log('Kokoro files ready in', OUT);

// ---- Supertonic 3 (multilingual) ----
const ST_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const ST_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'supertonic');
// Keep in sync with src/engines/supertonic/meta.ts
const ST_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
// Word timing needs the attention maps exposed (scripts/patch-supertonic.py, Python + onnx);
// only the patched vector estimator is kept, so the original is not bundled twice.
const timed = join(ST_OUT, 'onnx', 'vector_estimator.timed.onnx');
const original = join(ST_OUT, 'onnx', 'vector_estimator.onnx');
await download(ST_BASE, ST_OUT, [
  'LICENSE',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vocoder.onnx',
  ...((await exists(timed)) ? [] : ['onnx/vector_estimator.onnx']),
  ...ST_VOICES.map((v) => `voice_styles/${v}.json`),
]);
if (!(await exists(timed))) {
  const python = process.env.PYTHON ?? 'python3';
  try {
    execFileSync(python, [join(dirname(fileURLToPath(import.meta.url)), 'patch-supertonic.py'), join(ST_OUT, 'onnx', 'vector_estimator.onnx'), timed], { stdio: 'inherit' });
  } catch {
    console.error(`\nCould not patch Supertonic. Install the onnx package (pip install onnx) and run again,\nor set PYTHON to an interpreter that has it.`);
    process.exit(1);
  }
}
await rm(original, { force: true });
console.log('Supertonic files ready in', ST_OUT);
