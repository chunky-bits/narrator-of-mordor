// Zips the built extension (dist/) for the Chrome Web Store, without the bundled
// models: store builds download them on first use (src/engines/model-store.ts).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'dist', 'manifest.json'), 'utf8'));
const out = join(ROOT, 'release', `narrator-of-mordor-${version}.zip`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, '.', '-x', 'models/*', '-x', '.*'], { cwd: join(ROOT, 'dist'), stdio: 'inherit' });
console.log(`${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
