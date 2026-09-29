import { getGeminiConfig, orderByTopic } from '../shared/gemini';
import { getState, withWindowLock } from './state';
import { isHomeTab } from './homeTab';
import { saveWindowToSpace } from './switcher';
import { refreshSpaceGroups } from './spaceGroup';

/** The tabs a sort may move: not pinned, not the home tab, and not in a group the user made. */
async function sortable(windowId: number) {
  const spaceGroup = getState(windowId).groupId;
  return (await chrome.tabs.query({ windowId })).filter(
    t => t.id !== undefined && !t.pinned && !isHomeTab(t) && (t.groupId === -1 || t.groupId === spaceGroup),
  );
}

/** What the window's sortable tabs are, so auto-sort skips a window it already sorted. */
const lastSorted = new Map<number, string>();
const fingerprint = (tabs: chrome.tabs.Tab[]) => tabs.map(t => t.url || t.pendingUrl || '').sort().join('\n');

/**
 * Sorts a window's tabs by topic with Gemini. The tabs move as one block to where the
 * first of them was, so pinned tabs, the home tab and the user's own groups stay put.
 */
export async function sortWindowTabs(windowId: number): Promise<{ moved: boolean; topics: string[] }> {
  const { apiKey } = await getGeminiConfig();
  if (!apiKey) throw new Error('Add a Gemini API key in Settings to sort tabs.');
  const tabs = await sortable(windowId);
  if (tabs.length < 3) return { moved: false, topics: [] };
  const { order, topics } = await orderByTopic(
    tabs.map(t => ({ title: t.title ?? '', url: t.url || t.pendingUrl || '' })),
    apiKey,
  );
  return withWindowLock(windowId, async () => {
    // Tabs may have opened or closed while Gemini thought: keep the ones still here,
    // and put any new ones after them in their current order.
    const now = await sortable(windowId);
    const nowIds = new Set(now.map(t => t.id!));
    const ids = order.map(i => tabs[i].id!).filter(id => nowIds.has(id));
    for (const t of now) if (!ids.includes(t.id!)) ids.push(t.id!);
    lastSorted.set(windowId, fingerprint(now));
    if (ids.every((id, i) => id === now[i].id)) return { moved: false, topics };
    await chrome.tabs.move(ids, { index: now[0].index });
    await refreshSpaceGroups();
    await saveWindowToSpace(windowId);
    return { moved: true, topics };
  });
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Auto-sort: a few seconds after tabs settle, when it's on and the tabs have changed. */
export async function scheduleAutoSort(windowId: number) {
  const { apiKey, autoSort } = await getGeminiConfig();
  if (!apiKey || !autoSort) return;
  clearTimeout(timers.get(windowId));
  timers.set(
    windowId,
    setTimeout(async () => {
      timers.delete(windowId);
      const tabs = await sortable(windowId).catch(() => []);
      if (tabs.length < 3 || lastSorted.get(windowId) === fingerprint(tabs)) return;
      await sortWindowTabs(windowId).catch(e => console.warn('Spaces: auto-sort failed', e));
    }, 8000),
  );
}

export function forgetSortedWindow(windowId: number) {
  clearTimeout(timers.get(windowId));
  timers.delete(windowId);
  lastSorted.delete(windowId);
}
