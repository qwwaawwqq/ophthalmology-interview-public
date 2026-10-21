#!/usr/bin/env python3
"""Apply the learning-project adapter without altering course or question payloads."""
import argparse, re, shutil, datetime as dt
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def once(s,old,new):
 if new in s:return s
 if s.count(old)!=1:raise ValueError('Learning project anchor changed: '+old[:95])
 return s.replace(old,new,1)
def build(s):
 s=once(s,'</head>','<link rel="stylesheet" href="scripts/learning-project.css">\n<script src="scripts/learning-project.js" defer></script>\n</head>')
 s=once(s,"['sync','⇅','保存與同步']];","['sync','⇅','保存與同步'],['project','◉','甄試訓練日誌']];")
 s=once(s,"function navMarkup(){const groups=[","function navMarkup(){const groups=[['訓練專案',['project']],")
 s=once(s,'cram:cramPage,textbook:textbookPage','cram:cramPage,project:projectPage,textbook:textbookPage')
 s=once(s,'if(textbook!==undefined)return textbook;','if(textbook!==undefined)return textbook;const project=projectEntry(key,v);if(project!==undefined)return project;')
 s=once(s,'function validateMeta(key,v){','function validateMeta(key,v){const project=projectMeta(key,v);if(project!==undefined)return project;')
 core=(ROOT/'scripts/learning-project-core.js').read_text().strip()
 bridge=(ROOT/'scripts/learning-project-bridge.js').read_text().strip()
 block='/* learning-project:start */\n'+core+'\n'+bridge+'\n/* learning-project:end */'
 if '/* learning-project:start */' in s:s=re.sub(r'/\* learning-project:start \*/.*?/\* learning-project:end \*/',lambda _:block,s,count=1,flags=re.S)
 else:s=once(s,'/* progress-sync:start */',block+'\n/* progress-sync:start */')
 # Restore and cloud imports use the same validator and protect a finalized exam from stale active copies.
 s=once(s,'entries[key]=value;count++;','entries[key]=key.startsWith(\'project:\')?projectMerge(key,entries[key],value):value;count++;') if s.count('entries[key]=value;count++;')==1 else s.replace('entries[key]=value;count++;',"entries[key]=key.startsWith('project:')?projectMerge(key,entries[key],value):value;count++;")
 s=s.replace("if(!entries[key]||Date.parse(value.at)>=Date.parse(entries[key].at))","if(key.startsWith('project:')||!entries[key]||Date.parse(value.at)>=Date.parse(entries[key].at))")
 s=once(s,"function pauseTimer(){if(S.deadline)","function pauseTimer(){if(S.deadline)projectTimer('pause');if(S.deadline)")
 s=once(s,"function chooseInterview(id){if(!D.interview.some(i=>i.id===id))return;S.deadline=null;","function chooseInterview(id){if(!D.interview.some(i=>i.id===id))return;if(S.deadline)pauseTimer();S.deadline=null;")
 s=once(s,"S.deadline=Date.now()+S.seconds*1000;}render();break;","S.deadline=Date.now()+S.seconds*1000;projectTimer('start');}render();break;")
 s=once(s,"case'timer-reset':S.deadline=null;","case'timer-reset':projectTimer('reset');S.deadline=null;")
 s=once(s,"if(S.seconds===0){S.deadline=null;","if(S.seconds===0){projectTimer('finish');S.deadline=null;")
 s=once(s,"const a=b.dataset.action,v=b.dataset.value;switch(a){","const a=b.dataset.action,v=b.dataset.value;if(window.OphProject?.action(a,v,b))return;switch(a){")
 s=once(s,"document.addEventListener('input',e=>{const el=e.target;","document.addEventListener('input',e=>{const el=e.target;if(window.OphProject?.input(el))return;")
 s=once(s,"document.addEventListener('change',e=>{const el=e.target;","document.addEventListener('change',e=>{const el=e.target;if(window.OphProject?.change(el))return;")
 needle="syncPracticeHash();if(S.tab==='cram'"
 replacement="if(S.tab==='interview')$('#main').innerHTML+=projectOralPanel();if(S.tab==='project')window.OphProject?.mount(document.getElementById('project-root'));syncPracticeHash();if(S.tab==='cram'"
 s=once(s,needle,replacement)
 return s
def main():
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');a=p.parse_args();f=ROOT/'index.html';old=f.read_text();new=build(old)
 if a.check:
  if old!=new:raise SystemExit('Learning project hooks are not current')
  print('Learning project hooks current; course payload preserved.');return
 if old!=new:shutil.copy2(f,f.with_name(f.name+'.bak-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')));f.write_text(new)
 print('Learning project hooks built.')
if __name__=='__main__':main()
