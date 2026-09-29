// Real-browser check: when the updater rewrites the extension's files on disk,
// the extension notices on its next check and reloads into the new version.
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ext = mkdtempSync(path.join(tmpdir(), 'spaces-selfupdate-'));
cpSync('dist', ext, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'p-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let failures = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' — ' + JSON.stringify(d)}`); if (!ok) failures++; };
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const before = await sw.evaluate(() => chrome.runtime.getManifest().version);
  const m = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  m.version = '9.9.9';
  writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m)); // what updater.sh's rsync does
  const seen = await sw.evaluate(() => fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then(r => r.json()).then(j => j.version));
  check('extension sees the new version on disk', before !== '9.9.9' && seen === '9.9.9', { before, seen });
  // Fire the extension's own self-update alarm now instead of waiting 10 minutes. The running
  // worker must shut down (chrome.runtime.reload). Note: this Playwright build loads extensions
  // with --load-extension, which reload() unloads rather than restarts; with "Load unpacked" in
  // real Chrome the same call restarts it on the new files, so the restart itself isn't asserted here.
  const closed = new Promise(r => sw.on('close', () => r(true)));
  const within = ms => Promise.race([closed, new Promise(r => setTimeout(() => r(false), ms))]);

  // With the side panel open, an automatic update waits: a reload would close the panel,
  // and Chrome won't reopen it without a click.
  const extId = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/panel.html`); // connects as an open panel
  await panel.waitForTimeout(800);
  await sw.evaluate(() => chrome.alarms.create('self-update', { when: Date.now() + 50 })).catch(() => {});
  check('an automatic update waits while the panel is open', !(await within(3000)));

  // Closing the panel lets the waiting update run.
  await panel.close();
  check('closing the panel lets the update reload the extension', await within(15000));
} finally {
  await ctx.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
