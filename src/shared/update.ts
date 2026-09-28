/**
 * Manual updates on the Mac install. The LaunchAgent updater checks every 6 hours;
 * "Update now" asks it to run right away through a Chrome native messaging host
 * (installer/update-host.sh), since an extension can't replace its own files.
 */

/** Must match BUCKET in installer/update.conf. */
export const LATEST_URL = 'https://storage.googleapis.com/spaces-by-bhag-updates/latest.json';
export const UPDATE_HOST = 'com.bhagathon.spaces.updater';

export interface UpdateResult {
  ok: boolean;
  before: string;
  after: string;
  updated: boolean;
  /** The updater's last log line, e.g. "2026-09-27 22:04:10 updated 1.2.0 -> 1.2.1". */
  message: string;
}

/** Numeric version comparison ("1.10.0" > "1.9.0"). */
export function isNewer(candidate: string, current: string) {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(LATEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn’t reach the update server (${res.status}).`);
  return ((await res.json()) as { version: string }).version;
}
