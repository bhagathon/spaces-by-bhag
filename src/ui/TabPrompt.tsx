import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { currentSpaceIdAtom, spacesAtom, windowIdAtom, windowStatesAtom } from './atoms';
import { send } from './api';
import { TAB_PROMPT_KEY } from '../shared/settings';
import { CloseIcon } from './Icons';

const SHOW_MS = 2000;

/**
 * "Add <tab> to <Space>?" for a tab just opened in this window. Gone after 2s unless
 * the pointer or keyboard focus is on it. Missing it is safe: the card keeps listing
 * tabs that aren't in the Space until they're added or the window switches.
 */
export function TabPrompt({ onError }: { onError: (e: string) => void }) {
  const windowId = useAtomValue(windowIdAtom);
  const loose = useAtomValue(windowStatesAtom)[String(windowId)]?.looseTabIds ?? [];
  const spaceId = useAtomValue(currentSpaceIdAtom);
  const space = useAtomValue(spacesAtom).find(s => s.id === spaceId);
  const [tab, setTab] = useState<{ id: number; title: string } | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const p = area === 'session' ? (changes[TAB_PROMPT_KEY]?.newValue as { windowId: number; tabId: number } | undefined) : undefined;
      if (!p || p.windowId !== windowId) return;
      setTab({ id: p.tabId, title: 'New tab' });
      void chrome.tabs.get(p.tabId).then(t => setTab(cur => (cur?.id === p.tabId ? { id: p.tabId, title: t.title || t.pendingUrl || 'New tab' } : cur)), () => {});
    };
    // The title arrives as the page loads.
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.title) setTab(cur => (cur?.id === id ? { id, title: info.title! } : cur));
    };
    chrome.storage.onChanged.addListener(onChanged);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [windowId]);

  useEffect(() => {
    if (!tab || held) return;
    const t = setTimeout(() => setTab(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [tab?.id, held]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tab || !space || windowId == null || !loose.includes(tab.id)) return null;
  const hold = { onMouseEnter: () => setHeld(true), onMouseLeave: () => setHeld(false), onFocus: () => setHeld(true), onBlur: () => setHeld(false) };
  return (
    <div className="slip tab-prompt" role="status" {...hold}>
      <span className="tab-prompt-text">
        <span>
          Add to <b>{space.name}</b>?
        </span>
        <span className="tab-prompt-title">{tab.title}</span>
      </span>
      <span className="slip-actions">
        <button
          className="text-button"
          onClick={() => {
            setTab(null);
            send({ type: 'addLooseTabs', windowId, tabIds: [tab.id] }).catch(e => onError(e instanceof Error ? e.message : String(e)));
          }}
        >
          Add
        </button>
        <button className="icon-button" aria-label="Not now" onClick={() => setTab(null)}>
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}
