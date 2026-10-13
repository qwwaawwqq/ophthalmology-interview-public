/* practice-ui:start */
// PBL cases, clinical workflows and saved links. Injected by scripts/apply-enrichment.py.
Object.assign(S,{pbl:D.pbl?.cases?.[0]?.id||'',pblStage:Object.create(null),workflow:D.workflows?.workflows?.[0]?.id||'',wfMode:'read',wfShuffle:Object.create(null),wfPicked:Object.create(null),wfChecked:Object.create(null),linkDraft:{title:'',url:'',note:'',topicId:''},linkEdit:null,linkFilter:''});
const APP_URLS=['https://qwwaawwqq.github.io/ophthalmology-interview-public/'];
const LINK_LIMIT=500;
let practiceHashReady=false,resourceCache=null;
function pblCases(){return D.pbl?.cases||[];}
function wfList(){return D.workflows?.workflows||[];}
function pblCase(){return pblCases().find(c=>c.id===S.pbl)||pblCases()[0];}
function wfCurrent(){return wfList().find(w=>w.id===S.workflow)||wfList()[0];}
function wfCategory(w){return (D.workflows?.categories||[]).find(c=>c.id===w.category)||{id:w.category,label:w.category};}
function topicLabel(t){return (t.chapter?'共筆 '+String(t.chapter).padStart(2,'0')+' · ':'')+t.title.split('：')[0];}
function allResources(){if(!resourceCache){resourceCache=new Map();for(const c of Object.values(D.enrichment?.chapters||{}))for(const r of c.resources||[])resourceCache.set(r.id,r);}return resourceCache;}
function practiceSources(ids){const items=(ids||[]).map(id=>allResources().get(id)).filter(r=>r&&/^https:\/\//.test(r.url));return items.length?`<details class="refs"><summary>延伸來源</summary><ul>${items.map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><span class="small"> · ${esc(r.provider)}</span></li>`).join('')}</ul></details>`:'';}
function practiceRelated(topicIds,extra=''){return `<div class="practice-related"><span class="small">相關內容</span>${(topicIds||[]).filter(id=>D.topics.some(t=>t.id===id)).map(id=>btn(esc(shortTitle(id)),'learn-topic',id,'small subtle')).join('')}${extra}</div>`;}

/* Routes: every view and lesson anchor can be expressed as a hash so it can be saved and shared. */
function anchorValid(t,target){if(t.chapter&&typeof coverageTarget==='function'&&chapterCoverage(t))return coverageTarget(t,target);const m=target.match(/^section-(\d+)$/);return !!m&&Number(m[1])<t.sections.length;}
function parseRoute(hash){
  if(typeof hash!=='string')return null;
  const h=hash.trim();let m;
  if((m=h.match(/^#([a-z0-9-]+?)-(section-\d+|coverage(?:-[a-z][a-z0-9-]*)?|u[1-3])$/))){const t=D.topics.find(x=>x.id===m[1]);if(t&&anchorValid(t,m[2]))return {kind:'anchor',topicId:t.id,target:m[2],hash:h};}
  if((m=h.match(/^#topic-([a-z0-9-]+)$/))&&D.topics.some(t=>t.id===m[1]))return {kind:'topic',id:m[1],hash:h};
  if(h==='#pbl')return {kind:'pbl',id:null,hash:h};
  if(/^#pbl-[a-z0-9-]+$/.test(h)&&pblCases().some(c=>'#'+c.id===h))return {kind:'pbl',id:h.slice(1),hash:h};
  if(h==='#workflow')return {kind:'workflow',id:null,hash:h};
  if(/^#wf-[a-z0-9-]+$/.test(h)&&wfList().some(w=>'#'+w.id===h))return {kind:'workflow',id:h.slice(1),hash:h};
  if(h==='#links')return {kind:'tab',tab:'links',hash:h};
  if((m=h.match(/^#interview-([a-z0-9-]+)$/))&&D.interview.some(i=>i.id===m[1]))return {kind:'interview',id:m[1],hash:h};
  if((m=h.match(/^#tab-([a-z]+)$/))&&navs.some(n=>n[0]===m[1]))return {kind:'tab',tab:m[1],hash:h};
  return null;
}
function routeLabel(route){
  if(!route)return '';
  if(route.kind==='anchor'||route.kind==='topic'){
    const t=D.topics.find(x=>x.id===(route.topicId||route.id)),name=topicLabel(t);
    if(route.kind==='topic')return name;
    const target=route.target;
    if(target.startsWith('section-'))return name+' · '+t.sections[Number(target.slice(8))].title;
    if(target==='coverage')return name+' · 共筆對照';
    if(target.startsWith('coverage-'))return name+' · '+(chapterCoverage(t)?.entries.find(e=>'coverage-'+e.id===target)?.title||'共筆詳解');
    return name+' · '+(chapterEnrichment(t)?.integrated?.units.find(u=>u.id===target)?.title||'學習單元');
  }
  if(route.kind==='pbl')return route.id?'PBL · '+pblCases().find(c=>c.id===route.id).title:'PBL 情境討論';
  if(route.kind==='workflow')return route.id?'臨床流程 · '+wfList().find(w=>w.id===route.id).title:'臨床流程';
  if(route.kind==='interview')return '面試演練 · '+D.interview.find(i=>i.id===route.id).title;
  return navs.find(n=>n[0]===route.tab)?.[2]||'練習室';
}
function routeMatchesView(route){
  if(!route)return false;
  if(route.kind==='anchor')return S.tab==='learn'&&S.learn===route.topicId;
  if(route.kind==='topic')return S.tab==='learn'&&S.learn===route.id;
  if(route.kind==='pbl')return S.tab==='pbl'&&(!route.id||route.id===S.pbl);
  if(route.kind==='workflow')return S.tab==='workflow'&&(!route.id||route.id===S.workflow);
  if(route.kind==='interview')return S.tab==='interview'&&S.interview===route.id;
  return S.tab===route.tab;
}
function currentViewHash(){return S.tab==='learn'?'#topic-'+S.learn:S.tab==='pbl'?'#'+S.pbl:S.tab==='workflow'?'#'+S.workflow:S.tab==='interview'?'#interview-'+S.interview:S.tab==='links'?'#links':S.tab==='notebook'?'':'#tab-'+S.tab;}
function currentLocationHash(){const route=parseRoute(window.location?.hash||'');return route&&routeMatchesView(route)?route.hash:(currentViewHash()||'#tab-notebook');}
function syncPracticeHash(){
  if(!practiceHashReady||!window.history?.replaceState||!window.location)return;
  const route=parseRoute(window.location.hash||'');
  if(route&&routeMatchesView(route))return;
  const next=currentViewHash();
  if(next){if(window.location.hash!==next)window.history.replaceState(null,'',next);}
  else if(window.location.hash){const base=typeof window.location.pathname==='string'?window.location.pathname+(window.location.search||''):'#';window.history.replaceState(null,'',base);}
}
function openRoute(hash,updateHash=true){
  const route=parseRoute(hash);
  if(!route)return false;
  if(route.kind==='anchor'){
    const t=D.topics.find(x=>x.id===route.topicId);
    if(t.chapter&&chapterCoverage(t))return coverageFocus(t.id+'|'+route.target,updateHash);
    S.learn=t.id;switchTab('learn');
    if(updateHash&&window.history?.replaceState)window.history.replaceState(null,'',route.hash);
    const node=document.getElementById(t.id+'-'+route.target);if(node)node.scrollIntoView({block:'start'});
    return true;
  }
  if(route.kind==='topic'){S.learn=route.id;switchTab('learn');}
  else if(route.kind==='pbl'){if(route.id)S.pbl=route.id;switchTab('pbl');}
  else if(route.kind==='workflow'){if(route.id)S.workflow=route.id;switchTab('workflow');}
  else if(route.kind==='interview')chooseInterview(route.id);
  else switchTab(route.tab);
  if(updateHash&&window.history?.replaceState&&window.location?.hash!==route.hash)window.history.replaceState(null,'',route.hash);
  return true;
}
function appRestoreHash(){
  practiceHashReady=true;
  const route=parseRoute(window.location?.hash||'');
  if(!route)return;
  if(route.kind==='anchor'&&/^notes-\d{2}$/.test(route.topicId)){coverageRestoreHash();return;}
  if(!routeMatchesView(route))openRoute(route.hash,false);
}

/* Saved links: stored in meta as link:<id>, exported and imported with progress. Deletions keep a tombstone so an older import cannot bring them back. */
function normalizeLinkUrl(raw){
  const s=String(raw??'').trim();
  if(!s||s.length>2000)return null;
  if(s.startsWith('#'))return parseRoute(s)?s:null;
  const bases=[...APP_URLS];
  if(typeof window.location?.href==='string'&&/^https?:/.test(window.location.href))bases.push(window.location.origin+window.location.pathname);
  for(const base of bases){
    const root=base.replace(/index\.html$/,'');
    if(s===root||s===root.replace(/\/$/,'')||s.startsWith(root+'#')||s.startsWith(root+'index.html')){const i=s.indexOf('#');if(i<0)return '#tab-notebook';const hash=s.slice(i);return parseRoute(hash)?hash:null;}
  }
  let url;
  try{url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(s)?s:'https://'+s);}catch{return null;}
  if(!['https:','http:'].includes(url.protocol)||!url.hostname)return null;
  return url.href.length<=2000?url.href:null;
}
function linkItems(){return Object.entries(meta).filter(([key,v])=>key.startsWith('link:')&&v&&!v.deleted&&v.url).map(([key,v])=>({id:key.slice(5),...v})).sort((a,b)=>String(b.at).localeCompare(String(a.at)));}
function findLink(url){return linkItems().find(item=>item.url===url);}
function newLinkId(){return 'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function linkDefaultTitle(url){if(url.startsWith('#'))return routeLabel(parseRoute(url));try{return new URL(url).hostname;}catch{return url;}}
function saveLink(value,id=null){
  if(!id&&linkItems().length>=LINK_LIMIT){toast('連結已達 '+LINK_LIMIT+' 筆上限，請先刪除不需要的連結。');return null;}
  const key='link:'+(id||newLinkId());
  meta[key]={title:String(value.title||'').trim().slice(0,120)||linkDefaultTitle(value.url).slice(0,120),url:value.url,note:String(value.note||'').slice(0,1000),topicId:D.topics.some(t=>t.id===value.topicId)?value.topicId:'',at:now()};
  changed();
  return key.slice(5);
}
function deleteLink(id){meta['link:'+id]={deleted:true,at:now()};changed();}
function linkSaveButton(hash){if(!parseRoute(hash))return '';const saved=!!findLink(hash);return `<button class="link-save" data-action="link-save" data-value="${esc(hash)}" aria-pressed="${saved}">${saved?'★ 已收藏':'☆ 收藏連結'}</button>`;}
function linkTopicOf(url){const route=url.startsWith('#')?parseRoute(url):null;return route?.topicId||(route?.kind==='topic'?route.id:'')||'';}

/* Progress import validation for the new keys. Returns undefined for keys this module does not own. */
function practiceEntry(key,v){
  const at=validDate(v?.at);
  if(key.startsWith('pbl:')){if(!pblCases().some(c=>'pbl:'+c.id===key)||typeof v?.done!=='boolean')return null;return {done:v.done,at};}
  if(key.startsWith('workflow:')){const w=wfList().find(x=>'workflow:'+x.id===key);if(!w||!v||typeof v.practiced!=='boolean')return null;const total=w.steps.length,best=Number.isInteger(v.best)&&v.best>=0&&v.best<=total?v.best:0;return {practiced:v.practiced,best,total,at};}
  return undefined;
}
function practiceMeta(key,v){
  if(!v||typeof v!=='object'||Array.isArray(v))return key.startsWith('link:')||key.startsWith('pbl:')?null:undefined;
  const at=validDate(v.at),text=(s,max)=>typeof s==='string'?s.slice(0,max):'';
  if(key.startsWith('link:')){
    if(!/^link:[a-z0-9]{6,32}$/.test(key))return null;
    if(v.deleted===true)return {deleted:true,at};
    const url=normalizeLinkUrl(v.url);
    if(!url)return null;
    return {title:text(v.title,120).trim()||linkDefaultTitle(url).slice(0,120),url,note:text(v.note,1000),topicId:D.topics.some(t=>t.id===v.topicId)?v.topicId:'',at};
  }
  if(key.startsWith('pbl:')){
    const c=pblCases().find(x=>'pbl:'+x.id===key);
    if(!c)return null;
    const notes=Array.isArray(v.notes)?c.stages.map((_,n)=>text(v.notes[n],4000)):c.stages.map(()=>'');
    return {notes,issues:text(v.issues,4000),at};
  }
  return undefined;
}

/* PBL */
function pblNotes(id){const c=pblCases().find(x=>x.id===id);const m=meta['pbl:'+id]||{};return {notes:c.stages.map((_,n)=>m.notes?.[n]||''),issues:m.issues||''};}
function pblStageMarkup(c,stage,n,notes){
  return `<section class="pbl-stage" id="pbl-stage-${n+1}" aria-labelledby="pbl-stage-${n+1}-title">
    <div class="pbl-stage-head"><span class="step-number">${n+1}</span><h3 id="pbl-stage-${n+1}-title">${esc(stage.title)}</h3></div>
    <p>${esc(stage.info)}</p>
    <div class="pbl-prompts"><strong>導師提問</strong><ol>${stage.prompts.map(p=>`<li>${esc(p)}</li>`).join('')}</ol></div>
    <label class="field-label" for="pbl-note-${n}">我的討論筆記</label>
    <textarea class="input" id="pbl-note-${n}" maxlength="4000" placeholder="事實：…&#10;假說：…&#10;還需要知道：…">${esc(notes[n])}</textarea>
    <details class="model pbl-reference"><summary>寫完後，對照導師參考</summary><div>
      <div class="pbl-reference-grid"><div><h4>關鍵事實</h4>${list(stage.facts)}</div><div><h4>合理假說</h4>${list(stage.hypotheses)}</div><div><h4>還需要的資訊</h4>${list(stage.needToKnow)}</div></div>
      <p class="pbl-discussion"><strong>導師希望聽到</strong>${esc(stage.discussion)}</p>
    </div></details>
  </section>`;
}
function pblPage(){
  const cases=pblCases();
  if(!cases.length)return heading('','PBL 情境討論','目前沒有可用的情境。');
  const c=pblCase(),n=cases.indexOf(c),shown=Math.min(c.stages.length,S.pblStage[c.id]||1),v=pblNotes(c.id),done=cases.filter(x=>entries['pbl:'+x.id]?.done).length;
  const flows=(c.workflowIds||[]).map(id=>wfList().find(w=>w.id===id)).filter(Boolean).map(w=>btn('流程：'+esc(w.title.split('：')[0]),'workflow-open',w.id,'small subtle')).join('');
  const finished=shown>=c.stages.length;
  return heading('','PBL 情境討論',esc(D.pbl.intro),`<div class="heading-stat"><strong>${done}<i> / ${cases.length}</i></strong><span>個情境已完成</span></div>`)
  +`<section class="pbl-method" aria-label="PBL 討論五步"><ol>${(D.pbl.method||[]).map((m,i)=>`<li><span>${i+1}</span><strong>${esc(m.step)}</strong><small>${esc(m.hint)}</small></li>`).join('')}</ol></section>`
  +`<div class="two-col"><aside class="card topic-menu" aria-label="PBL 情境">${cases.map((x,i)=>`<button class="topic-button ${x.id===c.id?'active':''}" data-action="pbl-open" data-value="${x.id}" ${x.id===c.id?'aria-current="true"':''}><span class="index">${String(i+1).padStart(2,'0')}</span><span>${esc(x.title)}<small class="menu-note">${esc(x.theme)}</small></span>${entries['pbl:'+x.id]?.done?'<span class="done">✓</span>':''}</button>`).join('')}</aside>
  <article class="card reading-card pbl-card"><p class="eyebrow">PBL ${String(n+1).padStart(2,'0')} / ${cases.length}</p><p class="pbl-theme"><span class="tag">${esc(c.theme)}</span></p><h2>${esc(c.title)}</h2><p class="lead">${esc(c.trigger)}</p>${practiceRelated(c.topicIds,flows)}
  <ol class="pbl-progress" aria-label="已揭露 ${shown} / ${c.stages.length} 幕">${c.stages.map((_,i)=>`<li class="${i<shown?'is-open':''}"></li>`).join('')}</ol>
  ${c.stages.slice(0,shown).map((stage,i)=>pblStageMarkup(c,stage,i,v.notes)).join('')}
  ${finished?`<section class="pbl-wrap" id="pbl-wrap" aria-labelledby="pbl-wrap-title"><h3 id="pbl-wrap-title">學習議題</h3><ol class="pbl-issues">${c.learningIssues.map(x=>`<li><strong>${esc(x.issue)}</strong><span>${esc(x.why)}</span></li>`).join('')}</ol>
    <label class="field-label" for="pbl-issues">我的學習議題與查證結果</label><textarea class="input" id="pbl-issues" maxlength="4000" placeholder="我還不確定的是…&#10;查證後的答案與來源…">${esc(v.issues)}</textarea>
    <section class="learning-note pbl-humanities"><strong>${esc(c.humanities.title)}</strong>${list(c.humanities.points)}</section>
    <h3>考官可能追問</h3>${c.examinerFollowups.map(f=>`<details class="model"><summary>${esc(f.q)}</summary><div><p>${esc(f.a)}</p></div></details>`).join('')}
    <p class="practice-takeaway"><strong>帶走一句</strong>${esc(c.takeaway)}</p></section>`
  :`<div class="pbl-advance">${btn('進入'+esc(c.stages[shown].title.split(' · ')[0]),'pbl-stage','','primary')}${btn('一次展開全部','pbl-all','','subtle')}</div><p class="small">先寫下這一幕的事實、假說與還需要的資訊，再進入下一幕。</p>`}
  ${practiceSources(c.sourceIds)}
  <div class="reading-actions">${btn(entries['pbl:'+c.id]?.done?'✓ 已完成（可取消）':'標記完成','pbl-done')}${shown>1?btn('從第一幕重來','pbl-restart','','subtle'):''}${btn('下一個情境','pbl-next','','primary')}</div>
  <p class="small practice-disclaimer">${esc(D.pbl.disclaimer)}</p></article></div>`;
}

/* Workflows */
function wfEntry(w){return entries['workflow:'+w.id]||null;}
function shuffledOrder(n){const order=[...Array(n).keys()];for(let tries=0;tries<5;tries++){for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}if(n<2||order.some((x,i)=>x!==i))break;}return order;}
function ensureShuffle(w){if(!Array.isArray(S.wfShuffle[w.id])||S.wfShuffle[w.id].length!==w.steps.length){S.wfShuffle[w.id]=shuffledOrder(w.steps.length);S.wfPicked[w.id]=[];S.wfChecked[w.id]=false;}}
// Longest increasing subsequence of the picked step indices: the steps already in the right relative order.
function inOrderPositions(seq){
  const tails=[],tailPos=[],prev=new Array(seq.length).fill(-1);
  seq.forEach((value,pos)=>{let lo=0,hi=tails.length;while(lo<hi){const mid=(lo+hi)>>1;if(tails[mid]<value)lo=mid+1;else hi=mid;}tails[lo]=value;tailPos[lo]=pos;prev[pos]=lo>0?tailPos[lo-1]:-1;});
  const keep=new Set();for(let pos=tails.length?tailPos[tails.length-1]:-1;pos>=0;pos=prev[pos])keep.add(pos);
  return keep;
}
function wfStepsRead(w){return `<ol class="wf-steps">${w.steps.map((s,i)=>`<li class="${s.critical?'is-critical':''}"><div class="wf-step-head"><span class="step-number">${i+1}</span><h3>${esc(s.title)}</h3>${s.critical?'<span class="wf-critical">不可省略</span>':''}</div><p>${esc(s.detail)}</p><p class="wf-why"><strong>為什麼</strong>${esc(s.why)}</p></li>`).join('')}</ol>`;}
function wfStepsRecall(w){return `<p class="small">先說出每一步具體怎麼做、為什麼，再展開核對。</p><ol class="wf-steps is-recall">${w.steps.map((s,i)=>`<li class="${s.critical?'is-critical':''}"><details><summary><span class="step-number">${i+1}</span>${esc(s.title)}${s.critical?'<span class="wf-critical">不可省略</span>':''}</summary><div><p>${esc(s.detail)}</p><p class="wf-why"><strong>為什麼</strong>${esc(s.why)}</p></div></details></li>`).join('')}</ol>`;}
function wfOrderPractice(w){
  ensureShuffle(w);
  const order=S.wfShuffle[w.id],picked=S.wfPicked[w.id]||[],checked=!!S.wfChecked[w.id],total=w.steps.length,left=order.filter(i=>!picked.includes(i));
  const keep=checked?inOrderPositions(picked):new Set(),right=keep.size;
  return `<section class="wf-order" aria-label="排序練習"><p class="small">依你會執行的順序點選右側步驟。排完後按「檢查順序」；系統會找出相對順序已正確的步驟，標出需要移動的步驟。</p>
  <div class="wf-order-grid"><div><h4>你的順序（${picked.length} / ${total}）</h4>${picked.length?`<ol class="wf-picked">${picked.map((s,pos)=>`<li class="${checked?(keep.has(pos)?'is-right':'is-moved'):''}"><span>${esc(w.steps[s].title)}</span>${checked?`<small>${keep.has(pos)?'順序正確':'應在第 '+(s+1)+' 步'}</small>`:''}</li>`).join('')}</ol>`:'<p class="wf-picked is-empty">尚未選擇步驟。</p>'}</div>
  <div><h4>候選步驟</h4><div class="wf-candidates">${left.length?left.map(i=>`<button class="wf-candidate" data-action="wf-pick" data-value="${i}">${esc(w.steps[i].title)}</button>`).join(''):'<p class="small">已全部排入。</p>'}</div></div></div>
  <div class="actions"><button class="btn small" data-action="wf-undo" ${picked.length&&!checked?'':'disabled'}>復原一步</button>${btn('重新洗牌','wf-reshuffle','','small subtle')}<button class="btn small primary" data-action="wf-check" ${picked.length===total&&!checked?'':'disabled'}>檢查順序</button></div>
  ${checked?`<div class="wf-score ${right===total?'':'is-partial'}" role="status"><strong>${right} / ${total}</strong> 步的相對順序正確${right===total?'，完全正確。':'；移動 '+(total-right)+' 步即可排對。'}</div><h4>正確順序</h4>${wfStepsRead(w)}`:''}
  </section>`;
}
function workflowPage(){
  const all=wfList();
  if(!all.length)return heading('','臨床流程','目前沒有可用的流程。');
  const w=wfCurrent(),cat=wfCategory(w),practiced=all.filter(x=>wfEntry(x)?.practiced).length,mode=['read','recall','order'].includes(S.wfMode)?S.wfMode:'read',e=wfEntry(w);
  const cases=pblCases().filter(c=>(c.workflowIds||[]).includes(w.id)).map(c=>btn('PBL：'+esc(c.title),'pbl-open',c.id,'small subtle')).join('');
  const menu=(D.workflows.categories||[]).map(category=>{const items=all.filter(x=>x.category===category.id);return items.length?`<p class="menu-category">${esc(category.label)}</p>${items.map(x=>`<button class="topic-button ${x.id===w.id?'active':''}" data-action="workflow-open" data-value="${x.id}" ${x.id===w.id?'aria-current="true"':''}><span class="index">${String(all.indexOf(x)+1).padStart(2,'0')}</span><span>${esc(x.title)}<small class="menu-note">${esc(x.urgency)}</small></span>${wfEntry(x)?.practiced?'<span class="done">✓</span>':''}</button>`).join('')}`:'';}).join('');
  const handoff=w.handoff.split(/；(?=[SBAR]：)/).join('\n');
  return heading('','臨床流程',esc(D.workflows.intro),`<div class="heading-stat"><strong>${practiced}<i> / ${all.length}</i></strong><span>個流程已練習</span></div>`)
  +`<div class="two-col"><aside class="card topic-menu" aria-label="臨床流程">${menu}</aside>
  <article class="card reading-card wf-card"><p class="eyebrow">WORKFLOW ${String(all.indexOf(w)+1).padStart(2,'0')} / ${all.length}</p><div class="wf-meta"><span class="tag">${esc(cat.label)}</span><span class="wf-urgency is-${esc(w.category)}">時效：${esc(w.urgency)}</span></div><h2>${esc(w.title)}</h2><p class="lead">${esc(w.trigger)}</p>${practiceRelated(w.topicIds,cases)}
  <div class="study-switch" role="group" aria-label="流程練習方式">${[['read','閱讀流程'],['recall','遮住細節'],['order','排序練習']].map(([id,label])=>`<button class="btn ${mode===id?'active':''}" data-action="wf-mode" data-value="${id}" aria-pressed="${mode===id}">${label}</button>`).join('')}</div>
  ${mode==='order'?wfOrderPractice(w):mode==='recall'?wfStepsRecall(w):wfStepsRead(w)}
  ${e?.best?`<p class="small wf-best">排序最佳紀錄：${e.best} / ${e.total} 步相對順序正確。</p>`:''}
  <section class="wf-flags" aria-labelledby="wf-flags-title"><h3 id="wf-flags-title">紅旗：出現就升級處置</h3>${list(w.redFlags)}</section>
  <section class="trap wf-pitfalls"><strong>常見錯誤與考官陷阱</strong>${list(w.pitfalls)}</section>
  <h3>考官可能問</h3>${w.examQuestions.map(q=>`<details class="model"><summary>${esc(q.q)}</summary><div><p>${esc(q.a)}</p></div></details>`).join('')}
  <details class="model wf-handoff"><summary>向主治醫師回報（SBAR 範例）</summary><div><p class="preline">${esc(handoff)}</p></div></details>
  ${practiceSources(w.sourceIds)}
  <div class="reading-actions">${btn(e?.practiced?'✓ 已練習（可取消）':'標記已練習','wf-done')}${btn('下一個流程','wf-next','','primary')}</div>
  <p class="small practice-disclaimer">${esc(D.workflows.disclaimer)}</p></article></div>`;
}

/* Links page */
function linkItemMarkup(item){
  const internal=item.url.startsWith('#'),route=internal?parseRoute(item.url):null,topic=D.topics.find(t=>t.id===item.topicId);
  const title=internal?`<button class="link-title" data-action="link-open" data-value="${esc(item.id)}">${esc(item.title)}</button>`:`<a class="link-title" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`;
  return `<article class="link-item"><div class="link-body">${title}<span class="link-url">${internal?(route?(item.title===routeLabel(route)?'App 內位置':esc(routeLabel(route)))+' · '+esc(item.url):'已失效的 App 內位置 · '+esc(item.url)):esc(item.url)}</span>${item.note?`<p class="link-note preline">${esc(item.note)}</p>`:''}${topic?`<span class="tag">${esc(shortTitle(topic.id))}</span>`:''}</div><div class="link-actions">${btn('編輯','link-edit',item.id,'small subtle')}${btn('刪除','link-delete',item.id,'small subtle')}</div></article>`;
}
function linkListMarkup(){
  const tokens=S.linkFilter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const items=linkItems().filter(item=>tokens.every(k=>[item.title,item.url,item.note,item.topicId?shortTitle(item.topicId):''].join(' ').toLocaleLowerCase().includes(k)));
  if(!linkItems().length)return '<div class="card empty"><h3>還沒有收藏的連結</h3><p>在章節段落按「☆ 收藏連結」，或用上方表單貼上網址。</p></div>';
  if(!items.length)return '<div class="empty"><h3>沒有符合的連結</h3><p>試試其他關鍵詞。</p></div>';
  const inApp=items.filter(x=>x.url.startsWith('#')),outside=items.filter(x=>!x.url.startsWith('#'));
  return `${inApp.length?`<section class="link-group"><h3>App 內位置（${inApp.length}）</h3>${inApp.map(linkItemMarkup).join('')}</section>`:''}${outside.length?`<section class="link-group"><h3>外部網址（${outside.length}）</h3>${outside.map(linkItemMarkup).join('')}</section>`:''}`;
}
function linksPage(){
  const d=S.linkDraft,count=linkItems().length,editing=S.linkEdit&&meta['link:'+S.linkEdit]&&!meta['link:'+S.linkEdit].deleted;
  return heading('','我的連結','收藏 App 內的章節段落、PBL、流程，或任何外部網址並加上備註。連結和其他進度一樣，只存在這個分頁；請用「匯出進度」保存，下次「匯入進度」即可帶回。',`<div class="heading-stat"><strong>${count}</strong><span>個連結</span></div>`)
  +`<section class="card link-form" aria-label="${editing?'編輯連結':'新增連結'}"><h2 class="full">${editing?'編輯連結':'新增連結'}</h2>
  <div class="full"><label class="field-label" for="link-url">網址</label><input class="select" id="link-url" type="text" inputmode="url" autocomplete="off" maxlength="2000" value="${esc(d.url)}" placeholder="https://… 或 App 內位置，例如 #notes-02-section-2"></div>
  <div><label class="field-label" for="link-title">標題</label><input class="select" id="link-title" type="text" maxlength="120" value="${esc(d.title)}" placeholder="留空時自動使用頁面名稱或網域"></div>
  <div><label class="field-label" for="link-topic">分類</label><select class="select" id="link-topic"><option value="">未分類</option>${orderedTopics().map(t=>`<option value="${t.id}" ${d.topicId===t.id?'selected':''}>${esc(topicLabel(t))}</option>`).join('')}</select></div>
  <div class="full"><label class="field-label" for="link-note">備註</label><textarea class="input" id="link-note" maxlength="1000" placeholder="為什麼收藏、下次要看哪一段">${esc(d.note)}</textarea></div>
  <div class="full actions">${btn(editing?'儲存修改':'儲存連結','link-add','','primary')}${editing?btn('取消編輯','link-cancel','','subtle'):''}${btn('收藏目前位置','link-save-current','','subtle')}</div>
  <p class="full small">App 內位置以 # 開頭，例如 #notes-02-section-2、#pbl-dr、#wf-chemical；也可直接貼上本站完整網址。外部網址會在新分頁開啟。</p></section>
  <section class="link-list-wrap" aria-label="已收藏的連結"><div class="section-heading"><h2>已收藏</h2><label class="vh" for="link-filter">篩選連結</label><input class="select link-filter" id="link-filter" type="search" value="${esc(S.linkFilter)}" placeholder="篩選標題、網址或備註" autocomplete="off"></div><div id="link-list">${linkListMarkup()}</div></section>`;
}

/* Home overview and search */
function practiceOverview(){
  const cases=pblCases().length,flows=wfList().length;
  if(!cases&&!flows)return '';
  return `<section class="practice-overview" aria-labelledby="practice-title"><div class="section-heading"><h2 id="practice-title">情境與流程演練</h2><span class="small">口試常問：「接下來你會怎麼做？」</span></div><div class="practice-cards">
  <article class="practice-card"><span class="practice-count">${cases} 個三幕情境</span><h3>PBL 情境討論</h3><p>逐幕揭露病例：整理事實、提出假說、列出還需要的資訊，再延伸到溝通、倫理與制度。</p>${btn('開始討論','tab','pbl','small')}</article>
  <article class="practice-card"><span class="practice-count">${flows} 個流程</span><h3>臨床流程</h3><p>急症、當日轉介、操作安全與篩檢照會；可遮住細節，或把打亂的步驟排回正確順序。</p>${btn('開始練習','tab','workflow','small')}</article>
  <article class="practice-card"><span class="practice-count">${linkItems().length} 個收藏</span><h3>我的連結</h3><p>收藏章節段落、流程或外部網址並加註；隨「匯出進度」一起保存。</p>${btn('管理連結','tab','links','small')}</article></div></section>`;
}
function practiceIndex(){
  const out=[];
  for(const c of pblCases()){const topic=D.topics.find(t=>t.id===c.topicIds[0]);out.push({topicId:c.topicIds[0],chapter:topic?.chapter||0,type:'PBL 情境',title:c.title,body:[c.theme,c.trigger,...c.stages.flatMap(s=>[s.title,s.info,...s.prompts,...s.facts,...s.hypotheses,...s.needToKnow,s.discussion]),...c.learningIssues.flatMap(x=>[x.issue,x.why]),...c.humanities.points,...c.examinerFollowups.flatMap(f=>[f.q,f.a]),c.takeaway].join(' '),action:'pbl-open',target:c.id});}
  for(const w of wfList()){const topic=D.topics.find(t=>t.id===w.topicIds[0]);out.push({topicId:w.topicIds[0],chapter:topic?.chapter||0,type:'臨床流程',title:w.title,body:[w.urgency,w.trigger,...w.steps.flatMap(s=>[s.title,s.detail,s.why]),...w.redFlags,...w.pitfalls,...w.examQuestions.flatMap(q=>[q.q,q.a]),w.handoff].join(' '),action:'workflow-open',target:w.id});}
  return out;
}

/* Events routed from the app's existing handlers. */
function practiceInput(el){
  const id=el?.id||'';
  if(id==='link-url'||id==='link-title'||id==='link-note'){S.linkDraft[id.slice(5)]=el.value;return true;}
  if(id==='link-filter'){S.linkFilter=el.value;const box=$('#link-list');if(box)box.innerHTML=linkListMarkup();return true;}
  if(/^pbl-note-\d$/.test(id)){const c=pblCase(),v=pblNotes(c.id),n=Number(id.slice(9));if(n<c.stages.length){v.notes[n]=el.value;putMeta('pbl:'+c.id,{notes:v.notes,issues:v.issues});}return true;}
  if(id==='pbl-issues'){const c=pblCase(),v=pblNotes(c.id);putMeta('pbl:'+c.id,{notes:v.notes,issues:el.value});return true;}
  return false;
}
function practiceChange(el){if(el?.id==='link-topic'){S.linkDraft.topicId=el.value;return true;}return false;}
function practiceAction(a,v,b){
  switch(a){
  case'pbl-open':if(pblCases().some(c=>c.id===v)){S.pbl=v;switchTab('pbl');}break;
  case'pbl-stage':{const c=pblCase(),next=Math.min(c.stages.length,(S.pblStage[c.id]||1)+1);S.pblStage[c.id]=next;render();document.getElementById('pbl-stage-'+next)?.scrollIntoView?.({block:'start'});break;}
  case'pbl-all':{const c=pblCase();S.pblStage[c.id]=c.stages.length;render();break;}
  case'pbl-restart':{const c=pblCase();S.pblStage[c.id]=1;render();window.scrollTo?.({top:0,behavior:'instant'});break;}
  case'pbl-done':{const c=pblCase();put('pbl:'+c.id,{done:!entries['pbl:'+c.id]?.done});render();break;}
  case'pbl-next':{const cases=pblCases();S.pbl=cases[(cases.indexOf(pblCase())+1)%cases.length].id;switchTab('pbl');break;}
  case'workflow-open':if(wfList().some(w=>w.id===v)){S.workflow=v;switchTab('workflow');}break;
  case'wf-mode':if(['read','recall','order'].includes(v)){S.wfMode=v;if(v==='order')ensureShuffle(wfCurrent());render();}break;
  case'wf-pick':{const w=wfCurrent(),i=Number(v),picked=S.wfPicked[w.id]||(S.wfPicked[w.id]=[]);if(Number.isInteger(i)&&i>=0&&i<w.steps.length&&!picked.includes(i)&&!S.wfChecked[w.id]){picked.push(i);render();}break;}
  case'wf-undo':{const w=wfCurrent();if(!S.wfChecked[w.id]){(S.wfPicked[w.id]||[]).pop();render();}break;}
  case'wf-reshuffle':{const w=wfCurrent();S.wfShuffle[w.id]=shuffledOrder(w.steps.length);S.wfPicked[w.id]=[];S.wfChecked[w.id]=false;render();break;}
  case'wf-check':{const w=wfCurrent(),picked=S.wfPicked[w.id]||[];if(picked.length!==w.steps.length||S.wfChecked[w.id])break;S.wfChecked[w.id]=true;const right=inOrderPositions(picked).size,prior=wfEntry(w);put('workflow:'+w.id,{practiced:true,best:Math.max(prior?.best||0,right),total:w.steps.length});render();break;}
  case'wf-done':{const w=wfCurrent(),prior=wfEntry(w);put('workflow:'+w.id,{practiced:!prior?.practiced,best:prior?.best||0,total:w.steps.length});render();break;}
  case'wf-next':{const all=wfList();S.workflow=all[(all.indexOf(wfCurrent())+1)%all.length].id;switchTab('workflow');break;}
  case'link-save':{const url=normalizeLinkUrl(v);if(!url)break;if(findLink(url)){toast('這個位置已在「我的連結」。');break;}if(saveLink({url,title:'',note:'',topicId:linkTopicOf(url)})){if(b){b.textContent='★ 已收藏';b.setAttribute?.('aria-pressed','true');}toast('已收藏：'+linkDefaultTitle(url)+'。可到「我的連結」加上備註。');}break;}
  case'link-save-current':{const url=currentLocationHash();if(findLink(url)){toast('這個位置已在「我的連結」。');break;}if(saveLink({url,title:'',note:'',topicId:linkTopicOf(url)})){toast('已收藏：'+linkDefaultTitle(url)+'。');if(S.tab==='links')render();}break;}
  case'link-add':{const d=S.linkDraft,url=normalizeLinkUrl(d.url);if(!url){toast('請輸入 http(s):// 網址，或 App 內位置（例如 #notes-02-section-2）。');break;}const existing=findLink(url);if(existing&&existing.id!==S.linkEdit){toast('這個網址已收藏為「'+existing.title+'」。');break;}const id=saveLink({...d,url},S.linkEdit);if(id){toast(S.linkEdit?'已更新連結。':'已儲存連結。');S.linkEdit=null;S.linkDraft={title:'',url:'',note:'',topicId:''};render();}break;}
  case'link-edit':{const item=linkItems().find(x=>x.id===v);if(item){S.linkEdit=v;S.linkDraft={title:item.title,url:item.url,note:item.note||'',topicId:item.topicId||''};render();$('#link-url')?.focus?.();}break;}
  case'link-cancel':S.linkEdit=null;S.linkDraft={title:'',url:'',note:'',topicId:''};render();break;
  case'link-delete':{const item=linkItems().find(x=>x.id===v);if(item&&window.confirm('刪除「'+item.title+'」？')){deleteLink(v);if(S.linkEdit===v){S.linkEdit=null;S.linkDraft={title:'',url:'',note:'',topicId:''};}render();toast('已刪除連結。');}break;}
  case'link-open':{const item=linkItems().find(x=>x.id===v);if(item&&item.url.startsWith('#')&&!openRoute(item.url,true))toast('這個 App 內位置已不存在，請編輯或刪除。');break;}
  }
}
// Replaces the coverage-only hash listeners; coverage anchors are still restored through coverageRestoreHash.
window.addEventListener('hashchange',appRestoreHash);
window.addEventListener('load',appRestoreHash);
/* practice-ui:end */
