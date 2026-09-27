import { openDB, type IDBPDatabase } from 'idb';
import type { IStorageProvider, PutResult, ResourcesPutResult, SnapshotQuery } from './IStorageProvider';
import type { ResourcesInput, Snapshot, Space, SpaceInput, SpaceResources, SyncEvent, Workspace } from '../shared/types';

const CHANNEL = 'spaces-sync';
export const PERSONAL_WORKSPACE_ID = 'personal';

/** A pending push to the server, one per entity (later writes replace earlier ones). */
export interface OutboxEntry {
  key: string; // "space:<id>" | "resources:<spaceId>"
  kind: 'space' | 'resources';
  entityId: string;
  op: 'put' | 'delete';
  seq: number;
}

let seqCounter = 0;

/** IndexedDB-backed provider. The service worker and extension pages share the same database. */
export class LocalStorageProvider implements IStorageProvider {
  readonly kind = 'local' as const;
  private db!: IDBPDatabase;
  private channel = new BroadcastChannel(CHANNEL);

  constructor(private dbName = 'spaces') {}

  async init() {
    this.db = await openDB(this.dbName, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('workspaces', { keyPath: 'id' });
          const spaces = db.createObjectStore('spaces', { keyPath: 'id' });
          spaces.createIndex('byWorkspace', 'workspaceId');
          const snaps = db.createObjectStore('snapshots', { keyPath: 'id' });
          snaps.createIndex('byTakenAt', 'takenAt');
          snaps.createIndex('bySpace', ['spaceId', 'takenAt']);
        }
        if (oldVersion < 2) {
          const res = db.createObjectStore('resources', { keyPath: 'spaceId' });
          res.createIndex('byWorkspace', 'workspaceId');
          db.createObjectStore('outbox', { keyPath: 'key' });
          db.createObjectStore('syncMeta', { keyPath: 'key' });
        }
      },
    });
    if (!(await this.db.get('workspaces', PERSONAL_WORKSPACE_ID))) {
      await this.putWorkspace({ id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal' });
    }
  }

  listWorkspaces() {
    return this.db.getAll('workspaces') as Promise<Workspace[]>;
  }

  async putWorkspace(ws: Workspace) {
    await this.db.put('workspaces', ws);
  }

  async deleteWorkspace(id: string) {
    await this.db.delete('workspaces', id);
  }

  listSpaces(workspaceId: string) {
    return this.db.getAllFromIndex('spaces', 'byWorkspace', workspaceId) as Promise<Space[]>;
  }

  getSpace(spaceId: string) {
    return this.db.get('spaces', spaceId) as Promise<Space | undefined>;
  }

  async putSpace(input: SpaceInput, baseRev?: number): Promise<PutResult> {
    const tx = this.db.transaction('spaces', 'readwrite');
    const current = (await tx.store.get(input.id)) as Space | undefined;
    if (current && baseRev !== undefined && current.rev !== baseRev) {
      await tx.done;
      return { ok: false, reason: 'conflict', current };
    }
    const space: Space = { ...input, rev: (current?.rev ?? 0) + 1, updatedAt: Date.now() };
    await tx.store.put(space);
    await tx.done;
    this.broadcast({ type: 'space.updated', space });
    return { ok: true, rev: space.rev, space };
  }

  async deleteSpace(spaceId: string) {
    const tx = this.db.transaction(['spaces', 'resources'], 'readwrite');
    await tx.objectStore('spaces').delete(spaceId);
    await tx.objectStore('resources').delete(spaceId);
    await tx.done;
    this.broadcast({ type: 'space.deleted', spaceId });
  }

  listResources(workspaceId: string) {
    return this.db.getAllFromIndex('resources', 'byWorkspace', workspaceId) as Promise<SpaceResources[]>;
  }

  getResources(spaceId: string) {
    return this.db.get('resources', spaceId) as Promise<SpaceResources | undefined>;
  }

  async putResources(input: ResourcesInput, baseRev?: number): Promise<ResourcesPutResult> {
    const tx = this.db.transaction('resources', 'readwrite');
    const current = (await tx.store.get(input.spaceId)) as SpaceResources | undefined;
    if (current && baseRev !== undefined && current.rev !== baseRev) {
      await tx.done;
      return { ok: false, reason: 'conflict', current };
    }
    const resources: SpaceResources = { ...input, rev: (current?.rev ?? 0) + 1, updatedAt: Date.now() };
    await tx.store.put(resources);
    await tx.done;
    this.broadcast({ type: 'resources.updated', resources });
    return { ok: true, rev: resources.rev, resources };
  }

  async appendSnapshot(s: Snapshot) {
    await this.db.put('snapshots', s);
  }

  getSnapshot(id: string) {
    return this.db.get('snapshots', id) as Promise<Snapshot | undefined>;
  }

  async listSnapshots({ spaceId, since = 0, limit = 200 }: SnapshotQuery) {
    const tx = this.db.transaction('snapshots');
    const cursorSource = spaceId
      ? tx.store.index('bySpace').openCursor(IDBKeyRange.bound([spaceId, since], [spaceId, Infinity]), 'prev')
      : tx.store.index('byTakenAt').openCursor(IDBKeyRange.lowerBound(since), 'prev');
    const out: Snapshot[] = [];
    let cursor = await cursorSource;
    while (cursor && out.length < limit) {
      out.push(cursor.value as Snapshot);
      cursor = await cursor.continue();
    }
    await tx.done;
    return out;
  }

  async pruneSnapshots(olderThan: number) {
    const tx = this.db.transaction('snapshots', 'readwrite');
    let n = 0;
    let cursor = await tx.store.index('byTakenAt').openCursor(IDBKeyRange.upperBound(olderThan));
    while (cursor) {
      await cursor.delete();
      n++;
      cursor = await cursor.continue();
    }
    await tx.done;
    return n;
  }

  subscribe(_workspaceId: string, onEvent: (e: SyncEvent) => void) {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = m => onEvent(m.data as SyncEvent);
    return () => ch.close();
  }

  async getPresence() {
    return [];
  }

  /** Notify every extension context (worker and pages) of a change. */
  broadcast(e: SyncEvent) {
    this.channel.postMessage(e);
  }

  // ---- Sync bookkeeping (used by SyncingProvider) ----

  async enqueue(entry: Omit<OutboxEntry, 'key' | 'seq'>) {
    const key = `${entry.kind}:${entry.entityId}`;
    await this.db.put('outbox', { ...entry, key, seq: Date.now() * 1000 + (seqCounter++ % 1000) });
  }

  listOutbox() {
    return this.db.getAll('outbox') as Promise<OutboxEntry[]>;
  }

  async hasOutbox(key: string) {
    return (await this.db.count('outbox', key)) > 0;
  }

  /** Remove only if unchanged since it was read, so a write made mid-push isn't lost. */
  async ackOutbox(key: string, seq: number) {
    const tx = this.db.transaction('outbox', 'readwrite');
    const cur = (await tx.store.get(key)) as OutboxEntry | undefined;
    if (cur?.seq === seq) await tx.store.delete(key);
    await tx.done;
  }

  async getRemoteRev(key: string): Promise<number | undefined> {
    return ((await this.db.get('syncMeta', key)) as { remoteRev: number } | undefined)?.remoteRev;
  }

  async setRemoteRev(key: string, remoteRev: number | undefined) {
    if (remoteRev === undefined) await this.db.delete('syncMeta', key);
    else await this.db.put('syncMeta', { key, remoteRev });
  }

  /** Which server + user the remote revs belong to. */
  async getSyncIdentity(): Promise<string | undefined> {
    return ((await this.db.get('syncMeta', '@identity')) as { identity: string } | undefined)?.identity;
  }

  /** Switching server or user: forget every remote rev so nothing is judged against the wrong server. */
  async resetSyncIdentity(identity: string) {
    const tx = this.db.transaction('syncMeta', 'readwrite');
    await tx.store.clear();
    await tx.store.put({ key: '@identity', identity });
    await tx.done;
  }

  close() {
    this.channel.close();
    this.db.close();
  }
}
