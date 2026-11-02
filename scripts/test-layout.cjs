#!/usr/bin/env node
// Behavior checks for the 2026-11 layout (issue #108): grouped rail, specialty switcher, 今日 home,
// interview reference column, top-bar menu and search, and the phone tab bar.
// This mock DOM is not a browser or visual QA.
// Usage: node scripts/test-layout.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const root = path.join(__dirname, '..');
const input = process.argv[2] || path.join(root, 'index.html');
const html = fs.readFileSync(input, 'utf8');
const blocks = Object.fromEntries([...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map(m => [m[1], m[2]]));
assert(blocks['course-data'], 'The app must include its course-data payload.');
const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(appScript, 'The app must include its application script.');
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(appScript), 'The test hook must match the app bootstrap.');
const registry = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/)?.[1];
assert(registry, 'The app must include the specialty registry.');

const DAY = 86400000;
const taipei = t => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(t));
const inDays = n => taipei(Date.now() + n * DAY);

function boot({search = '', fetchImpl} = {}) {
  const elements = new Map(), handlers = new Map(), windowHandlers = new Map();
  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set(), attrs = {};
      elements.set(key, {
        textContent: '', innerHTML: '', value: '', hidden: false, style: {setProperty() {}},
        classList: {add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v),
          toggle(v, force) { const next = force === undefined ? !classes.has(v) : force; next ? classes.add(v) : classes.delete(v); return next; }},
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null,
        focus() {}, scrollIntoView() {}, click() {}, addEventListener() {},
      });
    }
    return elements.get(key);
  }
  const location = {hash: '', search, href: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + search, origin: 'https://qwwaawwqq.github.io', pathname: '/ophthalmology-interview-public/'};
  const window = {
    addEventListener: (name, fn) => windowHandlers.set(name, fn), scrollTo() {}, confirm: () => true, location,
    history: {replaceState(_s, _t, url) { const i = String(url).indexOf('#'); location.hash = i < 0 ? '' : String(url).slice(i); }},
  };
  const document = {
    getElementById: id => id in blocks ? {textContent: blocks[id]} : element('#' + id),
    querySelector: element, createElement: () => element('anchor'),
    addEventListener: (name, fn) => handlers.set(name, fn),
  };
  const context = {document, window, Intl, Date, Set, Map, Object, Array, String, Number, JSON, Math, Error, SyntaxError, Promise, URL, URLSearchParams, Blob,
    setInterval() {}, setTimeout() {}, clearTimeout() {}, console};
  if (fetchImpl) context.fetch = fetchImpl;
  vm.createContext(context);
  vm.runInContext(registry, context);
  window.OphSpecialty = context.window.OphSpecialty;
  const script = appScript.replace(end, 'globalThis.__qa={D,S,navs,get entries(){return entries;},render,parseRoute,normalizeLinkUrl,currentLocationHash,tabAllowed};render();})();');
  vm.runInContext(script, context, {timeout: 10000});
  const qa = context.__qa;
  windowHandlers.get('load')?.();
  const action = (name, value = '') => handlers.get('click')({target: {closest: () => ({dataset: {action: name, value}, disabled: false, setAttribute() {}})}});
  return {qa, element, handlers, location, action, main: () => element('#main').innerHTML, nav: () => element('#nav').innerHTML, tabbar: () => element('#tabbar').innerHTML};
}

// Balanced-tag check for controlled app templates, not an HTML rendering engine.
function wellFormed(markup) {
  const stack = [], voids = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
  for (const token of markup.match(/<(?:[^>"']|"[^"]*"|'[^']*')+>/g) || []) {
    if (token.startsWith('<!')) continue;
    const close = token.match(/^<\/\s*([a-z0-9]+)/i);
    if (close) { assert.equal(stack.pop(), close[1].toLowerCase(), 'Mismatched closing tag ' + close[1]); continue; }
    const open = token.match(/^<\s*([a-z0-9]+)/i)[1].toLowerCase();
    if (!voids.has(open) && !token.endsWith('/>')) stack.push(open);
  }
  assert.equal(stack.length, 0, 'Unclosed tags: ' + stack.join(','));
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

const results = [];
async function test(name, run) {
  try { await run(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, message: error.message}); }
}

(async () => {
  await test('the shell carries the stylesheet, top-bar menu, site search and tab bar exactly once', () => {
    assert.equal((html.match(/scripts\/layout\.css\?v=/g) || []).length, 1);
    assert.equal((html.match(/data-top-search-form/g) || []).length, 2, 'form attribute plus its submit handler');
    assert.equal((html.match(/<nav class="tabbar" id="tabbar"/g) || []).length, 1);
    assert.equal((html.match(/data-app-install-open/g) || []).length, 1, 'install entry must stay unique');
    for (const action of ['link-save-current', 'import', 'export']) assert(html.includes(`data-action="${action}"`), action + ' must stay in the menu');
    assert(html.includes('class="top-actions" id="top-actions"') && html.includes('aria-controls="top-actions"'));
    execFileSync('python3', [path.join(__dirname, 'apply-layout.py'), '--check'], {encoding: 'utf8'});
  });

  await test('今日 is the default home and owns the bare URL; old routes still open', () => {
    const app = boot();
    assert.equal(app.qa.S.tab, 'today');
    assert.equal(app.element('#main').getAttribute('data-view'), 'today');
    assert.equal(app.qa.currentLocationHash(), '#tab-today');
    assert.equal(app.qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/'), '#tab-today');
    assert.equal(app.qa.parseRoute('#tab-notebook').tab, 'notebook');
    assert.equal(app.qa.parseRoute('#tab-today').tab, 'today');
    app.action('tab', 'notebook');
    assert.equal(app.location.hash, '#tab-notebook');
    app.action('tab', 'today');
    assert.equal(app.location.hash, '');
  });

  await test('the rail groups every tab once under 今日、閱讀、筆試、面試、我的', () => {
    const app = boot(), nav = app.nav();
    wellFormed(nav);
    const labels = [...nav.matchAll(/<p class="nav-group-label">([^<]+)<\/p>/g)].map(m => m[1]);
    assert.deepEqual(labels, ['閱讀', '筆試', '面試', '我的']);
    const order = [...nav.matchAll(/data-action="tab" data-value="([a-z]+)"/g)].map(m => m[1]);
    assert.equal(order[0], 'today');
    assert.deepEqual([...order].sort(), Array.from(app.qa.navs, n => n[0]).filter(id => app.qa.tabAllowed(id) && id !== 'learn').sort(), 'each visible tab exactly once; the chapter page has no second entry');
    assert(order.indexOf('notebook') < order.indexOf('quiz') && order.indexOf('quiz') < order.indexOf('interview') && order.indexOf('interview') < order.indexOf('schedule'));
    assert(nav.indexOf('data-value="study"') > nav.indexOf('<p class="nav-group-label">筆試</p>'), '今日複習 sits with 筆試');
  });

  await test('one specialty switcher replaces the pill wall and opens, filters and closes', () => {
    const app = boot();
    let nav = app.nav();
    assert(!nav.includes('specialty-pill'));
    assert.equal((nav.match(/class="spec-item/g) || []).length, 5);
    assert(nav.includes('id="spec-panel" hidden'));
    assert(nav.includes('<span class="spec-current">眼科</span>'));
    app.action('spec-toggle');
    nav = app.nav();
    assert(nav.includes('aria-expanded="true"') && !nav.includes('id="spec-panel" hidden'));
    wellFormed(nav);
    assert.equal(app.handlers.get('input')({target: {id: 'spec-filter', value: '放射', classList: {contains: () => false}, dataset: {}}}), undefined);
    app.action('tab', 'quiz');
    assert(app.nav().includes('id="spec-panel" hidden'), 'changing view closes the switcher');
    const nm = boot({search: '?s=nm'});
    assert(nm.nav().includes('<span class="spec-current">核子醫學科</span>'));
    assert(nm.nav().includes('href="./?s=nm" aria-current="page"'));
  });

  await test('今日 renders review counts, continue cards and every chapter without the schedule', () => {
    const app = boot();
    const main = app.main();
    wellFormed(main);
    assert(main.includes('<h1>今日</h1>'));
    assert(main.includes('今日複習') && main.includes('現在到期'));
    const chapters = app.qa.D.topics.filter(t => t.chapter);
    assert.equal((main.match(/class="chapter-tile"/g) || []).length, chapters.length);
    assert(main.includes('data-action="learn-topic"') && main.includes('data-action="practice-topic"') && main.includes('data-action="interview"'));
    assert(!main.includes('undefined') && !main.includes('NaN'));
    const now = Date.now(), soon = new Date(now - 60000).toISOString(), later = new Date(now + 3 * DAY).toISOString();
    app.qa.entries['study:srs:shared:q1'] = {version: 1, at: soon, answerCount: 1, attempt: {id: 'a', at: soon, correct: false, rated: true}, plan: {step: -1, dueAt: soon, rating: 'again', reviewCount: 1, lapses: 1}};
    app.qa.entries['study:srs:shared:q2'] = {version: 1, at: soon, answerCount: 1, attempt: {id: 'b', at: soon, correct: true, rated: true}, plan: {step: 1, dueAt: later, rating: 'good', reviewCount: 1, lapses: 0}};
    app.qa.render();
    const counts = [...app.main().matchAll(/<div><span>(現在到期|今日稍後|弱項)<\/span><strong>(\d+)<\/strong><\/div>/g)].map(m => [m[1], Number(m[2])]);
    assert.deepEqual(counts, [['現在到期', 1], ['今日稍後', 0], ['弱項', 1]]);
    assert(app.main().includes('開始今日複習'));
  });

  await test('今日 review counts skip saved reviews of questions removed from the bank', () => {
    const app = boot();
    const soon = new Date(Date.now() - 60000).toISOString();
    const due = id => ({version: 1, at: soon, answerCount: 1, attempt: {id, at: soon, correct: false, rated: true}, plan: {step: -1, dueAt: soon, rating: 'again', reviewCount: 1, lapses: 1}});
    const counts = () => [...app.main().matchAll(/<div><span>(現在到期|今日稍後|弱項)<\/span><strong>(\d+)<\/strong><\/div>/g)].map(m => [m[1], Number(m[2])]);
    assert(!app.qa.D.questions.some(q => q.id === 'q9'), 'q9 was removed as a duplicate');
    app.qa.entries['study:srs:shared:q1'] = due('a');
    app.qa.entries['study:srs:shared:q9'] = due('b');
    app.qa.render();
    assert.deepEqual(counts(), [['現在到期', 1], ['今日稍後', 0], ['弱項', 1]]);
    app.qa.entries['study:srs:book:ch01-q1'] = due('c');
    app.qa.render();
    assert.deepEqual(counts(), [['現在到期', 2], ['今日稍後', 0], ['弱項', 2]], 'textbook and extra pools are still counted');
  });

  await test('今日 shows deadlines and the next exam day from the schedule file', async () => {
    const schedule = {schemaVersion: 1, timezone: 'Asia/Taipei', updatedAt: inDays(0), hospitals: [
      {id: 'a', name: '甲醫院', events: [
        {id: 'a-d', type: 'deadline', title: '線上報名截止', date: inDays(0), time: null, verifiedAt: inDays(0)},
        {id: 'a-w', type: 'written', title: '筆試', date: inDays(5), time: null, verifiedAt: inDays(0)},
        {id: 'a-i', type: 'interview', title: '面試', date: inDays(5), time: null, verifiedAt: inDays(0)}]},
      {id: 'b', name: '乙醫院', events: [
        {id: 'b-c', type: 'checkin', title: '報到', date: inDays(6), time: '14:00', verifiedAt: inDays(0), location: '第六會議室'},
        {id: 'b-w', type: 'written', title: '筆試', date: inDays(6), time: '14:10', verifiedAt: inDays(0)},
        {id: 'b-old', type: 'interview', title: '面試', date: inDays(-3), time: '09:00', verifiedAt: inDays(0)}]},
    ]};
    let calls = 0;
    const app = boot({fetchImpl: () => { calls++; return Promise.resolve({ok: true, json: () => Promise.resolve(schedule)}); }});
    assert(app.main().includes('正在讀取考試時程'));
    await settle();
    const main = app.main();
    wellFormed(main);
    assert.equal(calls, 1, 'the schedule is read once');
    assert(main.includes('<h2 id="exam-next">甲醫院</h2>'));
    assert(main.includes('筆試、面試時間待通知'));
    assert(main.includes('<strong>5</strong><span>天後</span>'));
    assert(main.includes('乙醫院') && main.includes('報到 14:00 · 筆試 14:10') && main.includes('6 天'));
    assert(!main.includes('09:00'), 'past events stay off the home page');
    assert(main.includes('deadline-strip') && main.includes('今天') && main.includes('線上報名截止'));
    assert(app.nav().includes('<span class="nav-badge">5 天後</span>'));
    const failed = boot({fetchImpl: () => Promise.resolve({ok: false})});
    await settle();
    assert(failed.main().includes('目前無法讀取考試時程'));
    const nm = boot({search: '?s=nm', fetchImpl: () => { throw Error('non-oph must not read the ophthalmology schedule'); }});
    assert(!nm.main().includes('exam-hero'));
    wellFormed(nm.main());
  });

  await test('each subject has one home: folded quick-review topics, one chapter entry, cases linked to 面試演練', () => {
    const app = boot(), D = app.qa.D;
    const legacy = D.topics.filter(t => !t.chapter), chapters = D.topics.filter(t => t.chapter);
    assert.equal(legacy.length, 12);
    app.action('learn-topic', 'notes-07');
    let main = app.main();
    wellFormed(main);
    const menu = [...main.matchAll(/class="topic-button[^"]*" data-action="learn-topic" data-value="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(menu, chapters.map(t => t.id), 'the chapter menu lists the 14 chapters only');
    assert(main.includes('<h1>章節教材</h1>') && main.includes('共筆 07 / 14'));
    assert(app.nav().includes('data-value="notebook" aria-current="page"'), '章節教材 stays selected while reading a chapter');
    assert(!app.nav().includes('data-value="learn"'));
    const chapter = D.topics.find(t => t.id === 'notes-07');
    assert(main.includes('class="lesson-block chapter-cases"') && main.includes('data-action="interview" data-value="notes-07-case-1"'));
    assert(!main.includes(chapter.cases[0].answer.slice(0, 40)), 'case answers live only in 面試演練');
    assert(main.includes('data-action="learn-topic" data-value="glaucoma"'), 'the folded topic is linked from its chapter');
    app.action('learn-topic', 'notes-14');
    for (const id of ['red-eye', 'vision-loss']) assert(app.main().includes(`data-action="learn-topic" data-value="${id}"`));
    app.action('learn-topic', 'red-eye');
    main = app.main();
    wellFormed(main);
    assert(main.includes('class="merged-note"') && main.includes('data-value="notes-14"'), 'old topic pages point to their chapter');
    assert(main.includes('快速重點 · 已併入共筆 14'));
    app.action('practice-topic', 'notes-07');
    const own = D.questions.filter(q => q.topicId === 'notes-07').map(q => q.id), folded = D.questions.filter(q => q.topicId === 'glaucoma').map(q => q.id);
    assert(folded.length > 0);
    assert.deepEqual(Array.from(app.qa.S.ids), [...own, ...folded], 'chapter questions first, folded ones after');
    main = app.main();
    for (const t of legacy) assert(!main.includes(`<option value="${t.id}"`), 'quiz topics list chapters only');
    app.action('tab', 'notebook');
    main = app.main();
    wellFormed(main);
    assert(main.includes('<h1>章節教材</h1>') && !main.includes('home-hero') && !main.includes('stat-tile'), 'no repeat of the 今日 card and tiles');
    app.action('tab', 'progress');
    for (const t of legacy) assert(!app.main().includes(`data-action="learn-topic" data-value="${t.id}"`), 'progress rows list chapters only');
    const nm = boot({search: '?s=nm'});
    nm.action('tab', 'learn');
    const nmMenu = [...nm.main().matchAll(/class="topic-button[^"]*" data-action="learn-topic" data-value="([^"]+)"/g)].length;
    assert.equal(nmMenu, nm.qa.D.topics.length, 'other specialties keep every topic');
  });

  await test('the interview page splits practice and references into columns', () => {
    const app = boot();
    for (const id of ['intro', app.qa.D.interview.find(i => i.clinical).id]) {
      app.action('interview', id);
      const main = app.main();
      wellFormed(main);
      assert(main.includes('class="two-col iv-layout"') && main.includes('class="card reading-card iv-practice"'));
      const aside = main.indexOf('<aside class="iv-reference"');
      assert(aside > main.indexOf('id="iv-draft"') && aside > main.indexOf('id="iv-improve"'), 'practice comes first');
      for (const part of ['class="model"', 'class="followup"']) assert(main.indexOf(part) > aside, part + ' belongs in the reference column');
      assert.equal((main.match(/id="iv-draft"/g) || []).length, 1);
    }
  });

  await test('top-bar menu, site search and the phone tab bar drive the same views', () => {
    const app = boot();
    assert(app.tabbar().includes('data-value="today" aria-current="page"'));
    assert.equal((app.tabbar().match(/class="tabbar-item/g) || []).length, 5);
    assert.equal(app.element('.shell').getAttribute('data-tab'), 'today');
    app.action('top-menu');
    assert(app.element('.topbar').classList.contains('menu-open'));
    assert.equal(app.element('.top-menu-toggle').getAttribute('aria-expanded'), 'true');
    app.action('tab', 'quiz');
    assert(!app.element('.topbar').classList.contains('menu-open'), 'switching view closes the menu');
    assert(app.tabbar().includes('data-value="quiz" aria-current="page"'));
    assert.equal(app.element('.shell').getAttribute('data-tab'), 'quiz');
    app.action('tab', 'schedule');
    assert(app.tabbar().includes('data-action="more-toggle" aria-controls="nav" aria-expanded="false" aria-current="page"'));
    app.action('more-toggle');
    assert(app.element('.rail').classList.contains('nav-open'));
    assert.equal(app.element('#nav-toggle').getAttribute('aria-expanded'), 'true');
    app.action('tab', 'interview');
    assert(!app.element('.rail').classList.contains('nav-open'));
    let prevented = false;
    app.handlers.get('submit')({preventDefault() { prevented = true; }, target: {matches: s => s === '[data-top-search-form]', querySelector: () => ({value: '  RAPD  ', blur() {}})}});
    assert(prevented);
    assert.equal(app.qa.S.tab, 'notebook');
    assert.equal(app.qa.S.search, 'RAPD');
    assert(app.main().includes('value="RAPD"'));
    app.handlers.get('submit')({preventDefault() { throw Error('other forms must submit normally'); }, target: {matches: () => false}});
  });

  await test('筆試練習 integrates BCSC S01–S13, Hard clinical reasoning, and Extra cases while keeping core mode intact', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/textbook-manifest.json'), 'utf8'));
    const bcsc01 = JSON.parse(fs.readFileSync(path.join(root, 'content/textbook-depth/bcsc-s01.json'), 'utf8'));
    const hardPack = JSON.parse(fs.readFileSync(path.join(root, 'content/textbook-depth/advanced-practice.json'), 'utf8'));
    const extraPack = JSON.parse(fs.readFileSync(path.join(root, 'content/textbook-depth/additional-practice.json'), 'utf8'));
    const fetchImpl = url => {
      const u = String(url);
      if (u.includes('exam-schedule.json')) return Promise.resolve({ok: true, json: () => Promise.resolve({schemaVersion: 1, hospitals: []})});
      if (u.includes('textbook-manifest.json')) return Promise.resolve({ok: true, json: () => Promise.resolve({...manifest, books: [manifest.books[0]]})});
      if (u.includes('bcsc-s01.json')) return Promise.resolve({ok: true, json: () => Promise.resolve(bcsc01)});
      if (u.includes('advanced-practice.json')) return Promise.resolve({ok: true, json: () => Promise.resolve(hardPack)});
      if (u.includes('additional-practice.json')) return Promise.resolve({ok: true, json: () => Promise.resolve(extraPack)});
      return Promise.resolve({ok: false});
    };
    const app = boot({fetchImpl});
    await settle();
    // 今日 has quick-launch buttons for BCSC, Hard, and Extra
    assert(app.main().includes('data-today-quiz-banks'));
    for (const mode of ['bcsc', 'hard', 'extra']) {
      assert(app.main().includes(`data-action="quiz-bank-open" data-value="${mode}"`));
    }
    // Open #quiz in default core mode
    app.action('tab', 'quiz');
    let main = app.main();
    wellFormed(main);
    assert(main.includes('data-quiz-bank-switcher'));
    assert(main.includes('data-quiz-adv-banner'));
    for (const mode of ['core', 'bcsc', 'hard', 'extra', 'all-advanced']) {
      assert(main.includes(`data-quiz-bank="${mode}"`), 'missing switcher button for ' + mode);
    }
    assert(main.includes('id="topic-filter"') && main.includes('id="mode-filter"'), 'core controls remain untouched');

    // Switch to BCSC mode
    app.action('quiz-bank', 'bcsc');
    await settle();
    main = app.main();
    wellFormed(main);
    assert(main.includes('data-quiz-adv-toolbar') && main.includes('id="quizList"'));
    assert(main.includes('id="quiz-adv-volume"') && main.includes('id="quiz-adv-status"') && main.includes('id="qShuffle"') && main.includes('id="qResetShown"'));
    const q1 = bcsc01.questions[0];
    assert(main.includes(`data-question-id="${q1.id}"`));
    // Answer a BCSC question and verify 4-option rationale + whenTrue reveal
    app.action('quiz-adv-answer', `${q1.id}|${q1.correctIndex}`);
    main = app.main();
    wellFormed(main);
    assert.equal(app.qa.entries['textbook:question:' + q1.id]?.choice, q1.correctIndex);
    assert.equal(app.qa.entries['textbook:question:' + q1.id]?.revealed, true);
    assert(main.includes('data-quiz-adv-rationales') && main.includes('條件反轉（何時成立）'));

    // Switch to Hard mode
    app.action('quiz-bank', 'hard');
    await settle();
    main = app.main();
    wellFormed(main);
    assert(main.includes('data-quiz-hard-actions') && main.includes('id="quiz-adv-domain"'));
    const hq = hardPack.questions[0];
    assert(main.includes(`data-question-id="${hq.id}"`));
    app.action('quiz-adv-answer', `${hq.id}|${hq.correctIndex}`);
    main = app.main();
    wellFormed(main);
    assert.equal(app.qa.entries['textbook:extra-question:' + hq.id]?.choice, hq.correctIndex);
    assert(main.includes('data-quiz-adv-reasoning') && main.includes('關鍵鑑別點'));

    // Switch to Extra 120 mode
    app.action('quiz-bank', 'extra');
    await settle();
    main = app.main();
    wellFormed(main);
    const eq = extraPack.questions[0];
    assert(main.includes(`data-question-id="${eq.id}"`));

    // Switch back to core mode
    app.action('quiz-bank', 'core');
    main = app.main();
    wellFormed(main);
    assert(main.includes('id="topic-filter"') && main.includes('id="mode-filter"'));

    // Non-oph specialty does not show ophthalmology quiz bank switcher
    const nm = boot({search: '?s=nm'});
    nm.action('tab', 'quiz');
    assert(!nm.main().includes('data-quiz-bank-switcher'));
  });

  console.log(JSON.stringify({passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, results}, null, 2));
  if (results.some(x => !x.pass)) process.exitCode = 1;
})();
