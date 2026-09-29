/** Mirrors chrome.tabGroups.Color, spelled out so the server can share these types. */
export type GroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface SavedGroup {
  /** Stable across sessions; Chrome group IDs are not. */
  key: string;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface SavedTab {
  url: string;
  title?: string;
  favIconUrl?: string;
  pinned: boolean;
  groupKey?: string;
}

export interface Space {
  id: string;
  workspaceId: string;
  name: string;
  /** Array order is tab order. */
  tabs: SavedTab[];
  groups: SavedGroup[];
  activeIndex: number;
  /** The user's colour for this Space (never red: red is reserved for pulling a card). */
  color?: GroupColor;
  /** Optimistic-concurrency revision, bumped by the provider on every write. */
  rev: number;
  updatedAt: number;
}

export type SpaceInput = Omit<Space, 'rev' | 'updatedAt'>;

export type Role = 'owner' | 'editor' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  /** Set by the server; absent locally, where the user owns everything. */
  role?: Role;
}

export const canEdit = (ws: Workspace | undefined) => !ws?.role || ws.role !== 'viewer';

/** Workona-style resources: notes, tasks and saved links that live alongside a Space's tabs. */
export type ResourceItem =
  | { id: string; kind: 'note'; text: string }
  | { id: string; kind: 'task'; text: string; done: boolean }
  | { id: string; kind: 'link'; url: string; title: string; favIconUrl?: string };

export interface ResourceSection {
  id: string;
  title: string;
  items: ResourceItem[];
}

export interface SpaceResources {
  spaceId: string;
  workspaceId: string;
  sections: ResourceSection[];
  rev: number;
  updatedAt: number;
}

export type ResourcesInput = Omit<SpaceResources, 'rev' | 'updatedAt'>;

export interface Snapshot {
  id: string;
  /** null when the window wasn't attached to a Space. */
  spaceId: string | null;
  windowId: number;
  takenAt: number;
  hash: string;
  tabs: SavedTab[];
  groups: SavedGroup[];
}

export interface PresenceUser {
  userId: string;
  name: string;
  /** Distinguishes your own devices from each other. */
  deviceId?: string;
  avatarUrl?: string;
  lastSeen: number;
}

export type SyncEvent =
  | { type: 'space.updated'; space: Space }
  | { type: 'space.deleted'; spaceId: string }
  | { type: 'resources.updated'; resources: SpaceResources }
  | { type: 'presence'; spaceId: string; users: PresenceUser[] };

export interface WindowState {
  spaceId: string | null;
  /** The user detached this window; automatic re-attachment leaves it alone. */
  detached?: boolean;
  phase: 'idle' | 'capturing' | 'opening' | 'closing' | 'grouping';
  switchId?: string;
  /** The tab group that labels this window with its Space's name. Never saved into the Space. */
  groupId?: number;
  /** Tabs opened in this window that the user hasn't added to its Space. Not saved; closed on the next switch. */
  looseTabIds?: number[];
}

export interface SuspendSettings {
  enabled: boolean;
  idleMinutes: number;
  skipPinned: boolean;
  skipAudible: boolean;
  skipGrouped: boolean;
  /** Hostnames; "*.example.com" matches the domain and its subdomains. */
  neverSuspend: string[];
  aggressiveUnderMemoryPressure: boolean;
}

export interface SuspensionRecord {
  tabId: number;
  windowId: number;
  index: number;
  groupId: number;
  url: string;
  title?: string;
  favIconUrl?: string;
  lastAccessed: number;
  suspendedAt: number;
  idleMs: number;
}

export interface SwitcherSettings {
  /** Pinned tabs stay put and are not part of any Space. */
  keepPinnedAcrossSpaces: boolean;
  /** Discard background tabs right after a switch so they load on first click. */
  lazyLoad: boolean;
  /** Put the window's ungrouped tabs in a tab group named after its Space. */
  showSpaceGroup: boolean;
  /** Keep the Spaces dashboard as a pinned first tab in every Space window. */
  homeTab: boolean;
}

/** Messages the UI sends to the service worker. */
export type Request =
  | { type: 'switchSpace'; windowId: number; spaceId: string }
  | { type: 'createSpaceFromWindow'; windowId: number; name: string; workspaceId?: string }
  | { type: 'detachWindow'; windowId: number }
  | { type: 'restoreSnapshot'; windowId: number; snapshotId: string }
  | { type: 'suspendNow' }
  | { type: 'formDirty'; dirty: boolean }
  | { type: 'setFormGuard'; enabled: boolean }
  | { type: 'syncNow' }
  | { type: 'syncConfigChanged' }
  | { type: 'refreshSpaceGroups' }
  | { type: 'updateNow' }
  | { type: 'addLooseTabs'; windowId: number; tabIds?: number[] }
  | { type: 'editSpace'; edit: SpaceEdit }
  | { type: 'sortTabs'; windowId: number };

export type SpaceEdit =
  | { spaceId: string; op: 'removeTab'; index: number }
  | { spaceId: string; op: 'moveTab'; index: number; to: number }
  | { spaceId: string; op: 'setColor'; color?: GroupColor };

/** Colours a Space can take: Chrome's tab-group colours, minus red (the One Red Rule). */
export const SPACE_COLORS: GroupColor[] = ['blue', 'cyan', 'green', 'yellow', 'orange', 'pink', 'purple', 'grey'];

/** Automatic colours: the vivid ones, so every Space has its own light like Arc's. */
const AUTO_COLORS: GroupColor[] = ['blue', 'purple', 'green', 'orange', 'cyan', 'pink', 'yellow'];

/** A Space's colour: the one the user picked, else a stable one derived from its id. */
export function spaceColor(space: { id: string; color?: GroupColor }): GroupColor {
  if (space.color) return space.color;
  let h = 0;
  for (const c of space.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AUTO_COLORS[h % AUTO_COLORS.length];
}

export type Response<T = unknown> = { ok: true; value?: T } | { ok: false; error: string };

export interface SyncStatus {
  state: 'off' | 'connecting' | 'online' | 'offline' | 'error';
  pending: number;
  lastSyncAt?: number;
  error?: string;
}
