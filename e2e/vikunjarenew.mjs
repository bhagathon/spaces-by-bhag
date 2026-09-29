// Real-browser test: a Vikunja 2.x session (short-lived access token plus an HttpOnly,
// SameSite=Strict refresh cookie) keeps working from the panel after the token lapses.
import { chromium } from 'playwright';
import http from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

const jwt = (secondsLeft, lifetime = 900) => {
  const now = Math.floor(Date.now() / 1000);
  return `h.${Buffer.from(JSON.stringify({ exp: now + secondsLeft, iat: now + secondsLeft - lifetime })).toString('base64url')}.s`;
};
let current = jwt(900);
let refreshCalls = 0;
let cookieSent = false;
const vk = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cookie = /refresh=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
  if (url.pathname === '/login') {
    res.setHeader('set-cookie', 'refresh=r1; HttpOnly; SameSite=Strict; Path=/api/v1/user/token/refresh');
    res.setHeader('content-type', 'text/html');
    return res.end('<title>Vikunja</title>');
  }
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/api/v1/user/token/refresh' && req.method === 'POST') {
    refreshCalls++;
    if (!cookie) return (res.statusCode = 401), res.end('{}');
    cookieSent = true;
    current = jwt(900);
    res.setHeader('set-cookie', 'refresh=r2; HttpOnly; SameSite=Strict; Path=/api/v1/user/token/refresh'); // rotated, like Vikunja
    return res.end(JSON.stringify({ token: current }));
  }
  if (req.headers.authorization !== `Bearer ${current}`) return (res.statusCode = 401), res.end('{}');
  if (url.pathname === '/api/v1/user') return res.end(JSON.stringify({ username: 'bhag', settings: { default_project_id: 7 } }));
  if (url.pathname === '/api/v1/projects/7/tasks') return res.end(JSON.stringify([{ id: 1, title: 'Still signed in', done: false, project_id: 7 }]));
  res.statusCode = 404;
  res.end('{}');
});
await new Promise(r => vk.listen(0, 'localhost', r));
const vkUrl = `http://localhost:${vk.address().port}`;

// The installed extension asks for the Vikunja site when connecting; grant it up front here.
const ext = mkdtempSync(path.join(tmpdir(), 'spaces-ext-'));
cpSync('dist', ext, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://localhost/*');
writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const site = await ctx.newPage();
  await site.goto(`${vkUrl}/login`); // logged in to Vikunja: Chrome now holds the refresh cookie
  await site.close();
  // A borrowed access token that has already lapsed, and no Vikunja tab open.
  await sw.evaluate(url => chrome.storage.local.set({ vikunja: { url, token: 'expired', kind: 'browser', username: 'bhag' } }), vkUrl);
  current = jwt(900);
  const windowId = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/panel.html?window=${windowId}`);
  const ok = await panel.getByText('Still signed in').waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check('a lapsed session renews itself and tasks load', ok, await panel.locator('section.tasks').innerText().catch(() => ''));
  check('the renewal carried the HttpOnly SameSite=Strict cookie', cookieSent, { refreshCalls });
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('vikunja')).vikunja.token);
  check('the fresh token is kept', saved === current);
} finally {
  await ctx.close();
  vk.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll Vikunja renewal checks passed');
