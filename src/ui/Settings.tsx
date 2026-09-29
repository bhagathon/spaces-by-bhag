import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { FORM_GUARD_KEY, getSuspendSettings, getSwitcherSettings, getSyncConfig } from '../shared/settings';
import type { SuspendSettings, SwitcherSettings } from '../shared/types';
import { syncStatusAtom } from './atoms';
import { send } from './api';
import { getStorage } from '../storage';
import { buildBackup, importBackup } from '../shared/backup';
import type { Notice } from './notice';
import { getTextScale, setTextScale, TEXT_SCALES, type TextScale } from './textScale';
import { getTasksBySpace, getVikunjaConfig, logInWithVikunja, setVikunjaConfig, TASKS_BY_SPACE_KEY } from '../shared/vikunja';
import { getGeminiConfig, setGeminiConfig, type GeminiConfig } from '../shared/gemini';
import { fetchLatestVersion, isNewer, type UpdateResult } from '../shared/update';
import { disconnect, GCAL_CLIENT_ID_KEY, GCAL_CONNECTED_KEY, getToken, redirectUri } from '../shared/gcal';

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
      <DisplaySettings />
      <fieldset>
        <legend>Switching</legend>
        <Check label="Keep pinned tabs across all Spaces" checked={switcher.keepPinnedAcrossSpaces} onChange={v => saveSwitcher({ keepPinnedAcrossSpaces: v })} />
        <Check label="Load background tabs only when clicked" checked={switcher.lazyLoad} onChange={v => saveSwitcher({ lazyLoad: v })} />
        <Check label="Show each window’s Space as a tab group" checked={switcher.showSpaceGroup} onChange={v => saveSwitcher({ showSpaceGroup: v })} />
        <p className="hint">Tabs already in a group you made stay in it; Chrome can’t put a group inside another group.</p>
        <Check label="Pin a Spaces home tab in each Space window" checked={switcher.homeTab} onChange={v => saveSwitcher({ homeTab: v })} />
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
      <VikunjaSettings onError={onError} />
      <GeminiSettings />
      <CalendarSettings onError={onError} />
      <BackupSettings onError={onError} onNotice={onNotice} />
      <UpdateSettings />
      <fieldset>
        <legend>Side panel</legend>
        <p className="hint">
          Chrome picks which side the panel opens on, and extensions can’t change it. Switch it under “Side panel” in Chrome’s Appearance
          settings. That moves every side panel, not just Spaces.
        </p>
        <div className="row">
          <button type="button" className="plate-button outline" onClick={() => void chrome.tabs.create({ url: 'chrome://settings/appearance' })}>
            Open Appearance settings
          </button>
        </div>
      </fieldset>
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

function CalendarSettings({ onError }: { onError: (e: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void chrome.storage.local.get([GCAL_CLIENT_ID_KEY, GCAL_CONNECTED_KEY]).then(r => {
      setClientId((r[GCAL_CLIENT_ID_KEY] as string) ?? '');
      setConnected(r[GCAL_CONNECTED_KEY] === true);
    });
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      await chrome.storage.local.set({ [GCAL_CLIENT_ID_KEY]: clientId.trim() });
      await getToken({ interactive: true });
      setConnected(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectNow = async () => {
    setBusy(true);
    await disconnect().catch(() => {});
    setConnected(false);
    setBusy(false);
  };

  return (
    <fieldset>
      <legend>Google Calendar</legend>
      <p className="hint">
        Shows today’s meetings on the home tab, and the next one in the panel. Read-only; events are fetched straight from Google and
        never stored or synced.
      </p>
      {!connected && (
        <ol className="hint steps">
          <li>
            In Google Cloud Console, enable the Google Calendar API and create an OAuth client of type <em>Web application</em>.
          </li>
          <li>
            Add this as an authorized redirect URI: <code className="copyable">{redirectUri()}</code>
          </li>
          <li>If the consent screen is in testing, add your Google account as a test user.</li>
          <li>Paste the client ID below and connect.</li>
        </ol>
      )}
      <label className="field stacked">
        OAuth client ID
        <input
          className="typed-input"
          placeholder="1234-abc.apps.googleusercontent.com"
          value={clientId}
          disabled={connected}
          spellCheck={false}
          onChange={e => setClientId(e.target.value)}
        />
      </label>
      <div className="row">
        {connected ? (
          <>
            <span className="stamp stamp-here">Connected</span>
            <button type="button" className="text-button" disabled={busy} onClick={() => void disconnectNow()}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" className="plate-button" disabled={busy || !clientId.trim()} onClick={() => void connect()}>
            {busy ? 'Connecting…' : 'Connect Google Calendar'}
          </button>
        )}
      </div>
    </fieldset>
  );
}

function UpdateSettings() {
  const installed = chrome.runtime.getManifest().version;
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; problem?: boolean } | null>(null);

  useEffect(() => {
    void fetchLatestVersion().then(setLatest, () => setLatest(null));
  }, []);

  const updateNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await send<UpdateResult>({ type: 'updateNow' });
      setLatest(r.after && isNewer(r.after, latest ?? '0') ? r.after : latest);
      const logged = r.message.replace(/^\S+ \S+ /, ''); // drop the log line's timestamp
      if (r.updated) setStatus({ text: `Updated to ${r.after}. Spaces is reloading…` });
      else if (logged.startsWith('up to date')) setStatus({ text: `You’re on the newest version (${r.after}).` });
      else setStatus({ text: `The updater said: ${logged || 'nothing'}`, problem: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({
        problem: true,
        text: /native messaging host not found/i.test(msg)
          ? 'The update helper isn’t installed yet. Open the latest Install Spaces app (from the DMG) once to add it.'
          : msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const behind = latest != null && isNewer(latest, installed);
  return (
    <fieldset>
      <legend>Updates</legend>
      <p className="hint">
        Spaces checks for updates at login and every 6 hours. Update now checks right away and installs any new version.
      </p>
      <p className="update-versions">
        <span>Installed {installed}</span>
        <span>{latest == null ? 'Latest: couldn’t check' : `Latest ${latest}`}</span>
        {behind && <span className="stamp stamp-pending">Update available</span>}
      </p>
      <div className="row">
        <button type="button" className="plate-button" disabled={busy} onClick={() => void updateNow()}>
          {busy ? 'Updating…' : 'Update now'}
        </button>
        {status && (
          <span className={`hint${status.problem ? ' update-problem' : ''}`} role="status">
            {status.text}
          </span>
        )}
      </div>
      <p className="hint">
        Log: <code>~/Library/Logs/Spaces-updater.log</code>
      </p>
    </fieldset>
  );
}

function GeminiSettings() {
  const [config, setConfig] = useState<GeminiConfig | null>(null);
  const [key, setKey] = useState('');

  useEffect(() => void getGeminiConfig().then(setConfig), []);
  const save = async (patch: Partial<GeminiConfig>) => {
    await setGeminiConfig(patch);
    setConfig(await getGeminiConfig());
  };
  if (!config) return null;

  return (
    <fieldset>
      <legend>Sort tabs (Gemini)</legend>
      <p className="hint">
        Sort puts related tabs next to each other. It sends each tab’s title and address to Google’s Gemini. Pinned tabs and groups you made
        stay where they are.
      </p>
      {config.apiKey ? (
        <>
          <div className="row">
            <span className="stamp stamp-here">Key saved on this device</span>
            <button type="button" className="text-button" onClick={() => void save({ apiKey: undefined, autoSort: false })}>
              Remove key
            </button>
          </div>
          <Check label="Sort automatically as tabs open" checked={config.autoSort} onChange={v => void save({ autoSort: v })} />
          <p className="hint">Sort is on each window’s card and in ⌘K. Automatic sorting waits until tabs have settled for a few seconds.</p>
        </>
      ) : (
        <>
          <label className="field stacked">
            API key
            <span className="field-note">From Google AI Studio → Get API key. It stays on this device and is never synced.</span>
            <input
              className="typed-input"
              type="password"
              autoComplete="off"
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && key.trim()) {
                  e.preventDefault();
                  void save({ apiKey: key.trim() }).then(() => setKey(''));
                }
              }}
            />
          </label>
          <div className="row">
            <button type="button" className="plate-button" disabled={!key.trim()} onClick={() => void save({ apiKey: key.trim() }).then(() => setKey(''))}>
              Save key
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}

function VikunjaSettings({ onError }: { onError: (e: string) => void }) {
  const [url, setUrl] = useState('https://tasks.bhag.dev');
  const [useToken, setUseToken] = useState(false);
  const [token, setToken] = useState('');
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bySpace, setBySpace] = useState(false);

  useEffect(() => {
    void getTasksBySpace().then(setBySpace);
    void getVikunjaConfig().then(async c => {
      if (!c) return;
      setUrl(c.url);
      setWho(c.username ?? (await whoAmI(c.url, c.token).catch(() => '(token not checked)')));
    });
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const base = url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(base)) throw new Error('The Vikunja address must start with https://');
      // Asked from the click, before other awaits: lets Spaces reach the server and read its tab.
      const granted = await chrome.permissions.request({ origins: [`${new URL(base).origin}/*`] });
      if (!granted) throw new Error('Spaces needs access to your Vikunja site to use its sign-in.');
      if (useToken) {
        const name = await whoAmI(base, token.trim());
        await setVikunjaConfig({ url: base, token: token.trim(), username: name, kind: 'api-token' });
        setWho(name);
        setToken('');
      } else {
        setWho(await logInWithVikunja(base));
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset>
      <legend>Tasks (Vikunja)</legend>
      <p className="hint">Shows your open Vikunja tasks at the bottom of the panel. New tasks go to your Vikunja Inbox.</p>
      <Check
        label="Separate tasks by Space"
        checked={bySpace}
        onChange={v => {
          setBySpace(v);
          void chrome.storage.local.set({ [TASKS_BY_SPACE_KEY]: v });
        }}
      />
      <p className="hint">
        {bySpace
          ? 'Each Space shows its own tasks, kept in its own Vikunja project inside “Spaces” (and so its own BusyCal calendar).'
          : 'Off: the same list in every Space, so switching never hides a task.'}
      </p>
      {who ? (
        <div className="row">
          <span className="stamp stamp-here">Signed in as {who}</span>
          <button type="button" className="text-button" onClick={() => void setVikunjaConfig(null).then(() => setWho(null))}>
            Sign out
          </button>
        </div>
      ) : (
        <>
          <label className="field stacked">
            Server
            <input className="typed-input" type="url" value={url} onChange={e => setUrl(e.target.value)} />
          </label>
          {useToken && (
            <label className="field stacked">
              API token
              <span className="field-note">Vikunja → Settings → API Tokens. Tokens can be set never to expire.</span>
              <input className="typed-input" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="tk_…" />
            </label>
          )}
          <div className="row">
            <button type="button" className="plate-button" disabled={busy || (useToken && !token.trim())} onClick={() => void connect()}>
              {busy ? (useToken ? 'Connecting…' : 'Waiting for Vikunja…') : useToken ? 'Connect' : 'Log in with Vikunja'}
            </button>
            <button type="button" className="text-button" onClick={() => setUseToken(v => !v)}>
              {useToken ? 'Log in with Vikunja instead' : 'Use an API token instead'}
            </button>
          </div>
          {!useToken && (
            <p className="hint">
              {busy
                ? 'Log in to Vikunja in the tab that opened (tick “stay logged in”); Spaces picks it up on its own.'
                : 'Uses the Vikunja sign-in you already have in Chrome. If you’re not logged in, a Vikunja tab opens for you to log in; tick “stay logged in”.'}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

async function whoAmI(url: string, token: string) {
  const res = await fetch(`${url}/api/v1/user`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(res.status === 401 ? 'Vikunja rejected that token.' : `Vikunja answered ${res.status}.`);
  const u = (await res.json()) as { username: string; name?: string };
  return u.name || u.username;
}

function DisplaySettings() {
  const [scale, setScale] = useState<TextScale | null>(null);
  useEffect(() => {
    void getTextScale().then(setScale);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'textScale' in changes) void getTextScale().then(setScale);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  if (scale == null) return null;
  return (
    <fieldset>
      <legend>Display</legend>
      <span className="field-label">Text size</span>
      <div className="segmented" role="group" aria-label="Text size in the side panel">
        {TEXT_SCALES.map(s => (
          <button key={s.value} type="button" className="segment" aria-pressed={s.value === scale} onClick={() => void setTextScale(s.value)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint">
        For the side panel; <kbd>⌘</kbd> <kbd>+</kbd> and <kbd>⌘</kbd> <kbd>−</kbd> change it there too. The full dashboard follows Chrome’s own
        zoom.
      </p>
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
