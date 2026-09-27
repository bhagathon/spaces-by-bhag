import { getStorage } from '../storage';
import { hashJson, newId } from '../shared/ids';
import { captureWindow } from './switcher';
import { getState, isBusy } from './state';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Last stored hash per window; lost on worker restart, which costs at most one duplicate. */
const lastHash = new Map<number, string>();

/** Store a snapshot of each normal window, but only when its layout changed. */
export async function snapshotAllWindows(now = Date.now()) {
  const store = await getStorage();
  let written = 0;
  for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
    const windowId = w.id!;
    // Incognito windows are never written to disk (Tabox #81/#60 raised incognito handling).
    if (w.incognito || isBusy(windowId)) continue;
    const { tabs, groups } = await captureWindow(windowId);
    if (!tabs.length) continue;
    const spaceId = getState(windowId).spaceId;
    const hash = await hashJson({ spaceId, tabs: tabs.map(t => [t.url, t.pinned, t.groupKey ?? null]), groups });
    if (lastHash.get(windowId) === hash) continue;
    lastHash.set(windowId, hash);
    await store.appendSnapshot({ id: newId(), spaceId, windowId, takenAt: now, hash, tabs, groups });
    written++;
  }
  return written;
}

export async function pruneSnapshots(now = Date.now()) {
  return (await getStorage()).pruneSnapshots(now - RETENTION_MS);
}

export function forgetWindowHash(windowId: number) {
  lastHash.delete(windowId);
}
