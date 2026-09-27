import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { FORM_GUARD_KEY, getSuspendSettings, getSwitcherSettings, getSyncConfig } from '../shared/settings';
import type { SuspendSettings, SwitcherSettings } from '../shared/types';
import { syncStatusAtom } from './atoms';
import { send } from './api';
import { getStorage } from '../storage';
import { buildBackup, importBackup } from '../shared/backup';
import type { Notice } from './notice';

export function Settings({ onError, onNotice }: { onError: (e: string) => void; onNotice: (n: Notice) => void }) {
  const [suspend, setSuspend] = useState<SuspendSettings | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherSettings | null>(null);
  const [hosts, setHosts] = useState('');

  useEffect(() => {
    void getSuspendSettings().then(s => {
      setSuspend(s);
      setHosts(s.neverSuspend.join('\n'));
    });
    void getSwitcherSettings().then(setSwitcher);
  }, []);

  if (!suspend || !switcher) return null;

  const saveSuspend = (patch: Partial<SuspendSettings>) => {
    const next = { ...suspend, ...patch };
    setSuspend(next);
    void chrome.storage.local.set({ suspender: next });
  };
  const saveSwitcher = (patch: Partial<SwitcherSettings>) => {
    const next = { ...switcher, ...patch };
    setSwitcher(next);
    void chrome.storage.local.set({ switcher: next });
  };

  return (
    <form className="settings" onSubmit={e => e.preventDefault()}>
      <fieldset>
        <legend>Switching</legend>
        <Check label="Keep pinned tabs across all Spaces" checked={switcher.keepPinnedAcrossSpaces} onChange={v => saveSwitcher({ keepPinnedAcrossSpaces: v })} />
        <Check label="Load background tabs only when clicked" checked={switcher.lazyLoad} onChange={v => saveSwitcher({ lazyLoad: v })} />
      </fieldset>
      <fieldset>
        <legend>Tab suspension</legend>
        <Check label="Suspend inactive tabs automatically" checked={suspend.enabled} onChange={v => saveSuspend({ enabled: v })} />
        <label className="field">
          Suspend after
          <input
            className="typed-input"
            type="number"
            min={1}
            max={1440}
            value={suspend.idleMinutes}
            onChange={e => saveSuspend({ idleMinutes: Math.max(1, Number(e.target.value) || 1) })}
          />
          minutes
        </label>
        <Check label="Skip pinned tabs" checked={suspend.skipPinned} onChange={v => saveSuspend({ skipPinned: v })} />
        <Check label="Skip tabs playing audio" checked={suspend.skipAudible} onChange={v => saveSuspend({ skipAudible: v })} />
        <Check label="Skip tabs in groups" checked={suspend.skipGrouped} onChange={v => saveSuspend({ skipGrouped: v })} />
        <Check label="Suspend sooner (5 min) when memory is low" checked={suspend.aggressiveUnderMemoryPressure} onChange={v => saveSuspend({ aggressiveUnderMemoryPressure: v })} />
        <label className="field stacked">
          Never suspend these sites
          <span className="field-note">
            One per line. <code>*.example.com</code> covers the domain and its subdomains.
          </span>
          <textarea
            className="typed-input"
            rows={4}
            value={hosts}
            onChange={e => setHosts(e.target.value)}
            onBlur={() => saveSuspend({ neverSuspend: hosts.split('\n').map(h => h.trim()).filter(Boolean) })}
          />
        </label>
        <FormGuardToggle onError={onError} />
      </fieldset>
      <SyncSettings onError={onError} />
      <BackupSettings onError={onError} onNotice={onNotice} />
    </form>
  );
}

function FormGuardToggle({ onError }: { onError: (e: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void chrome.storage.local.get(FORM_GUARD_KEY).then(r => setEnabled(!!r[FORM_GUARD_KEY]));
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        // Must be called directly from the click, before any other await.
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (!granted) return;
      }
      await send({ type: 'setFormGuard', enabled: on });
      if (!on) await chrome.permissions.remove({ origins: ['<all_urls>'] }).catch(() => {});
      setEnabled(on);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={e => void toggle(e.target.checked)} />
        Never suspend tabs with unsaved form text
      </label>
      <p className="hint">
        Chrome doesn’t warn you before suspending a tab that has text you’ve typed but not submitted. Turning this on asks for access to all
        sites so Spaces can see when you’ve typed into a form. It only checks whether a field has text, and never reads or stores what you typed.
      </p>
    </>
  );
}

function SyncSettings({ onError }: { onError: (e: string) => void }) {
  const status = useAtomValue(syncStatusAtom);
  const [backendUrl, setBackendUrl] = useState('');
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [liveUpdates, setLiveUpdates] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void getSyncConfig().then(c => {
      setBackendUrl(c.backendUrl ?? '');
      setToken(c.token ?? '');
      setDeviceName(c.deviceName);
      setLiveUpdates(c.liveUpdates);
    });
  }, []);

  const apply = async (config: { backendUrl: string; token: string }) => {
    try {
      const url = config.backendUrl.trim().replace(/\/+$/, '');
      if (url && !/^https?:\/\//.test(url)) throw new Error('Server URL must start with https:// (or http:// for a local server).');
      await chrome.storage.local.set({ backendUrl: url, token: config.token.trim(), deviceName: deviceName.trim() || 'Chrome', liveUpdates });
      await send({ type: 'syncConfigChanged' });
      setSaved(url ? 'Saved. Syncing…' : 'Sync turned off. Your data stays on this device.');
      // This page's provider was built with the old settings.
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const on = status.state !== 'off';

  return (
    <fieldset>
      <legend>Sync</legend>
      <p className="hint">
        Sync Spaces and resources across devices through your own Spaces server. History stays on each device. Get a token with{' '}
        <code>npm run admin add-user &lt;name&gt;</code> on the server.
      </p>
      <label className="field stacked">
        Server URL
        <input className="typed-input" type="url" placeholder="https://spaces-xxxx.run.app" value={backendUrl} onChange={e => setBackendUrl(e.target.value)} />
      </label>
      <label className="field stacked">
        Token
        <input className="typed-input" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
      </label>
      <label className="field stacked">
        This device’s name
        <input className="typed-input" placeholder="Laptop" value={deviceName} onChange={e => setDeviceName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={liveUpdates} onChange={e => setLiveUpdates(e.target.checked)} />
        Live updates (instant sync, and shows which Spaces are open on your other devices)
      </label>
      <p className="hint">
        Without live updates, changes sync once a minute. Live updates keep a connection open, and on Cloud Run that keeps the server billed
        the whole time Chrome is running (roughly $0.09 per hour once past the free tier).
      </p>
      <div className="row">
        <button type="button" className="plate-button" disabled={!backendUrl.trim() || !token.trim()} onClick={() => void apply({ backendUrl, token })}>
          {on ? 'Save' : 'Turn on sync'}
        </button>
        {on && (
          <>
            <button type="button" className="text-button" onClick={() => void send({ type: 'syncNow' }).catch(e => onError(String(e)))}>
              Sync now
            </button>
            <button type="button" className="text-button" onClick={() => void apply({ backendUrl: '', token: '' })}>
              Turn off
            </button>
          </>
        )}
        {saved && <span className="hint" role="status">{saved}</span>}
      </div>
      {on && (
        <p className="hint">
          Status: {status.state}
          {status.pending ? ` · ${status.pending} change${status.pending === 1 ? '' : 's'} waiting` : ''}
          {status.lastSyncAt ? ` · last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}` : ''}
          {status.error ? ` · ${status.error}` : ''}
        </p>
      )}
    </fieldset>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function BackupSettings({ onError, onNotice }: { onError: (e: string) => void; onNotice: (n: Notice) => void }) {
  const exportAll = async () => {
    try {
      const backup = await buildBackup(await getStorage());
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `spaces-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      onNotice({ text: `Exported ${backup.spaces.length} Space${backup.spaces.length === 1 ? '' : 's'}.` });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('That file isn’t valid JSON.');
      }
      const r = await importBackup(await getStorage(), data);
      onNotice({
        text: `Imported ${r.added} Space${r.added === 1 ? '' : 's'}` + (r.skipped ? `; skipped ${r.skipped} you already have.` : '.'),
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <fieldset>
      <legend>Backup</legend>
      <p className="hint">
        Save every Space and its resources to a file, or add Spaces from one. Importing only adds Spaces you don’t already have; it never
        overwrites or deletes anything.
      </p>
      <div className="row">
        <button type="button" className="plate-button outline" onClick={() => void exportAll()}>
          Export backup
        </button>
        <label className="plate-button outline file-button">
          Import backup…
          <input type="file" accept="application/json,.json" onChange={e => void importFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        </label>
      </div>
    </fieldset>
  );
}
