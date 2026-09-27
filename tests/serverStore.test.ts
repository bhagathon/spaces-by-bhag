import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../server/src/sqliteStore.ts';
import { FirestoreStore } from '../server/src/firestoreStore.ts';
import type { ServerStore } from '../server/src/store.ts';

// Firestore runs only against the emulator: FIRESTORE_EMULATOR_HOST=localhost:8681 npm test
const stores: [string, () => ServerStore][] = [['sqlite', () => new SqliteStore(':memory:')]];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  stores.push(['firestore', () => new FirestoreStore(`demo-${randomUUID().slice(0, 8)}`)]);
}

describe.each(stores)('%s store', (_name, make) => {
  const store = make();
  afterAll(() => store.close());
  const uid = () => randomUUID();
  const space = (id: string, workspaceId: string, ownerId: string) => ({ id, workspaceId, ownerId, name: id, tabs: [{ url: 'https://a.com/', pinned: false }], groups: [], activeIndex: 0 });

  it('finds users by token hash and name', async () => {
    const id = uid();
    const name = `u-${id}`;
    await store.createUser({ id, name, tokenHash: `h-${id}` });
    expect(await store.userByTokenHash(`h-${id}`)).toEqual({ id, name, tokenHash: `h-${id}` });
    expect((await store.userByName(name))?.id).toBe(id);
    expect(await store.userByTokenHash('nope')).toBeUndefined();
  });

  it('enforces revs atomically', async () => {
    const id = uid();
    const owner = uid();
    expect(await store.putSpace(space(id, 'personal', owner), 0)).toMatchObject({ ok: true, value: { rev: 1 } });
    expect(await store.putSpace(space(id, 'personal', owner), 0)).toMatchObject({ ok: false, current: { rev: 1 } });
    const [a, b] = await Promise.all([store.putSpace({ ...space(id, 'personal', owner), name: 'a' }, 1), store.putSpace({ ...space(id, 'personal', owner), name: 'b' }, 1)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1); // exactly one concurrent writer wins
    expect((await store.getSpace(id))?.rev).toBe(2);
  });

  it('scopes personal Spaces to their owner and team Spaces to the workspace', async () => {
    const alice = uid();
    const bob = uid();
    const team = `team-${uid()}`;
    const a1 = uid();
    const t1 = uid();
    await store.putSpace(space(a1, 'personal', alice));
    await store.putSpace(space(t1, team, alice));
    expect((await store.listSpaces('personal', alice)).map(s => s.id)).toContain(a1);
    expect((await store.listSpaces('personal', bob)).map(s => s.id)).not.toContain(a1);
    expect((await store.listSpaces(team, bob)).map(s => s.id)).toEqual([t1]);
  });

  it('manages roles', async () => {
    const team = `team-${uid()}`;
    const u = uid();
    await store.putWorkspace({ id: team, name: 'T' });
    await store.setRole(team, u, 'viewer');
    expect(await store.getRole(team, u)).toBe('viewer');
    expect(await store.listMemberships(u)).toEqual([{ workspaceId: team, role: 'viewer' }]);
    await store.setRole(team, u, null);
    expect(await store.getRole(team, u)).toBeUndefined();
  });

  it('stores resources and deletes them with the Space', async () => {
    const owner = uid();
    const id = uid();
    await store.putSpace(space(id, 'personal', owner));
    const r = await store.putResources({ spaceId: id, workspaceId: 'personal', ownerId: owner, sections: [] }, 0);
    expect(r).toMatchObject({ ok: true, value: { rev: 1 } });
    expect((await store.listResources('personal', owner)).map(x => x.spaceId)).toContain(id);
    await store.deleteSpace(id);
    expect(await store.getSpace(id)).toBeUndefined();
    expect(await store.getResources(id)).toBeUndefined();
  });

  it('tombstones deleted Spaces and clears the tombstone on re-create', async () => {
    const owner = uid();
    const id = uid();
    await store.putSpace(space(id, 'personal', owner));
    await store.deleteSpace(id);
    expect((await store.listTombstones('personal', owner, 0)).map(t => t.id)).toContain(id);
    expect((await store.listTombstones('personal', uid(), 0)).map(t => t.id)).not.toContain(id);
    await store.putSpace(space(id, 'personal', owner));
    expect((await store.listTombstones('personal', owner, 0)).map(t => t.id)).not.toContain(id);
  });

  it('keeps snapshots per user, newest first', async () => {
    const u = uid();
    for (const t of [1, 3, 2]) await store.appendSnapshot(u, { id: `${u}-${t}`, spaceId: 's', windowId: 1, takenAt: t, hash: '', tabs: [], groups: [] });
    expect((await store.listSnapshots(u, {})).map(s => s.takenAt)).toEqual([3, 2, 1]);
    expect((await store.listSnapshots(u, { since: 2, limit: 1 })).map(s => s.takenAt)).toEqual([3]);
    expect(await store.getSnapshot(uid(), `${u}-1`)).toBeUndefined();
  });
});
