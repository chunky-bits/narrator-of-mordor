// Voice Builder for Supertonic (options page): shipped voices are read-only; custom
// voices are recipes (preset mix + principal-direction offsets, see voices.ts) that can
// be created, copied, renamed, randomised, deleted, previewed, exported and used.
import {
  DIM_RANGE,
  DIMENSIONS,
  isPreset,
  newVoiceId,
  parseStyle,
  presetName,
  presetRecipe,
  PRESETS,
  randomRecipe,
  recipeJson,
  styleFile,
  VoiceSpace,
  type CustomVoice,
  type PartRecipe,
  type VoiceRecipe,
} from '../engines/supertonic/voices';

export interface VoiceBuilderHost {
  voices(): CustomVoice[];
  setVoices(voices: CustomVoice[]): void;
  /** Global key of the voice in use (e.g. "supertonic:F3"). */
  voiceInUse(): string;
  useVoice(key: string): void;
  /** Synthesise and play a sample with this voice key (custom recipes are resolved by the host). */
  preview(key: string): Promise<void>;
  toast(message: string): void;
  rerender(): void;
}

const ENGINE = 'supertonic';
const key = (id: string) => `${ENGINE}:${id}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

let selected = '';
/** Which "Fine-tune" sections are open (kept across re-renders). */
const openFine = new Set<string>();
let autoPreview = true;
let saveTimer = 0;
let space: Promise<VoiceSpace> | null = null;

function recipeOf(id: string, voices: CustomVoice[]): VoiceRecipe {
  if (isPreset(id)) return presetRecipe(id);
  return voices.find((v) => v.id === id) ?? presetRecipe('F1');
}

function nameOf(id: string, voices: CustomVoice[]): string {
  return isPreset(id) ? presetName(id) : (voices.find((v) => v.id === id)?.name ?? id);
}

function partEditor(part: 'character' | 'rhythm', recipe: PartRecipe, readOnly: boolean): string {
  const dis = readOnly ? 'disabled' : '';
  const mix = PRESETS.map((p) => {
    const v = Math.round((recipe.mix[p] ?? 0) * 100);
    return `
      <label class="vb-slider">
        <span class="vb-label">${p}</span>
        <input type="range" min="0" max="100" step="1" value="${v}" data-part="${part}" data-mix="${p}" ${dis}
          aria-label="${part === 'character' ? 'Character' : 'Rhythm'} mix: ${presetName(p)}">
        <span class="vb-value">${v}%</span>
      </label>`;
  }).join('');
  const dims = Array.from({ length: DIMENSIONS }, (_, k) => {
    const v = recipe.dims[k] ?? 0;
    return `
      <label class="vb-slider">
        <span class="vb-label">D${k + 1}</span>
        <input type="range" min="${-DIM_RANGE}" max="${DIM_RANGE}" step="0.1" value="${v}" data-part="${part}" data-dim="${k}" ${dis}
          aria-label="${part === 'character' ? 'Character' : 'Rhythm'} dimension ${k + 1}">
        <span class="vb-value">${v > 0 ? '+' : ''}${v.toFixed(1)}</span>
      </label>`;
  }).join('');
  const title = part === 'character' ? 'Character' : 'Rhythm';
  const hint =
    part === 'character'
      ? 'Timbre and tone: how much of each shipped voice goes into this one (relative weights, normalised to 100%).'
      : 'Pacing and timing, mixed independently of the character (relative weights).';
  return `
    <fieldset class="vb-part">
      <legend>${title}</legend>
      <p class="hint">${hint}</p>
      <div class="vb-grid">${mix}</div>
      <details class="vb-fine" data-fine="${part}" ${openFine.has(part) ? 'open' : ''}>
        <summary>Fine-tune (dimensions)</summary>
        <p class="hint">The main directions in which the shipped voices differ, strongest first, in steps of
          their spread (±${DIM_RANGE}). They go beyond the shipped voices, so extreme values can sound odd.</p>
        <div class="vb-grid">${dims}</div>
      </details>
    </fieldset>`;
}

export function voiceBuilderHtml(host: VoiceBuilderHost): string {
  const voices = host.voices();
  const inUse = host.voiceInUse();
  if (!selected || (!isPreset(selected) && !voices.some((v) => v.id === selected))) {
    selected = inUse.startsWith(`${ENGINE}:`) ? inUse.slice(ENGINE.length + 1) : 'F1';
    if (!isPreset(selected) && !voices.some((v) => v.id === selected)) selected = 'F1';
  }
  const readOnly = isPreset(selected);
  const recipe = recipeOf(selected, voices);
  const item = (id: string, name: string, shipped: boolean) => `
    <button type="button" class="vb-item ${id === selected ? 'selected' : ''}" data-select="${esc(id)}" role="option" aria-selected="${id === selected}">
      ${shipped ? `<span class="vb-lock" title="Shipped voice (read-only)">${LOCK}</span>` : '<span class="vb-dot"></span>'}
      <span class="vb-name">${esc(name)}</span>
      ${inUse === key(id) ? '<span class="vb-badge">in use</span>' : ''}
    </button>`;
  return `
    <h3>Voice Builder</h3>
    <div class="vb">
      <div class="vb-list" role="listbox" aria-label="Voices">
        <div class="vb-group">Shipped</div>
        ${PRESETS.map((p) => item(p, presetName(p), true)).join('')}
        <div class="vb-group">Custom</div>
        ${voices.length ? voices.map((v) => item(v.id, v.name, false)).join('') : '<p class="hint vb-empty">No custom voices yet.</p>'}
        <button type="button" class="btn vb-new" data-vb="new">+ New voice</button>
      </div>
      <div class="vb-editor">
        <div class="vb-head">
          ${
            readOnly
              ? `<div class="vb-title">${esc(nameOf(selected, voices))}<span class="hint"> · shipped voice, read-only — copy it to edit</span></div>`
              : `<input class="vb-rename" type="text" value="${esc(nameOf(selected, voices))}" maxlength="60" aria-label="Voice name" data-vb="rename">`
          }
        </div>
        <div class="vb-actions">
          <button type="button" class="play" data-vb="preview" aria-label="Play a sample" title="Play a sample">${PLAY}</button>
          <button type="button" class="btn" data-vb="use" ${inUse === key(selected) ? 'disabled' : ''}>Use this voice</button>
          <button type="button" class="btn" data-vb="copy">Create a copy</button>
          <button type="button" class="btn" data-vb="randomise" ${readOnly ? 'disabled' : ''}>Randomise</button>
          <button type="button" class="btn danger" data-vb="delete" ${readOnly ? 'disabled' : ''}>Delete</button>
          <span class="vb-spacer"></span>
          <button type="button" class="btn" data-vb="clipboard" title="Copy the voice recipe as text">Copy recipe</button>
          <button type="button" class="btn" data-vb="download" title="Download the full voice file">Download</button>
        </div>
        <label class="vb-auto"><input type="checkbox" data-vb="auto" ${autoPreview ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> Play a sample after each change</label>
        ${partEditor('character', recipe.character, readOnly)}
        ${partEditor('rhythm', recipe.rhythm, readOnly)}
      </div>
    </div>`;
}

export function bindVoiceBuilder(root: HTMLElement, host: VoiceBuilderHost): void {
  const voices = () => host.voices();
  const current = () => voices().find((v) => v.id === selected);
  const commit = (next: CustomVoice[], rerender = true) => {
    host.setVoices(next);
    if (rerender) host.rerender();
  };
  const update = (fn: (v: CustomVoice) => CustomVoice, rerender = false) => {
    const v = current();
    if (!v) return;
    commit(voices().map((x) => (x.id === v.id ? fn(x) : x)), rerender);
  };
  const add = (recipe: VoiceRecipe, name: string) => {
    const voice: CustomVoice = { id: newVoiceId(), name, ...structuredClone(recipe) };
    selected = voice.id;
    commit([...voices(), voice]);
    if (autoPreview) void host.preview(key(voice.id));
  };

  root.querySelectorAll<HTMLElement>('[data-select]').forEach((el) =>
    el.addEventListener('click', () => {
      selected = el.dataset.select!;
      host.rerender();
    }),
  );

  const on = (action: string, fn: () => void) => root.querySelector<HTMLElement>(`[data-vb="${action}"]`)?.addEventListener('click', fn);
  on('new', () => add(randomRecipe(), `Voice ${voices().length + 1}`));
  on('copy', () => add(recipeOf(selected, voices()), `Copy of ${nameOf(selected, voices())}`));
  on('randomise', () => {
    update((v) => ({ ...v, ...randomRecipe() }), true);
    if (autoPreview) void host.preview(key(selected));
  });
  on('delete', () => {
    const v = current();
    if (!v || !confirm(`Delete the voice "${v.name}"? This cannot be undone.`)) return;
    const rest = voices().filter((x) => x.id !== v.id);
    if (host.voiceInUse() === key(v.id)) host.useVoice(key('F1'));
    selected = rest.at(-1)?.id ?? 'F1';
    commit(rest);
  });
  on('use', () => host.useVoice(key(selected)));
  on('preview', () => void host.preview(key(selected)));
  on('clipboard', async () => {
    const text = recipeJson(recipeOf(selected, voices()), nameOf(selected, voices()));
    try {
      await navigator.clipboard.writeText(text);
      host.toast('Recipe copied to the clipboard.');
    } catch {
      host.toast(`Copy failed; recipe: ${text}`);
    }
  });
  on('download', async () => {
    space ??= Promise.all(
      PRESETS.map(async (p) => parseStyle(await (await fetch(chrome.runtime.getURL(`models/supertonic/voice_styles/${p}.json`))).json())),
    ).then((styles) => new VoiceSpace(styles));
    const name = nameOf(selected, voices());
    const voice: CustomVoice = { id: selected, name, ...recipeOf(selected, voices()) };
    const blob = new Blob([styleFile((await space).build(voice), voice)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'voice'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });

  root.querySelectorAll<HTMLDetailsElement>('details[data-fine]').forEach((d) =>
    d.addEventListener('toggle', () => (d.open ? openFine.add(d.dataset.fine!) : openFine.delete(d.dataset.fine!))),
  );

  const rename = root.querySelector<HTMLInputElement>('[data-vb="rename"]');
  rename?.addEventListener('change', () => {
    const name = rename.value.trim() || 'Custom voice';
    update((v) => ({ ...v, name }), true);
  });
  root.querySelector<HTMLInputElement>('[data-vb="auto"]')?.addEventListener('change', (e) => {
    autoPreview = (e.target as HTMLInputElement).checked;
  });

  // Sliders: update the label live, store on release (debounced), optionally preview.
  root.querySelectorAll<HTMLInputElement>('input[data-part]').forEach((input) => {
    const label = input.parentElement!.querySelector<HTMLElement>('.vb-value')!;
    const part = input.dataset.part as 'character' | 'rhythm';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      label.textContent = input.dataset.mix ? `${v}%` : `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      update((voice) => {
        const p = structuredClone(voice[part]);
        if (input.dataset.mix) {
          p.mix[input.dataset.mix as keyof PartRecipe['mix']] = v / 100;
          // Keep at least one voice in the mix.
          if (!Object.values(p.mix).some((w) => (w ?? 0) > 0)) p.mix[input.dataset.mix as keyof PartRecipe['mix']] = 0.01;
        } else p.dims[Number(input.dataset.dim)] = v;
        return { ...voice, [part]: p };
      });
      clearTimeout(saveTimer);
      if (autoPreview) saveTimer = window.setTimeout(() => void host.preview(key(selected)), 250);
    });
  });
}
