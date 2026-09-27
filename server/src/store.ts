import type { Role, ResourcesInput, Snapshot, Space, SpaceInput, SpaceResources } from '../../src/shared/types.ts';

export interface User {
  id: string;
  name: string;
  tokenHash: string;
}

export interface TeamWorkspace {
  id: string;
  name: string;
}

/** Spaces and resources carry their owner so the virtual "personal" workspace can be per-user. */
export type StoredSpace = Space & { ownerId: string };
export type StoredResources = SpaceResources & { ownerId: string };

export interface Tombstone {
  id: string;
  deletedAt: number;
}

/** Deleted Spaces are remembered this long so offline devices learn about the deletion. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type StorePut<T> = { ok: true; value: T } | { ok: false; current: T };

/**
 * Persistence for the server. Implementations must make putSpace/putResources
 * atomic: read the current rev, compare with baseRev, write rev + 1.
 * baseRev undefined = unconditional; baseRev 0 = must not exist.
 */
export interface ServerStore {
  createUser(user: User): Promise<void>;
  userByTokenHash(tokenHash: string): Promise<User | undefined>;
  userByName(name: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;

  getWorkspace(id: string): Promise<TeamWorkspace | undefined>;
  putWorkspace(ws: TeamWorkspace): Promise<void>;
  getRole(workspaceId: string, userId: string): Promise<Role | undefined>;
  setRole(workspaceId: string, userId: string, role: Role | null): Promise<void>;
  listMemberships(userId: string): Promise<{ workspaceId: string; role: Role }[]>;

  getSpace(id: string): Promise<StoredSpace | undefined>;
  /** ownerId filters the personal workspace; ignored for team workspaces. */
  listSpaces(workspaceId: string, ownerId: string): Promise<StoredSpace[]>;
  /** Writing a tombstoned id resurrects it (clears the tombstone). */
  putSpace(space: SpaceInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredSpace>>;
  /** Deletes the Space and its resources, and records a tombstone. */
  deleteSpace(id: string): Promise<void>;
  /** Spaces deleted since `since`. Absence from listSpaces alone never means "deleted". */
  listTombstones(workspaceId: string, ownerId: string, since: number): Promise<Tombstone[]>;

  getResources(spaceId: string): Promise<StoredResources | undefined>;
  listResources(workspaceId: string, ownerId: string): Promise<StoredResources[]>;
  putResources(res: ResourcesInput & { ownerId: string }, baseRev?: number): Promise<StorePut<StoredResources>>;

  appendSnapshot(userId: string, s: Snapshot): Promise<void>;
  getSnapshot(userId: string, id: string): Promise<Snapshot | undefined>;
  listSnapshots(userId: string, q: { spaceId?: string; since?: number; limit?: number }): Promise<Snapshot[]>;

  close(): Promise<void>;
}

export const PERSONAL = 'personal';
