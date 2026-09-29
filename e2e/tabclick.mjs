// Real-browser test: clicking a tab in a Space card goes to that tab, switching Spaces first if needed.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

const pages = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Page ${req.url.slice(1)}</title>`);
});
await new Promise(r => pages.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${pages.address().port}`;
const ext = path.resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: true, homeTab: false }, suspender: { enabled: false } }));
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ui.evaluate(x => chrome.runtime.sendMessage(x), m);
  const newWindow = paths => sw.evaluate(async ({ base, paths }) => (await chrome.windows.create({ url: paths.map(p => base + p) })).id, { base, paths });
  const activeTitle = w => sw.evaluate(async w => (await chrome.tabs.query({ windowId: w, active: true }))[0]?.title, w);

  const w = await newWindow(['/a1', '/a2', '/a3']);
  await wait(1000);
  await send({ type: 'createSpaceFromWindow', windowId: w, name: 'Alpha' });
  const w2 = await newWindow(['/b1', '/b2']);
  await wait(1000);
  await send({ type: 'createSpaceFromWindow', windowId: w2, name: 'Beta' });
  await send({ type: 'detachWindow', windowId: w2 }); // Beta now on the shelf
  await sw.evaluate(w2 => chrome.windows.remove(w2), w2);
  await wait(500);

  // The panel in its own window, so switching w doesn't close it.
  const cdp = await ctx.newCDPSession(ui);
  const opened = ctx.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html?window=${w}`, newWindow: true });
  const panel = await opened;
  await panel.waitForLoadState();
  await panel.getByRole('button', { name: 'Go to Page a3' }).click();
  await wait(600);
  check('clicking a tab in this window’s Space goes to it', (await activeTitle(w)) === 'Page a3', await activeTitle(w));
  check('the clicked row shows as active', await panel.getByRole('button', { name: 'Go to Page a3' }).evaluate(b => b.closest('li').classList.contains('entry-active')));

  // A card for another Space (the dashboard's) sends this: switch the window to Beta, on its second tab.
  const beta = await ui.evaluate(() => new Promise(res => {
    const r = indexedDB.open('spaces');
    r.onsuccess = () => { const g = r.result.transaction('spaces').objectStore('spaces').getAll(); g.onsuccess = () => res(g.result.find(s => s.name === 'Beta').id); };
  }));
  const r = await send({ type: 'openSpaceTab', windowId: w, spaceId: beta, index: 1 });
  check('the other Space’s tab reply', r.ok && r.value === 'switched', r);
  await wait(1000);
  const ws = await sw.evaluate(async w => (await chrome.tabs.query({ windowId: w })).map(t => t.title || t.url), w);
  check('clicking a tab in another Space switches this window to it', ws.includes('Page b1') && !ws.includes('Page a1'), ws);
  check('and lands on that tab', (await activeTitle(w)) === 'Page b2', await activeTitle(w));
} finally {
  await ctx.close();
  pages.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll tab-click checks passed');
