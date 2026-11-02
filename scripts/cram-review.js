/* Supplemental review module; intentionally separate from the app's answers and cloud sync. */
(function () {
  'use strict';
  if (window.OphCram) return;
  const KEY = ((window.OphSpecialty && window.OphSpecialty.storePrefix) || 'oph-prep:') + 'cram-review-v1';
  const base = new URL('../', document.currentScript.src);
  let data, pending, root, states = {}, group = 'all', filter = 'all', saveError = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function read() { try { const v = JSON.parse(window.localStorage.getItem(KEY) || '{}'); states = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { states = {}; saveError = true; } }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(states)); saveError = false; } catch (_) { saveError = true; } }
  function source(s) { return `<span class="cram-source">${esc(s?.chapter)} · ${esc(s?.pages)}</span>`; }
  function links(items) { return (items || []).filter(l => /^https:\/\//.test(l.url)).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · '); }
  function chapterLink(id, text) { return `<a class="cram-chapter-link" href="#topic-${esc(id)}">${esc(text)} →</a>`; }
  function status(id) { return ['review','known'].includes(states[id]?.status) ? states[id].status : 'new'; }
  const nowMs = () => (window.OphStudy?.now ? window.OphStudy.now() : Date.now());
  const DAYS = [1, 3, 7, 14, 30];
  function scheduleCard(prev, rating, now) {
    if (window.OphStudyScheduler?.schedule) {
      const validPrev = window.OphStudyScheduler.planValid(prev) ? prev : null;
      return window.OphStudyScheduler.schedule(validPrev, rating !== 'again', rating, now);
    }
    let step = -1, delay = 600000;
    if (rating === 'hard') { step = 0; delay = 86400000; }
    if (rating === 'good') { step = Math.min(4, Math.max(0, (prev?.step ?? -1) + 1)); delay = DAYS[step] * 86400000; }
    if (rating === 'easy') { step = Math.min(4, Math.max(1, (prev?.step ?? -1) + 2)); delay = DAYS[step] * 86400000; }
    return { step, dueAt: new Date(now + delay).toISOString(), rating, reviewCount: (prev?.reviewCount || 0) + 1, lapses: (prev?.lapses || 0) + (rating === 'again' ? 1 : 0) };
  }
  function isCardDue(id, now = nowMs()) {
    const plan = states[id]?.plan;
    if (plan && Number.isFinite(Date.parse(plan.dueAt))) return Date.parse(plan.dueAt) <= now;
    return status(id) === 'review';
  }
  const fmtDue = t => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  function render() {
    if (!root?.isConnected || !data) return;
    const now = nowMs();
    const known = data.cards.filter(c => status(c.id) === 'known').length;
    const review = data.cards.filter(c => status(c.id) === 'review').length;
    const dueCount = data.cards.filter(c => isCardDue(c.id, now)).length;
    const cards = data.cards.filter(c => (group === 'all' || c.groupId === group) && (filter === 'all' || (filter === 'due' ? isCardDue(c.id, now) : status(c.id) === filter)));
    root.innerHTML = `<header class="cram-heading"><div><p class="cram-eyebrow">共筆複習 · 主動回想</p><h1>${esc(data.title)}</h1><p class="subtitle">先讀六組對照，再遮住答案回想；卡住的卡片標為待複習。</p></div><div class="cram-count"><strong>${known}<small> / ${data.cards.length}</small></strong><span>自評已掌握 · ${review} 待複習 · ${dueCount} 到期</span></div></header>
      <p class="cram-save" role="status">${saveError ? '此瀏覽器無法保存自評；請保持此頁開啟。' : '自評只保存在此瀏覽器，重新開啟會恢復；不包含在雲端同步。'}</p>
      <details class="cram-source-note"><summary>教材來源與使用範圍</summary><p>${esc(data.disclaimer)}</p><p>${esc(data.sourceNotice)}</p></details>
      <nav class="cram-jumps" aria-label="衝刺章節"><a href="#cram-priorities">六組對照</a><a href="#cram-cards">回想卡</a><a href="#cram-corrections">共筆勘誤</a><a href="#cram-chapters">全冊索引</a></nav>
      <section id="cram-priorities" class="cram-section"><h2>先讀這六組對照</h2><div class="cram-groups">${data.groups.map((g,i) => `<details class="cram-group" ${i===0?'open':''}><summary><span class="cram-number">${i+1}</span><span><strong>${esc(g.title)}</strong><small>${esc(g.summary)}</small></span></summary><div class="cram-group-body">${g.points.map(p => `<article><h3>${esc(p.question)}</h3><p>${esc(p.answer)}</p><p class="cram-trap"><b>容易混淆</b> ${esc(p.trap)}</p>${source(p.source)}${p.links?.length?`<p>${links(p.links)}</p>`:''}</article>`).join('')}<div class="cram-related">${g.chapterIds.map(id => chapterLink(id, data.chapters.find(c=>c.id===id)?.title || id)).join('')}</div></div></details>`).join('')}</div></section>
      <section id="cram-cards" class="cram-section"><div class="cram-section-head"><div><h2>遮住答案，主動回想</h2><p>先說出答案，再展開核對。自評不代表客觀測驗分數。</p></div><span class="cram-result" aria-live="polite">顯示 ${cards.length} 張</span></div><div class="cram-filters"><label>主題<select data-cram-group><option value="all">全部主題</option>${data.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===group?'selected':''}>${esc(g.title)}</option>`).join('')}</select></label><label>自評狀態<select data-cram-filter>${[['all','全部'],['due','現在到期'],['review','待複習'],['new','尚未自評'],['known','已掌握']].map(([v,label])=>`<option value="${v}" ${filter===v?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" data-cram-next-due ${dueCount?'':'disabled'}>跳至下一張到期卡（${dueCount}）</button></div><div class="cram-cards">${cards.length?cards.map(c => {const plan=states[c.id]?.plan;return `<article class="cram-card" data-card-id="${esc(c.id)}"><div class="cram-card-meta"><span>${esc(data.groups.find(g=>g.id===c.groupId)?.title)}</span><span class="cram-badge ${status(c.id)}">${{new:'尚未自評',review:'待複習',known:'已掌握'}[status(c.id)]}${plan?` · 下次 ${fmtDue(plan.dueAt)}${isCardDue(c.id,now)?'（現在到期）':''}`:''}</span></div><h3>${esc(c.question)}</h3><details class="cram-answer"><summary>揭曉答案與易錯點</summary><p>${esc(c.answer)}</p><p class="cram-trap"><b>容易混淆</b> ${esc(c.trap)}</p>${source(c.source)}${c.links?.length?`<p>${links(c.links)}</p>`:''}<div class="cram-self"><span>間隔複習排程</span><button type="button" data-cram-srs="again" data-id="${esc(c.id)}">Again · 10分</button><button type="button" data-cram-srs="hard" data-id="${esc(c.id)}">Hard · 1天</button><button type="button" data-cram-srs="good" data-id="${esc(c.id)}">Good · 熟悉</button><button type="button" data-cram-srs="easy" data-id="${esc(c.id)}">Easy · 很熟</button></div><div class="cram-self"><span>這張卡的自評</span><button type="button" data-cram-mark="review" data-id="${esc(c.id)}" aria-pressed="${status(c.id)==='review'}">待複習</button><button type="button" data-cram-mark="known" data-id="${esc(c.id)}" aria-pressed="${status(c.id)==='known'}">已掌握</button><button type="button" data-cram-mark="new" data-id="${esc(c.id)}">重設此卡</button></div></details></article>`;}).join(''):'<div class="cram-empty">這個篩選目前沒有卡片。可切換「全部」繼續複習。</div>'}</div></section>
      <section id="cram-corrections" class="cram-section"><h2>共筆勘誤：舊稿與現行來源分開看</h2><div class="cram-corrections">${data.corrections.map(c=>`<article class="cram-correction"><h3>${esc(c.title)}</h3><p><b>共筆舊稿：</b>${esc(c.sourceWording)}</p><p><b>核對後：</b>${esc(c.correction)}</p>${source(c.source)}<p class="cram-official">${links(c.links)}</p></article>`).join('')}</div></section>
      <section id="cram-chapters" class="cram-section"><h2>十四章共筆全覽</h2><p>回到原有教材查圖與補充。排列是章節順序，不表示出題頻率。</p><div class="cram-chapters">${data.chapters.map(c=>`<article><span class="cram-number">${String(c.number).padStart(2,'0')}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.focus.join(' · '))}</p>${chapterLink(c.id,'開啟章節教材')}</div></article>`).join('')}</div></section>`;
  }
  async function mount(target) {
    root = target;
    if (!root || !root.dataset) return;
    if (!root.dataset.cramBound) {
      root.dataset.cramBound='true';
      root.addEventListener('click', e => {
        const srs=e.target.closest('[data-cram-srs]');
        if (srs) { const id=srs.dataset.id,rating=srs.dataset.cramSrs; if(!data?.cards.some(c=>c.id===id)||!['again','hard','good','easy'].includes(rating))return; const now=nowMs(),plan=scheduleCard(states[id]?.plan||null,rating,now); states[id]={status:(rating==='again'||rating==='hard')?'review':'known',at:new Date(now).toISOString(),plan}; save(); const card=srs.closest('.cram-card'); const next=card?.nextElementSibling; render(); const focus=(next && root.querySelector(`[data-card-id="${next.dataset.cardId}"] summary`)) || root.querySelector(`[data-card-id="${id}"] summary`) || root.querySelector('[data-cram-filter]'); focus?.focus(); return; }
        const nd=e.target.closest('[data-cram-next-due]');
        if (nd && !nd.disabled) { const dueCard=data?.cards.find(c=>isCardDue(c.id,nowMs())); if(!dueCard)return; if(group!=='all'||(filter!=='all'&&filter!=='due')){group='all';filter='due';render();} const el=root.querySelector(`[data-card-id="${dueCard.id}"] summary`); el?.focus(); return; }
        const b=e.target.closest('[data-cram-mark]');
        if (b) { const id=b.dataset.id; if(!data?.cards.some(c=>c.id===id))return; states[id]={status:b.dataset.cramMark,at:new Date(nowMs()).toISOString()};save();const card=b.closest('.cram-card');const next=card?.nextElementSibling;render();const focus=root.querySelector(`[data-card-id="${id}"] summary`) || (next && root.querySelector(`[data-card-id="${next.dataset.cardId}"] summary`)) || root.querySelector('[data-cram-filter]');focus?.focus(); }
        const jump=e.target.closest('.cram-jumps a');if(jump){e.preventDefault();root.querySelector(jump.getAttribute('href'))?.scrollIntoView({behavior:'smooth',block:'start'});}
      });
      root.addEventListener('change', e => { if(e.target.matches('[data-cram-group]')){group=e.target.value;render();root.querySelector('[data-cram-group]').focus();}if(e.target.matches('[data-cram-filter]')){filter=e.target.value;render();root.querySelector('[data-cram-filter]').focus();} });
    }
    read();
    try {
      if(!data){pending ||= fetch(new URL('content/cram-review.json',base)).then(r=>{if(!r.ok)throw Error('load');return r.json();}).then(d=>{if(d.version!==1||!Array.isArray(d.cards)||!Array.isArray(d.groups)||!Array.isArray(d.chapters)||!Array.isArray(d.corrections))throw Error('format');data=d;}).catch(e=>{pending=null;throw e;});await pending;}
      render();
    }catch(_){if(root?.isConnected)root.innerHTML='<section class="card"><h1>共筆考前衝刺</h1><p>暫時無法載入教材。請重新整理，或先使用原有章節教材與筆試練習。</p><button type="button" data-cram-retry>重試載入</button></section>';root?.querySelector('[data-cram-retry]')?.addEventListener('click',()=>mount(root));}
  }
  window.OphCram={mount};
  const initial=document.getElementById('cram-root');if(initial)mount(initial);
})();
