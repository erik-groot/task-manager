export const SECTIONS = ['today', 'tomorrow', 'this-week', 'next-week', 'later', 'backlog'];
export const LABELS = { all: 'All tasks', today: 'Today', tomorrow: 'Tomorrow', 'this-week': 'This week', 'next-week': 'Next week', later: 'Later', backlog: 'Backlog', completed: 'Completed' };
export const PRIORITIES = ['high', 'medium', 'low'];
export const TYPES = { task: 'Task', waiting: 'Waiting for' };

export function calendarDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Calendar arithmetic at local noon avoids UTC and daylight-saving date shifts.
export function dueFor(section, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (section === 'later' || section === 'backlog') return '';
  if (section === 'tomorrow') date.setDate(date.getDate() + 1);
  if (section === 'this-week' || section === 'next-week') {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset + 4 + (section === 'next-week' ? 7 : 0));
  }
  return calendarDate(date);
}

// Stored dates stay fixed. Sections roll forward as those dates approach.
// An explicit week assignment remains in its week when Friday is also tomorrow.
export function sectionFor(task, now = new Date()) {
  if (!task.dueDate) return task.section === 'later' ? 'later' : 'backlog';
  if (task.dueDate < dueFor('today', now)) return 'today';
  if (task.section === 'this-week' && task.dueDate === dueFor('this-week', now)) return 'this-week';
  if (task.section === 'next-week' && task.dueDate === dueFor('next-week', now)) return 'next-week';
  if (task.dueDate <= dueFor('today', now)) return 'today';
  if (task.dueDate === dueFor('tomorrow', now)) return 'tomorrow';
  if (task.dueDate <= dueFor('this-week', now)) return 'this-week';
  if (task.dueDate <= dueFor('next-week', now)) return 'next-week';
  return 'later';
}

export function completionReview(tasks) {
  return tasks.filter(task => !task.completed && !task.dueDate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
