import type {
  PresenceUser,
  ResourcesInput,
  Snapshot,
  Space,
  SpaceInput,
  SpaceResources,
  SyncEvent,
  Workspace,
} from '../shared/types';

export type PutResult =
  | { ok: true; rev: number; space: Space }
  | { ok: false; reason: 'conflict'; current: Space };

export type ResourcesPutResult =
  | { ok: true; rev: number; resources: SpaceResources }
  | { ok: false; reason: 'conflict'; current: SpaceResources };

export interface SnapshotQuery {
  spaceId?: string;
  since?: number;
  limit?: number;
}

/** Thrown by remote calls; `status` lets callers tell "forbidden" from "offline". */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * The only way the rest of the extension touches persisted data. Implementations:
 * LocalStorageProvider (IndexedDB), RemoteStorageProvider (REST + WebSocket) and
 * SyncingProvider (local-first, pushes to remote through an outbox).
 */
export interface IStorageProvider {
  readonly kind: 'local' | 'remote' | 'syncing';
  init(): Promise<void>;

  listWorkspaces(): Promise<Workspace[]>;
  putWorkspace(ws: Workspace): Promise<void>;

  listSpaces(workspaceId: string): Promise<Space[]>;
  getSpace(spaceId: string): Promise<Space | undefined>;
  /**
   * baseRev is the rev the caller last saw. A mismatch returns a conflict
   * instead of silently overwriting a newer write (e.g. from a teammate).
   * baseRev 0 means "must not exist yet".
   */
  putSpace(space: SpaceInput, baseRev?: number): Promise<PutResult>;
  /** Also deletes the Space's resources. */
  deleteSpace(spaceId: string): Promise<void>;

  listResources(workspaceId: string): Promise<SpaceResources[]>;
  getResources(spaceId: string): Promise<SpaceResources | undefined>;
  putResources(resources: ResourcesInput, baseRev?: number): Promise<ResourcesPutResult>;

  appendSnapshot(s: Snapshot): Promise<void>;
  getSnapshot(id: string): Promise<Snapshot | undefined>;
  /** Newest first. */
  listSnapshots(q: SnapshotQuery): Promise<Snapshot[]>;
  pruneSnapshots(olderThan: number): Promise<number>;

  subscribe(workspaceId: string, onEvent: (e: SyncEvent) => void): () => void;
  getPresence(spaceId: string): Promise<PresenceUser[]>;
}
