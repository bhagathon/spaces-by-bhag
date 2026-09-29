// Real-browser test for sorting tabs with Gemini. It calls the real Gemini API, so it
// runs only with GEMINI_API_KEY set (the key is never stored in the repo).
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log('SKIP tab sort (set GEMINI_API_KEY to run it against Gemini)');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// Pages whose titles say what they're about; the path is the topic.
const pages = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>${decodeURIComponent(req.url.split('/').pop())}</title>`);
});
await new Promise(r => pages.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${pages.address().port}`;
const topicOf = title => (/recipe|pasta|bake/i.test(title) ? 'cook' : /react|typescript|npm/i.test(title) ? 'code' : /flight|hotel|denver/i.test(title) ? 'travel' : '?');
const mixed = [
  'React useEffect reference',
  'Cheap flights to Denver',
  'Easy pasta recipe',
  'TypeScript handbook generics',
  'Hotels in Denver downtown',
  'Bake sourdough bread at home',
  'npm package publishing guide',
  'Denver flight status',
  'Tomato pasta sauce recipe',
];

const ext = path.resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, homeTab: false }, suspender: { enabled: false } }));
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ui.evaluate(x => chrome.runtime.sendMessage(x), m);
  const windowId = await sw.evaluate(
    async ({ base, mixed }) => {
      const w = await chrome.windows.create({ url: `${base}/Pinned` });
      await chrome.tabs.update(w.tabs[0].id, { pinned: true });
      for (const t of mixed) await chrome.tabs.create({ windowId: w.id, url: `${base}/${encodeURIComponent(t)}` });
      return w.id;
    },
    { base, mixed },
  );
  await wait(1500);
  const titles = () => sw.evaluate(async w => (await chrome.tabs.query({ windowId: w })).map(t => `${t.pinned ? '📌' : ''}${t.title}`), windowId);
  const runs = list => list.filter((t, i) => i === 0 || topicOf(t) !== topicOf(list[i - 1])).length;

  const created = await send({ type: 'createSpaceFromWindow', windowId, name: 'Sorting' });
  check('window became a Space', created.ok, created);

  const r = await send({ type: 'sortTabs', windowId });
  check('sort without a key explains what to do', !r.ok && /Gemini API key/.test(r.error), r);

  await sw.evaluate(k => chrome.storage.local.set({ gemini: { apiKey: k, autoSort: false } }), apiKey);
  const t0 = Date.now();
  const sorted = await send({ type: 'sortTabs', windowId });
  const after = await titles();
  console.log(`  Gemini took ${Date.now() - t0} ms; topics: ${sorted.value?.topics?.join(', ')}`);
  check('sort succeeds', sorted.ok && sorted.value.moved, sorted);
  check('pinned tab stays first', after[0] === '📌Pinned', after);
  check('related tabs end up together (3 runs of topics)', runs(after.slice(1)) === 3, after);

  await wait(2000); // the debounced save
  const saved = await ui.evaluate(
    () =>
      new Promise(resolve => {
        const open = indexedDB.open('spaces');
        open.onsuccess = () => {
          const all = open.result.transaction('spaces').objectStore('spaces').getAll();
          all.onsuccess = () => resolve(all.result.map(s => s.tabs.map(t => t.title)));
        };
      }),
  );
  check('the Space saves the new order', saved.some(s => JSON.stringify(s) === JSON.stringify(after.slice(1))), { saved, after });

  // Automatic: a new tab about code, opened at the end, moves next to the code tabs.
  await sw.evaluate(k => chrome.storage.local.set({ gemini: { apiKey: k, autoSort: true } }), apiKey);
  await sw.evaluate(({ w, url }) => chrome.tabs.create({ windowId: w, url }), { w: windowId, url: `${base}/${encodeURIComponent('React hooks tutorial')}` });
  let auto = [];
  for (let i = 0; i < 30; i++) {
    await wait(1000);
    auto = await titles();
    if (auto.at(-1) !== 'React hooks tutorial' && runs(auto.slice(1)) === 3) break;
  }
  check('auto-sort files a new tab with its topic', runs(auto.slice(1)) === 3 && auto.length === after.length + 1, auto);
} finally {
  await ctx.close();
  pages.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll tab-sort checks passed');
