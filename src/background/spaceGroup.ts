import { getStorage } from '../storage';
import { getSwitcherSettings } from '../shared/settings';
import { spaceColor, type GroupColor } from '../shared/types';
import { allStates, getState, isBusy, setState } from './state';

/**
 * The Space tab group: a window's loose tabs sit in a group titled with its Space's
 * name, so the tab strip shows which Space the window holds. With the setting off it
 * still appears when it tells the user something: while a tab outside the Space is
 * open (the group shows where the Space ends), and after Detach (the tabs stay labelled
 * with the Space they came from). Adding the outside tabs, or attaching the window to a
 * Space, takes it away again. Chrome can't nest groups,
 * so tabs in the user's own groups (and pinned tabs, which can't be grouped) stay out.
 * The group is window chrome, not content: captureWindow leaves it out of the Space.
 *
 * Chrome keeps a group's tabs contiguous, so grouping a tab that isn't next to the group
 * would move it. The group therefore only ever takes loose tabs already beside it (or,
 * when it's first made, the first run of loose tabs): it never reorders the user's tabs.
 */

const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

/** The Space's own colour if it has one, else a stable colour from its ID. */
export function colorFor(spaceId: string, color?: GroupColor): GroupColor {
  return spaceColor({ id: spaceId, color }); // one rule for the panel's light, dots and tab groups
}

const isLoose = (t: chrome.tabs.Tab) =>
  !t.pinned && t.groupId === NONE && !(getState(t.windowId).looseTabIds ?? []).includes(t.id!); // not-added tabs stay out

/** Loose tabs that can join the group without moving: the run touching it, or the first run if there's no group yet. */
export function joinableTabs(tabs: chrome.tabs.Tab[], groupId: number | undefined): number[] {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const members = sorted.flatMap((t, i) => (groupId !== undefined && t.groupId === groupId ? [i] : []));
  const out: number[] = [];
  if (members.length) {
    for (let i = members[0] - 1; i >= 0 && isLoose(sorted[i]); i--) out.push(sorted[i].id!);
    for (let i = members[members.length - 1] + 1; i < sorted.length && isLoose(sorted[i]); i++) out.push(sorted[i].id!);
  } else {
    const first = sorted.findIndex(isLoose);
    for (let i = first; first >= 0 && i < sorted.length && isLoose(sorted[i]); i++) out.push(sorted[i].id!);
  }
  return out;
}

export const isSpaceGroup = (windowId: number, groupId: number) => groupId !== NONE && getState(windowId).groupId === groupId;

/** Tabs opened outside the Space are in the window: the group marks where the Space ends. */
const hasOutsideTabs = (windowId: number) => (getState(windowId).looseTabIds?.length ?? 0) > 0;

export async function removeSpaceGroup(windowId: number) {
  const { groupId } = getState(windowId);
  if (groupId === undefined) return;
  const tabIds = (await chrome.tabs.query({ windowId })).filter(t => t.groupId === groupId).map(t => t.id!);
  // Ungrouping (not closing) removes the group without leaving it in Chrome's saved groups.
  if (tabIds.length) await chrome.tabs.ungroup(tabIds as [number, ...number[]]).catch(() => {});
  await setState(windowId, { groupId: undefined });
}

/**
 * Create, adopt or update the window's Space group to match its Space, the setting and
 * any tabs outside the Space. `force` makes the group even with neither (Detach).
 */
export async function ensureSpaceGroup(windowId: number, spaceId = getState(windowId).spaceId, { force = false } = {}) {
  if (!spaceId) return getState(windowId).detached ? undefined : removeSpaceGroup(windowId); // a detached window keeps its label
  const { showSpaceGroup: always, markOutsideTabs } = await getSwitcherSettings();
  if (!always && !force && !(markOutsideTabs && hasOutsideTabs(windowId))) return removeSpaceGroup(windowId);
  // Shown only to mark the Space's edge, the group takes all its tabs; the always-on group never reorders.
  const marking = !always;
  const space = await (await getStorage()).getSpace(spaceId);
  if (!space) return removeSpaceGroup(windowId);

  const color = colorFor(space.id, space.color);
  const tabs = await chrome.tabs.query({ windowId });
  let groupId = getState(windowId).groupId;
  if (groupId !== undefined && !tabs.some(t => t.groupId === groupId)) groupId = undefined;
  if (groupId === undefined) {
    // After a restart Chrome restores the group itself; adopt it rather than treating it as the user's.
    for (const id of new Set(tabs.map(t => t.groupId).filter(g => g !== NONE))) {
      const g = await chrome.tabGroups.get(id).catch(() => undefined);
      if (g && g.title === space.name && g.color === color) groupId = id;
    }
  }

  const loose = (marking ? tabs.filter(isLoose).map(t => t.id!) : joinableTabs(tabs, groupId)) as [number, ...number[]];
  if (loose.length) {
    groupId = await chrome.tabs.group(groupId !== undefined ? { tabIds: loose, groupId } : { tabIds: loose, createProperties: { windowId } });
  }
  if (groupId === undefined) return; // every tab is pinned or in the user's own groups
  if (groupId !== getState(windowId).groupId) await setState(windowId, { groupId });

  const g = await chrome.tabGroups.get(groupId);
  // Skip no-op updates: each one fires tabGroups.onUpdated.
  if (g.title !== space.name || g.color !== color) await chrome.tabGroups.update(groupId, { title: space.name, color });
}

/**
 * A tab just opened next to the Space group joins it, unless Chrome already put it in a
 * group. A tab outside the Space is kept out of the group, even when Chrome put it there
 * because it was opened from a tab in the group, and its arrival makes the group appear.
 */
export async function addToSpaceGroup(tab: chrome.tabs.Tab) {
  const { spaceId, looseTabIds = [] } = getState(tab.windowId);
  if (!spaceId || isBusy(tab.windowId) || tab.pinned) return;
  if (looseTabIds.includes(tab.id!)) {
    if (isSpaceGroup(tab.windowId, tab.groupId)) await chrome.tabs.ungroup(tab.id!).catch(() => {});
    return ensureSpaceGroup(tab.windowId);
  }
  if (isLoose(tab)) await ensureSpaceGroup(tab.windowId);
}

/** Bring every window's group in line with renames, deletions (including synced ones) and the setting. */
export async function refreshSpaceGroups() {
  for (const [windowId, s] of [...allStates()]) {
    if (!isBusy(windowId) && (s.spaceId || s.groupId !== undefined)) await ensureSpaceGroup(windowId).catch(() => {});
  }
  if (!(await getSwitcherSettings()).showSpaceGroup) await dissolveLeftoverSpaceGroups().catch(() => {});
}

/**
 * With the setting off, ungroup any Space group this worker has lost track of. Reloading
 * the extension (as every update does) clears which group labels which window, and a
 * leftover group would otherwise be saved into the Space as if the user had made it.
 * A Space group is recognised by its Space's name and colour.
 */
async function dissolveLeftoverSpaceGroups() {
  const tracked = new Set([...allStates()].map(([, s]) => s.groupId)); // e.g. a detached window's label
  const tabs = (await chrome.tabs.query({})).filter(t => t.groupId !== NONE && !tracked.has(t.groupId));
  if (!tabs.length) return;
  const store = await getStorage();
  const spaces = (await Promise.all((await store.listWorkspaces()).map(w => store.listSpaces(w.id)))).flat();
  const isLeftover = new Set(spaces.map(s => `${s.name}\u0000${colorFor(s.id, s.color)}`));
  for (const id of new Set(tabs.map(t => t.groupId))) {
    const g = await chrome.tabGroups.get(id).catch(() => undefined);
    if (!g || !isLeftover.has(`${g.title}\u0000${g.color}`)) continue;
    await chrome.tabs.ungroup(tabs.filter(t => t.groupId === id).map(t => t.id!) as [number, ...number[]]).catch(() => {});
  }
}
