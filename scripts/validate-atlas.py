#!/usr/bin/env python3
"""Validate independent original atlas data without changing textbook progress or sources."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PACK_ID = 'volume-atlas-20261028'
COLORS = {'ink','muted','teal','blue','red','amber','pale-teal','pale-blue','pale-red','pale-amber','white','none'}
UNIT_KEYS = {'id','title','chapterIds','learningGoals','clinicalQuestion','mechanism','diagram','figureReading','comparison','decisionSteps','pitfalls','counterfactuals','retrieval','references'}
STYLE_KEYS = {'fill','stroke','strokeWidth','opacity','dash'}
SHAPES = {
    'rect': ({'x','y','width','height'}, {'rx'}),
    'ellipse': ({'cx','cy','rx','ry'}, set()),
    'circle': ({'cx','cy','r'}, set()),
    'line': ({'x1','y1','x2','y2'}, {'arrow'}),
    'path': ({'d'}, {'arrow'}),
    'polyline': ({'points'}, {'arrow'}),
    'polygon': ({'points'}, set()),
    'text': ({'x','y','lines'}, {'fontSize','anchor'}),
}

def require(ok, message):
    if not ok:
        raise ValueError(message)


def text(value, label, minimum=1):
    require(isinstance(value, str) and len(value.strip()) >= minimum, label + ': expected substantive text')


def texts(value, label, minimum=1, chars=1):
    require(isinstance(value, list) and len(value) >= minimum, label + ': too few items')
    for item in value:
        text(item, label, chars)


def number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def reviewed_hash(unit):
    return hashlib.sha256(json.dumps(unit, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()


def validate_element(e, where, warnings):
    require(isinstance(e, dict) and e.get('type') in SHAPES, where + ': unsupported SVG element')
    required, optional = SHAPES[e['type']]
    require(required <= e.keys(), where + ': missing geometry')
    require(set(e) <= {'type'} | required | optional | STYLE_KEYS, where + ': unknown or unsafe SVG attribute')
    for key in STYLE_KEYS & e.keys():
        if key in {'fill','stroke'}:
            require(e[key] in COLORS, where + ': non-palette color')
        elif key == 'strokeWidth':
            require(number(e[key]) and 1 <= e[key] <= 6, where + ': invalid stroke width')
        elif key == 'opacity':
            require(number(e[key]) and 0 <= e[key] <= 1, where + ': invalid opacity')
        else:
            require(isinstance(e[key], bool), where + ': invalid dash')
    if 'arrow' in e:
        require(isinstance(e['arrow'], bool), where + ': invalid arrow')
    for key in (required | optional) - {'d','points','lines','anchor','arrow'}:
        if key in e:
            require(number(e[key]), where + ': geometry is not finite')
    if e['type'] == 'text':
        texts(e['lines'], where + ': text lines')
        size=e.get('fontSize',22)
        require(18 <= size <= 28, where + ': text too small or large')
        require(e.get('anchor','start') in {'start','middle','end'}, where + ': unsupported anchor')
        require(0 <= e['x'] <= 900 and 0 <= e['y'] <= 460, where + ': text origin outside canvas')
        require(e['y'] + (len(e['lines'])-1)*round(size*1.35) <= 460, where + ': text lines below canvas')
        for line in e['lines']:
            width=sum(1 if unicodedata.east_asian_width(c) in 'WF' else 0.57 for c in line)*size
            offset={'start':0,'middle':width/2,'end':width}[e.get('anchor','start')]
            if e['x']-offset < 3 or e['x']-offset+width > 897:
                warnings.append(where + ': inspect horizontal text bounds: ' + line)
    elif e['type'] == 'path':
        require(isinstance(e['d'],str) and bool(re.fullmatch(r'[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+',e['d'])), where + ': unsafe SVG path')
        require(bool(re.match(r'\s*[Mm]',e['d'])), where + ': path must start with moveto')
    elif e['type'] in {'polygon','polyline'}:
        require(isinstance(e['points'],str) and bool(re.fullmatch(r'[\d\s.,+eE-]+',e['points'])), where + ': unsafe point list')
        coords=[float(x) for x in re.split(r'[\s,]+',e['points'].strip())]
        require(len(coords)>=4 and len(coords)%2==0,where+': invalid coordinate pairs')
        require(all(math.isfinite(x) and 0<=x<=900 for x in coords[::2]) and all(math.isfinite(y) and 0<=y<=460 for y in coords[1::2]),where+': points outside canvas')
    else:
        if e['type']=='rect':
            x,y,w,h=e['x'],e['y'],e['width'],e['height']
            require(w>0 and h>0 and 0<=x<=900-w and 0<=y<=460-h,where+': rectangle outside canvas')
            if 'rx' in e:require(e['rx']>=0,where+': negative corner radius')
        elif e['type'] in {'ellipse','circle'}:
            rx=e.get('rx',e.get('r'));ry=e.get('ry',e.get('r'))
            require(rx>0 and ry>0 and rx<=e['cx']<=900-rx and ry<=e['cy']<=460-ry,where+': ellipse outside canvas')
        elif e['type']=='line':
            require(all(0<=e[x]<=900 for x in ['x1','x2']) and all(0<=e[y]<=460 for y in ['y1','y2']),where+': line outside canvas')


def validate(data, root=ROOT, partial=False, review=None):
    require(isinstance(data,dict) and isinstance(data.get('volumes'),list),'atlas: volumes missing')
    if not partial:
        require(data.get('schemaVersion')==1 and data.get('id')==PACK_ID,'atlas: pack identity mismatch')
        text(data.get('notice'),'atlas notice')
    manifest=json.loads((root/'content/textbook-manifest.json').read_text())
    expected={b['bookId'] for b in manifest['books']}
    volumes=[v.get('bookId') for v in data['volumes']]
    require(len(set(volumes))==len(volumes),'atlas: duplicate volume')
    require(set(volumes)<=expected,'atlas: unknown volume')
    if not partial:require(set(volumes)==expected,'atlas: all 13 volumes required')
    hashes={};warnings=[];diagram_counts={};case_count=0;shape_count=0
    for volume in data['volumes']:
        bid=volume['bookId'];items=volume.get('units')
        require(isinstance(items,list) and (len(items)>=1 if partial else len(items)==2),bid+': expected two units')
        source=json.loads((root/('content/textbook-depth/'+bid+'.json')).read_text())
        chapters={c['id'] for c in source['chapters']}
        non_relationship=0
        for unit in items:
            uid=unit.get('id');where=str(uid)
            require(uid in {'atlas-'+bid.replace('bcsc-','')+'-01','atlas-'+bid.replace('bcsc-','')+'-02'},bid+': wrong unit id')
            require(uid not in hashes,uid+': duplicate unit')
            require(set(unit)==UNIT_KEYS,uid+': unexpected or missing unit keys')
            text(unit['title'],uid+' title');text(unit['clinicalQuestion'],uid+' clinical question')
            texts(unit['chapterIds'],uid+' chapterIds');require(len(set(unit['chapterIds']))==len(unit['chapterIds']) and set(unit['chapterIds'])<=chapters,uid+': invalid/duplicate chapter link')
            texts(unit['learningGoals'],uid+' goals',2);texts(unit['mechanism'],uid+' mechanism',3,20)
            texts(unit['pitfalls'],uid+' pitfalls',2)
            for key,minimum,fields in [('figureReading',2,{'label','meaning'}),('decisionSteps',3,{'condition','action','why'}),('counterfactuals',2,{'change','consequence'})]:
                require(isinstance(unit[key],list) and len(unit[key])>=minimum,uid+': too few '+key)
                for row in unit[key]:
                    require(isinstance(row,dict) and set(row)==fields,uid+': invalid '+key+' structure')
                    for field in fields:text(row[field],uid+' '+key+'.'+field)
            comp=unit['comparison'];require(isinstance(comp,dict) and set(comp)=={'columns','rows'},uid+': invalid comparison')
            texts(comp['columns'],uid+' comparison columns',2)
            require(isinstance(comp['rows'],list) and len(comp['rows'])>=3,uid+': too few comparison rows')
            for row in comp['rows']:
                texts(row,uid+' comparison cells',len(comp['columns']));require(len(row)==len(comp['columns']),uid+': ragged table')
            require(isinstance(unit['retrieval'],list) and len(unit['retrieval'])>=2,uid+': too few retrievals')
            cases=0
            for row in unit['retrieval']:
                require(isinstance(row,dict) and row.get('type') in {'case','recall'},uid+': retrieval type required')
                allowed={'type','question','answer','reasoning'} if row['type']=='case' else {'type','question','answer'}
                require(set(row)==allowed,uid+': invalid retrieval structure')
                text(row['question'],uid+' retrieval question');text(row['answer'],uid+' retrieval answer')
                if row['type']=='case':texts(row['reasoning'],uid+' case reasoning',3);cases+=1
            require(cases>=1,uid+': case reasoning required');case_count+=cases
            refs=unit['references'];require(isinstance(refs,list) and len(refs)>=2,uid+': at least two primary references required')
            for ref in refs:
                require(isinstance(ref,dict) and {'title','url'}<=ref.keys() and set(ref)<={'title','url','year','note'},uid+': invalid reference')
                text(ref['title'],uid+' reference title')
                parsed=urlsplit(ref['url']);require(parsed.scheme=='https' and bool(parsed.netloc) and not parsed.username and not parsed.password,uid+': unsafe reference URL')
                for key in {'year','note'}&ref.keys():text(ref[key],uid+' reference '+key)
            diagram=unit['diagram'];require(isinstance(diagram,dict) and set(diagram)=={'kind','title','alt','width','height','elements'},uid+': invalid diagram')
            require(diagram['kind'] in {'anatomy','optics','field','relationship'},uid+': diagram kind')
            non_relationship+=diagram['kind']!='relationship';diagram_counts[diagram['kind']]=diagram_counts.get(diagram['kind'],0)+1
            text(diagram['title'],uid+' figure title');text(diagram['alt'],uid+' figure alt',20)
            require(diagram['width']==900 and diagram['height']==460,uid+': unexpected canvas')
            require(isinstance(diagram['elements'],list),uid+': missing SVG elements')
            shapes=sum(e.get('type')!='text' for e in diagram['elements']);require(shapes>=8,uid+': needs at least 8 nontext shapes');shape_count+=shapes
            for i,e in enumerate(diagram['elements']):validate_element(e,uid+' element '+str(i),warnings)
            hashes[uid]=reviewed_hash(unit)
        if not partial:require(non_relationship>=1,bid+': needs a spatial/anatomical/optical diagram')
    if review is not None:
        require(review.get('schemaVersion')==1 and review.get('packId')==PACK_ID and review.get('conclusion')=='pass','review: independent pass receipt required')
        text(review.get('reviewer'),'reviewer');text(review.get('reviewedAt'),'review date')
        require(review.get('contentHashes')==hashes,'review: content changed or review coverage incomplete')
    return {'volumes':len(volumes),'units':len(hashes),'figures':len(hashes),'structuredCases':case_count,'nontextShapes':shape_count,'diagramKinds':diagram_counts,'textBoundsWarnings':warnings,'contentHashes':hashes}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--file',type=Path,default=ROOT/'content/textbook-depth/visual-atlas.json')
    parser.add_argument('--partial',action='store_true')
    parser.add_argument('--strict',action='store_true')
    parser.add_argument('--review',type=Path,default=ROOT/'content/textbook-depth/visual-atlas-review.json')
    args=parser.parse_args()
    try:
        receipt=json.loads(args.review.read_text()) if args.strict else None
        result=validate(json.loads(args.file.read_text()),partial=args.partial,review=receipt)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except (ValueError,KeyError,TypeError,FileNotFoundError) as error:
        raise SystemExit('Atlas validation failed: '+str(error))


if __name__=='__main__':main()
