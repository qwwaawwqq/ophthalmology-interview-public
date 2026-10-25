const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const production = JSON.parse(read('content/exam-schedule.json')), results=[];
const clone = x => JSON.parse(JSON.stringify(x));
const now = Date.parse('2026-10-25T15:59:59Z');
function fixture(data=production, failOnce=false) {
  const listeners = {}, intervals=[]; let calls=0;
  const document={baseURI:'https://example.test/',currentScript:null,getElementById:()=>null,addEventListener:(name,fn)=>listeners[name]=fn};
  const context={window:{},document,Date,URL,Set,Map,console,setInterval:(fn,ms)=>intervals.push({fn,ms}),fetch:async()=>{calls++;if(failOnce&&calls===1)throw Error('暫時離線');return {ok:true,json:async()=>clone(data)};}};
  vm.createContext(context);vm.runInContext(read('scripts/exam-schedule.js'),context);
  context.window.OphSchedule.setClock(()=>now);
  return {api:context.window.OphSchedule,listeners,intervals,root:{isConnected:true,innerHTML:''},calls:()=>calls};
}
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
(async()=>{
 await test('Taipei calendar turns at 16:00Z regardless of runtime timezone',()=>{
  const {api}=fixture();assert.equal(api.day(now),'2026-10-25');assert.equal(api.day(now+1000),'2026-10-26');
  assert.equal(api.delta('2026-10-25',now),0);assert.equal(api.delta('2026-10-26',now),1);assert.equal(api.delta('2026-10-24',now),-1);assert.equal(api.delta(null,now),null);
  assert.equal(api.status({date:null},now),'日期待確認');assert.equal(api.status({date:'2026-10-24'},now),'日期已過');
 });
 await test('invalid dates and unsafe source links are rejected',()=>{
  const {api}=fixture();assert(!api.validDate('2026-02-30'));assert(!api.validDate('2026-13-01'));assert.throws(()=>api.validate({...production,timezone:'UTC'}));
  const d=clone(production);d.hospitals[0].events[0].sourceUrl='javascript:alert(1)';assert.throws(()=>api.validate(d));
 });
 await test('filters keep undated events separate and order exact calendar dates',()=>{
  const {api}=fixture();const all=api.filtered(production,'','all',now),upcoming=api.filtered(production,'','upcoming',now),pending=api.filtered(production,'','pending',now);
  assert.equal(all.length,16);assert.equal(upcoming.length,15);assert.equal(pending.length,1);assert.equal(pending[0].id,'femh-exam-pending');
  assert.equal(upcoming[0].date,'2026-10-29');assert.equal(upcoming.at(-1).date,'2026-11-29');assert(api.filtered(production,'skh','all',now).every(e=>e.hospitalId==='skh'));
 });
 await test('duplicate activities for one hospital never imply a cross-hospital clash',()=>{
  const {api}=fixture();assert.equal(api.conflicts(production,now).length,0);
  const d=clone(production);d.hospitals[0].events[1].date='2026-11-08';const c=api.conflicts(d,now);assert.equal(c.length,1);assert.equal(c[0].names.length,2);
 });
 await test('renders source age, deadline uncertainty, and both filters without writing progress',async()=>{
  const a=fixture();await a.api.mount(a.root);assert(a.root.innerHTML.includes('擷取 2026/10/24'));assert(a.root.innerHTML.includes('核對 2026/10/25'));assert(a.root.innerHTML.includes('14:00'));assert(a.root.innerHTML.includes('00:00'));assert(a.root.innerHTML.includes('時間有衝突'));
  a.listeners.change({target:{hasAttribute:n=>n==='data-schedule-mode',value:'pending'}});assert(a.root.innerHTML.includes('甄試日期待確認'));assert(!a.root.innerHTML.includes('還有 null'));
  a.listeners.change({target:{hasAttribute:n=>n==='data-schedule-mode',value:'all'}});assert(a.root.innerHTML.includes('16 項'));
 });
 await test('transient fetch failure can be retried',async()=>{
  const a=fixture(production,true);await a.api.mount(a.root);assert(a.root.innerHTML.includes('暫時離線'));assert(a.root.innerHTML.includes('data-schedule-retry'));await a.api.mount(a.root);assert(a.root.innerHTML.includes('亞東紀念醫院'));assert.equal(a.calls(),2);
 });
 await test('calendar midnight refresh keeps same-day deadlines until the next day',async()=>{
  const a=fixture();await a.api.mount(a.root);a.api.setClock(()=>Date.parse('2026-10-29T15:59:59Z'));assert(a.root.innerHTML.includes('今天'));a.api.setClock(()=>Date.parse('2026-10-29T16:00:00Z'));assert(!a.root.innerHTML.includes('data-event-id="femh-deadline"'));
 });
 await test('native navigation includes schedule and leaves all progress entries unchanged',()=>{
  let harness=read('scripts/test-progress-sync.cjs').split('(async () => {')[0];
  const host={require,process:{argv:[]},__dirname,console,URL,Blob,Buffer,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setImmediate};vm.runInNewContext(harness+'\nglobalThis.factories={boot,MemoryStorage,fakeGitHub};',host);
  const {boot,MemoryStorage,fakeGitHub}=host.factories,a=boot({local:new MemoryStorage(),session:new MemoryStorage(),github:fakeGitHub()});const snapshot=()=>JSON.stringify({entries:a.qa.progressPayload().entries,meta:a.qa.progressPayload().meta});const before=snapshot();a.action('tab','schedule');assert.equal(a.qa.S.tab,'schedule');assert(a.document.getElementById('main').innerHTML.includes('schedule-root'));assert.equal(snapshot(),before);
 });
 console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
})();
