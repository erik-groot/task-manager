import { createRemoteJWKSet, jwtVerify } from 'jose';
import { RequestError } from '../src/validation.js';

// Cache remote signing keys in each isolate; jose refreshes them for key rotation.
const keySets = new Map();
export async function authenticateAccess(request, env) {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  const emails = (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  if (!team || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(team) || !audience || !emails.length) {
    throw new RequestError(503, 'Sign-in is not configured.');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new RequestError(401, 'Sign in to continue.');
  const issuer = `https://${team}`;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });
    keySets.set(issuer, keys);
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
    }));
  } catch {
    throw new RequestError(401, 'Sign in to continue.');
  }
  if (typeof payload.email !== 'string' || !emails.includes(payload.email.toLowerCase())) {
    throw new RequestError(403, 'This account does not have access.');
  }
  return { email: payload.email };
}
