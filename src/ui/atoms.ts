import { atom } from 'jotai';
import { flushSync } from 'react-dom';
import { getStorage } from '../storage';
import { PRESENCE_KEY, SYNC_STATUS_KEY, WINDOW_STATES_KEY } from '../shared/settings';
import type { PresenceUser, Space, SyncStatus, WindowState, Workspace } from '../shared/types';

export const windowIdAtom = atom<number | null>(null);
windowIdAtom.onMount = set => {
  void chrome.windows.getCurrent().then(w => set(w.id ?? null));
};

/**
 * Run a state change as a view transition, so elements sharing a
 * view-transition-name (a card top and the pulled card) move between places.
 */
export function withViewTransition(apply: () => void) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && typeof document !== 'undefined' && 'startViewTransition' in document) {
    document.startViewTransition(() => flushSync(apply));
  } else apply();
}

/**
 * Mirror a chrome.storage.session key into an atom. `animate(prev, next)` decides
 * whether a change runs as a view transition (a full-page snapshot, so only when
 * something visibly moves).
 */
function sessionAtom<T>(key: string, fallback: T, { animate }: { animate?: (prev: T, next: T) => boolean } = {}) {
  const a = atom<T>(fallback);
  a.onMount = set => {
    let last = fallback;
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !(key in changes)) return;
      const next = (changes[key].newValue ?? fallback) as T;
      const prev = last;
      last = next;
      if (animate?.(prev, next)) withViewTransition(() => set(next));
      else set(next);
    };
    void chrome.storage.session.get(key).then(r => set((last = (r[key] ?? fallback) as T)));
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  };
  return a;
}

/** The card pull animates only when a window changes Space, not on every state write. */
const spaceChanged = (prev: Record<string, WindowState>, next: Record<string, WindowState>) =>
  Object.keys({ ...prev, ...next }).some(id => prev[id]?.spaceId !== next[id]?.spaceId);

/** Per-window state written by the service worker. */
export const windowStatesAtom = sessionAtom<Record<string, WindowState>>(WINDOW_STATES_KEY, {}, { animate: spaceChanged });
export const syncStatusAtom = sessionAtom<SyncStatus>(SYNC_STATUS_KEY, { state: 'off', pending: 0 });
/** Other devices/people with each Space open (from the server, via the worker). */
export const presenceAtom = sessionAtom<Record<string, PresenceUser[]>>(PRESENCE_KEY, {});

const workspacesBase = atom<Workspace[]>([]);
workspacesBase.onMount = set => {
  const load = () => void getStorage().then(s => s.listWorkspaces()).then(set);
  load();
  // Workspaces arrive from the server during a sync pull.
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && SYNC_STATUS_KEY in changes) load();
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
};
export const workspacesAtom = atom(get =>
  [...get(workspacesBase)].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'personal' ? -1 : 1)),
);

/** Every Space in every workspace, kept live via the provider's subscription. */
export const spacesAtom = atom<Space[]>([]);
spacesAtom.onMount = set => {
  let unsub = () => {};
  let cancelled = false;
  void getStorage().then(async store => {
    if (cancelled) return;
    unsub = store.subscribe('*', e => {
      if (e.type === 'space.updated') set(prev => [...prev.filter(s => s.id !== e.space.id), e.space]);
      else if (e.type === 'space.deleted') set(prev => prev.filter(s => s.id !== e.spaceId));
    });
    const workspaces = await store.listWorkspaces();
    set((await Promise.all(workspaces.map(w => store.listSpaces(w.id)))).flat());
  });
  return () => {
    cancelled = true;
    unsub();
  };
};

export const currentSpaceIdAtom = atom(get => {
  const id = get(windowIdAtom);
  return id == null ? null : (get(windowStatesAtom)[id]?.spaceId ?? null);
});

/** Space ID → window IDs where it is open on this device. */
export const openSpacesAtom = atom(get => {
  const map = new Map<string, number[]>();
  for (const [wid, s] of Object.entries(get(windowStatesAtom))) {
    if (s.spaceId) map.set(s.spaceId, [...(map.get(s.spaceId) ?? []), Number(wid)]);
  }
  return map;
});
