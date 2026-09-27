import { FORM_GUARD_KEY, GUARDED_TABS_KEY } from '../shared/settings';

const SCRIPT_ID = 'formguard';

async function guardedTabs(): Promise<Set<number>> {
  const r = await chrome.storage.session.get(GUARDED_TABS_KEY);
  return new Set((r[GUARDED_TABS_KEY] ?? []) as number[]);
}

async function saveGuarded(tabs: Set<number>) {
  await chrome.storage.session.set({ [GUARDED_TABS_KEY]: [...tabs] });
}

/**
 * Protect or release a tab. Only tabs this module protected are ever released,
 * so a tab the user marked "never suspend" stays that way.
 */
export async function setTabDirty(tabId: number, dirty: boolean) {
  const guarded = await guardedTabs();
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) return;
  if (dirty && !guarded.has(tabId)) {
    if (!tab.autoDiscardable) return; // already protected by the user
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    guarded.add(tabId);
    await saveGuarded(guarded);
  } else if (!dirty && guarded.has(tabId)) {
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    guarded.delete(tabId);
    await saveGuarded(guarded);
  }
}

/** A new page load starts with no typed text; the content script re-asserts within 5s if that's wrong. */
export async function onTabLoading(tabId: number) {
  if ((await guardedTabs()).has(tabId)) await setTabDirty(tabId, false);
}

export async function onTabRemoved(tabId: number) {
  const guarded = await guardedTabs();
  if (guarded.delete(tabId)) await saveGuarded(guarded);
}

/** Called after the UI has obtained (or given up) the <all_urls> host permission. */
export async function setFormGuard(enabled: boolean) {
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  if (enabled) {
    if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) throw new Error('Site access was not granted');
    if (!registered) {
      await chrome.scripting.registerContentScripts([
        { id: SCRIPT_ID, js: ['formguard.js'], matches: ['http://*/*', 'https://*/*'], runAt: 'document_idle', allFrames: true },
      ]);
    }
    // Already-open pages don't get registered scripts until they reload.
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false });
    await Promise.all(
      tabs.map(t => chrome.scripting.executeScript({ target: { tabId: t.id!, allFrames: true }, files: ['formguard.js'] }).catch(() => {})),
    );
  } else {
    if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    for (const tabId of await guardedTabs()) await setTabDirty(tabId, false);
  }
  await chrome.storage.local.set({ [FORM_GUARD_KEY]: enabled });
}
