// Downloads the Kokoro model files that ship inside the extension package.
// Chrome extensions may not load code or models from remote hosts, so everything
// lives under public/models and is copied into dist/ by Vite.
import { mkdir, stat, writeFile } from 'node:fs/promises';
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

for (const file of FILES) {
  const dest = join(OUT, file);
  if (await exists(dest)) continue;
  process.stdout.write(`fetching ${file} ... `);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
console.log('model files ready in', OUT);
