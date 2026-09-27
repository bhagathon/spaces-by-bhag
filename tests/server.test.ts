import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteStorageProvider } from '../src/storage/RemoteStorageProvider';
import { HttpError } from '../src/storage/IStorageProvider';
import type { SyncEvent } from '../src/shared/types';
import { startServer, until } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeEach(async () => {
  srv = await startServer();
});
afterEach(() => srv.close());

const client = (token: string) => new RemoteStorageProvider(srv.url, async () => token);
const space = (id: string, workspaceId = 'personal') => ({ id, workspaceId, name: id, tabs: [{ url: 'https://a.com/', pinned: false }], groups: [], activeIndex: 0 });

describe('server', () => {
  it('rejects missing or bad tokens', async () => {
    await expect(client('nope').listWorkspaces()).rejects.toMatchObject({ status: 401 });
    const res = await fetch(`${srv.url}/v1/workspaces`);
    expect(res.status).toBe(401);
    expect((await fetch(`${srv.url}/health`)).status).toBe(200);
  });

  it('does optimistic concurrency with If-Match', async () => {
    const alice = client((await srv.addUser('alice')).token);
    expect(await alice.putSpace(space('s1'), 0)).toMatchObject({ ok: true, rev: 1 });
    expect(await alice.putSpace(space('s1'), 0)).toMatchObject({ ok: false, reason: 'conflict', current: { rev: 1 } });
    expect(await alice.putSpace({ ...space('s1'), name: 'renamed' }, 1)).toMatchObject({ ok: true, rev: 2, space: { name: 'renamed' } });
    expect(await alice.getSpace('s1')).toMatchObject({ name: 'renamed', rev: 2 });
    expect(await alice.getSpace('missing')).toBeUndefined();
  });

  it('keeps personal workspaces private to their owner', async () => {
    const alice = client((await srv.addUser('alice')).token);
    const bob = client((await srv.addUser('bob')).token);
    await alice.putSpace(space('mine'));
    expect(await bob.listSpaces('personal')).toEqual([]);
    expect(await bob.getSpace('mine')).toBeUndefined();
    await expect(bob.putSpace({ ...space('mine'), name: 'hijack' })).rejects.toMatchObject({ status: 404 });
    await expect(bob.deleteSpace('mine')).resolves.toBeUndefined(); // 404 is allowed and a no-op
    expect(await alice.getSpace('mine')).toMatchObject({ name: 'mine' });
  });

  it('enforces team roles', async () => {
    const a = await srv.addUser('alice');
    const v = await srv.addUser('val');
    await srv.store.putWorkspace({ id: 'team', name: 'Team' });
    await srv.store.setRole('team', a.id, 'owner');
    await srv.store.setRole('team', v.id, 'viewer');
    const alice = client(a.token);
    const val = client(v.token);
    const outsider = client((await srv.addUser('eve')).token);

    expect((await val.listWorkspaces()).map(w => [w.id, w.role])).toEqual([['personal', 'owner'], ['team', 'viewer']]);
    await alice.putSpace(space('t1', 'team'));
    expect((await val.listSpaces('team')).map(s => s.id)).toEqual(['t1']);
    await expect(val.putSpace({ ...space('t1', 'team'), name: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(val.putResources({ spaceId: 't1', workspaceId: 'team', sections: [] })).rejects.toMatchObject({ status: 403 });
    await expect(outsider.listSpaces('team')).rejects.toMatchObject({ status: 404 });
    await expect(outsider.getSpace('t1')).resolves.toBeUndefined();
  });

  it('reports who the token belongs to, and records deletions as tombstones', async () => {
    const a = await srv.addUser('alice');
    const alice = client(a.token);
    expect(await alice.me()).toEqual({ id: a.id, name: 'alice' });
    await alice.putSpace(space('s1'));
    await alice.deleteSpace('s1');
    expect((await alice.listTombstones('personal')).map(t => t.id)).toEqual(['s1']);
    expect(await client((await srv.addUser('bob')).token).listTombstones('personal')).toEqual([]);
    await alice.putSpace(space('s1')); // re-creating clears the tombstone
    expect(await alice.listTombstones('personal')).toEqual([]);
  });

  it('refuses script URLs in tabs and links', async () => {
    const alice = client((await srv.addUser('alice')).token);
    await expect(alice.putSpace({ ...space('s1'), tabs: [{ url: 'javascript:alert(1)', pinned: false }] })).rejects.toMatchObject({ status: 400 });
    await expect(alice.putSpace({ ...space('s1'), tabs: [{ url: ' DATA:text/html,x', pinned: false }] })).rejects.toMatchObject({ status: 400 });
    await alice.putSpace(space('s1'));
    await expect(
      alice.putResources({ spaceId: 's1', workspaceId: 'personal', sections: [{ id: 'a', title: 'A', items: [{ id: 'l', kind: 'link', url: 'javascript:void(0)', title: 'x' }] }] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('stores resources and deletes them with the Space', async () => {
    const alice = client((await srv.addUser('alice')).token);
    await expect(alice.putResources({ spaceId: 'nope', workspaceId: 'personal', sections: [] })).rejects.toBeInstanceOf(HttpError);
    await alice.putSpace(space('s1'));
    const r = await alice.putResources({ spaceId: 's1', workspaceId: 'personal', sections: [{ id: 'a', title: 'A', items: [] }] }, 0);
    expect(r).toMatchObject({ ok: true, rev: 1 });
    expect(await alice.listResources('personal')).toHaveLength(1);
    await alice.deleteSpace('s1');
    expect(await alice.getResources('s1')).toBeUndefined();
  });

  it('pushes changes and presence over the socket only to people who can see them', async () => {
    const a = await srv.addUser('alice');
    const b = await srv.addUser('bob');
    const aliceEvents: SyncEvent[] = [];
    const bobEvents: SyncEvent[] = [];
    let aliceOpen = false;
    const aliceLaptop = client(a.token).connect({ onEvent: e => aliceEvents.push(e), onOpen: () => (aliceOpen = true) });
    const bobConn = client(b.token).connect({ onEvent: e => bobEvents.push(e) });
    const alicePhoneEvents: SyncEvent[] = [];
    let phoneOpen = false;
    const alicePhone = client(a.token).connect({ onEvent: e => alicePhoneEvents.push(e), onOpen: () => (phoneOpen = true) });
    await until(() => aliceOpen && phoneOpen);

    await client(a.token).putSpace(space('s1'));
    await until(() => aliceEvents.some(e => e.type === 'space.updated'));
    alicePhone.send({ type: 'presence', deviceId: 'phone', deviceName: 'Phone', spaceIds: ['s1'] });
    const presence = await until(
      () => aliceEvents.filter(e => e.type === 'presence'),
      evs => evs.length > 0,
    );
    expect(presence.at(-1)).toMatchObject({ spaceId: 's1', users: [{ name: 'alice · Phone', deviceId: 'phone' }] });
    expect(bobEvents).toEqual([]);

    alicePhone.close();
    await until(() => aliceEvents.filter(e => e.type === 'presence').at(-1), e => (e as { users: unknown[] } | undefined)?.users.length === 0);
    aliceLaptop.close();
    bobConn.close();
  });

  it('refuses sockets without a valid token', async () => {
    let opened = false;
    const conn = client('bad').connect({ onEvent: () => {}, onOpen: () => (opened = true) });
    await new Promise(r => setTimeout(r, 200));
    expect(opened).toBe(false);
    conn.close();
  });
});
