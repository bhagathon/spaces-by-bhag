/**
 * Control+S toggles the Spaces side panel. Chrome only opens a side panel in direct
 * response to a user gesture, so open() must run synchronously in the command
 * handler, before any await. Each open panel holds a port to the worker, which is
 * how the worker knows which windows have it open; the set is mirrored to session
 * storage because a worker woken by the keypress starts with an empty memory.
 */

const KEY = 'openPanels';
const open = new Set<number>();
let hydrated: Promise<void> | undefined;

function hydrate() {
  return (hydrated ??= chrome.storage.session.get(KEY).then(r => {
    for (const id of (r[KEY] as number[] | undefined) ?? []) open.add(id);
  }));
}
const persist = () => void chrome.storage.session.set({ [KEY]: [...open] });

export function watchPanels() {
  chrome.runtime.onConnect.addListener(port => {
    const m = /^panel:(\d+)$/.exec(port.name);
    if (!m) return;
    const windowId = Number(m[1]);
    open.add(windowId);
    persist();
    port.onDisconnect.addListener(() => {
      open.delete(windowId);
      persist();
    });
  });
}

export function togglePanel(windowId: number) {
  if (open.has(windowId)) {
    void chrome.sidePanel.close({ windowId }).catch(() => {});
    return;
  }
  // Must be synchronous: the keypress's gesture doesn't survive an await.
  const opening = chrome.sidePanel.open({ windowId }).catch(() => {});
  // A worker that just woke doesn't know yet; if the panel was already open, this press closes it.
  void hydrate().then(async () => {
    if (!open.has(windowId)) return;
    await opening;
    await chrome.sidePanel.close({ windowId }).catch(() => {});
  });
}
