/* Chapter knowledge graph for the 知識地圖 page: a force-directed map of every chapter and key point,
   with a camera fly-through and layout morphing. No dependencies; draws on one canvas. */
(function (w) {
  'use strict';
  const COLORS = ['#60a5fa', '#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#22d3ee', '#818cf8', '#fb923c', '#4ade80', '#e879f9', '#38bdf8', '#facc15', '#f87171', '#2dd4bf'];
  const MODES = [['force', '力導向圖'], ['fly', '鏡頭巡航'], ['morph', '版面變形']];
  const LAYOUTS = [['force', '力導向'], ['radial', '同心環'], ['columns', '章節欄']];
  /* Which course chapters each BCSC section mainly supports (navigation only, not teaching content). */
  const BOOK_MAP = {1: ['notes-13', 'notes-14'], 2: ['notes-01', 'notes-13'], 3: ['notes-02'], 4: ['notes-10', 'notes-11'], 5: ['notes-03'], 6: ['notes-04'], 7: ['notes-08', 'notes-11'],
    8: ['notes-05', 'notes-12'], 9: ['notes-09'], 10: ['notes-07'], 11: ['notes-06'], 12: ['notes-10'], 13: ['notes-02', 'notes-05']};
  /* English chapter-title keywords that point a BCSC chapter at a course chapter (navigation only). */
  const TITLE_MAP = [[/glaucoma|intraocular pressure|aqueous/i, 'notes-07'], [/retina|macula|vitre|choroid/i, 'notes-10'], [/cornea|kerat/i, 'notes-05'], [/uveitis|uveal|scleritis|endophthalmitis/i, 'notes-09'],
    [/strabismus|amblyopia|esodeviation|exodeviation|binocular|extraocular/i, 'notes-04'], [/orbit|lacrimal/i, 'notes-08'], [/eyelid|ptosis/i, 'notes-11'], [/conjunctiv|dry eye|tear film|ocular surface/i, 'notes-12'],
    [/optic nerve|pupil|visual field|nystagmus|diplopia/i, 'notes-03'], [/\blens\b|cataract/i, 'notes-06'], [/optics|refract|spectacle|contact lens|low vision/i, 'notes-02'], [/pharmacol|drug|medication/i, 'notes-13'], [/examination|imaging|diagnostic/i, 'notes-01']];
  const GENERIC = new Set(['anterior', 'posterior', 'peripheral', 'central', 'disease', 'diseases', 'ocular', 'ophthalmic', 'surgery', 'surgical', 'syndrome', 'primary', 'secondary', 'chronic', 'testing', 'therapy', 'pattern', 'function', 'patient', 'bilateral', 'unilateral', 'superior', 'inferior', 'clinical', 'general', 'against', 'between', 'without', 'follow-up', 'resection']);
  /* Distinctive terms in a key point: acronyms such as RAPD or OCT, and long specific words such as topiramate. */
  function keyTerms(text) {
    const out = new Map();
    for (const word of String(text).match(/[A-Za-z][A-Za-z-]{2,}/g) || []) {
      const lower = word.toLowerCase();
      const acronym = /[A-Z].*[A-Z]/.test(word) && !/^[IVX]+$/.test(word);
      if ((acronym || (lower.length >= 7 && !GENERIC.has(lower))) && !out.has(lower)) out.set(lower, acronym ? word : lower);
    }
    return out;
  }
  let active = null, showBooks = true, bookCache = null, bookRequest = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const reducedMotion = () => Boolean(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function buildGraph(state) {
    const topics = (state.topics || []).filter(topic => topic && topic.id && Array.isArray(topic.sections));
    const chapters = topics.some(topic => topic.chapter) ? topics.filter(topic => topic.chapter) : topics;
    const questions = state.questions || [];
    const nodes = [{id: 'root', kind: 'root', label: state.specialtyLabel || '知識', short: '核心', color: '#f43f5e', r: 20}];
    const links = [];
    chapters.forEach((topic, index) => {
      const color = COLORS[index % COLORS.length];
      const pillarId = 'c:' + topic.id;
      nodes.push({id: pillarId, kind: 'chapter', topicId: topic.id, chapterIndex: index, label: topic.title, short: String(topic.chapter || index + 1), color, r: 13,
        related: [], summary: topic.summary || '', count: topic.sections.length, questions: typeof state.questionCount === 'function' ? state.questionCount(topic) : questions.filter(q => q.topicId === topic.id).length, cases: (topic.cases || []).length});
      links.push(['root', pillarId]);
      if (index) links.push(['c:' + chapters[index - 1].id, pillarId, 'ring']);
      topic.sections.forEach((section, k) => {
        const id = 'p:' + topic.id + ':' + k;
        nodes.push({id, kind: 'point', topicId: topic.id, chapterIndex: index, sectionIndex: k, label: section.title, color, r: 4.5, related: [],
          terms: keyTerms(section.title + ' ' + (section.points || []).join(' ')), points: (section.points || []).slice(0, 2), parent: topic.title});
        links.push([pillarId, id]);
      });
    });
    if (chapters.length > 2) links.push(['c:' + chapters[chapters.length - 1].id, 'c:' + chapters[0].id, 'ring']);
    const chapterIndex = new Map(chapters.map((topic, index) => [topic.id, index]));
    const chapterNode = id => nodes.find(node => node.id === 'c:' + id);
    /* Cross-chapter links the lessons already declare, with their reason. */
    const enrichment = (state.enrichment && state.enrichment.chapters) || {};
    const paired = new Set();
    chapters.forEach(topic => {
      const declared = (enrichment[topic.id] && enrichment[topic.id].integrated && enrichment[topic.id].integrated.connections) || [];
      for (const item of declared) {
        if (!item || item.topicId === topic.id || !chapterIndex.has(item.topicId)) continue;
        const from = chapterNode(topic.id), to = chapterNode(item.topicId);
        from.related.push({id: to.id, label: to.label, reason: item.reason || ''});
        if (!to.related.some(entry => entry.id === from.id)) to.related.push({id: from.id, label: from.label, reason: item.reason || ''});
        const key = [topic.id, item.topicId].sort().join('|');
        if (!paired.has(key)) { paired.add(key); links.push([from.id, to.id, 'cross']); }
      }
    });
    /* Key points of different chapters that share a distinctive term, and key points taught in one unit. */
    const pointNodes = nodes.filter(node => node.kind === 'point');
    const spread = new Map();
    for (const node of pointNodes) for (const term of node.terms.keys()) spread.set(term, (spread.get(term) || 0) + 1);
    for (let i = 0; i < pointNodes.length; i++) {
      for (let j = i + 1; j < pointNodes.length; j++) {
        const a = pointNodes[i], b = pointNodes[j];
        if (a.topicId === b.topicId) continue;
        const shared = [...a.terms.keys()].filter(term => b.terms.has(term) && spread.get(term) <= 8);
        if (!shared.length) continue;
        const reason = '共同關鍵詞：' + shared.map(term => a.terms.get(term)).join('、');
        a.related.push({id: b.id, label: b.parent + '｜' + b.label, reason});
        b.related.push({id: a.id, label: a.parent + '｜' + a.label, reason});
        links.push([a.id, b.id, 'term']);
      }
    }
    chapters.forEach(topic => {
      for (const unit of (enrichment[topic.id] && enrichment[topic.id].integrated && enrichment[topic.id].integrated.units) || []) {
        const members = (unit.sectionIndexes || []).filter(k => Number.isInteger(k) && k >= 0 && k < topic.sections.length);
        for (let k = 1; k < members.length; k++) links.push(['p:' + topic.id + ':' + members[k - 1], 'p:' + topic.id + ':' + members[k], 'unit']);
      }
    });
    /* BCSC textbook sections and their chapters, tied to the course chapters they support. */
    const books = [];
    for (const book of (showBooks && Array.isArray(state.books) ? state.books : [])) {
      const targets = (BOOK_MAP[book.section] || []).filter(id => chapterIndex.has(id));
      if (book && book.bookId && Array.isArray(book.chapters) && targets.length) books.push({book, targets});
    }
    books.sort((a, b) => chapterIndex.get(a.targets[0]) - chapterIndex.get(b.targets[0]) || a.book.section - b.book.section);
    books.forEach(({book, targets}, slot) => {
      const id = 'b:' + book.bookId, home = chapterIndex.get(targets[0]);
      const mates = books.filter(other => chapterIndex.get(other.targets[0]) === home), side = mates.length > 1 ? mates.findIndex(other => other.book === book) - (mates.length - 1) / 2 : 0;
      nodes.push({id, kind: 'book', bookId: book.bookId, section: book.section, chapterIndex: home, side: side * 2, slot, slots: books.length, label: book.title, short: 'S' + book.section, color: '#e2e8f0', r: 11,
        count: book.chapters.length, targets: targets.map(topicId => ({id: 'c:' + topicId, label: chapterNode(topicId).label}))});
      for (const topicId of targets) {
        links.push(['c:' + topicId, id, 'book']);
        chapterNode(topicId).related.push({id, label: 'BCSC S' + book.section + ' ' + book.title, reason: ''});
      }
      book.chapters.forEach((chapter, k) => {
        nodes.push({id: 't:' + chapter.id, kind: 'leaf', bookId: book.bookId, chapterIndex: home, side: side * 2, slot, slots: books.length, sectionIndex: k, total: book.chapters.length,
          label: chapter.title, color: '#94a3b8', r: 3.5, related: [], parent: 'BCSC S' + book.section + ' ' + book.title, number: chapter.number, route: '#textbook-' + chapter.id});
        links.push([id, 't:' + chapter.id]);
        for (const [pattern, topicId] of TITLE_MAP) {
          if (!pattern.test(chapter.title) || !chapterIndex.has(topicId) || targets.includes(topicId)) continue;
          const course = chapterNode(topicId);
          links.push([course.id, 't:' + chapter.id, 'topic']);
          nodes[nodes.length - 1].related.push({id: course.id, label: course.label, reason: ''});
          course.related.push({id: 't:' + chapter.id, label: 'BCSC S' + book.section + '｜' + chapter.title, reason: ''});
        }
      });
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    return {nodes, byId, chapters: nodes.filter(node => node.kind === 'chapter'), books: nodes.filter(node => node.kind === 'book'),
      links: links.map(([a, b, kind]) => ({a: byId.get(a), b: byId.get(b), kind: kind || 'tree'}))};
  }

  /* Deterministic start positions, so the first frame is already readable and tests are stable. */
  function seed(graph) {
    const n = graph.chapters.length || 1;
    for (const node of graph.nodes) {
      if (node.kind === 'root') { node.x = 0; node.y = 0; continue; }
      if (node.kind === 'book' || node.kind === 'leaf') {
        const turn = (node.chapterIndex / n) * Math.PI * 2 - Math.PI / 2 + (node.side || 0) * 0.2, spin = node.kind === 'leaf' ? (node.sectionIndex / node.total) * Math.PI * 2 : 0, reach = node.kind === 'leaf' ? 44 : 0;
        node.x = Math.cos(turn) * 560 + Math.cos(spin) * reach; node.y = Math.sin(turn) * 560 + Math.sin(spin) * reach;
        if (node.kind === 'book') { node.ax = node.x; node.ay = node.y; }
        continue;
      }
      const angle = (node.chapterIndex / n) * Math.PI * 2 - Math.PI / 2;
      if (node.kind === 'chapter') { node.x = Math.cos(angle) * 290; node.y = Math.sin(angle) * 290; node.ax = node.x; node.ay = node.y; continue; }
      const total = graph.nodes.filter(other => other.kind === 'point' && other.chapterIndex === node.chapterIndex).length || 1;
      const spread = (node.sectionIndex / total) * Math.PI * 2;
      node.x = Math.cos(angle) * 290 + Math.cos(spread) * 46;
      node.y = Math.sin(angle) * 290 + Math.sin(spread) * 46;
    }
    for (const node of graph.nodes) { node.vx = 0; node.vy = 0; }
  }

  function layoutTargets(graph, layout) {
    const targets = new Map();
    const n = graph.chapters.length || 1;
    const rows = Math.ceil(n / Math.min(n, 7));
    for (const node of graph.nodes) {
      if (node.kind === 'book' || node.kind === 'leaf') {
        if (layout === 'radial') {
          const turn = (node.slot / node.slots) * Math.PI * 2 - Math.PI / 2;
          if (node.kind === 'book') targets.set(node.id, [Math.cos(turn) * 470, Math.sin(turn) * 470]);
          else {
            const offset = ((node.sectionIndex + 0.5) / node.total - 0.5) * (Math.PI * 2 / node.slots) * 0.84, ring = 545 + (node.sectionIndex % 3) * 26;
            targets.set(node.id, [Math.cos(turn + offset) * ring, Math.sin(turn + offset) * ring]);
          }
        } else {
          const x = ((node.slot % 7) - 3) * 118, top = (rows - 1) / 2 * 300 + 240 + Math.floor(node.slot / 7) * 470;
          if (node.kind === 'book') targets.set(node.id, [x, top]);
          else targets.set(node.id, [x + ((node.sectionIndex % 2) - 0.5) * 36, top + 28 + Math.floor(node.sectionIndex / 2) * 26]);
        }
        continue;
      }
      if (layout === 'radial') {
        const angle = ((node.chapterIndex || 0) / n) * Math.PI * 2 - Math.PI / 2;
        if (node.kind === 'root') targets.set(node.id, [0, 0]);
        else if (node.kind === 'chapter') targets.set(node.id, [Math.cos(angle) * 235, Math.sin(angle) * 235]);
        else {
          const total = graph.nodes.filter(other => other.kind === 'point' && other.chapterIndex === node.chapterIndex).length || 1;
          const offset = ((node.sectionIndex + 0.5) / total - 0.5) * (Math.PI * 2 / n) * 0.86;
          const ring = 330 + (node.sectionIndex % 2) * 32;
          targets.set(node.id, [Math.cos(angle + offset) * ring, Math.sin(angle + offset) * ring]);
        }
      } else {
        const cols = Math.min(n, 7);
        const col = (node.chapterIndex || 0) % cols, row = Math.floor((node.chapterIndex || 0) / cols);
        const x = (col - (cols - 1) / 2) * 118, top = (row - (rows - 1) / 2) * 300 - 110;
        if (node.kind === 'root') targets.set(node.id, [0, -(rows - 1) / 2 * 300 - 200]);
        else if (node.kind === 'chapter') targets.set(node.id, [x, top]);
        else targets.set(node.id, [x + ((node.sectionIndex % 2) - 0.5) * 36, top + 30 + Math.floor(node.sectionIndex / 2) * 30]);
      }
    }
    return targets;
  }

  function stepForce(graph, alpha) {
    const nodes = graph.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 90000) continue;
        if (d2 < 1) { dx = 0.5 + (i % 3); dy = 0.5 + (j % 3); d2 = dx * dx + dy * dy; }
        const small = (a.kind === 'point' || a.kind === 'leaf') && (b.kind === 'point' || b.kind === 'leaf');
        const strength = (small ? 260 : 1500) / d2;
        const d = Math.sqrt(d2), fx = dx / d * strength * alpha, fy = dy / d * strength * alpha;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const link of graph.links) {
      const a = link.a, b = link.b;
      if (link.kind === 'cross' || link.kind === 'term' || link.kind === 'topic' || link.kind === 'unit') continue;
      const rest = link.kind === 'book' ? 230 : a.kind === 'root' ? 290 : b.kind === 'point' ? 50 : b.kind === 'leaf' ? 44 : 132;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = (d - rest) / d * (link.kind === 'book' ? 0.008 : 0.06) * alpha;
      a.vx += dx * pull; a.vy += dy * pull; b.vx -= dx * pull; b.vy -= dy * pull;
    }
    for (const node of nodes) {
      node.vx -= node.x * 0.0016 * alpha; node.vy -= node.y * 0.0016 * alpha;
      if (node.ax != null) { node.vx += (node.ax - node.x) * 0.03 * alpha; node.vy += (node.ay - node.y) * 0.03 * alpha; }
      if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
      node.vx *= 0.82; node.vy *= 0.82;
      node.x += node.vx; node.y += node.vy;
    }
  }

  function settle(graph, rounds) {
    for (let i = 0; i < rounds; i++) stepForce(graph, Math.max(0.08, 1 - i / rounds));
  }

  function markup(graph, view) {
    const modeButtons = MODES.map(([id, label]) => `<button type="button" class="kg-mode${view.mode === id ? ' is-active' : ''}" data-kg-mode="${id}" aria-pressed="${view.mode === id}">${label}</button>`).join('');
    const bookChips = graph.books.slice().sort((a, b) => a.section - b.section).map(node => `<button type="button" class="kg-chip" data-kg-node="${esc(node.id)}"><i style="background:${node.color}"></i>${esc(node.short)} ${esc(node.label)}</button>`).join('');
    const leaves = graph.nodes.filter(node => node.kind === 'leaf').length, crossLinks = graph.links.filter(link => link.kind === 'cross').length, deepLinks = graph.links.filter(link => link.kind === 'term' || link.kind === 'topic').length;
    const bookToggle = view.hasBooks ? `<button type="button" class="kg-mode${showBooks ? ' is-on' : ''}" data-kg-books aria-pressed="${showBooks}">BCSC 原文書：${showBooks ? '顯示中' : '已隱藏'}</button>` : '';
    const chips = graph.chapters.map(node => `<button type="button" class="kg-chip" data-kg-node="${esc(node.id)}"><i style="background:${node.color}"></i>${esc(node.short)} ${esc(node.label)}</button>`).join('');
    return `<header class="kg-head"><div><p class="kg-eyebrow">知識圖譜</p><h2>${esc(graph.nodes[0].label)}章節知識圖譜</h2><p class="kg-sub">${graph.chapters.length} 章、${graph.nodes.filter(node => node.kind === 'point').length} 個基礎重點${crossLinks ? `、${crossLinks} 條跨章連結（虛線）` : ''}${deepLinks ? `、${deepLinks} 條重點與原文書互連（綠線）` : ''}${graph.books.length ? `，加上 BCSC ${graph.books.length} 冊 ${leaves} 章` : ''}。拖曳節點或背景、滾輪縮放；點節點看重點並跳到章節。</p></div></header>`
      + `<div class="kg-toolbar" role="group" aria-label="圖譜模式">${modeButtons}<button type="button" class="kg-mode" data-kg-reset>重置視角</button>${bookToggle}<span class="kg-status" data-kg-status role="status"></span></div>`
      + `<div class="kg-stage"><canvas class="kg-canvas" tabindex="0" role="img" aria-label="${esc(graph.nodes[0].label)}章節知識圖譜，共 ${graph.nodes.length} 個節點。章節清單在圖下方。"></canvas><div class="kg-caption" data-kg-caption hidden></div></div>`
      + `<div class="kg-detail" data-kg-detail aria-live="polite"><p class="kg-hint">點選圖上的節點，或從下方章節清單選一章。</p></div>`
      + `<nav class="kg-chips" aria-label="章節清單">${chips}</nav>`
      + (bookChips ? `<nav class="kg-chips" aria-label="BCSC 原文書清單">${bookChips}</nav>` : '');
  }

  function detailMarkup(node) {
    if (!node || node.kind === 'root') return '<p class="kg-hint">點選圖上的節點，或從下方章節清單選一章。</p>';
    const jump = entries => entries.map(entry => `<li><button type="button" class="kg-link" data-kg-node="${esc(entry.id)}">${esc(entry.label)}</button>${entry.reason ? `<span>${esc(entry.reason)}</span>` : ''}</li>`).join('');
    if (node.kind === 'book') {
      return `<p class="kg-tag" style="border-color:#38bdf8">BCSC ${esc(node.short)}</p><h3>${esc(node.label)}</h3><p class="kg-meta">${node.count} 章 · 對應的共筆章節</p><ul class="kg-related">${jump(node.targets)}</ul>`
        + `<button type="button" class="kg-open" data-kg-open="#textbook-${esc(node.bookId)}">打開這一冊</button>`;
    }
    if (node.kind === 'leaf') {
      return `<p class="kg-tag" style="border-color:#38bdf8">${esc(node.parent)}</p><h3>第 ${esc(node.number)} 章　${esc(node.label)}</h3>${node.related.length ? `<p class="kg-meta">相關共筆章節</p><ul class="kg-related">${jump(node.related)}</ul>` : ''}<button type="button" class="kg-open" data-kg-open="${esc(node.route)}">打開原文書這一章</button>`;
    }
    if (node.kind === 'chapter') {
      return `<p class="kg-tag" style="border-color:${node.color}">第 ${esc(node.short)} 章</p><h3>${esc(node.label)}</h3>${node.summary ? `<p>${esc(node.summary)}</p>` : ''}`
        + `<p class="kg-meta">${node.count} 個基礎重點 · ${node.questions} 題選擇題 · ${node.cases} 個情境</p>${node.related.length ? `<p class="kg-meta">相關章節與原文書</p><ul class="kg-related">${jump(node.related)}</ul>` : ''}<button type="button" class="kg-open" data-kg-open="#topic-${esc(node.topicId)}">打開這一章</button>`;
    }
    return `<p class="kg-tag" style="border-color:${node.color}">${esc(node.parent)}</p><h3>${esc(node.label)}</h3>${node.points.map(point => `<p>${esc(point)}</p>`).join('')}${node.related.length ? `<p class="kg-meta">其他章的相關重點</p><ul class="kg-related">${jump(node.related)}</ul>` : ''}`
      + `<button type="button" class="kg-open" data-kg-open="#topic-${esc(node.topicId)}">打開這一章</button>`;
  }

  function mount(container, state) {
    unmount();
    if (!container) return null;
    const graph = buildGraph(state || {});
    if (graph.chapters.length < 1) { container.innerHTML = ''; container.hidden = true; return null; }
    container.hidden = false;
    seed(graph);
    settle(graph, 140);
    const view = {hasBooks: Array.isArray(state && state.books) && state.books.length > 0, mode: 'force', layout: 'force', scale: 1, tx: 0, ty: 0, selected: null, hover: null, alpha: 0.5, morph: null, fly: null, raf: 0, drag: null, moved: false};
    container.innerHTML = markup(graph, view);
    const canvas = container.querySelector('.kg-canvas');
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    const statusEl = container.querySelector('[data-kg-status]');
    const captionEl = container.querySelector('[data-kg-caption]');
    const detailEl = container.querySelector('[data-kg-detail]');
    const instance = {container, graph, view, state, canvas};
    active = instance;
    let width = 0, height = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : {width: 900, height: 520};
      const dpr = Math.min(w.devicePixelRatio || 1, 2);
      width = rect.width || 900; height = rect.height || 520;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function fit() {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const node of graph.nodes) { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y); }
      const scale = Math.min(width / (maxX - minX + 120), height / (maxY - minY + 90), 1.6);
      return {scale, tx: -(minX + maxX) / 2 * scale, ty: -(minY + maxY) / 2 * scale};
    }
    function setStatus() {
      const label = view.mode === 'fly' ? (view.fly ? `巡航中 ${view.fly.index + 1}/${graph.chapters.length}` : '巡航結束')
        : view.mode === 'morph' ? `版面：${LAYOUTS.find(item => item[0] === view.layout)[1]}（再按一次切換）` : `${view.scale.toFixed(2)}×`;
      if (statusEl) statusEl.textContent = label;
    }
    function toScreen(node) { return [width / 2 + view.tx + node.x * view.scale, height / 2 + view.ty + node.y * view.scale]; }
    function nodeAt(px, py) {
      let best = null, bestD = Infinity;
      for (const node of graph.nodes) {
        const [sx, sy] = toScreen(node);
        const d = Math.hypot(px - sx, py - sy), reach = Math.max(node.r * view.scale, 9) + 5;
        if (d <= reach && d < bestD) { best = node; bestD = d; }
      }
      return best;
    }
    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const focus = view.selected || view.hover;
      const lit = new Set();
      if (focus) { lit.add(focus.id); for (const link of graph.links) { if (link.a === focus) lit.add(link.b.id); if (link.b === focus) lit.add(link.a.id); } }
      ctx.lineWidth = 1;
      for (const link of graph.links) {
        const [ax, ay] = toScreen(link.a), [bx, by] = toScreen(link.b);
        const on = focus && lit.has(link.a.id) && lit.has(link.b.id);
        const cross = link.kind === 'cross', deep = link.kind === 'term' || link.kind === 'topic';
        ctx.strokeStyle = on ? (cross || deep ? 'rgba(253,224,71,.95)' : 'rgba(226,232,240,.75)') : focus ? 'rgba(148,163,184,.08)' : cross ? 'rgba(196,181,253,.5)' : deep ? 'rgba(45,212,191,.2)' : link.kind === 'book' ? 'rgba(226,232,240,.28)' : link.kind === 'unit' ? 'rgba(148,163,184,.18)' : 'rgba(148,163,184,.3)';
        if (ctx.setLineDash) ctx.setLineDash(cross ? [5, 4] : []);
        ctx.lineWidth = (cross || deep) && on ? 1.8 : 1;
        ctx.beginPath(); ctx.moveTo(ax, ay);
        if ((cross || deep) && ctx.quadraticCurveTo) ctx.quadraticCurveTo((ax + bx) / 2 + (by - ay) * 0.16, (ay + by) / 2 - (bx - ax) * 0.16, bx, by); else ctx.lineTo(bx, by);
        ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const node of graph.nodes) {
        const tiny = node.kind === 'point' || node.kind === 'leaf';
        const [x, y] = toScreen(node), r = Math.max(node.r * Math.min(view.scale, 1.8), tiny ? 2.2 : 8);
        const dim = focus && !lit.has(node.id);
        ctx.globalAlpha = dim ? 0.28 : 1;
        ctx.fillStyle = node.color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        if (!tiny || node === focus) { ctx.strokeStyle = node.kind === 'book' ? '#38bdf8' : '#f8fafc'; ctx.lineWidth = node === focus ? 2.5 : 1.5; ctx.stroke(); ctx.lineWidth = 1; }
        if (!tiny) {
          ctx.fillStyle = '#0b1020'; ctx.font = (node.kind === 'book' ? '700 9.5px' : '700 11px') + ' system-ui,sans-serif'; ctx.fillText(node.kind === 'root' ? node.label[0] : node.short, x, y + 0.5);
          if (view.scale >= (node.kind === 'book' ? 0.62 : 0.42) || node === focus || node.kind === 'root') { ctx.fillStyle = '#e2e8f0'; ctx.font = '600 12.5px system-ui,"Noto Sans TC",sans-serif'; ctx.fillText(node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label, x, y + r + 12); }
        } else if (node === focus || (focus && lit.has(node.id) && focus.kind !== 'chapter' && focus.kind !== 'book') || (view.scale >= 1.7 && !dim)) {
          ctx.fillStyle = '#cbd5e1'; ctx.font = '11.5px system-ui,"Noto Sans TC",sans-serif'; ctx.fillText(node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label, x, y + r + 10);
        }
      }
      ctx.globalAlpha = 1;
    }
    function select(node, announce) {
      view.selected = node && node.kind !== 'root' ? node : null;
      if (detailEl) detailEl.innerHTML = detailMarkup(view.selected);
      for (const chip of container.querySelectorAll('.kg-chip')) chip.classList.toggle('is-active', Boolean(view.selected) && chip.getAttribute('data-kg-node') === (view.selected.kind === 'chapter' || view.selected.kind === 'book' ? view.selected.id : view.selected.kind === 'leaf' ? 'b:' + view.selected.bookId : 'c:' + view.selected.topicId));
      if (announce !== false) kick();
    }
    function cancelFit() { if (view.fitTimer) { w.clearTimeout(view.fitTimer); view.fitTimer = 0; } }
    function cameraTo(target, ms) {
      view.follow = null;
      if (reducedMotion() || !ms) { view.scale = target.scale; view.tx = target.tx; view.ty = target.ty; view.cam = null; return; }
      view.cam = {from: {scale: view.scale, tx: view.tx, ty: view.ty}, to: target, start: now(), ms};
    }
    /* Follow a node, so the camera stays on it while the layout is still moving. */
    function focusNode(node, scale) {
      cancelFit();
      view.cam = null;
      if (reducedMotion()) { view.follow = null; view.scale = scale; view.tx = -node.x * scale; view.ty = -node.y * scale; return; }
      view.follow = {node, scale};
    }
    function now() { return w.performance && w.performance.now ? w.performance.now() : Date.now(); }
    function startMorph(layout) {
      view.layout = layout;
      if (layout === 'force') {
        view.morph = null;
        for (const node of graph.nodes) node.fixed = false;
        if (reducedMotion()) { settle(graph, 140); view.alpha = 0; } else view.alpha = 0.9;
        return;
      }
      const targets = layoutTargets(graph, layout);
      if (reducedMotion()) { for (const node of graph.nodes) { const t = targets.get(node.id); node.x = t[0]; node.y = t[1]; } view.morph = null; view.alpha = 0; return; }
      view.alpha = 0;
      view.morph = {start: now(), ms: 900, from: new Map(graph.nodes.map(node => [node.id, [node.x, node.y]])), to: targets};
    }
    function stopFly(done) {
      if (view.fly && view.fly.timer) w.clearTimeout(view.fly.timer);
      view.fly = null; view.follow = null;
      if (captionEl) captionEl.hidden = true;
      if (done) cameraTo(fit(), 700);
    }
    function flyStep(index) {
      if (active !== instance || view.mode !== 'fly') return;
      if (index >= graph.chapters.length) { stopFly(true); setStatus(); kick(); return; }
      const node = graph.chapters[index];
      view.fly = {index, timer: 0};
      select(node, false);
      focusNode(node, 2.1);
      if (captionEl) { captionEl.hidden = false; captionEl.textContent = `第 ${node.short} 章　${node.label}`; }
      setStatus(); kick();
      view.fly.timer = w.setTimeout(() => flyStep(index + 1), reducedMotion() ? 2600 : 2300);
    }
    function setMode(mode) {
      const again = view.mode === mode;
      cancelFit();
      stopFly(false);
      view.mode = mode;
      for (const button of container.querySelectorAll('[data-kg-mode]')) {
        const on = button.getAttribute('data-kg-mode') === mode;
        button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on));
      }
      if (mode === 'force') { startMorph('force'); cameraTo(fit(), 600); }
      else if (mode === 'fly') { if (view.layout !== 'force') startMorph('force'); flyStep(0); }
      else {
        const order = LAYOUTS.map(item => item[0]);
        const next = again ? order[(order.indexOf(view.layout) + 1) % order.length] : (view.layout === 'force' ? 'radial' : view.layout);
        startMorph(next);
        view.fitTimer = w.setTimeout(() => { view.fitTimer = 0; if (active === instance && view.mode === 'morph') { cameraTo(fit(), 600); kick(); } }, reducedMotion() ? 0 : 920);
      }
      setStatus(); kick();
    }
    function frame() {
      view.raf = 0;
      if (active !== instance) return;
      if (container.isConnected === false) { unmount(); return; }
      let busy = false;
      const t = now();
      if (view.morph) {
        const p = Math.min(1, (t - view.morph.start) / view.morph.ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        for (const node of graph.nodes) { const a = view.morph.from.get(node.id), b = view.morph.to.get(node.id); node.x = a[0] + (b[0] - a[0]) * e; node.y = a[1] + (b[1] - a[1]) * e; }
        if (p >= 1) view.morph = null; else busy = true;
      } else if (view.layout === 'force' && view.alpha > 0.02) {
        stepForce(graph, view.alpha); view.alpha *= 0.985; busy = true;
      }
      if (view.follow) {
        const f = view.follow, tx = -f.node.x * f.scale, ty = -f.node.y * f.scale;
        view.scale += (f.scale - view.scale) * 0.1; view.tx += (tx - view.tx) * 0.1; view.ty += (ty - view.ty) * 0.1;
        if (Math.abs(tx - view.tx) + Math.abs(ty - view.ty) > 0.6 || Math.abs(f.scale - view.scale) > 0.004 || view.morph || (view.layout === 'force' && view.alpha > 0.02)) busy = true;
        else if (view.mode !== 'fly') view.follow = null;
      }
      if (view.cam) {
        const p = Math.min(1, (t - view.cam.start) / view.cam.ms), e = 1 - Math.pow(1 - p, 3);
        for (const key of ['scale', 'tx', 'ty']) view[key] = view.cam.from[key] + (view.cam.to[key] - view.cam.from[key]) * e;
        if (p >= 1) view.cam = null; else busy = true;
        if (view.mode !== 'fly') setStatus();
      }
      draw();
      if (busy) kick();
    }
    function kick() {
      if (view.raf || active !== instance) return;
      view.raf = w.requestAnimationFrame ? w.requestAnimationFrame(frame) : w.setTimeout(frame, 16);
    }
    function point(event) {
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : {left: 0, top: 0};
      return [event.clientX - rect.left, event.clientY - rect.top];
    }
    function onDown(event) {
      const [px, py] = point(event), node = nodeAt(px, py);
      view.moved = false;
      view.drag = node ? {node, px, py} : {pan: true, px, py, tx: view.tx, ty: view.ty};
      if (node && view.layout === 'force') node.fixed = true;
      if (canvas.setPointerCapture && event.pointerId != null) { try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* pointer already released */ } }
    }
    function onMove(event) {
      const [px, py] = point(event);
      if (!view.drag) {
        const node = nodeAt(px, py);
        if (node !== view.hover) { view.hover = node; canvas.style.cursor = node ? 'pointer' : 'grab'; kick(); }
        return;
      }
      if (Math.hypot(px - view.drag.px, py - view.drag.py) > 4) view.moved = true;
      if (view.drag.pan) { view.tx = view.drag.tx + px - view.drag.px; view.ty = view.drag.ty + py - view.drag.py; view.cam = null; view.follow = null; cancelFit(); }
      else if (view.layout === 'force' && view.moved) {
        view.drag.node.x = (px - width / 2 - view.tx) / view.scale; view.drag.node.y = (py - height / 2 - view.ty) / view.scale;
        if (!reducedMotion()) view.alpha = Math.max(view.alpha, 0.35);
      }
      kick();
    }
    function onUp() {
      const drag = view.drag;
      view.drag = null;
      if (!drag) return;
      if (drag.node) { drag.node.fixed = false; if (!view.moved) { if (view.mode === 'fly') stopFly(false); select(drag.node); } }
      else if (!view.moved) select(null);
      kick();
    }
    function onWheel(event) {
      if (event.preventDefault) event.preventDefault();
      const [px, py] = point(event), factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(4, Math.max(0.35, view.scale * factor));
      const wx = (px - width / 2 - view.tx) / view.scale, wy = (py - height / 2 - view.ty) / view.scale;
      view.scale = next; view.tx = px - width / 2 - wx * next; view.ty = py - height / 2 - wy * next; view.cam = null; view.follow = null; cancelFit();
      setStatus(); kick();
    }
    function onKey(event) {
      const steps = {ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40]};
      if (steps[event.key]) { view.tx += steps[event.key][0]; view.ty += steps[event.key][1]; }
      else if (event.key === '+' || event.key === '=') view.scale = Math.min(4, view.scale * 1.15);
      else if (event.key === '-') view.scale = Math.max(0.35, view.scale / 1.15);
      else if (event.key === 'Escape') { stopFly(false); select(null); }
      else return;
      if (event.preventDefault) event.preventDefault();
      view.cam = null; view.follow = null; cancelFit(); setStatus(); kick();
    }
    function onClick(event) {
      const target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      const mode = target.closest('[data-kg-mode]'), chip = target.closest('[data-kg-node]'), open = target.closest('[data-kg-open]');
      if (target.closest('[data-kg-books]')) { showBooks = !showBooks; mount(container, state); return; }
      if (mode) setMode(mode.getAttribute('data-kg-mode'));
      else if (target.closest('[data-kg-reset]')) { cancelFit(); stopFly(false); select(null, false); cameraTo(fit(), 600); setStatus(); kick(); }
      else if (chip) { const node = graph.byId.get(chip.getAttribute('data-kg-node')); if (node) { stopFly(false); select(node, false); focusNode(node, 1.9); setStatus(); kick(); } }
      else if (open && typeof state.openRoute === 'function') state.openRoute(open.getAttribute('data-kg-open'), true);
    }
    const onResize = () => { if (active === instance) { resize(); kick(); } };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', () => { if (!view.drag && view.hover) { view.hover = null; kick(); } });
    canvas.addEventListener('wheel', onWheel, {passive: false});
    canvas.addEventListener('keydown', onKey);
    container.addEventListener('click', onClick);
    if (w.addEventListener) w.addEventListener('resize', onResize);
    instance.dispose = () => {
      stopFly(false);
      cancelFit();
      if (view.raf) (w.cancelAnimationFrame || w.clearTimeout)(view.raf);
      container.removeEventListener('click', onClick);
      if (w.removeEventListener) w.removeEventListener('resize', onResize);
    };
    Object.assign(instance, {setMode, select: id => select(graph.byId.get(id) || null), nodeAt, draw});

    resize();
    Object.assign(view, fit());
    if (reducedMotion()) view.alpha = 0;
    setStatus();
    kick();
    return instance;
  }

  function unmount() {
    if (active && active.dispose) active.dispose();
    active = null;
  }

  /* Put the graph just above the existing map section; re-rendering the page keeps one host. */
  function attach(mapRoot, state) {
    if (!mapRoot || !mapRoot.parentNode) return null;
    const doc = mapRoot.ownerDocument || w.document;
    let host = doc.getElementById('knowledge-graph-root');
    if (!host) {
      host = doc.createElement('section');
      host.id = 'knowledge-graph-root';
      host.className = 'kg-shell';
      host.setAttribute('aria-label', '章節知識圖譜');
      mapRoot.parentNode.insertBefore(host, mapRoot);
    }
    if (active && active.container === host && active.state.topics === state.topics && active.state.books === state.books) return active;
    return mount(host, state);
  }
  /* Called by the page whenever the view changes: state while the map tab is open, null otherwise. */
  let pending = null, observer = null;
  function ensure() {
    const doc = w.document;
    if (!pending || !doc) return;
    const mapRoot = doc.getElementById('knowledge-map-root');
    if (mapRoot) attach(mapRoot, pending);
  }
  function sync(state) {
    pending = state || null;
    if (pending && bookCache) pending.books = bookCache;
    const doc = w.document;
    if (!pending) { unmount(); if (observer) { observer.disconnect(); observer = null; } return; }
    ensure();
    w.setTimeout(ensure, 0);
    /* The textbook catalogue is fetched once, and only for the course whose chapters it maps to. */
    if (!bookCache && !bookRequest && typeof w.fetch === 'function' && (pending.topics || []).some(topic => topic && /^notes-\d+$/.test(topic.id))) {
      bookRequest = w.fetch('content/textbook-manifest.json').then(response => response.ok ? response.json() : null).then(manifest => {
        if (!manifest || !Array.isArray(manifest.books)) { bookRequest = null; return; }
        bookCache = manifest.books;
        if (pending) { pending = Object.assign({}, pending, {books: bookCache}); ensure(); }
      }).catch(() => { bookRequest = null; });
    }
    const main = doc && doc.getElementById('main');
    if (!observer && main && typeof w.MutationObserver === 'function') {
      observer = new w.MutationObserver(() => { if (pending && !doc.getElementById('knowledge-graph-root')) ensure(); });
      observer.observe(main, {childList: true});
    }
  }

  w.OphKnowledgeGraph = {mount, unmount, attach, sync, buildGraph, layoutTargets, get active() { return active; }};
})(typeof window !== 'undefined' ? window : globalThis);
