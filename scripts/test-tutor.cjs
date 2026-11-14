// Tests for the Socratic tutor tab: index.html hooks, app navigation, and scripts/tutor.js without a real server.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const html = read('index.html'), tutorJs = read('scripts/tutor.js');
const results = [];
async function test(name, fn) { try { await fn(); results.push({name, pass: true}); } catch (e) { results.push({name, pass: false, error: e.stack}); } }
const count = (s, needle) => s.split(needle).length - 1;
const tick = () => new Promise(r => setImmediate(r));

// A tiny browser stand-in: the root is string-only, so the chat view's sub-renders are skipped, but the offline view,
// requests and state are fully observable.
function loadTutor({hostname = '127.0.0.1', protocol = 'http:', hash = '', responses = {}, specialty} = {}) {
  const calls = [], replaced = [], dispatched = [], storage = new Map();
  const listeners = {};
  const root = {innerHTML: '', isConnected: true, dataset: {}, handlers: {}, querySelector: () => null,
    addEventListener(name, fn) { this.handlers[name] = fn; }, contains: () => true};
  const location = {hostname, protocol, hash, origin: protocol + '//' + hostname + (hostname === '127.0.0.1' ? ':8002' : ''), pathname: '/'};
  const window = {
    OphSpecialty: specialty,
    addEventListener(name, fn) { listeners[name] = fn; },
    dispatchEvent(ev) { dispatched.push(ev.type); }
  };
  const context = {
    window, location, URL, console, Set, Map, WeakSet, Promise, JSON, Math, Date, Number, String, Array, Object,
    document: {getElementById: id => (id === 'tutor-root' ? null : null)},
    history: {replaceState(_, __, url) { replaced.push(url); location.hash = url; }},
    localStorage: {getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    navigator: {clipboard: {writeText: async () => {}}},
    setInterval: () => 1, clearInterval: () => {}, setTimeout: fn => { fn(); return 1; },
    HashChangeEvent: function (type) { this.type = type; }, Event: function (type) { this.type = type; },
    fetch: async (url, opt = {}) => {
      calls.push({url: String(url), method: opt.method, headers: opt.headers || {}, body: opt.body ? JSON.parse(opt.body) : undefined});
      const key = Object.keys(responses).find(k => String(url).includes(k));
      const r = key ? responses[key] : {status: 404, json: null};
      const payload = typeof r.json === 'function' ? r.json(opt.body ? JSON.parse(opt.body) : undefined) : r.json;
      return {ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (payload == null) throw Error('not json'); return JSON.parse(JSON.stringify(payload)); }};
    }
  };
  vm.createContext(context);
  vm.runInContext(tutorJs, context);
  return {api: window.OphTutor, root, calls, replaced, dispatched, listeners, storage, location};
}

const STATUS = {ok: true, available: true, reason: null, busy: false, login: 'unknown', specialty: 'oph', specialty_label: '眼科',
  chapters: [{id: 'notes-07', title: '青光眼', chapter: 7}], claude: {bin: '/x/claude', version: '9.9.9', model: 'sonnet', models: ['sonnet', 'opus', 'haiku'],
  account_dir: null, account_dirs: [], default_account: '~/.claude', login_command: 'claude'}, data_dir: '/Users/x/.ophthalmology-tutor', sessions: []};
const session = (id, turns = 1) => ({id, specialty: 'oph', title: '青光眼', topic: '青光眼', turns, updated_at: '2026-11-15T03:00:00+08:00',
  messages: [{role: 'user', text: '教我「青光眼」'}, {role: 'tutor', text: '第一題？'}], state: {phase: 'diagnostic', subskills: [{name: 'A', level: 2}], notes: []}});

(async () => {
  await test('index.html carries each tutor hook exactly once and apply-tutor.py --check passes', () => {
    assert.equal(count(html, 'src="scripts/tutor.js?v='), 1);
    assert.equal(count(html, 'href="scripts/tutor.css?v='), 1);
    assert.equal(count(html, "['tutor','✎','蘇格拉底家教']"), 1);
    assert.equal(count(html, "['家教',['tutor']]"), 1);
    assert.equal(count(html, 'tutor:()=>('), 1);
    assert.equal(count(html, "const NAV_LAYOUT=[['',['today','tutor']],"), 1, 'the tutor sits right under 今日');
    assert(html.includes("window.OphTutor?.mount(document.getElementById('tutor-root'))"), 'the view works even if tutor.js never loads');
    execFileSync('python3', [path.join(__dirname, 'apply-tutor.py'), '--check'], {encoding: 'utf8'});
  });

  await test('the app opens the tutor tab under 今日 for every specialty without touching progress', () => {
    const sync = read('scripts/test-progress-sync.cjs').split('(async () => {')[0];
    const syncHost = {require, process: {argv: []}, __dirname, console, URL, Blob, Buffer, TextEncoder, TextDecoder, Uint8Array, atob, btoa, setImmediate};
    vm.runInNewContext(sync + '\nglobalThis.factories={boot,MemoryStorage,fakeGitHub};', syncHost);
    const {boot: bootSync, MemoryStorage, fakeGitHub} = syncHost.factories;
    const a = bootSync({local: new MemoryStorage(), session: new MemoryStorage(), github: fakeGitHub()});
    const snapshot = () => JSON.stringify({entries: a.qa.progressPayload().entries, meta: a.qa.progressPayload().meta});
    const before = snapshot();
    a.action('tab', 'tutor');
    assert.equal(a.qa.S.tab, 'tutor');
    assert.equal(snapshot(), before, 'opening the tutor writes no progress');

    const layout = read('scripts/test-layout.cjs').split('\n(async () => {')[0];
    const host = {require, process: {argv: []}, __dirname, console, URL, URLSearchParams, Intl, Blob, Buffer, TextEncoder, TextDecoder, Uint8Array, atob, btoa, setImmediate, setTimeout, clearTimeout};
    vm.runInNewContext(layout + '\nglobalThis.factories={boot,wellFormed};', host);
    const {boot, wellFormed} = host.factories;
    for (const search of ['', '?s=ent', '?s=neuro']) {
      const app = boot({search});
      const order = [...app.nav().matchAll(/data-action="tab" data-value="([a-z]+)"/g)].map(m => m[1]);
      assert.deepEqual(order.slice(0, 2), ['today', 'tutor'], search || 'oph');
      app.action('tab', 'tutor');
      assert.equal(app.qa.S.tab, 'tutor');
      const main = app.main();
      wellFormed(main);
      assert(main.includes('<h1>蘇格拉底家教</h1>') && main.includes('id="tutor-root"'));
      assert(!main.includes('undefined') && !main.includes('NaN') && !main.includes('眼科'), 'no ophthalmology wording in the shared shell');
      assert.equal(app.location.hash, '#tab-tutor');
      assert.equal(app.qa.parseRoute('#tab-tutor').tab, 'tutor');
    }
  });

  await test('on GitHub Pages and file:// the tab only explains how to start it and sends no request', async () => {
    for (const [hostname, protocol] of [['qwwaawwqq.github.io', 'https:'], ['', 'file:']]) {
      const t = loadTutor({hostname, protocol});
      t.api.mount(t.root);
      await tick();
      assert.equal(t.api.isLocal(), false);
      assert(t.root.innerHTML.includes('家教要在你的 Mac 上啟動'), hostname || protocol);
      assert(t.root.innerHTML.includes('python3 ophthalmology-interview-public/scripts/tutor-server.py'));
      assert(t.root.innerHTML.includes('http://127.0.0.1:8002/#tutor'));
      assert(!t.root.innerHTML.includes('重新偵測'), 'no local probe button off-device');
      t.root.handlers.click({target: {closest: () => ({getAttribute: n => (n === 'data-t-act' ? 'reprobe' : null)})}});
      await tick();
      assert.equal(t.calls.length, 0, 'no fetch at all');
    }
  });

  await test('on 127.0.0.1 it reads the status for the active specialty, then sends JSON chats with the local header', async () => {
    const t = loadTutor({specialty: {id: 'ent', label: '耳鼻喉科', storePrefix: 'ent-prep:'}, responses: {
      'status?': {status: 200, json: Object.assign({}, STATUS, {specialty: 'ent'})},
      'chat': {status: 200, json: body => ({ok: true, reply: '第一題？', session: Object.assign(session(body.id || 't20261115-030000-abcdef'), {specialty: 'ent'})})}
    }});
    t.api.mount(t.root);
    await tick(); await tick();
    assert.equal(t.calls[0].url, 'http://127.0.0.1:8002/api/tutor/status?specialty=ent');
    assert.equal(t.calls[0].method, 'GET');
    assert.equal(t.calls[0].headers['X-Tutor'], undefined);
    assert.equal(t.api._state.phase, 'ready');
    assert(t.root.innerHTML.includes('data-t-input') && t.root.innerHTML.includes('看進度'));
    await t.api._send('教我「中耳炎」', 'ent-03');
    const chat = t.calls.find(c => c.url.endsWith('/api/tutor/chat'));
    assert.equal(chat.method, 'POST');
    assert.equal(chat.headers['Content-Type'], 'application/json');
    assert.equal(chat.headers['X-Tutor'], '1');
    assert.deepEqual(chat.body, {id: '', message: '教我「中耳炎」', specialty: 'ent', chapter: 'ent-03'});
    assert.equal(t.api._state.current.id, 't20261115-030000-abcdef');
    assert.equal(t.storage.get('ent-prep:tutor-current'), 't20261115-030000-abcdef', 'remembers the open course per specialty');
    await t.api._send('先問我鼓室圖');
    const second = t.calls.filter(c => c.url.endsWith('/api/tutor/chat'))[1];
    assert.deepEqual(second.body, {id: 't20261115-030000-abcdef', message: '先問我鼓室圖', specialty: 'ent'}, 'chapter only on a new course');
  });

  await test('failed chats keep the message for a retry and a login error flags the account', async () => {
    const t = loadTutor({responses: {
      'status?': {status: 200, json: STATUS},
      'chat': {status: 503, json: {ok: false, code: 'auth', error: '家教用的 Claude 帳號 ~/.claude 還沒登入'}}
    }});
    t.api.mount(t.root);
    await tick(); await tick();
    await t.api._send('教我白內障');
    assert.equal(t.api._state.failed.text, '教我白內障');
    assert.equal(t.api._state.failed.code, 'auth');
    assert.equal(t.api._state.status.login, 'needed');
    assert.equal(t.api._state.busy, false);
  });

  await test('a missing local server falls back to the start-up steps with a re-probe button', async () => {
    const t = loadTutor({responses: {}});
    t.api.mount(t.root);
    await tick(); await tick();
    assert.equal(t.api._state.phase, 'offline');
    assert(t.root.innerHTML.includes('連不上本機的家教伺服器') && t.root.innerHTML.includes('重新偵測'));
  });

  await test('#tutor is rewritten to the app route #tab-tutor', () => {
    const t = loadTutor({hash: '#tutor'});
    assert.deepEqual(t.replaced, ['#tab-tutor']);
    assert.deepEqual(t.dispatched, [], 'at load the app router reads the rewritten hash itself');
    t.location.hash = '#tutor';
    t.listeners.hashchange();
    assert.deepEqual(t.dispatched, ['hashchange']);
  });

  await test('tutor messages render as escaped markdown', () => {
    const {api} = loadTutor({hostname: 'example.test', protocol: 'https:'});
    const out = api.md('**重點**：`RAPD`\n\n- 一\n- 二\n\n```\nTopic  ████░░\n```\n\n<img src=x onerror=alert(1)>\n\n你會先做什麼？');
    assert(out.includes('<b>重點</b>') && out.includes('<code>RAPD</code>'));
    assert(out.includes('<ul><li>一</li><li>二</li></ul>'));
    assert(out.includes('<pre class="tutor-pre">Topic  ████░░\n</pre>'));
    assert(out.includes('&lt;img src=x onerror=alert(1)&gt;') && !out.includes('<img'));
    assert(out.includes('<p class="tutor-q">你會先做什麼？</p>'));
  });

  console.log(JSON.stringify({passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, results}, null, 2));
  if (results.some(x => !x.pass)) process.exitCode = 1;
})();
