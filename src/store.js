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
  const decode = row => row ? { ...row, completed: Boolean(row.completed) } : null;
  const find = id => decode(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  return {
    list: () => db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC, id').all().map(decode),
    find,
    create(fields) {
      const now = new Date().toISOString();
      const task = { id: randomUUID(), ...fields, completed: false, createdAt: now, updatedAt: now };
      db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        task.id, task.title, task.notes, task.dueDate, task.priority, 0, now, now,
      );
      return task;
    },
    update(id, fields) {
      const previous = find(id);
      if (!previous) return null;
      const task = { ...previous, ...fields, updatedAt: new Date().toISOString() };
      db.prepare('UPDATE tasks SET title=?, notes=?, dueDate=?, priority=?, completed=?, updatedAt=? WHERE id=?')
        .run(task.title, task.notes, task.dueDate, task.priority, Number(task.completed), task.updatedAt, id);
      return task;
    },
    remove: id => db.prepare('DELETE FROM tasks WHERE id=?').run(id).changes > 0,
    close: () => db.close(),
  };
}
