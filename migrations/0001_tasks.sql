CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  dueDate TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'backlog' CHECK (section IN ('today', 'tomorrow', 'this-week', 'next-week', 'later', 'backlog')),
  customer TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task', 'waiting'))
);
CREATE INDEX tasks_created ON tasks(createdAt DESC, id);
