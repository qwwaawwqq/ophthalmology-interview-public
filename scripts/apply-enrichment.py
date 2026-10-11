#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Idempotently add reviewed chapter enrichment to the existing public app.

Run from any directory after content/study-enrichment.json and all 14 SVGs exist.
--check validates and generates in memory without changing index.html.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
CONTENT = ROOT / 'content/study-enrichment.json'
KINDS = {'圖譜', '影片', '期刊', '指南'}
JS_START = '/* enrichment-ui:start */'
JS_END = '/* enrichment-ui:end */'
CSS_START = '/* enrichment-styles:start */'
CSS_END = '/* enrichment-styles:end */'


def require_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label}: nonempty string required')


def validate(enrichment, data):
    chapters = enrichment.get('chapters')
    expected = {t['id'] for t in data['topics'] if t.get('chapter')}
    if not isinstance(chapters, dict) or set(chapters) != expected:
        raise ValueError('Enrichment must contain exactly the 14 existing chapter IDs')
    for tid, chapter in chapters.items():
        if not re.fullmatch(r'notes-\d{2}', tid):
            raise ValueError(f'Unsafe chapter ID: {tid}')
        resources = chapter.get('resources')
        if not isinstance(resources, list) or not resources:
            raise ValueError(f'{tid}: resources required')
        ids = set()
        for resource in resources:
            for key in ['id', 'title', 'url', 'provider', 'note']:
                require_text(resource.get(key), f'{tid}.resources.{key}')
            if resource['id'] in ids:
                raise ValueError(f'{tid}: duplicate resource ID {resource["id"]}')
            ids.add(resource['id'])
            if not resource['url'].startswith('https://') or resource.get('kind') not in KINDS:
                raise ValueError(f'{tid}: resource needs HTTPS and a supported kind')
        deep_dive = chapter.get('deepDive')
        if not isinstance(deep_dive, list) or not deep_dive:
            raise ValueError(f'{tid}: deepDive required')
        for item in deep_dive:
            require_text(item.get('heading'), f'{tid}.deepDive.heading')
            if not isinstance(item.get('paragraphs'), list) or not item['paragraphs']:
                raise ValueError(f'{tid}: deepDive.paragraphs required')
            for paragraph in item['paragraphs']:
                require_text(paragraph, f'{tid}.deepDive.paragraph')
        challenge = chapter.get('oralChallenge', {})
        require_text(challenge.get('question'), f'{tid}.oralChallenge.question')
        require_text(challenge.get('answer'), f'{tid}.oralChallenge.answer')
        figure = chapter.get('figure', {})
        for key in ['type', 'title', 'caption', 'alt']:
            require_text(figure.get(key), f'{tid}.figure.{key}')
        for item in [*deep_dive, challenge, figure]:
            refs = item.get('sourceIds')
            if not isinstance(refs, list) or not refs or not all(isinstance(x, str) for x in refs):
                raise ValueError(f'{tid}: each teaching item requires sourceIds')
            missing = set(refs) - ids
            if missing:
                raise ValueError(f'{tid}: unresolved sourceIds: {sorted(missing)}')
        image = ROOT / 'assets/figures' / f'{tid}.svg'
        if not image.is_file():
            raise ValueError(f'Missing SVG: {image}')
        if ET.parse(image).getroot().tag.rsplit('}', 1)[-1] != 'svg':
            raise ValueError(f'Not an SVG: {image}')


JS = r'''
/* enrichment-ui:start */
function chapterEnrichment(t){return D.enrichment?.chapters?.[t.id]||null;}
function enrichmentSourceLinks(item,chapter){const ids=new Set(item.sourceIds||[]),sources=(chapter.resources||[]).filter(r=>ids.has(r.id));return sources.length?`<div class="enrichment-citations"><span>依據</span>${sources.map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`).join('')}</div>`:'';}
function enrichmentNav(t){if(!chapterEnrichment(t))return '';return `<nav class="enrichment-nav" aria-label="本章延伸學習"><span>延伸學習</span><a href="#${t.id}-figure">圖解</a><a href="#${t.id}-deep">深入理解</a><a href="#${t.id}-challenge">口述挑戰</a><a href="#${t.id}-resources">延伸資源</a></nav>`;}
function renderEnrichment(t){const c=chapterEnrichment(t);if(!c)return '';const f=c.figure,src='assets/figures/'+t.id+'.svg',kinds=['圖譜','影片','期刊','指南'];return `<section class="enrichment-block" aria-labelledby="${t.id}-enrichment-title"><div class="enrichment-section-heading"><h3 id="${t.id}-enrichment-title">圖解與延伸學習</h3><span class="small">最近查核 ${esc(D.enrichment.reviewedDate||'2026-10-11')}</span></div><figure class="enrichment-figure" id="${t.id}-figure"><img class="enrichment-image" src="${esc(src)}" alt="${esc(f.alt)}" loading="lazy" decoding="async"><p class="enrichment-image-fallback" hidden>圖解暫時無法顯示，請先閱讀下方圖說與延伸資料。</p><figcaption><div class="enrichment-figure-heading"><strong>${esc(f.title)}</strong><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">放大圖解</a></div><p>${esc(f.caption)}</p><p class="small">概念示意圖，非實際臨床影像。</p>${enrichmentSourceLinks(f,c)}</figcaption></figure><section class="enrichment-deep" id="${t.id}-deep" aria-label="深入理解"><h3>深入理解</h3>${c.deepDive.map((b,n)=>`<details class="enrichment-detail" ${n===0?'open':''}><summary>${esc(b.heading)}</summary><div>${b.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}${enrichmentSourceLinks(b,c)}</div></details>`).join('')}</section><section class="enrichment-challenge" id="${t.id}-challenge"><h3>口述挑戰</h3><p>${esc(c.oralChallenge.question)}</p><details class="enrichment-detail"><summary>回答後，查看重點</summary><div><p class="preline">${esc(c.oralChallenge.answer)}</p>${enrichmentSourceLinks(c.oralChallenge,c)}</div></details></section><section class="enrichment-resources" id="${t.id}-resources" aria-label="延伸學習資源"><h3>延伸資源</h3><p class="small">依提示找出重點，再回到本章用自己的話解釋。</p>${kinds.map(kind=>{const resources=c.resources.filter(r=>r.kind===kind);return resources.length?`<section class="enrichment-resource-group"><h4>${kind}</h4><ul>${resources.map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><span class="enrichment-provider">${esc(r.provider)}</span><p>${esc(r.note)}</p></li>`).join('')}</ul></section>`:'';}).join('')}</section></section>`;}
function enrichmentIndex(){const out=[];for(const t of D.topics){const c=chapterEnrichment(t);if(!c)continue;const common={topicId:t.id,chapter:t.chapter,action:'learn-topic',target:t.id};out.push({...common,type:'圖解',title:c.figure.title,body:c.figure.caption+' '+c.figure.alt});for(const b of c.deepDive)out.push({...common,type:'深入理解',title:b.heading,body:b.paragraphs.join(' ')});out.push({...common,type:'口述挑戰',title:c.oralChallenge.question,body:c.oralChallenge.answer});for(const r of c.resources)out.push({...common,type:'延伸資源',title:r.title,body:r.provider+' '+r.kind+' '+r.note});}return out;}
function enrichmentOverview(){const chapters=D.topics.filter(t=>chapterEnrichment(t));if(!chapters.length)return '';const sections=chapters.reduce((n,t)=>n+chapterEnrichment(t).deepDive.length,0),resources=chapters.reduce((n,t)=>n+chapterEnrichment(t).resources.length,0);return `<section class="enrichment-overview" aria-label="圖解與延伸學習"><div><strong>圖解與延伸學習</strong><p>${chapters.length} 張概念圖、${sections} 組深入理解與 ${resources} 筆延伸資源，已加入各章。可直接搜尋概念、圖解或資源名稱。</p></div>${btn('從第一章看圖解','learn-topic',chapters[0].id,'small')}</section>`;}
document.addEventListener('error',e=>{const image=e.target;if(!image?.classList?.contains('enrichment-image'))return;image.hidden=true;const fallback=image.closest('figure')?.querySelector('.enrichment-image-fallback');if(fallback)fallback.hidden=false;},true);
/* enrichment-ui:end */
'''

CSS = r'''
/* enrichment-styles:start */
.enrichment-nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 0;margin:20px 0;font-size:14px;line-height:1.7}.enrichment-nav>span{color:var(--muted);font-size:12px;margin-right:2px}.enrichment-nav>a{padding:4px 0;color:var(--blue);text-decoration-thickness:1px}.enrichment-block{padding:30px 0;border-top:2px solid #adcdd1;max-width:76ch;margin:24px auto 0}.enrichment-section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:21px}.enrichment-section-heading h3{font-size:1.13rem}.enrichment-section-heading .small{font-size:12px;color:var(--muted)}.enrichment-figure{margin:0 0 28px;scroll-margin-top:90px}.enrichment-image{display:block;width:100%;height:auto;max-height:700px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:5px}.enrichment-figure figcaption{padding:16px 0 0;font-size:14px;line-height:1.9;color:var(--ink)}.enrichment-figure figcaption p{margin-top:9px}.enrichment-figure-heading{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap}.enrichment-figure-heading strong{font-size:16px;font-weight:600}.enrichment-figure-heading>a{font-size:14px;padding:5px 0}.enrichment-image-fallback{padding:22px;border:1px solid var(--line);background:#f5f9fa;border-radius:5px;font-size:15px;line-height:1.85;color:var(--muted)}.enrichment-citations{display:flex;gap:5px 13px;align-items:baseline;flex-wrap:wrap;margin-top:14px;font-size:12px;line-height:1.8;color:var(--muted)}.enrichment-citations>span{flex-shrink:0}.enrichment-citations a{color:#426b78;text-decoration-thickness:1px;overflow-wrap:anywhere}.enrichment-deep,.enrichment-challenge,.enrichment-resources{padding:25px 0;border-top:1px solid var(--line);scroll-margin-top:90px}.enrichment-deep>h3,.enrichment-challenge>h3,.enrichment-resources>h3{font-size:1.05rem;margin-bottom:15px;color:var(--navy)}.enrichment-detail{border-bottom:1px solid var(--line)}.enrichment-detail>summary{padding:17px 4px;font-size:16px;font-weight:600;line-height:1.8;color:#245968}.enrichment-detail>div{padding:0 4px 21px;font-size:16px;line-height:1.95}.enrichment-detail>div>p+p{margin-top:14px}.enrichment-challenge>p{font-size:16px;line-height:1.95;margin:0 0 15px}.enrichment-challenge .enrichment-detail{border:1px solid var(--line);border-radius:5px;padding:0 16px;background:#f8fbfb}.enrichment-challenge .enrichment-detail>summary{font-size:14px}.enrichment-resource-group{margin-top:23px}.enrichment-resource-group h4{font-size:14px;font-weight:600;line-height:1.8;color:var(--muted);margin:0 0 9px}.enrichment-resource-group ul{list-style:none;padding:0;margin:0}.enrichment-resource-group li{padding:16px 0;border-top:1px solid #e3ecef;margin:0}.enrichment-resource-group li>a{font-size:16px;font-weight:600;line-height:1.8}.enrichment-provider{display:block;font-size:12px;color:var(--muted);margin-top:4px}.enrichment-resource-group li>p{margin:8px 0 0;font-size:15px;line-height:1.9;color:var(--ink)}.enrichment-overview{display:flex;align-items:center;justify-content:space-between;gap:22px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:19px 2px;margin:0 0 28px}.enrichment-overview strong{font-size:16px;font-weight:600;color:var(--navy)}.enrichment-overview p{font-size:14px;color:var(--muted);line-height:1.9;margin-top:6px;max-width:75ch}.enrichment-overview>.btn{flex-shrink:0}.enrichment-nav a:focus-visible,.enrichment-detail summary:focus-visible,.enrichment-figure-heading a:focus-visible{outline:3px solid #258b99;outline-offset:3px}
@media(max-width:760px){.enrichment-nav{gap:8px 17px;margin:19px 0;padding:10px 0}.enrichment-nav>a{min-height:44px;display:inline-flex;align-items:center;font-size:14px}.enrichment-nav>span{flex-basis:100%;font-size:12px}.enrichment-block{padding-top:25px}.enrichment-section-heading{gap:8px;margin-bottom:18px}.enrichment-section-heading h3{font-size:18px}.enrichment-image{max-height:none}.enrichment-figure,.enrichment-deep,.enrichment-challenge,.enrichment-resources{scroll-margin-top:145px}.enrichment-figure-heading>a{min-height:44px;display:inline-flex;align-items:center}.enrichment-figure figcaption{font-size:14px;line-height:1.9}.enrichment-figure-heading strong{font-size:16px}.enrichment-detail>summary{font-size:16px;padding:17px 0;min-height:52px}.enrichment-detail>div{font-size:16px;line-height:1.95;padding-left:0;padding-right:0}.enrichment-challenge>p{font-size:16px}.enrichment-citations{font-size:12px;line-height:1.85;gap:7px 12px}.enrichment-challenge .enrichment-detail{padding-left:14px;padding-right:14px}.enrichment-resource-group li>a{font-size:16px;line-height:1.9}.enrichment-resource-group li>p{font-size:16px;line-height:1.95}.enrichment-provider{font-size:12px}.enrichment-overview{display:block;padding:20px 1px;margin-bottom:23px}.enrichment-overview p{font-size:14px}.enrichment-overview>.btn{margin-top:15px;min-height:44px;font-size:14px}}
/* enrichment-styles:end */
'''


def function_line(js, name):
    match = re.search(r'^function '+re.escape(name)+r'\([^\n]+$', js, re.M)
    if not match:
        raise ValueError(f'Expected existing one-line function: {name}')
    return match


def build():
    html = INDEX.read_text(encoding='utf-8')
    match = re.search(r'(<script type="application/json" id="course-data">)(.*?)(</script>)', html, re.S)
    if not match:
        raise ValueError('Missing course-data JSON')
    data = json.loads(match.group(2))
    preserved = json.loads(json.dumps({k:v for k,v in data.items() if k != 'enrichment'}))
    enrichment = json.loads(CONTENT.read_text(encoding='utf-8'))
    enrichment.setdefault('reviewedDate', '2026-10-11')
    validate(enrichment, data)
    data['enrichment'] = enrichment
    data['notebook']['imageScope'] = '本版提供原創教學示意圖，非實際臨床影像；延伸資源連至來源網站的圖譜、影片或文獻。原始共筆 PDF 未公開。'
    preserved['notebook']['imageScope'] = data['notebook']['imageScope']
    js = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
    js = re.sub(re.escape(JS_START)+r'.*?'+re.escape(JS_END)+r'\n?', '', js, flags=re.S)

    # These markers are placed once; repeated runs only refresh data/functions.
    m = function_line(js, 'chapterExtras')
    old = m.group(0)
    if '${renderEnrichment(t)}' not in old:
        new = old.replace("if(!t.chapter)return '';return `", "if(!t.chapter)return '';return `${renderEnrichment(t)}", 1)
        if new == old:
            raise ValueError('chapterExtras insertion point changed')
        js = js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'chapterExtras')
    old = m.group(0)
    if "${chapterEnrichment(t)?'':`" not in old:
        heading='<section class="lesson-block"><h3>看圖判讀練習</h3>'
        if heading not in old:
            raise ValueError('Legacy image-practice insertion point changed')
        image_start=old.index(heading)
        image_end=old.index('${extensionList(t.ext)}',image_start)
        block=old[image_start:image_end]
        new=old[:image_start]+"${chapterEnrichment(t)?'':`"+block+'`}'+old[image_end:]
        js=js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'learn')
    old = m.group(0)
    if '${enrichmentNav(t)}' not in old:
        needle='<p class="lead">${esc(t.summary)}</p>'
        if needle not in old:
            raise ValueError('learn insertion point changed')
        new=old.replace(needle,needle+'${enrichmentNav(t)}',1)
        js=js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'notebookIndex')
    old = m.group(0)
    if '...enrichmentIndex()' not in old:
        if not old.endswith('return out;}'):
            raise ValueError('notebookIndex insertion point changed')
        new=old[:-len('return out;}')]+'return [...out,...enrichmentIndex()];}'
        js=js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'notebook')
    old = m.group(0)
    if '${enrichmentOverview()}' not in old:
        needle='${searching?`<section class="search-section">'
        if needle not in old:
            raise ValueError('notebook insertion point changed')
        new=old.replace(needle,'${enrichmentOverview()}'+needle,1)
        js=js[:m.start()]+new+js[m.end():]
    js=js.replace('function render(){',JS.strip()+'\nfunction render(){',1)
    if JS_START not in js:
        raise ValueError('Missing render function')
    if shutil.which('node'):
        checked=subprocess.run(['node','--check'],input=js,text=True,capture_output=True)
        if checked.returncode:
            raise ValueError('Generated JavaScript is invalid: '+checked.stderr)
    else:
        raise RuntimeError('Node is required to validate generated JavaScript')
    payload=json.dumps(data,ensure_ascii=False).replace('</','<\\/').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    html=html[:match.start(2)]+payload+html[match.end(2):]
    html=re.sub(r'<script>.*?</script>',lambda _: '<script>'+js+'</script>',html,flags=re.S)
    html=re.sub(re.escape(CSS_START)+r'.*?'+re.escape(CSS_END)+r'\n?', '', html, flags=re.S)
    css=CSS
    html=html.replace('</style>',css.strip()+'\n</style>',1)
    after=json.loads(re.search(r'<script type="application/json" id="course-data">(.*?)</script>',html,re.S).group(1))
    if {k:v for k,v in after.items() if k != 'enrichment'} != preserved:
        raise ValueError('Existing app data changed')
    assert html.count(JS_START)==1 and html.count(CSS_START)==1
    return html, after


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Validate without writing index.html')
    args=parser.parse_args()
    result,data=build()
    encoded=result.encode('utf-8')
    if not args.check:
        INDEX.write_bytes(encoded)
    chapters=data['enrichment']['chapters']
    print(json.dumps({'mode':'check' if args.check else 'write','index':str(INDEX),'bytes':len(encoded),'sha256':hashlib.sha256(encoded).hexdigest(),'chapters':len(chapters),'deep_dive_sections':sum(len(c['deepDive']) for c in chapters.values()),'resources':sum(len(c['resources']) for c in chapters.values()),'existing_content_preserved':True,'updated_metadata':['notebook.imageScope']},ensure_ascii=False))
