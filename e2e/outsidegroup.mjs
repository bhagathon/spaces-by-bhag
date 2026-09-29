// Real-browser test: with the Space-group setting off, a tab opened outside the Space
// makes the Space's tabs a group; adding it (or attaching) removes the group; Detach
// leaves the Space's tabs labelled.
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
  res.end(`<title>Page ${req.url}</title><a id="l" href="/linked" target="_blank">link</a>`);
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
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: false, homeTab: false }, suspender: { enabled: false } }));
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ui.evaluate(x => chrome.runtime.sendMessage(x), m);
  const strip = w =>
    sw.evaluate(async w => {
      const tabs = await chrome.tabs.query({ windowId: w });
      const names = {};
      for (const g of new Set(tabs.map(t => t.groupId).filter(g => g !== -1))) names[g] = (await chrome.tabGroups.get(g)).title;
      return tabs.map(t => `${new URL(t.url || t.pendingUrl).pathname}${t.groupId === -1 ? '' : `[${names[t.groupId]}]`}`);
    }, w);

  const w = await sw.evaluate(async base => (await chrome.windows.create({ url: [`${base}/a`, `${base}/b`] })).id, base);
  await wait(800);
  await send({ type: 'createSpaceFromWindow', windowId: w, name: 'Work' });
  await wait(500);
  check('no group while every tab is in the Space', (await strip(w)).every(t => !t.includes('[')), await strip(w));

  await sw.evaluate(({ w, base }) => chrome.tabs.create({ windowId: w, url: `${base}/outside` }), { w, base });
  await wait(1200);
  let s = await strip(w);
  check('a tab outside the Space makes the Space a group', JSON.stringify(s) === JSON.stringify(['/a[Work]', '/b[Work]', '/outside']), s);

  // A link opened from a tab in the group: Chrome puts it in the group; it's taken out.
  const tabA = await sw.evaluate(async w => (await chrome.tabs.query({ windowId: w }))[0].id, w);
  await sw.evaluate(async ({ tabA, base }) => chrome.tabs.create({ openerTabId: tabA, url: `${base}/linked`, index: 1 }), { tabA, base });
  await wait(1200);
  s = await strip(w);
  check('a tab opened from the group stays outside it', s.includes('/linked') && s.filter(t => t.includes('[Work]')).length === 2, s);

  await send({ type: 'addLooseTabs', windowId: w });
  await wait(800);
  s = await strip(w);
  check('adding the outside tabs removes the group', s.every(t => !t.includes('[')) && s.length === 4, s);

  await sw.evaluate(({ w, base }) => chrome.tabs.create({ windowId: w, url: `${base}/later` }), { w, base });
  await wait(1200);
  await send({ type: 'detachWindow', windowId: w });
  await wait(800);
  s = await strip(w);
  check('detach leaves the Space’s tabs labelled, and the outside tab outside', s.filter(t => t.includes('[Work]')).length === 4 && s.includes('/later'), s);
  await send({ type: 'syncNow' }).catch(() => {});
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: false, homeTab: true } })); // triggers a group refresh
  await wait(1200);
  s = await strip(w);
  check('the label survives a refresh', s.filter(t => t.includes('[Work]')).length === 4, s);

  await send({ type: 'createSpaceFromWindow', windowId: w, name: 'Attached' });
  await wait(800);
  s = await strip(w);
  check('attaching the window to a Space removes the group', s.every(t => !t.includes('[')), s);

  // Turned off in Settings: an outside tab leaves the Space's tabs ungrouped.
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: false, homeTab: false, markOutsideTabs: false } }));
  const w3 = await sw.evaluate(async base => (await chrome.windows.create({ url: [`${base}/p`, `${base}/q`] })).id, base);
  await wait(800);
  await send({ type: 'createSpaceFromWindow', windowId: w3, name: 'Quiet' });
  await sw.evaluate(({ w3, base }) => chrome.tabs.create({ windowId: w3, url: `${base}/outside2` }), { w3, base });
  await wait(1200);
  s = await strip(w3);
  check('with the setting off, an outside tab doesn’t group the Space', s.every(t => !t.includes('[')), s);
} finally {
  await ctx.close();
  pages.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll outside-tab group checks passed');
