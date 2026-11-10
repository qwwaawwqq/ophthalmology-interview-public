#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'scripts/knowledge-graph.js'), 'utf8');
const data = JSON.parse(html.match(/<script type="application\/json" id="course-data">([\s\S]*?)<\/script>/)[1]);
const results = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

function stub() {
  const listeners = {};
  const el = {
    style: {}, hidden: false, innerHTML: '', textContent: '', attrs: {}, isConnected: true, listeners,
    classList: {toggle() {}},
    addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; },
    setAttribute(k, v) { el.attrs[k] = v; }, getAttribute(k) { return el.attrs[k]; },
    getBoundingClientRect: () => ({left: 0, top: 0, width: 900, height: 520}),
    getContext: () => null,
    querySelector(sel) { el.children[sel] = el.children[sel] || stub(); return el.children[sel]; },
    querySelectorAll: () => [],
    children: {},
  };
  return el;
}
function load(reduced) {
  const timers = [], cleared = [];
  const win = {
    matchMedia: () => ({matches: Boolean(reduced)}), devicePixelRatio: 1,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout(id) { cleared.push(id); },
    requestAnimationFrame: fn => { timers.push(fn); return timers.length; }, cancelAnimationFrame() {},
    performance: {now: () => 0}, console,
  };
  vm.runInNewContext(source, {window: win, globalThis: win});
  return {api: win.OphKnowledgeGraph, win, timers, cleared};
}
const state = () => ({specialtyLabel: '眼科', topics: data.topics, questions: data.questions, openRoute: hash => { state.opened = hash; return true; }});

test('graph has one node per chapter and per key point, all reachable from the centre', () => {
  const {api} = load();
  const graph = api.buildGraph(state());
  const chapters = data.topics.filter(topic => topic.chapter);
  const points = chapters.reduce((sum, topic) => sum + topic.sections.length, 0);
  assert.equal(graph.chapters.length, chapters.length);
  assert.equal(graph.nodes.length, 1 + chapters.length + points);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length, 'node ids are unique');
  const seen = new Set(['root']);
  for (let grew = true; grew;) {
    grew = false;
    for (const link of graph.links) for (const [a, b] of [[link.a, link.b], [link.b, link.a]]) if (seen.has(a.id) && !seen.has(b.id)) { seen.add(b.id); grew = true; }
  }
  assert.equal(seen.size, graph.nodes.length);
  const retina = graph.byId.get('c:notes-10');
  assert.equal(retina.label, '視網膜與玻璃體');
  assert.equal(retina.questions, data.questions.filter(q => q.topicId === 'notes-10').length);
});

test('legacy quick-review topics are left out when chapters exist; other course data still gets a graph', () => {
  const {api} = load();
  assert(!api.buildGraph(state()).nodes.some(node => node.topicId === 'red-eye'));
  const small = api.buildGraph({specialtyLabel: '耳鼻喉科', topics: [{id: 'a', title: 'A', sections: [{title: 's', points: ['p']}]}, {id: 'b', title: 'B', sections: []}]});
  assert.equal(small.chapters.length, 2);
  assert.equal(small.nodes.length, 4);
});

test('every layout gives each node its own finite position', () => {
  const {api} = load();
  const graph = api.buildGraph(state());
  for (const layout of ['radial', 'columns']) {
    const targets = api.layoutTargets(graph, layout);
    assert.equal(targets.size, graph.nodes.length);
    const keys = new Set();
    for (const [x, y] of targets.values()) { assert(Number.isFinite(x) && Number.isFinite(y)); keys.add(Math.round(x) + ',' + Math.round(y)); }
    assert.equal(keys.size, graph.nodes.length, layout + ' stacks two nodes on one spot');
  }
});

test('mounting draws the three modes, a text chapter list and settled positions', () => {
  const {api} = load();
  const host = stub();
  const instance = api.mount(host, state());
  for (const label of ['力導向圖', '鏡頭巡航', '版面變形', '重置視角']) assert(host.innerHTML.includes(label), label);
  assert.equal((host.innerHTML.match(/data-kg-node="c:/g) || []).length, instance.graph.chapters.length);
  assert(/<canvas[^>]+role="img"[^>]+aria-label="[^"]*章節清單在圖下方/.test(host.innerHTML));
  assert(instance.graph.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  const a = instance.graph.byId.get('c:notes-01'), b = instance.graph.byId.get('c:notes-02');
  assert(Math.hypot(a.x - b.x, a.y - b.y) > 60, 'neighbouring chapters are spaced apart');
});

test('layout morph cycles and returns to the force layout; selecting a chapter offers its route', () => {
  const {api} = load(true);
  const host = stub();
  const instance = api.mount(host, state());
  instance.setMode('morph'); assert.equal(instance.view.layout, 'radial');
  const radial = instance.graph.byId.get('c:notes-01').x;
  instance.setMode('morph'); assert.equal(instance.view.layout, 'columns');
  assert.notEqual(instance.graph.byId.get('c:notes-01').x, radial, 'reduced motion still applies the new layout at once');
  instance.setMode('force'); assert.equal(instance.view.layout, 'force');
  instance.select('c:notes-10');
  const detail = host.children['[data-kg-detail]'].innerHTML;
  assert(detail.includes('視網膜與玻璃體') && detail.includes('data-kg-open="#topic-notes-10"'));
  instance.select('p:notes-10:0');
  assert(host.children['[data-kg-detail]'].innerHTML.includes(data.topics.find(t => t.id === 'notes-10').sections[0].title));
});

test('fly-through visits chapters in order and stops when another mode is chosen', () => {
  const {api, timers} = load(true);
  const instance = api.mount(stub(), state());
  instance.setMode('fly');
  assert.equal(instance.view.fly.index, 0);
  assert.equal(instance.view.selected.id, instance.graph.chapters[0].id);
  instance.setMode('force');
  assert.equal(instance.view.fly, null);
  timers.splice(0).forEach(fn => fn());
  assert.equal(instance.view.fly, null, 'a pending tour step does not restart the tour');
});

test('reduced motion: returning to the force layout settles at once with no animation left to run', () => {
  const {api} = load(true);
  const instance = api.mount(stub(), state());
  instance.setMode('morph');
  instance.setMode('force');
  assert.equal(instance.view.alpha, 0);
  assert.equal(instance.view.morph, null);
  const a = instance.graph.byId.get('c:notes-01'), b = instance.graph.byId.get('c:notes-02');
  assert(Math.hypot(a.x - b.x, a.y - b.y) > 60, 'force layout was re-settled');
});

test('a layout morph drops leftover force energy and its delayed overview is cancelled by the next mode', () => {
  const {api, cleared} = load(false);
  const instance = api.mount(stub(), state());
  assert(instance.view.alpha > 0.02, 'force layout starts warm');
  instance.setMode('morph');
  assert.equal(instance.view.alpha, 0, 'non-force layouts hold no force energy');
  const pendingFit = instance.view.fitTimer;
  assert(pendingFit, 'overview is scheduled after the morph');
  instance.setMode('fly');
  assert(cleared.includes(pendingFit), 'pending overview was cancelled');
  assert.equal(instance.view.fitTimer, 0);
  assert.equal(instance.view.follow.node.id, instance.graph.chapters[0].id, 'camera keeps following the first tour stop');
});

test('chapter question totals come from the page when it supplies a counter', () => {
  const {api} = load();
  const graph = api.buildGraph(Object.assign(state(), {questionCount: topic => topic.id === 'notes-10' ? 99 : 1}));
  assert.equal(graph.byId.get('c:notes-10').questions, 99);
  assert.equal(graph.byId.get('c:notes-01').questions, 1);
});

test('reduced motion: dragging a node moves only that node and does not restart the simulation', () => {
  const {api} = load(true);
  const host = stub();
  const instance = api.mount(host, state());
  const canvas = host.children['.kg-canvas'];
  const node = instance.graph.byId.get('c:notes-03'), other = instance.graph.byId.get('c:notes-09');
  const v = instance.view, sx = 450 + v.tx + node.x * v.scale, sy = 260 + v.ty + node.y * v.scale, before = [other.x, other.y];
  canvas.listeners.pointerdown({clientX: sx, clientY: sy});
  canvas.listeners.pointermove({clientX: sx + 40, clientY: sy + 25});
  canvas.listeners.pointerup({});
  assert.equal(instance.view.alpha, 0);
  assert(Math.abs(node.x - (sx + 40 - 450 - v.tx) / v.scale) < 1e-6, 'dragged node follows the pointer');
  assert.deepEqual([other.x, other.y], before);
});

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/textbook-manifest.json'), 'utf8'));
const fullState = () => Object.assign(state(), {enrichment: data.enrichment, books: manifest.books});

test('cross-chapter links come from the lessons\' declared connections, one per pair, with reasons on both ends', () => {
  const {api} = load();
  const graph = api.buildGraph(fullState());
  const pairs = new Set();
  for (const [id, chapter] of Object.entries(data.enrichment.chapters)) for (const item of (chapter.integrated && chapter.integrated.connections) || []) pairs.add([id, item.topicId].sort().join('|'));
  const cross = graph.links.filter(link => link.kind === 'cross');
  assert(pairs.size >= 14, 'lessons declare connections');
  assert.equal(cross.length, pairs.size);
  const retina = graph.byId.get('c:notes-10');
  const declared = data.enrichment.chapters['notes-10'].integrated.connections[0];
  assert(retina.related.some(entry => entry.id === 'c:' + declared.topicId && entry.reason === declared.reason));
  assert(graph.byId.get('c:' + declared.topicId).related.some(entry => entry.id === 'c:notes-10'), 'the other chapter links back');
});

test('BCSC sections and chapters join the graph, tied to existing course chapters and textbook routes', () => {
  const {api} = load();
  const graph = api.buildGraph(fullState());
  assert.equal(graph.books.length, manifest.books.length);
  const leaves = graph.nodes.filter(node => node.kind === 'leaf');
  assert.equal(leaves.length, manifest.books.reduce((sum, book) => sum + book.chapters.length, 0));
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  for (const book of graph.books) {
    const ties = graph.links.filter(link => link.kind === 'book' && link.b === book);
    assert(ties.length >= 1 && ties.every(link => link.a.kind === 'chapter'), book.id + ' is tied to a chapter');
  }
  assert(leaves.every(leaf => /^#textbook-bcsc-s(0[1-9]|1[0-3])-ch\d{3}$/.test(leaf.route)));
  assert(graph.links.some(link => link.kind === 'book' && link.a.id === 'c:notes-07' && link.b.id === 'b:bcsc-s10'), 'glaucoma chapter ↔ BCSC Glaucoma');
  for (const layout of ['radial', 'columns']) {
    const keys = new Set([...api.layoutTargets(graph, layout).values()].map(([x, y]) => Math.round(x) + ',' + Math.round(y)));
    assert.equal(keys.size, graph.nodes.length, layout + ' stacks two nodes on one spot');
  }
});

test('textbook layer can be hidden, and selecting a section lists its course chapters and route', () => {
  const {api} = load(true);
  const host = stub();
  let instance = api.mount(host, fullState());
  assert(host.innerHTML.includes('data-kg-books') && host.innerHTML.includes('BCSC 原文書清單'));
  instance.select('b:bcsc-s12');
  const detail = host.children['[data-kg-detail]'].innerHTML;
  assert(detail.includes('Retina and Vitreous') && detail.includes('data-kg-node="c:notes-10"') && detail.includes('data-kg-open="#textbook-bcsc-s12"'));
  instance.select('c:notes-10');
  assert(host.children['[data-kg-detail]'].innerHTML.includes('data-kg-node="b:bcsc-s12"'));
  host.listeners.click({target: {closest: sel => sel === '[data-kg-books]' ? {} : null}});
  instance = api.active;
  assert.equal(instance.graph.books.length, 0, 'toggle hides the textbook layer');
  assert(host.innerHTML.includes('已隱藏'));
  host.listeners.click({target: {closest: sel => sel === '[data-kg-books]' ? {} : null}});
  assert.equal(api.active.graph.books.length, manifest.books.length);
});

test('other courses get no textbook nodes even if the catalogue is present', () => {
  const {api} = load();
  const graph = api.buildGraph({specialtyLabel: 'X', topics: [{id: 'ent-01', title: 'A', sections: []}], books: manifest.books});
  assert.equal(graph.books.length, 0);
});

test('a failed catalogue request is retried on the next sync, and a good one adds the textbook layer', async () => {
  const {api, win} = load(true);
  const mapRoot = stub(), host = stub();
  const doc = {getElementById: id => id === 'knowledge-map-root' ? mapRoot : id === 'knowledge-graph-root' ? host : null};
  mapRoot.parentNode = {insertBefore() {}}; mapRoot.ownerDocument = doc; win.document = doc;
  let calls = 0, ok = false;
  win.fetch = () => { calls += 1; return Promise.resolve(ok ? {ok: true, json: () => Promise.resolve(manifest)} : {ok: false}); };
  api.sync(state());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(api.active.graph.books.length, 0);
  ok = true;
  api.sync(state());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'the request is made again after an HTTP error');
  assert.equal(api.active.graph.books.length, manifest.books.length);
  api.sync(state());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'a loaded catalogue is not fetched again');
  api.sync(null);
});

test('node text is escaped', () => {
  const {api} = load();
  const host = stub();
  api.mount(host, {specialtyLabel: '<b>x</b>', topics: [{id: 'a"b', title: '<img onerror=1>', sections: []}]});
  assert(!host.innerHTML.includes('<img') && !host.innerHTML.includes('<b>x'));
});

test('page loads the graph assets and syncs it from the view', () => {
  assert(html.includes('<link rel="stylesheet" href="scripts/knowledge-graph.css">'));
  assert(html.includes('<script src="scripts/knowledge-graph.js" defer></script>'));
  assert(html.includes("window.OphKnowledgeGraph?.sync?.(S.tab==='map'?{specialtyLabel:SPEC.label,topics:D.topics,questions:D.questions,questionCount:t=>topicQuestions(t).length,enrichment:D.enrichment,openRoute}:null);"));
  assert(html.indexOf('scripts/knowledge-map.js') < html.indexOf('scripts/knowledge-graph.js'));
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, error: String(error && error.stack || error)}); }
  }
  console.log(JSON.stringify({results}, null, 2));
  if (results.some(result => !result.pass)) process.exit(1);
})();
