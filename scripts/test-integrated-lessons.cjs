#!/usr/bin/env node
// State/template regression checks. This mock DOM is not a browser or visual QA.
// Usage: node scripts/test-integrated-lessons.cjs [index.html]
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
  getElementById(id) { return id === 'course-data' ? {textContent: payload} : element('#' + id); },
  querySelector: element, createElement: () => element('anchor'),
  addEventListener(name, fn) { handlers.set(name, fn); },
};
class MockURL extends URL {}
MockURL.createObjectURL = blob => { blobs.push(blob); return 'blob:qa'; };
MockURL.revokeObjectURL = () => {};
const context = {
  document, window: {addEventListener() {}, scrollTo() {}, confirm: () => true},
  Blob, URL: MockURL, Intl, Date, Set, Object, Array, String, Number, JSON, Math, Error, SyntaxError,
  setInterval() {}, setTimeout() {}, clearTimeout() {},
};
const end = /render\(\);\s*\}\)\(\);\s*$/;
assert(end.test(script), 'The test hook must match the app bootstrap.');
script = script.replace(end, 'globalThis.__qa={D,S,get entries(){return entries;},get meta(){return meta;},startQuiz,question,mergeProgress,validateEntry,validateMeta,stats,notebookIndex,exportProgress,render};render();})();');
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
  handlers.get('click')({target: {closest: () => ({dataset: {action: name, value}, disabled: false})}});
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

test('original course, question, interview, workshop, and study-plan payloads stay unchanged', () => {
  const expected = {
    topics: '8bb67cf1ecef50889eff81a7a7ca5f12ee1c451316dcba0893ade78af0b7a0ee',
    questions: 'f5da0c4a369964ddbdb01da2c4c3879069deac19721c20c23cedc66f263af917',
    // 2026-10-14: only change is the simplified 项 → 項 typo fix in 29 interview strings.
    interview: 'd0d19b39244cf68e0d82393e5edea81ba0ffdcc34389a5e76aa4caecc79c7b78',
    storySeeds: '52c68a1ef5578a6ebbd66e945a15a168e0b93a0a7a6cccfc6e2593e62cd0b9e5',
    evidenceSeeds: 'a7b8b10d16a2608a638b8449214533371698079e454e871fe3d35b6b5757f111',
    plan: '64ca7c5bede8966a3f8ab9f049486a40c75523e841070ae82bf468e3919d7f06',
  };
  for (const [key, hash] of Object.entries(expected)) {
    const value = key === 'questions' ? qa.D.questions.filter(q => !q.pastExam) : qa.D[key];
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'), hash, key + ' content changed');
  }
  assert.equal(qa.D.topics.length, 26);
  assert.equal(qa.D.questions.filter(q => !q.pastExam).length, 294);
  assert.equal(qa.D.interview.length, 46);
});
test('past-exam concept questions are complete and reachable through their own practice filter', () => {
  const pastExam = qa.D.questions.filter(q => q.pastExam);
  assert.equal(pastExam.length, 245);
  for (const q of pastExam) assert(q.options.length === 4 && q.options[q.correctIndex] && q.explanation.startsWith('考點：'), q.id + ': malformed');
  for (let n = 1; n <= 14; n++) assert(pastExam.some(q => q.topicId === 'notes-' + String(n).padStart(2, '0')), 'chapter ' + n + ' has no past-exam question');
  qa.startQuiz('all', 'kaogu');
  assert.deepEqual(qa.S.ids, pastExam.map(q => q.id));
  qa.startQuiz('notes-07', 'kaogu');
  assert(qa.S.ids.length && qa.S.ids.every(id => id.startsWith('notes-07-k')));
  qa.startQuiz();
});
test('all 26 topics render with each original heading and paragraph exactly once', () => {
  for (const topic of qa.D.topics) {
    const tree = chapterTree(topic.id);
    uniqueIds(tree, topic.id);
    assert(hasText(tree, topic.title));
    for (const section of topic.sections) {
      assert.equal(headings(tree, section.title).length, 1, topic.id + ': repeated or missing heading ' + section.title);
      for (const point of section.points) assert.equal(all(tree, node => node.tag === 'li' && normalized(text(node)) === normalized(point)).length, 1, topic.id + ': repeated or missing original point: ' + point.slice(0, 50));
    }
  }
});
test('every enriched chapter renders one accessible diagram with intrinsic dimensions', () => {
  assert.equal(Object.keys(qa.D.enrichment.chapters).length, 14);
  for (const [id, chapter] of Object.entries(qa.D.enrichment.chapters)) {
    const tree = chapterTree(id);
    const images = all(tree, node => node.tag === 'img' && node.attrs.src === 'assets/figures/' + id + '.svg');
    assert.equal(images.length, 1, id + ': figure should be inserted once');
    assert.equal(images[0].attrs.alt, chapter.figure.alt);
    assert(Number(images[0].attrs.width) > 0 && Number(images[0].attrs.height) > 0, id + ': figure needs intrinsic dimensions');
    assert(all(tree, node => node.tag === 'a' && node.attrs.href === images[0].attrs.src).length, id + ': enlarged diagram link missing');
  }
});
test('existing active recall remains hidden until revealed and preserves original rating keys', () => {
  const tree = chapterTree('notes-01', true);
  const topic = qa.D.topics.find(item => item.id === 'notes-01');
  assert(!hasText(tree, topic.sections[0].points[0]), 'Original recall answer leaked before reveal');
  action('reveal', 'notes-01:0');
  assert(decode(main()).includes(topic.sections[0].points[0]), 'Original answer should render after reveal');
  action('recall-rating', 'notes-01:0|true');
  assert.equal(qa.meta['recall:notes-01:0'].mastered, true);
  action('reveal', 'notes-01:0');
  assert(!decode(main()).includes(topic.sections[0].points[0]), 'Original answer should hide again');
  action('recall', 'off');
});
test('chapter quiz filters questions and records correct and wrong answers', () => {
  qa.startQuiz('notes-07');
  assert.equal(qa.S.ids.length, 56);
  assert(qa.S.ids.every(id => id.startsWith('notes-07-')));
  let question = qa.question();
  change({name: 'answer', value: String(question.correctIndex)});
  action('submit');
  assert.equal(qa.entries['q:' + question.id].correct, true);
  assert(decode(main()).includes(question.explanation));
  qa.startQuiz('notes-02'); question = qa.question();
  change({name: 'answer', value: String((question.correctIndex + 1) % question.options.length)});
  action('submit'); action('wrong');
  assert.equal(qa.S.ids.length, 1);
  assert.equal(qa.question().id, question.id);
});
test('v1, v2, and v3 imports retain old progress and recompute correctness', () => {
  for (const version of [1, 2, 3]) {
    const result = qa.mergeProgress({
      format: 'ophthalmology-prep-progress-v' + version,
      entries: {'q:q1': {choice: 2, correct: false, at}, 'topic:examination': {done: true, at},
        ['interview:' + qa.D.interview[0].id]: {draft: '既有口稿', ratings: [true, false, true, false, true], practiced: true, at}},
      meta: {'q:q1': {confidence: 2, note: 'old note', reason: 'knowledge', at}, 'recall:notes-13:0': {mastered: true, at}},
    });
    assert.equal(result.skipped, 0);
    assert.equal(qa.entries['q:q1'].correct, true);
    assert.equal(qa.meta['q:q1'].note, 'old note');
    assert.equal(qa.meta['recall:notes-13:0'].mastered, true);
  }
});
test('malformed imports and invalid IDs remain rejected', () => {
  assert.throws(() => qa.mergeProgress({format: 'wrong', entries: {}}));
  const result = qa.mergeProgress({format: 'ophthalmology-prep-progress-v3', entries: {'q:unknown': {choice: 0, at}, 'q:q1': {choice: 999, at}, bad: {}}, meta: {'recall:notes-13:999': {mastered: true, at}}});
  assert.equal(result.skipped, 4);
});
test('all 46 existing interviews render and clinical rehearsal completion persists', () => {
  for (const interview of qa.D.interview) {
    action('interview', interview.id);
    assert(decode(main()).includes(interview.title));
  }
  action('interview', 'notes-05-case-1'); action('iv-done');
  assert(qa.entries['interview:notes-05-case-1'].practiced);
});
test('every interview shows three persona sample answers that can be appended to the draft', () => {
  assert.equal(qa.D.interviewSamples.versions.length, 3);
  for (const interview of qa.D.interview) {
    action('interview', interview.id);
    const html = decode(main());
    const samples = qa.D.interviewSamples.answers[interview.id];
    assert.equal(samples.length, 3, interview.id);
    for (const text of samples) assert(html.includes(text), interview.id + ': sample answer missing');
    assert(html.includes(interview.clinical ? qa.D.interviewSamples.clinicalNote : qa.D.interviewSamples.note), interview.id + ': note missing');
  }
  action('interview', 'notes-05-case-1'); action('use-sample', '2');
  assert(qa.entries['interview:notes-05-case-1'].draft.includes(qa.D.interviewSamples.answers['notes-05-case-1'][2]));
});
test('all main views and workshop templates render', () => {
  for (const view of ['notebook', 'originals', 'quiz', 'learn', 'interview', 'workshop', 'plan', 'progress']) {
    action('tab', view); assert(main().length > 0); uniqueIds(parse(main()), view);
  }
  for (const item of qa.D.storySeeds) action('story-select', item.id);
  for (const item of qa.D.evidenceSeeds) action('evidence-select', item.id);
  action('workshop-mode', 'sources');
});
test('mobile menu toggles and closes on navigation', () => {
  action('nav-toggle'); assert(element('.rail').classList.contains('nav-open'));
  assert.equal(element('#nav-toggle').getAttribute('aria-expanded'), 'true');
  action('tab', 'quiz'); assert(!element('.rail').classList.contains('nav-open'));
  assert.equal(element('#nav-toggle').getAttribute('aria-expanded'), 'false');
});
test('public data excludes private originals and personal sources', () => {
  assert.equal(qa.D.originals.length, 0);
  assert.equal(qa.D.personalSources.length, 0);
  assert.equal(qa.D.notes.personalFacts.length, 0);
  assert(!element('#nav').innerHTML.includes('data-value="originals"'));
});

// Integrated teaching checks are below; use semantic content and actions, not styling.
function chapters() { return Object.entries(qa.D.enrichment.chapters); }
function eachObject(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) eachObject(child, visit);
}
test('14 chapters each integrate all original sections and deep dives without omissions or duplicates', () => {
  for (const [id, chapter] of chapters()) {
    const topic = qa.D.topics.find(item => item.id === id);
    assert(chapter.integrated, id + ': integrated curriculum missing');
    const units = chapter.integrated.units;
    assert.equal(units.length, 3, id + ': three integrated units expected');
    assert.equal(new Set(units.map(unit => unit.id)).size, units.length, id + ': unit IDs repeat');
    assert.deepEqual(Array.from(units.flatMap(unit => unit.sectionIndexes)).sort((a, b) => a - b), Array.from(topic.sections, (_, index) => index), id + ': original sections must be covered once');
    assert.deepEqual(Array.from(units.flatMap(unit => unit.deepDiveIndexes)).sort((a, b) => a - b), Array.from(chapter.deepDive, (_, index) => index), id + ': deep dives must be covered once');
    assert.equal(units.filter(unit => unit.showFigure).length, 1, id + ': figure must belong to one unit');
    for (const unit of units) {
      assert.equal(unit.synthesis.length, 2, id + ': substantive synthesis should have two paragraphs');
      assert.equal(unit.decisions.length, 2, id + ': decision practice should include two rows');
    }
    assert.equal(chapter.integrated.case.steps.length, 3, id + ': sequential case needs three stages');
  }
});
test('every teaching citation resolves within its chapter and external resources remain safe links', () => {
  for (const [id, chapter] of chapters()) {
    const resourceIds = new Set(chapter.resources.map(resource => resource.id));
    assert.equal(resourceIds.size, chapter.resources.length, id + ': resource IDs repeat');
    eachObject(chapter, object => {
      if (!Object.hasOwn(object, 'sourceIds')) return;
      assert(Array.isArray(object.sourceIds) && object.sourceIds.length > 0, id + ': teaching source list is empty');
      for (const ref of object.sourceIds) assert(resourceIds.has(ref), id + ': unresolved source ' + ref);
    });
    const tree = chapterTree(id);
    for (const resource of chapter.resources) {
      assert.equal(new URL(resource.url).protocol, 'https:');
      const links = all(tree, node => node.tag === 'a' && node.attrs.href === resource.url);
      assert(links.length > 0, id + ': source link missing ' + resource.id);
      for (const link of links) {
        assert.equal(link.attrs.target, '_blank');
        assert(link.attrs.rel.split(/\s+/).includes('noopener'));
        assert(link.attrs.rel.split(/\s+/).includes('noreferrer'));
      }
    }
  }
});
test('all unit synthesis and decision practice appear in reading mode', () => {
  for (const [id, chapter] of chapters()) {
    const tree = chapterTree(id);
    assert(hasText(tree, chapter.integrated.framing), id + ': framing missing');
    for (const objective of chapter.integrated.objectives) assert(hasText(tree, objective), id + ': objective missing');
    for (const unit of chapter.integrated.units) {
      assert.equal(headings(tree, unit.title).length, 1, id + ': unit heading repeated or missing');
      for (const paragraph of unit.synthesis) assert(hasText(tree, paragraph), id + ': synthesis missing');
      for (const decision of unit.decisions) {
        for (const key of ['finding', 'interpretation', 'nextStep']) assert(hasText(tree, decision[key]), id + ': decision ' + key + ' missing');
      }
    }
    for (const dive of chapter.deepDive) {
      assert.equal(headings(tree, dive.heading).length, 1, id + ': deep dive repeated or missing');
      for (const paragraph of dive.paragraphs) assert(hasText(tree, paragraph), id + ': deep dive paragraph missing');
    }
  }
});
test('recall mode conceals all new synthesis, decision explanations, deep dives, and diagram captions', () => {
  for (const [id, chapter] of chapters()) {
    const tree = chapterTree(id, true);
    uniqueIds(tree, id + ' recall');
    for (const unit of chapter.integrated.units) {
      for (const paragraph of unit.synthesis) closedDetailsContaining(tree, paragraph, id + ' synthesis');
      for (const decision of unit.decisions) {
        closedDetailsContaining(tree, decision.interpretation, id + ' decision interpretation');
        closedDetailsContaining(tree, decision.nextStep, id + ' decision next step');
      }
    }
    for (const dive of chapter.deepDive) {
      for (const paragraph of dive.paragraphs) closedDetailsContaining(tree, paragraph, id + ' mechanism/exception');
    }
    closedDetailsContaining(tree, chapter.figure.caption, id + ' diagram caption');
    closedDetailsContaining(tree, chapter.oralChallenge.answer, id + ' oral answer');
    const image = all(tree, node => node.tag === 'img' && node.attrs.src === 'assets/figures/' + id + '.svg')[0];
    assert(image && ancestors(image).some(node => node.tag === 'details' && !Object.hasOwn(node.attrs, 'open')), id + ': diagram leaks the recalled concept');
  }
  action('recall', 'off');
});
test('all 42 sequential case answers begin concealed; later case stages are collapsed', () => {
  for (const [id, chapter] of chapters()) {
    for (const recall of [false, true]) {
      const tree = chapterTree(id, recall);
      const problem = chapter.integrated.case;
      assert(hasText(tree, problem.stem), id + ': case stem missing');
      problem.steps.forEach((step, index) => {
        closedDetailsContaining(tree, step.answer, id + ' case answer ' + index);
        closedDetailsContaining(tree, step.rationale, id + ' case rationale ' + index);
        if (index > 0) {
          closedDetailsContaining(tree, step.newInfo, id + ' later-case data ' + index);
          closedDetailsContaining(tree, step.prompt, id + ' later-case prompt ' + index);
        }
      });
    }
  }
  action('recall', 'off');
});
test('every cross-chapter connection exposes a working chapter action', () => {
  for (const [id, chapter] of chapters()) {
    const tree = chapterTree(id);
    for (const connection of chapter.integrated.connections) {
      assert(qa.D.topics.some(topic => topic.id === connection.topicId), id + ': unknown connected topic');
      const containingListItem = all(tree, node => node.tag === 'li' && hasText(node, connection.reason));
      assert.equal(containingListItem.length, 1, id + ': connection explanation missing or repeated');
      assert(all(containingListItem[0], node => node.tag === 'button' && node.attrs['data-action'] === 'learn-topic' && node.attrs['data-value'] === connection.topicId).length, id + ': connection button missing');
      action('learn-topic', connection.topicId);
      assert.equal(qa.S.learn, connection.topicId);
      assert(hasText(parse(main()), qa.D.topics.find(topic => topic.id === connection.topicId).title));
    }
  }
});
test('four symptom-based routes display their question and working ordered chapter actions', () => {
  qa.S.search = ''; qa.S.searchChapter = 'all'; action('tab', 'notebook');
  const tree = parse(main());
  const paths = qa.D.enrichment.learningPaths;
  assert(Array.isArray(paths) && paths.length === 4, 'Four learning routes expected');
  assert.equal(new Set(paths.map(route => route.id)).size, paths.length, 'Route IDs repeat');
  for (const route of paths) {
    assert(hasText(tree, route.title)); assert(hasText(tree, route.question));
    const container = all(tree, node => node.tag === 'article' && node.children.some(child => child.tag === 'h3' && hasText(child, route.title)));
    assert.equal(container.length, 1, 'Route should have one card: ' + route.id);
    const buttons = all(container[0], node => node.tag === 'button' && node.attrs['data-action'] === 'learn-topic');
    assert.deepEqual(buttons.map(node => node.attrs['data-value']), Array.from(route.topicIds), route.id + ': route chapter order changed');
    for (const button of buttons) {
      action(button.attrs['data-action'], button.attrs['data-value']);
      assert.equal(qa.S.learn, button.attrs['data-value']);
    }
  }
});
test('search indexes original material plus every new concept, resource, integrated case, and route', () => {
  const index = qa.notebookIndex();
  function indexed(value, label) {
    assert(index.some(item => normalized(item.title + ' ' + item.body).includes(normalized(value))), 'Unsearchable ' + label + ': ' + value.slice(0, 70));
  }
  for (const topic of qa.D.topics) for (const section of topic.sections) indexed(section.title, 'original section');
  for (const [id, chapter] of chapters()) {
    indexed(chapter.figure.title, id + ' figure'); indexed(chapter.figure.caption, id + ' caption');
    for (const dive of chapter.deepDive) {
      indexed(dive.heading, id + ' mechanism title');
      for (const paragraph of dive.paragraphs) indexed(paragraph, id + ' mechanism paragraph');
    }
    indexed(chapter.oralChallenge.question, id + ' oral question'); indexed(chapter.oralChallenge.answer, id + ' oral answer');
    for (const resource of chapter.resources) { indexed(resource.title, id + ' resource title'); indexed(resource.note, id + ' resource note'); }
    const integrated = chapter.integrated;
    indexed(integrated.framing, id + ' framing');
    for (const objective of integrated.objectives) indexed(objective, id + ' objective');
    for (const unit of integrated.units) {
      indexed(unit.title, id + ' unit title');
      for (const paragraph of unit.synthesis) indexed(paragraph, id + ' synthesis');
      for (const decision of unit.decisions) for (const key of ['finding', 'interpretation', 'nextStep']) indexed(decision[key], id + ' decision ' + key);
    }
    indexed(integrated.case.title, id + ' case title'); indexed(integrated.case.stem, id + ' case stem');
    for (const step of integrated.case.steps) for (const key of ['newInfo', 'prompt', 'answer', 'rationale']) indexed(step[key], id + ' case ' + key);
    for (const connection of integrated.connections) indexed(connection.reason, id + ' connection');
  }
  for (const route of qa.D.enrichment.learningPaths) { indexed(route.title, 'route title'); indexed(route.question, 'route question'); }
});
test('search interaction finds newly written integrated content', () => {
  const paragraph = chapters()[0][1].integrated.units[0].synthesis[0];
  const query = paragraph.slice(0, 12);
  action('tab', 'notebook');
  element('#notebook-search').value = query; element('#notebook-chapter').value = 'all';
  action('notebook-search');
  assert(decode(main()).includes(query), 'New integrated prose not returned by search action');
});

async function finish() {
  try {
    qa.exportProgress();
    const exported = JSON.parse(await blobs.at(-1).text());
    assert.equal(exported.format, 'ophthalmology-prep-progress-v3');
    assert.equal(exported.entries['q:q1'].choice, 2);
    assert.equal(exported.meta['q:q1'].note, 'old note');
    assert.equal(exported.meta['recall:notes-13:0'].mastered, true);
    results.push({name: 'export retains v3 schema, original answers, and original recall keys', pass: true});
  } catch (error) {
    results.push({name: 'export retains v3 schema, original answers, and original recall keys', pass: false, message: error.message});
  }
  const report = {test_kind: 'JavaScript state and template checks using a mock DOM; not browser or visual QA', passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, results};
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}
finish().catch(error => { console.error(error); process.exitCode = 1; });
