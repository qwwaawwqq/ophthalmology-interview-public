/* textbook-bridge:start */
// Shape validation deliberately does not depend on a lazily loaded book.
function textbookEntry(key,v){
  if(!key.startsWith('textbook:'))return undefined;
  if(/^textbook:extra-question:extra-\d{8}-q\d{3}$/.test(key)){
    if(!v||typeof v!=='object'||Array.isArray(v)||!Number.isInteger(v.choice)||v.choice<0||v.choice>3)return null;
    return {version:1,choice:v.choice,revealed:v.revealed===true,confidence:[0,1,2,3].includes(v.confidence)?v.confidence:0,edition:typeof v.edition==='string'?v.edition.slice(0,40):'',at:validDate(v.at)};
  }
  if(!/^textbook:(unit|question):bcsc-s(?:0[1-9]|1[0-3])-(?:ch\d{3}-u\d{2}|rq\d{3}|ch\d{3}-iq\d{3})$/.test(key)||!v||typeof v!=='object'||Array.isArray(v))return null;
  if(key.startsWith('textbook:unit:')&&!/-ch\d{3}-u\d{2}$/.test(key))return null;
  if(key.startsWith('textbook:question:')&&/-u\d{2}$/.test(key))return null;
  const at=validDate(v.at),edition=typeof v.edition==='string'?v.edition.slice(0,40):'';
  if(key.startsWith('textbook:unit:')){
    if(!['review','known'].includes(v.rating))return null;
    return {version:1,rating:v.rating,edition,at};
  }
  if(!Number.isInteger(v.choice)||v.choice<0||v.choice>3)return null;
  return {version:1,choice:v.choice,revealed:v.revealed===true,confidence:[0,1,2,3].includes(v.confidence)?v.confidence:0,edition,at};
}
function textbookPage(){return '<p class="tb-small">原創教材與題目涵蓋原書主要主題與章節重點；可選取本機 PDF 查看原書全文與圖表。</p><section id="textbook-root" aria-label="原文書進階"><p role="status">正在開啟原文書書架…</p></section>';}
window.OphTextbookBridge={
  read(kind,id){const key='textbook:'+kind+':'+id;return textbookEntry(key,entries[key])||null;},
  all(){return Object.fromEntries(Object.entries(entries).filter(([key])=>key.startsWith('textbook:')));},
  write(kind,id,value){const key='textbook:'+kind+':'+id,valid=textbookEntry(key,{...value,at:now()});if(!valid)throw Error('原文書進度格式無效');put(key,valid);},
  rememberLocation(){rememberWorkspace();},
  saveStatus(){return document.getElementById('save-status')?.textContent||'';}
};
/* textbook-bridge:end */
