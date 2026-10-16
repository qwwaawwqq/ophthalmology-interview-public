#!/usr/bin/env node
// Autosave and GitHub sync checks with a simulated browser storage and a simulated GitHub contents API.
// Usage: node scripts/test-progress-sync.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const input = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(input, 'utf8');
const payload = html.match(/<script type="application\/json" id="course-data">([\s\S]*?)<\/script>/)[1];
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(source), 'The test hook must match the app bootstrap.');
const hooked = source.replace(end, 'globalThis.__qa={D,S,get entries(){return entries;},get meta(){return meta;},get dirty(){return dirty;},put,syncNow,syncState,cloudConfig,progressPayload,mergeProgress,exportProgress,render};render();})();');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// A minimal GitHub: repos by "owner/repo", each with an optional progress.json and a sha that changes on every write.
function fakeGitHub() {
  const repos = new Map();
  const calls = [];
  let shaCounter = 0;
  const response = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: {get: k => headers[k.toLowerCase()] ?? null},
    json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  async function fetch(url, opts = {}) {
    const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(\/contents\/progress\.json)?$/);
    assert(m, 'Unexpected request ' + url);
    const key = decodeURIComponent(m[1]) + '/' + decodeURIComponent(m[2]);
    const auth = opts.headers?.Authorization;
    calls.push({method: opts.method, url, auth});
    const repo = repos.get(key);
    if (!repo) return response(404, {message: 'Not Found'});
    if (auth !== 'Bearer ' + repo.token) return response(401, {message: 'Bad credentials'});
    if (!m[3]) return response(200, {full_name: key, private: repo.private});
    if (opts.method === 'GET') {
      if (!repo.file) return response(404, {message: 'Not Found'});
      return response(200, {sha: repo.file.sha, encoding: 'base64', content: Buffer.from(repo.file.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n')});
    }
    if (opts.method === 'PUT') {
      if (api.onPut) { const hook = api.onPut; api.onPut = null; hook(repo); }
      if (repo.readOnly) return response(403, {message: 'Resource not accessible by personal access token'});
      const body = JSON.parse(opts.body);
      if (repo.file && body.sha !== repo.file.sha) return response(409, {message: 'sha does not match'});
      if (!repo.file && body.sha) return response(409, {message: 'unexpected sha'});
      repo.file = {sha: 'sha' + (++shaCounter), text: Buffer.from(body.content, 'base64').toString('utf8')};
      repo.commits.push(body.message);
      return response(repo.file.sha === 'sha1' ? 201 : 200, {content: {sha: repo.file.sha}});
    }
    throw new Error('Unsupported method ' + opts.method);
  }
  const api = {repos, calls, fetch, onPut: null, add(key, token, opts = {}) { repos.set(key, {token, private: true, file: null, commits: [], ...opts}); }};
  return api;
}

// Boot one "browser tab" of the app with its own storage, sharing the same fake GitHub.
function boot({local, session, github, hash = ''}) {
  const elements = new Map();
  const handlers = new Map();
  const toasts = [];
  const timers = [];
  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set();
      const node = {
        textContent: '', innerHTML: '', value: '', hidden: false, style: {setProperty() {}},
        classList: {add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); }, toggle(v, f) { const n = f === undefined ? !classes.has(v) : f; n ? classes.add(v) : classes.delete(v); return n; }},
        setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollIntoView() {}, click() {},
        addEventListener(name, fn) { handlers.set(key + ':' + name, fn); },
      };
      if (key === '#toast') Object.defineProperty(node, 'textContent', {get() { return toasts.at(-1) || ''; }, set(v) { toasts.push(v); }});
      elements.set(key, node);
    }
    return elements.get(key);
  }
  const document = {
    activeElement: null, visibilityState: 'visible',
    getElementById(id) { return id === 'course-data' ? {textContent: payload} : element('#' + id); },
    querySelector: element, createElement: () => element('anchor'),
    addEventListener(name, fn) { handlers.set(name, fn); },
  };
  const blobs = [];
  class MockURL extends URL {}
  MockURL.createObjectURL = b => { blobs.push(b); return 'blob:qa'; };
  MockURL.revokeObjectURL = () => {};
  const windowHandlers = new Map();
  const context = {
    document,
    window: {
      localStorage: local, sessionStorage: session, confirm: () => true, scrollTo() {},
      addEventListener(name, fn) { windowHandlers.set(name, fn); },
      location: {hash, href: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + hash, origin: 'https://qwwaawwqq.github.io', pathname: '/ophthalmology-interview-public/', search: '', hostname: 'qwwaawwqq.github.io'},
      history: {replaceState(_s, _t, url) { const i = String(url).indexOf('#'); context.window.location.hash = i < 0 ? '' : String(url).slice(i); }},
    },
    navigator: {userAgent: 'Mozilla/5.0 (iPhone)'},
    fetch: github.fetch, Blob, URL: MockURL, Intl, Date, Set, Map, Object, Array, String, Number, JSON, Math, Error, SyntaxError, TypeError, Promise,
    TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    setInterval() {}, setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(hooked, context, {timeout: 10000});
  const qa = context.__qa;
  return {
    qa, toasts, blobs, document, windowHandlers, handlers,
    main: () => element('#main').innerHTML,
    nav: () => element('#nav').innerHTML,
    status: () => element('#save-status').textContent,
    bar: element('.topbar'),
    action(name, value = '') { handlers.get('click')({target: {closest: () => ({dataset: {action: name, value}, disabled: false, setAttribute() {}})}}); },
    type(id, value) { handlers.get('input')({target: {id, value, classList: {contains: () => false}, dataset: {}}}); },
    change(id, props) { handlers.get('change')({target: {id, classList: {contains: () => false}, dataset: {}, ...props}}); },
    async runTimers(filter = () => true) { const due = timers.filter(t => t.fn && filter(t)); for (const t of due) { const fn = t.fn; t.fn = null; await fn(); } },
    async settle() { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); },
  };
}

const results = [];
async function test(name, run) {
  try { await run(); results.push({name, pass: true}); }
  catch (error) { results.push({name, pass: false, message: error.stack}); }
}
const Q = JSON.parse(payload).questions;

(async () => {
  await test('changes are saved automatically and restored after a reload, with no export needed', async () => {
    const local = new MemoryStorage(), session = new MemoryStorage(), github = fakeGitHub();
    const a = boot({local, session, github});
    await a.runTimers();
    assert.equal(a.status(), '已自動保存在此裝置');
    a.qa.put('q:' + Q[0].id, {choice: Q[0].correctIndex, correct: true});
    a.qa.put('interview:intro', {draft: '我的自我介紹草稿', ratings: [true, false, false, false, false], practiced: false});
    assert.equal(a.status(), '正在保存…');
    assert(a.bar.classList.contains('is-dirty'));
    await a.runTimers();
    assert.equal(a.qa.dirty, false, 'saved locally, so leaving the page needs no warning');
    assert.equal(a.status(), '已自動保存在此裝置');
    const b = boot({local, session: new MemoryStorage(), github});
    assert.equal(b.qa.entries['q:' + Q[0].id].correct, true);
    assert.equal(b.qa.entries['interview:intro'].draft, '我的自我介紹草稿');
  });

  await test('a pending save is flushed when the tab is closed before the debounce fires', async () => {
    const local = new MemoryStorage(), github = fakeGitHub();
    const a = boot({local, session: new MemoryStorage(), github});
    a.qa.put('topic:notes-02', {done: true});
    a.windowHandlers.get('pagehide')();
    const b = boot({local, session: new MemoryStorage(), github});
    assert.equal(b.qa.entries['topic:notes-02'].done, true);
  });

  await test('connecting rejects public repos, unknown repos and bad tokens without storing the token', async () => {
    const local = new MemoryStorage(), github = fakeGitHub();
    github.add('me/public-progress', 'tok-1', {private: false});
    const a = boot({local, session: new MemoryStorage(), github, hash: '#tab-sync'});
    a.action('tab', 'sync');
    assert(a.main().includes('建立私人 repo') && a.main().includes('value="qwwaawwqq"'), 'setup steps and owner prefill');
    for (const [owner, repo, token, expected] of [['me', 'public-progress', 'tok-1', '公開'], ['me', 'missing', 'tok-1', '找不到'], ['me', 'public-progress', 'wrong', 'token 無效']]) {
      a.type('sync-owner', owner); a.type('sync-repo', repo); a.type('sync-token', token);
      a.action('sync-connect'); await a.settle();
      assert(a.main().includes(expected), 'expected error containing ' + expected);
      assert.equal(local.getItem('oph-prep:cloud-token'), null);
      assert.equal(a.qa.cloudConfig(), null);
    }
  });

  await test('connecting uploads progress to progress.json in the private repo; the token never enters the export', async () => {
    const local = new MemoryStorage(), github = fakeGitHub();
    github.add('me/ophthalmology-progress', 'tok-1');
    const a = boot({local, session: new MemoryStorage(), github});
    a.qa.put('q:' + Q[1].id, {choice: 0, correct: Q[1].correctIndex === 0});
    a.action('tab', 'sync');
    a.type('sync-owner', 'me'); a.type('sync-repo', 'ophthalmology-progress'); a.type('sync-token', 'tok-1');
    a.action('sync-connect'); await a.settle();
    const repo = github.repos.get('me/ophthalmology-progress');
    assert(repo.file, 'progress.json created');
    const remote = JSON.parse(repo.file.text);
    assert.equal(remote.format, 'ophthalmology-prep-progress-v3');
    assert(remote.entries['q:' + Q[1].id]);
    assert(!repo.file.text.includes('tok-1'), 'token not in synced file');
    assert.match(repo.commits[0], /^同步進度 · iPhone · /);
    assert(a.status().startsWith('已同步到雲端'));
    assert(a.bar.classList.contains('is-synced'));
    assert(a.main().includes('me/ophthalmology-progress'));
    a.qa.exportProgress();
    assert(!(await a.blobs.at(-1).text()).includes('tok-1'), 'token not in exported file');
    assert.equal(local.getItem('oph-prep:cloud-token'), 'tok-1');
  });

  await test('two devices merge their progress through the repo, newest record per item wins', async () => {
    const github = fakeGitHub();
    github.add('me/p', 'tok');
    const connect = async device => { device.action('tab', 'sync'); device.type('sync-owner', 'me'); device.type('sync-repo', 'p'); device.type('sync-token', 'tok'); device.action('sync-connect'); await device.settle(); };
    const phone = boot({local: new MemoryStorage(), session: new MemoryStorage(), github});
    phone.qa.put('q:' + Q[2].id, {choice: Q[2].correctIndex, correct: true});
    phone.qa.put('interview:why-oph', {draft: '手機版草稿', ratings: [false, false, false, false, false], practiced: false});
    await connect(phone);
    const laptop = boot({local: new MemoryStorage(), session: new MemoryStorage(), github});
    laptop.qa.put('q:' + Q[3].id, {choice: Q[3].correctIndex, correct: true});
    await connect(laptop);
    assert(laptop.qa.entries['q:' + Q[2].id], 'laptop received the phone answer');
    assert.equal(laptop.qa.entries['interview:why-oph'].draft, '手機版草稿');
    await new Promise(r => setTimeout(r, 5));
    laptop.qa.put('interview:why-oph', {draft: '電腦上改好的草稿', ratings: [true, true, false, false, false], practiced: true});
    await laptop.runTimers(t => t.ms === 400);
    assert.equal(laptop.qa.syncState.pending, true);
    await laptop.runTimers(t => t.ms === 30000);
    await laptop.settle();
    phone.document.visibilityState = 'visible';
    phone.qa.syncState.lastSync = 0;
    phone.handlers.get('visibilitychange')();
    await phone.settle();
    assert.equal(phone.qa.entries['interview:why-oph'].draft, '電腦上改好的草稿', 'phone pulls the newer draft when it comes back to the foreground');
    assert(phone.qa.entries['q:' + Q[3].id], 'phone received the laptop answer');
    const remote = JSON.parse(github.repos.get('me/p').file.text);
    assert(remote.entries['q:' + Q[2].id] && remote.entries['q:' + Q[3].id]);
  });

  await test('a write conflict from another device is retried after merging, and unchanged progress makes no new commit', async () => {
    const github = fakeGitHub();
    github.add('me/p', 'tok');
    const a = boot({local: new MemoryStorage(), session: new MemoryStorage(), github});
    a.action('tab', 'sync'); a.type('sync-owner', 'me'); a.type('sync-repo', 'p'); a.type('sync-token', 'tok'); a.action('sync-connect'); await a.settle();
    const repo = github.repos.get('me/p');
    const commits = repo.commits.length;
    await a.qa.syncNow('manual');
    assert.equal(repo.commits.length, commits, 'no commit when nothing changed');
    // Another device writes between this device's read and its write: the first PUT is rejected, then merged and retried.
    a.qa.put('topic:notes-05', {done: true});
    github.onPut = r => {
      const other = JSON.parse(r.file.text);
      other.entries['topic:notes-06'] = {done: true, at: new Date(Date.now() + 1000).toISOString()};
      r.file = {sha: 'other-device', text: JSON.stringify(other)};
    };
    const ok = await a.qa.syncNow('manual');
    assert.equal(ok, true);
    const remote = JSON.parse(repo.file.text);
    assert(remote.entries['topic:notes-05'] && remote.entries['topic:notes-06'], 'both devices\' changes kept');
    assert(a.qa.entries['topic:notes-06'], 'merged into this device');
    assert.equal(github.calls.filter(c => c.method === 'PUT').length >= 3, true, 'rejected write was retried');
  });

  await test('expired tokens and offline errors keep progress on the device and show the problem', async () => {
    const github = fakeGitHub();
    github.add('me/p', 'tok');
    const local = new MemoryStorage();
    const a = boot({local, session: new MemoryStorage(), github});
    a.action('tab', 'sync'); a.type('sync-owner', 'me'); a.type('sync-repo', 'p'); a.type('sync-token', 'tok'); a.action('sync-connect'); await a.settle();
    github.repos.get('me/p').token = 'rotated';
    a.qa.put('topic:notes-07', {done: true});
    await a.runTimers(t => t.ms === 400);
    a.action('sync-now'); await a.settle();
    assert.equal(a.status(), '雲端同步暫停 · 已保存在此裝置');
    assert(a.bar.classList.contains('is-sync-error'));
    assert(a.main().includes('token 無效或已過期'));
    assert.equal(JSON.parse(local.getItem('oph-prep:progress-v3')).entries['topic:notes-07'].done, true);
    github.repos.get('me/p').token = 'tok';
    github.repos.get('me/p').readOnly = true;
    a.action('sync-now'); await a.settle();
    assert(a.main().includes('Contents 設為 Read and write'));
  });

  await test('not remembering the token keeps it only for this tab; disconnect and clear remove device data', async () => {
    const github = fakeGitHub();
    github.add('me/p', 'tok');
    const local = new MemoryStorage(), session = new MemoryStorage();
    const a = boot({local, session, github});
    a.action('tab', 'sync'); a.type('sync-owner', 'me'); a.type('sync-repo', 'p'); a.type('sync-token', 'tok');
    a.change('sync-remember', {checked: false});
    a.action('sync-connect'); await a.settle();
    assert.equal(local.getItem('oph-prep:cloud-token'), null);
    assert.equal(session.getItem('oph-prep:cloud-token'), 'tok');
    const nextTab = boot({local, session: new MemoryStorage(), github});
    assert.equal(nextTab.qa.cloudConfig(), null, 'a new tab needs the token again');
    a.action('sync-disconnect');
    assert.equal(session.getItem('oph-prep:cloud-token'), null);
    assert.equal(a.qa.cloudConfig(), null);
    assert(github.repos.get('me/p').file, 'cloud data untouched');
    a.qa.put('topic:notes-08', {done: true});
    await a.runTimers(t => t.ms === 400);
    a.action('sync-clear');
    assert.equal(local.getItem('oph-prep:progress-v3'), null);
    assert.equal(Object.keys(a.qa.entries).length, 0);
  });

  await test('turning autosave off removes the device copy and warns before leaving', async () => {
    const local = new MemoryStorage();
    const a = boot({local, session: new MemoryStorage(), github: fakeGitHub()});
    a.qa.put('topic:notes-09', {done: true});
    await a.runTimers();
    a.action('tab', 'sync');
    a.change('sync-autosave', {checked: false});
    assert.equal(local.getItem('oph-prep:progress-v3'), null);
    assert.equal(a.qa.dirty, true);
    assert(a.status().includes('未自動保存'));
    const b = boot({local, session: new MemoryStorage(), github: fakeGitHub()});
    assert.equal(b.qa.entries['topic:notes-09'], undefined);
  });

  await test('without browser storage the app still runs and asks for export', async () => {
    const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {}};
    const a = boot({local: broken, session: broken, github: fakeGitHub()});
    await a.runTimers();
    assert.equal(a.status(), '此瀏覽器無法自動保存 · 離開前請匯出');
    a.qa.put('topic:notes-10', {done: true});
    await a.runTimers();
    assert.equal(a.qa.dirty, true);
    a.action('tab', 'sync');
    assert(a.main().includes('不允許網站保存資料'));
  });

  await test('the sync page is reachable from the nav, the top-bar status and a deep link', async () => {
    const a = boot({local: new MemoryStorage(), session: new MemoryStorage(), github: fakeGitHub(), hash: '#tab-sync'});
    a.windowHandlers.get('load')();
    assert.equal(a.qa.S.tab, 'sync');
    assert(a.main().includes('保存與同步') && a.main().includes('手動備份'));
    assert(a.nav().includes('data-value="sync"') && a.nav().includes('保存與同步'));
    assert(/<button class="status-link" data-action="tab" data-value="sync"/.test(html));
    assert(!/離開前請(記得)?匯出。/.test(html), 'old export reminders replaced');
  });

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({input, results}, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
