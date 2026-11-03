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
  assert(root.innerHTML.includes('今日稍後'));assert(root.innerHTML.includes('共筆 535 題'));assert(root.innerHTML.includes('原書概念 540 題'));assert(root.innerHTML.includes('自編陌生題 120 題'));assert(root.innerHTML.includes(q.stem));
  handlers.get('click')({target:{closest:()=>({dataset:{studyFilter:'all'},disabled:false})}});assert(root.innerHTML.includes('手動練習'));
 });
 await test('continuous due and weak review queues advance across due items and show interval previews',async()=>{
  const a=fresh(),q1=a.qa.D.questions[0],q2=a.qa.D.questions[1];
  a.action('practice-one',q1.id);a.change('answer',{name:'answer',value:String((q1.correctIndex+1)%4)});a.action('submit');
  a.action('practice-one',q2.id);a.change('answer',{name:'answer',value:String(q2.correctIndex)});a.action('submit');
  assert(a.main().includes('Again · 重練 (10分)'));assert(a.main().includes('Good · 熟悉 (1天)'));assert(a.main().includes('Easy · 很熟 (3天)'));assert(a.main().includes('下一題到期複習'));
  const token2=record(a,'shared',q2.id).attempt.id;assert(a.study.grade('shared',q2.id,token2,'hard'));
  a.study.setClock(()=>Date.parse('2026-10-21T15:00:00.000Z'));
  const first=await a.study.nextReview('due');assert.deepEqual(JSON.parse(JSON.stringify(first)),{pool:'shared',id:q1.id,remaining:2});assert.equal(a.qa.S.ids[a.qa.S.qi],q1.id);
  const second=await a.study.nextReview('due');assert.deepEqual(JSON.parse(JSON.stringify(second)),{pool:'shared',id:q2.id,remaining:2});assert.equal(a.qa.S.ids[a.qa.S.qi],q2.id);
  const weakNext=await a.study.nextReview('weak');assert.equal(weakNext.id,q1.id);
  const b=fresh(),bookQ=volumes['bcsc-s07'].questions[0];
  b.context.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('textbook-manifest.json')?manifest:extra});
  b.bridge.save(key('book',bookQ.id),{version:1,at:'2026-10-20T14:00:00.000Z',answerCount:1,attempt:{id:'book-t1',at:'2026-10-20T14:00:00.000Z',correct:false,rated:true},plan:{step:-1,dueAt:'2026-10-20T14:10:00.000Z',rating:'again',reviewCount:1,lapses:1}});
  b.study.setClock(()=>Date.parse('2026-10-20T14:15:00.000Z'));
  const bookPick=await b.study.nextReview('due');assert.deepEqual(JSON.parse(JSON.stringify(bookPick)),{pool:'book',id:bookQ.id,remaining:1});assert.equal(b.context.window.location.hash,'#textbook-'+bookQ.id);
 });
 await test('cram active-recall flashcards support Again/Hard/Good/Easy SRS scheduling and due filtering',async()=>{
  const a=fresh(),cramData=read('content/cram-review.json'),handlers=new Map();
  const root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return {focus(){},scrollIntoView(){}};},addEventListener(n,fn){handlers.set(n,fn);}};
  a.context.fetch=async()=>({ok:true,json:async()=>structuredClone(cramData)});
  a.document.currentScript={src:'https://example.test/scripts/cram-review.js'};
  const get=a.document.getElementById;a.document.getElementById=()=>null;
  vm.runInContext(fs.readFileSync(path.join(here,'cram-review.js'),'utf8'),a.context);
  a.document.getElementById=get;
  await a.context.window.OphCram.mount(root);
  const cardId=cramData.cards[0].id;
  handlers.get('click')({target:{closest:s=>s==='[data-cram-srs]'?{dataset:{id:cardId,cramSrs:'good'},closest:()=>({nextElementSibling:null})}:null}});
  let saved=JSON.parse(a.local.getItem('oph-prep:cram-review-v1'));
  assert.equal(saved[cardId].status,'known');assert.equal(saved[cardId].plan.step,0);assert.equal(saved[cardId].plan.dueAt,'2026-10-21T14:00:00.000Z');
  handlers.get('change')({target:{matches:s=>s==='[data-cram-filter]',value:'due'}});
  assert(!root.innerHTML.includes(`data-card-id="${cardId}"`),'card due tomorrow is not in due filter today');
  a.study.setClock(()=>Date.parse('2026-10-21T14:05:00.000Z'));
  handlers.get('change')({target:{matches:s=>s==='[data-cram-filter]',value:'due'}});
  assert(root.innerHTML.includes(`data-card-id="${cardId}"`),'card appears in due filter once dueAt arrives');
 });
 await test('granular sub-bank taxonomy indexes all 1,667 oph items, scopes due/weak queues by pool+volume, and routes cram/atlas/shared deep links',async()=>{
  const a=fresh(),cramData=read('content/cram-review.json'),atlasData=read('content/textbook-depth/visual-atlas.json'),hardData=read('content/textbook-depth/advanced-practice.json');
  a.document.currentScript={src:'https://example.test/scripts/advanced-practice.js'};
  vm.runInContext(fs.readFileSync(path.join(here,'advanced-practice.js'),'utf8'),a.context);
  const cramHandlers=new Map(),cramRoot={isConnected:true,dataset:{},innerHTML:'',querySelector(){return {focus(){},scrollIntoView(){}};},addEventListener(n,fn){cramHandlers.set(n,fn);}};
  a.document.currentScript={src:'https://example.test/scripts/cram-review.js'};
  const oldGet=a.document.getElementById;a.document.getElementById=()=>null;
  vm.runInContext(fs.readFileSync(path.join(here,'cram-review.js'),'utf8'),a.context);
  a.document.currentScript={src:'https://example.test/scripts/textbook-atlas.js'};
  vm.runInContext(fs.readFileSync(path.join(here,'textbook-atlas.js'),'utf8'),a.context);
  a.document.getElementById=oldGet;
  a.context.fetch=async url=>{
   const u=String(url);
   const payload=u.includes('textbook-manifest.json')?manifest:u.includes('advanced-practice.json')?hardData:u.includes('additional-practice.json')?extra:u.includes('cram-review.json')?cramData:u.includes('visual-atlas.json')?atlasData:volumes[u.match(/bcsc-s\d{2}/)?.[0]];
   return {ok:!!payload,json:async()=>structuredClone(payload)};
  };
  await a.context.window.OphCram.mount(cramRoot);
  const studyHandlers=new Map(),studyRoot={isConnected:true,dataset:{},innerHTML:'',addEventListener(n,fn){studyHandlers.set(n,fn);}};
  await a.study.mount(studyRoot);
  assert(studyRoot.innerHTML.includes('共筆 535 題'));
  assert(studyRoot.innerHTML.includes('原書概念 540 題'));
  assert(studyRoot.innerHTML.includes('自編陌生題 264 題（Hard 144 ＋ 陌生病例 120）'));
  assert(studyRoot.innerHTML.includes('衝刺卡 18 張'));
  assert(studyRoot.innerHTML.includes('圖解回想 310 題'));
  studyHandlers.get('click')({target:{closest:()=>({dataset:{studyFilter:'all'},disabled:false})}});
  assert(studyRoot.innerHTML.includes('1667 題；顯示 1–30'),'all 1,667 items indexed across all oph pools');
  const expectedCounts=[['shared',535],['shared-notes',292],['shared-kaogu',243],['book',540],['extra',264],['hard',144],['extra-legacy',120],['cram',18],['atlas',310]];
  for(const [poolVal,cnt] of expectedCounts){
   studyHandlers.get('change')({target:{matches:s=>s==='[data-study-pool]',value:poolVal}});
   assert(studyRoot.innerHTML.includes(cnt+' 題；顯示'),poolVal+' count should be '+cnt);
  }
  // Check chapter-inline normalization on book pool
  studyHandlers.get('change')({target:{matches:s=>s==='[data-study-pool]',value:'book'}});
  assert(studyRoot.innerHTML.includes('data-study-volume'),'book pool renders secondary volume selector');
  studyHandlers.get('change')({target:{matches:s=>s==='[data-study-volume]',value:'bcsc-s01'}});
  const s01BookCount=manifest.books.find(b=>b.bookId==='bcsc-s01').sourceQuestions.length;
  assert(studyRoot.innerHTML.includes(s01BookCount+' 題；顯示'));
  assert(!studyRoot.innerHTML.includes('chapter-inline'));

  // Seed due & weak records across multiple pools and verify strict scope isolation
  const dueAt='2026-10-20T13:50:00.000Z',mkDue=(id,lapses=1)=>({version:1,at:dueAt,answerCount:lapses,attempt:{id:'tok-'+id,at:dueAt,correct:false,rated:true},plan:{step:-1,dueAt,rating:'again',reviewCount:lapses,lapses}});
  const notesQ=a.qa.D.questions.find(q=>!q.pastExam),kaoguQ=a.qa.D.questions.find(q=>q.pastExam);
  const bookS01=manifest.books.find(b=>b.bookId==='bcsc-s01').sourceQuestions[0].sourceQuestionKey;
  const bookS07=manifest.books.find(b=>b.bookId==='bcsc-s07').sourceQuestions[0].sourceQuestionKey;
  const hardQ=hardData.questions[0].id,legacyExtraQ=extra.questions[0].id,cramQ=cramData.cards[2].id,atlasS09='atlas-s09-01-case';
  a.bridge.save(key('shared',notesQ.id),mkDue(notesQ.id,3));
  a.bridge.save(key('shared',kaoguQ.id),mkDue(kaoguQ.id,1));
  a.bridge.save(key('book',bookS01),mkDue(bookS01,4));
  a.bridge.save(key('book',bookS07),mkDue(bookS07,1));
  a.bridge.save(key('extra',hardQ),mkDue(hardQ,1));
  a.bridge.save(key('extra',legacyExtraQ),mkDue(legacyExtraQ,2));
  a.bridge.save(key('cram',cramQ),mkDue(cramQ,1));
  a.bridge.save(key('atlas',atlasS09),mkDue(atlasS09,1));

  a.study.setScope('shared-kaogu');
  assert.deepEqual(Array.from(a.study.nextCandidates('due'),x=>x.id),[kaoguQ.id]);
  const pickedKaogu=await a.study.nextReview('due');
  assert.equal(pickedKaogu.id,kaoguQ.id);
  assert.equal(a.qa.S.tab,'quiz');
  assert.equal(a.qa.S.mode,'due','opening due shared item from SRS enters #quiz due mode');
  assert.deepEqual(Array.from(a.qa.S.ids).sort(),[notesQ.id,kaoguQ.id].sort(),'#quiz due mode holds only due shared items');

  a.study.setScope('shared-notes');
  const pickedWeakNotes=await a.study.nextReview('weak');
  assert.equal(pickedWeakNotes.id,notesQ.id);
  assert.equal(a.qa.S.mode,'srs-weak','opening weak shared item from SRS enters #quiz srs-weak mode');

  a.study.setScope('book','bcsc-s07');
  assert.deepEqual(Array.from(a.study.nextCandidates('due'),x=>x.id),[bookS07]);
  const pickedBook=await a.study.nextReview('due');
  assert.equal(pickedBook.id,bookS07);
  assert.equal(a.context.window.location.hash,'#textbook-'+bookS07);

  a.study.setScope('hard');
  assert.deepEqual(Array.from(a.study.nextCandidates('due'),x=>x.id),[hardQ]);

  a.study.setScope('cram');
  const pickedCram=await a.study.nextReview('due');
  assert.equal(pickedCram.id,cramQ);
  assert.equal(a.qa.S.tab,'cram');
  assert(cramRoot.innerHTML.includes(`data-card-id="${cramQ}"`)&&cramRoot.innerHTML.includes('<details class="cram-answer" open>'),'cram deep-link opens target flashcard details');

  a.study.setScope('atlas','bcsc-s09');
  assert.deepEqual(Array.from(a.study.nextCandidates('due'),x=>x.id),[atlasS09]);
  const pickedAtlas=await a.study.nextReview('due');
  assert.equal(pickedAtlas.id,atlasS09);
  assert.equal(a.context.window.location.hash,'#textbook-atlas-bcsc-s09-atlas-s09-01');
 });
 await test('cram 1-way migration syncs existing cram-review-v1 schedules to OphStudyBridge and v1-v3 roundtrip preserves cram + atlas SRS entries',async()=>{
  const local=new MemoryStorage(),cramData=read('content/cram-review.json');
  const c0=cramData.cards[0].id,c1=cramData.cards[1].id;
  local.setItem('oph-prep:cram-review-v1',JSON.stringify({
   [c0]:{status:'review',at:'2026-10-19T10:00:00.000Z',plan:{step:0,dueAt:'2026-10-20T10:00:00.000Z',rating:'hard',reviewCount:2,lapses:1}}
  }));
  const a=fresh(local),handlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return {focus(){},scrollIntoView(){}};},addEventListener(n,fn){handlers.set(n,fn);}};
  a.context.fetch=async()=>({ok:true,json:async()=>structuredClone(cramData)});
  a.document.currentScript={src:'https://example.test/scripts/cram-review.js'};
  const oldGet=a.document.getElementById;a.document.getElementById=()=>null;
  vm.runInContext(fs.readFileSync(path.join(here,'cram-review.js'),'utf8'),a.context);
  a.document.getElementById=oldGet;
  await a.context.window.OphCram.mount(root);
  for(const label of ['重來 · 10 分鐘','微卡 · 1 天','記得 · 1–30 天','很熟 · 跳階'])assert(root.innerHTML.includes(label),'missing updated cram label '+label);
  const mig=record(a,'cram',c0);
  assert(mig&&mig.version===1&&mig.plan.rating==='hard'&&mig.plan.dueAt==='2026-10-20T10:00:00.000Z','1-way migration populates study:srs:cram:<id>');
  handlers.get('click')({target:{closest:s=>s==='[data-cram-srs]'?{dataset:{id:c1,cramSrs:'easy'},closest:()=>({nextElementSibling:null})}:null}});
  const rated=record(a,'cram',c1);
  assert.equal(rated.plan.rating,'easy');assert.equal(rated.plan.step,1);assert.equal(rated.plan.dueAt,'2026-10-23T14:00:00.000Z');
  const mirrored=JSON.parse(a.local.getItem('oph-prep:cram-review-v1'))[c1];
  assert.equal(mirrored.plan.dueAt,'2026-10-23T14:00:00.000Z');
  a.bridge.save('study:srs:atlas:atlas-s01-01-case',{version:1,at:'2026-10-20T14:00:00.000Z',answerCount:1,attempt:{id:'atlas-t1',at:'2026-10-20T14:00:00.000Z',correct:true,rated:true},plan:{step:0,dueAt:'2026-10-21T14:00:00.000Z',rating:'good',reviewCount:1,lapses:0}});
  const exported=a.qa.progressPayload();
  for(const ver of [1,2,3]){
   const b=fresh();
   b.qa.mergeProgress({format:'ophthalmology-prep-progress-v'+ver,entries:structuredClone(exported.entries),meta:{}});
   assert.equal(record(b,'cram',c1).plan.dueAt,'2026-10-23T14:00:00.000Z','v'+ver+' preserves cram SRS');
   assert.equal(record(b,'atlas','atlas-s01-01-case').plan.dueAt,'2026-10-21T14:00:00.000Z','v'+ver+' preserves atlas SRS');
  }
 });
 await test('cram manual self-rating preserves SRS plan across refresh/remount, card reset removes study:srs:cram:<id>, and array plan is ignored safely',async()=>{
  const local=new MemoryStorage(),cramData=read('content/cram-review.json');
  const cGood=cramData.cards[0].id,cArr=cramData.cards[1].id;
  local.setItem('oph-prep:cram-review-v1',JSON.stringify({
   [cArr]:{status:'review',at:'2026-10-19T10:00:00.000Z',plan:[]}
  }));
  const a=fresh(local),handlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return {focus(){},scrollIntoView(){}};},addEventListener(n,fn){handlers.set(n,fn);}};
  let clockMs=Date.parse('2026-10-20T14:00:00.000Z');
  a.study.setClock(()=>clockMs);
  a.context.fetch=async()=>({ok:true,json:async()=>structuredClone(cramData)});
  a.document.currentScript={src:'https://example.test/scripts/cram-review.js'};
  const oldGet=a.document.getElementById;a.document.getElementById=()=>null;
  vm.runInContext(fs.readFileSync(path.join(here,'cram-review.js'),'utf8'),a.context);
  a.document.getElementById=oldGet;
  await a.context.window.OphCram.mount(root);
  const cardSnippet=id=>root.innerHTML.match(new RegExp(`<article class="cram-card" data-card-id="${id}">[\\s\\S]*?<\\/article>`))?.[0]||'';

  // (c) Malformed array plan: [] must NOT synthesize a migrated SRS entry or render undefined dueAt
  assert.equal(record(a,'cram',cArr),null,'plan: [] in cram-review-v1 must not migrate to OphStudyBridge');
  assert(cardSnippet(cArr).includes('cram-badge review')&&!cardSnippet(cArr).includes('下次'),'plan: [] keeps manual review status without bogus schedule');

  // (a) Schedule card via [data-cram-srs="good"], then mark [data-cram-mark="review"] (even at same frozen ms first, then advanced ms), refresh & remount
  handlers.get('click')({target:{closest:s=>s==='[data-cram-srs]'?{dataset:{id:cGood,cramSrs:'good'},closest:()=>({nextElementSibling:null})}:null}});
  assert(cardSnippet(cGood).includes('cram-badge known')&&cardSnippet(cGood).includes('下次'));
  assert.equal(record(a,'cram',cGood).plan.dueAt,'2026-10-21T14:00:00.000Z');

  handlers.get('click')({target:{closest:s=>s==='[data-cram-mark]'?{dataset:{id:cGood,cramMark:'review'},closest:()=>({nextElementSibling:null})}:null}});
  a.context.window.OphCram.refresh();
  assert(cardSnippet(cGood).includes('cram-badge review')&&cardSnippet(cGood).includes('下次'),'same-ms manual 待複習 survives OphCram.refresh() and keeps SRS due date');

  clockMs+=5000;
  handlers.get('click')({target:{closest:s=>s==='[data-cram-mark]'?{dataset:{id:cGood,cramMark:'review'},closest:()=>({nextElementSibling:null})}:null}});
  a.context.window.OphCram.refresh();
  await a.context.window.OphCram.mount(root);
  assert(cardSnippet(cGood).includes('cram-badge review')&&cardSnippet(cGood).includes('下次'),'remount preserves manual 待複習 status AND SRS plan');
  assert.equal(record(a,'cram',cGood).plan.dueAt,'2026-10-21T14:00:00.000Z','SRS entry in OphStudyBridge remains intact');

  // Newer cloud-synced SRS record (bAt > locAt) still wins cleanly on refresh
  const syncAt='2026-10-20T15:00:00.000Z';
  a.bridge.save(key('cram',cGood),{version:1,at:syncAt,answerCount:2,attempt:{id:'sync-1',at:syncAt,correct:true,rated:true},plan:{step:2,dueAt:'2026-10-27T15:00:00.000Z',rating:'easy',reviewCount:2,lapses:0}});
  a.context.window.OphCram.refresh();
  assert(cardSnippet(cGood).includes('cram-badge known'),'strictly newer cloud-synced SRS record updates status');

  // (b) Reset card via [data-cram-mark="new"] (重設此卡): clears badge to 尚未自評, removes OphStudyBridge entry, and persists across refresh/remount
  clockMs=Date.parse('2026-10-20T16:00:00.000Z');
  handlers.get('click')({target:{closest:s=>s==='[data-cram-mark]'?{dataset:{id:cGood,cramMark:'new'},closest:()=>({nextElementSibling:null})}:null}});
  assert.equal(record(a,'cram',cGood),null,'重設此卡 removes study:srs:cram:<id> from OphStudyBridge');
  assert(cardSnippet(cGood).includes('cram-badge new')&&cardSnippet(cGood).includes('尚未自評')&&!cardSnippet(cGood).includes('下次'),'重設此卡 clears badge and due date');
  a.context.window.OphCram.refresh();
  await a.context.window.OphCram.mount(root);
  assert.equal(record(a,'cram',cGood),null,'study:srs:cram:<id> stays removed after refresh & remount');
  assert(cardSnippet(cGood).includes('cram-badge new')&&!cardSnippet(cGood).includes('下次'),'card stays new across refresh & remount');
 });
 console.log(JSON.stringify({pass:results.filter(r=>r.pass).length,total:results.length,results},null,2));if(results.some(r=>!r.pass))process.exitCode=1;
})();
