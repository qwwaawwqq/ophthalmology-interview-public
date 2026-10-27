const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),script=fs.readFileSync(path.join(__dirname,'app-install.js'),'utf8'),results=[];
function fixture({ua='',platform='',touch=0,standalone=false,iosStandalone=false}={}){
 const winEvents={},docEvents={},mediaEvents={},nodes=[];
 const entry={textContent:'',attrs:{},disabled:false,setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;}};
 const document={querySelectorAll:()=>[entry],body:{appendChild:n=>nodes.push(n)},addEventListener:(name,fn)=>docEvents[name]=fn,createElement:()=>({open:false,innerHTML:'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];this.open=false;},addEventListener(k,fn){this.events[k]=fn;},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}})};
 const media={matches:standalone,addEventListener:(k,fn)=>mediaEvents[k]=fn};
 const navigator={userAgent:ua,platform,maxTouchPoints:touch,standalone:iosStandalone};Object.defineProperty(navigator,'serviceWorker',{get(){throw Error('No service-worker access allowed');}});
 const window={document,navigator,matchMedia:()=>media,addEventListener:(name,fn)=>winEvents[name]=fn};Object.defineProperty(window,'localStorage',{get(){throw Error('No progress-store access allowed');}});
 const context={window,console};vm.createContext(context);vm.runInContext(script,context);
 const click=(kind='open',trusted=true)=>{const selector={'open':'[data-app-install-open]','confirm':'[data-app-install-confirm]','close':'[data-app-install-close]'}[kind];docEvents.click({isTrusted:trusted,target:{closest:q=>q===selector?entry:null}});};
 const offer=(outcome='dismissed',error=false)=>{let calls=0,prevented=false;const event={prompt(){calls++;return error?Promise.reject(Error('blocked')):Promise.resolve();},userChoice:Promise.resolve({outcome}),preventDefault(){prevented=true;}};winEvents.beforeinstallprompt(event);return{calls:()=>calls,prevented:()=>prevented};};
 return{api:window.OphInstall,entry,click,offer,winEvents,media,mediaEvents,nodes,dialog:()=>nodes[0]};
}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
(async()=>{
 await test('Pages manifest identity, start URL, scope and PNG sizes stay under the repo path',()=>{
  const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8')),url=new URL('https://qwwaawwqq.github.io/ophthalmology-interview-public/manifest.webmanifest');
  assert.equal(new URL(m.id,url.origin).pathname,'/ophthalmology-interview-public/');assert.equal(new URL(m.start_url,url).pathname,'/ophthalmology-interview-public/');assert.equal(new URL(m.scope,url).pathname,'/ophthalmology-interview-public/');assert.equal(m.display,'standalone');assert.equal(m.prefer_related_applications,false);
  for(const size of ['192x192','512x512'])assert(m.icons.some(i=>i.sizes===size&&i.purpose==='any'));
  for(const icon of m.icons){const b=fs.readFileSync(path.join(root,icon.src));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(b.readUInt32BE(16)+'x'+b.readUInt32BE(20),icon.sizes);assert(new URL(icon.src,url).pathname.startsWith('/ophthalmology-interview-public/assets/icons/'));}
  const apple=fs.readFileSync(path.join(root,'assets/icons/apple-touch-icon.png'));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 });
 await test('initial page never opens or prompts automatically, and absent event offers guidance',()=>{
  const f=fixture({ua:'Mozilla Chrome/141.0 Safari/537.36'});assert.equal(f.nodes.length,0);assert.equal(f.entry.textContent,'安裝App');assert.equal(f.api.state().ready,false);f.click();assert(f.dialog().open);assert(f.dialog().innerHTML.includes('目前尚未提供直接安裝視窗'));assert(f.dialog().innerHTML.includes('投放、儲存及分享'));
 });
 await test('offered prompt requires trusted click, is consumed once, and dismissal remains truthful',async()=>{
  const f=fixture(),p=f.offer();assert(p.prevented());assert.equal(p.calls(),0);f.click('open',false);assert.equal(p.calls(),0);f.click('confirm');assert.equal(p.calls(),1);assert.equal(f.entry.disabled,false);assert.equal(f.entry.textContent,'查看安裝步驟');await settle();assert.equal(f.entry.disabled,false);assert.equal(f.api.state().ready,false);assert(f.dialog().innerHTML.includes('這次未安裝'));f.click();assert.equal(p.calls(),1);
 });
 await test('unsettled prompt and unsettled userChoice retain manual recovery without a second prompt',async()=>{
  for(const phase of ['prompt','choice']){
   const f=fixture();let calls=0;const never=new Promise(()=>{});
   f.winEvents.beforeinstallprompt({preventDefault(){},prompt(){calls++;return phase==='prompt'?never:Promise.resolve();},userChoice:phase==='choice'?never:Promise.resolve({outcome:'dismissed'})});
   f.click();await settle();assert.equal(calls,1);assert.equal(f.api.state().busy,true);assert.equal(f.entry.disabled,false);assert.equal(f.entry.textContent,'查看安裝步驟');
   f.click();assert(f.dialog().open);assert(f.dialog().innerHTML.includes('瀏覽器的安裝視窗完成選擇'));assert(f.dialog().innerHTML.includes('app-install-steps'));assert(!f.dialog().innerHTML.includes('data-app-install-confirm'));
   f.click('close');f.click();await settle();assert(f.dialog().open);assert.equal(calls,1);assert.equal(f.api.state().installed,false);
  }
 });
 await test('acceptance does not claim installation until appinstalled or standalone is observed',async()=>{
  const f=fixture(),p=f.offer('accepted');f.click();await settle();assert.equal(p.calls(),1);assert.equal(f.api.state().installed,false);assert(f.dialog().innerHTML.includes('已送出安裝要求'));f.winEvents.appinstalled();assert.equal(f.api.state().installed,true);assert.equal(f.entry.textContent,'已安裝');assert.equal(fixture().api.state().installed,false,'installed flag must not be persisted as a guess');
 });
 await test('native errors clear the one-shot prompt and allow a new browser offer',async()=>{
  const f=fixture(),p=f.offer('dismissed',true);f.click();await settle();assert.equal(p.calls(),1);assert.equal(f.api.state().ready,false);assert(f.dialog().innerHTML.includes('未能開啟安裝視窗'));const next=f.offer();assert.equal(f.api.state().ready,true);f.click();await settle();assert.equal(next.calls(),1);
 });
 await test('standalone and iOS app mode show installed state without opening another prompt',()=>{
  for(const options of [{standalone:true},{iosStandalone:true}]){const f=fixture(options);assert.equal(f.entry.textContent,'已安裝');f.click();assert(f.dialog().innerHTML.includes('目前正以App模式開啟'));}const f=fixture();f.media.matches=true;f.mediaEvents.change();assert.equal(f.entry.textContent,'已安裝');
 });
 await test('platform guidance covers iPad desktop UA, Mac Safari, Edge and unknown browsers',()=>{
  const items=[{opts:{ua:'Mozilla Macintosh Version/26.0 Safari/605.1.15',platform:'MacIntel',touch:5},text:'加入主畫面'},{opts:{ua:'Mozilla Macintosh Version/26.0 Safari/605.1.15'},text:'加入Dock'},{opts:{ua:'Chrome/141 Safari/537.36 Edg/141'},text:'Apps／應用程式'},{opts:{ua:'Firefox/143'},text:'書籤或捷徑'},{opts:{ua:'Android Chrome/141'},text:'安裝及建立捷徑'}];
  for(const x of items){const f=fixture(x.opts);f.click();assert(f.dialog().innerHTML.includes(x.text));assert(f.dialog().innerHTML.includes('首次開啟請確認學習進度'));f.click('close');assert.equal(f.dialog().open,false);assert(f.entry.focused);}
 });
 await test('installation metadata and entry are present exactly once without replacing the course payload',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.equal((html.match(/rel="manifest"/g)||[]).length,1);assert.equal((html.match(/data-app-install-open/g)||[]).length,1);assert(html.includes('src="scripts/app-install.js" defer'));assert(html.includes('id="course-data"'));assert(html.includes('src="scripts/exam-schedule.js"'));assert(html.includes('src="scripts/learning-project.js"'));
 });
 console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
})();
