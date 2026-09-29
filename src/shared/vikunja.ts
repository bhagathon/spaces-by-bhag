/**
 * Vikunja tasks, shown in the panel's Tasks section. Vikunja is where the tasks live;
 * Spaces reads and writes them directly, so nothing is copied and nothing drifts.
 * Each Space gets a project inside a parent project "Spaces" (created on first use),
 * and Vikunja's CalDAV turns each project into a BusyCal calendar.
 *
 * The URL and API token stay in chrome.storage.local on this device; they are never
 * synced to the Spaces server.
 */

const CONFIG_KEY = 'vikunja';
/** spaceId → Vikunja project id, per device. */
const PROJECTS_KEY = 'vikunjaProjects';
const PARENT_TITLE = 'Spaces';

export interface VikunjaConfig {
  url: string;
  token: string;
  username?: string;
  /** 'browser': borrowed from the Vikunja web app's own session (renewed by Spaces). */
  kind?: 'browser' | 'api-token';
}

export interface VikunjaTask {
  id: number;
  title: string;
  done: boolean;
  project_id: number;
  due_date?: string;
}

interface Project {
  id: number;
  title: string;
  parent_project_id: number;
}

type Fetch = typeof fetch;

export async function getVikunjaConfig(): Promise<VikunjaConfig | null> {
  const c = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] as VikunjaConfig | undefined;
  return c?.url && c.token ? c : null;
}

export async function setVikunjaConfig(c: VikunjaConfig | null) {
  if (!c) return chrome.storage.local.remove([CONFIG_KEY, PROJECTS_KEY]);
  const { url, token, ...rest } = c;
  await chrome.storage.local.set({ [CONFIG_KEY]: { url: url.trim().replace(/\/+$/, ''), token: token.trim(), ...rest } });
}

class VikunjaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Seconds until a JWT expires, or Infinity if it isn't one (API tokens don't expire this way). */
export function jwtSecondsLeft(token: string, now = Date.now()): number {
  const part = token.split('.')[1];
  if (!part) return Infinity;
  try {
    const { exp } = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return exp ? exp - now / 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

/** A JWT's lifetime in seconds (exp − iat), or undefined when it doesn't say. */
function jwtLifetime(token: string): number | undefined {
  try {
    const { exp, iat } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number; iat?: number };
    return exp && iat ? exp - iat : undefined;
  } catch {
    return undefined;
  }
}

/**
 * When a borrowed session needs renewing. Vikunja 2.x hands the web app short-lived
 * access tokens (minutes), so those renew just before they lapse; older servers'
 * month-long tokens renew with a day to go.
 */
function renewDue(token: string, now: number) {
  const left = jwtSecondsLeft(token, now);
  return left < ((jwtLifetime(token) ?? 0) > 2 * 24 * 3600 ? 24 * 3600 : 120);
}

/** One renewal at a time across the panel, ⌘K window and dashboard, like Vikunja's own tabs do. */
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks.request('spaces-vikunja-renew', fn) as Promise<T>) : fn();
}

/**
 * Get a fresh token for a borrowed session, the way Vikunja's web app does: its
 * refresh endpoint, with the sign-in cookie Chrome already holds for the site. Older
 * servers renew the token itself; failing both, re-read an open Vikunja tab.
 */
async function renewSession(stale: VikunjaConfig, fetchFn: Fetch): Promise<string | null> {
  return oneAtATime(async () => {
    const c = await getVikunjaConfig();
    if (!c || c.kind !== 'browser') return null;
    if (c.token !== stale.token) return c.token; // another view renewed it while this one waited
    const save = async (token: string) => (await setVikunjaConfig({ ...c, token }), token);
    const read = async (res: Response | null) => (res?.ok ? ((await res.json().catch(() => ({}))) as { token?: string }).token : undefined);

    const refreshed = await read(await fetchFn(`${c.url}/api/v1/user/token/refresh`, { method: 'POST', credentials: 'include' }).catch(() => null));
    if (refreshed) return save(refreshed);
    if (jwtSecondsLeft(c.token) > 0) {
      const renewed = await read(await fetchFn(`${c.url}/api/v1/user/token`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}` } }).catch(() => null));
      if (renewed) return save(renewed);
    }
    const fromTab = await borrowBrowserSession(c.url, { openIfNeeded: false }).catch(() => null);
    if (fromTab && fromTab !== c.token && jwtSecondsLeft(fromTab) > 0) return save(fromTab);
    return null;
  });
}

/** Keep a borrowed session alive: renew it shortly before it lapses. */
export async function renewIfNeeded(fetchFn: Fetch = fetch, now = Date.now()) {
  const c = await getVikunjaConfig();
  if (!c || c.kind !== 'browser' || !renewDue(c.token, now)) return;
  await renewSession(c, fetchFn);
}

/**
 * Read the Vikunja web app's session from a tab on the server (it keeps it in
 * localStorage "token", when "stay logged in" is on). With no Vikunja tab open,
 * `openIfNeeded` opens one and waits up to two minutes for the user to log in.
 */
export async function borrowBrowserSession(url: string, { openIfNeeded = true } = {}): Promise<string> {
  const origin = new URL(url).origin;
  let tab = (await chrome.tabs.query({ url: `${origin}/*` }))[0];
  if (!tab && !openIfNeeded) throw new VikunjaError('No Vikunja tab open to renew the sign-in from.');
  tab ??= await chrome.tabs.create({ url: origin, active: true });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const [hit] = await chrome.scripting
      .executeScript({ target: { tabId: tab.id! }, func: () => localStorage.getItem('token') })
      .catch(() => [] as chrome.scripting.InjectionResult<string | null>[]);
    if (hit?.result) return hit.result;
    if (!openIfNeeded) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new VikunjaError('Didn’t find a Vikunja sign-in. Log in to Vikunja with “stay logged in” checked, then try again.');
}

/** "Log in with Vikunja": borrow the web app's session, check it, and keep it. */
export async function logInWithVikunja(url: string, fetchFn: Fetch = fetch) {
  const base = url.trim().replace(/\/+$/, '');
  const token = await borrowBrowserSession(base);
  const res = await fetchFn(`${base}/api/v1/user`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new VikunjaError('Vikunja didn’t accept that session. Log in again in the Vikunja tab and retry.');
  const { username } = (await res.json()) as { username: string };
  await setVikunjaConfig({ url: base, token, username, kind: 'browser' });
  return username;
}

async function api<T>(path: string, init: RequestInit = {}, fetchFn: Fetch = fetch, retried = false): Promise<T> {
  await renewIfNeeded(fetchFn).catch(() => {});
  const c = await getVikunjaConfig();
  if (!c) throw new VikunjaError('Connect Vikunja in Settings first.');
  const res = await fetchFn(`${c.url}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  if (res.status === 401 || res.status === 403) {
    // A lapsed borrowed session: renew it quietly, once, and try again.
    if (c.kind === 'browser' && !retried && (await renewSession(c, fetchFn))) return api<T>(path, init, fetchFn, true);
    throw new VikunjaError(
      c.kind === 'browser'
        ? 'Vikunja signed Spaces out. Open Vikunja and log in (tick “stay logged in”), then use Log in with Vikunja in Settings.'
        : 'Vikunja rejected the token. Check it in Settings.',
      res.status,
    );
  }
  if (!res.ok) throw new VikunjaError(`Vikunja: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`, res.status);
  return (await res.json()) as T;
}

/** The user's default project (their Inbox), for windows without a Space. */
export async function inboxProjectId(fetchFn: Fetch = fetch): Promise<number> {
  const user = await api<{ settings?: { default_project_id?: number } }>('/user', {}, fetchFn);
  const id = user.settings?.default_project_id;
  if (id) return id;
  const projects = await api<Project[]>('/projects', {}, fetchFn);
  const inbox = projects.find(p => p.title === 'Inbox') ?? projects.find(p => p.id > 0);
  if (!inbox) throw new VikunjaError('No Vikunja project to put tasks in.');
  return inbox.id;
}

/** The Space's project, created (under "Spaces") the first time and kept named after the Space. */
export async function ensureSpaceProject(space: { id: string; name: string }, fetchFn: Fetch = fetch): Promise<number> {
  const map = ((await chrome.storage.local.get(PROJECTS_KEY))[PROJECTS_KEY] ?? {}) as Record<string, number>;
  const projects = await api<Project[]>('/projects', {}, fetchFn);
  const known = map[space.id] !== undefined ? projects.find(p => p.id === map[space.id]) : undefined;
  if (known) {
    if (known.title !== space.name) await api(`/projects/${known.id}`, { method: 'POST', body: JSON.stringify({ ...known, title: space.name }) }, fetchFn);
    return known.id;
  }
  let parent = projects.find(p => p.title === PARENT_TITLE && !p.parent_project_id);
  parent ??= await api<Project>('/projects', { method: 'PUT', body: JSON.stringify({ title: PARENT_TITLE }) }, fetchFn);
  // Reuse a project already named after this Space under "Spaces" (e.g. made on another device).
  const existing = projects.find(p => p.parent_project_id === parent.id && p.title === space.name);
  const project = existing ?? (await api<Project>('/projects', { method: 'PUT', body: JSON.stringify({ title: space.name, parent_project_id: parent.id }) }, fetchFn));
  await chrome.storage.local.set({ [PROJECTS_KEY]: { ...map, [space.id]: project.id } });
  return project.id;
}

/** The Space's project if it already has one; no project is created just by looking. */
export async function knownSpaceProject(spaceId: string): Promise<number | undefined> {
  const map = ((await chrome.storage.local.get(PROJECTS_KEY))[PROJECTS_KEY] ?? {}) as Record<string, number>;
  return map[spaceId];
}

export async function listOpenTasks(projectId: number, fetchFn: Fetch = fetch): Promise<VikunjaTask[]> {
  // Open tasks, oldest first. (sort_by=position needs a project view ID on Vikunja 2.x: error 4026.)
  const q = new URLSearchParams({ per_page: '100', filter: 'done = false', sort_by: 'id', order_by: 'asc' });
  const tasks = await api<VikunjaTask[]>(`/projects/${projectId}/tasks?${q}`, {}, fetchFn);
  return (tasks ?? []).filter(t => !t.done);
}

/**
 * Vikunja's task update replaces every field it's sent and blanks the ones it isn't
 * (verified: a {done} update wiped the description), so send the whole task back.
 */
export async function setTaskDone(taskId: number, done: boolean, fetchFn: Fetch = fetch) {
  const task = await api<Record<string, unknown>>(`/tasks/${taskId}`, {}, fetchFn);
  return api<VikunjaTask>(`/tasks/${taskId}`, { method: 'POST', body: JSON.stringify({ ...task, done }) }, fetchFn);
}

export async function addTask(projectId: number, title: string, fetchFn: Fetch = fetch) {
  return api<VikunjaTask>(`/projects/${projectId}/tasks`, { method: 'PUT', body: JSON.stringify({ title }) }, fetchFn);
}
