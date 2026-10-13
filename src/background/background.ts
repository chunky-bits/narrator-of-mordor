// Service worker: per-tab on/off state, toolbar/shortcut toggle, and the lifetime
// of the offscreen document that hosts the TTS model.
import { isIssueUrl } from '../shared/feedback';
import { OFFSCREEN_PATH, type BackgroundRequest, type ContentMessage } from '../shared/messages';

const tabKey = (tabId: number) => `tab:${tabId}`;

async function isEnabled(tabId: number): Promise<boolean> {
  const key = tabKey(tabId);
  return Boolean((await chrome.storage.session.get(key))[key]);
}

async function setEnabled(tabId: number, enabled: boolean): Promise<void> {
  if (enabled) await chrome.storage.session.set({ [tabKey(tabId)]: true });
  else await chrome.storage.session.remove(tabKey(tabId));
  await updateBadge(tabId, enabled);
  if (!enabled) await closeEngineIfUnused();
}

async function updateBadge(tabId: number, enabled: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d9480f' });
  } catch {
    // tab already gone
  }
}

// Toolbar click and the keyboard shortcut (_execute_action) both land here.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  const enabled = !(await isEnabled(tab.id));
  await setEnabled(tab.id, enabled);
  const msg: ContentMessage = { type: 'narmor:set-enabled', enabled };
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // No content script yet (tab was open before install, or a restricted page).
    if (!enabled) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {
      await setEnabled(tab.id, false); // e.g. chrome:// pages or the Web Store
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void setEnabled(tabId, false);
});

// ---- offscreen document (model host) ----

let creating: Promise<void> | null = null;

async function hasEngine(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureEngine(): Promise<void> {
  if (await hasEngine()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      // WORKERS: the document must stay alive while idle between sentences;
      // AUDIO_PLAYBACK documents are closed after 30 s without sound.
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the local Kokoro text-to-speech model.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function closeEngineIfUnused(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  if (Object.keys(all).some((k) => k.startsWith('tab:'))) return;
  if (await hasEngine()) await chrome.offscreen.closeDocument();
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest & { target?: string }, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false; // handled by the offscreen document
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case 'narmor:get-tab-state':
      if (tabId === undefined) return false;
      isEnabled(tabId).then((enabled) => {
        void updateBadge(tabId, enabled); // tab badges reset on navigation
        sendResponse({ enabled });
      });
      return true;
    case 'narmor:open-options':
      void chrome.runtime.openOptionsPage();
      return false;
    case 'narmor:open-feedback':
      if (isIssueUrl(msg.url)) {
        void chrome.tabs.create({ url: msg.url, openerTabId: tabId, index: sender.tab ? sender.tab.index + 1 : undefined });
      }
      return false;
    case 'narmor:ensure-engine':
      ensureEngine().then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e) }),
      );
      return true;
  }
  return false;
});
