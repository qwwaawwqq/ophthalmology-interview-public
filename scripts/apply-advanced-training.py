#!/usr/bin/env python3
"""Add advanced training hooks, preserving legacy exam timer and all content payloads."""
import argparse,datetime as dt,re,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def once(s,old,new):
 if new in s:return s
 if s.count(old)!=1:raise ValueError('Advanced insertion anchor changed: '+old[:95])
 return s.replace(old,new,1)
def external(name):
 s=(ROOT/name).read_text()
 if name=='scripts/study-srs.js':
  s=once(s,"json('content/textbook-depth/additional-practice.json')","(g.OphAdvancedCatalog?g.OphAdvancedCatalog.extra():json('content/textbook-depth/additional-practice.json'))")
 elif name=='scripts/learning-project.js':
  s=once(s,".map(async path=>{const r=await fetch(",".map(async path=>{if(path==='content/textbook-depth/additional-practice.json'&&g.OphAdvancedCatalog)return g.OphAdvancedCatalog.extra();const r=await fetch(")
  s=once(s,"title:q.stem}))];return catalog;","title:q.stem,difficulty:q.difficulty,domain:q.domain}))];return catalog;")
  s=s.replace("pending?'接續限時筆試小關':'挑戰 10 題限時小關'","pending?'接續基礎限時小關':'Hard｜12題／18分鐘'")
  s=s.replace("'04','限時筆試小關','10題、10分鐘、交卷後看解析'","'04','Hard混合訓練','12題、18分鐘；可另選基礎小關'")
  s=s.replace("pending?'接續基礎限時小關':'Hard｜12題／18分鐘','project-written'","pending?'接續基礎限時小關':'Hard｜12題／18分鐘',pending?'project-written':'advanced-start'")
  s=s.replace("'04','Hard混合訓練','12題、18分鐘；可另選基礎小關','project-written'","'04','Hard混合訓練','12題、18分鐘；可另選基礎小關','advanced-start'")
 elif name=='scripts/practice-ui.js':
  s=once(s,'function practiceAction(a,v,b){',"function practiceAction(a,v,b){if(window.OphAdvanced?.action(a,v,b))return true;")
  s=once(s,'function practiceChange(el){',"function practiceChange(el){if(window.OphAdvanced?.change(el))return true;")
 elif name=='scripts/learning-project-core.js':
  s=once(s,"fresh=records.filter(q=>!q.record),quota=", "fresh=records.filter(q=>!q.record).sort((a,b)=>Number(b.difficulty==='advanced')-Number(a.difficulty==='advanced')),quota=")
 elif name=='scripts/learning-project-bridge.js':
  s=once(s,'function projectEntry(key,v){return window.OphProjectCore.validateEntry(key,v);}',"function projectEntry(key,v){const advanced=window.OphAdvancedCore?.validateEntry(key,v);if(advanced!==undefined)return advanced;return window.OphProjectCore.validateEntry(key,v);}")
  s=once(s,"if(key.startsWith('project:exam:')){", "if(key.startsWith('project:exam:')||key.startsWith('project:challenge:')){")
 elif name=='scripts/textbook-depth.js':
  s=once(s,"  async function loadExtra(){if(extraPack)return extraPack;", "  async function loadExtra(){if(window.OphAdvancedCatalog){const merged=await window.OphAdvancedCatalog.extra();extraPack={...merged,source:{edition:merged.packId},chapters:[]};return extraPack;}if(extraPack)return extraPack;")
  s=once(s,"const p=await loadExtra();if(token!==request||!root?.isConnected)return;view.questionId=", "const p=await loadExtra();if(token!==request||!root?.isConnected)return;if(target&&/^extra-20261022-/.test(target)&&!p.questions.some(q=>q.id===target))throw Error('指定進階題目前無法載入');view.questionId=")
  # Keep exact legacy content strings and source indices. Additional reasoning is shown only after reveal.
  if 'OphAdvanced?.reasoningHtml' not in s:
   old="esc(q.explanation)+'</p><ol class=\"tb-rationales\">'"
   new="esc(q.explanation)+'</p>'+(window.OphAdvanced?.reasoningHtml(q,revealed)||'')+'<ol class=\"tb-rationales\">'"
   if old in s:s=s.replace(old,new,1)
   else:raise ValueError('Advanced reasoning reveal anchor changed')

 return s
def build(s):
 s=re.sub(r'/\* practice-ui:start \*/.*?/\* practice-ui:end \*/',lambda _:(ROOT/'scripts/practice-ui.js').read_text().strip(),s,count=1,flags=re.S)
 s=once(s,'<script src="scripts/study-srs.js" defer></script>','<link rel="stylesheet" href="scripts/advanced-training.css">\n<script src="scripts/advanced-practice.js" defer></script>\n<script src="scripts/study-srs.js" defer></script>')
 s=once(s,'<link rel="stylesheet" href="scripts/learning-project.css">','<script src="scripts/advanced-training.js" defer></script>\n<link rel="stylesheet" href="scripts/learning-project.css">')
 s=once(s,"['workshop','◇','故事與證據']", "['advanced','◆','Hard｜臨床推理'],['workshop','◇','故事與證據']")
 s=once(s,"['訓練專案',['project']],", "['訓練專案',['project']],['進階訓練',['advanced']],")
 s=once(s,'sync:syncPage,cram:cramPage','sync:syncPage,advanced:advancedPage,cram:cramPage')
 s=once(s,"[S.tab]();if(S.tab==='interview')", "[S.tab]();if(S.tab==='advanced')window.OphAdvanced?.mount(document.getElementById('advanced-root'));if(S.tab==='interview')")
 s=once(s,"${searching?'':practiceOverview()+enrichmentOverview()}", "${searching?'':advancedHomeLink()+practiceOverview()+enrichmentOverview()}")
 block='/* advanced-training:start */\n'+(ROOT/'scripts/advanced-training-core.js').read_text().strip()+'\n'+(ROOT/'scripts/advanced-training-bridge.js').read_text().strip()+'\n/* advanced-training:end */'
 if '/* advanced-training:start */' in s:s=re.sub(r'/\* advanced-training:start \*/.*?/\* advanced-training:end \*/',lambda _:block,s,count=1,flags=re.S)
 else:s=once(s,'/* progress-sync:start */',block+'\n/* progress-sync:start */')
 return s
def write(path,value):
 old=path.read_text()
 if old!=value:
  stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f');shutil.copy2(path,path.with_name(path.name+'.bak-'+stamp));path.write_text(value)
def main():
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');a=p.parse_args();changed=[]
 names=['scripts/study-srs.js','scripts/learning-project.js','scripts/learning-project-core.js','scripts/learning-project-bridge.js','scripts/textbook-depth.js','scripts/practice-ui.js']
 for name in names:
  path=ROOT/name;new=external(name)
  if new!=path.read_text():changed.append(name)
  if not a.check:write(path,new)
 # Rebuild the original inline project block after its small bridge/core changes.
 if not a.check:
  import importlib.util
  spec=importlib.util.spec_from_file_location('learning_builder',ROOT/'scripts/apply-learning-project.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);write(ROOT/'index.html',module.build((ROOT/'index.html').read_text()))
 path=ROOT/'index.html';new=build(path.read_text())
 if new!=path.read_text():changed.append('index.html')
 if a.check:
  if changed:raise SystemExit('Advanced hooks not current: '+', '.join(changed))
  print('Advanced hooks current; legacy timer and content payloads preserved.')
 else:write(path,new);print('Advanced hooks built; legacy timer block untouched.')
if __name__=='__main__':main()
