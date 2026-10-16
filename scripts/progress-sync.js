/* progress-sync:start */
// Automatic saving. Every change is kept in this browser, and when the learner connects their own
// private GitHub repo, progress.json in that repo is merged and updated automatically.
// Injected by scripts/apply-enrichment.py; the export/import file format is unchanged (v3).
const STORE={state:'oph-prep:progress-v3',cloud:'oph-prep:cloud',token:'oph-prep:cloud-token',settings:'oph-prep:settings'};
const SYNC_FILE='progress.json',SYNC_DELAY=30000,PROGRESS_FORMATS=['ophthalmology-prep-progress-v1','ophthalmology-prep-progress-v2','ophthalmology-prep-progress-v3'];
const syncState={storage:false,restored:false,lastLocal:null,localError:false,busy:false,again:false,pending:false,verified:false,lastSync:null,error:'',authError:false,remoteUpdate:false};
let localTimer=null,cloudTimer=null;
S.syncDraft={owner:'',repo:'ophthalmology-progress',token:'',remember:true};
{const c=(()=>{try{return JSON.parse(window.localStorage?.getItem('oph-prep:cloud')||'null');}catch{return null;}})();if(c?.owner)S.syncDraft.owner=c.owner;if(c?.repo)S.syncDraft.repo=c.repo;}

function storage(kind){try{const s=kind==='session'?window.sessionStorage:window.localStorage;if(!s)return null;s.setItem('oph-prep:probe','1');s.removeItem('oph-prep:probe');return s;}catch{return null;}}
function readJSON(s,key){try{const v=s?.getItem(key);return v?JSON.parse(v):null;}catch{return null;}}
function writeJSON(s,key,value){try{s.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function removeKey(key){for(const s of [storage(),storage('session')])try{s?.removeItem(key);}catch{}}
function deviceSettings(){return {autosave:true,autoSync:true,...(readJSON(storage(),STORE.settings)||{})};}
function setDeviceSetting(key,value){const s=storage();if(s)writeJSON(s,STORE.settings,{...deviceSettings(),[key]:value});}
function progressPayload(){return {format:'ophthalmology-prep-progress-v3',exportedAt:now(),entries,meta:exportMeta()};}
function canonical(value){return JSON.stringify(value,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,key)=>(o[key]=v[key],o),{}):v);}
// Compare the validated form of both copies, so stored defaults and older field layouts do not cause needless writes.
function normalizedProgress(p){const out={entries:{},meta:{}};for(const [k,v] of Object.entries(p?.entries||{})){const x=validateEntry(k,v);if(x)out.entries[k]=x;}for(const [k,v] of Object.entries(p?.meta||{})){const x=validateMeta(k,v);if(x)out.meta[k]=x;}return out;}
function sameProgress(a,b){return canonical(normalizedProgress(a))===canonical(normalizedProgress(b));}
// Merge another copy of progress without re-rendering or resetting the quiz round; the newer record per key wins.
function absorbProgress(payload){
  if(!payload||!PROGRESS_FORMATS.includes(payload.format)||!payload.entries||typeof payload.entries!=='object'||Array.isArray(payload.entries))throw syncError('保存的進度格式不符。');
  let count=0;
  for(const [key,v] of Object.entries(payload.entries)){const value=validateEntry(key,v);if(value&&(!entries[key]||Date.parse(value.at)>Date.parse(entries[key].at))){entries[key]=value;count++;}}
  if(payload.meta&&typeof payload.meta==='object'&&!Array.isArray(payload.meta))for(const [key,v] of Object.entries(payload.meta)){const value=validateMeta(key,v);if(value&&(!meta[key]||Date.parse(value.at)>Date.parse(meta[key].at))){meta[key]=value;count++;}}
  return count;
}

/* This device */
function saveLocal(){
  clearTimeout(localTimer);localTimer=null;
  const s=storage();
  if(!s||!deviceSettings().autosave){syncStatus();return false;}
  const ok=writeJSON(s,STORE.state,progressPayload());
  syncState.localError=!ok;
  if(ok){syncState.lastLocal=Date.now();dirty=false;$('.topbar').classList.remove('is-dirty');}
  syncStatus();
  return ok;
}
function flushLocal(){if(localTimer)saveLocal();}
function progressChanged(){
  clearTimeout(localTimer);localTimer=setTimeout(saveLocal,400);
  if(cloudConfig()){syncState.pending=true;if(deviceSettings().autoSync)scheduleSync(SYNC_DELAY);}
  syncStatus();
}
function clearDevice(){
  removeKey(STORE.state);removeKey(STORE.token);removeKey(STORE.cloud);
  clearTimeout(localTimer);clearTimeout(cloudTimer);localTimer=cloudTimer=null;
  entries=Object.create(null);meta=Object.create(null);dirty=false;
  Object.assign(syncState,{restored:false,lastLocal:null,pending:false,verified:false,lastSync:null,error:'',authError:false});
  S.round=Object.create(null);S.selected=null;S.confidence=0;
}

/* GitHub private repo */
const OWNER_RE=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,REPO_RE=/^[A-Za-z0-9._-]{1,100}$/;
function validRepo(owner,repo){return OWNER_RE.test(owner||'')&&REPO_RE.test(repo||'')&&repo!=='.'&&repo!=='..';}
function cloudConfig(){const c=readJSON(storage(),STORE.cloud);let token='';try{token=storage()?.getItem(STORE.token)||storage('session')?.getItem(STORE.token)||'';}catch{}return c&&token&&validRepo(c.owner,c.repo)?{owner:c.owner,repo:c.repo,token,lastSync:c.lastSync||null}:null;}
function syncError(message,extra={}){return Object.assign(new Error(message),extra);}
function gh(cfg,method,path,body,accept){
  return fetch('https://api.github.com/repos/'+encodeURIComponent(cfg.owner)+'/'+encodeURIComponent(cfg.repo)+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+cfg.token,Accept:accept||'application/vnd.github+json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
}
async function ghError(res,context){
  let detail='';try{detail=String((await res.json()).message||'').slice(0,120);}catch{}
  if(res.status===401)return syncError('GitHub token 無效或已過期。請建立新的 token 後重新連線。',{auth:true});
  if(res.status===403&&res.headers?.get?.('x-ratelimit-remaining')==='0')return syncError('已達 GitHub 每小時的請求上限，稍後會自動重試。',{retry:true});
  if(res.status===403)return syncError('這個 token 不能寫入：請確認 token 的 Repository access 選到這個 repo，且 Contents 設為 Read and write。',{auth:true});
  if(res.status===404&&context==='repo')return syncError('找不到這個 repo，或 token 沒有授權存取它。請檢查帳號、repo 名稱與 token 的 Repository access。',{auth:true});
  if(res.status>=500)return syncError('GitHub 暫時無法回應，稍後會自動重試。',{retry:true});
  return syncError('同步失敗（GitHub '+res.status+(detail?'：'+detail:'')+'）。');
}
function encodeBase64(text){const bytes=new TextEncoder().encode(text);let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(bin);}
function decodeBase64(b64){const bin=atob(String(b64).replace(/\s/g,''));const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new TextDecoder().decode(bytes);}
async function verifyRepo(cfg){
  const res=await gh(cfg,'GET','');
  if(!res.ok)throw await ghError(res,'repo');
  const info=await res.json();
  if(info.private!==true)throw syncError('這個 repo 是公開的。進度含有你的草稿與筆記，請改用 Private repo。',{auth:true});
  return info;
}
async function pullRemote(cfg){
  const res=await gh(cfg,'GET','/contents/'+SYNC_FILE);
  if(res.status===404)return {sha:null,payload:null};
  if(!res.ok)throw await ghError(res,'file');
  const info=await res.json();
  let text;
  if(info.encoding==='base64'&&info.content)text=decodeBase64(info.content);
  else{const raw=await gh(cfg,'GET','/contents/'+SYNC_FILE,null,'application/vnd.github.raw+json');if(!raw.ok)throw await ghError(raw,'file');text=await raw.text();}
  try{return {sha:info.sha,payload:JSON.parse(text)};}catch{throw syncError('雲端的 '+SYNC_FILE+' 無法讀取，請到 GitHub 檢查這個檔案。');}
}
function deviceName(){const ua=String(globalThis.navigator?.userAgent||'');return /iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Macintosh/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':'瀏覽器';}
function syncTime(t){return t?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)):'';}
function scheduleSync(ms){clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>{cloudTimer=null;syncNow('auto');},ms);}
function afterRemoteMerge(){
  syncState.remoteUpdate=true;
  const active=document.activeElement,typing=active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName||'');
  if(!typing){render();syncState.remoteUpdate=false;}
}
async function syncNow(reason='manual'){
  const cfg=cloudConfig();
  if(!cfg)return false;
  if(syncState.busy){syncState.again=true;return false;}
  clearTimeout(cloudTimer);cloudTimer=null;
  flushLocal();
  syncState.busy=true;syncState.error='';syncStatus();
  try{
    if(!syncState.verified){await verifyRepo(cfg);syncState.verified=true;}
    for(let attempt=0;attempt<3;attempt++){
      const remote=await pullRemote(cfg);
      if(remote.payload&&absorbProgress(remote.payload)){saveLocal();afterRemoteMerge();}
      const local={...progressPayload(),...normalizedProgress(progressPayload())};
      if(!remote.payload||!sameProgress(remote.payload,local)){
        const res=await gh(cfg,'PUT','/contents/'+SYNC_FILE,{message:'同步進度 · '+deviceName()+' · '+syncTime(Date.now()),content:encodeBase64(JSON.stringify(local,null,1)),...(remote.sha?{sha:remote.sha}:{})});
        if(res.status===409||res.status===422)continue;
        if(!res.ok)throw await ghError(res,'file');
      }
      syncState.pending=false;syncState.authError=false;syncState.lastSync=Date.now();
      const saved=readJSON(storage(),STORE.cloud);if(saved)writeJSON(storage(),STORE.cloud,{...saved,lastSync:syncState.lastSync});
      if(!deviceSettings().autosave){dirty=false;$('.topbar').classList.remove('is-dirty');}
      return true;
    }
    throw syncError('雲端檔案剛被其他裝置更新，稍後會自動再試。',{retry:true});
  }catch(error){
    const offline=error instanceof TypeError||!('message' in Object(error));
    syncState.error=offline?'目前無法連到 GitHub，恢復連線後會自動同步。':error.message||'同步失敗。';
    syncState.authError=!!error.auth;
    if(offline||error.retry)scheduleSync(60000);
    return false;
  }finally{
    syncState.busy=false;syncStatus();
    if(S.tab==='sync'&&cloudConfig())render();
    if(syncState.again){syncState.again=false;scheduleSync(1500);}
  }
}
async function connectCloud(){
  const d=S.syncDraft,owner=d.owner.trim(),repo=d.repo.trim().replace(/\.git$/,''),token=d.token.trim();
  if(!validRepo(owner,repo)){toast('請填入正確的 GitHub 帳號與 repo 名稱。');return;}
  if(!token||/\s/.test(token)){toast('請貼上 GitHub token。');return;}
  syncState.busy=true;syncState.error='';syncStatus();render();
  try{await verifyRepo({owner,repo,token});}
  catch(error){syncState.busy=false;syncState.error=error instanceof TypeError?'目前無法連到 GitHub，請確認網路後再試。':error.message;syncStatus();render();return;}
  syncState.busy=false;
  removeKey(STORE.token);
  const s=storage(),target=d.remember?s:storage('session');
  if(!s||!target){syncState.error='這個瀏覽器不允許保存設定，無法啟用雲端同步。';syncStatus();render();return;}
  writeJSON(s,STORE.cloud,{owner,repo,connectedAt:now()});
  try{target.setItem(STORE.token,token);}catch{}
  S.syncDraft={...d,owner,repo,token:''};
  Object.assign(syncState,{verified:true,pending:true,authError:false,error:''});
  const ok=await syncNow('connect');
  render();
  toast(ok?'已連線，進度已同步到你的私人 repo。':'已連線，但這次同步沒有完成：'+syncState.error);
}
function disconnectCloud(){removeKey(STORE.token);removeKey(STORE.cloud);clearTimeout(cloudTimer);cloudTimer=null;Object.assign(syncState,{verified:false,pending:false,lastSync:null,error:'',authError:false});}

/* Status line and settings page */
function syncStatus(){
  const el=$('#save-status'),bar=$('.topbar');
  if(!el||!bar)return;
  const cfg=cloudConfig(),autosave=syncState.storage&&deviceSettings().autosave;
  let text,state;
  if(syncState.busy){text='同步中…';state='busy';}
  else if(cfg&&syncState.error){text='雲端同步暫停'+(autosave?' · 已保存在此裝置':'');state='error';}
  else if(dirty&&autosave){text='正在保存…';state='dirty';}
  else if(syncState.localError){text='此裝置無法保存 · 請到「保存與同步」查看';state='error';}
  else if(cfg&&syncState.pending){text=(autosave?'已保存在此裝置':'尚未保存')+' · 稍後同步到雲端';state=autosave?'saved':'dirty';}
  else if(cfg&&syncState.lastSync){text='已同步到雲端 · '+syncTime(syncState.lastSync);state='synced';}
  else if(cfg){text='已連上雲端 · 等待同步';state='saved';}
  else if(autosave){text='已自動保存在此裝置';state='saved';}
  else{text=syncState.storage?'未自動保存 · 離開前請匯出或連上雲端':'此瀏覽器無法自動保存 · 離開前請匯出';state='dirty';}
  el.textContent=text;
  bar.classList.toggle('is-dirty',state==='dirty');
  bar.classList.toggle('is-sync-error',state==='error');
  bar.classList.toggle('is-synced',state==='synced'||state==='saved');
}
function cloudStatusMarkup(){
  const cfg=cloudConfig();
  if(!cfg)return '';
  const history='https://github.com/'+encodeURIComponent(cfg.owner)+'/'+encodeURIComponent(cfg.repo)+'/commits/HEAD/'+SYNC_FILE;
  return `<dl class="sync-facts"><div><dt>同步位置</dt><dd><a href="${esc(history)}" target="_blank" rel="noopener noreferrer">${esc(cfg.owner)}/${esc(cfg.repo)} · ${SYNC_FILE}</a></dd></div><div><dt>狀態</dt><dd>${syncState.busy?'同步中…':syncState.error?'<span class="sync-error-text">'+esc(syncState.error)+'</span>':syncState.pending?'有新的變更，稍後自動同步':syncState.lastSync?'已同步 · '+esc(syncTime(syncState.lastSync)):'等待第一次同步'}</dd></div></dl>`;
}
function syncPage(){
  const cfg=cloudConfig(),settings=deviceSettings(),d=S.syncDraft,host=String(window.location?.hostname||'');
  if(!d.owner&&/\.github\.io$/.test(host))d.owner=host.split('.')[0];
  const saved=syncState.storage&&settings.autosave;
  return heading('','保存與同步','進度會自動保存在這個瀏覽器；連上你自己的 GitHub 私人 repo 後，也會自動同步到雲端，手機和電腦可以接著練，不必再匯出或匯入。',`<div class="heading-stat"><strong>${cfg?'雲端':saved?'本機':'—'}</strong><span>${cfg?'已啟用同步':saved?'自動保存中':'尚未保存'}</span></div>`)
  +`<section class="card sync-card" aria-labelledby="sync-device-title"><h2 id="sync-device-title">這個裝置</h2>
  ${syncState.storage?`<p>${saved?`每次作答、勾選或輸入文字後，幾秒內就自動保存在這個瀏覽器${syncState.lastLocal?'（最近一次：'+esc(syncTime(syncState.lastLocal))+'）':''}。重新整理或關閉分頁都不會遺失。`:'自動保存已關閉：離開前請連上雲端或匯出備份。'}</p>
  <label class="check-label"><input type="checkbox" id="sync-autosave" ${settings.autosave?'checked':''}><span>自動保存在這個瀏覽器</span></label>
  <p class="small">共用或公用電腦請關閉自動保存，用完按下方「清除此裝置資料」。</p>
  <div class="actions">${btn('清除此裝置資料','sync-clear','','small subtle')}</div>`:`<p class="sync-error-text">這個瀏覽器（例如部分無痕模式）不允許網站保存資料，只能在離開前匯出備份。</p>`}</section>
  <section class="card sync-card" aria-labelledby="sync-cloud-title"><h2 id="sync-cloud-title">雲端同步（你的 GitHub 私人 repo）</h2>
  ${cfg?`<div id="sync-cloud-status">${cloudStatusMarkup()}</div>
  <label class="check-label"><input type="checkbox" id="sync-auto" ${settings.autoSync?'checked':''}><span>自動同步（變更後約 30 秒、切換分頁或重新開啟時）</span></label>
  <div class="actions">${btn(syncState.busy?'同步中…':'立即同步','sync-now','','small primary')}${btn('中斷連線','sync-disconnect','','small subtle')}</div>
  ${syncState.authError?`<p class="small">若 token 已過期或權限不足，先按「中斷連線」，再用新的 token 重新連線。</p>`:''}
  <p class="small">每次同步都會在 repo 留下一筆 commit，可在 GitHub 查看或還原較早的版本。其他裝置用同一個 repo 與各自的 token 連線即可接著練。</p>`
  :`<ol class="sync-steps">
    <li><strong>建立私人 repo</strong>開啟 <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">github.com/new</a>，名稱例如 <code>ophthalmology-progress</code>，一定要選 <b>Private</b>，並勾選 Add a README file。</li>
    <li><strong>建立只能用在這個 repo 的 token</strong>開啟 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained token</a>：Repository access 選 <b>Only select repositories</b> → 剛建立的 repo；Permissions → Repository permissions → <b>Contents</b> 設為 <b>Read and write</b>；設定到期日後產生並複製 token。</li>
    <li><strong>貼到下方並連線</strong>每台裝置第一次使用時輸入一次；之後會自動同步。</li></ol>
  <div class="sync-form"><div><label class="field-label" for="sync-owner">GitHub 帳號</label><input class="select" id="sync-owner" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="39" value="${esc(d.owner)}" placeholder="例如 your-name"></div>
  <div><label class="field-label" for="sync-repo">私人 repo 名稱</label><input class="select" id="sync-repo" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="100" value="${esc(d.repo)}"></div>
  <div class="full"><label class="field-label" for="sync-token">Token</label><input class="select" id="sync-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" value="${esc(d.token)}" placeholder="github_pat_…"></div>
  <label class="check-label full"><input type="checkbox" id="sync-remember" ${d.remember?'checked':''}><span>在這個瀏覽器記住 token（共用電腦請取消勾選，關閉分頁後就會忘記）</span></label>
  <div class="full actions">${btn(syncState.busy?'連線中…':'連線並同步','sync-connect','','primary')}</div>
  ${syncState.error?`<p class="full sync-error-text" role="alert">${esc(syncState.error)}</p>`:''}</div>
  <p class="small">進度包含你的草稿與筆記，只會寫入你自己的私人 repo，公開 repo 會被拒絕。Token 只用來連線 api.github.com，保存在這個瀏覽器，不會放進匯出檔；可隨時在 GitHub 撤銷。</p>`}</section>
  <section class="card sync-card" aria-labelledby="sync-backup-title"><h2 id="sync-backup-title">手動備份（選用）</h2><p>需要另存一份時，仍可下載進度檔；在其他瀏覽器按「匯入進度」即可合併，較新的紀錄會保留。</p><div class="actions">${btn('匯出進度','export','','small')}${btn('匯入進度','import','','small subtle')}</div></section>`;
}

/* Events, delegated from the practice handlers */
function syncInput(el){
  const map={'sync-owner':'owner','sync-repo':'repo','sync-token':'token'},key=map[el?.id];
  if(!key)return false;
  S.syncDraft[key]=el.value;return true;
}
function syncChange(el){
  const id=el?.id;
  if(id==='sync-remember'){S.syncDraft.remember=el.checked;return true;}
  if(id==='sync-autosave'){setDeviceSetting('autosave',el.checked);if(el.checked)saveLocal();else{clearTimeout(localTimer);localTimer=null;removeKey(STORE.state);syncState.lastLocal=null;dirty=true;}render();syncStatus();return true;}
  if(id==='sync-auto'){setDeviceSetting('autoSync',el.checked);if(el.checked&&syncState.pending)scheduleSync(2000);return true;}
  return false;
}
function syncAction(a){
  switch(a){
  case'sync-connect':if(!syncState.busy)connectCloud();return true;
  case'sync-now':if(!syncState.busy){syncState.verified=false;syncNow('manual').then(ok=>{render();toast(ok?'已同步。':syncState.error);});}return true;
  case'sync-disconnect':if(window.confirm('中斷這個瀏覽器的雲端同步並刪除保存的 token？雲端 repo 中的資料不受影響。')){disconnectCloud();render();toast('已中斷連線。雲端的進度仍在你的 repo。');}return true;
  case'sync-clear':if(window.confirm('清除這個瀏覽器保存的全部進度、草稿與 GitHub token？雲端 repo 中的資料不受影響。')){clearDevice();render();toast('已清除此裝置的資料。');}return true;
  }
  return false;
}

/* Boot: restore this device's copy before the first render, then pull from the cloud. */
syncState.storage=!!storage();
if(syncState.storage&&deviceSettings().autosave){const saved=readJSON(storage(),STORE.state);if(saved)try{absorbProgress(saved);syncState.restored=true;syncState.lastLocal=Date.parse(saved.exportedAt)||null;}catch{}}
{const cfg=readJSON(storage(),STORE.cloud);if(cfg?.lastSync)syncState.lastSync=cfg.lastSync;}
window.addEventListener('beforeunload',flushLocal);
window.addEventListener('pagehide',flushLocal);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){flushLocal();if(syncState.pending&&deviceSettings().autoSync)syncNow('hidden');}else if(cloudConfig()&&deviceSettings().autoSync&&(!syncState.lastSync||Date.now()-syncState.lastSync>60000))syncNow('visible');});
window.addEventListener('online',()=>{if(cloudConfig()&&(syncState.pending||syncState.error))syncNow('online');});
setTimeout(()=>{syncStatus();if(cloudConfig()&&deviceSettings().autoSync)syncNow('load');},0);
/* progress-sync:end */
