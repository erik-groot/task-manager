const $ = selector => document.querySelector(selector);
let tasks = [];
let filter = 'active';
let editingId = null;
let signedIn = false;
let refreshing = false;
let writing = false;
let refreshId = 0;

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
  $('#dialog-error').textContent = message;
  $('#dialog-error').hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw new Error(data.error || 'Unable to connect. Please try again.');
  }
  return data;
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function showLogin() {
  signedIn = false;
  ++refreshId;
  refreshing = false;
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#task-dialog').close();
  tasks = [];
  $('#task-list').replaceChildren();
  $('#password').focus();
}

function render() {
  const today = localDate();
  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  $('#active-count').textContent = tasks.filter(task => !task.completed).length;
  $('#today-count').textContent = tasks.filter(task => !task.completed && task.dueDate && task.dueDate <= today).length;
  $('#done-count').textContent = tasks.filter(task => task.completed).length;
  $('#view-title').textContent = { active: 'My tasks', today: 'Today', completed: 'Completed' }[filter];
  $('#view-description').textContent = { active: 'Make room for what matters.', today: 'Due today and anything still waiting.', completed: 'A little progress, every day.' }[filter];
  const search = $('#search').value.toLocaleLowerCase();
  const visible = tasks.filter(task => {
    const matches = filter === 'completed' ? task.completed : !task.completed &&
      (filter !== 'today' || (task.dueDate && task.dueDate <= today));
    return matches && `${task.title} ${task.notes}`.toLocaleLowerCase().includes(search);
  }).sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') ||
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.createdAt.localeCompare(a.createdAt));
  $('#result-count').textContent = `${visible.length} ${visible.length === 1 ? 'task' : 'tasks'}`;
  $('#task-list').replaceChildren();
  for (const task of visible) {
    const row = node('article', `task${task.completed ? ' completed' : ''}`);
    const check = node('input', 'task-check');
    check.type = 'checkbox';
    check.checked = task.completed;
    check.setAttribute('aria-label', `${task.completed ? 'Reopen' : 'Complete'} ${task.title}`);
    check.addEventListener('change', () => mutate(async () => {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: check.checked }) });
    }));
    const details = node('button', 'task-details');
    details.append(node('span', 'task-title', task.title));
    if (task.notes) details.append(node('span', 'task-notes', task.notes));
    const meta = node('span', 'task-meta');
    if (task.priority === 'high') meta.append(node('span', 'priority', '↑ High priority'));
    if (task.dueDate) {
      const label = task.dueDate === today ? 'Today' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${task.dueDate}T12:00:00`));
      meta.append(node('span', !task.completed && task.dueDate < today ? 'overdue' : '', label));
    }
    if (meta.childNodes.length) details.append(meta);
    details.addEventListener('click', () => openEditor(task));
    row.append(check, details, node('span', 'task-arrow', '›'));
    $('#task-list').append(row);
  }
  $('#empty').hidden = visible.length !== 0;
  $('#empty-title').textContent = search ? 'No matching tasks.' : { active: 'A clear space to start.', today: 'A little breathing room.', completed: 'Progress starts small.' }[filter];
  $('#empty-description').textContent = search ? 'Try another search.' : { active: 'Add a task and take it one step at a time.', today: 'Nothing is due today. Your other tasks are in My tasks.', completed: 'Completed tasks will appear here.' }[filter];
}

async function refresh(force = false) {
  if (!signedIn || (refreshing && !force) || writing) return;
  const requestId = ++refreshId;
  refreshing = true;
  try {
    const result = await api('/api/tasks');
    if (!signedIn || requestId !== refreshId) return;
    tasks = result;
    render();
    $('#sync-status').textContent = 'Up to date · refreshes every 15 seconds';
    showError('');
  } catch (error) {
    if (requestId !== refreshId) return;
    $('#sync-status').textContent = 'Connection unavailable';
    showError(`${error.message} Check that your Mac mini is running and reachable.`);
  } finally { if (requestId === refreshId) refreshing = false; }
}

async function mutate(action) {
  if (writing) { render(); return; }
  writing = true;
  ++refreshId;
  refreshing = false;
  try {
    showError('');
    await action();
    writing = false;
    await refresh(true);
  } catch (error) { showError(error.message); render(); }
  finally { writing = false; }
}

function openEditor(task = null) {
  showError('');
  editingId = task?.id ?? null;
  $('#dialog-title').textContent = task ? 'Edit task' : 'New task';
  $('#task-title').value = task?.title ?? '';
  $('#task-notes').value = task?.notes ?? '';
  $('#task-due').value = task?.dueDate ?? '';
  $('#task-priority').value = task?.priority ?? 'normal';
  $('#delete-task').hidden = !task;
  $('#task-dialog').showModal();
  $('#task-title').focus();
}

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
  } catch (error) { showError(error.message); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', () => mutate(async () => { await api('/api/logout', { method: 'POST' }); showLogin(); }));
$('#new-task').addEventListener('click', () => openEditor());
$('#close-dialog').addEventListener('click', () => $('#task-dialog').close());
$('#search').addEventListener('input', render);
$('#refresh').addEventListener('click', () => refresh());
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => {
    item.classList.toggle('selected', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
  render();
}));
$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  mutate(async () => {
    const body = Object.fromEntries(new FormData(event.target));
    await api(editingId ? `/api/tasks/${editingId}` : '/api/tasks', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    $('#task-dialog').close();
  });
});
$('#delete-task').addEventListener('click', () => {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  mutate(async () => { await api(`/api/tasks/${editingId}`, { method: 'DELETE' }); $('#task-dialog').close(); });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', () => refresh());
setInterval(() => { if (!document.hidden) refresh(); }, 15000);

try {
  const session = await api('/api/session');
  $('#logout').hidden = !session.passwordRequired;
  if (session.authenticated) { signedIn = true; $('#app-view').hidden = false; await refresh(); }
  else showLogin();
} catch (error) { showError(`${error.message} Reload this page to reconnect.`); }
