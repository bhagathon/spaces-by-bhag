import { describe, expect, it } from 'vitest';
import { authUrl, parseAuthRedirect, toAgenda } from '../src/shared/gcal';

describe('Google sign-in', () => {
  it('asks for read-only calendar access with a token response, silently when not interactive', () => {
    const u = new URL(authUrl('cid.apps.googleusercontent.com', 'https://abc.chromiumapp.org/', false));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'cid.apps.googleusercontent.com',
      redirect_uri: 'https://abc.chromiumapp.org/',
      response_type: 'token',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      prompt: 'none',
    });
    expect(new URL(authUrl('c', 'https://r/', true)).searchParams.get('prompt')).toBe('consent');
  });

  it('reads the token and expiry from the redirect fragment, and reports errors', () => {
    expect(parseAuthRedirect('https://abc.chromiumapp.org/#access_token=tok&token_type=Bearer&expires_in=3599', 1000)).toEqual({
      token: 'tok',
      expiresAt: 1000 + 3599_000 - 60_000,
    });
    expect(() => parseAuthRedirect('https://abc.chromiumapp.org/#error=access_denied', 0)).toThrow(/access_denied/);
    expect(() => parseAuthRedirect('https://abc.chromiumapp.org/', 0)).toThrow();
  });
});

describe('toAgenda', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 27, h, m).toISOString();

  it('merges calendars in start order, drops cancelled and declined events, and finds the join link', () => {
    const agenda = toAgenda(
      [
        [
          { id: 'b', summary: 'Review', start: { dateTime: at(14) }, end: { dateTime: at(15) }, hangoutLink: 'https://meet.google.com/x' },
          { id: 'c', status: 'cancelled', summary: 'Gone', start: { dateTime: at(9) }, end: { dateTime: at(10) } },
          { id: 'd', summary: 'Declined', start: { dateTime: at(11) }, end: { dateTime: at(12) }, attendees: [{ self: true, responseStatus: 'declined' }] },
        ],
        [
          { id: 'a', summary: 'Standup', start: { dateTime: at(9, 30) }, end: { dateTime: at(9, 45) },
            conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } },
          { id: 'e', start: { date: '2026-09-27' }, end: { date: '2026-09-28' } },
        ],
      ],
    );
    expect(agenda.map(e => [e.id, e.title, e.allDay, e.joinUrl])).toEqual([
      ['e', '(No title)', true, undefined],
      ['a', 'Standup', false, 'https://zoom.us/j/1'],
      ['b', 'Review', false, 'https://meet.google.com/x'],
    ]);
  });
});
