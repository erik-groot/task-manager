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
const chrome = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeError;
let chromeLog = '';
chrome.stderr.on('data', chunk => { chromeLog = (chromeLog + chunk.toString()).slice(-8192); });
chrome.on('error', error => { chromeError = error; });
let debugPort;
try {
  const startupDeadline = Date.now() + 30000;
  while (Date.now() < startupDeadline) {
    if (chromeError) throw chromeError;
    if (chrome.exitCode !== null) throw new Error('Chromium exited before startup. Set CHROMIUM to your browser executable.');
    try { debugPort = (await readFile(join(directory, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!debugPort) throw new Error(`Chromium startup timed out. ${chromeLog}`);
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
async function press(key, code = key, modifiers = 0) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(key === 'Enter' ? {windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r'} : key.length === 1 ? { text: key, unmodifiedText: key } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
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
async function screenshot(name, selector) {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, {recursive:true});
  const clip = selector ? await evaluate(`{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();({x:Math.max(0,r.x-16),y:Math.max(0,r.y-16),width:r.width+32,height:r.height+32,scale:1})}`) : undefined;
  await writeFile(join(screenshotDirectory, name + '.png'), Buffer.from((await cdp('Page.captureScreenshot', { format:'png', ...(clip ? {clip} : {}) })).data,'base64'));
}
try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Amsterdam' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait(`document.readyState === 'complete' && document.querySelector('#app-view')?.hidden === false && document.querySelector('#connection')?.classList.contains('online')`);
  assert.equal(await evaluate(`document.documentElement.dataset.theme`),'frost');
  await evaluate(`document.fonts.ready`);
  assert.ok(await evaluate(`getComputedStyle(document.documentElement).fontFamily.startsWith('-apple-system')`));
  await click('#navigation [data-section="backlog"]');
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
  // Metadata stays editable inside Review, including during rapid move/undo/reassign.
  await clean();
  await create({title:'Undo and edit',section:'backlog'});
  await create({title:'Skip and return',section:'later'});
  await reload(); await click('#review-start');
  const firstReviewTitle=await evaluate(`document.querySelector('#review-title').textContent`);
  const firstReviewId=(await tasks()).find(task=>task.title===firstReviewTitle).id;
  assert.equal(await evaluate(`document.querySelector('#review-back').disabled`),true);
  await press('@');
  assert.equal(await evaluate(`document.activeElement.id`),'review-customer');
  await input('#review-customer','New Customer'); await press('Escape');
  await press('!');
  assert.equal(await evaluate(`document.activeElement.id`),'review-priority');
  await evaluate(`document.querySelector('#review-priority').value='high';document.querySelector('#review-priority').dispatchEvent(new Event('change',{bubbles:true}))`);
  await press('Escape'); await press('#');
  assert.equal(await evaluate(`document.activeElement.id`),'review-type');
  await evaluate(`document.querySelector('#review-type').value='waiting';document.querySelector('#review-type').dispatchEvent(new Event('change',{bubbles:true}))`);
  await press('Escape');
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:-1,uploadThroughput:-1});
  await press('1','Digit1'); await press('ArrowLeft'); await press('4','Digit4');
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  let changed=(await tasks()).find(task=>task.id===firstReviewId);
  assert.equal(changed.section,'next-week'); assert.equal(changed.dueDate,dueFor('next-week'));
  assert.equal(changed.customer,'New Customer'); assert.equal(changed.priority,'high'); assert.equal(changed.type,'waiting');
  const secondReviewTitle=await evaluate(`document.querySelector('#review-title').textContent`);
  await press('ArrowRight');
  await wait(`document.querySelector('#review-title').textContent==='All reviewed'`);
  await click('#review-back');
  assert.equal(await evaluate(`document.querySelector('#review-title').textContent`),secondReviewTitle);
  await press('ArrowLeft');
  assert.equal(await evaluate(`document.querySelector('#review-title').textContent`),firstReviewTitle);
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  changed=(await tasks()).find(task=>task.id===firstReviewId);
  assert.equal(changed.dueDate,''); assert.equal(changed.customer,'New Customer');
  await press('3','Digit3'); await press('2','Digit2');
  await wait(`document.querySelector('#review-title').textContent==='All reviewed'`);
  await press('z','KeyZ',4);
  assert.equal(await evaluate(`document.querySelector('#review-title').textContent`),secondReviewTitle);
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  assert.equal((await tasks()).find(task=>task.title===secondReviewTitle).dueDate,'');
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await click('#review-close');
  // An undo that fails is explicitly retryable; the server's saved date is preserved.
  await clean(); const undoFailed=await create({title:'Retry undo',section:'backlog'});
  await reload(); await click('#review-start'); await press('1','Digit1');
  await wait(`document.querySelector('#review-title').textContent==='All reviewed'`);
  await cdp('Network.setBlockedURLs',{urls:[base+'/api/tasks/*']});
  await click('#review-back');
  await wait(`!document.querySelector('#review-undo-retry').hidden`);
  assert.equal((await tasks()).find(task=>task.id===undoFailed.id).dueDate,dueFor('today'));
  assert.equal(await evaluate(`document.querySelector('#review-actions button').disabled`),true);
  await cdp('Network.setBlockedURLs',{urls:[]}); await click('#review-undo-retry');
  await wait(`document.querySelector('#review-undo-retry').hidden && document.querySelector('#connection').classList.contains('online')`);
  assert.equal((await tasks()).find(task=>task.id===undoFailed.id).dueDate,'');
  await click('#review-close');
  // Failed metadata edits retain their draft and can be saved with the next assignment.
  await clean(); const draftTask=await create({title:'Keep review draft',section:'backlog'});
  await reload(); await click('#review-start');
  await cdp('Network.setBlockedURLs',{urls:[base+'/api/tasks/*']});
  await input('#review-customer','Keep this draft'); await press('Escape');
  await wait(`!document.querySelector('#review-error').hidden`);
  assert.equal((await tasks()).find(task=>task.id===draftTask.id).customer,'');
  await cdp('Network.setBlockedURLs',{urls:[]}); await press('4','Digit4');
  await wait(`document.querySelector('#review-title').textContent==='All reviewed'`);
  assert.equal((await tasks()).find(task=>task.id===draftTask.id).customer,'Keep this draft');
  await click('#review-close');
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
  // Multiple failed moves of the same task restore the last server-confirmed state.
  await clean();
  const repeated = await create({title:'Repeated move',section:'backlog'});
  await reload(); await click('[data-section="all"]');
  await evaluate(`document.querySelector('.task').focus()`);
  await cdp('Network.setBlockedURLs',{urls:[base + '/api/tasks/*']});
  await press('1','Digit1'); await press('4','Digit4');
  await wait(`document.querySelector('#connection').classList.contains('offline') && document.querySelector('#review-count').textContent === '1'`);
  await cdp('Network.setBlockedURLs',{urls:[]});
  await click('#review-start');
  await wait(`document.querySelector('#review-title').textContent === 'Repeated move'`);
  assert.equal((await tasks()).find(task=>task.id===repeated.id).section,'backlog');
  await click('#review-close');
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
    await click('#preferences > summary');
    await click(`.appearance [data-theme="${theme}"]`);
    await screenshot('glass-' + theme);
  }
  // High-contrast and reduced-transparency settings have opaque fallbacks.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sidebar')).backdropFilter`), 'none');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await click('#preferences > summary');
  await click('.appearance [data-theme="frost"]');
  await click('#review-start'); await screenshot('glass-review','#review-dialog'); await click('#review-close');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  // The phone has its own reachable navigation, not an overflowing desktop strip.
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sidebar')).display`),'none');
  assert.ok(await evaluate(`document.querySelector('.mobile-dock').getBoundingClientRect().height >= 44`));
  await click('#mobile-lists');
  await wait(`document.querySelector('#lists-dialog').open`);
  assert.equal(await evaluate(`document.querySelectorAll('#mobile-sections [data-section]').length`),8);
  await click('#mobile-sections [data-section="backlog"]');
  assert.equal(await evaluate(`document.querySelector('#view-title').textContent`),'Backlog');
  assert.equal(await evaluate(`document.querySelector('#lists-dialog').open`),false);
  await click('#mobile-today');
  await click('#search-toggle');
  await input('#search','no matching title');
  assert.equal(await evaluate(`document.querySelectorAll('.task').length`),0);
  await press('Escape');
  assert.equal(await evaluate(`document.querySelector('#search-toggle').getAttribute('aria-expanded')`),'false');
  await click('#mobile-add');
  await wait(`document.querySelector('#task-dialog').open`);
  assert.ok(await evaluate(`document.querySelector('#task-dialog').getBoundingClientRect().bottom <= innerHeight`));
  await input('#task-title','Mobile capture @Acme');
  await wait(`!document.querySelector('#suggestions').hidden`);
  await press('Enter');
  await click('#save-task');
  await wait(`!document.querySelector('#task-dialog').open`);
  assert.ok((await tasks()).some(task=>task.title==='Mobile capture'));
  const mobileTask = (await tasks()).find(task=>task.title==='Mobile capture');
  await fetch(base+'/api/tasks/'+mobileTask.id,{method:'DELETE'});
  await reload();
  // The row action opens all six schedule choices, with Undo restoring the exact old date.
  const mobileBefore=(await tasks()).find(task=>task.title==='Send revised proposal');
  await evaluate(`document.querySelector('[data-task-id="${mobileBefore.id}"] .schedule-trigger').click()`);
  assert.equal(await evaluate(`document.querySelector('#schedule-dialog').open`),true);
  assert.equal(await evaluate(`document.querySelectorAll('#schedule-options button').length`),6);
  await click('#schedule-options [data-move="tomorrow"]');
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  assert.equal((await tasks()).find(task=>task.id===mobileBefore.id).dueDate,dueFor('tomorrow'));
  await click('#toast .toast-action');
  await wait(`document.querySelector('#connection').classList.contains('online')`);
  assert.equal((await tasks()).find(task=>task.id===mobileBefore.id).dueDate,mobileBefore.dueDate);
  // Native touch gestures must open scheduling without also opening the editor.
  async function touchGesture(dx,dy,hold=0){
    const point=await evaluate(`{const r=document.querySelector('.task .task-main').getBoundingClientRect();({x:r.left+r.width*.65,y:r.top+r.height/2})}`);
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
    if(hold)await new Promise(resolve=>setTimeout(resolve,hold));
    if(dx||dy)await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+dx,y:point.y+dy}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await touchGesture(-90,1);
  await wait(`document.querySelector('#schedule-dialog').open`);
  assert.equal(await evaluate(`document.querySelector('#task-dialog').open`),false);
  await screenshot('sf-mobile-schedule'); await click('#schedule-close');
  await touchGesture(0,-70);
  assert.equal(await evaluate(`document.querySelector('#schedule-dialog').open`),false);
  await evaluate(`window.scrollTo(0,0)`);
  await touchGesture(0,0,550);
  await wait(`document.querySelector('#schedule-dialog').open`);
  assert.equal(await evaluate(`document.querySelector('#task-dialog').open`),false);
  await click('#schedule-close');
  // A priority alone must not create a second text line or inflate the row.
  await evaluate(`document.querySelector('#group-by').value='customer';document.querySelector('#group-by').dispatchEvent(new Event('change'))`);
  const rowGeometry = await evaluate(`{const mark=document.querySelector('.task .priority-mark');const row=mark.closest('.task');const title=row.querySelector('.task-title').getBoundingClientRect();const flag=mark.getBoundingClientRect();({height:row.getBoundingClientRect().height,delta:Math.abs((title.top+title.bottom)/2-(flag.top+flag.bottom)/2)})}`);
  assert.ok(rowGeometry.height <= 57,JSON.stringify(rowGeometry));
  assert.ok(rowGeometry.delta < 5,JSON.stringify(rowGeometry));
  const touchGeometry = await evaluate(`['.checkbox-hit','.schedule-trigger','#mobile-add','#mobile-lists','#mobile-review','#search-toggle','#group-by'].map(selector=>({selector,height:document.querySelector(selector).getBoundingClientRect().height,width:document.querySelector(selector).getBoundingClientRect().width}))`);
  for (const target of touchGeometry) assert.ok(target.height >= 44 && target.width >= 44,JSON.stringify(target));
  await screenshot('glass-iphone');
  await click('#mobile-review');
  assert.equal(await evaluate(`document.querySelector('#review-dialog').scrollWidth <= document.querySelector('#review-dialog').clientWidth`), true);
  await screenshot('glass-iphone-review');
  await click('#review-close');
  await click('#mobile-lists'); await screenshot('frost-mobile-lists'); await click('#lists-close');
  // Verify bottom content stays reachable above the floating dock when scrolled.
  await evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`);
  assert.ok(await evaluate(`document.querySelector('.task:last-child').getBoundingClientRect().bottom < document.querySelector('.mobile-dock').getBoundingClientRect().top`));
  await evaluate(`window.scrollTo(0,0)`);
  for (const width of [320,768,1024]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<700});
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Horizontal overflow at '+width);
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const longTask = await create({title:'Review the full scope and timeline for the upcoming customer experience redesign before sharing the final proposal',customer:'A very long customer organization name',priority:'high',section:'today',dueDate:dueFor('today')});
  await reload();
  await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:600,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Long-title overflow');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.documentElement.style.fontSize='200%'`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Text zoom overflow');
  await evaluate(`document.documentElement.style.fontSize=''`);
  // Exercise the browser's cloud session behavior without a real Access account.
  let cloudExpired = false;
  const cloudFetch = async event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let body;
    if (path === '/api/session') body = { authenticated: true, passwordRequired: false, authProvider: 'cloudflare-access', email: 'owner@example.com' };
    if (path === '/api/logout') body = { ok: true, logoutUrl: '/cdn-cgi/access/logout' };
    try {
      if (path === '/api/tasks' && cloudExpired) {
        await cdp('Fetch.fulfillRequest', { requestId, responseCode: 302, responseHeaders: [{name:'Location',value:'/cdn-cgi/access/login'}], body: '' });
      } else if (body) {
        await cdp('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{name:'Content-Type',value:'application/json'}], body: Buffer.from(JSON.stringify(body)).toString('base64') });
      } else await cdp('Fetch.continueRequest', { requestId });
    } catch (cause) { errors.push(cause.message); }
  };
  ws.addEventListener('message', cloudFetch);
  await cdp('Fetch.enable', { patterns: [{urlPattern: base + '/api/*'}] });
  await reload();
  assert.equal(await evaluate(`document.querySelector('#logout').hidden`), false, 'Cloud sign-out is available');
  cloudExpired = true;
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await wait(`!document.querySelector('#login-view').hidden && !document.querySelector('#access-login').hidden`);
  assert.equal(await evaluate(`document.querySelector('#login-form').hidden`), true, 'Access expiry does not ask for a local passphrase');
  assert.equal(await evaluate(`document.querySelector('#task-list').children.length`), 0, 'Expired session clears the visible task list');
  cloudExpired = false;
  await click('#access-login');
  await wait(`document.querySelector('#app-view')?.hidden === false && document.querySelector('#connection')?.classList.contains('online')`);
  await click('#logout');
  await wait(`location.pathname === '/cdn-cgi/access/logout'`);
  await cdp('Fetch.disable');
  ws.removeEventListener('message', cloudFetch);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: @/!/# menus, 1–4 moves, editable review, queued undo/reassign, failed-save retries, mobile menus/swipe/long-press, fixed-date edits, typography, themes, accessibility, responsive layouts, and Cloudflare session expiry/sign-out.');
} catch (cause) { console.log('UI state', await evaluate(`JSON.stringify({errors:document.querySelector('#notice').textContent,view:document.querySelector('#view-title').textContent,title:document.querySelector('#quick-title').value,menu:document.querySelector('#suggestions').hidden,tokens:document.querySelector('#quick-tokens').textContent,list:document.querySelector('#task-list').textContent})`)); console.log('Runtime errors',errors); console.log('Network errors',networkErrors); console.log('Navigations',navigations); console.log('Tasks',await tasks()); throw cause; } finally { ws.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => { if (chrome.exitCode !== null || chrome.signalCode) resolve(); else chrome.once('exit',resolve); }); await rm(directory,{recursive:true,force:true,maxRetries:10}); }
