import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addWindow, fake, resetFake } from './fakeChrome';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { setStorageForTests } from '../src/storage';
import { resetStateForTests } from '../src/background/state';
import { createSpaceFromWindow } from '../src/background/switcher';
import { editSpace } from '../src/background/editSpace';
import { colorFor } from '../src/background/spaceGroup';

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

const tabs = (url: string[]) => url.map(u => ({ url: u, pinned: false }));
const urls = async (id: string) => (await store.getSpace(id))!.tabs.map(t => t.url);

describe('editing a Space', () => {
  it('removes and reorders the saved tabs of a Space that is not open', async () => {
    await store.putSpace({ id: 's', workspaceId: 'personal', name: 'S', groups: [], activeIndex: 2, tabs: tabs(['https://a/', 'https://b/', 'https://c/']) });
    await editSpace({ spaceId: 's', op: 'removeTab', index: 0 });
    expect(await urls('s')).toEqual(['https://b/', 'https://c/']);
    expect((await store.getSpace('s'))!.activeIndex).toBe(1); // still points at c
    await editSpace({ spaceId: 's', op: 'moveTab', index: 1, to: 0 });
    expect(await urls('s')).toEqual(['https://c/', 'https://b/']);
  });

  it('applies tab edits to the real tabs when the Space is open in a window', async () => {
    const w = addWindow([{ url: 'https://a/' }, { url: 'https://b/' }, { url: 'https://c/' }]);
    const space = await createSpaceFromWindow(w, 'Work');
    await editSpace({ spaceId: space.id, op: 'moveTab', index: 2, to: 0 });
    expect(fake.tabs.filter(t => t.windowId === w).map(t => t.url)).toEqual(['https://c/', 'https://a/', 'https://b/']);
    await editSpace({ spaceId: space.id, op: 'removeTab', index: 1 });
    expect(fake.tabs.filter(t => t.windowId === w).map(t => t.url)).toEqual(['https://c/', 'https://b/']);
    expect(await urls(space.id)).toEqual(['https://c/', 'https://b/']);
  });

  it('refuses to remove the last tab of an open window', async () => {
    const w = addWindow([{ url: 'https://a/' }]);
    const space = await createSpaceFromWindow(w, 'Work');
    await expect(editSpace({ spaceId: space.id, op: 'removeTab', index: 0 })).rejects.toThrow(/last tab/);
    expect(fake.windows.has(w)).toBe(true);
  });

  it('sets a colour, which the Space tab group then uses', async () => {
    await store.putSpace({ id: 's', workspaceId: 'personal', name: 'S', groups: [], activeIndex: 0, tabs: tabs(['https://a/']) });
    await editSpace({ spaceId: 's', op: 'setColor', color: 'purple' });
    const s = (await store.getSpace('s'))!;
    expect(s.color).toBe('purple');
    expect(colorFor(s.id, s.color)).toBe('purple');
    await editSpace({ spaceId: 's', op: 'setColor', color: undefined });
    expect((await store.getSpace('s'))!.color).toBeUndefined();
  });
});
