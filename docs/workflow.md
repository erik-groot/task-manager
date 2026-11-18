# Task workflow

## Schedule

| Key | Section | Stored date |
| --- | --- | --- |
| `1` | Today | Today's local date |
| `2` | Tomorrow | Tomorrow's local date |
| `3` | This week | Friday of the current Monday–Sunday week |
| `4` | Next week | Friday of the following Monday–Sunday week |
| `5` | Later | No date |
| `6` | Backlog | No date |

Dates are computed when you assign a task, using your device's local calendar. Dates stay fixed afterwards; editing notes or metadata does not change them. On weekends, This week still means the preceding Friday in that calendar week. Past-due tasks appear in Today. Explicit weekly assignments stay in their week section on Friday, even when Today or Tomorrow has the same date. Future tasks move into nearer sections as their dates approach.

Later is an undated holding section; Backlog is an undated inbox. Both are included in Review. Existing tasks with custom dates keep those dates and are placed in the appropriate relative section.

## Capture and grouping

Type a task in the composer. Use these prefixes in the composer or task title:

- `@`: select an existing customer or type a new name and select Create.
- `!`: select Low, Medium, or High.
- `#`: select Task or Waiting for.

Use Up/Down and Enter or Tab to choose a suggestion. Escape dismisses suggestions. Selected metadata is saved in separate fields; it does not remain in the title. Press Enter again to create the task. Customer suggestions come from saved tasks, including completed tasks. The full editor also has dedicated customer, priority, type, and schedule controls.

Choose Customer, Priority, or Type in the grouping control. Your grouping and appearance preferences are remembered on that browser; task data lives in the shared database.

## Move and review

Click the empty area of a task row or use Up/Down to select a task, then press `1`–`4` to move it. Click its title or press Enter on the selected row to open it. When the editor has focus outside a text field, the same number keys schedule and save it. Digits typed in title, notes, customer, or other form controls stay ordinary input. The visible schedule buttons work on touch devices too.

Press `R` or click Review to open a snapshot of all incomplete, undated tasks, oldest first. Press `1`, `2`, `3`, or `4` to assign the visible task and immediately see the next one. Rapid sequences queue writes without dropping assignments. Use `5` for Later, `6` for Backlog, Right Arrow to skip, and Escape to close. Completed and already dated tasks are excluded.

Assignments save as you go; closing Review does not undo them. Failed saves roll back and offer Retry. A review's Done state appears only after queued writes finish. Press `N` outside form controls to focus the quick composer.

## Existing databases

Startup adds the customer, type, and section fields without replacing existing records. Legacy Normal priority becomes Medium. Existing task IDs, notes, dates, and completion states are preserved. Back up the database before updating as described in the main README.
