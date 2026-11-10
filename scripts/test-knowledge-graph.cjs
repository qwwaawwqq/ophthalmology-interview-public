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
function test(name, fn) {
  try { fn(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, error: String(error && error.stack || error)}); }
}

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

test('node text is escaped', () => {
  const {api} = load();
  const host = stub();
  api.mount(host, {specialtyLabel: '<b>x</b>', topics: [{id: 'a"b', title: '<img onerror=1>', sections: []}]});
  assert(!host.innerHTML.includes('<img') && !host.innerHTML.includes('<b>x'));
});

test('page loads the graph assets and syncs it from the view', () => {
  assert(html.includes('<link rel="stylesheet" href="scripts/knowledge-graph.css">'));
  assert(html.includes('<script src="scripts/knowledge-graph.js" defer></script>'));
  assert(html.includes("window.OphKnowledgeGraph?.sync?.(S.tab==='map'?{specialtyLabel:SPEC.label,topics:D.topics,questions:D.questions,openRoute}:null);"));
  assert(html.indexOf('scripts/knowledge-map.js') < html.indexOf('scripts/knowledge-graph.js'));
});

console.log(JSON.stringify({results}, null, 2));
if (results.some(result => !result.pass)) process.exit(1);
