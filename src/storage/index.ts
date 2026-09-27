import type { IStorageProvider } from './IStorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';
import { RemoteStorageProvider } from './RemoteStorageProvider';
import { SyncingProvider, type SyncOptions } from './SyncingProvider';
import { getDeviceId, getSyncConfig } from '../shared/settings';

export { PERSONAL_WORKSPACE_ID } from './LocalStorageProvider';

let instance: Promise<IStorageProvider> | undefined;
let syncHooks: Omit<SyncOptions, 'deviceId' | 'deviceName'> = {};

/** Service worker only: callbacks the sync loop reports to. Call before the first getStorage(). */
export function setSyncHooks(hooks: typeof syncHooks) {
  syncHooks = hooks;
}

/**
 * Local IndexedDB by default. When a server URL and token are configured, a
 * SyncingProvider wraps the same local database, so every read stays local.
 */
export function getStorage(): Promise<IStorageProvider> {
  return (instance ??= (async () => {
    const config = await getSyncConfig();
    const local = new LocalStorageProvider();
    const provider: IStorageProvider =
      config.backendUrl && config.token
        ? new SyncingProvider(
            local,
            new RemoteStorageProvider(config.backendUrl, async () => (await getSyncConfig()).token ?? ''),
            { deviceId: await getDeviceId(), deviceName: config.deviceName, realtime: config.liveUpdates, ...syncHooks },
          )
        : local;
    await provider.init();
    return provider;
  })());
}

/** Drop the cached provider (after the sync settings change). Returns the old one so it can be stopped. */
export async function resetStorage(): Promise<IStorageProvider | undefined> {
  const old = instance;
  instance = undefined;
  return old;
}

/** Tests only. */
export function setStorageForTests(p: IStorageProvider) {
  instance = Promise.resolve(p);
}
