import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs installer/updater.sh (the script the LaunchAgent runs) against a local server.
const root = mkdtempSync(path.join(tmpdir(), 'spaces-updater-'));
const files = new Map<string, Buffer>();
let server: http.Server;
let base = '';

function buildZip(version: string, extra = '') {
  const dir = mkdtempSync(path.join(root, 'build-'));
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Spaces', version }));
  writeFileSync(path.join(dir, 'background.js'), `// ${version}${extra}`);
  const zip = path.join(root, `ext-${version}-${Math.random()}.zip`);
  execFileSync('ditto', ['-c', '-k', dir, zip]);
  return readFileSync(zip);
}

function publish(version: string, opts: { sha?: string; zipVersion?: string } = {}) {
  const zip = buildZip(opts.zipVersion ?? version);
  files.set(`/spaces-${version}.zip`, zip);
  const sha = opts.sha ?? createHash('sha256').update(zip).digest('hex');
  files.set('/latest.json', Buffer.from(JSON.stringify({ version, url: `${base}/spaces-${version}.zip`, sha256: sha })));
}

// Async: the test server lives in this process, so a blocking exec would starve it.
const execFileAsync = promisify(execFile);
async function run(extDir: string, url = `${base}/latest.json`) {
  const log = path.join(mkdtempSync(path.join(root, 'log-')), 'updater.log');
  await execFileAsync('sh', ['installer/updater.sh'], { env: { ...process.env, SPACES_UPDATE_URL: url, SPACES_EXT_DIR: extDir, SPACES_LOG: log } });
  return existsSync(log) ? readFileSync(log, 'utf8') : '';
}

const installed = (extDir: string) => JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version;

function install(version: string) {
  const dir = mkdtempSync(path.join(root, 'ext-'));
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version }));
  writeFileSync(path.join(dir, 'stale.js'), 'old');
  return dir;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = files.get(req.url ?? '');
    if (!body) return res.writeHead(404).end();
    res.writeHead(200).end(body);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('updater.sh', () => {
  it('installs a newer version in place and removes stale files', async () => {
    const ext = install('1.0.0');
    publish('1.1.0');
    expect(await run(ext)).toContain('updated 1.0.0 -> 1.1.0');
    expect(installed(ext)).toBe('1.1.0');
    expect(existsSync(path.join(ext, 'stale.js'))).toBe(false);
  });

  it('refuses a download whose checksum does not match', async () => {
    const ext = install('1.0.0');
    publish('1.2.0', { sha: 'deadbeef' });
    expect(await run(ext)).toContain('refused: checksum mismatch');
    expect(installed(ext)).toBe('1.0.0');
  });

  it('refuses a zip that carries a different version than advertised', async () => {
    const ext = install('1.0.0');
    publish('1.3.0', { zipVersion: '0.0.1' });
    expect(await run(ext)).toContain('refused: zip holds a different version');
    expect(installed(ext)).toBe('1.0.0');
  });

  it('never downgrades, and compares versions numerically', async () => {
    const ext = install('1.10.0');
    publish('1.9.0');
    await run(ext);
    expect(installed(ext)).toBe('1.10.0');
  });

  it('does nothing when the update server is unreachable', async () => {
    const ext = install('1.0.0');
    expect(await run(ext, 'http://127.0.0.1:9/latest.json')).toContain('check failed');
    expect(installed(ext)).toBe('1.0.0');
  });
});
