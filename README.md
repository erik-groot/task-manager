# Task Manager

A personal task manager for your **Mac mini, MacBook Pro, iPad, and iPhone**. Host it on Cloudflare Workers and D1 for access anywhere, or on your Mac mini with a local SQLite database. Open the same address in Safari on each device to use the same task list.

This is a responsive web app starter. It is not a native App Store app. It requires an internet connection for cloud hosting, or a connection to your Mac mini for local hosting. Offline editing and iCloud sync are not included.

## Included

- Create, edit, complete, reopen, and delete tasks.
- Today, Tomorrow, This week (Friday), Next week (Friday), Later, and Backlog.
- Customer selection with `@`, Low/Medium/High priority with `!`, and Task/Waiting for with `#`.
- Group by customer, priority, or type; search across task text and customers.
- Move tasks with `1`–`4` and review every undated task in a keyboard-driven popup.
- Frost by default, plus Clear and Midnight, with Apple's SF system typography and a self-hosted Inter fallback for other platforms.
- Review supports editable customer/priority/type fields, Back/Undo, and keyboard shortcuts without leaving the queue.
- Swipe, long-press, or open a task's row menu to schedule it; quick moves include Undo.
- Dedicated phone list navigation, bottom controls, search, and capture/review sheets.
- One SQLite database on the Mac mini, retained across restarts.
- Optional passphrase on localhost; required for direct network access.
- Automatic refresh every 15 seconds while the page is visible.
- No external runtime packages or cloud services required for local use.

See [the task workflow and shortcuts](docs/workflow.md), [design screenshots](docs/designs.md), and [the design research](docs/design-research.md).

## Host on Cloudflare

See [the Cloudflare setup guide](docs/cloudflare.md) for Workers, D1, Cloudflare Access sign-in, importing existing tasks, and GitHub deployments. The cloud backend is included, but your account's database and Access application still need configuration before deployment. No Mac mini server or VPN is needed once it is hosted.

## Start on your Mac mini

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org/) and Git (Apple's Command Line Tools supply Git). Then:

```sh
git clone https://github.com/erik-groot/task-manager.git
cd task-manager
npm start
```

If GitHub asks you to authenticate, use your GitHub credentials. If you use the GitHub CLI, run `gh auth login` and `gh repo clone erik-groot/task-manager` instead.

Open [http://localhost:3000](http://localhost:3000). Local serving uses Node built-ins. Run `npm ci` before running tests or using the Cloudflare tools.

## Use it from your other devices

See [the device setup guide](docs/devices.md) for two options:

1. **Private HTTPS with Tailscale:** works at home and away, while the Mac mini stays available. Recommended for everyday use.
2. **Your home Wi-Fi:** access the Mac mini directly with a shared passphrase. HTTP traffic on this connection is not encrypted.

On iPhone and iPad, open the app in Safari and choose **Share → Add to Home Screen**. On recent macOS versions, Safari's **File → Add to Dock** provides a similar app window. The Mac mini must remain powered on, awake, and running the server. Home Screen shortcuts do not provide offline support.

## Development

```sh
npm ci
npm run dev    # Restart the server when source files change; reload Safari for frontend edits
npm test       # API, validation, authentication, and database persistence tests
npm run test:browser  # Isolated browser checks; requires Chromium or CHROMIUM=/path/to/chrome
```

```text
src/index.js       Startup and network configuration
src/server.js      HTTP API, sessions, and static assets
src/store.js       Local SQLite persistence
src/validation.js  Shared API validation
cloudflare/        Worker, Access verification, and D1 persistence
migrations/        D1 schema migrations
public/           Browser UI
scripts/          Isolated browser checks and screenshot capture
test/             Integration tests using Node's built-in test runner
docs/             Device setup and development roadmap
```

Copy `.env.example` to `.env` to configure the server. `HOST` defaults to `127.0.0.1`, `PORT` to `3000`, and `DATABASE_PATH` to `./data/tasks.sqlite` relative to the working directory. Keep the database and `.env` out of Git. For predictable operation, always start from the repository directory or set an absolute `DATABASE_PATH`.

**Backups:** stop the server, copy the entire `data/` directory to a backup location, then restart. Restore with the server stopped. Keep a separate copy before changing the database schema.

## Current scope

This starter has a single shared workspace. Local hosting uses a shared passphrase; local sessions last up to seven days and are cleared when the server restarts. Cloud hosting uses your configured Cloudflare Access policy and email allowlist, with no app password. Simultaneous edits to the same task use the last saved update. Server-side date values are calendar dates; the Today view follows each device's local date. With local hosting, a Mac mini sleeping, restarting, losing power, or losing its connection makes the app unavailable until it returns.

The new glass layouts are tested in Chromium at desktop and phone sizes, including native touch-event gestures and queued assign/undo/reassign operations. Apple devices use their installed system font; Apple font files are not distributed with the app. Native Safari and physical Apple-device testing remain to be done. This is a web implementation inspired by Liquid Glass, not an Apple native material. Cloudflare hosting uses Workers and D1 with verified Access sign-in; see the setup guide. Deployment to your account and physical-device verification are separate steps.

See [the roadmap](docs/roadmap.md) for possible next steps.
