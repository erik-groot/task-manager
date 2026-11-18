import { authenticateAccess } from './access.js';
import { d1Store } from './store.js';
import { assets, securityHeaders } from '../src/http.js';
import { RequestError, validateFields } from '../src/validation.js';

async function jsonBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(415, 'Send JSON with Content-Type: application/json.');
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) { await reader.cancel(); throw new RequestError(413, 'Request is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new RequestError(400, 'Invalid JSON object.'); }
}
const json = (data, status = 200) => Response.json(data, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/') && request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, 'Cross-site request blocked.');
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new RequestError(403, 'Cross-site request blocked.');
      const identity = await authenticateAccess(request, env);
      const path = url.pathname;
      if (['GET', 'HEAD'].includes(request.method) && assets.has(path)) {
        // With html_handling:none, map the public root explicitly.
        const assetUrl = new URL(request.url);
        if (path === '/') assetUrl.pathname = '/index.html';
        const response = await env.ASSETS.fetch(new Request(assetUrl, request));
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, headers });
      }
      if (path === '/api/session' && request.method === 'GET') return json({ authenticated: true, passwordRequired: false, authProvider: 'cloudflare-access', email: identity.email });
      if (path === '/api/logout' && request.method === 'POST') return json({ ok: true, logoutUrl: '/cdn-cgi/access/logout' });
      if (!env.DB) throw new RequestError(503, 'Task storage is not configured.');
      const store = d1Store(env.DB);
      if (path === '/api/tasks' && request.method === 'GET') return json(await store.list());
      if (path === '/api/tasks' && request.method === 'POST') return json(await store.create(validateFields(await jsonBody(request))), 201);
      // Existing local databases may contain older non-UUID IDs. Keep those tasks editable after import.
      const match = /^\/api\/tasks\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
      if (match && request.method === 'PATCH') {
        const task = await store.update(match[1], validateFields(await jsonBody(request), true));
        if (!task) throw new RequestError(404, 'Task not found.');
        return json(task);
      }
      if (match && request.method === 'DELETE') {
        if (!await store.remove(match[1])) throw new RequestError(404, 'Task not found.');
        return json({ ok: true });
      }
      throw new RequestError(404, 'Not found.');
    } catch (cause) {
      if (!cause.status) console.error('Worker request failed:', cause.message);
      return json({ error: cause.status ? cause.message : 'Something went wrong. Please try again.', authProvider: 'cloudflare-access' }, cause.status ?? 500);
    }
  },
};
