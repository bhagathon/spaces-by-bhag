import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { currentSpaceIdAtom, spacesAtom, windowIdAtom } from './atoms';
import { send } from './api';
import { spaceColor, type Space } from '../shared/types';
import { GlobeIcon, SearchIcon } from './Icons';
import { sortTabs, useCanSort } from './sortTabs';

export type CommandTab = 'drawer' | 'today' | 'history' | 'suspension' | 'settings';

interface Item {
  id: string;
  group: 'Spaces' | 'Tabs' | 'Go to';
  label: string;
  sub?: string;
  icon?: ReactNode;
  run: () => void | Promise<void>;
}

const RESULT_LIMIT = 8;

/**
 * ⌘K or /: one field for everything. Spaces switch (or open, on the dashboard), a tab
 * jumps to its Space and then to the tab itself, and the views and card actions are
 * a keystroke away. The current Space's colour is the selection.
 */
export function CommandBar({
  view,
  onClose,
  onTab,
  onError,
  onNotice,
}: {
  view: 'panel' | 'dashboard' | 'command';
  onClose: () => void;
  onTab: (t: CommandTab) => void;
  onError: (e: string) => void;
  onNotice: (text: string) => void;
}) {
  const spaces = useAtomValue(spacesAtom);
  const currentId = useAtomValue(currentSpaceIdAtom);
  const windowId = useAtomValue(windowIdAtom);
  const canSort = useCanSort();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const go = (space: Space, thenUrl?: string) => async () => {
    if (view === 'dashboard') {
      window.dispatchEvent(new CustomEvent('spaces:open-card', { detail: space.id }));
      return;
    }
    if (windowId == null) return;
    try {
      if (space.id !== currentId) {
        const r = await send<'switched' | 'focused' | 'unchanged'>({ type: 'switchSpace', windowId, spaceId: space.id });
        if (r === 'focused') onNotice(`“${space.name}” is open in another window, so that window was brought to the front.`);
      }
      if (thenUrl) {
        const tab = (await chrome.tabs.query({ windowId })).find(t => t.url === thenUrl || t.pendingUrl === thenUrl);
        if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { active: true });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const has = (s?: string) => !needle || (s ?? '').toLowerCase().includes(needle);
    const sorted = [...spaces].sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : a.name.localeCompare(b.name)));
    const spaceItems: Item[] = sorted
      .filter(s => has(s.name))
      .map(s => ({
        id: `s-${s.id}`,
        group: 'Spaces',
        label: s.name,
        sub: s.id === currentId ? 'This window' : `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}`,
        icon: <span className="cmd-dot" style={{ background: `var(--gc-${spaceColor(s)})` }} aria-hidden />,
        run: go(s),
      }));
    const tabItems: Item[] = needle
      ? sorted.flatMap(s =>
          s.tabs
            .filter(t => has(t.title) || has(t.url))
            .map((t, i) => ({
              id: `t-${s.id}-${i}`,
              group: 'Tabs' as const,
              label: t.title || t.url,
              sub: s.name,
              icon: t.favIconUrl ? <img className="favicon" src={t.favIconUrl} alt="" /> : <GlobeIcon className="icon favicon-blank" />,
              run: go(s, t.url),
            })),
        )
      : [];
    const views: [CommandTab, string][] = [
      ['drawer', 'Spaces'],
      ['today', 'Today'],
      ['history', 'History'],
      ['suspension', 'Suspended'],
      ['settings', 'Settings'],
    ];
    // The floating ⌘K window only switches Spaces and tabs; views live in the panel.
    const sortItem: Item[] =
      canSort && windowId != null && view !== 'dashboard'
        ? [
            {
              id: 'a-sort',
              group: 'Go to',
              label: 'Sort tabs by topic',
              sub: 'Gemini',
              run: () => sortTabs(windowId).then(onNotice, e => onError(e instanceof Error ? e.message : String(e))),
            },
          ]
        : [];
    const goItems: Item[] = view === 'command' ? sortItem.filter(i => has(i.label)) : [
      ...sortItem,
      ...views.map(([t, label]) => ({ id: `v-${t}`, group: 'Go to' as const, label, run: () => onTab(t) })),
      ...(currentId
        ? [
            { id: 'a-edit', group: 'Go to' as const, label: 'Edit this Space', run: () => void window.dispatchEvent(new Event('spaces:edit')) },
            { id: 'a-flip', group: 'Go to' as const, label: 'Resources for this Space', run: () => void window.dispatchEvent(new Event('spaces:flip')) },
          ]
        : []),
      ...(view === 'panel'
        ? [{ id: 'a-catalog', group: 'Go to' as const, label: 'Open the full catalog', run: () => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }) }]
        : []),
    ].filter(i => has(i.label));
    return [...spaceItems.slice(0, RESULT_LIMIT), ...tabItems.slice(0, RESULT_LIMIT), ...goItems];
  }, [q, spaces, currentId, view, windowId, canSort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (item?: Item) => {
    if (!item) return;
    // The floating window closes itself, which would cancel an unfinished action, so it acts first.
    if (view === 'command') return void Promise.resolve(item.run()).finally(onClose);
    onClose();
    void item.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setSel(s => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setSel(s => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = '';
  return (
    <div className="cmd-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Search Spaces, tabs and actions" onKeyDown={onKey}>
        <label className="cmd-field">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-results"
            aria-activedescendant={items[sel] ? `cmd-${items[sel].id}` : undefined}
            placeholder="Search Spaces, tabs, or go to…"
            value={q}
            spellCheck={false}
            onChange={e => setQ(e.target.value)}
          />
          <kbd>esc</kbd>
        </label>
        <div className="cmd-results" id="cmd-results" role="listbox" ref={listRef}>
          {items.length === 0 && <p className="cmd-empty">Nothing matches “{q.trim()}”.</p>}
          {items.map((item, i) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id} role="presentation">
                {head && <div className="cmd-group">{head}</div>}
                <div
                  id={`cmd-${item.id}`}
                  role="option"
                  aria-selected={i === sel}
                  className="cmd-item"
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(item)}
                >
                  {item.icon ?? <span className="cmd-dot cmd-dot-go" aria-hidden />}
                  <span className="cmd-label">{item.label}</span>
                  {item.sub && <span className="cmd-sub">{item.sub}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
