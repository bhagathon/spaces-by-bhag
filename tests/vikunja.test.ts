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
    const [, init] = v.fetchFn.mock.calls.at(-1)!;
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

describe('signing in with username and password', () => {
  const login = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('stores the returned session token and username, never the password', async () => {
    const { signInVikunja } = await import('../src/shared/vikunja');
    const f = login(200, { token: 'jwt-abc' });
    await signInVikunja({ url: 'https://tasks.example/', username: 'bhag', password: 'hunter2' }, f);
    expect(fake.local.vikunja).toEqual({ url: 'https://tasks.example', token: 'jwt-abc', username: 'bhag', kind: 'session' });
    expect(JSON.stringify(fake.local)).not.toContain('hunter2');
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://tasks.example/api/v1/login');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ username: 'bhag', password: 'hunter2', long_token: true });
  });

  it('asks for the two-factor code when Vikunja wants one, and reports wrong credentials plainly', async () => {
    const { signInVikunja, NeedsTotp } = await import('../src/shared/vikunja');
    await expect(signInVikunja({ url: 'https://t', username: 'bhag', password: 'x' }, login(412, { code: 1017, message: 'Invalid totp passcode.' }))).rejects.toBeInstanceOf(NeedsTotp);
    await expect(signInVikunja({ url: 'https://t', username: 'bhag', password: 'x' }, login(412, { code: 1011, message: 'Wrong username or password.' }))).rejects.toThrow(/Wrong username or password/);
  });
});
