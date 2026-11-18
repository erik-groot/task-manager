# Development roadmap

The first version establishes one task list shared by browsers on four Apple devices.

Possible next increments, to choose based on how you use it:

- Projects, tags, subtasks, and recurring tasks.
- Undo for deletion and a task history.
- Live updates instead of periodic refresh; conflict detection for simultaneous edits.
- Automated database backups and JSON import/export.
- A macOS LaunchAgent installer for startup after login, with clear uninstall instructions.
- Offline support with an explicit sync and conflict strategy.
- Notifications, with delivery support tested on macOS, iOS, and iPadOS.
- Separate users if the workspace needs to be shared with other people.
- Native SwiftUI apps and iCloud sync if native Apple features become a priority. That would be a separate architecture decision rather than a requirement for this web starter.
