import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addWindow, fake, resetFake } from './fakeChrome';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { setStorageForTests } from '../src/storage';
import { resetStateForTests } from '../src/background/state';
import { captureWindow, createSpaceFromWindow, detachWindow, switchSpace } from '../src/background/switcher';
import { refreshHomeTabs } from '../src/background/homeTab';

const HOME = 'chrome-extension://ext/dashboard.html';
let store: LocalStorageProvider;
beforeEach(async () => {
  resetFake();
  resetStateForTests();
  fake.local.switcher = { lazyLoad: false, homeTab: true, showSpaceGroup: false };
  store = new LocalStorageProvider(`test-${crypto.randomUUID()}`);
  await store.init();
  setStorageForTests(store);
});
afterEach(() => store.close());

const strip = (w: number) => fake.tabs.filter(t => t.windowId === w).map(t => `${t.pinned ? '📌' : ''}${t.url}`);

describe('home tab', () => {
  it('is pinned first in a new Space window and never saved into the Space', async () => {
    const w = addWindow([{ url: 'https://a.com/', active: true }]);
    const space = await createSpaceFromWindow(w, 'Work');
    expect(strip(w)).toEqual([`📌${HOME}`, 'https://a.com/']);
    expect(fake.tabs.find(t => t.url === HOME)!.active).toBe(false);
    expect((await store.getSpace(space.id))!.tabs.map(t => t.url)).toEqual(['https://a.com/']);
  });

  it('stays open across switches, even when pinned tabs belong to Spaces', async () => {
    fake.local.switcher = { lazyLoad: false, homeTab: true, showSpaceGroup: false, keepPinnedAcrossSpaces: false };
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    const homeId = fake.tabs.find(t => t.url === HOME)!.id;
    expect((await captureWindow(w)).ownedTabIds).not.toContain(homeId);
    await store.putSpace({ id: 'h', workspaceId: 'personal', name: 'H', tabs: [{ url: 'https://h.com/', pinned: false }], groups: [], activeIndex: 0 });
    await switchSpace(w, 'h');
    expect(strip(w)).toEqual([`📌${HOME}`, 'https://h.com/']);
    expect(fake.tabs.find(t => t.url === HOME)!.id).toBe(homeId);
  });

  it('switching into an empty Space shows the home tab instead of opening another dashboard', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await store.putSpace({ id: 'e', workspaceId: 'personal', name: 'E', tabs: [], groups: [], activeIndex: 0 });
    await switchSpace(w, 'e');
    expect(strip(w)).toEqual([`📌${HOME}`]);
    expect(fake.tabs.find(t => t.url === HOME)!.active).toBe(true);
  });

  it('is not added to windows without a Space, and goes away when turned off', async () => {
    const loose = addWindow([{ url: 'https://x.com/' }]);
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await refreshHomeTabs();
    expect(strip(loose)).toEqual(['https://x.com/']);

    fake.local.switcher = { lazyLoad: false, homeTab: false, showSpaceGroup: false };
    await refreshHomeTabs();
    expect(strip(w)).toEqual(['https://a.com/']);
  });

  it('stays when the window is detached', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await detachWindow(w);
    expect(strip(w)).toEqual([`📌${HOME}`, 'https://a.com/']);
  });
});
