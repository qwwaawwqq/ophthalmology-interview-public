/* layout-shell:start */
// 2026-11 layout: grouped rail, one specialty switcher, the 今日 home, the interview reference column and the phone tab bar.
// Injected by scripts/apply-layout.py into the application script; edit this file, then run the script.
const NAV_LAYOUT=[['',['today']],['閱讀',['notebook','textbook','cram']],['筆試',['quiz','study','advanced']],['面試',['interview','pbl','workflow','workshop','project']],['我的',['schedule','progress','plan','links','sync']]];
// 'learn' is the chapter page itself: it opens from 章節教材, so it gets no second rail entry.
const NAV_HIDDEN=new Set(['learn']);
// The 12 early quick-review topics now live inside the chapter that teaches them (ophthalmology only).
const LEGACY_TOPICS={examination:'notes-01',optics:'notes-02','red-eye':'notes-14','vision-loss':'notes-14',trauma:'notes-05',glaucoma:'notes-07','vascular-retina':'notes-10','retina-macula':'notes-10',neuro:'notes-03',diplopia:'notes-04',pediatric:'notes-04',cataract:'notes-06'};
const TABBAR=[['today','今日',['today']],['notebook','教材',['notebook','textbook','cram','learn']],['quiz','筆試',['quiz','study','advanced']],['interview','面試',['interview','pbl','workflow','workshop','project']]];
const TABBAR_ICON={
  today:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  notebook:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/></svg>',
  quiz:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2"/></svg>',
  interview:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  more:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>'
};
const EXAM_TYPES={written:'筆試',interview:'面試',exam:'甄試',checkin:'報到'};
const TAIPEI_DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
const specState={open:false,tab:null};
let examData=null,examState='idle';

function taipeiDate(t){return TAIPEI_DAY.format(new Date(t));}
function daysUntil(date){return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(taipeiDate(Date.now())+'T00:00:00Z'))/86400000);}
function shortDate(date){const d=new Date(date+'T00:00:00Z');return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+'（'+'日一二三四五六'[d.getUTCDay()]+'）';}

/* Rail: the build-hooked `groups` list stays the source of known tabs; NAV_LAYOUT only decides order and grouping. */
function navLayout(groups){
  const known=new Set(groups.flatMap(g=>g[1]));known.add('today');
  const placed=new Set(NAV_LAYOUT.flatMap(g=>g[1])),extra=[...known].filter(id=>!placed.has(id)&&!NAV_HIDDEN.has(id));
  return NAV_LAYOUT.map(([label,ids])=>[label,(label==='我的'?[...ids,...extra]:ids).filter(id=>known.has(id)&&navs.some(n=>n[0]===id))]);
}
function navCurrent(id){return id===S.tab||(id==='notebook'&&S.tab==='learn');}

/* One home per subject: folded quick-review topics, their questions and their old links all lead to the chapter. */
function mergedInto(id){const to=SPEC.id==='oph'?LEGACY_TOPICS[id]:null;return to&&D.topics.some(t=>t.id===to)?to:null;}
function topicQuestions(t){return D.questions.filter(q=>q.topicId===t.id||mergedInto(q.topicId)===t.id);}
function chapterLabel(t){return t.chapter?(SPEC.id==='oph'?'共筆 ':'第 ')+String(t.chapter).padStart(2,'0')+(SPEC.id==='oph'?' · ':' 章 · ')+shortTitle(t.id):shortTitle(t.id);}
function topicEyebrow(t){
  const to=mergedInto(t.id);
  if(to)return '快速重點 · 已併入'+esc(chapterLabel(D.topics.find(x=>x.id===to)));
  const list=orderedTopics();
  return (t.chapter&&SPEC.id==='oph'?'共筆 ':'主題 ')+String(list.indexOf(t)+1).padStart(2,'0')+' / '+String(list.length).padStart(2,'0');
}
function mergedNotice(t){
  const to=mergedInto(t.id);if(!to)return '';
  return `<p class="merged-note">這個早期快速重點已由「${esc(chapterLabel(D.topics.find(x=>x.id===to)))}」取代，題目也併入該章練習。${btn('打開該章','learn-topic',to,'small')}</p>`;
}
function mergedSupplements(t){
  if(!t.chapter)return '';
  const list=D.topics.filter(x=>mergedInto(x.id)===t.id);if(!list.length)return '';
  return `<section class="lesson-block merged-topics" aria-label="併入本章的快速重點"><h3>併入本章的快速重點</h3><p class="small">早期「主動複習」的快速重點已由本章取代，題目併入本章練習；舊頁與回想紀錄仍保留。</p><ul class="merged-links">${list.map(x=>`<li>${btn(esc(x.title),'learn-topic',x.id,'small')}</li>`).join('')}</ul></section>`;
}
function notebookHeading(){
  const n=D.topics.filter(t=>t.chapter).length;
  return heading('','章節教材',n?`${n} 章整合教材：點章節開始閱讀，或直接搜尋重點、詳解與題目。`:'點主題開始閱讀，或直接搜尋重點與題目。');
}
function specialtySwitcher(){
  if(specState.tab!==S.tab){specState.open=false;specState.tab=S.tab;}
  const open=specState.open,current=SPECIALTY_LIST.find(x=>x[0]===SPEC.id);
  return `<section class="nav-group spec-switch${open?' is-open':''}" aria-label="科別切換"><button type="button" class="spec-toggle" data-action="spec-toggle" aria-expanded="${open}" aria-controls="spec-panel"><span class="spec-text"><span class="spec-meta">科別 · 共 ${SPECIALTY_LIST.length} 科</span><span class="spec-current">${esc(current?current[1]:SPEC.label)}</span></span><span class="spec-hint">${open?'收合':'切換'}</span></button><div class="spec-panel" id="spec-panel"${open?'':' hidden'}><label class="vh" for="spec-filter">搜尋科別</label><input class="input spec-filter" id="spec-filter" type="search" placeholder="搜尋科別" autocomplete="off" data-spec-filter><ul class="spec-list">${SPECIALTY_LIST.map(([id,label,href])=>{const on=id===SPEC.id;return `<li data-spec-name="${esc(label)}"><a class="spec-item${on?' is-active':''}" href="${esc(href)}"${on?' aria-current="page"':''}><span>${esc(label)}</span><span class="spec-state">${on?'目前':'切換'}</span></a></li>`;}).join('')}</ul><p class="small spec-note">切換科別會重新載入；各科進度與雲端同步獨立保存。</p></div></section>`;
}
function scheduleBadge(){
  loadExamSchedule();
  const next=examDays()[0];if(!next)return '';
  const n=daysUntil(next.date);
  return `<span class="nav-badge">${n===0?'今天':n+' 天後'}</span>`;
}

/* Phone tab bar and top-bar menu. Called from render() before the view is drawn. */
function tabbarMarkup(){
  const cur=TABBAR.find(t=>t[2].includes(S.tab)),open=!!$('.rail')?.classList.contains('nav-open');
  return TABBAR.filter(([id])=>tabAllowed(id)).map(([id,label])=>`<button type="button" class="tabbar-item" data-action="tab" data-value="${id}"${cur&&cur[0]===id?' aria-current="page"':''}>${TABBAR_ICON[id]}<span>${label}</span></button>`).join('')+`<button type="button" class="tabbar-item tabbar-more" data-action="more-toggle" aria-controls="nav" aria-expanded="${open}"${cur?'':' aria-current="page"'}>${TABBAR_ICON.more}<span>更多</span></button>`;
}
function setTopMenu(open){const top=$('.topbar');if(!top)return;top.classList.toggle('menu-open',open);$('.top-menu-toggle')?.setAttribute('aria-expanded',String(open));}
function layoutChrome(){
  $('.shell')?.setAttribute('data-tab',S.tab);
  const bar=document.getElementById('tabbar');if(bar)bar.innerHTML=tabbarMarkup();
  setTopMenu(false);
}
function layoutDismiss(e){
  const t=e?.target;if(!t||typeof t.closest!=='function')return;
  if($('.topbar')?.classList.contains('menu-open')&&!t.closest('.top-menu-toggle')&&(!t.closest('.top-actions')||t.closest('[data-action]')||t.closest('.app-install-entry')))setTopMenu(false);
  if(specState.open&&!t.closest('.spec-switch')){specState.open=false;const nav=$('#nav');if(nav)nav.innerHTML=navMarkup();}
}
function layoutAction(a,v,b){
  if(a==='spec-toggle'){specState.open=!specState.open;specState.tab=S.tab;$('#nav').innerHTML=navMarkup();if(specState.open)document.getElementById('spec-filter')?.focus?.();return true;}
  if(a==='top-menu'){setTopMenu(!$('.topbar')?.classList.contains('menu-open'));return true;}
  if(a==='more-toggle'){const rail=$('.rail'),open=!rail.classList.contains('nav-open');rail.classList.toggle('nav-open',open);$('#nav-toggle').setAttribute('aria-expanded',String(open));b?.setAttribute?.('aria-expanded',String(open));return true;}
  if(a==='today-new'){startQuiz('all','new');return true;}
  return false;
}
function layoutInput(el){
  if(!el||el.id!=='spec-filter')return false;
  const q=String(el.value||'').trim();
  for(const li of document.querySelectorAll?.('#spec-panel li[data-spec-name]')||[])li.hidden=!!q&&!li.dataset.specName.includes(q);
  return true;
}
document.addEventListener('submit',e=>{
  const form=e.target;if(!form?.matches?.('[data-top-search-form]'))return;
  e.preventDefault();
  const input=form.querySelector('input');
  S.search=String(input?.value||'').trim();S.searchChapter='all';
  input?.blur?.();switchTab('notebook');
});

/* Exam schedule for the home page and the rail badge; ophthalmology only, read once per load. */
function loadExamSchedule(){
  if(examState!=='idle'||!tabAllowed('schedule')||typeof fetch!=='function')return;
  examState='loading';
  fetch('content/exam-schedule.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('schedule');return r.json();}).then(data=>{
    if(window.OphSchedule?.validate)window.OphSchedule.validate(data);
    else if(!data||!Array.isArray(data.hospitals))throw Error('schedule');
    examData=data;examState='ready';
  }).catch(()=>{examData=null;examState='error';}).then(()=>{if(S.tab==='today')render();else{const nav=$('#nav');if(nav)nav.innerHTML=navMarkup();}});
}
function examEvents(){
  if(!examData)return [];
  const today=taipeiDate(Date.now());
  return examData.hospitals.flatMap(h=>(h.events||[]).map(e=>({...e,hospitalId:h.id,hospitalName:h.name}))).filter(e=>typeof e.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99'));
}
function examDays(){
  const groups=new Map();
  for(const e of examEvents()){if(!EXAM_TYPES[e.type])continue;const k=e.hospitalId+'|'+e.date;if(!groups.has(k))groups.set(k,{date:e.date,name:e.hospitalName,events:[]});groups.get(k).events.push(e);}
  return [...groups.values()];
}
function examDetail(g){
  if(!g.events.some(e=>e.time))return [...new Set(g.events.filter(e=>e.type!=='checkin').map(e=>EXAM_TYPES[e.type]))].join('、')+'時間待通知';
  return g.events.filter(e=>e.time||e.type!=='checkin').map(e=>EXAM_TYPES[e.type]+(e.time?' '+e.time:'時間待通知')).join(' · ');
}

/* 今日: what to do now, built only from data the app already has. */
function todayStats(){
  const st=stats();
  return `<dl class="today-stats"><div><dt>選擇題已練習</dt><dd>${st.answered}<small> / ${D.questions.length}</small></dd></div><div><dt>待補強</dt><dd>${st.wrong}</dd></div><div><dt>口試已演練</dt><dd>${st.interviews}<small> / ${D.interview.length}</small></dd></div></dl>`;
}
function todayDeadlines(){
  const list=examEvents().filter(e=>e.type==='deadline'&&daysUntil(e.date)<=14);
  if(!list.length)return '';
  return `<div class="deadline-strip" role="note"><strong>報名截止</strong>${list.slice(0,4).map(e=>{const n=daysUntil(e.date);return `<span>${n===0?'今天':shortDate(e.date)}${e.time?' '+esc(e.time):''} · ${esc(e.hospitalName)} ${esc(e.title)}</span>`;}).join('')}</div>`;
}
function todayExams(){
  if(!tabAllowed('schedule'))return '';
  if(examState==='idle'||examState==='loading')return '<section class="exam-hero" aria-label="下一場甄試"><p class="exam-kicker">下一場甄試</p><p class="exam-when" role="status">正在讀取考試時程…</p></section>';
  const days=examDays();
  if(!days.length)return `<section class="exam-hero" aria-label="下一場甄試"><p class="exam-kicker">下一場甄試</p><h2>${examState==='error'?'目前無法讀取考試時程':'近期沒有已排定的甄試'}</h2><div class="exam-foot">${btn('完整考試時程','tab','schedule','exam-link')}</div></section>`;
  const [next,...rest]=days,n=daysUntil(next.date),place=next.events.find(e=>e.location)?.location;
  return `<section class="exam-hero" aria-labelledby="exam-next"><div class="exam-head"><div><p class="exam-kicker">下一場甄試</p><h2 id="exam-next">${esc(next.name)}</h2><p class="exam-when">${shortDate(next.date)} · ${esc(examDetail(next))}${place?' · '+esc(place):''}</p></div><p class="exam-count">${n===0?'<strong>今天</strong>':`<strong>${n}</strong><span>天後</span>`}</p></div>${rest.length?`<ol class="exam-list">${rest.slice(0,3).map(g=>{const d=daysUntil(g.date);return `<li><span class="exam-date">${shortDate(g.date)}</span><span class="exam-name"><strong>${esc(g.name)}</strong><span>${esc(examDetail(g))}</span></span><span class="exam-days">${d===0?'今天':d+' 天'}</span></li>`;}).join('')}</ol>`:''}<div class="exam-foot">${btn('完整考試時程','tab','schedule','exam-link')}<span class="small">時間以院方正式公告為準</span></div></section>`;
}
function todayPlanLine(){
  const plan=Array.isArray(D.plan)?D.plan:[],p=plan.find(x=>x.date===taipeiDate(Date.now())),ref=p||plan[plan.length-1];
  if(p&&Array.isArray(p.goals)&&p.goals.length)return `<p class="today-plan"><strong>今日計畫</strong>${esc(p.goals.join('；'))}</p>`;
  if(ref&&Array.isArray(ref.normalDayMinutes)&&Array.isArray(ref.onCallMinimumMinutes))return `<p class="today-plan">建議練習量：一般日 ${ref.normalDayMinutes.join('–')} 分鐘 · 值班日 ${ref.onCallMinimumMinutes.join('–')} 分鐘</p>`;
  return '';
}
function todayReview(){
  if(!tabAllowed('study')||(SPEC.id!=='oph'&&!D.questions.length))return '';
  const now=Date.now(),today=taipeiDate(now),st=stats();let due=0,later=0,weak=0;
  for(const [k,v] of Object.entries(entries)){
    if(!k.startsWith('study:srs:')||!v||typeof v!=='object')continue;
    const at=Date.parse(v.plan?.dueAt);
    if(Number.isFinite(at)){if(at<=now)due++;else if(taipeiDate(at)===today)later++;}
    if(v.attempt?.correct===false||['again','hard'].includes(v.plan?.rating))weak++;
  }
  return `<section class="card today-review" aria-labelledby="today-review-title"><div class="today-card-head"><h2 id="today-review-title">今日複習</h2><span class="small">台北時間</span></div><div class="today-counts"><div><span>現在到期</span><strong>${due}</strong></div><div><span>今日稍後</span><strong>${later}</strong></div><div><span>弱項</span><strong>${weak}</strong></div></div><p class="today-note">${due?`有 ${due} 題到期：先清掉，再練新題。`:'目前沒有到期題目，可以先練新題或錯題。'}</p><div class="today-actions">${btn(due?'開始今日複習':'打開複習清單','tab','study','primary')}${st.wrong?btn('錯題再練 '+st.wrong,'wrong'):btn('從新題開始','today-new')}</div>${todayPlanLine()}</section>`;
}
function todayReading(){
  const t=D.topics.find(x=>x.id===S.learn&&x.chapter)||D.topics.find(x=>x.chapter)||D.topics[0];
  if(!t)return '';
  const started=Object.keys(entries).length>0,qs=topicQuestions(t),done=qs.filter(q=>entries['q:'+q.id]).length;
  return `<article class="card home-card"><p class="today-kicker">${started?'繼續閱讀':'從這裡開始'} · 章節教材</p><h3>${t.chapter?String(t.chapter).padStart(2,'0')+' ':''}${esc(t.title)}</h3><p class="today-summary">${esc(t.summary||'')}</p>${qs.length?`<p class="small">本章已答 ${done} / ${qs.length} 題</p>`:''}<div class="today-actions">${btn(started?'繼續閱讀':'開始閱讀','learn-topic',t.id,'primary')}${qs.length?btn('做本章 '+qs.length+' 題','practice-topic',t.id):''}</div></article>`;
}
function todayQuiz(){
  if(!D.questions.length)return '';
  const cur=question(),q=cur||D.questions[0],st=stats();
  return `<article class="card home-card"><p class="today-kicker">${cur?`繼續筆試 · 第 ${S.qi+1} / ${S.ids.length} 題`:'筆試練習'}</p><h3>${esc(shortTitle(q.topicId))}</h3><p class="today-summary clamp">${esc(q.stem)}</p><p class="small">已練習 ${st.answered} / ${D.questions.length} · 待補強 ${st.wrong}</p><div class="today-actions">${cur?btn('繼續作答','tab','quiz','primary'):btn('開始練習','all','','primary')}${btn('換主題','tab','quiz')}</div></article>`;
}
function todayInterview(){
  const i=currentInterview();if(!i)return '';
  const st=stats();
  return `<article class="card home-card"><p class="today-kicker">面試演練 · ${i.clinical?'臨床口試':'通用面試'}</p><h3>${esc(i.title)}</h3><p class="today-summary clamp">${esc(i.question)}</p><p class="small">目標 ${i.durationSeconds} 秒 · 已演練 ${st.interviews} / ${D.interview.length}</p><div class="today-actions">${btn('開始計時練習','interview',i.id,'primary')}${btn('換一題','tab','interview')}</div></article>`;
}
function todayChapters(){
  const ch=D.topics.filter(t=>t.chapter);if(!ch.length)return '';
  return `<section class="today-chapters" aria-labelledby="today-chapters-title"><div class="today-section-head"><h2 id="today-chapters-title">${ch.length} 章進度</h2>${btn('全部章節教材','tab','notebook','small subtle')}</div><div class="chapter-tiles">${ch.map(t=>{const qs=topicQuestions(t),done=qs.filter(q=>entries['q:'+q.id]).length,pct=qs.length?Math.round(done/qs.length*100):0;return `<button class="chapter-tile" data-action="learn-topic" data-value="${esc(t.id)}"><span class="tile-no">${String(t.chapter).padStart(2,'0')}</span><span class="tile-name">${esc(shortTitle(t.id))}</span><span class="tile-meta">${qs.length?`${done} / ${qs.length} 題`:'閱讀'}</span><span class="tile-bar" aria-hidden="true"><span style="width:${pct}%"></span></span></button>`;}).join('')}</div></section>`;
}
function todayPage(){
  loadExamSchedule();
  const date=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'long',day:'numeric',weekday:'long'}).format(new Date());
  const has=D.topics.length||D.questions.length||D.interview.length;
  const head=`<div class="heading today-heading"><div><p class="today-date">${esc(date)}</p><h1>今日</h1><p class="subtitle">到期複習、下一場甄試、上次讀到的地方，都在這一頁。</p></div>${has?todayStats():''}</div>`;
  if(!has)return head+pendingCard('今日');
  return head+todayDeadlines()+`<div class="today-row">${todayExams()}${todayReview()}</div><div class="today-continue">${todayReading()}${todayQuiz()}${todayInterview()}</div>`+todayChapters();
}
/* layout-shell:end */
