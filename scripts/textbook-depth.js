(function(){
  'use strict';
  if(window.OphTextbook)return;
  const base=new URL('../',document.currentScript.src),books=new Map(),pending=new Map(),localPdfs=new Map(),pdfMessages=new Map(),pdfChanges=new Map(),openFigures=new Set(),zoomedInlineAtlas=new Set();
  let manifest,manifestPending,root,request=0,extraPack,extraPending,atlasPack,atlasPending=null,readStyle='full';
  const view={bookId:null,chapterId:null,questionId:null,mode:'read',filter:'all',extra:false,feedbackId:null,figure:null,atlasId:null};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bridge=()=>window.OphTextbookBridge;
  const imageLabels={'not-reviewed':'原圖尚未核對',missing:'原圖缺失',unreadable:'原圖無法辨讀',verified:'原圖已核對','not-applicable':'本題不依賴原圖'};
  const statusLabels={unreviewed:'尚待補入',unmapped:'尚未對應',draft:'初稿',partial:'已核部分單元，章內仍有缺口', 'source-checked':'已對照來源','independently-reviewed':'已獨立核對'};
  const CHAPTER_ZH_TITLES={
    'bcsc-s13-ch001':'屈光手術科學基礎：角膜生物力學、光學像差與雷射組織交互作用',
    'bcsc-s13-ch002':'屈光手術術前評估：目標屈光設定、擴張風險篩檢與組織安全預算',
    'bcsc-s13-ch003':'角膜切開屈光手術：放射狀切開（RK）長期演變與弧形鬆弛切口散光矯正',
    'bcsc-s13-ch004':'準分子雷射光消融技術與療效：表層切削、LASIK、波前導引與術後照護',
    'bcsc-s13-ch005':'光消融併發症與處置：視覺品質異常、角膜瓣機械意外、DLK／IFS 與醫源性外膨',
    'bcsc-s13-ch006':'飛秒雷射微透鏡萃取術（SMILE）：深層透鏡幾何、前基質力學優勢與分離併發症',
    'bcsc-s13-ch007':'合併眼部或全身疾病之屈光手術評估：角膜失養症、乾眼、青光眼與自體免疫風險',
    'bcsc-s13-ch008':'屈光手術後之繼發臨床考量：白內障人工水晶體度數計算、眼壓校正與後續角膜手術',
    'bcsc-s13-ch009':'眼內屈光手術：有晶狀體眼人工水晶體（Phakic IOL）、透明晶狀體置換與散光軸位管理',
    'bcsc-s13-ch010':'老花眼之調節性與非調節性治療：單眼視、多焦光學、角膜嵌入片與老花藥物機轉'
  };
  const label=x=>statusLabels[x]||'待核對';
  function formatInline(raw){
    return esc(raw).split(/(`[^`\n]+`)/g).map(part=>part.startsWith('`')&&part.endsWith('`')&&part.length>2?'<code class="tb-formula-chip">'+part.slice(1,-1).replace(/\*/g,'&#42;')+'</code>':part).join('').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/&#42;/g,'*');
  }
  function balancedParens(s){
    return (s.match(/（/g)||[]).length===(s.match(/）/g)||[]).length&&(s.match(/\(/g)||[]).length===(s.match(/\)/g)||[]).length;
  }
  function applyLead(str,allowColon){
    const s=String(str??'');
    const b=s.match(/^(【[^】\n]+】：?)([\s\S]*)$/);
    if(b)return '<strong class="tb-lead-term">'+formatInline(b[1])+'</strong>'+formatInline(b[2]);
    if(allowColon){
      const idx=s.indexOf('：');
      if(idx>0&&idx<=28){
        const head=s.slice(0,idx),tail=s.slice(idx+1);
        if(!/https?:/i.test(head)&&balancedParens(head))return '<strong class="tb-lead-term">'+formatInline(head+'：')+'</strong>'+formatInline(tail);
      }
    }
    return formatInline(s);
  }
  function findSubstepMatches(s){
    for(const re of [/（[1-9]）/g,/[①②③④⑤⑥⑦⑧⑨]/g]){
      const m=[...s.matchAll(re)];
      if(m.length>=2)return m;
    }
    if(s.includes('第一是')&&s.includes('第二是')){
      const m=[...s.matchAll(/第[一二三四五六七八九]是/g)];
      if(m.length>=2)return m;
    }
    return null;
  }
  function formatRich(raw,opts={}){
    const s=String(raw??''),allowColon=Boolean(opts.lead),matches=findSubstepMatches(s);
    if(!matches)return applyLead(s,allowColon);
    const pre=s.slice(0,matches[0].index).trim();
    const steps=matches.map((m,i)=>s.slice(m.index,i+1<matches.length?matches[i+1].index:s.length).trim()).filter(Boolean);
    return (pre?applyLead(pre,allowColon):'')+'<span class="tb-substeps">'+steps.map(p=>'<span class="tb-substep">'+applyLead(p,false)+'</span>').join('')+'</span>';
  }
  const formatBullet=raw=>formatRich(raw,{lead:true});
  const list=items=>'<ul class="tb-mech-list">'+items.map(x=>'<li>'+formatBullet(x)+'</li>').join('')+'</ul>';
  function prettyExpr(expr){
    const sup={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
    return String(expr??'').trim()
      .replace(/\s*\*\*\s*\(\s*-(\d+)\s*\)/g,(_,d)=>'⁻'+[...d].map(c=>sup[c]||c).join(''))
      .replace(/\s*\*\*\s*([234])(?![\d.])/g,(_,d)=>sup[d])
      .replace(/\s*\*\*\s*/g,'^')
      .replace(/\s*\*\s*/g,' × ')
      .replace(/\s*\/\s*/g,' ÷ ')
      .replace(/(?<=[\d.)⁰¹²³⁴⁵⁶⁷⁸⁹])\s*\+\s*/g,' + ')
      .replace(/(?<=[\d.)⁰¹²³⁴⁵⁶⁷⁸⁹])\s*-\s*/g,' − ')
      .replace(/(^|[(\s×÷+−^])-\s*/g,'$1−')
      .replace(/\(\s+/g,'(')
      .replace(/\s+\)/g,')')
      .replace(/\s{2,}/g,' ')
      .trim();
  }
  function formatExpected(val){
    if(typeof val!=='number'||!Number.isFinite(val))return String(val??'');
    if(val===0)return '0';
    const abs=Math.abs(val),raw=String(val);
    let out=raw;
    if(abs<1e-6)out=val.toExponential(3).replace(/\.?0+e/,'e');
    else if(/\.\d{7,}/.test(raw)||/e/i.test(raw)){
      out=abs>=10?String(Number(val.toFixed(2))):abs>=1?String(Number(val.toFixed(3))):String(Number(val.toPrecision(4)));
    }
    return out.replace(/^-/,'−');
  }
  function inferCalcHint(expr){
    const s=String(expr??'').trim();
    if(/^\d+(?:\.\d+)?\s*\*\s*\d+(?:\.\d+)?\s*\*\*\s*2\s*\/\s*3(?:\.0)?$/.test(s))return 'Munnerlyn 切削深度估算（D × OZ² ÷ 3，μm）';
    if(/^\(\s*\d+\s*\+\s*\d+\s*\)\s*\/\s*(?:4\d\d|5\d\d|6\d\d)\s*\*\s*100$/.test(s))return '組織改變百分比 PTA（(瓣厚 + 消融) ÷ CCT × 100%）';
    if(/^(?:4\d\d|5\d\d|6\d\d)\s*-\s*\d+\s*-\s*\d+$/.test(s))return '殘餘基質床厚度 RSB（CCT − 瓣厚 − 消融，μm）';
    if(/0\.01[2-4]\s*\*/.test(s))return '鏡框至角膜平面頂點距離換算';
    if(/^4\d(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\*\s*0\.8$/.test(s))return '近視消融後預期角膜曲率 K（D）';
    if(/^4\d(?:\.\d+)?\s*\+\s*\d+(?:\.\d+)?\s*\*\s*1(?:\.0)?$/.test(s))return '遠視消融後預期角膜曲率 K（D）';
    return '';
  }
  function cleanCalcUnit(u){
    return typeof u==='string'&&u&&!/[_]/.test(u)&&!/^(proportion|ratio|entities|percent|pct|fold|applications|doses|arteries|muscle|days|years|degrees|deg|rad|um|x)$/.test(u)?u:'';
  }
  function renderCalcChecks(checks){
    if(!Array.isArray(checks)||!checks.length)return '';
    return '<div class="tb-calc-box" aria-label="臨床公式與床邊驗算"><h5>臨床公式與數值驗算</h5><div class="tb-calc-grid">'+checks.map((c,i)=>{
      const hint=c.label||inferCalcHint(c.expression),u=cleanCalcUnit(c.unit);
      return '<div class="tb-calc-item"><div class="tb-calc-meta"><span class="tb-calc-idx">驗算 '+(i+1)+'</span>'+(hint?'<span class="tb-calc-label">'+formatRich(hint)+'</span>':'')+'</div><div class="tb-calc-math"><code class="tb-calc-expr">'+esc(prettyExpr(c.expression))+'</code><span class="tb-calc-eq"> = <strong>'+esc(formatExpected(c.expected))+'</strong>'+(u?' <span class="tb-calc-unit">'+esc(u)+'</span>':'')+'</span></div>'+(c.note?'<p class="tb-calc-note">'+formatRich(c.note)+'</p>':'')+'</div>';
    }).join('')+'</div></div>';
  }
  function splitRecallParts(raw,defaultPrefix){
    const s=String(raw??'').trim();
    const kw=[...s.matchAll(/【([^】]+)】/g)];
    if(kw.length>=2){
      const pre=s.slice(0,kw[0].index).trim();
      const items=kw.map((m,i)=>({badge:m[1],body:s.slice(m.index+m[0].length,i+1<kw.length?kw[i+1].index:s.length).trim()})).filter(x=>x.body);
      return {pre,items};
    }
    const pn=[...s.matchAll(/（([1-9])）/g)];
    if(pn.length>=2){
      const pre=s.slice(0,pn[0].index).trim();
      const items=pn.map((m,i)=>({badge:defaultPrefix+' '+m[1],body:s.slice(m.index+m[0].length,i+1<pn.length?pn[i+1].index:s.length).trim()})).filter(x=>x.body);
      return {pre,items};
    }
    return {pre:'',items:[]};
  }
  function renderRecall(recall){
    if(!recall)return '';
    const qParts=splitRecallParts(recall.prompt,'問題');
    const aParts=splitRecallParts(recall.answer,'解析');
    const promptHtml=qParts.items.length
      ?(qParts.pre?'<p class="tb-recall-intro">'+formatRich(qParts.pre)+'</p>':'')+'<ol class="tb-recall-list tb-recall-prompts">'+qParts.items.map(it=>'<li class="tb-recall-item"><span class="tb-recall-badge">'+esc(it.badge)+'</span><div class="tb-recall-text">'+formatRich(it.body)+'</div></li>').join('')+'</ol>'
      :'<p class="tb-recall-single">'+formatRich(recall.prompt)+'</p>';
    const answerHtml=aParts.items.length
      ?(aParts.pre?'<p class="tb-recall-intro">'+formatRich(aParts.pre)+'</p>':'')+'<ol class="tb-recall-list tb-recall-answers">'+aParts.items.map(it=>'<li class="tb-recall-item"><span class="tb-recall-badge tb-recall-ans-badge">'+esc(it.badge)+'</span><div class="tb-recall-text">'+formatRich(it.body)+'</div></li>').join('')+'</ol>'
      :'<p class="tb-recall-ans-single">'+formatRich(recall.answer)+'</p>';
    return '<section class="tb-recall"><h3>不看字，自己講一次</h3>'+promptHtml+'<details class="tb-recall-details"><summary>展開參考推理</summary>'+answerHtml+'</details></section>';
  }
  function optionOrder(q){const a=[0,1,2,3];let seed=2166136261;for(const c of q.id){seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;}for(let i=3;i>0;i--){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const j=(seed>>>0)%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
  function updates(item,scoped=[]){const all=[...(item.clinicalUpdates||[]),...scoped].filter(x=>/^https:\/\//.test(x.source?.url));return all.length?'<section class="tb-clinical-updates"><h3>與現行臨床建議的差異</h3>'+all.map(x=>'<p>'+esc(x.statement)+'</p><p class="tb-source"><a href="'+esc(x.source.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.source.title)+'</a> · 核對 '+esc(x.source.checkedAt)+'</p>').join('')+'</section>':'';}
  function scopedUpdates(b,key,id){return (b.clinicalUpdates||[]).filter(x=>x[key]?.includes(id));}
  const button=(text,action,value='',extra='')=>'<button type="button" data-tb-action="'+action+'" data-value="'+esc(value)+'" '+extra+'>'+text+'</button>';
  function pdfPicker(b){const selected=localPdfs.get(b.bookId),message=pdfMessages.get(b.bookId);return '<details class="tb-method"><summary>開啟自己的原書核對頁碼</summary><p>選擇這一卷的PDF後，可點來源頁碼開啟。檔案只在本機使用，不上傳；重新整理後需再選。版次與頁序尚未比對，請先確認與本卷相符。開啟原書不會改變原圖核對狀態。</p><label>本卷PDF <input type="file" accept="application/pdf,.pdf" data-tb-pdf data-book="'+esc(b.bookId)+'"></label><p role="status">'+esc(message||(selected?'已選擇：'+selected.name:'尚未選擇原書'))+'</p></details>';}
  async function choosePdf(input){const id=input.dataset.book,file=input.files?.[0];if(!file||!manifest?.books.some(b=>b.bookId===id))return;const token={};pdfChanges.set(id,token);try{if(file.type&&file.type!=='application/pdf')throw Error('請選擇PDF檔案；原來的選檔仍保留。');const header=new Uint8Array(await file.slice(0,5).arrayBuffer());if(header.length!==5||String.fromCharCode(...header)!=='%PDF-')throw Error('無法辨識PDF檔頭；原來的選檔仍保留。');if(pdfChanges.get(id)!==token)return;const pdf=new Blob([file],{type:'application/pdf'}),url=URL.createObjectURL(pdf),old=localPdfs.get(id);localPdfs.set(id,{url,name:file.name||'本機PDF'});pdfMessages.delete(id);if(old)URL.revokeObjectURL(old.url);}catch(error){if(pdfChanges.get(id)===token)pdfMessages.set(id,error.message||'無法開啟這個PDF；原來的選檔仍保留。');}finally{input.value='';if(pdfChanges.get(id)===token&&(view.bookId===id||view.extra))render();}}
  function disposePdfs(){for(const pdf of localPdfs.values())URL.revokeObjectURL(pdf.url);localPdfs.clear();pdfMessages.clear();pdfChanges.clear();}
  function sourceRefs(refs,bookId=view.bookId){return '<p class="tb-source">'+(refs||[]).map(r=>{const bid=view.extra?(r.bookId||bookId):bookId,pdf=localPdfs.get(bid),item=books.get(bid)||manifest?.books.find(b=>b.bookId===bid),count=item?.source.pdfPageCount;return (view.extra&&bid!==bookId?'第 '+esc(manifest.books.find(b=>b.bookId===bid)?.section)+' 卷 · ':'')+'PDF p. '+(r.pdfPages||[]).map(n=>pdf&&Number.isInteger(n)&&n>0&&n<=count?'<a href="'+esc(pdf.url+'#page='+n)+'" target="_blank" rel="noopener noreferrer">'+n+'</a>':esc(n)).join('、')+(r.printedPages?.length?'；書頁 '+esc(r.printedPages.join('、')):'；印刷頁碼未另核對')+(r.chapterHeading?' · '+esc(r.chapterHeading):'');}).join('<br>')+'</p>';}
  function pageUrl(bid,n){const pdf=localPdfs.get(bid),item=books.get(bid)||manifest?.books.find(b=>b.bookId===bid),count=item?.source.pdfPageCount;return pdf&&Number.isInteger(n)&&n>0&&n<=count?pdf.url+'#page='+n:null;}
  function inlinePdf(){const nav=window.navigator;if(!nav)return true;if(nav.pdfViewerEnabled===false)return false;return !/iP(hone|ad|od)/.test(nav.userAgent||'')&&!(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);}
  function figureFrame(bid,n){const url=pageUrl(bid,n),section=manifest?.books.find(b=>b.bookId===bid)?.section,message=pdfMessages.get(bid);if(!localPdfs.has(bid))return '<div class="tb-figure tb-figure-empty"><p>原書圖頁 PDF p. '+esc(n)+'：尚未選擇第 '+esc(section)+' 卷PDF。</p><label class="tb-figure-load">選擇本卷PDF以顯示圖頁<input type="file" accept="application/pdf,.pdf" data-tb-pdf data-book="'+esc(bid)+'"></label>'+(message?'<p role="status">'+esc(message)+'</p>':'')+'<p class="tb-small">檔案只在本機顯示，不上傳、不存入進度；重新整理後需再選。</p></div>';if(!url)return '<div class="tb-figure tb-figure-empty"><p>PDF p. '+esc(n)+' 不在本卷PDF頁數內，無法顯示。</p></div>';return '<figure class="tb-figure">'+(inlinePdf()?'<iframe src="'+esc(url)+'" title="原書 PDF 第 '+n+' 頁" loading="lazy"></iframe>':'<p class="tb-small">這個瀏覽器無法在頁內顯示PDF，請改用新分頁開啟。</p>')+'<figcaption>第 '+esc(section)+' 卷 PDF p. '+n+' · 只在本機顯示，版次與頁序請自行確認 · <a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">在新分頁開啟</a></figcaption></figure>';}
  function questionFigures(q,bid){const out=[],seen=new Set(),add=(book,n)=>{if(Number.isInteger(n)&&n>0&&!seen.has(book+'|'+n)){seen.add(book+'|'+n);out.push({bid:book,n});}};const missing=[...new Set((q.unitIds||[]).map(id=>String(id).match(/^bcsc-s\d{2}/)?.[0]).filter(b=>b&&!books.has(b)))];if(missing.length)Promise.all(missing.map(loadBook)).then(()=>{if(view.questionId===q.id&&root?.isConnected)render();},()=>{});if(q.requiresImage)for(const r of q.sourceRefs||[])for(const n of r.pdfPages||[])add(view.extra?(r.bookId||bid):bid,n);for(const id of q.unitIds||[]){const book=String(id).match(/^bcsc-s\d{2}/)?.[0],u=books.get(book)?.chapters.flatMap(c=>c.units).find(u=>u.id===id);for(const i of u?.imageClues||[])add(book,i.pdfPage);}return out;}
  function withFigures(q,bid,article){const figures=questionFigures(q,bid);if(!figures.length)return article;const key=view.figure?.startsWith(q.id+'|')?view.figure.slice(q.id.length+1):'',current=figures.find(f=>f.bid+'|'+f.n===key)||figures[0];return '<div class="tb-question-layout">'+article+'<aside class="tb-figure-panel" aria-label="原書圖頁"><h3>原書圖頁</h3>'+(figures.length>1?'<div class="tb-figure-pages">'+figures.map(f=>button('p. '+f.n,'figure',q.id+'|'+f.bid+'|'+f.n,'aria-pressed="'+(f===current)+'"')).join('')+'</div>':'')+figureFrame(current.bid,current.n)+'</aside></div>';}
  function record(kind,id){return bridge()?.read(kind,id)||null;}
  function data(){return view.extra?extraPack:books.get(view.bookId);}
  function chapter(){const b=data();return b?.chapters.find(c=>c.id===view.chapterId)||b?.chapters[0];}
  function ensureAtlas(){const atlas=window.TextbookAtlas||window.OphTextbookAtlas;if(atlasPack)return Promise.resolve(atlasPack);if(!atlas?.load)return Promise.resolve(null);atlasPending||=atlas.load().then(d=>(atlasPack=d),()=>null);return atlasPending;}
  function atlasCount(bid){const v=atlasPack?.volumes?.find(x=>x.bookId===bid);return v?v.units.length:null;}
  function route(hash){const atlas=String(hash||'').match(/^#textbook-atlas(?:-(bcsc-s(?:0[1-9]|1[0-3]))(?:-(atlas-s(?:0[1-9]|1[0-3])-(?:0[1-9]|[1-9]\d)))?)?$/);if(atlas)return {atlas:true,bookId:atlas[1]||null,unitId:atlas[2]||null};const x=String(hash||'').match(/^#textbook-extra(?:-(extra-\d{8}-q\d{3}))?$/);if(x)return {extra:true,target:x[1]||null};const m=String(hash||'').match(/^#textbook(?:-(bcsc-s(?:0[1-9]|1[0-3]))(?:-(ch\d{3}(?:-iq\d{3}|-u\d{2})?|rq\d{3}))?)?$/);if(!m)return null;return {bookId:m[1]||null,target:m[2]?m[1]+'-'+m[2]:null};}
  function setHash(target=''){
    const hash=view.extra?'#textbook-extra'+(target?'-'+target:''):view.bookId?'#textbook-'+view.bookId+(target?'-'+target.slice(view.bookId.length+1):''):'#textbook';
    window.history?.replaceState(null,'',hash);bridge()?.rememberLocation();
  }
  async function openAtlas(bookId=null,unitId=null,focus=true){
    if(unitId&&(!bookId||!unitId.startsWith('atlas-'+bookId.slice(5)+'-')))unitId=null;
    view.extra=false;view.mode='atlas';view.bookId=bookId;view.atlasId=unitId;view.feedbackId=null;
    const token=++request;window.OphStudy?.leave();window.OphStudy?.context(null,null);
    window.history?.replaceState(null,'','#textbook-atlas'+(bookId?'-'+bookId:'')+(unitId?'-'+unitId:''));bridge()?.rememberLocation();
    root.innerHTML='<p role="status">正在開啟圖解與進階內容…</p>';
    try{const book=bookId?await loadBook(bookId):null;if(token!==request||!root?.isConnected)return;if(!window.OphTextbookAtlas)throw Error('圖解元件尚未載入');
      await window.OphTextbookAtlas.mount(root,{manifest,book,bookId,unitId,focus,isCurrent:()=>token===request&&view.mode==='atlas',onSelect:(bid,uid)=>{void openAtlas(bid,uid);},onBack:()=>{request++;view.mode='read';view.extra=false;view.bookId=null;view.atlasId=null;setHash();render();root.querySelector('.tb-heading')?.scrollIntoView({block:'start'});},onChapter:async id=>{const bid=id.match(/^bcsc-s\d{2}/)?.[0];if(!bid)return;view.bookId=bid;view.extra=false;view.mode='read';setHash(id===bid?'':id);await openBook(bid,id===bid?null:id);const heading=root?.querySelector('.tb-chapter-heading');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'auto'});}});
      if(!atlasPack)window.OphTextbookAtlas.load?.().then(d=>{atlasPack=d;},()=>{});
    }catch(_){if(token===request&&root?.isConnected)root.innerHTML='<div class="tb-empty"><h2>圖解暫時無法開啟</h2><p>請重試，或先讀原有章節。</p>'+button('重試圖解','atlas',bookId||'')+button('全部卷別','library')+'</div>';}
  }
  async function json(path){const r=await fetch(new URL(path,base));if(!r.ok)throw Error('無法讀取教材');return r.json();}
  async function catalog(){if(manifest)return manifest;manifestPending||=json('content/textbook-manifest.json').then(d=>{if(d.schemaVersion!==1||!Array.isArray(d.books))throw Error('教材清單格式不符');manifest=d;return d;}).catch(e=>{manifestPending=null;throw e;});return manifestPending;}
  async function loadBook(id){if(books.has(id))return books.get(id);const item=manifest.books.find(x=>x.bookId===id);if(!item||!/^content\/textbook-depth\/bcsc-s\d{2}\.json$/.test(item.file))throw Error('找不到這卷教材');if(!pending.has(id))pending.set(id,json(item.file).then(b=>{if(b.schemaVersion!==1||b.bookId!==id||!Array.isArray(b.chapters)||!Array.isArray(b.questions))throw Error('教材內容格式不符');books.set(id,b);return b;}).catch(e=>{pending.delete(id);throw e;}));return pending.get(id);}
  async function loadExtra(){if(window.OphAdvancedCatalog){const merged=await window.OphAdvancedCatalog.extra();extraPack={...merged,source:{edition:merged.packId},chapters:[]};return extraPack;}if(extraPack)return extraPack;extraPending||=json('content/textbook-depth/additional-practice.json').then(p=>{if(p.schemaVersion!==1||p.packId!=='additional-20261020'||p.origin!=='original-extra-practice'||!Array.isArray(p.questions)||p.questions.some(q=>!/^extra-20261020-q\d{3}$/.test(q.id)||!manifest.books.some(b=>b.bookId===q.bookId)||!Array.isArray(q.options)||q.options.length!==4))throw Error('自編練習格式不符');extraPack={...p,source:{edition:p.packId},chapters:[]};return extraPack;}).catch(e=>{extraPending=null;throw e;});return extraPending;}
  function extraHeader(){return '<div class="tb-back">'+button('全部卷別','library')+'</div><header class="tb-heading"><h1>自編陌生病例</h1><p>'+esc(String(extraPack.notice||'全新原創練習，非原書題').replace(/[。.\s]+$/,''))+'。本區額外 '+extraPack.questions.length+' 題，與原書540個題目概念分開記錄。</p><p>先選答案再看逐選項推理；看過解答與掌握相關單元分開記錄。</p></header>';}
  async function openExtra(target){view.feedbackId=null;view.extra=true;view.bookId=null;view.mode='questions';const token=++request;root.innerHTML='<p role="status">正在載入自編陌生病例…</p>';try{const p=await loadExtra();if(token!==request||!root?.isConnected)return;if(target&&/^extra-20261022-/.test(target)&&!p.questions.some(q=>q.id===target))throw Error('指定進階題目前無法載入');view.questionId=p.questions.some(q=>q.id===target)?target:p.questions[0]?.id;if(target&&view.questionId===target)view.filter='all';render();}catch(_){if(token===request&&root?.isConnected)root.innerHTML='<div class="tb-empty"><h2>自編練習暫時無法載入</h2><p>請重試，或先回原文書書架。</p>'+button('重試','extra',target||'')+button('全部卷別','library')+'</div>';}}
  function totals(){return manifest.books.reduce((a,b)=>{const c=b.coverage||{};a.chapters+=b.expected.chapters;a.questions+=b.expected.questions;a.taught+=c.taughtChapters||0;a.concepts+=c.readyQuestions||0;a.images+=c.verifiedImages||0;return a;},{chapters:0,questions:0,taught:0,concepts:0,images:0});}
  function library(){const t=totals();return '<section class="tb-atlas-entry"><h2>各卷圖解與進階推演</h2><p>收錄各卷原創醫學圖解，搭配鑑別比較、決策理由與病例推演；不需先選取PDF。</p>'+button('瀏覽全部卷別圖解','atlas')+'</section><section class="tb-extra-entry advanced-deep-library"><h2>深度臨床推理</h2><p>把分散章節接成臨床決策：比對衝突線索、檢查限制與治療先後，再練全新Hard病例。</p><a class="btn primary" href="#tab-advanced">開啟深度單元與新病例</a></section><section class="tb-extra-entry"><h2>自編陌生病例</h2><p>把已讀過的概念換成新的病例線索，與原書概念題分開練習。</p>'+button('開始自編陌生題','extra')+'</section><header class="tb-heading"><h1>原文書進階</h1><p>把原書章節讀成機轉、判斷與下一步。從一卷開始，先回想，再看推理。</p></header><div class="tb-scope"><strong>BCSC '+esc(manifest.edition)+'</strong><span>'+t.chapters+' 章來源對照 · '+t.questions+' 個原書題目概念</span><p>教材已補入 '+t.taught+' 章；已重述 '+t.concepts+' 個題目概念。原圖核對另列，與自評掌握分開記錄。</p></div><div class="tb-library">'+manifest.books.map(b=>{const c=b.coverage||{},ac=atlasCount(b.bookId);return '<article class="tb-book"><div class="tb-book-number">'+String(b.section).padStart(2,'0')+'</div><div><h2>'+esc(b.title)+'</h2><p>'+b.expected.chapters+' 章 · '+b.expected.questions+' 個題目概念</p><p class="tb-small">已編寫 '+(c.authoredChapters||0)+' 章／已核對 '+(c.taughtChapters||0)+' 章；題解已編寫 '+(c.authoredQuestions||0)+'／已核對 '+(c.readyQuestions||0)+'；原圖已核對 '+(c.verifiedImages||0)+' 項</p></div>'+'<div class="tb-book-actions">'+button('開啟這卷','book',b.bookId)+button(ac!==null?'圖解與進階 · '+ac+' 個':'圖解與進階','atlas',b.bookId)+'</div></article>';}).join('')+'</div><details class="tb-method"><summary>來源與完成狀態怎麼看</summary><p>章名與題號是來源範圍。只有具體教材或原創題解通過檢查後，才列入已補入或已重述；它們不等於你已掌握，也不表示原圖已核對。文字重述供學習，不能代替最新指引與臨床督導。</p><p>共筆教材保留原來的來源對照；本區另外追溯原文書版次、章節與頁碼。原書全文及未授權圖像未公開。</p></details>';}
  function bookHeader(b){const summary=manifest.books.find(x=>x.bookId===b.bookId),c=b.coverage.summary,ac=atlasCount(b.bookId);return '<div class="tb-back">'+button('全部卷別','library')+'</div><header class="tb-heading"><p class="tb-section">BCSC 第 '+summary.section+' 卷 · '+esc(b.source.edition)+'</p><h1>'+esc(b.source.title)+'</h1><p>教材已編寫 '+c.authoredChapters+' / '+b.chapters.length+' 章，已核對 '+c.taughtChapters+' 章；題解已編寫 '+c.authoredQuestions+' / '+summary.expected.questions+'，已核對 '+c.readyQuestions+'；原圖已核對 '+c.verifiedImages+' 項。</p><div class="tb-atlas-summary"><strong>'+(ac!==null?'原創圖解 '+ac+' 個':'原創醫學圖解')+'</strong><span>搭配進階比較與病例推演</span>'+button('開啟本卷圖解與進階','atlas',b.bookId)+'</div></header>'+pdfPicker(b)+'<nav class="tb-modes" aria-label="本卷閱讀方式">'+[['read','章節深讀'],['atlas','圖解與進階'],['questions','題目推理'],['coverage','來源與缺口']].map(([m,t])=>button(t,'mode',m,'aria-pressed="'+(view.mode===m)+'"')).join('')+'</nav>';}
  function memoryAidHtml(u){const ma=u.memoryAid;if(!ma)return '';const flow=Array.isArray(ma.visualFlow)?ma.visualFlow:[];return '<section class="tb-memory-card" aria-label="秒懂與速記卡"><div class="tb-ma-grid"><div class="tb-ma-item tb-ma-oneliner"><span class="tb-ma-tag">一句話秒懂</span><p>'+formatRich(ma.oneLiner)+'</p></div><div class="tb-ma-item tb-ma-mnemonic"><span class="tb-ma-tag">記憶口訣</span><p><strong>'+esc(ma.mnemonic)+'</strong></p></div></div>'+(flow.length?'<div class="tb-ma-flow-wrap"><span class="tb-ma-tag">視覺流程圖</span><ol class="tb-visual-flow">'+flow.map((f,i)=>'<li class="tb-vf-node"><div class="tb-vf-step"><span class="tb-vf-num">'+(i+1)+'</span><strong>'+esc(f.step)+'</strong></div><p class="tb-vf-detail">'+formatRich(f.detail)+'</p></li>').join('')+'</ol></div>':'')+'<div class="tb-ma-trigger"><span class="tb-ma-tag">考題秒判</span><p>'+formatRich(ma.examTrigger)+'</p></div></section>';}
  function studyGuideHtml(ch){const sg=ch.studyGuide;if(!sg)return '';const mnemonics=Array.isArray(sg.masterMnemonics)?sg.masterMnemonics:[],contrasts=Array.isArray(sg.quickContrasts)?sg.quickContrasts:[];return '<section class="tb-study-guide" aria-label="本章速記總覽"><div class="tb-sg-header"><span class="tb-sg-badge">本章速記總覽</span><p class="tb-sg-tagline">'+formatRich(sg.chapterTagline)+'</p></div>'+(mnemonics.length?'<div class="tb-sg-mnemonics">'+mnemonics.map(m=>'<div class="tb-sg-card"><span class="tb-sg-label">'+esc(m.label)+'</span><strong class="tb-sg-formula">'+esc(m.formula)+'</strong><p>'+formatRich(m.meaning)+'</p></div>').join('')+'</div>':'')+(contrasts.length?'<div class="tb-sg-contrasts"><h3>秒辨對照</h3><dl>'+contrasts.map(c=>'<div><dt>'+formatRich(c.pair)+'</dt><dd>'+formatRich(c.rule)+'</dd></div>').join('')+'</dl></div>':'')+'</section>';}
  function chapterToolbar(b,ch){if(!ch.units.length)return '<p class="tb-chapter-atlas">'+button('搭配本卷圖解延伸閱讀','atlas',b.bookId)+'</p>';return '<div class="tb-read-toolbar" role="region" aria-label="本章學習工具"><div class="tb-style-switch"><span>學習視圖：</span>'+button('完整精讀','read-style','full','aria-pressed="'+(readStyle==='full')+'"')+button('圖解速記（好背模式）','read-style','digest','aria-pressed="'+(readStyle==='digest')+'"')+button('搭配本卷圖解延伸閱讀','atlas',b.bookId,'class="tb-atlas-link-btn"')+'</div><nav class="tb-unit-pills" aria-label="本章單元快速跳轉">'+ch.units.map((u,i)=>button((i+1)+'. '+esc(u.title),'jump-unit',u.id,'class="tb-unit-pill"')).join('')+'</nav></div>';}
  function unit(u,book=data()){const mark=record('unit',u.id);const na=u.notApplicable||{};const bookId=book?.bookId||view.bookId,unitVisuals=window.TextbookAtlas?.renderInlineUnitCards?window.TextbookAtlas.renderInlineUnitCards(bookId,u.id,zoomedInlineAtlas):(window.OphTextbookAtlas?.renderInlineUnitCards?.(bookId,u.id,zoomedInlineAtlas)||'');function section(title,key,body){if(u[key]?.length){const inner='<section class="tb-domain"><h3>'+title+'</h3>'+body+'</section>';if(readStyle==='digest'&&key!=='differential'){const keepOpen=key==='imageClues'&&(u.imageClues||[]).some((_,n)=>openFigures.has(u.id+'|'+n));return '<details class="tb-digest-fold"'+(keepOpen?' open':'')+'><summary>展開詳讀：'+title+'（'+u[key].length+' 項）</summary>'+inner+'</details>';}return inner;}return na[key]?'<p class="tb-na">'+title+'：'+esc(na[key])+'</p>':'';}
    return '<article class="tb-unit" id="'+esc(u.id)+'"><header><h2>'+esc(u.title)+'</h2><span class="tb-status">'+label(u.status)+'</span></header>'+sourceRefs(u.sourceRefs)+memoryAidHtml(u)+unitVisuals+section('機轉與因果','mechanism',list(u.mechanism||[])+renderCalcChecks(u.calculationChecks))+section('看到什麼，代表什麼','clinicalClues','<dl class="tb-clues tb-clinical-clues">'+(u.clinicalClues||[]).map(c=>'<div><dt>'+formatRich(c.finding)+'</dt><dd>'+formatRich(c.meaning)+'</dd></div>').join('')+'</dl>')+section('鑑別與分辨線索','differential','<div class="tb-table-wrap"><table><thead><tr><th>鑑別</th><th>支持／反對</th><th>下一個分辨點</th></tr></thead><tbody>'+(u.differential||[]).map(d=>'<tr><th>'+formatRich(d.diagnosis)+'</th><td><b>支持：</b>'+formatRich(d.for)+'<br><b>反對：</b>'+formatRich(d.against)+'</td><td>'+formatRich(d.discriminator)+'</td></tr>').join('')+'</tbody></table></div>')+section('檢查要回答的問題','investigations','<div class="tb-investigations">'+(u.investigations||[]).map(i=>'<section><h4>'+formatRich(i.test)+'</h4><p><b>目的：</b>'+formatBullet(i.purpose)+'</p><p><b>解讀：</b>'+formatBullet(i.interpretation)+'</p><p class="tb-small"><b>限制：</b>'+formatBullet(i.limitation)+'</p></section>').join('')+'</div>')+section('分層處置與理由','management','<ol class="tb-management">'+(u.management||[]).map(m=>'<li><strong>'+formatRich(m.stage)+'</strong><p class="tb-condition">'+formatRich(m.condition)+'</p><p>'+formatBullet(m.action)+'</p><p><b>理由：</b>'+formatBullet(m.rationale)+'</p><p class="tb-small"><b>留意：</b>'+formatBullet(m.caution)+'</p></li>').join('')+'</ol>')+section('圖像判讀線索','imageClues',(u.imageClues||[]).map((i,n)=>'<div class="tb-image-clue"><span class="tb-image-status">'+esc(imageLabels[i.status]||imageLabels['not-reviewed'])+'</span><h4>'+esc(i.modality)+'</h4><p><b>找：</b>'+formatRich(i.clue)+'</p><p><b>解讀：</b>'+formatRich(i.interpretation)+'</p>'+(i.figureId||i.pdfPage?'<p class="tb-source">'+esc(i.figureId||'')+(i.pdfPage?' · PDF p. '+esc(i.pdfPage):'')+'</p>':'')+(Number.isInteger(i.pdfPage)&&i.pdfPage>0?(openFigures.has(u.id+'|'+n)?button('收起原書圖頁','unit-figure',u.id+'|'+n,'aria-expanded="true"')+figureFrame(view.bookId,i.pdfPage):button('在這裡顯示原書圖頁 p. '+i.pdfPage,'unit-figure',u.id+'|'+n,'aria-expanded="false"')):'')+'</div>').join(''))+section('易錯之處','pitfalls','<dl class="tb-clues tb-pitfalls">'+(u.pitfalls||[]).map(p=>'<div class="tb-pitfall-card"><dt><span class="tb-pf-tag tb-pf-mistake">✗ 常見誤區</span>'+formatRich(p.mistake)+'</dt><dd><span class="tb-pf-tag tb-pf-correct">✓ 臨床正解</span>'+formatRich(p.correction)+'</dd></div>').join('')+'</dl>')+updates(u)+renderRecall(u.recall)+'<div class="tb-self"><span>這一單元的自評</span>'+button('待複習','rate',u.id+'|review','aria-pressed="'+(mark?.rating==='review')+'"')+button('能解釋','rate',u.id+'|known','aria-pressed="'+(mark?.rating==='known')+'"')+'</div></article>';}
  function reading(b){const ch=chapter();if(!ch)return '<p>這卷章節尚未補入。</p>';const zhTitle=CHAPTER_ZH_TITLES[ch.id]||'',chapterUnitIds=ch.units.map(u=>u.id),atlas=window.TextbookAtlas||window.OphTextbookAtlas,visuals=atlas?.renderInlineChapterCards?atlas.renderInlineChapterCards(b.bookId,ch.id,chapterUnitIds,zoomedInlineAtlas):(atlas?.inlineChapterHtml?.(b.bookId,ch.id,zoomedInlineAtlas)||'');return '<div class="tb-reading"><aside class="tb-chapter-nav" aria-label="本卷章節">'+b.chapters.map(c=>{const czh=CHAPTER_ZH_TITLES[c.id];return button('<span>'+c.number+'</span><span class="tb-nav-label">'+esc(c.title)+(czh?'<small class="tb-nav-zh">'+esc(czh.split('：')[0])+'</small>':'')+'</span>','chapter',c.id,(c.id===ch.id?'aria-current="page"':''));}).join('')+'</aside><div class="tb-chapter"><header class="tb-chapter-heading"><p>第 '+ch.number+' 章</p><h2>'+esc(ch.title)+'</h2>'+(zhTitle?'<p class="tb-chapter-zh">'+esc(zhTitle)+'</p>':'')+sourceRefs(ch.sourceRefs)+'</header>'+chapterToolbar(b,ch)+studyGuideHtml(ch)+visuals+updates({},scopedUpdates(b,'chapterIds',ch.id))+(ch.units.length?ch.units.map(u=>unit(u,b)).join(''):'<p class="tb-empty">這一章只有來源對照，教材尚待補入；不列為已完成。</p>')+'</div></div>';}
  function questions(b){const progressKind=view.extra?'extra-question':'question',all=b.questions;const available=view.filter==='review'?all.filter(q=>{const r=record(progressKind,q.id);return q.id===view.feedbackId||!r?.revealed||r.choice!==q.correctIndex;}):all;const q=available.find(q=>q.id===view.questionId)||available[0];if(q)view.questionId=q.id;window.OphStudy?.context(q?(view.extra?'extra':'book'):null,q?.id);const rec=q?record(progressKind,q.id):null;const selected=rec?.choice;const verified=q?.readiness==='ready';const revealed=!verified||rec?.revealed===true;
    return (!verified&&q?'<p class="tb-draft-notice">本題已編寫，仍待來源與醫學核對；目前只供檢閱推理，不記錄答題成績。</p>':'')+'<div class="tb-question-toolbar"><label>練習範圍 <select data-tb-filter><option value="all" '+(view.filter==='all'?'selected':'')+'>全部已補入概念</option><option value="review" '+(view.filter==='review'?'selected':'')+'>未答與待複習</option></select></label><span>'+available.length+' 題可練習</span></div>'+(q?withFigures(q,view.extra?q.bookId:view.bookId,'<article class="tb-question"><div class="tb-question-meta"><span>'+(available.indexOf(q)+1)+' / '+available.length+'</span><span>'+(view.extra?'自編原創練習 · '+esc(manifest.books.find(x=>x.bookId===q.bookId)?.title||''):esc(q.questionScope==='chapter-inline'?'章內練習':'卷末練習')+' · 原書題號 '+esc(q.sourceNumber))+'</span><span>'+esc(imageLabels[q.imageStatus]||imageLabels['not-reviewed'])+'</span></div>'+updates({},scopedUpdates(b,'questionIds',q.id))+'<h2>'+esc(q.stem)+'</h2><div class="tb-options" role="group" aria-label="答案選項">'+optionOrder(q).map((i,position)=>{const o=q.options[i];return button('<span class="tb-option-letter">'+String.fromCharCode(65+position)+'</span><span>'+esc(o.text)+'</span>','answer',q.id+'|'+i,'aria-pressed="'+(selected===i)+'" '+(revealed?'disabled':'')+' class="'+(revealed?(i===q.correctIndex?'correct':i===selected?'wrong':''):'')+'"');}).join('')+'</div><div class="tb-question-actions">'+(verified?button(revealed?'重新作答':'看逐選項推理',revealed?'retry':'reveal',q.id,selected===undefined?'disabled':''):'')+'</div>'+(revealed?'<section class="tb-feedback"><h3>'+(!verified?'待核對的原創題解':selected===q.correctIndex?'答對了，確認理由是否相同':'先找出改變答案的線索')+'</h3><p>'+esc(q.explanation)+'</p>'+(window.OphAdvanced?.reasoningHtml(q,revealed)||'')+'<ol class="tb-rationales">'+optionOrder(q).map((i,position)=>{const o=q.options[i];return '<li><strong>'+String.fromCharCode(65+position)+' · '+(i===q.correctIndex?'本題正確':'本題不選')+'</strong><p>'+esc(o.rationale)+'</p>'+(o.whenTrue?'<p class="tb-small"><b>在哪種設定可能成立：</b>'+esc(o.whenTrue)+'</p>':'')+'</li>';}).join('')+'</ol>'+(window.OphStudy?.ratingHtml(view.extra?'extra':'book',q.id)||'')+updates(q)+sourceRefs(q.sourceRefs,view.extra?q.bookId:view.bookId)+'<div class="tb-related">'+(view.extra?q.unitIds.map((id,i)=>button('回讀相關單元 '+(i+1),'linked-unit',id.match(/^bcsc-s\d{2}/)[0]+'|'+id)):q.chapterIds.map(id=>{const c=b.chapters.find(c=>c.id===id);return c?button('回讀：'+esc(c.title),'chapter',id):'';})).join('')+'</div></section>':'')+'<div class="tb-question-nav">'+button('上一題','question',available[(available.indexOf(q)-1+available.length)%available.length].id)+button('下一題','question',available[(available.indexOf(q)+1)%available.length].id)+'</div></article>'):'<p class="tb-empty">這個範圍沒有待複習題。可切回全部概念，或回章節練習解釋。</p>');}
  function coverage(b){const c=b.coverage;return '<section class="tb-coverage"><h2>來源對照與仍待補的部分</h2><p>原書題目概念使用重新編寫的題幹與選項。原圖核對、來源答案核對與學習自評各自記錄。</p><p class="tb-source">'+esc(b.source.title)+' · '+esc(b.source.edition)+' · PDF '+b.source.pdfPageCount+' 頁</p><div class="tb-table-wrap"><table><thead><tr><th>章節</th><th>教材</th><th>原圖</th><th>仍待補</th></tr></thead><tbody>'+c.chapterRows.map(r=>{const ch=b.chapters.find(c=>c.id===r.chapterId);return '<tr><th>'+esc(ch?.title||r.chapterId)+'</th><td>'+label(r.teachingStatus)+'</td><td>'+esc(imageLabels[r.originalImageStatus])+'</td><td>'+esc(r.gaps.join('；')||'目前未另列')+'</td></tr>';}).join('')+'</tbody></table></div><h3>題目概念對照</h3><div class="tb-table-wrap"><table><thead><tr><th>原題號</th><th>概念重述</th><th>來源答案</th><th>原圖與缺口</th></tr></thead><tbody>'+c.questionRows.map(r=>'<tr><th>'+esc(r.questionScope==='chapter-inline'?'章內 ':'卷末 ')+esc(r.sourceNumber)+'</th><td>'+(r.questionId?button(label(r.conceptStatus),'question',r.questionId):label(r.conceptStatus))+'</td><td>'+esc({matched:'已對照',missing:'來源缺答案',unverified:'尚未核對'}[r.sourceAnswerStatus]||'尚未核對')+'</td><td>'+esc(imageLabels[r.originalImageStatus])+(r.gaps.length?'<br>'+esc(r.gaps.join('；')):'')+'</td></tr>').join('')+'</tbody></table></div></section>';}
  function render(){if(!root?.isConnected||!manifest)return;if(view.mode==='atlas'){void openAtlas(view.bookId,view.atlasId,false);return;}if(!data()||!view.extra&&view.mode!=='questions')window.OphStudy?.context(null,null);root.innerHTML=view.extra&&data()?extraHeader()+questions(data()):view.bookId&&data()?bookHeader(data())+(view.mode==='read'?reading(data()):view.mode==='questions'?questions(data()):coverage(data())):library();}
  async function openBook(id,target){view.feedbackId=null;view.extra=false;view.bookId=id;const token=++request;root.innerHTML='<p role="status">正在開啟這卷教材…</p>';try{const [b]=await Promise.all([loadBook(id),ensureAtlas()]);if(token!==request||!root?.isConnected)return;if(target&&b.questions.some(q=>q.id===target)){view.mode='questions';view.questionId=target;view.filter='all';}else{view.mode='read';view.chapterId=b.chapters.find(c=>c.id===target||c.units.some(u=>u.id===target))?.id||b.chapters[0]?.id;}render();if(target&&/-u\d{2}$/.test(target))root.querySelector('#'+target)?.scrollIntoView({block:'start'});}catch(_){if(token===request&&root?.isConnected)root.innerHTML='<div class="tb-empty"><h2>這卷暫時無法開啟</h2><p>請重試載入，或先回書架選擇其他卷。</p>'+button('重試','book',id)+button('全部卷別','library')+'</div>';}}
  function action(e){const a=e.target.closest('[data-tb-action]');if(!a||a.disabled)return;const value=a.dataset.value,kind=a.dataset.tbAction;if(['library','book','mode','chapter','question','linked-unit','extra','retry','open-atlas-unit'].includes(kind))window.OphStudy?.leave();const b=data();
    if(kind==='atlas'){void openAtlas(value||null);return;}
    if(kind==='read-style'){readStyle=value==='digest'?'digest':'full';render();return;}
    if(kind==='inline-atlas-zoom'){if(!/^atlas-s(?:0[1-9]|1[0-3])-(?:0[1-9]|[1-9]\d)$/.test(value))return;if(zoomedInlineAtlas.has(value))zoomedInlineAtlas.delete(value);else zoomedInlineAtlas.add(value);render();return;}
    if(kind==='open-atlas-unit'){if(!view.bookId||!/^atlas-s(?:0[1-9]|1[0-3])-(?:0[1-9]|[1-9]\d)$/.test(value)||!value.startsWith('atlas-'+view.bookId.slice(5)+'-'))return;void openAtlas(view.bookId,value);return;}
    if(kind==='jump-unit'){if(!/^bcsc-s(?:0[1-9]|1[0-3])-ch\d{3}-u\d{2}$/.test(value))return;setHash(value);const id=typeof CSS!=='undefined'&&CSS.escape?CSS.escape(value):value;root.querySelector('#'+id)?.scrollIntoView?.({block:'start'});return;}
    if(kind==='library'){request++;view.mode='read';view.atlasId=null;view.feedbackId=null;view.extra=false;view.bookId=null;setHash();render();}
    if(kind==='extra'){view.questionId=null;view.extra=true;view.bookId=null;setHash(value);void openExtra(value);}
    if(kind==='linked-unit'){const [bid,uid]=value.split('|');if(!/^bcsc-s(?:0[1-9]|1[0-3])$/.test(bid)||!/^bcsc-s\d{2}-ch\d{3}-u\d{2}$/.test(uid)||!uid.startsWith(bid+'-'))return;view.extra=false;view.bookId=bid;setHash(uid);void openBook(bid,uid);}
    if(kind==='book'){view.extra=false;view.mode='read';view.questionId=null;view.chapterId=null;view.bookId=value;setHash();openBook(value);}
    if(kind==='mode'){if(value==='atlas'){void openAtlas(view.bookId);return;}view.feedbackId=null;view.mode=value;setHash(value==='read'?chapter()?.id:value==='questions'?view.questionId:'');render();}
    if(kind==='chapter'){view.chapterId=value;view.mode='read';setHash(value);render();root.querySelector('.tb-chapter-heading')?.scrollIntoView({block:'start'});}
    if(kind==='question'){view.feedbackId=null;view.questionId=value;view.mode='questions';setHash(value);render();root.querySelector('.tb-question')?.scrollIntoView({block:'start'});}
    if(kind==='figure'){view.figure=value;render();}
    if(kind==='unit-figure'){if(!/^bcsc-s\d{2}-ch\d{3}-u\d{2}\|\d+$/.test(value))return;if(openFigures.has(value))openFigures.delete(value);else openFigures.add(value);render();}
    if(kind==='rate'){const [id,rating]=value.split('|');bridge()?.write('unit',id,{rating,edition:b.source.edition});render();root.querySelector('#'+id+' .tb-self button[aria-pressed="true"]')?.focus();}
    if(kind==='answer'){const [id,n]=value.split('|');if(!b.questions.some(q=>q.id===id&&q.readiness==='ready'))return;bridge()?.write(view.extra?'extra-question':'question',id,{choice:Number(n),revealed:false,edition:b.source.edition});render();}
    if(kind==='reveal'||kind==='retry'){const q=b.questions.find(q=>q.id===value&&q.readiness==='ready');if(!q)return;const progressKind=view.extra?'extra-question':'question',old=record(progressKind,value);if(!old)return;if(kind==='reveal'){if(old.revealed)return;window.OphStudy?.commit(view.extra?'extra':'book',value,old.choice===q.correctIndex);}view.feedbackId=kind==='reveal'?value:null;bridge()?.write(progressKind,value,{...old,revealed:kind==='reveal',edition:b.source.edition});render();}
  }
  async function mount(target){root=target;if(!root)return;if(!root.dataset.tbBound){root.dataset.tbBound='true';root.addEventListener('click',action);root.addEventListener('change',e=>{if(e.target.matches('[data-tb-pdf]')){void choosePdf(e.target);return;}if(e.target.matches('[data-tb-filter]')){window.OphStudy?.leave();view.feedbackId=null;view.filter=e.target.value;view.questionId=null;render();}});}const token=++request;try{await catalog();if(token!==request||!root?.isConnected)return;const r=route(window.location?.hash);if(r?.atlas){await openAtlas(r.bookId,r.unitId,false);}else if(r?.extra){await openExtra(r.target);}else if(r?.bookId){await openBook(r.bookId,r.target);}else{view.extra=false;view.mode='read';view.bookId=null;view.atlasId=null;render();void ensureAtlas().then(d=>{if(d&&token===request&&root?.isConnected&&!view.bookId&&!view.extra&&view.mode!=='atlas')render();});}}catch(_){if(root?.isConnected)root.innerHTML='<div class="tb-empty"><h1>原文書書架暫時無法載入</h1><p>請重新開啟本頁。原來的共筆與練習功能仍可使用。</p>'+button('重試','reload')+'</div>';root?.querySelector('[data-tb-action="reload"]')?.addEventListener('click',()=>mount(root));}}
  window.addEventListener('hashchange',()=>{if(root?.isConnected&&route(window.location?.hash))mount(root);});
  window.addEventListener('pagehide',disposePdfs);
  window.addEventListener('beforeunload',disposePdfs);
  window.addEventListener('pageshow',()=>render());
  window.OphTextbook={mount};window.OphTextbook.refresh=render;
  const initial=document.getElementById('textbook-root');if(initial)mount(initial);
})();
