#!/usr/bin/env node
// Comprehensive regression suite for Issue #196: Interactive Knowledge Map (#knowledge-map / #tab-map)
// and Obsidian 285 free motion-design plugins across oph, ent, rad, nm, and neuro.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const htmlPath = process.argv[2] || path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
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

function bootApp({ search = '', hash = '', deferKm = false } = {}) {
  const elements = new Map();
  const docHandlers = new Map();
  const winHandlers = new Map();
  const elHandlers = new Map();
  const blobs = [];
  const clipboard = [];
  const createdAnchors = [];

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
        removeAttribute(k) { delete attrs[k]; },
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
          // Sync child #knowledge-map-root when #main is rendered (fresh placeholder resets data-km-mounted)
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
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bootMatch[1], context);
  window.OphSpecialty = context.window.OphSpecialty;
  if (!deferKm) {
    vm.runInContext(kmJs, context);
    window.OphKnowledgeMap = context.window.OphKnowledgeMap;
  }
  vm.runInContext(hookedSource, context, { timeout: 10000 });
  if (!deferKm) {
    winHandlers.get('load')?.();
  }

  function loadDeferredKnowledgeMap() {
    vm.runInContext(kmJs, context);
    window.OphKnowledgeMap = context.window.OphKnowledgeMap;
    return window.OphKnowledgeMap;
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
    loadDeferredKnowledgeMap,
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
  await test('head assets, 390px-safe CSS invariants, and apply-knowledge-map.py --check idempotency', () => {
    assert(html.includes('<link rel="stylesheet" href="scripts/knowledge-map.css">'));
    assert(html.includes('<script src="scripts/knowledge-map.js" defer></script>'));
    assert(kmCss.includes('overflow-x:clip'));
    assert(kmCss.includes('@media(max-width:760px)'));
    assert(!/fbclid/i.test(kmJs) && !/fbclid/i.test(html), 'zero fbclid tracking params');

    const checkOut = execFileSync('python3', [path.join(ROOT, 'scripts/apply-knowledge-map.py'), '--check'], { encoding: 'utf8' });
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

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
