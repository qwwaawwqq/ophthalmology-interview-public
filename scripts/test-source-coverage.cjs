#!/usr/bin/env node
// State/template regression checks. This mock DOM is not a browser or visual QA.
// Usage: node scripts/test-source-coverage.cjs [index.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const input = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(input, 'utf8');
const payload = html.match(/<script type="application\/json" id="course-data">([\s\S]*?)<\/script>/)?.[1];
assert(payload, 'The app must include its course-data payload.');
let script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(script, 'The app must include its application script.');
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
    });
  }
  return elements.get(key);
}
const document = {
  getElementById(id) { return id === 'course-data' ? {textContent: payload} : renderedAnchor(id); },
  querySelector: element, createElement: () => element('anchor'),
  addEventListener(name, fn) { handlers.set(name, fn); },
};
class MockURL extends URL {}
MockURL.createObjectURL = blob => { blobs.push(blob); return 'blob:qa'; };
MockURL.revokeObjectURL = () => {};
const context = {
  document, window: {addEventListener(name, fn) { windowHandlers.set(name, fn); }, scrollTo() {}, confirm: () => true, location: {hash: ''}, history: {replaceState(_state, _title, hash) { context.window.location.hash = hash; }}},
  Blob, URL: MockURL, Intl, Date, Set, Object, Array, String, Number, JSON, Math, Error, SyntaxError,
  setInterval() {}, setTimeout() {}, clearTimeout() {},
};
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(script), 'The test hook must match the app bootstrap.');
script = script.replace(end, 'globalThis.__qa={D,S,get entries(){return entries;},get meta(){return meta;},startQuiz,question,mergeProgress,validateEntry,validateMeta,stats,notebookIndex,exportProgress,render,coverageFocus,coverageRestoreHash,coveragePageLabel,coverageOverview,coverageOutline};render();})();');
vm.createContext(context);
vm.runInContext(script, context, {timeout: 10000});
const qa = context.__qa;
const results = [];
const at = '2026-10-11T08:00:00.000Z';
function test(name, run) {
  try { run(); results.push({name, pass: true}); }
  catch (error) { results.push({name, pass: false, message: error.message}); }
}
function action(name, value = '') {
  handlers.get('click')({preventDefault() {},target: {closest: () => ({dataset: {action: name, value}, disabled: false})}});
}
function change(target) {
  handlers.get('change')({target: {classList: {contains: () => false}, ...target}});
}
function main() { return element('#main').innerHTML; }
function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, entity => {
    const fixed = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'"};
    if (fixed[entity]) return fixed[entity];
    return String.fromCodePoint(entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10));
  });
}
// Small structural parser for controlled app templates, not an HTML rendering engine.
function parse(markup) {
  const root = {tag: 'root', attrs: {}, children: [], parent: null};
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
      const node = {tag, attrs, children: [], parent: stack.at(-1)};
      node.parent.children.push(node);
      if (!voids.has(tag) && !token.endsWith('/>')) stack.push(node);
    } else {
      stack.at(-1).children.push({tag: '#text', value: decode(token), attrs: {}, children: [], parent: stack.at(-1)});
    }
  }
  assert.equal(stack.length, 1, 'Template has unclosed tags.');
  return root;
}
function all(node, predicate) {
  return [node, ...node.children.flatMap(child => all(child, () => true))].filter(predicate);
}
function text(node) { return node.tag === '#text' ? node.value : node.children.map(text).join(''); }
function normalized(value) { return value.replace(/\s+/g, ' ').trim(); }
function hasText(node, value) { return normalized(text(node)).includes(normalized(value)); }
function headings(tree, value) { return all(tree, node => (/^h[1-6]$/.test(node.tag) || node.tag === 'summary') && normalized(text(node)).replace(/^\d+\s*/, '') === normalized(value)); }
function ancestors(node) {
  const out = [];
  for (let parent = node.parent; parent; parent = parent.parent) out.push(parent);
  return out;
}
function closedDetailsContaining(tree, value, label) {
  const matches = all(tree, node => node.tag !== '#text' && hasText(node, value) && !node.children.some(child => child.tag !== '#text' && hasText(child, value)));
  assert(matches.length, label + ': explanation missing from template');
  for (const match of matches) {
    const chain = [match, ...ancestors(match)];
    assert(chain.some(node => node.tag === 'details' && !Object.hasOwn(node.attrs, 'open') && !chain.some(child => child.tag === 'summary' && child.parent === node)), label + ': explanation is visible outside a closed details answer');
  }
}
function uniqueIds(tree, label) {
  const ids = all(tree, node => Object.hasOwn(node.attrs, 'id')).map(node => node.attrs.id);
  assert.equal(new Set(ids).size, ids.length, label + ': duplicate DOM IDs');
}
function chapterTree(id, recall = false) {
  action('learn-topic', id);
  action('recall', recall ? 'on' : 'off');
  return parse(main());
}

function renderedAnchor(id) {
  const tree = parse(main());
  const found = all(tree, node => node.attrs.id === id)[0];
  if (!found) return null;
  function wrap(node) {
    if (!node) return null;
    const wrapper = {
      tagName: node.tag.toUpperCase(), open: Object.hasOwn(node.attrs, 'open'),
      parentElement: wrap(node.parent),
      setAttribute(key, value) { node.attrs[key] = String(value); },
      focus() { domEvents.push({type: 'focus', tag: node.tag, id}); },
      scrollIntoView() { domEvents.push({type: 'scroll', id}); },
      querySelector(selector) { return selector === 'summary' ? wrap(node.children.find(child => child.tag === 'summary')) : null; },
    };
    return wrapper;
  }
  const result = wrap(found);
  anchorNodes.set(id, result);
  return result;
}
const coverage = qa.D.coverage;
assert(coverage && Object.keys(coverage.chapters).length === 14, 'Build all 14 source-coverage chapters before this test.');
const audited = Object.entries(coverage.chapters);
const enrichment = qa.D.enrichment.chapters;
const totalEntries = audited.reduce((n, [,chapter]) => n + chapter.entries.length, 0);
const totalPages = audited.reduce((n, [,chapter]) => n + chapter.pageCount, 0);

test('every source page is reviewed once and all teaching and exam pages map to topics', () => {
  for (const [id, chapter] of audited) {
    const pages = [], required = new Set(), linked = new Set(chapter.entries.flatMap(entry => entry.pages));
    for (const range of chapter.reviewedPages) {
      assert(['teaching', 'exam', 'administrative'].includes(range.kind));
      assert(range.from >= 1 && range.to <= chapter.pageCount && range.from <= range.to);
      for (let page = range.from; page <= range.to; page++) {
        pages.push(page); if (range.kind !== 'administrative') required.add(page);
      }
    }
    assert.deepEqual(pages.sort((a,b) => a-b), Array.from({length: chapter.pageCount}, (_,n) => n+1), id + ': overlapping or unaudited pages');
    for (const page of required) assert(linked.has(page), id + ': page has no topic ' + page);
    assert.equal(chapter.unresolved.length, 0, id + ': unresolved source audit');
  }
});
test('source entries resolve to integrated units, source pages, original concepts, and clinical references', () => {
  for (const [id, chapter] of audited) {
    const topic = qa.D.topics.find(topic => topic.id === id);
    assert.equal(new Set(chapter.entries.map(entry => entry.id)).size, chapter.entries.length);
    for (const entry of chapter.entries) {
      assert(/^[a-z][a-z0-9-]*$/.test(entry.id));
      assert(enrichment[id].integrated.units.some(unit => unit.id === entry.unitId));
      assert(entry.pages.length && entry.pages.every(page => Number.isInteger(page) && page >= 1 && page <= chapter.pageCount));
      assert(entry.sectionIndexes.length && entry.sectionIndexes.every(index => topic.sections[index]));
      assert(entry.sourceIds.length && entry.sourceIds.every(ref => enrichment[id].resources.some(resource => resource.id === ref)));
      assert(entry.relatedTopics.every(ref => qa.D.topics.some(topic => topic.id === ref)));
      assert(entry.keyPoints.length >= 2 && entry.keyPoints.length <= 4);
    }
  }
});
test('each topic detail renders exactly once inside its intended integrated unit', () => {
  for (const [id, chapter] of audited) {
    const tree = chapterTree(id);
    uniqueIds(tree, id);
    for (const entry of chapter.entries) {
      const nodes = all(tree, node => node.attrs.id === id + '-coverage-' + entry.id);
      assert.equal(nodes.length, 1, id + ': missing or duplicate source entry ' + entry.id);
      const node = nodes[0];
      assert.equal(node.tag, 'details'); assert(!Object.hasOwn(node.attrs, 'open'));
      assert(ancestors(node).some(parent => parent.attrs.id === id + '-' + entry.unitId), id + ': source lesson in wrong unit');
      const summary = node.children.find(child => child.tag === 'summary');
      assert(hasText(summary, entry.title)); assert(hasText(summary, 'PDF 頁 ' + qa.coveragePageLabel(entry.pages)));
      for (const paragraph of entry.keyPoints) assert(hasText(node, paragraph), id + ': missing paragraph');
      for (const key of ['clinicalLink', 'pitfall']) assert(hasText(node, entry[key]), id + ': missing ' + key);
      assert(hasText(node, entry.recall.question));
      closedDetailsContaining(node, entry.recall.answer, id + ': recall answer');
    }
  }
});
test('recall mode keeps source explanations and answers behind an additional closed answer panel', () => {
  for (const [id, chapter] of audited) {
    const tree = chapterTree(id, true);
    for (const entry of chapter.entries) {
      const node = all(tree, node => node.attrs.id === id + '-coverage-' + entry.id)[0];
      const answer = all(node, node => node.tag === 'details' && (node.attrs.class || '').split(' ').includes('coverage-answer'));
      assert.equal(answer.length, 1); assert(!Object.hasOwn(answer[0].attrs, 'open'));
      for (const value of [...entry.keyPoints, entry.clinicalLink, entry.pitfall, entry.recall.answer]) assert(hasText(answer[0], value));
      assert(hasText(node, entry.recall.question));
      assert(!hasText(answer[0], entry.recall.question), id + ': question hidden with answer');
    }
  }
  action('recall', 'off');
});
test('chapter outlines expose every source topic and honest complete page audit labels', () => {
  for (const [id, chapter] of audited) {
    const tree = chapterTree(id);
    const outline = all(tree, node => node.attrs.id === id + '-coverage')[0];
    assert(outline && !Object.hasOwn(outline.attrs, 'open'));
    assert(hasText(outline, chapter.entries.length + ' 個主題'));
    assert(hasText(outline, '核對 ' + chapter.pageCount + ' 頁'));
    assert(hasText(outline, '逐頁核對主題；教學重述，非原文全文或官方考綱。'));
    for (const entry of chapter.entries) assert(all(outline, node => node.tag === 'a' && node.attrs.href === '#' + id + '-coverage-' + entry.id).length === 1);
    for (const range of chapter.reviewedPages) assert(hasText(outline, range.note));
  }
});
test('homepage presents actual chapter, page, and topic counts and every direct source link', () => {
  qa.S.search = ''; qa.S.searchChapter = 'all'; action('tab', 'notebook');
  const tree = parse(main());
  assert(hasText(tree, '14 章 · 核對 ' + totalPages + ' 頁 · ' + totalEntries + ' 個主題詳解'));
  assert(hasText(tree, coverage.scopeNote));
  for (const [id, chapter] of audited) for (const entry of chapter.entries) {
    assert(all(tree, node => node.tag === 'a' && node.attrs['data-action'] === 'coverage-focus' && node.attrs['data-value'] === id + '|coverage-' + entry.id).length === 1);
  }
});
test('search returns one direct entry result with all terms and explanatory content indexed', () => {
  const index = qa.notebookIndex();
  assert.equal(index.filter(item => item.type === '共筆主題詳解').length, totalEntries);
  for (const [id, chapter] of audited) for (const entry of chapter.entries) {
    const result = index.find(item => item.action === 'coverage-focus' && item.target === id + '|coverage-' + entry.id);
    assert(result); assert.equal(result.title, entry.title); assert.equal(result.ref, qa.coveragePageLabel(entry.pages));
    for (const value of [...entry.terms, ...entry.keyPoints, entry.clinicalLink, entry.pitfall, entry.recall.question, entry.recall.answer]) assert(result.body.includes(value));
  }
  const [id, chapter] = audited[0], entry = chapter.entries[0];
  action('tab', 'notebook');
  element('#notebook-search').value = entry.title; element('#notebook-chapter').value = id;
  action('notebook-search');
  const tree = parse(main());
  assert(all(tree, node => node.tag === 'button' && node.attrs['data-action'] === 'coverage-focus' && node.attrs['data-value'] === id + '|coverage-' + entry.id && hasText(node, '閱讀這個主題')).length);
});
test('direct topic navigation opens, focuses, and scrolls the correct detail while preserving recall mode', () => {
  const [id, chapter] = audited.at(-1), entry = chapter.entries.at(-1), anchor = id + '-coverage-' + entry.id;
  action('tab', 'notebook'); qa.S.recall = true;
  action('coverage-focus', id + '|coverage-' + entry.id);
  assert.equal(qa.S.tab, 'learn'); assert.equal(qa.S.learn, id); assert.equal(qa.S.recall, true);
  assert(anchorNodes.get(anchor).open);
  assert(domEvents.some(event => event.type === 'focus' && event.id === anchor));
  assert(domEvents.some(event => event.type === 'scroll' && event.id === anchor));
  assert.equal(context.window.location.hash, '#' + anchor);
  assert.equal(qa.coverageFocus(id + '|coverage-not-a-topic'), false);
});
test('source backlinks open original details and chapter outlines, and deep links restore the right chapter', () => {
  const [id, chapter] = audited[0], entry = chapter.entries[0];
  action('recall', 'off');
  action('coverage-focus', id + '|section-' + entry.sectionIndexes[0]);
  assert(anchorNodes.get(id + '-section-' + entry.sectionIndexes[0]).open);
  action('coverage-focus', id + '|coverage');
  assert(anchorNodes.get(id + '-coverage').open);
  action('tab', 'notebook');
  context.window.location.hash = '#' + id + '-coverage-' + entry.id;
  windowHandlers.get('hashchange')();
  assert.equal(qa.S.learn, id); assert.equal(qa.S.tab, 'learn');
  assert(anchorNodes.get(id + '-coverage-' + entry.id).open);
  assert.equal(typeof windowHandlers.get('load'), 'function');
});
test('source limitations identify affected PDF pages and explain the handling visibly', () => {
  for (const [id, chapter] of audited) {
    const tree = chapterTree(id);
    for (const item of chapter.sourceLimitations || []) {
      assert(item.pages.length && item.pages.every(page => page >= 1 && page <= chapter.pageCount));
      const limitation = all(tree, node => node.attrs['aria-label'] === '原共筆的內容限制')[0];
      assert(limitation, id + ': original source limitation omitted');
      assert(hasText(limitation, 'PDF 頁 ' + qa.coveragePageLabel(item.pages)));
      assert(hasText(limitation, item.reason)); assert(hasText(limitation, item.handling));
    }
  }
});
test('source metadata and author text are escaped before rendering', () => {
  const [id, chapter] = audited[0], entry = chapter.entries[0], original = entry.title;
  try {
    entry.title = '<img src=x onerror=alert(1)> & "quote"';
    const tree = chapterTree(id);
    assert(hasText(tree, entry.title));
    assert(!all(tree, node => node.tag === 'img' && node.attrs.src === 'x').length);
    assert(main().includes('&lt;img'));
  } finally { entry.title = original; }
});

const report = {test_kind: 'Source mapping and JavaScript state/template checks using a mock DOM; not browser or visual QA', chapters: audited.length, source_topics: totalEntries, reviewed_pdf_pages: totalPages, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, results};
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
