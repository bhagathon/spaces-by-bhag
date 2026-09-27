import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import type { Snapshot } from '../src/shared/types';

let store: LocalStorageProvider;
beforeEach(async () => {
  store = new LocalStorageProvider(`test-${crypto.randomUUID()}`);
  await store.init();
});
afterEach(() => store.close());

const space = { id: 's1', workspaceId: 'personal', name: 'Work', tabs: [], groups: [], activeIndex: 0 };
const snap = (id: string, spaceId: string | null, takenAt: number): Snapshot => ({ id, spaceId, windowId: 1, takenAt, hash: id, tabs: [], groups: [] });

describe('LocalStorageProvider', () => {
  it('seeds the personal workspace', async () => {
    expect(await store.listWorkspaces()).toEqual([{ id: 'personal', name: 'Personal', kind: 'personal' }]);
  });

  it('bumps rev on each write and rejects stale baseRev', async () => {
    const a = await store.putSpace(space);
    expect(a).toMatchObject({ ok: true, rev: 1 });
    const b = await store.putSpace({ ...space, name: 'Work 2' }, 1);
    expect(b).toMatchObject({ ok: true, rev: 2 });
    const stale = await store.putSpace({ ...space, name: 'Stale' }, 1);
    expect(stale).toMatchObject({ ok: false, reason: 'conflict', current: { name: 'Work 2', rev: 2 } });
    expect((await store.getSpace('s1'))?.name).toBe('Work 2');
  });

  it('lists snapshots newest first, filtered by space', async () => {
    await store.appendSnapshot(snap('a', 's1', 1));
    await store.appendSnapshot(snap('b', 's2', 2));
    await store.appendSnapshot(snap('c', 's1', 3));
    expect((await store.listSnapshots({ spaceId: 's1' })).map(s => s.id)).toEqual(['c', 'a']);
    expect((await store.listSnapshots({})).map(s => s.id)).toEqual(['c', 'b', 'a']);
    expect((await store.listSnapshots({ limit: 1 })).map(s => s.id)).toEqual(['c']);
  });

  it('prunes snapshots older than the cutoff', async () => {
    await store.appendSnapshot(snap('old', 's1', 10));
    await store.appendSnapshot(snap('new', 's1', 1000));
    expect(await store.pruneSnapshots(500)).toBe(1);
    expect((await store.listSnapshots({})).map(s => s.id)).toEqual(['new']);
  });
});

describe('LocalStorageProvider resources', () => {
  const res = { spaceId: 's1', workspaceId: 'personal', sections: [{ id: 'a', title: 'Docs', items: [{ id: 'n', kind: 'note' as const, text: 'hi' }] }] };

  it('stores resources per Space with rev checks, and baseRev 0 means "must not exist"', async () => {
    expect(await store.putResources(res, 0)).toMatchObject({ ok: true, rev: 1 });
    expect(await store.putResources(res, 0)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await store.putResources({ ...res, sections: [] }, 1)).toMatchObject({ ok: true, rev: 2 });
    expect((await store.listResources('personal')).map(r => r.spaceId)).toEqual(['s1']);
  });

  it('deletes resources along with their Space', async () => {
    await store.putSpace(space);
    await store.putResources(res);
    await store.deleteSpace('s1');
    expect(await store.getResources('s1')).toBeUndefined();
  });

  it('keeps one outbox entry per entity and only acks an unchanged entry', async () => {
    await store.enqueue({ kind: 'space', entityId: 's1', op: 'put' });
    const [first] = await store.listOutbox();
    await store.enqueue({ kind: 'space', entityId: 's1', op: 'put' });
    expect(await store.listOutbox()).toHaveLength(1);
    await store.ackOutbox(first.key, first.seq); // stale seq: must not remove the newer write
    expect(await store.hasOutbox('space:s1')).toBe(true);
    const [second] = await store.listOutbox();
    await store.ackOutbox(second.key, second.seq);
    expect(await store.hasOutbox('space:s1')).toBe(false);
  });
});
