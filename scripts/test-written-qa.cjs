#!/usr/bin/env node
// Behavior, multi-specialty surface, canvas/textarea persistence, SRS scheduling,
// v1/v2/v3 progress compatibility, and schema validator checks for Written Q&A (Issue #188).
// Usage: node scripts/test-written-qa.cjs [index.html]
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const input = process.argv[2] || path.join(root, 'index.html');
const html = fs.readFileSync(input, 'utf8');

const blocks = Object.fromEntries(
  [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)]
    .map(m => [m[1], m[2]])
);
assert(blocks['course-data'], 'index.html must include course-data payload');

const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert(appScript, 'index.html must include inline application script');
const endRe = /render\(\);\s*\}\)\(\);\s*$/;
assert(endRe.test(appScript), 'inline app bootstrap end anchor must match');

const registryScript = html.match(/<script id="specialty-boot">([\s\S]*?)<\/script>/)?.[1];
assert(registryScript, 'index.html must include specialty-boot script');

const studySrsScript = fs.readFileSync(path.join(__dirname, 'study-srs.js'), 'utf8');
const writtenQaScript = fs.readFileSync(path.join(__dirname, 'written-qa.js'), 'utf8');
const textbookDepthScript = fs.readFileSync(path.join(__dirname, 'textbook-depth.js'), 'utf8');
const cramReviewScript = fs.readFileSync(path.join(__dirname, 'cram-review.js'), 'utf8');
const advancedPracticeScript = fs.readFileSync(path.join(__dirname, 'advanced-practice.js'), 'utf8');
const advancedTrainingScript = fs.readFileSync(path.join(__dirname, 'advanced-training.js'), 'utf8');

const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const manifest = readJson('content/textbook-manifest.json');
const bcscS01 = readJson('content/textbook-depth/bcsc-s01.json');
const cramOph = readJson('content/cram-review.json');
const advancedData = readJson('content/textbook-depth/advanced-practice.json');
const additionalData = readJson('content/textbook-depth/additional-practice.json');

const SPECIALTIES = ['oph', 'ent', 'rad', 'nm', 'neuro'];

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function buildSyntheticPack(spec) {
  const course = spec === 'oph'
    ? JSON.parse(blocks['course-data'])
    : JSON.parse(blocks['course-data-' + spec]);
  const topics = (course.topics || []).filter(t => t.chapter);
  const pbls = Array.isArray(course.pbl?.cases) ? course.pbl.cases : (Array.isArray(course.pblCases) ? course.pblCases : []);
  const wfs = Array.isArray(course.workflows?.workflows) ? course.workflows.workflows : (Array.isArray(course.workflows) ? course.workflows : []);
  const items = [];

  topics.forEach((t, idx) => {
    const pbl = pbls[idx % Math.max(1, pbls.length)]?.id || null;
    const wf = wfs[idx % Math.max(1, wfs.length)]?.id || null;
    for (let k = 1; k <= 3; k++) {
      items.push({
        id: `${spec}-wq-${t.id}-${String(k).padStart(2, '0')}`,
        specialty: spec,
        category: 'chapter',
        topicId: t.id,
        bookId: null,
        chapterId: null,
        deepDiveId: null,
        pblId: k === 1 ? pbl : (k === 2 && pbls[idx + topics.length] ? pbls[idx + topics.length].id : null),
        workflowId: k === 1 ? wf : (k === 2 && wfs[idx + topics.length] ? wfs[idx + topics.length].id : null),
        cramHighYield: k === 1,
        format: k === 1 ? '簡答題' : k === 2 ? '機轉推導' : '急症處置申論',
        title: `${t.title.split('：')[0]} 核心手寫第 ${k} 題`,
        prompt: `請針對「${t.title}」條列說明：\n（1）關鍵解剖或病生理機轉。\n（2）標準診斷判讀指標與鑑別。\n（3）第一線處置步驟與禁忌症。`,
        answer: `（1）先確認核心解剖定位與受犯構造，建立完整病生理推論與血流神經支配關係。\n（2）依關鍵臨床徵象、定量檢查與影像指標完成鑑別診斷並排除危急假象。\n（3）立即啟動標準第一線處置流程，設定定量追蹤門檻、密切監測併發症並嚴格避開高風險禁忌用藥。`,
        keyPoints: [
          '正確寫出受犯解剖構造與病生理核心機轉',
          '列出定量診斷標準與至少兩項重要鑑別診斷',
          '完整說明第一線處置優先順序與關鍵數值門檻',
          '明確指出高風險禁忌症與轉介／手術時機'
        ],
        pitfall: '切勿未排除危急鑑別診斷即直接給藥，且須寫出具體定量門檻以免失分。',
        sourceRef: `${spec.toUpperCase()} 第 ${t.chapter} 章核心教材重述`
      });
    }
  });

  // Ensure every PBL and workflow in this specialty has at least 1 direct item
  pbls.forEach((p, idx) => {
    if (!items.some(it => it.pblId === p.id)) {
      items[idx % items.length].pblId = p.id;
    }
  });
  wfs.forEach((w, idx) => {
    if (!items.some(it => it.workflowId === w.id)) {
      items[(idx + 1) % items.length].workflowId = w.id;
    }
  });

  if (spec === 'oph') {
    for (let s = 1; s <= 13; s++) {
      const bid = `bcsc-s${String(s).padStart(2, '0')}`;
      const bData = readJson(`content/textbook-depth/${bid}.json`);
      const ch0 = bData.chapters[0]?.id || `${bid}-ch001`;
      const ch1 = bData.chapters[1]?.id || ch0;
      [ch0, ch1].forEach((cid, k) => {
        items.push({
          id: `oph-wq-${bid}-${String(k + 1).padStart(2, '0')}`,
          specialty: 'oph',
          category: 'bcsc',
          topicId: topics[s % topics.length].id,
          bookId: bid,
          chapterId: cid,
          deepDiveId: null,
          pblId: null,
          workflowId: null,
          cramHighYield: k === 0,
          format: '計算與機轉推導',
          title: `${bid.toUpperCase()} ${cid} 原書深度手寫申論 (${k + 1})`,
          prompt: `請依據 BCSC ${bid.toUpperCase()} 推導關鍵臨床判斷原則：\n（1）核心機轉與定量公式。\n（2）臨床檢查判讀與處置決策。`,
          answer: `（1）依 BCSC ${bid.toUpperCase()} 原理解析光學與病生理定量關係，逐一確認符號正負號、頂點距離與臨床單位換算。\n（2）結合結構影像與功能檢查結果，排除常見測量偽影後擬定分階段治療、手術適應症與長期追蹤計畫。`,
          keyPoints: [
            `寫出 ${bid.toUpperCase()} 核心機轉或定量換算關係`,
            '列舉關鍵鑑別指標與影像／功能檢查重點',
            '說明標準治療決策與併發症預防要點'
          ],
          pitfall: '注意正負號與單位換算，避免混淆適應症與禁忌症。',
          sourceRef: `AAO BCSC 2024–2025 ${bid.toUpperCase()} (${cid})`
        });
      });
    }
    const deepIds = [...new Set((advancedData.deepDives || []).map(u => u.id))];
    deepIds.forEach((did, idx) => {
      items.push({
        id: `oph-wq-hard-${String(idx + 1).padStart(2, '0')}`,
        specialty: 'oph',
        category: 'hard',
        topicId: topics[idx % topics.length].id,
        bookId: `bcsc-s${String((idx % 13) + 1).padStart(2, '0')}`,
        chapterId: null,
        deepDiveId: did,
        pblId: null,
        workflowId: null,
        cramHighYield: true,
        format: '臨床決策申論',
        title: `${did} 跨領域複雜病例手寫決策申論`,
        prompt: `面對複雜合併症情境（${did}），請分點擬答：\n（1）首要排除之危急診斷與順序。\n（2）檢查判讀陷阱與矛盾數據解析。\n（3）分階段處置與風險溝通要點。`,
        answer: `（1）第一時間優先排除威脅視力或生命之高危急症，同步確認瞳孔反應、眼壓變化與關鍵神經影像徵象。\n（2）辨識各項檢查偽陰性與偽陽性來源，交叉比對結構與功能指標以釐清矛盾線索。\n（3）依風險分層執行階梯式治療並設定明確惡化回診與手術介入指標。`,
        keyPoints: [
          '正確排序危急鑑別診斷與第一時間必做檢查',
          '指出關鍵偽陽性／偽陰性檢查陷阱與修正方式',
          '提出具體分階段處置策略與手術／藥物轉換門檻',
          '包含併發症監測指標與病患衛教重點'
        ],
        pitfall: '不可遺漏全身性或神經血管危急鑑別，且處置順序顛倒將大幅扣分。',
        sourceRef: `BCSC 跨卷整合與 Hard 臨床決策 (${did})`
      });
    });
  }

  return {
    schemaVersion: 1,
    specialty: spec,
    title: `${spec.toUpperCase()} 筆試手寫簡答與臨床申論題庫`,
    updated: '2026-11-07',
    disclaimer: '本題庫為原創教學重述之筆試手寫簡答與臨床申論練習，附標準參考答案與得分要點；非官方歷屆原題逐字重製。',
    items
  };
}

function loadPackForSpec(spec) {
  const p = path.join(root, 'content', 'written-qa', `${spec}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return buildSyntheticPack(spec);
}

const PACKS = Object.fromEntries(SPECIALTIES.map(s => [s, loadPackForSpec(s)]));

function createMockCanvas(id) {
  const listeners = new Map();
  const ops = [];
  const ctx2d = {
    globalCompositeOperation: 'source-over',
    strokeStyle: '#000',
    fillStyle: '#000',
    lineCap: 'round',
    lineJoin: 'round',
    lineWidth: 2,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    setTransform() { ops.push('setTransform'); },
    clearRect() { ops.push('clearRect'); },
    beginPath() { ops.push('beginPath'); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    arc(x, y, r) { ops.push(['arc', x, y, r]); },
    stroke() { ops.push(['stroke', this.globalCompositeOperation, this.strokeStyle, this.lineWidth]); },
    fill() { ops.push(['fill', this.globalCompositeOperation, this.fillStyle]); }
  };
  return {
    tagName: 'CANVAS',
    width: 680,
    height: 260,
    style: { height: '260px', setProperty() {} },
    dataset: { writtenCanvas: id },
    getAttribute(k) { return k === 'data-written-canvas' ? id : k === 'width' ? String(this.width) : null; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 680, height: this.height }; },
    getContext(kind) { return kind === '2d' ? ctx2d : null; },
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchPointer(type, eventInit = {}) {
      const fn = listeners.get(type);
      if (fn) fn({ preventDefault() {}, pointerId: 1, button: 0, ...eventInit });
    },
    ops
  };
}

function parseSlotsFromHtml(mainNode, slotCache, canvasCache) {
  const markup = mainNode._innerHTML;
  const slots = [];
  const slotRe = /<([a-z0-9]+)\b([^>]*\bdata-written-slot="([^"]+)"[^>]*)>/gi;
  let m;
  while ((m = slotRe.exec(markup))) {
    const openTag = m[0];
    const attrsRaw = m[2];
    const kind = m[3];
    const getAttr = name => {
      const am = attrsRaw.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
      return am ? am[1] : null;
    };
    const key = `${kind}|${getAttr('data-spec-id') || ''}|${getAttr('data-topic-id') || ''}|${getAttr('data-context-id') || ''}|${getAttr('data-book-id') || ''}|${getAttr('data-chapter-id') || ''}|${getAttr('data-deepdive-id') || ''}`;
    if (!slotCache.has(key)) {
      const node = {
        dataset: {
          writtenSlot: kind,
          specId: getAttr('data-spec-id') || undefined,
          topicId: getAttr('data-topic-id') || undefined,
          contextId: getAttr('data-context-id') || undefined,
          topicIds: getAttr('data-topic-ids') || undefined,
          bookId: getAttr('data-book-id') || undefined,
          chapterId: getAttr('data-chapter-id') || undefined,
          deepdiveId: getAttr('data-deepdive-id') || undefined
        },
        _openTag: openTag,
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
          this._innerHTML = String(v);
          mainNode._slotHtml = this._innerHTML;
        },
        getAttribute: getAttr,
        querySelector(sel) {
          if (sel === '.practice-count') {
            return { textContent: '' };
          }
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'canvas[data-written-canvas]') {
            return [...this._innerHTML.matchAll(/data-written-canvas="([^"]+)"/g)].map(cm => {
              if (!canvasCache.has(cm[1])) canvasCache.set(cm[1], createMockCanvas(cm[1]));
              return canvasCache.get(cm[1]);
            });
          }
          return [];
        },
        addEventListener() {}
      };
      slotCache.set(key, node);
    }
    slots.push(slotCache.get(key));
  }
  return slots;
}

function bootApp({
  spec = 'oph',
  hash = '',
  local = new MemoryStorage(),
  session = new MemoryStorage(),
  primePack = true,
  customFetch = null,
  withStudy = true
} = {}) {
  const search = spec === 'oph' ? '' : `?s=${spec}`;
  const elements = new Map();
  const docHandlers = new Map();
  const winHandlers = new Map();
  const slotCache = new Map();
  const canvasCache = new Map();
  const statusPills = new Map();
  const toasts = [];
  const scrolledIds = [];

  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set();
      const attrs = {};
      const elListeners = new Map();
      const node = {
        id: key.startsWith('#') ? key.slice(1) : '',
        tagName: 'DIV',
        dataset: {},
        _innerHTML: '',
        _slotHtml: null,
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
          this._innerHTML = String(v);
          this._slotHtml = null;
          if (key === '#main') slotCache.clear();
        },
        textContent: '',
        value: '',
        hidden: false,
        selectionStart: 0,
        selectionEnd: 0,
        style: { setProperty() {}, height: '' },
        classList: {
          add: v => classes.add(v),
          remove: v => classes.delete(v),
          contains: v => classes.has(v),
          toggle(v, force) {
            const next = force === undefined ? !classes.has(v) : force;
            next ? classes.add(v) : classes.delete(v);
            return next;
          }
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute: k => attrs[k] ?? null,
        focus() {},
        setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
        scrollIntoView() { scrolledIds.push(this.id || key); },
        click() {},
        addEventListener(name, fn) { elListeners.set(name, fn); },
        querySelector(sel) {
          if (sel === '[data-written-search]') return element('[data-written-search]');
          return element(sel);
        },
        querySelectorAll(sel) {
          if (sel === 'canvas[data-written-canvas]') {
            const src = this._slotHtml || this._innerHTML;
            return [...src.matchAll(/data-written-canvas="([^"]+)"/g)].map(m => {
              if (!canvasCache.has(m[1])) canvasCache.set(m[1], createMockCanvas(m[1]));
              return canvasCache.get(m[1]);
            });
          }
          return [];
        },
        _listeners: elListeners
      };
      if (key === '#toast') {
        Object.defineProperty(node, 'textContent', {
          get() { return toasts.at(-1) || ''; },
          set(v) { toasts.push(String(v)); }
        });
      }
      elements.set(key, node);
    }
    return elements.get(key);
  }

  const location = {
    hash,
    search,
    href: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/' + search + hash,
    origin: 'https://qwwaawwqq.github.io',
    pathname: '/ophthalmology-interview-public/'
  };

  const defaultFetch = async url => {
    const u = String(url);
    const wMatch = u.match(/content\/written-qa\/([a-z]+)\.json/);
    if (wMatch && PACKS[wMatch[1]]) {
      return { ok: true, status: 200, json: async () => structuredClone(PACKS[wMatch[1]]) };
    }
    if (u.includes('textbook-manifest.json')) return { ok: true, status: 200, json: async () => structuredClone(manifest) };
    if (u.includes('bcsc-s01.json')) return { ok: true, status: 200, json: async () => structuredClone(bcscS01) };
    const bMatch = u.match(/(bcsc-s\d{2})\.json/);
    if (bMatch) return { ok: true, status: 200, json: async () => readJson(`content/textbook-depth/${bMatch[1]}.json`) };
    const specCramMatch = u.match(/content\/(ent|rad|nm|neuro)\/cram-review\.json/);
    if (specCramMatch) return { ok: true, status: 200, json: async () => readJson(`content/${specCramMatch[1]}/cram-review.json`) };
    if (u.includes('cram-review.json')) return { ok: true, status: 200, json: async () => structuredClone(cramOph) };
    if (u.includes('advanced-practice.json')) return { ok: true, status: 200, json: async () => structuredClone(advancedData) };
    if (u.includes('additional-practice.json')) return { ok: true, status: 200, json: async () => structuredClone(additionalData) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const fetchFn = customFetch || defaultFetch;

  const window = {
    location,
    localStorage: local,
    sessionStorage: session,
    devicePixelRatio: 2,
    confirm: () => true,
    scrollTo() {},
    addEventListener(name, fn) {
      if (!winHandlers.has(name)) winHandlers.set(name, []);
      winHandlers.get(name).push(fn);
    },
    history: {
      replaceState(_s, _t, url) {
        const str = String(url);
        const i = str.indexOf('#');
        location.hash = i < 0 ? '' : str.slice(i);
      }
    },
    fetch: fetchFn
  };

  const document = {
    activeElement: null,
    visibilityState: 'visible',
    currentScript: { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/written-qa.js' },
    getElementById(id) {
      if (id in blocks) return { textContent: blocks[id] };
      if (['study-root', 'textbook-root', 'cram-root', 'advanced-root', 'project-root'].includes(id)) return null;
      if (id.startsWith('written-') || id.endsWith('-written')) {
        const liveMarkup = element('#main')._innerHTML + ' ' + (element('#main')._slotHtml || '') + ' ' + [...slotCache.values()].map(s => s._innerHTML).join(' ') + ' ' + (elements.get('#cram-root-live')?.innerHTML || '');
        if (!liveMarkup.includes(`id="${id}"`)) return null;
      }
      return element('#' + id);
    },
    querySelector(sel) { return element(sel); },
    querySelectorAll(sel) {
      if (sel === '[data-written-slot]') {
        return parseSlotsFromHtml(element('#main'), slotCache, canvasCache);
      }
      const stMatch = sel.match(/^\[data-written-status="([^"]+)"\]$/);
      if (stMatch) {
        if (!statusPills.has(stMatch[1])) statusPills.set(stMatch[1], { className: '', textContent: '' });
        return [statusPills.get(stMatch[1])];
      }
      return [];
    },
    createElement: () => element('anchor'),
    addEventListener(name, fn) {
      if (!docHandlers.has(name)) docHandlers.set(name, []);
      docHandlers.get(name).push(fn);
    }
  };

  const context = {
    document,
    window,
    localStorage: local,
    sessionStorage: session,
    fetch: fetchFn,
    Intl, Date, Set, Map, Object, Array, String, Number, Boolean, JSON, Math, Error, TypeError, RangeError, SyntaxError, RegExp, Promise,
    URL, URLSearchParams, Blob, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    devicePixelRatio: 2,
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { return 1; },
    clearTimeout() {},
    requestAnimationFrame(fn) { fn(); },
    console
  };
  window.window = window;
  window.document = document;
  vm.createContext(context);

  vm.runInContext(registryScript, context);
  window.OphSpecialty = context.window.OphSpecialty;

  if (withStudy) {
    document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/study-srs.js' };
    vm.runInContext(studySrsScript, context);
    context.window.OphStudy.setClock(() => Date.parse('2026-11-07T02:00:00.000Z'));
  }

  document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/written-qa.js' };
  vm.runInContext(writtenQaScript, context);
  if (primePack) {
    context.window.OphWritten.prime(structuredClone(PACKS[spec]), spec);
  }

  const hookedApp = appScript.replace(
    endRe,
    'globalThis.__qa={SPEC,D,S,get entries(){return entries;},get meta(){return meta;},put,putMeta,save:changed,pblCases,wfList,render,switchTab,openRoute,appRestoreHash,parseRoute,routeLabel,routeMatchesView,currentViewHash,notebookIndex,practiceIndex,practiceEntry,practiceMeta,coverageTarget,chapterCoverage,mergeProgress,progressPayload,clearDevice};render();})();'
  );
  vm.runInContext(hookedApp, context, { timeout: 10000 });
  for (const fn of winHandlers.get('load') || []) fn();

  const fireClick = (actionName, value = '') => {
    const btn = { dataset: { action: actionName, value: String(value) }, disabled: false, setAttribute() {} };
    const ev = {
      target: {
        closest(sel) {
          if (sel === '[data-action]') return btn;
          return null;
        }
      },
      preventDefault() {}
    };
    for (const fn of docHandlers.get('click') || []) fn(ev);
  };

  const settle = async (ticks = 20) => {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  };

  return {
    context,
    window: context.window,
    document,
    local,
    session,
    qa: context.__qa,
    written: context.window.OphWritten,
    study: context.window.OphStudy,
    studyBridge: context.window.OphStudyBridge,
    element,
    docHandlers,
    winHandlers,
    canvasCache,
    slotCache,
    statusPills,
    toasts,
    scrolledIds,
    location,
    fireClick,
    settle,
    main: () => element('#main')._slotHtml || element('#main').innerHTML
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
  await test('apply-written-qa.py --check passes and preserves single-line functions and OphAdvanced prefixes', () => {
    execFileSync('python3', [path.join(__dirname, 'apply-written-qa.py'), '--check'], { encoding: 'utf8' });
    assert.equal((html.match(/scripts\/written-qa\.css/g) || []).length, 1, 'written-qa.css included once');
    assert.equal((html.match(/scripts\/written-qa\.js/g) || []).length, 1, 'written-qa.js included once');
    for (const fnName of ['chapterExtras', 'learn', 'notebookIndex', 'notebook', 'personalInterviewTools']) {
      const matches = appScript.split('\n').filter(line => line.startsWith(`function ${fnName}(`));
      assert.equal(matches.length, 1, `${fnName} must remain a single-line declaration`);
      assert(matches[0].endsWith('}'), `${fnName} must end on the same line`);
    }
    assert(appScript.includes('function practiceChange(el){if(window.OphAdvanced?.change(el))return true;'));
    assert(appScript.includes('function practiceAction(a,v,b){if(window.OphAdvanced?.action(a,v,b))return true;'));
  });

  await test('async fetch resolves once per specialty and live-hydrates mounted [data-written-slot] containers', async () => {
    let fetchCalls = 0;
    const app = bootApp({
      spec: 'ent',
      primePack: false,
      customFetch: async url => {
        if (String(url).includes('content/written-qa/ent.json')) {
          fetchCalls++;
          return { ok: true, status: 200, json: async () => structuredClone(PACKS.ent) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });
    app.fireClick('spec-quiz-mode', 'written');
    assert(app.main().includes('data-written-slot="quiz"'), 'quiz written slot mounts immediately');
    await app.settle(30);
    assert.equal(fetchCalls, 1, 'fetches ent.json exactly once');
    assert.equal(app.written.getItems('ent').length, PACKS.ent.items.length);
    const hydratedQuiz = app.main() + [...app.slotCache.values()].map(s => s.innerHTML).join('');
    assert(hydratedQuiz.includes(PACKS.ent.items[0].title), 'live slot or rerendered main contains loaded ENT questions');
    await app.written.ensureLoaded('ent');
    assert.equal(fetchCalls, 1, 'subsequent ensureLoaded uses memory cache');
  });

  await test('all 5 specialties expose Today quick-launch buttons while preserving 3 review count boxes and non-oph switcher invariant', () => {
    for (const spec of SPECIALTIES) {
      const app = bootApp({ spec });
      const todayMarkup = app.main();
      for (const boxLabel of ['現在到期', '今日稍後', '弱項']) {
        assert(todayMarkup.includes(`<span>${boxLabel}</span>`), `${spec} todayReview keeps ${boxLabel} box`);
      }
      assert(todayMarkup.includes('手寫問答題'), `${spec} today page shows 手寫問答題 quick launch`);

      if (spec === 'oph') {
        assert(todayMarkup.includes('data-today-quiz-banks'), 'oph today has data-today-quiz-banks');
        app.fireClick('quiz-bank', 'written');
        assert.equal(app.qa.S.tab, 'quiz');
        assert(app.main().includes('data-quiz-bank-switcher'), 'oph quiz renders bank switcher');
        assert(app.main().includes(PACKS.oph.items[0].title), 'oph written bank renders items');
      } else {
        app.fireClick('tab', 'quiz');
        assert(!app.main().includes('data-quiz-bank-switcher'), `${spec} quiz must NOT include data-quiz-bank-switcher`);
        assert(app.main().includes('data-spec-quiz-mode'), `${spec} quiz renders clean [data-spec-quiz-mode] bar`);
        app.fireClick('spec-quiz-mode', 'written');
        assert(!app.main().includes('data-quiz-bank-switcher'), `${spec} written mode still omits data-quiz-bank-switcher`);
        assert(app.main().includes(PACKS[spec].items[0].title), `${spec} written bank renders its specialty questions`);
        app.fireClick('spec-quiz-mode', 'mcq');
        assert(!app.main().includes('written-bank-root'), `${spec} switches back to MCQ cleanly`);
      }
    }
  });

  await test('all 58 chapters across 5 specialties render inline chapter Written Q&A and jump links inside #learn', () => {
    let totalChaptersChecked = 0;
    for (const spec of SPECIALTIES) {
      const app = bootApp({ spec });
      const chapters = app.qa.D.topics.filter(t => t.chapter);
      for (const ch of chapters) {
        totalChaptersChecked++;
        app.qa.S.tab = 'learn';
        app.qa.S.learn = ch.id;
        app.qa.render();
        const m = app.main();
        assert(m.includes(`href="#${ch.id}-written"`), `${spec} ${ch.id} enrichmentNav includes #${ch.id}-written jump link`);
        assert(m.includes(`id="${ch.id}-written"`), `${spec} ${ch.id} renders #${ch.id}-written section`);
        assert(m.includes('本章手寫問答題（手寫板／打字作答＋標準答案）'), `${spec} ${ch.id} renders chapter Written Q&A heading`);
        const matching = PACKS[spec].items.find(it => it.topicId === ch.id);
        const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        assert(matching && m.includes(escHtml(matching.title)), `${spec} ${ch.id} renders matching chapter question card`);
      }
    }
    assert.equal(totalChaptersChecked, 58, 'all 58 chapters acrossoph/ent/rad/nm/neuro verified');
  });

  await test('notebook overview, practiceIndex search, PBL cases, and clinical workflows wire Written Q&A across all 5 specialties', () => {
    for (const spec of SPECIALTIES) {
      const app = bootApp({ spec });
      app.fireClick('tab', 'notebook');
      assert(app.main().includes('手寫問答題'), `${spec} notebook overview shows 手寫問答題 card`);
      assert(app.main().includes('data-action="written-bank-open"'), `${spec} notebook card has written-bank-open button`);

      const idx = app.qa.practiceIndex();
      const writtenHits = idx.filter(x => x.type === '手寫問答' && x.action === 'written-open');
      assert.equal(writtenHits.length, PACKS[spec].items.length, `${spec} practiceIndex indexes every written item`);

      app.fireClick('written-open', writtenHits[0].target);
      assert.equal(app.qa.S.tab, 'quiz');
      assert(app.main().includes(`id="written-${writtenHits[0].target}"`), `${spec} written-open navigates to target question`);

      // PBL check (direct + fallback)
      const pbl0 = app.qa.pblCases()[0];
      app.qa.S.tab = 'pbl';
      app.qa.S.pbl = pbl0.id;
      app.qa.render();
      assert(app.main().includes('本情境延伸手寫問答'), `${spec} PBL ${pbl0.id} renders延伸手寫問答`);

      // Workflow check
      const wf0 = app.qa.wfList()[0];
      app.qa.S.tab = 'workflow';
      app.qa.S.workflow = wf0.id;
      app.qa.render();
      assert(app.main().includes('本流程延伸手寫問答'), `${spec} Workflow ${wf0.id} renders延伸手寫問答`);
    }

    // Explicit fallback test when pblId/workflowId has no direct match
    const appFallback = bootApp({ spec: 'nm', primePack: false });
    const stripped = structuredClone(PACKS.nm);
    for (const it of stripped.items) { it.pblId = null; it.workflowId = null; }
    appFallback.written.prime(stripped, 'nm');
    appFallback.qa.S.tab = 'pbl';
    appFallback.qa.S.pbl = appFallback.qa.pblCases()[0].id;
    appFallback.qa.render();
    assert(appFallback.main().includes('本情境延伸手寫問答'), 'PBL falls back to topicIds chapter items cleanly');
    const scopeMatch = appFallback.main().match(/data-action="written-reveal-all" data-value="([^"]+\|open)"/);
    assert(scopeMatch, 'fallback PBL section includes reveal-all button');
    appFallback.written.action('written-reveal-all', scopeMatch[1]);
    assert(appFallback.main().includes('標準參考答案'), 'reveal-all expands fallback PBL cards');
  });

  await test('quiz bank filters (category/book/topic, status, search) and 單題專注 vs 整頁全覽 work accurately', () => {
    const app = bootApp({ spec: 'oph' });
    app.fireClick('quiz-bank', 'written');
    assert(app.main().includes('整頁全覽'));

    // Filter by category = hard
    app.written.change({ dataset: { writtenFilter: 'scope' }, value: 'cat:hard' });
    const hardItems = PACKS.oph.items.filter(x => x.category === 'hard');
    assert(hardItems.length >= 8);
    assert(app.main().includes(hardItems[0].title));
    assert(!app.main().includes(PACKS.oph.items.find(x => x.category === 'chapter').title));

    // Switch to focus view and navigate next/prev
    app.written.action('written-view', 'focus');
    assert(app.main().includes(`第 1 / ${hardItems.length} 題`));
    app.written.action('written-nav', '1');
    assert(app.main().includes(`第 2 / ${hardItems.length} 題`));
    assert(app.main().includes(hardItems[1].title));
    app.written.action('written-view', 'list');
    app.written.change({ dataset: { writtenFilter: 'scope' }, value: 'all' });

    // Search filter
    const uniqueTitle = PACKS.oph.items[3].title;
    app.written.input({ dataset: { writtenSearch: '' }, value: uniqueTitle, matches: s => s === '[data-written-search]' }, {});
    assert(app.main().includes(uniqueTitle));
    app.written.input({ dataset: { writtenSearch: '' }, value: '', matches: s => s === '[data-written-search]' }, {});
  });

  await test('#tab-textbook BCSC volume written mode, deep link #textbook-written-bcsc-s01, and inline chapter written section work', async () => {
    const app = bootApp({ spec: 'oph', hash: '#textbook-written-bcsc-s01' });
    const tbHandlers = new Map();
    const tbRoot = {
      isConnected: true,
      dataset: {},
      innerHTML: '',
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(n, fn) {
        if (!tbHandlers.has(n)) tbHandlers.set(n, []);
        tbHandlers.get(n).push(fn);
      }
    };
    app.document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/textbook-depth.js' };
    vm.runInContext(textbookDepthScript, app.context);
    await app.context.window.OphTextbook.mount(tbRoot);
    await app.settle(20);

    assert(tbRoot.innerHTML.includes('手寫問答'), 'BCSC bookHeader shows 手寫問答 mode button');
    const s01Items = PACKS.oph.items.filter(x => x.category === 'bcsc' && x.bookId === 'bcsc-s01');
    assert(s01Items.length >= 2);
    assert(tbRoot.innerHTML.includes(s01Items[0].title), '#textbook-written-bcsc-s01 renders BCSC S01 written items');

    // Switch to reading mode and verify chapter toolbar + inline chapter written Q&A
    const clickEv = {
      target: { closest: sel => sel === '[data-tb-action]' ? { dataset: { tbAction: 'mode', value: 'read' }, disabled: false } : null }
    };
    for (const fn of tbHandlers.get('click') || []) fn(clickEv);
    await app.settle(10);
    assert(tbRoot.innerHTML.includes('本章手寫問答'), 'BCSC chapter toolbar includes 本章手寫問答 button');
    assert(tbRoot.innerHTML.includes('tb-written-'), 'BCSC reading view embeds inline #tb-written-<chapterId> container');
  });

  await test('#tab-cram renders #cram-written jump link and high-yield / all Written Q&A cards across oph and non-oph', async () => {
    for (const spec of ['oph', 'rad']) {
      const app = bootApp({ spec });
      const cramHandlers = new Map();
      const cramRoot = {
        isConnected: true,
        dataset: {},
        innerHTML: '',
        querySelector() { return { focus() {}, scrollIntoView() {} }; },
        querySelectorAll() { return []; },
        addEventListener(n, fn) { cramHandlers.set(n, fn); }
      };
      app.document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/cram-review.js' };
      vm.runInContext(cramReviewScript, app.context);
      await app.context.window.OphCram.mount(cramRoot);
      await app.settle(20);

      assert(cramRoot.innerHTML.includes('href="#cram-written"'), `${spec} cram nav includes #cram-written link`);
      assert(cramRoot.innerHTML.includes('id="cram-written"'), `${spec} cram renders #cram-written section`);
      assert(cramRoot.innerHTML.includes('考前手寫問答衝刺'), `${spec} cram renders written Q&A heading`);
      const hyItem = PACKS[spec].items.find(x => x.cramHighYield);
      assert(hyItem && cramRoot.innerHTML.includes(hyItem.title), `${spec} cram shows high-yield written item`);
    }
  });

  await test('#tab-advanced renders Hard clinical essay view and inline deepDive Written Q&A while preserving 12Q timed MCQ', async () => {
    const app = bootApp({ spec: 'oph' });
    const advHandlers = new Map();
    const advRoot = {
      isConnected: true,
      dataset: {},
      innerHTML: '',
      querySelector() { return { focus() {} }; },
      querySelectorAll() { return []; },
      addEventListener(n, fn) { advHandlers.set(n, fn); }
    };
    app.document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/advanced-practice.js' };
    vm.runInContext(advancedPracticeScript, app.context);
    app.document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/advanced-training.js' };
    vm.runInContext(advancedTrainingScript, app.context);
    await app.context.window.OphAdvanced.mount(advRoot);
    await app.settle(25);

    assert(advRoot.innerHTML.includes('data-action="advanced-written"'), 'Hard home displays advanced-written button');
    assert(advRoot.innerHTML.includes('開始12題／18分鐘'), '12-question timed MCQ challenge entry remains intact');

    // Open Hard clinical essay view
    app.context.window.OphAdvanced.action('advanced-written', '');
    assert(advRoot.innerHTML.includes('Hard｜手寫申論問答'));
    const hard0 = PACKS.oph.items.find(x => x.category === 'hard');
    assert(advRoot.innerHTML.includes(hard0.title));

    // Open each deepDive unit and check inline Hard essay
    const deepDive0 = advancedData.deepDives[0];
    app.context.window.OphAdvanced.action('advanced-deepdive', deepDive0.id);
    assert(advRoot.innerHTML.includes('Hard 手寫臨床申論實戰'), `deepDive ${deepDive0.id} embeds Hard 手寫臨床申論實戰`);
    const matchedDeep = PACKS.oph.items.find(x => x.category === 'hard' && x.deepDiveId === deepDive0.id);
    assert(matchedDeep && advRoot.innerHTML.includes(matchedDeep.title));
  });

  await test('dual-mode workspace (text/ink/both), <textarea> autosave, <canvas> Pointer Events, undo/grow/clear, clearDevice, and v1/v2/v3 progress sync', () => {
    const app = bootApp({ spec: 'oph' });
    const item = PACKS.oph.items[0];
    app.fireClick('quiz-bank', 'written');

    // Mode toggles: text -> ink -> both
    app.written.action('written-mode', `${item.id}|text`);
    let cardHtml = app.written.renderCard(item);
    assert(cardHtml.includes('class="written-pane written-pane-ink" hidden'), 'mode=text hides ink pane');
    assert(!cardHtml.includes('class="written-pane written-pane-text" hidden'), 'mode=text shows text pane');

    app.written.action('written-mode', `${item.id}|ink`);
    cardHtml = app.written.renderCard(item);
    assert(!cardHtml.includes('class="written-pane written-pane-ink" hidden'), 'mode=ink shows ink pane');
    assert(cardHtml.includes('class="written-pane written-pane-text" hidden'), 'mode=ink hides text pane');

    app.written.action('written-mode', `${item.id}|both`);
    cardHtml = app.written.renderCard(item);
    assert(cardHtml.includes('written-workspace is-both'), 'mode=both activates side-by-side grid');

    // Textarea & note autosave to meta['written:' + id]
    app.written.input({ dataset: { writtenText: item.id }, value: '（1）角膜基質水腫（2）內皮細胞失代償' }, {});
    app.written.input({ dataset: { writtenNote: item.id }, value: '必背 Fuchs 指標' }, {});
    assert.equal(app.qa.meta['written:' + item.id].text, '（1）角膜基質水腫（2）內皮細胞失代償');
    assert.equal(app.qa.meta['written:' + item.id].note, '必背 Fuchs 指標');
    assert.equal(app.qa.meta['written:' + item.id].hasInk, false);

    // Canvas Pointer Events (Apple Pencil pressure + red pen + eraser + undo + grow + clear)
    app.qa.render();
    const canvas = app.canvasCache.get(item.id);
    assert(canvas, 'canvas bound via bindContainer');
    app.written.action('written-tool', `${item.id}|red`);
    canvas.dispatchPointer('pointerdown', { pointerId: 7, pointerType: 'pen', pressure: 0.8, clientX: 30, clientY: 45 });
    canvas.dispatchPointer('pointermove', { pointerId: 7, pointerType: 'pen', pressure: 0.8, clientX: 90, clientY: 85 });
    canvas.dispatchPointer('pointerup', { pointerId: 7, pointerType: 'pen', pressure: 0.8, clientX: 90, clientY: 85 });

    app.written.action('written-tool', `${item.id}|eraser`);
    canvas.dispatchPointer('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 50, clientY: 60 });
    canvas.dispatchPointer('pointermove', { pointerId: 8, pointerType: 'touch', clientX: 70, clientY: 65 });
    canvas.dispatchPointer('pointerup', { pointerId: 8, pointerType: 'touch', clientX: 70, clientY: 65 });

    let ink = app.written.getInk(item.id);
    assert.equal(ink.strokes.length, 2, '2 vector strokes recorded');
    assert.equal(ink.strokes[0].t, 'red');
    assert.equal(ink.strokes[1].t, 'eraser');
    assert.equal(app.qa.meta['written:' + item.id].hasInk, true, 'hasInk mirrored into meta');
    assert(app.local.getItem('oph-prep:written-ink-v1'), 'strokes persisted under SPEC.storePrefix + written-ink-v1');

    // Undo removes last stroke
    app.written.action('written-undo', item.id);
    assert.equal(app.written.getInk(item.id).strokes.length, 1);

    // Grow increases canvas height by +160px
    app.written.action('written-grow', item.id);
    assert.equal(app.written.getInk(item.id).h, 420);

    // Clear ink removes strokes and sets hasInk=false
    app.written.action('written-clear-ink', item.id);
    assert.equal(app.written.getInk(item.id).strokes.length, 0);
    assert.equal(app.qa.meta['written:' + item.id].hasInk, false);

    // Add one stroke again, then verify clearDevice() wipes written-ink-v1
    app.written.addStroke(item.id, { t: 'navy', w: 2.4, pts: [10, 10, 40, 40] });
    assert(app.local.getItem('oph-prep:written-ink-v1'));
    app.qa.clearDevice();
    assert.equal(app.local.getItem('oph-prep:written-ink-v1'), null, 'clearDevice removes written-ink-v1 from localStorage');

    // v1 / v2 / v3 progress import/export round-trip
    for (const ver of [1, 2, 3]) {
      const freshApp = bootApp({ spec: 'oph' });
      const k = 'written:' + item.id;
      freshApp.qa.mergeProgress({
        format: 'ophthalmology-prep-progress-v' + ver,
        entries: {
          [k]: { completed: true, selfScore: 2, checks: [true, false, true], revealed: true, at: '2026-11-07T02:00:00.000Z' },
          'written:bad': { completed: 'nope', selfScore: 99, at: 'invalid-date' }
        },
        meta: {
          [k]: { text: '雲端同步擬答重點', note: '口訣筆記', hasInk: true, at: '2026-11-07T02:00:00.000Z' },
          'written:bad': { text: 'x'.repeat(9000), at: 'invalid-date' }
        }
      });
      const exported = freshApp.qa.progressPayload();
      assert.equal(exported.entries[k].completed, true, `v${ver} preserves valid written entry`);
      assert.deepEqual(exported.entries[k].checks, [true, false, true], `v${ver} preserves keyPoints checks`);
      assert.equal(exported.meta[k].text, '雲端同步擬答重點', `v${ver} preserves written text draft`);
      assert.equal(exported.meta[k].hasInk, true, `v${ver} preserves hasInk flag`);
      assert.equal(exported.entries['written:bad'], undefined, `v${ver} rejects malformed written entry`);
      assert.equal(exported.meta['written:bad'], undefined, `v${ver} rejects oversized/invalid written meta`);
    }
  });

  await test('answer reveal, 一鍵展開全部標準答案, keyPoints checklist, SRS Good/Again scheduling, #tab-study queue, and #written-<id> deep links', async () => {
    const app = bootApp({ spec: 'oph' });
    const item1 = PACKS.oph.items[0];
    const item2 = PACKS.oph.items[1];
    app.fireClick('quiz-bank', 'written');

    // Single toggle answer
    assert(!app.written.renderCard(item1).includes('標準參考答案'));
    app.written.action('written-toggle-answer', item1.id);
    assert(app.written.renderCard(item1).includes('標準參考答案'));

    // Section-level reveal all & collapse all
    app.written.action('written-reveal-all', 'quiz|open');
    assert(app.written.renderCard(item2).includes('標準參考答案'));
    app.written.action('written-reveal-all', 'quiz|close');
    assert(!app.written.renderCard(item2).includes('標準參考答案'));

    // Interactive keyPoints checklist
    app.written.change({ dataset: { writtenCheck: `${item1.id}|0` }, checked: true });
    app.written.change({ dataset: { writtenCheck: `${item1.id}|2` }, checked: true });
    const cardAfterCheck = app.written.renderCard(item1);
    assert(cardAfterCheck.includes(`命中得分點 2 / ${item1.keyPoints.length}`), 'shows updated keyPoints hit count');

    // SRS self-rating: item1 -> good (mastered, due tomorrow), item2 -> again (review, due in 10m)
    app.written.action('written-rate', `${item1.id}|good`);
    assert.equal(app.qa.entries['written:' + item1.id].completed, true);
    assert.equal(app.qa.entries['written:' + item1.id].selfScore, 2);
    const srs1 = app.studyBridge.read('study:srs:written:' + item1.id);
    assert(srs1 && srs1.plan.rating === 'good' && srs1.plan.dueAt === '2026-11-08T02:00:00.000Z');

    app.written.action('written-rate', `${item2.id}|again`);
    assert.equal(app.qa.entries['written:' + item2.id].completed, false);
    assert.equal(app.qa.entries['written:' + item2.id].selfScore, 1);
    const srs2 = app.studyBridge.read('study:srs:written:' + item2.id);
    assert(srs2 && srs2.plan.rating === 'again' && srs2.plan.step === -1);

    // Mount #tab-study and verify poolFilter="written" + nextReview('due') & nextReview('weak')
    const studyHandlers = new Map();
    const studyRoot = { isConnected: true, dataset: {}, innerHTML: '', addEventListener(n, fn) { studyHandlers.set(n, fn); } };
    await app.study.mount(studyRoot);
    assert(studyRoot.innerHTML.includes('data-study-pool') && studyRoot.innerHTML.includes('<option value="written"'), '#tab-study renders 手寫問答 pool filter');
    assert(studyRoot.innerHTML.includes(`手寫問答 ${PACKS.oph.items.length} 題`), '#tab-study header counts written items');

    app.study.setClock(() => Date.parse('2026-11-07T02:15:00.000Z'));
    const duePick = await app.study.nextReview('due');
    assert.equal(duePick.pool, 'written');
    assert.equal(duePick.id, item2.id);
    assert.equal(app.location.hash, '#written-' + item2.id);

    const weakPick = await app.study.nextReview('weak');
    assert.equal(weakPick.id, item2.id);

    // Deep link parseRoute / routeLabel / bookmarking + XSS safety
    const parsed = app.qa.parseRoute('#written-' + item1.id);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { kind: 'written', id: item1.id, hash: '#written-' + item1.id });
    assert(app.qa.routeLabel(parsed).includes(item1.title));
    app.qa.openRoute('#written-' + item1.id);
    assert.equal(app.qa.currentViewHash(), '#written-' + item1.id);
    assert.equal(app.qa.routeMatchesView(parsed), true);
    app.fireClick('link-save', '#written-' + item1.id);
    app.fireClick('tab', 'links');
    assert(app.main().includes('#written-' + item1.id), '#tab-links bookmarks #written-<id>');

    // XSS escaping check
    const xssHtml = app.written.renderCard({
      id: 'wq-oph-xss',
      specialty: 'oph',
      category: 'chapter',
      topicId: 'notes-01',
      format: '<script>alert(1)</script>',
      title: '<img src=x onerror=alert(2)>',
      prompt: 'Prompt <b>raw</b>',
      answer: 'Answer <svg onload=alert(3)>',
      keyPoints: ['KP <iframe src=evil>'],
      pitfall: 'Pitfall <script>',
      sourceRef: 'Ref <a href=javascript:1>'
    });
    assert(!xssHtml.includes('<script>'), 'escapes <script> tags');
    assert(!xssHtml.includes('<img src=x'), 'escapes raw <img> tags');
    assert(!xssHtml.includes('<svg onload'), 'escapes raw <svg> tags');
  });

  await test('validate-written-qa.py passes on real/synthetic packs, supports --allow-missing, and rejects invalid packs', () => {
    const validator = path.join(__dirname, 'validate-written-qa.py');

    // 1. Real repo check (--allow-missing if sibling packs absent, strict if all 5 exist)
    const allRealExist = SPECIALTIES.every(s => fs.existsSync(path.join(root, 'content', 'written-qa', `${s}.json`)));
    if (allRealExist) {
      execFileSync('python3', [validator], { encoding: 'utf8' });
    } else {
      execFileSync('python3', [validator, '--allow-missing'], { encoding: 'utf8' });
    }

    // 2. Empty temp dir with --allow-missing passes; without --allow-missing fails
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-val-'));
    try {
      const emptyDir = path.join(tmpBase, 'empty');
      fs.mkdirSync(emptyDir);
      execFileSync('python3', [validator, '--dir', emptyDir, '--allow-missing'], { encoding: 'utf8' });
      const missingRes = spawnSync('python3', [validator, '--dir', emptyDir], { encoding: 'utf8' });
      assert.notEqual(missingRes.status, 0, 'strict mode fails when files are missing');

      // 3. Complete valid synthetic 5-pack dir passes strict mode
      const validDir = path.join(tmpBase, 'valid');
      fs.mkdirSync(validDir);
      for (const s of SPECIALTIES) {
        fs.writeFileSync(path.join(validDir, `${s}.json`), JSON.stringify(buildSyntheticPack(s), null, 2));
      }
      execFileSync('python3', [validator, '--dir', validDir], { encoding: 'utf8' });

      // 4. Malformed pack (raw LaTeX + control char + duplicate ID) is rejected
      const badDir = path.join(tmpBase, 'bad');
      fs.mkdirSync(badDir);
      for (const s of SPECIALTIES) {
        const pack = buildSyntheticPack(s);
        if (s === 'oph') {
          pack.items[1].id = pack.items[0].id; // duplicate ID
          pack.items[2].answer += ' \\frac{1}{2} raw latex';
          pack.items[3].prompt += '\x07 bell control char';
        }
        fs.writeFileSync(path.join(badDir, `${s}.json`), JSON.stringify(pack));
      }
      const badRes = spawnSync('python3', [validator, '--dir', badDir], { encoding: 'utf8' });
      assert.notEqual(badRes.status, 0, 'validator rejects duplicate ID, raw LaTeX, and control characters');
      assert(badRes.stderr.includes('duplicate id') && badRes.stderr.includes('LaTeX') && badRes.stderr.includes('control character'));
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  await test('cold-start async regressions: #written-<id> focus/scroll, #cram-written, #<topicId>-written, and non-oph todayReview() SRS due count before pack resolves', async () => {
    const createDeferred = () => {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      return { promise, resolve };
    };

    // 1. Cold-start #written-<id> with delayed fetch: aligns quizFocusIdx & scrolls after pack resolves
    const targetIdx = 4;
    const targetItem = PACKS.oph.items[targetIdx];
    const ophDeferred = createDeferred();
    const appColdWritten = bootApp({
      spec: 'oph',
      hash: '#written-' + targetItem.id,
      primePack: false,
      customFetch: url => {
        if (String(url).includes('content/written-qa/oph.json')) return ophDeferred.promise;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, hospitals: [] }) });
      }
    });
    assert.equal(appColdWritten.qa.S.tab, 'quiz', 'cold-start #written-<id> switches to quiz tab immediately');
    assert(appColdWritten.main().includes('正在載入手寫問答與申論題庫'), 'renders loading card while fetch is pending');
    assert(!appColdWritten.scrolledIds.includes('written-' + targetItem.id), 'cannot scroll before card exists in DOM');

    // Switch to focus mode while still loading, then resolve delayed fetch
    appColdWritten.written.action('written-view', 'focus');
    ophDeferred.resolve({ ok: true, status: 200, json: async () => structuredClone(PACKS.oph) });
    await appColdWritten.settle(30);

    assert(appColdWritten.scrolledIds.includes('written-' + targetItem.id), 'scrolls #written-<id> into view once async pack resolves');
    assert(appColdWritten.main().includes(`第 ${targetIdx + 1} / ${PACKS.oph.items.length} 題`), 'aligns quizFocusIdx to focusedId after async load');
    assert(appColdWritten.main().includes(targetItem.title), 'focus view renders the deep-linked question');

    // 2. Cold-start #cram-written route & delayed fetch scroll
    const entCramDeferred = createDeferred();
    const appColdCram = bootApp({
      spec: 'ent',
      hash: '#cram-written',
      primePack: false,
      customFetch: url => {
        const u = String(url);
        if (u.includes('content/written-qa/ent.json')) return entCramDeferred.promise;
        if (u.includes('content/ent/cram-review.json')) return Promise.resolve({ ok: true, status: 200, json: async () => readJson('content/ent/cram-review.json') });
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
    });
    const parsedCram = appColdCram.qa.parseRoute('#cram-written');
    assert.deepEqual(JSON.parse(JSON.stringify(parsedCram)), { kind: 'tab', tab: 'cram', hash: '#cram-written' });
    assert.equal(appColdCram.qa.routeLabel(parsedCram), '共筆考前衝刺 · 手寫問答');
    assert.equal(appColdCram.qa.S.tab, 'cram');
    assert.equal(appColdCram.location.hash, '#cram-written', 'preserves #cram-written hash during tab switch');

    let cramScrollCount = 0;
    const cramLiveNode = appColdCram.element('#cram-root-live');
    const cramRoot = {
      isConnected: true,
      dataset: {},
      get innerHTML() { return cramLiveNode.innerHTML; },
      set innerHTML(v) { cramLiveNode.innerHTML = v; },
      querySelector(sel) {
        if (sel === '#cram-written') return { scrollIntoView() { cramScrollCount++; } };
        return { focus() {}, scrollIntoView() {} };
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    };
    appColdCram.document.currentScript = { src: 'https://qwwaawwqq.github.io/ophthalmology-interview-public/scripts/cram-review.js' };
    vm.runInContext(cramReviewScript, appColdCram.context);
    await appColdCram.context.window.OphCram.mount(cramRoot);
    await appColdCram.settle(20);
    assert(cramScrollCount >= 1, 'cram-review scrolls #cram-written into view on initial mount');
    assert(cramRoot.innerHTML.includes('正在載入考前手寫問答題'), 'shows loading placeholder before ent.json resolves');

    const beforePackScrolls = cramScrollCount;
    entCramDeferred.resolve({ ok: true, status: 200, json: async () => structuredClone(PACKS.ent) });
    await appColdCram.settle(30);
    const entHy = PACKS.ent.items.find(x => x.cramHighYield);
    assert(entHy && cramRoot.innerHTML.includes(entHy.title), 'hydrates ENT high-yield written items once pack resolves');
    assert(cramScrollCount > beforePackScrolls || appColdCram.scrolledIds.includes('cram-written'), 're-scrolls #cram-written after async pack refresh');

    // 3. Cold-start #<topicId>-written on non-oph chapter (verifies coverageTarget before chapterCoverage + async re-scroll)
    const radDeferred = createDeferred();
    const radPack = PACKS.rad;
    const radTopicId = radPack.items.find(x => x.category === 'chapter' && !x.topicId.endsWith('-01'))?.topicId || radPack.items[0].topicId;
    const appColdChapter = bootApp({
      spec: 'rad',
      hash: `#${radTopicId}-written`,
      primePack: false,
      customFetch: url => {
        if (String(url).includes('content/written-qa/rad.json')) return radDeferred.promise;
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
    });
    const radTopic = appColdChapter.qa.D.topics.find(t => t.id === radTopicId);
    const noCovTopic = { id: 'nocov-01', chapter: 1, sections: [] };
    assert.equal(appColdChapter.qa.chapterCoverage(noCovTopic), null);
    assert.equal(appColdChapter.qa.coverageTarget(noCovTopic, 'written'), true, 'coverageTarget returns true for written even without D.coverage');
    assert.equal(appColdChapter.qa.coverageTarget(radTopic, 'written'), true);
    assert.equal(appColdChapter.qa.S.tab, 'learn');
    assert.equal(appColdChapter.qa.S.learn, radTopicId);
    appColdChapter.scrolledIds.length = 0;

    radDeferred.resolve({ ok: true, status: 200, json: async () => structuredClone(radPack) });
    await appColdChapter.settle(30);
    const radMatching = radPack.items.find(x => x.topicId === radTopicId);
    assert(appColdChapter.main().includes(radMatching.title), 'renders chapter written Q&A after delayed fetch');
    assert(appColdChapter.scrolledIds.includes(`${radTopicId}-written`), 'scrolls #<topicId>-written into view after async re-render');

    // 4. Cold-start non-oph todayReview() counts study:srs:written: due items BEFORE pack fetch resolves, then reconciles on pack ready
    const nmDeferred = createDeferred();
    const appColdToday = bootApp({
      spec: 'nm',
      primePack: false,
      customFetch: url => {
        if (String(url).includes('content/written-qa/nm.json')) return nmDeferred.promise;
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
    });
    const pastIso = '2026-11-07T01:00:00.000Z';
    const realNmId = PACKS.nm.items[0].id;
    const staleNmId = 'nm-wq-stale-removed-item';
    const mkDue = id => ({
      version: 1,
      at: pastIso,
      answerCount: 1,
      attempt: { id: 'tok-' + id, at: pastIso, correct: false, rated: true },
      plan: { step: -1, dueAt: pastIso, rating: 'again', reviewCount: 1, lapses: 1 }
    });
    appColdToday.qa.entries['study:srs:written:' + realNmId] = mkDue(realNmId);
    appColdToday.qa.entries['study:srs:written:' + staleNmId] = mkDue(staleNmId);
    appColdToday.qa.entries['study:srs:written:oph-wq-foreign'] = mkDue('oph-wq-foreign');
    appColdToday.qa.render();

    const preLoadToday = appColdToday.main();
    assert(preLoadToday.includes('<span>現在到期</span><strong>2</strong>'), 'counts nm-wq-* due items before nm.json resolves while ignoring foreign oph-wq-*');

    nmDeferred.resolve({ ok: true, status: 200, json: async () => structuredClone(PACKS.nm) });
    await appColdToday.settle(30);
    const postLoadToday = appColdToday.main();
    assert(postLoadToday.includes('<span>現在到期</span><strong>1</strong>'), 'today tab re-renders on pack ready and filters out stale non-bank written IDs');
  });

  await test('P2 hardening: WebKit 16M pixel cap, QuotaExceededError toast + hasInk protection, legacy mouse/touch fallback, and <=80 ID validation', () => {
    const local = new MemoryStorage();
    const app = bootApp({ spec: 'oph', local });
    const itemA = PACKS.oph.items[0];
    const itemB = PACKS.oph.items[1];

    // 1. WebKit 16M pixel & 4096 dimension cap on giant high-DPR canvas
    app.window.devicePixelRatio = 3;
    for (let i = 0; i < 8; i++) app.written.growCanvas(itemA.id, 160); // grow to MAX_HEIGHT (1540)
    const hugeCanvas = createMockCanvas(itemA.id);
    hugeCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 1540 });
    app.written.bindContainer({
      innerHTML: `data-written-canvas="${itemA.id}"`,
      querySelectorAll: sel => (sel === 'canvas[data-written-canvas]' ? [hugeCanvas] : []),
      addEventListener() {}
    });
    assert(hugeCanvas.width <= 4096 && hugeCanvas.height <= 4096, `canvas dimensions capped <= 4096 (got ${hugeCanvas.width}x${hugeCanvas.height})`);
    assert(hugeCanvas.width * hugeCanvas.height <= 16000000, `canvas area capped <= 16M pixels (got ${hugeCanvas.width * hugeCanvas.height})`);

    // 2. QuotaExceededError on setItem does NOT mark hasInk:true and triggers user toast
    const origSetItem = local.setItem.bind(local);
    local.setItem = (k, v) => {
      if (String(k).endsWith('written-ink-v1')) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return origSetItem(k, v);
    };
    const saved = app.written.addStroke(itemB.id, { t: 'navy', pts: [12, 12, 60, 60] });
    assert.equal(saved, false, 'addStroke returns false when storage quota is exceeded');
    assert.equal(Boolean(app.qa.meta['written:' + itemB.id]?.hasInk), false, 'does NOT falsely mark hasInk: true when stroke failed to persist');
    assert(app.toasts.some(t => t.includes('本機儲存空間已滿')), 'displays storage-full toast to user');

    // Restore storage and verify legacy mouse/touch fallback when PointerEvent is undefined
    local.setItem = origSetItem;
    assert.equal(typeof app.window.PointerEvent, 'undefined', 'VM has no PointerEvent so fallback listeners are bound');
    const fbCanvas = createMockCanvas(itemB.id);
    app.written.bindContainer({
      innerHTML: `data-written-canvas="${itemB.id}"`,
      querySelectorAll: sel => (sel === 'canvas[data-written-canvas]' ? [fbCanvas] : []),
      addEventListener() {}
    });
    fbCanvas.dispatchPointer('mousedown', { button: 0, clientX: 25, clientY: 35 });
    fbCanvas.dispatchPointer('mousemove', { clientX: 70, clientY: 85 });
    fbCanvas.dispatchPointer('mouseup', { clientX: 70, clientY: 85 });
    assert.equal(app.written.getInk(itemB.id).strokes.length, 1, 'mousedown/mousemove/mouseup fallback records stroke');

    fbCanvas.dispatchPointer('touchstart', { changedTouches: [{ identifier: 7, clientX: 30, clientY: 40, force: 0.5 }] });
    fbCanvas.dispatchPointer('touchmove', { changedTouches: [{ identifier: 7, clientX: 90, clientY: 95, force: 0.5 }] });
    fbCanvas.dispatchPointer('touchend', { changedTouches: [{ identifier: 7, clientX: 90, clientY: 95 }] });
    assert.equal(app.written.getInk(itemB.id).strokes.length, 2, 'touchstart/touchmove/touchend fallback records stroke');

    // 3. <= 80 char written ID validation alignment in practiceEntry / practiceMeta / parseRoute
    const id78 = 'oph-wq-' + 'a'.repeat(71); // total length 78 (previously rejected by {1,64}!)
    const id81 = 'oph-wq-' + 'a'.repeat(74); // total length 81 (> 80)
    assert.equal(id78.length, 78);
    assert.equal(id81.length, 81);
    assert(app.qa.practiceEntry('written:' + id78, { completed: true, selfScore: 2, checks: [true], revealed: true, at: '2026-11-07T02:00:00.000Z' }) !== null, 'accepts 78-char written ID in practiceEntry');
    assert(app.qa.practiceMeta('written:' + id78, { text: 'ok', note: '', hasInk: false, at: '2026-11-07T02:00:00.000Z' }) !== null, 'accepts 78-char written ID in practiceMeta');
    assert(app.qa.parseRoute('#written-' + id78) !== null, 'accepts 78-char written ID in parseRoute');
    assert.equal(app.qa.practiceEntry('written:' + id81, { completed: true, at: '2026-11-07T02:00:00.000Z' }), null, 'rejects 81-char written ID in practiceEntry');
    assert.equal(app.qa.practiceMeta('written:' + id81, { text: 'ok', at: '2026-11-07T02:00:00.000Z' }), null, 'rejects 81-char written ID in practiceMeta');
    assert.equal(app.qa.parseRoute('#written-' + id81), null, 'rejects 81-char written ID in parseRoute');
  });

  await test('Codex P1: bindContainer stops DOM bubbling to document so toggle-answer, undo, SRS rating, and inputs fire exactly once while non-written actions still bubble', () => {
    const app = bootApp({ spec: 'oph' });
    const item = PACKS.oph.items[0];
    app.fireClick('quiz-bank', 'written');

    // Simulate nested slot container inside #main -> document 3-stage DOM bubbling
    const slotListeners = new Map();
    const slotContainer = {
      innerHTML: app.written.renderCard(item),
      querySelectorAll: () => [],
      addEventListener(type, fn) { slotListeners.set(type, fn); }
    };
    app.written.bindContainer(slotContainer);
    const mainNode = app.element('#main');
    assert(slotListeners.has('click') && mainNode._listeners.has('click'), 'both nested slot and #main bound');

    const dispatchBubbling = (type, ev) => {
      let propagationStopped = false;
      ev.stopPropagation = () => { propagationStopped = true; };
      ev.preventDefault = ev.preventDefault || (() => {});
      const sFn = slotListeners.get(type);
      if (sFn) sFn(ev);
      if (!propagationStopped) {
        const mFn = mainNode._listeners.get(type);
        if (mFn) mFn(ev);
      }
      if (!propagationStopped) {
        for (const dFn of app.docHandlers.get(type) || []) dFn(ev);
      }
      return propagationStopped;
    };

    const dispatchBubblingAction = (actionName, value, tagName = 'BUTTON') => {
      const btn = { tagName, dataset: { action: actionName, value: String(value) }, disabled: false, setAttribute() {} };
      return dispatchBubbling('click', {
        target: { closest: sel => (sel === '[data-action]' ? btn : null) }
      });
    };

    // 1. written-toggle-answer opens and STAYS open (toggled once, not open-then-closed)
    assert(!app.written.renderCard(item).includes('標準參考答案'), 'answer starts collapsed');
    const toggleStopped = dispatchBubblingAction('written-toggle-answer', item.id);
    assert.equal(toggleStopped, true, 'written-toggle-answer stops propagation before document');
    assert.equal(app.qa.entries['written:' + item.id]?.revealed, true, 'entry marked revealed');
    assert(app.written.renderCard(item).includes('標準參考答案'), 'answer panel stays expanded after single click');

    // 2. written-undo removes only 1 stroke (from 3 -> 2, not 3 -> 1)
    app.written.addStroke(item.id, { t: 'navy', w: 2.4, cw: 680, pts: [10, 10, 40, 40] });
    app.written.addStroke(item.id, { t: 'black', w: 2.4, cw: 680, pts: [50, 20, 80, 50] });
    app.written.addStroke(item.id, { t: 'red', w: 2.6, cw: 680, pts: [90, 30, 120, 60] });
    assert.equal(app.written.getInk(item.id).strokes.length, 3);
    const undoStopped = dispatchBubblingAction('written-undo', item.id);
    assert.equal(undoStopped, true, 'written-undo stops propagation before document');
    assert.equal(app.written.getInk(item.id).strokes.length, 2, 'single click undoes exactly 1 stroke');

    // 3. written-rate ('good') advances SRS exactly 1 step (reviewCount=1, step=0), not 2 steps
    assert.equal(app.studyBridge.read('study:srs:written:' + item.id), null);
    const rateStopped = dispatchBubblingAction('written-rate', `${item.id}|good`);
    assert.equal(rateStopped, true, 'written-rate stops propagation before document');
    const srsAfterOneClick = app.studyBridge.read('study:srs:written:' + item.id);
    assert.equal(srsAfterOneClick.answerCount, 1, 'SRS answerCount incremented once');
    assert.equal(srsAfterOneClick.plan.reviewCount, 1, 'SRS reviewCount incremented once');
    assert.equal(srsAfterOneClick.plan.step, 0, 'SRS step advanced once to step 0 (not double-stepped to 1)');

    // 4. Bubbling input & change events also stop propagation cleanly
    const inputStopped = dispatchBubbling('input', {
      target: { dataset: { writtenText: item.id }, value: '單次冒泡文字測試' }
    });
    assert.equal(inputStopped, true, 'written input stops propagation');
    assert.equal(app.qa.meta['written:' + item.id].text, '單次冒泡文字測試');

    const changeStopped = dispatchBubbling('change', {
      target: { dataset: { writtenCheck: `${item.id}|1` }, checked: true }
    });
    assert.equal(changeStopped, true, 'written checkbox change stops propagation');
    assert.equal(app.qa.entries['written:' + item.id].checks[1], true);

    // 5. Non-written action inside a card (link-save) MUST continue bubbling to document
    const linkSaveStopped = dispatchBubblingAction('link-save', '#written-' + item.id);
    assert.equal(linkSaveStopped, false, 'non-written link-save is NOT stopped by bindContainer');
    app.fireClick('tab', 'links');
    assert(app.main().includes('#written-' + item.id), 'link-save bubbled to document and saved bookmark');
  });

  await test('Codex P2 #1: routeMatchesView and matchesRoute enforce written quiz sub-mode and exact question ID on same-page hash navigation', () => {
    // (a) Ophthalmology (#tab-quiz MCQ -> #written & #written-<id>)
    const app = bootApp({ spec: 'oph', hash: '#tab-quiz' });
    const item1 = PACKS.oph.items[0];
    const item2 = PACKS.oph.items[2];
    assert.equal(app.qa.S.tab, 'quiz');
    assert.equal(app.window.OphQuizBank.getMode(), 'core', 'starts on MCQ core mode');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written')), false, 'MCQ mode must NOT match #written');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item1.id)), false, 'MCQ mode must NOT match #written-<id>');

    // Navigate via hashchange / appRestoreHash from MCQ -> #written
    app.location.hash = '#written';
    app.qa.appRestoreHash();
    assert.equal(app.window.OphQuizBank.getMode(), 'written', 'appRestoreHash(#written) switches quiz into written mode');
    assert(app.main().includes('written-bank-root'), 'renders written bank');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written')), true);

    // Switch back to MCQ, then navigate via hash directly to #written-<id1>
    app.fireClick('quiz-bank', 'core');
    assert.equal(app.window.OphQuizBank.getMode(), 'core');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item1.id)), false);
    app.location.hash = '#written-' + item1.id;
    for (const fn of app.winHandlers.get('hashchange') || []) fn();
    assert.equal(app.window.OphQuizBank.getMode(), 'written', 'hashchange to #written-<id1> switches from MCQ to written mode');
    assert(app.main().includes(`id="written-${item1.id}"`), 'renders target question');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item1.id)), true);

    // (b) Same-page navigation in written single-question focus mode: #written-<id1> -> #written-<id2> -> #written
    app.written.action('written-view', 'focus');
    assert(app.main().includes(item1.title) && !app.main().includes(item2.title), 'focus mode shows item1 initially');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item2.id)), false, 'must return false when focused on item1 and checking route for item2');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written')), false, 'must return false for generic #written while locked on item1');

    app.location.hash = '#written-' + item2.id;
    for (const fn of app.winHandlers.get('hashchange') || []) fn();
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item2.id)), true, 'matches item2 after hashchange');
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written-' + item1.id)), false, 'no longer matches item1');
    assert(app.main().includes(item2.title) && !app.main().includes(item1.title), 'focus view updates to item2');
    assert(app.main().includes(`第 3 / ${PACKS.oph.items.length} 題`), 'focus counter aligns to item2');

    app.location.hash = '#written';
    for (const fn of app.winHandlers.get('hashchange') || []) fn();
    assert.equal(app.qa.routeMatchesView(app.qa.parseRoute('#written')), true, '#written clears focusedId lock');
    assert.equal(app.qa.currentViewHash(), '#written');

    // (c) Non-oph specialty (ENT) #tab-quiz MCQ -> #written-<id>
    const appEnt = bootApp({ spec: 'ent', hash: '#tab-quiz' });
    const entItem1 = PACKS.ent.items[1];
    assert.equal(appEnt.qa.S.tab, 'quiz');
    assert.equal(appEnt.window.OphQuizBank.getMode(), 'mcq');
    assert.equal(appEnt.qa.routeMatchesView(appEnt.qa.parseRoute('#written')), false);
    assert.equal(appEnt.qa.routeMatchesView(appEnt.qa.parseRoute('#written-' + entItem1.id)), false);
    appEnt.location.hash = '#written-' + entItem1.id;
    for (const fn of appEnt.winHandlers.get('hashchange') || []) fn();
    assert.equal(appEnt.window.OphQuizBank.getMode(), 'written', 'ENT switches specQuizMode from mcq to written');
    assert(appEnt.main().includes(`id="written-${entItem1.id}"`));
    assert.equal(appEnt.qa.routeMatchesView(appEnt.qa.parseRoute('#written-' + entItem1.id)), true);
  });

  await test('Codex P2 #2: canvas strokes record reference width cw and proportionally scale X coordinates across 900px full-width and 450px split-column modes', () => {
    const app = bootApp({ spec: 'oph' });
    const item = PACKS.oph.items[0];
    let cssWidth = 900;
    const dynCanvas = createMockCanvas(item.id);
    dynCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssWidth, height: 260 });

    const mountAtCurrentWidth = () => {
      dynCanvas.ops.length = 0;
      app.written.bindContainer({
        innerHTML: `data-written-canvas="${item.id}"`,
        querySelectorAll: sel => (sel === 'canvas[data-written-canvas]' ? [dynCanvas] : []),
        addEventListener() {}
      });
    };

    // 1. Full-width ink mode (900px): write stroke near right margin x = 720..810
    app.written.action('written-mode', `${item.id}|ink`);
    mountAtCurrentWidth();
    dynCanvas.dispatchPointer('pointerdown', { pointerId: 11, pointerType: 'pen', pressure: 0.5, clientX: 720, clientY: 80 });
    dynCanvas.dispatchPointer('pointermove', { pointerId: 11, pointerType: 'pen', pressure: 0.5, clientX: 765, clientY: 110 });
    dynCanvas.dispatchPointer('pointermove', { pointerId: 11, pointerType: 'pen', pressure: 0.5, clientX: 810, clientY: 140 });
    dynCanvas.dispatchPointer('pointerup', { pointerId: 11, pointerType: 'pen', pressure: 0.5, clientX: 810, clientY: 140 });

    const stored = app.written.getInk(item.id);
    assert.equal(stored.strokes.length, 1);
    assert.equal(stored.strokes[0].cw, 900, 'persists reference canvas CSS width cw=900');
    assert.deepEqual(stored.strokes[0].pts, [720, 80, 765, 110, 810, 140]);

    // 2. Switch to split-column mode (450px): X coordinates scale by 0.5 into 360..405 (<= 450), Y unchanged
    cssWidth = 450;
    app.written.action('written-mode', `${item.id}|both`);
    mountAtCurrentWidth();
    const splitCoords = dynCanvas.ops.filter(op => Array.isArray(op) && (op[0] === 'moveTo' || op[0] === 'lineTo'));
    assert.deepEqual(splitCoords, [
      ['moveTo', 360, 80],
      ['lineTo', 382.5, 110],
      ['lineTo', 405, 140]
    ], '900px stroke scales proportionally into 360..405 on 450px split canvas without clipping');
    assert(splitCoords.every(([, x]) => x >= 360 && x <= 450), 'all scaled X coordinates stay inside 450px canvas');

    // 3. Switch back to full-width ink mode (900px): X coordinates restore cleanly to 720..810
    cssWidth = 900;
    app.written.action('written-mode', `${item.id}|ink`);
    mountAtCurrentWidth();
    const restoredCoords = dynCanvas.ops.filter(op => Array.isArray(op) && (op[0] === 'moveTo' || op[0] === 'lineTo'));
    assert.deepEqual(restoredCoords, [
      ['moveTo', 720, 80],
      ['lineTo', 765, 110],
      ['lineTo', 810, 140]
    ], 'switching back to 900px restores exact 720..810 X coordinates');

    // 4. Legacy strokes without cw remain backward-compatible (scaleX = 1)
    app.written.clearInk(item.id);
    app.written.addStroke(item.id, { t: 'black', w: 2.4, pts: [100, 50, 200, 90] });
    cssWidth = 450;
    mountAtCurrentWidth();
    const legacyCoords = dynCanvas.ops.filter(op => Array.isArray(op) && (op[0] === 'moveTo' || op[0] === 'lineTo'));
    assert.deepEqual(legacyCoords, [
      ['moveTo', 100, 50],
      ['lineTo', 200, 90]
    ], 'legacy strokes without cw render at 1:1 without error');
  });

  await test('Issue #197: ENT written-past mode, quick-scope filter bar, #written-past deep-link, and cold-start hydration', async () => {
    const countCards = markup => (markup.match(/<article class="card written-card"/g) || []).length;
    const firstCardId = markup => (markup.match(/data-written-card="([^"]+)"/) || [])[1] || null;

    assert.equal(PACKS.ent.items.length, 49, 'ENT written pack has 49 total items');

    // 1. Clicking spec-quiz-mode written-past and toggling written-scope past / all
    const app = bootApp({ spec: 'ent', hash: '#tab-quiz' });
    assert.equal(app.written.pastCount('ent'), 16, 'ENT written pastCount is 16');
    assert.equal(app.written.pastCount('oph'), 0, 'OPH written pastCount is 0');
    assert(app.main().includes('110–113 筆試申論（16 組 · 中榮為主 · 含完整答案）'));

    app.fireClick('spec-quiz-mode', 'written-past');
    assert.equal(app.window.OphQuizBank.getMode(), 'written', 'OphQuizBank.getMode() stays strictly written');
    assert.equal(app.written.getQuizScope(), 'past');
    assert.equal(app.location.hash, '#written-past');
    let fullHtml = app.element('#main')._innerHTML;
    assert(fullHtml.includes('data-value="written-past" aria-pressed="true"'), 'top bar highlights written-past');
    assert(fullHtml.includes('data-value="written" aria-pressed="false"'), 'top bar unhighlights generic written');
    assert(fullHtml.includes('data-written-quick-scope'), 'renders quick-scope filter bar');
    assert(fullHtml.includes('<option value="past" selected>110–113 各院筆試申論（16 組）</option>'));
    assert.equal(countCards(app.main()), 16, 'filters ENT written items to 16 past-exam sets');
    assert.equal(firstCardId(app.main()), 'ent-wq-past-01', 'ent-wq-past-01 renders first');

    // Toggle quick-scope button to all -> 49 items, ent-wq-ent-01-01 first, top bar & hash sync to #written
    app.fireClick('written-scope', 'all');
    assert.equal(app.written.getQuizScope(), 'all');
    assert.equal(app.location.hash, '#written');
    fullHtml = app.element('#main')._innerHTML;
    assert(fullHtml.includes('data-value="written" aria-pressed="true"'), 'top bar syncs to generic written');
    assert(fullHtml.includes('data-value="written-past" aria-pressed="false"'), 'top bar unhighlights written-past');
    assert.equal(countCards(app.main()), 49, 'restores all 49 ENT written items');
    assert.equal(firstCardId(app.main()), 'ent-wq-ent-01-01', 'ent-wq-ent-01-01 renders first');

    // Toggle quick-scope button back to past -> 16 items
    app.fireClick('written-scope', 'past');
    assert.equal(app.written.getQuizScope(), 'past');
    assert.equal(app.location.hash, '#written-past');
    assert.equal(countCards(app.main()), 16);
    assert.equal(firstCardId(app.main()), 'ent-wq-past-01');

    // Scope <select data-written-filter="scope"> change also syncs top bar and hash
    app.written.change({ dataset: { writtenFilter: 'scope' }, value: 'all' });
    assert.equal(app.written.getQuizScope(), 'all');
    assert.equal(app.location.hash, '#written');
    assert.equal(countCards(app.main()), 49);
    assert(app.element('#main')._innerHTML.includes('data-value="written" aria-pressed="true"'));

    // Clicking spec-quiz-mode written from written-past resets scope to all
    app.fireClick('spec-quiz-mode', 'written-past');
    assert.equal(countCards(app.main()), 16);
    app.fireClick('spec-quiz-mode', 'written');
    assert.equal(app.written.getQuizScope(), 'all');
    assert.equal(app.location.hash, '#written');
    assert.equal(countCards(app.main()), 49);
    assert.equal(firstCardId(app.main()), 'ent-wq-ent-01-01');

    // 2. Direct deep-link boot ?s=ent#written-past (both primed and cold-start async fetch)
    const appDeep = bootApp({ spec: 'ent', hash: '#written-past' });
    assert.equal(appDeep.qa.S.tab, 'quiz');
    assert.equal(appDeep.window.OphQuizBank.getMode(), 'written');
    assert.equal(appDeep.written.getQuizScope(), 'past');
    assert.equal(appDeep.location.hash, '#written-past');
    assert.equal(countCards(appDeep.main()), 16);
    assert.equal(firstCardId(appDeep.main()), 'ent-wq-past-01');
    assert.equal(appDeep.qa.routeMatchesView(appDeep.qa.parseRoute('#written-past')), true);
    assert.equal(appDeep.qa.routeMatchesView(appDeep.qa.parseRoute('#written')), false);

    // Same-page hash navigation #written-past -> #written -> #kaogu -> #tab-quiz
    appDeep.location.hash = '#written';
    for (const fn of appDeep.winHandlers.get('hashchange') || []) fn();
    assert.equal(appDeep.written.getQuizScope(), 'all');
    assert.equal(countCards(appDeep.main()), 49);

    appDeep.location.hash = '#kaogu';
    for (const fn of appDeep.winHandlers.get('hashchange') || []) fn();
    assert.equal(appDeep.window.OphQuizBank.getMode(), 'mcq');
    assert.equal(appDeep.qa.S.mode, 'kaogu-hosp');
    assert.equal(appDeep.qa.S.ids.length, 64);

    appDeep.location.hash = '#tab-quiz';
    for (const fn of appDeep.winHandlers.get('hashchange') || []) fn();
    assert.equal(appDeep.window.OphQuizBank.getMode(), 'mcq');
    assert.equal(appDeep.qa.S.mode, 'all');
    assert.equal(appDeep.qa.S.ids.length, 432);

    // Cold-start ?s=ent#written-past before ent.json resolves
    const appCold = bootApp({ spec: 'ent', hash: '#written-past', primePack: false });
    assert.equal(appCold.qa.S.tab, 'quiz');
    assert.equal(appCold.written.getQuizScope(), 'past');
    await appCold.settle(30);
    assert.equal(countCards(appCold.main()), 16, 'cold-start #written-past hydrates to 16 past sets');
    assert.equal(firstCardId(appCold.main()), 'ent-wq-past-01');

    // ?s=rad#written-past (pastCount === 0) keeps written pill active and openRoute('#written-past', true) normalizes hash to #written
    const radPastBoot = bootApp({ spec: 'rad', hash: '#written-past' });
    assert.equal(radPastBoot.qa.S.tab, 'quiz');
    assert.equal(radPastBoot.written.getQuizScope(), 'all');
    assert.equal(countCards(radPastBoot.main()), 36);
    assert(radPastBoot.main().includes('data-value="written" aria-pressed="true"'), 'rad #written-past keeps written mode pill active');
    radPastBoot.qa.openRoute('#written-past', true);
    assert.equal(radPastBoot.location.hash, '#written', 'openRoute(#written-past, true) on rad normalizes hash to #written');
    assert(radPastBoot.main().includes('data-value="written" aria-pressed="true"'));

    // Cold-start rad openRoute('#written-past', true) before rad.json resolves also normalizes hash to #written immediately
    const radCold = bootApp({ spec: 'rad', primePack: false });
    radCold.qa.openRoute('#written-past', true);
    assert.equal(radCold.location.hash, '#written', 'cold-start rad openRoute(#written-past, true) normalizes hash to #written');
    assert(radCold.main().includes('data-value="written" aria-pressed="true"'));
    await radCold.settle(30);
    assert.equal(countCards(radCold.main()), 36);
    assert.equal(radCold.location.hash, '#written');
  });

  await test('Issue #210: TCVGH (中榮) 110–113 past-exam written essay prioritization, dedicated filtering, badges, and deep-linking', async () => {
    const countCards = markup => (markup.match(/<article class="card written-card"/g) || []).length;
    const firstCardId = markup => (markup.match(/data-written-card="([^"]+)"/) || [])[1] || null;
    const app = bootApp({ spec: 'ent' });

    // 1. hasPastEssays, pastCount and tcvghPastCount API
    assert.equal(app.written.hasPastEssays('ent'), true, 'hasPastEssays("ent") returns true');
    assert.equal(app.written.pastCount('ent'), 16, 'ENT pastCount is 16');
    assert.equal(app.written.tcvghPastCount('ent'), 11, 'ENT tcvghPastCount is 11');
    assert.equal(app.written.tcvghPastCount('oph'), 0, 'OPH tcvghPastCount is 0');
    assert.equal(app.written.tcvghPastCount('rad'), 0, 'RAD tcvghPastCount is 0');

    // 2. TCVGH badges and dedicated filter bar render in #written-past
    const appEnt = bootApp({ spec: 'ent', hash: '#written-past' });
    assert.equal(appEnt.written.getQuizScope(), 'past');
    const mainHtml = appEnt.main();
    assert(mainHtml.includes('class="written-past-filter-bar"'), 'renders dedicated written-past-filter-bar in past scope');
    assert(mainHtml.includes('全部各院（16 組）'), 'filter bar contains 全部各院（16 組） button');
    assert(mainHtml.includes('臺中榮總必考（11 組）'), 'filter bar contains 臺中榮總必考（11 組） button');
    assert(mainHtml.includes('class="card card-pad written-tcvgh-banner"'), 'renders TCVGH guidance banner in past scope');
    assert.equal(countCards(mainHtml), 16, 'past scope shows all 16 items');

    // Verify TCVGH badges: exactly 11 cards have <span class="tag written-badge-tcvgh">中榮必考</span>
    const tcvghBadgeMatches = (mainHtml.match(/<span class="tag written-badge-tcvgh">中榮必考<\/span>/g) || []).length;
    assert.equal(tcvghBadgeMatches, 11, 'exactly 11 cards render the 中榮必考 badge');

    // 3. Switch to TCVGH filter via filter bar button
    appEnt.fireClick('written-past-filter', 'tcvgh');
    assert.equal(appEnt.written.getQuizScope(), 'past-tcvgh');
    assert.equal(appEnt.location.hash, '#written-past-tcvgh');
    const tcvghHtml = appEnt.main();
    assert.equal(countCards(tcvghHtml), 11, 'past-tcvgh filters to exactly 11 TCVGH core items');
    assert.equal(firstCardId(tcvghHtml), 'ent-wq-past-03', 'first TCVGH card is ent-wq-past-03');
    assert(tcvghHtml.includes('【中榮 112/113 必考】'), 'card titles show required TCVGH exam format');
    assert(tcvghHtml.includes('【中榮 110–113 連續命題】'), 'LEMG card title shows required format');

    // 4. Switch back to all past exams via filter bar button
    appEnt.fireClick('written-past-filter', 'all');
    assert.equal(appEnt.written.getQuizScope(), 'past');
    assert.equal(appEnt.location.hash, '#written-past');
    assert.equal(countCards(appEnt.main()), 16, 'switches back to all 16 past exam items');
    assert.equal(firstCardId(appEnt.main()), 'ent-wq-past-01');

    // 5. Deep link directly to #written-past-tcvgh
    const appTcvghDeep = bootApp({ spec: 'ent', hash: '#written-past-tcvgh' });
    assert.equal(appTcvghDeep.written.getQuizScope(), 'past-tcvgh');
    assert.equal(countCards(appTcvghDeep.main()), 11, 'direct deep link #written-past-tcvgh renders 11 items');
    assert.equal(appTcvghDeep.qa.routeMatchesView(appTcvghDeep.qa.parseRoute('#written-past-tcvgh')), true);
    assert.equal(appTcvghDeep.qa.routeMatchesView(appTcvghDeep.qa.parseRoute('#written-past')), false);

    // 6. Cross-specialty isolation: OPH and RAD never show TCVGH banner or filter bar
    const appOph = bootApp({ spec: 'oph', hash: '#written' });
    assert(!appOph.main().includes('written-tcvgh-banner'), 'OPH main never renders TCVGH banner');
    assert(!appOph.main().includes('written-past-filter-bar'), 'OPH main never renders past filter bar');
    assert(!appOph.main().includes('written-badge-tcvgh'), 'OPH main never renders TCVGH badge');

    const appRad = bootApp({ spec: 'rad', hash: '#written' });
    assert(!appRad.main().includes('written-tcvgh-banner'), 'RAD main never renders TCVGH banner');
    assert(!appRad.main().includes('written-past-filter-bar'), 'RAD main never renders past filter bar');
  });

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
