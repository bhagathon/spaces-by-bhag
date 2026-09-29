/**
 * ⌘K from anywhere: a small focused popup window, centred near the top of the browser
 * window the shortcut was pressed in. An in-page shortcut only works while the side
 * panel has focus; a Chrome command works on every page.
 */
const WIDTH = 620;
const HEIGHT = 440;
let openId: number | undefined;

export async function openCommandWindow(overWindowId: number) {
  if (openId !== undefined) {
    const ok = await chrome.windows.update(openId, { focused: true }).then(() => true, () => false);
    if (ok) return;
    openId = undefined;
  }
  const over = await chrome.windows.get(overWindowId).catch(() => undefined);
  const left = over?.left !== undefined && over.width ? Math.round(over.left + (over.width - WIDTH) / 2) : undefined;
  const top = over?.top !== undefined ? over.top + 90 : undefined;
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL(`command.html?window=${overWindowId}`),
    type: 'popup',
    width: WIDTH,
    height: HEIGHT,
    left,
    top,
    focused: true,
  });
  openId = w?.id;
}

export function forgetCommandWindow(windowId: number) {
  if (windowId === openId) openId = undefined;
}
