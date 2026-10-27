(function () {
  'use strict';
  if (window.OphTextbookAtlas) return;
  const base = new URL('../', document.currentScript.src);
  const version = 'volume-atlas-20261028';
  const palette = {ink:'#20324a',muted:'#60758a',teal:'#187b78',blue:'#366cb1',red:'#bf4f5b',amber:'#9d6c15','pale-teal':'#dcefed','pale-blue':'#e2ecf8','pale-red':'#f6e2e5','pale-amber':'#f6edce',white:'#ffffff',none:'none'};
  let pack, pending;
  const contexts = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const color = (value, fallback) => palette[value] || palette[fallback];
  const button = (label, action, value='', extra='') => '<button type="button" data-atlas-action="'+action+'" data-value="'+esc(value)+'" '+extra+'>'+esc(label)+'</button>';
  const paragraph = text => '<p>'+esc(text)+'</p>';
  const list = items => '<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
  function shape(e, prefix) {
    if(!e||typeof e!=='object')return '';
    const numeric = keys => keys.filter(k=>finite(e[k])).map(k=>' '+k.replace('strokeWidth','stroke-width')+'="'+e[k]+'"').join('');
    const style = ' fill="'+color(e.fill,'none')+'" stroke="'+color(e.stroke,'ink')+'"'+numeric(['strokeWidth','opacity'])+(e.dash?' stroke-dasharray="8 6"':'');
    const arrow = e.arrow && ['line','path','polyline'].includes(e.type) ? ' marker-end="url(#'+prefix+'-'+(Object.prototype.hasOwnProperty.call(palette,e.stroke)?e.stroke:'ink')+')"' : '';
    if(e.type==='text') {
      if(!finite(e.x)||!finite(e.y)||!Array.isArray(e.lines)) return '';
      const size=finite(e.fontSize)&&e.fontSize>=18&&e.fontSize<=28?e.fontSize:22;
      const anchor=['start','middle','end'].includes(e.anchor)?e.anchor:'start';
      return '<text x="'+e.x+'" y="'+e.y+'" fill="'+color(e.fill,'ink')+'" font-size="'+size+'" text-anchor="'+anchor+'">'+e.lines.map((line,i)=>'<tspan x="'+e.x+'" dy="'+(i?Math.round(size*1.35):0)+'">'+esc(line)+'</tspan>').join('')+'</text>';
    }
    if(e.type==='rect') return '<rect'+numeric(['x','y','width','height','rx'])+style+'/>';
    if(e.type==='ellipse') return '<ellipse'+numeric(['cx','cy','rx','ry'])+style+'/>';
    if(e.type==='circle') return '<circle'+numeric(['cx','cy','r'])+style+'/>';
    if(e.type==='line') return '<line'+numeric(['x1','y1','x2','y2'])+style+arrow+'/>';
    if(['polyline','polygon'].includes(e.type)&&typeof e.points==='string'&&/^[\d\s.,+eE-]+$/.test(e.points)) return '<'+e.type+' points="'+esc(e.points)+'"'+style+arrow+'/>';
    if(e.type==='path'&&typeof e.d==='string'&&/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(e.d)) return '<path d="'+esc(e.d)+'"'+style+arrow+'/>';
    return '';
  }
  function svg(unit, preview=false) {
    const d=unit.diagram, prefix='atlas-arrow-'+unit.id+(preview?'-preview':'');
    const title=unit.id+(preview?'-preview':'')+'-title', description=unit.id+(preview?'-preview':'')+'-description';
    const markers=Object.entries(palette).filter(([key])=>key!=='none').map(([key,fill])=>'<marker id="'+prefix+'-'+key+'" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 Z" fill="'+fill+'"/></marker>').join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 460" role="img" aria-labelledby="'+title+' '+description+'"><title id="'+title+'">'+esc(d.title)+'</title><desc id="'+description+'">'+esc(d.alt)+'</desc><defs>'+markers+'</defs><rect width="900" height="460" fill="#fff"/>'+d.elements.map(e=>shape(e,prefix)).join('')+'</svg>';
  }
  async function load() {
    if(pack) return pack;
    pending ||= fetch(new URL('content/textbook-depth/visual-atlas.json?v='+version,base)).then(async response=>{
      if(!response.ok) throw Error('圖解教材載入失敗');
      const data=await response.json();
      if(data.schemaVersion!==1||data.id!==version||!Array.isArray(data.volumes)||data.volumes.length!==13||data.volumes.some(v=>!/^bcsc-s(?:0[1-9]|1[0-3])$/.test(v.bookId)||!Array.isArray(v.units)||v.units.length!==2||v.units.some(u=>!/^atlas-s(?:0[1-9]|1[0-3])-0[12]$/.test(u.id)||!Array.isArray(u.diagram?.elements)))) throw Error('圖解教材格式不符');
      pack=data; return data;
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  function selector(context, value='') {
    return '<label class="atlas-selector">選擇卷別<select data-atlas-volume><option value="">全部圖解卷別</option>'+context.manifest.books.map(b=>'<option value="'+esc(b.bookId)+'" '+(value===b.bookId?'selected':'')+'>第 '+b.section+' 卷　'+esc(b.title)+'</option>').join('')+'</select></label>';
  }
  function overview(context) {
    const count=pack.volumes.reduce((sum,v)=>sum+v.units.length,0);
    return '<div class="atlas-back">'+button('返回全部卷別','back')+'</div><header class="atlas-heading" tabindex="-1"><h1>各卷圖解與進階推演</h1><p>沿著結構、機轉與臨床決策閱讀。每卷兩個圖解單元，接回原本章節，再用病例檢驗推理。</p><p class="atlas-scope">'+pack.volumes.length+' 卷 · '+count+' 個原創圖解單元</p></header>'+selector(context)+'<div class="atlas-library">'+pack.volumes.map(v=>{
      const book=context.manifest.books.find(b=>b.bookId===v.bookId);
      return '<article class="atlas-volume"><header><p class="atlas-volume-number">第 '+book.section+' 卷</p><h2>'+esc(book.title)+'</h2></header><div class="atlas-preview">'+svg(v.units[0],true)+'</div><div class="atlas-volume-units">'+v.units.map(u=>button(u.title,'unit',v.bookId+'|'+u.id)).join('')+'</div></article>';
    }).join('')+'</div><p class="atlas-note">'+esc(pack.notice)+'</p>';
  }
  function references(items) {
    return '<ol class="atlas-references">'+items.map(r=>'<li>'+(typeof r.url==='string'&&/^https:\/\//.test(r.url)?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.title)+'</a>':esc(r.title))+(r.year?' ('+esc(r.year)+')':'')+(r.note?paragraph(r.note):'')+'</li>').join('')+'</ol>';
  }
  function detail(context) {
    const volume=pack.volumes.find(v=>v.bookId===context.bookId), book=context.manifest.books.find(b=>b.bookId===context.bookId);
    const unit=volume.units.find(u=>u.id===context.unitId)||volume.units[0];
    const chapters=context.book?.chapters||[];
    return '<div class="atlas-back">'+button('全部圖解卷別','overview')+button('返回本卷章節','chapter',context.bookId)+'</div><header class="atlas-heading" tabindex="-1"><p>第 '+book.section+' 卷 · '+esc(book.title)+'</p><h1>'+esc(unit.title)+'</h1></header>'+selector(context,volume.bookId)+'<nav class="atlas-unit-nav" aria-label="本卷圖解單元">'+volume.units.map(u=>button(u.title,'unit',volume.bookId+'|'+u.id,'aria-pressed="'+(u.id===unit.id)+'"')).join('')+'</nav><article class="atlas-lesson"><section class="atlas-goals"><h2>讀完要能解釋</h2>'+list(unit.learningGoals)+'<p class="atlas-clinical-question">'+esc(unit.clinicalQuestion)+'</p></section><figure class="atlas-figure" data-atlas-figure="'+unit.id+'"><div class="atlas-figure-toolbar"><h2>'+esc(unit.diagram.title)+'</h2>'+button('放大圖解','zoom',unit.id,'aria-expanded="false"')+'</div><div class="atlas-svg-scroll" tabindex="0" aria-label="'+esc(unit.diagram.title)+'，可橫向捲動放大圖解">'+svg(unit)+'</div><figcaption>原創醫學示意，非患者影像、非按比例。'+esc(unit.diagram.alt)+'</figcaption></figure><section class="atlas-reading"><h2>讀圖與判斷</h2><dl>'+unit.figureReading.map(r=>'<div><dt>'+esc(r.label)+'</dt><dd>'+esc(r.meaning)+'</dd></div>').join('')+'</dl></section><section><h2>機轉：為什麼會這樣</h2>'+unit.mechanism.map(paragraph).join('')+'</section><section><h2>把相似情況分開</h2><div class="atlas-table-scroll" tabindex="0" aria-label="'+esc(unit.title)+'的鑑別比較"><table><thead><tr>'+unit.comparison.columns.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+unit.comparison.rows.map(row=>'<tr>'+row.map((cell,i)=>i?'<td>'+esc(cell)+'</td>':'<th scope="row">'+esc(cell)+'</th>').join('')+'</tr>').join('')+'</tbody></table></div></section><section><h2>決策順序與理由</h2><ol class="atlas-decisions">'+unit.decisionSteps.map(step=>'<li><h3>'+esc(step.condition)+'</h3>'+paragraph(step.action)+'<p class="atlas-why">'+esc(step.why)+'</p></li>').join('')+'</ol></section><section><h2>容易誤判的地方</h2>'+list(unit.pitfalls)+'</section><section><h2>改一個條件，決策如何改變</h2><dl class="atlas-counterfactuals">'+unit.counterfactuals.map(c=>'<div><dt>'+esc(c.change)+'</dt><dd>'+esc(c.consequence)+'</dd></div>').join('')+'</dl></section><section><h2>病例推演與主動回想</h2>'+unit.retrieval.map((r,i)=>'<div class="atlas-retrieval"><h3>'+(r.type==='case'?'病例推演':'主動回想')+'</h3>'+paragraph(r.question)+'<details><summary>展開推理與答案</summary>'+paragraph(r.answer)+(r.reasoning?'<ol>'+r.reasoning.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>':'')+'</details></div>').join('')+'</section><section class="atlas-links"><h2>回到原章節</h2><p>原有章節、概念題及本機 PDF 圖頁仍可搭配閱讀。</p>'+unit.chapterIds.map(id=>button(chapters.find(c=>c.id===id)?.title||id,'chapter',id)).join('')+'</section><section><h2>證據與適用範圍</h2>'+references(unit.references)+'</section></article>';
  }
  function render(root,context) {
    root.innerHTML='<div class="atlas-root">'+(context.bookId?detail(context):overview(context))+'</div>';
    if(context.focus){const heading=root.querySelector('.atlas-heading');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'auto'});}
  }
  function bind(root) {
    if(root.dataset.atlasBound) return;
    root.dataset.atlasBound='true';
    root.addEventListener('click',event=>{
      const target=event.target.closest('[data-atlas-action]'),context=contexts.get(root);
      if(!target||!context||target.disabled)return;
      const {atlasAction:action,value}=target.dataset;
      if(action==='back')context.onBack();
      if(action==='overview'||action==='retry')context.onSelect(null,null);
      if(action==='unit'){const [bookId,unitId]=value.split('|');if(pack.volumes.some(v=>v.bookId===bookId&&v.units.some(u=>u.id===unitId)))context.onSelect(bookId,unitId);}
      if(action==='chapter'&&/^bcsc-s(?:0[1-9]|1[0-3])(?:-ch\d{3})?$/.test(value))context.onChapter(value);
      if(action==='zoom'){
        const figure=root.querySelector('[data-atlas-figure="'+value+'"]');
        if(!figure)return;
        const expanded=figure.dataset.expanded!=='true';figure.dataset.expanded=String(expanded);target.setAttribute('aria-expanded',String(expanded));target.textContent=expanded?'縮回圖解':'放大圖解';
      }
    });
    root.addEventListener('change',event=>{if(event.target.matches('[data-atlas-volume]'))contexts.get(root)?.onSelect(event.target.value||null,null);});
    root.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      const figure=root.querySelector('[data-atlas-figure][data-expanded="true"]');
      if(!figure)return;
      figure.dataset.expanded='false';
      const control=figure.querySelector('[data-atlas-action="zoom"]');
      control?.setAttribute('aria-expanded','false');if(control)control.textContent='放大圖解';control?.focus();event.preventDefault();
    });
  }
  async function mount(root,context) {
    contexts.set(root,context);bind(root);
    try{await load();if(contexts.get(root)!==context||!root.isConnected||!context.isCurrent())return;render(root,context);}
    catch(error){if(contexts.get(root)!==context||!root.isConnected||!context.isCurrent())return;root.innerHTML='<div class="atlas-root atlas-error"><h1>圖解教材暫時無法載入</h1><p>請重新載入，或先回原有卷別閱讀。</p>'+button('重試圖解','retry')+button('返回全部卷別','back')+'</div>';}
  }
  window.OphTextbookAtlas={mount};
})();
