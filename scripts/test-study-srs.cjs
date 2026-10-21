// Real answer-handler and progress round-trip checks; scheduler arithmetic has a separate independent oracle.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const here=__dirname,results=[];
let harness=fs.readFileSync(path.join(here,'test-progress-sync.cjs'),'utf8').split('(async () => {')[0];
harness=harness.replace('qa, toasts, blobs, clipboard','context, qa, toasts, blobs, clipboard');
const host={require,process:{argv:[]},__dirname:here,console,URL,Blob,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setImmediate};
vm.runInNewContext(harness+'\nglobalThis.factories={boot,MemoryStorage,fakeGitHub};',host);
const {boot,MemoryStorage,fakeGitHub}=host.factories;
const read=p=>JSON.parse(fs.readFileSync(path.join(here,'..',p),'utf8'));
const manifest=read('content/textbook-manifest.json'),extra=read('content/textbook-depth/additional-practice.json');
const volumes=Object.fromEntries(manifest.books.map(b=>[b.bookId,read(b.file)]));
function fresh(local=new MemoryStorage()){
 const a=boot({local,session:new MemoryStorage(),github:fakeGitHub()});
 const ctx=a.context,oldGet=a.document.getElementById,oldOn=a.document.addEventListener,studyHandlers=new Map();
 a.document.getElementById=id=>['study-root','textbook-root'].includes(id)?null:oldGet(id);
 a.document.addEventListener=(n,fn)=>studyHandlers.set(n,fn);
 a.document.currentScript={src:'https://example.test/scripts/study-srs.js'};
 vm.runInContext(fs.readFileSync(path.join(here,'study-srs.js'),'utf8'),ctx);
 a.document.getElementById=id=>['study-root','textbook-root'].includes(id)?null:oldGet(id);a.document.addEventListener=oldOn;
 ctx.window.OphStudy.setClock(()=>Date.parse('2026-10-20T14:00:00.000Z'));
 return Object.assign(a,{local,study:ctx.window.OphStudy,bridge:ctx.window.OphStudyBridge,studyHandlers});
}
const key=(p,id)=>'study:srs:'+p+':'+id;
function record(a,p,id){return a.bridge.read(key(p,id));}
function shared(a,correct=true){a.action('all');const q=a.qa.D.questions.find(q=>q.id===a.qa.S.ids[a.qa.S.qi]);a.change('answer',{name:'answer',value:String(correct?q.correctIndex:(q.correctIndex+1)%4)});return q;}
async function textbook(a,q,pool='book',pack=extra){
 const ctx=a.context,handlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return null;},addEventListener(n,fn){handlers.set(n,fn);}};
 ctx.fetch=async url=>({ok:true,json:async()=>structuredClone(String(url).endsWith('textbook-manifest.json')?manifest:String(url).endsWith('additional-practice.json')?pack:volumes[String(url).match(/bcsc-s\d{2}/)?.[0]])});
 ctx.window.location.hash=pool==='extra'?'#textbook-extra-'+q.id:'#textbook-'+q.id;a.qa.S.tab='textbook';
 a.document.currentScript={src:'https://example.test/scripts/textbook-depth.js'};
 const get=a.document.getElementById;a.document.getElementById=()=>null;
 vm.runInContext(fs.readFileSync(path.join(here,'textbook-depth.js'),'utf8'),ctx);a.document.getElementById=get;
 await ctx.window.OphTextbook.mount(root);
 const action=async(name,value=q.id)=>{handlers.get('click')({target:{closest:()=>({dataset:{tbAction:name,value},disabled:false})}});await a.settle();};
 return {root,action,async filter(value){handlers.get('change')({target:{matches:s=>s==='[data-tb-filter]',value}});await a.settle();},async remount(){await ctx.window.OphTextbook.mount(root);}};
}
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
(async()=>{
 await test('native shared submit needs an answer and correct feedback waits for one manual rating',async()=>{
  const a=fresh();a.action('all');a.action('submit');assert(!Object.keys(a.qa.entries).some(k=>k.startsWith('study:srs:')));
  const q=shared(a);assert.equal(record(a,'shared',q.id),null);a.action('submit');const r=record(a,'shared',q.id);assert(r&&r.plan===null&&!r.attempt.rated);assert(a.main().includes('選一次熟悉度'));
  const token=r.attempt.id;assert(a.study.grade('shared',q.id,token,'good'));assert.equal(record(a,'shared',q.id).plan.reviewCount,1);assert.equal(record(a,'shared',q.id).plan.dueAt,'2026-10-21T14:00:00.000Z');
  assert(!a.study.grade('shared',q.id,token,'easy'));a.action('submit');assert.equal(record(a,'shared',q.id).answerCount,1);
 });
 await test('wrong native submit auto-Again cannot be extended by a forged Easy click',async()=>{
  const a=fresh(),q=shared(a,false);a.action('submit');const r=record(a,'shared',q.id);assert.equal(r.plan.rating,'again');assert.equal(r.plan.dueAt,'2026-10-20T14:10:00.000Z');assert(!a.study.grade('shared',q.id,r.attempt.id,'easy'));assert.equal(r.plan.step,-1);
 });
 await test('leaving, retry, merge and reload cannot reuse a pending correct attempt',async()=>{
  const a=fresh(),q=shared(a);a.action('submit');let r=record(a,'shared',q.id);const token=r.attempt.id;
  a.action('tab','study');assert(!a.study.grade('shared',q.id,token,'easy'));
  a.action('practice-one',q.id);assert(!a.study.grade('shared',q.id,token,'easy'));a.action('retry');a.change('answer',{name:'answer',value:String(q.correctIndex)});a.action('submit');r=record(a,'shared',q.id);assert.equal(r.answerCount,2);
  a.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{},meta:{}});assert(!a.study.grade('shared',q.id,r.attempt.id,'good'));
  await a.runTimers(t=>t.ms===400);const b=fresh(a.local);b.action('practice-one',q.id);assert.equal(record(b,'shared',q.id).answerCount,2);assert(!b.study.grade('shared',q.id,r.attempt.id,'good'));
 });
 for(const pool of ['book','extra'])await test(pool+' actual choose/reveal hooks create one attempt and keep reasoning visible',async()=>{
  const a=fresh(),q=pool==='book'?volumes['bcsc-s07'].questions[0]:extra.questions[0],b=await textbook(a,q,pool);
  await b.filter('review');await b.action('reveal');assert.equal(record(a,pool,q.id),null);await b.action('answer',q.id+'|'+q.correctIndex);assert.equal(record(a,pool,q.id),null);
  await b.action('reveal');const r=record(a,pool,q.id);assert(r&&!r.attempt.rated&&r.plan===null);assert(b.root.innerHTML.includes(q.options[q.correctIndex].rationale));
  await b.action('reveal');assert.equal(record(a,pool,q.id).answerCount,1);assert(a.study.grade(pool,q.id,r.attempt.id,'hard'));assert.equal(record(a,pool,q.id).plan.dueAt,'2026-10-21T14:00:00.000Z');
  a.study.leave();await b.remount();assert(b.root.innerHTML.includes(q.stem),'explicit dashboard route must open its target despite review filter');assert(b.root.innerHTML.includes('value="all" selected'));await b.action('retry');assert(!a.study.grade(pool,q.id,r.attempt.id,'easy'));assert.equal(record(a,pool,q.id).plan.reviewCount,1);
 });
 await test('draft extra cannot grade or schedule and q110 routes to its real auxiliary volume',async()=>{
  const a=fresh(),draft=structuredClone(extra),q=draft.questions[0];q.readiness='draft';q.status='draft';const b=await textbook(a,q,'extra',draft);await b.action('answer',q.id+'|'+q.correctIndex);await b.action('reveal');assert.equal(record(a,'extra',q.id),null);
  const c=fresh(),q110=extra.questions.find(q=>q.id.endsWith('q110')),view=await textbook(c,q110,'extra');await view.action('answer',q110.id+'|'+q110.correctIndex);await view.action('reveal');
  for(const uid of q110.unitIds)assert(view.root.innerHTML.includes(uid.match(/^bcsc-s\d{2}/)[0]+'|'+uid),uid);
  const aux=q110.unitIds.find(id=>id.startsWith('bcsc-s11'));await view.action('linked-unit','bcsc-s11|'+aux);assert(c.context.window.location.hash.includes('bcsc-s11'));const unit=volumes['bcsc-s11'].chapters.flatMap(c=>c.units).find(u=>u.id===aux);assert(view.root.innerHTML.includes(unit.title));
  assert(q110.sourceRefs.some(r=>r.bookId==='bcsc-s11'));assert(view.root.innerHTML.includes('bcsc-s11'));
 });
 await test('v1-v3 imports, cloud export and local reload retain unknown future schedules without creating old-mastery plans',async()=>{
  for(const version of [1,2,3]){
   const a=fresh(),q=a.qa.D.questions[0],unknown='study:srs:future:future_q999';
   const value={version:1,at:'2026-10-20T14:00:00.000Z',answerCount:1,attempt:{id:'future-token',at:'2026-10-20T14:00:00.000Z',correct:false,rated:true},plan:{step:-1,dueAt:'2026-10-20T14:10:00.000Z',rating:'again',reviewCount:1,lapses:1}};
   a.qa.mergeProgress({format:'ophthalmology-prep-progress-v'+version,entries:{[unknown]:value,['q:'+q.id]:{choice:q.correctIndex,correct:true,at:value.at}},meta:{['q:'+q.id]:{recall:{mastered:true},at:value.at}}});
   assert.equal(record(a,'shared',q.id),null);assert.equal(a.qa.progressPayload().entries[unknown].plan.step,-1);await a.runTimers(t=>t.ms===400);
   const b=fresh(a.local);assert.equal(b.qa.entries[unknown].attempt.id,'future-token');assert.equal(b.qa.entries['q:'+q.id].correct,true);
  }
 });
 await test('today catalogue distinguishes now/later/new and manual practice remains available',async()=>{
  const a=fresh(),q=shared(a,false);a.action('submit');const handlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',addEventListener(n,fn){handlers.set(n,fn);}};
  a.context.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('textbook-manifest.json')?manifest:extra});await a.study.mount(root);
  assert(root.innerHTML.includes('今日稍後'));assert(root.innerHTML.includes('共筆 539 題'));assert(root.innerHTML.includes('原書概念 540 題'));assert(root.innerHTML.includes('自編陌生題 120 題'));assert(root.innerHTML.includes(q.stem));
  handlers.get('click')({target:{closest:()=>({dataset:{studyFilter:'all'},disabled:false})}});assert(root.innerHTML.includes('手動練習'));
 });
 console.log(JSON.stringify({pass:results.filter(r=>r.pass).length,total:results.length,results},null,2));if(results.some(r=>!r.pass))process.exitCode=1;
})();
