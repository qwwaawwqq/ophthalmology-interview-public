const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
const source=fs.readFileSync(path.join(__dirname,'textbook-depth.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/textbook-manifest.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/textbook-depth/bcsc-s07.json'),'utf8'));
assert(fixture.questions.length,'The module tests require one real authored volume, not an invented empty book.');
for(const c of fixture.chapters)for(const u of c.units)u.status='draft';
for(const row of fixture.coverage.chapterRows){row.teachingStatus='draft';row.coverageStatus='partial';}
fixture.coverage.summary.taughtChapters=0;
fixture.questions=fixture.questions.slice(0,4).map(q=>({...q,readiness:'ready'}));
function moduleBoot(progress=new Map(),hash='#textbook',volume=fixture,env={}){
 const calls=[],handlers=new Map(),windowHandlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return null;},addEventListener(n,fn){handlers.set(n,fn);}};
 const window={location:{hash},history:{replaceState(_a,_b,value){window.location.hash=value;}},addEventListener(name,fn){windowHandlers.set(name,fn);},OphTextbookBridge:{read(k,id){return progress.get(k+':'+id)||null;},write(k,id,v){progress.set(k+':'+id,{...v,at:new Date().toISOString()});},rememberLocation(){}}};
 const context={window,document:{currentScript:{src:'https://example.test/scripts/textbook-depth.js'},getElementById(){return null;}},URL:env.URL||URL,Blob,Map,Promise,console,fetch:async url=>{calls.push(String(url));const data=String(url).endsWith('textbook-manifest.json')?manifest:String(url).endsWith('additional-practice.json')?env.extra:volume;if(!data)return {ok:false,json:async()=>null};return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};}};
 vm.createContext(context);
 vm.runInContext(source.replace('window.OphTextbook={mount};','window.OphTextbook={mount,__test:{optionOrder,route,choosePdf,localPdfs}};'),context);
 return {api:window.OphTextbook,root,calls,progress,window,windowHandlers,async mount(){await window.OphTextbook.mount(root);},async filter(value){handlers.get('change')({target:{matches:selector=>selector==='[data-tb-filter]',value}});for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));},async action(kind,value=''){handlers.get('click')({target:{closest:()=>({dataset:{tbAction:kind,value},disabled:false})}});for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));}};
}
(async()=>{
 await test('no book payload is fetched until the textbook view and a volume are opened',async()=>{
  const b=moduleBoot();assert.equal(b.calls.length,0);await b.mount();assert.equal(b.calls.length,1);assert(b.root.innerHTML.includes('原文書進階'));assert.equal((b.root.innerHTML.match(/class="tb-book"/g)||[]).length,13);await b.action('book','bcsc-s07');assert.equal(b.calls.length,2);assert(b.calls[1].endsWith('bcsc-s07.json'));assert(b.root.innerHTML.includes('機轉與因果'));
 });
 await test('a volume/question deep link opens the correct source concept and all four option rationales',async()=>{
  const q=fixture.questions[0],b=moduleBoot(new Map(),'#textbook-bcsc-s07-'+q.id.slice('bcsc-s07-'.length));await b.mount();assert(b.root.innerHTML.includes(q.stem));await b.action('answer',q.id+'|'+q.correctIndex);await b.action('reveal',q.id);assert(b.root.innerHTML.includes('答對了'));for(const o of q.options)assert(b.root.innerHTML.includes(o.rationale));
 });
 await test('deterministic display shuffling preserves source indices, judging, rationales and reload state',async()=>{
  const q=fixture.questions[0],store=new Map(),hash='#textbook-bcsc-s07-'+q.id.slice('bcsc-s07-'.length),b=moduleBoot(store,hash);await b.mount();const order=Array.from(b.api.__test.optionOrder(q));assert.deepEqual([...order].sort(),[0,1,2,3]);const positions=new Set(Array.from({length:30},(_,i)=>b.api.__test.optionOrder({id:'bcsc-s07-rq'+String(i+1).padStart(3,'0')}).indexOf(0)));assert(positions.size>=3,'correct options must not all appear in one display position');await b.action('answer',q.id+'|'+q.correctIndex);await b.action('reveal',q.id);assert.equal(store.get('question:'+q.id).choice,q.correctIndex);const c=moduleBoot(store,hash);await c.mount();assert.deepEqual(Array.from(c.api.__test.optionOrder(q)),order);assert(c.root.innerHTML.includes('答對了'));const wrong=(q.correctIndex+1)%4;await c.action('retry',q.id);await c.action('answer',q.id+'|'+wrong);await c.action('reveal',q.id);assert(c.root.innerHTML.includes('先找出改變答案的線索'));assert.equal(store.get('question:'+q.id).choice,wrong);
 });
 await test('source figure verification and learner mastery remain distinct on the reading page',async()=>{
  const b=moduleBoot();await b.mount();await b.action('book','bcsc-s07');const u=fixture.chapters[0].units[0];await b.action('rate',u.id+'|known');assert.equal(b.progress.get('unit:'+u.id).rating,'known');assert(b.root.innerHTML.includes('原圖尚未核對'));assert(b.root.innerHTML.includes('原圖已核對 0 項'));
 });
 await test('authored drafts are visible for review but never graded or counted as source-checked',async()=>{
  const q=fixture.questions[0],old=q.readiness;q.readiness='draft';try{const b=moduleBoot(new Map(),'#textbook-bcsc-s07-'+q.id.slice('bcsc-s07-'.length));await b.mount();assert(b.root.innerHTML.includes('仍待來源與醫學核對'));assert(b.root.innerHTML.includes('已編寫 15 / 15 章，已核對 0 章'));await b.action('answer',q.id+'|'+q.correctIndex);assert.equal(b.progress.size,0);assert(!b.root.innerHTML.includes('答對了'));}finally{q.readiness=old;}
 });
 await test('real section 1 clinical updates appear on each linked chapter and question',async()=>{
  const b1=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/textbook-depth/bcsc-s01.json'),'utf8'));
  assert(b1.clinicalUpdates?.length>=3,'real authored clinical update fixture required');
  const visible=x=>String(x).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  for(const update of b1.clinicalUpdates){
   assert(update.questionIds?.length||update.chapterIds?.length,'every primary note must have a visible linked target');
   for(const id of update.questionIds||[]){const q=moduleBoot(new Map(),'#textbook-'+id,b1);await q.mount();assert(q.root.innerHTML.includes(visible(update.statement)),id);assert(q.root.innerHTML.includes(visible(update.source.url)),id);}
   for(const id of update.chapterIds||[]){const ch=moduleBoot(new Map(),'#textbook-'+id,b1);await ch.mount();assert(ch.root.innerHTML.includes(visible(update.statement)),id);}
  }
 });
 await test('checked units do not certify the rest of a chapter with unreviewed source gaps',async()=>{
  const {execFileSync}=require('node:child_process');
  const check=`import importlib.util,json
from pathlib import Path
p=Path('scripts/validate-textbook.py');sp=importlib.util.spec_from_file_location('v',p);v=importlib.util.module_from_spec(sp);sp.loader.exec_module(v)
m=json.loads(Path('content/textbook-manifest.json').read_text());b=json.loads(Path('content/textbook-depth/bcsc-s07.json').read_text())
for c in b['chapters']:
 for u in c['units']:u['status']='independently-reviewed'
for r in b['coverage']['chapterRows']:r['coverageStatus']='partial'
s=v.validate_book(b,m['books'][6]);assert s['taughtChapters']==0
assert all(r['teachingStatus']=='partial' for r in b['coverage']['chapterRows'])
`;
  execFileSync('python3',['-c',check],{cwd:path.join(__dirname,'..')});
 });
 await test('strict acceptance rejects real complete-shaped drafts, partial chapters, unmatched answers and missing required figures',async()=>{
  const {execFileSync}=require('node:child_process');
  const check=`import importlib.util,json,copy
from pathlib import Path
p=Path('scripts/validate-textbook.py');sp=importlib.util.spec_from_file_location('v',p);v=importlib.util.module_from_spec(sp);sp.loader.exec_module(v)
m=json.loads(Path('content/textbook-manifest.json').read_text());original=json.loads(Path('content/textbook-depth/bcsc-s13.json').read_text());ex=m['books'][12]
def fails(b):
 try:v.validate_book(b,ex,True)
 except ValueError:return
 raise AssertionError('strict acceptance incorrectly passed')
draft=copy.deepcopy(original)
for c in draft['chapters']:
 for u in c['units']:u['status']='draft'
for q in draft['questions']:q['status']='draft'
for r in draft['coverage']['chapterRows']:r['coverageStatus']='partial'
fails(draft)
b=copy.deepcopy(original)
for c in b['chapters']:
 for u in c['units']:u['status']='source-checked'
for q in b['questions']:q.update(status='source-checked',imageStatus='not-applicable',requiresImage=False)
for r in b['coverage']['chapterRows']:r.update(coverageStatus='independently-reviewed',originalImageStatus='not-reviewed')
for r in b['coverage']['questionRows']:r.update(sourceAnswerStatus='matched',originalImageStatus='not-applicable')
assert v.validate_book(copy.deepcopy(b),ex,True)['readyQuestions']==40
# Real complete fixture remains source-reviewed while only duplicated coverage links drift.
for axis in ['chapter','question']:
 for kind in ['missing','extra','duplicate']:
  bad=copy.deepcopy(b);rows=bad['coverage'][axis+'Rows'];ids=rows[0]['unitIds'];extra=bad['chapters'][-1]['units'][-1]['id']
  rows[0]['unitIds']=(ids[1:] if kind=='missing' else ids+[extra] if kind=='extra' else ids+[ids[0]])
  try:v.validate_book(bad,ex,True)
  except ValueError as err:assert axis+' coverage unitIds drift' in str(err)
  else:raise AssertionError(axis+' '+kind+' coverage drift was silently normalized')
for mutation in ['unit','question','chapter','answer','figure','changedfact','noevidence']:
 bad=copy.deepcopy(b)
 if mutation=='unit':bad['chapters'][0]['units'][0]['status']='draft'
 if mutation=='question':bad['questions'][0]['status']='draft'
 if mutation=='chapter':bad['coverage']['chapterRows'][0]['coverageStatus']='partial'
 if mutation=='answer':bad['coverage']['questionRows'][0]['sourceAnswerStatus']='unverified'
 if mutation=='figure':bad['questions'][0]['requiresImage']=True
 if mutation=='changedfact':bad['chapters'][0]['units'][0]['mechanism'][0]+=' altered after approval'
 if mutation=='noevidence':bad.pop('review',None)
 fails(bad)
b['questions'][0].update(requiresImage=True,imageStatus='verified');b['coverage']['questionRows'][0]['originalImageStatus']='verified'
b['review']['questionContentHashes'][b['questions'][0]['id']]=v.reviewed_item_hash(b['questions'][0])
assert v.validate_book(b,ex,True)['readyQuestions']==40
claims,_=v.numeric_claims(original);words=[c['statement'] for c in claims]
for expected in ['193 nm','81.7','1–2','6–12','數週','數月']:
 assert any(expected in x for x in words),expected+' was missed'
assert all(not x['field'].startswith('source') for x in claims)
`;
  execFileSync('python3',['-c',check],{cwd:path.join(__dirname,'..')});
 });
 await test('local PDF selection validates MIME/header, isolates books, links safe pages and never persists/uploads',async()=>{
  const created=[],revoked=[];
  class PdfURL extends URL{static createObjectURL(blob){assert.equal(blob.type,'application/pdf');const url='blob:https://example.test/local-'+(created.length+1);created.push({url,blob});return url;}static revokeObjectURL(url){revoked.push(url);}}
  const make=(text,type='application/pdf',name='own.pdf')=>{const blob=new Blob([text],{type});Object.defineProperty(blob,'name',{value:name});return blob;};
  const input=(id,file)=>({dataset:{book:id},files:[file],value:'fake-input-value'});
  const pdfFixture=JSON.parse(JSON.stringify(fixture));pdfFixture.chapters[0].sourceRefs[0].pdfPages.push(0,999999,1.5,'<invalid>');
  const b=moduleBoot(new Map(),'#textbook',pdfFixture,{URL:PdfURL});await b.mount();await b.action('book','bcsc-s07');const networkBefore=b.calls.length;
  assert(b.root.innerHTML.includes('版次與頁序尚未比對'));
  await b.api.__test.choosePdf(input('bcsc-s07',make('<html>unsafe</html>','text/html','pretend.pdf')));assert.equal(created.length,0);
  await b.api.__test.choosePdf(input('bcsc-s07',make('<html>unsafe</html>')));assert.equal(created.length,0);
  await b.api.__test.choosePdf(input('bcsc-s07',make('%PDF-1.7\nlocal fixture')));assert.equal(created.length,1);assert(b.root.innerHTML.includes('blob:https://example.test/local-1#page='));assert(b.root.innerHTML.includes('target="_blank" rel="noopener noreferrer"'));
  const previous=b.api.__test.localPdfs.get('bcsc-s07').url;
  await b.api.__test.choosePdf(input('bcsc-s07',make('%PDF-HTML','text/html')));assert.equal(created.length,1);assert.equal(b.api.__test.localPdfs.get('bcsc-s07').url,previous);assert.equal(revoked.length,0);
  await b.api.__test.choosePdf(input('bcsc-s08',make('%PDF-1.7\nsecond book')));assert.equal(created.length,2);assert.equal(b.api.__test.localPdfs.get('bcsc-s07').url,previous);assert(!b.root.innerHTML.includes('local-2#page='));
  await b.api.__test.choosePdf(input('bcsc-s07',make('%PDF-1.7\nreplacement','application/pdf','<private>.pdf')));assert.equal(created.length,3);assert.deepEqual(revoked,[previous]);assert(b.root.innerHTML.includes('&lt;private&gt;.pdf'));
  assert.equal(b.calls.length,networkBefore);assert.equal(b.progress.size,0);
  assert(!b.root.innerHTML.includes('#page=999999'));assert(!b.root.innerHTML.includes('#page=1.5'));assert(b.root.innerHTML.includes('&lt;invalid&gt;'));
  let resolve;const waiting={type:'application/pdf',name:'late.pdf',slice(){return {arrayBuffer:()=>new Promise(r=>{resolve=r;})};}};
  const pending=b.api.__test.choosePdf(input('bcsc-s07',waiting));b.windowHandlers.get('pagehide')();resolve(new TextEncoder().encode('%PDF-').buffer);await pending;assert.equal(created.length,3,'unload must invalidate pending file reads');assert.equal(b.api.__test.localPdfs.size,0);assert.deepEqual(revoked,[previous,'blob:https://example.test/local-3','blob:https://example.test/local-2']);b.windowHandlers.get('beforeunload')();assert.equal(revoked.length,3);
  const reload=moduleBoot(new Map(),'#textbook',fixture,{URL:PdfURL});await reload.mount();await reload.action('book','bcsc-s07');assert(reload.root.innerHTML.includes('尚未選擇原書'));assert(!reload.root.innerHTML.includes('blob:https://example.test/'));
 });
 const extraQuestion={...JSON.parse(JSON.stringify(fixture.questions[0])),id:'extra-20261020-q001',questionScope:'original-practice',bookId:'bcsc-s07',requiresImage:false,imageStatus:'not-applicable',status:'source-checked',readiness:'ready'};
 const extraFixture={schemaVersion:1,packId:'additional-20261020',origin:'original-extra-practice',notice:'全新原創病例練習，非原書題',questions:[extraQuestion]};
 await test('extra practice loads only on request and keeps the 13-volume 540-concept denominator',async()=>{
  const b=moduleBoot(new Map(),'#textbook',fixture,{extra:extraFixture});await b.mount();assert(b.root.innerHTML.includes('540 個原書題目概念'));assert.equal((b.root.innerHTML.match(/class="tb-book"/g)||[]).length,13);assert(!b.calls.some(x=>x.endsWith('additional-practice.json')));await b.action('extra');assert.equal(b.calls.filter(x=>x.endsWith('additional-practice.json')).length,1);assert(b.root.innerHTML.includes('本區額外 1 題'));assert(b.root.innerHTML.includes('自編原創練習'));assert(!b.root.innerHTML.includes('原書題號 undefined'));await b.action('library');assert(b.root.innerHTML.includes('540 個原書題目概念'));assert.equal((b.root.innerHTML.match(/class="tb-book"/g)||[]).length,13);
 });
 await test('extra grading, shuffle, reveal and reload preserve source option indices in a separate namespace',async()=>{
  const store=new Map(),hash='#textbook-extra-'+extraQuestion.id,b=moduleBoot(store,hash,fixture,{extra:extraFixture});await b.mount();const order=Array.from(b.api.__test.optionOrder(extraQuestion));await b.action('answer',extraQuestion.id+'|'+extraQuestion.correctIndex);assert.equal(store.get('extra-question:'+extraQuestion.id).choice,extraQuestion.correctIndex);assert.equal(store.get('question:'+extraQuestion.id),undefined);await b.action('reveal',extraQuestion.id);assert(b.root.innerHTML.includes('答對了'));for(const option of extraQuestion.options)assert(b.root.innerHTML.includes(option.rationale));const c=moduleBoot(store,hash,fixture,{extra:extraFixture});await c.mount();assert.deepEqual(Array.from(c.api.__test.optionOrder(extraQuestion)),order);assert(c.root.innerHTML.includes('答對了'));await c.action('retry',extraQuestion.id);const wrong=(extraQuestion.correctIndex+1)%4;await c.action('answer',extraQuestion.id+'|'+wrong);await c.action('reveal',extraQuestion.id);assert(c.root.innerHTML.includes('先找出改變答案的線索'));assert.equal(store.get('extra-question:'+extraQuestion.id).choice,wrong);const draft=JSON.parse(JSON.stringify(extraFixture));draft.questions[0].readiness='draft';const d=moduleBoot(new Map(),hash,fixture,{extra:draft});await d.mount();await d.action('answer',extraQuestion.id+'|0');assert.equal(d.progress.size,0);
 });
 await test('extra practice opens its exact teaching unit without marking it as mastered',async()=>{
  const q=extraQuestion,b=moduleBoot(new Map(),'#textbook-extra-'+q.id,fixture,{extra:extraFixture});await b.mount();await b.action('answer',q.id+'|'+q.correctIndex);await b.action('reveal',q.id);assert(b.root.innerHTML.includes('data-tb-action="linked-unit"'));const uid=q.unitIds[0];await b.action('linked-unit',q.bookId+'|'+uid);assert.equal(b.window.location.hash,'#textbook-'+uid);assert(b.root.innerHTML.includes('id="'+uid+'"'));assert(!b.progress.has('unit:'+uid));const again=moduleBoot(new Map(),'#textbook-'+uid,fixture);await again.mount();assert(again.root.innerHTML.includes('id="'+uid+'"'));
 });
 await test('review filters retain a just-revealed correct answer until navigation so both source and extra reasoning stay readable',async()=>{
  const second={...extraQuestion,id:'extra-20261020-q002',stem:'Second private fixture '+extraQuestion.stem},pack={...extraFixture,questions:[extraQuestion,second]};
  for(const extra of [false,true]){const q=extra?extraQuestion:fixture.questions[0],next=extra?second:fixture.questions[1],hash=extra?'#textbook-extra-'+q.id:'#textbook-'+q.id,b=moduleBoot(new Map(),hash,fixture,{extra:pack});await b.mount();await b.filter('review');await b.action('answer',q.id+'|'+q.correctIndex);await b.action('reveal',q.id);assert(b.root.innerHTML.includes(q.stem));assert(b.root.innerHTML.includes(q.options[0].rationale));assert(b.progress.get((extra?'extra-question:':'question:')+q.id).revealed);await b.action('question',next.id);assert(b.root.innerHTML.includes(next.stem));assert(!b.root.innerHTML.includes('<h2>'+q.stem+'</h2>'));await b.filter('all');assert(b.root.innerHTML.includes(q.stem));}
 });
 // Reuse the existing app harness to exercise real restore/import/cloud validation before any textbook JSON is fetched.
 const helper=fs.readFileSync(path.join(__dirname,'test-progress-sync.cjs'),'utf8');
 const setup=helper.slice(0,helper.indexOf('(async () => {')).replace('globalThis.__qa={D,S,','globalThis.__qa={bridge:window.OphTextbookBridge,D,S,');
 const checks=`(async()=>{
  const extra='textbook:extra-question:extra-20261020-q120',key='textbook:question:bcsc-s13-rq040',rating='textbook:unit:bcsc-s13-ch010-u01',at='2026-10-20T00:00:00.000Z';
  const local=new MemoryStorage(),github=fakeGitHub();
  local.setItem('oph-prep:progress-v3',JSON.stringify({format:'ophthalmology-prep-progress-v3',exportedAt:at,entries:{[extra]:{choice:3,revealed:true,at},[key]:{choice:2,revealed:true,at},[rating]:{rating:'known',at}},meta:{}}));
  const a=boot({local,session:new MemoryStorage(),github,hash:'#textbook-bcsc-s13-rq040'});a.windowHandlers.get('load')();
  assert.equal(a.qa.S.tab,'textbook');assert.equal(a.qa.entries[key].choice,2);assert.equal(a.qa.entries[extra].choice,3);assert.equal(a.qa.entries[rating].rating,'known');
  for(const version of ['v1','v2','v3']){a.qa.mergeProgress({format:'ophthalmology-prep-progress-'+version,entries:{[extra]:{choice:2,revealed:true,at:'2026-10-21T00:00:00.000Z'},[key]:{choice:1,revealed:true,at:'2026-10-21T00:00:00.000Z'}},meta:{}});assert.equal(a.qa.entries[key].choice,1);assert.equal(a.qa.entries[extra].choice,2);}
  a.qa.bridge.write('unit','bcsc-s13-ch010-u01',{rating:'review',edition:'2024–2025'});await a.runTimers(t=>t.ms===400);
  const reload=boot({local,session:new MemoryStorage(),github});assert.equal(reload.qa.entries[rating].rating,'review');assert.equal(reload.qa.entries[extra].choice,2);
  const bad=a.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{'textbook:question:bcsc-s13-rq999':{choice:7,at},'textbook:unit:bcsc-s13-rq040':{rating:'known',at}},meta:{}});assert.equal(bad.skipped,2);
  github.add('me/p','tok');a.action('tab','sync');a.type('sync-owner','me');a.type('sync-repo','p');a.type('sync-token','tok');a.action('sync-connect');await a.settle();assert(JSON.parse(github.repos.get('me/p').file.text).entries[key]);assert.equal(JSON.parse(github.repos.get('me/p').file.text).entries[extra].choice,2);
 })()`;
 await test('v1/v2/v3 imports, device reload and private cloud sync preserve unloaded-volume progress',async()=>{
  const context={require,__dirname,process:{argv:[],exit(){throw Error('unexpected exit');}},console:{log(){}},Buffer,setImmediate,URL,Blob,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout};vm.createContext(context);await vm.runInContext(setup+checks,context);
 });
 const failed=results.filter(x=>!x.pass);console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));if(failed.length)process.exitCode=1;
})();
