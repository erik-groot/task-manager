# Cloudflare hosting

This app can run entirely on Cloudflare Workers + Static Assets + D1. The Mac mini does not need to stay awake. Local Node/SQLite hosting remains available with `npm start`.

The repository supplies the cloud backend, schema, and tools. You must configure your own Cloudflare database and Access application. Nothing is deployed by running tests or `check:cloudflare`.

## Architecture and access

- `cloudflare/worker.js` serves the existing API and browser assets.
- `cloudflare/store.js` uses bound D1 statements. PATCH updates only supplied fields atomically, preserving independent edits from other devices.
- `cloudflare/access.js` verifies Access JWT signatures, expiration, issuer, audience, and an exact email allowlist. Signing keys are fetched from your fixed team domain and cached with rotation support by `jose`.
- Every request, including assets, runs through the Worker first. Missing configuration or invalid tokens deny access before any task query. There is no production login bypass.
- The workspace is shared by all allowed emails. This is not a multi-tenant app. Access logout clears the browser's Access session; a copied JWT remains usable until its expiry. Never share tokens.
- No KV, R2, paid Workers plan, tunnel, or VPN is required. Static requests pass through authentication and therefore invoke the Worker, counting toward its request allowance.

Cloudflare's free limits include 100,000 Worker requests/day and 10 ms CPU per invocation; D1 includes 5 million rows read/day, 100,000 written/day, and 500 MB per database. The app refreshes every 15 seconds while visible, so large task collections and multiple open devices increase row reads. Monitor usage. Free quotas can interrupt requests; no uptime guarantee is included. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 1. Install and check

Install Node.js 24 LTS and Git. Clone the repository, or update your existing checkout to the release containing the Cloudflare changes:

```sh
git clone https://github.com/erik-groot/task-manager.git
cd task-manager
npm ci
npm test
npm run check:cloudflare
npx wrangler login
```

For an existing checkout, use `git switch main` and `git pull --ff-only` instead of cloning. `check:cloudflare` bundles locally without publishing. The default configuration has a placeholder database ID and no authentication secrets; it cannot serve private data until configured.

## 2. Create the Worker and Access application

1. In the Cloudflare dashboard, open **Workers & Pages** and create an empty/basic Worker named `task-manager`. Keep the Workers Free plan. Do not connect Git deployments yet.
2. Open **Settings → Domains & Routes**. Enable Cloudflare Access for the Worker's production `workers.dev` URL. Follow any prompts to create your Cloudflare One team and select its Free plan.
3. Configure an Allow policy for your **exact email address**, with email one-time PIN login or your preferred identity provider. Do not allow Everyone, public bypass, or an entire email domain unless intended.
4. In Cloudflare One/Zero Trust, note your team hostname, for example `my-team.cloudflareaccess.com`.
5. Open the Access application and copy its **Application Audience (AUD) tag** from its settings. This belongs to the production application, not the account ID or an API token.
6. Leave preview URLs disabled. The repository sets `preview_urls: false`. A future preview needs its own protected application, audience, and separate database. Never point test deployments at production task data.

UI labels may move. References: [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## 3. Configure sign-in

From the repository directory, run each command and enter its value when prompted:

```sh
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ACCESS_ALLOWED_EMAILS
```

Values:

- `ACCESS_TEAM_DOMAIN`: hostname only, such as `my-team.cloudflareaccess.com`; no `https://` or path.
- `ACCESS_AUD`: the production Access application's audience tag.
- `ACCESS_ALLOWED_EMAILS`: your full email address; multiple addresses can be comma-separated. Match the Access policy.

These are runtime settings. Build-only variables do not reach the Worker. Wrangler secrets are retained across ordinary deployments. Do not put actual JWTs, API tokens, passphrases, or private task exports into Git. The team hostname and audience are configuration rather than passwords; storing them as secrets keeps account-specific settings out of this public repository.

## 4. Create D1 and apply the schema

```sh
npx wrangler d1 create task-manager-db
```

Replace the all-zero `database_id` in `wrangler.jsonc` with the returned UUID. Keep `binding` as `DB`, `database_name` as `task-manager-db`, and `migrations_dir` as `migrations`. The database ID is not a credential and can be committed so Git builds use the same database.

```sh
npm run db:migrate:remote
```

This creates the schema in your real cloud database. `npm run db:migrate:local` creates a separate local development database. Schema migrations are tracked by Wrangler; applying them again does not recreate the tasks table. Do not run the SQL migration directly a second time.

## 5. Deploy and check Access

```sh
npm run deploy
```

Open the printed `https://task-manager.<account-subdomain>.workers.dev` address. Sign in through Access; no second app passphrase is needed. In the app, Appearance → Sign out uses Cloudflare's logout endpoint. If a session expires during use, the app offers Sign in; refresh/sign-in is necessary before continuing.

Verify before importing real tasks:

1. A private browser window requires Access sign-in before loading the app.
2. A different, unapproved email cannot enter.
3. Visiting `/api/tasks` without Access sign-in does not expose task JSON.
4. Create a temporary task; edit it from another device, refresh, then delete it. The shared list refreshes every 15 seconds while visible.
5. Check the Worker logs for configuration or database errors. `503 Sign-in is not configured` means a required setting is absent or invalid. `401` after Access login usually means the team domain/AUD does not match the actual application. `403` can indicate an email not in the allowlist.

If you later add a custom domain, protect that route with Access too and use its correct audience. Do not disable protection on alternative URLs. The Worker independently verifies JWTs, but Access is also needed to provide the browser sign-in flow.

## 6. Import existing local tasks (optional)

Skip this if you have no tasks yet. Pause task edits on both versions during migration. Stop the local Node server and back up its entire `data/` directory first.

```sh
npm run export:cloudflare -- ./data/tasks.sqlite ./tasks.backup.sql
npx wrangler d1 execute DB --remote --file=./tasks.backup.sql
```

The exporter opens SQLite read-only, preserves IDs, timestamps, dates, completion and metadata, and converts the historical Normal priority to Medium. It works with the original schema and the current schema. SQL uses encoded text literals to preserve quotes, Unicode, newlines, and null characters. It refuses to overwrite an existing output file.

Import into an empty task table after applying the schema. Plain INSERT refuses duplicate IDs rather than overwriting cloud changes. An interrupted import can leave some tasks imported; inspect the task count before retrying. Do not repeatedly run the import or delete cloud data to resolve an error without a backup. Keep the SQL file private; `*.backup.sql` is ignored by Git.

Verify the count and spot-check dates/customers/completed tasks:

```sh
npx wrangler d1 execute DB --remote --command='SELECT COUNT(*) AS tasks FROM tasks'
```

After verification, use the Cloudflare URL on all devices. The old local and cloud databases are independent; there is no two-way sync.

## 7. Connect GitHub deployments

Commit the actual database ID to your repository. In the Worker's **Settings → Build** settings, connect GitHub, granting access to `erik-groot/task-manager` only where possible. Use:

| Setting | Value |
| --- | --- |
| Worker name | `task-manager` (must match `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm test` |
| Deploy command | `npx wrangler deploy` |
| Build environment | `NODE_VERSION=24` |
| Preview builds | Disabled |

Cloudflare installs dependencies from the lockfile; keep `package-lock.json` committed. The GitHub CI separately runs Node/D1 tests, a deployment dry run, and browser checks. Cloudflare's build runs tests before deploying, but its Git integration does not automatically wait for every separate GitHub check. Future schema changes require `npm run db:migrate:remote` before deploying code that depends on them. Review migrations and back up data first.

Runtime Access settings from step 3 belong to the Worker, not the build environment. Reference: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 8. Devices, backups, and development

- iPhone/iPad: open the cloud URL in Safari → Share → Add to Home Screen.
- Mac: Safari → File → Add to Dock. Each device signs in separately. Internet access is required; offline editing is not included.
- Export a cloud backup periodically: `npx wrangler d1 export DB --remote --output=tasks-cloud.backup.sql`. Store it outside the repository and test restoration into a separate database. D1 Free also provides seven days of Time Travel recovery.
- Normal UI development: `npm run dev` uses local Node/SQLite and its local passphrase rules.
- Cloud runtime tests: `npm test` uses isolated Miniflare D1 databases and generated test signing keys, with no Cloudflare credentials or real tasks.
- Manual Worker development: copy `.dev.vars.example` to `.dev.vars`, configure your Access values, run `npm run db:migrate:local` then `npm run dev:cloudflare`. This binds loopback only. It still requires a real valid `Cf-Access-Jwt-Assertion` header; do not disable authentication for a deployed Worker. The Node server is the easier choice for ordinary UI work.

The UI is plain browser JS/CSS and both stores use SQLite-compatible SQL. Another assistant, including Claude, can work from this repository and these docs. Hosting migration to another provider needs a server adapter and a D1 SQL export; task data is exportable.
