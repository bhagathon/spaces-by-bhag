// Real-browser test for the Tasks section's refresh: the button, and refreshing on return.
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

// A fake Vikunja: one Inbox project whose tasks the test changes behind the panel's back.
const tasks = [{ id: 1, title: 'First task', done: false, project_id: 7 }];
let listCalls = 0;
const vk = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT');
  if (req.method === 'OPTIONS') return res.end();
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/v1/user') return res.end(JSON.stringify({ username: 'bc', settings: { default_project_id: 7 } }));
  if (url.pathname === '/api/v1/projects/9/tasks') return res.end(JSON.stringify([{ id: 50, title: 'Added under a Space', done: false, project_id: 9 }]));
  if (url.pathname === '/api/v1/projects/7/tasks') {
    listCalls++;
    return res.end(JSON.stringify(tasks));
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise(r => vk.listen(0, '127.0.0.1', r));
const vkUrl = `http://127.0.0.1:${vk.address().port}`;

const ext = path.resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'spaces-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  // A task added under a Space (in its own project) earlier: the one shared list still shows it.
  await sw.evaluate(url => chrome.storage.local.set({ vikunja: { url, token: 'api-token', kind: 'api-token' }, vikunjaProjects: { someSpace: 9 } }), vkUrl);
  const windowId = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/panel.html?window=${windowId}`);

  await panel.getByText('First task').waitFor({ timeout: 10_000 });
  check('one list: a task added under a Space is still listed', await panel.getByText('Added under a Space').isVisible());
  const button = panel.getByRole('button', { name: 'Refresh tasks' });
  check('refresh button shows once Vikunja is connected', await button.isVisible());

  tasks.push({ id: 2, title: 'Added in BusyCal', done: false, project_id: 7 });
  const before = listCalls;
  await button.click();
  await panel.getByText('Added in BusyCal').waitFor({ timeout: 5_000 });
  check('clicking refresh fetches tasks and shows new ones', listCalls > before, { before, listCalls });
  check('refresh button says when tasks were last updated', /^Updated /.test((await button.getAttribute('title')) ?? ''), await button.getAttribute('title'));

  tasks.splice(0, 1); // checked off elsewhere
  const beforeTab = listCalls;
  await sw.evaluate(async () => {
    const t = await chrome.tabs.create({ url: 'about:blank', active: true });
    await chrome.tabs.update(t.id, { active: true });
  });
  await wait(1500);
  check('switching tabs refreshes right away', listCalls > beforeTab, { beforeTab, listCalls });
  check('a task done elsewhere leaves the list', (await panel.getByText('First task').count()) === 0);

  if (process.env.SHOT) await panel.locator('section.tasks').screenshot({ path: process.env.SHOT });
} finally {
  await ctx.close();
  vk.close();
}
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll tasks-refresh checks passed');
