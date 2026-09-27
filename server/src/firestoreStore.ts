import { Firestore } from '@google-cloud/firestore';
import type { Role, ResourcesInput, Snapshot, SpaceInput } from '../../src/shared/types.ts';
import { PERSONAL, TOMBSTONE_TTL_MS, type ServerStore, type Tombstone, type StorePut, type StoredResources, type StoredSpace, type TeamWorkspace, type User } from './store.ts';

/**
 * Firestore store for Cloud Run. Collections:
 *   users/{id}                 {name, tokenHash}
 *   workspaces/{id}            {name}
 *   members/{wid}_{uid}        {workspaceId, userId, role}
 *   spaces/{id}                {workspaceId, ownerId, rev, data}   data = JSON string of the Space
 *   resources/{spaceId}        {workspaceId, ownerId, rev, data}
 *   snapshots/{id}             {userId, spaceId, takenAt, data}
 *   tombstones/{spaceId}       {workspaceId, ownerId, deletedAt}
 * Only single-field and equality-only queries are used, so no composite indexes are required.
 * Documents are capped at 1 MiB; the extension drops inline data: favicons to stay well under it.
 */
export class FirestoreStore implements ServerStore {
  private db: Firestore;

  /** projectId defaults to the environment (Cloud Run / GOOGLE_CLOUD_PROJECT). */
  constructor(projectId?: string) {
    this.db = new Firestore({ ignoreUndefinedProperties: true, ...(projectId ? { projectId } : {}) });
  }

  async createUser(u: User) {
    await this.db.collection('users').doc(u.id).create({ name: u.name, tokenHash: u.tokenHash });
  }

  private toUser(doc: FirebaseFirestore.DocumentSnapshot): User {
    const d = doc.data()!;
    return { id: doc.id, name: d.name as string, tokenHash: d.tokenHash as string };
  }

  async userByTokenHash(tokenHash: string) {
    const q = await this.db.collection('users').where('tokenHash', '==', tokenHash).limit(1).get();
    return q.empty ? undefined : this.toUser(q.docs[0]);
  }

  async userByName(name: string) {
    const q = await this.db.collection('users').where('name', '==', name).limit(1).get();
    return q.empty ? undefined : this.toUser(q.docs[0]);
  }

  async listUsers() {
    return (await this.db.collection('users').get()).docs.map(d => this.toUser(d)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getWorkspace(id: string) {
    const d = await this.db.collection('workspaces').doc(id).get();
    return d.exists ? ({ id, name: d.data()!.name as string } satisfies TeamWorkspace) : undefined;
  }

  async putWorkspace(ws: TeamWorkspace) {
    await this.db.collection('workspaces').doc(ws.id).set({ name: ws.name });
  }

  async getRole(workspaceId: string, userId: string) {
    const d = await this.db.collection('members').doc(`${workspaceId}_${userId}`).get();
    return d.exists ? (d.data()!.role as Role) : undefined;
  }

  async setRole(workspaceId: string, userId: string, role: Role | null) {
    const ref = this.db.collection('members').doc(`${workspaceId}_${userId}`);
    if (role === null) await ref.delete();
    else await ref.set({ workspaceId, userId, role });
  }

  async listMemberships(userId: string) {
    const q = await this.db.collection('members').where('userId', '==', userId).get();
    return q.docs.map(d => ({ workspaceId: d.data().workspaceId as string, role: d.data().role as Role }));
  }

  async getSpace(id: string) {
    const d = await this.db.collection('spaces').doc(id).get();
    return d.exists ? (JSON.parse(d.data()!.data as string) as StoredSpace) : undefined;
  }

  async listSpaces(workspaceId: string, ownerId: string) {
    let q = this.db.collection('spaces').where('workspaceId', '==', workspaceId);
    if (workspaceId === PERSONAL) q = q.where('ownerId', '==', ownerId);
    return (await q.get()).docs.map(d => JSON.parse(d.data().data as string) as StoredSpace);
  }

  async putSpace(input: SpaceInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredSpace>> {
    const ref = this.db.collection('spaces').doc(input.id);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (JSON.parse(snap.data()!.data as string) as StoredSpace) : undefined;
      if (cur && baseRev !== undefined && cur.rev !== baseRev) return { ok: false, current: cur };
      const value: StoredSpace = { ...input, rev: (cur?.rev ?? 0) + 1, updatedAt: Date.now() };
      tx.set(ref, { workspaceId: value.workspaceId, ownerId: value.ownerId, rev: value.rev, data: JSON.stringify(value) });
      tx.delete(this.db.collection('tombstones').doc(input.id));
      return { ok: true, value };
    });
  }

  async deleteSpace(id: string) {
    const ref = this.db.collection('spaces').doc(id);
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      tx.delete(ref);
      tx.delete(this.db.collection('resources').doc(id));
      if (snap.exists) {
        const d = snap.data()!;
        tx.set(this.db.collection('tombstones').doc(id), { workspaceId: d.workspaceId, ownerId: d.ownerId, deletedAt: Date.now() });
      }
    });
  }

  /** Equality filters only (no composite index); the time filter and TTL are applied in memory. */
  async listTombstones(workspaceId: string, ownerId: string, since: number): Promise<Tombstone[]> {
    let q = this.db.collection('tombstones').where('workspaceId', '==', workspaceId);
    if (workspaceId === PERSONAL) q = q.where('ownerId', '==', ownerId);
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const out: Tombstone[] = [];
    for (const d of (await q.get()).docs) {
      const deletedAt = d.data().deletedAt as number;
      if (deletedAt < cutoff) void d.ref.delete();
      else if (deletedAt >= since) out.push({ id: d.id, deletedAt });
    }
    return out;
  }

  async getResources(spaceId: string) {
    const d = await this.db.collection('resources').doc(spaceId).get();
    return d.exists ? (JSON.parse(d.data()!.data as string) as StoredResources) : undefined;
  }

  async listResources(workspaceId: string, ownerId: string) {
    let q = this.db.collection('resources').where('workspaceId', '==', workspaceId);
    if (workspaceId === PERSONAL) q = q.where('ownerId', '==', ownerId);
    return (await q.get()).docs.map(d => JSON.parse(d.data().data as string) as StoredResources);
  }

  async putResources(input: ResourcesInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredResources>> {
    const ref = this.db.collection('resources').doc(input.spaceId);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (JSON.parse(snap.data()!.data as string) as StoredResources) : undefined;
      if (cur && baseRev !== undefined && cur.rev !== baseRev) return { ok: false, current: cur };
      const value: StoredResources = { ...input, rev: (cur?.rev ?? 0) + 1, updatedAt: Date.now() };
      tx.set(ref, { workspaceId: value.workspaceId, ownerId: value.ownerId, rev: value.rev, data: JSON.stringify(value) });
      return { ok: true, value };
    });
  }

  async appendSnapshot(userId: string, s: Snapshot) {
    await this.db.collection('snapshots').doc(s.id).set({ userId, spaceId: s.spaceId, takenAt: s.takenAt, data: JSON.stringify(s) });
  }

  async getSnapshot(userId: string, id: string) {
    const d = await this.db.collection('snapshots').doc(id).get();
    return d.exists && d.data()!.userId === userId ? (JSON.parse(d.data()!.data as string) as Snapshot) : undefined;
  }

  /** Filtered and sorted in memory to avoid needing a composite index. */
  async listSnapshots(userId: string, { spaceId, since = 0, limit = 200 }: { spaceId?: string; since?: number; limit?: number }) {
    const q = await this.db.collection('snapshots').where('userId', '==', userId).get();
    return q.docs
      .map(d => JSON.parse(d.data().data as string) as Snapshot)
      .filter(s => s.takenAt >= since && (!spaceId || s.spaceId === spaceId))
      .sort((a, b) => b.takenAt - a.takenAt)
      .slice(0, limit);
  }

  async close() {
    await this.db.terminate();
  }
}
