// Supertonic voices: shipped presets and custom "recipes" built from them.
//
// A Supertonic voice is two parameter sets for the shared model: style_ttl (character:
// timbre, tone; 50x256 values) and style_dp (rhythm: pacing; 8x16 values). The values
// have no individual meaning, so custom voices are recipes in the space spanned by the
// shipped presets:
//   part = sum_i w_i * preset_i            (mix, weights normalised)
//        + sum_k d_k * sigma_k * u_k       (dimensions: principal directions of the
//                                           presets, in units of their spread)
// computed separately for character and rhythm. Recipes are tiny, so they are stored in
// chrome.storage.sync and sent along with synthesis requests; the engine and the options
// page build the full voice with the same code below.

export const PRESETS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const;
export type PresetId = (typeof PRESETS)[number];
/** Principal directions available per part (10 presets span at most 9). */
export const DIMENSIONS = 9;
/** Dimension slider range, in standard deviations of the presets. */
export const DIM_RANGE = 3;

export interface PartRecipe {
  /** Mix weights per preset (0–1; normalised when building). */
  mix: Partial<Record<PresetId, number>>;
  /** Offsets along the principal directions, in standard deviations. */
  dims: number[];
}

export interface VoiceRecipe {
  character: PartRecipe;
  rhythm: PartRecipe;
}

export interface CustomVoice extends VoiceRecipe {
  /** "c-" + random id; the global voice key is "supertonic:<id>". */
  id: string;
  name: string;
}

export const presetName = (id: string) => `${id[0] === 'F' ? 'Female' : 'Male'} ${id[1]}`;
export const isPreset = (id: string): id is PresetId => (PRESETS as readonly string[]).includes(id);

/** A preset expressed as a recipe (100% of itself, no offsets). */
export function presetRecipe(id: PresetId): VoiceRecipe {
  const part = (): PartRecipe => ({ mix: { [id]: 1 }, dims: Array(DIMENSIONS).fill(0) });
  return { character: part(), rhythm: part() };
}

function randomPart(): PartRecipe {
  // A few presets with random weights (reads as a blend, not a mush of all ten) plus
  // modest offsets along the principal directions.
  const chosen = [...PRESETS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));
  const mix: Partial<Record<PresetId, number>> = {};
  for (const p of chosen) mix[p] = Math.round((0.15 + Math.random() * 0.85) * 100) / 100;
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
  const dims = Array.from({ length: DIMENSIONS }, () => Math.round(Math.max(-2, Math.min(2, gauss() * 0.7)) * 10) / 10);
  return { mix, dims };
}

export function randomRecipe(): VoiceRecipe {
  return { character: randomPart(), rhythm: randomPart() };
}

export function newVoiceId(): string {
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}

/** Compact, stable JSON of a recipe (zero weights dropped, values rounded). */
export function recipeJson(r: VoiceRecipe, name?: string): string {
  const part = (p: PartRecipe) => ({
    mix: Object.fromEntries(
      PRESETS.filter((k) => (p.mix[k] ?? 0) > 0).map((k) => [k, Math.round((p.mix[k] ?? 0) * 1000) / 1000]),
    ),
    dims: p.dims.map((d) => Math.round(d * 100) / 100),
  });
  return JSON.stringify({ ...(name ? { name } : {}), character: part(r.character), rhythm: part(r.rhythm) });
}

/** Extra request parameters for a voice key: a custom Supertonic voice's recipe. */
export function customVoiceParams(voices: CustomVoice[], voiceKey: string): Record<string, string> {
  const custom = voices.find((v) => `supertonic:${v.id}` === voiceKey);
  return custom ? { voiceRecipe: recipeJson(custom) } : {};
}

// ---- storage (options page and content script) ----------------------------------------

const KEY = 'supertonicVoices';

function normalizePart(p: Partial<PartRecipe> | undefined): PartRecipe {
  const dims = Array.from({ length: DIMENSIONS }, (_, k) => {
    const v = Number(p?.dims?.[k] ?? 0);
    return Number.isFinite(v) ? Math.max(-DIM_RANGE, Math.min(DIM_RANGE, v)) : 0;
  });
  const mix: Partial<Record<PresetId, number>> = {};
  for (const k of PRESETS) {
    const v = Number(p?.mix?.[k] ?? 0);
    if (Number.isFinite(v) && v > 0) mix[k] = Math.min(1, v);
  }
  if (!Object.keys(mix).length) mix.F1 = 1;
  return { mix, dims };
}

export function normalizeVoice(v: Partial<CustomVoice>): CustomVoice | null {
  if (!v.id || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    name: String(v.name ?? 'Custom voice').slice(0, 60),
    character: normalizePart(v.character),
    rhythm: normalizePart(v.rhythm),
  };
}

export async function loadCustomVoices(): Promise<CustomVoice[]> {
  const stored = (await chrome.storage.sync.get(KEY))[KEY] as Partial<CustomVoice>[] | undefined;
  return (stored ?? []).map(normalizeVoice).filter((v): v is CustomVoice => Boolean(v));
}

export async function saveCustomVoices(voices: CustomVoice[]): Promise<void> {
  // Stored compactly (one sync item holds 8 KB, roughly 25 voices).
  await chrome.storage.sync.set({ [KEY]: voices.map((v) => ({ id: v.id, ...JSON.parse(recipeJson(v, v.name)) })) });
}

export function onCustomVoicesChanged(cb: (voices: CustomVoice[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) {
      cb(((changes[KEY].newValue as Partial<CustomVoice>[]) ?? []).map(normalizeVoice).filter((v): v is CustomVoice => Boolean(v)));
    }
  });
}

// ---- building voices (engine and options page) -------------------------------------------

export interface StyleData {
  ttl: Float32Array;
  ttlDims: number[];
  dp: Float32Array;
  dpDims: number[];
}

interface Basis {
  presets: Float32Array[];
  mean: Float32Array;
  /** Unit principal directions, strongest first. */
  axes: Float32Array[];
  /** Standard deviation of the presets along each axis. */
  sigma: number[];
}

/** Eigen-decomposition of a small symmetric matrix (Jacobi rotations). */
function symmetricEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: m.map((r, i) => r[i]), vectors: v };
}

/** Principal directions of a set of preset vectors (via the small Gram matrix). */
function basisOf(presets: Float32Array[]): Basis {
  const n = presets.length;
  const d = presets[0].length;
  const mean = new Float32Array(d);
  for (const p of presets) for (let i = 0; i < d; i++) mean[i] += p[i] / n;
  const centered = presets.map((p) => p.map((x, i) => x - mean[i]));
  const gram = centered.map((a) => centered.map((b) => a.reduce((s, x, i) => s + x * b[i], 0)));
  const { values, vectors } = symmetricEigen(gram);
  const order = values.map((_, i) => i).sort((x, y) => values[y] - values[x]);
  const axes: Float32Array[] = [];
  const sigma: number[] = [];
  for (const k of order.slice(0, DIMENSIONS)) {
    if (values[k] <= 1e-12) break;
    const axis = new Float32Array(d);
    for (let j = 0; j < n; j++) for (let i = 0; i < d; i++) axis[i] += vectors[j][k] * centered[j][i];
    let norm = 0;
    for (let i = 0; i < d; i++) norm += axis[i] * axis[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < d; i++) axis[i] /= norm;
    axes.push(axis);
    sigma.push(Math.sqrt(values[k] / (n - 1)));
  }
  return { presets, mean, axes, sigma };
}

function buildPart(basis: Basis, part: PartRecipe): Float32Array {
  const d = basis.mean.length;
  const out = new Float32Array(d);
  const weights = PRESETS.map((k) => Math.max(0, part.mix[k] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  weights.forEach((w, j) => {
    if (w > 0) for (let i = 0; i < d; i++) out[i] += (w / total) * basis.presets[j][i];
  });
  basis.axes.forEach((axis, k) => {
    const offset = (part.dims[k] ?? 0) * basis.sigma[k];
    if (offset) for (let i = 0; i < d; i++) out[i] += offset * axis[i];
  });
  return out;
}

/** Builds voices from recipes, given the preset styles (in PRESETS order). */
export class VoiceSpace {
  private ttl: Basis;
  private dp: Basis;

  constructor(private styles: StyleData[]) {
    this.ttl = basisOf(styles.map((s) => s.ttl));
    this.dp = basisOf(styles.map((s) => s.dp));
  }

  build(recipe: VoiceRecipe): StyleData {
    return {
      ttl: buildPart(this.ttl, recipe.character),
      ttlDims: this.styles[0].ttlDims,
      dp: buildPart(this.dp, recipe.rhythm),
      dpDims: this.styles[0].dpDims,
    };
  }
}

/** Parses a voice style file (Supertonic's voice_styles/*.json format). */
export function parseStyle(json: {
  style_ttl: { data: unknown[]; dims: number[] };
  style_dp: { data: unknown[]; dims: number[] };
}): StyleData {
  return {
    ttl: Float32Array.from(json.style_ttl.data.flat(Infinity) as number[]),
    ttlDims: json.style_ttl.dims,
    dp: Float32Array.from(json.style_dp.data.flat(Infinity) as number[]),
    dpDims: json.style_dp.dims,
  };
}

/** A built voice as a file in Supertonic's voice_styles format, with its recipe. */
export function styleFile(style: StyleData, voice: CustomVoice): string {
  const nest = (flat: Float32Array, dims: number[]): unknown => {
    if (dims.length === 1) return Array.from(flat, (x) => Math.round(x * 1e6) / 1e6);
    const size = flat.length / dims[0];
    return Array.from({ length: dims[0] }, (_, i) => nest(flat.subarray(i * size, (i + 1) * size), dims.slice(1)));
  };
  return JSON.stringify({
    style_ttl: { data: nest(style.ttl, style.ttlDims), dims: style.ttlDims, type: 'float32' },
    style_dp: { data: nest(style.dp, style.dpDims), dims: style.dpDims, type: 'float32' },
    metadata: { name: voice.name, source: 'Narrator of Mordor voice builder', recipe: JSON.parse(recipeJson(voice)) },
  });
}
