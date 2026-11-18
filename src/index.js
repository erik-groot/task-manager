import { resolve } from 'node:path';
import { createApp } from './server.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const password = process.env.TASK_MANAGER_PASSWORD || '';
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && password.length < 12) {
  console.error('Set TASK_MANAGER_PASSWORD to at least 12 characters before enabling network access.');
  process.exit(1);
}
const app = createApp({ databasePath: resolve(process.env.DATABASE_PATH || 'data/tasks.sqlite'), password });
app.listen(port, host, () => console.log(`Task Manager is running at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
