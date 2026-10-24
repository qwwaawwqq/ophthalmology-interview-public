(function(g){
 'use strict';if(g.OphAdvancedCatalog)return;
 const base=new URL('../',document.currentScript.src);let hard=null,hardPending=null,legacy=null,legacyPending=null;const lookup=new Map();
 async function json(path){const r=await fetch(new URL(path,base));if(!r.ok)throw Error('進階題庫目前無法讀取');return r.json();}
 function remember(p){for(const q of p.questions){const old=lookup.get(q.id);if(old&&JSON.stringify(old)!==JSON.stringify(q))throw Error('題目ID重複且內容不一致');lookup.set(q.id,q);}return p;}
 async function load(){if(hard)return hard;hardPending||=json(g.OphAdvancedCore.PATH).then(p=>{if(!g.OphAdvancedCore.packValid(p))throw Error('進階題庫格式不符');hard=remember(p);g.OphStudy?.refreshCatalog?.();g.OphProject?.refreshCatalog?.();return hard;}).catch(e=>{hardPending=null;throw e;});return hardPending;}
 async function old(){if(legacy)return legacy;legacyPending||=json('content/textbook-depth/additional-practice.json').then(p=>{if(p.schemaVersion!==1||p.packId!=='additional-20261020'||p.origin!=='original-extra-practice'||!Array.isArray(p.questions)||p.questions.some(q=>!/^extra-20261020-q\d{3}$/.test(q.id)||!Array.isArray(q.options)||q.options.length!==4))throw Error('原自編題庫格式不符');legacy=remember(p);return legacy;}).catch(e=>{legacyPending=null;throw e;});return legacyPending;}
 async function extra(){const [p,h]=await Promise.all([old(),load().catch(()=>null)]);return {...p,advancedPackId:h?.packId||null,questions:[...lookup.values()].sort((a,b)=>a.id.localeCompare(b.id)),notice:p.notice+(h?' 另有進階臨床推理題，訓練難度由作者設定，尚未對實際甄試校準。':'')};}
 function get(id){return lookup.get(id)||null;}
 function entries(p){return p.questions.filter(g.OphAdvancedCore.eligible).map(q=>({pool:'extra',id:q.id,title:q.stem,difficulty:'advanced',domain:q.domain}));}
 g.OphAdvancedCatalog={load,old,extra,get,entries};
})(window);
