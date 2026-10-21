#!/usr/bin/env python3
"""The approval gate rejects edited reviewed content, unresolved sources and draft promotion."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
spec = importlib.util.spec_from_file_location('advanced_validation', Path(__file__).with_name('validate-advanced.py'))
v = importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def check_rejected(root, pack, review):
    (root/'content/textbook-depth/advanced-practice.json').write_text(json.dumps(pack))
    (root/'content/textbook-depth/advanced-review.json').write_text(json.dumps(review))
    try: v.validate(root)
    except ValueError: return
    raise AssertionError('invalid reviewed content was accepted')
with tempfile.TemporaryDirectory(prefix='advanced-validator-') as temp:
    root = Path(temp); manifest = json.loads((v.ROOT/'content/textbook-manifest.json').read_text())
    for name in ['content/textbook-manifest.json']+[b['file'] for b in manifest['books']]:
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(v.ROOT/name,p)
    b=manifest['books'][0]; book=json.loads((v.ROOT/b['file']).read_text()); ch=next(c for c in book['chapters'] if c['units'])
    q={'id':'extra-20261022-q001','questionScope':'original-practice','bookId':b['bookId'],'chapterIds':[ch['id']],'unitIds':[ch['units'][0]['id']],'stem':'Synthetic nonmedical case','options':[{'text':str(i),'rationale':'Different rationale '+str(i),'whenTrue':'Different condition '+str(i)} for i in range(4)],'correctIndex':0,'closestDistractorIndex':1,'decisiveDiscriminator':'Second fixture clue separates competing choices','counterfactual':'A changed fixture clue supports the competing semantic option','explanation':'Synthetic explanation','testConcept':'Synthetic integration','questionType':'clinical-integration','difficulty':'advanced','domain':'synthetic','reasoningSteps':['First constraint','Independent second constraint'],'sourceRefs':[{'bookId':b['bookId'],'pdfPages':[1],'chapterHeading':'Synthetic reference fixture'}],'requiresImage':False,'imageStatus':'not-applicable','status':'source-checked','readiness':'ready'}
    pack={'schemaVersion':1,'packId':v.PACK,'origin':'original-extra-practice','questionScope':'original-practice','officialCoverageCredit':False,'title':'Synthetic test only','description':'Nonmedical fixture','notice':'Not actual teaching content','questions':[q]}
    review={'schemaVersion':1,'packId':v.PACK,'hashDefinition':v.HASH_DEFINITION,'items':[{'id':q['id'],'contentSha256':v.content_hash(q),'medical':'pass','hardness':'pass','source':'pass','numbers':'not-applicable'}]}
    (root/'content/textbook-depth/advanced-practice.json').write_text(json.dumps(pack));(root/'content/textbook-depth/advanced-review.json').write_text(json.dumps(review))
    assert v.validate(root)['approvedQuestions']==1
    bad=copy.deepcopy(pack);bad['questions'][0]['correctIndex']=1;check_rejected(root,bad,review)
    bad=copy.deepcopy(pack);bad['questions'][0]['sourceRefs'][0]['pdfPages']=[b['source']['pdfPageCount']+1];r=copy.deepcopy(review);r['items'][0]['contentSha256']=v.content_hash(bad['questions'][0]);check_rejected(root,bad,r)
    bad=copy.deepcopy(pack);bad['questions'][0]['status']='draft';check_rejected(root,bad,review)
    r=copy.deepcopy(review);r['items'][0]['hardness']='fail';check_rejected(root,pack,r)
    assert v.arithmetic('a + 3 * 4',{'a':2})==14
    try: v.arithmetic("__import__('os')",{})
    except ValueError: pass
    else: raise AssertionError('unsafe arithmetic syntax accepted')
print('Advanced approval gate PASS: exact content accepted, four invalid cases rejected, safe arithmetic checked.')
