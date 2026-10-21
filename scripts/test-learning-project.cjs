// Meaningful project-flow checks against native handlers and the existing save/sync harness.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const C=require('./learning-project-core.js'),here=__dirname,results=[];
let n=Date.parse('2026-10-22T01:00:00.000Z');class ClockDate extends Date{constructor(...a){super(...(a.length?a:[n]));}static now(){return n;}}
let harness=fs.readFileSync(path.join(here,'test-progress-sync.cjs'),'utf8').split('(async () => {')[0];
harness=harness.replace('qa, toasts, blobs, clipboard','context, intervals, qa, toasts, blobs, clipboard').replace('const timers = [];','const timers = [];const intervals=[];').replace('setInterval() {},','setInterval(fn,ms){intervals.push({fn,ms});},');
const host={require,process:{argv:[]},__dirname:here,console,URL,Blob,Buffer,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setImmediate,Date:ClockDate};
vm.runInNewContext(harness+'\nglobalThis.factories={boot,MemoryStorage,fakeGitHub};',host);
const {boot,MemoryStorage,fakeGitHub}=host.factories;
const json=p=>JSON.parse(fs.readFileSync(path.join(here,'..',p),'utf8'));
async function fresh(local=new MemoryStorage(),github=fakeGitHub()){
 const a=boot({local,session:new MemoryStorage(),github}),ctx=a.context,get=a.document.getElementById;
 a.document.baseURI='https://example.test/';a.document.currentScript={src:'https://example.test/scripts/study-srs.js'};a.document.getElementById=id=>['study-root','project-root','textbook-root'].includes(id)?null:get(id);
 const on=a.document.addEventListener;a.document.addEventListener=()=>{};vm.runInContext(fs.readFileSync(path.join(here,'study-srs.js'),'utf8'),ctx);a.document.addEventListener=on;ctx.window.OphStudy.setClock(()=>n);
 ctx.fetch=async url=>({ok:true,json:async()=>json(String(url).endsWith('textbook-manifest.json')?'content/textbook-manifest.json':'content/textbook-depth/additional-practice.json')});
 a.document.currentScript={src:'https://example.test/scripts/learning-project.js'};vm.runInContext(fs.readFileSync(path.join(here,'learning-project.js'),'utf8'),ctx);
 ctx.window.OphProject.setClock(()=>n);a.document.getElementById=get;
 const root={isConnected:true,innerHTML:''};await ctx.window.OphProject.mount(root);ctx.fetch=github.fetch;
 return Object.assign(a,{root,local,github,project:ctx.window.OphProject,bridge:ctx.window.OphProjectBridge});
}
function submit(a,q,correct=true){a.action('practice-one',q.id);a.change('answer',{name:'answer',value:String(correct?q.correctIndex:(q.correctIndex+1)%q.options.length)});a.action('submit');}
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
(async()=>{
 await test('calendar boundaries, invalid dates and exact daily reward cap are independent of correctness',async()=>{
  assert.equal(C.day(Date.parse('2026-10-21T15:59:59Z')),'2026-10-21');assert.equal(C.day(Date.parse('2026-10-21T16:00:00Z')),'2026-10-22');assert(!C.dateValid('2026-02-30'));
  const e={};for(let i=0;i<24;i++){const x=C.award(e,'question',new Date(n).toISOString(),{pool:'shared',id:'q'+i,correct:false});if(x)e[x.key]=x.value;}
  for(const kind of ['written','oral']){const x=C.award(e,kind,new Date(n).toISOString());e[x.key]=x.value;assert.equal(C.award(e,kind,new Date(n).toISOString()),null);}
  assert.equal(C.totals(e,'2026-10-22').xp,220);assert.equal(C.totals(e,'2026-10-22').level,3);
  const merged={};for(let i=0;i<40;i++){const x=C.award({},'question',new Date(n+i).toISOString(),{pool:'shared',id:'q'+i});merged[x.key]=x.value;}assert.equal(C.totals(merged,'2026-10-22').xp,200,'merged device ledgers still obey effective daily cap');
 });
 await test('native valid answers award once; reveal, rating, reload, settings and legacy progress do not backfill XP',async()=>{
  const a=await fresh(),q=a.qa.D.questions[0];a.qa.put('q:'+q.id,{choice:q.correctIndex,correct:true});assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,0);
  submit(a,q,false);assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,10);submit(a,q,true);assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,10);
  const s=a.context.window.OphStudyBridge.read('study:srs:shared:'+q.id);a.context.window.OphStudy.grade('shared',q.id,s.attempt.id,'easy');assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,10);
  a.bridge.config({targetDate:'',dailyMinutes:45});await a.runTimers(t=>t.ms===400);const b=await fresh(a.local);assert.equal(C.totals(b.qa.entries,'2026-10-22').xp,10);assert.equal(b.qa.meta['project:config'].dailyMinutes,45);
  assert.throws(()=>b.bridge.config({targetDate:'2026-02-30',dailyMinutes:30}));
 });
 await test('next-day early native practice saves its answer but earns no XP until actually due',async()=>{
  n=Date.parse('2026-10-22T02:00:00.000Z');const a=await fresh(),q=a.qa.D.questions[0];submit(a,q,true);let r=a.qa.entries['study:srs:shared:'+q.id];assert(a.context.window.OphStudy.grade('shared',q.id,r.attempt.id,'easy'));assert.equal(r.answerCount,1);
  n=Date.parse('2026-10-23T02:00:00.000Z');submit(a,q,true);r=a.qa.entries['study:srs:shared:'+q.id];assert.equal(r.answerCount,2);assert(!a.qa.entries['project:reward:2026-10-23:question:shared:'+q.id]);assert.equal(C.totals(a.qa.entries,'2026-10-23').xp,10);
  n=Date.parse('2026-10-25T02:00:00.000Z');submit(a,q,true);assert(a.qa.entries['project:reward:2026-10-25:question:shared:'+q.id]);assert.equal(C.totals(a.qa.entries,'2026-10-25').xp,20);n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('daily mission is due-wrong first and stable after answer/reload/time-budget changes',async()=>{
  const a=await fresh(),q=a.qa.D.questions[4],k='study:srs:shared:'+q.id;submit(a,q,false);const rec=a.qa.entries[k];rec.plan.dueAt=new Date(n-1).toISOString();
  // Only the just-created first daily snapshot is replaced in this isolated fixture.
  delete a.qa.entries['project:mission:2026-10-22'];await a.project.mount(a.root);const before=JSON.stringify(a.qa.entries['project:mission:2026-10-22'].items);assert.equal(a.qa.entries['project:mission:2026-10-22'].items[0].id,q.id);
  a.bridge.config({targetDate:'2026-10-21',dailyMinutes:60});await a.project.mount(a.root);assert.equal(JSON.stringify(a.qa.entries['project:mission:2026-10-22'].items),before);assert(a.root.innerHTML.includes('目標日已過'));assert(!a.root.innerHTML.includes('NaN'));
 });
 await test('timed answers stay hidden and persist exact session, choices and deadline; finish and SRS apply once',async()=>{
  const a=await fresh();a.project.action('project-written','');const key='project:exam:2026-10-22',v=a.qa.entries[key],q=v.items[0];a.project.change({dataset:{projectAnswer:q.id},value:String(q.correctIndex)});
  assert.equal(Object.keys(a.qa.entries).filter(k=>k.startsWith('study:srs:')).length,0);assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,0);assert(!a.root.innerHTML.includes('正解：'));assert(!a.root.innerHTML.includes(q.explanation));await a.runTimers(t=>t.ms===400);
  const b=await fresh(a.local);b.project.action('project-written','');assert.equal(JSON.stringify(b.qa.entries[key]),JSON.stringify(a.qa.entries[key]));n+=600001;await b.project.mount(b.root);
  assert.equal(b.qa.entries[key].status,'finished');assert.equal(b.qa.entries[key].correct,1);assert.equal(b.qa.entries['study:srs:shared:'+q.id].answerCount,1);assert.equal(C.totals(b.qa.entries,'2026-10-22').xp,10);assert(b.root.innerHTML.includes('未答 9 題'));
  b.project.action('project-exam-submit','');b.project.action('project-written','');assert.equal(b.qa.entries['study:srs:shared:'+q.id].answerCount,1);
  const stale={...v,at:new Date(n+500).toISOString()};b.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{[key]:stale},meta:{}});assert.equal(b.qa.entries[key].status,'finished');n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('oral requires same-round timer, new draft, rubric review and reflection; low self-ratings remain valid',async()=>{
  const a=await fresh();a.action('interview','intro');a.action('iv-done');assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,0);assert(!a.bridge.finishOral());
  a.action('timer');a.type('iv-draft','這是本輪新寫的回答提綱，說明我的角色、行動、證據以及反思。');a.type('project-reflection','下一次開場更直接，最後一句把學習與應徵動機連起來。');a.change('project-oral-reviewed',{checked:true});n+=61000;for(const t of a.intervals.filter(x=>x.ms===250))t.fn();
  assert(a.bridge.finishOral());assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,20);assert(a.qa.entries['interview:intro'].ratings.every(x=>x===false));assert(!a.bridge.finishOral());assert.equal(C.totals(a.qa.entries,'2026-10-22').xp,20);n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('two private-cloud devices converge same-key rewards and stop writing after synchronization',async()=>{
  n=Date.parse('2026-10-22T02:00:00.000Z');const gh=fakeGitHub();gh.add('elton/progress','token');const a=await fresh(new MemoryStorage(),gh);submit(a,a.qa.D.questions[0],false);n+=1000;const b=await fresh(new MemoryStorage(),gh);submit(b,b.qa.D.questions[0],true);
  async function connect(x){x.type('sync-owner','elton');x.type('sync-repo','progress');x.type('sync-token','token');x.action('sync-connect');await x.settle();}
  await connect(a);assert(a.qa.cloudConfig(),a.qa.syncState.error);await connect(b);assert(b.qa.cloudConfig(),b.qa.syncState.error);await a.qa.syncNow('manual');const count=gh.repos.get('elton/progress').commits.length;assert(count>=2,JSON.stringify({count,a:a.qa.syncState,b:b.qa.syncState,calls:gh.calls.map(x=>x.method)}));await b.qa.syncNow('manual');await a.qa.syncNow('manual');assert.equal(gh.repos.get('elton/progress').commits.length,count);
  const key='project:reward:2026-10-22:question:shared:q1';assert.deepEqual(JSON.parse(JSON.stringify(a.qa.entries[key])),JSON.parse(JSON.stringify(b.qa.entries[key])));
  const left={...a.qa.entries[key],correct:false},right={...a.qa.entries[key],correct:true};a.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{[key]:right},meta:{}});b.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{[key]:left},meta:{}});assert.deepEqual(JSON.parse(JSON.stringify(a.qa.entries[key])),JSON.parse(JSON.stringify(b.qa.entries[key])));n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('background written finalization preserves native answer entries and pending familiarity for same and different keys',async()=>{
  for(const same of [false,true]){
   n=Date.parse('2026-10-22T02:00:00.000Z');const a=await fresh();a.project.action('project-written','');const exam=a.qa.entries['project:exam:2026-10-22'],eq=exam.items[0],native=same?a.qa.D.questions.find(q=>q.id===eq.id):a.qa.D.questions.find(q=>q.id!==eq.id);a.project.change({dataset:{projectAnswer:eq.id},value:String((eq.correctIndex+1)%eq.options.length)});submit(a,native,true);
   const token=a.qa.entries['study:srs:shared:'+native.id].attempt.id,before=JSON.stringify(a.qa.entries['q:'+native.id]);n+=600001;for(const t of a.intervals.filter(t=>t.ms===250))t.fn();
   assert.equal(a.qa.entries['project:exam:2026-10-22'].status,'finished');assert.equal(a.qa.S.tab,'quiz');assert.equal(JSON.stringify(a.qa.entries['q:'+native.id]),before);assert(a.context.window.OphStudy.grade('shared',native.id,token,'good'));assert.equal(a.qa.entries['study:srs:shared:'+native.id].plan.rating,'good');assert.equal(a.qa.entries['study:srs:shared:'+native.id].answerCount,1);
  }n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('a timed session that expires after a reload finalizes without reopening the challenge (#14)',async()=>{
  const a=await fresh();a.project.action('project-written','');const key='project:exam:2026-10-22',q=a.qa.entries[key].items[0];a.project.change({dataset:{projectAnswer:q.id},value:String(q.correctIndex)});await a.runTimers(t=>t.ms===400);
  const b=await fresh(a.local);assert.equal(b.qa.entries[key].status,'active');assert(b.root.innerHTML.includes('接續限時筆試小關'));
  for(const t of b.intervals.filter(t=>t.ms===250))t.fn();assert.equal(b.qa.entries[key].status,'active','still inside the 10 minutes');
  n+=600001;for(const t of b.intervals.filter(t=>t.ms===250))t.fn();
  assert.equal(b.qa.entries[key].status,'finished');assert.equal(b.qa.entries[key].correct,1);assert.equal(b.qa.entries['study:srs:shared:'+q.id].answerCount,1);assert.equal(C.totals(b.qa.entries,'2026-10-22').xp,10);assert(!b.root.innerHTML.includes('接續限時筆試小關'));
  n+=1000;for(const t of b.intervals.filter(t=>t.ms===250))t.fn();assert.equal(b.qa.entries['study:srs:shared:'+q.id].answerCount,1,'answers apply once');n=Date.parse('2026-10-22T01:00:00.000Z');
 });
 await test('application notes escape HTML and local restore respects explicit autosave opt-out',async()=>{
  const a=await fresh();a.project.action('project-applications','');a.project.input({dataset:{projectNote:'documents'},value:'<img src=x onerror=alert(1)>'});a.project.change({dataset:{projectCheck:'documents'},checked:true});a.project.action('project-applications','');assert(a.root.innerHTML.includes('&lt;img'));assert(!a.root.innerHTML.includes('<img src=x'));
  await a.runTimers(t=>t.ms===400);const b=await fresh(a.local);assert.equal(b.qa.meta['project:check:documents'].done,true);assert.equal(C.totals(b.qa.entries,'2026-10-22').xp,0);
  b.change('sync-autosave',{checked:false});b.bridge.config({targetDate:'',dailyMinutes:15});await b.runTimers(t=>t.ms===400);assert.equal(b.local.getItem('oph-prep:progress-v3'),null);
 });
 console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
})();
