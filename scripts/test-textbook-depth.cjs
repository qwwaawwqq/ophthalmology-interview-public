const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
const source=fs.readFileSync(path.join(__dirname,'textbook-depth.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/textbook-manifest.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/textbook-depth/bcsc-s07.json'),'utf8'));
assert(fixture.questions.length,'The module tests require one real authored volume, not an invented empty book.');
fixture.questions=fixture.questions.slice(0,4).map(q=>({...q,readiness:'ready'}));
function moduleBoot(progress=new Map(),hash='#textbook',volume=fixture){
 const calls=[],handlers=new Map(),root={isConnected:true,dataset:{},innerHTML:'',querySelector(){return null;},addEventListener(n,fn){handlers.set(n,fn);}};
 const window={location:{hash},history:{replaceState(_a,_b,value){window.location.hash=value;}},addEventListener(){},OphTextbookBridge:{read(k,id){return progress.get(k+':'+id)||null;},write(k,id,v){progress.set(k+':'+id,{...v,at:new Date().toISOString()});},rememberLocation(){}}};
 const context={window,document:{currentScript:{src:'https://example.test/scripts/textbook-depth.js'},getElementById(){return null;}},URL,Map,Promise,console,fetch:async url=>{calls.push(String(url));const data=String(url).endsWith('textbook-manifest.json')?manifest:volume;return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};}};
 vm.createContext(context);
 vm.runInContext(source.replace('window.OphTextbook={mount};','window.OphTextbook={mount,__test:{optionOrder,route}};'),context);
 return {api:window.OphTextbook,root,calls,progress,window,async mount(){await window.OphTextbook.mount(root);},async action(kind,value=''){handlers.get('click')({target:{closest:()=>({dataset:{tbAction:kind,value},disabled:false})}});for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));}};
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
  for(const update of b1.clinicalUpdates){
   const q=moduleBoot(new Map(),'#textbook-'+update.questionIds[0],b1);await q.mount();assert(q.root.innerHTML.includes(update.statement));assert(q.root.innerHTML.includes(update.source.url.replace(/&/g,'&amp;')));
   const ch=moduleBoot(new Map(),'#textbook-'+update.chapterIds[0],b1);await ch.mount();assert(ch.root.innerHTML.includes(update.statement));
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
s=v.validate_book(b,m['books'][6]);assert s['taughtChapters']==0
assert all(r['teachingStatus']=='partial' for r in b['coverage']['chapterRows'])
`;
  execFileSync('python3',['-c',check],{cwd:path.join(__dirname,'..')});
 });
 // Reuse the existing app harness to exercise real restore/import/cloud validation before any textbook JSON is fetched.
 const helper=fs.readFileSync(path.join(__dirname,'test-progress-sync.cjs'),'utf8');
 const setup=helper.slice(0,helper.indexOf('(async () => {')).replace('globalThis.__qa={D,S,','globalThis.__qa={bridge:window.OphTextbookBridge,D,S,');
 const checks=`(async()=>{
  const key='textbook:question:bcsc-s13-rq040',rating='textbook:unit:bcsc-s13-ch010-u01',at='2026-10-20T00:00:00.000Z';
  const local=new MemoryStorage(),github=fakeGitHub();
  local.setItem('oph-prep:progress-v3',JSON.stringify({format:'ophthalmology-prep-progress-v3',exportedAt:at,entries:{[key]:{choice:2,revealed:true,at},[rating]:{rating:'known',at}},meta:{}}));
  const a=boot({local,session:new MemoryStorage(),github,hash:'#textbook-bcsc-s13-rq040'});a.windowHandlers.get('load')();
  assert.equal(a.qa.S.tab,'textbook');assert.equal(a.qa.entries[key].choice,2);assert.equal(a.qa.entries[rating].rating,'known');
  for(const version of ['v1','v2','v3']){a.qa.mergeProgress({format:'ophthalmology-prep-progress-'+version,entries:{[key]:{choice:1,revealed:true,at:'2026-10-21T00:00:00.000Z'}},meta:{}});assert.equal(a.qa.entries[key].choice,1);}
  a.qa.bridge.write('unit','bcsc-s13-ch010-u01',{rating:'review',edition:'2024–2025'});await a.runTimers(t=>t.ms===400);
  const reload=boot({local,session:new MemoryStorage(),github});assert.equal(reload.qa.entries[rating].rating,'review');
  const bad=a.qa.mergeProgress({format:'ophthalmology-prep-progress-v3',entries:{'textbook:question:bcsc-s13-rq999':{choice:7,at},'textbook:unit:bcsc-s13-rq040':{rating:'known',at}},meta:{}});assert.equal(bad.skipped,2);
  github.add('me/p','tok');a.action('tab','sync');a.type('sync-owner','me');a.type('sync-repo','p');a.type('sync-token','tok');a.action('sync-connect');await a.settle();assert(JSON.parse(github.repos.get('me/p').file.text).entries[key]);
 })()`;
 await test('v1/v2/v3 imports, device reload and private cloud sync preserve unloaded-volume progress',async()=>{
  const context={require,__dirname,process:{argv:[],exit(){throw Error('unexpected exit');}},console:{log(){}},Buffer,setImmediate,URL,Blob,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout};vm.createContext(context);await vm.runInContext(setup+checks,context);
 });
 const failed=results.filter(x=>!x.pass);console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));if(failed.length)process.exitCode=1;
})();
