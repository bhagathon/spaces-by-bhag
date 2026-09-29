import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake } from './fakeChrome';
import { ensureSpaceProject, listOpenTasks, setTaskDone, setVikunjaConfig } from '../src/shared/vikunja';

// A tiny in-memory Vikunja: projects and tasks, enough for the calls the panel makes.
function fakeVikunja() {
  const projects = [{ id: 1, title: 'Inbox', parent_project_id: 0 }, { id: 2, title: 'OakstoneOne', parent_project_id: 0 }];
  const tasks = [
    { id: 10, title: 'Open task', done: false, project_id: 5, description: 'keep me' },
    { id: 11, title: 'Done task', done: true, project_id: 5 },
  ];
  let next = 5;
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.pathname}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (u.pathname === '/api/v1/projects' && method === 'GET') return json(projects);
    if (u.pathname === '/api/v1/projects' && method === 'PUT') {
      const p = { id: next++, title: body.title, parent_project_id: body.parent_project_id ?? 0 };
      projects.push(p);
      return json(p);
    }
    const pm = /^\/api\/v1\/projects\/(\d+)$/.exec(u.pathname);
    if (pm && method === 'POST') {
      const p = projects.find(x => x.id === Number(pm[1]))!;
      Object.assign(p, body);
      return json(p);
    }
    const one = /^\/api\/v1\/tasks\/(\d+)$/.exec(u.pathname);
    if (one) {
      const t = tasks.find(x => x.id === Number(one[1]))! as Record<string, unknown>;
      if (method === 'GET') return json(t);
      // Like the real server: fields not sent are blanked.
      for (const k of Object.keys(t)) if (!(k in body)) t[k] = typeof t[k] === 'string' ? '' : t[k];
      Object.assign(t, body);
      return json(t);
    }
    const tm = /^\/api\/v1\/projects\/(\d+)\/tasks$/.exec(u.pathname);
    if (tm && method === 'GET') return json(tasks.filter(t => t.project_id === Number(tm[1])));
    return new Response('not found', { status: 404 });
  });
  return { projects, tasks, calls, fetchFn };
}

beforeEach(() => {
  resetFake();
});

describe('Vikunja tasks for a Space', () => {
  it('creates the Spaces parent and a project for the Space once, then reuses it', async () => {
    const v = fakeVikunja();
    await setVikunjaConfig({ url: 'https://tasks.example', token: 't' });
    const id1 = await ensureSpaceProject({ id: 's1', name: 'Deep work' }, v.fetchFn);
    const id2 = await ensureSpaceProject({ id: 's1', name: 'Deep work' }, v.fetchFn);
    expect(id1).toBe(id2);
    const parent = v.projects.find(p => p.title === 'Spaces')!;
    expect(v.projects.find(p => p.id === id1)).toMatchObject({ title: 'Deep work', parent_project_id: parent.id });
    expect(v.projects.filter(p => p.title === 'Spaces')).toHaveLength(1);
    expect(v.projects.filter(p => p.title === 'Deep work')).toHaveLength(1);
  });

  it('renames the project when the Space is renamed', async () => {
    const v = fakeVikunja();
    await setVikunjaConfig({ url: 'https://tasks.example', token: 't' });
    const id = await ensureSpaceProject({ id: 's1', name: 'Deep work' }, v.fetchFn);
    await ensureSpaceProject({ id: 's1', name: 'Focus' }, v.fetchFn);
    expect(v.projects.find(p => p.id === id)!.title).toBe('Focus');
  });

  it('lists only open tasks, sending the token', async () => {
    const v = fakeVikunja();
    await setVikunjaConfig({ url: 'https://tasks.example/', token: 'secret' });
    const tasks = await listOpenTasks(5, v.fetchFn);
    expect(tasks.map(t => t.title)).toEqual(['Open task']);
    const [url, init] = v.fetchFn.mock.calls.at(-1)!;
    // Vikunja 2.x rejects sort_by=position without a view ID (error 4026); ask for open tasks by id.
    const params = new URL(String(url)).searchParams;
    expect(params.get('sort_by')).toBe('id');
    expect(params.get('filter')).toBe('done = false');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(fake.local.vikunja).toBeTruthy();
  });
});

describe('checking a task off', () => {
  it('keeps every other field (Vikunja blanks fields an update leaves out)', async () => {
    const v = fakeVikunja();
    await setVikunjaConfig({ url: 'https://tasks.example', token: 't' });
    await setTaskDone(10, true, v.fetchFn);
    expect(v.tasks.find(t => t.id === 10)).toMatchObject({ done: true, title: 'Open task', description: 'keep me' });
  });
});

describe('a borrowed Vikunja session', () => {
  const jwt = (secondsLeft: number) => `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsLeft }))}.s`;

  it('reads a JWT expiry, and treats API tokens as not expiring', async () => {
    const { jwtSecondsLeft } = await import('../src/shared/vikunja');
    expect(jwtSecondsLeft(jwt(3600))).toBeGreaterThan(3500);
    expect(jwtSecondsLeft('tk_abc')).toBe(Infinity);
  });

  const shortJwt = (secondsLeft: number, lifetime = 900) => {
    const now = Math.floor(Date.now() / 1000);
    return `h.${btoa(JSON.stringify({ exp: now + secondsLeft, iat: now + secondsLeft - lifetime }))}.s`;
  };

  it('renews a Vikunja 2.x short-lived token through the refresh endpoint, with the sign-in cookie', async () => {
    const { renewIfNeeded, getVikunjaConfig } = await import('../src/shared/vikunja');
    const renewed = shortJwt(900);
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify({ token: renewed }), { status: 200 }));
    await setVikunjaConfig({ url: 'https://t', token: shortJwt(600), username: 'bhag', kind: 'browser' });
    await renewIfNeeded(f as unknown as typeof fetch);
    expect(f.mock.calls).toHaveLength(0); // ten minutes left: not yet
    await setVikunjaConfig({ url: 'https://t', token: shortJwt(60), username: 'bhag', kind: 'browser' });
    await renewIfNeeded(f as unknown as typeof fetch);
    expect((await getVikunjaConfig())!.token).toBe(renewed);
    expect(String(f.mock.calls[0][0])).toBe('https://t/api/v1/user/token/refresh');
    expect(f.mock.calls[0][1]!.credentials).toBe('include');
  });

  it('falls back to renewing a month-long token on older servers, with a day to go', async () => {
    const { renewIfNeeded, getVikunjaConfig } = await import('../src/shared/vikunja');
    const renewed = shortJwt(30 * 24 * 3600, 30 * 24 * 3600);
    const f = vi.fn(async (u: string | URL | Request) =>
      String(u).endsWith('/refresh') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ token: renewed }), { status: 200 }),
    );
    await setVikunjaConfig({ url: 'https://t', token: shortJwt(7 * 24 * 3600, 30 * 24 * 3600), username: 'bhag', kind: 'browser' });
    await renewIfNeeded(f as unknown as typeof fetch);
    expect(f.mock.calls).toHaveLength(0);
    await setVikunjaConfig({ url: 'https://t', token: shortJwt(3600, 30 * 24 * 3600), username: 'bhag', kind: 'browser' });
    await renewIfNeeded(f as unknown as typeof fetch);
    expect((await getVikunjaConfig())!.token).toBe(renewed);
    expect(f.mock.calls.map(c => String(c[0]))).toEqual(['https://t/api/v1/user/token/refresh', 'https://t/api/v1/user/token']);
  });

  it('renews after a 401 and retries the call once', async () => {
    const { listOpenTasks, getVikunjaConfig } = await import('../src/shared/vikunja');
    const renewed = shortJwt(900);
    await setVikunjaConfig({ url: 'https://t', token: shortJwt(500), username: 'bhag', kind: 'browser' });
    const f = vi.fn(async (u: string | URL | Request, i?: RequestInit) => {
      if (String(u).endsWith('/user/token/refresh')) return new Response(JSON.stringify({ token: renewed }), { status: 200 });
      const auth = (i?.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${renewed}` ? new Response('[{"id":1,"title":"a","done":false,"project_id":3}]', { status: 200 }) : new Response('{}', { status: 401 });
    });
    expect(await listOpenTasks(3, f as unknown as typeof fetch)).toHaveLength(1);
    expect((await getVikunjaConfig())!.token).toBe(renewed);
  });
});
