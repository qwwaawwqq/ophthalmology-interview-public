/* learning-project-bridge:start */
function projectEntry(key,v){const advanced=window.OphAdvancedCore?.validateEntry(key,v);if(advanced!==undefined)return advanced;return window.OphProjectCore.validateEntry(key,v);}
function projectMeta(key,v){return window.OphProjectCore.validateMeta(key,v);}
function projectMerge(key,old,value){if(!old)return value;const earlier=(a,b,field)=>Date.parse(a[field])!==Date.parse(b[field])?(Date.parse(a[field])<Date.parse(b[field])?a:b):(canonical(a)<=canonical(b)?a:b);if(key.startsWith('project:reward:'))return earlier(old,value,'at');if(key.startsWith('project:exam:')||key.startsWith('project:challenge:')){if(old.status==='finished'&&value.status==='finished')return earlier(old,value,'finishedAt');if(old.status==='finished')return old;if(value.status==='finished')return value;}return Date.parse(value.at)>=Date.parse(old.at)?value:old;}
function projectPage(){return heading('LEARNING PROJECT','我的甄試訓練日誌','把複習、筆試與口述接成一段可持續的準備。')+'<section id="project-root" aria-label="甄試學習專案"><p role="status">正在整理今日訓練…</p></section>';}
function projectAward(kind,detail){const x=window.OphProjectCore.award(entries,kind,now(),detail);if(x){entries[x.key]=x.value;changed();}return !!x;}
function projectAnswer(pool,id,correct,wasDue,first){if(first||wasDue)projectAward('question',{pool,id,correct,wasDue});window.OphProject?.refresh();}
function projectOralKey(){return 'project:oral:'+window.OphProjectCore.day(Date.now())+':'+S.interview;}
function projectOral(){return entries[projectOralKey()]||{version:1,day:window.OphProjectCore.day(Date.now()),interviewId:S.interview,elapsed:0,timerDone:false,reflection:'',reviewed:false,draftTouched:false,runningAt:null,deadline:null,completedAt:null,at:now()};}
function projectOralWrite(patch){const v={...projectOral(),...patch,at:now()},k=projectOralKey();if(!projectEntry(k,v))throw Error('口述練習紀錄無效');entries[k]=v;changed();return v;}
function projectTimer(action){const v=projectOral();if(v.completedAt)return;const elapsed=v.elapsed+(v.runningAt?Math.max(0,Math.min(7200,(Date.now()-Date.parse(v.runningAt))/1000)):0);if(action==='start')projectOralWrite({runningAt:now(),deadline:new Date(S.deadline).toISOString(),...(!v.elapsed&&!v.timerDone?{draftTouched:false,reviewed:false,reflection:''}:{})});else if(action==='finish')projectOralWrite({elapsed:Math.min(7200,elapsed),runningAt:null,deadline:null,timerDone:true});else if(action==='reset')projectOralWrite({elapsed:0,runningAt:null,deadline:null,timerDone:false,draftTouched:false,reviewed:false,reflection:''});else projectOralWrite({elapsed:Math.min(7200,elapsed),runningAt:null,deadline:null});}
function projectOralPanel(){const v=projectOral();return '<section class="card card-pad project-oral" aria-label="專案口述紀錄"><h3>口述後，留下下一輪的改進</h3><p class="small">沿用上方計時、你的草稿與五項自評。完成一輪倒數後再記錄反思；自評與口述皆由你自行回報，並非客觀能力檢定。</p><label class="field-label" for="project-reflection">下次要改進的一件事</label><textarea id="project-reflection" class="select" rows="3" maxlength="2000">'+esc(v.reflection)+'</textarea><label class="check-label"><input type="checkbox" id="project-oral-reviewed" '+(v.reviewed?'checked':'')+'>我已逐項核對上方五項自評（可全部未達成）</label><p class="small" id="project-oral-status">'+(v.timerDone?'✓ 已完成本輪倒數':'先完成一次上方倒數')+' · '+(v.completedAt?'✓ 本輪已記錄':'本輪請編輯至少20字草稿，反思至少10字後可記錄')+'</p>'+btn(v.completedAt?'已記錄本輪':'記錄口述與反思','project-oral-complete','','small primary')+btn('回到訓練日誌','tab','project','small subtle')+'</section>';}
window.OphProjectBridge={
 snapshot(){return {entries,meta,questions:D.questions,interviews:D.interview.map(i=>({id:i.id,title:i.title,question:i.question,durationSeconds:i.durationSeconds})),topics:D.topics.map(t=>({id:t.id,title:t.title})),oral:projectOral()};},
 save(key,value){const v=projectEntry(key,value);if(!v)throw Error('專案紀錄無效');entries[key]=projectMerge(key,entries[key],v);changed();return entries[key];},
 config(value){const v=projectMeta('project:config',{...value,at:now()});if(!v)throw Error('請確認目標日期與每日分鐘（15–120）。');meta['project:config']=v;changed();},
 checklist(id,patch){const k='project:check:'+id,v=projectMeta(k,{done:false,note:'',...meta[k],...patch,at:now()});if(!v)throw Error('清單項目無效');meta[k]=v;changed();},
 award:projectAward,answer:projectAnswer,oralWrite:projectOralWrite,
 open(pool,id){window.OphStudyBridge.open(pool,id);},
 route(hash){return openRoute(hash);},
 tab:switchTab,
 oral(id){chooseInterview(id);},
 finishOral(){const v=projectOral(),iv=ivEntry();if(v.completedAt)return false;if(!v.timerDone||!v.draftTouched||iv.draft.trim().length<20||v.reflection.trim().length<10||!v.reviewed){toast('請完成倒數、20字草稿、逐項自評確認與10字反思。');return false;}projectOralWrite({completedAt:now()});updateIv({practiced:true});projectAward('oral');render();toast('已記錄口述與反思；這是自行回報的練習。');return true;},
 writtenAttempt(id,choice,snapshot){const q=D.questions.find(q=>q.id===id);if(!q||q.correctIndex!==snapshot.correctIndex||JSON.stringify(q.options)!==JSON.stringify(snapshot.options))return;if(!window.OphStudy?.sessionCommit('shared',id,choice===q.correctIndex))return;put('q:'+id,{choice,correct:choice===q.correctIndex});},
 notify:toast
};
/* learning-project-bridge:end */
