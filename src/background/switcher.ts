import { getStorage, PERSONAL_WORKSPACE_ID } from '../storage';
import { newId } from '../shared/ids';
import { getSwitcherSettings } from '../shared/settings';
import { canEdit, type SavedGroup, type SavedTab, type Space } from '../shared/types';
import { isSafeUrl } from '../shared/url';
import { allStates, getState, setState, withWindowLock } from './state';
import { ensureSpaceGroup } from './spaceGroup';
import { dashboardUrl, ensureHomeTab, isHomeTab } from './homeTab';
import { snapshotWindow } from './snapshots';

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

function isRestorable(url?: string): url is string {
  return (
    isSafeUrl(url) &&
    url !== 'chrome://newtab/' &&
    !url.startsWith('about:blank') &&
    !url.startsWith(chrome.runtime.getURL(''))
  );
}

export interface Capture {
  tabs: SavedTab[];
  groups: SavedGroup[];
  activeIndex: number;
  /** Tabs the Space owns and a switch would close (excludes kept pinned tabs). */
  ownedTabIds: number[];
  /** The live tab behind each entry of `tabs`, in the same order. */
  tabIds: number[];
}

/**
 * The window's tabs as its Space would save them. Tabs the user hasn't added to the
 * Space are left out unless `includeLoose` (snapshots keep them, so History has them).
 */
export async function captureWindow(windowId: number, { includeLoose = false } = {}): Promise<Capture> {
  const { keepPinnedAcrossSpaces } = await getSwitcherSettings();
  const tabs = await chrome.tabs.query({ windowId });
  const owned = tabs.filter(t => !(keepPinnedAcrossSpaces && t.pinned) && !isHomeTab(t));
  // The Space group labels the window; its tabs are saved as ungrouped.
  const spaceGroup = getState(windowId).groupId;
  const groupOf = (t: chrome.tabs.Tab) => (t.groupId === spaceGroup ? NONE : t.groupId);

  // Keys are assigned by order of appearance so identical layouts produce identical captures.
  const keyFor = new Map<number, string>();
  for (const t of owned) if (groupOf(t) !== NONE && !keyFor.has(t.groupId)) keyFor.set(t.groupId, `g${keyFor.size}`);

  const groups: SavedGroup[] = await Promise.all(
    [...keyFor].map(async ([id, key]) => {
      const g = await chrome.tabGroups.get(id);
      return { key, title: g.title ?? '', color: g.color, collapsed: g.collapsed };
    }),
  );

  const loose = new Set(includeLoose ? [] : (getState(windowId).looseTabIds ?? []));
  const saved: SavedTab[] = [];
  const tabIds: number[] = [];
  let activeIndex = 0;
  for (const t of owned) {
    const url = t.url || t.pendingUrl; // discarded tabs still report their url
    if (!isRestorable(url) || loose.has(t.id!)) continue;
    tabIds.push(t.id!);
    if (t.active) activeIndex = saved.length;
    saved.push({
      url,
      title: t.title,
      // Inline data: favicons can be tens of KB each; keep synced documents small.
      favIconUrl: t.favIconUrl?.startsWith('data:') ? undefined : t.favIconUrl,
      pinned: t.pinned,
      groupKey: groupOf(t) !== NONE ? keyFor.get(t.groupId) : undefined,
    });
  }
  return { tabs: saved, groups, activeIndex, ownedTabIds: owned.map(t => t.id!), tabIds };
}

async function workspaceOf(workspaceId: string) {
  return (await (await getStorage()).listWorkspaces()).find(w => w.id === workspaceId);
}

/**
 * Commit the window's current tabs to the Space it's attached to. The window is
 * the source of truth for its tabs, so a concurrent write (a rename from the UI,
 * a change synced from another device) is re-read and the tabs re-applied on top.
 */
export async function saveWindowToSpace(windowId: number) {
  const { spaceId } = getState(windowId);
  if (!spaceId) return;
  const store = await getStorage();
  const { tabs, groups, activeIndex } = await captureWindow(windowId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await store.getSpace(spaceId);
    if (!existing || !canEdit(await workspaceOf(existing.workspaceId))) return;
    const { rev: _rev, updatedAt: _u, ...input } = existing;
    if (JSON.stringify([input.tabs, input.groups, input.activeIndex]) === JSON.stringify([tabs, groups, activeIndex])) return;
    if ((await store.putSpace({ ...input, tabs, groups, activeIndex }, existing.rev)).ok) return;
  }
}

export async function createSpaceFromWindow(windowId: number, name: string, workspaceId = PERSONAL_WORKSPACE_ID): Promise<Space> {
  return withWindowLock(windowId, async () => {
    if (!canEdit(await workspaceOf(workspaceId))) throw new Error('You have view-only access to that workspace');
    await saveWindowToSpace(windowId); // don't lose edits to the Space we're leaving
    await setState(windowId, { looseTabIds: undefined }); // a new Space takes every tab in the window
    const { tabs, groups, activeIndex } = await captureWindow(windowId);
    const store = await getStorage();
    const res = await store.putSpace({ id: newId(), workspaceId, name, tabs, groups, activeIndex });
    if (!res.ok) throw new Error('Unexpected conflict creating a Space');
    await setState(windowId, { spaceId: res.space.id, detached: false });
    await ensureHomeTab(windowId).catch(() => {});
    await ensureSpaceGroup(windowId).catch(() => {});
    return res.space;
  });
}

export async function detachWindow(windowId: number) {
  return withWindowLock(windowId, async () => {
    await saveWindowToSpace(windowId);
    // The Space's tabs stay labelled with its name; tabs opened outside it stay outside.
    await ensureSpaceGroup(windowId, undefined, { force: true }).catch(() => {});
    await setState(windowId, { spaceId: null, detached: true, looseTabIds: undefined });
  });
}

/**
 * Resolve true once the tab can be discarded without going blank: its URL has
 * committed (a tab discarded before that is an empty tab forever, Tabox #77/#53)
 * and it has a title or finished loading (so the tab strip isn't a row of blanks).
 * Resolve false if the URL never committed; that tab is left loading.
 */
function waitUntilDiscardable(tabId: number, timeoutMs = 10_000): Promise<boolean> {
  return new Promise(resolve => {
    let committed = false;
    let titled = false;
    const finish = (ok: boolean) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(ok);
    };
    const check = () => committed && titled && finish(true);
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id !== tabId) return;
      if (info.url || (tab.url && !tab.pendingUrl)) committed = true;
      if (info.title || info.status === 'complete') titled = true;
      check();
    };
    const timer = setTimeout(() => finish(committed), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      t => {
        if (t.url && !t.pendingUrl) committed = true;
        if (t.status === 'complete') titled = true;
        check();
      },
      () => finish(false),
    );
  });
}

/**
 * Safely replace the window's tabs with another Space:
 *   1. capture + save the outgoing Space
 *   2. create the incoming tabs (window is never empty, so it never closes)
 *   3. remove the outgoing tabs
 *   4. rebuild groups, activate, and lazily discard background tabs
 * Any failure before step 3 finishes rolls back by closing the tabs this switch created.
 */
export type SwitchResult = 'switched' | 'focused' | 'unchanged';

export function switchSpace(windowId: number, targetSpaceId: string): Promise<SwitchResult> {
  return withWindowLock(windowId, async (): Promise<SwitchResult> => {
    if (getState(windowId).spaceId === targetSpaceId) return 'unchanged';
    const store = await getStorage();
    const target = await store.getSpace(targetSpaceId);
    if (!target) throw new Error(`Space ${targetSpaceId} not found`);

    // The same Space open in another window: focus that window instead of duplicating it.
    for (const [otherId, s] of allStates()) {
      if (otherId !== windowId && s.spaceId === targetSpaceId) {
        const exists = await chrome.windows.get(otherId).then(() => true, () => false);
        if (exists) {
          // Tell the caller, so the UI can say so instead of appearing to do nothing (Tabox #90).
          await chrome.windows.update(otherId, { focused: true });
          return 'focused';
        }
      }
    }

    const { lazyLoad } = await getSwitcherSettings();
    const created: (number | undefined)[] = [];

    try {
      // Tabs never added to the Space close in this switch; snapshot first so History keeps them.
      if (getState(windowId).looseTabIds?.length) await snapshotWindow(windowId).catch(() => {});
      await setState(windowId, { phase: 'capturing', switchId: newId() });
      await saveWindowToSpace(windowId);
      const { ownedTabIds } = await captureWindow(windowId);

      await setState(windowId, { phase: 'opening' });
      const homeId = (await chrome.tabs.query({ windowId })).find(isHomeTab)?.id;
      const openable = target.tabs.filter(t => isSafeUrl(t.url));
      // The window must never be left empty; the home tab (kept across switches) is enough.
      const source: SavedTab[] = openable.length ? target.tabs : homeId !== undefined ? [] : [{ url: dashboardUrl(), pinned: false }];
      for (const t of source) {
        // Sequential creation keeps tab order deterministic. A single bad URL
        // (e.g. file:// without permission) is skipped instead of failing the switch.
        const tab = isSafeUrl(t.url)
          ? await chrome.tabs.create({ windowId, url: t.url, pinned: t.pinned, active: false }).catch(() => undefined)
          : undefined;
        created.push(tab?.id);
      }
      const createdIds = created.filter((id): id is number => id !== undefined);
      if (!createdIds.length && homeId === undefined) {
        createdIds.push((await chrome.tabs.create({ windowId, url: dashboardUrl(), active: false })).id!);
      }

      await setState(windowId, { phase: 'closing' });
      const current = await chrome.tabs.query({ windowId });
      const stillOpen = new Set(current.map(t => t.id!));
      const toRemove = ownedTabIds.filter(id => stillOpen.has(id));
      // Dissolve the outgoing groups before closing their tabs. Closing a grouped tab set
      // leaves a "closed group" in Chrome's saved Tab Groups menu, and every switch would
      // add another duplicate (Tabox #94). Ungrouping removes the group instead.
      const grouped = current.filter(t => toRemove.includes(t.id!) && t.groupId !== NONE).map(t => t.id!);
      if (grouped.length) await chrome.tabs.ungroup(grouped as [number, ...number[]]).catch(() => {});
      if (toRemove.length) await chrome.tabs.remove(toRemove);
      await setState(windowId, { groupId: undefined, looseTabIds: undefined }); // they went with the outgoing tabs

      await setState(windowId, { phase: 'grouping' });
      const activeTabId = created[Math.min(target.activeIndex, created.length - 1)] ?? createdIds[0] ?? homeId!;
      await chrome.tabs.update(activeTabId, { active: true });

      for (const g of target.groups) {
        const tabIds = target.tabs.flatMap((t, i) => (t.groupKey === g.key && created[i] !== undefined ? [created[i]!] : []));
        if (!tabIds.length) continue;
        const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
        // Chrome won't collapse the group holding the active tab.
        await chrome.tabGroups.update(groupId, {
          title: g.title,
          color: g.color,
          collapsed: g.collapsed && !tabIds.includes(activeTabId),
        });
      }

      await ensureHomeTab(windowId, targetSpaceId).catch(() => {});
      await ensureSpaceGroup(windowId, targetSpaceId).catch(() => {});

      if (lazyLoad) {
        void Promise.all(
          createdIds
            .filter(id => id !== activeTabId)
            .map(async id => {
              if (!(await waitUntilDiscardable(id))) return;
              const tab = await chrome.tabs.get(id).catch(() => undefined);
              if (tab && !tab.active && !tab.discarded) await chrome.tabs.discard(id).catch(() => {});
            }),
        );
      }

      await setState(windowId, { phase: 'idle', spaceId: targetSpaceId, switchId: undefined, detached: false });
      return 'switched';
    } catch (err) {
      const phase = getState(windowId).phase;
      if (phase === 'capturing' || phase === 'opening') {
        const live = new Set((await chrome.tabs.query({ windowId })).map(t => t.id!));
        const orphans = created.filter((id): id is number => id !== undefined && live.has(id));
        // Never remove every tab: that would close the window.
        if (orphans.length && orphans.length < live.size) await chrome.tabs.remove(orphans).catch(() => {});
        await setState(windowId, { phase: 'idle', switchId: undefined });
      } else {
        // Old tabs are already gone; the window now shows the target Space.
        await setState(windowId, { phase: 'idle', spaceId: targetSpaceId, switchId: undefined });
      }
      throw err;
    }
  });
}

/** Restore a snapshot as a new Space (non-destructive) and switch to it. */
export async function restoreSnapshot(windowId: number, snapshotId: string) {
  const store = await getStorage();
  const snap = await store.getSnapshot(snapshotId);
  if (!snap) throw new Error(`Snapshot ${snapshotId} not found`);
  const source = snap.spaceId ? await store.getSpace(snap.spaceId) : undefined;
  const when = new Date(snap.takenAt).toLocaleString();
  const sourceWs = source && (await workspaceOf(source.workspaceId));
  const res = await store.putSpace({
    id: newId(),
    workspaceId: source && canEdit(sourceWs) ? source.workspaceId : PERSONAL_WORKSPACE_ID,
    name: `${source?.name ?? 'Window'} (restored ${when})`,
    tabs: snap.tabs,
    groups: snap.groups,
    activeIndex: 0,
  });
  if (!res.ok) throw new Error('Unexpected conflict restoring snapshot');
  await switchSpace(windowId, res.space.id);
  return res.space;
}

/** A non-idle phase at worker start means the worker died mid-switch. */
export async function recoverInterruptedSwitches() {
  for (const [windowId, s] of allStates()) {
    if (s.phase !== 'idle') {
      // We can't tell which Space the window now matches, so detach it; the snapshot ledger keeps its tabs.
      await setState(windowId, { phase: 'idle', spaceId: null, switchId: undefined });
    }
  }
}

/**
 * Window IDs change across browser restarts. Re-attach restored windows to the
 * Space whose URLs they best match (Jaccard ≥ 0.6).
 */
export async function reattachWindows() {
  const store = await getStorage();
  const spaces = (await Promise.all((await store.listWorkspaces()).map(w => store.listSpaces(w.id)))).flat();
  const claimed = new Set([...allStates().values()].map(s => s.spaceId).filter(Boolean));
  for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
    const state = getState(w.id!);
    if (w.incognito || state.spaceId || state.detached) continue;
    const { tabs } = await captureWindow(w.id!);
    const urls = new Set(tabs.map(t => t.url));
    if (!urls.size) continue;
    let best: { id: string; score: number } | undefined;
    for (const s of spaces) {
      if (claimed.has(s.id)) continue;
      const other = new Set(s.tabs.map(t => t.url));
      const inter = [...urls].filter(u => other.has(u)).length;
      const score = inter / (urls.size + other.size - inter);
      // A one-tab window only matches exactly; otherwise any window with that page open would attach.
      if (score >= 0.6 && (urls.size >= 2 || score === 1) && (!best || score > best.score)) best = { id: s.id, score };
    }
    if (best) {
      claimed.add(best.id);
      await setState(w.id!, { spaceId: best.id });
      await ensureHomeTab(w.id!).catch(() => {});
      await ensureSpaceGroup(w.id!).catch(() => {});
    }
  }
}
