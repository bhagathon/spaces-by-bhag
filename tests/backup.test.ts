import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { buildBackup, importBackup } from '../src/shared/backup';

let a: LocalStorageProvider;
let b: LocalStorageProvider;
beforeEach(async () => {
  a = new LocalStorageProvider(`a-${crypto.randomUUID()}`);
  b = new LocalStorageProvider(`b-${crypto.randomUUID()}`);
  await a.init();
  await b.init();
});
afterEach(() => {
  a.close();
  b.close();
});

const space = (id: string, name: string, workspaceId = 'personal') => ({ id, workspaceId, name, tabs: [{ url: `https://${id}.com/`, pinned: false }], groups: [], activeIndex: 0 });

describe('backup', () => {
  it('round-trips Spaces and resources through JSON', async () => {
    await a.putSpace(space('s1', 'Work'));
    await a.putResources({ spaceId: 's1', workspaceId: 'personal', sections: [{ id: 'x', title: 'Notes', items: [{ id: 'n', kind: 'note', text: 'hi' }] }] });
    const file = JSON.parse(JSON.stringify(await buildBackup(a)));
    expect(await importBackup(b, file)).toEqual({ added: 1, skipped: 0, resourcesAdded: 1 });
    expect((await b.getSpace('s1'))?.name).toBe('Work');
    expect((await b.getResources('s1'))?.sections[0].items).toHaveLength(1);
  });

  it('never overwrites an existing Space, and puts unknown workspaces into Personal', async () => {
    await b.putSpace(space('s1', 'Newer local version'));
    const file = { format: 'spaces-backup', version: 1, spaces: [space('s1', 'Old backup'), space('t1', 'Team thing', 'gone-team')], resources: [] };
    expect(await importBackup(b, file)).toMatchObject({ added: 1, skipped: 1 });
    expect((await b.getSpace('s1'))?.name).toBe('Newer local version');
    expect((await b.getSpace('t1'))?.workspaceId).toBe('personal');
  });

  it('drops script URLs and rejects files that are not backups', async () => {
    const file = {
      format: 'spaces-backup',
      version: 1,
      spaces: [{ ...space('s1', 'X'), tabs: [{ url: 'javascript:alert(1)', pinned: false }, { url: 'https://ok.com/', pinned: false }] }],
      resources: [{ spaceId: 's1', sections: [{ id: 'a', title: 'A', items: [{ id: 'l', kind: 'link', url: 'javascript:x', title: 'bad' }, { id: 'n', kind: 'note', text: 'ok' }] }] }],
    };
    await importBackup(b, file);
    expect((await b.getSpace('s1'))?.tabs.map(t => t.url)).toEqual(['https://ok.com/']);
    expect((await b.getResources('s1'))?.sections[0].items.map(i => i.id)).toEqual(['n']);
    await expect(importBackup(b, { hello: 'world' })).rejects.toThrow('isn’t a Spaces backup');
  });
});
