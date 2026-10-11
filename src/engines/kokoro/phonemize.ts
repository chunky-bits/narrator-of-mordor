// Text normalisation and phonemisation for Kokoro.
// Ported from kokoro-js (Apache-2.0, hexgrad / Xenova) so that each word can be
// phonemised on its own — that is what lets us map model durations back to words.
import { phonemize as espeak } from 'phonemizer';

/** 'a' = American English, 'b' = British English (first letter of the voice id). */
export type Lang = 'a' | 'b';

function splitNum(num: string): string {
  if (num.includes('.')) return num;
  if (num.includes(':')) {
    const [h, m] = num.split(':').map(Number);
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = parseInt(num.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return num;
  const left = num.slice(0, 2);
  const right = parseInt(num.slice(2, 4), 10);
  const suffix = num.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(m: string): string {
  const bill = m[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(m.slice(1)))) return `${m.slice(1)} ${bill}s`;
  if (!m.includes('.')) {
    const suffix = m.slice(1) === '1' ? '' : 's';
    return `${m.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = m.slice(1).split('.');
  const d = parseInt(c.padEnd(2, '0'), 10);
  const coins = m[0] === '$' ? (d === 1 ? 'cent' : 'cents') : d === 1 ? 'penny' : 'pence';
  return `${b} ${bill}${b === '1' ? '' : 's'} and ${d} ${coins}`;
}

function pointNum(num: string): string {
  const [a, b] = num.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/, ' ')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RE = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`,
  'g',
);

function splitPunctuation(text: string): { match: boolean; text: string }[] {
  const parts: { match: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(PUNCTUATION_RE)) {
    const idx = m.index ?? 0;
    if (last < idx) parts.push({ match: false, text: text.slice(last, idx) });
    if (m[0].length > 0) parts.push({ match: true, text: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ match: false, text: text.slice(last) });
  return parts;
}

const cache = new Map<string, string>();

/** Phonemise one whitespace-delimited chunk of text (a word plus attached punctuation). */
export async function phonemizeChunk(text: string, lang: Lang): Promise<string> {
  const key = lang + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const normalized = normalizeText(text);
  const espeakLang = lang === 'a' ? 'en-us' : 'en';
  const pieces = await Promise.all(
    splitPunctuation(normalized).map(async ({ match, text: t }) =>
      match ? t : (await espeak(t, espeakLang)).join(' '),
    ),
  );
  let ph = pieces
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang === 'a') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  ph = ph.trim();

  if (cache.size > 5000) cache.clear();
  cache.set(key, ph);
  return ph;
}

// Words that are normally unstressed in running speech. Phonemised in isolation,
// espeak gives every word primary stress and its citation form ("a" → ˈeɪ, "to" → tˈuː),
// which makes the rhythm even and flat. Kokoro was trained on running speech where
// these words are reduced, so we reduce them back.
const UNSTRESSED = new Set([
  'the', 'a', 'an', 'and', 'or', 'nor', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from',
  'with', 'as', 'into', 'onto', 'than', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'it',
  'its', "it's", 'his', 'her', 'him', 'them', 'their', 'they', 'we', 'he', 'she', 'you', 'your',
  'my', 'me', 'our', 'us', 'i', "i'm", "i've", "i'll", "i'd", 'do', 'does', 'did', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'that',
  'this', 'so', 'if', 'there', 'some',
]);

/** Reduced vowel forms for the most frequent function words (stress already removed). */
const REDUCED: Record<string, Record<Lang, string>> = {
  the: { a: 'ðə', b: 'ðə' },
  a: { a: 'ə', b: 'ə' },
  an: { a: 'ən', b: 'ən' },
  to: { a: 'tə', b: 'tə' },
  for: { a: 'fɚ', b: 'fə' },
  of: { a: 'əv', b: 'əv' },
  from: { a: 'fɹəm', b: 'fɹəm' },
  and: { a: 'ənd', b: 'ənd' },
  than: { a: 'ðən', b: 'ðən' },
};

/**
 * Turn the isolated pronunciation of a function word into its unstressed running-speech
 * form; "not" is demoted to secondary stress. Other words are returned unchanged.
 */
export function reduceFunctionWord(text: string, phonemes: string, lang: Lang): string {
  const bare = text.toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, '');
  if (bare === 'not') return phonemes.replace('ˈ', 'ˌ');
  if (!UNSTRESSED.has(bare)) return phonemes;
  // Keep attached punctuation (e.g. the comma in "it,") around the replaced core.
  const m = /^([^a-zɐ-ʒæðŋθɚɪʊʌɔəɛɜɑɒˈˌ]*)(.*?)([^a-zɐ-ʒæðŋθɚɪʊʌɔəɛɜɑɒːˈˌ]*)$/u.exec(phonemes);
  if (!m) return phonemes;
  const core = REDUCED[bare]?.[lang] ?? m[2].replace(/[ˈˌ]/g, '');
  return m[1] + core + m[3];
}
