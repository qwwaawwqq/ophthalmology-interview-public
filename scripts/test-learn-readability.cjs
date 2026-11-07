#!/usr/bin/env node
// Readability, default auto-expand, 3-way study mode switch, and high-yield exam/trap
// highlighting regression tests for chapter reading view (Issue #190).
// Usage: node scripts/test-learn-readability.cjs [index.html]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const rootDir = path.join(__dirname, '..');
const input = process.argv[2] || path.join(rootDir, 'index.html');
const html = fs.readFileSync(input, 'utf8');

const blocks = Object.fromEntries(
  [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)]
    .map(m => [m[1], m[2]])
);
const payload = blocks['course-data'];
assert(payload, 'The app must include its course-data payload.');

const registryScript = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/)?.[1] || '';
let script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(script, 'The app must include its application script.');

const writtenQaPath = path.join(__dirname, 'written-qa.js');
const writtenQaScript = fs.existsSync(writtenQaPath) ? fs.readFileSync(writtenQaPath, 'utf8') : '';
const ophWrittenPackPath = path.join(rootDir, 'content', 'written-qa', 'oph.json');
const ophWrittenPack = fs.existsSync(ophWrittenPackPath)
  ? JSON.parse(fs.readFileSync(ophWrittenPackPath, 'utf8'))
  : null;

const elements = new Map();
const handlers = new Map();
const blobs = [];
const domEvents = [];
const anchorNodes = new Map();
const windowHandlers = new Map();

function element(key) {
  if (!elements.has(key)) {
    const classes = new Set();
    const attrs = {};
    elements.set(key, {
      textContent: '',
      innerHTML: '',
      value: '',
      hidden: false,
      style: { setProperty() {} },
      classList: {
        add(v) { classes.add(v); },
        remove(v) { classes.delete(v); },
        contains(v) { return classes.has(v); },
        toggle(v, force) {
          const next = force === undefined ? !classes.has(v) : force;
          next ? classes.add(v) : classes.delete(v);
          return next;
        },
      },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      focus() {},
      scrollIntoView() {},
      click() {},
      querySelector(sel) { return element(sel); },
      querySelectorAll() { return []; },
      addEventListener(name, fn) { handlers.set(key + ':' + name, fn); },
    });
  }
  return elements.get(key);
}

const document = {
  currentScript: { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/written-qa.js' },
  getElementById(id) {
    if (id in blocks) return { textContent: blocks[id] };
    return renderedAnchor(id);
  },
  querySelector: element,
  querySelectorAll() { return []; },
  createElement: () => element('anchor'),
  addEventListener(name, fn) { handlers.set(name, fn); },
};

class MockURL extends URL {}
MockURL.createObjectURL = blob => { blobs.push(blob); return 'blob:qa'; };
MockURL.revokeObjectURL = () => {};

const window = {
  addEventListener(name, fn) { windowHandlers.set(name, fn); },
  scrollTo() {},
  confirm: () => true,
  location: {
    hash: '',
    search: '',
    href: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/',
    origin: 'https://qwwaawwqq.github.io',
    pathname: '/ophthalmology-interview-public/',
  },
  history: {
    replaceState(_state, _title, hash) {
      window.location.hash = String(hash || '');
    },
  },
};
window.window = window;
window.document = document;

const context = {
  document,
  window,
  Blob,
  URL: MockURL,
  URLSearchParams,
  Intl,
  Date,
  Set,
  Map,
  Object,
  Array,
  String,
  Number,
  Boolean,
  JSON,
  Math,
  RegExp,
  Promise,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  setInterval() {},
  clearInterval() {},
  setTimeout() {},
  clearTimeout() {},
  requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); },
};

const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(script), 'The test hook must match the app bootstrap.');
script = script.replace(
  end,
  'globalThis.__qa={D,S,get entries(){return entries;},get meta(){return meta;},startQuiz,question,mergeProgress,validateEntry,validateMeta,stats,notebookIndex,exportProgress,render,coverageFocus,coverageRestoreHash,coveragePageLabel,coverageOverview,coverageOutline};render();})();'
);

vm.createContext(context);
if (registryScript) {
  vm.runInContext(registryScript, context);
  window.OphSpecialty = context.window.OphSpecialty;
}
if (writtenQaScript) {
  vm.runInContext(writtenQaScript, context);
  if (ophWrittenPack && context.window.OphWritten?.prime) {
    context.window.OphWritten.prime(ophWrittenPack, 'oph');
  }
}
vm.runInContext(script, context, { timeout: 10000 });

const qa = context.__qa;
const results = [];

function test(name, run) {
  try {
    run();
    results.push({ name, pass: true });
  } catch (error) {
    results.push({ name, pass: false, message: error.message });
  }
}

function action(name, value = '') {
  handlers.get('click')({
    preventDefault() {},
    target: { closest: () => ({ dataset: { action: name, value }, disabled: false }) },
  });
}

function main() {
  return element('#main').innerHTML;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, entity => {
    const fixed = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
    if (fixed[entity]) return fixed[entity];
    return String.fromCodePoint(
      entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
    );
  });
}

// Small structural parser for controlled app templates.
function parse(markup) {
  const root = { tag: 'root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const tokens = markup.match(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = token.match(/^<\/\s*([^\s>]+)/)[1].toLowerCase();
      const index = stack.map(node => node.tag).lastIndexOf(tag);
      assert(index > 0, 'Unexpected closing tag in template: ' + tag);
      assert.equal(index, stack.length - 1, 'Unclosed child before closing ' + tag);
      stack.pop();
    } else if (token.startsWith('<')) {
      const match = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      assert(match, 'Unparseable template tag: ' + token);
      const tag = match[1].toLowerCase();
      const attrs = {};
      for (const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      const node = { tag, attrs, children: [], parent: stack.at(-1) };
      node.parent.children.push(node);
      if (!voids.has(tag) && !token.endsWith('/>')) stack.push(node);
    } else {
      stack.at(-1).children.push({ tag: '#text', value: decode(token), attrs: {}, children: [], parent: stack.at(-1) });
    }
  }
  assert.equal(stack.length, 1, 'Template has unclosed tags.');
  return root;
}

function all(node, predicate) {
  return [node, ...node.children.flatMap(child => all(child, () => true))].filter(predicate);
}

function byId(tree, id) {
  return all(tree, node => node.attrs?.id === id)[0] || null;
}

function hasClass(node, cls) {
  return Boolean(node?.attrs?.class && node.attrs.class.split(/\s+/).includes(cls));
}

function text(node) {
  return node.tag === '#text' ? node.value : node.children.map(text).join('');
}

function normalized(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function hasText(node, value) {
  return normalized(text(node)).includes(normalized(value));
}

function renderedAnchor(id) {
  const tree = parse(main());
  const found = byId(tree, id);
  if (!found) return null;
  function wrap(node) {
    if (!node) return null;
    const wrapper = {
      tagName: node.tag.toUpperCase(),
      open: Object.hasOwn(node.attrs, 'open'),
      parentElement: wrap(node.parent),
      setAttribute(key, value) { node.attrs[key] = String(value); },
      focus() { domEvents.push({ type: 'focus', tag: node.tag, id }); },
      scrollIntoView() { domEvents.push({ type: 'scroll', id }); },
      querySelector(selector) {
        return selector === 'summary' ? wrap(node.children.find(child => child.tag === 'summary')) : null;
      },
    };
    return wrapper;
  }
  const result = wrap(found);
  anchorNodes.set(id, result);
  return result;
}

test('1. Default Auto-Expand on Chapter Load (#topic-notes-02 / learn-topic)', () => {
  action('learn-topic', 'notes-02');
  assert.equal(qa.S.learnExpandAll, true, 'S.learnExpandAll must default to true on learn-topic');
  assert.equal(qa.S.recall, false, 'S.recall must default to false on learn-topic');

  const tree = parse(main());
  const readingCard = all(tree, node => hasClass(node, 'reading-card'))[0] || tree;

  // .coverage-outline (#notes-02-coverage)
  const outline = byId(readingCard, 'notes-02-coverage');
  assert(outline && hasClass(outline, 'coverage-outline'), 'notes-02-coverage (.coverage-outline) must exist');
  assert(Object.hasOwn(outline.attrs, 'open'), '#notes-02-coverage must have open attribute by default');

  // all .coverage-entry nodes
  const covEntries = all(readingCard, node => node.tag === 'details' && hasClass(node, 'coverage-entry'));
  assert(covEntries.length > 0, '.coverage-entry nodes must exist');
  assert(covEntries.every(node => Object.hasOwn(node.attrs, 'open')), 'every .coverage-entry must have open attribute');

  // all .coverage-answer nodes
  const covAnswers = all(readingCard, node => node.tag === 'details' && hasClass(node, 'coverage-answer'));
  assert(covAnswers.length > 0, '.coverage-answer nodes must exist');
  assert(covAnswers.every(node => Object.hasOwn(node.attrs, 'open')), 'every .coverage-answer must have open attribute');

  // all .integrated-reference nodes
  const intRefs = all(readingCard, node => node.tag === 'details' && hasClass(node, 'integrated-reference'));
  assert(intRefs.length > 0, '.integrated-reference nodes must exist');
  assert(intRefs.every(node => Object.hasOwn(node.attrs, 'open')), 'every .integrated-reference must have open attribute');

  // all .enrichment-detail nodes (including deep dives, oral challenge answer, and .integrated-case-answer)
  const enrichDetails = all(readingCard, node => node.tag === 'details' && hasClass(node, 'enrichment-detail'));
  assert(enrichDetails.length > 0, '.enrichment-detail nodes must exist');
  assert(enrichDetails.every(node => Object.hasOwn(node.attrs, 'open')), 'every .enrichment-detail must have open attribute');

  const caseAnswers = all(readingCard, node => node.tag === 'details' && hasClass(node, 'integrated-case-answer'));
  assert(caseAnswers.length > 0, '.integrated-case-answer nodes must exist');
  assert(caseAnswers.every(node => Object.hasOwn(node.attrs, 'open')), 'every .integrated-case-answer must have open attribute');

  // all .integrated-case-step nodes (all stages 1, 2, 3!)
  const caseSteps = all(readingCard, node => node.tag === 'details' && hasClass(node, 'integrated-case-step'));
  assert(caseSteps.length >= 3, 'all 3 stages of .integrated-case-step must exist');
  assert(caseSteps.every(node => Object.hasOwn(node.attrs, 'open')), 'all .integrated-case-step stages (1, 2, 3) must have open attribute');

  // all .enrichment-context-sources and .enrichment-resource-group nodes
  const ctxSources = all(readingCard, node => node.tag === 'details' && hasClass(node, 'enrichment-context-sources'));
  assert(ctxSources.length > 0, '.enrichment-context-sources nodes must exist');
  assert(ctxSources.every(node => Object.hasOwn(node.attrs, 'open')), 'every .enrichment-context-sources must have open attribute');

  const resGroups = all(readingCard, node => node.tag === 'details' && hasClass(node, 'enrichment-resource-group'));
  assert(resGroups.length > 0, '.enrichment-resource-group nodes must exist');
  assert(resGroups.every(node => Object.hasOwn(node.attrs, 'open')), 'every .enrichment-resource-group must have open attribute');

  // .refs (check any .refs on notes-02 and verify non-empty t.refs on examination renders details.refs[open])
  const refsNodes = all(readingCard, node => node.tag === 'details' && hasClass(node, 'refs'));
  assert(refsNodes.every(node => Object.hasOwn(node.attrs, 'open')), '.refs must have open attribute');

  // Every collapsible <details> inside notes-02 chapter reading view has open
  const allDetails = all(readingCard, node => node.tag === 'details');
  assert(allDetails.length > 0, 'chapter reading view must contain <details> elements');
  assert(allDetails.every(node => Object.hasOwn(node.attrs, 'open')), 'every <details> in chapter reading view must have open attribute by default');

  // Inline chapter written Q&A section (#notes-02-written) renders .written-answer-panel visible by default in learn reading mode
  const writtenSection = byId(readingCard, 'notes-02-written');
  assert(writtenSection, '#notes-02-written section must exist');
  const answerPanels = all(writtenSection, node => hasClass(node, 'written-answer-panel'));
  assert(answerPanels.length > 0, '#notes-02-written must render .written-answer-panel visible by default in learn reading mode');

  // Also verify .refs auto-opens on a topic that carries external refs (examination)
  action('learn-topic', 'examination');
  const examTopicTree = parse(main());
  const examRefs = all(examTopicTree, node => node.tag === 'details' && hasClass(node, 'refs'));
  assert(examRefs.length > 0 && examRefs.every(node => Object.hasOwn(node.attrs, 'open')), '.refs must render with open attribute on topics with refs');
  action('learn-topic', 'notes-02');
});

test('2. 3-Way Study Switch Mode Toggle (expand vs off vs on)', () => {
  action('learn-topic', 'notes-02');
  const initialTree = parse(main());
  const studySwitch = all(initialTree, node => hasClass(node, 'study-switch'))[0];
  assert(studySwitch, '.study-switch must exist');
  for (const mode of ['expand', 'off', 'on']) {
    assert(
      all(studySwitch, node => node.tag === 'button' && node.attrs['data-action'] === 'recall' && node.attrs['data-value'] === mode).length === 1,
      'missing study-switch button for mode: ' + mode
    );
  }

  // Clicking action('recall', 'off') (🗂️ 分段收合閱讀) collapses .coverage-outline, .coverage-entry, .coverage-answer, and .integrated-case-step (stages > 0)
  action('recall', 'off');
  assert.equal(qa.S.recall, false, 'S.recall must be false in off mode');
  assert.equal(qa.S.learnExpandAll, false, 'S.learnExpandAll must be false in off mode');

  const offTree = parse(main());
  const offOutline = byId(offTree, 'notes-02-coverage');
  assert(offOutline && !Object.hasOwn(offOutline.attrs, 'open'), '.coverage-outline must be collapsed in off mode');

  const offEntries = all(offTree, node => hasClass(node, 'coverage-entry'));
  assert(offEntries.length > 0 && offEntries.every(node => !Object.hasOwn(node.attrs, 'open')), '.coverage-entry must be collapsed in off mode');

  const offAnswers = all(offTree, node => hasClass(node, 'coverage-answer'));
  assert(offAnswers.length > 0 && offAnswers.every(node => !Object.hasOwn(node.attrs, 'open')), '.coverage-answer must be collapsed in off mode');

  const offSteps = all(offTree, node => hasClass(node, 'integrated-case-step'));
  assert(offSteps.length >= 3, '.integrated-case-step stages must exist in off mode');
  assert(offSteps.slice(1).every(node => !Object.hasOwn(node.attrs, 'open')), '.integrated-case-step stages > 0 must be collapsed in off mode');

  // Clicking action('recall', 'on') (🧠 遮住答案，主動回想) enables active recall mode (S.recall === true)
  action('recall', 'on');
  assert.equal(qa.S.recall, true, 'S.recall must be true in on mode');
  assert.equal(qa.S.learnExpandAll, false, 'S.learnExpandAll must be false in on mode');
  const onTree = parse(main());
  const onAnswers = all(onTree, node => hasClass(node, 'coverage-answer'));
  assert(onAnswers.length > 0 && onAnswers.every(node => !Object.hasOwn(node.attrs, 'open')), '.coverage-answer must remain closed in recall on mode');

  // Clicking action('recall', 'expand') (📖 全展開閱讀（免點開）) restores full auto-expansion (open on all <details>)
  action('recall', 'expand');
  assert.equal(qa.S.recall, false, 'S.recall must be false in expand mode');
  assert.equal(qa.S.learnExpandAll, true, 'S.learnExpandAll must be true in expand mode');
  const expandTree = parse(main());
  const readingCard = all(expandTree, node => hasClass(node, 'reading-card'))[0] || expandTree;
  const allDetails = all(readingCard, node => node.tag === 'details');
  assert(allDetails.length > 0 && allDetails.every(node => Object.hasOwn(node.attrs, 'open')), 'all <details> must be open after switching back to expand mode');
});

test('3. Readability & Visual Highlighting of Exam Test Points (🎯 必考考點) and Often-Confused Traps (⚠️ 常混淆鑑別)', () => {
  action('learn-topic', 'notes-02');
  const tree = parse(main());
  const readingCard = all(tree, node => hasClass(node, 'reading-card'))[0] || tree;

  // .chapter-hy-bar is rendered at the top of #notes-02 with quick-jump links to #notes-02-compare, #notes-02-coverage, and #notes-02-written
  const hyBar = all(readingCard, node => hasClass(node, 'chapter-hy-bar'))[0];
  assert(hyBar, '.chapter-hy-bar must be rendered in chapter view');
  for (const target of ['#notes-02-compare', '#notes-02-coverage', '#notes-02-written']) {
    assert(
      all(hyBar, node => node.tag === 'a' && node.attrs.href === target).length >= 1,
      '.chapter-hy-bar must contain quick-jump link to ' + target
    );
  }

  // .cov-keypoints-box, .cov-testpoint-card (🎯), and .cov-pitfall-card (⚠️) are rendered inside .coverage-entry
  const covEntries = all(readingCard, node => hasClass(node, 'coverage-entry'));
  assert(covEntries.length > 0, '.coverage-entry nodes must exist');
  for (const entryNode of covEntries) {
    assert(
      all(entryNode, node => hasClass(node, 'cov-keypoints-box')).length >= 1,
      '.cov-keypoints-box must be rendered inside .coverage-entry'
    );
    const tpCard = all(entryNode, node => hasClass(node, 'cov-testpoint-card'))[0];
    assert(tpCard && hasText(tpCard, '🎯'), '.cov-testpoint-card (🎯) must be rendered inside .coverage-entry');
    const pfCard = all(entryNode, node => hasClass(node, 'cov-pitfall-card'))[0];
    assert(pfCard && hasText(pfCard, '⚠️'), '.cov-pitfall-card (⚠️) must be rendered inside .coverage-entry');
  }

  // .cov-exam-pill (🎯 必考考點頁) is rendered on coverage entries whose PDF pages overlap kind === 'exam' in reviewedPages
  const chapterCov = qa.D.coverage.chapters['notes-02'];
  const examPages = new Set();
  for (const range of chapterCov.reviewedPages) {
    if (range.kind === 'exam') {
      for (let p = range.from; p <= range.to; p++) examPages.add(p);
    }
  }
  assert(examPages.size > 0, 'notes-02 must have exam pages in reviewedPages');
  for (const entry of chapterCov.entries) {
    const entryNode = byId(readingCard, 'notes-02-coverage-' + entry.id);
    assert(entryNode, 'coverage entry node missing for ' + entry.id);
    const pills = all(entryNode, node => hasClass(node, 'cov-exam-pill'));
    const overlapsExam = entry.pages.some(p => examPages.has(p));
    if (overlapsExam) {
      assert(pills.length >= 1 && hasText(pills[0], '🎯 必考考點頁'), entry.id + ': must render .cov-exam-pill (🎯 必考考點頁)');
    } else {
      assert.equal(pills.length, 0, entry.id + ': should not render .cov-exam-pill when pages do not overlap exam range');
    }
  }

  // mark.hl-test and mark.hl-trap inline highlight tags are present in the chapter DOM,
  // while normalized(text(node)) === normalized(point) remains 100% preserved for every t.sections[].points item!
  const hlTestMarks = all(readingCard, node => node.tag === 'mark' && hasClass(node, 'hl-test'));
  const hlTrapMarks = all(readingCard, node => node.tag === 'mark' && hasClass(node, 'hl-trap'));
  assert(hlTestMarks.length > 0, 'mark.hl-test inline highlight tags must be present in chapter DOM');
  assert(hlTrapMarks.length > 0, 'mark.hl-trap inline highlight tags must be present in chapter DOM');

  const topic = qa.D.topics.find(t => t.id === 'notes-02');
  assert(topic, 'notes-02 topic must exist');
  topic.sections.forEach((sec, idx) => {
    const secNode = byId(readingCard, 'notes-02-section-' + idx);
    assert(secNode, 'missing section node notes-02-section-' + idx);
    const liNodes = all(secNode, node => node.tag === 'li');
    for (const point of sec.points) {
      assert(
        liNodes.some(li => normalized(text(li)) === normalized(point)),
        'normalized(text(node)) === normalized(point) must remain 100% preserved for point: ' + point
      );
    }
  });

  // #notes-02-compare (.compare-callout-section / .compare-trap-table) is present and linked from .enrichment-nav
  const compareSec = byId(readingCard, 'notes-02-compare');
  assert(compareSec, '#notes-02-compare must be present');
  assert(
    hasClass(compareSec, 'compare-callout-section') || all(compareSec, node => hasClass(node, 'compare-callout-section')).length > 0,
    '#notes-02-compare must have .compare-callout-section'
  );
  assert(
    all(compareSec, node => hasClass(node, 'compare-trap-table')).length > 0,
    '#notes-02-compare must contain .compare-trap-table'
  );
  const nav = all(readingCard, node => hasClass(node, 'enrichment-nav'))[0];
  assert(nav, '.enrichment-nav must exist');
  assert(
    all(nav, node => node.tag === 'a' && node.attrs.href === '#notes-02-compare').length >= 1,
    '.enrichment-nav must link to #notes-02-compare'
  );
});

const report = {
  test_kind: 'Chapter learn readability, default auto-expand, 3-way study mode switch, and high-yield highlighting checks',
  passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).length,
  results,
};
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
