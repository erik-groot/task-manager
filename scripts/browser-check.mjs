import assert from 'node:assert/strict';
import { writeFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { dueFor, completionReview } from '../public/planning.js';
// This runner always creates its own disposable server, database, and browser.
process.env.TZ = 'Europe/Amsterdam';
const directory = await mkdtemp(join(tmpdir(), 'task-browser-'));
const server = createApp({ databasePath: join(directory, 'tasks.sqlite') });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
let chromeError;
chrome.on('error', error => { chromeError = error; });
let debugPort;
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (chromeError) throw chromeError;
    if (chrome.exitCode !== null) throw new Error('Chromium exited before startup. Set CHROMIUM to your browser executable.');
    try { debugPort = (await readFile(join(directory, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!debugPort) throw new Error('Chromium startup timed out.');
} catch (error) {
  chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive:true, force:true, maxRetries:10 }); throw error;
}
const screenshotDirectory = process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : null;
const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${base}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
const networkErrors = [];
const networkRequests = new Map();
const navigations = [];
ws.addEventListener('message', event => {
  const result = JSON.parse(event.data);
  if (result.method === 'Network.requestWillBeSent') networkRequests.set(result.params.requestId,result.params.request.url);
  if (result.method === 'Page.frameNavigated') navigations.push(result.params.frame.url);
  if (result.method === 'Network.loadingFailed') networkErrors.push({...result.params,url:networkRequests.get(result.params.requestId)});
  if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text);
  if (!result.id) return;
  const handlers = pending.get(result.id); pending.delete(result.id);
  if (result.error) handlers.reject(new Error(JSON.stringify(result.error))); else handlers.resolve(result.result);
});
function cdp(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }); }
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function wait(expression) {
  const until = Date.now() + 6000;
  while (Date.now() < until) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Timed out: ' + expression);
}
async function press(key, code = key) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...(key === 'Enter' ? {windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r'} : key.length === 1 ? { text: key, unmodifiedText: key } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}
async function input(selector, value) {
  await evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.value=${JSON.stringify(value)};el.setSelectionRange?.(el.value.length,el.value.length);el.dispatchEvent(new Event('input',{bubbles:true}));}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function tasks() { return (await fetch(base + '/api/tasks')).json(); }
async function create(fields) { const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }); assert.equal(r.status, 201); return r.json(); }
async function clean() { for (const task of await tasks()) await fetch(base + '/api/tasks/' + task.id, { method: 'DELETE' }); }
let navigation = 0;
async function reload() { const query='?check='+ ++navigation; await cdp('Page.navigate', {url:base+'/'+query}); await wait(`location.search === '${query}' && document.readyState === 'complete' && document.querySelector('#app-view')?.hidden === false && document.querySelector('#connection')?.classList.contains('online')`); }
async function screenshot(name) { if (!screenshotDirectory) return; await mkdir(screenshotDirectory, {recursive:true}); await writeFile(join(screenshotDirectory, name + '.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Amsterdam' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait(`document.readyState === 'complete' && document.querySelector('#app-view')?.hidden === false && document.querySelector('#connection')?.classList.contains('online')`);
  await click('[data-section="backlog"]');
  await input('#quick-title', 'Review proposal @Acme');
  await wait(`!document.querySelector('#suggestions').hidden`);
  await press('Enter');
  assert.equal(await evaluate(`document.querySelector('#quick-title').value.trim()`), 'Review proposal');
  await input('#quick-title', 'Review proposal !hi'); await press('Enter');
  await input('#quick-title', 'Review proposal #waiting'); await press('Enter');
  await press('Enter');
  await wait(`document.querySelectorAll('.task').length === 1`);
  let [created] = await tasks();
  assert.equal(created.customer, 'Acme'); assert.equal(created.priority, 'high'); assert.equal(created.type, 'waiting'); assert.equal(created.dueDate, '');
  // Numbers typed into title fields must remain text.
  await click('.task-main'); await input('#task-title', 'Review proposal '); await press('1', 'Digit1');
  assert.equal(await evaluate(`document.querySelector('#task-title').value`), 'Review proposal 1');
  assert.equal((await tasks())[0].dueDate, '');
  // Metadata menus must stay visible and clickable inside the modal top layer.
  await input('#task-title', 'Review proposal @Acme');
  const menuBox = await evaluate(`{const m=document.querySelector('#suggestions').getBoundingClientRect();const d=document.querySelector('#task-dialog').getBoundingClientRect();JSON.stringify({ml:m.left,mr:m.right,dl:d.left,dr:d.right,top:m.top,bottom:d.bottom})}`);
  const bounds = JSON.parse(menuBox); assert.ok(bounds.ml >= bounds.dl && bounds.mr <= bounds.dr && bounds.top < bounds.bottom, menuBox);
  await press('Enter'); await click('#close-editor');
  // A selected row can be moved immediately using the assigned number key.
  await evaluate(`document.querySelector('.task').focus()`); await press('3', 'Digit3');
  await wait(`document.querySelectorAll('.task').length === 0`);
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  [created] = await tasks(); assert.equal(created.section, 'this-week'); assert.equal(created.dueDate, dueFor('this-week'));
  // Review accepts a rapid sequence without dropping or double-applying keys.
  await clean();
  for (let n = 1; n <= 4; n++) await create({ title: 'Review ' + n, section: n % 2 ? 'backlog' : 'later', priority: 'medium' });
  const reviewOrder = completionReview(await tasks()).map(task => task.id);
  await reload(); await click('#review-start');
  await wait(`document.querySelector('#review-dialog').open`);
  for (const key of ['1', '4', '3', '2']) await press(key, 'Digit' + key);
  await wait(`document.querySelector('#review-title').textContent === 'All reviewed'`);
  const resultTasks = await tasks();
  const reviewed = reviewOrder.map(id => resultTasks.find(task => task.id === id));
  assert.deepEqual(reviewed.map(task => task.section), ['today', 'next-week', 'this-week', 'tomorrow']);
  assert.deepEqual(reviewed.map(task => task.dueDate), ['today', 'next-week', 'this-week', 'tomorrow'].map(section => dueFor(section)));
  await click('#review-done');
  // A failed review write rolls back and offers retry rather than losing a task.
  await clean();
  const failedTask = await create({title:'Retry this task', section:'backlog'});
  await reload(); await click('#review-start');
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs',{urls:[base + '/api/tasks/*']});
  await press('1','Digit1');
  await wait(`!document.querySelector('#review-retry').hidden`);
  assert.equal((await tasks()).find(task => task.id === failedTask.id).dueDate,'');
  await cdp('Network.setBlockedURLs',{urls:[]});
  await click('#review-retry'); await press('4','Digit4');
  await wait(`document.querySelector('#review-title').textContent === 'All reviewed'`);
  assert.equal((await tasks()).find(task=>task.id===failedTask.id).section,'next-week');
  await click('#review-done');
  // Saving an edit must preserve an existing fixed due date.
  const older = await create({ title: 'Keep fixed date', section: 'today', dueDate: '2026-01-01' });
  await reload(); await evaluate(`document.querySelector('[data-task-id="${older.id}"] .task-main').click()`);
  await input('#task-notes', 'Do not change the old date'); await click('#save-task');
  await wait(`!document.querySelector('#task-dialog').open`);
  assert.equal((await tasks()).find(task => task.id === older.id).dueDate, '2026-01-01');
  // Demonstrate grouping and all six sections using disposable sample content.
  await clean();
  const examples = [
    ['Send revised proposal', 'Acme', 'high', 'task', 'today'],
    ['Approve homepage direction', 'Acme', 'medium', 'waiting', 'today'],
    ['Share project estimate', 'Studio North', 'high', 'task', 'today'],
    ['Feedback on the brand concepts', 'Studio North', 'medium', 'waiting', 'today'],
    ['Prepare discovery session', 'Lumen', 'low', 'task', 'today'],
    ['Confirm launch date', 'Acme', 'medium', 'waiting', 'tomorrow'],
    ['Review website copy', 'Lumen', 'medium', 'task', 'this-week'],
    ['Map the next release', 'Studio North', 'low', 'task', 'next-week'],
    ['Explore the mobile experience', 'Lumen', 'medium', 'task', 'later'],
    ['Plan the customer dashboard', 'Acme', 'high', 'task', 'backlog'],
    ['Review annual support proposal', 'Studio North', 'medium', 'waiting', 'backlog'],
  ];
  for (const [title, customer, priority, type, section] of examples) await create({ title, customer, priority, type, section, dueDate: dueFor(section) });
  await reload();
  for (const [group, expected] of [['priority',['High','Medium','Low']],['type',['Task','Waiting for']]]) {
    await evaluate(`document.querySelector('#group-by').value='${group}';document.querySelector('#group-by').dispatchEvent(new Event('change'))`);
    const headings = await evaluate(`Array.from(document.querySelectorAll('.group-heading')).map(el=>el.firstChild.textContent)`);
    assert.deepEqual(headings,expected);
  }
  await evaluate(`document.querySelector('#group-by').value='customer';document.querySelector('#group-by').dispatchEvent(new Event('change'))`);

  for (const theme of ['clear', 'frost', 'midnight']) {
    await click(`.appearance [data-theme="${theme}"]`);
    await screenshot('glass-' + theme);
  }
  // High-contrast and reduced-transparency settings have opaque fallbacks.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.app-window')).backdropFilter`), 'none');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await click('.appearance [data-theme="clear"]');
  await click('#review-start'); await screenshot('glass-review'); await click('#review-close');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.mobile-completed')).display !== 'none'`));
  await screenshot('glass-iphone');
  await click('#review-start');
  assert.equal(await evaluate(`document.querySelector('#review-dialog').scrollWidth <= document.querySelector('#review-dialog').clientWidth`), true);
  await screenshot('glass-iphone-review');
  await click('#review-close');
  for (const width of [320,768,1024]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Horizontal overflow at '+width);
  }
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: @/!/# menus, modal positioning, title typing, 1–4 moves, rapid review, fixed-date edits, three themes, reduced transparency, and phone layout.');
} catch (cause) { console.log('UI state', await evaluate(`JSON.stringify({errors:document.querySelector('#notice').textContent,view:document.querySelector('#view-title').textContent,title:document.querySelector('#quick-title').value,menu:document.querySelector('#suggestions').hidden,tokens:document.querySelector('#quick-tokens').textContent,list:document.querySelector('#task-list').textContent})`)); console.log('Runtime errors',errors); console.log('Network errors',networkErrors); console.log('Navigations',navigations); console.log('Tasks',await tasks()); throw cause; } finally { ws.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => { if (chrome.exitCode !== null || chrome.signalCode) resolve(); else chrome.once('exit',resolve); }); await rm(directory,{recursive:true,force:true,maxRetries:10}); }
