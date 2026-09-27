import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from '../src/storage/LocalStorageProvider';
import { RemoteStorageProvider } from '../src/storage/RemoteStorageProvider';
import { SyncingProvider, mergeResources } from '../src/storage/SyncingProvider';
import type { PresenceUser, SyncStatus } from '../src/shared/types';
import { startServer, until } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
const devices: SyncingProvider[] = [];

beforeEach(async () => {
  srv = await startServer();
});
afterEach(async () => {
  for (const d of devices.splice(0)) d.close();
  await srv.close();
});

async function device(token: string, name: string, extra: { openLocally?: Set<string>; baseUrl?: () => string } = {}) {
  const status: SyncStatus[] = [];
  const presence: Record<string, PresenceUser[]>[] = [];
  const baseUrl = extra.baseUrl ?? (() => srv.url);
  const remote = new RemoteStorageProvider(baseUrl(), async () => token);
  const d = new SyncingProvider(new LocalStorageProvider(`${name}-${crypto.randomUUID()}`), remote, {
    deviceId: name,
    deviceName: name,
    isOpenLocally: id => extra.openLocally?.has(id) ?? false,
    onStatus: s => status.push(s),
    onPresence: p => presence.push(p),
  });
  await d.init();
  devices.push(d);
  return { d, status, presence };
}

const space = (id: string, name = id, workspaceId = 'personal') => ({ id, workspaceId, name, tabs: [{ url: `https://${id}.com/`, pinned: false }], groups: [], activeIndex: 0 });
const names = async (d: SyncingProvider, ws = 'personal') => (await d.listSpaces(ws)).map(s => s.name).sort();
const online = (status: SyncStatus[]) => until(() => status.at(-1)?.state, s => s === 'online');

describe('SyncingProvider', () => {
  it('propagates creates, edits and deletes between two devices', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    const phone = await device(token, 'phone');
    laptop.d.startSync();
    phone.d.startSync();
    await online(laptop.status);
    await online(phone.status);

    await laptop.d.putSpace(space('s1', 'Work'));
    await until(() => names(phone.d), n => n.join() === 'Work');

    const onPhone = (await phone.d.getSpace('s1'))!;
    await phone.d.putSpace({ ...onPhone, name: 'Work 2' }, onPhone.rev);
    await until(() => names(laptop.d), n => n.join() === 'Work 2');

    await laptop.d.deleteSpace('s1');
    await until(() => names(phone.d), n => n.length === 0);
    expect(await laptop.d.local.listOutbox()).toEqual([]);
  });

  it('uploads Spaces created before sync was turned on', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    await laptop.d.local.putSpace(space('old', 'Made offline'));
    await laptop.d.local.putResources({ spaceId: 'old', workspaceId: 'personal', sections: [{ id: 'x', title: 'Notes', items: [] }] });
    laptop.d.startSync();
    await until(() => srv.store.getSpace('old'));
    await until(() => srv.store.getResources('old'));
  });

  it('queues writes while the server is unreachable and pushes them on reconnect', async () => {
    const { token } = await srv.addUser('alice');
    let url = 'http://127.0.0.1:9'; // nothing listens here
    const laptop = await device(token, 'laptop', { baseUrl: () => url });
    await laptop.d.putSpace(space('s1', 'Offline edit'));
    await laptop.d.flush();
    expect(laptop.status.at(-1)).toMatchObject({ state: 'offline', pending: 1 });

    // "Reconnect": a fresh provider on the same local database, pointed at the live server.
    url = srv.url;
    const again = new SyncingProvider(laptop.d.local, new RemoteStorageProvider(srv.url, async () => token), { deviceId: 'laptop', deviceName: 'laptop' });
    again.startSync();
    await until(() => srv.store.getSpace('s1'));
    await until(() => again.local.listOutbox(), o => o.length === 0);
    again.stopSync();
  });

  it('keeps both versions when two devices edit a closed Space at once', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    const phone = await device(token, 'phone');
    laptop.d.startSync();
    await online(laptop.status);
    await laptop.d.putSpace(space('s1', 'Base'));
    await until(() => srv.store.getSpace('s1'));

    // Phone was offline and edits from a stale copy.
    await phone.d.local.putSpace(space('s1', 'Base'));
    await phone.d.local.setRemoteRev('space:s1', 1);
    const laptopCopy = (await laptop.d.getSpace('s1'))!;
    await laptop.d.putSpace({ ...laptopCopy, name: 'Laptop edit' }, laptopCopy.rev);
    await until(async () => (await srv.store.getSpace('s1'))?.name, n => n === 'Laptop edit');
    const phoneCopy = (await phone.d.getSpace('s1'))!;
    await phone.d.putSpace({ ...phoneCopy, name: 'Phone edit' }, phoneCopy.rev);

    phone.d.startSync();
    await until(() => names(phone.d), n => n.join() === 'Laptop edit,Phone edit (conflict copy)');
    await until(() => names(laptop.d), n => n.join() === 'Laptop edit,Phone edit (conflict copy)');
  });

  it('lets the local window win when the conflicting Space is open on this device', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    const phone = await device(token, 'phone', { openLocally: new Set(['s1']) });
    laptop.d.startSync();
    await online(laptop.status);
    await laptop.d.putSpace(space('s1', 'Base'));
    await until(() => srv.store.getSpace('s1'));
    const l = (await laptop.d.getSpace('s1'))!;
    await laptop.d.putSpace({ ...l, name: 'Laptop edit' }, l.rev);
    await until(async () => (await srv.store.getSpace('s1'))?.name, n => n === 'Laptop edit');

    await phone.d.local.putSpace(space('s1', 'Window state'));
    await phone.d.local.setRemoteRev('space:s1', 1);
    await phone.d.local.enqueue({ kind: 'space', entityId: 's1', op: 'put' });
    phone.d.startSync();
    await until(async () => (await srv.store.getSpace('s1'))?.name, n => n === 'Window state');
    expect(await names(phone.d)).toEqual(['Window state']);
  });

  it('merges concurrent resource edits item by item', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    const phone = await device(token, 'phone');
    laptop.d.startSync();
    phone.d.startSync();
    await online(laptop.status);
    await online(phone.status);
    await laptop.d.putSpace(space('s1'));
    const base = { spaceId: 's1', workspaceId: 'personal', sections: [{ id: 'sec', title: 'Notes', items: [] as never[] }] };
    await laptop.d.putResources(base);
    await until(() => phone.d.getResources('s1'));
    await until(() => laptop.d.local.listOutbox(), o => o.length === 0);

    // Both add an item before hearing about the other's.
    laptop.d.stopSync();
    phone.d.stopSync();
    const lr = (await laptop.d.getResources('s1'))!;
    await laptop.d.putResources({ ...base, sections: [{ ...lr.sections[0], items: [{ id: 'l', kind: 'note', text: 'from laptop' }] }] }, lr.rev);
    const pr = (await phone.d.getResources('s1'))!;
    await phone.d.putResources({ ...base, sections: [{ ...pr.sections[0], items: [{ id: 'p', kind: 'task', text: 'from phone', done: false }] }] }, pr.rev);
    laptop.d.startSync();
    await until(() => laptop.d.local.listOutbox(), o => o.length === 0);
    phone.d.startSync();

    const itemIds = async (d: SyncingProvider) => (await d.getResources('s1'))?.sections[0].items.map(i => i.id).sort().join();
    await until(() => itemIds(phone.d), ids => ids === 'l,p');
    await until(() => itemIds(laptop.d), ids => ids === 'l,p');
  });

  it('drops writes a viewer is not allowed to make and restores the server copy', async () => {
    const owner = await srv.addUser('olga');
    const viewer = await srv.addUser('val');
    await srv.store.putWorkspace({ id: 'team', name: 'Team' });
    await srv.store.setRole('team', owner.id, 'owner');
    await srv.store.setRole('team', viewer.id, 'viewer');
    await srv.store.putSpace({ ...space('t1', 'Shared', 'team'), ownerId: owner.id });

    const v = await device(viewer.token, 'val');
    v.d.startSync();
    await until(() => names(v.d, 'team'), n => n.join() === 'Shared');
    expect((await v.d.listWorkspaces()).find(w => w.id === 'team')?.role).toBe('viewer');

    const t = (await v.d.getSpace('t1'))!;
    await v.d.putSpace({ ...t, name: 'Vandalized' }, t.rev);
    await v.d.putSpace(space('t2', 'Sneaky', 'team'));
    await until(() => names(v.d, 'team'), n => n.join() === 'Shared');
    expect((await srv.store.getSpace('t1'))?.name).toBe('Shared');
    expect(await srv.store.getSpace('t2')).toBeUndefined();
    expect(await v.d.local.listOutbox()).toEqual([]);
  });

  it('reports which Spaces are open on your other devices', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await device(token, 'laptop');
    const phone = await device(token, 'phone');
    laptop.d.startSync();
    phone.d.startSync();
    await online(laptop.status);
    await online(phone.status);
    await laptop.d.putSpace(space('s1'));
    await until(() => srv.store.getSpace('s1'));

    phone.d.sendPresence(['s1']);
    laptop.d.sendPresence(['s1']);
    await until(() => laptop.presence.at(-1)?.s1 ?? [], users => users.length === 1);
    expect(laptop.presence.at(-1)!.s1).toMatchObject([{ deviceId: 'phone', name: 'alice · phone' }]);
    expect(await laptop.d.getPresence('s1')).toHaveLength(1);
  });
});

describe('mergeResources', () => {
  it('unions sections and items by id, preferring local', () => {
    const merged = mergeResources(
      { spaceId: 's', workspaceId: 'w', sections: [{ id: 'a', title: 'Local A', items: [{ id: '1', kind: 'note', text: 'local' }] }] },
      {
        spaceId: 's',
        workspaceId: 'w',
        sections: [
          { id: 'a', title: 'Remote A', items: [{ id: '1', kind: 'note', text: 'remote' }, { id: '2', kind: 'note', text: 'r2' }] },
          { id: 'b', title: 'Remote B', items: [] },
        ],
      },
    );
    expect(merged.sections.map(s => s.title)).toEqual(['Local A', 'Remote B']);
    expect(merged.sections[0].items).toEqual([{ id: '1', kind: 'note', text: 'local' }, { id: '2', kind: 'note', text: 'r2' }]);
  });
});

describe('SyncingProvider polling mode', () => {
  it('syncs without a socket when realtime is off', async () => {
    const { token } = await srv.addUser('alice');
    const mk = async (name: string) => {
      const d = new SyncingProvider(new LocalStorageProvider(`${name}-${crypto.randomUUID()}`), new RemoteStorageProvider(srv.url, async () => token), {
        deviceId: name,
        deviceName: name,
        realtime: false,
      });
      await d.init();
      devices.push(d);
      return d;
    };
    const laptop = await mk('laptop');
    const phone = await mk('phone');
    laptop.startSync();
    phone.startSync();
    await until(() => laptop.getStatus().state === 'online' && phone.getStatus().state === 'online');

    await laptop.putSpace(space('s1', 'Polled'));
    await until(() => srv.store.getSpace('s1')); // outbox flush doesn't need the socket
    expect(await names(phone)).toEqual([]);
    await phone.syncNow(); // what the worker's 1-minute alarm does
    expect(await names(phone)).toEqual(['Polled']);
  });
});

// Regression tests for the data-loss bugs in Tabox's issue tracker (#67, #59, #102, #116).
describe('SyncingProvider never deletes on absence', () => {
  const polled = async (url: string, token: string, local = new LocalStorageProvider(`dev-${crypto.randomUUID()}`)) => {
    const d = new SyncingProvider(local, new RemoteStorageProvider(url, async () => token), { deviceId: 'd', deviceName: 'd', realtime: false });
    await d.init();
    devices.push(d);
    return d;
  };

  it('re-uploads instead of deleting when the server lost its data', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await polled(srv.url, token);
    await laptop.putSpace(space('s1', 'Precious'));
    await laptop.syncNow();
    expect(await srv.store.getSpace('s1')).toBeTruthy();

    // Server data vanishes without a recorded deletion (restore from an empty backup, bad migration...).
    await srv.loseAllSpaces();
    await laptop.syncNow();
    expect(await names(laptop)).toEqual(['Precious']);
    expect((await srv.store.getSpace('s1'))?.name).toBe('Precious');
  });

  it('keeps local Spaces when pointed at a different server, and uploads them there', async () => {
    const a = await srv.addUser('alice');
    const laptop = await polled(srv.url, a.token);
    await laptop.putSpace(space('s1', 'Work'));
    await laptop.syncNow();

    const other = await startServer();
    try {
      const b = await other.addUser('alice-elsewhere');
      laptop.stopSync();
      const moved = await polled(other.url, b.token, laptop.local);
      await moved.syncNow();
      expect(await names(moved)).toEqual(['Work']);
      expect((await other.store.getSpace('s1'))?.name).toBe('Work');
    } finally {
      await other.close();
    }
  });

  it('applies a real deletion made on another device while this one was offline', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await polled(srv.url, token);
    const phone = await polled(srv.url, token);
    await laptop.putSpace(space('s1', 'Old'));
    await laptop.putSpace(space('s2', 'Keep'));
    await laptop.syncNow();
    await phone.syncNow();
    expect(await names(phone)).toEqual(['Keep', 'Old']);

    await phone.deleteSpace('s1');
    await phone.syncNow();
    await laptop.syncNow();
    expect(await names(laptop)).toEqual(['Keep']);
  });

  it('a device offline with edits to a Space deleted elsewhere brings it back', async () => {
    const { token } = await srv.addUser('alice');
    const laptop = await polled(srv.url, token);
    const phone = await polled(srv.url, token);
    await laptop.putSpace(space('s1', 'Draft'));
    await laptop.syncNow();
    await phone.syncNow();

    await phone.deleteSpace('s1');
    await phone.syncNow();
    const l = (await laptop.getSpace('s1'))!;
    await laptop.putSpace({ ...l, name: 'Draft, edited offline' }, l.rev); // pending in the outbox
    await laptop.syncNow();
    await phone.syncNow();
    expect(await names(phone)).toEqual(['Draft, edited offline']);
  });
});
