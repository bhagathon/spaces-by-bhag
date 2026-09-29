/** Minimal in-memory model of the chrome.* APIs the service worker uses. */
type Tab = chrome.tabs.Tab;
type Group = { id: number; windowId: number; title: string; color: `${chrome.tabGroups.Color}`; collapsed: boolean };

const noopEvent = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });

export interface FakeState {
  tabs: Tab[];
  groups: Map<number, Group>;
  windows: Set<number>;
  nextId: number;
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  /** Smallest tab count seen in any window after a remove (0 = a window closed). */
  minTabsAfterRemove: number;
  memoryPressure: number;
  incognito: Set<number>;
  /** Tab IDs passed to tabs.ungroup, in order. */
  ungrouped: number[];
}

export const fake: FakeState = {} as FakeState;

export function resetFake() {
  Object.assign(fake, {
    tabs: [],
    groups: new Map(),
    windows: new Set(),
    nextId: 100,
    local: {},
    session: {},
    minTabsAfterRemove: Infinity,
    memoryPressure: 0.2,
    incognito: new Set(),
    ungrouped: [],
  });
}

const windowTabs = (windowId: number) => fake.tabs.filter(t => t.windowId === windowId);
function reindex(windowId: number) {
  windowTabs(windowId).forEach((t, i) => (t.index = i));
}

export function addWindow(tabs: Partial<Tab>[]): number {
  const windowId = fake.nextId++;
  fake.windows.add(windowId);
  for (const t of tabs) fake.tabs.push(makeTab(windowId, t));
  if (!windowTabs(windowId).some(t => t.active) && fake.tabs.length) windowTabs(windowId)[0].active = true;
  reindex(windowId);
  return windowId;
}

export function addGroup(windowId: number, tabUrls: string[], props: Partial<Group>): number {
  const id = fake.nextId++;
  fake.groups.set(id, { id, windowId, title: '', color: 'grey', collapsed: false, ...props });
  for (const t of windowTabs(windowId)) if (tabUrls.includes(t.url!)) t.groupId = id;
  return id;
}

function makeTab(windowId: number, t: Partial<Tab>): Tab {
  return {
    id: fake.nextId++,
    windowId,
    index: 0,
    url: '',
    title: '',
    pinned: false,
    active: false,
    discarded: false,
    autoDiscardable: true,
    audible: false,
    groupId: -1,
    status: 'complete',
    lastAccessed: Date.now(),
    highlighted: false,
    incognito: false,
    selected: false,
    frozen: false,
    ...t,
  } as Tab;
}

const clone = <T>(v: T): T => structuredClone(v);
const storageArea = (key: 'local' | 'session') => ({
  async get(k?: string | string[]) {
    const src = fake[key];
    if (k === undefined) return clone(src);
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter(x => x in src).map(x => [x, clone(src[x])]));
  },
  async set(items: Record<string, unknown>) {
    Object.assign(fake[key], clone(items));
  },
});

export function installFakeChrome() {
  resetFake();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://ext/${p}`, onMessage: noopEvent() },
    storage: { local: storageArea('local'), session: storageArea('session'), onChanged: noopEvent() },
    system: { memory: { getInfo: async () => ({ capacity: 100, availableCapacity: 100 - fake.memoryPressure * 100 }) } },
    windows: {
      async getAll() {
        return [...fake.windows].map(id => ({ id, type: 'normal', incognito: fake.incognito.has(id) }));
      },
      async get(id: number) {
        if (!fake.windows.has(id)) throw new Error(`No window with id: ${id}`);
        return { id };
      },
      async update(id: number) {
        return { id };
      },
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      async get(id: number) {
        const g = fake.groups.get(id);
        if (!g) throw new Error(`No group with id: ${id}`);
        return clone(g);
      },
      async update(id: number, props: Partial<Group>) {
        Object.assign(fake.groups.get(id)!, props);
      },
    },
    tabs: {
      onUpdated: noopEvent(),
      async query(q: { windowId?: number; active?: boolean; discarded?: boolean; autoDiscardable?: boolean }) {
        return clone(
          fake.tabs.filter(t =>
            (q.windowId === undefined || t.windowId === q.windowId) &&
            (q.active === undefined || t.active === q.active) &&
            (q.discarded === undefined || t.discarded === q.discarded) &&
            (q.autoDiscardable === undefined || t.autoDiscardable === q.autoDiscardable),
          ),
        );
      },
      async get(id: number) {
        const t = fake.tabs.find(x => x.id === id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return clone(t);
      },
      async create(p: { windowId: number; url: string; pinned?: boolean; active?: boolean; index?: number }) {
        if (p.url.startsWith('file:')) throw new Error('Cannot access file URL');
        const tab = makeTab(p.windowId, { url: p.url, pinned: !!p.pinned, title: p.url });
        const tabs = windowTabs(p.windowId);
        const insertAt = p.index ?? (p.pinned ? tabs.filter(t => t.pinned).length : tabs.length);
        const globalIndex = insertAt < tabs.length ? fake.tabs.indexOf(tabs[insertAt]) : fake.tabs.length;
        fake.tabs.splice(globalIndex, 0, tab);
        if (p.active) for (const t of windowTabs(p.windowId)) t.active = t === tab;
        reindex(p.windowId);
        return clone(tab);
      },
      async remove(ids: number | number[]) {
        const list = Array.isArray(ids) ? ids : [ids];
        for (const id of list) if (!fake.tabs.some(t => t.id === id)) throw new Error(`No tab with id: ${id}`);
        const affected = new Set(fake.tabs.filter(t => list.includes(t.id!)).map(t => t.windowId));
        fake.tabs = fake.tabs.filter(t => !list.includes(t.id!));
        for (const id of fake.groups.keys()) if (!fake.tabs.some(t => t.groupId === id)) fake.groups.delete(id);
        for (const w of affected) {
          const left = windowTabs(w);
          fake.minTabsAfterRemove = Math.min(fake.minTabsAfterRemove, left.length);
          if (!left.length) fake.windows.delete(w);
          else if (!left.some(t => t.active)) left[left.length - 1].active = true;
          reindex(w);
        }
      },
      async update(id: number, props: { active?: boolean; autoDiscardable?: boolean }) {
        const tab = fake.tabs.find(t => t.id === id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        if (props.active) for (const t of windowTabs(tab.windowId)) t.active = t === tab;
        if (props.autoDiscardable !== undefined) tab.autoDiscardable = props.autoDiscardable;
        return clone(tab);
      },
      async group({ tabIds, groupId, createProperties }: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        let id = groupId;
        if (id === undefined) {
          id = fake.nextId++;
          const windowId = createProperties?.windowId ?? fake.tabs.find(t => t.id === ids[0])!.windowId;
          fake.groups.set(id, { id, windowId, title: '', color: 'grey', collapsed: false });
        } else if (!fake.groups.has(id)) throw new Error(`No group with id: ${id}`);
        for (const t of fake.tabs) if (ids.includes(t.id!)) {
          if (t.pinned) throw new Error('Cannot group pinned tabs');
          t.groupId = id;
        }
        return id;
      },
      async ungroup(ids: number | number[]) {
        const list = Array.isArray(ids) ? ids : [ids];
        fake.ungrouped.push(...list);
        for (const t of fake.tabs) if (list.includes(t.id!)) t.groupId = -1;
        // Chrome deletes a group once its last tab leaves.
        for (const id of fake.groups.keys()) if (!fake.tabs.some(t => t.groupId === id)) fake.groups.delete(id);
      },
      async move(id: number, { index }: { index: number }) {
        const tab = fake.tabs.find(t => t.id === id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        const others = windowTabs(tab.windowId).filter(t => t !== tab);
        const at = index < 0 || index >= others.length ? others.length : index;
        fake.tabs = fake.tabs.filter(t => t !== tab);
        const globalIndex = at < others.length ? fake.tabs.indexOf(others[at]) : fake.tabs.indexOf(others[others.length - 1]) + 1;
        fake.tabs.splice(globalIndex, 0, tab);
        reindex(tab.windowId);
        return clone(tab);
      },
      async discard(id: number) {
        const t = fake.tabs.find(x => x.id === id);
        if (!t || t.active) throw new Error('Cannot discard tab');
        t.discarded = true;
        return clone(t);
      },
    },
  };
}
