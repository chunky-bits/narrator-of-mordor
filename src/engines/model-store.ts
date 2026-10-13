// Model files for the engines (offscreen document only). Development builds bundle
// them under models/; store builds download them on first use from the models release
// on GitHub, verify their SHA-256 and keep them in the Cache API.
import MODELS from './model-files.json';

export interface ModelFileInfo {
  size: number;
  sha256: string;
}

/** Contents of model-files.json, written by scripts/release-models.mjs. */
export interface ModelRelease {
  /** Release tag whose assets hold the files. */
  tag: string;
  repository: string;
  /** Path (e.g. "kokoro/onnx/model.onnx") → size and hash. */
  files: Record<string, ModelFileInfo>;
}

/** The engine-scoped view handed to an engine module. */
export interface ModelFiles {
  /** Make sure every file of the engine is available (downloading if needed). */
  ensureAll(): Promise<void>;
  /** A file relative to the engine's folder, e.g. "onnx/model.onnx". */
  response(path: string): Promise<Response>;
  bytes(path: string): Promise<Uint8Array>;
  json<T>(path: string): Promise<T>;
}

/** Download progress of one engine, in bytes. */
export type ProgressFn = (loaded: number, total: number) => void;

const release = MODELS as ModelRelease;

/** Release assets are flat, so folders become "__" ("kokoro/onnx/model.onnx" → "kokoro__onnx__model.onnx"). */
export const assetName = (path: string) => path.replaceAll('/', '__');

/** Where the assets are downloaded from; VITE_MODELS_URL overrides it for testing a build. */
const assetBase: string =
  import.meta.env.VITE_MODELS_URL || `https://github.com/${release.repository}/releases/download/${release.tag}/`;
const assetUrl = (path: string) => assetBase + assetName(path);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ModelStore {
  /** Whether the files are bundled in the extension (checked once). */
  private bundled: Promise<boolean>;
  private inflight = new Map<string, Promise<void>>();
  private cache = caches.open(`narmor-models-${release.tag}`);

  constructor(private bundledRoot: string) {
    this.bundled = fetch(bundledRoot + 'kokoro/config.json').then(
      (r) => r.ok,
      () => false,
    );
    void this.dropOldCaches();
  }

  /** Files of one engine, reporting download progress. */
  forEngine(engineId: string, onProgress: ProgressFn): ModelFiles {
    const full = (p: string) => `${engineId}/${p}`;
    const response = async (p: string): Promise<Response> => {
      const path = full(p);
      if (await this.bundled) {
        const res = await fetch(this.bundledRoot + path);
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res;
      }
      const cached = await (await this.cache).match(assetUrl(path));
      if (cached) return cached;
      await this.download([path], onProgress);
      return (await (await this.cache).match(assetUrl(path)))!;
    };
    return {
      ensureAll: async () => {
        if (await this.bundled) return;
        const cache = await this.cache;
        const paths = Object.keys(release.files).filter((p) => p.startsWith(`${engineId}/`));
        const missing: string[] = [];
        for (const p of paths) if (!(await cache.match(assetUrl(p)))) missing.push(p);
        if (missing.length) await this.download(missing, onProgress);
      },
      response,
      bytes: async (p) => new Uint8Array(await (await response(p)).arrayBuffer()),
      json: async (p) => (await response(p)).json(),
    };
  }

  /** Download files one after another, with progress over all of them. */
  private async download(paths: string[], onProgress: ProgressFn): Promise<void> {
    const total = paths.reduce((n, p) => n + (release.files[p]?.size ?? 0), 0);
    let done = 0;
    for (const path of paths) {
      let job = this.inflight.get(path);
      if (!job) {
        job = this.fetchOne(path, (n) => onProgress(done + n, total)).finally(() => this.inflight.delete(path));
        this.inflight.set(path, job);
      }
      await job;
      done += release.files[path]?.size ?? 0;
      onProgress(done, total);
    }
  }

  private async fetchOne(path: string, onBytes: (n: number) => void): Promise<void> {
    const info = release.files[path];
    if (!info) throw new Error(`Unknown model file ${path}`);
    const res = await fetch(assetUrl(path));
    if (!res.ok || !res.body) throw new Error(`Downloading ${path} failed: HTTP ${res.status}`);
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > info.size) throw new Error(`${path}: larger than expected`);
      bytes.set(value, offset);
      offset += value.length;
      onBytes(offset);
    }
    if (offset !== info.size || (await sha256(bytes)) !== info.sha256) {
      throw new Error(`${path}: download incomplete or corrupted, please try again`);
    }
    await (await this.cache).put(assetUrl(path), new Response(bytes, { headers: { 'Content-Length': String(info.size) } }));
  }

  /** Remove files of earlier model releases. */
  private async dropOldCaches(): Promise<void> {
    const current = `narmor-models-${release.tag}`;
    for (const name of await caches.keys()) {
      if (name.startsWith('narmor-models-') && name !== current) await caches.delete(name);
    }
  }
}

/** "Downloading voice model… 42% of 356 MB" */
export function downloadStatus(loaded: number, total: number): string {
  const pct = total ? Math.floor((loaded / total) * 100) : 0;
  return `Downloading voice model… ${pct}% of ${Math.round(total / 1e6)} MB`;
}
