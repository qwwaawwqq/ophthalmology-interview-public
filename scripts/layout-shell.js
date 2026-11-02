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
  if(a==='today-new'){quizBankMode='core';startQuiz('all','new');return true;}
  if(a==='quiz-bank'||a==='quiz-bank-open'){return setQuizBankMode(v);}
  if(a==='quiz-adv-answer'){return handleQuizAdvAnswer(v);}
  if(a==='quiz-adv-reveal'){quizAdvRevealed.add(v);render();return true;}
  if(a==='quiz-adv-retry'){const q=quizAdvFindQuestion(v);if(q){delete entries[quizAdvKey(q)];changed();}quizAdvRevealed.delete(v);render();return true;}
  if(a==='quiz-adv-shuffle'){quizAdvSeed=(quizAdvSeed+1)||1;render();return true;}
  if(a==='quiz-adv-reset-shown'){for(const q of quizAdvShownQuestions()){delete entries[quizAdvKey(q)];quizAdvRevealed.delete(q.id);}changed();render();return true;}
  if(a==='quiz-adv-more'){quizAdvLimit+=25;render();return true;}
  if(a==='quiz-hard-timed'){switchTab('advanced');window.OphAdvanced?.action?.('advanced-start');return true;}
  if(a==='quiz-hard-deepdives'){switchTab('advanced');window.OphAdvanced?.action?.('advanced-home');return true;}
  if(a==='quiz-adv-open-source'){if(window.history?.replaceState)window.history.replaceState(null,'',/^bcsc-s/.test(v)?'#textbook-'+v:'#textbook-extra-'+v);switchTab('textbook');return true;}
  return false;
}
function layoutChange(el){
  if(!el)return false;
  if(el.id==='quiz-adv-volume'){quizAdvVolume=el.value||'all';quizAdvLimit=25;render();return true;}
  if(el.id==='quiz-adv-domain'){quizAdvDomain=el.value||'all';quizAdvLimit=25;render();return true;}
  if(el.id==='quiz-adv-status'){quizAdvStatus=el.value||'all';quizAdvLimit=25;render();return true;}
  return false;
}
function layoutInput(el){
  if(!el)return false;
  if(el.id==='quiz-adv-search'){quizAdvSearch=String(el.value||'');quizAdvLimit=25;render();return true;}
  if(el.id!=='spec-filter')return false;
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

/* Advanced Question Banks in #quiz (Issue #148): BCSC S01-S13 (540), Hard Clinical Reasoning (36+), Extra Cases (120) */
const QUIZ_BANK_MODES=['core','bcsc','hard','extra','all-advanced'];
const BCSC_VOLUMES=[
  ['bcsc-s01','S01','Update on General Medicine'],
  ['bcsc-s02','S02','Fundamentals & Principles'],
  ['bcsc-s03','S03','Clinical Optics & Vision Rehab'],
  ['bcsc-s04','S04','Ophthalmic Pathology & Intraocular Tumors'],
  ['bcsc-s05','S05','Neuro-Ophthalmology'],
  ['bcsc-s06','S06','Pediatric Ophthalmology & Strabismus'],
  ['bcsc-s07','S07','Oculofacial Plastic & Orbital Surgery'],
  ['bcsc-s08','S08','External Disease & Cornea'],
  ['bcsc-s09','S09','Uveitis & Ocular Inflammation'],
  ['bcsc-s10','S10','Glaucoma'],
  ['bcsc-s11','S11','Lens & Cataract'],
  ['bcsc-s12','S12','Retina & Vitreous'],
  ['bcsc-s13','S13','Refractive Surgery']
];
const HARD_DOMAINS=[
  ['glaucoma','青光眼'],
  ['cornea-uveitis','角膜與眼炎'],
  ['retina','視網膜'],
  ['neuro-pupils','神經眼科與瞳孔'],
  ['peds-strabismus','兒童與斜視'],
  ['optics-biometry','光學與生物測量'],
  ['orbit-trauma','眼眶與外傷'],
  ['diagnostics-systemic','診斷與全身病']
];
let quizBankMode='core',quizAdvVolume='all',quizAdvDomain='all',quizAdvStatus='all',quizAdvSearch='',quizAdvLimit=25,quizAdvSeed=0;
const quizAdvRevealed=new Set();
const quizAdvCache={bcsc:null,bcscState:'idle',hard:null,hardState:'idle',extra:null,extraState:'idle'};

function quizAdvKey(q){return (q.bankKind==='bcsc'||/^bcsc-s/.test(q.id)?'textbook:question:':'textbook:extra-question:')+q.id;}
function quizAdvRecord(q){const r=entries[quizAdvKey(q)];return r&&Number.isInteger(r.choice)&&r.choice>=0&&r.choice<=3?r:null;}
function loadQuizAdvBcsc(){
  if(quizAdvCache.bcscState==='loading'||quizAdvCache.bcscState==='ready'||typeof fetch!=='function')return;
  quizAdvCache.bcscState='loading';
  fetch('content/textbook-manifest.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('manifest');return r.json();}).then(m=>{
    const books=Array.isArray(m?.books)&&m.books.length?m.books:BCSC_VOLUMES.map(([bookId,,title],i)=>({bookId,section:i+1,title,file:`content/textbook-depth/${bookId}.json`}));
    return Promise.all(books.map(b=>fetch(b.file||`content/textbook-depth/${b.bookId}.json`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error(b.bookId);return r.json();}).then(data=>{
      const chMap=new Map((data.chapters||b.chapters||[]).map(c=>[c.id,c.title]));
      const sec=String(b.section||b.bookId.slice(6)).padStart(2,'0');
      const shortT=BCSC_VOLUMES.find(x=>x[0]===b.bookId)?.[2]||b.title||data.source?.title||b.bookId;
      return (data.questions||[]).map(q=>({...q,bankKind:'bcsc',bookId:b.bookId,bookSection:'S'+sec,bookTitle:shortT,edition:data.source?.edition||m.edition||'2024–2025',chapterTitle:(q.chapterIds||[]).map(cid=>chMap.get(cid)).filter(Boolean)[0]||''}));
    })));
  }).then(lists=>{quizAdvCache.bcsc=lists.flat();quizAdvCache.bcscState='ready';}).catch(()=>{quizAdvCache.bcscState='error';}).then(()=>{if(S.tab==='quiz')render();});
}
function loadQuizAdvHard(){
  if(quizAdvCache.hardState==='loading'||quizAdvCache.hardState==='ready'||typeof fetch!=='function')return;
  quizAdvCache.hardState='loading';
  fetch('content/textbook-depth/advanced-practice.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('hard');return r.json();}).then(data=>{
    const labels=data?.domainLabels||Object.fromEntries(HARD_DOMAINS);
    quizAdvCache.hard=(data?.questions||[]).map(q=>{const vol=BCSC_VOLUMES.find(x=>x[0]===q.bookId);return {...q,bankKind:'hard',bookSection:vol?vol[1]:String(q.bookId||'').replace('bcsc-s','S'),bookTitle:vol?vol[2]:(q.bookId||''),domainLabel:labels[q.domain]||q.domain||'',edition:'2025-2026'};});
    quizAdvCache.hardState='ready';
  }).catch(()=>{quizAdvCache.hardState='error';}).then(()=>{if(S.tab==='quiz')render();});
}
function loadQuizAdvExtra(){
  if(quizAdvCache.extraState==='loading'||quizAdvCache.extraState==='ready'||typeof fetch!=='function')return;
  quizAdvCache.extraState='loading';
  fetch('content/textbook-depth/additional-practice.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('extra');return r.json();}).then(data=>{
    quizAdvCache.extra=(data?.questions||[]).map(q=>{const vol=BCSC_VOLUMES.find(x=>x[0]===q.bookId);return {...q,bankKind:'extra',bookSection:vol?vol[1]:String(q.bookId||'').replace('bcsc-s','S'),bookTitle:vol?vol[2]:(q.bookId||''),edition:'2025-2026'};});
    quizAdvCache.extraState='ready';
  }).catch(()=>{quizAdvCache.extraState='error';}).then(()=>{if(S.tab==='quiz')render();});
}
function ensureQuizAdvLoaded(mode){
  if(SPEC.id!=='oph')return;
  if(mode==='bcsc'||mode==='all-advanced')loadQuizAdvBcsc();
  if(mode==='hard'||mode==='all-advanced')loadQuizAdvHard();
  if(mode==='extra'||mode==='all-advanced')loadQuizAdvExtra();
}
function setQuizBankMode(mode){
  if(SPEC.id!=='oph'||!QUIZ_BANK_MODES.includes(mode))return false;
  quizBankMode=mode;quizAdvLimit=25;
  if(mode!=='core')ensureQuizAdvLoaded(mode);
  if(S.tab!=='quiz')switchTab('quiz');else render();
  return true;
}
window.OphQuizBank={getMode(){return quizBankMode;},setMode(mode){return setQuizBankMode(mode);}};

function quizAdvPool(mode=quizBankMode){
  if(mode==='bcsc')return quizAdvCache.bcsc||[];
  if(mode==='hard')return quizAdvCache.hard||[];
  if(mode==='extra')return quizAdvCache.extra||[];
  if(mode==='all-advanced')return [...(quizAdvCache.bcsc||[]),...(quizAdvCache.hard||[]),...(quizAdvCache.extra||[])];
  return [];
}
function quizAdvFindQuestion(id){
  return quizAdvPool('all-advanced').find(q=>q.id===id)||null;
}
function handleQuizAdvAnswer(val){
  const [id,rawIdx]=String(val||'').split('|'),choice=Number(rawIdx);
  const q=quizAdvFindQuestion(id);
  if(!q||!Number.isInteger(choice)||choice<0||choice>3)return true;
  const kind=q.bankKind==='bcsc'||/^bcsc-s/.test(q.id)?'question':'extra-question';
  const edition=q.edition||'2025-2026';
  try{
    if(window.OphTextbookBridge?.write)window.OphTextbookBridge.write(kind,q.id,{choice,revealed:true,edition});
    else put('textbook:'+kind+':'+q.id,{version:1,choice,revealed:true,confidence:0,edition});
  }catch(_){
    put('textbook:'+kind+':'+q.id,{version:1,choice,revealed:true,confidence:0,edition});
  }
  const isCorrect=choice===q.correctIndex;
  window.OphStudy?.commit?.(kind==='question'?'book':'extra',q.id,isCorrect);
  window.OphStudy?.recordExtraQuestionAttempt?.(q.id,isCorrect);
  quizAdvRevealed.add(q.id);
  render();
  return true;
}
function quizAdvStatsFor(mode){
  const list=quizAdvPool(mode);
  if(list.length){
    let answered=0,correct=0,wrong=0;
    for(const q of list){const r=quizAdvRecord(q);if(r){answered++;if(r.choice===q.correctIndex)correct++;else wrong++;}}
    return {answered,correct,wrong,total:list.length};
  }
  const keys=Object.keys(entries);
  const bcscCnt=keys.filter(k=>/^textbook:question:bcsc-s/.test(k)&&entries[k]&&Number.isInteger(entries[k].choice)).length;
  const hardCnt=keys.filter(k=>/^textbook:extra-question:extra-20261022-/.test(k)&&entries[k]&&Number.isInteger(entries[k].choice)).length;
  const extraCnt=keys.filter(k=>/^textbook:extra-question:extra-20261020-/.test(k)&&entries[k]&&Number.isInteger(entries[k].choice)).length;
  if(mode==='bcsc')return {answered:bcscCnt,correct:0,wrong:0,total:540};
  if(mode==='hard')return {answered:hardCnt,correct:0,wrong:0,total:36};
  if(mode==='extra')return {answered:extraCnt,correct:0,wrong:0,total:120};
  return {answered:bcscCnt+hardCnt+extraCnt,correct:0,wrong:0,total:696};
}
function quizAdvFilteredQuestions(){
  let list=quizAdvPool(quizBankMode);
  if(quizAdvVolume!=='all')list=list.filter(q=>q.bookId===quizAdvVolume);
  if((quizBankMode==='hard'||quizBankMode==='all-advanced')&&quizAdvDomain!=='all')list=list.filter(q=>q.domain===quizAdvDomain);
  if(quizAdvStatus!=='all'){
    list=list.filter(q=>{
      const r=quizAdvRecord(q);
      if(quizAdvStatus==='unanswered')return !r;
      if(quizAdvStatus==='wrong')return !!r&&r.choice!==q.correctIndex;
      if(quizAdvStatus==='correct')return !!r&&r.choice===q.correctIndex;
      return true;
    });
  }
  const qStr=quizAdvSearch.trim().toLocaleLowerCase();
  if(qStr){
    const tokens=qStr.split(/\s+/).filter(Boolean);
    list=list.filter(q=>{
      const hay=[q.id,q.stem,q.explanation,q.testConcept,q.chapterTitle,q.bookSection,q.bookTitle,q.domainLabel,q.decisiveDiscriminator,q.counterfactual,...(q.options||[]).map(o=>typeof o==='string'?o:(o.text+' '+(o.rationale||'')+' '+(o.whenTrue||'')))].filter(Boolean).join(' ').toLocaleLowerCase();
      return tokens.every(t=>hay.includes(t));
    });
  }
  if(quizAdvSeed){
    const copy=[...list];
    let s=(quizAdvSeed*2654435761)>>>0;
    for(let i=copy.length-1;i>0;i--){s=(Math.imul(s,1664525)+1013904223)>>>0;const j=s%(i+1);[copy[i],copy[j]]=[copy[j],copy[i]];}
    return copy;
  }
  return list;
}
function quizAdvShownQuestions(){
  return quizAdvFilteredQuestions().slice(0,quizAdvLimit);
}
function quizBankSwitcherMarkup(){
  if(SPEC.id!=='oph')return '';
  const items=[
    ['core',`共筆與歷屆（${D.questions.length} 題）`,'基礎必考與歷屆回憶題'],
    ['bcsc','BCSC 第 1–13 卷（540 題）','AAO BCSC 二至三階臨床推理 · 四選項條件反轉'],
    ['hard','Hard｜多步臨床推理與限時模考','衝突線索、檢查限制與治療先後（36+ 題）'],
    ['extra','自編陌生病例（120 題）','跨卷臨床情境題'],
    ['all-advanced','進階題庫全混合（696+ 題）','BCSC 540 題 + Hard 多步推理 + 自編陌生病例一次刷']
  ];
  return `<nav class="quiz-bank-switcher" data-quiz-bank-switcher aria-label="筆試題庫切換">${items.map(([id,title,sub])=>{const on=quizBankMode===id;return `<button type="button" class="quiz-bank-btn${on?' is-active':''}" data-action="quiz-bank" data-value="${id}" data-quiz-bank="${id}" aria-pressed="${on}"><strong>${esc(title)}</strong><span>${esc(sub)}</span></button>`;}).join('')}</nav>`;
}
function quizCoreAdvBannerMarkup(){
  if(SPEC.id!=='oph')return '';
  const st=stats(),bSt=quizAdvStatsFor('bcsc'),hSt=quizAdvStatsFor('hard'),eSt=quizAdvStatsFor('extra');
  const doneCore=st.answered>=500;
  return `<section class="card quiz-adv-banner${doneCore?' is-complete':''}" data-quiz-adv-banner aria-label="進階題庫直通車"><div class="quiz-adv-banner-body"><div><p class="eyebrow">${doneCore?`基礎題庫已完成 ${st.answered} / ${D.questions.length} 題 · 進階挑戰`:'進階題庫直通車 · 免離開筆試練習'}</p><h2>${doneCore?'恭喜刷完基礎題庫！立即進入 BCSC 540 題與 Hard 多步臨床推理':'隨時切換 BCSC 第 1–13 卷、Hard 多步推理與自編陌生病例'}</h2><p class="small">BCSC 1–13 卷已練 ${bSt.answered} / ${bSt.total} 題 · Hard 多步推理已練 ${hSt.answered} / ${hSt.total} 題 · 自編陌生病例已練 ${eSt.answered} / ${eSt.total} 題</p></div><div class="quiz-adv-banner-actions">${btn('練 BCSC 540 題','quiz-bank','bcsc','primary small')}${btn('練 Hard 多步推理','quiz-bank','hard','small')}${btn('練自編陌生病例 120 題','quiz-bank','extra','small')}${btn('進階 696 題全混合','quiz-bank','all-advanced','small subtle')}</div></div></section>`;
}
function quizAdvPdfBadge(q){
  const refs=q.sourceRefs||[];
  const pages=[...new Set(refs.flatMap(r=>r.pdfPages||[]))].filter(Boolean);
  const sec=q.bookSection||'BCSC';
  return pages.length?`BCSC ${sec} PDF p.${pages.join(', ')}`:`BCSC ${sec}`;
}
function quizAdvSourceText(q){
  const refs=q.sourceRefs||[];
  if(!refs.length)return `${q.bookSection||''} ${q.bookTitle||''}`.trim();
  return refs.map(r=>`${q.bookSection||r.bookId||''}${r.chapterHeading?' · '+r.chapterHeading:''}${(r.pdfPages||[]).length?' · PDF p.'+r.pdfPages.join('、'):''}`).join('；');
}
function quizAdvCardMarkup(q,idx,total){
  const rec=quizAdvRecord(q),hasChoice=!!rec,isRevealed=(rec&&(rec.revealed||Number.isInteger(rec.choice)))||quizAdvRevealed.has(q.id);
  const bankLabel=q.bankKind==='hard'?`Hard 多步推理 · ${q.domainLabel||q.bookSection}`:q.bankKind==='extra'?`自編病例 · ${q.bookSection} ${q.bookTitle}`:`BCSC ${q.bookSection} · ${q.bookTitle}`;
  const diffLabel=q.bankKind==='hard'||q.difficulty==='advanced'?'Hard 多步臨床推理':'BCSC 二至三階';
  const concept=q.testConcept||q.chapterTitle||(q.sourceNumber?`原書題號 #${q.sourceNumber}`:'');
  const hasSteps=q.decisiveDiscriminator||q.counterfactual||(Array.isArray(q.reasoningSteps)&&q.reasoningSteps.length);
  const closestOpt=Number.isInteger(q.closestDistractorIndex)&&q.options?.[q.closestDistractorIndex];
  const closestText=closestOpt?(typeof closestOpt==='string'?closestOpt:closestOpt.text):'';
  return `<article class="card question-card quiz-adv-card" data-question-id="${esc(q.id)}" data-bank-kind="${esc(q.bankKind)}"><div class="question-top quiz-adv-top"><div class="quiz-adv-badges"><span class="tag quiz-badge-${esc(q.bankKind)}">${esc(bankLabel)}</span><span class="tag quiz-badge-diff">${esc(diffLabel)}</span>${concept?`<span class="quiz-adv-concept">${esc(concept)}</span>`:''}<span class="quiz-adv-pages">${esc(quizAdvPdfBadge(q))}</span></div><span>第 ${String(idx+1).padStart(2,'0')} / ${String(total).padStart(2,'0')} 題</span></div><div class="question-body"><h2 class="question-stem" tabindex="-1">${esc(q.stem)}</h2><div class="options quiz-adv-options" role="group" aria-label="請選擇一個答案">${(q.options||[]).map((opt,i)=>{const txt=typeof opt==='string'?opt:opt.text;const isCorr=i===q.correctIndex,isSel=hasChoice&&rec.choice===i;const cls=isRevealed?(isCorr?'correct':isSel?'wrong':''):(isSel?'selected':'');return `<button type="button" class="option quiz-adv-option ${cls}" data-action="quiz-adv-answer" data-value="${esc(q.id)}|${i}" aria-pressed="${isSel}"><span class="letter">${'ABCD'[i]}</span><span class="option-text">${esc(txt)}</span>${isRevealed&&isCorr?'<span class="option-status">✓ 正解</span>':isRevealed&&isSel?'<span class="option-status">你的答案</span>':''}</button>`;}).join('')}</div><div class="question-actions quiz-adv-actions">${btn(isRevealed?'重做本題':'直接看解析',isRevealed?'quiz-adv-retry':'quiz-adv-reveal',q.id,isRevealed?'small subtle':'small')}${btn('原書章節對照','quiz-adv-open-source',q.id,'small subtle')}</div>${isRevealed?`<section class="feedback quiz-adv-feedback ${hasChoice&&rec.choice!==q.correctIndex?'is-wrong':''}" aria-label="作答解析"><div class="feedback-head" role="status">${hasChoice?(rec.choice===q.correctIndex?'✓ 答對了':'✗ 這一題值得再練一次'):'解析檢閱'} · 正確答案 ${'ABCD'[q.correctIndex]}</div><div class="feedback-content"><div class="reason-step"><span class="step-number">1</span><div><h3>核心臨床推理與解析</h3><p class="preline">${esc(q.explanation)}</p></div></div>${hasSteps?`<div class="quiz-adv-reasoning" data-quiz-adv-reasoning><h3>多步臨床推理與條件反轉</h3>${q.decisiveDiscriminator?`<p><strong>關鍵鑑別點：</strong>${esc(q.decisiveDiscriminator)}</p>`:''}${closestText?`<p><strong>最接近干擾項（${'ABCD'[q.closestDistractorIndex]}）：</strong>${esc(closestText)}</p>`:''}${Array.isArray(q.reasoningSteps)&&q.reasoningSteps.length?`<div class="quiz-adv-steps"><strong>多步推理步驟：</strong><ol>${q.reasoningSteps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>`:''}${q.counterfactual?`<p><strong>條件反轉 Counterfactual：</strong>${esc(q.counterfactual)}</p>`:''}</div>`:''}<div class="quiz-adv-rationales" data-quiz-adv-rationales><h3>四選項逐一解析與條件反轉（Rationale &amp; When True）</h3><ol class="quiz-rationale-list">${(q.options||[]).map((opt,i)=>{const txt=typeof opt==='string'?opt:opt.text;const rat=opt?.rationale||(Array.isArray(q.rationales)?q.rationales[i]:'');const wt=opt?.whenTrue||(Array.isArray(q.whenTrue)?q.whenTrue[i]:'');return `<li class="${i===q.correctIndex?'is-correct':'is-distractor'}"><div class="rationale-head"><strong>${'ABCD'[i]} · ${i===q.correctIndex?'✓ 本題正解':'干擾選項'}</strong><span>${esc(txt)}</span></div>${rat?`<p class="rationale-body"><b>為什麼${i===q.correctIndex?'選':'不選'}：</b>${esc(rat)}</p>`:''}${wt?`<p class="rationale-whentrue"><b>條件反轉（何時成立）：</b>${esc(wt)}</p>`:''}</li>`;}).join('')}</ol></div>${window.OphStudy?.ratingHtml?.(q.bankKind==='bcsc'?'book':'extra',q.id)||''}<p class="small quiz-adv-source">來源頁碼：${esc(quizAdvSourceText(q))}</p></div></section>`:''}</div></article>`;
}
function quizAdvPageMarkup(){
  ensureQuizAdvLoaded(quizBankMode);
  const st=quizAdvStatsFor(quizBankMode);
  const titles={bcsc:['BCSC 01–13 / 540 QUESTIONS','BCSC 第 1–13 卷進階題庫','AAO BCSC 二至三階臨床推理題，逐選項附為什麼不選與條件反轉（whenTrue）解析。'],hard:['HARD / MULTISTEP CLINICAL REASONING','Hard｜多步臨床推理與限時模考','專練衝突線索、檢查限制與治療先後順序；可單題深練或啟動 12 題／18 分鐘限時盲測。'],extra:['EXTRA / 120 UNFAMILIAR CASES','自編陌生病例題庫（120 題）','把已讀過的 BCSC 概念換成全新臨床病史線索，檢驗跨章節鑑別能力。'],'all-advanced':['ALL ADVANCED / 696+ QUESTIONS','進階題庫全混合（BCSC + Hard + 自編病例）','整合 BCSC 1–13 卷 540 題、Hard 多步推理與自編陌生病例 120 題一次刷齊。']};
  const [kicker,title,sub]=titles[quizBankMode]||titles.bcsc;
  const head=heading(kicker,title,sub,`<div class="heading-stat"><strong>${st.answered}<i> / ${st.total}</i></strong><span>題已練習<br>${st.wrong} 題待補強</span></div>`);
  const hardHero=quizBankMode==='hard'||quizBankMode==='all-advanced'?`<section class="card quiz-hard-hero" data-quiz-hard-actions aria-label="Hard 限時模考與深度單元"><div class="quiz-hard-hero-body"><div><p class="eyebrow">HARD CLINICAL REASONING · 限時模考與決策單元</p><h2>挑戰 12 題／18 分鐘限時盲測，或先讀 8 大深度鑑別決策單元</h2><p class="small">限時盲測交卷前不揭露正誤；深度鑑別單元整理相似表現、檢查限制與治療分歧。</p></div><div class="quiz-hard-hero-actions">${btn('啟動 12 題／18 分鐘限時盲測','quiz-hard-timed','','primary')}${btn('開啟 8 大深度鑑別單元與原書對照','quiz-hard-deepdives','')}</div></div></section>`:'';
  const volOptions=BCSC_VOLUMES.map(([id,code,name])=>`<option value="${id}" ${quizAdvVolume===id?'selected':''}>${code} · ${esc(name)}</option>`).join('');
  const domSelect=quizBankMode==='hard'||quizBankMode==='all-advanced'?`<label class="small" for="quiz-adv-domain">領域</label><select class="select" id="quiz-adv-domain" data-quiz-adv-filter="domain" aria-label="臨床領域"><option value="all">全部領域</option>${HARD_DOMAINS.map(([id,name])=>`<option value="${id}" ${quizAdvDomain===id?'selected':''}>${esc(name)}</option>`).join('')}</select>`:'';
  const toolbar=`<div class="toolbar quiz-toolbar quiz-adv-toolbar" data-quiz-adv-toolbar><label class="small" for="quiz-adv-volume">卷別</label><select class="select" id="quiz-adv-volume" data-quiz-adv-filter="volume" aria-label="BCSC 卷別"><option value="all">全部卷別 S01–S13</option>${volOptions}</select>${domSelect}<label class="small" for="quiz-adv-status">狀態</label><select class="select" id="quiz-adv-status" data-quiz-adv-filter="status" aria-label="作答狀態"><option value="all" ${quizAdvStatus==='all'?'selected':''}>全部狀態</option><option value="unanswered" ${quizAdvStatus==='unanswered'?'selected':''}>尚未作答</option><option value="wrong" ${quizAdvStatus==='wrong'?'selected':''}>待補強（答錯）</option><option value="correct" ${quizAdvStatus==='correct'?'selected':''}>已答對</option></select><input class="input quiz-adv-search" id="quiz-adv-search" type="search" value="${esc(quizAdvSearch)}" placeholder="搜尋題幹、考點、解析或頁碼…" aria-label="搜尋進階題庫"><button type="button" class="btn subtle small" id="qShuffle" data-action="quiz-adv-shuffle">隨機重排</button><button type="button" class="btn subtle small" id="qResetShown" data-action="quiz-adv-reset-shown">重設本頁作答</button></div>`;
  const isLoading=(quizBankMode==='bcsc'&&quizAdvCache.bcscState==='loading')||(quizBankMode==='hard'&&quizAdvCache.hardState==='loading')||(quizBankMode==='extra'&&quizAdvCache.extraState==='loading')||(quizBankMode==='all-advanced'&&!quizAdvPool('all-advanced').length&&(quizAdvCache.bcscState==='loading'||quizAdvCache.hardState==='loading'||quizAdvCache.extraState==='loading'));
  const filtered=quizAdvFilteredQuestions(),shown=filtered.slice(0,quizAdvLimit);
  let listHtml='';
  if(isLoading&&!filtered.length){
    listHtml='<div class="card empty"><p role="status">正在載入進階題庫…</p></div>';
  }else if(!filtered.length){
    listHtml=`<div class="card empty"><h2>目前篩選條件下沒有符合的題目</h2><p>請切換卷別、狀態或清除搜尋關鍵字。</p></div>`;
  }else{
    listHtml=shown.map((q,i)=>quizAdvCardMarkup(q,i,filtered.length)).join('')+(filtered.length>shown.length?`<div class="quiz-adv-more"><button type="button" class="btn primary" data-action="quiz-adv-more">載入更多題目（已顯示 ${shown.length} / ${filtered.length} 題，顯示下 25 題）</button></div>`:'');
  }
  return head+quizBankSwitcherMarkup()+hardHero+toolbar+`<div id="quizList" class="quiz-adv-list" data-quiz-adv-list>${listHtml}</div>`;
}
function quizPage(){
  if(SPEC.id!=='oph')return quiz();
  if(quizBankMode!=='core')return quizAdvPageMarkup();
  const base=quiz();
  const splitIdx=base.indexOf('<div class="grid">');
  if(splitIdx<0)return quizBankSwitcherMarkup()+base;
  return base.slice(0,splitIdx)+quizBankSwitcherMarkup()+quizCoreAdvBannerMarkup()+base.slice(splitIdx);
}

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
  const now=Date.now(),today=taipeiDate(now),st=stats(),bank=new Set(D.questions.map(q=>q.id));let due=0,later=0,weak=0;
  for(const [k,v] of Object.entries(entries)){
    if(!k.startsWith('study:srs:')||!v||typeof v!=='object')continue;
    if(k.startsWith('study:srs:shared:')&&!bank.has(k.slice(17)))continue;// saved review for a question no longer in the bank
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
  const advLinks=SPEC.id==='oph'?`<div class="today-quiz-banks" data-today-quiz-banks aria-label="進階題庫快速啟動">${btn('BCSC 1–13 卷（540 題）','quiz-bank-open','bcsc','small subtle')}${btn('Hard 多步臨床推理','quiz-bank-open','hard','small subtle')}${btn('自編陌生病例（120 題）','quiz-bank-open','extra','small subtle')}</div>`:'';
  return `<article class="card home-card"><p class="today-kicker">${cur?`繼續筆試 · 第 ${S.qi+1} / ${S.ids.length} 題`:'筆試練習'}</p><h3>${esc(shortTitle(q.topicId))}</h3><p class="today-summary clamp">${esc(q.stem)}</p><p class="small">已練習 ${st.answered} / ${D.questions.length} · 待補強 ${st.wrong}</p><div class="today-actions">${cur?btn('繼續作答','tab','quiz','primary'):btn('開始練習','all','','primary')}${btn('換主題','tab','quiz')}</div>${advLinks}</article>`;
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
