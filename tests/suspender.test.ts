import { beforeEach, describe, expect, it } from 'vitest';
import { addWindow, fake, resetFake } from './fakeChrome';
import { hostMatches, sweep } from '../src/background/suspender';
import { resetStateForTests, setState } from '../src/background/state';
import { SUSPENSION_LOG_KEY } from '../src/shared/settings';

const NOW = 10_000_000;
const MIN = 60_000;
const discarded = () => fake.tabs.filter(t => t.discarded).map(t => t.url);

beforeEach(() => {
  resetFake();
  resetStateForTests();
});

describe('sweep', () => {
  it('discards only eligible tabs idle past the threshold and logs them', async () => {
    addWindow([
      { url: 'https://active.com/', active: true, lastAccessed: NOW - 999 * MIN },
      { url: 'https://old.com/', lastAccessed: NOW - 31 * MIN, title: 'Old' },
      { url: 'https://recent.com/', lastAccessed: NOW - 5 * MIN },
      { url: 'https://pinned.com/', pinned: true, lastAccessed: NOW - 99 * MIN },
      { url: 'https://music.com/', audible: true, lastAccessed: NOW - 99 * MIN },
      { url: 'https://meet.google.com/abc', lastAccessed: NOW - 99 * MIN },
      { url: 'https://team.slack.com/', lastAccessed: NOW - 99 * MIN },
      { url: 'chrome://settings/', lastAccessed: NOW - 99 * MIN },
      { url: 'https://keep.com/', autoDiscardable: false, lastAccessed: NOW - 99 * MIN },
    ]);
    const records = await sweep(NOW);
    expect(discarded()).toEqual(['https://old.com/']);
    expect(records).toMatchObject([{ url: 'https://old.com/', title: 'Old', idleMs: 31 * MIN, suspendedAt: NOW }]);
    expect(fake.local[SUSPENSION_LOG_KEY]).toHaveLength(1);
  });

  it('respects custom settings and memory pressure', async () => {
    addWindow([{ url: 'https://a.com/', active: true }, { url: 'https://b.com/', lastAccessed: NOW - 6 * MIN }]);
    fake.local.suspender = { idleMinutes: 60 };
    expect(await sweep(NOW)).toHaveLength(0);
    fake.memoryPressure = 0.9;
    expect(await sweep(NOW)).toHaveLength(1);
  });

  it('does nothing when disabled unless forced, and skips windows mid-switch', async () => {
    const w = addWindow([{ url: 'https://a.com/', active: true }, { url: 'https://b.com/', lastAccessed: NOW }]);
    fake.local.suspender = { enabled: false };
    expect(await sweep(NOW)).toHaveLength(0);
    await setState(w, { phase: 'opening' });
    expect(await sweep(NOW, { force: true })).toHaveLength(0);
    await setState(w, { phase: 'idle' });
    expect(await sweep(NOW, { force: true })).toHaveLength(1);
  });
});

describe('hostMatches', () => {
  it('matches exact hosts and wildcard subdomains', () => {
    expect(hostMatches('https://slack.com/x', ['*.slack.com'])).toBe(true);
    expect(hostMatches('https://a.slack.com/x', ['*.slack.com'])).toBe(true);
    expect(hostMatches('https://notslack.com/', ['*.slack.com'])).toBe(false);
    expect(hostMatches('https://zoom.us/', ['zoom.us'])).toBe(true);
    expect(hostMatches('https://x.zoom.us/', ['zoom.us'])).toBe(false);
    expect(hostMatches('not a url', ['zoom.us'])).toBe(false);
  });
});
