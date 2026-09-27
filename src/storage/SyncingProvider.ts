import { HttpError, type IStorageProvider, type PutResult, type ResourcesPutResult, type SnapshotQuery } from './IStorageProvider';
import type { LocalStorageProvider, OutboxEntry } from './LocalStorageProvider';
import type { RealtimeConnection, RemoteStorageProvider } from './RemoteStorageProvider';
import { newId } from '../shared/ids';
import {
  canEdit,
  type PresenceUser,
  type ResourceItem,
  type ResourceSection,
  type ResourcesInput,
  type Snapshot,
  type Space,
  type SpaceInput,
  type SpaceResources,
  type SyncEvent,
  type SyncStatus,
  type Workspace,
} from '../shared/types';

const OUTBOX_CHANNEL = 'spaces-outbox';

export interface SyncOptions {
  deviceId: string;
  deviceName: string;
  /**
   * Keep a WebSocket open for instant updates and presence (default). When false,
   * the worker's 1-minute alarm polls instead, which lets a scale-to-zero host
   * (Cloud Run) stop billing between polls.
   */
  realtime?: boolean;
  /** Spaces open in a local window: the window is the source of truth, so local wins conflicts. */
  isOpenLocally?: (spaceId: string) => boolean;
  onStatus?: (s: SyncStatus) => void;
  onPresence?: (bySpace: Record<string, PresenceUser[]>) => void;
}

const spaceKey = (id: string) => `space:${id}`;
const resourcesKey = (spaceId: string) => `resources:${spaceId}`;

function stripSpace({ rev: _rev, updatedAt: _u, ...input }: Space): SpaceInput {
  return input;
}
function stripResources({ rev: _rev, updatedAt: _u, ...input }: SpaceResources): ResourcesInput {
  return input;
}

/**
 * Local-first provider. Every read and write goes to IndexedDB, so the extension
 * works offline and the UI never waits on the network. Writes also land in an
 * outbox; the service worker (the only context that calls startSync) pushes the
 * outbox to the server and applies remote changes it hears about over the socket.
 *
 * Conflicts:
 *  - Space open in a local window → local wins (the window is what the user sees).
 *  - Other Spaces → server wins the original, local edits are kept as "(conflict copy)".
 *  - Resources → merged by section/item id, local edits win per item.
 */
export class SyncingProvider implements IStorageProvider {
  readonly kind = 'syncing' as const;
  private conn?: RealtimeConnection;
  private running = false;
  private listener?: BroadcastChannel;
  private poster = new BroadcastChannel(OUTBOX_CHANNEL);
  private flushing?: Promise<void>;
  private flushAgain = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private presence: Record<string, PresenceUser[]> = {};
  private presenceSpaceIds: string[] = [];
  private status: SyncStatus = { state: 'off', pending: 0 };
  private identityChecked = false;

  constructor(readonly local: LocalStorageProvider, readonly remote: RemoteStorageProvider, private opts: SyncOptions) {}

  init() {
    return this.local.init();
  }

  // ---- Reads: always local ----
  listWorkspaces() { return this.local.listWorkspaces(); }
  listSpaces(workspaceId: string) { return this.local.listSpaces(workspaceId); }
  getSpace(spaceId: string) { return this.local.getSpace(spaceId); }
  listResources(workspaceId: string) { return this.local.listResources(workspaceId); }
  getResources(spaceId: string) { return this.local.getResources(spaceId); }
  getSnapshot(id: string) { return this.local.getSnapshot(id); }
  listSnapshots(q: SnapshotQuery) { return this.local.listSnapshots(q); }
  subscribe(workspaceId: string, onEvent: (e: SyncEvent) => void) { return this.local.subscribe(workspaceId, onEvent); }
  async getPresence(spaceId: string) { return this.presence[spaceId] ?? []; }

  // ---- Local-only data: snapshots are per-device history, workspaces are managed on the server ----
  appendSnapshot(s: Snapshot) { return this.local.appendSnapshot(s); }
  pruneSnapshots(olderThan: number) { return this.local.pruneSnapshots(olderThan); }
  putWorkspace(ws: Workspace) { return this.local.putWorkspace(ws); }

  // ---- Writes: local, then queued for the server ----
  async putSpace(input: SpaceInput, baseRev?: number): Promise<PutResult> {
    const r = await this.local.putSpace(input, baseRev);
    if (r.ok) await this.enqueue({ kind: 'space', entityId: input.id, op: 'put' });
    return r;
  }

  async deleteSpace(spaceId: string) {
    await this.local.deleteSpace(spaceId);
    await this.enqueue({ kind: 'space', entityId: spaceId, op: 'delete' });
  }

  async putResources(input: ResourcesInput, baseRev?: number): Promise<ResourcesPutResult> {
    const r = await this.local.putResources(input, baseRev);
    if (r.ok) await this.enqueue({ kind: 'resources', entityId: input.spaceId, op: 'put' });
    return r;
  }

  private async enqueue(entry: Omit<OutboxEntry, 'key' | 'seq'>) {
    await this.local.enqueue(entry);
    this.poster.postMessage('changed'); // wakes the worker's flush loop, from any context
    if (this.listener) this.scheduleFlush();
  }

  // ---- Sync loop (service worker only) ----

  startSync() {
    if (this.running) return;
    this.running = true;
    this.listener = new BroadcastChannel(OUTBOX_CHANNEL);
    this.listener.onmessage = () => this.scheduleFlush();
    void this.setStatus({ state: 'connecting' });
    if (this.opts.realtime === false) {
      void this.syncNow();
      return;
    }
    this.conn = this.remote.connect({
      onOpen: () => {
        this.sendPresence(this.presenceSpaceIds);
        void this.syncNow();
      },
      onEvent: e => void this.onRemoteEvent(e).catch(err => this.setStatus({ state: 'error', error: String(err) })),
      onClose: () => this.setStatus({ state: 'offline' }),
    });
  }

  stopSync() {
    this.running = false;
    this.identityChecked = false;
    this.conn?.close();
    this.conn = undefined;
    this.listener?.close();
    this.listener = undefined;
    clearTimeout(this.flushTimer);
    this.setStatus({ state: 'off' });
  }

  /** Full catch-up: pull everything, then push the outbox. */
  async syncNow() {
    try {
      await this.ensureIdentity();
      await this.pull();
      await this.flush();
    } catch (err) {
      await this.setStatus({ state: err instanceof HttpError && err.status === 0 ? 'offline' : 'error', error: errMsg(err) });
    }
  }

  sendPresence(spaceIds: string[]) {
    this.presenceSpaceIds = spaceIds;
    this.conn?.send({ type: 'presence', deviceId: this.opts.deviceId, deviceName: this.opts.deviceName, spaceIds });
  }

  private scheduleFlush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 300);
  }

  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.flushOnce();
      } while (this.flushAgain);
    })().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  private async flushOnce() {
    const entries = (await this.local.listOutbox()).sort((a, b) => a.seq - b.seq);
    for (const e of entries) {
      try {
        await this.push(e);
      } catch (err) {
        if (err instanceof HttpError && [400, 403, 404].includes(err.status)) {
          // The server will never accept this write (e.g. viewer role): drop it and restore the server's copy.
          await this.revert(e);
          continue;
        }
        await this.setStatus({ state: err instanceof HttpError && err.status === 0 ? 'offline' : 'error', error: errMsg(err) });
        return; // retry on the next flush
      }
    }
    await this.setStatus({ state: this.running ? 'online' : this.status.state, lastSyncAt: Date.now(), error: undefined });
  }

  private async push(e: OutboxEntry) {
    if (e.kind === 'space' && e.op === 'delete') {
      await this.remote.deleteSpace(e.entityId);
      await this.local.setRemoteRev(e.key, undefined);
      await this.local.setRemoteRev(resourcesKey(e.entityId), undefined);
      return this.local.ackOutbox(e.key, e.seq);
    }

    if (e.kind === 'space') {
      const s = await this.local.getSpace(e.entityId);
      if (!s) return this.local.ackOutbox(e.key, e.seq);
      const input = stripSpace(s);
      const r = await this.remote.putSpace(input, (await this.local.getRemoteRev(e.key)) ?? 0);
      if (r.ok) {
        await this.local.setRemoteRev(e.key, r.rev);
        return this.local.ackOutbox(e.key, e.seq);
      }
      if (this.opts.isOpenLocally?.(s.id)) {
        const again = await this.remote.putSpace(input, r.current.rev);
        if (!again.ok) throw new HttpError(409, `Space ${s.id} kept conflicting`);
        await this.local.setRemoteRev(e.key, again.rev);
        return this.local.ackOutbox(e.key, e.seq);
      }
      await this.putSpace({ ...input, id: newId(), name: `${s.name} (conflict copy)` });
      await this.local.ackOutbox(e.key, e.seq);
      return this.applyRemoteSpace(r.current);
    }

    const res = await this.local.getResources(e.entityId);
    if (!res) return this.local.ackOutbox(e.key, e.seq);
    const input = stripResources(res);
    const r = await this.remote.putResources(input, (await this.local.getRemoteRev(e.key)) ?? 0);
    if (r.ok) {
      await this.local.setRemoteRev(e.key, r.rev);
      return this.local.ackOutbox(e.key, e.seq);
    }
    const merged = mergeResources(input, stripResources(r.current));
    const again = await this.remote.putResources(merged, r.current.rev);
    if (!again.ok) throw new HttpError(409, `Resources for ${e.entityId} kept conflicting`);
    await this.local.ackOutbox(e.key, e.seq);
    if (!(await this.local.hasOutbox(e.key))) await this.local.putResources(merged);
    await this.local.setRemoteRev(e.key, again.rev);
  }

  private async revert(e: OutboxEntry) {
    await this.local.ackOutbox(e.key, e.seq);
    await this.local.setRemoteRev(e.key, undefined);
    if (e.kind === 'space') {
      const remote = await this.remote.getSpace(e.entityId).catch(() => undefined);
      if (remote) await this.applyRemoteSpace(remote);
      else if (e.op === 'put') await this.local.deleteSpace(e.entityId);
    } else {
      const remote = await this.remote.getResources(e.entityId).catch(() => undefined);
      if (remote) await this.applyRemoteResources(remote);
    }
  }

  /**
   * Remote revs only mean something for the server and user they came from. After
   * the server URL or token changes, forget them so every local Space is treated as
   * not-yet-uploaded instead of "deleted on the server" (Tabox #67, #59).
   */
  private async ensureIdentity() {
    if (this.identityChecked) return;
    const me = await this.remote.me();
    const identity = `${this.remote.url()}|${me.id}`;
    if ((await this.local.getSyncIdentity()) !== identity) await this.local.resetSyncIdentity(identity);
    this.identityChecked = true;
  }

  private async pull() {
    const remoteWs = await this.remote.listWorkspaces();
    const remoteWsIds = new Set(remoteWs.map(w => w.id));
    for (const w of remoteWs) await this.local.putWorkspace(w);
    for (const w of await this.local.listWorkspaces()) {
      if (w.kind === 'team' && !remoteWsIds.has(w.id)) await this.local.deleteWorkspace(w.id); // access revoked
    }

    for (const w of remoteWs) {
      const [rSpaces, rResources, rTombstones, lSpaces, lResources] = await Promise.all([
        this.remote.listSpaces(w.id),
        this.remote.listResources(w.id),
        this.remote.listTombstones(w.id),
        this.local.listSpaces(w.id),
        this.local.listResources(w.id),
      ]);

      const remoteSpaceIds = new Set(rSpaces.map(s => s.id));
      const deleted = new Set(rTombstones.map(t => t.id));
      for (const s of rSpaces) await this.applyRemoteSpace(s);
      for (const s of lSpaces) {
        if (remoteSpaceIds.has(s.id)) continue;
        const key = spaceKey(s.id);
        if (await this.local.hasOutbox(key)) continue;
        if (deleted.has(s.id)) {
          await this.dropLocalSpace(s.id); // deleted on another device while we were away
        } else if (canEdit(w)) {
          // Missing without a tombstone: never uploaded, or the server lost it. Upload, never delete.
          await this.local.setRemoteRev(key, undefined);
          await this.local.setRemoteRev(resourcesKey(s.id), undefined);
          await this.enqueue({ kind: 'space', entityId: s.id, op: 'put' });
          if (await this.local.getResources(s.id)) await this.enqueue({ kind: 'resources', entityId: s.id, op: 'put' });
        }
      }

      const remoteResIds = new Set(rResources.map(r => r.spaceId));
      for (const r of rResources) await this.applyRemoteResources(r);
      for (const r of lResources) {
        const key = resourcesKey(r.spaceId);
        if (remoteResIds.has(r.spaceId) || (await this.local.hasOutbox(key))) continue;
        if ((await this.local.getRemoteRev(key)) === undefined && canEdit(w)) {
          await this.enqueue({ kind: 'resources', entityId: r.spaceId, op: 'put' });
        }
      }
    }
  }

  private async onRemoteEvent(e: SyncEvent) {
    switch (e.type) {
      case 'space.updated':
        return this.applyRemoteSpace(e.space);
      case 'resources.updated':
        return this.applyRemoteResources(e.resources);
      case 'space.deleted':
        if (!(await this.local.hasOutbox(spaceKey(e.spaceId)))) await this.dropLocalSpace(e.spaceId);
        return;
      case 'presence':
        this.presence[e.spaceId] = e.users.filter(u => u.deviceId !== this.opts.deviceId);
        this.opts.onPresence?.({ ...this.presence });
        return;
    }
  }

  private async dropLocalSpace(spaceId: string) {
    await this.local.deleteSpace(spaceId);
    await this.local.setRemoteRev(spaceKey(spaceId), undefined);
    await this.local.setRemoteRev(resourcesKey(spaceId), undefined);
  }

  /** Apply a server copy unless we already have it or have unpushed local edits (the push resolves those). */
  private async applyRemoteSpace(s: Space) {
    const key = spaceKey(s.id);
    if (await this.local.hasOutbox(key)) return;
    const known = await this.local.getRemoteRev(key);
    if (known !== undefined && known >= s.rev) return;
    await this.local.putSpace(stripSpace(s));
    await this.local.setRemoteRev(key, s.rev);
  }

  private async applyRemoteResources(r: SpaceResources) {
    const key = resourcesKey(r.spaceId);
    if (await this.local.hasOutbox(key)) return;
    const known = await this.local.getRemoteRev(key);
    if (known !== undefined && known >= r.rev) return;
    await this.local.putResources(stripResources(r));
    await this.local.setRemoteRev(key, r.rev);
  }

  isRealtime() {
    return this.opts.realtime !== false;
  }

  private async setStatus(patch: Partial<SyncStatus>) {
    const pending = (await this.local.listOutbox().catch(() => [])).length;
    this.status = { ...this.status, ...patch, pending };
    this.opts.onStatus?.(this.status);
  }

  getStatus() {
    return this.status;
  }

  close() {
    this.stopSync();
    this.poster.close();
    this.local.close();
  }
}

/** Union by id; where both sides have a section or item, the local version wins. */
export function mergeResources(local: ResourcesInput, remote: ResourcesInput): ResourcesInput {
  const remoteSections = new Map(remote.sections.map(s => [s.id, s]));
  const sections: ResourceSection[] = local.sections.map(ls => {
    const rs = remoteSections.get(ls.id);
    if (!rs) return ls;
    const localIds = new Set(ls.items.map(i => i.id));
    const items: ResourceItem[] = [...ls.items, ...rs.items.filter(i => !localIds.has(i.id))];
    return { ...ls, items };
  });
  const localSectionIds = new Set(local.sections.map(s => s.id));
  for (const rs of remote.sections) if (!localSectionIds.has(rs.id)) sections.push(rs);
  return { ...local, sections };
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
