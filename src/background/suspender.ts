import { getSuspendSettings, SUSPENSION_LOG_KEY } from '../shared/settings';
import type { SuspensionRecord } from '../shared/types';
import { isBusy } from './state';

const LOG_MAX = 500;
const PRESSURE_THRESHOLD = 0.85;
const PRESSURE_IDLE_MS = 5 * 60_000;

export function hostMatches(url: string, patterns: string[]) {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return patterns.some(p => (p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p));
}

async function memoryPressure(): Promise<number> {
  try {
    const { capacity, availableCapacity } = await chrome.system.memory.getInfo();
    return 1 - availableCapacity / capacity;
  } catch {
    return 0;
  }
}

/**
 * Discard background tabs that haven't been viewed for `idleMinutes`.
 * Per-tab idleness comes from tab.lastAccessed (Chrome 121+); chrome.idle only
 * reports whole-machine idleness, so it's used by the caller to skip sweeps while locked.
 */
export async function sweep(now = Date.now(), { force = false } = {}) {
  const s = await getSuspendSettings();
  if (!s.enabled && !force) return [];

  let idleMs = s.idleMinutes * 60_000;
  if (s.aggressiveUnderMemoryPressure && (await memoryPressure()) > PRESSURE_THRESHOLD) {
    idleMs = Math.min(idleMs, PRESSURE_IDLE_MS);
  }

  const candidates = await chrome.tabs.query({ active: false, discarded: false, autoDiscardable: true });
  const records: SuspensionRecord[] = [];

  for (const tab of candidates) {
    if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) continue;
    if (isBusy(tab.windowId)) continue; // never race the switcher
    if (s.skipPinned && tab.pinned) continue;
    if (s.skipAudible && tab.audible) continue;
    if (s.skipGrouped && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
    if (hostMatches(tab.url, s.neverSuspend)) continue;
    const lastAccessed = tab.lastAccessed ?? now;
    if (!force && now - lastAccessed < idleMs) continue;

    const discarded = await chrome.tabs.discard(tab.id).catch(() => undefined);
    if (!discarded) continue; // Chrome refused, e.g. the tab just became active

    records.push({
      tabId: discarded.id ?? tab.id, // the ID can change on discard
      windowId: tab.windowId,
      index: tab.index,
      groupId: tab.groupId,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      lastAccessed,
      suspendedAt: now,
      idleMs: now - lastAccessed,
    });
  }

  if (records.length) {
    const { [SUSPENSION_LOG_KEY]: log = [] } = await chrome.storage.local.get(SUSPENSION_LOG_KEY);
    await chrome.storage.local.set({ [SUSPENSION_LOG_KEY]: [...records.reverse(), ...(log as SuspensionRecord[])].slice(0, LOG_MAX) });
  }
  return records;
}
