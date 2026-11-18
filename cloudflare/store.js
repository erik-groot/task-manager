const columns = ['title', 'notes', 'dueDate', 'priority', 'completed', 'section', 'customer', 'type'];
const decode = row => row ? { ...row, completed: Boolean(row.completed) } : null;

export function d1Store(db) {
  return {
    async list() {
      const { results } = await db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC, id').all();
      return results.map(decode);
    },
    async create(fields) {
      const now = new Date().toISOString();
      const task = { ...fields, id: crypto.randomUUID(), completed: false, createdAt: now, updatedAt: now };
      await db.prepare('INSERT INTO tasks (id,title,notes,dueDate,priority,completed,createdAt,updatedAt,section,customer,type) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(task.id, task.title, task.notes, task.dueDate, task.priority, 0, now, now, task.section, task.customer, task.type).run();
      return task;
    },
    async update(id, fields) {
      // Update only supplied columns in one statement so concurrent edits to
      // different fields cannot overwrite each other through read/modify/write.
      const changed = columns.filter(key => Object.hasOwn(fields, key));
      const values = changed.map(key => key === 'completed' ? Number(fields[key]) : fields[key]);
      return decode(await db.prepare(`UPDATE tasks SET ${[...changed.map(key => `${key}=?`), 'updatedAt=?'].join(',')} WHERE id=? RETURNING *`)
        .bind(...values, new Date().toISOString(), id).first());
    },
    async remove(id) {
      const result = await db.prepare('DELETE FROM tasks WHERE id=?').bind(id).run();
      return result.meta.changes > 0;
    },
  };
}
