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
  await chrome.storage.local.set({ [CONFIG_KEY]: { url: c.url.trim().replace(/\/+$/, ''), token: c.token.trim() } });
}

export class VikunjaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}, fetchFn: Fetch = fetch): Promise<T> {
  const c = await getVikunjaConfig();
  if (!c) throw new VikunjaError('Connect Vikunja in Settings first.');
  const res = await fetchFn(`${c.url}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  if (res.status === 401 || res.status === 403) throw new VikunjaError('Vikunja rejected the token. Check it in Settings.', res.status);
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
  const tasks = await api<VikunjaTask[]>(`/projects/${projectId}/tasks?per_page=100&sort_by=position&order_by=asc`, {}, fetchFn);
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
