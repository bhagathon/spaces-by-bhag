import { TAB_PROMPT_KEY } from '../shared/settings';
import { getState, isBusy, setState } from './state';
import { isHomeTab } from './homeTab';
import { saveWindowToSpace } from './switcher';

/**
 * Tabs opened in a Space window don't join its Space until the user says so. The panel
 * shows a brief "Add to <Space>?" slip (TAB_PROMPT_KEY) and keeps listing tabs not yet
 * added; the toolbar badge counts them, so they're visible with the panel closed.
 * Tabs never added are left out of saves and close on the next switch, after a
 * snapshot, so History still has them.
 */

export async function markNewTab(tab: chrome.tabs.Tab) {
  const { spaceId, looseTabIds = [] } = getState(tab.windowId);
  if (!spaceId || isBusy(tab.windowId) || tab.pinned || tab.id === undefined || isHomeTab(tab)) return;
  // Spaces' own pages (dashboard, panel) can never be saved into a Space; don't ask about them.
  if ((tab.pendingUrl || tab.url || '').startsWith(chrome.runtime.getURL(''))) return;
  if (looseTabIds.includes(tab.id)) return;
  await setState(tab.windowId, { looseTabIds: [...looseTabIds, tab.id] });
  await chrome.storage.session.set({ [TAB_PROMPT_KEY]: { windowId: tab.windowId, tabId: tab.id, at: Date.now() } });
  await updateBadge();
}

/** Add some (or all) of the window's tabs to its Space, and save it. */
export async function addLooseTabs(windowId: number, tabIds?: number[]) {
  const left = tabIds ? (getState(windowId).looseTabIds ?? []).filter(id => !tabIds.includes(id)) : [];
  await setState(windowId, { looseTabIds: left.length ? left : undefined });
  await saveWindowToSpace(windowId);
  await updateBadge();
}

export async function forgetLooseTab(windowId: number, tabId: number) {
  const ids = getState(windowId).looseTabIds;
  if (!ids?.includes(tabId)) return;
  const left = ids.filter(id => id !== tabId);
  await setState(windowId, { looseTabIds: left.length ? left : undefined });
  await updateBadge();
}

/** The toolbar badge: how many tabs in the focused window aren't in its Space. */
export async function updateBadge() {
  if (!chrome.action?.setBadgeText) return;
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const n = win?.id !== undefined ? (getState(win.id).looseTabIds?.length ?? 0) : 0;
  await chrome.action.setBadgeText({ text: n ? `+${n}` : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#23211d' });
}
