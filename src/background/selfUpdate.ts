import { allStates } from './state';

/**
 * The Mac updater (installer/updater.sh) replaces this extension's files in place.
 * An unpacked extension serves its files straight from disk, so a newer
 * manifest.json on disk means an update landed: reload to run it, unless a
 * Space switch is mid-flight.
 */
export async function reloadIfUpdatedOnDisk(): Promise<boolean> {
  const running = chrome.runtime.getManifest().version;
  let onDisk: string | undefined;
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    onDisk = ((await res.json()) as { version?: string }).version;
  } catch {
    return false;
  }
  if (!onDisk || onDisk === running) return false;
  if ([...allStates().values()].some(s => s.phase !== 'idle')) return false;
  chrome.runtime.reload();
  return true;
}
