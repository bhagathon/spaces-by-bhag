import { DatabaseSync } from 'node:sqlite';
import type { Role, ResourcesInput, Snapshot, SpaceInput } from '../../src/shared/types.ts';
import { PERSONAL, TOMBSTONE_TTL_MS, type ServerStore, type Tombstone, type StorePut, type StoredResources, type StoredSpace, type TeamWorkspace, type User } from './store.ts';

/** Single-file store for local development and tests. */
export class SqliteStore implements ServerStore {
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spaces_ws ON spaces (workspace_id, owner_id);
      CREATE TABLE IF NOT EXISTS resources (space_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS resources_ws ON resources (workspace_id, owner_id);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, space_id TEXT, taken_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_user ON snapshots (user_id, taken_at);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL, deleted_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tombstones_ws ON tombstones (workspace_id, owner_id, deleted_at);
    `);
  }

  async createUser(u: User) {
    this.db.prepare('INSERT INTO users (id, name, token_hash) VALUES (?, ?, ?)').run(u.id, u.name, u.tokenHash);
  }

  async userByTokenHash(h: string) {
    const r = this.db.prepare('SELECT id, name, token_hash FROM users WHERE token_hash = ?').get(h) as Record<string, string> | undefined;
    return r && { id: r.id, name: r.name, tokenHash: r.token_hash };
  }

  async userByName(name: string) {
    const r = this.db.prepare('SELECT id, name, token_hash FROM users WHERE name = ?').get(name) as Record<string, string> | undefined;
    return r && { id: r.id, name: r.name, tokenHash: r.token_hash };
  }

  async listUsers() {
    return (this.db.prepare('SELECT id, name, token_hash FROM users ORDER BY name').all() as Record<string, string>[]).map(r => ({
      id: r.id,
      name: r.name,
      tokenHash: r.token_hash,
    }));
  }

  async getWorkspace(id: string) {
    return this.db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(id) as TeamWorkspace | undefined;
  }

  async putWorkspace(ws: TeamWorkspace) {
    this.db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name').run(ws.id, ws.name);
  }

  async getRole(workspaceId: string, userId: string) {
    const r = this.db.prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) as { role: Role } | undefined;
    return r?.role;
  }

  async setRole(workspaceId: string, userId: string, role: Role | null) {
    if (role === null) this.db.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
    else
      this.db
        .prepare('INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role')
        .run(workspaceId, userId, role);
  }

  async listMemberships(userId: string) {
    return this.db.prepare('SELECT workspace_id AS workspaceId, role FROM members WHERE user_id = ?').all(userId) as { workspaceId: string; role: Role }[];
  }

  async getSpace(id: string) {
    const r = this.db.prepare('SELECT data FROM spaces WHERE id = ?').get(id) as { data: string } | undefined;
    return r && (JSON.parse(r.data) as StoredSpace);
  }

  async listSpaces(workspaceId: string, ownerId: string) {
    const rows = (workspaceId === PERSONAL
      ? this.db.prepare('SELECT data FROM spaces WHERE workspace_id = ? AND owner_id = ?').all(workspaceId, ownerId)
      : this.db.prepare('SELECT data FROM spaces WHERE workspace_id = ?').all(workspaceId)) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as StoredSpace);
  }

  async putSpace(input: SpaceInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredSpace>> {
    return this.tx(() => {
      const current = this.db.prepare('SELECT data FROM spaces WHERE id = ?').get(input.id) as { data: string } | undefined;
      const cur = current && (JSON.parse(current.data) as StoredSpace);
      if (baseRev !== undefined && (cur?.rev ?? 0) !== baseRev) {
        if (cur) return { ok: false, current: cur };
      }
      const value: StoredSpace = { ...input, rev: (cur?.rev ?? 0) + 1, updatedAt: Date.now() };
      this.db
        .prepare('INSERT INTO spaces (id, workspace_id, owner_id, rev, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, owner_id = excluded.owner_id, rev = excluded.rev, data = excluded.data')
        .run(value.id, value.workspaceId, value.ownerId, value.rev, JSON.stringify(value));
      this.db.prepare('DELETE FROM tombstones WHERE id = ?').run(value.id);
      return { ok: true, value };
    });
  }

  async deleteSpace(id: string) {
    this.tx(() => {
      const cur = this.db.prepare('SELECT workspace_id, owner_id FROM spaces WHERE id = ?').get(id) as { workspace_id: string; owner_id: string } | undefined;
      this.db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM resources WHERE space_id = ?').run(id);
      if (cur) {
        this.db
          .prepare('INSERT OR REPLACE INTO tombstones (id, workspace_id, owner_id, deleted_at) VALUES (?, ?, ?, ?)')
          .run(id, cur.workspace_id, cur.owner_id, Date.now());
      }
    });
  }

  async listTombstones(workspaceId: string, ownerId: string, since: number): Promise<Tombstone[]> {
    this.db.prepare('DELETE FROM tombstones WHERE deleted_at < ?').run(Date.now() - TOMBSTONE_TTL_MS);
    const rows = (workspaceId === PERSONAL
      ? this.db.prepare('SELECT id, deleted_at FROM tombstones WHERE workspace_id = ? AND owner_id = ? AND deleted_at >= ?').all(workspaceId, ownerId, since)
      : this.db.prepare('SELECT id, deleted_at FROM tombstones WHERE workspace_id = ? AND deleted_at >= ?').all(workspaceId, since)) as { id: string; deleted_at: number }[];
    return rows.map(r => ({ id: r.id, deletedAt: r.deleted_at }));
  }

  async getResources(spaceId: string) {
    const r = this.db.prepare('SELECT data FROM resources WHERE space_id = ?').get(spaceId) as { data: string } | undefined;
    return r && (JSON.parse(r.data) as StoredResources);
  }

  async listResources(workspaceId: string, ownerId: string) {
    const rows = (workspaceId === PERSONAL
      ? this.db.prepare('SELECT data FROM resources WHERE workspace_id = ? AND owner_id = ?').all(workspaceId, ownerId)
      : this.db.prepare('SELECT data FROM resources WHERE workspace_id = ?').all(workspaceId)) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as StoredResources);
  }

  async putResources(input: ResourcesInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredResources>> {
    return this.tx(() => {
      const current = this.db.prepare('SELECT data FROM resources WHERE space_id = ?').get(input.spaceId) as { data: string } | undefined;
      const cur = current && (JSON.parse(current.data) as StoredResources);
      if (cur && baseRev !== undefined && cur.rev !== baseRev) return { ok: false, current: cur };
      const value: StoredResources = { ...input, rev: (cur?.rev ?? 0) + 1, updatedAt: Date.now() };
      this.db
        .prepare('INSERT INTO resources (space_id, workspace_id, owner_id, rev, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (space_id) DO UPDATE SET workspace_id = excluded.workspace_id, owner_id = excluded.owner_id, rev = excluded.rev, data = excluded.data')
        .run(value.spaceId, value.workspaceId, value.ownerId, value.rev, JSON.stringify(value));
      return { ok: true, value };
    });
  }

  async appendSnapshot(userId: string, s: Snapshot) {
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots (id, user_id, space_id, taken_at, data) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, userId, s.spaceId, s.takenAt, JSON.stringify(s));
  }

  async getSnapshot(userId: string, id: string) {
    const r = this.db.prepare('SELECT data FROM snapshots WHERE id = ? AND user_id = ?').get(id, userId) as { data: string } | undefined;
    return r && (JSON.parse(r.data) as Snapshot);
  }

  async listSnapshots(userId: string, { spaceId, since = 0, limit = 200 }: { spaceId?: string; since?: number; limit?: number }) {
    const rows = (spaceId
      ? this.db.prepare('SELECT data FROM snapshots WHERE user_id = ? AND space_id = ? AND taken_at >= ? ORDER BY taken_at DESC LIMIT ?').all(userId, spaceId, since, limit)
      : this.db.prepare('SELECT data FROM snapshots WHERE user_id = ? AND taken_at >= ? ORDER BY taken_at DESC LIMIT ?').all(userId, since, limit)) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as Snapshot);
  }

  async close() {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
