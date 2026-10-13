# Privacy policy

*Narrator of Mordor — last updated 13 October 2026*

Narrator of Mordor reads web pages aloud. It does this entirely on your device: it has
no server, no accounts, no analytics and no advertising, and it does not collect, sell
or share any personal data.

## What happens to the pages you read

When you open the bar on a page, the extension reads the page's text in your browser to
split it into sentences and words, and turns it into speech with a text-to-speech model
that runs on your own computer. The text, the audio and what you read are never sent
anywhere.

## What is stored on your device

- **Settings** (voice, speed, colours, custom voices you build) are saved with
  `chrome.storage.sync`. If you use Chrome Sync, Google syncs them between your own
  browsers, like any extension's settings.
- **Which tabs have the bar open**, kept only for the browser session.
- **Voice models**, downloaded once and kept in the browser's cache (see below).

Removing the extension deletes all of this.

## Network connections

The extension connects to the internet for two things only:

1. **Downloading voice models.** The first time a voice engine is used, its model files
   (about 340–400 MB) are downloaded from this project's GitHub releases
   (`github.com/chunky-bits/narrator-of-mordor`). Like any download, GitHub receives
   your IP address and browser information for the request; see
   [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
   No information about you or the pages you read is sent.
2. **Feedback, only when you ask for it.** The feedback button opens a GitHub issue form
   in a new tab, pre-filled with technical details: the extension version, browser and
   operating system versions, the voice engine and its status, your narration settings,
   the page's language and, only if you switch it on, the page's address. Nothing is
   sent until you review the form and submit it yourself with your GitHub account, and
   the issue is then public on GitHub.

## Contact

Questions about privacy: open an issue at
<https://github.com/chunky-bits/narrator-of-mordor/issues>.
