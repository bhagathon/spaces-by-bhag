// Real-browser smoke test: loads dist/ into Chromium and drives a full Space switch.
//
// chrome.tabs.discard() segfaults Playwright's Chrome for Testing 153.0.8010.12 even from a
// bare extension with no code, so discard-dependent checks (lazy load, suspender) are off
// unless DISCARD=1. Branded Chrome 137+ ignores --load-extension, so check those by hand there.
const DISCARD = !!process.env.DISCARD;
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ext = path.resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  // The Space group and home tab have their own test (spacegroup.mjs); this one checks switching itself.
  const switcher = DISCARD ? { showSpaceGroup: false, homeTab: false } : { lazyLoad: false, showSpaceGroup: false, homeTab: false };
  await sw.evaluate(({ switcher, keepSuspender }) => chrome.storage.local.set(keepSuspender ? { switcher } : { switcher, suspender: { enabled: false } }), { switcher, keepSuspender: DISCARD });
  const api = fn => sw.evaluate(fn);
  const apiArg = (fn, arg) => sw.evaluate(fn, arg);

  // Window 1 ("Work"): a, b, c with b+c in a blue collapsed group, b active.
  const w1 = await apiArg(async base => {
    const w = await chrome.windows.create({ url: [`${base}/a`, `${base}/b`, `${base}/c`] });
    const tabs = await chrome.tabs.query({ windowId: w.id });
    const g = await chrome.tabs.group({ tabIds: [tabs[1].id, tabs[2].id], createProperties: { windowId: w.id } });
    await chrome.tabGroups.update(g, { title: 'Docs', color: 'blue' });
    await chrome.tabs.update(tabs[1].id, { active: true });
    return w.id;
  }, base);
  // Window 2 ("Home"): x, y.
  const w2 = await apiArg(async base => (await chrome.windows.create({ url: [`${base}/x`, `${base}/y`] })).id, base);
  await new Promise(r => setTimeout(r, 1000));

  // Control page lives in its own window so switches never close it.
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = msg => ui.evaluate(m => chrome.runtime.sendMessage(m), msg);

  const work = await send({ type: 'createSpaceFromWindow', windowId: w1, name: 'Work' });
  const home = await send({ type: 'createSpaceFromWindow', windowId: w2, name: 'Home' });
  check('create Spaces', work.ok && home.ok, { work, home });
  check('Work captured group', work.value.groups[0]?.title === 'Docs' && work.value.groups[0]?.color === 'blue', work.value.groups);
  await send({ type: 'detachWindow', windowId: w2 });

  const snapshotTabs = windowId =>
    apiArg(async windowId => {
      const tabs = await chrome.tabs.query({ windowId });
      const groups = await chrome.tabGroups.query({ windowId });
      return { tabs: tabs.map(t => ({ path: new URL(t.url || t.pendingUrl).pathname, active: t.active, discarded: t.discarded, groupId: t.groupId })), groups };
    }, windowId);

  let r = await send({ type: 'switchSpace', windowId: w1, spaceId: home.value.id });
  check('switch to Home ok', r.ok, r);
  let s = await snapshotTabs(w1);
  check('window 1 now shows Home', JSON.stringify(s.tabs.map(t => t.path)) === '["/x","/y"]', s.tabs);
  check('window 1 still exists', (await api(() => chrome.windows.getAll())).length >= 2);

  r = await send({ type: 'switchSpace', windowId: w1, spaceId: work.value.id });
  check('switch back to Work ok', r.ok, r);
  await new Promise(r => setTimeout(r, 1500));
  s = await snapshotTabs(w1);
  check('tab order restored', JSON.stringify(s.tabs.map(t => t.path)) === '["/a","/b","/c"]', s.tabs);
  check('active tab restored', s.tabs.find(t => t.active)?.path === '/b', s.tabs);
  check('group restored', s.groups.length === 1 && s.groups[0].title === 'Docs' && s.groups[0].color === 'blue', s.groups);
  check('b and c grouped, a not', s.tabs[1].groupId === s.groups[0]?.id && s.tabs[2].groupId === s.groups[0]?.id && s.tabs[0].groupId === -1, s.tabs);
  if (DISCARD) {
    check('background tabs lazily discarded', s.tabs.filter(t => !t.active).every(t => t.discarded), s.tabs);
    const n = await send({ type: 'suspendNow' });
    check('suspendNow ran', n.ok, n);
    const w2tabs = await snapshotTabs(w2);
    check('window 2 background tab discarded', w2tabs.tabs.filter(t => !t.active).every(t => t.discarded), w2tabs.tabs);
  } else {
    console.log('SKIP discard checks (set DISCARD=1 to run them)');
  }

  // Auto-save: add a tab to Work, wait for the debounce, check the stored Space.
  await apiArg(async ({ windowId, base }) => chrome.tabs.create({ windowId, url: `${base}/d`, active: false }), { windowId: w1, base });
  await new Promise(r => setTimeout(r, 2500));
  const saved = await ui.evaluate(
    id => new Promise(res => {
      const req = indexedDB.open('spaces');
      req.onsuccess = () => {
        const get = req.result.transaction('spaces').objectStore('spaces').get(id);
        get.onsuccess = () => res(get.result.tabs.map(t => new URL(t.url).pathname));
      };
    }),
    work.value.id,
  );
  check('auto-save picked up new tab', JSON.stringify(saved) === '["/a","/b","/c","/d"]', saved);

  // Tabox #39: large collections lost their groups. 72 tabs in 10 groups, switched away and back twice.
  const w3 = await apiArg(async base => {
    const urls = Array.from({ length: 72 }, (_, i) => `${base}/big${i}`);
    const w = await chrome.windows.create({ url: urls });
    const tabs = await chrome.tabs.query({ windowId: w.id });
    const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey', 'blue'];
    for (let g = 0; g < 10; g++) {
      const id = await chrome.tabs.group({ tabIds: tabs.slice(g * 7, g * 7 + 7).map(t => t.id), createProperties: { windowId: w.id } });
      await chrome.tabGroups.update(id, { title: `G${g}`, color: colors[g] });
    }
    return w.id;
  }, base);
  await new Promise(r => setTimeout(r, 1500));
  const big = await send({ type: 'createSpaceFromWindow', windowId: w3, name: 'Big' });
  check('big Space captured 72 tabs / 10 groups', big.value.tabs.length === 72 && big.value.groups.length === 10, { tabs: big.value.tabs.length, groups: big.value.groups.length });
  await send({ type: 'detachWindow', windowId: w3 });
  for (let round = 1; round <= 2; round++) {
    const r1 = await send({ type: 'switchSpace', windowId: w1, spaceId: big.value.id });
    const b = await snapshotTabs(w1);
    const titles = b.groups.map(g => g.title).sort().join();
    const sizes = b.groups.map(g => b.tabs.filter(t => t.groupId === g.id).length);
    check(`round ${round}: big Space opens with all 10 groups intact`, r1.ok && r1.value === 'switched' && b.tabs.length === 72 && titles === 'G0,G1,G2,G3,G4,G5,G6,G7,G8,G9' && sizes.every(n => n === 7), { tabs: b.tabs.length, titles, sizes });
    check(`round ${round}: tab order preserved`, b.tabs.every((t, i) => t.path === `/big${i}`), b.tabs.slice(0, 3));
    const back = await send({ type: 'switchSpace', windowId: w1, spaceId: work.value.id });
    const wk = await snapshotTabs(w1);
    check(`round ${round}: back to Work leaves no stray groups`, back.ok && wk.groups.length === 1 && wk.groups[0].title === 'Docs', wk.groups.map(g => g.title));
  }

  // UI renders both Spaces.
  await ui.reload();
  await ui.waitForSelector('.card-top');
  const names = await ui.$$eval('.top-name', els => els.map(e => e.textContent));
  check('dashboard lists Spaces', JSON.stringify(names) === '["Big","Home","Work"]', names);
  await ui.setViewportSize({ width: 900, height: 700 });
  await ui.screenshot({ path: 'e2e/dashboard.png' });
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 360, height: 640 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.waitForSelector('.card-top');
  await panel.screenshot({ path: 'e2e/panel.png' });
} finally {
  await ctx.close();
  server.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
