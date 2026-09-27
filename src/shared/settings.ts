import type { SuspendSettings, SwitcherSettings } from './types';

export const SUSPEND_DEFAULTS: SuspendSettings = {
  enabled: true,
  idleMinutes: 30,
  skipPinned: true,
  skipAudible: true,
  skipGrouped: false,
  neverSuspend: ['meet.google.com', 'zoom.us', '*.slack.com'],
  aggressiveUnderMemoryPressure: true,
};

export const SWITCHER_DEFAULTS: SwitcherSettings = {
  keepPinnedAcrossSpaces: true,
  lazyLoad: true,
};

export async function getSuspendSettings(): Promise<SuspendSettings> {
  const { suspender } = await chrome.storage.local.get('suspender');
  return { ...SUSPEND_DEFAULTS, ...(suspender as Partial<SuspendSettings> | undefined) };
}

export async function getSwitcherSettings(): Promise<SwitcherSettings> {
  const { switcher } = await chrome.storage.local.get('switcher');
  return { ...SWITCHER_DEFAULTS, ...(switcher as Partial<SwitcherSettings> | undefined) };
}

export const SUSPENSION_LOG_KEY = 'suspensionLog';
export const WINDOW_STATES_KEY = 'windowStates';
export const PRESENCE_KEY = 'presence';
export const SYNC_STATUS_KEY = 'syncStatus';
export const FORM_GUARD_KEY = 'formGuard';
export const GUARDED_TABS_KEY = 'guardedTabs';

export interface SyncConfig {
  backendUrl?: string;
  token?: string;
  deviceName: string;
  /** WebSocket instead of 1-minute polling. Off by default: an open socket keeps a Cloud Run instance billed. */
  liveUpdates: boolean;
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const { backendUrl, token, deviceName, liveUpdates } = await chrome.storage.local.get(['backendUrl', 'token', 'deviceName', 'liveUpdates']);
  return {
    backendUrl: (backendUrl as string) || undefined,
    token: (token as string) || undefined,
    deviceName: (deviceName as string) || 'Chrome',
    liveUpdates: liveUpdates === true,
  };
}

export async function getDeviceId(): Promise<string> {
  const { deviceId } = await chrome.storage.local.get('deviceId');
  if (deviceId) return deviceId as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}
