import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateFields } from '../src/validation.js';

const columns = ['id', 'title', 'notes', 'dueDate', 'priority', 'completed', 'createdAt', 'updatedAt', 'section', 'customer', 'type'];
const sqlValue = value => typeof value === 'number' ? String(value) : `CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)`;

// The source is opened read-only. Plain INSERT intentionally refuses duplicate
// IDs; importing must never silently replace a task edited in the cloud.
export function exportTasks(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT * FROM tasks ORDER BY createdAt, id').all();
    const statements = rows.map(row => {
      if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)) throw new Error('A task has an unsupported ID. No export was written.');
      const { section = 'backlog', ...source } = row;
      // Legacy local records can have a fixed date and a Backlog section. Keep
      // both values; sectionFor() already understands these historical records.
      const fields = validateFields({ ...source, completed: Boolean(row.completed) });
      if (!['today', 'tomorrow', 'this-week', 'next-week', 'later', 'backlog'].includes(section)) throw new Error('A task has an invalid section.');
      for (const key of ['createdAt', 'updatedAt']) if (typeof row[key] !== 'string' || !row[key]) throw new Error(`A task has an invalid ${key}.`);
      const task = { ...fields, section, id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, completed: Number(Boolean(row.completed)) };
      return `INSERT INTO tasks (${columns.join(',')}) VALUES (${columns.map(key => sqlValue(task[key])).join(',')});`;
    });
    return { count: rows.length, sql: '-- Task Manager data export. Apply schema migrations first. Contains private task data.\n' + statements.join('\n') + '\n' };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [databasePath, output] = process.argv.slice(2);
  if (!databasePath || !output) {
    console.error('Usage: npm run export:cloudflare -- /path/to/tasks.sqlite /path/to/tasks.backup.sql');
    process.exitCode = 1;
  } else {
    try {
      const { count, sql } = exportTasks(databasePath);
      await writeFile(output, sql, { flag: 'wx', mode: 0o600 });
      console.log(`Exported ${count} tasks. Source database unchanged. Keep this SQL file private.`);
    } catch (cause) { console.error(cause.message); process.exitCode = 1; }
  }
}
