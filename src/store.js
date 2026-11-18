import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      dueDate TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal',
      completed INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  // Upgrade existing databases in place without changing IDs, dates, or notes.
  const columns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(column => column.name));
  for (const [column, definition] of [
    ['section', "TEXT NOT NULL DEFAULT 'backlog'"],
    ['customer', "TEXT NOT NULL DEFAULT ''"],
    ['type', "TEXT NOT NULL DEFAULT 'task'"],
  ]) {
    if (!columns.has(column)) db.exec(`ALTER TABLE tasks ADD COLUMN ${column} ${definition}`);
  }
  db.exec("UPDATE tasks SET priority = 'medium' WHERE priority = 'normal'");
  const decode = row => row ? { ...row, completed: Boolean(row.completed) } : null;
  const find = id => decode(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  return {
    list: () => db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC, id').all().map(decode),
    find,
    create(fields) {
      const now = new Date().toISOString();
      const task = { id: randomUUID(), section: 'backlog', customer: '', type: 'task', ...fields, completed: false, createdAt: now, updatedAt: now };
      db.prepare('INSERT INTO tasks (id, title, notes, dueDate, priority, completed, createdAt, updatedAt, section, customer, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        task.id, task.title, task.notes, task.dueDate, task.priority, 0, now, now, task.section, task.customer, task.type,
      );
      return task;
    },
    update(id, fields) {
      const previous = find(id);
      if (!previous) return null;
      const task = { ...previous, ...fields, updatedAt: new Date().toISOString() };
      db.prepare('UPDATE tasks SET title=?, notes=?, dueDate=?, priority=?, completed=?, updatedAt=?, section=?, customer=?, type=? WHERE id=?')
        .run(task.title, task.notes, task.dueDate, task.priority, Number(task.completed), task.updatedAt, task.section, task.customer, task.type, id);
      return task;
    },
    remove: id => db.prepare('DELETE FROM tasks WHERE id=?').run(id).changes > 0,
    close: () => db.close(),
  };
}
