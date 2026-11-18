# Task Manager

A personal task manager for your **Mac mini, MacBook Pro, iPad, and iPhone**. The Mac mini hosts the app and its SQLite database. Open the same address in Safari on each device to use the same task list.

This is a responsive web app starter. It is not a native App Store app. It requires a connection to your Mac mini; offline editing and iCloud sync are not included.

## Included

- Create, edit, complete, reopen, and delete tasks.
- Notes, due dates, high priority, search, and views for active, due, and completed tasks.
- Responsive layouts for desktop, tablet, and phone.
- One SQLite database on the Mac mini, retained across restarts.
- Optional passphrase on localhost; required for direct network access.
- Automatic refresh every 15 seconds while the page is visible.
- No external runtime packages or cloud services required for local use.

## Start on your Mac mini

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org/) and Git (Apple's Command Line Tools supply Git). Then:

```sh
git clone https://github.com/erik-groot/task-manager.git
cd task-manager
npm start
```

The repository is private: cloning requires your GitHub credentials. If you use the GitHub CLI, run `gh auth login` and `gh repo clone erik-groot/task-manager` instead.

Open [http://localhost:3000](http://localhost:3000). No `npm install` step is needed.

## Use it from your other devices

See [the device setup guide](docs/devices.md) for two options:

1. **Private HTTPS with Tailscale:** works at home and away, while the Mac mini stays available. Recommended for everyday use.
2. **Your home Wi-Fi:** access the Mac mini directly with a shared passphrase. HTTP traffic on this connection is not encrypted.

On iPhone and iPad, open the app in Safari and choose **Share → Add to Home Screen**. On recent macOS versions, Safari's **File → Add to Dock** provides a similar app window. The Mac mini must remain powered on, awake, and running the server. Home Screen shortcuts do not provide offline support.

## Development

```sh
npm run dev    # Restart the server when source files change; reload Safari for frontend edits
npm test       # API, validation, authentication, and database persistence tests
```

```text
src/index.js       Startup and network configuration
src/server.js      HTTP API, sessions, and static assets
src/store.js       SQLite persistence
public/           Browser UI
test/             Integration tests using Node's built-in test runner
docs/             Device setup and development roadmap
```

Copy `.env.example` to `.env` to configure the server. `HOST` defaults to `127.0.0.1`, `PORT` to `3000`, and `DATABASE_PATH` to `./data/tasks.sqlite` relative to the working directory. Keep the database and `.env` out of Git. For predictable operation, always start from the repository directory or set an absolute `DATABASE_PATH`.

**Backups:** stop the server, copy the entire `data/` directory to a backup location, then restart. Restore with the server stopped. Keep a separate copy before changing the database schema.

## Current scope

This starter has a single shared workspace and passphrase. Sessions last up to seven days and are cleared when the server restarts. Simultaneous edits to the same task use the last saved update. Server-side date values are calendar dates; the Today view follows each device's local date. A Mac mini sleeping, restarting, losing power, or losing its connection makes the app unavailable until it returns.

See [the roadmap](docs/roadmap.md) for possible next steps.
