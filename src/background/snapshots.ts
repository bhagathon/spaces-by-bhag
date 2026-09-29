import { getStorage } from '../storage';
import { hashJson, newId } from '../shared/ids';
import { captureWindow } from './switcher';
import { getState, isBusy } from './state';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Last stored hash per window; lost on worker restart, which costs at most one duplicate. */
const lastHash = new Map<number, string>();

/** Store a snapshot of each normal window, but only when its layout changed. */
export async function snapshotAllWindows(now = Date.now()) {
  let written = 0;
  for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
    // Incognito windows are never written to disk (Tabox #81/#60 raised incognito handling).
    if (w.incognito || isBusy(w.id!)) continue;
    if (await snapshotWindow(w.id!, now)) written++;
  }
  return written;
}

/** Snapshot one window, tabs not added to its Space included. Returns whether one was written. */
export async function snapshotWindow(windowId: number, now = Date.now()) {
  const { tabs, groups } = await captureWindow(windowId, { includeLoose: true });
  if (!tabs.length) return false;
  const spaceId = getState(windowId).spaceId;
  const hash = await hashJson({ spaceId, tabs: tabs.map(t => [t.url, t.pinned, t.groupKey ?? null]), groups });
  if (lastHash.get(windowId) === hash) return false;
  lastHash.set(windowId, hash);
  await (await getStorage()).appendSnapshot({ id: newId(), spaceId, windowId, takenAt: now, hash, tabs, groups });
  return true;
}

export async function pruneSnapshots(now = Date.now()) {
  return (await getStorage()).pruneSnapshots(now - RETENTION_MS);
}

export function forgetWindowHash(windowId: number) {
  lastHash.delete(windowId);
}
