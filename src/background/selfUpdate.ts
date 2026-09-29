import { allStates } from './state';
import { openPanelWindows } from './panelToggle';

/** Windows whose panel an update closed, so they can get it back with one click. */
const REOPEN_KEY = 'reopenPanelsAfterUpdate';
const NOTIFICATION_PREFIX = 'spaces-updated:';

/**
 * The Mac updater (installer/updater.sh) replaces this extension's files in place.
 * An unpacked extension serves its files straight from disk, so a newer
 * manifest.json on disk means an update landed: reload to run it, unless a
 * Space switch is mid-flight.
 */
export async function reloadIfUpdatedOnDisk({ evenWithPanelOpen = false } = {}): Promise<boolean> {
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
  // A reload closes the side panel and Chrome won't reopen it without a click, so an
  // automatic update waits until no panel is open. "Update now" goes ahead, and the
  // panel is offered back once the new version is running.
  const panels = await openPanelWindows();
  if (panels.length && !evenWithPanelOpen) return false;
  await chrome.storage.local.set({ [REOPEN_KEY]: { windowIds: panels, at: Date.now() } });
  chrome.runtime.reload();
  return true;
}

/**
 * After an update that closed the panel: a badge on the toolbar icon and a notification.
 * Clicking the notification (a user gesture, so Chrome allows it) reopens the panel; so
 * does the toolbar icon or Control+S.
 */
export async function offerPanelBack() {
  const saved = (await chrome.storage.local.get(REOPEN_KEY))[REOPEN_KEY] as { windowIds: number[]; at: number } | undefined;
  await chrome.storage.local.remove(REOPEN_KEY);
  if (!saved || Date.now() - saved.at > 5 * 60_000) return;
  const alive = (await Promise.all(saved.windowIds.map(id => chrome.windows.get(id).then(() => id, () => undefined)))).filter(
    (id): id is number => id !== undefined,
  );
  if (!alive.length) return;
  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#188038' });
  await chrome.action.setTitle({ title: 'Spaces updated. Click to reopen the panel.' });
  // The window ids ride in the notification's id: a click may wake a fresh worker, and
  // the panel has to open before any await or the click no longer counts.
  chrome.notifications.create(`${NOTIFICATION_PREFIX}${alive.join(',')}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `Spaces updated to ${chrome.runtime.getManifest().version}`,
    message: 'Click to reopen the Spaces panel (or press Control+S).',
    priority: 1,
  });
}

/** Reopen the panel from the "updated" notification. Synchronous up to open(): the click's gesture doesn't survive an await. */
export function onUpdateNotificationClicked(id: string) {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  for (const windowId of id.slice(NOTIFICATION_PREFIX.length).split(',').map(Number)) {
    void chrome.sidePanel.open({ windowId }).catch(() => {});
  }
  chrome.notifications.clear(id);
}

/** The panel is back: drop the "updated" badge and notification. */
export async function panelIsBack() {
  if ((await chrome.action.getBadgeText({})) !== '✓') return false;
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Spaces' });
  for (const id of Object.keys(await chrome.notifications.getAll())) if (id.startsWith(NOTIFICATION_PREFIX)) chrome.notifications.clear(id);
  return true;
}
