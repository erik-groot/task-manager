import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { openStore } from './store.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const publicRoot = new URL('../public/', import.meta.url);

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new RequestError(415, 'Send JSON with Content-Type: application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new RequestError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new RequestError(400, 'Invalid JSON object.'); }
}

function validateFields(body, partial = false) {
  const fields = {};
  if (!partial || 'title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      throw new RequestError(400, 'Title must contain between 1 and 200 characters.');
    }
    fields.title = body.title.trim();
  }
  for (const [key, limit] of [['notes', 4000], ['dueDate', 10]]) {
    if (!partial || key in body) {
      const value = body[key] ?? '';
      if (typeof value !== 'string' || value.length > limit) throw new RequestError(400, `Invalid ${key}.`);
      fields[key] = value;
    }
  }
  if (fields.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate) ||
      !Number.isFinite(Date.parse(fields.dueDate)) ||
      new Date(fields.dueDate).toISOString().slice(0, 10) !== fields.dueDate)) {
    throw new RequestError(400, 'Choose a valid due date.');
  }
  if (!partial || 'priority' in body) {
    fields.priority = body.priority ?? 'normal';
    if (!['normal', 'high'].includes(fields.priority)) throw new RequestError(400, 'Invalid priority.');
  }
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') throw new RequestError(400, 'Invalid completion status.');
    fields.completed = body.completed;
  }
  return fields;
}

export function createApp({ databasePath, password = '' }) {
  const store = openStore(databasePath);
  const sessions = new Map();
  const salt = randomBytes(16);
  const passwordHash = password ? scryptSync(password, salt, 64) : null;
  let loginAttempts = 0;
  let loginWindow = Date.now();
  const authenticated = req => {
    if (!passwordHash) return true;
    const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const expires = sessions.get(token);
    if (!expires) return false;
    if (expires < Date.now()) { sessions.delete(token); return false; }
    return true;
  };

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!passwordHash && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)) {
        throw new RequestError(403, 'Use localhost, or set a passphrase for network access.');
      }
      // Reject cross-site reads and writes, including requests aimed at localhost.
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'Cross-site request blocked.');
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
          throw new RequestError(403, 'Cross-site request blocked.');
        }
      }
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(await readFile(new URL(file, publicRoot)));
        return;
      }
      if (pathname === '/api/session' && req.method === 'GET') {
        send(200, { authenticated: authenticated(req), passwordRequired: Boolean(passwordHash) });
        return;
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        if (!passwordHash) { send(200, { ok: true }); return; }
        if (Date.now() - loginWindow > 600000) { loginAttempts = 0; loginWindow = Date.now(); }
        if (++loginAttempts > 20) throw new RequestError(429, 'Too many sign-in attempts. Try again in 10 minutes.');
        const body = await jsonBody(req);
        if (typeof body.password !== 'string' || body.password.length > 1024 ||
            !timingSafeEqual(scryptSync(body.password, salt, 64), passwordHash)) {
          throw new RequestError(401, 'Incorrect passphrase.');
        }
        for (const [token, expires] of sessions) if (expires < Date.now()) sessions.delete(token);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + 7 * 86400000);
        // SameSite and origin checks protect writes. A direct TLS connection or
        // a loopback-only HTTPS proxy can use Secure cookies.
        const secure = req.socket.encrypted ||
          (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https');
        res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`);
        send(200, { ok: true });
        return;
      }
      if (!authenticated(req)) throw new RequestError(401, 'Sign in to continue.');
      if (pathname === '/api/logout' && req.method === 'POST') {
        const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
        sessions.delete(token);
        res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        send(200, { ok: true });
        return;
      }
      if (pathname === '/api/tasks' && req.method === 'GET') { send(200, store.list()); return; }
      if (pathname === '/api/tasks' && req.method === 'POST') {
        send(201, store.create(validateFields(await jsonBody(req))));
        return;
      }
      const match = /^\/api\/tasks\/([a-f0-9-]{36})$/.exec(pathname);
      if (match && req.method === 'PATCH') {
        const task = store.update(match[1], validateFields(await jsonBody(req), true));
        if (!task) throw new RequestError(404, 'Task not found.');
        send(200, task);
        return;
      }
      if (match && req.method === 'DELETE') {
        if (!store.remove(match[1])) throw new RequestError(404, 'Task not found.');
        send(200, { ok: true });
        return;
      }
      throw new RequestError(404, 'Not found.');
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send(error.status ?? 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
      else res.end();
    }
  });
  server.on('close', () => store.close());
  return server;
}
