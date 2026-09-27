/**
 * Client for the Spaces server (server/). Contract:
 *
 * REST (JSON, `Authorization: Bearer <token>`):
 *   GET    /v1/me                              → {id, name}
 *   GET    /v1/workspaces                      → Workspace[] (with the caller's role)
 *   PUT    /v1/workspaces/:wid                 (owner only)
 *   GET    /v1/workspaces/:wid/spaces          → Space[]
 *   GET    /v1/workspaces/:wid/resources       → SpaceResources[]
 *   GET    /v1/workspaces/:wid/tombstones?since= → {id, deletedAt}[]  (deletions, kept 90 days)
 *   GET    /v1/spaces/:sid                     → Space | 404
 *   PUT    /v1/spaces/:sid        If-Match: "<rev>" ("0" = must not exist)
 *                                  → 200 {rev, space} | 412 {current} | 403
 *   DELETE /v1/spaces/:sid                     → 204 (also deletes resources)
 *   GET    /v1/spaces/:sid/resources           → SpaceResources | 404
 *   PUT    /v1/spaces/:sid/resources  If-Match → 200 {rev, resources} | 412 {current} | 403
 *   POST   /v1/snapshots
 *   GET    /v1/snapshots/:id
 *   GET    /v1/snapshots?spaceId=&since=&limit=
 *   GET    /v1/spaces/:sid/presence            → PresenceUser[]
 *
 * WebSocket: /v1/realtime?token=<token>[&workspace=<wid>]
 *   server → client: SyncEvent JSON, for every workspace the caller can read (or just <wid>)
 *   client → server: {type:'ping'} every 20s (keeps the MV3 worker alive, Chrome 116+)
 *                    {type:'presence', deviceId, deviceName, spaceIds}
 *
 * Roles (owner/editor/viewer) are enforced by the server; a 403 surfaces as HttpError.
 */
import { HttpError, type IStorageProvider, type PutResult, type ResourcesPutResult, type SnapshotQuery } from './IStorageProvider';
import type { PresenceUser, ResourcesInput, Snapshot, Space, SpaceInput, SpaceResources, SyncEvent, Workspace } from '../shared/types';

export interface RealtimeConnection {
  send(msg: unknown): void;
  close(): void;
}

export class RemoteStorageProvider implements IStorageProvider {
  readonly kind = 'remote' as const;

  constructor(private baseUrl: string, private getToken: () => Promise<string>) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async init() {}

  private async req<T>(path: string, init: RequestInit & { allow?: number[] } = {}): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await this.getToken()}`,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (e) {
      throw new HttpError(0, `Network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 400 && !init.allow?.includes(res.status)) {
      const text = await res.text().catch(() => '');
      throw new HttpError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status} ${text}`.trim());
    }
    const body = res.status === 204 || res.status === 404 ? undefined : await res.json();
    return { status: res.status, body: body as T };
  }

  private ifMatch(baseRev?: number): Record<string, string> {
    return baseRev !== undefined ? { 'if-match': `"${baseRev}"` } : {};
  }

  readonly url = () => this.baseUrl;

  async me() {
    return (await this.req<{ id: string; name: string }>('/v1/me')).body;
  }

  async listTombstones(workspaceId: string, since = 0) {
    return (await this.req<{ id: string; deletedAt: number }[]>(`/v1/workspaces/${enc(workspaceId)}/tombstones?since=${since}`)).body;
  }

  async listWorkspaces() {
    return (await this.req<Workspace[]>('/v1/workspaces')).body;
  }

  async putWorkspace(ws: Workspace) {
    await this.req(`/v1/workspaces/${enc(ws.id)}`, { method: 'PUT', body: JSON.stringify(ws) });
  }

  async listSpaces(workspaceId: string) {
    return (await this.req<Space[]>(`/v1/workspaces/${enc(workspaceId)}/spaces`)).body;
  }

  async getSpace(spaceId: string) {
    return (await this.req<Space | undefined>(`/v1/spaces/${enc(spaceId)}`, { allow: [404] })).body;
  }

  async putSpace(space: SpaceInput, baseRev?: number): Promise<PutResult> {
    const r = await this.req<{ rev: number; space: Space } | { current: Space }>(`/v1/spaces/${enc(space.id)}`, {
      method: 'PUT',
      body: JSON.stringify(space),
      headers: this.ifMatch(baseRev),
      allow: [412],
    });
    if (r.status === 412) return { ok: false, reason: 'conflict', current: (r.body as { current: Space }).current };
    const { rev, space: saved } = r.body as { rev: number; space: Space };
    return { ok: true, rev, space: saved };
  }

  async deleteSpace(spaceId: string) {
    await this.req(`/v1/spaces/${enc(spaceId)}`, { method: 'DELETE', allow: [404] });
  }

  async listResources(workspaceId: string) {
    return (await this.req<SpaceResources[]>(`/v1/workspaces/${enc(workspaceId)}/resources`)).body;
  }

  async getResources(spaceId: string) {
    return (await this.req<SpaceResources | undefined>(`/v1/spaces/${enc(spaceId)}/resources`, { allow: [404] })).body;
  }

  async putResources(resources: ResourcesInput, baseRev?: number): Promise<ResourcesPutResult> {
    const r = await this.req<{ rev: number; resources: SpaceResources } | { current: SpaceResources }>(
      `/v1/spaces/${enc(resources.spaceId)}/resources`,
      { method: 'PUT', body: JSON.stringify(resources), headers: this.ifMatch(baseRev), allow: [412] },
    );
    if (r.status === 412) return { ok: false, reason: 'conflict', current: (r.body as { current: SpaceResources }).current };
    const { rev, resources: saved } = r.body as { rev: number; resources: SpaceResources };
    return { ok: true, rev, resources: saved };
  }

  async appendSnapshot(s: Snapshot) {
    await this.req('/v1/snapshots', { method: 'POST', body: JSON.stringify(s) });
  }

  async getSnapshot(id: string) {
    return (await this.req<Snapshot | undefined>(`/v1/snapshots/${enc(id)}`, { allow: [404] })).body;
  }

  async listSnapshots(q: SnapshotQuery) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null) params.set(k, String(v));
    return (await this.req<Snapshot[]>(`/v1/snapshots?${params}`)).body;
  }

  /** Retention is a server-side policy. */
  async pruneSnapshots() {
    return 0;
  }

  async getPresence(spaceId: string) {
    return (await this.req<PresenceUser[]>(`/v1/spaces/${enc(spaceId)}/presence`)).body;
  }

  subscribe(workspaceId: string, onEvent: (e: SyncEvent) => void) {
    const conn = this.connect({ workspaceId, onEvent });
    return () => conn.close();
  }

  /** Auto-reconnecting realtime socket. Omit workspaceId to receive events for every readable workspace. */
  connect(opts: { workspaceId?: string; onEvent: (e: SyncEvent) => void; onOpen?: () => void; onClose?: () => void }): RealtimeConnection {
    let ws: WebSocket | undefined;
    let closed = false;
    let backoff = 1000;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = async () => {
      if (closed) return;
      const params = new URLSearchParams({ token: await this.getToken() });
      if (opts.workspaceId) params.set('workspace', opts.workspaceId);
      const socket = new WebSocket(`${this.baseUrl.replace(/^http/, 'ws')}/v1/realtime?${params}`);
      ws = socket;
      socket.onopen = () => {
        backoff = 1000;
        ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'ping' })), 20_000);
        opts.onOpen?.();
      };
      socket.onmessage = m => {
        const data = JSON.parse(String(m.data)) as SyncEvent | { type: 'pong' };
        if (data.type !== 'pong') opts.onEvent(data);
      };
      socket.onclose = () => {
        clearInterval(ping);
        if (ws === socket) ws = undefined;
        opts.onClose?.();
        if (!closed) setTimeout(() => void connect(), (backoff = Math.min(backoff * 2, 30_000)));
      };
      socket.onerror = () => socket.close();
    };
    void connect();

    return {
      send: msg => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => {
        closed = true;
        ws?.close();
      },
    };
  }
}

const enc = encodeURIComponent;
