// Real-browser test for Settings → Updates → "Update now": the extension asks the native
// messaging host (installer/update-host.sh) to run the updater, which installs a newer
// version from a local update server into the extension's own folder.
import { chromium } from 'playwright';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

// Chrome hashes the real path, and macOS temp folders sit behind the /var -> /private/var symlink.
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'spaces-manual-')));
const ext = path.join(root, 'extension');
cpSync('dist', ext, { recursive: true });
const installed = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
const next = installed.replace(/\d+$/, n => String(Number(n) + 1));

// The "published" newer build: same files, bumped version, zipped like publish-update does.
const pub = path.join(root, 'pub');
cpSync('dist', pub, { recursive: true });
const m = JSON.parse(readFileSync(path.join(pub, 'manifest.json'), 'utf8'));
writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify({ ...m, version: next }));
execFileSync('zip', ['-qr', path.join(root, 'next.zip'), '.'], { cwd: pub });
const zip = readFileSync(path.join(root, 'next.zip'));
const server = http.createServer((req, res) => {
  if (req.url === '/latest.json') return res.end(JSON.stringify({ version: next, url: `${base}/next.zip`, sha256: createHash('sha256').update(zip).digest('hex') }));
  if (req.url === '/next.zip') return res.end(zip);
  res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Register the host in the test profile (Chrome also reads <user-data-dir>/NativeMessagingHosts).
const profile = path.join(root, 'profile');
const log = path.join(root, 'updater.log');
const wrapper = path.join(root, 'host.sh');
writeFileSync(wrapper, `#!/bin/sh\nexport SPACES_UPDATER='${path.resolve('installer/updater.sh')}' SPACES_UPDATE_URL='${base}/latest.json' SPACES_EXT_DIR='${ext}' SPACES_LOG='${log}'\nexec /bin/sh '${path.resolve('installer/update-host.sh')}'\n`);
chmodSync(wrapper, 0o755);
const extId = createHash('sha256').update(ext).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => 'abcdefghijklmnop'[parseInt(c, 16)]);
mkdirSync(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
writeFileSync(
  path.join(profile, 'NativeMessagingHosts', 'com.bhagathon.spaces.updater.json'),
  JSON.stringify({ name: 'com.bhagathon.spaces.updater', description: 'test', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extId}/`] }),
);

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  check('the extension ID matches the one computed from its folder (as the installer does)', new URL(sw.url()).host === extId, new URL(sw.url()).host);
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/panel.html`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Update now' }).click();
  const status = page.locator('.settings [role=status]').filter({ hasText: /Updated|newest|updater|helper/ });
  await status.waitFor({ timeout: 20000 });
  const text = await status.textContent();
  check('Update now reports the update', text.includes(`Updated to ${next}`), text);
  const onDisk = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
  check('the new version is on disk in the extension folder', onDisk === next, onDisk);
  check('the updater logged it', readFileSync(log, 'utf8').includes(`updated ${installed} -> ${next}`), readFileSync(log, 'utf8'));
} finally {
  await ctx.close().catch(() => {});
  server.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
