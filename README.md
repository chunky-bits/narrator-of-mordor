# Narrator of Mordor

A Chrome extension that reads web pages aloud with **Kokoro**, a high-quality
open-weight TTS model that runs entirely on your machine — no cloud, no API keys.

- Bottom bar with play/pause, a settings menu (gear) and transport controls:
  - Back: start of the paragraph, or the previous paragraph within its first 2 s
  - Rewind: start of the sentence, or the previous sentence within its first 2 s
  - Forward / Skip: next sentence / next paragraph
- Smooth progress line with a hover-revealed thumb; drag it to jump to the sentence
  under it (the thumb snaps to that sentence's start on release)
- Paragraphs are detected automatically from the page structure; short lists and
  tables count as one paragraph, headings as their own
- Reads the selected text, or the whole page / detected main article
- Exact sentence and word highlighting, coloured as variations of the site's own background
- Selection is hidden while reading and restored on pause or when finished
- Voice (27 US/UK English voices), speed, volume and auto-scroll settings
- Per-tab toggle that survives reloads and navigation; shortcut **Alt+Shift+N**

## Build and install

```bash
npm install
npm run assets   # downloads the Kokoro model (~340 MB) into public/models
npm run build    # outputs the unpacked extension to dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**
and choose the `dist/` folder. Click the toolbar icon (or press Alt+Shift+N) to show
the bar on a page. The shortcut can be changed at `chrome://extensions/shortcuts`.

## How it works

| Part | File | Role |
| --- | --- | --- |
| Service worker | `src/background/background.ts` | Per-tab on/off state, toolbar/shortcut, offscreen lifetime |
| Offscreen document | `src/offscreen/`, `src/engine/` | Runs Kokoro fp32 (WebGPU, WASM fallback) |
| Content script | `src/content/` | Bar UI, text extraction, playback, highlighting |

**Exact word timing.** The model export used
([`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped))
returns the predicted duration of every phoneme token next to the audio. Each word is
phonemised separately, so the engine knows exactly which tokens belong to which word
and converts the durations into word start/end times. The page plays the audio in its
own `AudioContext` and highlights from that audio clock.

**Natural rhythm.** Because words are phonemised one by one (needed for exact
timing), espeak would give every word full stress and its dictionary form ("for a" →
"for AY"). Common function words ("the, a, to, for, of, and…") are therefore replaced
by their unstressed running-speech forms, as in the speech Kokoro was trained on.

**Chunked synthesis.** Several sentences per request give the model context for more
natural intonation, so text is synthesised in chunks of whole sentences within a
paragraph: up to 500 tokens on WebGPU, 250 on the WASM fallback. After a start or seek
the first chunk is a single sentence (sound within ~1 s), and each following chunk may
grow to 4× (WebGPU) / 1.6× (WASM) the previous one, so it is ready before the previous
one ends. A chunk plays as one continuous audio source; the current sentence is derived
from the word timings, so seeking within a generated chunk is instant. Paragraph ends
get a 0.4 s pause and headings 0.6 s. When the bar opens, the first two chunks of the
page are prepared in the background.

**Highlighting** uses the CSS Custom Highlight API, so the page's DOM is never
modified. Colours are derived from the composited background behind the text:
the sentence gets a lightness shift in the same hue family, the word a different hue
with a stronger shift, both adjusted to keep the site's text colour readable.

## Development

```bash
npm run dev          # Vite dev server; open http://localhost:5173/harness/
npm run typecheck
npm run test:engine  # synthesises a sentence in Node, prints word timings, writes test.wav
npx tsx scripts/make-samples.ts  # renders A/B narration samples into samples/ (open samples/index.html)
```

The harness page runs the content script and the engine together with a small
stand-in for the `chrome.*` APIs, which is the quickest way to iterate on the UI.

## Licence

GPL-3.0-or-later. The phonemiser bundles eSpeak NG (GPL-3.0). Kokoro model weights
and `kokoro-js` (whose text normalisation is adapted in `src/engine/phonemize.ts`)
are Apache-2.0.
