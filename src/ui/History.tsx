import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { spacesAtom, windowIdAtom } from './atoms';
import { getStorage } from '../storage';
import { send } from './api';
import type { Snapshot } from '../shared/types';
import { isSafeUrl } from '../shared/url';

export function History({ onError }: { onError: (e: string) => void }) {
  const windowId = useAtomValue(windowIdAtom);
  const spaces = useAtomValue(spacesAtom);
  const [spaceFilter, setSpaceFilter] = useState('');
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStorage()
      .then(s => s.listSnapshots({ spaceId: spaceFilter || undefined, limit: 200 }))
      .then(r => !cancelled && setSnaps(r));
    return () => {
      cancelled = true;
    };
  }, [spaceFilter]);

  const nameOf = (id: string | null) => (id ? (spaces.find(s => s.id === id)?.name ?? 'Deleted Space') : 'Unsaved window');

  return (
    <article className="card page-card">
      <h2 className="page-title">History</h2>
      <p className="hint">Each window is photographed onto a card every minute its tabs change, kept 30 days. Restoring files the old card as a new Space and switches this window to it.</p>
      <div className="row">
        <label className="field">
          <span className="visually-hidden">Filter by Space</span>
          <select className="typed-input" style={{ width: 'auto' }} aria-label="Filter by Space" value={spaceFilter} onChange={e => setSpaceFilter(e.target.value)}>
            <option value="">All windows</option>
            {spaces.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {snaps === null ? (
        <p className="empty">Pulling the history drawer…</p>
      ) : !snaps.length ? (
        <p className="empty">No snapshots yet. The first one is taken a minute after a window’s tabs change.</p>
      ) : (
        <ul className="snap-list">
          {snaps.map(s => (
            <li key={s.id}>
              <div className="snap-row">
                <button className="text-button" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                  <span className="snap-when">{new Date(s.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {' · '}
                  {nameOf(s.spaceId)} · {s.tabs.length} tabs
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    windowId != null &&
                    void send({ type: 'restoreSnapshot', windowId, snapshotId: s.id }).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
                  }
                >
                  Restore
                </button>
              </div>
              {open === s.id && (
                <ol className="snap-tabs">
                  {s.tabs.map((t, i) => (
                    <li key={i}>
                      <a href={isSafeUrl(t.url) ? t.url : undefined} target="_blank" rel="noreferrer">
                        {t.title || t.url}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
