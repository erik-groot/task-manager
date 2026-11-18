import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, createFetchMock, Log, LogLevel } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { exportTasks } from '../scripts/export-cloudflare.mjs';
import { openStore } from '../src/store.js';

const config = JSON.parse((await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
const { outputFiles } = await build({ entryPoints: [config.main], bundle: true, format: 'esm', platform: 'browser', write: false });
const migration = await readFile(new URL('../migrations/0001_tasks.sql', import.meta.url), 'utf8');
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const issuer = 'https://task-tests.cloudflareaccess.com';
const bindings = { ACCESS_TEAM_DOMAIN: 'task-tests.cloudflareaccess.com', ACCESS_AUD: 'task-manager-tests', ACCESS_ALLOWED_EMAILS: 'owner@example.com' };
async function token(claims = {}, key = privateKey) {
  return new SignJWT({ email: 'owner@example.com', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(claims.iss ?? issuer).setAudience(claims.aud ?? bindings.ACCESS_AUD).setSubject('owner-id')
    .setIssuedAt().setExpirationTime(claims.exp ?? '5m').sign(key);
}
async function start({ overrides = {}, persist, migrate = true } = {}) {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  fetchMock.get(issuer).intercept({ path: '/cdn-cgi/access/certs' }).reply(200, { keys: [jwk] }, { headers: { 'content-type': 'application/json' } }).persist();
  const mf = new Miniflare({
    name: 'task-manager-test', modules: true, script: outputFiles[0].text, compatibilityDate: config.compatibility_date,
    log: new Log(LogLevel.ERROR), bindings: { ...bindings, ...overrides }, fetchMock,
    d1Databases: { DB: 'task-tests' }, d1Persist: persist ?? false,
    assets: { directory: config.assets.directory, binding: config.assets.binding, routerConfig: { invoke_user_worker_ahead_of_assets: config.assets.run_worker_first, has_user_worker: true }, assetConfig: { html_handling: config.assets.html_handling, not_found_handling: config.assets.not_found_handling } },
  });
  const db = await mf.getD1Database('DB');
  if (migrate) {
    try { await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql))); }
    catch (cause) { await mf.dispose(); throw cause; }
  }
  const valid = await token();
  return {
    db, mf,
    request: (path, { method = 'GET', body, assertion = valid, headers = {} } = {}) => mf.dispatchFetch(`https://tasks.example.com${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    close: () => mf.dispose(),
  };
}

test('Worker validates Access signatures and claims before serving assets or tasks', async t => {
  assert.equal(config.preview_urls, false);
  const app = await start(); t.after(() => app.close());
  for (const path of ['/', '/app.js', '/api/session', '/api/tasks']) {
    assert.equal((await app.request(path, { assertion: null, headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } })).status, 401, path);
  }
  const cases = [
    'invalid.token.value',
    await token({ exp: Math.floor(Date.now() / 1000) - 30 }),
    await token({ nbf: Math.floor(Date.now() / 1000) + 120 }),
    await token({ aud: 'different-app' }),
    await token({ iss: 'https://attacker.example.com' }),
    await token({}, (await generateKeyPair('RS256')).privateKey),
  ];
  for (const assertion of cases) assert.equal((await app.request('/api/tasks', { assertion })).status, 401);
  assert.equal((await app.request('/api/tasks', { assertion: await token({ email: 'other@example.com' }) })).status, 403);
  assert.equal((await app.request('/api/tasks', { assertion: null, headers: { Cookie: `CF_Authorization=${await token()}` } })).status, 401);
  const session = await (await app.request('/api/session')).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.authProvider, 'cloudflare-access');
  assert.equal(session.email, 'owner@example.com');
});

test('Worker stays locked when Access configuration is missing or unsafe', async t => {
  for (const overrides of [{ ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'attacker.example' }, { ACCESS_ALLOWED_EMAILS: '' }]) {
    await t.test(JSON.stringify(overrides), async () => {
      const app = await start({ overrides });
      try {
        assert.equal((await app.request('/')).status, 503);
        assert.equal((await app.request('/api/tasks', { method: 'POST', body: { title: 'Must not save' } })).status, 503);
        assert.equal((await app.db.prepare('SELECT count(*) AS count FROM tasks').first()).count, 0);
      } finally { await app.close(); }
    });
  }
});

test('Worker serves the interface with security headers, blocks cross-site API calls, and supports Access logout', async t => {
  const app = await start(); t.after(() => app.close());
  const page = await app.request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Task Manager/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  for (const path of ['/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg', '/fonts/InterVariable.woff2']) assert.equal((await app.request(path)).status, 200, path);
  for (const path of ['/src/server.js', '/index.html', '/fonts/README.md', '/api/not-found']) assert.equal((await app.request(path)).status, 404, path);
  assert.equal((await app.request('/api/tasks', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await app.request('/api/tasks', { method: 'POST', body: { title: 'Blocked' }, headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await app.request('/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200, 'Top-level links and Access redirects can load the protected app');
  assert.deepEqual(await (await app.request('/api/logout', { method: 'POST' })).json(), { ok: true, logoutUrl: '/cdn-cgi/access/logout' });
});

test('Worker task workflow uses real D1, preserves independent concurrent edits, and survives a cold start', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudflare-persist-'));
  let app = await start({ persist: directory });
  t.after(async () => { await app.close(); await rm(directory, { force: true, recursive: true }); });
  const response = await app.request('/api/tasks', { method: 'POST', body: { title: '  Proposal  ', notes: 'Keep these notes', section: 'this-week', dueDate: '2026-11-20', customer: ' Acme ', priority: 'high', type: 'waiting' } });
  assert.equal(response.status, 201);
  const task = await response.json();
  assert.equal(task.title, 'Proposal'); assert.equal(task.customer, 'Acme'); assert.equal(task.completed, false);
  const responses = await Promise.all([
    app.request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { customer: 'Lumen' } }),
    app.request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { priority: 'low', completed: true } }),
  ]);
  assert.ok(responses.every(result => result.status === 200));
  const [edited] = await (await app.request('/api/tasks')).json();
  assert.equal(edited.customer, 'Lumen'); assert.equal(edited.priority, 'low'); assert.equal(edited.completed, true);
  assert.equal(edited.notes, task.notes); assert.equal(edited.dueDate, '2026-11-20');
  await app.close(); app = await start({ persist: directory, migrate: false });
  assert.deepEqual(await (await app.request('/api/tasks')).json(), [edited]);
  const moved = await (await app.request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { section: 'later', completed: false } })).json();
  assert.equal(moved.dueDate, ''); assert.equal(moved.section, 'later'); assert.equal(moved.completed, false);
  assert.equal((await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await app.request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { notes: 'Gone' } })).status, 404);
});

test('Worker rejects invalid and oversized input without writing to D1', async t => {
  const app = await start(); t.after(() => app.close());
  for (const body of [{ title: '' }, { title: 'x'.repeat(201) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', section: 'tomorrow' }, { title: 'Task', dueDate: '2026-02-30' }, { title: 'Task', type: 'other' }, { title: 'Task', completed: 'yes' }, { title: 'Task', notes: 'x'.repeat(4001) }, { title: 'Task', customer: 'x'.repeat(101) }]) {
    assert.equal((await app.request('/api/tasks', { method: 'POST', body })).status, 400);
  }
  assert.equal((await app.request('/api/tasks', { method: 'POST', body: { title: 'x'.repeat(33000) } })).status, 413);
  assert.equal((await app.request('/api/tasks', { method: 'POST', body: { title: 'Task' }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const malformed = await app.mf.dispatchFetch('https://tasks.example.com/api/tasks', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(), 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await (await app.request('/api/tasks')).json(), []);
});

test('local SQLite export preserves legacy IDs, dates, metadata, Unicode and completion in D1 without modifying the source', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudflare-export-'));
  const source = join(directory, 'legacy.sqlite');
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, dueDate TEXT, priority TEXT, completed INTEGER, createdAt TEXT, updatedAt TEXT)`);
  const title = "Café 'proposal' 🧊"; const notes = 'First line\nSecond line\0end';
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('legacy-id', title, notes, '2026-11-20', 'normal', 1, '2026-11-01', '2026-11-02');
  db.close();
  const before = await readFile(source);
  const { sql, count } = exportTasks(source);
  assert.equal(count, 1); assert.deepEqual(await readFile(source), before);
  const app = await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const imports = sql.split('\n').filter(line => line && !line.startsWith('--'));
  await app.db.batch(imports.map(statement => app.db.prepare(statement)));
  const [imported] = await (await app.request('/api/tasks')).json();
  assert.equal(imported.id, 'legacy-id'); assert.equal(imported.title, title); assert.equal(imported.notes, notes);
  assert.equal(imported.priority, 'medium'); assert.equal(imported.dueDate, '2026-11-20'); assert.equal(imported.completed, true);
  assert.equal(imported.createdAt, '2026-11-01'); assert.equal(imported.updatedAt, '2026-11-02');
  assert.equal((await app.request('/api/tasks/legacy-id', { method: 'PATCH', body: { completed: false } })).status, 200);
  await assert.rejects(() => app.db.batch(imports.map(statement => app.db.prepare(statement))), /UNIQUE constraint/);
  assert.equal((await app.db.prepare('SELECT count(*) AS count FROM tasks').first()).count, 1);
});


test('current local task metadata and exact dates survive cloud export/import', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudflare-current-export-'));
  const source = join(directory, 'current.sqlite');
  const local = openStore(source);
  const task = local.create({ title: 'Customer review', notes: 'Keep dates fixed', dueDate: '2027-01-08', section: 'next-week', customer: 'Acme', priority: 'low', type: 'waiting' });
  local.update(task.id, { completed: true });
  const expected = local.list(); local.close();
  const { sql } = exportTasks(source);
  const app = await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const statements = sql.split('\n').filter(line => line && !line.startsWith('--'));
  await app.db.batch(statements.map(statement => app.db.prepare(statement)));
  assert.deepEqual(await (await app.request('/api/tasks')).json(), expected);
});
