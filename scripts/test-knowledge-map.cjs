#!/usr/bin/env node
// Comprehensive regression suite for Issue #196 & #200: Interactive Knowledge Map (#knowledge-map / #tab-map),
// Built-in $0 Motion Studio (flythrough, slides, sketch), and Obsidian 285 free motion-design plugins across 5 specialties.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const htmlPath = process.argv[2] || path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const kmMotionJs = fs.readFileSync(path.join(ROOT, 'scripts/knowledge-map-motion.js'), 'utf8');
const kmJs = fs.readFileSync(path.join(ROOT, 'scripts/knowledge-map.js'), 'utf8');
const kmCss = fs.readFileSync(path.join(ROOT, 'scripts/knowledge-map.css'), 'utf8');

const bootMatch = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/);
assert(bootMatch, 'index.html must include specialty-boot script');
const jsonBlocks = Object.fromEntries(
  [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map(m => [m[1], m[2]])
);
const appSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(appSource, 'index.html must include inline application script');
const endRe = /render\(\);\s*\}\)\(\);\s*$/;
assert(endRe.test(appSource), 'inline application script must end with render();})();');

const hookedSource = appSource.replace(
  endRe,
  'globalThis.__qa={D,S,SPEC,navs,get entries(){return entries;},get meta(){return meta;},render,switchTab,openRoute,parseRoute,routeLabel,routeMatchesView,currentViewHash,currentLocationHash,normalizeLinkUrl,linkItems,tabAllowed};render();})();'
);

const STRICT_OPH_LEAK_TERMS = [
  'BCSC', 'RAPD', '白瞳', '眼科學No.', '急性視力喪失', '糖尿病黃斑水腫', '#pbl-dr', '#wf-chemical', '#notes-02',
  '裂隙燈', '眼底', '眼科', '視網膜', '青光眼', '白內障', '角膜', '斜視', '房水', '黃斑',
  '視神經', '隅角', '瞳孔', '眼壓', '虹膜', '水晶體', '淚腺',
  '#textbook', '#tab-textbook', '#tab-project', '#tab-schedule', '#tab-advanced'
];

function wellFormed(markup) {
  const stack = [];
  const voids = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
  for (const token of markup.match(/<(?:[^>"']|"[^"]*"|'[^']*')+>/g) || []) {
    if (token.startsWith('<!')) continue;
    const close = token.match(/^<\/\s*([a-z0-9]+)/i);
    if (close) {
      assert.equal(stack.pop(), close[1].toLowerCase(), 'Mismatched closing tag: ' + close[1]);
      continue;
    }
    const open = token.match(/^<\s*([a-z0-9]+)/i)[1].toLowerCase();
    if (!voids.has(open) && !token.endsWith('/>')) stack.push(open);
  }
  assert.equal(stack.length, 0, 'Unclosed HTML/SVG tags: ' + stack.join(','));
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

function bootApp({ search = '', hash = '', deferKm = false, enableRaf = false, osReducedMotion = false, enableFlipRects = false } = {}) {
  const elements = new Map();
  const docHandlers = new Map();
  const winHandlers = new Map();
  const elHandlers = new Map();
  const blobs = [];
  const clipboard = [];
  const createdAnchors = [];
  let handleSeq = 1;
  let fakeNowMs = 1000;
  let flipRenderTick = 0;
  const rafQueue = new Map();
  const timeoutQueue = new Map();
  const intervalQueue = new Map();

  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set();
      const attrs = {};
      const node = {
        id: key.startsWith('#') ? key.slice(1) : '',
        dataset: {},
        textContent: '',
        _innerHTML: '',
        value: '',
        hidden: false,
        selectionStart: 0,
        selectionEnd: 0,
        style: { setProperty() {} },
        classList: {
          add(v) { classes.add(v); },
          remove(v) { classes.delete(v); },
          contains(v) { return classes.has(v); },
          toggle(v, force) {
            const next = force === undefined ? !classes.has(v) : force;
            next ? classes.add(v) : classes.delete(v);
            return next;
          }
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return attrs[k] ?? null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
        removeAttribute(k) { delete attrs[k]; },
        querySelectorAll(sel) {
          if (!enableFlipRects || sel !== '[data-morph-key]') return [];
          const tick = flipRenderTick++;
          return ['hero-title', 'core-diagram'].map((mk, idx) => ({
            dataset: { morphKey: mk },
            offsetWidth: 120,
            style: {},
            classList: { add() {}, remove() {} },
            getAttribute: a => (a === 'data-morph-key' ? mk : null),
            getBoundingClientRect: () => ({
              left: 30 + tick * 40 + idx * 10,
              top: 50 + tick * 20,
              width: 240 + tick * 30,
              height: 80 + tick * 10
            })
          }));
        },
        focus() {},
        setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
        scrollIntoView() {},
        click() { this._clicked = true; },
        addEventListener(name, fn) {
          if (!elHandlers.has(key)) elHandlers.set(key, new Map());
          elHandlers.get(key).set(name, fn);
        }
      };
      Object.defineProperty(node, 'innerHTML', {
        get() { return this._innerHTML; },
        set(v) {
          this._innerHTML = String(v ?? '');
          if (key === '#main') {
            const m = this._innerHTML.match(/<section id="knowledge-map-root"[^>]*>([\s\S]*?)<\/section>/);
            if (m) {
              const kmRoot = element('#knowledge-map-root');
              kmRoot._innerHTML = m[1];
              kmRoot.removeAttribute('data-km-mounted');
              delete kmRoot.dataset.kmMounted;
            }
          }
        }
      });
      elements.set(key, node);
    }
    return elements.get(key);
  }

  const href = 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + search + hash;
  const location = {
    hash,
    search,
    href,
    origin: 'https://qwwaawwqq.github.io',
    pathname: '/ophthalmology-interview-public/',
    hostname: 'qwwaawwqq.github.io'
  };

  const document = {
    title: '',
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id in jsonBlocks) return { textContent: jsonBlocks[id] };
      if (id === 'knowledge-map-root') {
        const mainHtml = elements.has('#main') ? elements.get('#main')._innerHTML : '';
        if (!mainHtml.includes('id="knowledge-map-root"')) return null;
      }
      return element('#' + id);
    },
    querySelector: element,
    querySelectorAll: () => [],
    createElement(tag) {
      const a = element('created-' + tag + '-' + createdAnchors.length);
      createdAnchors.push(a);
      return a;
    },
    addEventListener(name, fn) { docHandlers.set(name, fn); }
  };

  class MockURL extends URL {}
  MockURL.createObjectURL = blob => { blobs.push(blob); return 'blob:km-md'; };
  MockURL.revokeObjectURL = () => {};

  const setTimeoutFn = (fn, ms) => { const id = handleSeq++; timeoutQueue.set(id, { fn, ms: Number(ms) || 0 }); return id; };
  const clearTimeoutFn = id => { timeoutQueue.delete(id); };
  const setIntervalFn = (fn, ms) => { const id = handleSeq++; intervalQueue.set(id, { fn, ms: Number(ms) || 0 }); return id; };
  const clearIntervalFn = id => { intervalQueue.delete(id); };
  const rafFn = enableRaf ? (fn => { const id = handleSeq++; rafQueue.set(id, fn); return id; }) : undefined;
  const cafFn = enableRaf ? (id => { rafQueue.delete(id); }) : undefined;

  const window = {
    document,
    location,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { clipboard: { writeText: async txt => { clipboard.push(txt); } } },
    Blob,
    URL: MockURL,
    confirm: () => true,
    scrollTo() {},
    matchMedia: q => ({ matches: Boolean(osReducedMotion && q.includes('reduce')) }),
    performance: { now: () => fakeNowMs },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
    ...(enableRaf ? { requestAnimationFrame: rafFn, cancelAnimationFrame: cafFn } : {}),
    addEventListener(name, fn) { winHandlers.set(name, fn); },
    history: {
      replaceState(_s, _t, url) {
        const u = new URL(String(url), location.href);
        Object.assign(location, {
          href: u.href,
          origin: u.origin,
          pathname: u.pathname,
          search: u.search,
          hash: u.hash,
          hostname: u.hostname
        });
      }
    }
  };

  const context = {
    document,
    window,
    navigator: window.navigator,
    location,
    Blob,
    URL: MockURL,
    URLSearchParams,
    Intl,
    Date,
    Set,
    Map,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Math,
    Error,
    SyntaxError,
    Promise,
    fetch: () => Promise.resolve({ ok: false }),
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
    ...(enableRaf ? { requestAnimationFrame: rafFn, cancelAnimationFrame: cafFn } : {}),
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bootMatch[1], context);
  window.OphSpecialty = context.window.OphSpecialty;
  if (!deferKm) {
    vm.runInContext(kmMotionJs, context);
    window.OphKnowledgeMotion = context.window.OphKnowledgeMotion;
    vm.runInContext(kmJs, context);
    window.OphKnowledgeMap = context.window.OphKnowledgeMap;
  }
  vm.runInContext(hookedSource, context, { timeout: 10000 });
  if (!deferKm) {
    winHandlers.get('load')?.();
  }

  function loadDeferredKnowledgeMap({ reverseOrder = false } = {}) {
    if (reverseOrder) {
      vm.runInContext(kmJs, context);
      window.OphKnowledgeMap = context.window.OphKnowledgeMap;
      vm.runInContext(kmMotionJs, context);
      window.OphKnowledgeMotion = context.window.OphKnowledgeMotion;
    } else {
      vm.runInContext(kmMotionJs, context);
      window.OphKnowledgeMotion = context.window.OphKnowledgeMotion;
      vm.runInContext(kmJs, context);
      window.OphKnowledgeMap = context.window.OphKnowledgeMap;
    }
    return window.OphKnowledgeMap;
  }

  function stepRaf(dtMs = 120) {
    fakeNowMs += dtMs;
    const batch = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, fn] of batch) fn(fakeNowMs);
    return batch.length;
  }

  function stepTimers() {
    const batch = [...timeoutQueue.entries()];
    timeoutQueue.clear();
    for (const [, entry] of batch) entry.fn();
    return batch.length;
  }

  function stepIntervals(ticks = 1) {
    let count = 0;
    for (let t = 0; t < ticks; t++) {
      for (const [, entry] of [...intervalQueue.entries()]) {
        if (intervalQueue.size === 0) break;
        entry.fn();
        count++;
      }
    }
    return count;
  }

  function main() {
    const raw = element('#main').innerHTML;
    if (raw.includes('id="knowledge-map-root"')) {
      const kmHtml = element('#knowledge-map-root').innerHTML;
      return raw.replace(/(<section id="knowledge-map-root"[^>]*>)[\s\S]*?(<\/section>)/, `$1${kmHtml}$2`);
    }
    return raw;
  }

  return {
    qa: context.__qa,
    get km() { return context.window.OphKnowledgeMap; },
    get kmMotion() { return context.window.OphKnowledgeMotion; },
    loadDeferredKnowledgeMap,
    stepRaf,
    stepTimers,
    stepIntervals,
    rafQueue,
    timeoutQueue,
    intervalQueue,
    location,
    blobs,
    clipboard,
    createdAnchors,
    winHandlers,
    docHandlers,
    elHandlers,
    element,
    main,
    nav: () => element('#nav').innerHTML,
    tabbar: () => element('#tabbar').innerHTML,
    kmHtml: () => element('#knowledge-map-root').innerHTML,
    action(name, value = '') {
      docHandlers.get('click')({
        target: {
          closest: sel => sel === '[data-action]' ? { dataset: { action: name, value }, disabled: false, setAttribute() {} } : null
        }
      });
    },
    kmClick(kmAction, kmValue = '') {
      const h = elHandlers.get('#knowledge-map-root')?.get('click');
      assert(h, 'knowledge-map-root must bind click listener');
      h({
        preventDefault() {},
        target: {
          closest: sel => {
            if (sel === 'a[href]') return null;
            if (sel === '[data-km-action]') {
              return {
                dataset: { kmAction, kmValue },
                getAttribute(attr) {
                  if (attr === 'data-km-action') return kmAction;
                  if (attr === 'data-km-value') return kmValue;
                  return null;
                }
              };
            }
            return null;
          }
        }
      });
    },
    kmKey(key, targetTag = 'DIV') {
      const h = elHandlers.get('#knowledge-map-root')?.get('keydown');
      assert(h, 'knowledge-map-root must bind keydown listener');
      h({
        key,
        preventDefault() {},
        target: { tagName: targetTag, id: '', closest: () => null }
      });
    },
    kmType(val) {
      const h = elHandlers.get('#knowledge-map-root')?.get('input');
      assert(h, 'knowledge-map-root must bind input listener');
      h({ target: { id: 'km-search', value: val } });
    }
  };
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.stack || err.message });
  }
}

(async () => {
  await test('head assets, script load order, 390px-safe CSS invariants, and apply-knowledge-map.py --check idempotency', () => {
    const cssTag = '<link rel="stylesheet" href="scripts/knowledge-map.css">';
    const motionTag = '<script src="scripts/knowledge-map-motion.js" defer></script>';
    const kmTag = '<script src="scripts/knowledge-map.js" defer></script>';
    assert(html.includes(cssTag));
    assert(html.includes(motionTag));
    assert(html.includes(kmTag));
    assert(html.indexOf(motionTag) < html.indexOf(kmTag), 'knowledge-map-motion.js must precede knowledge-map.js');
    assert(kmCss.includes('overflow-x:clip'));
    assert(kmCss.includes('@media(max-width:760px)'));
    assert(!/fbclid/i.test(kmMotionJs) && !/fbclid/i.test(kmJs) && !/fbclid/i.test(html), 'zero fbclid tracking params');

    const checkOut = execFileSync('python3', ['-B', path.join(ROOT, 'scripts/apply-knowledge-map.py'), '--check'], { encoding: 'utf8' });
    assert(checkOut.includes('Knowledge Map hooks current'));
  });

  await test('rail, 5-column mobile tabbar, #today quick-jump, and practiceOverview card wire #knowledge-map cleanly', () => {
    const app = bootApp();
    const nav = app.nav();
    wellFormed(nav);
    assert(nav.includes('data-action="tab" data-value="map"') && nav.includes('知識地圖'));
    // Mobile tabbar remains strictly 5 columns
    assert.equal((app.tabbar().match(/class="tabbar-item/g) || []).length, 5);

    // #today includes quick-jump to #knowledge-map
    const todayMarkup = app.main();
    wellFormed(todayMarkup);
    assert(todayMarkup.includes('data-today-knowledge-map'));
    assert(todayMarkup.includes('#knowledge-map-obsidian-motion-285'));

    // Chapter overview preserves 情境與流程演練 and adds knowledge-map card
    app.action('tab', 'notebook');
    const nbMarkup = app.main();
    wellFormed(nbMarkup);
    assert(nbMarkup.includes('情境與流程演練'));
    assert(nbMarkup.includes('data-knowledge-map-card'));

    // Clicking knowledge-map-open navigates to map
    app.action('knowledge-map-open', '#knowledge-map');
    assert.equal(app.qa.S.tab, 'map');
    assert.equal(app.location.hash, '#knowledge-map');
    // Mobile tabbar highlights interview group when on map
    assert(app.tabbar().includes('data-value="interview" aria-current="page"'));
  });

  await test('routing parses and matches #knowledge-map, #knowledge-map-<subId>, #tab-map, #today, and #tab-exam', () => {
    const app = bootApp();
    const { parseRoute, routeLabel, routeMatchesView, openRoute, normalizeLinkUrl } = app.qa;

    assert.deepEqual({ ...parseRoute('#knowledge-map') }, { kind: 'map', tab: 'map', id: null, hash: '#knowledge-map' });
    assert.deepEqual(
      { ...parseRoute('#knowledge-map-obsidian-motion-285') },
      { kind: 'map', tab: 'map', id: 'obsidian-motion-285', hash: '#knowledge-map-obsidian-motion-285' }
    );
    assert.equal(parseRoute('#tab-map').tab, 'map');
    assert.equal(parseRoute('#today').tab, 'today');
    assert.equal(parseRoute('#tab-exam').tab, 'quiz');
    assert.equal(parseRoute('#knowledge-map-nonexistent-node'), null);
    assert.equal(normalizeLinkUrl('#knowledge-map-nonexistent-node'), null);
    assert.equal(normalizeLinkUrl('#knowledge-map-obsidian-motion-285'), '#knowledge-map-obsidian-motion-285');
    assert(routeLabel(parseRoute('#knowledge-map-obsidian-canvas-222')).includes('Canvas'));

    // Navigate via openRoute and hashchange between sub-nodes and generic #knowledge-map
    assert.equal(openRoute('#knowledge-map-obsidian-canvas-222'), true);
    assert.equal(app.qa.S.tab, 'map');
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-canvas-222');
    assert.equal(routeMatchesView(parseRoute('#knowledge-map-obsidian-canvas-222')), true);
    assert.equal(routeMatchesView(parseRoute('#knowledge-map-obsidian-slides-30')), false);
    assert.equal(routeMatchesView(parseRoute('#knowledge-map')), false);

    app.location.hash = '#knowledge-map-obsidian-slides-30';
    app.winHandlers.get('hashchange')();
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-slides-30');

    app.location.hash = '#knowledge-map';
    app.winHandlers.get('hashchange')();
    assert.equal(app.qa.S.mapNode, '');
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-motion-285');

    // Cold boot on deep link #knowledge-map-obsidian-motion-285
    const cold = bootApp({ hash: '#knowledge-map-obsidian-motion-285' });
    assert.equal(cold.qa.S.tab, 'map');
    assert.equal(cold.km.getSelectedNodeId(), 'obsidian-motion-285');
  });

  await test('Obsidian 285 spotlight renders exact numbers, $0 vs $1,500–$4,800, 4-step guide, 3 recipes, and clean URLs', () => {
    const app = bootApp({ hash: '#knowledge-map' });
    const dom = app.kmHtml();
    wellFormed(dom);

    // Default selected spotlight node
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-motion-285');
    assert(dom.includes('viewBox="0 0 960 440"'), 'responsive SVG viewBox 960x440');

    // Exact plugin numbers: 30 + 222 + 33 = 285, 900 萬+ / 9M+
    const counts = Array.from(app.km.OBSIDIAN_PLUGINS.map(p => p.count));
    assert.deepEqual(counts, [30, 222, 33]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 285);
    for (const token of ['285', '30 款', '222 款', '33 款', '900 萬+', '$0', '$1,500–$4,800']) {
      assert(dom.includes(token), `DOM must include ${token}`);
    }

    // All 3 clean Obsidian plugin URLs with rel="noopener noreferrer" and target="_blank", zero fbclid
    const expectedUrls = [
      'https://obsidian.md/plugins?search=slides',
      'https://obsidian.md/plugins?search=canvas',
      'https://obsidian.md/plugins?search=excalidraw'
    ];
    for (const u of expectedUrls) {
      assert(dom.includes(`href="${u}"`), `Missing clean plugin URL ${u}`);
    }
    const anchorTags = [...dom.matchAll(/<a\s+[^>]+>/g)].map(m => m[0]);
    assert(anchorTags.length >= 3);
    for (const tag of anchorTags) {
      assert(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), `External link missing security attrs: ${tag}`);
      assert(!/fbclid/i.test(tag), `Link leaked fbclid: ${tag}`);
    }

    // 4-step Quick Start & 3 interview recipes
    assert(dom.includes('四步快速安裝啟用'));
    assert(dom.includes('Obsidian → Settings → Community plugins'));
    assert(dom.includes('Browse'));
    assert(dom.includes('Install') && dom.includes('Enable'));
    assert(dom.includes('實戰起手式') && dom.includes('第 1 個動態場景'));
    assert(dom.includes('自我介紹 3 分鐘研究亮點 Slides 變形'));
    assert(dom.includes('PBL／臨床決策樹 Canvas 鏡頭導覽'));
    assert(dom.includes('手術／病生理機轉 Excalidraw 手繪動畫'));
  });

  await test('filter pills, search input, node selection, and internal 1-click navigation work end-to-end', () => {
    const app = bootApp({ hash: '#knowledge-map' });
    const chipCount = () => (app.kmHtml().match(/<button[^>]+class="km-node-chip\b/g) || []).length;
    assert.equal(chipCount(), 11);

    app.kmClick('filter', 'motion');
    assert.equal(app.km.getCategory(), 'motion');
    assert.equal(chipCount(), 4);

    app.kmClick('filter', 'study');
    assert.equal(chipCount(), 3);

    app.kmClick('filter', 'interview');
    assert.equal(chipCount(), 3);

    app.kmClick('filter', 'all');
    app.kmType('Excalidraw');
    assert.equal(app.km.getSearch(), 'Excalidraw');
    const chipsAfterSearch = chipCount();
    assert(chipsAfterSearch >= 2 && chipsAfterSearch <= 4, 'search narrows visible node chips for Excalidraw');

    app.kmType('Magic Move');
    assert.equal(chipCount(), 2);

    app.kmType('zzzz-no-such-plugin-999');
    assert(app.kmHtml().includes('找不到符合'));
    app.kmClick('clear-filter');
    assert.equal(app.km.getSearch(), '');
    assert.equal(chipCount(), 11);

    // Select reading-core in oph mode: has both #tab-learn and #tab-textbook
    app.kmClick('select', 'reading-core');
    assert.equal(app.km.getSelectedNodeId(), 'reading-core');
    assert.equal(app.location.hash, '#knowledge-map-reading-core');
    assert(app.kmHtml().includes('BCSC S01–S13'));
    assert(app.kmHtml().includes('data-km-value="#tab-learn"'));
    assert(app.kmHtml().includes('data-km-value="#tab-textbook"'));

    // 1-click internal route navigation
    app.kmClick('route', '#tab-exam');
    assert.equal(app.qa.S.tab, 'quiz');
    app.qa.openRoute('#knowledge-map-written-qa');
    assert.equal(app.qa.S.tab, 'map');
    app.kmClick('route', '#written');
    assert.equal(app.qa.S.tab, 'quiz');
    app.qa.openRoute('#knowledge-map-interview-flow');
    app.kmClick('route', '#pbl');
    assert.equal(app.qa.S.tab, 'pbl');
  });

  await test('specialty modes (ent, rad, nm, neuro) render tailored labels with ZERO ophthalmology leaks across all 11 nodes and Markdown', () => {
    for (const sid of ['ent', 'rad', 'nm', 'neuro']) {
      const app = bootApp({ search: '?s=' + sid, hash: '#knowledge-map' });
      assert.equal(app.qa.SPEC.id, sid);
      assert.equal(app.location.search, '?s=' + sid);

      for (const node of app.km.getNodes(sid)) {
        app.km.selectNode(node.id);
        assert.equal(app.location.search, '?s=' + sid, `${sid} selecting ${node.id} must preserve ?s=${sid}`);
        const dom = app.kmHtml();
        wellFormed(dom);
        assert(!dom.includes('undefined') && !dom.includes('NaN'), `${sid} ${node.id} rendered undefined/NaN`);
        for (const leak of STRICT_OPH_LEAK_TERMS) {
          assert(!dom.includes(leak), `${sid} node ${node.id} leaked ophthalmology term "${leak}"`);
        }
      }

      const md = app.km.buildObsidianMarkdown(sid);
      for (const leak of STRICT_OPH_LEAK_TERMS) {
        assert(!md.includes(leak), `${sid} Markdown leaked ophthalmology term "${leak}"`);
      }
    }
  });

  await test('buildObsidianMarkdown() escapes currency $ for Obsidian MathJax safety and supports .md download + clipboard copy', async () => {
    const app = bootApp({ hash: '#knowledge-map-obsidian-motion-285' });
    const md = app.km.buildObsidianMarkdown('oph');

    assert(md.includes('\\$0'), 'Markdown must escape \\$0');
    assert(md.includes('**\\$0**'), 'Markdown must render bold \\$0 outside inline code backticks');
    assert(md.includes('\\$1,500–\\$4,800'), 'Markdown must escape \\$1,500–\\$4,800');
    assert(!/(?<!\\)\$\d/.test(md), 'Zero unescaped $<digit> sequences in Markdown');
    assert(!md.includes('`\\$'), 'Zero `\\$ sequences inside inline code backticks');
    const codeSpans = [...md.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
    assert(codeSpans.length >= 6);
    for (const span of codeSpans) {
      assert(!span.includes('\\$'), `Inline code span leaked literal \\$: \`${span}\``);
    }
    assert(md.includes('https://obsidian.md/plugins?search=slides'));
    assert(md.includes('https://obsidian.md/plugins?search=canvas'));
    assert(md.includes('https://obsidian.md/plugins?search=excalidraw'));
    assert(md.includes('285') && md.includes('30') && md.includes('222') && md.includes('33') && md.includes('900 萬+'));
    assert(!/fbclid/i.test(md));

    // Download .md button
    app.kmClick('download-md');
    assert.equal(app.blobs.length, 1);
    const blobText = await app.blobs[0].text();
    assert.equal(blobText, md);
    assert(app.createdAnchors.at(-1)?.download.endsWith('.md'));

    // Copy Markdown button
    await app.km.action('copy-md');
    assert.equal(app.clipboard.at(-1), md);
  });

  await test('defer pre-window.load tab-click race auto-mounts pre-existing #knowledge-map-root and reconciles routeMatchesView', () => {
    const app = bootApp({ hash: '#knowledge-map-obsidian-canvas-222', deferKm: true });
    // Simulate user clicking the map tab before deferred scripts/knowledge-map.js finishes loading
    app.action('tab', 'map');
    assert.equal(app.qa.S.tab, 'map');
    const kmRoot = app.element('#knowledge-map-root');
    assert.equal(kmRoot.getAttribute('data-km-mounted'), null);
    assert(kmRoot.innerHTML.includes('正在載入知識地圖'));
    // Unmounted placeholder must NOT satisfy routeMatchesView so appRestoreHash() will re-run openRoute()
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#knowledge-map')), false);
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#tab-map')), false);
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#knowledge-map-obsidian-canvas-222')), false);

    // Deferred knowledge-map.js executes and immediately mounts pre-existing #knowledge-map-root
    app.loadDeferredKnowledgeMap();
    assert.equal(kmRoot.getAttribute('data-km-mounted'), '1');
    assert(kmRoot.innerHTML.includes('viewBox="0 0 960 440"'));
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-canvas-222');

    // window.load fires appRestoreHash(), reconciling S.mapNode with #knowledge-map-obsidian-canvas-222
    app.winHandlers.get('load')?.();
    assert.equal(app.qa.S.mapNode, 'obsidian-canvas-222');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#knowledge-map-obsidian-canvas-222')), true);
  });

  await test('all 11 SVG <rect> node boxes stay within [8, 952] x [8, 432] and have >= 12px pairwise separation', () => {
    const app = bootApp({ hash: '#knowledge-map' });
    const nodes = app.km.getNodes('oph');
    assert.equal(nodes.length, 11);

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax1 = a.x - a.w / 2;
      const ax2 = a.x + a.w / 2;
      const ay1 = a.y - a.h / 2;
      const ay2 = a.y + a.h / 2;
      assert(ax1 >= 8 && ax2 <= 952, `Node ${a.id} X bounds [${ax1}, ${ax2}] out of [8, 952]`);
      assert(ay1 >= 8 && ay2 <= 432, `Node ${a.id} Y bounds [${ay1}, ${ay2}] out of [8, 432]`);

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bx1 = b.x - b.w / 2;
        const bx2 = b.x + b.w / 2;
        const by1 = b.y - b.h / 2;
        const by2 = b.y + b.h / 2;
        const gapX = Math.max(bx1 - ax2, ax1 - bx2);
        const gapY = Math.max(by1 - ay2, ay1 - by2);
        assert(
          Math.max(gapX, gapY) >= 12,
          `Nodes ${a.id} and ${b.id} overlap or < 12px apart (gapX=${gapX}, gapY=${gapY})`
        );
      }
    }

    // Also verify rendered SVG <rect class="km-node-rect"> attributes directly
    const rectMatches = [...app.kmHtml().matchAll(/<rect class="km-node-rect" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)];
    assert.equal(rectMatches.length, 11);
    const rects = rectMatches.map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      assert(a.x >= 8 && a.x + a.w <= 952 && a.y >= 8 && a.y + a.h <= 432);
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
        const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        assert(Math.max(gapX, gapY) >= 12, `Rendered SVG <rect> ${i} and ${j} closer than 12px`);
      }
    }
  });

  await test('Issue #200 sub-routes (#knowledge-map-flythrough / -slides / -sketch), Studio Bar, and reverse deferred load order work cleanly', () => {
    const app = bootApp({ hash: '#knowledge-map-slides' });
    assert.equal(app.qa.S.tab, 'map');
    assert.equal(app.qa.S.mapNode, 'slides');
    assert.equal(app.km.getStudioMode(), 'slides');
    assert(app.kmHtml().includes('data-km-engine="slides"'));
    wellFormed(app.kmHtml());

    for (const mode of ['flythrough', 'slides', 'sketch']) {
      const h = '#knowledge-map-' + mode;
      const r = app.qa.parseRoute(h);
      assert.deepEqual({ ...r }, { kind: 'map', tab: 'map', id: mode, hash: h });
      assert.equal(app.qa.normalizeLinkUrl(h), h);
      assert(app.qa.routeLabel(r).length >= 4);
      assert.equal(app.qa.openRoute(h), true);
      assert.equal(app.km.getStudioMode(), mode);
      assert.equal(app.qa.routeMatchesView(r), true);
      assert(app.kmHtml().includes(`data-km-engine="${mode}"`));
      wellFormed(app.kmHtml());
    }

    // Studio bar button clicks update mode + spotlight + hash
    app.kmClick('studio-mode', 'sketch');
    assert.equal(app.km.getStudioMode(), 'sketch');
    assert.equal(app.km.getSelectedNodeId(), 'obsidian-excalidraw-33');
    assert.equal(app.location.hash, '#knowledge-map-sketch');

    app.kmClick('studio-mode', 'flythrough');
    assert.equal(app.km.getStudioMode(), 'flythrough');
    assert.equal(app.location.hash, '#knowledge-map-flythrough');

    // Reverse deferred script order (knowledge-map.js executes before knowledge-map-motion.js)
    const rev = bootApp({ hash: '#knowledge-map-sketch', deferKm: true });
    rev.action('tab', 'map');
    rev.loadDeferredKnowledgeMap({ reverseOrder: true });
    rev.winHandlers.get('load')?.();
    assert.equal(rev.km.getStudioMode(), 'sketch');
    assert(rev.kmHtml().includes('data-km-engine="sketch"'));
    assert(rev.kmHtml().includes('viewBox="0 0 880 380"'));
  });

  await test('Engine 1 (flythrough): curved cubic-Bezier synapses, 60fps RAF camera flyTo/zoom/reset, 7-stop tour, motion toggle, and timer cleanup', () => {
    const app = bootApp({ hash: '#knowledge-map-flythrough', enableRaf: true });
    const baseIntervals = app.intervalQueue.size;
    const dom0 = app.kmHtml();
    assert(/<path class="km-edge[^"]*" d="M \d+ \d+ C /.test(dom0), 'SVG edges must render curved cubic-Bezier paths');
    assert(dom0.includes('class="km-edge-stream'), 'Active edges must render .km-edge-stream');
    assert(dom0.includes('class="km-pulse-orb'), 'Active edges must render glowing .km-pulse-orb');

    // 60fps RAF flyToNode interpolation
    app.km.flyToNode('obsidian-motion-285', { durationMs: 500 });
    assert.equal(app.rafQueue.size, 1, 'flyToNode must schedule requestAnimationFrame');
    app.stepRaf(250); // halfway through 500ms -> cubicEaseInOut(0.5) === 0.5
    const midBox = app.km.getCameraBox();
    assert(midBox[2] < 900 && midBox[2] > 450, `Mid-flight width should interpolate smoothly, got ${midBox[2]}`);
    const svgViewBoxAttr = app.element('#km-main-svg').getAttribute('viewBox');
    assert(svgViewBoxAttr && !svgViewBoxAttr.startsWith('0 0 960'), 'Live #km-main-svg viewBox updates per RAF frame');
    app.stepRaf(300); // finish flight
    const landedBox = app.km.getCameraBox();
    assert(landedBox[2] < 500, `Landed camera width should zoom in on node, got ${landedBox[2]}`);
    assert.equal(app.rafQueue.size, 0);

    // Zoom in / Zoom out / Reset overview
    const beforeZoomW = landedBox[2];
    app.km.zoomCamera(1, { instant: true });
    const zoomedInW = app.km.getCameraBox()[2];
    assert(zoomedInW < beforeZoomW, 'zoomCamera(1) narrows viewBox width');
    app.km.zoomCamera(-1, { instant: true });
    assert(app.km.getCameraBox()[2] > zoomedInW, 'zoomCamera(-1) widens viewBox width');
    app.km.resetCamera({ instant: true });
    assert.deepEqual([...app.km.getCameraBox()], [0, 0, 960, 440]);

    // 7-stop curated cinema tour + final overview reset (8 stops total in TOUR_STOPS)
    const visited = [];
    app.km.startTour({ instant: true, stepHoldMs: 200 });
    assert.equal(app.km.isTourActive(), true);
    for (let i = 0; i < app.kmMotion.TOUR_STOPS.length; i++) {
      const expectedStop = app.kmMotion.TOUR_STOPS[i];
      visited.push(expectedStop === 'overview' ? 'overview' : app.km.getSelectedNodeId());
      assert(app.kmHtml().includes('class="km-tour-caption"'), `Stop ${expectedStop} must show live cinema narration caption`);
      app.stepTimers();
    }
    assert.deepEqual(visited, ['hub', 'reading-core', 'srs-banks', 'written-qa', 'interview-flow', 'story-workshop', 'obsidian-motion-285', 'overview']);
    assert.equal(app.km.isTourActive(), false);
    assert.deepEqual([...app.km.getCameraBox()], [0, 0, 960, 440]);

    // Timer & RAF leak prevention on stopTour, unmount, and tab leave
    const timeoutsBeforeTour = app.timeoutQueue.size;
    app.km.startTour({ instant: true, stepHoldMs: 500 });
    assert.equal(app.timeoutQueue.size, timeoutsBeforeTour + 1);
    assert.equal(app.km.getActiveTimerCount(), 1);
    app.km.stopTour();
    assert.equal(app.timeoutQueue.size, timeoutsBeforeTour);
    assert.equal(app.km.getActiveTimerCount(), 0);
    assert(!app.kmHtml().includes('class="km-tour-caption"'), 'P2-1: stopTour() must clear stale HUD narration banner');

    // P2-1: selectNode() also clears any stale flyToNode narration banner
    app.km.flyToNode('reading-core', { instant: true });
    assert(app.kmHtml().includes('class="km-tour-caption"'));
    app.km.selectNode('srs-banks');
    assert(!app.kmHtml().includes('class="km-tour-caption"'), 'P2-1: selectNode() must clear stale HUD narration banner');

    // P1-2: Toggling reduced motion mid-flight during startTour() snaps camera and advances tour without deadlock
    const timeoutsBeforeMidFlight = app.timeoutQueue.size;
    app.km.startTour({ flyDurationMs: 500, stepHoldMs: 250 });
    assert.equal(app.km.isTourActive(), true);
    assert.equal(app.rafQueue.size, 1);
    assert.equal(app.timeoutQueue.size, timeoutsBeforeMidFlight);
    app.km.toggleMotion(true); // switch to reduced motion while camera RAF is mid-flight
    assert.equal(app.rafQueue.size, 0, 'P1-2: mid-flight camera RAF cancelled on reduced-motion toggle');
    assert.equal(app.km.isTourActive(), true, 'P1-2: tour stays active and schedules next hold timer');
    assert.equal(app.timeoutQueue.size, timeoutsBeforeMidFlight + 1, 'P1-2: hold timer scheduled immediately after snap');
    app.stepTimers();
    assert.equal(app.km.getSelectedNodeId(), 'reading-core', 'P1-2: tour advances cleanly to stop 2 without deadlock');
    app.km.stopTour();
    app.km.toggleMotion(false);

    // P1-4: Cross-engine mode switch (startTour -> setSlide) immediately stops tour and clears background timers
    app.km.startTour({ flyDurationMs: 400, stepHoldMs: 500 });
    assert.equal(app.km.isTourActive(), true);
    app.km.setSlide(1);
    assert.equal(app.km.getStudioMode(), 'slides');
    assert.equal(app.km.isTourActive(), false, 'P1-4: setSlide() must stop active tour');
    assert.equal(app.km.getActiveTimerCount(), 0, 'P1-4: setSlide() must clear tour RAF/timers');

    app.km.startTour({ flyDurationMs: 400, stepHoldMs: 500 });
    assert.equal(app.rafQueue.size, 1);
    assert(app.km.getActiveTimerCount() > 0);
    app.action('tab', 'today'); // triggers OphKnowledgeMap.unmount() in syncPracticeHash
    assert.equal(app.km.getActiveTimerCount(), 0);
    assert.equal(app.rafQueue.size, 0);
    assert.equal(app.intervalQueue.size, baseIntervals);

    // OS prefers-reduced-motion + manual override toggle
    const rmApp = bootApp({ hash: '#knowledge-map-flythrough', enableRaf: true, osReducedMotion: true });
    assert.equal(rmApp.km.isReducedMotion(), true);
    assert.equal(rmApp.element('#knowledge-map-root').getAttribute('data-km-motion'), 'reduced');
    rmApp.km.flyToNode('srs-banks', { durationMs: 500 });
    assert.equal(rmApp.rafQueue.size, 0, 'Reduced motion must snap immediately without scheduling RAF');
    rmApp.kmClick('toggle-motion');
    assert.equal(rmApp.km.isReducedMotion(), false);
    assert.equal(rmApp.element('#knowledge-map-root').getAttribute('data-km-motion'), 'forced-on');

    // P2-2: Pre-load generic #knowledge-map route reset over stale #knowledge-map-slides hash
    const preLoadApp = bootApp({ hash: '#knowledge-map-slides' });
    assert.equal(preLoadApp.km.getStudioMode(), 'slides');
    preLoadApp.qa.openRoute('#knowledge-map', false);
    assert.equal(preLoadApp.km.getStudioMode(), 'flythrough', 'P2-2: openRoute(#knowledge-map, false) must reset to flythrough');
    assert.equal(preLoadApp.km.getSelectedNodeId(), 'obsidian-motion-285');
    preLoadApp.location.hash = '#knowledge-map-slides';
    preLoadApp.km.mount(preLoadApp.element('#knowledge-map-root'), { specialty: 'oph', nodeId: '', explicitRoute: true });
    assert.equal(preLoadApp.km.getStudioMode(), 'flythrough', 'P2-2: mount with explicitRoute && !nodeId must not fall back to stale location.hash');
  });

  await test('Engine 2 (slides): Keynote Magic-Move FLIP shared-element morphing, 2 decks x 4 slides, keyboard arrows, autoplay, and speaker cues', () => {
    const app = bootApp({ hash: '#knowledge-map-slides' });
    const baseIntervals = app.intervalQueue.size;
    const decks = app.kmMotion.getDecks('oph');
    assert.equal(decks.length, 2);

    // P2-3: Verify oph-triage Slides 1-2 cover both painful red-eye emergencies and painless sudden vision loss (CRAO & RRD)
    const triageDeck = decks.find(d => d.id === 'oph-triage');
    assert(triageDeck, 'oph-triage deck must exist');
    const triageS12 = JSON.stringify(triageDeck.slides.slice(0, 2));
    for (const term of ['AACG', 'CRAO', 'RRD', '櫻桃紅斑', '視網膜裂孔', '先排閉鎖・再查眼底']) {
      assert(triageS12.includes(term), `P2-3: oph-triage Slides 1-2 must include "${term}"`);
    }

    for (const deck of decks) {
      assert.equal(deck.slides.length, 4);
      app.km.setDeck(deck.id);
      assert.equal(app.km.getSlideState().deckId, deck.id);
      for (let s = 0; s < 4; s++) {
        app.km.setSlide(s);
        assert.equal(app.km.getSlideState().slideIndex, s);
        const dom = app.kmHtml();
        wellFormed(dom);
        assert(dom.includes('data-morph-key="hero-badge"'));
        assert(dom.includes('data-morph-key="hero-title"'));
        assert(dom.includes('data-morph-key="core-diagram"'));
        assert(dom.includes('data-morph-key="kpi-card-0"'));
        assert(dom.includes('data-morph-key="bar-0"'));
        assert(dom.includes('data-morph-key="timeline-pill"'));
        assert(dom.includes('口試講者提詞'));
      }
    }

    // Keyboard ArrowRight / ArrowLeft navigation (and ignored inside INPUT)
    app.km.setSlide(0);
    app.kmKey('ArrowRight');
    assert.equal(app.km.getSlideState().slideIndex, 1);
    app.kmKey('ArrowLeft');
    assert.equal(app.km.getSlideState().slideIndex, 0);
    app.kmKey('ArrowLeft'); // wraps to slide 3
    assert.equal(app.km.getSlideState().slideIndex, 3);
    app.kmKey('ArrowRight', 'INPUT'); // ignored when typing in search input
    assert.equal(app.km.getSlideState().slideIndex, 3);

    // P1-3: Hidden or unmounted container ignores stray click / keydown events
    const kmRoot = app.element('#knowledge-map-root');
    kmRoot.hidden = true;
    app.kmKey('ArrowRight');
    assert.equal(app.km.getSlideState().slideIndex, 3, 'P1-3: keydown on hidden container must no-op');
    app.kmClick('slide-next');
    assert.equal(app.km.getSlideState().slideIndex, 3, 'P1-3: click on hidden container must no-op');
    kmRoot.hidden = false;

    // Autoplay interval & clean stop on unmount
    app.kmClick('toggle-slide-autoplay');
    assert.equal(app.km.getSlideState().autoplay, true);
    assert.equal(app.intervalQueue.size, baseIntervals + 1);
    assert.equal(app.km.getActiveTimerCount(), 1);
    app.stepIntervals(2);
    assert.equal(app.km.getSlideState().slideIndex, 1);
    app.km.unmount();
    assert.equal(app.intervalQueue.size, baseIntervals);
    assert.equal(app.km.getActiveTimerCount(), 0);
    app.kmKey('ArrowRight');
    assert.equal(app.km.getSlideState().slideIndex, 1, 'P1-3: keydown on unmounted container must no-op');

    // P1-3: setSlide(1) with active FLIP RAF immediately cancelled by unmount() before RAF ticks
    const flipApp = bootApp({ hash: '#knowledge-map-slides', enableRaf: true, enableFlipRects: true });
    const flipBaseTimeouts = flipApp.timeoutQueue.size;
    flipApp.km.setSlide(1);
    assert.equal(flipApp.rafQueue.size, 1, 'P1-3: setSlide(1) schedules FLIP requestAnimationFrame');
    assert.equal(flipApp.km.getActiveTimerCount(), 1, 'P1-3: getActiveTimerCount() tracks pending FLIP RAF');
    flipApp.km.unmount();
    assert.equal(flipApp.rafQueue.size, 0, 'P1-3: unmount() cancels pending FLIP RAF');
    assert.equal(flipApp.km.getActiveTimerCount(), 0);
    flipApp.stepRaf(16);
    assert.equal(flipApp.timeoutQueue.size, flipBaseTimeouts, 'P1-3: cancelled FLIP RAF must not schedule post-unmount 600ms timeout');
    assert.equal(flipApp.km.getActiveTimerCount(), 0);

    // Direct FLIP geometry unit test with non-zero bounding rects (First -> Last -> Invert -> Play)
    let rectPhase = 'first';
    const mkMorphNode = (key, firstBox, lastBox) => {
      const classes = new Set();
      return {
        dataset: { morphKey: key },
        offsetWidth: 100,
        style: {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) },
        getAttribute: a => (a === 'data-morph-key' ? key : null),
        getBoundingClientRect: () => (rectPhase === 'first' ? firstBox : lastBox)
      };
    };
    const cardA = mkMorphNode('hero-title', { left: 40, top: 60, width: 300, height: 80 }, { left: 140, top: 110, width: 600, height: 160 });
    const cardZero = mkMorphNode('zero-rect', { left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 0, height: 0 });
    const mockStage = { querySelectorAll: () => [cardA, cardZero] };

    const firstRects = app.kmMotion.captureFlipRects(mockStage);
    assert.equal(firstRects.size, 1, '0x0 headless rects must be safely ignored');
    rectPhase = 'last';
    let cleanupCb = null;
    const rafCbs = [];
    const movedCount = app.kmMotion.playFlipTransition(
      mockStage,
      firstRects,
      false,
      fn => { cleanupCb = fn; },
      { requestAnimationFrame: fn => rafCbs.push(fn) }
    );
    assert.equal(movedCount, 1);
    assert.equal(cardA.style.transition, 'none');
    assert.equal(cardA.style.transform, 'translate3d(-100.00px, -50.00px, 0) scale(0.500, 0.500)');
    assert.equal(rafCbs.length, 1);
    rafCbs[0](); // Play frame
    assert(cardA.classList.has('is-flipping'));
    assert(cardA.style.transition.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
    assert.equal(cardA.style.transform, 'translate3d(0, 0, 0) scale(1, 1)');
    cleanupCb(); // Post-transition cleanup
    assert.equal(cardA.classList.has('is-flipping'), false);
    assert.equal(cardA.style.transform, '');
  });

  await test('Engine 3 (sketch): progressive pathLength="1000" stroke-draw, RAPD bilateral pupil constriction/paradoxical dilation, and AACG LPI', () => {
    const app = bootApp({ hash: '#knowledge-map-sketch' });
    const scenes = app.kmMotion.getSketchScenes('oph');
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].id, 'oph-rapd');
    assert.equal(scenes[1].id, 'oph-aacg');

    // P1-5: Scene 1 RAPD bilateral pupil rings [20, 15, 9, 16] (Step 4 dilation 16px <= scotopic baseline 20px)
    const expectedRadii = [20, 15, 9, 16];
    for (let step = 1; step <= 4; step++) {
      app.km.setSketchStep(step);
      const dom = app.kmHtml();
      wellFormed(dom);
      assert(dom.includes('viewBox="0 0 880 380"'));
      assert(dom.includes('pathLength="1000"'));
      const drawnBoxes = [...dom.matchAll(/<g data-sketch-box="(\d)">[\s\S]*?<path class="km-sketch-stroke is-drawn/g)];
      assert.equal(drawnBoxes.length, step, `Step ${step} should mark ${step} boxes as is-drawn`);
      const odMatch = dom.match(/data-pupil-side="od"[^>]*r="(\d+)"/);
      const osMatch = dom.match(/data-pupil-side="os"[^>]*r="(\d+)"/);
      assert(odMatch && osMatch, `Step ${step} must render bilateral OD/OS pupil rings`);
      assert.equal(Number(odMatch[1]), expectedRadii[step - 1]);
      assert.equal(Number(osMatch[1]), expectedRadii[step - 1]);
      assert(Number(odMatch[1]) <= expectedRadii[0], 'Pupil radius must never exceed scotopic baseline');
    }

    // P1-5: Verify ACR LI-RADS v2018 high-risk population pearl in rad-liver Step 1
    const radScenes = app.kmMotion.getSketchScenes('rad');
    const radLiverPearl = radScenes.find(s => s.id === 'rad-liver').steps[0].pearl;
    assert(radLiverPearl.includes('肝硬化、慢性 B 型肝炎或曾患肝細胞癌'), 'P1-5: rad-liver pearl must state LI-RADS v2018 high-risk criteria');
    assert(radLiverPearl.includes('單純慢性 C 肝未合併肝硬化者不適用'), 'P1-5: rad-liver pearl must exclude non-cirrhotic HCV');

    // Scene 2: Acute Angle-Closure Glaucoma & LPI shunt
    app.km.setSketchScene('oph-aacg');
    assert.equal(app.km.getSketchState().sceneId, 'oph-aacg');
    assert.equal(app.km.getSketchState().step, 1);
    app.km.setSketchStep(2);
    assert(app.kmHtml().includes('Iris bombé'));
    app.km.setSketchStep(3);
    assert(app.kmHtml().includes('58 mmHg'));
    app.km.setSketchStep(4);
    assert(app.kmHtml().includes('LPI 雷射穿孔分流'));

    // Play / Speed 1.75x / Auto-stop at step 4 / Replay
    app.km.setSketchStep(1);
    app.kmClick('toggle-sketch-speed');
    assert.equal(app.km.getSketchState().speed, 1.75);
    app.kmClick('toggle-sketch-play');
    assert.equal(app.km.getSketchState().playing, true);
    app.stepIntervals(4);
    assert.equal(app.km.getSketchState().step, 4);
    assert.equal(app.km.getSketchState().playing, false, 'Sketch player auto-stops upon completing step 4');
    app.kmClick('sketch-replay');
    assert.equal(app.km.getSketchState().step, 1);
    assert.equal(app.km.getSketchState().playing, true);
    app.km.unmount();
    assert.equal(app.km.getActiveTimerCount(), 0);
  });

  await test('Cross-specialty matrix: all 5 specialties x all 3 modes (flythrough tour, slides decks, sketch scenes) have ZERO ophthalmology leaks', () => {
    for (const sid of ['oph', 'ent', 'rad', 'nm', 'neuro']) {
      const app = bootApp({ search: '?s=' + sid, hash: '#knowledge-map' });
      assert.equal(app.qa.SPEC.id, sid);

      const assertClean = (markup, ctxLabel) => {
        wellFormed(markup);
        assert(!markup.includes('undefined') && !markup.includes('NaN'), `${sid} ${ctxLabel} rendered undefined/NaN`);
        assert.equal(app.location.search, '?s=' + sid, `${sid} ${ctxLabel} must preserve ?s=${sid}`);
        if (sid !== 'oph') {
          for (const leak of STRICT_OPH_LEAK_TERMS) {
            assert(!markup.includes(leak), `${sid} ${ctxLabel} leaked ophthalmology term "${leak}"`);
          }
        }
      };

      // 1. Flythrough mode + all 8 tour stops
      app.km.setStudioMode('flythrough');
      app.km.startTour({ instant: true, stepHoldMs: 150 });
      for (const stopId of app.kmMotion.TOUR_STOPS) {
        assertClean(app.kmHtml(), `flythrough tour:${stopId}`);
        app.stepTimers();
      }

      // 2. Slides mode: all decks x all 4 slides
      const decks = app.kmMotion.getDecks(sid);
      assert.equal(decks.length, 2, `${sid} must provide 2 slide decks`);
      app.km.setStudioMode('slides');
      for (const deck of decks) {
        assert.equal(deck.slides.length, 4, `${sid} deck ${deck.id} must have 4 slides`);
        app.km.setDeck(deck.id);
        for (let i = 0; i < deck.slides.length; i++) {
          app.km.setSlide(i);
          assertClean(app.kmHtml(), `slides ${deck.id}[${i}]`);
        }
      }

      // 3. Sketch mode: all scenes x all 4 steps
      const scenes = app.kmMotion.getSketchScenes(sid);
      assert.equal(scenes.length, 2, `${sid} must provide 2 sketch scenes`);
      app.km.setStudioMode('sketch');
      for (const scene of scenes) {
        assert.equal(scene.steps.length, 4, `${sid} scene ${scene.id} must have 4 steps`);
        app.km.setSketchScene(scene.id);
        for (let step = 1; step <= 4; step++) {
          app.km.setSketchStep(step);
          assertClean(app.kmHtml(), `sketch ${scene.id}@step${step}`);
        }
      }

      app.km.unmount();
      assert.equal(app.km.getActiveTimerCount(), 0);
    }
  });

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
