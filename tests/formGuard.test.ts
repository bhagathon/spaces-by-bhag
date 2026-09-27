import { beforeEach, describe, expect, it } from 'vitest';
import { addWindow, fake, resetFake } from './fakeChrome';
import { onTabLoading, onTabRemoved, setTabDirty } from '../src/background/formGuard';
import { GUARDED_TABS_KEY } from '../src/shared/settings';

const tab = (url: string) => fake.tabs.find(t => t.url === url)!;

beforeEach(() => resetFake());

describe('form guard', () => {
  it('protects a dirty tab and releases it when clean or reloaded', async () => {
    addWindow([{ url: 'https://a.com/', active: true }, { url: 'https://draft.com/' }]);
    const id = tab('https://draft.com/').id!;
    await setTabDirty(id, true);
    expect(tab('https://draft.com/').autoDiscardable).toBe(false);
    expect(fake.session[GUARDED_TABS_KEY]).toEqual([id]);

    await setTabDirty(id, false);
    expect(tab('https://draft.com/').autoDiscardable).toBe(true);

    await setTabDirty(id, true);
    await onTabLoading(id);
    expect(tab('https://draft.com/').autoDiscardable).toBe(true);
    expect(fake.session[GUARDED_TABS_KEY]).toEqual([]);
  });

  it('never releases a tab the user protected themselves', async () => {
    addWindow([{ url: 'https://keep.com/', autoDiscardable: false }]);
    const id = tab('https://keep.com/').id!;
    await setTabDirty(id, true);
    await setTabDirty(id, false);
    await onTabLoading(id);
    expect(tab('https://keep.com/').autoDiscardable).toBe(false);
  });

  it('forgets closed tabs and ignores unknown ones', async () => {
    addWindow([{ url: 'https://x.com/' }]);
    const id = tab('https://x.com/').id!;
    await setTabDirty(id, true);
    await onTabRemoved(id);
    expect(fake.session[GUARDED_TABS_KEY]).toEqual([]);
    await expect(setTabDirty(99999, true)).resolves.toBeUndefined();
  });
});
