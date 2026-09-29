// Real-browser test: with Animations off (the default), nothing in the panel animates when
// a tab opens outside the Space or the window switches Spaces, and the card still flips.
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
  await sw.evaluate(() => chrome.storage.local.set({ switcher: { lazyLoad: false, homeTab: false }, suspender: { enabled: false } }));
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/dashboard.html`);
  const send = m => ui.evaluate(x => chrome.runtime.sendMessage(x), m);
  const newWindow = paths => sw.evaluate(async ({ base, paths }) => (await chrome.windows.create({ url: paths.map(p => base + p) })).id, { base, paths });

  const w = await newWindow(['/a1', '/a2']);
  await wait(800);
  const alpha = (await send({ type: 'createSpaceFromWindow', windowId: w, name: 'Alpha' })).value;
  const w2 = await newWindow(['/b1']);
  await wait(800);
  const beta = (await send({ type: 'createSpaceFromWindow', windowId: w2, name: 'Beta' })).value;
  await send({ type: 'editSpace', edit: { spaceId: alpha.id, op: 'setColor', color: 'blue' } });
  await send({ type: 'editSpace', edit: { spaceId: beta.id, op: 'setColor', color: 'orange' } });
  await send({ type: 'detachWindow', windowId: w2 });
  await sw.evaluate(w2 => chrome.windows.remove(w2), w2);

  const cdp = await ctx.newCDPSession(ui);
  const opened = ctx.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html?window=${w}`, newWindow: true });
  const panel = await opened;
  await panel.waitForLoadState();
  await wait(1000);
  check('animations are off by default', (await panel.evaluate(() => document.documentElement.dataset.motion)) === 'off');

  // Sample running animations for 1.5s after an action.
  const sample = () =>
    panel.evaluate(async () => {
      const seen = new Set();
      for (let i = 0; i < 15; i++) {
        for (const a of document.getAnimations()) seen.add(a.animationName || a.transitionProperty || 'animation');
        await new Promise(r => setTimeout(r, 100));
      }
      return [...seen];
    });
  const outside = sample();
  await sw.evaluate(({ w, base }) => chrome.tabs.create({ windowId: w, url: `${base}/outside` }), { w, base });
  check('opening a tab outside the Space animates nothing', (await outside).length === 0, await outside);

  const switching = sample();
  await send({ type: 'switchSpace', windowId: w, spaceId: beta.id });
  check('switching Spaces animates nothing (no light fade, no swipe)', (await switching).length === 0, await switching);

  await panel.keyboard.press('v');
  await wait(200);
  check('the card still turns over to Resources, instantly', (await panel.getByRole('button', { name: 'Turn back to tabs' }).count()) === 1);

  await sw.evaluate(() => chrome.storage.local.set({ animations: true }));
  await wait(300);
  check('turning Animations on takes effect', (await panel.evaluate(() => document.documentElement.dataset.motion)) === 'on');
} finally {
  await ctx.close();
  pages.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll motion checks passed');
