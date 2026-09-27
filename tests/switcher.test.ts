import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addGroup, addWindow, fake, resetFake } from './fakeChrome';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { setStorageForTests } from '../src/storage';
import { getState, resetStateForTests } from '../src/background/state';
import { captureWindow, createSpaceFromWindow, detachWindow, reattachWindows, restoreSnapshot, switchSpace } from '../src/background/switcher';
import { snapshotAllWindows } from '../src/background/snapshots';

let store: LocalStorageProvider;
beforeEach(async () => {
  resetFake();
  resetStateForTests();
  store = new LocalStorageProvider(`test-${crypto.randomUUID()}`);
  await store.init();
  setStorageForTests(store);
});
afterEach(() => store.close());

const urls = (windowId: number) => fake.tabs.filter(t => t.windowId === windowId).map(t => t.url);
const flush = () => new Promise(r => setTimeout(r, 10));

describe('switchSpace', () => {
  it('swaps tabs, restores groups and active tab, and never empties the window', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/', active: true }, { url: 'https://c.com/' }]);
    addGroup(w, ['https://b.com/', 'https://c.com/'], { title: 'Docs', color: 'blue', collapsed: true });
    const work = await createSpaceFromWindow(w, 'Work');
    expect(work.groups).toEqual([{ key: 'g0', title: 'Docs', color: 'blue', collapsed: true }]);
    expect(work.activeIndex).toBe(1);

    const { space: home } = (await store.putSpace({
      id: 'home', workspaceId: 'personal', name: 'Home', activeIndex: 0, groups: [],
      tabs: [{ url: 'https://x.com/', pinned: false }, { url: 'https://y.com/', pinned: false }],
    })) as { space: { id: string } };

    await switchSpace(w, home.id);
    expect(urls(w)).toEqual(['https://x.com/', 'https://y.com/']);
    expect(fake.minTabsAfterRemove).toBeGreaterThan(0);
    expect(getState(w)).toMatchObject({ spaceId: 'home', phase: 'idle' });

    await switchSpace(w, work.id);
    expect(urls(w)).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/']);
    const tabs = fake.tabs.filter(t => t.windowId === w);
    expect(tabs.find(t => t.active)?.url).toBe('https://b.com/');
    const group = fake.groups.get(tabs[1].groupId)!;
    expect(group).toMatchObject({ title: 'Docs', color: 'blue', collapsed: false }); // holds the active tab
    expect(tabs[2].groupId).toBe(tabs[1].groupId);
    expect(tabs[0].groupId).toBe(-1);

    await flush();
    expect(tabs.filter(t => !t.active).map(t => fake.tabs.find(x => x.id === t.id)!.discarded)).toEqual([true, true]);
  });

  it('saves edits to the outgoing Space before leaving it', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    const work = await createSpaceFromWindow(w, 'Work');
    await chrome.tabs.create({ windowId: w, url: 'https://new.com/' });
    await store.putSpace({ id: 'empty', workspaceId: 'personal', name: 'Empty', tabs: [], groups: [], activeIndex: 0 });

    await switchSpace(w, 'empty');
    expect((await store.getSpace(work.id))!.tabs.map(t => t.url)).toEqual(['https://a.com/', 'https://new.com/']);
    // Switching into an empty Space opens the dashboard so the window survives.
    expect(urls(w)).toEqual(['chrome-extension://ext/dashboard.html']);
  });

  it('keeps pinned tabs in place and out of Spaces', async () => {
    const w = addWindow([{ url: 'https://mail.com/', pinned: true }, { url: 'https://a.com/', active: true }]);
    const work = await createSpaceFromWindow(w, 'Work');
    expect(work.tabs.map(t => t.url)).toEqual(['https://a.com/']);
    await store.putSpace({ id: 'h', workspaceId: 'personal', name: 'H', tabs: [{ url: 'https://h.com/', pinned: false }], groups: [], activeIndex: 0 });
    await switchSpace(w, 'h');
    expect(urls(w)).toEqual(['https://mail.com/', 'https://h.com/']);
  });

  it('skips a tab that cannot be opened without failing the switch', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await store.putSpace({
      id: 'f', workspaceId: 'personal', name: 'F', groups: [{ key: 'g0', title: 'G', color: 'red', collapsed: false }], activeIndex: 1,
      tabs: [{ url: 'https://ok.com/', pinned: false, groupKey: 'g0' }, { url: 'file:///x', pinned: false, groupKey: 'g0' }],
    });
    await switchSpace(w, 'f');
    expect(urls(w)).toEqual(['https://ok.com/']);
    expect(fake.tabs.find(t => t.url === 'https://ok.com/')!.active).toBe(true);
  });

  it('is a no-op when the target is already attached', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    const work = await createSpaceFromWindow(w, 'Work');
    const before = fake.tabs.map(t => t.id);
    await switchSpace(w, work.id);
    expect(fake.tabs.map(t => t.id)).toEqual(before);
  });

  it('serializes concurrent switches on one window', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    for (const id of ['p', 'q']) {
      await store.putSpace({ id, workspaceId: 'personal', name: id, tabs: [{ url: `https://${id}.com/`, pinned: false }], groups: [], activeIndex: 0 });
    }
    await Promise.all([switchSpace(w, 'p'), switchSpace(w, 'q')]);
    expect(urls(w)).toEqual(['https://q.com/']);
    expect((await store.getSpace('p'))!.tabs.map(t => t.url)).toEqual(['https://p.com/']);
  });
});

describe('captureWindow', () => {
  it('produces identical output for identical layouts (stable group keys)', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
    addGroup(w, ['https://b.com/'], { title: 'X', color: 'green' });
    const first = await captureWindow(w);
    expect(await captureWindow(w)).toEqual(first);
  });

  it('excludes new-tab and extension pages', async () => {
    const w = addWindow([{ url: 'chrome://newtab/' }, { url: 'chrome-extension://ext/dashboard.html' }, { url: 'https://a.com/' }]);
    expect((await captureWindow(w)).tabs.map(t => t.url)).toEqual(['https://a.com/']);
  });
});

describe('snapshots', () => {
  it('only writes a snapshot when the layout changes, and can restore one as a new Space', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    expect(await snapshotAllWindows(1)).toBe(1);
    expect(await snapshotAllWindows(2)).toBe(0);
    await chrome.tabs.create({ windowId: w, url: 'https://b.com/' });
    expect(await snapshotAllWindows(3)).toBe(1);

    const [latest, first] = await store.listSnapshots({});
    expect(latest.tabs).toHaveLength(2);
    const restored = await restoreSnapshot(w, first.id);
    expect(restored.name).toMatch(/^Window \(restored /);
    expect(urls(w)).toEqual(['https://a.com/']);
    expect(getState(w).spaceId).toBe(restored.id);
  });
});

// Regressions for problems reported against Tabox (#94, #48, #81, #55, #90).
describe('issues shared with Tabox', () => {
  it('dissolves the outgoing groups before closing their tabs (no saved-group duplicates)', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/', active: true }]);
    addGroup(w, ['https://a.com/', 'https://b.com/'], { title: 'G', color: 'red' });
    const oldIds = fake.tabs.map(t => t.id);
    await createSpaceFromWindow(w, 'Work');
    await store.putSpace({ id: 'h', workspaceId: 'personal', name: 'H', tabs: [{ url: 'https://h.com/', pinned: false }], groups: [], activeIndex: 0 });
    await switchSpace(w, 'h');
    expect(fake.ungrouped.sort()).toEqual(oldIds.sort());
  });

  it('re-attaches a restored window by its tabs, but never one the user detached', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
    const work = await createSpaceFromWindow(w, 'Work');
    // Crash: the window is gone, then comes back with a new ID and no state.
    await chrome.tabs.remove(fake.tabs.filter(t => t.windowId === w).map(t => t.id!));
    resetStateForTests();
    const restored = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
    const other = addWindow([{ url: 'https://a.com/' }]); // one matching tab isn't enough
    await reattachWindows();
    expect(getState(restored).spaceId).toBe(work.id);
    expect(getState(other).spaceId).toBeNull();

    await detachWindow(restored);
    await reattachWindows();
    expect(getState(restored)).toMatchObject({ spaceId: null, detached: true });
  });

  it('never snapshots or re-attaches incognito windows', async () => {
    const w = addWindow([{ url: 'https://private.com/' }, { url: 'https://p2.com/' }]);
    fake.incognito.add(w);
    expect(await snapshotAllWindows(1)).toBe(0);
    await store.putSpace({ id: 'p', workspaceId: 'personal', name: 'P', groups: [], activeIndex: 0, tabs: [{ url: 'https://private.com/', pinned: false }, { url: 'https://p2.com/', pinned: false }] });
    await reattachWindows();
    expect(getState(w).spaceId).toBeNull();
  });

  it('never opens script URLs from a stored Space', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await store.putSpace({
      id: 'x', workspaceId: 'personal', name: 'X', groups: [], activeIndex: 0,
      tabs: [{ url: 'javascript:alert(1)', pinned: false }, { url: 'https://ok.com/', pinned: false }],
    });
    await switchSpace(w, 'x');
    expect(urls(w)).toEqual(['https://ok.com/']);
  });

  it('reports when it focused another window instead of switching', async () => {
    const w1 = addWindow([{ url: 'https://a.com/' }]);
    const w2 = addWindow([{ url: 'https://b.com/' }]);
    const b = await createSpaceFromWindow(w2, 'B');
    await createSpaceFromWindow(w1, 'A');
    expect(await switchSpace(w1, b.id)).toBe('focused');
    expect(urls(w1)).toEqual(['https://a.com/']);
  });
});
