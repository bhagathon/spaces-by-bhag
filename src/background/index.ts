import './sync'; // registers sync hooks before the first getStorage()
import type { Request, Response } from '../shared/types';
import { forgetWindow, getState, hydrate, isBusy } from './state';
import {
  createSpaceFromWindow,
  detachWindow,
  reattachWindows,
  recoverInterruptedSwitches,
  restoreSnapshot,
  saveWindowToSpace,
  switchSpace,
} from './switcher';
import { forgetWindowHash, pruneSnapshots, snapshotAllWindows } from './snapshots';
import { sweep } from './suspender';
import { onTabLoading, onTabRemoved, setFormGuard, setTabDirty } from './formGuard';
import { restartSync, startSync, syncNow, syncTick, updatePresence } from './sync';
import { offerPanelBack, onUpdateNotificationClicked, panelIsBack, reloadIfUpdatedOnDisk } from './selfUpdate';
import { addToSpaceGroup, refreshSpaceGroups } from './spaceGroup';
import { openDashboard, refreshHomeTabs } from './homeTab';
import { UPDATE_HOST, type UpdateResult } from '../shared/update';
import { addLooseTabs, forgetLooseTab, markNewTab, updateBadge } from './looseTabs';
import { editSpace } from './editSpace';
import { togglePanel, watchPanels } from './panelToggle';
import { forgetCommandWindow, openCommandWindow } from './commandWindow';
import { forgetSortedWindow, scheduleAutoSort, sortWindowTabs } from './tabSort';

// All listeners are registered synchronously at top level so MV3 can wake the worker for them.

const ready = hydrate().then(recoverInterruptedSwitches);
void ready.then(startSync);

function setupAlarms() {
  chrome.alarms.create('snapshot', { periodInMinutes: 1 });
  chrome.alarms.create('suspend-sweep', { periodInMinutes: 1 });
  chrome.alarms.create('prune', { periodInMinutes: 60 * 24 });
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  chrome.alarms.create('self-update', { periodInMinutes: 10 });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  setupAlarms();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // An update reloads the extension, which clears the session record of which window holds
  // which Space. Clear leftover Space groups first (so none is saved as the user's), then
  // re-attach open windows the way a browser restart does.
  if (reason === 'update') {
    void ready.then(refreshSpaceGroups).then(reattachWindows).then(updatePresence);
    void offerPanelBack().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  // Give session restore a moment to finish recreating windows.
  setTimeout(() => void ready.then(reattachWindows), 3000);
});

let systemIdle: `${chrome.idle.IdleState}` = 'active';
chrome.idle.onStateChanged.addListener(s => (systemIdle = s));

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  await ready;
  if (name === 'snapshot') {
    await snapshotAllWindows();
    await refreshSpaceGroups(); // picks up renames and deletions synced from other devices
  }
  else if (name === 'suspend-sweep' && systemIdle !== 'locked') await sweep();
  else if (name === 'prune') await pruneSnapshots();
  else if (name === 'sync') await syncTick();
  else if (name === 'self-update') await reloadIfUpdatedOnDisk();
});

watchPanels({
  onOpened: () => void panelIsBack().then(async back => { if (back) await ready.then(updateBadge); }).catch(() => {}),
  // An update that waited for the panel to close can run now.
  onAllClosed: () => void ready.then(() => reloadIfUpdatedOnDisk()),
});
chrome.notifications.onClicked.addListener(onUpdateNotificationClicked);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-panel' && tab?.windowId !== undefined) return togglePanel(tab.windowId);
  if (command === 'command-bar' && tab?.windowId !== undefined) return void openCommandWindow(tab.windowId);
  if (command === 'open-dashboard') void openDashboard();
});

// Debounced auto-save of the attached Space. Ignored mid-switch, when the
// switcher's own tab churn would otherwise be saved as a half-built Space.
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
function scheduleSave(windowId: number) {
  if (isBusy(windowId) || !getState(windowId).spaceId) return;
  clearTimeout(saveTimers.get(windowId));
  saveTimers.set(
    windowId,
    setTimeout(() => {
      saveTimers.delete(windowId);
      if (!isBusy(windowId)) void saveWindowToSpace(windowId);
    }, 1500),
  );
}
const onTabChange = (windowId: number) => void ready.then(() => scheduleSave(windowId));

// A new tab joins the Space group. Wait a beat: a tab opened from a link in a group
// is put in that group just after it's created, and that group should win.
const joinSpaceGroup = (tabId: number) =>
  setTimeout(() => void ready.then(() => chrome.tabs.get(tabId)).then(addToSpaceGroup).catch(() => {}), 250);

chrome.tabs.onCreated.addListener(t => {
  // Marked before the debounced save, so a new tab never lands in the Space unasked.
  void ready.then(() => markNewTab(t)).then(() => onTabChange(t.windowId));
  if (t.id !== undefined) joinSpaceGroup(t.id);
  void scheduleAutoSort(t.windowId);
});
chrome.tabs.onUpdated.addListener((id, info, t) => {
  if (info.status === 'loading') void onTabLoading(id);
  if (info.url || info.title || info.pinned !== undefined || info.groupId !== undefined) onTabChange(t.windowId);
  if (info.url) void scheduleAutoSort(t.windowId);
});
chrome.tabs.onMoved.addListener((_id, { windowId }) => onTabChange(windowId));
chrome.tabs.onActivated.addListener(({ windowId }) => onTabChange(windowId));
chrome.tabs.onAttached.addListener((id, { newWindowId }) => {
  onTabChange(newWindowId);
  joinSpaceGroup(id);
});
chrome.tabs.onDetached.addListener((_id, { oldWindowId }) => onTabChange(oldWindowId));
chrome.tabs.onRemoved.addListener((id, { windowId, isWindowClosing }) => {
  void onTabRemoved(id);
  void ready.then(() => forgetLooseTab(windowId, id));
  // Closing a window keeps its Space intact.
  if (!isWindowClosing) onTabChange(windowId);
});
chrome.tabGroups.onUpdated.addListener(g => onTabChange(g.windowId));
// Windows restored after a crash or via "Restore windows" arrive later than onStartup
// and with new IDs. Re-attach them to their Spaces once their tabs are in (Tabox #48).
let reattachTimer: ReturnType<typeof setTimeout> | undefined;
chrome.windows.onCreated.addListener(w => {
  if (w.type !== 'normal' || w.incognito) return;
  clearTimeout(reattachTimer);
  reattachTimer = setTimeout(() => void ready.then(reattachWindows).then(updatePresence), 3000);
});

chrome.windows.onFocusChanged.addListener(() => void ready.then(updateBadge));

chrome.windows.onRemoved.addListener(windowId => {
  forgetCommandWindow(windowId);
  clearTimeout(saveTimers.get(windowId));
  saveTimers.delete(windowId);
  forgetWindowHash(windowId);
  forgetSortedWindow(windowId);
  void ready.then(() => forgetWindow(windowId)).then(updatePresence);
});

async function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  switch (msg.type) {
    case 'switchSpace':
      return switchSpace(msg.windowId, msg.spaceId).finally(updatePresence);
    case 'createSpaceFromWindow':
      return createSpaceFromWindow(msg.windowId, msg.name, msg.workspaceId).finally(updatePresence);
    case 'detachWindow':
      return detachWindow(msg.windowId).finally(updatePresence);
    case 'restoreSnapshot':
      return restoreSnapshot(msg.windowId, msg.snapshotId).finally(updatePresence);
    case 'suspendNow':
      return (await sweep(Date.now(), { force: true })).length;
    case 'formDirty':
      if (sender.tab?.id !== undefined) await setTabDirty(sender.tab.id, msg.dirty);
      return;
    case 'setFormGuard':
      return setFormGuard(msg.enabled);
    case 'syncNow':
      return syncNow();
    case 'syncConfigChanged':
      return restartSync();
    case 'refreshSpaceGroups':
      return refreshSpaceGroups();
    case 'addLooseTabs':
      return addLooseTabs(msg.windowId, msg.tabIds);
    case 'editSpace':
      return editSpace(msg.edit).finally(updatePresence);
    case 'sortTabs':
      return sortWindowTabs(msg.windowId);
    case 'updateNow': {
      const result = (await chrome.runtime.sendNativeMessage(UPDATE_HOST, { cmd: 'update' })) as UpdateResult;
      // Reply first; the reload that runs the new version ends this worker.
      if (result.updated) setTimeout(() => void reloadIfUpdatedOnDisk({ evenWithPanelOpen: true }), 1500);
      return result;
    }
  }
}

// The Space group and home tab settings apply to open windows as soon as they change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'switcher' in changes) void ready.then(refreshHomeTabs).then(refreshSpaceGroups);
});

chrome.runtime.onMessage.addListener((msg: Request, sender, reply: (r: Response) => void) => {
  handle(msg, sender).then(
    value => reply({ ok: true, value }),
    (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // async response
});
