import http from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { PresenceUser, ResourcesInput, Role, Snapshot, SpaceInput, SyncEvent, Workspace } from '../../src/shared/types.ts';
import { PERSONAL, type ServerStore, type StoredResources, type StoredSpace, type User } from './store.ts';

const MAX_BODY = 5 * 1024 * 1024;
const WRITE_ROLES: Role[] = ['owner', 'editor'];

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Conn {
  ws: WebSocket;
  user: User;
  workspaceFilter?: string;
  deviceId?: string;
  deviceName?: string;
  spaceIds: Set<string>;
  lastSeen: number;
}

export interface App {
  server: http.Server;
  close(): Promise<void>;
}

export function createApp(store: ServerStore, { log = false } = {}): App {
  const conns = new Set<Conn>();
  let closing = false;

  // ---- Access control ----

  async function roleIn(user: User, workspaceId: string, ownerId?: string): Promise<Role | undefined> {
    if (workspaceId === PERSONAL) return ownerId === undefined || ownerId === user.id ? 'owner' : undefined;
    return store.getRole(workspaceId, user.id);
  }

  async function requireRead(user: User, workspaceId: string, ownerId?: string) {
    if (!(await roleIn(user, workspaceId, ownerId))) throw new ApiError(404, 'Not found');
  }

  async function requireWrite(user: User, workspaceId: string, ownerId?: string) {
    const role = await roleIn(user, workspaceId, ownerId);
    if (!role) throw new ApiError(404, 'Not found');
    if (!WRITE_ROLES.includes(role)) throw new ApiError(403, 'Viewers cannot edit this workspace');
  }

  /** Personal spaces are hidden from everyone but their owner (404, not 403, to avoid leaking IDs). */
  async function readableSpace(user: User, spaceId: string) {
    const s = await store.getSpace(spaceId);
    if (!s) return undefined;
    await requireRead(user, s.workspaceId, s.ownerId);
    return s;
  }

  // ---- Realtime fan-out ----

  async function broadcast(event: SyncEvent, workspaceId: string, ownerId: string) {
    const payload = JSON.stringify(event);
    for (const c of conns) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (c.workspaceFilter && c.workspaceFilter !== workspaceId) continue;
      if (await roleIn(c.user, workspaceId, ownerId)) c.ws.send(payload);
    }
  }

  function presenceFor(spaceId: string): PresenceUser[] {
    return [...conns]
      .filter(c => c.spaceIds.has(spaceId))
      .map(c => ({ userId: c.user.id, name: c.deviceName ? `${c.user.name} · ${c.deviceName}` : c.user.name, deviceId: c.deviceId, lastSeen: c.lastSeen }));
  }

  async function broadcastPresence(spaceIds: Iterable<string>) {
    if (closing) return;
    for (const spaceId of spaceIds) {
      const s = await store.getSpace(spaceId);
      if (s) await broadcast({ type: 'presence', spaceId, users: presenceFor(spaceId) }, s.workspaceId, s.ownerId);
    }
  }

  const strip = <T extends { ownerId: string }>({ ownerId: _o, ...rest }: T) => rest;

  // ---- REST ----

  async function authenticate(token: string | undefined | null) {
    if (!token) throw new ApiError(401, 'Missing token');
    const user = await store.userByTokenHash(hashToken(token));
    if (!user) throw new ApiError(401, 'Invalid token');
    return user;
  }

  function parseIfMatch(h: string | undefined) {
    if (h === undefined) return undefined;
    const n = Number(h.replace(/^W\//, '').replace(/"/g, ''));
    if (!Number.isInteger(n) || n < 0) throw new ApiError(400, 'Bad If-Match');
    return n;
  }

  async function readJson<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new ApiError(413, 'Body too large');
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    } catch {
      throw new ApiError(400, 'Invalid JSON');
    }
  }

  /** Script-bearing schemes are refused so a shared Space can't carry code to a teammate. */
  const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;

  function validateSpace(body: SpaceInput, id: string) {
    if (!body || body.id !== id || typeof body.name !== 'string' || typeof body.workspaceId !== 'string' || !Array.isArray(body.tabs) || !Array.isArray(body.groups)) {
      throw new ApiError(400, 'Invalid Space');
    }
    if (body.tabs.some(t => typeof t?.url !== 'string' || UNSAFE_URL.test(t.url))) throw new ApiError(400, 'Invalid tab URL');
  }

  function validateResources(body: ResourcesInput, spaceId: string) {
    if (!body || body.spaceId !== spaceId || typeof body.workspaceId !== 'string' || !Array.isArray(body.sections)) {
      throw new ApiError(400, 'Invalid resources');
    }
    for (const s of body.sections) {
      if (!Array.isArray(s?.items)) throw new ApiError(400, 'Invalid resources');
      if (s.items.some(i => i?.kind === 'link' && (typeof i.url !== 'string' || UNSAFE_URL.test(i.url)))) throw new ApiError(400, 'Invalid link URL');
    }
  }

  type Handler = (ctx: { user: User; params: string[]; req: http.IncomingMessage; query: URLSearchParams }) => Promise<[number, unknown?]>;
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/v1\/me$/, async ({ user }) => [200, { id: user.id, name: user.name }]],
    ['GET', /^\/v1\/workspaces\/([^/]+)\/tombstones$/, async ({ user, params: [wid], query }) => {
      await requireRead(user, wid);
      return [200, await store.listTombstones(wid, user.id, Number(query.get('since') ?? 0))];
    }],
    ['GET', /^\/v1\/workspaces$/, async ({ user }) => {
      const personal: Workspace = { id: PERSONAL, name: 'Personal', kind: 'personal', role: 'owner' };
      const teams = await Promise.all(
        (await store.listMemberships(user.id)).map(async m => {
          const ws = await store.getWorkspace(m.workspaceId);
          return ws && ({ id: ws.id, name: ws.name, kind: 'team', role: m.role } satisfies Workspace);
        }),
      );
      return [200, [personal, ...teams.filter(Boolean)]];
    }],
    ['PUT', /^\/v1\/workspaces\/([^/]+)$/, async ({ user, params: [wid], req }) => {
      if (wid === PERSONAL) throw new ApiError(400, 'The personal workspace cannot be renamed');
      if ((await store.getRole(wid, user.id)) !== 'owner') throw new ApiError(403, 'Only owners can edit a workspace');
      const body = await readJson<Workspace>(req);
      await store.putWorkspace({ id: wid, name: String(body.name) });
      return [204];
    }],
    ['GET', /^\/v1\/workspaces\/([^/]+)\/spaces$/, async ({ user, params: [wid] }) => {
      await requireRead(user, wid);
      return [200, (await store.listSpaces(wid, user.id)).map(strip)];
    }],
    ['GET', /^\/v1\/workspaces\/([^/]+)\/resources$/, async ({ user, params: [wid] }) => {
      await requireRead(user, wid);
      return [200, (await store.listResources(wid, user.id)).map(strip)];
    }],
    ['GET', /^\/v1\/spaces\/([^/]+)$/, async ({ user, params: [sid] }) => {
      const s = await readableSpace(user, sid);
      return s ? [200, strip(s)] : [404];
    }],
    ['PUT', /^\/v1\/spaces\/([^/]+)$/, async ({ user, params: [sid], req }) => {
      const body = await readJson<SpaceInput>(req);
      validateSpace(body, sid);
      const existing = await store.getSpace(sid);
      if (existing) await requireWrite(user, existing.workspaceId, existing.ownerId);
      await requireWrite(user, body.workspaceId);
      const ownerId = existing?.ownerId ?? user.id;
      const r = await store.putSpace({ ...body, ownerId }, parseIfMatch(req.headers['if-match']));
      if (!r.ok) return [412, { current: strip(r.current) }];
      if (existing && existing.workspaceId !== body.workspaceId) {
        await broadcast({ type: 'space.deleted', spaceId: sid }, existing.workspaceId, existing.ownerId);
      }
      await broadcast({ type: 'space.updated', space: strip(r.value) }, r.value.workspaceId, r.value.ownerId);
      return [200, { rev: r.value.rev, space: strip(r.value) }];
    }],
    ['DELETE', /^\/v1\/spaces\/([^/]+)$/, async ({ user, params: [sid] }) => {
      const existing = await store.getSpace(sid);
      if (!existing) return [404];
      await requireWrite(user, existing.workspaceId, existing.ownerId);
      await store.deleteSpace(sid);
      await broadcast({ type: 'space.deleted', spaceId: sid }, existing.workspaceId, existing.ownerId);
      return [204];
    }],
    ['GET', /^\/v1\/spaces\/([^/]+)\/resources$/, async ({ user, params: [sid] }) => {
      const r = await store.getResources(sid);
      if (!r) return [404];
      await requireRead(user, r.workspaceId, r.ownerId);
      return [200, strip(r)];
    }],
    ['PUT', /^\/v1\/spaces\/([^/]+)\/resources$/, async ({ user, params: [sid], req }) => {
      const body = await readJson<ResourcesInput>(req);
      validateResources(body, sid);
      const space = await store.getSpace(sid);
      if (!space) throw new ApiError(404, 'Space not found; push the Space first');
      await requireWrite(user, space.workspaceId, space.ownerId);
      const r = await store.putResources({ ...body, workspaceId: space.workspaceId, ownerId: space.ownerId }, parseIfMatch(req.headers['if-match']));
      if (!r.ok) return [412, { current: strip(r.current) }];
      await broadcast({ type: 'resources.updated', resources: strip(r.value) }, space.workspaceId, space.ownerId);
      return [200, { rev: r.value.rev, resources: strip(r.value) }];
    }],
    ['GET', /^\/v1\/spaces\/([^/]+)\/presence$/, async ({ user, params: [sid] }) => {
      const s = await readableSpace(user, sid);
      return s ? [200, presenceFor(sid)] : [404];
    }],
    ['POST', /^\/v1\/snapshots$/, async ({ user, req }) => {
      const s = await readJson<Snapshot>(req);
      if (!s || typeof s.id !== 'string' || !Array.isArray(s.tabs)) throw new ApiError(400, 'Invalid snapshot');
      await store.appendSnapshot(user.id, s);
      return [204];
    }],
    ['GET', /^\/v1\/snapshots\/([^/]+)$/, async ({ user, params: [id] }) => {
      const s = await store.getSnapshot(user.id, id);
      return s ? [200, s] : [404];
    }],
    ['GET', /^\/v1\/snapshots$/, async ({ user, query }) => {
      const num = (k: string) => (query.has(k) ? Number(query.get(k)) : undefined);
      return [200, await store.listSnapshots(user.id, { spaceId: query.get('spaceId') ?? undefined, since: num('since'), limit: Math.min(num('limit') ?? 200, 1000) })];
    }],
  ];

  const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, if-match');
    res.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body?: unknown) => {
      if (body === undefined) res.writeHead(status).end();
      else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (log) console.log(JSON.stringify({ method: req.method, path: url.pathname, status, ms: Date.now() - started }));
    };

    try {
      if (req.method === 'OPTIONS') return send(204);
      if (url.pathname === '/health') return send(200, { ok: true });
      for (const [method, pattern, handler] of routes) {
        const m = req.method === method && pattern.exec(url.pathname);
        if (!m) continue;
        const user = await authenticate(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
        const [status, body] = await handler({ user, params: m.slice(1).map(decodeURIComponent), req, query: url.searchParams });
        return send(status, body);
      }
      send(404, { error: 'No such route' });
    } catch (e) {
      if (e instanceof ApiError) send(e.status, { error: e.message });
      else {
        console.error(e);
        send(500, { error: 'Internal error' });
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/v1/realtime') return socket.destroy();
    let user: User;
    try {
      user = await authenticate(url.searchParams.get('token'));
      const wid = url.searchParams.get('workspace');
      if (wid) await requireRead(user, wid);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const conn: Conn = { ws, user, workspaceFilter: url.searchParams.get('workspace') ?? undefined, spaceIds: new Set(), lastSeen: Date.now() };
      conns.add(conn);
      ws.on('message', async raw => {
        let msg: { type?: string; deviceId?: string; deviceName?: string; spaceIds?: unknown };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        conn.lastSeen = Date.now();
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        if (msg.type === 'presence' && Array.isArray(msg.spaceIds)) {
          const next = new Set(msg.spaceIds.filter((x): x is string => typeof x === 'string').slice(0, 100));
          const affected = new Set([...conn.spaceIds, ...next]);
          conn.spaceIds = next;
          conn.deviceId = String(msg.deviceId ?? '').slice(0, 64) || undefined;
          conn.deviceName = String(msg.deviceName ?? '').slice(0, 64) || undefined;
          await broadcastPresence(affected).catch(e => console.error('presence broadcast failed', e));
        }
      });
      ws.on('close', () => {
        conns.delete(conn);
        void broadcastPresence(conn.spaceIds).catch(e => console.error('presence broadcast failed', e));
      });
    });
  });

  return {
    server,
    async close() {
      closing = true;
      for (const c of conns) c.ws.terminate();
      wss.close();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

export type { StoredSpace, StoredResources };
