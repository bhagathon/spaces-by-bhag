import { getStorage } from '../storage';
import { canEdit, type Space, type SpaceEdit } from '../shared/types';
import { allStates, withWindowLock } from './state';
import { captureWindow, saveWindowToSpace } from './switcher';
import { refreshSpaceGroups } from './spaceGroup';

/**
 * Edits from the card's Edit mode. A Space open in a window is its window, so tab
 * edits there act on the real tabs and are saved from them; a Space on the shelf is
 * edited in storage.
 */
export async function editSpace(edit: SpaceEdit) {
  const store = await getStorage();
  const space = await store.getSpace(edit.spaceId);
  if (!space) throw new Error('That Space no longer exists');
  const ws = (await store.listWorkspaces()).find(w => w.id === space.workspaceId);
  if (!canEdit(ws)) throw new Error('You have view-only access to that workspace');

  if (edit.op === 'setColor') {
    await update(edit.spaceId, s => ({ ...s, color: edit.color }));
    await refreshSpaceGroups(); // the tab group follows the colour
    return;
  }

  const windowId = await openWindowOf(edit.spaceId);
  if (windowId !== undefined) {
    return withWindowLock(windowId, async () => {
      const { tabIds } = await captureWindow(windowId);
      const id = tabIds[edit.index];
      if (id === undefined) throw new Error('That tab is no longer open');
      if (edit.op === 'removeTab') {
        if ((await chrome.tabs.query({ windowId })).length <= 1) throw new Error('Can’t close the window’s last tab');
        await chrome.tabs.remove(id);
      } else {
        const target = tabIds[edit.to];
        if (target === undefined) throw new Error('Can’t move the tab there');
        await chrome.tabs.move(id, { index: (await chrome.tabs.get(target)).index });
      }
      await saveWindowToSpace(windowId);
    });
  }

  await update(edit.spaceId, s => {
    const tabs = [...s.tabs];
    const active = tabs[s.activeIndex];
    if (edit.op === 'removeTab') tabs.splice(edit.index, 1);
    else tabs.splice(edit.to, 0, ...tabs.splice(edit.index, 1));
    const groups = s.groups.filter(g => tabs.some(t => t.groupKey === g.key));
    return { ...s, tabs, groups, activeIndex: Math.max(0, tabs.indexOf(active)) };
  });
}

async function openWindowOf(spaceId: string) {
  for (const [windowId, s] of allStates()) {
    if (s.spaceId === spaceId && (await chrome.windows.get(windowId).then(() => true, () => false))) return windowId;
  }
  return undefined;
}

/** Read-modify-write with the provider's revision check, retried if another write lands first. */
async function update(spaceId: string, change: (s: Space) => Space) {
  const store = await getStorage();
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await store.getSpace(spaceId);
    if (!latest) throw new Error('That Space no longer exists');
    const { rev, updatedAt: _u, ...input } = change(latest);
    if ((await store.putSpace(input, rev)).ok) return;
  }
  throw new Error('That Space kept changing; try again');
}
