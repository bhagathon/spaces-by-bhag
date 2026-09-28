import { getStorage } from '../storage';
import { getSwitcherSettings } from '../shared/settings';
import type { GroupColor } from '../shared/types';
import { allStates, getState, isBusy, setState } from './state';

/**
 * The Space tab group: a window's loose tabs sit in a group titled with its Space's
 * name, so the tab strip shows which Space the window holds. Chrome can't nest groups,
 * so tabs in the user's own groups (and pinned tabs, which can't be grouped) stay out.
 * The group is window chrome, not content: captureWindow leaves it out of the Space.
 *
 * Chrome keeps a group's tabs contiguous, so grouping a tab that isn't next to the group
 * would move it. The group therefore only ever takes loose tabs already beside it (or,
 * when it's first made, the first run of loose tabs): it never reorders the user's tabs.
 */

const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE
const COLORS: GroupColor[] = ['blue', 'green', 'purple', 'cyan', 'orange', 'pink', 'yellow', 'red', 'grey'];

/** A stable colour per Space, so the same Space always looks the same in the tab strip. */
export function colorFor(spaceId: string): GroupColor {
  let h = 0;
  for (const c of spaceId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const isLoose = (t: chrome.tabs.Tab) => !t.pinned && t.groupId === NONE;

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

export async function removeSpaceGroup(windowId: number) {
  const { groupId } = getState(windowId);
  if (groupId === undefined) return;
  const tabIds = (await chrome.tabs.query({ windowId })).filter(t => t.groupId === groupId).map(t => t.id!);
  // Ungrouping (not closing) removes the group without leaving it in Chrome's saved groups.
  if (tabIds.length) await chrome.tabs.ungroup(tabIds as [number, ...number[]]).catch(() => {});
  await setState(windowId, { groupId: undefined });
}

/** Create, adopt or update the window's Space group to match its Space and the setting. */
export async function ensureSpaceGroup(windowId: number, spaceId = getState(windowId).spaceId) {
  if (!spaceId || !(await getSwitcherSettings()).showSpaceGroup) return removeSpaceGroup(windowId);
  const space = await (await getStorage()).getSpace(spaceId);
  if (!space) return removeSpaceGroup(windowId);

  const color = colorFor(space.id);
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

  const loose = joinableTabs(tabs, groupId) as [number, ...number[]];
  if (loose.length) {
    groupId = await chrome.tabs.group(groupId !== undefined ? { tabIds: loose, groupId } : { tabIds: loose, createProperties: { windowId } });
  }
  if (groupId === undefined) return; // every tab is pinned or in the user's own groups
  if (groupId !== getState(windowId).groupId) await setState(windowId, { groupId });

  const g = await chrome.tabGroups.get(groupId);
  // Skip no-op updates: each one fires tabGroups.onUpdated.
  if (g.title !== space.name || g.color !== color) await chrome.tabGroups.update(groupId, { title: space.name, color });
}

/** A tab just opened next to the Space group joins it, unless Chrome already put it in a group. */
export async function addToSpaceGroup(tab: chrome.tabs.Tab) {
  if (!getState(tab.windowId).spaceId || isBusy(tab.windowId) || !isLoose(tab)) return;
  await ensureSpaceGroup(tab.windowId);
}

/** Bring every window's group in line with renames, deletions (including synced ones) and the setting. */
export async function refreshSpaceGroups() {
  for (const [windowId, s] of [...allStates()]) {
    if (!isBusy(windowId) && (s.spaceId || s.groupId !== undefined)) await ensureSpaceGroup(windowId).catch(() => {});
  }
}
