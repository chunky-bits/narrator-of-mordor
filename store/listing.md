# Chrome Web Store listing

Everything the Chrome Web Store Developer Dashboard asks for, ready to paste. Upload
`release/narrator-of-mordor-<version>.zip` (from `npm run package`).

## Package

The **summary** shown in the store comes from the manifest's `description`
(`public/manifest.json`, max 132 characters):

> Reads web pages aloud with private voices that run on your device, highlighting each sentence and word as it is spoken.

## Store listing tab

**Category:** Accessibility (if not offered for your account: Productivity › Tools)

**Language:** English

**Description:**

```text
Listen to any web page. Narrator of Mordor reads articles aloud — or just the text you select — and highlights each sentence and word as it is spoken, so you can follow along, listen while you do something else, or speed-read.

PRIVATE BY DESIGN
Speech is generated on your own computer by open text-to-speech models. Nothing you read is sent to a server, and there are no accounts, subscriptions or API keys.

FEATURES
• Reads the whole page, the detected main article, or your selection
• Highlights the current sentence and word in colours that fit the site
• Play/pause, back to paragraph start, rewind, next sentence, next paragraph and a draggable progress bar
• Speed from 0.5× to 4×, with a words-per-minute estimate
• Natural narration: pauses between paragraphs and after headings
• Two voice engines: Kokoro (27 English voices) and Supertonic (31 languages, follows the page's language)
• Voice Builder: create your own Supertonic voices by mixing and shaping the built-in ones
• Speed reading (RSVP): shows the current word with a fixed focus letter, with or without the voice
• Four colour themes — Mordor, Shire, Rivendell and Gondor — in light and dark
• Keyboard shortcut Alt+Shift+N; the bar stays open per tab across reloads

GETTING STARTED
Click the toolbar icon (or press Alt+Shift+N) to show the bar, then press play. The first time a voice engine is used, its model is downloaded once (about 340 MB for Kokoro, 400 MB for Supertonic) and kept on your device. WebGPU is used when available; otherwise the voice runs on the CPU, which is slower.

PRE-RELEASE
This is an early version. Use the feedback button in the bar to report a bug or suggest a feature.

Open source (GPL-3.0): https://github.com/chunky-bits/narrator-of-mordor
Voice models: Kokoro-82M (Apache-2.0) and Supertonic 3 (OpenRAIL-M).
```

**Graphic assets** (in `store/`):

| Asset | File |
| --- | --- |
| Store icon (128×128) | `public/icons/icon-128.png` |
| Screenshots (1280×800) | `store/screenshots/1-reading.png`, `2-rsvp.png`, `3-settings.png`, `4-options.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

Screenshot captions, if asked: "Reading with sentence and word highlighting",
"Speed reading (RSVP) in the Gondor light theme", "Settings with colour themes",
"Narration Options and the Voice Builder".

**Homepage URL:** https://github.com/chunky-bits/narrator-of-mordor

**Support URL:** https://github.com/chunky-bits/narrator-of-mordor/issues

## Privacy practices tab

**Single purpose:**

```text
Reads the text of web pages aloud with on-device text-to-speech, highlighting the sentence and word being spoken.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's narration settings (voice, speed, colours, custom voices) and which tabs have the narration bar open. |
| `unlimitedStorage` | Keeps the downloaded voice models (340–400 MB per engine) in the browser cache, so Chrome does not delete them when disk space runs low and they need not be downloaded again. |
| `offscreen` | Runs the text-to-speech models in an offscreen document, which provides the WebGPU and worker threads that speech generation needs. |
| `scripting` | Injects the narration bar into tabs that were already open when the extension was installed or enabled, when the user clicks the toolbar icon. |
| Host permission (`<all_urls>`) | The narration bar must work on any page the user chooses to listen to: it reads the page's text and highlights the spoken words. Also used to download the voice models from the project's GitHub releases. Page content is processed locally and never transmitted. |

**Are you using remote code?** No. All JavaScript and WebAssembly is in the package.
The downloaded voice models are data (neural network weights), not code.

**Data usage:** tick none of the data types — the extension does not collect or
transmit user data. (The feedback form is filled into a GitHub page that the user
reviews and submits themselves; nothing is sent by the extension.)

Certify all three statements (no selling or transfer of user data, no use unrelated to
the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** https://github.com/chunky-bits/narrator-of-mordor/blob/master/PRIVACY.md

## Distribution tab

- **Visibility:** Private (trusted testers) or Unlisted for the pre-release
- **Regions:** all
- **Pricing:** free

## Test instructions (optional, for the reviewer)

```text
No account is needed. Open any article (for example a Wikipedia page), click the toolbar icon to show the bar at the bottom, and press play. The first playback downloads the Kokoro voice model (about 340 MB) from GitHub; progress is shown in the bar. Engine settings are on the options page.
```
