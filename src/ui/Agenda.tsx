import { useCallback, useEffect, useState } from 'react';
import { type AgendaEvent, fetchToday, GCAL_CONNECTED_KEY, getToken, NeedsSignIn } from '../shared/gcal';

type AgendaState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; events: AgendaEvent[] }
  | { status: 'signin'; message: string }
  | { status: 'error'; message: string };

const REFRESH_MS = 5 * 60_000;

/** Today's calendar, refreshed every 5 minutes and whenever the page comes back into view. */
function useAgenda() {
  const [state, setState] = useState<AgendaState>({ status: 'loading' });
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const connected = (await chrome.storage.local.get(GCAL_CONNECTED_KEY))[GCAL_CONNECTED_KEY] === true;
    if (!connected) return setState({ status: 'off' });
    try {
      setState({ status: 'ready', events: await fetchToday() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState(e instanceof NeedsSignIn ? { status: 'signin', message } : { status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000); // moves the NOW stamp along
    const onVisible = () => document.visibilityState === 'visible' && void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && GCAL_CONNECTED_KEY in changes) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [load]);

  const reconnect = async () => {
    try {
      await getToken({ interactive: true });
      await load();
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return { state, now, reconnect };
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Today's events typed onto a ruled card: beside the drawer on the home tab, and as
 * the Today view. The view passes onSetUp, so an unconnected calendar shows how to
 * connect it instead of nothing.
 */
export function Agenda({ onSetUp }: { onSetUp?: () => void } = {}) {
  const { state, now, reconnect } = useAgenda();
  const today = new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (state.status === 'off') {
    if (!onSetUp) return null;
    return (
      <article className="card agenda" aria-label="Today’s calendar">
        <header className="agenda-head">
          <h2 className="agenda-title">Today</h2>
          <span className="agenda-date">{today}</span>
        </header>
        <p className="agenda-note">Connect Google Calendar to see today’s meetings here, with a Join link for video calls.</p>
        <button type="button" className="plate-button outline" onClick={onSetUp}>
          Set up Google Calendar
        </button>
      </article>
    );
  }

  return (
    <article className={`card agenda${onSetUp ? '' : ' dash-agenda'}`} aria-label="Today’s calendar">
      <header className="agenda-head">
        <h2 className="agenda-title">Today</h2>
        <span className="agenda-date">{today}</span>
      </header>
      {state.status === 'loading' && <p className="agenda-note">Reading the calendar…</p>}
      {state.status === 'signin' && (
        <>
          <p className="agenda-note">{state.message}</p>
          <button type="button" className="plate-button outline" onClick={() => void reconnect()}>
            Sign in to Google
          </button>
        </>
      )}
      {state.status === 'error' && <p className="agenda-note">Couldn’t read the calendar. {state.message}</p>}
      {state.status === 'ready' &&
        (state.events.length ? (
          <ol className="agenda-list">
            {state.events.map(e => {
              const live = !e.allDay && e.start <= now && now < e.end;
              const past = !e.allDay && e.end <= now;
              return (
                <li key={e.id} className={`agenda-row${past ? ' past' : ''}${live ? ' live' : ''}`}>
                  <time className="agenda-time" dateTime={new Date(e.start).toISOString()}>
                    {e.allDay ? 'All day' : clock(e.start)}
                  </time>
                  {e.htmlLink ? (
                    <a className="agenda-name" href={e.htmlLink} target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                  ) : (
                    <span className="agenda-name">{e.title}</span>
                  )}
                  <span className="agenda-marks">
                    {live && <span className="stamp stamp-here">Now</span>}
                    {e.joinUrl && !past && (
                      <a className="text-button" href={e.joinUrl} target="_blank" rel="noreferrer" aria-label={`Join ${e.title}`}>
                        Join
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="agenda-note">Nothing on the calendar today.</p>
        ))}
    </article>
  );
}

/** The panel's one line: the meeting in progress, or the next one within the hour. */
export function NextUp() {
  const { state, now } = useAgenda();
  if (state.status !== 'ready') return null;
  const next = state.events.find(e => !e.allDay && e.end > now && e.start - now <= 60 * 60_000);
  if (!next) return null;
  const mins = Math.max(1, Math.round((next.start - now) / 60_000));
  const live = next.start <= now;
  return (
    <p className="next-up">
      {live ? <span className="stamp stamp-here">Now</span> : <span className="next-up-when">In {mins} min</span>}
      <span className="next-up-name">{next.title}</span>
      {next.joinUrl && (
        <a className="text-button" href={next.joinUrl} target="_blank" rel="noreferrer" aria-label={`Join ${next.title}`}>
          Join
        </a>
      )}
    </p>
  );
}
