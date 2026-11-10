#!/usr/bin/env node
// Specialty registry, namespaced storage, picker/pending UI, and per-specialty build pipeline checks (issues #48, #49, #50, #73, #78).
// Usage: node scripts/test-specialty.cjs [index.html]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const input = process.argv[2] || path.join(ROOT, 'index.html');
const html = fs.readFileSync(input, 'utf8');
const bootMatch = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/);
assert(bootMatch, 'index.html must inline the registry as <script id="specialty-boot">');
const bootSource = bootMatch[1];
assert.equal(bootSource.trim(), fs.readFileSync(path.join(ROOT, 'scripts/specialty-registry.js'), 'utf8').trim(), 'inlined registry matches scripts/specialty-registry.js');
assert(html.indexOf('<script id="specialty-boot">') < html.indexOf('<script>'), 'registry runs before the app');
const blockMatches = [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)];
const jsonBlocks = Object.fromEntries(blockMatches.map(m => [m[1], m[2]]));
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(source), 'The test hook must match the app bootstrap.');
const hooked = source.replace(end, 'globalThis.__qa={D,S,SPEC,get entries(){return entries;},get meta(){return meta;},put,syncState,cloudConfig,progressPayload,mergeProgress,exportProgress,render,navs,switchTab,openRoute,parseRoute,routeMatchesView,startQuiz,normalizeLinkUrl,tabAllowed,notebookIndex,coverageFocus,coverageRestoreHash};render();})();');
const bootScript = new vm.Script(bootSource);
const hookedScript = new vm.Script(hooked);

// 2026-11-10 (#202): 8 clinical workflows added (total 24 workflows).
const COURSE_DATA_SHA256 = '5fa910dfa6aa011ddee879127365ace91785fdf102dd186bc4614abbcd11efd2';
const OPH = {
  id: 'oph', label: '眼科', appTitle: '眼科甄選練習室', storePrefix: 'oph-prep:', stateKey: 'oph-prep:progress-v3', syncFile: 'progress.json',
  formats: ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3'],
  exportFormat: 'ophthalmology-prep-progress-v3', defaultRepo: 'ophthalmology-progress', exportName: 'Ophthalmology_Progress_',
  dataId: 'course-data', contentBase: 'content/', query: '',
};
const OTHERS = {
  ent: '耳鼻喉科',
  rad: '放射診斷科',
  nm: '核子醫學科',
  neuro: '神經內科',
};
const EXPORT_NAMES = {
  ent: 'ENT_Progress_',
  rad: 'Radiology_Progress_',
  nm: 'NuclearMedicine_Progress_',
  neuro: 'Neurology_Progress_',
};
// Full 12-tab + 3-workshop-mode DOM sweeps run on every registered non-oph specialty (populated and empty shells).
const FULL_TAB_SPECIALTIES = ['ent', 'rad', 'nm', 'neuro'];
// Specialties without a 甄選面試 that were removed from the registry/picker on 2026-11-02 (old ?s= links fall back to oph).
const REMOVED_SPECIALTIES = ['radonc', 'gs', 'prs', 'ortho', 'uro', 'ns', 'gm', 'cv', 'pulm', 'gi', 'nephro', 'endo', 'hemeonc', 'id', 'rheu', 'ped', 'obgyn', 'derm', 'psych', 'pmr', 'anes', 'fm'];
const OPH_ONLY_TABS = ['textbook', 'advanced', 'schedule', 'project'];
const OPH_LEAK_TERMS = ['BCSC', 'RAPD', '白瞳', '眼科學No.', '急性視力喪失', '糖尿病黃斑水腫', '#pbl-dr', '#wf-chemical', '#notes-02'];

function wellFormed(markup) {
  const stack = [];
  const voids = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
  for (const token of markup.match(/<(?:[^>"']|"[^"]*"|'[^']*')+>/g) || []) {
    if (token.startsWith('<!')) continue;
    const close = token.match(/^<\/\s*([a-z0-9]+)/i);
    if (close) { assert.equal(stack.pop(), close[1].toLowerCase(), 'Mismatched closing tag ' + close[1]); continue; }
    const open = token.match(/^<\s*([a-z0-9]+)/i)[1].toLowerCase();
    if (!voids.has(open) && !token.endsWith('/>')) stack.push(open);
  }
  assert.equal(stack.length, 0, 'Unclosed tags: ' + stack.join(','));
}

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
  bootScript.runInContext(context);
  return window;
}

// Boot one browser tab. withBoot=false reproduces the existing test harnesses, which only run the bare app script.
function boot({search = '', hash = '', withBoot = true, local = new MemoryStorage(), session = new MemoryStorage(), github = fakeGitHub(), blocks = jsonBlocks} = {}) {
  const elements = new Map(), handlers = new Map(), toasts = [], timers = [], blobs = [], clipboard = [];
  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set(), attrs = {};
      const node = {
        textContent: '', innerHTML: '', value: '', hidden: false, style: {setProperty() {}},
        classList: {add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); }, toggle(v, f) { const n = f === undefined ? !classes.has(v) : f; n ? classes.add(v) : classes.delete(v); return n; }},
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k] ?? null; }, focus() {}, scrollIntoView() {}, click() {},
        addEventListener(name, fn) { handlers.set(key + ':' + name, fn); },
      };
      if (key === '#toast') Object.defineProperty(node, 'textContent', {get() { return toasts.at(-1) || ''; }, set(v) { toasts.push(v); }});
      elements.set(key, node);
    }
    return elements.get(key);
  }
  const document = {
    activeElement: null, visibilityState: 'visible', title: '',
    getElementById(id) { return id in blocks ? {textContent: blocks[id]} : element('#' + id); },
    querySelector: element, querySelectorAll: () => [], createElement: () => element('anchor'),
    addEventListener(name, fn) { handlers.set(name, fn); },
  };
  class MockURL extends URL {}
  MockURL.createObjectURL = b => { blobs.push(b); return 'blob:qa'; };
  MockURL.revokeObjectURL = () => {};
  const windowHandlers = new Map();
  const href = 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + search + hash;
  const context = {
    document,
    window: {
      localStorage: local, sessionStorage: session, confirm: () => true, scrollTo() {},
      addEventListener(name, fn) { windowHandlers.set(name, fn); },
      location: {hash, href, origin: 'https://qwwaawwqq.github.io', pathname: '/ophthalmology-interview-public/', search, hostname: 'qwwaawwqq.github.io'},
      history: {
        replaceState(_s, _t, url) {
          const u = new URL(String(url), context.window.location.href);
          Object.assign(context.window.location, {
            href: u.href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, hostname: u.hostname,
          });
        },
      },
    },
    navigator: {userAgent: 'Mozilla/5.0 (iPhone)', clipboard: {writeText: async text => { clipboard.push(text); }}},
    fetch: github.fetch, Blob, URL: MockURL, URLSearchParams, Intl, Date, Set, Map, Object, Array, String, Number, JSON, Math, Error, SyntaxError, TypeError, Promise,
    TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    setInterval() {}, setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
  };
  context.globalThis = context;
  vm.createContext(context);
  if (withBoot) bootScript.runInContext(context);
  hookedScript.runInContext(context, {timeout: 10000});
  return {
    qa: context.__qa, window: context.window, local, session, github, blobs, clipboard, toasts, windowHandlers, anchor: element('anchor'),
    location: context.window.location,
    main: () => element('#main').innerHTML,
    nav: () => element('#nav').innerHTML,
    title: () => document.title,
    brand: () => element('.brand strong').textContent,
    brandSub: () => element('.brand span').textContent,
    footer: () => element('footer span').textContent,
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
  if (q) {
    app.action('practice-one', q.id);
    app.qa.put('q:' + q.id, {choice: q.correctIndex, correct: true});
  } else {
    app.action('tab', 'plan');
    app.qa.put('day:' + app.qa.D.plan[0].date, {done: true});
  }
  app.action('tab', 'sync'); app.type('sync-owner', 'me'); app.type('sync-repo', 'ophthalmology-progress'); app.type('sync-token', 'github_pat_SPECIALTYTOKEN1234567890');
  app.action('sync-connect'); await app.settle(); await app.runTimers(); await app.settle();
  app.windowHandlers.get('pagehide')?.();
  return q;
}

(async () => {
  await test('course-data sha256 is untouched and all 4 non-oph course-data-<s> blocks exist once', async () => {
    const counts = {};
    for (const m of blockMatches) counts[m[1]] = (counts[m[1]] || 0) + 1;
    assert.equal(counts['course-data'], 1);
    const sha = crypto.createHash('sha256').update(jsonBlocks['course-data'], 'utf8').digest('hex');
    assert.equal(sha, COURSE_DATA_SHA256, 'ophthalmology course-data payload must remain byte-identical');
    assert.equal(Object.keys(OTHERS).length, 4);
    assert.equal(Object.keys(EXPORT_NAMES).length, 4);
    assert.deepEqual(Object.keys(OTHERS), ['ent', 'rad', 'nm', 'neuro']);
    assert.deepEqual(Object.keys(counts).filter(k => k.startsWith('course-data-')).sort(), Object.keys(OTHERS).map(id => 'course-data-' + id).sort(), 'no course-data blocks for removed specialties');
    for (const [id, label] of Object.entries(OTHERS)) {
      const blockId = 'course-data-' + id;
      assert.equal(counts[blockId], 1, blockId + ' must appear once');
      const data = JSON.parse(jsonBlocks[blockId]);
      assert.equal(data.title, label + '甄試準備');
      for (const k of ['topics', 'questions', 'interview', 'plan', 'dayBeforeChecklist', 'examDayChecklist', 'storySeeds', 'evidenceSeeds']) {
        assert(Array.isArray(data[k]), `${blockId}.${k} must be an array`);
      }
      assert(data.notes && typeof data.notes === 'object' && data.notebook && typeof data.notebook === 'object');
    }
  });

  await test('the registry defaults to oph; only known ?s= values switch specialty across all 5 specialties', async () => {
    const cases = [
      ['', 'oph'], ['?s=oph', 'oph'], ['?s=xyz', 'oph'], ['?s=__proto__', 'oph'], ['?s=constructor', 'oph'], ['?s=toString', 'oph'],
      ...Object.keys(OTHERS).flatMap(id => [['?s=' + id, id], ['?x=1&s=' + id, id], ['?s=' + id.toUpperCase(), 'oph']]),
    ];
    for (const [search, id] of cases) {
      assert.equal(runRegistry(search).OphSpecialty.id, id, search);
    }
    const w = runRegistry('');
    assert.deepEqual(Object.keys(w.OphSpecialties).sort(), ['oph', ...Object.keys(OTHERS)].sort());
    assert.equal(Object.keys(w.OphSpecialties).length, 5);
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
      assert.equal(s.appTitle, label + '甄選練習室');
      assert.equal(s.storePrefix, id + '-prep:');
      assert(s.stateKey.startsWith(s.storePrefix));
      assert.equal(s.syncFile, 'progress-' + id + '.json');
      assert.deepEqual(s.formats, [id + '-prep-progress-v1']);
      assert.equal(s.exportFormat, s.formats[0]);
      assert.equal(s.exportName, EXPORT_NAMES[id]);
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

  await test('?s=neuro writes only neuro-prep:* keys and progress-neuro.json, and its links keep ?s=neuro', async () => {
    const local = new MemoryStorage();
    local.setItem('oph-prep:cloud', JSON.stringify({owner: 'someone', repo: 'oph-only'}));
    local.setItem('nm-prep:cloud', JSON.stringify({owner: 'someone', repo: 'nm-only'}));
    local.written.clear();
    const app = boot({search: '?s=neuro', local}), github = app.github;
    github.add('me/ophthalmology-progress', 'github_pat_SPECIALTYTOKEN1234567890');
    assert.equal(app.qa.SPEC.id, 'neuro');
    assert.notEqual(app.qa.S.syncDraft.repo, 'oph-only', 'oph cloud settings are not read in neuro');
    assert.notEqual(app.qa.S.syncDraft.repo, 'nm-only', 'nm cloud settings are not read in neuro');
    await practise(app);
    const keys = [...local.written, ...keysOf(app.session)];
    assert(keys.includes('neuro-prep:progress-v1') && keys.includes('neuro-prep:cloud') && keys.includes('neuro-prep:cloud-token') && keys.includes('neuro-prep:workspace-v1'), keys.join(','));
    assert(keys.every(k => k.startsWith('neuro-prep:')), keys.join(','));
    assert.equal(local.getItem('oph-prep:progress-v3'), null);
    assert.equal(local.getItem('nm-prep:progress-v1'), null);
    const files = github.calls.map(c => c.file).filter(Boolean);
    assert(files.length && files.every(f => f === 'progress-neuro.json'), files.join(','));
    assert.equal(JSON.parse(github.repos.get('me/ophthalmology-progress').files.get('progress-neuro.json').text).format, 'neuro-prep-progress-v1');
    app.qa.exportProgress();
    assert.match(app.anchor.download, /^Neurology_Progress_\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(JSON.parse(await app.blobs.at(-1).text()).format, 'neuro-prep-progress-v1');
    app.action('sync-copy-link'); await app.settle();
    assert.equal(app.clipboard.at(-1), 'https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=neuro#sync-join=me/ophthalmology-progress/github_pat_SPECIALTYTOKEN1234567890');
    const again = boot({search: '?s=neuro', local, github});
    assert(Object.keys(again.qa.entries).length > 0, 'neuro progress restores after a reload');
    const oph = boot({local, github});
    assert.equal(Object.keys(oph.qa.entries).length, 0, 'oph does not see neuro progress');
    const nm = boot({search: '?s=nm', local, github});
    assert.equal(Object.keys(nm.qa.entries).length, 0, 'nm does not see neuro progress');
  });

  await test('removed specialties (?s=pmr, ?s=radonc, ...) fall back to the oph view and are absent from the picker', async () => {
    assert.equal(REMOVED_SPECIALTIES.length, 22);
    const reg = runRegistry('').OphSpecialties;
    const picker = boot().nav();
    for (const id of REMOVED_SPECIALTIES) {
      assert(!Object.prototype.hasOwnProperty.call(reg, id), `${id} must not be registered`);
      assert.equal(jsonBlocks['course-data-' + id], undefined, `course-data-${id} must be removed`);
      assert(!picker.includes(`href="./?s=${id}"`), `picker must not link ?s=${id}`);
      assert.equal(runRegistry('?s=' + id).OphSpecialty.id, 'oph', `?s=${id} falls back to oph`);
    }
    for (const id of ['pmr', 'radonc', 'gs', 'obgyn', 'fm']) {
      const app = boot({search: '?s=' + id});
      assert.equal(app.qa.SPEC.id, 'oph', `?s=${id} boots the oph app`);
      assert.equal(app.title(), '眼科甄選練習室 · 公開練習版');
      assert(app.nav().includes('href="./" aria-current="page"'));
      assert(app.qa.D.questions.length > 0, `?s=${id} shows ophthalmology content`);
      for (const tab of ['today', 'quiz', 'interview']) {
        app.action('tab', tab);
        const markup = app.main();
        wellFormed(markup);
        assert(!markup.includes('specialty-pending') && !markup.includes('內容待補'), `?s=${id} ${tab} must not show a 內容待補 placeholder`);
      }
    }
  });

  await test('importing one specialty\u2019s file into another is rejected; oph v1/v2/v3 still import', async () => {
    const oph = boot(), nm = boot({search: '?s=nm'}), ent = boot({search: '?s=ent'}), neuro = boot({search: '?s=neuro'});
    const q = oph.qa.D.questions[0], at = '2026-10-01T00:00:00.000Z';
    const ophFile = format => ({format, exportedAt: at, entries: {['q:' + q.id]: {choice: q.correctIndex, at}}, meta: {}});
    const srsEntry = {version: 1, at, answerCount: 1, attempt: {id: 't1', at, correct: false, rated: true}, plan: {step: -1, dueAt: at, rating: 'again', reviewCount: 1, lapses: 1}};
    const sharedFile = format => ({format, exportedAt: at, entries: {'study:srs:shared:smoke-1': srsEntry}, meta: {}});
    for (const v of ['v1', 'v2', 'v3']) assert.equal(oph.qa.mergeProgress(ophFile('ophthalmology-prep-progress-' + v)).count, 1, v);
    for (const format of ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3', 'ent-prep-progress-v1', 'neuro-prep-progress-v1']) assert.throws(() => nm.qa.mergeProgress(sharedFile(format)), /進度 JSON/, format);
    for (const format of ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3', 'ent-prep-progress-v1', 'nm-prep-progress-v1']) assert.throws(() => neuro.qa.mergeProgress(sharedFile(format)), /進度 JSON/, format);
    assert.throws(() => oph.qa.mergeProgress(sharedFile('nm-prep-progress-v1')), /進度 JSON/);
    assert.throws(() => oph.qa.mergeProgress(sharedFile('neuro-prep-progress-v1')), /進度 JSON/);
    assert.throws(() => ent.qa.mergeProgress(sharedFile('nm-prep-progress-v1')), /進度 JSON/);
    assert.throws(() => ent.qa.mergeProgress(sharedFile('neuro-prep-progress-v1')), /進度 JSON/);
    assert.equal(nm.qa.mergeProgress(sharedFile('nm-prep-progress-v1')).count, 1);
    assert.equal(neuro.qa.mergeProgress(sharedFile('neuro-prep-progress-v1')).count, 1);
  });

  await test('a remote progress file of another specialty is not merged', async () => {
    const github = fakeGitHub();
    github.add('me/ophthalmology-progress', 'github_pat_SPECIALTYTOKEN1234567890');
    const oph = boot({github});
    await practise(oph);
    const repo = github.repos.get('me/ophthalmology-progress');
    repo.files.set('progress-nm.json', {sha: 'x1', text: repo.files.get('progress.json').text});
    repo.files.set('progress-neuro.json', {sha: 'x2', text: repo.files.get('progress.json').text});
    const nm = boot({search: '?s=nm', github});
    await practise(nm);
    assert.notEqual(nm.qa.syncState.error, '', 'an oph-format file in progress-nm.json is refused');
    assert.equal(JSON.parse(repo.files.get('progress-nm.json').text).format, 'ophthalmology-prep-progress-v3', 'the foreign file is left untouched');
    const neuro = boot({search: '?s=neuro', github});
    await practise(neuro);
    assert.notEqual(neuro.qa.syncState.error, '', 'an oph-format file in progress-neuro.json is refused');
    assert.equal(JSON.parse(repo.files.get('progress-neuro.json').text).format, 'ophthalmology-prep-progress-v3', 'the foreign file is left untouched');
  });

  await test('cram-review.js stores under the active specialty prefix across all 5 specialties', async () => {
    const line = fs.readFileSync(path.join(ROOT, 'scripts/cram-review.js'), 'utf8').match(/const KEY = ([^;]+);/)[1];
    assert.equal(vm.runInNewContext(line, {window: {}}), 'oph-prep:cram-review-v1');
    assert.equal(vm.runInNewContext(line, {window: runRegistry('')}), 'oph-prep:cram-review-v1');
    for (const id of Object.keys(OTHERS)) {
      assert.equal(vm.runInNewContext(line, {window: runRegistry('?s=' + id)}), `${id}-prep:cram-review-v1`);
    }
  });

  await test('specialty switcher renders all 5 links in the sidebar with dynamic branding', async () => {
    const expectedHrefs = ['./', ...Object.keys(OTHERS).map(id => './?s=' + id)];
    assert.equal(expectedHrefs.length, 5);
    const oph = boot();
    assert.equal(oph.title(), '眼科甄選練習室 · 公開練習版');
    assert.equal(oph.brand(), '眼科甄選練習室');
    assert(oph.footer().includes('眼科甄選練習室 · 公開練習版'));
    for (const href of expectedHrefs) {
      assert(oph.nav().includes(`href="${href}"`), 'sidebar switcher missing ' + href);
    }
    assert(!oph.main().includes('specialty-picker'), 'the switcher lives in the sidebar, not on the home page');
    assert(oph.nav().includes('href="./" aria-current="page"'));
    assert(oph.nav().includes('<span class="spec-current">眼科</span>'));
    wellFormed(oph.main());
    wellFormed(oph.nav());

    for (const [id, label] of Object.entries(OTHERS)) {
      const app = boot({search: '?s=' + id});
      assert.equal(app.title(), `${label}甄選練習室 · 公開練習版`);
      assert.equal(app.brand(), `${label}甄選練習室`);
      assert(app.footer().includes(`${label}甄選練習室 · 公開練習版`));
      assert(!app.footer().includes('共筆'));
      for (const href of expectedHrefs) {
        assert(app.nav().includes(`href="${href}"`), `${id} sidebar switcher missing ${href}`);
      }
      assert(app.nav().includes(`href="./?s=${id}" aria-current="page"`));
      assert(app.nav().includes(`<span class="spec-current">${label}</span>`));
    }
  });

  await test('every visible tab renders well-formed HTML, empty shells show 內容待補, and zero ophthalmology content leaks', async () => {
    const oph = boot();
    for (const [tab] of oph.qa.navs) {
      oph.action('tab', tab);
      assert.equal(oph.qa.S.tab, tab);
      wellFormed(oph.main());
    }

    for (const id of FULL_TAB_SPECIALTIES) {
      const label = OTHERS[id];
      const app = boot({search: '?s=' + id});
      for (const ophTab of OPH_ONLY_TABS) {
        assert.equal(app.qa.tabAllowed(ophTab), false, `${id} must hide ${ophTab}`);
        assert(!app.nav().includes(`data-value="${ophTab}"`), `${id} nav leaked ${ophTab}`);
      }
      const visibleTabs = plain(app.qa.navs.filter(n => app.qa.tabAllowed(n[0])).map(n => n[0]));
      assert.deepEqual(visibleTabs, ['study', 'cram', 'today', 'notebook', 'quiz', 'learn', 'interview', 'pbl', 'workflow', 'workshop', 'map', 'plan', 'progress', 'links', 'sync']);

      for (const tab of visibleTabs) {
        app.action('tab', tab);
        assert.equal(app.qa.S.tab, tab, `${id} tab ${tab}`);
        const markup = app.main();
        wellFormed(markup);
        assert(!markup.includes('NaN') && !markup.includes('undefined'), `${id} ${tab} rendered NaN/undefined`);
        for (const leak of OPH_LEAK_TERMS) {
          assert(!markup.includes(leak), `${id} ${tab} leaked ophthalmology term "${leak}"`);
        }
        if (['notebook', 'study', 'learn', 'quiz', 'interview', 'pbl', 'workflow', 'progress'].includes(tab) && !app.qa.D.questions.length && !app.qa.D.topics.length) {
          assert(markup.includes('內容待補') && markup.includes('specialty-pending'), `${id} ${tab} should show 內容待補 card`);
        } else if (app.qa.D.questions.length && app.qa.D.topics.length) {
          assert(!markup.includes('內容待補') && !markup.includes('specialty-pending'), `${id} ${tab} must not show 內容待補`);
        }
      }

      app.action('tab', 'workshop');
      assert(app.main().includes(`反思與${label}訓練的連結`), `${id} workshop reflection label`);
      app.action('workshop-mode', 'evidence');
      wellFormed(app.main());
      for (const leak of OPH_LEAK_TERMS) assert(!app.main().includes(leak), `${id} workshop evidence leaked ${leak}`);
      app.action('workshop-mode', 'sources');
      wellFormed(app.main());
      for (const leak of OPH_LEAK_TERMS) assert(!app.main().includes(leak), `${id} workshop sources leaked ${leak}`);
    }

    // Explicitly verify empty-shell 內容待補 rendering on ?s=neuro (remains valid even once content/neuro/ is populated later).
    const emptyNeuro = JSON.parse(jsonBlocks['course-data-neuro']);
    Object.assign(emptyNeuro, {topics: [], questions: [], interview: [], pbl: {...emptyNeuro.pbl, cases: []}, workflows: {...emptyNeuro.workflows, workflows: []}});
    const emptyNeuroApp = boot({search: '?s=neuro', blocks: {...jsonBlocks, 'course-data-neuro': JSON.stringify(emptyNeuro)}});
    for (const tab of ['notebook', 'study', 'learn', 'quiz', 'interview', 'pbl', 'workflow', 'progress']) {
      emptyNeuroApp.action('tab', tab);
      const markup = emptyNeuroApp.main();
      wellFormed(markup);
      assert(markup.includes('內容待補') && markup.includes('specialty-pending'), `empty neuro ${tab} should show 內容待補 card`);
      for (const leak of OPH_LEAK_TERMS) assert(!markup.includes(leak), `empty neuro ${tab} leaked ${leak}`);
    }
  });

  await test('hash navigation and saved links preserve ?s=<specialty> and reject ophthalmology-only routes', async () => {
    for (const sid of ['nm', 'neuro', 'ent', 'rad']) {
      const app = boot({search: '?s=' + sid, hash: '#tab-quiz'});
      app.windowHandlers.get('load')?.();
      assert.equal(app.qa.S.tab, 'quiz');
      assert.equal(app.location.search, '?s=' + sid);
      assert.equal(app.location.hash, '#tab-quiz');

      for (const [hash, expectedTab] of [['#tab-cram', 'cram'], ['#tab-learn', 'learn'], ['#pbl', 'pbl'], ['#workflow', 'workflow'], ['#links', 'links'], ['#tab-interview', 'interview']]) {
        assert.equal(app.qa.openRoute(hash), true, `${sid} ${hash}`);
        assert.equal(app.qa.S.tab, expectedTab);
        assert.equal(app.location.search, '?s=' + sid, `${hash} must keep ?s=${sid}`);
        assert.equal(app.location.hash, hash);
      }

      app.action('tab', 'today');
      assert.equal(app.location.search, '?s=' + sid, `returning to home keeps ?s=${sid}`);
      assert.equal(app.location.hash, '');

      for (const blocked of ['#textbook', '#textbook-bcsc-s01', '#textbook-atlas', '#tab-advanced', '#tab-schedule', '#tab-project']) {
        assert.equal(app.qa.parseRoute(blocked), null, `${blocked} must be rejected in ${sid}`);
        assert.equal(app.qa.openRoute(blocked), false);
      }

      assert.equal(app.qa.normalizeLinkUrl(`https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=${sid}#pbl`), '#pbl');
      assert.equal(app.qa.normalizeLinkUrl(`https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=${sid}`), '#tab-today');
      assert.equal(app.qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2'), 'https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2');

      app.qa.openRoute('#pbl');
      app.action('link-save-current');
      app.action('tab', 'links');
      assert(app.main().includes('#pbl'));
      const linkKey = Object.keys(app.qa.meta).find(k => k.startsWith('link:'));
      assert(linkKey, 'current route saved in meta');
      app.action('link-open', linkKey.slice(5));
      assert.equal(app.qa.S.tab, 'pbl');
      assert.equal(app.location.search, '?s=' + sid);
      assert.equal(app.location.hash, '#pbl');
    }
  });

  await test('populated non-oph course-data-nm renders real quiz, learn, interview, PBL and workflow items instead of 內容待補', async () => {
    const shell = JSON.parse(jsonBlocks['course-data-nm']);
    shell.topics = [{id: 'nm-thyroid', chapter: 1, title: '甲狀腺核醫診斷與治療：攝取與掃描', summary: '區分 Graves 病與亞急性甲狀腺炎。', sections: [{title: '放射碘攝取率', points: ['高攝取支持功能亢進，低攝取支持破壞性甲狀腺炎。'], recall: '何時呈現低攝取？'}], notes: '', refs: [], compare: [], cases: [], images: [], source: 'SNMMI Procedure Standard'}];
    shell.questions = [{id: 'nm-q001', topicId: 'nm-thyroid', stem: '甲狀腺毒症合併極低放射碘攝取率最符合下列何者？', options: ['Graves 病', '亞急性甲狀腺炎', '毒性多結節性甲狀腺腫', '毒性腺瘤'], correctIndex: 1, explanation: '破壞性甲狀腺炎釋放預存荷爾蒙，TSH 受抑且攝取率低。', source: 'SNMMI Thyroid Scintigraphy Guideline'}];
    shell.interview = [{id: 'nm-iv-01', title: '核醫輻射安全溝通', question: '病人擔心檢查輻射劑量時如何說明？', durationSeconds: 120, clinical: true, topicId: 'nm-thyroid', answer: '先同理焦慮，說明診斷效益與合理抑低原則。', personalizationRequired: '', followups: ['孕婦受檢前要確認什麼？'], rubric: ['直接回答', '臨床依據', '輻射防護', '病人溝通', '求助界線'], source: 'ICRP Publication 105'}];
    shell.pbl = {version: 1, reviewedDate: '2026-11-01', intro: '核醫 PBL', method: [{step: '整理事實', hint: '列出已知證據'}], disclaimer: '教學用途', cases: [{id: 'pbl-nm-01', title: '分化型甲狀腺癌術後碘-131 評估', theme: '治療型核醫', trigger: '術後病理回報與治療前準備', topicIds: ['nm-thyroid'], workflowIds: ['wf-nm-01'], stages: [{title: '第一幕 · 術後病理', info: '乳突癌術後評估殘餘組織。', prompts: ['需要哪些資訊？'], facts: ['病理分期'], hypotheses: ['殘餘甲狀腺組織'], needToKnow: ['頸部超音波與 Tg'], discussion: '確認分期與妊娠排除。'}], learningIssues: [{issue: 'NIS 攝取機轉', why: '決定促甲狀腺素刺激策略'}], humanities: {title: '輻射防護與溝通', points: ['說明居家隔離注意事項']}, examinerFollowups: [{q: '低碘飲食幾天？', a: '約 1–2 週。'}], takeaway: '完整分期與安全核對後決定劑量。', sourceIds: []}]};
    shell.workflows = {version: 1, reviewedDate: '2026-11-01', intro: '核醫流程', disclaimer: '教學用途', categories: [{id: 'safety', label: '操作與用藥安全'}], workflows: [{id: 'wf-nm-01', category: 'safety', title: 'FDG PET/CT 受檢前血糖處置', urgency: '檢查前 4–6 小時禁食', trigger: '糖尿病受檢者報到前準備。', topicIds: ['nm-thyroid'], steps: [{title: '確認禁食與含糖輸液', detail: '檢視靜脈輸液與近期胰島素紀錄。', why: '避免競爭性抑制 FDG 攝取', critical: true}, {title: '量測檢查前血糖', detail: '依院內與指引門檻決定是否改期。', why: '高血糖降低腫瘤對比', critical: true}], redFlags: ['近期注射速效胰島素'], pitfalls: ['使用含葡萄糖點滴'], examQuestions: [{q: '為何避免運動？', a: '減少骨骼肌生理性攝取。'}], handoff: 'S：FDG PET 受檢者血糖偏高；B：第二型糖尿病；A：疑似近期胰島素作用；R：請主治醫師評估改期。', sourceIds: []}]};
    const app = boot({search: '?s=nm', blocks: {...jsonBlocks, 'course-data-nm': JSON.stringify(shell)}});
    for (const [tab, expectedText] of [['notebook', '甲狀腺核醫診斷與治療'], ['learn', '放射碘攝取率'], ['quiz', '甲狀腺毒症合併極低放射碘攝取率'], ['interview', '核醫輻射安全溝通'], ['pbl', '分化型甲狀腺癌術後碘-131 評估'], ['workflow', 'FDG PET/CT 受檢前血糖處置']]) {
      app.action('tab', tab);
      const markup = app.main();
      wellFormed(markup);
      assert(markup.includes(expectedText), `populated nm ${tab} missing ${expectedText}`);
      assert(!markup.includes('specialty-pending'), `populated nm ${tab} must not show 內容待補`);
    }
  });

  await test('content JSON strings contain no control characters except newline', async () => {
    const bad = [];
    const walk = (value, where) => {
      if (typeof value === 'string') { if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value)) bad.push(where); }
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { walk(key, where + ' key'); walk(item, where + '/' + key); }
    };
    const files = fs.readdirSync(path.join(ROOT, 'content'), {recursive: true}).filter(file => String(file).endsWith('.json'));
    assert(files.length > 0, 'content JSON files must be found');
    for (const file of files) walk(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', String(file)), 'utf8')), String(file));
    assert.deepEqual(bad, [], 'LaTeX written with single backslashes in JSON decodes to control characters (\\beta -> backspace + eta)');
  });
  await test('apply-specialty.py builds a full fixture specialty, preserves course-data sha256, and passes --check', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oph-spec-test-'));
    try {
      const tmpIndex = path.join(tmp, 'index.html');
      const contentRoot = path.join(tmp, 'content');
      const nmDir = path.join(contentRoot, 'nm');
      fs.mkdirSync(nmDir, {recursive: true});
      fs.copyFileSync(input, tmpIndex);

      const writeJson = (name, obj) => fs.writeFileSync(path.join(nmDir, name), JSON.stringify(obj, null, 2), 'utf8');
      writeJson('meta.json', {
        title: '核子醫學科甄選練習室 · 測試題庫',
        plan: [{date: '2026-11-01', topicIds: ['nm-thyroid'], goals: ['複習甲狀腺攝取機轉與輻射防護'], courseTask: {target: 'stories', text: '整理臨床溝通案例'}}],
      });
      writeJson('topics.json', [
        {
          id: 'nm-thyroid',
          chapter: 1,
          title: '甲狀腺核醫診斷與放射碘治療：攝取與判讀',
          summary: '整合放射碘攝取率與甲狀腺掃描鑑別甲狀腺毒症。',
          source: ['SNMMI Procedure Standard for Thyroid Scintigraphy 4.0'],
          sourceUrl: 'https://www.snmmi.org/',
          sections: [
            {title: '放射碘攝取率判讀', points: ['瀰漫高攝取見於 Graves 病；低攝取考慮亞急性甲狀腺炎或含碘顯影劑干擾。'], recall: '低攝取合併甲狀腺毒症有哪些原因？', ref: 'Sec III'},
            {title: '妊娠與哺乳禁忌', points: ['懷孕為放射碘檢查與治療絕對禁忌，給藥前須確認妊娠狀態。']},
          ],
          compare: [['Graves 病 vs 亞急性甲狀腺炎', '高攝取 vs 極低攝取', '避免對破壞性甲狀腺炎誤給抗甲狀腺藥']],
          cases: [{prompt: '育齡女性安排碘-131 前必問事項？', answer: '排除懷孕與確認停止哺乳，並檢查近期含碘顯影劑暴露。'}],
        },
        {
          id: 'nm-pet',
          chapter: 2,
          title: 'FDG PET/CT 腫瘤與發炎影像：生理分布與準備',
          summary: '掌握血糖控制、胰島素間隔與棕色脂肪生理攝取。',
          source: 'EANM FDG PET/CT Tumour Imaging Guideline v2.0',
          sections: [{title: '受檢前準備', points: ['禁食 4–6 小時，避免劇烈運動與含糖輸液。']}],
        },
      ]);
      writeJson('questions.json', [
        {
          id: 'nm-q001',
          topicId: 'nm-thyroid',
          stem: '34 歲女性頸部疼痛合併甲狀腺毒症，24 小時放射碘攝取率 1%，最可能為？',
          options: ['Graves 病', '亞急性甲狀腺炎', '毒性多結節性甲狀腺腫', '毒性甲狀腺腺瘤'],
          correctIndex: 1,
          explanation: '考點：濾泡破壞釋放荷爾蒙導致低攝取率。\n\n常見陷阱：未看攝取率即投予抗甲狀腺藥物。',
          source: 'SNMMI Procedure Standard for Thyroid Scintigraphy 4.0',
          pastExam: true,
          safety: true,
        },
        {
          id: 'nm-q002',
          topicId: 'nm-pet',
          stem: 'FDG PET/CT 檢查前若剛注射速效胰島素，最典型會造成何種假影？',
          options: ['腦部完全無攝取', '全身骨骼肌與心肌瀰漫性高攝取', '腎臟完全不顯影', '肺實質瀰漫高攝取'],
          answer: '全身骨骼肌與心肌瀰漫性高攝取',
          explanation: '胰島素促使 GLUT4 轉位至骨骼肌與心肌細胞膜，導致 FDG 大量進入肌肉而降低病灶對比。',
          source: 'EANM FDG PET/CT Guideline v2.0',
        },
      ]);
      writeJson('interview.json', [
        {
          id: 'nm-iv-01',
          title: '放射碘安全衛教',
          question: '病人詢問碘-131 治療後返家如何保護家人？',
          durationSeconds: 150,
          clinical: true,
          topicId: 'nm-thyroid',
          answer: '依時間、距離與個人衛生三原則說明分房睡覺、避免近距離接觸孕婦幼兒與沖水規範。',
          followups: ['若受檢者正在哺乳應如何建議？'],
          rubric: ['先講核心防護原則', '涵蓋時間與距離', '說明體液與衛浴清潔', '確認妊娠哺乳禁忌', '語氣清楚同理'],
          source: 'ICRP Publication 105',
        },
        {
          id: 'nm-iv-02',
          title: '報考核醫動機',
          question: '為什麼選擇核子醫學科作為住院醫師訓練方向？',
          durationSeconds: 120,
          clinical: false,
          answer: '結合分子影像生理判讀與精準放射標靶治療（Theranostics），重視跨科討論與輻射安全。',
          shortAnswer: '從分子影像定量與標靶治療整合談個人真實見習經驗。',
          followups: ['分享一次跨科討論印象深刻的經驗。'],
          rubric: ['直接回答動機', '連結真實經驗', '理解核醫日常工作', '誠實說明限制', '結尾拉回訓練目標'],
          source: '核子醫學專科訓練公開架構',
        },
      ]);
      writeJson('interviewSamples.json', {
        note: '通用題三位示範',
        clinicalNote: '臨床題三位示範',
        versions: [
          {label: 'A · PGY', hint: '先給結論', clinicalHint: '先講處置重點'},
          {label: 'B · 見習生', hint: '守住角色', clinicalHint: '回報主治醫師'},
          {label: 'C · 跨科醫師', hint: '連結臨床', clinicalHint: '補充機轉與紅旗'},
        ],
        answers: {
          'nm-iv-01': ['PGY 版回答', '見習生版回答', '跨科版回答'],
          'nm-iv-02': ['PGY 動機回答', '見習生動機回答', '跨科動機回答'],
        },
      });
      writeJson('interviewDetailed.json', {
        reviewedDate: '2026-11-01',
        note: '通用題詳解說明',
        clinicalNote: '臨床題詳解說明',
        answers: {
          'nm-iv-01': {
            summary: '30 秒防護重點',
            outline: ['先確認無懷孕哺乳', '距離與分房天數', '衛浴清潔與緊急聯絡'],
            answer: '完整口述防護內容與返診追蹤安排。',
            followupAnswers: ['碘-131 治療前須完全停止哺乳，不可於該胎次恢復哺乳。'],
            moreFollowups: [{q: '何時需要住院隔離？', a: '依體內殘留活度與法規門檻評估。'}],
            examinerFocus: ['輻射安全界線', '衛教可執行性'],
            pitfalls: ['忽略哺乳禁忌', '只背數字未解釋原因'],
            source: 'ICRP Publication 105',
          },
        },
      });
      writeJson('enrichment.json', {
        reviewedDate: '2026-11-01',
        chapters: {
          'nm-thyroid': {
            source: 'SNMMI Procedure Standard 4.0',
            resources: [{id: 'nm-res-snmmi', title: 'SNMMI Thyroid Guideline', url: 'https://www.snmmi.org/', kind: '指南', provider: 'SNMMI', note: '攝取率與掃描標準'}],
            figure: {
              title: '甲狀腺毒症核醫攝取鑑別圖',
              caption: '結合頸部壓痛與 24 小時攝取率區分高攝取與破壞性甲狀腺炎。',
              alt: '甲狀腺毒症高攝取與低攝取流程示意圖',
              src: 'assets/figures/nm-thyroid.svg',
              sourceIds: ['nm-res-snmmi'],
            },
            summaryTables: [{
              id: 't1',
              title: '甲狀腺毒症核醫攝取對照表',
              caption: '整合 24 小時攝取率與首選處置方向',
              headers: ['診斷', '24h RAIU', '掃描表現', '處置重點'],
              rows: [
                ['Graves 病', '瀰漫升高', '雙葉均勻高攝取', '抗甲狀腺藥物或評估碘-131'],
                ['亞急性甲狀腺炎', '顯著受抑 (<2%)', '雙葉低顯影', '消炎止痛並追蹤功能演變'],
              ],
              sourceIds: ['nm-res-snmmi'],
            }],
            deepDive: [{heading: '碘池擴張如何壓低攝取率', paragraphs: ['近期含碘顯影劑會競爭 NIS 轉運，造成假性低攝取。'], sourceIds: ['nm-res-snmmi']}],
            oralChallenge: {question: '如何分辨亞急性甲狀腺炎與顯影劑干擾？', answer: '結合頸部壓痛、發炎指標、病史與尿碘或追蹤時序。', sourceIds: ['nm-res-snmmi']},
            integrated: {
              framing: '從 TSH 受抑走到正確核醫檢查與治療決策。',
              objectives: ['區分高攝取與低攝取甲狀腺毒症', '落實放射碘給藥前妊娠核對'],
              units: [{
                id: 'u1',
                title: '攝取機轉與鑑別',
                sectionIndexes: [0, 1],
                deepDiveIndexes: [0],
                showFigure: true,
                synthesis: ['先看臨床壓痛與病史，再解讀攝取率高低。'],
                decisions: [{finding: 'TSH 低且 RAIU 1%', interpretation: '破壞性甲狀腺炎或碘干擾', nextStep: '症狀控制並避免誤用碘-131'}],
                sourceIds: ['nm-res-snmmi'],
              }],
              case: {
                title: '心悸與頸部疼痛的年輕女性',
                stem: '34 歲女性上呼吸道感染後出現頸痛與心悸。',
                steps: [{newInfo: 'RAIU 24h 為 1%。', prompt: '下一步處置？', answer: '支持性消炎止痛並追蹤甲狀腺功能演變。', rationale: '破壞期後可能進入甲狀腺低下期。', sourceIds: ['nm-res-snmmi']}],
              },
              connections: [{topicId: 'nm-pet', reason: '甲狀腺偶發高 FDG 攝取結節需進一步超音波評估'}],
            },
          },
          'nm-pet': {
            source: 'EANM FDG PET/CT Tumour Imaging Guideline v2.0',
            resources: [{id: 'nm-res-eanm', title: 'EANM FDG PET/CT Guideline', url: 'https://www.eanm.org/', kind: '指南', provider: 'EANM', note: '腫瘤代謝影像受檢前準備'}],
            figure: {
              title: 'FDG 受檢前血糖與胰島素間隔示意圖',
              caption: '避免內生性與外源性胰島素造成肌肉瀰漫攝取假影。',
              alt: 'FDG 受檢前血糖與胰島素處置流程圖',
              src: 'assets/figures/nm-pet.svg',
              sourceIds: ['nm-res-eanm'],
            },
            summaryTables: [{
              id: 't1',
              title: 'FDG 生理攝取與假影對照表',
              headers: ['情境', '主要機轉', '預防對策'],
              rows: [
                ['速效胰島素注射後', 'GLUT4 轉位致骨骼肌與心肌高攝取', '維持至少 4 小時以上間隔'],
                ['低溫受寒環境', '交感神經活化棕色脂肪攝取', '給藥前後保溫並安靜休息'],
              ],
              sourceIds: ['nm-res-eanm'],
            }],
            deepDive: [{heading: '胰島素與 GLUT4 轉位效應', paragraphs: ['胰島素會把 FDG 導向骨骼肌與心肌，顯著降低腫瘤背景對比。'], sourceIds: ['nm-res-eanm']}],
            oralChallenge: {question: '受檢者報到時指尖血糖偏高，能否直接注射速效胰島素後立刻打 FDG？', answer: '不可，會造成全身肌肉瀰漫高攝取假影，應依規範改期或拉長間隔。', sourceIds: ['nm-res-eanm']},
            integrated: {
              framing: '掌握受檢前血糖控制與生理分布，避免判讀假影。',
              objectives: ['辨識胰島素相關肌肉高攝取假影', '落實禁食與保溫準備流程'],
              units: [{
                id: 'nm-pet-u1',
                title: '血糖準備與生理攝取控制',
                sectionIndexes: [0],
                deepDiveIndexes: [0],
                showFigure: true,
                synthesis: ['注射 FDG 前先確認禁食、輸液成分與最後一次胰島素時間。'],
                decisions: [{finding: '剛施打速效胰島素 1 小時', interpretation: '高風險產生肌肉瀰漫攝取', nextStep: '延後給藥或重新排程'}],
                sourceIds: ['nm-res-eanm'],
              }],
              case: {
                title: '糖尿病受檢者的 FDG 排程評估',
                stem: '62 歲肺癌分期受檢者早餐後自行注射速效胰島素。',
                steps: [{newInfo: '距注射僅 90 分鐘。', prompt: '是否立即注射 FDG？', answer: '暫緩注射並向核醫主治醫師確認改期或等待間隔。', rationale: '避免肌肉攝取掩蓋縱膈與骨轉移病灶。', sourceIds: ['nm-res-eanm']}],
              },
              connections: [{topicId: 'nm-thyroid', reason: 'PET 偶發焦點性甲狀腺高攝取須安排超音波評估惡性風險'}],
            },
          },
        },
        learningPaths: [{id: 'nm-path-01', title: '甲狀腺與全身代謝影像', question: '如何串連攝取機轉與全身分子影像？', topicIds: ['nm-thyroid', 'nm-pet']}],
      });
      writeJson('source-coverage.json', {
        reviewedDate: '2026-11-03',
        scopeNote: '逐頁核對核醫科測試講義，全數以繁體中文原創重述整理。',
        chapters: {
          'nm-thyroid': {
            sourceFile: '核醫甲狀腺講義.pdf',
            pageCount: 6,
            sourceSha256: '0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef',
            companionSources: [{sourceFile: '放射碘防護補充講義.pdf', pageCount: 4, note: '合併核對妊娠哺乳與居家防護'}],
            reviewedPages: [
              {from: 1, to: 1, kind: 'administrative', note: '封面與課綱'},
              {from: 2, to: 6, kind: 'teaching', note: 'NIS 攝取機轉、掃描鑑別與防護'},
            ],
            unresolved: [],
            sourceLimitations: [{pages: [5], reason: '掃描示意圖對比較淡', handling: '改依標準文字描述判讀原則'}],
            entries: [{
              id: 'c01',
              title: 'NIS 轉運機轉與碘池干擾詳解',
              pages: [2, 3, 4, 5, 6],
              unitId: 'u1',
              sectionIndexes: [0, 1],
              terms: ['NIS', 'RAIU', '含碘顯影劑'],
              keyPoints: [
                '甲狀腺濾泡細胞透過基底膜鈉碘共同轉運蛋白主動濃縮碘離子，構成核醫攝取率與放射碘治療的共同基礎。',
                '近期接受含碘顯影劑或高碘藥物會擴張體內無機碘池並競爭轉運，導致 24 小時攝取率呈現假性低值。',
              ],
              clinicalLink: '判讀低攝取率合併甲狀腺毒症時，須同時比對頸部壓痛與近期顯影劑暴露紀錄。',
              pitfall: '漏問近期胸部或腹部顯影 CT 病史，誤把碘干擾當成單純甲狀腺炎。',
              recall: {question: '為何含碘顯影劑會壓低放射碘攝取率？', answer: '無機碘池擴張稀釋放射性碘並競爭 NIS 主動轉運。'},
              relatedTopics: ['nm-pet'],
              sourceIds: ['nm-res-snmmi'],
            }],
          },
          'nm-pet': {
            sourceFile: 'FDG代謝影像講義.pdf',
            pageCount: 4,
            reviewedPages: [{from: 1, to: 4, kind: 'teaching', note: 'FDG 生理分布與血糖胰島素準備'}],
            unresolved: [],
            sourceLimitations: [],
            entries: [{
              id: 'c01',
              title: '速效胰島素與骨骼肌瀰漫攝取假影',
              pages: [1, 2, 3, 4],
              unitId: 'nm-pet-u1',
              sectionIndexes: [0],
              terms: ['GLUT4', '速效胰島素'],
              keyPoints: [
                '胰島素會促使骨骼肌與心肌細胞膜表現 GLUT4 轉運蛋白，使大量 FDG 轉入正常肌肉組織。',
                '受檢前維持 4–6 小時禁食並確認無含糖輸液與近期速效胰島素，才能維持腫瘤病灶清晰對比。',
              ],
              clinicalLink: '報到時除量測指尖血糖外，必問最後一次皮下胰島素施打時間。',
              pitfall: '在檢查室為降血糖直接施打速效胰島素後立即注射 FDG。',
              recall: {question: '剛施打速效胰島素對 FDG PET 有何影響？', answer: '造成全身骨骼肌與心肌瀰漫性高攝取，降低病灶偵測靈敏度。'},
              relatedTopics: ['nm-thyroid'],
              sourceIds: ['nm-res-eanm'],
            }],
          },
        },
      });
      writeJson('workflows.json', {
        reviewedDate: '2026-11-01',
        intro: '核醫關鍵安全流程',
        disclaimer: '教學複習用途，依院內規範執行。',
        workflows: [{
          id: 'wf-nm-fdg',
          category: 'safety',
          title: 'FDG PET/CT 檢查前血糖與胰島素核對',
          urgency: '給藥前必檢',
          trigger: '受檢者報到準備注射 FDG 前。',
          topicIds: ['nm-pet'],
          steps: [
            {title: '確認禁食時數與靜脈輸液種類', detail: '檢視是否含葡萄糖溶液或腸道外營養。', why: '避免內生性胰島素升高與葡萄糖競爭', critical: true},
            {title: '詢問近期胰島素與降血糖藥時間', detail: '確認速效胰島素間隔是否足夠。', why: '避免肌肉瀰漫攝取假影', critical: true},
            {title: '測定指尖血糖並安靜休息保溫', detail: '減少說話、咀嚼與寒冷刺激。', why: '降低喉部肌肉與棕色脂肪生理攝取', critical: false},
          ],
          redFlags: ['4 小時內曾施打速效胰島素', '嚴重高血糖或低血糖症狀'],
          pitfalls: ['在檢查室自行補打速效胰島素後立即注射 FDG'],
          examQuestions: [{q: '棕色脂肪活化常見於哪些受檢者？', a: '年輕、偏瘦或受寒受檢者。'}],
          handoff: 'S：FDG 受檢者指尖血糖 245 mg/dL；B：第二型糖尿病；A：腫瘤對比可能下降；R：請核醫主治醫師評估是否延期檢查。',
          sourceIds: ['nm-res-snmmi'],
          source: 'EANM FDG PET/CT Guideline v2.0',
        }],
      });
      writeJson('pbl.json', {
        reviewedDate: '2026-11-01',
        intro: '核醫多幕臨床推理',
        disclaimer: '虛構教學情境。',
        cases: [{
          id: 'pbl-nm-dtc',
          title: '分化型甲狀腺癌術後放射碘治療評估',
          theme: 'Theranostics 與輻射防護',
          trigger: '全甲狀腺切除術後病理顯示局部淋巴結轉移。',
          topicIds: ['nm-thyroid'],
          workflowIds: ['wf-nm-fdg'],
          stages: [
            {title: '第一幕 · 術後風險分層', info: '檢視手術紀錄與病理分期。', prompts: ['還需要哪些抽血與影像？'], facts: ['甲狀腺乳突癌伴頸部淋巴結轉移'], hypotheses: ['中度復發風險'], needToKnow: ['術後 Tg、Anti-Tg 與頸部超音波'], discussion: '整合結構與生化指標決定是否輔助碘-131。'},
            {title: '第二幕 · 給藥前準備與衛教', info: '擬安排碘-131 治療。', prompts: ['如何完成促甲狀腺素刺激與防護衛教？'], facts: ['育齡女性受檢者'], hypotheses: ['需落實低碘飲食與驗孕'], needToKnow: ['妊娠檢驗結果與同住家庭成員'], discussion: '確認無懷孕哺乳並完成書面輻射安全衛教。'},
          ],
          learningIssues: [{issue: 'rhTSH 與停用甲狀腺素差異', why: '影響生活品質與清除效率評估'}],
          humanities: {title: '跨團隊與家庭溝通', points: ['以具體天數與距離化解家屬對輻射的恐懼']},
          examinerFollowups: [{q: '若 Tg 升高但碘掃描陰性（TENIS），下一步影像？', a: '考慮安排 FDG PET/CT 尋找去分化病灶。'}],
          takeaway: '治療型核醫須同時兼顧腫瘤風險分層、TSH 刺激準備與輻射安全。',
          sourceIds: ['nm-res-snmmi'],
          source: 'ATA Differentiated Thyroid Cancer Guidelines',
        }],
      });

      const scriptPath = path.join(ROOT, 'scripts/apply-specialty.py');
      // Before building, --check must detect that tmpIndex is out of date with contentRoot/nm.
      assert.throws(() => execFileSync('python3', [scriptPath, '--s', 'nm', '--content-root', contentRoot, '--index', tmpIndex, '--check'], {stdio: 'pipe'}));

      const buildOut = JSON.parse(execFileSync('python3', [scriptPath, '--s', 'nm', '--content-root', contentRoot, '--index', tmpIndex], {encoding: 'utf8'}));
      assert.equal(buildOut.course_data_sha256, COURSE_DATA_SHA256);
      assert.equal(buildOut.specialties.nm.changed, true);
      assert.equal(buildOut.specialties.nm.topics, 2);
      assert.equal(buildOut.specialties.nm.questions, 2);
      assert.equal(buildOut.specialties.nm.interview, 2);
      assert.equal(buildOut.specialties.nm.pbl_cases, 1);
      assert.equal(buildOut.specialties.nm.workflows, 1);
      assert.equal(buildOut.specialties.nm.coverage_topics, 2);
      assert.equal(buildOut.specialties.nm.summary_tables, 2);

      // Now --check passes and reports changed: false.
      const checkOut = JSON.parse(execFileSync('python3', [scriptPath, '--s', 'nm', '--content-root', contentRoot, '--index', tmpIndex, '--check'], {encoding: 'utf8'}));
      assert.equal(checkOut.course_data_sha256, COURSE_DATA_SHA256);
      assert.equal(checkOut.specialties.nm.changed, false);

      // Verify course-data and sibling non-oph blocks in tmpIndex are byte-identical to original.
      const builtHtml = fs.readFileSync(tmpIndex, 'utf8');
      const builtBlocks = Object.fromEntries([...builtHtml.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map(m => [m[1], m[2]]));
      assert.equal(builtBlocks['course-data'], jsonBlocks['course-data']);
      for (const otherId of Object.keys(OTHERS).filter(id => id !== 'nm')) {
        assert.equal(builtBlocks['course-data-' + otherId], jsonBlocks['course-data-' + otherId], otherId + ' block untouched');
      }
      const parsedNm = JSON.parse(builtBlocks['course-data-nm']);
      assert.equal(parsedNm.coverage.chapters['nm-thyroid'].sourceSha256, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      assert.equal(parsedNm.enrichment.learningPaths[0].id, 'nm-path-01');

      // Boot the built index.html with ?s=nm and exercise every populated feature!
      const app = boot({search: '?s=nm', blocks: builtBlocks});
      assert(!app.main().includes('specialty-pending'), 'populated nm home must not show 內容待補');
      wellFormed(app.main());
      app.action('tab', 'notebook');
      assert(!app.main().includes('specialty-pending'), 'populated nm chapters must not show 內容待補');
      assert(app.main().includes('甲狀腺與全身代謝影像'));
      assert(app.main().includes('從共筆找到每個主題的位置'), 'notebook tab renders coverageOverview');
      const indexEntries = plain(app.qa.notebookIndex());
      assert(indexEntries.some(x => x.type === '共筆主題詳解' && x.title === 'NIS 轉運機轉與碘池干擾詳解'), 'notebookIndex includes coverage entries');
      assert(indexEntries.some(x => x.type === '重點表格' && x.title === '甲狀腺毒症核醫攝取對照表' && x.body.includes('亞急性甲狀腺炎')), 'notebookIndex includes summaryTables');
      wellFormed(app.main());

      // Deep-link routes into integrated unit, coverage outline, companionSources, SVG figure, and summaryTables
      assert.equal(app.qa.openRoute('#nm-thyroid-u1'), true);
      assert.equal(app.qa.S.tab, 'learn');
      assert(app.main().includes('碘池擴張如何壓低攝取率') && app.main().includes('心悸與頸部疼痛的年輕女性'));
      assert(app.main().includes('本章共筆對照') && app.main().includes('合併對照：放射碘防護補充講義.pdf（4 頁）'), 'coverageOutline renders companionSources');
      assert(app.main().includes('表格重點整理') && app.main().includes('甲狀腺毒症核醫攝取對照表') && app.main().includes('enrichment-summary-table'), 'summaryTables renders in learn view');
      assert(app.main().includes('href="#nm-thyroid-tables">重點表格</a>'), 'enrichmentNav links to #nm-thyroid-tables');
      assert(app.main().includes('id="nm-thyroid-figure"') && app.main().includes('src="assets/figures/nm-thyroid.svg"'), 'SVG figure renders in integrated unit');
      wellFormed(app.main());

      // Active recall conceals summaryTables inside closed <details class="enrichment-detail">
      app.action('recall', 'on');
      assert.equal(app.qa.S.recall, true);
      assert(app.main().includes('<details class="enrichment-detail"><summary>回想後，展開「甲狀腺毒症核醫攝取對照表」表格</summary>'), 'S.recall conceals summaryTables behind closed details');
      wellFormed(app.main());
      app.action('recall', 'off');

      // Deep-link focus on coverage entry and <tid>-u1 unit IDs + initial hash load restoration
      assert.equal(app.qa.openRoute('#nm-thyroid-coverage-c01'), true);
      assert.equal(app.location.hash, '#nm-thyroid-coverage-c01');
      assert.equal(app.location.search, '?s=nm');
      assert.equal(app.qa.openRoute('#nm-pet-nm-pet-u1'), true);
      assert.equal(app.qa.S.learn, 'nm-pet');
      assert.equal(app.location.hash, '#nm-pet-nm-pet-u1');
      assert.equal(app.qa.openRoute('#nm-pet-coverage-c01'), true);
      assert.equal(app.location.hash, '#nm-pet-coverage-c01');

      const hashBootApp = boot({search: '?s=nm', hash: '#nm-thyroid-coverage-c01', blocks: builtBlocks});
      hashBootApp.windowHandlers.get('load')?.();
      assert.equal(hashBootApp.qa.S.tab, 'learn');
      assert.equal(hashBootApp.qa.S.learn, 'nm-thyroid');
      assert.equal(hashBootApp.location.search, '?s=nm');

      // Also verify numeric specialty IDs (#nm-01-coverage-c01, #ent-01-ent-01-u1) and ophthalmology (#notes-01-coverage-c01)
      const numericNm = JSON.parse(builtBlocks['course-data-nm']);
      numericNm.topics[0].id = 'nm-01';
      numericNm.enrichment.chapters['nm-01'] = numericNm.enrichment.chapters['nm-thyroid'];
      delete numericNm.enrichment.chapters['nm-thyroid'];
      numericNm.coverage.chapters['nm-01'] = numericNm.coverage.chapters['nm-thyroid'];
      delete numericNm.coverage.chapters['nm-thyroid'];
      const numApp = boot({search: '?s=nm', hash: '#nm-01-coverage-c01', blocks: {...builtBlocks, 'course-data-nm': JSON.stringify(numericNm)}});
      numApp.windowHandlers.get('load')?.();
      assert.equal(numApp.qa.S.tab, 'learn');
      assert.equal(numApp.qa.S.learn, 'nm-01');
      assert.equal(numApp.qa.parseRoute('#nm-01-coverage-c01')?.target, 'coverage-c01');

      const entCustom = JSON.parse(builtBlocks['course-data-ent']);
      if (entCustom.topics[0] && entCustom.enrichment?.chapters?.[entCustom.topics[0].id]?.integrated?.units?.[0]) {
        const tid0 = entCustom.topics[0].id;
        entCustom.enrichment.chapters[tid0].integrated.units[0].id = `${tid0}-u1`;
        const entApp = boot({search: '?s=ent', hash: `#${tid0}-${tid0}-u1`, blocks: {...builtBlocks, 'course-data-ent': JSON.stringify(entCustom)}});
        entApp.windowHandlers.get('load')?.();
        assert.equal(entApp.qa.S.tab, 'learn');
        assert.equal(entApp.qa.S.learn, tid0);
      }

      const ophHashApp = boot({hash: '#notes-01-coverage-c01'});
      ophHashApp.windowHandlers.get('load')?.();
      assert.equal(ophHashApp.qa.S.tab, 'learn');
      assert.equal(ophHashApp.qa.S.learn, 'notes-01');

      app.action('tab', 'quiz');
      assert(app.main().includes('34 歲女性頸部疼痛合併甲狀腺毒症'));
      app.qa.S.selected = 1;
      app.action('submit');
      assert(app.main().includes('SNMMI Procedure Standard for Thyroid Scintigraphy 4.0'));
      wellFormed(app.main());

      assert.equal(app.qa.openRoute('#interview-nm-iv-01'), true);
      assert(app.main().includes('三位示範者') && app.main().includes('30 秒防護重點') && app.main().includes('ICRP Publication 105'));
      app.action('use-sample', '0');
      assert(app.qa.entries['interview:nm-iv-01'].draft.includes('PGY 版回答'));
      wellFormed(app.main());

      assert.equal(app.qa.openRoute('#interview-nm-iv-02'), true);
      assert(app.main().includes('核子醫學專科訓練公開架構'));
      wellFormed(app.main());

      assert.equal(app.qa.openRoute('#pbl-nm-dtc'), true);
      assert(app.main().includes('分化型甲狀腺癌術後放射碘治療評估') && app.main().includes('ATA Differentiated Thyroid Cancer Guidelines'));
      app.action('pbl-stage');
      assert(app.main().includes('rhTSH 與停用甲狀腺素差異'));
      wellFormed(app.main());

      assert.equal(app.qa.openRoute('#wf-nm-fdg'), true);
      assert(app.main().includes('FDG PET/CT 檢查前血糖與胰島素核對') && app.main().includes('EANM FDG PET/CT Guideline v2.0'));
      app.action('wf-mode', 'order');
      wellFormed(app.main());
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  });

  await test('apply-specialty.py rejects items missing answer, missing source, bad IDs, or broken references', async () => {
    const scriptPath = path.join(ROOT, 'scripts/apply-specialty.py');
    const baseTopic = [{id: 'nm-t1', chapter: 1, title: '主題一', summary: '摘要', source: 'SNMMI 2024', sections: [{title: '重點', points: ['內容']}]}];
    const validQuestion = {id: 'nm-q1', topicId: 'nm-t1', stem: '題幹？', options: ['選項A', '選項B', '選項C', '選項D'], correctIndex: 0, explanation: '解析文字', source: 'SNMMI 2024'};
    const validInterview = {id: 'nm-iv1', title: '口試一', question: '問題？', clinical: true, topicId: 'nm-t1', answer: '參考回答', rubric: ['1', '2', '3', '4', '5'], source: 'ICRP 105'};
    const validEnrichment = {
      reviewedDate: '2026-11-03',
      chapters: {
        'nm-t1': {
          source: 'SNMMI 2024',
          resources: [{id: 'nm-res-1', title: 'SNMMI', url: 'https://www.snmmi.org/', kind: '指南', provider: 'SNMMI', note: '指引'}],
          deepDive: [],
          integrated: {
            framing: '導讀',
            objectives: ['目標一', '目標二'],
            units: [{id: 'u1', title: '單元一', sectionIndexes: [0], deepDiveIndexes: [], synthesis: ['整合說明'], decisions: [], sourceIds: ['nm-res-1']}],
          },
        },
      },
    };
    const validCoverageChapter = {
      sourceFile: '講義一.pdf',
      pageCount: 3,
      reviewedPages: [{from: 1, to: 1, kind: 'administrative', note: '封面'}, {from: 2, to: 3, kind: 'teaching', note: '正文'}],
      unresolved: [],
      sourceLimitations: [],
      entries: [{
        id: 'c01',
        title: '主題詳解一',
        pages: [2, 3],
        unitId: 'u1',
        sectionIndexes: [0],
        terms: ['術語一'],
        keyPoints: ['第一段原創重點說明。', '第二段原創重點說明。'],
        clinicalLink: '臨床判斷連結',
        pitfall: '常見判讀陷阱',
        recall: {question: '回想問題？', answer: '回想答案。'},
        relatedTopics: [],
        sourceIds: ['nm-res-1'],
      }],
    };
    const validCoverage = {reviewedDate: '2026-11-03', scopeNote: '核對範圍說明', chapters: {'nm-t1': validCoverageChapter}};

    const badCases = [
      ['question missing answer and correctIndex', {
        'topics.json': baseTopic,
        'questions.json': [{id: 'nm-q1', topicId: 'nm-t1', stem: '題幹？', options: ['A', 'B', 'C', 'D'], explanation: '解析', source: 'SNMMI'}],
      }, /answer required/],
      ['question out-of-range correctIndex', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, correctIndex: 4}],
      }, /correctIndex/],
      ['question boolean correctIndex', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, correctIndex: true}],
      }, /correctIndex/],
      ['question conflicting correctIndex and answer', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, correctIndex: 0, answer: '選項B'}],
      }, /disagrees with answer/],
      ['question missing source', {
        'topics.json': baseTopic,
        'questions.json': [{id: 'nm-q1', topicId: 'nm-t1', stem: '題幹？', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: '解析'}],
      }, /source reference required/],
      ['question blank source string', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, source: '   '}],
      }, /source reference required/],
      ['question missing explanation', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, explanation: ''}],
      }, /explanation/],
      ['question unknown topicId', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, topicId: 'nm-missing'}],
      }, /unknown topicId/],
      ['question wrong specialty prefix', {
        'topics.json': baseTopic,
        'questions.json': [{...validQuestion, id: 'ent-q1'}],
      }, /must match nm-/],
      ['topic missing source', {
        'topics.json': [{id: 'nm-t1', title: '主題一', summary: '摘要', sections: [{title: '重點', points: ['內容']}]}],
      }, /source reference required/],
      ['interview missing source', {
        'topics.json': baseTopic,
        'interview.json': [{...validInterview, source: []}],
      }, /source reference required/],
      ['interview wrong rubric count', {
        'topics.json': baseTopic,
        'interview.json': [{...validInterview, rubric: ['1', '2', '3']}],
      }, /rubric/],
      ['workflow missing source', {
        'topics.json': baseTopic,
        'workflows.json': {reviewedDate: '2026-11-01', intro: '簡介', disclaimer: '聲明', workflows: [{id: 'wf-nm-1', category: 'safety', title: '流程', urgency: '立即', trigger: '觸發', topicIds: ['nm-t1'], steps: [{title: '步一', detail: '細節', why: '理由', critical: true}, {title: '步二', detail: '細節', why: '理由', critical: false}], redFlags: ['紅旗'], pitfalls: ['陷阱'], examQuestions: [{q: '問', a: '答'}], handoff: 'SBAR'}]},
      }, /source reference required/],
      ['pbl missing source', {
        'topics.json': baseTopic,
        'pbl.json': {reviewedDate: '2026-11-01', intro: '簡介', disclaimer: '聲明', cases: [{id: 'pbl-nm-1', title: '個案', theme: '主題', trigger: '觸發', topicIds: ['nm-t1'], stages: [{title: '第一幕', info: '資訊', prompts: ['提問'], facts: ['事實'], hypotheses: ['假說'], needToKnow: ['待補'], discussion: '討論'}, {title: '第二幕', info: '資訊', prompts: ['提問'], facts: ['事實'], hypotheses: ['假說'], needToKnow: ['待補'], discussion: '討論'}], learningIssues: [{issue: '議題', why: '原因'}], humanities: {title: '人文', points: ['重點']}, examinerFollowups: [{q: '問', a: '答'}], takeaway: '帶走一句'}]},
      }, /source reference required/],
      ['summaryTables fewer than 2 headers', {
        'topics.json': baseTopic,
        'enrichment.json': {
          ...validEnrichment,
          chapters: {'nm-t1': {...validEnrichment.chapters['nm-t1'], summaryTables: [{id: 't1', title: '表一', headers: ['單欄'], rows: [['值']]}]}},
        },
      }, /summaryTables.*headers/],
      ['summaryTables empty rows', {
        'topics.json': baseTopic,
        'enrichment.json': {
          ...validEnrichment,
          chapters: {'nm-t1': {...validEnrichment.chapters['nm-t1'], summaryTables: [{id: 't1', title: '表一', headers: ['欄一', '欄二'], rows: []}]}},
        },
      }, /summaryTables.*rows/],
      ['summaryTables row column mismatch', {
        'topics.json': baseTopic,
        'enrichment.json': {
          ...validEnrichment,
          chapters: {'nm-t1': {...validEnrichment.chapters['nm-t1'], summaryTables: [{id: 't1', title: '表一', headers: ['欄一', '欄二'], rows: [['僅一欄']]}]}},
        },
      }, /2 cells matching headers/],
      ['summaryTables unknown sourceIds', {
        'topics.json': baseTopic,
        'enrichment.json': {
          ...validEnrichment,
          chapters: {'nm-t1': {...validEnrichment.chapters['nm-t1'], summaryTables: [{id: 't1', title: '表一', headers: ['欄一', '欄二'], rows: [['甲', '乙']], sourceIds: ['nm-res-missing']}]}},
        },
      }, /unresolved resource IDs/],
      ['source-coverage without enrichment integrated lessons', {
        'topics.json': baseTopic,
        'source-coverage.json': validCoverage,
      }, /enrichment with integrated lessons/],
      ['source-coverage missing topic key', {
        'topics.json': [...baseTopic, {id: 'nm-t2', chapter: 2, title: '主題二', summary: '摘要二', source: 'SNMMI 2024', sections: [{title: '重點', points: ['內容']}]}],
        'enrichment.json': {
          reviewedDate: '2026-11-03',
          chapters: {
            'nm-t1': validEnrichment.chapters['nm-t1'],
            'nm-t2': {...validEnrichment.chapters['nm-t1'], resources: [{id: 'nm-res-2', title: 'SNMMI 2', url: 'https://www.snmmi.org/', kind: '指南', provider: 'SNMMI', note: '指引'}], integrated: {...validEnrichment.chapters['nm-t1'].integrated, units: [{...validEnrichment.chapters['nm-t1'].integrated.units[0], sourceIds: ['nm-res-2']}]}},
          },
        },
        'source-coverage.json': validCoverage,
      }, /keys must match all specialty topic IDs/],
      ['source-coverage reviewedPages gap', {
        'topics.json': baseTopic,
        'enrichment.json': validEnrichment,
        'source-coverage.json': {...validCoverage, chapters: {'nm-t1': {...validCoverageChapter, reviewedPages: [{from: 1, to: 1, kind: 'administrative', note: '封面'}, {from: 3, to: 3, kind: 'teaching', note: '缺第2頁'}]}}},
      }, /partition every PDF page/],
      ['source-coverage uncovered teaching page', {
        'topics.json': baseTopic,
        'enrichment.json': validEnrichment,
        'source-coverage.json': {...validCoverage, chapters: {'nm-t1': {...validCoverageChapter, entries: [{...validCoverageChapter.entries[0], pages: [2]}]}}},
      }, /teaching\/exam pages without topic entries/],
      ['source-coverage non-empty unresolved', {
        'topics.json': baseTopic,
        'enrichment.json': validEnrichment,
        'source-coverage.json': {...validCoverage, chapters: {'nm-t1': {...validCoverageChapter, unresolved: ['待確認第3頁']}}},
      }, /unresolved audit findings/],
      ['source-coverage malformed sourceSha256', {
        'topics.json': baseTopic,
        'enrichment.json': validEnrichment,
        'source-coverage.json': {...validCoverage, chapters: {'nm-t1': {...validCoverageChapter, sourceSha256: 'not-a-sha256'}}},
      }, /64-hex sha256 required/],
      ['source-coverage unknown unitId', {
        'topics.json': baseTopic,
        'enrichment.json': validEnrichment,
        'source-coverage.json': {...validCoverage, chapters: {'nm-t1': {...validCoverageChapter, entries: [{...validCoverageChapter.entries[0], unitId: 'u3'}]}}},
      }, /unresolved integrated unit/],
      ['unknown json filename typo', {
        'question.json': [validQuestion],
      }, /unknown JSON file question\.json/],
      ['cram-review chapter mismatch against topics.json', {
        'topics.json': baseTopic,
        'cram-review.json': {
          version: 1, updated: '2026-11-03', title: '衝刺', disclaimer: '聲明', sourceNotice: '來源',
          chapters: [{id: 'nm-other', number: 1, title: '章一', focus: ['重點']}],
          groups: [{id: 'nm-g1', title: '組一', summary: '摘要', chapterIds: ['nm-other'], points: [{question: '問', answer: '答', trap: '陷', source: {chapter: '1', pages: 'p.1'}}]}],
          cards: [{id: 'nm-cram-01', groupId: 'nm-g1', chapterId: 'nm-other', question: '問', answer: '答', trap: '陷', source: {chapter: '1', pages: 'p.1'}}],
          corrections: [{id: 'nm-corr-01', title: '勘', sourceWording: '舊', correction: '新', source: {chapter: '1', pages: 'p.1'}, links: [{label: 'SNMMI', url: 'https://www.snmmi.org/'}]}],
        },
      }, /chapters: IDs must match topics\.json/],
      ['cram-review non-https link url', {
        'topics.json': baseTopic,
        'cram-review.json': {
          version: 1, updated: '2026-11-03', title: '衝刺', disclaimer: '聲明', sourceNotice: '來源',
          chapters: [{id: 'nm-t1', number: 1, title: '章一', focus: ['重點']}],
          groups: [{id: 'nm-g1', title: '組一', summary: '摘要', chapterIds: ['nm-t1'], points: [{question: '問', answer: '答', trap: '陷', source: {chapter: '1', pages: 'p.1'}}]}],
          cards: [{id: 'nm-cram-01', groupId: 'nm-g1', chapterId: 'nm-t1', question: '問', answer: '答', trap: '陷', source: {chapter: '1', pages: 'p.1'}}],
          corrections: [{id: 'nm-corr-01', title: '勘', sourceWording: '舊', correction: '新', source: {chapter: '1', pages: 'p.1'}, links: [{label: 'Insecure', url: 'http://example.com/'}]}],
        },
      }, /must start with https:\/\//],
    ];

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oph-spec-neg-'));
    try {
      const tmpIndex = path.join(tmp, 'index.html');
      fs.copyFileSync(input, tmpIndex);
      for (const [label, files, pattern] of badCases) {
        const cRoot = path.join(tmp, 'case');
        fs.rmSync(cRoot, {recursive: true, force: true});
        fs.mkdirSync(path.join(cRoot, 'nm'), {recursive: true});
        for (const [fname, data] of Object.entries(files)) {
          fs.writeFileSync(path.join(cRoot, 'nm', fname), JSON.stringify(data), 'utf8');
        }
        let errOut = '';
        try {
          execFileSync('python3', [scriptPath, '--s', 'nm', '--content-root', cRoot, '--index', tmpIndex, '--check'], {encoding: 'utf8', stdio: 'pipe'});
          assert.fail(`Expected validator to reject: ${label}`);
        } catch (err) {
          errOut = String(err.stderr || '') + String(err.stdout || '') + String(err.message || '');
        }
        assert.match(errOut, pattern, label);
      }
      // Reject --s oph explicitly
      assert.throws(() => execFileSync('python3', [scriptPath, '--s', 'oph', '--check'], {stdio: 'pipe'}));
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  });

  await test('a specialty bank must not give the key away by option length', async () => {
    const checkOptionLengths = (label, questions) => {
      assert.ok(Array.isArray(questions) && questions.length > 0, `${label}: expected non-empty questions`);
      const text = o => (o && typeof o === 'object' ? o.text : String(o));
      const cidx = q => Number.isInteger(q.correctIndex) ? q.correctIndex : q.options.indexOf(q.answer);
      const longest = questions.filter(q => {
        const lens = q.options.map(o => text(o).length);
        return lens[cidx(q)] === Math.max(...lens);
      }).length;
      const percent = 100 * longest / questions.length;
      assert.ok(percent <= 40, `${label}: the keyed option is the longest in ${percent.toFixed(1)}% of ${questions.length} MCQs (limit 40%)`);

      const ratios = questions.map(q => {
        const idx = cidx(q);
        const lens = q.options.map(o => text(o).length);
        const others = lens.filter((_, i) => i !== idx);
        return lens[idx] / (others.reduce((a, b) => a + b, 0) / others.length);
      }).sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
      assert.ok(median <= 1.2, `${label}: median keyed-to-other option length ratio is ${median.toFixed(2)} (limit 1.2)`);
    };

    for (const id of fs.readdirSync(path.join(ROOT, 'content'))) {
      const file = path.join(ROOT, 'content', id, 'questions.json');
      if (!fs.existsSync(file)) continue;
      const questions = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!questions.length) continue;
      checkOptionLengths(id, questions);
    }

    const pastExamQuestions = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'past-exam-questions.json'), 'utf8'));
    checkOptionLengths('past-exam-questions.json', pastExamQuestions);

    const depthDir = path.join(ROOT, 'content', 'textbook-depth');
    const depthBanks = [
      ...Array.from({length: 13}, (_, i) => `bcsc-s${String(i + 1).padStart(2, '0')}.json`),
      'additional-practice.json',
      'advanced-practice.json',
    ];
    for (const name of depthBanks) {
      const questions = JSON.parse(fs.readFileSync(path.join(depthDir, name), 'utf8')).questions;
      checkOptionLengths(name, questions);
    }
  });

  await test('content/<sid>/cram-review.json schema, topic alignment, and hygiene across ent, rad, nm, and neuro', async () => {
    const ophCramRaw = fs.readFileSync(path.join(ROOT, 'content/cram-review.json'));
    const ophCramSha = crypto.createHash('sha256').update(ophCramRaw).digest('hex');
    assert.equal(ophCramSha, '1877f5dc210c0bfd80f6f635612ca1f99a6277a784dda52986bce0b13fabcfca', 'ophthalmology content/cram-review.json must stay byte-identical');

    const simpRe = /[这为发对说会着过还进们个时来国学体点线显剂脑肾脏肿肠胆髋颈颌龈龋脓瘘痫瘫痉挛颤晕呕泻痒癣瘢瘾疗药针输检诊证验标导级类组块结节纤综适并鉴扫摄计]|瞻妄|線粒體|综合症|综合征/;
    const rawLatexRe = /\\[a-zA-Z]{2,}|\$[^$\n]+\$/;
    const ctrlRe = /[\u0000-\u0009\u000b-\u001f\u007f]/;

    for (const sid of FULL_TAB_SPECIALTIES) {
      const cramFile = path.join(ROOT, 'content', sid, 'cram-review.json');
      assert(fs.existsSync(cramFile), `missing ${cramFile}`);
      const raw = fs.readFileSync(cramFile, 'utf8');
      const cram = JSON.parse(raw);
      const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', sid, 'topics.json'), 'utf8'));
      const topicIds = new Set(topics.map(t => t.id));

      assert.equal(cram.version, 1, `${sid} cram version`);
      assert.equal(cram.groups.length, 6, `${sid} cram groups count`);
      assert.equal(cram.chapters.length, topics.length, `${sid} cram chapters count must match topics.json`);
      assert.equal(cram.cards.length, 24, `${sid} cram cards count`);
      assert.equal(cram.corrections.length, 4, `${sid} cram corrections count`);

      const chapterIds = new Set(cram.chapters.map(c => c.id));
      assert.deepEqual([...chapterIds].sort(), [...topicIds].sort(), `${sid} cram chapters must match topics.json IDs`);

      const groupIds = new Set();
      for (const g of cram.groups) {
        assert(g.id.startsWith(sid + '-'), `${sid} group id prefix: ${g.id}`);
        assert(!groupIds.has(g.id), `${sid} duplicate group id: ${g.id}`);
        groupIds.add(g.id);
        assert(Array.isArray(g.points) && g.points.length >= 2, `${sid} group ${g.id} points`);
        for (const cid of g.chapterIds) assert(topicIds.has(cid), `${sid} group ${g.id} unknown chapterId ${cid}`);
        for (const pt of g.points) {
          for (const l of pt.links || []) assert.match(l.url, /^https:\/\/\S+$/, `${sid} point link url`);
        }
      }

      const cardIds = new Set();
      for (const card of cram.cards) {
        assert.match(card.id, new RegExp(`^${sid}-cram-\\d{2}$`), `${sid} card id format: ${card.id}`);
        assert(!cardIds.has(card.id), `${sid} duplicate card id: ${card.id}`);
        cardIds.add(card.id);
        assert(groupIds.has(card.groupId), `${sid} card ${card.id} unknown groupId ${card.groupId}`);
        assert(topicIds.has(card.chapterId), `${sid} card ${card.id} unknown chapterId ${card.chapterId}`);
        for (const l of card.links || []) assert.match(l.url, /^https:\/\/\S+$/, `${sid} card link url`);
      }

      for (const corr of cram.corrections) {
        assert(corr.id.startsWith(sid + '-'), `${sid} correction id prefix: ${corr.id}`);
        assert(Array.isArray(corr.links) && corr.links.length > 0, `${sid} correction ${corr.id} links`);
        for (const l of corr.links) assert.match(l.url, /^https:\/\/\S+$/, `${sid} correction link url`);
      }

      const walkStrings = (val, where) => {
        if (typeof val === 'string') {
          assert(!ctrlRe.test(val), `${sid} ${where}: control character`);
          assert(!simpRe.test(val), `${sid} ${where}: simplified or banned term (${val.match(simpRe)?.[0]})`);
          assert(!rawLatexRe.test(val), `${sid} ${where}: raw LaTeX (${val.match(rawLatexRe)?.[0]})`);
          for (const leak of OPH_LEAK_TERMS) assert(!val.includes(leak), `${sid} ${where}: leaked ophthalmology term ${leak}`);
        } else if (val && typeof val === 'object') {
          for (const [k, v] of Object.entries(val)) walkStrings(v, `${where}.${k}`);
        }
      };
      walkStrings(cram, 'cram');
    }
  });

  await test('cram-review.js mounts per-specialty packs, renders chapter counts and #topic-<sid>-* links, and isolates localStorage without oph-prep: leakage', async () => {
    const cramScriptSource = fs.readFileSync(path.join(ROOT, 'scripts/cram-review.js'), 'utf8');
    const mountCramFor = async search => {
      const regWin = runRegistry(search);
      const local = new MemoryStorage();
      const fetchedUrls = [];
      const bridgeCalls = [];
      const rootHandlers = new Map();
      const root = {
        isConnected: true,
        dataset: {},
        innerHTML: '',
        querySelector() { return {focus() {}, scrollIntoView() {}}; },
        addEventListener(name, fn) { rootHandlers.set(name, fn); },
      };
      const fakeBridge = {
        read() { bridgeCalls.push('read'); return null; },
        save(k, v) { bridgeCalls.push(['save', k, v]); },
        remove(k) { bridgeCalls.push(['remove', k]); },
      };
      let clock = Date.parse('2026-11-03T12:00:00.000Z');
      const win = {
        OphSpecialty: regWin.OphSpecialty,
        OphSpecialties: regWin.OphSpecialties,
        OphStudyBridge: fakeBridge,
        OphStudy: {now: () => clock},
        localStorage: local,
      };
      const ctx = vm.createContext({
        window: win,
        document: {
          currentScript: {src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/cram-review.js'},
          getElementById: () => null,
        },
        fetch: async url => {
          const u = String(url);
          fetchedUrls.push(u);
          const rel = u.replace('https://qwwaawwqq.github.io/ophthalmology-interview-public/', '');
          const payload = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
          return {ok: true, status: 200, json: async () => payload};
        },
        URL, Intl, Date, Set, Map, Object, Array, String, Number, Boolean, JSON, Math, Error, Promise, encodeURIComponent,
      });
      vm.runInContext(cramScriptSource, ctx);
      await win.OphCram.mount(root);
      return {win, local, fetchedUrls, bridgeCalls, root, rootHandlers, advance(ms) { clock += ms; }};
    };

    const ophRun = await mountCramFor('');
    assert.deepEqual(ophRun.fetchedUrls, ['https://qwwaawwqq.github.io/ophthalmology-interview-public/content/cram-review.json']);
    wellFormed(ophRun.root.innerHTML);
    assert(ophRun.root.innerHTML.includes('先讀這六組對照'));
    assert(ophRun.root.innerHTML.includes('十四章共筆全覽'));
    ophRun.rootHandlers.get('click')({
      target: {closest: sel => sel === '[data-cram-srs]' ? {dataset: {id: 'cram-01', cramSrs: 'good'}, closest: () => ({nextElementSibling: null})} : null},
    });
    assert.deepEqual(keysOf(ophRun.local), ['oph-prep:cram-review-v1']);
    assert(ophRun.bridgeCalls.some(c => Array.isArray(c) && c[0] === 'save' && c[1] === 'study:srs:cram:cram-01'), 'oph cram still syncs to OphStudyBridge');

    for (const sid of FULL_TAB_SPECIALTIES) {
      const cramData = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', sid, 'cram-review.json'), 'utf8'));
      const run = await mountCramFor('?s=' + sid);
      assert.deepEqual(run.fetchedUrls, [`https://qwwaawwqq.github.io/ophthalmology-interview-public/content/${sid}/cram-review.json`]);
      wellFormed(run.root.innerHTML);
      assert(!run.root.innerHTML.includes('內容待補') && !run.root.innerHTML.includes('暫時無法載入教材'), `${sid} cram must render real content`);
      assert(run.root.innerHTML.includes(cramData.title), `${sid} cram title rendered`);
      assert(run.root.innerHTML.includes('先讀這六組對照'), `${sid} cram group heading`);
      assert(run.root.innerHTML.includes(`${cramData.chapters.length}章共筆全覽`), `${sid} cram dynamic chapter heading`);
      assert(run.root.innerHTML.includes('自評只保存在此瀏覽器'), `${sid} cram local-only status banner`);
      for (const leak of OPH_LEAK_TERMS) assert(!run.root.innerHTML.includes(leak), `${sid} cram DOM leaked ${leak}`);

      const firstChapterId = cramData.chapters[0].id;
      assert(run.root.innerHTML.includes(`href="#topic-${firstChapterId}"`), `${sid} cram renders #topic-${firstChapterId} link`);
      const app = boot({search: '?s=' + sid});
      assert.equal(app.qa.openRoute(`#topic-${firstChapterId}`), true, `${sid} #topic-${firstChapterId} opens in main app`);
      assert.equal(app.qa.S.tab, 'learn');
      assert.equal(app.qa.S.learn, firstChapterId);
      assert.equal(app.location.search, '?s=' + sid);

      const card0 = cramData.cards[0].id;
      const card1 = cramData.cards[1].id;
      run.rootHandlers.get('click')({
        target: {closest: sel => sel === '[data-cram-srs]' ? {dataset: {id: card0, cramSrs: 'again'}, closest: () => ({nextElementSibling: null})} : null},
      });
      run.rootHandlers.get('click')({
        target: {closest: sel => sel === '[data-cram-mark]' ? {dataset: {id: card1, cramMark: 'known'}, closest: () => ({nextElementSibling: null})} : null},
      });
      assert.deepEqual(keysOf(run.local), [`${sid}-prep:cram-review-v1`], `${sid} cram writes only ${sid}-prep:cram-review-v1`);
      assert.equal(run.local.getItem('oph-prep:cram-review-v1'), null, `${sid} cram never touches oph-prep:cram-review-v1`);
      assert.deepEqual(run.bridgeCalls, [], `${sid} cram never touches OphStudyBridge`);
      const saved = JSON.parse(run.local.getItem(`${sid}-prep:cram-review-v1`));
      assert.equal(saved[card0].status, 'review');
      assert.equal(saved[card0].plan.rating, 'again');
      assert.equal(saved[card1].status, 'known');

      run.rootHandlers.get('change')({target: {matches: s => s === '[data-cram-filter]', value: 'due'}});
      wellFormed(run.root.innerHTML);
      assert(!run.root.innerHTML.includes(`data-card-id="${card0}"`), `${sid} again-rated card is due in 10 min, not immediately`);
      run.advance(600000);
      run.rootHandlers.get('change')({target: {matches: s => s === '[data-cram-filter]', value: 'due'}});
      wellFormed(run.root.innerHTML);
      assert(run.root.innerHTML.includes(`data-card-id="${card0}"`), `${sid} again-rated card becomes due after 10 min`);
    }
  });

  await test('Issue #197: ENT past-exam MCQ mode bar, badges without spoilers, stale workspace merge, and #kaogu / #written-past routes', async () => {
    // 1. ENT #tab-today quick-launch & #tab-quiz mode bar vs other non-oph specialties
    const entApp = boot({search: '?s=ent'});
    entApp.windowHandlers.get('load')?.();
    const todayHtml = entApp.main();
    wellFormed(todayHtml);
    assert(todayHtml.includes('110–113 各院考古單選'), 'ENT today renders 110–113 各院考古單選 quick launch');
    assert(todayHtml.includes('110–113 筆試申論（中榮為主）'), 'ENT today renders 110–113 筆試申論（中榮為主） quick launch');
    assert(todayHtml.includes('手寫問答題'), 'ENT today renders 手寫問答題 quick launch');

    entApp.action('tab', 'quiz');
    const quizHtml = entApp.main();
    wellFormed(quizHtml);
    assert(quizHtml.includes('單選題練習（432 題）'));
    assert(quizHtml.includes('110–113 各院考古單選（64 題）'));
    assert(quizHtml.includes('歷屆與講義考點單選（166 題）'));
    assert(quizHtml.includes('110–113 筆試申論（16 組 · 中榮為主 · 含完整答案）'), 'ENT quiz mode bar renders 110–113 筆試申論（16 組 · 中榮為主 · 含完整答案）');
    assert(quizHtml.includes('手寫問答題（手寫板＋文字作答＋標準答案）'));
    assert(quizHtml.includes('<option value="kaogu-hosp" >110–113 各院考古單選</option>') || quizHtml.includes('<option value="kaogu-hosp">110–113 各院考古單選</option>'));
    assert(quizHtml.includes('歷屆與講義考點</option>'));

    for (const otherSid of ['rad', 'nm', 'neuro']) {
      const otherApp = boot({search: '?s=' + otherSid, hash: '#tab-quiz'});
      otherApp.windowHandlers.get('load')?.();
      const om = otherApp.main();
      wellFormed(om);
      assert(!om.includes('110–113 各院考古單選'), `${otherSid} must not render hospital past-exam MCQ pill when count is 0`);
      assert(!om.includes('110–113 各院筆試申論'), `${otherSid} must not render past-exam written pill when count is 0`);
      assert(om.includes('歷屆考點單選（'), `${otherSid} renders standard 歷屆考點單選 pill`);
    }

    // 2. Clicking spec-quiz-mode mcq-past-hosp -> 64 items, ent-q369 first, badge & disclaimer, no spoiler on ent-q432, and mcq returns to 432
    entApp.action('spec-quiz-mode', 'mcq-past-hosp');
    assert.equal(entApp.qa.S.mode, 'kaogu-hosp');
    assert.equal(entApp.qa.S.ids.length, 64);
    assert.equal(entApp.qa.S.ids[0], 'ent-q369');
    assert.equal(entApp.location.hash, '#kaogu');
    const hospCardHtml = entApp.main();
    wellFormed(hospCardHtml);
    assert(hospCardHtml.includes('<span class="tag">歷屆考點 · 北榮111筆試1、亞東111筆試1</span>'), 'renders hospital past-exam badge');
    assert(hospCardHtml.includes('歷屆考點改寫<br>單選練習'), 'renders accurate rewrite note');
    assert(!hospCardHtml.includes('非歷屆試題'), 'must not claim 非歷屆試題 on pastExam item');
    for (const leak of OPH_LEAK_TERMS) assert(!hospCardHtml.includes(leak), `ENT kaogu-hosp leaked ${leak}`);

    // Verify colon subtitle spoiler is stripped on ent-q432 (index 63)
    entApp.action('jump', '63');
    assert.equal(entApp.qa.S.ids[entApp.qa.S.qi], 'ent-q432');
    const q432Html = entApp.main();
    wellFormed(q432Html);
    assert(q432Html.includes('<span class="tag">歷屆考點 · 中榮 110／112 筆試甲狀腺題組</span>'), 'strips colon subtitle from badge');
    assert(!q432Html.includes('術前軟式內視鏡評估重點與術中雙神經保留'), 'does not leak topic subtitle spoiler before answering');

    // mcq-past -> 166 items with 64 hospital items sorted first, and #kaogu normalizes to #tab-quiz so reload preserves 166 items
    entApp.action('spec-quiz-mode', 'mcq-past');
    assert.equal(entApp.qa.S.mode, 'kaogu');
    assert.equal(entApp.qa.S.ids.length, 166);
    assert.equal(entApp.qa.S.ids[0], 'ent-q369', 'hospital past-exam items sort ahead in ENT kaogu mode');
    assert.equal(entApp.location.hash, '#tab-quiz', 'ENT mcq-past normalizes #kaogu to #tab-quiz');
    entApp.action('jump', '5');
    assert.equal(entApp.qa.S.qi, 5);
    await entApp.runTimers();
    const reloadedMcqPast = boot({search: '?s=ent', local: entApp.local});
    reloadedMcqPast.windowHandlers.get('load')?.();
    assert.equal(reloadedMcqPast.qa.S.tab, 'quiz');
    assert.equal(reloadedMcqPast.qa.S.mode, 'kaogu', 'reload preserves ENT mcq-past mode');
    assert.equal(reloadedMcqPast.qa.S.ids.length, 166, 'reload preserves all 166 mcq-past items without clobbering to 64');
    assert.equal(reloadedMcqPast.qa.S.qi, 5);

    // Chapter-filtered kaogu-hosp session at #kaogu survives reload without resetting topic to 'all'
    const chapLocal = new MemoryStorage();
    const chapEnt = boot({search: '?s=ent', hash: '#kaogu', local: chapLocal});
    chapEnt.windowHandlers.get('load')?.();
    const hospTopicId = chapEnt.qa.D.questions.find(q => q.id === 'ent-q369').topicId;
    chapEnt.qa.startQuiz(hospTopicId, 'kaogu-hosp');
    const expectedChapLen = chapEnt.qa.S.ids.length;
    assert(expectedChapLen > 0 && expectedChapLen < 64, 'chapter filter narrows kaogu-hosp pool');
    assert.equal(chapEnt.location.hash, '#kaogu');
    if (expectedChapLen > 1) chapEnt.action('jump', '1');
    await chapEnt.runTimers();
    const reloadedChapEnt = boot({search: '?s=ent', local: chapLocal});
    reloadedChapEnt.windowHandlers.get('load')?.();
    assert.equal(reloadedChapEnt.qa.S.tab, 'quiz');
    assert.equal(reloadedChapEnt.qa.S.mode, 'kaogu-hosp');
    assert.equal(reloadedChapEnt.qa.S.topic, hospTopicId, 'reload preserves chapter-filtered #kaogu topic');
    assert.equal(reloadedChapEnt.qa.S.ids.length, expectedChapLen, 'reload preserves chapter-filtered #kaogu pool');
    if (expectedChapLen > 1) assert.equal(reloadedChapEnt.qa.S.qi, 1);

    // mcq returns cleanly to all 432 items
    entApp.action('spec-quiz-mode', 'mcq');
    assert.equal(entApp.qa.S.mode, 'all');
    assert.equal(entApp.qa.S.ids.length, 432);
    assert.equal(entApp.location.hash, '#tab-quiz');

    // Switching mcq-past-hosp -> written-past -> mcq also resets back to 432 items
    entApp.action('spec-quiz-mode', 'mcq-past-hosp');
    assert.equal(entApp.qa.S.ids.length, 64);
    entApp.action('spec-quiz-mode', 'written-past');
    assert.equal(entApp.location.hash, '#written-past');
    assert(entApp.main().includes('data-value="written-past" aria-pressed="true"'));
    entApp.action('spec-quiz-mode', 'mcq');
    assert.equal(entApp.qa.S.mode, 'all');
    assert.equal(entApp.qa.S.ids.length, 432);

    // OPH #kaogu -> switching to bcsc/hard/extra normalizes hash from #kaogu to #tab-quiz
    const ophKaogu = boot({hash: '#kaogu', github: {fetch: async () => ({ok: true, status: 200, headers: {get: () => null}, json: async () => ({questions: []}), text: async () => '{}'})}});
    ophKaogu.windowHandlers.get('load')?.();
    assert.equal(ophKaogu.qa.S.tab, 'quiz');
    assert.equal(ophKaogu.qa.S.mode, 'kaogu');
    assert.equal(ophKaogu.location.hash, '#kaogu');
    ophKaogu.action('quiz-bank', 'bcsc');
    assert.equal(ophKaogu.window.OphQuizBank.getMode(), 'bcsc');
    assert.equal(ophKaogu.qa.routeMatchesView(ophKaogu.qa.parseRoute('#kaogu')), false);
    assert.equal(ophKaogu.location.hash, '#tab-quiz', 'oph #kaogu -> bcsc normalizes hash to #tab-quiz');

    // 3. Stale workspace auto-merge: cached 368 IDs automatically append ent-q369..ent-q432 -> 432 while preserving S.qi and S.round
    const staleLocal = new MemoryStorage();
    const first368 = entApp.qa.D.questions.slice(0, 368).map(q => q.id);
    assert.equal(first368.length, 368);
    assert.equal(first368.at(-1), 'ent-q368');
    staleLocal.setItem('ent-prep:workspace-v1', JSON.stringify({
      v: 1,
      at: '2026-11-08T10:00:00.000Z',
      hash: '#tab-quiz',
      quiz: {
        topic: 'all',
        mode: 'all',
        ids: first368,
        qi: 12,
        round: {'ent-q001': {choice: 1, correct: true, confidence: 2, at: '2026-11-08T09:59:00.000Z'}},
      },
    }));
    const resumedEnt = boot({search: '?s=ent', local: staleLocal});
    resumedEnt.windowHandlers.get('load')?.();
    assert.equal(resumedEnt.qa.S.tab, 'quiz');
    assert.equal(resumedEnt.qa.S.mode, 'all');
    assert.equal(resumedEnt.qa.S.ids.length, 432, 'merges newly added 64 questions into cached 368 workspace');
    assert.deepEqual(plain(resumedEnt.qa.S.ids.slice(0, 368)), first368, 'preserves original cached order');
    assert.equal(resumedEnt.qa.S.ids[368], 'ent-q369');
    assert.equal(resumedEnt.qa.S.ids[431], 'ent-q432');
    assert.equal(resumedEnt.qa.S.qi, 12, 'preserves current question index S.qi');
    assert.equal(resumedEnt.qa.S.round['ent-q001']?.choice, 1, 'preserves round answers');

    // 4. Deep links ?s=ent#kaogu, ?s=ent#written-past, and ?s=rad#written-past fallback normalization
    const deepKaogu = boot({search: '?s=ent', hash: '#kaogu'});
    deepKaogu.windowHandlers.get('load')?.();
    assert.equal(deepKaogu.qa.S.tab, 'quiz');
    assert.equal(deepKaogu.qa.S.mode, 'kaogu-hosp');
    assert.equal(deepKaogu.qa.S.ids.length, 64);
    assert.equal(deepKaogu.qa.S.ids[0], 'ent-q369');
    assert.equal(deepKaogu.location.hash, '#kaogu');
    wellFormed(deepKaogu.main());

    const deepWrittenPast = boot({search: '?s=ent', hash: '#written-past'});
    deepWrittenPast.windowHandlers.get('load')?.();
    assert.equal(deepWrittenPast.qa.S.tab, 'quiz');
    assert.equal(deepWrittenPast.location.hash, '#written-past');
    assert(deepWrittenPast.main().includes('data-value="written-past" aria-pressed="true"'));
    assert(deepWrittenPast.main().includes('data-written-scope="past"'));
    wellFormed(deepWrittenPast.main());

    const radWrittenPast = boot({search: '?s=rad', hash: '#written-past'});
    radWrittenPast.windowHandlers.get('load')?.();
    assert.equal(radWrittenPast.qa.S.tab, 'quiz');
    assert(radWrittenPast.main().includes('data-value="written" aria-pressed="true"'), 'rad #written-past keeps written pill active');
    assert(!radWrittenPast.main().includes('data-written-scope="past"'));
    radWrittenPast.qa.openRoute('#written-past', true);
    assert.equal(radWrittenPast.location.hash, '#written', 'openRoute(#written-past, true) on rad normalizes hash to #written');
    assert(radWrittenPast.main().includes('data-value="written" aria-pressed="true"'));
    wellFormed(radWrittenPast.main());
  });

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({input, results}, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
