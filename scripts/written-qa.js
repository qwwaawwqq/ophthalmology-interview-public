(function (g) {
  'use strict';
  if (g.OphWritten) return;

  const PEN_COLORS = {
    navy: { hex: '#133b70', label: '深藍', width: 2.4 },
    black: { hex: '#1d2430', label: '黑', width: 2.4 },
    red: { hex: '#b82e2e', label: '紅標記', width: 2.6 },
    eraser: { hex: '#fcfbf7', label: '橡皮擦', width: 18 }
  };
  const DEFAULT_HEIGHT = 260;
  const GROW_STEP = 160;
  const MAX_HEIGHT = 1540;

  const scriptSrc = typeof document !== 'undefined' ? (document.currentScript?.src || '') : '';
  const baseUrl = scriptSrc ? (() => { try { return new URL('../', scriptSrc); } catch (_) { return null; } })() : null;

  const packs = Object.create(null);
  const cardModes = Object.create(null);
  const cardTools = Object.create(null);
  const sessionRevealed = new Set();
  const sessionHidden = new Set();
  const state = { chapterCollapsed: Object.create(null) };
  const internalEntries = Object.create(null);
  const internalMeta = Object.create(null);

  let defaultMode = 'both';
  let quizScope = 'all';
  let quizStatus = 'all';
  let quizSearch = '';
  let quizView = 'list';
  let quizFocusIdx = 0;
  let bcscScopeChapter = 'all';
  let cramScope = 'hy';
  let focusedId = null;
  let pendingFocusScroll = false;
  let searchComposing = false;

  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round1 = n => Math.round(Number(n || 0) * 10) / 10;
  const bridge = () => g.OphWrittenBridge || null;
  const specId = () => (g.OphSpecialty && g.OphSpecialty.id) || bridge()?.SPEC?.id || 'oph';
  const storePrefix = () => (g.OphSpecialty && g.OphSpecialty.storePrefix) || bridge()?.SPEC?.storePrefix || (specId() === 'oph' ? 'oph-prep:' : specId() + '-prep:');
  const inkKey = (sid) => {
    if (sid && sid !== specId()) return (sid === 'oph' ? 'oph-prep:' : sid + '-prep:') + 'written-ink-v1';
    return storePrefix() + 'written-ink-v1';
  };
  const clockNow = () => (typeof g.OphStudy?.now === 'function' ? g.OphStudy.now() : Date.now());
  const isoNow = () => new Date(clockNow()).toISOString();

  function contentUrl(sid) {
    const rel = 'content/written-qa/' + encodeURIComponent(sid) + '.json';
    if (!baseUrl) return rel;
    try { return new URL(rel, baseUrl).href; } catch (_) { return rel; }
  }

  function localStore() {
    try { return g.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null); } catch (_) { return null; }
  }

  function readInkAll(sid) {
    const ls = localStore();
    if (!ls) return Object.create(null);
    try {
      const raw = ls.getItem(inkKey(sid));
      if (!raw) return Object.create(null);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.items && typeof parsed.items === 'object') return parsed.items;
      return Object.create(null);
    } catch (_) {
      return Object.create(null);
    }
  }

  function sanitizeStroke(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.pts) || s.pts.length < 2) return null;
    const t = PEN_COLORS[s.t] ? s.t : 'navy';
    const w = Number(s.w) || PEN_COLORS[t].width;
    const pts = s.pts.slice(0, 4000).map(round1);
    const cwNum = Number(s.cw);
    if (Number.isFinite(cwNum) && cwNum > 0) {
      return { t, w, cw: Math.round(cwNum), pts };
    }
    return { t, w, pts };
  }

  function writeInkAll(itemsMap, sid) {
    const ls = localStore();
    if (!ls) return false;
    try {
      const clean = Object.create(null);
      for (const [k, v] of Object.entries(itemsMap || {})) {
        if (!v || typeof v !== 'object') continue;
        const strokes = Array.isArray(v.strokes) ? v.strokes.map(sanitizeStroke).filter(Boolean) : [];
        const h = Number.isFinite(v.h) && v.h >= DEFAULT_HEIGHT ? Math.min(MAX_HEIGHT, Math.round(v.h)) : DEFAULT_HEIGHT;
        if (strokes.length || h > DEFAULT_HEIGHT) clean[k] = { h, strokes };
      }
      if (!Object.keys(clean).length) ls.removeItem(inkKey(sid));
      else ls.setItem(inkKey(sid), JSON.stringify({ v: 1, updatedAt: isoNow(), items: clean }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getInk(id, sid) {
    const all = readInkAll(sid);
    const rec = all[id];
    const h = Number.isFinite(rec?.h) && rec.h >= DEFAULT_HEIGHT ? Math.min(MAX_HEIGHT, Math.round(rec.h)) : DEFAULT_HEIGHT;
    const strokes = Array.isArray(rec?.strokes) ? rec.strokes.map(sanitizeStroke).filter(Boolean) : [];
    return { h, strokes };
  }

  function hasLocalInk(id, sid) {
    return getInk(id, sid).strokes.length > 0;
  }

  function entryOf(id) {
    const b = bridge();
    if (b?.entries && Object.prototype.hasOwnProperty.call(b.entries, 'written:' + id)) return b.entries['written:' + id];
    return internalEntries['written:' + id] || null;
  }

  function metaOf(id) {
    const b = bridge();
    if (b?.meta && Object.prototype.hasOwnProperty.call(b.meta, 'written:' + id)) return b.meta['written:' + id];
    return internalMeta['written:' + id] || null;
  }

  function saveEntry(id, patch) {
    const prev = entryOf(id) || {};
    const item = findItem(id);
    const kpLen = Array.isArray(item?.keyPoints) ? item.keyPoints.length : 5;
    const rawChecks = Array.isArray(patch.checks) ? patch.checks : (Array.isArray(prev.checks) ? prev.checks : []);
    const checks = Array.from({ length: Math.min(10, Math.max(kpLen, rawChecks.length)) }, (_, i) => Boolean(rawChecks[i])).slice(0, kpLen || 10);
    const completed = typeof patch.completed === 'boolean' ? patch.completed : Boolean(prev.completed);
    const selfScore = Number.isInteger(patch.selfScore) && patch.selfScore >= 0 && patch.selfScore <= 5
      ? patch.selfScore
      : (Number.isInteger(prev.selfScore) ? prev.selfScore : 0);
    const revealed = typeof patch.revealed === 'boolean' ? patch.revealed : Boolean(prev.revealed);
    const value = { completed, selfScore, checks, revealed, at: isoNow() };
    const b = bridge();
    if (typeof b?.put === 'function') b.put('written:' + id, value);
    else if (b?.entries) { b.entries['written:' + id] = value; b.save?.(); }
    internalEntries['written:' + id] = value;
    return value;
  }

  function saveMeta(id, patch) {
    const prev = metaOf(id) || {};
    const text = typeof patch.text === 'string' ? patch.text.slice(0, 8000) : String(prev.text || '').slice(0, 8000);
    const note = typeof patch.note === 'string' ? patch.note.slice(0, 2000) : String(prev.note || '').slice(0, 2000);
    const hasInk = typeof patch.hasInk === 'boolean' ? patch.hasInk : (Boolean(prev.hasInk) || hasLocalInk(id));
    const value = { text, note, hasInk, at: isoNow() };
    const b = bridge();
    if (typeof b?.putMeta === 'function') b.putMeta('written:' + id, value);
    else if (b?.meta) { b.meta['written:' + id] = value; b.save?.(); }
    internalMeta['written:' + id] = value;
    return value;
  }

  function srsRecordOf(id) {
    const k = 'study:srs:written:' + id;
    if (g.OphStudyBridge?.read) return g.OphStudyBridge.read(k);
    const b = bridge();
    return b?.entries?.[k] || null;
  }

  function isSrsDue(id) {
    const rec = srsRecordOf(id);
    if (!rec?.plan?.dueAt) return false;
    if (g.OphStudyScheduler?.isDueNow) return g.OphStudyScheduler.isDueNow(rec.plan, clockNow());
    const t = Date.parse(rec.plan.dueAt);
    return Number.isFinite(t) && t <= clockNow();
  }

  function statusOf(item) {
    const id = typeof item === 'string' ? item : item.id;
    const e = entryOf(id);
    const m = metaOf(id);
    const srs = srsRecordOf(id);
    if (e?.completed === true || (Number.isInteger(e?.selfScore) && e.selfScore >= 2)) return 'mastered';
    if (e?.selfScore === 1 || srs?.plan?.rating === 'again' || srs?.attempt?.correct === false) return 'review';
    const hasText = Boolean(m?.text && String(m.text).trim().length > 0);
    const hasInk = Boolean(m?.hasInk) || hasLocalInk(id);
    const hasChecks = Array.isArray(e?.checks) && e.checks.some(Boolean);
    if (hasText || hasInk || hasChecks) return 'answered';
    return 'unanswered';
  }

  function statusLabel(st) {
    return st === 'mastered' ? '已掌握' : st === 'review' ? '需重練' : st === 'answered' ? '已作答' : '未作答';
  }

  function isAnswerRevealed(id) {
    if (sessionRevealed.has(id)) return true;
    if (sessionHidden.has(id)) return false;
    return Boolean(entryOf(id)?.revealed);
  }

  function currentAppState() {
    if (typeof S !== 'undefined' && S) return S;
    if (g.__qa && g.__qa.S) return g.__qa.S;
    return bridge()?.S || null;
  }

  function normalizePack(raw, fallbackSid) {
    const sid = (raw && typeof raw.specialty === 'string' && raw.specialty) || fallbackSid || specId();
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    const items = list.filter(x => x && typeof x.id === 'string' && typeof x.prompt === 'string' && typeof x.answer === 'string').map(x => ({
      id: x.id,
      specialty: x.specialty || sid,
      category: x.category || 'chapter',
      topicId: x.topicId || null,
      bookId: x.bookId || null,
      chapterId: x.chapterId || null,
      deepDiveId: x.deepDiveId || null,
      pblId: x.pblId || null,
      workflowId: x.workflowId || null,
      cramHighYield: Boolean(x.cramHighYield),
      format: x.format || '簡答與申論',
      title: x.title || x.id,
      prompt: x.prompt,
      answer: x.answer,
      keyPoints: Array.isArray(x.keyPoints) ? x.keyPoints.map(String) : [],
      pitfall: x.pitfall || '',
      sourceRef: x.sourceRef || ''
    }));
    const byId = new Map(items.map(it => [it.id, it]));
    return {
      schemaVersion: 1,
      specialty: sid,
      title: (raw && typeof raw.title === 'string' && raw.title) || '手寫問答與臨床申論題庫',
      updated: (raw && typeof raw.updated === 'string' && raw.updated) || '2026-11-07',
      disclaimer: (raw && typeof raw.disclaimer === 'string' && raw.disclaimer) || '本題庫為原創教學重述之筆試手寫簡答與臨床申論練習，附標準參考答案與得分要點；非官方歷屆原題逐字重製。',
      items,
      byId
    };
  }

  function packEntry(sid = specId()) {
    if (!packs[sid]) packs[sid] = { state: 'idle', data: null, items: [], byId: new Map(), promise: null };
    return packs[sid];
  }

  function getItems(sid = specId()) {
    return packEntry(sid).items;
  }

  function findItem(id, sid = specId()) {
    const cur = packEntry(sid).byId.get(id);
    if (cur) return cur;
    for (const p of Object.values(packs)) {
      if (p?.byId?.has(id)) return p.byId.get(id);
    }
    return null;
  }

  function onPackReady(sid) {
    try { g.OphStudy?.refreshCatalog?.(); } catch (_) {}
    if (sid === specId()) {
      hydrateSlots();
      const b = bridge();
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const typing = activeEl && /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName || '');
      if (!typing && b?.S) {
        const tab = b.S.tab;
        if (['today', 'learn', 'notebook', 'pbl', 'workflow', 'quiz', 'links'].includes(tab)) {
          try { b.render?.(); } catch (_) {}
        }
      }
      if (!typing) {
        try { g.OphCram?.refresh?.(); } catch (_) {}
        try { g.OphTextbook?.refresh?.(); } catch (_) {}
        try { g.OphAdvanced?.refresh?.(); } catch (_) {}
        if (typeof document !== 'undefined') {
          if (focusedId && pendingFocusScroll) {
            const focusEl = document.getElementById?.('written-' + focusedId);
            if (focusEl) {
              pendingFocusScroll = false;
              focusEl.scrollIntoView?.({ block: 'start' });
            }
          }
          const rawHash = String(g.location?.hash || '');
          if (rawHash.endsWith('-written') && rawHash !== '#textbook-written') {
            document.getElementById?.(rawHash.slice(1))?.scrollIntoView?.({ block: 'start' });
          }
        }
      }
    }
  }

  function prime(data, sidOverride) {
    const sid = sidOverride || (data && typeof data === 'object' && !Array.isArray(data) && data.specialty) || specId();
    if (data === null) {
      packs[sid] = { state: 'idle', data: null, items: [], byId: new Map(), promise: null };
      return null;
    }
    const norm = normalizePack(data, sid);
    packs[sid] = { state: 'ready', data: norm, items: norm.items, byId: norm.byId, promise: Promise.resolve(norm) };
    onPackReady(sid);
    return norm;
  }

  function ensureLoaded(sid = specId()) {
    const p = packEntry(sid);
    if (p.state === 'ready') return Promise.resolve(p.data);
    if (p.state === 'loading' && p.promise) return p.promise;
    if (typeof fetch !== 'function') return Promise.resolve(null);
    p.state = 'loading';
    p.promise = fetch(contentUrl(sid), { cache: 'no-cache' })
      .then(r => {
        if (!r || !r.ok) throw Error('written-qa load failed: ' + sid);
        return r.json();
      })
      .then(raw => {
        if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.items)) throw Error('written-qa schema mismatch');
        const norm = normalizePack(raw, sid);
        p.state = 'ready';
        p.data = norm;
        p.items = norm.items;
        p.byId = norm.byId;
        onPackReady(sid);
        return norm;
      })
      .catch(() => {
        p.state = 'error';
        p.promise = null;
        if (sid === specId()) hydrateSlots();
        return null;
      });
    return p.promise;
  }

  function topicShortLabel(topicId) {
    const topics = bridge()?.D?.topics || [];
    const t = topics.find(x => x.id === topicId);
    if (!t) return topicId || '';
    const prefix = t.chapter ? (specId() === 'oph' ? '共筆 ' + String(t.chapter).padStart(2, '0') : '第 ' + String(t.chapter).padStart(2, '0') + ' 章') + ' · ' : '';
    return prefix + String(t.title || '').split('：')[0];
  }

  function scopeBadgeText(item) {
    if (item.category === 'bcsc') {
      const sec = String(item.bookId || '').replace(/^bcsc-s/i, 'S');
      const ch = item.chapterId ? ' · ' + String(item.chapterId).replace(/^bcsc-s\d{2}-/i, '').toUpperCase() : '';
      return 'BCSC ' + sec + ch;
    }
    if (item.category === 'hard') {
      return 'Hard 臨床申論' + (item.topicId ? ' · ' + topicShortLabel(item.topicId) : '');
    }
    return item.topicId ? topicShortLabel(item.topicId) : '章節手寫題';
  }

  function formatMultiline(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const rawLines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const expanded = [];
    for (const line of rawLines) {
      const parts = line.split(/(?<=[。；！？])\s*(?=[（(][1-9][)）])/g).map(s => s.trim()).filter(Boolean);
      for (const part of parts) expanded.push(part);
    }
    return expanded.map(line => '<p>' + esc(line) + '</p>').join('');
  }

  function fmtDueShort(isoStr) {
    try {
      return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoStr));
    } catch (_) {
      return String(isoStr || '').slice(0, 10);
    }
  }

  function renderCard(item, optsOrIdx = {}, _total, maybeOpts) {
    if (!item) return '';
    const opts = (optsOrIdx && typeof optsOrIdx === 'object') ? optsOrIdx : (maybeOpts && typeof maybeOpts === 'object' ? maybeOpts : {});
    const id = item.id;
    const anchorId = (opts.idPrefix || 'written-') + id;
    const mode = cardModes[id] || defaultMode;
    const tool = cardTools[id] || 'navy';
    const st = statusOf(item);
    const due = isSrsDue(id);
    const e = entryOf(id);
    const m = metaOf(id);
    const ink = getInk(id, item.specialty);
    const S = currentAppState();
    var chapterAutoOpen = (opts && opts.context === 'chapter') && (typeof S === 'undefined' || !S || (S.learnExpandAll !== false && !S.recall));
    var revealed = isAnswerRevealed(id) || Boolean(chapterAutoOpen && !state.chapterCollapsed[id] && !sessionHidden.has(id));
    const srs = srsRecordOf(id);
    const kps = Array.isArray(item.keyPoints) ? item.keyPoints : [];
    const checks = Array.from({ length: kps.length }, (_, i) => Boolean(e?.checks?.[i]));
    const hitCount = checks.filter(Boolean).length;
    const deepHash = '#written-' + id;
    const highlightCls = focusedId === id ? ' is-highlighted' : '';

    const modeButtons = [
      ['text', '⌨ 文字作答'],
      ['ink', '✎ 手寫板（Apple Pencil／觸控／滑鼠）'],
      ['both', '⊞ 雙欄並排（手寫＋文字）']
    ].map(([mKey, label]) =>
      '<button type="button" class="btn small subtle written-mode-btn' + (mode === mKey ? ' is-active' : '') + '" data-action="written-mode" data-value="' + esc(id + '|' + mKey) + '" aria-pressed="' + (mode === mKey) + '">' + esc(label) + '</button>'
    ).join('');

    const penButtons = [
      ['navy', '深藍', 'is-navy'],
      ['black', '黑', 'is-black'],
      ['red', '紅標記', 'is-red']
    ].map(([tKey, label, sw]) =>
      '<button type="button" class="written-tool-btn' + (tool === tKey ? ' is-active' : '') + '" data-action="written-tool" data-value="' + esc(id + '|' + tKey) + '" aria-pressed="' + (tool === tKey) + '"><span class="written-swatch ' + sw + '" aria-hidden="true"></span><span>' + label + '</span></button>'
    ).join('');

    const eraserBtn = '<button type="button" class="written-tool-btn' + (tool === 'eraser' ? ' is-active' : '') + '" data-action="written-tool" data-value="' + esc(id + '|eraser') + '" aria-pressed="' + (tool === 'eraser') + '">橡皮擦</button>';
    const undoBtn = '<button type="button" class="written-tool-btn" data-action="written-undo" data-value="' + esc(id) + '">復原上一筆</button>';
    const clearBtn = '<button type="button" class="written-tool-btn" data-action="written-clear-ink" data-value="' + esc(id) + '">清除手寫</button>';
    const growBtn = '<button type="button" class="written-tool-btn" data-action="written-grow" data-value="' + esc(id) + '">加高作答紙（+160px）</button>';

    const srsStatusText = srs?.plan
      ? 'SRS 排程：下次 ' + esc(fmtDueShort(srs.plan.dueAt)) + (due ? '（現在到期）' : '') + ' · 累計複習 ' + srs.plan.reviewCount + ' 次'
      : '自評後自動排入「今日複習」SRS 間隔排程';

    const answerPanel = revealed
      ? '<section class="written-answer-panel" data-written-answer-panel="' + esc(id) + '" aria-label="標準參考答案與得分要點">' +
          '<div class="written-answer-block"><h4>標準參考答案</h4><div class="written-answer-body">' + formatMultiline(item.answer) + '</div></div>' +
          (kps.length
            ? '<div class="written-keypoints-block"><div class="written-keypoints-head"><h4>必寫得分要點 Checklist</h4><span class="written-score-pill" data-written-score="' + esc(id) + '">命中得分點 ' + hitCount + ' / ' + kps.length + '</span></div>' +
              '<ul class="written-checklist">' +
              kps.map((pt, idx) =>
                '<li><label><input type="checkbox" data-written-check="' + esc(id + '|' + idx) + '"' + (checks[idx] ? ' checked' : '') + '><span>' + esc(pt) + '</span></label></li>'
              ).join('') +
              '</ul></div>'
            : '') +
          (item.pitfall ? '<div class="written-pitfall"><strong>常見失分陷阱：</strong><span>' + esc(item.pitfall) + '</span></div>' : '') +
          '<p class="small written-source-line">來源核對：' + esc(item.sourceRef) + '</p>' +
          '<div class="written-srs-bar"><span class="small" data-written-srs-info="' + esc(id) + '">' + srsStatusText + '</span>' +
            '<div class="written-srs-actions">' +
              '<button type="button" class="btn small primary" data-action="written-rate" data-value="' + esc(id + '|good') + '" aria-pressed="' + (st === 'mastered') + '">✓ 已掌握（排入複習）</button>' +
              '<button type="button" class="btn small subtle" data-action="written-rate" data-value="' + esc(id + '|again') + '" aria-pressed="' + (st === 'review') + '">↻ 需重練（明日再複習）</button>' +
            '</div>' +
          '</div>' +
        '</section>'
      : '';

    return '<article class="card written-card' + highlightCls + '" id="' + esc(anchorId) + '" data-written-card="' + esc(id) + '" data-written-category="' + esc(item.category) + '">' +
      '<div class="written-card-top">' +
        '<div class="written-badges">' +
          '<span class="tag written-badge-format">' + esc(item.format) + '</span>' +
          '<span class="tag written-badge-scope">' + esc(scopeBadgeText(item)) + '</span>' +
          (item.cramHighYield ? '<span class="tag written-badge-hy">考前必寫</span>' : '') +
        '</div>' +
        '<div class="written-meta-right">' +
          '<span class="written-status is-' + st + '" data-written-status="' + esc(id) + '">' + statusLabel(st) + (due ? ' · 現在到期' : '') + '</span>' +
          '<a class="written-deeplink" href="' + esc(deepHash) + '" data-action="written-deeplink" data-value="' + esc(id) + '">' + esc(deepHash) + '</a>' +
          '<button type="button" class="link-save" data-action="link-save" data-value="' + esc(deepHash) + '">☆ 收藏</button>' +
        '</div>' +
      '</div>' +
      '<h3 class="written-card-title">' + esc(item.title) + '</h3>' +
      '<span class="written-source-badge">出處：' + esc(item.sourceRef) + '</span>' +
      '<div class="written-prompt">' + formatMultiline(item.prompt) + '</div>' +
      '<div class="written-mode-bar" role="group" aria-label="作答模式切換">' +
        '<div class="written-mode-group">' + modeButtons + '</div>' +
        '<span class="small">' + (ink.strokes.length ? '已留存手寫 ' + ink.strokes.length + ' 筆畫' : '支援觸控筆、手指與鍵盤作答') + '</span>' +
      '</div>' +
      '<div class="written-workspace' + (mode === 'both' ? ' is-both' : '') + '">' +
        '<div class="written-pane written-pane-ink"' + (mode === 'text' ? ' hidden' : '') + '>' +
          '<div class="written-pane-label"><span>手寫作答紙</span><span class="small">筆跡保存於本機裝置</span></div>' +
          '<div class="written-ink-toolbar" role="toolbar" aria-label="手寫板工具列">' + penButtons + eraserBtn + undoBtn + clearBtn + growBtn + '</div>' +
          '<div class="written-canvas-wrap"><canvas class="written-canvas" data-written-canvas="' + esc(id) + '" width="680" height="' + ink.h + '" style="height:' + ink.h + 'px;touch-action:none" aria-label="手寫作答板：' + esc(item.title) + '"></canvas></div>' +
        '</div>' +
        '<div class="written-pane written-pane-text"' + (mode === 'ink' ? ' hidden' : '') + '>' +
          '<div class="written-pane-label"><span>文字作答欄</span><span class="small">自動儲存並支援進度匯出／雲端同步</span></div>' +
          '<textarea class="written-textarea" data-written-text="' + esc(id) + '" maxlength="8000" aria-label="文字作答：' + esc(item.title) + '" placeholder="在此輸入簡答／申論重點（自動儲存，可與雲端進度同步）…">' + esc(m?.text || '') + '</textarea>' +
          '<input type="text" class="written-note-input" data-written-note="' + esc(id) + '" maxlength="2000" value="' + esc(m?.note || '') + '" aria-label="個人訂正筆記：' + esc(item.title) + '" placeholder="個人訂正備忘／考場口訣（選填，自動保存）…">' +
        '</div>' +
      '</div>' +
      '<div class="written-answer-bar">' +
        '<button type="button" class="btn small ' + (revealed ? 'subtle' : 'primary') + '" data-action="written-toggle-answer" data-value="' + esc(id) + '" aria-expanded="' + revealed + '">' + (revealed ? '收合標準答案' : '查看標準答案與得分要點') + '</button>' +
        '<span class="small">' + (chapterAutoOpen && revealed ? '章節全展開模式已自動顯示標準答案與必寫得分點；亦可收合自我默寫' : '先親自動筆或打字列點，再展開核對必寫得分點') + '</span>' +
      '</div>' +
      answerPanel +
    '</article>';
  }

  function revealToolbarButtons(scopeKey) {
    return '<button type="button" class="btn small subtle" data-action="written-reveal-all" data-value="' + esc(scopeKey + '|open') + '">一鍵展開全部標準答案</button>' +
           '<button type="button" class="btn small subtle" data-action="written-reveal-all" data-value="' + esc(scopeKey + '|close') + '">全部收合答案</button>';
  }

  function renderCardsUnique(list, opts = {}) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(renderCard(item, opts));
    }
    return out.join('');
  }

  function itemsForScope(scopeKey, sid = specId()) {
    const all = getItems(sid);
    if (!scopeKey || scopeKey === 'quiz') return filterQuizItems(sid);
    if (scopeKey.startsWith('chapter:')) {
      const tid = scopeKey.slice(8);
      return all.filter(x => x.topicId === tid);
    }
    if (scopeKey.startsWith('pbl:')) {
      const [pid, rawTopics = ''] = scopeKey.slice(4).split('::');
      const direct = all.filter(x => x.pblId === pid);
      if (direct.length) return direct;
      const tSet = new Set(rawTopics.split(',').filter(Boolean));
      return all.filter(x => x.category === 'chapter' && tSet.has(x.topicId)).slice(0, 2);
    }
    if (scopeKey.startsWith('workflow:')) {
      const [wid, rawTopics = ''] = scopeKey.slice(9).split('::');
      const direct = all.filter(x => x.workflowId === wid);
      if (direct.length) return direct;
      const tSet = new Set(rawTopics.split(',').filter(Boolean));
      return all.filter(x => x.category === 'chapter' && tSet.has(x.topicId)).slice(0, 2);
    }
    if (scopeKey === 'bcsc:all') return all.filter(x => x.category === 'bcsc' && (bcscScopeChapter === 'all' || x.chapterId === bcscScopeChapter));
    if (scopeKey.startsWith('bcsc-book:')) {
      const bid = scopeKey.slice(10);
      return all.filter(x => x.category === 'bcsc' && x.bookId === bid && (bcscScopeChapter === 'all' || x.chapterId === bcscScopeChapter));
    }
    if (scopeKey.startsWith('bcsc-ch:')) {
      const [bid, cid] = scopeKey.slice(8).split('/');
      return all.filter(x => x.category === 'bcsc' && x.bookId === bid && x.chapterId === cid);
    }
    if (scopeKey === 'cram') {
      return cramScope === 'all' ? all : all.filter(x => x.cramHighYield);
    }
    if (scopeKey === 'hard:all') return all.filter(x => x.category === 'hard');
    if (scopeKey.startsWith('deepdive:')) {
      const did = scopeKey.slice(9);
      return all.filter(x => x.category === 'hard' && x.deepDiveId === did);
    }
    return all;
  }

  function filterQuizItems(sid = specId()) {
    let list = getItems(sid);
    if (quizScope !== 'all') {
      if (quizScope.startsWith('cat:')) {
        const cat = quizScope.slice(4);
        list = list.filter(x => x.category === cat);
      } else if (quizScope.startsWith('topic:')) {
        const tid = quizScope.slice(6);
        list = list.filter(x => x.topicId === tid);
      } else if (quizScope.startsWith('book:')) {
        const bid = quizScope.slice(5);
        list = list.filter(x => x.bookId === bid);
      }
    }
    if (quizStatus !== 'all') {
      if (quizStatus === 'due') list = list.filter(x => isSrsDue(x.id));
      else list = list.filter(x => statusOf(x) === quizStatus);
    }
    const q = quizSearch.trim().toLocaleLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter(x => {
        const hay = [x.id, x.format, x.title, x.prompt, x.answer, ...(x.keyPoints || []), x.pitfall, x.sourceRef].join(' ').toLocaleLowerCase();
        return tokens.every(t => hay.includes(t));
      });
    }
    return list;
  }

  function statsSummary(list) {
    let mastered = 0, review = 0, answered = 0;
    for (const x of list) {
      const s = statusOf(x);
      if (s === 'mastered') { mastered++; answered++; }
      else if (s === 'review') { review++; answered++; }
      else if (s === 'answered') answered++;
    }
    return { total: list.length, mastered, review, answered };
  }

  function loadingCardMarkup(label = '正在載入手寫問答題庫…') {
    return '<div class="card card-pad written-loading"><p role="status">' + esc(label) + '</p></div>';
  }

  function errorCardMarkup(sid) {
    return '<div class="card card-pad written-error"><h3>手寫問答題庫暫時無法載入</h3><p class="small">請確認網路連線或題庫檔案（content/written-qa/' + esc(sid) + '.json）後重試。</p><button type="button" class="btn small primary" data-action="written-retry-load" data-value="' + esc(sid) + '">重試載入</button></div>';
  }

  function quizBankInnerHtml(sid = specId()) {
    const p = packEntry(sid);
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded(sid);
      return loadingCardMarkup('正在載入手寫問答與申論題庫…');
    }
    if (p.state === 'error') return errorCardMarkup(sid);
    const all = p.items;
    const st = statsSummary(all);
    const topics = (bridge()?.D?.topics || []).filter(t => t.chapter);
    const bcscVols = Array.from({ length: 13 }, (_, i) => 'bcsc-s' + String(i + 1).padStart(2, '0'));
    const scopeOptions = [
      ['all', '全部範圍（' + all.length + ' 題）'],
      ...(sid === 'oph'
        ? [
            ['cat:chapter', '共筆 14 章手寫題（' + all.filter(x => x.category === 'chapter').length + ' 題）'],
            ['cat:bcsc', 'BCSC 1–13 卷手寫題（' + all.filter(x => x.category === 'bcsc').length + ' 題）'],
            ['cat:hard', 'Hard 臨床決策申論（' + all.filter(x => x.category === 'hard').length + ' 題）'],
            ...bcscVols.map(bid => ['book:' + bid, 'BCSC ' + bid.slice(5).toUpperCase()])
          ]
        : []),
      ...topics.map(t => ['topic:' + t.id, topicShortLabel(t.id)])
    ];
    const statusOptions = [
      ['all', '全部狀態'],
      ['unanswered', '未作答'],
      ['review', '需重練'],
      ['mastered', '已掌握'],
      ['answered', '已作答'],
      ['due', '現在到期複習']
    ];
    const filtered = filterQuizItems(sid);
    if (focusedId) {
      const fIdx = filtered.findIndex(x => x.id === focusedId);
      if (fIdx >= 0) quizFocusIdx = fIdx;
    }
    if (quizFocusIdx >= filtered.length) quizFocusIdx = 0;
    if (quizFocusIdx < 0) quizFocusIdx = 0;

    const focusControls = quizView === 'focus' && filtered.length
      ? '<div class="written-focus-nav">' +
          '<button type="button" class="btn small subtle" data-action="written-nav" data-value="-1"' + (filtered.length <= 1 ? ' disabled' : '') + '>← 上一題</button>' +
          '<strong>第 ' + (quizFocusIdx + 1) + ' / ' + filtered.length + ' 題 · ' + esc(filtered[quizFocusIdx].title) + '</strong>' +
          '<button type="button" class="btn small subtle" data-action="written-nav" data-value="1"' + (filtered.length <= 1 ? ' disabled' : '') + '>下一題 →</button>' +
        '</div>'
      : '';

    const shown = quizView === 'focus' ? (filtered[quizFocusIdx] ? [filtered[quizFocusIdx]] : []) : filtered;

    return '<div class="card card-pad written-summary-card">' +
        '<div class="written-section-head">' +
          '<div><h2>' + esc(p.data?.title || '手寫問答與申論題庫') + '</h2><p class="written-section-sub">' + esc(p.data?.disclaimer || '') + '</p></div>' +
          '<div class="heading-stat"><strong>' + st.mastered + '<i> / ' + st.total + '</i></strong><span>題已掌握 · ' + st.review + ' 題需重練 · ' + st.answered + ' 題已作答</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="written-toolbar" data-written-toolbar="quiz">' +
        '<select class="select" data-written-filter="scope" aria-label="手寫題分類與章節篩選">' +
          scopeOptions.map(([v, label]) => '<option value="' + esc(v) + '"' + (quizScope === v ? ' selected' : '') + '>' + esc(label) + '</option>').join('') +
        '</select>' +
        '<select class="select" data-written-filter="status" aria-label="手寫題作答狀態篩選">' +
          statusOptions.map(([v, label]) => '<option value="' + esc(v) + '"' + (quizStatus === v ? ' selected' : '') + '>' + esc(label) + '</option>').join('') +
        '</select>' +
        '<input type="search" class="input written-search-input" data-written-search value="' + esc(quizSearch) + '" placeholder="搜尋題目、關鍵詞、得分點或頁碼…" aria-label="搜尋手寫問答題">' +
        '<button type="button" class="btn small ' + (quizView === 'focus' ? 'primary' : 'subtle') + '" data-action="written-view" data-value="focus" aria-pressed="' + (quizView === 'focus') + '">單題專注</button>' +
        '<button type="button" class="btn small ' + (quizView === 'list' ? 'primary' : 'subtle') + '" data-action="written-view" data-value="list" aria-pressed="' + (quizView === 'list') + '">整頁全覽</button>' +
        revealToolbarButtons('quiz') +
      '</div>' +
      focusControls +
      (shown.length
        ? '<div class="written-list">' + renderCardsUnique(shown) + '</div>'
        : '<div class="card empty"><h3>沒有符合篩選條件的手寫問答題</h3><p>請切換範圍、狀態或清除搜尋關鍵字。</p></div>');
  }

  function quizBankHtml(sid = specId()) {
    return '<section class="written-bank-root" data-written-slot="quiz" data-spec-id="' + esc(sid) + '">' + quizBankInnerHtml(sid) + '</section>';
  }

  function chapterInnerHtml(topicId, sid = specId()) {
    if (!topicId) return '';
    const p = packEntry(sid);
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded(sid);
      return loadingCardMarkup('正在載入本章手寫問答題…');
    }
    if (p.state === 'error') return errorCardMarkup(sid);
    const list = p.items.filter(x => x.topicId === topicId).sort((a, b) => (a.category !== 'chapter') - (b.category !== 'chapter'));
    if (!list.length) return '';
    return '<div class="written-section">' +
      '<div class="written-section-head">' +
        '<div><h3>本章手寫問答題（手寫板／打字作答＋標準答案）</h3><p class="written-section-sub">共 ' + list.length + ' 題 · 預設已展開參考解答與必寫得分點供順暢閱讀；亦可收合自我默寫，或用手寫板／鍵盤分點作答並排入間隔複習。</p></div>' +
        '<button type="button" class="btn small subtle" data-action="written-bank-topic" data-value="' + esc(topicId) + '">前往手寫題庫全覽</button>' +
      '</div>' +
      '<div class="written-toolbar">' + revealToolbarButtons('chapter:' + topicId) + '</div>' +
      '<div class="written-list">' + renderCardsUnique(list, { context: 'chapter' }) + '</div>' +
    '</div>';
  }

  function chapterHtml(topic) {
    if (!topic || !topic.chapter) return '';
    return chapterInnerHtml(topic.id, specId());
  }

  function contextInnerHtml(kind, contextId, topicIds, sid = specId()) {
    const p = packEntry(sid);
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded(sid);
      return loadingCardMarkup('正在載入延伸手寫問答題…');
    }
    if (p.state === 'error') return '';
    const direct = p.items.filter(x => (kind === 'pbl' ? x.pblId === contextId : x.workflowId === contextId));
    const tSet = new Set(Array.isArray(topicIds) ? topicIds : []);
    const list = direct.length ? direct : p.items.filter(x => x.category === 'chapter' && tSet.has(x.topicId)).slice(0, 2);
    if (!list.length) return '';
    const headingText = kind === 'pbl' ? '本情境延伸手寫問答（手寫板／打字作答＋標準答案）' : '本流程延伸手寫問答（手寫板／打字作答＋標準答案）';
    const scopeKey = kind + ':' + contextId + '::' + [...tSet].join(',');
    return '<section class="written-context-section" aria-label="' + esc(headingText) + '">' +
      '<div class="written-section-head"><div><h3>' + esc(headingText) + '</h3><p class="written-section-sub">將口頭討論轉為筆試條列簡答與急救處置步驟，核對必寫得分要點。</p></div></div>' +
      '<div class="written-toolbar">' + revealToolbarButtons(scopeKey) + '</div>' +
      '<div class="written-list">' + renderCardsUnique(list) + '</div>' +
    '</section>';
  }

  function contextHtml(kind, contextId, topicIds) {
    return contextInnerHtml(kind, contextId, topicIds, specId());
  }

  function bcscBookInnerHtml(bookId) {
    const p = packEntry('oph');
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded('oph');
      return loadingCardMarkup('正在載入 BCSC 手寫問答題…');
    }
    if (p.state === 'error') return errorCardMarkup('oph');
    const allBcsc = p.items.filter(x => x.category === 'bcsc' && (!bookId || x.bookId === bookId));
    const chapters = [...new Set(allBcsc.map(x => x.chapterId).filter(Boolean))];
    if (bcscScopeChapter !== 'all' && !chapters.includes(bcscScopeChapter)) bcscScopeChapter = 'all';
    const list = bcscScopeChapter === 'all' ? allBcsc : allBcsc.filter(x => x.chapterId === bcscScopeChapter);
    const scopeKey = bookId ? 'bcsc-book:' + bookId : 'bcsc:all';
    const title = bookId ? '本卷手寫問答與申論（' + bookId.toUpperCase() + ' · 共 ' + allBcsc.length + ' 題）' : 'BCSC 第 1–13 卷手寫問答全覽（共 ' + allBcsc.length + ' 題）';
    return '<section class="written-section" aria-label="BCSC 手寫問答">' +
      '<div class="written-section-head"><div><h2>' + esc(title) + '</h2><p class="written-section-sub">支援 Apple Pencil／觸控手寫板與文字作答，逐題核對 BCSC 必寫得分點與來源章節。</p></div></div>' +
      '<div class="written-toolbar">' +
        (chapters.length > 1
          ? '<select class="select" data-written-bcsc-ch aria-label="BCSC 章節篩選"><option value="all">全部章節（' + allBcsc.length + ' 題）</option>' +
            chapters.map(cid => '<option value="' + esc(cid) + '"' + (bcscScopeChapter === cid ? ' selected' : '') + '>' + esc(cid) + '</option>').join('') +
            '</select>'
          : '') +
        revealToolbarButtons(scopeKey) +
      '</div>' +
      (list.length
        ? '<div class="written-list">' + renderCardsUnique(list) + '</div>'
        : '<p class="small">本卷目前無符合篩選之手寫題。</p>') +
    '</section>';
  }

  function bcscBookHtml(bookId) {
    return '<div data-written-slot="bcsc-book" data-book-id="' + esc(bookId || 'all') + '">' + bcscBookInnerHtml(bookId || null) + '</div>';
  }

  function bcscChapterInnerHtml(bookId, chapterId) {
    const p = packEntry('oph');
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded('oph');
      return loadingCardMarkup('正在載入本章手寫問答題…');
    }
    if (p.state === 'error') return '';
    const list = p.items.filter(x => x.category === 'bcsc' && x.bookId === bookId && x.chapterId === chapterId);
    if (!list.length) {
      const bookCount = p.items.filter(x => x.category === 'bcsc' && x.bookId === bookId).length;
      if (!bookCount) return '';
      return '<section class="written-bcsc-chapter" aria-label="本卷手寫問答入口"><div class="written-toolbar"><span>本章重點已整合於本卷手寫問答題庫（共 ' + bookCount + ' 題）</span><button type="button" class="btn small primary" data-tb-action="mode" data-value="written">開啟本卷手寫問答</button></div></section>';
    }
    const scopeKey = 'bcsc-ch:' + bookId + '/' + chapterId;
    return '<section class="written-bcsc-chapter" aria-label="本章手寫問答題">' +
      '<div class="written-section-head"><div><h3>本章手寫問答題（手寫板／打字作答＋標準答案）</h3><p class="written-section-sub">讀完本章直接演練手寫簡答與機轉推導。</p></div></div>' +
      '<div class="written-toolbar">' + revealToolbarButtons(scopeKey) + '</div>' +
      '<div class="written-list">' + renderCardsUnique(list) + '</div>' +
    '</section>';
  }

  function bcscChapterHtml(bookId, chapterId) {
    if (!bookId || !chapterId) return '';
    return '<div data-written-slot="bcsc-chapter" data-book-id="' + esc(bookId) + '" data-chapter-id="' + esc(chapterId) + '">' + bcscChapterInnerHtml(bookId, chapterId) + '</div>';
  }

  function cramSectionInnerHtml(sid = specId()) {
    const p = packEntry(sid);
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded(sid);
      return '<h2>考前手寫問答衝刺</h2>' + loadingCardMarkup('正在載入考前手寫問答題…');
    }
    if (p.state === 'error') return '<h2>考前手寫問答衝刺</h2>' + errorCardMarkup(sid);
    const all = p.items;
    const hy = all.filter(x => x.cramHighYield);
    const list = cramScope === 'all' || !hy.length ? all : hy;
    return '<div class="written-section-head">' +
        '<div><h2>考前手寫問答衝刺（手寫板＋必寫得分點）</h2><p class="written-section-sub">考前快速默寫關鍵公式、分級、急救劑量與鑑別步驟，一鍵展開核對標準答案。</p></div>' +
      '</div>' +
      '<div class="written-toolbar">' +
        '<button type="button" class="btn small ' + (cramScope === 'hy' ? 'primary' : 'subtle') + '" data-action="written-cram-scope" data-value="hy" aria-pressed="' + (cramScope === 'hy') + '">考前必寫精選（' + (hy.length || all.length) + ' 題）</button>' +
        '<button type="button" class="btn small ' + (cramScope === 'all' ? 'primary' : 'subtle') + '" data-action="written-cram-scope" data-value="all" aria-pressed="' + (cramScope === 'all') + '">全部手寫題（' + all.length + ' 題）</button>' +
        revealToolbarButtons('cram') +
      '</div>' +
      '<div class="written-list">' + renderCardsUnique(list) + '</div>';
  }

  function cramSectionHtml(sid = specId()) {
    return cramSectionInnerHtml(sid);
  }

  function hardBankInnerHtml() {
    const p = packEntry('oph');
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded('oph');
      return loadingCardMarkup('正在載入 Hard 臨床決策手寫申論題…');
    }
    if (p.state === 'error') return errorCardMarkup('oph');
    const list = p.items.filter(x => x.category === 'hard');
    return '<div class="written-section">' +
      '<p class="written-section-sub">共 ' + list.length + ' 題跨領域多步臨床決策申論題 · 先以手寫板或文字分點擬答，再核對標準答案與得分點 Checklist。</p>' +
      '<div class="written-toolbar">' + revealToolbarButtons('hard:all') + '</div>' +
      '<div class="written-list">' + renderCardsUnique(list) + '</div>' +
    '</div>';
  }

  function hardBankHtml() {
    return '<div data-written-slot="hard">' + hardBankInnerHtml() + '</div>';
  }

  function deepDiveInnerHtml(deepDiveId) {
    const p = packEntry('oph');
    if (p.state === 'idle' || p.state === 'loading') {
      void ensureLoaded('oph');
      return loadingCardMarkup('正在載入本單元 Hard 手寫申論題…');
    }
    if (p.state === 'error') return '';
    const list = p.items.filter(x => x.category === 'hard' && x.deepDiveId === deepDiveId);
    if (!list.length) return '';
    return '<h3>Hard 手寫臨床申論實戰</h3>' +
      '<p class="small">用上方決策架構親手擬答本領域申論題，完成後展開核對必寫得分要點。</p>' +
      '<div class="written-toolbar">' + revealToolbarButtons('deepdive:' + deepDiveId) + '</div>' +
      '<div class="written-list">' + renderCardsUnique(list) + '</div>';
  }

  function deepDiveHtml(deepDiveId) {
    if (!deepDiveId) return '';
    return '<section class="advanced-deep-section written-deepdive-section" data-written-slot="deepdive" data-deepdive-id="' + esc(deepDiveId) + '">' + deepDiveInnerHtml(deepDiveId) + '</section>';
  }

  function countLabel() {
    const sid = specId();
    const p = packEntry(sid);
    if (p.state === 'idle') void ensureLoaded(sid);
    return p.items.length ? p.items.length + ' 題手寫與申論' : '手寫板＋文字作答';
  }

  function searchIndex() {
    const sid = specId();
    const p = packEntry(sid);
    if (p.state === 'idle') void ensureLoaded(sid);
    const topics = bridge()?.D?.topics || [];
    return p.items.map(x => {
      const t = topics.find(tp => tp.id === x.topicId);
      return {
        topicId: x.topicId || '',
        chapter: t?.chapter || 0,
        type: '手寫問答',
        title: x.title,
        body: [x.format, x.prompt, x.answer, ...(x.keyPoints || []), x.pitfall, x.sourceRef].join(' '),
        ref: x.sourceRef,
        action: 'written-open',
        target: x.id
      };
    });
  }

  /* Canvas Drawing & Pointer Events */
  function canvasCssWidth(canvas) {
    const rect = canvas?.getBoundingClientRect?.() || {};
    if (Number.isFinite(rect.width) && rect.width > 0) {
      const w = Math.max(120, Math.round(rect.width));
      canvas.__lastCssW = w;
      return w;
    }
    if (Number.isFinite(canvas?.__lastCssW) && canvas.__lastCssW > 0) return canvas.__lastCssW;
    if (!canvas.__baseAttrW) {
      canvas.__baseAttrW = Math.max(280, Math.round(Number(canvas?.getAttribute?.('width')) || canvas?.width || 680));
    }
    return canvas.__baseAttrW;
  }

  function drawStrokeOnCtx(ctx, stroke, cssW) {
    if (!ctx || !stroke || !Array.isArray(stroke.pts) || stroke.pts.length < 2) return;
    const isEraser = stroke.t === 'eraser';
    const pen = PEN_COLORS[stroke.t] || PEN_COLORS.navy;
    const sx = (Number.isFinite(stroke.cw) && stroke.cw > 0 && Number.isFinite(cssW) && cssW > 0)
      ? (cssW / stroke.cw)
      : 1;
    const baseW = Number(stroke.w) || pen.width;
    const scaledW = sx !== 1 ? Math.max(1.2, round1(baseW * Math.sqrt(sx))) : baseW;
    ctx.save?.();
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = pen.hex;
    ctx.fillStyle = pen.hex;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = scaledW;
    const pts = stroke.pts;
    if (pts.length === 2) {
      ctx.beginPath?.();
      ctx.arc?.(round1(pts[0] * sx), pts[1], (ctx.lineWidth || 2.4) / 2, 0, Math.PI * 2);
      ctx.fill?.();
    } else {
      ctx.beginPath?.();
      ctx.moveTo?.(round1(pts[0] * sx), pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo?.(round1(pts[i] * sx), pts[i + 1]);
      }
      ctx.stroke?.();
    }
    ctx.restore?.();
  }

  function redrawCanvas(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const id = canvas.dataset?.writtenCanvas || canvas.getAttribute?.('data-written-canvas');
    if (!id) return;
    const item = findItem(id);
    const ink = getInk(id, item?.specialty);
    const cssW = canvasCssWidth(canvas);
    const cssH = ink.h || DEFAULT_HEIGHT;
    const rawDpr = Math.min(Math.max(Number(g.devicePixelRatio) || 1, 1), 3);
    const maxScale = Math.min(4096 / cssW, 4096 / cssH, Math.sqrt(16000000 / (cssW * cssH)));
    const dpr = Math.max(0.5, Math.min(rawDpr, maxScale));
    if (canvas.style) canvas.style.height = cssH + 'px';
    try {
      const targetW = Math.max(1, Math.floor(cssW * dpr));
      const targetH = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect?.(0, 0, cssW, cssH);
      for (const stroke of ink.strokes) drawStrokeOnCtx(ctx, stroke, cssW);
    } catch (_) {}
  }

  function addStroke(id, stroke, sid) {
    if (!id || !stroke || !Array.isArray(stroke.pts) || stroke.pts.length < 2) return false;
    const item = findItem(id);
    const targetSid = sid || item?.specialty || specId();
    const all = readInkAll(targetSid);
    const prev = getInk(id, targetSid);
    const cleanStroke = sanitizeStroke(stroke);
    if (!cleanStroke) return false;
    const nextStrokes = [...prev.strokes, cleanStroke];
    all[id] = { h: prev.h, strokes: nextStrokes };
    const saved = writeInkAll(all, targetSid);
    if (!saved) {
      saveMeta(id, { hasInk: hasLocalInk(id, targetSid) });
      bridge()?.toast?.('本機儲存空間已滿，手寫筆跡無法保存；請改用文字作答或清理瀏覽器空間。');
      return false;
    }
    saveMeta(id, { hasInk: nextStrokes.length > 0 });
    return true;
  }

  function undoStroke(id, sid) {
    const item = findItem(id);
    const targetSid = sid || item?.specialty || specId();
    const all = readInkAll(targetSid);
    const prev = getInk(id, targetSid);
    if (!prev.strokes.length) return false;
    const nextStrokes = prev.strokes.slice(0, -1);
    all[id] = { h: prev.h, strokes: nextStrokes };
    writeInkAll(all, targetSid);
    saveMeta(id, { hasInk: nextStrokes.length > 0 });
    return true;
  }

  function clearInk(id, sid) {
    const item = findItem(id);
    const targetSid = sid || item?.specialty || specId();
    const all = readInkAll(targetSid);
    const prev = getInk(id, targetSid);
    all[id] = { h: prev.h, strokes: [] };
    writeInkAll(all, targetSid);
    saveMeta(id, { hasInk: false });
    return true;
  }

  function growCanvas(id, delta = GROW_STEP, sid) {
    const item = findItem(id);
    const targetSid = sid || item?.specialty || specId();
    const all = readInkAll(targetSid);
    const prev = getInk(id, targetSid);
    const nextH = Math.min(MAX_HEIGHT, prev.h + (Number(delta) || GROW_STEP));
    all[id] = { h: nextH, strokes: prev.strokes };
    writeInkAll(all, targetSid);
    return nextH;
  }

  function pointerCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
    const x = (typeof e.clientX === 'number' ? e.clientX - (rect.left || 0) : Number(e.offsetX || 0));
    const y = (typeof e.clientY === 'number' ? e.clientY - (rect.top || 0) : Number(e.offsetY || 0));
    return [round1(x), round1(y)];
  }

  function bindCanvas(canvas) {
    if (!canvas) return;
    redrawCanvas(canvas);
    if (canvas.__writtenBound) return;
    canvas.__writtenBound = true;
    let active = null;
    const id = () => canvas.dataset?.writtenCanvas || canvas.getAttribute?.('data-written-canvas');

    const beginDraw = (e, src, ptrId, isPen, rawPressure) => {
      const itemId = id();
      if (!itemId) return;
      e?.preventDefault?.();
      if (ptrId !== undefined) {
        try { canvas.setPointerCapture?.(ptrId); } catch (_) {}
      }
      const tool = cardTools[itemId] || 'navy';
      const pen = PEN_COLORS[tool] || PEN_COLORS.navy;
      const pressure = isPen && typeof rawPressure === 'number' && rawPressure > 0 ? (0.7 + 0.6 * rawPressure) : 1;
      const cssW = canvasCssWidth(canvas);
      const [x, y] = pointerCoords(canvas, src || {});
      active = { pointerId: ptrId, t: tool, w: round1(pen.width * pressure), cw: cssW, pts: [x, y] };
      const ctx = canvas.getContext?.('2d');
      if (ctx) drawStrokeOnCtx(ctx, active, cssW);
    };

    const moveDraw = (e, src, ptrId) => {
      if (!active || (ptrId !== undefined && active.pointerId !== undefined && ptrId !== active.pointerId)) return;
      e?.preventDefault?.();
      const [x, y] = pointerCoords(canvas, src || {});
      const lastX = active.pts[active.pts.length - 2];
      const lastY = active.pts[active.pts.length - 1];
      if (Math.hypot(x - lastX, y - lastY) < 0.4) return;
      active.pts.push(x, y);
      const ctx = canvas.getContext?.('2d');
      if (ctx) {
        drawStrokeOnCtx(ctx, { t: active.t, w: active.w, cw: active.cw, pts: [lastX, lastY, x, y] }, active.cw);
      }
    };

    const finishDraw = (e, ptrId) => {
      if (!active || (ptrId !== undefined && active.pointerId !== undefined && ptrId !== active.pointerId)) return;
      e?.preventDefault?.();
      const stroke = active;
      active = null;
      if (ptrId !== undefined) {
        try { canvas.releasePointerCapture?.(ptrId); } catch (_) {}
      }
      const itemId = id();
      if (!itemId) return;
      addStroke(itemId, stroke);
      redrawCanvas(canvas);
      updateCardStatusDom(itemId);
    };

    canvas.addEventListener?.('pointerdown', e => {
      if (e?.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
      beginDraw(e, e, e?.pointerId, e?.pointerType === 'pen', e?.pressure);
    });
    canvas.addEventListener?.('pointermove', e => moveDraw(e, e, e?.pointerId));
    canvas.addEventListener?.('pointerup', e => finishDraw(e, e?.pointerId));
    canvas.addEventListener?.('pointercancel', e => finishDraw(e, e?.pointerId));

    if (typeof g.PointerEvent === 'undefined') {
      canvas.addEventListener?.('mousedown', e => {
        if (typeof e?.button === 'number' && e.button !== 0) return;
        beginDraw(e, e, 'mouse', false, 0.5);
      });
      canvas.addEventListener?.('mousemove', e => moveDraw(e, e, 'mouse'));
      canvas.addEventListener?.('mouseup', e => finishDraw(e, 'mouse'));
      canvas.addEventListener?.('mouseleave', e => finishDraw(e, 'mouse'));
      canvas.addEventListener?.('touchstart', e => {
        const t = e?.changedTouches?.[0] || e?.touches?.[0];
        if (!t) return;
        beginDraw(e, t, t.identifier ?? 'touch', false, t.force);
      }, { passive: false });
      canvas.addEventListener?.('touchmove', e => {
        const t = e?.changedTouches?.[0] || e?.touches?.[0];
        if (!t) return;
        moveDraw(e, t, t.identifier ?? 'touch');
      }, { passive: false });
      canvas.addEventListener?.('touchend', e => {
        const t = e?.changedTouches?.[0];
        finishDraw(e, t ? (t.identifier ?? 'touch') : undefined);
      });
      canvas.addEventListener?.('touchcancel', e => {
        const t = e?.changedTouches?.[0];
        finishDraw(e, t ? (t.identifier ?? 'touch') : undefined);
      });
    }
  }

  function updateCardStatusDom(id) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const item = findItem(id);
    if (!item) return;
    const st = statusOf(item);
    const due = isSrsDue(id);
    const safeId = String(id).replace(/["\\\r\n\f]/g, '\\$&');
    try {
      for (const pill of document.querySelectorAll('[data-written-status="' + safeId + '"]') || []) {
        pill.className = 'written-status is-' + st;
        pill.textContent = statusLabel(st) + (due ? ' · 現在到期' : '');
      }
    } catch (_) {}
  }

  function bindContainer(root) {
    if (!root || typeof root.innerHTML !== 'string' || !root.innerHTML.includes('data-written-')) return;
    if (typeof root.querySelectorAll === 'function') {
      for (const c of root.querySelectorAll('canvas[data-written-canvas]') || []) bindCanvas(c);
    }
    if (!root.__writtenDelegated && typeof root.addEventListener === 'function') {
      root.__writtenDelegated = true;
      root.addEventListener('click', e => {
        if (e.__writtenHandled) {
          e.stopPropagation?.();
          return;
        }
        const b = e.target?.closest?.('[data-action]');
        if (!b || b.disabled) return;
        const act = b.dataset?.action;
        if (act && act.startsWith('written-')) {
          if (action(act, b.dataset.value || '', b, e)) {
            if (b.tagName === 'A') e.preventDefault?.();
            e.__writtenHandled = true;
            e.stopPropagation?.();
          }
        }
      });
      root.addEventListener('input', e => {
        if (e.__writtenHandled) {
          e.stopPropagation?.();
          return;
        }
        if (input(e.target, e)) {
          e.__writtenHandled = true;
          e.stopPropagation?.();
        }
      });
      root.addEventListener('change', e => {
        if (e.__writtenHandled) {
          e.stopPropagation?.();
          return;
        }
        if (change(e.target, e)) {
          e.__writtenHandled = true;
          e.stopPropagation?.();
        }
      });
    }
  }

  function hydrateSlotElement(slot) {
    if (!slot) return;
    const kind = slot.dataset?.writtenSlot || slot.getAttribute?.('data-written-slot');
    if (!kind) return;
    const sid = slot.dataset?.specId || slot.getAttribute?.('data-spec-id') || specId();
    if (kind === 'quiz') {
      slot.innerHTML = quizBankInnerHtml(sid);
    } else if (kind === 'chapter') {
      const tid = slot.dataset?.topicId || slot.getAttribute?.('data-topic-id');
      slot.innerHTML = chapterInnerHtml(tid, sid);
    } else if (kind === 'pbl' || kind === 'workflow') {
      const cid = slot.dataset?.contextId || slot.getAttribute?.('data-context-id');
      const topicsStr = slot.dataset?.topicIds || slot.getAttribute?.('data-topic-ids') || '';
      slot.innerHTML = contextInnerHtml(kind, cid, topicsStr ? topicsStr.split(',').filter(Boolean) : [], sid);
    } else if (kind === 'bcsc-book') {
      const bid = slot.dataset?.bookId || slot.getAttribute?.('data-book-id');
      slot.innerHTML = bcscBookInnerHtml(bid === 'all' ? null : bid);
    } else if (kind === 'bcsc-chapter') {
      const bid = slot.dataset?.bookId || slot.getAttribute?.('data-book-id');
      const cid = slot.dataset?.chapterId || slot.getAttribute?.('data-chapter-id');
      slot.innerHTML = bcscChapterInnerHtml(bid, cid);
    } else if (kind === 'cram') {
      slot.innerHTML = cramSectionInnerHtml(sid);
    } else if (kind === 'hard') {
      slot.innerHTML = hardBankInnerHtml();
    } else if (kind === 'deepdive') {
      const did = slot.dataset?.deepdiveId || slot.getAttribute?.('data-deepdive-id');
      slot.innerHTML = deepDiveInnerHtml(did);
    } else if (kind === 'overview') {
      const cnt = slot.querySelector?.('.practice-count');
      if (cnt) cnt.textContent = countLabel();
    }
    bindContainer(slot);
  }

  function hydrateSlots() {
    if (typeof document === 'undefined') return;
    if (typeof document.querySelectorAll === 'function') {
      const slots = document.querySelectorAll('[data-written-slot]') || [];
      if (slots.length) {
        for (const s of slots) hydrateSlotElement(s);
        return;
      }
    }
  }

  function refreshActiveSurfaces() {
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const slots = document.querySelectorAll('[data-written-slot]') || [];
      if (slots.length) {
        for (const s of slots) hydrateSlotElement(s);
        return;
      }
    }
    const b = bridge();
    if (b?.render && ['quiz', 'learn', 'pbl', 'workflow', 'notebook'].includes(b.S?.tab)) {
      b.render();
      return;
    }
    g.OphCram?.refresh?.();
    g.OphTextbook?.refresh?.();
    g.OphAdvanced?.refresh?.();
  }

  function recordSrs(id, rating) {
    if (g.OphStudy?.record) {
      const ok = g.OphStudy.record('written', id, rating);
      if (ok) return true;
    }
    if (g.OphStudyScheduler?.schedule && g.OphStudyBridge?.save) {
      const k = 'study:srs:written:' + id;
      const old = g.OphStudyBridge.read(k);
      const now = clockNow();
      const at = new Date(now).toISOString();
      const correct = rating !== 'again';
      const plan = g.OphStudyScheduler.schedule(old?.plan || null, correct, rating, now);
      const count = Math.max((old?.answerCount || 0) + 1, plan.reviewCount);
      g.OphStudyBridge.save(k, {
        version: 1,
        at,
        answerCount: count,
        attempt: { id: 'written-' + at + '-' + count, at, correct, rated: true },
        plan
      });
      return true;
    }
    return false;
  }

  function focusQuestion(id) {
    focusedId = id || null;
    pendingFocusScroll = Boolean(id);
    if (id) {
      quizScope = 'all';
      quizStatus = 'all';
      quizSearch = '';
      const list = filterQuizItems(specId());
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) quizFocusIdx = idx;
    }
  }

  function openQuestion(id) {
    focusQuestion(id);
    const b = bridge();
    if (b?.setQuizWritten) b.setQuizWritten();
    else if (b?.openRoute) b.openRoute(id ? '#written-' + id : '#written');
    if (id && typeof document !== 'undefined') {
      const el = document.getElementById?.('written-' + id);
      if (el) {
        if (packEntry(specId()).state === 'ready') pendingFocusScroll = false;
        el.scrollIntoView?.({ block: 'start' });
      }
    }
  }

  function action(a, v, _b, ev) {
    if (!a || !String(a).startsWith('written-')) return false;
    const curEv = ev || (typeof g.event === 'object' ? g.event : null);
    if (curEv?.__writtenHandled) return true;
    if (a === 'written-bank-open') {
      if (bridge()?.openRoute) bridge().openRoute('#written');
      else openQuestion(null);
      return true;
    }
    if (a === 'written-open') {
      const targetHash = v ? '#written-' + v : '#written';
      if (bridge()?.openRoute) bridge().openRoute(targetHash);
      else openQuestion(v);
      return true;
    }
    if (a === 'written-deeplink') {
      focusedId = v || null;
      const h = v ? '#written-' + v : '#written';
      if (g.history?.replaceState) g.history.replaceState(null, '', h);
      return true;
    }
    if (a === 'written-bank-topic') {
      quizScope = v ? 'topic:' + v : 'all';
      quizStatus = 'all';
      quizSearch = '';
      focusedId = null;
      pendingFocusScroll = false;
      if (bridge()?.setQuizWritten) bridge().setQuizWritten();
      return true;
    }
    if (a === 'written-retry-load') {
      const sid = v || specId();
      const p = packEntry(sid);
      p.state = 'idle';
      p.promise = null;
      void ensureLoaded(sid);
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-mode') {
      const [id, mode] = String(v || '').split('|');
      if (!id || !['text', 'ink', 'both'].includes(mode)) return true;
      cardModes[id] = mode;
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-tool') {
      const [id, tool] = String(v || '').split('|');
      if (!id || !PEN_COLORS[tool]) return true;
      cardTools[id] = tool;
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-undo') {
      if (v) { undoStroke(v); refreshActiveSurfaces(); }
      return true;
    }
    if (a === 'written-clear-ink') {
      if (v) { clearInk(v); refreshActiveSurfaces(); }
      return true;
    }
    if (a === 'written-grow') {
      if (v) { growCanvas(v, GROW_STEP); refreshActiveSurfaces(); }
      return true;
    }
    if (a === 'written-toggle-answer') {
      if (!v) return true;
      const S = currentAppState();
      const inChapterAuto = Boolean(S && S.tab === 'learn' && S.learnExpandAll !== false && !S.recall);
      const currentlyShownInChapter = isAnswerRevealed(v) || (inChapterAuto && !state.chapterCollapsed[v] && !sessionHidden.has(v));
      const next = inChapterAuto ? !currentlyShownInChapter : !isAnswerRevealed(v);
      if (next) {
        delete state.chapterCollapsed[v];
        sessionRevealed.add(v);
        sessionHidden.delete(v);
      } else {
        state.chapterCollapsed[v] = true;
        sessionRevealed.delete(v);
        sessionHidden.add(v);
      }
      saveEntry(v, { revealed: next });
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-reveal-all') {
      const [scopeKey, dir] = String(v || '').split('|');
      const open = dir !== 'close';
      const list = itemsForScope(scopeKey);
      for (const item of list) {
        if (open) {
          delete state.chapterCollapsed[item.id];
          sessionRevealed.add(item.id);
          sessionHidden.delete(item.id);
        } else {
          state.chapterCollapsed[item.id] = true;
          sessionRevealed.delete(item.id);
          sessionHidden.add(item.id);
        }
        saveEntry(item.id, { revealed: open });
      }
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-rate') {
      const [id, rating] = String(v || '').split('|');
      if (!id || !['good', 'again'].includes(rating)) return true;
      sessionRevealed.add(id);
      sessionHidden.delete(id);
      if (rating === 'good') {
        saveEntry(id, { completed: true, selfScore: 2, revealed: true });
      } else {
        saveEntry(id, { completed: false, selfScore: 1, revealed: true });
      }
      recordSrs(id, rating);
      bridge()?.toast?.(rating === 'good' ? '已標記掌握並排入間隔複習。' : '已標記需重練，將提早安排再次複習。');
      refreshActiveSurfaces();
      return true;
    }
    if (a === 'written-view') {
      if (v === 'focus' || v === 'list') {
        quizView = v;
        if (!focusedId) quizFocusIdx = 0;
        refreshActiveSurfaces();
      }
      return true;
    }
    if (a === 'written-nav') {
      const list = filterQuizItems(specId());
      if (list.length) {
        quizFocusIdx = (quizFocusIdx + Number(v || 0) + list.length) % list.length;
        focusedId = list[quizFocusIdx]?.id || null;
        if (g.history?.replaceState && String(g.location?.hash || '').startsWith('#written')) {
          g.history.replaceState(null, '', currentHash());
        }
        refreshActiveSurfaces();
      }
      return true;
    }
    if (a === 'written-cram-scope') {
      if (v === 'hy' || v === 'all') {
        cramScope = v;
        refreshActiveSurfaces();
      }
      return true;
    }
    return false;
  }

  function input(el, e) {
    if (!el) return false;
    const curEv = e || (typeof g.event === 'object' ? g.event : null);
    const textId = el.dataset?.writtenText || el.getAttribute?.('data-written-text');
    if (textId) {
      if (curEv?.__writtenHandled) return true;
      saveMeta(textId, { text: String(el.value || '') });
      updateCardStatusDom(textId);
      return true;
    }
    const noteId = el.dataset?.writtenNote || el.getAttribute?.('data-written-note');
    if (noteId) {
      if (curEv?.__writtenHandled) return true;
      saveMeta(noteId, { note: String(el.value || '') });
      return true;
    }
    if (el.matches?.('[data-written-search]') || el.dataset?.writtenSearch !== undefined || el.getAttribute?.('data-written-search') !== null) {
      if (curEv?.__writtenHandled) return true;
      quizSearch = String(el.value || '');
      focusedId = null;
      pendingFocusScroll = false;
      quizFocusIdx = 0;
      if (e?.isComposing || searchComposing) return true;
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : quizSearch.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      refreshActiveSurfaces();
      if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
        const next = document.querySelector('[data-written-search]');
        if (next) {
          next.focus?.({ preventScroll: true });
          try { next.setSelectionRange?.(start, end); } catch (_) {}
        }
      }
      return true;
    }
    return false;
  }

  function change(el, e) {
    if (!el) return false;
    const curEv = e || (typeof g.event === 'object' ? g.event : null);
    const checkSpec = el.dataset?.writtenCheck || el.getAttribute?.('data-written-check');
    if (checkSpec) {
      if (curEv?.__writtenHandled) return true;
      const [id, rawIdx] = String(checkSpec).split('|');
      const idx = Number(rawIdx);
      const item = findItem(id);
      const kpLen = Array.isArray(item?.keyPoints) ? item.keyPoints.length : Math.max(idx + 1, 3);
      const prev = entryOf(id);
      const checks = Array.from({ length: kpLen }, (_, i) => Boolean(prev?.checks?.[i]));
      if (Number.isInteger(idx) && idx >= 0 && idx < checks.length) {
        checks[idx] = Boolean(el.checked);
      }
      sessionRevealed.add(id);
      sessionHidden.delete(id);
      saveEntry(id, { checks, revealed: true });
      refreshActiveSurfaces();
      return true;
    }
    const filterKind = el.dataset?.writtenFilter || el.getAttribute?.('data-written-filter');
    if (filterKind === 'scope') {
      if (curEv?.__writtenHandled) return true;
      quizScope = String(el.value || 'all');
      focusedId = null;
      pendingFocusScroll = false;
      quizFocusIdx = 0;
      refreshActiveSurfaces();
      return true;
    }
    if (filterKind === 'status') {
      if (curEv?.__writtenHandled) return true;
      quizStatus = String(el.value || 'all');
      focusedId = null;
      pendingFocusScroll = false;
      quizFocusIdx = 0;
      refreshActiveSurfaces();
      return true;
    }
    if (el.dataset?.writtenBcscCh !== undefined || el.getAttribute?.('data-written-bcsc-ch') !== null) {
      if (curEv?.__writtenHandled) return true;
      bcscScopeChapter = String(el.value || 'all');
      refreshActiveSurfaces();
      return true;
    }
    return false;
  }

  function routeLabel(id) {
    if (!id) return '手寫問答題庫';
    const item = findItem(id);
    return '手寫問答 · ' + (item ? item.title : id);
  }

  function isQuizWrittenActive() {
    if (typeof g.OphQuizBank?.getMode === 'function') {
      return g.OphQuizBank.getMode() === 'written';
    }
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      return Boolean(document.querySelector('[data-written-slot="quiz"]'));
    }
    return false;
  }

  function matchesRoute(routeOrId) {
    if (routeOrId && typeof routeOrId === 'object') {
      if (routeOrId.kind && routeOrId.kind !== 'written') return false;
    } else if (routeOrId !== null && routeOrId !== undefined && typeof routeOrId !== 'string') {
      return false;
    }
    const b = bridge();
    if (b?.S?.tab !== 'quiz' || !isQuizWrittenActive()) return false;
    const targetId = (routeOrId && typeof routeOrId === 'object') ? (routeOrId.id || null) : (routeOrId || null);
    if (targetId) {
      if (focusedId !== targetId) return false;
      if (quizView === 'focus') {
        const list = filterQuizItems(specId());
        if (list.length) {
          const shown = list[Math.min(Math.max(0, quizFocusIdx), list.length - 1)];
          if (shown?.id !== targetId) return false;
        }
      }
      return true;
    }
    return !focusedId;
  }

  function currentHash() {
    return focusedId ? '#written-' + focusedId : '#written';
  }

  function clearLocalCache() {
    sessionRevealed.clear();
    sessionHidden.clear();
    for (const k of Object.keys(state.chapterCollapsed)) delete state.chapterCollapsed[k];
    for (const k of Object.keys(internalEntries)) delete internalEntries[k];
    for (const k of Object.keys(internalMeta)) delete internalMeta[k];
    const ls = localStore();
    try { ls?.removeItem(inkKey()); } catch (_) {}
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('compositionstart', e => {
      if (e?.target?.dataset?.writtenSearch !== undefined) searchComposing = true;
    });
    document.addEventListener('compositionend', e => {
      if (e?.target?.dataset?.writtenSearch === undefined) return;
      searchComposing = false;
      input(e.target, e);
    });
  }
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('resize', () => {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      for (const c of document.querySelectorAll('canvas[data-written-canvas]') || []) redrawCanvas(c);
    });
  }

  g.OphWritten = {
    prime,
    ensureLoaded,
    getItems,
    findItem,
    isAnswerRevealed,
    renderCard,
    quizBankHtml,
    chapterHtml,
    contextHtml,
    bcscBookHtml,
    bcscChapterHtml,
    cramSectionHtml,
    hardBankHtml,
    deepDiveHtml,
    countLabel,
    searchIndex,
    bindContainer,
    hydrateSlots,
    refresh: refreshActiveSurfaces,
    action,
    input,
    change,
    openQuestion,
    focusQuestion,
    routeLabel,
    matchesRoute,
    currentHash,
    getInk,
    addStroke,
    undoStroke,
    clearInk,
    growCanvas,
    clearLocalCache,
    setDefaultMode(m) { if (['text', 'ink', 'both'].includes(m)) defaultMode = m; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
