// Real-browser test for the Space tab group and the pinned home tab (Chrome enforces
// group contiguity and pinned ordering itself, which the unit-test fake can't).
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
  res.end(`<title>Page ${req.url}</title>`);
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
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: true }, suspender: { enabled: false } }));
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ui.evaluate(x => chrome.runtime.sendMessage(x), m);
  const newWindow = paths => sw.evaluate(async ({ base, paths }) => (await chrome.windows.create({ url: paths.map(p => base + p) })).id, { base, paths });
  const strip = w =>
    sw.evaluate(async w => {
      const tabs = await chrome.tabs.query({ windowId: w });
      const titles = {};
      for (const g of new Set(tabs.map(t => t.groupId).filter(g => g !== -1))) titles[g] = (await chrome.tabGroups.get(g)).title;
      return tabs.map(t => `${t.pinned ? '📌' : ''}${new URL(t.url || t.pendingUrl).pathname}${t.groupId !== -1 ? `{${titles[t.groupId]}}` : ''}`);
    }, w);

  // Errands, then closed, so switching to it replaces tabs instead of focusing its window.
  const w2 = await newWindow(['/x', '/y']);
  await wait(800);
  const errands = (await send({ type: 'createSpaceFromWindow', windowId: w2, name: 'Errands' })).value;
  await sw.evaluate(w => chrome.windows.remove(w), w2);

  // Work: a, [Docs: b], c. The Space group takes a; c is cut off by Docs and must not move.
  const w1 = await newWindow(['/a', '/b', '/c']);
  await wait(800);
  await sw.evaluate(async w => {
    const t = await chrome.tabs.query({ windowId: w });
    const g = await chrome.tabs.group({ tabIds: [t[1].id], createProperties: { windowId: w } });
    await chrome.tabGroups.update(g, { title: 'Docs', color: 'blue' });
  }, w1);
  const work = (await send({ type: 'createSpaceFromWindow', windowId: w1, name: 'Work' })).value;
  await wait(500);
  check('home tab pinned first; Space group beside user group; nothing moved', JSON.stringify(await strip(w1)) === JSON.stringify(['📌/dashboard.html', '/a{Work}', '/b{Docs}', '/c']), await strip(w1));

  const dTab = await sw.evaluate(async ({ w, base }) => (await chrome.tabs.create({ windowId: w, url: base + '/d' })).id, { w: w1, base });
  await wait(600);
  await send({ type: 'addLooseTabs', windowId: w1, tabIds: [dTab] }); // new tabs join the Space only once added
  await wait(900);
  check('a new tab away from the group stays where Chrome put it', JSON.stringify(await strip(w1)) === JSON.stringify(['📌/dashboard.html', '/a{Work}', '/b{Docs}', '/c', '/d']), await strip(w1));

  const saved = await ui.evaluate(
    id => new Promise(res => {
      const r = indexedDB.open('spaces');
      r.onsuccess = () => {
        const g = r.result.transaction('spaces').objectStore('spaces').get(id);
        g.onsuccess = () => res(g.result);
      };
    }),
    work.id,
  );
  check('saved Space has only the user group and no home tab', JSON.stringify(saved?.groups?.map(g => g.title)) === '["Docs"]' && !saved.tabs.some(t => t.url.includes('dashboard')), saved && { groups: saved.groups, tabs: saved.tabs.map(t => t.url) });

  check('switch to Errands', (await send({ type: 'switchSpace', windowId: w1, spaceId: errands.id })).value === 'switched');
  await wait(1000);
  check('home tab survives; group follows the Space', JSON.stringify(await strip(w1)) === JSON.stringify(['📌/dashboard.html', '/x{Errands}', '/y{Errands}']), await strip(w1));

  check('switch back to Work', (await send({ type: 'switchSpace', windowId: w1, spaceId: work.id })).value === 'switched');
  await wait(1000);
  check('Work comes back in its saved order with its own group', JSON.stringify(await strip(w1)) === JSON.stringify(['📌/dashboard.html', '/a{Work}', '/b{Docs}', '/c', '/d']), await strip(w1));

  // What an update does to state: the setting goes back to its default (off) and the session record
  // of which group labels which window is wiped. (A real chrome.runtime.reload() unloads a
  // --load-extension extension in Playwright's Chromium, so stop the worker instead; it rehydrates empty.)
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false } }));
  await sw.evaluate(() => chrome.storage.session.clear());
  const cdp = await ctx.newCDPSession(ui);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // Its own window: a page opened in w1 would be a tab outside the Space, which (rightly) groups the Space.
  const opened = ctx.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html`, newWindow: true });
  const sw2 = await opened;
  await sw2.waitForLoadState();
  await ui.close();
  const strip2 = w => sw2.evaluate(async w => {
    const tabs = await chrome.tabs.query({ windowId: w });
    const titles = {};
    for (const g of new Set(tabs.map(t => t.groupId).filter(g => g !== -1))) titles[g] = (await chrome.tabGroups.get(g)).title;
    return tabs.map(t => `${t.pinned ? '📌' : ''}${new URL(t.url || t.pendingUrl).pathname}${t.groupId !== -1 ? `{${titles[t.groupId]}}` : ''}`);
  }, w).then(list => list.filter(x => x !== '/panel.html')); // this test's own page may open in w1
  const want = JSON.stringify(['📌/dashboard.html', '/a', '/b{Docs}', '/c', '/d']);
  let after;
  for (let i = 0; i < 80 && JSON.stringify(after) !== want; i++) {
    after = await strip2(w1);
    if (JSON.stringify(after) !== want) await wait(1000);
  }
  check('with state lost, the minute tick ungroups the leftover Space group and keeps the user group', JSON.stringify(after) === want, after);

  await sw2.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, showSpaceGroup: false, homeTab: false } }));
  await wait(1000);
  check('turning the home tab off removes it', JSON.stringify(await strip2(w1)) === JSON.stringify(['/a', '/b{Docs}', '/c', '/d']), await strip2(w1));
} finally {
  await ctx.close();
  pages.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
