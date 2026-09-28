/**
 * Google Calendar, read-only. Sign-in uses chrome.identity.launchWebAuthFlow with the
 * user's own OAuth client ID (a "Web application" client whose redirect URI is this
 * extension's chromiumapp.org URL), so no client ID or fixed extension key has to be
 * baked into the build. The access token lives in session storage and is renewed
 * silently (prompt=none) while the user stays signed in to Google.
 */

export const GCAL_CLIENT_ID_KEY = 'gcalClientId';
export const GCAL_CONNECTED_KEY = 'gcalConnected';
const TOKEN_KEY = 'gcalToken';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';

export interface AgendaEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  joinUrl?: string;
  htmlLink?: string;
}

/** The subset of a Calendar API event resource used here. */
export interface ApiEvent {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

export function authUrl(clientId: string, redirectUri: string, interactive: boolean) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SCOPE,
    prompt: interactive ? 'consent' : 'none',
  }).toString();
  return u.toString();
}

/** Tokens are treated as expired a minute early, so a request never races the expiry. */
export function parseAuthRedirect(redirect: string, now = Date.now()) {
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const error = params.get('error');
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  const token = params.get('access_token');
  if (!token) throw new Error('Google sign-in returned no token');
  return { token, expiresAt: now + Number(params.get('expires_in') ?? 3600) * 1000 - 60_000 };
}

// A local date ("2026-09-27") parsed with new Date() would be UTC midnight; all-day events are local.
const localDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
};

/** Merge each calendar's events into one day's agenda: all-day first, then by start time. */
export function toAgenda(calendars: ApiEvent[][]): AgendaEvent[] {
  const seen = new Set<string>();
  const out: AgendaEvent[] = [];
  for (const e of calendars.flat()) {
    if (e.status === 'cancelled' || seen.has(e.id)) continue;
    if (e.attendees?.some(a => a.self && a.responseStatus === 'declined')) continue;
    seen.add(e.id); // the same meeting can appear on several of the user's calendars
    const allDay = !e.start.dateTime;
    out.push({
      id: e.id,
      title: e.summary?.trim() || '(No title)',
      start: allDay ? localDate(e.start.date!) : Date.parse(e.start.dateTime!),
      end: allDay ? localDate(e.end.date!) : Date.parse(e.end.dateTime!),
      allDay,
      joinUrl: e.hangoutLink ?? e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri,
      htmlLink: e.htmlLink,
    });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

export async function getClientId(): Promise<string> {
  return (((await chrome.storage.local.get(GCAL_CLIENT_ID_KEY))[GCAL_CLIENT_ID_KEY] as string) ?? '').trim();
}

export const redirectUri = () => chrome.identity.getRedirectURL();

/** A valid access token. Silent unless `interactive`; throws NeedsSignIn when Google wants the user. */
export class NeedsSignIn extends Error {}
export async function getToken({ interactive = false } = {}): Promise<string> {
  if (!interactive) {
    const saved = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as { token: string; expiresAt: number } | undefined;
    if (saved && saved.expiresAt > Date.now()) return saved.token;
  }
  const clientId = await getClientId();
  if (!clientId) throw new NeedsSignIn('Add a Google OAuth client ID in Settings first.');
  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl(clientId, redirectUri(), interactive), interactive });
  } catch (e) {
    if (!interactive) throw new NeedsSignIn('Google needs you to sign in again.');
    throw e;
  }
  if (!redirect) throw new NeedsSignIn('Google sign-in was closed.');
  const parsed = parseAuthRedirect(redirect);
  await chrome.storage.session.set({ [TOKEN_KEY]: parsed });
  await chrome.storage.local.set({ [GCAL_CONNECTED_KEY]: true });
  return parsed.token;
}

export async function disconnect() {
  const saved = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as { token: string } | undefined;
  await chrome.storage.session.remove(TOKEN_KEY);
  await chrome.storage.local.set({ [GCAL_CONNECTED_KEY]: false });
  // Revoke so the grant doesn't linger in the user's Google account.
  if (saved) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(saved.token)}`, { method: 'POST' }).catch(() => {});
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await chrome.storage.session.remove(TOKEN_KEY);
    throw new NeedsSignIn('Google needs you to sign in again.');
  }
  if (!res.ok) throw new Error(`Google Calendar: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Today's events across the calendars the user has shown in Google Calendar (up to 10). */
export async function fetchToday(now = Date.now()): Promise<AgendaEvent[]> {
  const token = await getToken();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { items: cals = [] } = await api<{ items?: { id: string; selected?: boolean; primary?: boolean }[] }>(
    '/users/me/calendarList?minAccessRole=reader',
    token,
  );
  const chosen = cals.filter(c => c.selected || c.primary).slice(0, 10);
  const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const lists = await Promise.all(
    chosen.map(c => api<{ items?: ApiEvent[] }>(`/calendars/${encodeURIComponent(c.id)}/events?${q}`, token).then(r => r.items ?? [])),
  );
  return toAgenda(lists);
}
