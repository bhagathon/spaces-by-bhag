import type { IStorageProvider } from '../storage/IStorageProvider';
import { PERSONAL_WORKSPACE_ID } from '../storage/LocalStorageProvider';
import type { SpaceInput, SpaceResources, Space, Workspace, ResourcesInput } from './types';
import { isSafeUrl } from './url';

export interface Backup {
  format: 'spaces-backup';
  version: 1;
  exportedAt: string;
  workspaces: Workspace[];
  spaces: Space[];
  resources: SpaceResources[];
}

export async function buildBackup(store: IStorageProvider): Promise<Backup> {
  const workspaces = await store.listWorkspaces();
  const spaces = (await Promise.all(workspaces.map(w => store.listSpaces(w.id)))).flat();
  const resources = (await Promise.all(workspaces.map(w => store.listResources(w.id)))).flat();
  return { format: 'spaces-backup', version: 1, exportedAt: new Date().toISOString(), workspaces, spaces, resources };
}

export interface ImportResult {
  added: number;
  skipped: number;
  resourcesAdded: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Additive and non-destructive: Spaces whose ID already exists here are left
 * untouched, never overwritten. Script URLs are dropped. Spaces from a workspace
 * this device doesn't have go into Personal.
 */
export async function importBackup(store: IStorageProvider, data: unknown): Promise<ImportResult> {
  if (!isObj(data) || data.format !== 'spaces-backup' || !Array.isArray(data.spaces)) {
    throw new Error('That file isn’t a Spaces backup.');
  }
  const known = new Set((await store.listWorkspaces()).map(w => w.id));
  const result: ImportResult = { added: 0, skipped: 0, resourcesAdded: 0 };
  const imported = new Map<string, string>(); // spaceId → workspaceId it landed in

  for (const raw of data.spaces as unknown[]) {
    if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.tabs)) {
      result.skipped++;
      continue;
    }
    if (await store.getSpace(raw.id)) {
      result.skipped++;
      continue;
    }
    const workspaceId = typeof raw.workspaceId === 'string' && known.has(raw.workspaceId) ? raw.workspaceId : PERSONAL_WORKSPACE_ID;
    const tabs = (raw.tabs as unknown[]).filter((t): t is SpaceInput['tabs'][number] => isObj(t) && typeof t.url === 'string' && isSafeUrl(t.url));
    const input: SpaceInput = {
      id: raw.id,
      workspaceId,
      name: raw.name,
      tabs,
      groups: Array.isArray(raw.groups) ? (raw.groups as SpaceInput['groups']) : [],
      activeIndex: typeof raw.activeIndex === 'number' ? Math.min(raw.activeIndex, Math.max(0, tabs.length - 1)) : 0,
    };
    const r = await store.putSpace(input, 0);
    if (r.ok) {
      result.added++;
      imported.set(input.id, workspaceId);
    } else result.skipped++;
  }

  for (const raw of Array.isArray(data.resources) ? (data.resources as unknown[]) : []) {
    if (!isObj(raw) || typeof raw.spaceId !== 'string' || !Array.isArray(raw.sections)) continue;
    const workspaceId = imported.get(raw.spaceId);
    if (!workspaceId) continue; // only attach resources to Spaces this import created
    const sections = (raw.sections as ResourcesInput['sections']).map(s => ({
      ...s,
      items: (Array.isArray(s.items) ? s.items : []).filter(i => i.kind !== 'link' || isSafeUrl(i.url)),
    }));
    const r = await store.putResources({ spaceId: raw.spaceId, workspaceId, sections }, 0);
    if (r.ok) result.resourcesAdded++;
  }
  return result;
}
