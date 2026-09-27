import { getStorage, resetStorage, setSyncHooks } from '../storage';
import { SyncingProvider } from '../storage/SyncingProvider';
import { PRESENCE_KEY, SYNC_STATUS_KEY } from '../shared/settings';
import { allStates } from './state';

setSyncHooks({
  isOpenLocally: spaceId => [...allStates().values()].some(s => s.spaceId === spaceId),
  onStatus: status => void chrome.storage.session.set({ [SYNC_STATUS_KEY]: status }),
  onPresence: bySpace => void chrome.storage.session.set({ [PRESENCE_KEY]: bySpace }),
});

async function syncing() {
  const p = await getStorage();
  return p instanceof SyncingProvider ? p : undefined;
}

export async function startSync() {
  const p = await syncing();
  if (p) {
    p.startSync();
    await updatePresence();
  } else {
    await chrome.storage.session.set({ [SYNC_STATUS_KEY]: { state: 'off', pending: 0 }, [PRESENCE_KEY]: {} });
  }
}

/** Periodic safety net: reconnects are automatic, this catches anything the socket missed. */
export async function syncTick() {
  const p = await syncing();
  if (!p) return;
  await p.syncNow();
  await updatePresence();
}

export async function syncNow() {
  await (await syncing())?.syncNow();
}

/** Tell the server which Spaces this device has open. */
export async function updatePresence() {
  const ids = [...new Set([...allStates().values()].map(s => s.spaceId).filter((id): id is string => !!id))];
  (await syncing())?.sendPresence(ids);
}

export async function restartSync() {
  const old = await resetStorage().catch(() => undefined);
  if (old instanceof SyncingProvider) old.stopSync();
  await startSync();
}
