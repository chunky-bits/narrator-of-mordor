import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Build identifier for feedback diagnostics: commit, uncommitted changes and date. */
function buildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = git('status --porcelain') ? '-dirty' : '';
    return `${git('rev-parse --short HEAD')}${dirty} (${date})`;
  } catch {
    return `unknown commit (${date})`; // not built from a git checkout
  }
}
const define = { __BUILD__: JSON.stringify(buildId()) };

// Two builds share dist/:
//  - default: background service worker + offscreen document (ES modules)
//  - `--mode content`: the content script as a single classic script (IIFE),
//    because content scripts cannot be ES modules.
export default defineConfig(({ mode }) => {
  if (mode === 'content') {
    return {
      define,
      publicDir: false,
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        copyPublicDir: false,
        lib: {
          entry: resolve(import.meta.dirname, 'src/content/content.ts'),
          formats: ['iife'],
          name: 'narmor',
          fileName: () => 'content.js',
        },
      },
    };
  }
  return {
    define,
    // The dev harness (harness/index.html) runs everything in one page.
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'esnext',
      chunkSizeWarningLimit: 4000,
      // onnxruntime-web starts its WASM threads by re-loading offscreen.js inside
      // workers, so the bundle must not touch `document` at the top level.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          background: resolve(import.meta.dirname, 'src/background/background.ts'),
          offscreen: resolve(import.meta.dirname, 'offscreen.html'),
          options: resolve(import.meta.dirname, 'options.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
