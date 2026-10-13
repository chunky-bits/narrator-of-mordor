// Feedback through GitHub issues: links to the repository's issue forms
// (.github/ISSUE_TEMPLATE), pre-filled with diagnostics. The reporter reviews the issue
// on GitHub and submits it themselves, so no tokens or servers are involved.
import type { Settings } from './settings';

export const REPOSITORY = 'chunky-bits/narrator-of-mordor';

export type FeedbackKind = 'bug' | 'idea';

const TEMPLATES: Record<FeedbackKind, string> = { bug: 'bug_report.yml', idea: 'feature_request.yml' };

interface UADataValues {
  platform?: string;
  platformVersion?: string;
  fullVersionList?: { brand: string; version: string }[];
}
type UAData = { getHighEntropyValues(hints: string[]): Promise<UADataValues> };

/**
 * Browser and OS versions. The user agent string is frozen (e.g. "Chrome 129.0.0.0 on
 * Mac OS X 10.15.7"), so the client hints are preferred; they need a secure page.
 */
async function browserInfo(): Promise<string> {
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  try {
    const v = await uaData!.getHighEntropyValues(['platformVersion', 'fullVersionList']);
    const chrome = v.fullVersionList?.find((b) => /Chrom/.test(b.brand))?.version;
    if (chrome && v.platform) return `Chrome ${chrome} on ${v.platform} ${v.platformVersion ?? ''}`.trim();
  } catch {
    // no client hints (insecure page or other browser)
  }
  const ua = navigator.userAgent;
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? 'unknown';
  const os = /Windows NT [\d.]+|Mac OS X|CrOS [\w ]+|Android [\d.]+|Linux [\w]+/.exec(ua)?.[0] ?? 'unknown';
  return `Chrome ${chrome} on ${os}`;
}

export interface DiagnosticsInput {
  settings: Settings;
  /** Engine runtime status per engine, e.g. { kokoro: "WebGPU, fp32" }. */
  engineStatus: Record<string, string>;
  /** Language of the page being read (no address); absent on the options page. */
  pageLang?: string;
  lastError?: string;
}

/** Compact, non-personal diagnostics (no page content or address). */
export async function diagnostics({ settings: s, engineStatus, pageLang, lastError }: DiagnosticsInput): Promise<string> {
  const engines = Object.entries(engineStatus).map(([k, v]) => `${k}: ${v}`).join('; ') || 'not loaded';
  return [
    `Extension: ${chrome.runtime.getManifest().version}`,
    `Browser: ${await browserInfo()}`,
    `Engines: ${engines}`,
    `Voice: ${s.voice} · speed ${s.speed}×${pageLang ? ` · page language ${pageLang}` : ''}`,
    `Reading: main article ${s.articleMode ? 'on' : 'off'} · highlights ${s.sentenceHighlight ? 'sentence' : '-'}/${s.wordHighlight ? 'word' : '-'} · auto-scroll ${s.autoScroll ? 'on' : 'off'}`,
    `RSVP: ${s.rsvp ? `on (mute ${s.rsvpMute ? 'on' : 'off'}, size ${s.rsvpSize})` : 'off'}`,
    `Theme: ${s.theme} / ${s.mode}`,
    ...(lastError ? [`Last error: ${lastError}`] : []),
  ].join('\n');
}

/** Whether a URL is one of this repository's new-issue links (checked before opening). */
export function isIssueUrl(url: string): boolean {
  return url.startsWith(`https://github.com/${REPOSITORY}/issues/new?`);
}

/** URL of a new, pre-filled issue of the given kind. */
export function issueUrl(kind: FeedbackKind, diag: string, pageUrl?: string): string {
  const params = new URLSearchParams({ template: TEMPLATES[kind], diagnostics: diag });
  if (pageUrl) params.set('page-url', pageUrl);
  return `https://github.com/${REPOSITORY}/issues/new?${params}`;
}
