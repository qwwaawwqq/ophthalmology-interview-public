/* study-bridge:start */
function studyISO(s){try{return typeof s==='string'&&new Date(s).toISOString()===s;}catch(_){return false;}}
function studyPlanValid(p){return !!p&&typeof p==='object'&&!Array.isArray(p)&&Number.isInteger(p.step)&&p.step>=-1&&p.step<=4&&studyISO(p.dueAt)&&['again','hard','good','easy'].includes(p.rating)&&Number.isSafeInteger(p.reviewCount)&&p.reviewCount>=1&&Number.isSafeInteger(p.lapses)&&p.lapses>=0&&p.lapses<=p.reviewCount&&(p.rating==='again'?p.step===-1:p.rating==='hard'?p.step===0:p.rating==='easy'?p.step>=1:p.step>=0);}
function studyEntry(key,v){
 if(!key.startsWith('study:srs:'))return undefined;
 if(!/^study:srs:[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(key)||!v||typeof v!=='object'||Array.isArray(v)||v.version!==1||!studyISO(v.at)||!Number.isSafeInteger(v.answerCount)||v.answerCount<1)return null;
 const a=v.attempt,p=v.plan;
 if(!a||typeof a!=='object'||typeof a.id!=='string'||a.id.length>100||!a.id||!studyISO(a.at)||typeof a.correct!=='boolean'||typeof a.rated!=='boolean'||p!==null&&!studyPlanValid(p)||a.rated&&!p||!a.correct&&(!a.rated||p?.rating!=='again')||p&&p.reviewCount>v.answerCount)return null;
 return {version:1,at:v.at,answerCount:v.answerCount,attempt:{id:a.id,at:a.at,correct:a.correct,rated:a.rated},plan:p?{step:p.step,dueAt:p.dueAt,rating:p.rating,reviewCount:p.reviewCount,lapses:p.lapses}:null};
}
function studyPage(){return heading('SPACED REVIEW','今日複習','先有效作答，再評熟悉度。答錯提早重練，答對並熟悉才延長間隔；看過解析不等於已學會。')+'<section id="study-root" aria-label="間隔複習與學習進度"><p role="status">正在讀取複習清單…</p></section>';}
window.OphStudyBridge={
 read(key){return studyEntry(key,entries[key])||null;},
 save(key,value){const valid=studyEntry(key,value);if(!valid)throw Error('複習紀錄格式無效');entries[key]=valid;changed();},
 shared(){return D.questions.map(q=>({pool:'shared',id:q.id,title:q.stem}));},
 open(pool,id){window.OphStudy?.leave();if(pool==='shared'){if(D.questions.some(q=>q.id===id))startQuiz('all','all',id);}else if(pool==='book')openRoute('#textbook-'+id);else if(pool==='extra')openRoute('#textbook-extra-'+id);},
 refresh(pool){if(pool==='shared'&&S.tab==='quiz')render();}
};
/* study-bridge:end */
