import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { syncStatusAtom } from './atoms';
import { Drawer } from './Drawer';
import { History } from './History';
import { Suspension } from './Suspension';
import { Settings } from './Settings';
import { NextUp } from './Agenda';
import { getTextScale, setTextScale, stepScale } from './textScale';
import { CabinetIcon, CloseIcon } from './Icons';
import type { Notice } from './notice';

type Tab = 'drawer' | 'history' | 'suspension' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'drawer', label: 'Spaces' },
  { id: 'history', label: 'History' },
  { id: 'suspension', label: 'Suspended' },
  { id: 'settings', label: 'Settings' },
];

export function App({ view }: { view: 'panel' | 'dashboard' }) {
  const [tab, setTab] = useState<Tab>('drawer');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filterRef = useRef<HTMLInputElement>(null);

  const setNotice = (n: Notice | null) => {
    clearTimeout(noticeTimer.current);
    setNoticeState(n);
    if (n) noticeTimer.current = setTimeout(() => setNoticeState(null), n.action ? 10_000 : 6_000);
  };

  // "/" or ⌘K / Ctrl+K: go to the drawer and find.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest('input, textarea, select');
      const slash = e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey;
      const modK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      // ⌘+ / ⌘− / ⌘0 step the panel's text size (Chrome's zoom doesn't reach the side panel).
      if (view === 'panel' && (e.metaKey || e.ctrlKey) && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key === '-' ? -1 : e.key === '0' ? 0 : 1;
        void getTextScale().then(v => setTextScale(stepScale(v, dir)));
        return;
      }
      if (slash || modK) {
        e.preventDefault();
        // Focus synchronously when the drawer is showing, so keys typed right after "/" land in the field.
        if (filterRef.current) {
          filterRef.current.focus();
          filterRef.current.select();
        } else {
          setTab('drawer');
          requestAnimationFrame(() => filterRef.current?.focus());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app app-${view}`}>
      <header className="drawer-front">
        <h1 className="wordmark">Spaces</h1>
        <SyncStamp />
        {view === 'panel' && (
          <button
            className="icon-button"
            aria-label="Open the full catalog"
            title="Open the full catalog (⌘⇧S)"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })}
          >
            <CabinetIcon />
          </button>
        )}
      </header>

      <nav className="guide-tabs" role="tablist" aria-label="Views">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="guide-tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div key={error} className="slip slip-error" role="alert">
          <span>{error}</span>
          <span className="slip-actions">
            <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </span>
        </div>
      )}
      {notice && (
        <div key={notice.text} className="slip" role="status">
          <span>{notice.text}</span>
          <span className="slip-actions">
            {notice.action && (
              <button
                className="text-button"
                onClick={() => {
                  const run = notice.action!.run;
                  setNotice(null);
                  void run().catch(e => setError(e instanceof Error ? e.message : String(e)));
                }}
              >
                {notice.action.label}
              </button>
            )}
            <button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </span>
        </div>
      )}

      <main>
        {tab === 'drawer' && view === 'panel' && <NextUp />}
        {tab === 'drawer' && <Drawer view={view} query={query} setQuery={setQuery} filterRef={filterRef} onError={setError} onNotice={setNotice} />}
        {tab === 'history' && <History onError={setError} />}
        {tab === 'suspension' && <Suspension onError={setError} />}
        {tab === 'settings' && <Settings onError={setError} onNotice={setNotice} />}
      </main>
    </div>
  );
}

function SyncStamp() {
  const status = useAtomValue(syncStatusAtom);
  if (status.state === 'off') return null;
  const [label, cls] = {
    connecting: ['Connecting', ''],
    online: status.pending ? [`Pending ${status.pending}`, 'stamp-pending'] : ['Synced', ''],
    offline: [status.pending ? `Offline ${status.pending}` : 'Offline', 'stamp-offline'],
    error: ['Sync error', 'stamp-error'],
  }[status.state] as [string, string];
  return (
    // The live region stays mounted so screen readers announce changes; only the stamp inside re-mounts,
    // keyed by state (not the pending count), so it presses on only when the state changes.
    <span className="stamps" role="status">
      <span key={status.state + cls} className={`stamp stamp-press ${cls}`} title={status.error ?? (status.lastSyncAt ? `Last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}` : undefined)}>
        {label}
      </span>
    </span>
  );
}
