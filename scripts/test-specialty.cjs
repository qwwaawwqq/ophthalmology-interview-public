#!/usr/bin/env node
// Specialty registry, namespaced storage, specialty picker and shell/pending rendering checks (issues #48 & #49).
// Usage: node scripts/test-specialty.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
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
const hooked = source.replace(end, 'globalThis.__qa={D,S,SPEC,get entries(){return entries;},get meta(){return meta;},put,syncState,cloudConfig,progressPayload,mergeProgress,exportProgress,render,navs,switchTab,openRoute,parseRoute,normalizeLinkUrl,tabAllowed};render();})();');

const COURSE_DATA_SHA256 = 'd58be38d9cd8594696560123694dfd988b221300dec9b91f3e0f7d9c27c4ef02';
const OPH = {
  id: 'oph', label: '眼科', appTitle: '眼科甄選練習室', storePrefix: 'oph-prep:', stateKey: 'oph-prep:progress-v3', syncFile: 'progress.json',
  formats: ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3'],
  exportFormat: 'ophthalmology-prep-progress-v3', defaultRepo: 'ophthalmology-progress', exportName: 'Ophthalmology_Progress_',
  dataId: 'course-data', contentBase: 'content/', query: '',
};
const OTHERS = {ent: '耳鼻喉科', rad: '放射診斷科', radonc: '放射腫瘤科', nm: '核子醫學科'};
const OPH_ONLY_TABS = ['textbook', 'cram', 'advanced', 'schedule', 'project'];
const OPH_LEAK_TERMS = ['BCSC', 'RAPD', '白瞳', '共筆', '急性視力喪失', '糖尿病黃斑水腫', '#pbl-dr', '#wf-chemical', '#notes-02'];

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
  vm.runInContext(bootSource, context);
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
  if (withBoot) vm.runInContext(bootSource, context);
  vm.runInContext(hooked, context, {timeout: 10000});
  return {
    qa: context.__qa, local, session, github, blobs, clipboard, toasts, windowHandlers, anchor: element('anchor'),
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
  await test('course-data sha256 is untouched and all four non-oph course-data-<s> blocks exist once', async () => {
    const counts = {};
    for (const m of blockMatches) counts[m[1]] = (counts[m[1]] || 0) + 1;
    assert.equal(counts['course-data'], 1);
    const sha = crypto.createHash('sha256').update(jsonBlocks['course-data'], 'utf8').digest('hex');
    assert.equal(sha, COURSE_DATA_SHA256, 'ophthalmology course-data payload must remain byte-identical');
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
    const ophFile = format => ({format, exportedAt: at, entries: {['q:' + q.id]: {choice: q.correctIndex, at}}, meta: {}});
    const srsEntry = {version: 1, at, answerCount: 1, attempt: {id: 't1', at, correct: false, rated: true}, plan: {step: -1, dueAt: at, rating: 'again', reviewCount: 1, lapses: 1}};
    const sharedFile = format => ({format, exportedAt: at, entries: {'study:srs:shared:smoke-1': srsEntry}, meta: {}});
    for (const v of ['v1', 'v2', 'v3']) assert.equal(oph.qa.mergeProgress(ophFile('ophthalmology-prep-progress-' + v)).count, 1, v);
    for (const format of ['ophthalmology-prep-progress-v1', 'ophthalmology-prep-progress-v2', 'ophthalmology-prep-progress-v3', 'ent-prep-progress-v1']) assert.throws(() => nm.qa.mergeProgress(sharedFile(format)), /進度 JSON/, format);
    assert.throws(() => oph.qa.mergeProgress(sharedFile('nm-prep-progress-v1')), /進度 JSON/);
    assert.throws(() => ent.qa.mergeProgress(sharedFile('nm-prep-progress-v1')), /進度 JSON/);
    assert.equal(nm.qa.mergeProgress(sharedFile('nm-prep-progress-v1')).count, 1);
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

  await test('specialty picker renders on home and sidebar across all 5 specialties with dynamic branding', async () => {
    const expectedHrefs = ['./', './?s=ent', './?s=rad', './?s=radonc', './?s=nm'];
    const oph = boot();
    assert.equal(oph.title(), '眼科甄選練習室 · 公開練習版');
    assert.equal(oph.brand(), '眼科甄選練習室');
    assert(oph.footer().includes('眼科甄選練習室 · 公開練習版'));
    for (const href of expectedHrefs) {
      assert(oph.main().includes(`href="${href}"`), 'home picker missing ' + href);
      assert(oph.nav().includes(`href="${href}"`), 'sidebar switcher missing ' + href);
    }
    assert(oph.main().includes('href="./" aria-current="page"'));
    assert(oph.nav().includes('href="./" aria-current="page"'));
    wellFormed(oph.main());
    wellFormed(oph.nav());

    for (const [id, label] of Object.entries(OTHERS)) {
      const app = boot({search: '?s=' + id});
      assert.equal(app.title(), `${label}甄選練習室 · 公開練習版`);
      assert.equal(app.brand(), `${label}甄選練習室`);
      assert(app.footer().includes(`${label}甄選練習室 · 公開練習版`));
      assert(!app.footer().includes('共筆'));
      for (const href of expectedHrefs) {
        assert(app.main().includes(`href="${href}"`), `${id} home picker missing ${href}`);
        assert(app.nav().includes(`href="${href}"`), `${id} sidebar switcher missing ${href}`);
      }
      assert(app.main().includes(`href="./?s=${id}" aria-current="page"`));
      assert(app.nav().includes(`href="./?s=${id}" aria-current="page"`));
    }
  });

  await test('every visible tab renders well-formed HTML, empty shells show 內容待補, and zero ophthalmology content leaks', async () => {
    const oph = boot();
    for (const [tab] of oph.qa.navs) {
      oph.action('tab', tab);
      assert.equal(oph.qa.S.tab, tab);
      wellFormed(oph.main());
    }

    for (const [id, label] of Object.entries(OTHERS)) {
      const app = boot({search: '?s=' + id});
      for (const ophTab of OPH_ONLY_TABS) {
        assert.equal(app.qa.tabAllowed(ophTab), false, `${id} must hide ${ophTab}`);
        assert(!app.nav().includes(`data-value="${ophTab}"`), `${id} nav leaked ${ophTab}`);
      }
      const visibleTabs = plain(app.qa.navs.filter(n => app.qa.tabAllowed(n[0])).map(n => n[0]));
      assert.deepEqual(visibleTabs, ['study', 'notebook', 'quiz', 'learn', 'interview', 'pbl', 'workflow', 'workshop', 'plan', 'progress', 'links', 'sync']);

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
  });

  await test('hash navigation and saved links preserve ?s=nm and reject ophthalmology-only routes', async () => {
    const app = boot({search: '?s=nm', hash: '#tab-quiz'});
    app.windowHandlers.get('load')?.();
    assert.equal(app.qa.S.tab, 'quiz');
    assert.equal(app.location.search, '?s=nm');
    assert.equal(app.location.hash, '#tab-quiz');

    for (const [hash, expectedTab] of [['#tab-learn', 'learn'], ['#pbl', 'pbl'], ['#workflow', 'workflow'], ['#links', 'links'], ['#tab-interview', 'interview']]) {
      assert.equal(app.qa.openRoute(hash), true, hash);
      assert.equal(app.qa.S.tab, expectedTab);
      assert.equal(app.location.search, '?s=nm', `${hash} must keep ?s=nm`);
      assert.equal(app.location.hash, hash);
    }

    app.action('tab', 'notebook');
    assert.equal(app.location.search, '?s=nm', 'returning to home keeps ?s=nm');
    assert.equal(app.location.hash, '');

    for (const blocked of ['#textbook', '#textbook-bcsc-s01', '#textbook-atlas', '#tab-cram', '#tab-advanced', '#tab-schedule', '#tab-project']) {
      assert.equal(app.qa.parseRoute(blocked), null, `${blocked} must be rejected in nm`);
      assert.equal(app.qa.openRoute(blocked), false);
    }

    assert.equal(app.qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=nm#pbl'), '#pbl');
    assert.equal(app.qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/?s=nm'), '#tab-notebook');
    assert.equal(app.qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2'), 'https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2');

    app.qa.openRoute('#pbl');
    app.action('link-save-current');
    app.action('tab', 'links');
    assert(app.main().includes('#pbl'));
    const linkKey = Object.keys(app.qa.meta).find(k => k.startsWith('link:'));
    assert(linkKey, 'current route saved in meta');
    app.action('link-open', linkKey.slice(5));
    assert.equal(app.qa.S.tab, 'pbl');
    assert.equal(app.location.search, '?s=nm');
    assert.equal(app.location.hash, '#pbl');
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

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({input, results}, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
