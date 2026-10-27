#!/usr/bin/env python3
"""Validate reviewed deep-dive units and their live question/curriculum links."""
import json,re,sys
from pathlib import Path
from collections import Counter
from importlib.util import spec_from_file_location,module_from_spec
ROOT=Path(__file__).resolve().parents[1]
spec=spec_from_file_location('advanced_validator',ROOT/'scripts/validate-advanced.py');v=module_from_spec(spec);spec.loader.exec_module(v)
def validate(root=ROOT):
 pack=json.loads((root/'content/textbook-depth/advanced-practice.json').read_text());review=json.loads((root/'content/textbook-depth/advanced-review.json').read_text())
 modules=pack.get('deepDives',[]);v.require(isinstance(modules,list) and 1<=len(modules)<=40,'missing or excessive deep dives')
 ids=[m.get('id') for m in modules];v.require(len(set(ids))==len(ids),'duplicate module ID')
 reviewed={m.get('id'):m for m in review.get('deepDives',[])};v.require(set(reviewed)==set(ids),'exact deep-dive approval records required')
 qs={q['id']:q for q in pack['questions']};units={u['id']:u for p in (root/'content/textbook-depth').glob('bcsc-s*.json') for c in json.loads(p.read_text())['chapters'] for u in c['units']}
 linked=[]
 for m in modules:
  mid=m['id'];v.require(bool(re.fullmatch(r'deep-[a-z0-9-]+',mid)),mid+': invalid ID');v.require(m.get('status')=='source-checked',mid+': unreviewed unit')
  for key in ['category','title','overview']:v.text(m.get(key),mid+'.'+key)
  for key,minimum in [('mechanism',2),('evidenceLimits',2)]:
   items=m.get(key);v.require(isinstance(items,list) and len(items)>=minimum,mid+'.'+key)
   for item in items:v.text(item,mid+'.'+key)
  for key,fields in [('pitfalls',['mistake','correction']),('counterfactuals',['change','effect'])]:
   rows=m.get(key);v.require(isinstance(rows,list) and len(rows)>=2,mid+'.'+key)
   for row in rows:
    if isinstance(row,str):v.text(row,mid+'.'+key)
    else:
     v.require(isinstance(row,dict),mid+'.'+key+': invalid item')
     for field in fields:v.text(row.get(field),mid+'.'+key+'.'+field)
  for key,fields in [('differential',['diagnosis','for','against','discriminator']),('investigations',['test','interpretation','limitation']),('management',['stage','action','rationale'])]:
   rows=m.get(key);v.require(isinstance(rows,list) and len(rows)>=3,mid+'.'+key)
   for row in rows:
    for field in fields:v.text(row.get(field),mid+'.'+key+'.'+field)
  qids=m.get('questionIds');v.require(isinstance(qids,list) and len(qids)==2 and len(set(qids))==2,mid+': two unique cases required')
  for qid in qids:v.require(qid in qs and qs[qid].get('readiness')=='ready',mid+': question unavailable');linked.append(qid)
  curriculum=m.get('curriculumLinks');v.require(isinstance(curriculum,list) and curriculum,mid+': curriculum links missing')
  for link in curriculum:v.require(link.get('unitId') in units and link.get('label')==units[link['unitId']]['title'],mid+': curriculum label or ID mismatch')
  for ref in m.get('externalRefs',[]):v.require(ref.get('url','').startswith('https://') and ref.get('title'),mid+': invalid source')
  v.require(m.get('externalRefs'),mid+': evidence missing');r=reviewed[mid]
  v.require(r.get('contentSha256')==v.content_hash(m),mid+': review hash mismatch')
  v.require(all(r.get(k)=='pass' for k in ['medical','source','hardness']),mid+': approval incomplete')
 v.require(len(linked)==len(set(linked)),'a new case is linked to multiple modules')
 new=[q for q in qs.values() if q.get('batchId')==pack.get('deepDiveBatchId')]
 v.require(set(linked)=={q['id'] for q in new},'every new question needs one module')
 counts=Counter(q['correctIndex'] for q in new);v.require(len(counts)>1 and max(counts.values())<=len(new)/2,'obvious fixed answer-position pattern')
 v.require(not any('/Users/' in s or 'private-text/' in s or 'file://' in s for s in v.strings(modules)),'private path in module')
 return {'units':len(modules),'linkedQuestions':len(linked),'answerPositions':dict(counts),'reviewHashesMatched':True}
if __name__=='__main__':print(json.dumps(validate(),ensure_ascii=False,indent=2))
