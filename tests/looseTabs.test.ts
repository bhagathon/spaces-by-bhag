import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addWindow, fake, resetFake } from './fakeChrome';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { setStorageForTests } from '../src/storage';
import { getState, resetStateForTests } from '../src/background/state';
import { captureWindow, createSpaceFromWindow, saveWindowToSpace, switchSpace } from '../src/background/switcher';
import { addLooseTabs, forgetLooseTab, markNewTab } from '../src/background/looseTabs';

let store: LocalStorageProvider;
beforeEach(async () => {
  resetFake();
  resetStateForTests();
  fake.local.switcher = { lazyLoad: false, homeTab: false, showSpaceGroup: false };
  store = new LocalStorageProvider(`test-${crypto.randomUUID()}`);
  await store.init();
  setStorageForTests(store);
});
afterEach(() => store.close());

const open = async (w: number, url: string, extra = {}) => {
  const t = await chrome.tabs.create({ windowId: w, url, ...extra });
  await markNewTab(fake.tabs.find(x => x.id === t.id)!);
  return t.id!;
};

describe('tabs opened outside a Space', () => {
  it('stay out of the saved Space until added, and ask the panel about them', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    const space = await createSpaceFromWindow(w, 'Work');
    const id = await open(w, 'https://new.com/');

    expect(getState(w).looseTabIds).toEqual([id]);
    expect(fake.session.tabPrompt).toMatchObject({ windowId: w, tabId: id });
    await saveWindowToSpace(w);
    expect((await store.getSpace(space.id))!.tabs.map(t => t.url)).toEqual(['https://a.com/']);

    await addLooseTabs(w, [id]);
    expect(getState(w).looseTabIds ?? []).toEqual([]);
    expect((await store.getSpace(space.id))!.tabs.map(t => t.url)).toEqual(['https://a.com/', 'https://new.com/']);
  });

  it('are left alone in windows without a Space, and never include pinned or home tabs', async () => {
    const loose = addWindow([{ url: 'https://x.com/' }]);
    await open(loose, 'https://y.com/');
    expect(getState(loose).looseTabIds).toBeUndefined();

    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await open(w, 'https://pin.com/', { pinned: true });
    await open(w, 'chrome-extension://ext/dashboard.html', { pinned: true });
    expect(getState(w).looseTabIds).toBeUndefined();
  });

  it('close on the next switch, but a snapshot taken first keeps them in History', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    await open(w, 'https://keep-in-history.com/');
    await store.putSpace({ id: 'h', workspaceId: 'personal', name: 'H', tabs: [{ url: 'https://h.com/', pinned: false }], groups: [], activeIndex: 0 });

    await switchSpace(w, 'h');
    expect(fake.tabs.filter(t => t.windowId === w).map(t => t.url)).toEqual(['https://h.com/']);
    const [snap] = await store.listSnapshots({});
    expect(snap.tabs.map(t => t.url)).toContain('https://keep-in-history.com/');
    expect(getState(w).looseTabIds ?? []).toEqual([]);
  });

  it('are forgotten when closed', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    const id = await open(w, 'https://new.com/');
    await chrome.tabs.remove(id);
    await forgetLooseTab(w, id);
    expect(getState(w).looseTabIds ?? []).toEqual([]);
    expect((await captureWindow(w)).tabs.map(t => t.url)).toEqual(['https://a.com/']);
  });
});

describe('Spaces pages', () => {
  it('are never listed as tabs to add', async () => {
    const w = addWindow([{ url: 'https://a.com/' }]);
    await createSpaceFromWindow(w, 'Work');
    const t = await chrome.tabs.create({ windowId: w, url: 'chrome-extension://ext/dashboard.html' });
    await markNewTab(fake.tabs.find(x => x.id === t.id)!);
    expect(getState(w).looseTabIds).toBeUndefined();
  });
});
