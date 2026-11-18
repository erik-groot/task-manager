import { SECTIONS, LABELS, PRIORITIES, TYPES, dueFor, sectionFor, completionReview, calendarDate } from './planning.js';

const $ = selector => document.querySelector(selector);
const NS = 'http://www.w3.org/2000/svg';
const icons = { all: 'grid', today: 'sun', tomorrow: 'rise', 'this-week': 'calendar', 'next-week': 'next', later: 'later', backlog: 'tray', completed: 'check' };
const moves = { '1': 'today', '2': 'tomorrow', '3': 'this-week', '4': 'next-week', '5': 'later', '6': 'backlog' };
let tasks = [];
let view = 'today';
let selectedId = null;
let editingId = null;
let signedIn = false;
let revision = 0;
let readPending = false;
let pendingWrites = 0;
let writeQueue = Promise.resolve();
let review = null;
let formSaving = false;
let noticeTimer;
let toastTimer;
let toastAction = null;
let scheduleTaskId = null;
let activeGesture = null;
let tokenMenu = null;
let quickFields = {};
const taskVersions = new Map();
const confirmedTasks = new Map();

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function icon(name) {
  const result = document.createElementNS(NS, 'svg');
  result.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  result.append(use);
  return result;
}
function error(message = '') {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
  $('#editor-error').textContent = message;
  $('#editor-error').hidden = !message;
  $('#review-error').textContent = message;
  $('#review-error').hidden = !message;
  if (message) noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 9000);
}
function clearToast(token) {
  if (token && token !== toastAction) return;
  clearTimeout(toastTimer);
  toastAction = null;
  $('#toast').hidden = true;
}
function toast(message, action = null, label = 'Undo') {
  clearTimeout(toastTimer);
  const token = { run: action };
  toastAction = token;
  $('#toast').replaceChildren(element('span', '', message));
  if (action) {
    const button = element('button', 'toast-action', label);
    button.addEventListener('click', () => { clearToast(token); action(); });
    $('#toast').append(button);
  }
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => clearToast(token), action ? 10000 : 2200);
  return token;
}
function connection(status) {
  $('#connection').className = `connection ${status}`;
  const label = pendingWrites ? 'Saving' : status === 'online' ? 'Up to date' : status === 'offline' ? 'Connection unavailable' : 'Connecting';
  $('#connection').setAttribute('aria-label', label);
  $('#connection').title = label;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw new Error(data.error || 'Could not save.');
  }
  return data;
}
function showLogin() {
  signedIn = false;
  ++revision;
  tasks = [];
  confirmedTasks.clear();
  review = null;
  selectedId = null;
  $('#task-dialog').close();
  $('#review-dialog').close();
  $('#lists-dialog').close();
  $('#schedule-dialog').close();
  clearToast();
  hideSuggestions();
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#task-list').replaceChildren();
  $('#password').focus();
}
function queueWrite(action) {
  ++revision;
  ++pendingWrites;
  connection('');
  const result = writeQueue.then(action);
  writeQueue = result.catch(() => {}).finally(() => {
    --pendingWrites;
    connection(pendingWrites ? '' : 'online');
    renderReview();
  });
  return result;
}
function customers() {
  return [...new Set(tasks.map(task => task.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function scheduledFields(section) { return { section, dueDate: dueFor(section) }; }
function visibleTasks() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  return tasks.filter(task => {
    if (view === 'completed' ? !task.completed : task.completed) return false;
    if (!['all', 'completed'].includes(view) && sectionFor(task) !== view) return false;
    return `${task.title} ${task.notes} ${task.customer} ${TYPES[task.type]}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt));
}
function dateLabel(task) {
  if (!task.dueDate) return '';
  const today = dueFor('today');
  if (task.dueDate === today) return 'Today';
  if (task.dueDate === dueFor('tomorrow') && task.section !== 'this-week') return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(task.dueDate.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).format(new Date(`${task.dueDate}T12:00:00`));
}
function makeRow(task) {
  const row = element('article', `task${task.completed ? ' completed' : ''}${selectedId === task.id ? ' selected' : ''}`);
  row.dataset.taskId = task.id;
  row.tabIndex = 0;
  row.setAttribute('aria-label', task.title);
  const checkbox = element('input', 'task-check');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `${task.completed ? 'Reopen' : 'Complete'} ${task.title}`);
  checkbox.addEventListener('click', event => event.stopPropagation());
  checkbox.addEventListener('change', () => patchTask(task.id, { completed: checkbox.checked }));
  const hitArea = element('label', 'checkbox-hit');
  hitArea.append(checkbox);
  hitArea.addEventListener('click', event => event.stopPropagation());
  const button = element('button', 'task-main');
  const copy = element('span', 'task-copy');
  copy.append(element('span', 'task-title', task.title));
  if (task.customer && $('#group-by').value !== 'customer') copy.append(element('span', 'customer-tag', `@${task.customer}`));
  const markers = element('span', 'task-markers');
  const marker = (name, label, className) => {
    const result = element('span', className);
    result.title = label;
    result.setAttribute('role', 'img');
    result.setAttribute('aria-label', label);
    result.append(icon(name));
    return result;
  };
  if (task.priority !== 'medium' && $('#group-by').value !== 'priority') markers.append(marker('flag', `${task.priority === 'high' ? 'High' : 'Low'} priority`, `priority-mark ${task.priority}`));
  if (task.type === 'waiting' && $('#group-by').value !== 'type') markers.append(marker('hourglass', 'Waiting for', 'waiting-mark'));
  button.append(markers, copy);
  button.addEventListener('click', event => { event.stopPropagation(); selectTask(task.id); openEditor(task); });
  const date = element('span', `task-date${!task.completed && task.dueDate && task.dueDate < dueFor('today') ? ' overdue' : ''}`, ['all', 'completed'].includes(view) || task.dueDate && task.dueDate < dueFor('today') ? dateLabel(task) : '');
  const scheduleButton = element('button', 'icon-button schedule-trigger');
  scheduleButton.setAttribute('aria-label', `Schedule ${task.title}`);
  scheduleButton.title = 'Schedule task';
  scheduleButton.setAttribute('aria-haspopup', 'dialog');
  scheduleButton.append(icon('more'));
  scheduleButton.hidden = task.completed;
  scheduleButton.addEventListener('click', event => { event.stopPropagation(); openSchedule(task.id); });
  row.append(hitArea, button, date, scheduleButton);
  installTaskGestures(row, task.id);
  row.addEventListener('focusin', () => selectTask(task.id));
  row.addEventListener('click', () => { selectTask(task.id); row.focus(); });
  return row;
}
function selectTask(id) {
  selectedId = id;
  $('.keyboard-bar').hidden = !id;
  document.querySelectorAll('.task').forEach(row => row.classList.toggle('selected', row.dataset.taskId === id));
  document.querySelectorAll('#move-buttons button').forEach(button => { button.disabled = !id; });
}
function render() {
  const focusedRow = document.activeElement?.classList.contains('task') ? document.activeElement.dataset.taskId : null;
  const counts = Object.fromEntries(['all', ...SECTIONS, 'completed'].map(section => [section, 0]));
  for (const task of tasks) {
    if (task.completed) ++counts.completed;
    else { ++counts.all; ++counts[sectionFor(task)]; }
  }
  document.querySelectorAll('[data-section]').forEach(button => {
    const section = button.dataset.section;
    button.setAttribute('aria-current', view === section ? 'page' : 'false');
    const count = button.querySelector('.nav-count');
    if (count) count.textContent = counts[section];
  });
  $('#workspace-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  $('#view-title').textContent = LABELS[view];
  const visible = visibleTasks();
  $('#view-count').textContent = visible.length;
  $('#review-count').textContent = completionReview(tasks).length;
  $('#review-start').disabled = !completionReview(tasks).length;
  $('#mobile-review-count').textContent = completionReview(tasks).length;
  $('#mobile-review-count').hidden = !completionReview(tasks).length;
  $('#mobile-review').disabled = !completionReview(tasks).length;
  $('#mobile-lists').classList.toggle('active', view !== 'today');
  const groupBy = $('#group-by').value;
  const groups = new Map();
  if (groupBy === 'priority') for (const priority of PRIORITIES) groups.set(priority, []);
  if (groupBy === 'type') for (const type of Object.keys(TYPES)) groups.set(type, []);
  for (const task of visible) {
    const key = groupBy === 'none' ? '' : task[groupBy];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  let entries = [...groups];
  if (groupBy === 'customer') entries.sort(([a], [b]) => !a ? 1 : !b ? -1 : a.localeCompare(b));
  const list = $('#task-list');
  list.replaceChildren();
  for (const [key, members] of entries) {
    if (!members.length) continue;
    if (groupBy !== 'none') {
      const label = groupBy === 'customer' ? key || 'No customer' : groupBy === 'type' ? TYPES[key] : `${key[0].toUpperCase()}${key.slice(1)}`;
      const heading = element('h2', 'group-heading', label);
      heading.append(element('span', '', members.length));
      list.append(heading);
    }
    for (const task of members) list.append(makeRow(task));
  }
  if (selectedId && !visible.some(task => task.id === selectedId)) selectedId = null;
  selectTask(selectedId);
  if (focusedRow) [...document.querySelectorAll('.task')].find(row => row.dataset.taskId === focusedRow)?.focus({ preventScroll: true });
  $('#empty').hidden = visible.length > 0;
  $('#empty-label').textContent = $('#search').value ? 'No matches' : view === 'completed' ? 'No completed tasks' : 'No tasks';
  $('#customer-list').replaceChildren(...customers().map(name => { const option = element('option'); option.value = name; return option; }));
}
async function refresh() {
  if (!signedIn || readPending || pendingWrites || activeGesture) return;
  const version = revision;
  readPending = true;
  try {
    const result = await api('/api/tasks');
    if (!signedIn || revision !== version) return;
    tasks = result;
    confirmedTasks.clear();
    for (const task of result) confirmedTasks.set(task.id, task);
    render();
    renderReview();
    connection('online');
  } catch (cause) { if (revision === version) { connection('offline'); error(cause.message); } }
  finally { readPending = false; }
}
function patchTask(id, fields, { onError, message, skipIfSame = false } = {}) {
  const previous = tasks.find(task => task.id === id);
  if (!previous) return Promise.resolve(false);
  const version = (taskVersions.get(id) || 0) + 1;
  taskVersions.set(id, version);
  tasks = tasks.map(task => task.id === id ? { ...task, ...fields } : task);
  render();
  if (message) toast(message);
  const saved = queueWrite(() => {
    const confirmed = confirmedTasks.get(id);
    if (skipIfSame && confirmed && Object.entries(fields).every(([key, value]) => confirmed[key] === value)) return confirmed;
    return api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
  });
  return saved.then(task => {
    confirmedTasks.set(id, task);
    if (taskVersions.get(id) === version) tasks = tasks.map(item => item.id === id ? task : item);
    render();
    return true;
  }).catch(cause => {
    if (taskVersions.get(id) === version) tasks = tasks.map(item => item.id === id ? confirmedTasks.get(id) ?? previous : item);
    onError?.(id);
    error(`${previous.title}: ${cause.message}`);
    render();
    renderReview();
    connection('offline');
    return false;
  });
}
function setView(section) {
  view = section;
  selectedId = null;
  render();
  $('#lists-dialog').close();
  if (!matchMedia('(max-width: 700px)').matches) document.querySelector(`#navigation [data-section="${section}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
function schedule(id, section) {
  const task = tasks.find(item => item.id === id);
  if (!task || task.completed) return;
  const visible = visibleTasks();
  const index = visible.findIndex(item => item.id === id);
  const next = visible[index + 1] || visible[index - 1];
  const before = scheduleSnapshot(task);
  let active = true;
  const token = toast(LABELS[section], () => {
    if (!active) return;
    active = false;
    restoreSchedule(id, before);
  });
  const result = patchTask(id, scheduledFields(section), { onError: () => { active = false; clearToast(token); } });
  if (!visibleTasks().some(item => item.id === id)) {
    selectTask(next?.id ?? null);
    if (next) [...document.querySelectorAll('.task')].find(row => row.dataset.taskId === next.id)?.focus({ preventScroll: true });
  }
  return result;
}
function scheduleSnapshot(task) {
  let section = task.section;
  if (!task.dueDate) section = section === 'later' ? 'later' : 'backlog';
  else if (['later', 'backlog'].includes(section)) section = sectionFor(task) === 'later' ? 'next-week' : sectionFor(task);
  return { section, dueDate: task.dueDate };
}
async function restoreSchedule(id, before) {
  const restored = await patchTask(id, before, { skipIfSame: true });
  if (restored) toast('Undone');
  else toast('Could not undo', () => restoreSchedule(id, before), 'Retry');
}
function openSchedule(id) {
  const task = tasks.find(item => item.id === id);
  if (!task || task.completed) return;
  scheduleTaskId = id;
  selectTask(id);
  $('#preferences').open = false;
  $('#schedule-task-title').textContent = task.title;
  document.querySelectorAll('#schedule-options button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.move === sectionFor(task)));
  });
  if (!$('#schedule-dialog').open) $('#schedule-dialog').showModal();
  $('#schedule-dialog').focus();
}
function cancelTaskGesture() {
  if (!activeGesture) return;
  clearTimeout(activeGesture.timer);
  activeGesture.row.classList.remove('gesture-active');
  activeGesture = null;
}
function installTaskGestures(row, id) {
  let suppressClickUntil = 0;
  row.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  row.addEventListener('contextmenu', event => {
    if (tasks.find(task => task.id === id)?.completed) return;
    event.preventDefault();
    openSchedule(id);
  });
  row.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || event.isPrimary === false || event.target.closest('.checkbox-hit,.schedule-trigger')) return;
    if (tasks.find(task => task.id === id)?.completed) return;
    cancelTaskGesture();
    const gesture = { id, row, pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, opened: false,
      suppress: () => { suppressClickUntil = Date.now() + 800; } };
    gesture.timer = setTimeout(() => {
      if (activeGesture !== gesture) return;
      gesture.opened = true;
      gesture.suppress();
      openSchedule(id);
    }, 500);
    activeGesture = gesture;
  });
}
document.addEventListener('pointermove', event => {
  const gesture = activeGesture;
  if (!gesture || gesture.pointer !== event.pointerId || gesture.opened) return;
  gesture.dx = event.clientX - gesture.x;
  gesture.dy = event.clientY - gesture.y;
  if (Math.abs(gesture.dy) > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) { cancelTaskGesture(); return; }
  if (Math.abs(gesture.dx) > 12) {
    clearTimeout(gesture.timer);
    gesture.row.classList.add('gesture-active');
    if (event.cancelable) event.preventDefault();
  }
}, { passive: false });
document.addEventListener('pointerup', event => {
  const gesture = activeGesture;
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const swipe = !gesture.opened && gesture.dx < -55 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
  if (swipe) gesture.suppress();
  cancelTaskGesture();
  if (swipe) openSchedule(gesture.id);
});
document.addEventListener('pointercancel', cancelTaskGesture);
window.addEventListener('blur', cancelTaskGesture);

function openEditor(task = null, title = '', fields = {}) {
  hideSuggestions();
  error();
  editingId = task?.id ?? null;
  const section = task ? sectionFor(task) : SECTIONS.includes(view) ? view : 'backlog';
  $('#dialog-title').textContent = task ? 'Task' : 'New task';
  $('#task-title').value = task?.title ?? title;
  $('#task-notes').value = task?.notes ?? '';
  $('#task-section').value = section;
  $('#task-section').dataset.original = section;
  $('#task-section').dataset.changed = 'false';
  $('#task-priority').value = task?.priority ?? fields.priority ?? 'medium';
  $('#task-type').value = task?.type ?? fields.type ?? 'task';
  $('#task-customer').value = task?.customer ?? fields.customer ?? '';
  $('#delete-task').hidden = !task;
  $('#task-dialog').showModal();
  if (task) $('#task-dialog').focus(); else $('#task-title').focus();
}
async function saveEditor() {
  if (formSaving) return;
  formSaving = true;
  $('#save-task').disabled = true;
  try {
    const fields = Object.fromEntries(new FormData($('#task-form')));
    const oldTask = tasks.find(task => task.id === editingId);
    // Editing notes/metadata must not reschedule an existing fixed date.
    fields.dueDate = oldTask && $('#task-section').dataset.changed !== 'true' ? oldTask.dueDate : dueFor(fields.section);
    if (oldTask && $('#task-section').dataset.changed !== 'true') delete fields.section;
    const task = await queueWrite(() => api(editingId ? `/api/tasks/${editingId}` : '/api/tasks', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(fields) }));
    confirmedTasks.set(task.id, task);
    tasks = editingId ? tasks.map(item => item.id === editingId ? task : item) : [task, ...tasks];
    if (!editingId) { $('#quick-title').value = ''; quickFields = {}; renderQuickTokens(); }
    $('#task-dialog').close();
    render();
  } catch (cause) { error(cause.message); }
  finally { formSaving = false; $('#save-task').disabled = false; }
}
function startReview(ids, drafts = new Map()) {
  const queue = ids ?? completionReview(tasks).map(task => task.id);
  if (!queue.length) return;
  clearToast();
  error();
  review = { ids: queue, index: 0, failed: new Set(), history: [], drafts, undoFailure: null };
  $('#review-meta').dataset.taskId = '';
  renderReview();
  if (!$('#review-dialog').open) $('#review-dialog').showModal();
  $('#review-dialog').focus();
}
function currentReviewTask() { return review ? tasks.find(task => task.id === review.ids[review.index]) : null; }
function reviewFields(id) {
  if ($('#review-meta').dataset.taskId !== id) return review?.drafts.get(id) ?? {};
  const typed = $('#review-customer').value.trim();
  const customer = customers().find(name => name.toLocaleLowerCase() === typed.toLocaleLowerCase()) ?? typed;
  const fields = { customer, priority: $('#review-priority').value, type: $('#review-type').value };
  review?.drafts.set(id, fields);
  return fields;
}
function commitReviewMetadata() {
  const task = currentReviewTask();
  if (!task || review.undoFailure) return;
  const fields = reviewFields(task.id);
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => task[key] !== value));
  if (Object.keys(changes).length) patchTask(task.id, changes);
}
function renderReview() {
  if (!review) return;
  while (!review.undoFailure && review.index < review.ids.length && (!currentReviewTask() || currentReviewTask().completed || currentReviewTask().dueDate)) ++review.index;
  const task = currentReviewTask();
  const blocked = Boolean(review.undoFailure);
  const last = review.history.at(-1);
  $('#review-back').disabled = !last || blocked;
  $('#review-back span').textContent = last?.kind === 'move' ? 'Undo' : 'Back';
  $('#review-back').setAttribute('aria-label', last?.kind === 'move' ? 'Undo last assignment' : 'Back to previous task');
  $('#review-progress').textContent = `${Math.min(review.index + 1, review.ids.length)} / ${review.ids.length}`;
  $('#review-progress-fill').style.width = `${(review.index / review.ids.length) * 100}%`;
  $('#review-actions').hidden = !task;
  $('.review-footer').hidden = !task;
  document.querySelectorAll('#review-actions button, .review-footer button, #review-meta input, #review-meta select').forEach(control => { control.disabled = blocked; });
  $('#review-done').hidden = Boolean(task) || pendingWrites > 0 || review.failed.size > 0 || blocked;
  $('#review-retry').hidden = Boolean(task) || pendingWrites > 0 || review.failed.size === 0 || blocked;
  $('#review-undo-retry').hidden = !blocked;
  $('#review-section').hidden = !task;
  $('#review-notes').hidden = !task?.notes;
  $('#review-meta').hidden = !task;
  $('#review-message').hidden = !blocked && (Boolean(task) || (!pendingWrites && !review.failed.size));
  if (task) {
    $('#review-section').textContent = LABELS[sectionFor(task)];
    $('#review-title').textContent = task.title;
    $('#review-notes').textContent = task.notes;
    const changedTask = $('#review-meta').dataset.taskId !== task.id;
    const fields = review.drafts.get(task.id) ?? task;
    for (const key of ['customer', 'priority', 'type']) {
      const input = $(`#review-${key}`);
      if (changedTask || document.activeElement !== input) input.value = fields[key] ?? '';
    }
    $('#review-meta').dataset.taskId = task.id;
    if (blocked) $('#review-message').textContent = 'Undo was not saved. Retry to continue.';
  } else {
    $('#review-title').textContent = pendingWrites ? 'Saving…' : review.failed.size ? 'Could not save' : 'All reviewed';
    $('#review-notes').textContent = '';
    $('#review-message').textContent = review.failed.size ? `${review.failed.size} ${review.failed.size === 1 ? 'task needs' : 'tasks need'} another try.` : 'Saving your changes…';
    if (!pendingWrites) $('#review-progress-fill').style.width = '100%';
  }
}
function reviewMove(section) {
  const task = currentReviewTask();
  if (!task || review.undoFailure) return;
  error();
  const activeReview = review;
  const fields = reviewFields(task.id);
  const record = { id: task.id, index: review.index, before: scheduleSnapshot(task), kind: 'move', active: true };
  review.history.push(record);
  ++review.index;
  patchTask(task.id, { ...fields, ...scheduledFields(section) }, { onError: id => {
    record.failed = true;
    if (record.active) activeReview.failed.add(id);
  } });
  renderReview();
}
function reviewBack() {
  if (!review || review.undoFailure || !review.history.length) return;
  commitReviewMetadata();
  error();
  const record = review.history.pop();
  record.active = false;
  review.index = record.index;
  review.failed.delete(record.id);
  if (record.kind === 'move' && !record.failed) restoreReviewRecord(review, record);
  else renderReview();
}
function restoreReviewRecord(context, record) {
  context.undoFailure = null;
  context.index = record.index;
  error();
  patchTask(record.id, record.before, { skipIfSame: true, onError: () => { context.undoFailure = record; } }).then(ok => {
    if (ok) context.undoFailure = null;
    if (review === context) renderReview();
  });
  renderReview();
}
function closeReview() { commitReviewMetadata(); $('#review-dialog').close(); review = null; }
function skipReview() {
  const task = currentReviewTask();
  if (!task || review.undoFailure) return;
  commitReviewMetadata();
  review.history.push({ id: task.id, index: review.index, kind: 'skip', active: true });
  ++review.index;
  renderReview();
}

// One suggestion menu serves both the quick composer and the full editor.
function hideSuggestions() {
  if (tokenMenu) {
    tokenMenu.input.setAttribute('aria-expanded', 'false');
    tokenMenu.input.removeAttribute('aria-activedescendant');
  }
  tokenMenu = null;
  $('#suggestions').hidden = true;
}
function suggest(input) {
  const caret = input.selectionStart;
  const prefix = input.value.slice(0, caret);
  const match = /(?:^|\s)([@!#])([^@!#]*)$/.exec(prefix);
  if (!match) { hideSuggestions(); return; }
  const trigger = match[1];
  const query = match[2].trim();
  let options;
  if (trigger === '@') {
    options = customers().filter(name => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(value => ({ value, label: value }));
    if (query && !customers().some(name => name.toLocaleLowerCase() === query.toLocaleLowerCase())) options.push({ value: query, label: query, create: true });
    if (!options.length) options = [{ value: '', label: 'Type a customer', hint: true }];
  } else {
    options = (trigger === '!' ? ['low', 'medium', 'high'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) : Object.entries(TYPES).map(([value, label]) => ({ value, label })))
      .filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }
  if (!options.length) { hideSuggestions(); return; }
  tokenMenu = { input, trigger, start: prefix.length - match[2].length - 1, end: caret, options: options.slice(0, 8), selected: 0 };
  renderSuggestions();
}
function renderSuggestions() {
  const { input, trigger, options, selected } = tokenMenu;
  const menu = $('#suggestions');
  menu.replaceChildren(...options.map((option, index) => {
    const button = element('button', 'suggestion');
    button.type = 'button';
    button.id = `suggestion-${index}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === selected));
    button.disabled = Boolean(option.hint);
    button.append(element('span', 'token-prefix', trigger), element('span', '', option.label));
    if (option.create) button.append(element('small', '', 'Create'));
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => applySuggestion(index));
    return button;
  }));
  const bounds = input.getBoundingClientRect();
  const modal = input.closest('dialog');
  (modal ?? document.body).append(menu);
  menu.style.position = modal ? 'absolute' : 'fixed';
  const modalBounds = modal?.getBoundingClientRect();
  menu.style.left = `${modal ? bounds.left - modalBounds.left - modal.clientLeft : Math.max(16, Math.min(bounds.left, innerWidth - 250))}px`;
  menu.style.top = `${modal ? bounds.bottom - modalBounds.top - modal.clientTop + modal.scrollTop + 10 : bounds.bottom + 10}px`;
  menu.hidden = false;
  input.setAttribute('aria-controls', 'suggestions');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', `suggestion-${selected}`);
  // A modal dialog is in the browser's top layer; its menu must share that layer.
}
function applySuggestion(index = tokenMenu?.selected) {
  if (!tokenMenu) return;
  const { input, trigger, start, end, options } = tokenMenu;
  const option = options[index];
  if (!option || option.hint) return;
  const key = { '@': 'customer', '!': 'priority', '#': 'type' }[trigger];
  if (input.id === 'quick-title') { quickFields[key] = option.value; renderQuickTokens(); }
  else $(`#task-${key}`).value = option.value;
  input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
  input.setSelectionRange(start, start);
  hideSuggestions();
  input.focus();
}
function renderQuickTokens() {
  const tokens = $('#quick-tokens');
  tokens.replaceChildren();
  for (const [key, value] of Object.entries(quickFields)) {
    const label = key === 'customer' ? `@${value}` : key === 'priority' ? `! ${value}` : `# ${TYPES[value]}`;
    const button = element('button', `token ${key === 'customer' ? 'customer' : value}`, label);
    button.type = 'button';
    button.setAttribute('aria-label', `Remove ${label}`);
    button.addEventListener('click', () => { delete quickFields[key]; renderQuickTokens(); $('#quick-title').focus(); });
    tokens.append(button);
  }
  tokens.hidden = !Object.keys(quickFields).length;
}
function tokenKeydown(event) {
  if (!tokenMenu || tokenMenu.input !== event.target || event.isComposing) return;
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    tokenMenu.selected = (tokenMenu.selected + (event.key === 'ArrowDown' ? 1 : -1) + tokenMenu.options.length) % tokenMenu.options.length;
    renderSuggestions();
  } else if (['Enter', 'Tab'].includes(event.key) && !tokenMenu.options[tokenMenu.selected].hint) {
    event.preventDefault();
    applySuggestion();
  } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hideSuggestions(); }
}
for (const input of [$('#quick-title'), $('#task-title')]) {
  input.addEventListener('input', () => suggest(input));
  input.addEventListener('keydown', tokenKeydown);
  input.addEventListener('blur', () => { setTimeout(() => { if (tokenMenu?.input === input && !$('#suggestions').contains(document.activeElement)) hideSuggestions(); }, 120); });
}
window.addEventListener('resize', hideSuggestions);
window.addEventListener('scroll', hideSuggestions, true);
document.addEventListener('pointerdown', event => {
  if (tokenMenu && event.target !== tokenMenu.input && !$('#suggestions').contains(event.target)) hideSuggestions();
});

// Navigation, themes, and scheduling controls are shared by mouse, touch, and keys.
for (const parent of [$('#navigation'), $('#mobile-sections')]) {
  for (const section of ['all', ...SECTIONS, 'completed']) {
    if (parent.id === 'navigation' && section === 'completed') continue;
    if (section === 'today' || section === 'completed') parent.append(element('div', 'nav-divider'));
    const button = element('button', `nav-item${section === 'completed' ? ' mobile-completed' : ''}`);
    button.dataset.section = section;
    button.append(icon(icons[section]), element('span', '', LABELS[section]), element('span', 'nav-count', '0'));
    parent.append(button);
  }
}
document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => setView(button.dataset.section)));
for (const section of SECTIONS) {
  const option = element('option');
  option.value = section;
  option.textContent = `${LABELS[section]}${dueFor(section) ? ` · ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${dueFor(section)}T12:00:00`))}` : ''}`;
  $('#task-section').append(option);
}
for (const [key, section] of Object.entries(moves).slice(0, 4)) {
  for (const parent of [$('#move-buttons'), $('#editor-moves'), $('#review-actions')]) {
    const button = element('button', parent.id === 'review-actions' ? 'review-action' : 'move-button');
    button.type = 'button';
    button.dataset.move = section;
    const label = element('span', '', LABELS[section]);
    if (parent.id === 'review-actions' && ['this-week', 'next-week'].includes(section)) {
      label.append(element('span', 'review-date', new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${dueFor(section)}T12:00:00`))));
    }
    button.append(element('kbd', '', key), label);
    if (parent.id === 'move-buttons') { button.disabled = true; button.addEventListener('click', () => schedule(selectedId, section)); }
    if (parent.id === 'editor-moves') button.addEventListener('click', () => {
      $('#task-section').value = section;
      $('#task-section').dataset.changed = 'true';
      if (editingId) $('#task-form').requestSubmit();
    });
    if (parent.id === 'review-actions') button.addEventListener('click', () => reviewMove(section));
    parent.append(button);
  }
}
function setTheme(theme) {
  if (!['clear', 'frost', 'midnight'].includes(theme)) theme = 'frost';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = { clear: '#f5f7fb', frost: '#f6f7f4', midnight: '#141c29' }[theme];
  document.querySelectorAll('.appearance button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  try { localStorage.setItem('task-theme', theme); } catch {}
}
let initialTheme = 'frost';
try {
  // Adopt the chosen Frost direction once, then keep explicit later choices.
  if (localStorage.getItem('task-appearance-version') === '2') initialTheme = localStorage.getItem('task-theme') || 'frost';
  localStorage.setItem('task-appearance-version', '2');
  $('#group-by').value = localStorage.getItem('task-grouping') || 'none';
} catch {}
if (!['none', 'customer', 'priority', 'type'].includes($('#group-by').value)) $('#group-by').value = 'none';
setTheme(initialTheme);
document.querySelectorAll('.appearance button').forEach(button => button.addEventListener('click', () => { setTheme(button.dataset.theme); $('#preferences').open = false; }));
document.addEventListener('click', event => { if (!$('#preferences').contains(event.target)) $('#preferences').open = false; });
function openLists() {
  $('#preferences').open = false;
  $('#mobile-lists').setAttribute('aria-expanded', 'true');
  $('#lists-dialog').showModal();
}
for (const id of ['#mobile-lists', '#mobile-lists-top']) $(id).addEventListener('click', openLists);
$('#lists-close').addEventListener('click', () => $('#lists-dialog').close());
$('#lists-dialog').addEventListener('close', () => $('#mobile-lists').setAttribute('aria-expanded', 'false'));
$('#mobile-add').addEventListener('click', () => openEditor());
$('#mobile-review').addEventListener('click', () => startReview());
function toggleSearch(open) {
  document.documentElement.dataset.searchOpen = String(open);
  $('#search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
  else { $('#search').value = ''; render(); $('#search-toggle').focus(); }
}
$('#search-toggle').addEventListener('click', () => toggleSearch(document.documentElement.dataset.searchOpen !== 'true'));
$('#search').addEventListener('keydown', event => { if (event.key === 'Escape' && matchMedia('(max-width: 700px)').matches) { event.preventDefault(); toggleSearch(false); } });
function updateViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--viewport-height', `${viewport?.height ?? innerHeight}px`);
  const inset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  document.documentElement.toggleAttribute('data-keyboard-open', inset > 140);
}
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
updateViewport();
$('#group-by').addEventListener('change', () => { try { localStorage.setItem('task-grouping', $('#group-by').value); } catch {} render(); });
$('#search').addEventListener('input', render);
$('#task-section').addEventListener('change', () => { $('#task-section').dataset.changed = 'true'; });
$('#close-editor').addEventListener('click', () => $('#task-dialog').close());
$('#task-dialog').addEventListener('close', hideSuggestions);
$('#task-form').addEventListener('submit', event => { event.preventDefault(); hideSuggestions(); saveEditor(); });
$('#quick-details').addEventListener('click', () => openEditor(null, $('#quick-title').value.trim(), quickFields));
$('#quick-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (formSaving) return;
  const title = $('#quick-title').value.trim();
  if (!title) return;
  if (title.length > 200) { error('Title must be at most 200 characters.'); return; }
  formSaving = true;
  $('#quick-title').disabled = true;
  const section = SECTIONS.includes(view) ? view : 'backlog';
  try {
    const task = await queueWrite(() => api('/api/tasks', { method: 'POST', body: JSON.stringify({ title, ...scheduledFields(section), ...quickFields }) }));
    confirmedTasks.set(task.id, task);
    tasks.unshift(task);
    $('#quick-title').value = '';
    quickFields = {};
    renderQuickTokens();
    render();
  } catch (cause) { error(cause.message); }
  finally { formSaving = false; $('#quick-title').disabled = false; $('#quick-title').focus(); }
});
$('#delete-task').addEventListener('click', async () => {
  if (formSaving || !confirm('Delete this task?')) return;
  formSaving = true;
  const id = editingId;
  try { await queueWrite(() => api(`/api/tasks/${id}`, { method: 'DELETE' })); tasks = tasks.filter(task => task.id !== id); $('#task-dialog').close(); render(); }
  catch (cause) { error(cause.message); }
  finally { formSaving = false; }
});
$('#review-start').addEventListener('click', () => startReview());
$('#review-close').addEventListener('click', closeReview);
$('#review-dialog').addEventListener('cancel', () => { commitReviewMetadata(); review = null; });
$('#review-done').addEventListener('click', closeReview);
$('#review-retry').addEventListener('click', () => startReview([...review.failed], review.drafts));
$('#review-later').addEventListener('click', () => reviewMove('later'));
$('#review-backlog').addEventListener('click', () => reviewMove('backlog'));
$('#review-skip').addEventListener('click', skipReview);
$('#review-back').addEventListener('click', reviewBack);
$('#review-undo-retry').addEventListener('click', () => restoreReviewRecord(review, review.undoFailure));
for (const key of ['customer', 'priority', 'type']) {
  const control = $(`#review-${key}`);
  control.addEventListener('change', commitReviewMetadata);
  control.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      commitReviewMetadata(); $('#review-dialog').focus();
    }
  });
}
for (const [key, section] of Object.entries(moves)) {
  const button = element('button', 'schedule-option');
  button.type = 'button';
  button.dataset.move = section;
  button.append(icon(icons[section]), element('span', '', LABELS[section]), element('span', 'schedule-date', dueFor(section) ? new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${dueFor(section)}T12:00:00`)) : ''), element('kbd', '', key));
  button.addEventListener('click', () => { const id = scheduleTaskId; $('#schedule-dialog').close(); schedule(id, section); });
  $('#schedule-options').append(button);
}
$('#schedule-close').addEventListener('click', () => $('#schedule-dialog').close());
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    signedIn = true;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    await refresh();
  } catch (cause) { error(cause.message); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await writeQueue; await api('/api/logout', { method: 'POST' }); showLogin(); } catch (cause) { error(cause.message); }
});

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.isComposing || !signedIn) return;
  if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    if ($('#review-dialog').open) { event.preventDefault(); reviewBack(); }
    else if (toastAction?.run && !document.querySelector('dialog[open]')) { event.preventDefault(); const action = toastAction.run; clearToast(); action(); }
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if ($('#review-dialog').open) {
    if (moves[event.key]) { event.preventDefault(); reviewMove(moves[event.key]); }
    if (event.key === 'ArrowRight') { event.preventDefault(); skipReview(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); reviewBack(); }
    const field = { '@': 'customer', '!': 'priority', '#': 'type' }[event.key];
    if (field && currentReviewTask() && !review.undoFailure) {
      event.preventDefault(); $(`#review-${field}`).focus();
      if (field === 'customer') $('#review-customer').select();
    }
    return;
  }
  if ($('#lists-dialog').open) return;
  if ($('#schedule-dialog').open) {
    if (moves[event.key]) { event.preventDefault(); const id = scheduleTaskId; $('#schedule-dialog').close(); schedule(id, moves[event.key]); }
    return;
  }
  if ($('#task-dialog').open) {
    if (moves[event.key] && !formSaving) {
      event.preventDefault();
      $('#task-section').value = moves[event.key];
      $('#task-section').dataset.changed = 'true';
      if (editingId) $('#task-form').requestSubmit();
    }
    return;
  }
  if (event.key === 'F10' && event.shiftKey && selectedId) { event.preventDefault(); openSchedule(selectedId); return; }
  if (moves[event.key] && selectedId) { event.preventDefault(); schedule(selectedId, moves[event.key]); }
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    const visible = visibleTasks();
    if (!visible.length) return;
    event.preventDefault();
    const position = visible.findIndex(task => task.id === selectedId);
    const next = visible[Math.max(0, Math.min(visible.length - 1, position + (event.key === 'ArrowDown' ? 1 : -1)))];
    selectTask(next.id);
    [...document.querySelectorAll('.task')].find(row => row.dataset.taskId === next.id)?.focus();
  }
  if (event.key === 'Enter' && event.target.classList.contains('task') && selectedId) { event.preventDefault(); openEditor(tasks.find(task => task.id === selectedId)); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); startReview(); }
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); if (matchMedia('(max-width: 700px)').matches) openEditor(); else $('#quick-title').focus(); }
});
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
try {
  const session = await api('/api/session');
  $('#logout').hidden = !session.passwordRequired;
  if (session.authenticated) { signedIn = true; $('#app-view').hidden = false; await refresh(); }
  else showLogin();
} catch (cause) { error(`${cause.message} Reload to reconnect.`); }
