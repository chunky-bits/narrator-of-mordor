// Publishes the model files (public/models, from `npm run assets`) as assets of a GitHub
// release, from which store builds download them on first use (src/engines/model-store.ts).
//
//   node scripts/release-models.mjs            write src/engines/model-files.json only
//   node scripts/release-models.mjs --upload   also create the release and upload (needs gh)
//
// A new tag is needed whenever a model file changes: the extension caches files per tag.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'chunky-bits/narrator-of-mordor';
const TAG = 'models-v1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = join(ROOT, 'public', 'models');
const OUT = join(ROOT, 'src', 'engines', 'model-files.json');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const hash = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

const files = {};
const paths = (await walk(MODELS)).sort();
for (const file of paths) {
  const path = relative(MODELS, file).split('\\').join('/');
  if (path.endsWith('vector_estimator.onnx')) continue; // unpatched original, not used
  files[path] = { size: (await stat(file)).size, sha256: await hash(file) };
  console.log(path, files[path].size);
}
await writeFile(OUT, JSON.stringify({ repository: REPOSITORY, tag: TAG, files }, null, 2) + '\n');
console.log(`${Object.keys(files).length} files, ${(Object.values(files).reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0)} MB → ${relative(ROOT, OUT)}`);

if (process.argv.includes('--upload')) {
  const gh = (...args) => execFileSync('gh', args, { stdio: 'inherit' });
  const notes = [
    'Model files for Narrator of Mordor, downloaded by the extension on first use. Not an extension release.',
    '',
    '- `kokoro__*`: [Kokoro-82M v1.0 timestamped ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped), Apache-2.0, unmodified.',
    '- `supertonic__*`: [Supertonic 3](https://huggingface.co/Supertone/supertonic-3), OpenRAIL-M (see `supertonic__LICENSE`).',
    '  `vector_estimator.timed.onnx` is modified: two attention maps are exposed as extra outputs for word timing',
    '  (`scripts/patch-supertonic.py`); the weights are unchanged.',
    '',
    'Asset names are file paths with `/` replaced by `__`.',
  ].join('\n');
  try {
    execFileSync('gh', ['release', 'view', TAG, '-R', REPOSITORY], { stdio: 'ignore' });
  } catch {
    gh('release', 'create', TAG, '-R', REPOSITORY, '--title', `Voice models (${TAG})`, '--notes', notes, '--prerelease', '--latest=false');
  }
  // Assets are named after the uploaded file, so upload through symlinks with flat names.
  const stage = await mkdtemp(join(tmpdir(), 'narmor-models-'));
  const assets = [];
  for (const p of Object.keys(files)) {
    const link = join(stage, p.replaceAll('/', '__'));
    await symlink(join(MODELS, p), link);
    assets.push(link);
  }
  try {
    for (let i = 0; i < assets.length; i += 10) {
      gh('release', 'upload', TAG, '-R', REPOSITORY, '--clobber', ...assets.slice(i, i + 10));
    }
  } finally {
    await rm(stage, { recursive: true });
  }
}
