const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const base = path.join(__dirname, '..');
const atlasSource = fs.readFileSync(path.join(__dirname, 'textbook-atlas.js'), 'utf8');
const textbookSource = fs.readFileSync(path.join(__dirname, 'textbook-depth.js'), 'utf8');
const pack = JSON.parse(fs.readFileSync(path.join(base, 'content/textbook-depth/visual-atlas.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'content/textbook-manifest.json'), 'utf8'));
const volumes = Object.fromEntries(manifest.books.map(book=>[book.bookId,JSON.parse(fs.readFileSync(path.join(base,book.file),'utf8'))]));
const results=[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
async function test(name, fn){try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.stack});}}
function fakeRoot(){
  const listeners = new Map(), root={dataset:{},isConnected:true,focused:null,scrolls:[],listeners};
  let html='';
  function node(name){return {dataset:{},setAttribute(k,v){this[k]=v;},focus(){root.focused=name;},scrollIntoView(opts){root.scrolls.push({name,opts});}};}
  Object.defineProperty(root,'innerHTML',{get(){return html;},set(value){html=value;root.heading=node('atlas-heading');root.chapterHeading=node('tb-chapter-heading');root.figures=new Map();for(const match of value.matchAll(/data-atlas-figure="([^"]+)"/g)){const id=match[1],control=node('zoom-'+id);control.textContent='放大圖解';const figure=node('figure-'+id);figure.control=control;figure.querySelector=()=>control;root.figures.set(id,figure);}}});
  root.querySelector=selector=>{
    if(selector==='.atlas-heading')return html.includes('atlas-heading')?root.heading:null;
    if(selector==='.tb-chapter-heading')return html.includes('tb-chapter-heading')?root.chapterHeading:null;
    if(selector==='[data-atlas-figure][data-expanded="true"]')return [...root.figures.values()].find(x=>x.dataset.expanded==='true')||null;
    const match=selector.match(/^\[data-atlas-figure="([^"]+)"\]$/);if(match)return root.figures.get(match[1])||null;
    return null;
  };
  root.addEventListener=(kind, fn)=>{if(!listeners.has(kind))listeners.set(kind,[]);listeners.get(kind).push(fn);};
  root.event=async(kind,event)=>{for(const fn of [...(listeners.get(kind)||[])])fn(event);await settle();};
  root.click=async(family,action,value='')=>{
    const dataset=family==='atlas'?{atlasAction:action,value}:{tbAction:action,value};
    let control={dataset,disabled:false,setAttribute(k,v){this[k]=v;},focus(){root.focused='zoom-'+value;}};
    if(family==='atlas'&&action==='zoom')control=Object.assign(root.figures.get(value).control,{dataset});
    return root.event('click',{target:{closest:selector=>selector===('[data-'+family+'-action]')?control:null}});
  };
  return root;
}
function boot({integrated=false,hash='#textbook',data=pack,fetchOverride=null}={}){
  const root=fakeRoot(),calls=[],writes=[],navigation=[];
  const window={location:{hash},history:{replaceState(_a,_b,value){window.location.hash=value;}},addEventListener(){},OphTextbookBridge:{read(){return null;},all(){return {};},write(...args){writes.push(args);},rememberLocation(){}},OphStudy:{leave(){},context(){}}};
  const document={currentScript:{src:'https://example.test/ophthalmology-interview-public/scripts/textbook-atlas.js'},getElementById(){return null;}};
  const context={window,document,URL,Blob,WeakMap,Map,Promise,console,fetch:async url=>{
    calls.push(String(url));if(fetchOverride){const custom=fetchOverride(String(url));if(custom)return custom;}
    const pathname=new URL(url).pathname;let value;
    if(pathname.endsWith('visual-atlas.json'))value=data;
    else if(pathname.endsWith('textbook-manifest.json'))value=manifest;
    else value=volumes[path.basename(pathname,'.json')];
    return {ok:!!value,json:async()=>JSON.parse(JSON.stringify(value))};
  }};
  vm.createContext(context);vm.runInContext(atlasSource.replace('window.OphTextbookAtlas={mount,load,unitsForChapter,inlineChapterHtml};','window.OphTextbookAtlas={mount,load,unitsForChapter,inlineChapterHtml,__test:{shape,svg,load,formatRich,formatBullet}};'),context);
  if(integrated){document.currentScript.src='https://example.test/ophthalmology-interview-public/scripts/textbook-depth.js';vm.runInContext(textbookSource,context);}
  async function mount(bookId=null,unitId=null,extra={}){
    const opts={manifest,book:bookId?volumes[bookId]:null,bookId,unitId,focus:true,isCurrent:()=>true,onSelect:(b,u)=>{navigation.push(['select',b,u]);void mount(b,u);},onBack:()=>navigation.push(['back']),onChapter:id=>navigation.push(['chapter',id]),...extra};
    await window.OphTextbookAtlas.mount(root,opts);return opts;
  }
  return {root,window,calls,writes,navigation,mount,context,async start(){if(integrated)await window.OphTextbook.mount(root);else await mount();}};
}
(async()=>{
  const totalUnits=pack.volumes.reduce((s,v)=>s+v.units.length,0);
  const s01Units=pack.volumes.find(v=>v.bookId==='bcsc-s01').units.length;
  assert(s01Units>=2,'BCSC S01 must have at least 2 atlas units');
  await test('all thirteen volumes have working unit choices and original accessible figure previews',async()=>{
    const b=boot();await b.start();assert.equal((b.root.innerHTML.match(/class="atlas-volume"/g)||[]).length,13);assert.equal((b.root.innerHTML.match(/data-atlas-action="unit"/g)||[]).length,totalUnits);assert.equal((b.root.innerHTML.match(/role="img"/g)||[]).length,13);assert(b.root.innerHTML.includes('13 卷 · '+totalUnits+' 個原創圖解單元'));assert.equal(b.calls.length,1);assert(b.calls[0].includes('/ophthalmology-interview-public/content/textbook-depth/visual-atlas.json?v=volume-atlas-20261028'));
    for(const v of pack.volumes){for(const u of v.units){await b.root.click('atlas','unit',v.bookId+'|'+u.id);assert(b.root.innerHTML.includes(u.title));assert(b.root.innerHTML.includes('aria-labelledby="'+u.id+'-title '+u.id+'-description"'));assert(b.root.innerHTML.includes(u.diagram.alt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')));assert.equal(b.root.focused,'atlas-heading');}}
    assert.equal(b.calls.length,1,'switching volume uses cached atlas data');assert.equal(b.writes.length,0);
  });
  await test('selector, chapter return and overview dispatch actual navigation callbacks',async()=>{
    const b=boot();await b.start();await b.root.event('change',{target:{value:'bcsc-s09',matches:s=>s==='[data-atlas-volume]'}});assert.deepEqual(b.navigation.at(-1),['select','bcsc-s09',null]);const u=pack.volumes.find(v=>v.bookId==='bcsc-s09').units[0];await b.root.click('atlas','chapter',u.chapterIds[0]);assert.deepEqual(b.navigation.at(-1),['chapter',u.chapterIds[0]]);await b.root.click('atlas','overview');assert.equal((b.root.innerHTML.match(/class="atlas-volume"/g)||[]).length,13);await b.root.click('atlas','back');assert.deepEqual(b.navigation.at(-1),['back']);
  });
  await test('inline zoom is reversible with Escape and returns focus to its control without altering lesson text',async()=>{
    const b=boot(),v=pack.volumes[0],u=v.units[0];await b.mount(v.bookId,u.id);const text=b.root.innerHTML;await b.root.click('atlas','zoom',u.id);const f=b.root.figures.get(u.id);assert.equal(f.dataset.expanded,'true');assert.equal(f.control['aria-expanded'],'true');assert.equal(f.control.textContent,'縮回圖解');let prevented=false;await b.root.event('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert(prevented);assert.equal(f.dataset.expanded,'false');assert.equal(f.control['aria-expanded'],'false');assert.equal(b.root.focused,'zoom-'+u.id);assert.equal(b.root.innerHTML,text);assert.equal(b.writes.length,0);
  });
  await test('a stale fetch cannot overwrite the page after navigation and a failed request can be retried',async()=>{
    let resolve;const promise=new Promise(r=>resolve=r);const b=boot({fetchOverride:url=>url.includes('visual-atlas.json')?promise:null});let current=true;const pending=b.mount(null,null,{isCurrent:()=>current});current=false;b.root.innerHTML='Other page';resolve({ok:true,json:async()=>pack});await pending;assert.equal(b.root.innerHTML,'Other page');let fail=true;const c=boot({fetchOverride:url=>url.includes('visual-atlas.json')&&fail?Promise.resolve({ok:false}):null});await c.start();assert(c.root.innerHTML.includes('圖解教材暫時無法載入'));fail=false;await c.root.click('atlas','retry');assert(c.root.innerHTML.includes('各卷圖解與進階推演'));
  });
  await test('renderer escapes content, drops unapproved SVG elements and never promotes unsafe links',async()=>{
    const bad=JSON.parse(JSON.stringify(pack));const u=bad.volumes[0].units[0];u.title='<img src=x onerror=alert(1)>';u.diagram.elements.push({type:'foreignObject',html:'<script>alert(1)</script>'},{type:'path',d:'M 0 0" onload="alert(1)',stroke:'url(https://evil.test/image)'},{type:'text',x:20,y:20,lines:['<script>bad</script>'],onclick:'bad'});u.references[0].url='javascript:alert(1)';const b=boot({data:bad});await b.mount(bad.volumes[0].bookId,u.id);assert(!b.root.innerHTML.includes('<img src=x'));assert(!b.root.innerHTML.includes('<foreignObject'));assert(!b.root.innerHTML.includes('<script>'));assert(!b.root.innerHTML.includes('href="javascript:'));assert(!b.root.innerHTML.includes('url(https://evil'));assert(b.root.innerHTML.includes('&lt;script&gt;bad&lt;/script&gt;'));
  });
  await test('textbook deep links, local PDF controls, mode navigation and progress remain compatible',async()=>{
    const b=boot({integrated:true,hash:'#textbook-bcsc-s01'});await b.start();assert(b.root.innerHTML.includes('原創圖解 '+s01Units+' 個'));assert(b.root.innerHTML.includes('data-tb-pdf'));await b.root.click('tb','mode','atlas');assert(b.root.innerHTML.includes('atlas-lesson'));assert.equal(b.window.location.hash,'#textbook-atlas-bcsc-s01');const u=pack.volumes[0].units[0];await b.root.click('atlas','unit','bcsc-s01|'+u.id);assert.equal(b.window.location.hash,'#textbook-atlas-bcsc-s01-'+u.id);await b.root.click('atlas','chapter',u.chapterIds[0]);assert.equal(b.window.location.hash,'#textbook-'+u.chapterIds[0]);assert(b.root.innerHTML.includes('data-tb-pdf'));assert.equal(b.root.focused,'tb-chapter-heading');await b.root.click('tb','mode','questions');assert(b.root.innerHTML.includes('tb-question'));assert.equal(b.writes.length,0);await b.root.click('tb','library');assert.equal(b.window.location.hash,'#textbook');assert(b.root.innerHTML.includes('瀏覽全部卷別圖解'));assert(b.root.innerHTML.includes('圖解與進階 · '+s01Units+' 個'));assert.equal((b.root.innerHTML.match(/class="tb-book"/g)||[]).length,13);
  });
  await test('multi-unit volumes (>=22 units, e.g. atlas-s01-12 and atlas-s01-22) route and render cleanly',async()=>{
    const vol1=pack.volumes.find(v=>v.bookId==='bcsc-s01');
    assert(vol1.units.length>=22,'expected bcsc-s01 to have >= 22 atlas units');
    const u12=vol1.units.find(u=>u.id==='atlas-s01-12');
    const u22=vol1.units.find(u=>u.id==='atlas-s01-22');
    assert(u12&&u22,'expected atlas-s01-12 and atlas-s01-22 to exist');
    const b=boot({integrated:true,hash:'#textbook-atlas-bcsc-s01-atlas-s01-12'});
    await b.start();
    assert(b.root.innerHTML.includes(u12.title));
    assert.equal(b.window.location.hash,'#textbook-atlas-bcsc-s01-atlas-s01-12');
    await b.root.click('atlas','unit','bcsc-s01|atlas-s01-22');
    assert(b.root.innerHTML.includes(u22.title));
    assert.equal(b.window.location.hash,'#textbook-atlas-bcsc-s01-atlas-s01-22');
  });
  await test('an atlas unit deep link opens its exact volume on initial mount without writing learner records',async()=>{
    const v=pack.volumes[12],u=v.units[1];const b=boot({integrated:true,hash:'#textbook-atlas-'+v.bookId+'-'+u.id});await b.start();assert(b.root.innerHTML.includes(u.title));assert(b.root.innerHTML.includes('aria-pressed="true"'));assert.equal(b.writes.length,0);assert.equal(b.calls.filter(x=>x.includes('visual-atlas.json')).length,1);
  });
  await test('the full app shell accepts atlas hashes and restores them after a device reload',async()=>{
    const helper=fs.readFileSync(path.join(__dirname,'test-progress-sync.cjs'),'utf8');
    const setup=helper.slice(0,helper.indexOf('(async () => {')).replace('globalThis.__qa={D,S,','globalThis.__qa={parseRoute,currentLocationHash,D,S,');
    const checks=`(async()=>{const local=new MemoryStorage(),github=fakeGitHub();const hash='#textbook-atlas-bcsc-s01-atlas-s01-22';const a=boot({local,session:new MemoryStorage(),github,hash});a.windowHandlers.get('load')();assert.equal(a.qa.S.tab,'textbook');assert.equal(a.qa.currentLocationHash(),hash);await a.runTimers();const b=boot({local,session:new MemoryStorage(),github});b.windowHandlers.get('load')();assert.equal(b.qa.S.tab,'textbook');assert.equal(b.qa.currentLocationHash(),hash);assert.equal(b.qa.parseRoute('#textbook-atlas-bcsc-s01-atlas-s01-00'),null);assert.equal(b.qa.parseRoute('#textbook-atlas-bcsc-s99'),null);assert.equal(b.qa.parseRoute('#textbook-atlas-javascript:alert(1)'),null);assert.equal(Object.keys(b.qa.entries).length,0);})()`;
    const context={require,__dirname,process:{argv:[],exit(){throw Error('unexpected exit');}},console:{log(){}},Buffer,setImmediate,URL,Blob,TextEncoder,TextDecoder,Uint8Array,atob,btoa,setTimeout,clearTimeout};vm.createContext(context);await vm.runInContext(setup+checks,context);
  });
  await test('strict schema refuses script tags, unsafe attrs, bad links, non-sequential IDs, missing coverage and changed clinical content',async()=>{
    const script=`import copy,importlib.util,json\nfrom pathlib import Path\np=Path('scripts/validate-atlas.py');s=importlib.util.spec_from_file_location('v',p);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)\nd=json.loads(Path('content/textbook-depth/visual-atlas.json').read_text());r=json.loads(Path('content/textbook-depth/visual-atlas-review.json').read_text());v.validate(d,review=r)\nmulti=copy.deepcopy(d);u3=copy.deepcopy(multi['volumes'][0]['units'][0]);u3['id']=f"atlas-s01-{len(multi['volumes'][0]['units'])+1:02d}";multi['volumes'][0]['units'].append(u3);mr=copy.deepcopy(r);mr['contentHashes'][u3['id']]=v.reviewed_hash(u3);assert v.validate(multi,review=mr)['units']==len(r['contentHashes'])+1\ndef reject(f):\n b=copy.deepcopy(d);f(b)\n try:v.validate(b,review=r)\n except (ValueError,KeyError,TypeError):return\n raise AssertionError('invalid atlas was accepted')\nreject(lambda b:b['volumes'][0]['units'][0]['diagram']['elements'].append({'type':'script','text':'alert(1)'}))\nreject(lambda b:b['volumes'][0]['units'][0]['diagram']['elements'][0].update(onload='alert(1)'))\nreject(lambda b:b['volumes'][0]['units'][0]['references'][0].update(url='javascript:alert(1)'))\nreject(lambda b:b['volumes'][0]['units'][0]['chapterIds'].append('bcsc-s02-ch999'))\nreject(lambda b:b['volumes'][0]['units'][1].update(id=b['volumes'][0]['units'][0]['id']))\nreject(lambda b:b['volumes'][0]['units'][1].update(id='atlas-s01-99'))\nreject(lambda b:b['volumes'][0].update(units=[b['volumes'][0]['units'][0]]))\nreject(lambda b:b['volumes'].pop())\nreject(lambda b:b['volumes'][0]['units'][0]['mechanism'].append('Changed after independent medical review.'))\n`;
    execFileSync('python3',['-c',script],{cwd:base});
  });
  await test('validate-atlas.py accepts valid optional unitIds and rejects empty, duplicate, unknown or cross-chapter mismatched unitIds',async()=>{
    const script=`import copy,importlib.util,json
from pathlib import Path
p=Path('scripts/validate-atlas.py');s=importlib.util.spec_from_file_location('v',p);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
d=json.loads(Path('content/textbook-depth/visual-atlas.json').read_text());r=json.loads(Path('content/textbook-depth/visual-atlas-review.json').read_text())
# Existing hashes remain untouched when unitIds is omitted
res0=v.validate(d,review=r)
assert res0['contentHashes']==r['contentHashes']
# Valid single and multi unitIds within declared chapterIds pass when reviewed
good=copy.deepcopy(d);gr=copy.deepcopy(r)
u=good['volumes'][0]['units'][0]
u['chapterIds']=['bcsc-s01-ch002','bcsc-s01-ch003']
u['unitIds']=['bcsc-s01-ch002-u01','bcsc-s01-ch003-u01']
try:
 v.validate(good,review=r)
 raise AssertionError('unhashed unitIds change was accepted')
except ValueError:
 pass
gr['contentHashes'][u['id']]=v.reviewed_hash(u)
assert v.validate(good,review=gr)['units']==len(gr['contentHashes'])
def reject_unit_ids(mut):
 bad=copy.deepcopy(d);br=copy.deepcopy(r)
 target=bad['volumes'][0]['units'][0]
 target['chapterIds']=['bcsc-s01-ch002']
 mut(target)
 br['contentHashes'][target['id']]=v.reviewed_hash(target)
 try:
  v.validate(bad,review=br)
 except (ValueError,KeyError,TypeError):
  return
 raise AssertionError('invalid unitIds was accepted: '+repr(target.get('unitIds')))
reject_unit_ids(lambda t:t.update(unitIds=[]))
reject_unit_ids(lambda t:t.update(unitIds='bcsc-s01-ch002-u01'))
reject_unit_ids(lambda t:t.update(unitIds=['']))
reject_unit_ids(lambda t:t.update(unitIds=['bcsc-s01-ch002-u01','bcsc-s01-ch002-u01']))
reject_unit_ids(lambda t:t.update(unitIds=['bcsc-s01-ch002-u99']))
reject_unit_ids(lambda t:t.update(unitIds=['bcsc-s02-ch001-u01']))
reject_unit_ids(lambda t:t.update(unitIds=['bcsc-s01-ch003-u01']))
reject_unit_ids(lambda t:t.update(unitIds=['bcsc-s01-ch002-u01'],unexpectedKey=True))
`;
    execFileSync('python3',['-c',script],{cwd:base});
  });
  await test('renderInlineUnitCards and renderInlineChapterCards route unit-bound figures exclusively to their target unit',async()=>{
    const custom=JSON.parse(JSON.stringify(pack));
    const s01=custom.volumes.find(v=>v.bookId==='bcsc-s01');
    const unitFig=s01.units[0],chapFig=s01.units[1];
    s01.units=[unitFig,chapFig];
    unitFig.chapterIds=['bcsc-s01-ch002'];
    unitFig.unitIds=['bcsc-s01-ch002-u01'];
    chapFig.chapterIds=['bcsc-s01-ch002'];
    delete chapFig.unitIds;
    const b=boot({data:custom});
    await b.start();
    assert.equal(b.window.TextbookAtlas,b.window.OphTextbookAtlas);
    const u01Html=b.window.TextbookAtlas.renderInlineUnitCards('bcsc-s01','bcsc-s01-ch002-u01');
    const u02Html=b.window.TextbookAtlas.renderInlineUnitCards('bcsc-s01','bcsc-s01-ch002-u02');
    const chHtml=b.window.TextbookAtlas.renderInlineChapterCards('bcsc-s01','bcsc-s01-ch002',['bcsc-s01-ch002-u01','bcsc-s01-ch002-u02']);
    assert(u01Html.includes('class="atlas-inline-wrap atlas-unit-inline-wrap"'));
    assert(u01Html.includes('data-inline-atlas="'+unitFig.id+'"'));
    assert(u01Html.includes('讀圖重點與臨床決策步驟'));
    assert(u01Html.includes('開啟完整圖解與臨床問答 →'));
    assert.equal(u02Html,'');
    assert(chHtml.includes('data-inline-atlas="'+chapFig.id+'"'));
    assert(!chHtml.includes('data-inline-atlas="'+unitFig.id+'"'),'unit-bound SVG must not duplicate in chapter header');
  });
  await test('atlas formatRich and formatBullet escape XSS before converting **bold**, `code`, lead-ins and （1）（2） substeps across all 13 volumes',async()=>{
    const b=boot();
    const {formatRich,formatBullet}=b.window.OphTextbookAtlas.__test;
    const out=formatRich('基因 **`PAX6` <script>evil()</script>** 分流：（1）無虹膜 <img src=x onerror=alert(1)>；（2）WAGR 症候群');
    assert(!out.includes('<script>'));
    assert(!out.includes('<img src=x'));
    assert(out.includes('<strong><code class="tb-formula-chip">PAX6</code> &lt;script&gt;evil()&lt;/script&gt;</strong>'));
    assert(out.includes('<span class="tb-substeps"><span class="tb-substep">（1）無虹膜 &lt;img src=x onerror=alert(1)&gt;；</span><span class="tb-substep">（2）WAGR 症候群</span></span>'));
    const lead=formatBullet('安全拱高 <svg onload=alert(1)>：`250–750 μm`');
    assert(!lead.includes('<svg onload='));
    assert(lead.startsWith('<strong class="tb-lead-term">安全拱高 &lt;svg onload=alert(1)&gt;：</strong>'));
    assert(lead.includes('<code class="tb-formula-chip">250–750 μm</code>'));
    for(const v of pack.volumes){
      for(const u of v.units){
        await b.mount(v.bookId,u.id);
        assert(!b.root.innerHTML.includes('**'),'unrendered ** in '+u.id);
        assert(!b.root.innerHTML.includes('`'),'unrendered backtick in '+u.id);
      }
    }
  });
  const failed=results.filter(r=>!r.pass);console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));if(failed.length)process.exitCode=1;
})();
