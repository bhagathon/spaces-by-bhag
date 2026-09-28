// Real-browser test for resources, sync against a live local server, and the form guard.
import { chromium } from 'playwright';
import http from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, hashToken } from '../server/src/app.ts';
import { SqliteStore } from '../server/src/sqliteStore.ts';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return v;
    await wait(100);
  }
}

// Pages to browse, including one with a form.
const pages = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(req.url === '/form' ? '<title>Form</title><textarea id="t"></textarea>' : `<title>Page ${req.url}</title><h1>${req.url}</h1>`);
});
await new Promise(r => pages.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${pages.address().port}`;

// Live Spaces server.
const store = new SqliteStore(':memory:');
const api = createApp(store);
await new Promise(r => api.server.listen(0, '127.0.0.1', r));
const serverUrl = `http://127.0.0.1:${api.server.address().port}`;
const token = `t-${randomUUID()}`;
const userId = randomUUID();
await store.createUser({ id: userId, name: 'me', tokenHash: hashToken(token) });

// Test copy of the extension with site access pre-granted (skips the native permission prompt).
const ext = mkdtempSync(path.join(tmpdir(), 'spaces-ext-'));
cpSync('dist', ext, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: false, homeTab: false }, suspender: { enabled: false } }));

  const w1 = await sw.evaluate(async base => (await chrome.windows.create({ url: [`${base}/a`, `${base}/b`] })).id, base);
  await wait(800);
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = msg => ui.evaluate(m => chrome.runtime.sendMessage(m), msg);
  const work = (await send({ type: 'createSpaceFromWindow', windowId: w1, name: 'Work' })).value;
  const readIdb = (storeName, key) =>
    ui.evaluate(
      ([storeName, key]) =>
        new Promise(res => {
          const r = indexedDB.open('spaces');
          r.onsuccess = () => {
            const g = r.result.transaction(storeName).objectStore(storeName).get(key);
            g.onsuccess = () => res(g.result);
          };
        }),
      [storeName, key],
    );

  // ---- Resources, through the UI ----
  await ui.reload();
  // Dashboard: open Work's card from the drawer; its verso (resources) sits beside it.
  await ui.getByRole('button', { name: /^Open Work/ }).click();
  await ui.getByRole('button', { name: 'Add section' }).click();
  await ui.getByLabel('Section title').fill('Launch');
  await ui.getByRole('button', { name: 'Note', exact: true }).click();
  await ui.getByLabel('Note', { exact: true }).fill('Ship on Friday');
  await ui.getByRole('button', { name: 'Task', exact: true }).click();
  await ui.getByLabel('Task', { exact: true }).fill('Write changelog');
  await ui.getByRole('checkbox').first().check();
  await ui.getByLabel('Link URL').fill('example.com/spec');
  await ui.getByRole('button', { name: 'Add', exact: true }).click();
  await wait(1200);
  const res = await readIdb('resources', work.id);
  const items = res?.sections?.[0]?.items ?? [];
  check('resources saved from the UI', res?.sections?.[0]?.title === 'Launch' && items.length === 3, res);
  check('note, done task and normalized link', items[0]?.text === 'Ship on Friday' && items[1]?.done === true && items[2]?.url === 'https://example.com/spec', items);
  await ui.setViewportSize({ width: 900, height: 760 });
  await ui.screenshot({ path: 'e2e/resources.png' });

  // ---- Sync: turn it on through Settings ----
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByLabel('Server URL').fill(serverUrl);
  await ui.getByLabel('Token').fill(token);
  await ui.getByLabel('This device’s name').fill('Test laptop');
  await ui.getByLabel(/Live updates/).check();
  await ui.getByRole('button', { name: 'Turn on sync' }).click();
  const uploaded = await until(async () => (await store.getSpace(work.id)) && (await store.getResources(work.id)));
  check('existing Space and resources uploaded', !!uploaded);
  const status = await until(async () => {
    const s = await sw.evaluate(() => chrome.storage.session.get('syncStatus'));
    return s.syncStatus?.state === 'online' && s.syncStatus.pending === 0 && s.syncStatus;
  });
  check('sync status online, nothing pending', !!status, status);

  // Another device renames the Space on the server; this browser should pick it up live.
  const current = await store.getSpace(work.id);
  const r = await fetch(`${serverUrl}/v1/spaces/${work.id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'if-match': `"${current.rev}"` },
    body: JSON.stringify({ ...current, rev: undefined, updatedAt: undefined, ownerId: undefined, name: 'Work (renamed on phone)' }),
  });
  check('remote rename accepted', r.status === 200, r.status);
  await wait(1000); // the settings page reloads itself after turning sync on
  const renamed = await until(async () => (await readIdb('spaces', work.id))?.name === 'Work (renamed on phone)');
  check('remote rename arrives over the socket', renamed);

  // Local tab change pushes to the server.
  await sw.evaluate(async ({ w, base }) => chrome.tabs.create({ windowId: w, url: `${base}/c`, active: false }), { w: w1, base });
  const pushed = await until(async () => (await store.getSpace(work.id))?.tabs.length === 3);
  check('local tab change pushed to server', pushed, (await store.getSpace(work.id))?.tabs.map(t => t.url));
  const kept = await store.getSpace(work.id);
  check('remote rename survives the local auto-save', kept?.name === 'Work (renamed on phone)', kept?.name);

  // ---- Form guard ----
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByLabel('Never suspend tabs with unsaved form text').click();
  const guardOn = await until(() => sw.evaluate(() => chrome.storage.local.get('formGuard').then(r => r.formGuard === true)));
  check('form guard enabled', guardOn);
  const formPage = await ctx.newPage();
  await formPage.goto(`${base}/form`);
  await wait(500);
  const formTabId = await sw.evaluate(async base => (await chrome.tabs.query({ url: `${base}/form` }))[0].id, base);
  const autoDiscardable = () => sw.evaluate(id => chrome.tabs.get(id).then(t => t.autoDiscardable), formTabId);
  check('clean form page is suspendable', (await autoDiscardable()) === true);
  await formPage.locator('#t').fill('half-written reply');
  const guarded = await until(async () => (await autoDiscardable()) === false);
  check('typing protects the tab from suspension', guarded);
  await formPage.locator('#t').fill('');
  const released = await until(async () => (await autoDiscardable()) === true, 8000);
  check('clearing the text releases it', released);

  await ui.getByRole('tab', { name: 'Spaces' }).click();
  await ui.screenshot({ path: 'e2e/dashboard-synced.png' });

  // Undo after delete, through the UI; the server must end up with the Space again.
  const spaceName = (await readIdb('spaces', work.id)).name;
  await ui.getByRole('button', { name: new RegExp(`^Open ${spaceName.replace(/[()]/g, '\\$&')}`) }).click();
  await ui.getByRole('button', { name: `Delete ${spaceName}` }).click();
  await ui.getByRole('button', { name: `Confirm delete ${spaceName}` }).click();
  const gone = await until(async () => !(await readIdb('spaces', work.id)) && !(await store.getSpace(work.id)));
  check('delete removes the Space locally and on the server', !!gone);
  await ui.getByRole('button', { name: 'Undo' }).click();
  const back = await until(async () => (await readIdb('spaces', work.id))?.name === spaceName && (await store.getSpace(work.id))?.name === spaceName);
  check('undo brings it back, locally and on the server', !!back);
  const resBack = await until(async () => (await store.getResources(work.id))?.sections?.[0]?.title === 'Launch');
  check('undo restores its resources too', !!resBack);
} finally {
  await ctx.close();
  await api.close();
  pages.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
