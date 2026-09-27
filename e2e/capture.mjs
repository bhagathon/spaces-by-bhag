// Screenshot harness for design review. All tab titles and content here are synthetic demo data.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = '.impeccable/review';
const PAGES = {
  '/doc-plan': ['Q4 launch plan — Docs', '#1a73e8', 'D'],
  '/doc-notes': ['Launch notes: pricing page copy', '#1a73e8', 'D'],
  '/pr-1': ['Fix sync tombstones · Pull Request #212', '#24292f', 'P'],
  '/pr-2': ['Card pull transition · Pull Request #215', '#24292f', 'P'],
  '/ci': ['Checks · main · passing', '#24292f', 'C'],
  '/figma': ['Spaces — Card Catalog (Design)', '#a259ff', 'F'],
  '/cal': ['Calendar — Week of Sep 28', '#188038', 'C'],
  '/mail': ['Inbox (3)', '#d93025', 'M'],
  '/lis-1': ['Lisbon: where to stay, Alfama vs Príncipe Real', '#e8710a', 'L'],
  '/lis-2': ['TAP flights LIS · Oct 14–21', '#e8710a', 'T'],
  '/lis-3': ['Time Out Lisbon — 48 hours', '#e8710a', 'T'],
  '/mv3-1': ['chrome.tabs — Chrome for Developers', '#4285f4', 'C'],
  '/mv3-2': ['Service worker lifecycle — Manifest V3', '#4285f4', 'S'],
  '/mv3-3': ['chrome.tabGroups API reference', '#4285f4', 'G'],
  '/mv3-4': ['View Transitions API — MDN', '#000000', 'M'],
  '/tax-1': ['IRS — Estimated taxes (Form 1040-ES)', '#11385b', 'I'],
  '/tax-2': ['Receipts 2026 — Sheets', '#188038', 'S'],
};
const server = http.createServer((req, res) => {
  const [p] = (req.url ?? '/').split('?');
  if (p.startsWith('/fav/')) {
    const key = '/' + p.slice(5).replace('.svg', '');
    const [, color, letter] = PAGES[key] ?? ['', '#777', '?'];
    res.setHeader('content-type', 'image/svg+xml');
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="12" font-family="Arial" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`);
  }
  const [title] = PAGES[p] ?? ['Page', '#777', '?'];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<title>${title}</title><link rel="icon" href="/fav${p}.svg"><h1>${title}</h1>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const ext = path.resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-cap-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false }, suspender: { enabled: false } }));
  const mk = (paths, groups = []) =>
    sw.evaluate(
      async ({ base, paths, groups }) => {
        const w = await chrome.windows.create({ url: paths.map(p => base + p) });
        const tabs = await chrome.tabs.query({ windowId: w.id });
        for (const g of groups) {
          const id = await chrome.tabs.group({ tabIds: g.idx.map(i => tabs[i].id), createProperties: { windowId: w.id } });
          await chrome.tabGroups.update(id, { title: g.title, color: g.color });
        }
        await chrome.tabs.update(tabs[g_active(paths)].id, { active: true });
        function g_active() { return Math.min(2, paths.length - 1); }
        return w.id;
      },
      { base, paths, groups },
    );
  const work = await mk(['/doc-plan', '/doc-notes', '/pr-1', '/pr-2', '/ci', '/figma', '/cal', '/mail'], [
    { idx: [0, 1], title: 'Docs', color: 'blue' },
    { idx: [2, 3, 4], title: 'Review', color: 'green' },
  ]);
  const trip = await mk(['/lis-1', '/lis-2', '/lis-3']);
  const mv3 = await mk(['/mv3-1', '/mv3-2', '/mv3-3', '/mv3-4'], [{ idx: [0, 1, 2], title: 'API', color: 'purple' }]);
  const tax = await mk(['/tax-1', '/tax-2']);
  const unfiled = await mk(['/figma', '/ci', '/mv3-4']);
  await wait(2500);

  const ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ctl.evaluate(x => chrome.runtime.sendMessage(x), m);
  const W = (await send({ type: 'createSpaceFromWindow', windowId: work, name: 'Launch week' })).value;
  await send({ type: 'createSpaceFromWindow', windowId: trip, name: 'Lisbon trip' });
  await send({ type: 'createSpaceFromWindow', windowId: mv3, name: 'Research: MV3' });
  await send({ type: 'createSpaceFromWindow', windowId: tax, name: 'Taxes 2026' });
  for (const [id, name] of [['home', 'Home admin'], ['reading', 'Reading list'], ['hiring', 'Hiring: design lead']]) {
    await ctl.evaluate(([id, name, base]) => new Promise(res => {
      const r = indexedDB.open('spaces');
      r.onsuccess = () => {
        const tx = r.result.transaction('spaces', 'readwrite');
        tx.objectStore('spaces').put({ id, workspaceId: 'personal', name, tabs: [{ url: base + '/mail', title: 'Inbox (3)', favIconUrl: base + '/fav/mail.svg', pinned: false }, { url: base + '/cal', title: 'Calendar — Week of Sep 28', favIconUrl: base + '/fav/cal.svg', pinned: false }, { url: base + '/doc-plan', title: 'Q4 launch plan — Docs', favIconUrl: base + '/fav/doc-plan.svg', pinned: false }], groups: [], activeIndex: 0, rev: 1, updatedAt: Date.now() - 86400000 * 2 });
        tx.oncomplete = res;
      };
    }), [id, name, base]);
  }
  await ctl.evaluate(([id]) => new Promise(res => {
    const r = indexedDB.open('spaces');
    r.onsuccess = () => {
      const tx = r.result.transaction('resources', 'readwrite');
      tx.objectStore('resources').put({ spaceId: id, workspaceId: 'personal', rev: 1, updatedAt: Date.now(), sections: [
        { id: 's1', title: 'This week', items: [
          { id: 'n1', kind: 'note', text: 'Pricing copy goes to legal Tuesday.\nFreeze the changelog Thursday noon.' },
          { id: 't1', kind: 'task', text: 'Review tombstone PR', done: true },
          { id: 't2', kind: 'task', text: 'Record the card-pull demo', done: false },
          { id: 'l1', kind: 'link', url: 'https://example.com/launch-brief', title: 'Launch brief' },
        ] },
        { id: 's2', title: 'People', items: [{ id: 'n2', kind: 'note', text: 'Design review with Priya, Thu 3pm.' }] },
      ] });
      tx.oncomplete = res;
    };
  }), [W.id]);

  // Panel page opened inside the Work window, so it reads that window's Space.
  const panelIn = async (windowId, name, { dark = false, act } = {}) => {
    const tabId = await sw.evaluate(async ({ w, url }) => (await chrome.tabs.create({ windowId: w, url, active: false })).id, { w: windowId, url: `chrome-extension://${extId}/panel.html` });
    await wait(600);
    const page = ctx.pages().find(p => p.url().includes('panel.html') && !p.__used);
    page.__used = true;
    await page.setViewportSize({ width: 400, height: 900 });
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.waitForSelector('.pulled');
    await page.evaluate(() => document.fonts.ready);
    if (act) await act(page);
    await wait(300);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    return { page, tabId };
  };
  await panelIn(work, 'mobile');
  await panelIn(work, 'panel-dark', { dark: true });
  await panelIn(work, 'panel-verso', { act: async p => { await p.keyboard.press('v'); await wait(400); } });
  await panelIn(work, 'panel-find', { act: async p => { await p.keyboard.press('/'); await p.keyboard.type('lis'); } });
  await panelIn(unfiled, 'panel-unfiled');

  await ctl.setViewportSize({ width: 1440, height: 900 });
  await ctl.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await ctl.reload();
  await ctl.waitForSelector('.card-top');
  await ctl.evaluate(() => document.fonts.ready);
  await ctl.getByRole('button', { name: /^Open Launch week/ }).click();
  await wait(500);
  await ctl.screenshot({ path: `${OUT}/desktop.png`, fullPage: true });
  await ctl.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await wait(300);
  await ctl.screenshot({ path: `${OUT}/desktop-dark.png`, fullPage: true });
  await ctl.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await ctl.getByRole('tab', { name: 'Settings' }).click();
  await wait(300);
  await ctl.screenshot({ path: `${OUT}/desktop-settings.png`, fullPage: true });
  console.log('captured');
} finally {
  await ctx.close();
  server.close();
}
