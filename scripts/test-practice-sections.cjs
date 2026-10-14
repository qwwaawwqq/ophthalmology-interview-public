#!/usr/bin/env node
// State/template regression checks for PBL cases, clinical workflows and saved links.
// This mock DOM is not a browser or visual QA.
// Usage: node scripts/test-practice-sections.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const input = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(input, 'utf8');
const payload = html.match(/<script type="application\/json" id="course-data">([\s\S]*?)<\/script>/)?.[1];
assert(payload, 'The app must include its course-data payload.');
let script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(script, 'The app must include its application script.');
const elements = new Map();
const handlers = new Map();
const windowHandlers = new Map();
const blobs = [];
const toasts = [];
function element(key) {
  if (!elements.has(key)) {
    const classes = new Set();
    const attrs = {};
    const node = {
      textContent: '', innerHTML: '', value: '', hidden: false,
      style: {setProperty() {}},
      classList: {
        add(v) { classes.add(v); }, remove(v) { classes.delete(v); },
        contains(v) { return classes.has(v); },
        toggle(v, force) { const next = force === undefined ? !classes.has(v) : force; next ? classes.add(v) : classes.delete(v); return next; },
      },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      focus() {}, scrollIntoView() {}, click() {},
      addEventListener(name, fn) { handlers.set(key + ':' + name, fn); },
    };
    if (key === '#toast') Object.defineProperty(node, 'textContent', {get() { return toasts.at(-1) || ''; }, set(v) { toasts.push(v); }});
    elements.set(key, node);
  }
  return elements.get(key);
}
const document = {
  getElementById(id) { return id === 'course-data' ? {textContent: payload} : element('#' + id); },
  querySelector: element, createElement: () => element('anchor'),
  addEventListener(name, fn) { handlers.set(name, fn); },
};
class MockURL extends URL {}
MockURL.createObjectURL = blob => { blobs.push(blob); return 'blob:qa'; };
MockURL.revokeObjectURL = () => {};
const context = {
  document,
  window: {
    addEventListener(name, fn) { windowHandlers.set(name, fn); }, scrollTo() {}, confirm: () => true,
    location: {hash: '', href: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/', origin: 'https://qwwaawwqq.github.io', pathname: '/ophthalmology-interview-public/', search: ''},
    history: {replaceState(_state, _title, url) { const i = String(url).indexOf('#'); context.window.location.hash = i < 0 ? '' : String(url).slice(i); }},
  },
  Blob, URL: MockURL, Intl, Date, Set, Map, Object, Array, String, Number, JSON, Math, Error, SyntaxError,
  setInterval() {}, setTimeout() {}, clearTimeout() {},
};
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(script), 'The test hook must match the app bootstrap.');
script = script.replace(end, 'globalThis.__qa={D,S,get entries(){return entries;},get meta(){return meta;},mergeProgress,validateEntry,validateMeta,notebookIndex,exportProgress,render,parseRoute,normalizeLinkUrl,linkItems,inOrderPositions,currentLocationHash};render();})();');
vm.createContext(context);
vm.runInContext(script, context, {timeout: 10000});
const qa = context.__qa;
const results = [];
function test(name, run) {
  const result = {name, pass: true};
  results.push(result);
  try {
    const out = run();
    if (out && typeof out.then === 'function') result.pending = out.catch(error => { result.pass = false; result.message = error.message; });
  } catch (error) { result.pass = false; result.message = error.message; }
}
function action(name, value = '', extra = {}) {
  handlers.get('click')({target: {closest: () => ({dataset: {action: name, value}, disabled: false, setAttribute() {}, ...extra})}});
}
function typeInto(id, value) { handlers.get('input')({target: {id, value, classList: {contains: () => false}, dataset: {}}}); }
function change(id, value) { handlers.get('change')({target: {id, value, classList: {contains: () => false}, dataset: {}}}); }
function main() { return element('#main').innerHTML; }
function nav() { return element('#nav').innerHTML; }
function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, e => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"}[e]));
}
// Balanced-tag check for controlled app templates, not an HTML rendering engine.
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
const D = qa.D;

test('navigation lists the three new sections and each page renders well-formed markup', () => {
  for (const [tab, label] of [['pbl', 'PBL 情境'], ['workflow', '臨床流程'], ['links', '我的連結']]) {
    assert(nav().includes(`data-value="${tab}"`) && nav().includes(label), label + ' missing from navigation');
    action('tab', tab);
    assert.equal(qa.S.tab, tab);
    wellFormed(main());
  }
  action('tab', 'notebook');
  assert(main().includes('情境與流程演練'), 'home page should introduce the new sections');
  wellFormed(main());
});

test('every PBL case reveals stages one at a time and ends with learning issues', () => {
  for (const c of D.pbl.cases) {
    action('pbl-open', c.id);
    assert.equal(qa.S.pbl, c.id);
    assert(main().includes('pbl-stage-1') && !main().includes('pbl-stage-2'), c.id + ': only the first stage should be visible');
    assert(!main().includes('id="pbl-wrap"'), c.id + ': learning issues are hidden until the last stage');
    action('pbl-stage'); action('pbl-stage');
    assert(main().includes('pbl-stage-3'), c.id + ': third stage visible');
    assert(main().includes('id="pbl-wrap"') && main().includes('考官可能追問'), c.id + ': wrap-up visible after the last stage');
    for (const x of c.learningIssues) assert(decode(main()).includes(x.issue));
    wellFormed(main());
  }
});

test('PBL notes and completion are kept in progress and survive export/import validation', () => {
  const c = D.pbl.cases[0];
  action('pbl-open', c.id);
  typeInto('pbl-note-0', '事實：視力下降 <b>');
  assert.equal(qa.meta['pbl:' + c.id].notes[0], '事實：視力下降 <b>');
  action('pbl-open', c.id);
  assert(main().includes('事實：視力下降 &lt;b&gt;'), 'notes are escaped when the page re-renders');
  action('pbl-done');
  assert.equal(qa.entries['pbl:' + c.id].done, true);
  assert.deepEqual({...qa.validateEntry('pbl:' + c.id, {done: true, at: '2026-10-13T00:00:00.000Z'})}, {done: true, at: '2026-10-13T00:00:00.000Z'});
  assert.equal(qa.validateEntry('pbl:not-a-case', {done: true}), null);
  const m = qa.validateMeta('pbl:' + c.id, {notes: ['a', 7, 'c', 'extra'], issues: 'x'.repeat(5000), at: '2026-10-13T00:00:00.000Z'});
  assert.deepEqual([...m.notes], ['a', '', 'c']);
  assert.equal(m.issues.length, 4000);
});

test('workflow ordering exercise scores relative order and records the best result', () => {
  for (const w of D.workflows.workflows) {
    assert.equal(new Set(w.steps.map(s => s.title)).size, w.steps.length, w.id + ': step titles must be distinct');
  }
  const w = D.workflows.workflows[0];
  action('workflow-open', w.id);
  action('wf-mode', 'order');
  assert(main().includes('排序練習'));
  const n = w.steps.length;
  // Swap the first two steps: everything else is in order, so n-1 steps are in relative order.
  for (const i of [1, 0, ...Array.from({length: n - 2}, (_, k) => k + 2)]) action('wf-pick', String(i));
  action('wf-check');
  assert(main().includes(`${n - 1} / ${n}`), 'swapping two steps should leave n-1 in order');
  assert.equal(qa.entries['workflow:' + w.id].best, n - 1);
  action('wf-reshuffle');
  for (let i = 0; i < n; i++) action('wf-pick', String(i));
  action('wf-check');
  assert(main().includes('完全正確'));
  assert.equal(qa.entries['workflow:' + w.id].best, n);
  assert.equal(qa.inOrderPositions([2, 0, 1, 3]).size, 3);
  assert.equal(qa.validateEntry('workflow:' + w.id, {practiced: true, best: 99, at: 'x'}).best, 0, 'out-of-range scores are reset on import');
  action('wf-mode', 'recall');
  assert(main().includes('wf-steps is-recall'));
  action('wf-mode', 'read');
  for (const x of D.workflows.workflows) { action('workflow-open', x.id); wellFormed(main()); }
});

test('saved links accept https and in-app locations, and reject unsafe schemes', () => {
  assert.equal(qa.normalizeLinkUrl('javascript:alert(1)'), null);
  assert.equal(qa.normalizeLinkUrl('data:text/html,hi'), null);
  assert.equal(qa.normalizeLinkUrl('#notes-99-section-1'), null);
  assert.equal(qa.normalizeLinkUrl('#notes-02-section-2'), '#notes-02-section-2');
  assert.equal(qa.normalizeLinkUrl('https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2'), '#notes-02-section-2');
  assert.equal(qa.normalizeLinkUrl('eyewiki.aao.org/Glaucoma'), 'https://eyewiki.aao.org/Glaucoma');
  action('tab', 'links');
  typeInto('link-url', 'javascript:alert(1)');
  action('link-add');
  assert.equal(qa.linkItems().length, 0, 'unsafe URL must not be saved');
  typeInto('link-url', 'https://eyewiki.aao.org/Glaucoma');
  typeInto('link-title', 'EyeWiki <glaucoma>');
  typeInto('link-note', '看 SLT 段落');
  change('link-topic', 'notes-07');
  action('link-add');
  const saved = qa.linkItems();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].topicId, 'notes-07');
  assert(main().includes('EyeWiki &lt;glaucoma&gt;') && main().includes('target="_blank" rel="noopener noreferrer"'));
  typeInto('link-url', 'https://qwwaawwqq.github.io/ophthalmology-interview-public/#notes-02-section-2');
  typeInto('link-title', '');
  action('link-add');
  const internal = qa.linkItems().find(x => x.url === '#notes-02-section-2');
  assert(internal && internal.title.includes(D.topics.find(t => t.id === 'notes-02').sections[2].title), 'in-app links get a readable default title');
  wellFormed(main());
});

test('in-app links, section bookmarks and the hash open the matching view', () => {
  const internal = qa.linkItems().find(x => x.url === '#notes-02-section-2');
  action('tab', 'links');
  action('link-open', internal.id);
  assert.equal(qa.S.tab, 'learn'); assert.equal(qa.S.learn, 'notes-02');
  assert.equal(context.window.location.hash, '#notes-02-section-2');
  assert(main().includes('data-value="#notes-02-section-2" aria-pressed="true"'), 'saved section shows as bookmarked');
  assert(main().includes('data-value="#notes-02-section-3" aria-pressed="false"'));
  action('link-save', '#notes-02-section-3');
  assert(qa.linkItems().some(x => x.url === '#notes-02-section-3'));
  context.window.location.hash = '#wf-chemical';
  windowHandlers.get('hashchange')();
  assert.equal(qa.S.tab, 'workflow'); assert.equal(qa.S.workflow, 'wf-chemical');
  context.window.location.hash = '#pbl-rb';
  windowHandlers.get('hashchange')();
  assert.equal(qa.S.tab, 'pbl'); assert.equal(qa.S.pbl, 'pbl-rb');
  context.window.location.hash = '#notes-02-section-2';
  windowHandlers.get('load')();
  assert.equal(qa.S.tab, 'learn'); assert.equal(qa.S.learn, 'notes-02');
  action('tab', 'quiz');
  assert.equal(context.window.location.hash, '#tab-quiz', 'navigating away replaces a stale deep link');
  assert.equal(qa.currentLocationHash(), '#tab-quiz');
  action('workflow-open', 'wf-gca');
  assert.equal(context.window.location.hash, '#wf-gca');
  action('link-save-current');
  assert(qa.linkItems().some(x => x.url === '#wf-gca'));
  action('tab', 'notebook');
  assert.equal(context.window.location.hash, '');
});

test('links export, import safely, and deletions are not revived by older files', () => {
  const target = qa.linkItems().find(x => x.url === '#wf-gca');
  action('link-delete', target.id);
  assert(!qa.linkItems().some(x => x.id === target.id));
  assert.equal(qa.meta['link:' + target.id].deleted, true);
  const older = {format: 'ophthalmology-prep-progress-v3', entries: {}, meta: {
    ['link:' + target.id]: {title: 'old', url: '#wf-gca', note: '', at: '2020-01-01T00:00:00.000Z'},
    'link:evil123': {title: 'x', url: 'javascript:alert(1)', at: '2026-10-13T00:00:00.000Z'},
    'link:good1234': {title: '<img src=x onerror=alert(1)>', url: 'https://www.aao.org/', note: 'n', topicId: 'nope', at: '2026-10-13T00:00:00.000Z'},
  }};
  const result = qa.mergeProgress(older);
  assert(!qa.linkItems().some(x => x.id === target.id), 'older copy must not revive a deleted link');
  assert(!qa.meta['link:evil123'], 'unsafe link rejected on import');
  assert.equal(qa.meta['link:good1234'].topicId, '');
  assert(result.skipped >= 1);
  action('tab', 'links');
  assert(!main().includes('<img src=x'), 'imported titles are escaped');
  qa.exportProgress();
  return blobs.at(-1).text().then(text => {
    const exported = JSON.parse(text);
    assert.equal(exported.format, 'ophthalmology-prep-progress-v3');
    assert(exported.meta['link:good1234'] && exported.meta['link:' + target.id].deleted);
  });
});

test('search finds PBL cases and workflows and opens them', () => {
  const index = qa.notebookIndex();
  assert.equal(index.filter(x => x.type === 'PBL 情境').length, D.pbl.cases.length);
  assert.equal(index.filter(x => x.type === '臨床流程').length, D.workflows.workflows.length);
  const hit = index.find(x => x.type === '臨床流程' && x.target === 'wf-aacg');
  action(hit.action, hit.target);
  assert.equal(qa.S.tab, 'workflow'); assert.equal(qa.S.workflow, 'wf-aacg');
  action('tab', 'notebook');
  element('#notebook-search').value = '眼內炎';
  element('#notebook-chapter').value = 'all';
  action('notebook-search');
  assert(main().includes('開啟流程') && main().includes('開啟情境'));
});

test('PBL and workflow cross-links point at existing items', () => {
  const flows = new Set(D.workflows.workflows.map(w => w.id));
  for (const c of D.pbl.cases) for (const id of c.workflowIds) assert(flows.has(id), c.id + ' → ' + id);
  action('pbl-open', 'pbl-gca');
  assert(main().includes('data-action="workflow-open" data-value="wf-gca"'));
  action('workflow-open', 'wf-gca');
  assert(main().includes('data-action="pbl-open" data-value="pbl-gca"'));
});

test('all 46 interview items show a detailed answer pack, follow-up references and can seed the draft', () => {
  const detailed = D.interviewDetailed.answers;
  assert.equal(Object.keys(detailed).length, D.interview.length);
  for (const i of D.interview) {
    action('interview', i.id);
    assert.equal(qa.S.interview, i.id);
    const page = main();
    assert(page.includes('iv-detailed') && page.includes(i.clinical ? '臨床口試完整答法' : '完整示範說法'), i.id + ': detailed section missing');
    assert(decode(page).includes(detailed[i.id].summary), i.id + ': summary missing');
    assert(decode(page).includes(detailed[i.id].followupAnswers[0]), i.id + ': follow-up reference should use the detailed answer');
    assert.equal(detailed[i.id].followupAnswers.length, i.followups.length);
    if (!i.clinical) assert(page.includes('換成自己的版本'), i.id + ': personalisation tips missing');
    wellFormed(page);
  }
  action('interview', 'notes-03-case-1');
  action('use-detailed');
  assert(qa.entries['interview:notes-03-case-1'].draft.includes(detailed['notes-03-case-1'].answer));
  const hits = qa.notebookIndex().filter(x => x.type === '面試詳解');
  assert.equal(hits.length, D.interview.length);
  assert(!JSON.stringify(D.interview).includes('项'), 'simplified characters fixed in interview data');
});

(async () => {
  // Await async checks registered through returned promises.
  for (const r of results) if (r.pending) { await r.pending; delete r.pending; }
  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({input, results}, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
