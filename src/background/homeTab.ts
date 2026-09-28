import { getSwitcherSettings } from '../shared/settings';
import { allStates, getState } from './state';

/**
 * The home tab: the Spaces dashboard pinned first in every Space window, like Workona's.
 * It belongs to the window, not the Space, so switching never closes it and it's never saved.
 * If the user closes it, it comes back only on the next switch, not behind their back.
 */

export const dashboardUrl = () => chrome.runtime.getURL('dashboard.html');

export const isHomeTab = (t: chrome.tabs.Tab) => t.pinned && (t.url || t.pendingUrl || '').startsWith(dashboardUrl());

export async function ensureHomeTab(windowId: number, spaceId = getState(windowId).spaceId) {
  if (!spaceId || !(await getSwitcherSettings()).homeTab) return;
  if ((await chrome.tabs.query({ windowId })).some(isHomeTab)) return;
  await chrome.tabs.create({ windowId, url: dashboardUrl(), pinned: true, active: false, index: 0 });
}

/** Apply the setting to every window: add home tabs to Space windows, or remove them all. */
export async function refreshHomeTabs() {
  if ((await getSwitcherSettings()).homeTab) {
    for (const [windowId, s] of [...allStates()]) if (s.spaceId && s.phase === 'idle') await ensureHomeTab(windowId).catch(() => {});
    return;
  }
  for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
    const tabs = await chrome.tabs.query({ windowId: w.id });
    const homes = tabs.filter(isHomeTab).map(t => t.id!);
    // Never close a window's last tab.
    if (homes.length && homes.length < tabs.length) await chrome.tabs.remove(homes).catch(() => {});
  }
}

/** ⌘⇧S: jump to this window's home tab if it has one, otherwise open the dashboard. */
export async function openDashboard() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const home = win?.id !== undefined ? (await chrome.tabs.query({ windowId: win.id })).find(isHomeTab) : undefined;
  if (home?.id !== undefined) await chrome.tabs.update(home.id, { active: true });
  else await chrome.tabs.create({ url: dashboardUrl() });
}
