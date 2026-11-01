#!/usr/bin/env node
// Specialty registry and namespaced storage checks (issue #48), run against the built index.html.
// Usage: node scripts/test-specialty.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const input = process.argv[2] || path.join(ROOT, 'index.html');
const html = fs.readFileSync(input, 'utf8');
const bootMatch = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/);
assert(bootMatch, 'index.html must inline the registry as <script id="specialty-boot">');
const bootSource = bootMatch[1];
assert.equal(bootSource.trim(), fs.readFileSync(path.join(ROOT, 'scripts/specialty-registry.js'), 'utf8').trim(), 'inlined registry matches scripts/specialty-registry.js');
assert(html.indexOf('<script id="specialty-boot">') < html.indexOf('<script>'), 'registry runs before the app');
const jsonBlocks = Object.fromEntries([...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map(m => [m[1], m[2]]));
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(source), 'The test hook must match the app bootstrap.');
const hooked = source.replace(end, 'globalThis.__qa={D,S,SPEC,get entries(){return entries;},put,syncState,cloudConfig,progressPayload,mergeProgress,exportProgress,render};render();})();');

const OPH = {
  id: 'oph', label: '眼科', appTitle: '眼科甄選練習室', storePrefix: 'oph-prep:', stateKey: 'oph-prep:progress-v3', syncFile: 'progress.json',
  formats: ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3'],
  exportFormat: 'ophthalmology-prep-progress-v3', defaultRepo: 'ophthalmology-progress', exportName: 'Ophthalmology_Progress_',
  dataId: 'course-data', contentBase: 'content/', query: '',
};
const OTHERS = {ent: '耳鼻喉科', rad: '放射診斷科', radonc: '放射腫瘤科', nm: '核子醫學科'};

class MemoryStorage {
  constructor() { this.map = new Map(); this.written = new Set(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.written.add(k); this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// A minimal GitHub contents API that records every file path it is asked for.
function fakeGitHub() {
  const repos = new Map(), calls = [];
  let shaCounter = 0;
  const response = (status, body) => ({ok: status >= 200 && status < 300, status, headers: {get: () => null}, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body))});
  async function fetch(url, opts = {}) {
    const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(?:\/contents\/([^/?]+))?$/);
    assert(m, 'Unexpected request ' + url);
    const repo = repos.get(m[1] + '/' + m[2]);
    calls.push({method: opts.method, url, file: m[3] || null});
    if (!repo) return response(404, {message: 'Not Found'});
    if (opts.headers?.Authorization !== 'Bearer ' + repo.token) return response(401, {message: 'Bad credentials'});
    if (!m[3]) return response(200, {full_name: m[1] + '/' + m[2], private: true});
    const file = repo.files.get(m[3]);
    if (opts.method === 'GET') return file ? response(200, {sha: file.sha, encoding: 'base64', content: Buffer.from(file.text).toString('base64')}) : response(404, {message: 'Not Found'});
    const body = JSON.parse(opts.body);
    if (file && body.sha !== file.sha) return response(409, {message: 'sha does not match'});
    repo.files.set(m[3], {sha: 'sha' + (++shaCounter), text: Buffer.from(body.content, 'base64').toString('utf8')});
    return response(201, {content: {sha: 'sha' + shaCounter}});
  }
  return {repos, calls, fetch, add(key, token) { repos.set(key, {token, files: new Map()}); }};
}

function runRegistry(search) {
  const window = {location: {search}};
  const context = vm.createContext({window, URLSearchParams, Object});
  vm.runInContext(bootSource, context);
  return window;
}

// Boot one browser tab. withBoot=false reproduces the existing test harnesses, which only run the bare app script.
function boot({search = '', withBoot = true, local = new MemoryStorage(), session = new MemoryStorage(), github = fakeGitHub()} = {}) {
  const elements = new Map(), handlers = new Map(), toasts = [], timers = [], blobs = [], clipboard = [];
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
    activeElement: null, visibilityState: 'visible', title: '',
    getElementById(id) { return id in jsonBlocks ? {textContent: jsonBlocks[id]} : element('#' + id); },
    querySelector: element, querySelectorAll: () => [], createElement: () => element('anchor'),
    addEventListener(name, fn) { handlers.set(name, fn); },
  };
  class MockURL extends URL {}
  MockURL.createObjectURL = b => { blobs.push(b); return 'blob:qa'; };
  MockURL.revokeObjectURL = () => {};
  const windowHandlers = new Map();
  const href = 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + search;
  const context = {
    document,
    window: {
      localStorage: local, sessionStorage: session, confirm: () => true, scrollTo() {},
      addEventListener(name, fn) { windowHandlers.set(name, fn); },
      location: {hash: '', href, origin: 'https://qwwaawwqq.github.io', pathname: '/ophthalmology-interview-public/', search, hostname: 'qwwaawwqq.github.io'},
      history: {replaceState(_s, _t, url) { const i = String(url).indexOf('#'); context.window.location.hash = i < 0 ? '' : String(url).slice(i); }},
    },
    navigator: {userAgent: 'Mozilla/5.0 (iPhone)', clipboard: {writeText: async text => { clipboard.push(text); }}},
    fetch: github.fetch, Blob, URL: MockURL, URLSearchParams, Intl, Date, Set, Map, Object, Array, String, Number, JSON, Math, Error, SyntaxError, TypeError, Promise,
    TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    setInterval() {}, setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
  };
  context.globalThis = context;
  vm.createContext(context);
  if (withBoot) vm.runInContext(bootSource, context);
  vm.runInContext(hooked, context, {timeout: 10000});
  return {
    qa: context.__qa, local, session, github, blobs, clipboard, toasts, windowHandlers, anchor: element('anchor'),
    main: () => element('#main').innerHTML,
    action(name, value = '') { handlers.get('click')({target: {closest: () => ({dataset: {action: name, value}, disabled: false, setAttribute() {}})}}); },
    type(id, value) { handlers.get('input')({target: {id, value, classList: {contains: () => false}, dataset: {}}}); },
    async runTimers() { for (let round = 0; round < 5; round++) { const due = timers.filter(t => t.fn); for (const t of due) { const fn = t.fn; t.fn = null; await fn(); } } },
    async settle() { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); },
  };
}

const keysOf = s => [...new Set([...s.map.keys(), ...s.written])];
const plain = v => JSON.parse(JSON.stringify(v));
const results = [];
async function test(name, run) {
  try { await run(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, message: error.stack}); }
}

async function practise(app) {
  app.windowHandlers.get('load')?.();
  const q = app.qa.D.questions[0];
  app.action('practice-one', q.id);
  app.qa.put('q:' + q.id, {choice: q.correctIndex, correct: true});
  app.action('tab', 'sync'); app.type('sync-owner', 'me'); app.type('sync-repo', 'ophthalmology-progress'); app.type('sync-token', 'github_pat_SPECIALTYTOKEN1234567890');
  app.action('sync-connect'); await app.settle(); await app.runTimers(); await app.settle();
  app.windowHandlers.get('pagehide')?.();
  return q;
}

(async () => {
  await test('the registry defaults to oph; only known ?s= values switch specialty', async () => {
    for (const [search, id] of [['', 'oph'], ['?s=oph', 'oph'], ['?s=nm', 'nm'], ['?s=ent', 'ent'], ['?s=rad', 'rad'], ['?s=radonc', 'radonc'], ['?s=NM', 'oph'], ['?s=xyz', 'oph'], ['?s=__proto__', 'oph'], ['?s=constructor', 'oph'], ['?s=toString', 'oph'], ['?x=1&s=nm', 'nm']]) {
      assert.equal(runRegistry(search).OphSpecialty.id, id, search);
    }
    const w = runRegistry('');
    assert.deepEqual(Object.keys(w.OphSpecialties).sort(), ['ent', 'nm', 'oph', 'rad', 'radonc']);
    assert(Object.isFrozen(w.OphSpecialty) && Object.isFrozen(w.OphSpecialty.formats), 'registry entries are frozen');
  });

  await test('oph keys, sync file, formats, default repo and export name are byte-identical to the original literals', async () => {
    assert.deepEqual(plain(runRegistry('').OphSpecialties.oph), OPH);
    const fallback = source.match(/const SPEC=window\.OphSpecialty\|\|(\{[^;]*\});/);
    assert(fallback, 'the app keeps an oph fallback for harnesses without the registry');
    assert.deepEqual(plain(vm.runInNewContext('(' + fallback[1] + ')')), OPH, 'fallback equals the registry oph entry');
  });

  await test('every other specialty has its own prefix, sync file and formats', async () => {
    const reg = runRegistry('').OphSpecialties;
    const seen = new Set(OPH.formats);
    for (const [id, label] of Object.entries(OTHERS)) {
      const s = plain(reg[id]);
      assert.equal(s.label, label);
      assert.equal(s.storePrefix, id + '-prep:');
      assert(s.stateKey.startsWith(s.storePrefix));
      assert.equal(s.syncFile, 'progress-' + id + '.json');
      assert.deepEqual(s.formats, [id + '-prep-progress-v1']);
      assert.equal(s.exportFormat, s.formats[0]);
      assert.equal(s.dataId, 'course-data-' + id);
      assert.equal(s.contentBase, 'content/' + id + '/');
      assert.equal(s.query, '?s=' + id);
      for (const f of s.formats) { assert(!seen.has(f), 'format reused: ' + f); seen.add(f); }
    }
  });

  for (const withBoot of [false, true]) {
    await test(`oph writes only the original keys and progress.json (${withBoot ? 'with' : 'without'} the registry script)`, async () => {
      const app = boot({withBoot}), github = app.github;
      github.add('me/ophthalmology-progress', 'github_pat_SPECIALTYTOKEN1234567890');
      assert.equal(app.qa.SPEC.id, 'oph');
      await practise(app);
      const keys = [...keysOf(app.local), ...keysOf(app.session)];
      assert(keys.includes('oph-prep:progress-v3') && keys.includes('oph-prep:cloud') && keys.includes('oph-prep:cloud-token') && keys.includes('oph-prep:workspace-v1'), keys.join(','));
      assert(keys.every(k => k.startsWith('oph-prep:')), keys.join(','));
      const files = github.calls.map(c => c.file).filter(Boolean);
      assert(files.length && files.every(f => f === 'progress.json'), files.join(','));
      assert.equal(JSON.parse(github.repos.get('me/ophthalmology-progress').files.get('progress.json').text).format, 'ophthalmology-prep-progress-v3');
      app.qa.exportProgress();
      assert.match(app.anchor.download, /^Ophthalmology_Progress_\d{4}-\d{2}-\d{2}\.json$/);
      assert.equal(JSON.parse(await app.blobs.at(-1).text()).format, 'ophthalmology-prep-progress-v3');
      app.action('sync-copy-link'); await app.settle();
      assert.equal(app.clipboard.at(-1), 'https://qwwaawwqq.github.io/ophthalmology-interview-public/#sync-join=me/ophthalmology-progress/github_pat_SPECIALTYTOKEN1234567890');
    });
  }

  await test('?s=nm writes only nm-prep:* keys and progress-nm.json, and its links keep ?s=nm', async () => {
    const local = new MemoryStorage();
    local.setItem('oph-prep:cloud', JSON.stringify({owner: 'someone', repo: 'oph-only'}));
    local.written.clear();
    const app = boot({search: '?s=nm', local}), github = app.github;
    github.add('me/ophthalmology-progress', 'github_pat_SPECIALTYTOKEN1234567890');
    assert.equal(app.qa.SPEC.id, 'nm');
    assert.notEqual(app.qa.S.syncDraft.repo, 'oph-only', 'oph cloud settings are not read in nm');
    await practise(app);
    const keys = [...local.written, ...keysOf(app.session)];
    assert(keys.includes('nm-prep:progress-v1') && keys.includes('nm-prep:cloud') && keys.includes('nm-prep:cloud-token') && keys.includes('nm-prep:workspace-v1'), keys.join(','));
    assert(keys.every(k => k.startsWith('nm-prep:')), keys.join(','));
    assert.equal(local.getItem('oph-prep:progress-v3'), null);
    const files = github.calls.map(c => c.file).filter(Boolean);
    assert(files.length && files.every(f => f === 'progress-nm.json'), files.join(','));
    assert.equal(JSON.parse(github.repos.get('me/ophthalmology-progress').files.get('progress-nm.json').text).format, 'nm-prep-progress-v1');
    app.qa.exportProgress();
    assert.match(app.anchor.download, /^NuclearMedicine_Progress_\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(JSON.parse(await app.blobs.at(-1).text()).format, 'nm-prep-progress-v1');
    app.action('sync-copy-link'); await app.settle();
    assert.equal(app.clipboard.at(-1), 'https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=nm#sync-join=me/ophthalmology-progress/github_pat_SPECIALTYTOKEN1234567890');
    const again = boot({search: '?s=nm', local, github});
    assert(Object.keys(again.qa.entries).length > 0, 'nm progress restores after a reload');
    const oph = boot({local, github});
    assert.equal(Object.keys(oph.qa.entries).length, 0, 'oph does not see nm progress');
  });

  await test('importing one specialty\u2019s file into another is rejected; oph v1/v2/v3 still import', async () => {
    const oph = boot(), nm = boot({search: '?s=nm'}), ent = boot({search: '?s=ent'});
    const q = oph.qa.D.questions[0], at = '2026-10-01T00:00:00.000Z';
    const file = format => ({format, exportedAt: at, entries: {['q:' + q.id]: {choice: q.correctIndex, at}}, meta: {}});
    for (const v of ['v1', 'v2', 'v3']) assert.equal(oph.qa.mergeProgress(file('ophthalmology-prep-progress-' + v)).count, 1, v);
    for (const format of ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3', 'ent-prep-progress-v1']) assert.throws(() => nm.qa.mergeProgress(file(format)), /進度 JSON/, format);
    assert.throws(() => oph.qa.mergeProgress(file('nm-prep-progress-v1')), /進度 JSON/);
    assert.throws(() => ent.qa.mergeProgress(file('nm-prep-progress-v1')), /進度 JSON/);
    assert.equal(nm.qa.mergeProgress(file('nm-prep-progress-v1')).count, 1);
  });

  await test('a remote progress file of another specialty is not merged', async () => {
    const github = fakeGitHub();
    github.add('me/ophthalmology-progress', 'github_pat_SPECIALTYTOKEN1234567890');
    const oph = boot({github});
    await practise(oph);
    const repo = github.repos.get('me/ophthalmology-progress');
    repo.files.set('progress-nm.json', {sha: 'x1', text: repo.files.get('progress.json').text});
    const nm = boot({search: '?s=nm', github});
    await practise(nm);
    assert.notEqual(nm.qa.syncState.error, '', 'an oph-format file in progress-nm.json is refused');
    assert.equal(JSON.parse(repo.files.get('progress-nm.json').text).format, 'ophthalmology-prep-progress-v3', 'the foreign file is left untouched');
  });

  await test('cram-review.js stores under the active specialty prefix', async () => {
    const line = fs.readFileSync(path.join(ROOT, 'scripts/cram-review.js'), 'utf8').match(/const KEY = ([^;]+);/)[1];
    assert.equal(vm.runInNewContext(line, {window: {}}), 'oph-prep:cram-review-v1');
    assert.equal(vm.runInNewContext(line, {window: runRegistry('')}), 'oph-prep:cram-review-v1');
    assert.equal(vm.runInNewContext(line, {window: runRegistry('?s=nm')}), 'nm-prep:cram-review-v1');
  });

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({input, results}, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
