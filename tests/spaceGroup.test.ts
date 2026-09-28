import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addGroup, addWindow, fake, resetFake } from './fakeChrome';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { setStorageForTests } from '../src/storage';
import { getState, resetStateForTests } from '../src/background/state';
import { captureWindow, createSpaceFromWindow, detachWindow, reattachWindows, switchSpace } from '../src/background/switcher';
import { addToSpaceGroup, colorFor, refreshSpaceGroups } from '../src/background/spaceGroup';
import { sweep } from '../src/background/suspender';

let store: LocalStorageProvider;
beforeEach(async () => {
  resetFake();
  resetStateForTests();
  fake.local.switcher = { lazyLoad: false, homeTab: false, showSpaceGroup: true };
  store = new LocalStorageProvider(`test-${crypto.randomUUID()}`);
  await store.init();
  setStorageForTests(store);
});
afterEach(() => store.close());

const tabsOf = (w: number) => fake.tabs.filter(t => t.windowId === w);
const groupOf = (w: number) => fake.groups.get(getState(w).groupId!);

describe('Space tab group', () => {
  it('groups the loose tabs under the Space name when a Space is created, leaving user groups and pinned tabs alone', async () => {
    const w = addWindow([{ url: 'https://mail.com/', pinned: true }, { url: 'https://a.com/' }, { url: 'https://b.com/' }, { url: 'https://c.com/' }]);
    const docs = addGroup(w, ['https://c.com/'], { title: 'Docs', color: 'blue' });
    const space = await createSpaceFromWindow(w, 'Work');

    expect(groupOf(w)).toMatchObject({ title: 'Work', color: colorFor(space.id) });
    const byUrl = Object.fromEntries(tabsOf(w).map(t => [t.url, t.groupId]));
    expect(byUrl['https://a.com/']).toBe(getState(w).groupId);
    expect(byUrl['https://b.com/']).toBe(getState(w).groupId);
    expect(byUrl['https://c.com/']).toBe(docs);
    expect(byUrl['https://mail.com/']).toBe(-1);
  });

  it('never reorders tabs: loose tabs cut off by a user group stay loose, and new tabs join only when next to the group', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }, { url: 'https://c.com/' }]);
    const docs = addGroup(w, ['https://b.com/'], { title: 'Docs', color: 'blue' });
    await createSpaceFromWindow(w, 'Work');
    const gid = getState(w).groupId;
    const g = (url: string) => fake.tabs.find(t => t.url === url)!.groupId;
    expect([g('https://a.com/'), g('https://b.com/'), g('https://c.com/')]).toEqual([gid, docs, -1]);

    // Opened at the end, after the loose c.com: not next to the Space group, so it stays put.
    const far = await chrome.tabs.create({ windowId: w, url: 'https://far.com/' });
    await addToSpaceGroup(fake.tabs.find(t => t.id === far.id)!);
    expect(g('https://far.com/')).toBe(-1);
  });

  it('is never saved as part of the Space', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
    addGroup(w, ['https://b.com/'], { title: 'Docs', color: 'blue' });
    await createSpaceFromWindow(w, 'Work');
    const { tabs, groups } = await captureWindow(w);
    expect(groups.map(g => g.title)).toEqual(['Docs']);
    expect(tabs.find(t => t.url === 'https://a.com/')!.groupKey).toBeUndefined();
  });

  it('moves to the new Space on a switch, and the old one does not come back', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    const work = await createSpaceFromWindow(w, 'Work');
    await store.putSpace({ id: 'h', workspaceId: 'personal', name: 'Home', tabs: [{ url: 'https://h.com/', pinned: false }], groups: [], activeIndex: 0 });
    await switchSpace(w, 'h');
    expect(groupOf(w)).toMatchObject({ title: 'Home', color: colorFor('h') });
    expect([...fake.groups.values()].map(g => g.title)).toEqual(['Home']);
    await switchSpace(w, work.id);
    expect((await store.getSpace(work.id))!.groups).toEqual([]);
    expect(groupOf(w)!.title).toBe('Work');
  });

  it('pulls new ungrouped tabs into the group, but not pinned tabs or tabs in user groups', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    const created = await chrome.tabs.create({ windowId: w, url: 'https://new.com/' });
    const pinned = await chrome.tabs.create({ windowId: w, url: 'https://pin.com/', pinned: true });
    await addToSpaceGroup(fake.tabs.find(t => t.id === created.id)!);
    await addToSpaceGroup(fake.tabs.find(t => t.id === pinned.id)!);
    expect(fake.tabs.find(t => t.id === created.id)!.groupId).toBe(getState(w).groupId);
    expect(fake.tabs.find(t => t.id === pinned.id)!.groupId).toBe(-1);
  });

  it('follows renames, and goes away on detach or when the Space is deleted', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    const space = await createSpaceFromWindow(w, 'Work');
    const { rev, updatedAt: _u, ...input } = (await store.getSpace(space.id))!;
    await store.putSpace({ ...input, name: 'Deep work' }, rev);
    await refreshSpaceGroups();
    expect(groupOf(w)!.title).toBe('Deep work');

    await detachWindow(w);
    expect(fake.groups.size).toBe(0);
    expect(getState(w).groupId).toBeUndefined();

    const w2 = addWindow([{ url: 'https://b.com/' }]);
    const other = await createSpaceFromWindow(w2, 'Other');
    await store.deleteSpace(other.id);
    await refreshSpaceGroups();
    expect(tabsOf(w2)[0].groupId).toBe(-1);
  });

  it('can be turned off', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    fake.local.switcher = { lazyLoad: false, homeTab: false, showSpaceGroup: false };
    await refreshSpaceGroups();
    expect(tabsOf(w)[0].groupId).toBe(-1);
  });

  it('adopts the restored group after a browser restart instead of saving it as a user group', async () => {
    const w = addWindow([{ url: 'https://a.com/' }, { url: 'https://b.com/' }]);
    const space = await createSpaceFromWindow(w, 'Work');
    const gid = getState(w).groupId!;
    resetStateForTests(); // session state is gone after a restart; Chrome restores the group itself
    await reattachWindows();
    expect(getState(w)).toMatchObject({ spaceId: space.id, groupId: gid });
    expect((await captureWindow(w)).groups).toEqual([]);
  });

  it('does not count as a group for "Skip tabs in groups"', async () => {
    const w = addWindow([{ url: 'https://a.com/', active: true }, { url: 'https://old.com/', lastAccessed: 0 }]);
    await createSpaceFromWindow(w, 'Work');
    fake.local.suspender = { skipGrouped: true };
    await sweep(10_000_000);
    expect(fake.tabs.find(t => t.url === 'https://old.com/')!.discarded).toBe(true);
  });
});
