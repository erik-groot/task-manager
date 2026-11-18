import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { DatabaseSync } from 'node:sqlite';

async function start(databasePath, password = '') {
  const server = createApp({ databasePath, password });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    request: (path, method = 'GET', body, headers = {}) => fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}

test('tasks can be created, edited, completed, reopened, persisted, and deleted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'task-manager-'));
  const database = join(directory, 'tasks.sqlite');
  let app = await start(database);
  try {
    const response = await app.request('/api/tasks', 'POST', { title: '  Plan the week  ', notes: 'On the iPad', dueDate: '2026-11-18', priority: 'high' });
    assert.equal(response.status, 201);
    const task = await response.json();
    assert.equal(task.title, 'Plan the week');
    assert.equal(task.completed, false);
    assert.equal((await (await app.request('/api/tasks')).json()).length, 1);
    const edited = await (await app.request(`/api/tasks/${task.id}`, 'PATCH', { completed: true, title: 'Plan tomorrow' })).json();
    assert.equal(edited.completed, true);
    assert.equal(edited.notes, 'On the iPad');
    await app.close();
    app = await start(database);
    const persisted = await (await app.request('/api/tasks')).json();
    assert.equal(persisted[0].title, 'Plan tomorrow');
    assert.equal(persisted[0].completed, true);
    assert.equal((await (await app.request(`/api/tasks/${task.id}`, 'PATCH', { completed: false })).json()).completed, false);
    assert.equal((await app.request(`/api/tasks/${task.id}`, 'DELETE')).status, 200);
    assert.deepEqual(await (await app.request('/api/tasks')).json(), []);
    assert.equal((await app.request(`/api/tasks/${task.id}`, 'DELETE')).status, 404);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('invalid input is rejected without creating tasks', async () => {
  const app = await start(':memory:');
  try {
    for (const fields of [{ title: '' }, { title: 'a'.repeat(201) }, { title: 'Task', dueDate: '2026-02-30' }, { title: 'Task', priority: 'urgent' }, { title: 'Task', completed: 'yes' }, { title: 'Task', notes: 'a'.repeat(4001) }]) {
      assert.equal((await app.request('/api/tasks', 'POST', fields)).status, 400);
    }
    assert.equal((await app.request('/api/tasks', 'POST', { title: 'a'.repeat(33000) })).status, 413);
    assert.deepEqual(await (await app.request('/api/tasks')).json(), []);
  } finally { await app.close(); }
});

test('shared-device sessions require a passphrase and logout invalidates access', async () => {
  const app = await start(':memory:', 'a-long-test-passphrase');
  try {
    assert.equal((await app.request('/api/tasks')).status, 401);
    assert.equal((await app.request('/api/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await app.request('/api/login', 'POST', { password: 'a-long-test-passphrase' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await app.request('/api/tasks', 'POST', { title: 'From the iPhone' }, headers)).status, 201);
    assert.equal((await (await app.request('/api/tasks', 'GET', undefined, headers)).json())[0].title, 'From the iPhone');
    assert.equal((await app.request('/api/tasks', 'POST', { title: 'Cross-site' }, { ...headers, Origin: 'https://elsewhere.example' })).status, 403);
    assert.equal((await app.request('/api/logout', 'POST', undefined, headers)).status, 200);
    assert.equal((await app.request('/api/tasks', 'GET', undefined, headers)).status, 401);
  } finally { await app.close(); }
});

test('the UI is served with security headers, unknown paths and cross-site traffic are blocked', async () => {
  const app = await start(':memory:');
  try {
    const response = await app.request('/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Task Manager/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    for (const path of ['/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg']) assert.equal((await app.request(path)).status, 200);
    assert.equal((await app.request('/src/server.js')).status, 404);
    assert.equal((await app.request('/api/tasks', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await app.request('/api/tasks', 'POST', { title: 'blocked' }, { Origin: 'https://elsewhere.example' })).status, 403);
  } finally { await app.close(); }
});

test('planning metadata is persisted and changing to an undated section clears the date', async () => {
  const app = await start(':memory:');
  try {
    const response = await app.request('/api/tasks', 'POST', {
      title: 'Review proposal', section: 'this-week', dueDate: '2026-11-20', customer: '  Acme  ', priority: 'low', type: 'waiting',
    });
    assert.equal(response.status, 201);
    const task = await response.json();
    assert.equal(task.customer, 'Acme');
    assert.equal(task.type, 'waiting');
    assert.equal(task.priority, 'low');
    assert.equal(task.section, 'this-week');
    const moved = await app.request(`/api/tasks/${task.id}`, 'PATCH', { section: 'later' });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).dueDate, '');
    const [persisted] = await (await app.request('/api/tasks')).json();
    assert.equal(persisted.customer, 'Acme');
    assert.equal(persisted.section, 'later');
    assert.equal(persisted.dueDate, '');
    for (const fields of [{ section: 'tomorrow' }, { section: 'unknown' }, { type: 'other' }, { priority: 'urgent' }, { customer: 'a'.repeat(101) }, { section: 'backlog', dueDate: '2026-11-20' }]) {
      assert.equal((await app.request(`/api/tasks/${task.id}`, 'PATCH', fields)).status, 400);
    }
    for (const priority of ['low', 'medium', 'high']) assert.equal((await app.request(`/api/tasks/${task.id}`, 'PATCH', { priority })).status, 200);
  } finally { await app.close(); }
});

test('existing databases upgrade without losing tasks, dates, IDs, or completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'task-migration-'));
  const database = join(directory, 'old.sqlite');
  const old = new DatabaseSync(database);
  old.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', dueDate TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal', completed INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  old.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('legacy', 'Existing task', 'Keep notes', '2026-11-20', 'normal', 1, '2026-11-01', '2026-11-02');
  old.close();
  let app = await start(database);
  try {
    let tasks = await (await app.request('/api/tasks')).json();
    assert.equal(tasks[0].id, 'legacy');
    assert.equal(tasks[0].notes, 'Keep notes');
    assert.equal(tasks[0].dueDate, '2026-11-20');
    assert.equal(tasks[0].priority, 'medium');
    assert.equal(tasks[0].completed, true);
    assert.equal(tasks[0].customer, '');
    assert.equal(tasks[0].type, 'task');
    await app.close();
    app = await start(database);
    tasks = await (await app.request('/api/tasks')).json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].priority, 'medium');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
