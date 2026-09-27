import { WINDOW_STATES_KEY } from '../shared/settings';
import type { WindowState } from '../shared/types';

/**
 * Per-window state machine: idle → capturing → opening → closing → grouping → idle.
 *
 * Persisted to chrome.storage.session so it survives the MV3 worker being killed,
 * and mirrored in memory so tab-event guards can check it synchronously.
 */
const mem = new Map<number, WindowState>();
let hydrated: Promise<void> | undefined;

export function hydrate() {
  return (hydrated ??= chrome.storage.session.get(WINDOW_STATES_KEY).then(result => {
    const saved = (result[WINDOW_STATES_KEY] ?? {}) as Record<string, WindowState>;
    for (const [id, s] of Object.entries(saved)) mem.set(Number(id), s);
  }));
}

export function getState(windowId: number): WindowState {
  return mem.get(windowId) ?? { spaceId: null, phase: 'idle' };
}

export function allStates(): Map<number, WindowState> {
  return mem;
}

async function persist() {
  await chrome.storage.session.set({ [WINDOW_STATES_KEY]: Object.fromEntries(mem) });
}

export async function setState(windowId: number, patch: Partial<WindowState>) {
  mem.set(windowId, { ...getState(windowId), ...patch });
  await persist();
}

export async function forgetWindow(windowId: number) {
  mem.delete(windowId);
  await persist();
}

export const isBusy = (windowId: number) => getState(windowId).phase !== 'idle';

/** Serialize operations on a window so two switches can never interleave. */
const locks = new Map<number, Promise<unknown>>();
export function withWindowLock<T>(windowId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(windowId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(windowId, next);
  return next;
}

/** Tests only. */
export function resetStateForTests() {
  mem.clear();
  locks.clear();
  hydrated = undefined;
}
