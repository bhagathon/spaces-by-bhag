import { useEffect, useState } from 'react';
import { SUSPENSION_LOG_KEY } from '../shared/settings';
import type { SuspensionRecord } from '../shared/types';
import { send } from './api';

export function Suspension({ onError }: { onError: (e: string) => void }) {
  const [log, setLog] = useState<SuspensionRecord[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const read = () => chrome.storage.local.get(SUSPENSION_LOG_KEY).then(r => setLog((r[SUSPENSION_LOG_KEY] ?? []) as SuspensionRecord[]));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SUSPENSION_LOG_KEY in changes) void read();
    };
    void read();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const suspendNow = async () => {
    try {
      const n = await send<number>({ type: 'suspendNow' });
      setStatus(`Suspended ${n} tab${n === 1 ? '' : 's'}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <article className="card page-card">
      <h2 className="page-title">Suspended</h2>
      <p className="hint">Background tabs you haven’t looked at for a while are unloaded to free memory. They keep their place and reload when you click them.</p>
      <div className="row">
        <button className="plate-button" onClick={() => void suspendNow()}>
          Suspend background tabs now
        </button>
        {status && (
          <span className="hint" role="status" style={{ margin: 0 }}>
            {status}
          </span>
        )}
      </div>
      {!log.length ? (
        <p className="empty">Nothing suspended yet.</p>
      ) : (
        <ul className="log">
          {log.map((r, i) => (
            <li key={i}>
              <span className="log-title">{r.title || r.url}</span>
              <span className="log-meta">
                idle {Math.round(r.idleMs / 60_000)} min · {new Date(r.suspendedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
