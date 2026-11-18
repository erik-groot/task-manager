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

On desktop, type a task in the composer. On a phone, tap the floating Add button. Use these prefixes in the composer or task title:

- `@`: select an existing customer or type a new name and select Create.
- `!`: select Low, Medium, or High.
- `#`: select Task or Waiting for.

Use Up/Down and Enter or Tab to choose a suggestion. Escape dismisses suggestions. Selected metadata is saved in separate fields; it does not remain in the title. Press Enter again to create the task. Customer suggestions come from saved tasks, including completed tasks. The full editor also has dedicated customer, priority, type, and schedule controls.

Choose Customer, Priority, or Type in the grouping control. Your grouping and appearance preferences are remembered on that browser; task data lives in the shared database.

Phone navigation is in the bottom dock: Lists opens every section, Today returns to today's tasks, and Review starts processing undated tasks. The search button expands a search field; Escape dismisses it when using a keyboard. Appearance is in the settings control. Priority flags and waiting hourglasses sit beside task titles. Customer group headings use the customer name; `@` remains available for entry.

## Move and review

Click the empty area of a task row or use Up/Down to select a task, then press `1`–`4` to move it. Click its title or press Enter on the selected row to open it. When the editor has focus outside a text field, the same number keys schedule and save it. Digits typed in title, notes, customer, or other form controls stay ordinary input. The visible schedule buttons work on touch devices too.

For quick scheduling, open the row's menu, right-click, or press Shift+F10 on the selected task. On phones, swiping left or holding a task for half a second opens the same six-choice scheduling sheet. Vertical scrolling does not schedule tasks. Choose a section or use `1`–`6`; dates are shown beside the dated choices. An Undo action restores the previous schedule without reverting metadata changes. The Undo toast lasts ten seconds and also responds to Cmd/Ctrl+Z outside text fields.

Press `R` or click Review to open a snapshot of all incomplete, undated tasks, oldest first. Press `1`, `2`, `3`, or `4` to assign the visible task and immediately see the next one. Rapid sequences queue writes without dropping assignments. Use `5` for Later, `6` for Backlog, Right Arrow to skip, and Escape to close. Completed and already dated tasks are excluded.

Use the customer field and priority/type selectors directly in Review. Changes save as you work; scheduling also includes the current metadata draft. `@`, `!`, and `#` focus those fields from the review card. Escape from a field saves its current value and returns focus to the card, so number keys can schedule again. Metadata errors are visible inside Review, and a failed draft can be saved with the next assignment.

Use the Back/Undo control, Left Arrow, or Cmd/Ctrl+Z to return to the previous card. When going back over an assignment, its previous schedule is restored while customer, priority, and type edits remain. Going back over Skip only changes the current card. These controls remain available at the end of a review. Rapid assign → undo → reassign sequences are saved in order. A failed undo offers Retry undo and pauses assignment until it is resolved. Weekly choices show their exact Friday dates.

Assignments save as you go; closing Review does not undo them. Failed saves roll back and offer Retry. A review's Done state appears only after queued writes finish. Press `N` outside form controls to focus the desktop composer or open the phone task editor.

## Existing databases

Startup adds the customer, type, and section fields without replacing existing records. Legacy Normal priority becomes Medium. Existing task IDs, notes, dates, and completion states are preserved. Back up the database before updating as described in the main README.
