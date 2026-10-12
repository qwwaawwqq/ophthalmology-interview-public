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
COVERAGE = ROOT / 'content/source-coverage.json'
SAMPLES = ROOT / 'content/interview-samples.json'
KAOGU = ROOT / 'content/past-exam-questions.json'
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
        integrated = chapter.get('integrated')
        if integrated is not None:
            validate_integrated(tid, integrated, chapter, data, ids)
        image = ROOT / 'assets/figures' / f'{tid}.svg'
        if not image.is_file():
            raise ValueError(f'Missing SVG: {image}')
        if ET.parse(image).getroot().tag.rsplit('}', 1)[-1] != 'svg':
            raise ValueError(f'Not an SVG: {image}')

    integrated_count = sum('integrated' in chapter for chapter in chapters.values())
    if integrated_count not in (0, len(chapters)):
        raise ValueError('Integrated lessons must cover all chapters together')
    topic_ids = {t['id'] for t in data['topics']}
    paths = enrichment.get('learningPaths', [])
    path_ids = set()
    if not isinstance(paths, list):
        raise ValueError('learningPaths must be a list')
    for path in paths:
        for key in ['id', 'title', 'question']:
            require_text(path.get(key), f'learningPaths.{key}')
        if path['id'] in path_ids:
            raise ValueError('Duplicate learning path ID')
        path_ids.add(path['id'])
        targets = path.get('topicIds')
        if not isinstance(targets, list) or not targets or len(set(targets)) != len(targets) or not set(targets) <= topic_ids:
            raise ValueError(f'Learning path {path["id"]}: invalid topicIds')


def validate_integrated(tid, integrated, chapter, data, resource_ids):
    topic = next(t for t in data['topics'] if t['id'] == tid)
    topic_ids = {t['id'] for t in data['topics']}

    def texts(items, label, length):
        if not isinstance(items, list) or len(items) != length:
            raise ValueError(f'{tid}.{label}: exactly {length} items required')
        for item in items:
            require_text(item, f'{tid}.{label}')

    def refs(item, label):
        values = item.get('sourceIds')
        if not isinstance(values, list) or not values or not all(isinstance(x, str) for x in values) or not set(values) <= resource_ids:
            raise ValueError(f'{tid}.{label}: sourceIds must resolve within the chapter')

    require_text(integrated.get('framing'), f'{tid}.integrated.framing')
    texts(integrated.get('objectives'), 'integrated.objectives', 3)
    units = integrated.get('units')
    if not isinstance(units, list) or len(units) != 3:
        raise ValueError(f'{tid}: exactly three integrated units required')
    sections, dives = [], []
    for n, unit in enumerate(units):
        if unit.get('id') != f'u{n+1}':
            raise ValueError(f'{tid}: unit IDs must be u1, u2, u3 in order')
        require_text(unit.get('title'), f'{tid}.units.title')
        texts(unit.get('synthesis'), 'units.synthesis', 2)
        for key, target in [('sectionIndexes', sections), ('deepDiveIndexes', dives)]:
            values = unit.get(key)
            if not isinstance(values, list) or not all(type(x) is int for x in values) or (key == 'sectionIndexes' and not values):
                requirement = 'nonempty integer list' if key == 'sectionIndexes' else 'integer list'
                raise ValueError(f'{tid}.units.{key}: {requirement} required')
            target.extend(values)
        if type(unit.get('showFigure')) is not bool:
            raise ValueError(f'{tid}: showFigure must be boolean')
        decisions = unit.get('decisions')
        if not isinstance(decisions, list) or len(decisions) != 2:
            raise ValueError(f'{tid}: two decisions required for each unit')
        for decision in decisions:
            for key in ['finding', 'interpretation', 'nextStep']:
                require_text(decision.get(key), f'{tid}.decisions.{key}')
        refs(unit, 'units')
    if sorted(sections) != list(range(len(topic['sections']))):
        raise ValueError(f'{tid}: sectionIndexes must partition all original sections exactly once')
    if sorted(dives) != list(range(len(chapter['deepDive']))):
        raise ValueError(f'{tid}: deepDiveIndexes must partition all deep dives exactly once')
    if sum(unit['showFigure'] for unit in units) != 1:
        raise ValueError(f'{tid}: the figure must appear in exactly one unit')
    case = integrated.get('case', {})
    for key in ['title', 'stem']:
        require_text(case.get(key), f'{tid}.case.{key}')
    steps = case.get('steps')
    if not isinstance(steps, list) or len(steps) != 3:
        raise ValueError(f'{tid}: three case steps required')
    for step in steps:
        for key in ['newInfo', 'prompt', 'answer', 'rationale']:
            require_text(step.get(key), f'{tid}.case.steps.{key}')
        refs(step, 'case.steps')
    connections = integrated.get('connections')
    if not isinstance(connections, list) or not 2 <= len(connections) <= 3:
        raise ValueError(f'{tid}: two or three connections required')
    targets = []
    for connection in connections:
        target = connection.get('topicId')
        if target not in topic_ids or target == tid or target in targets:
            raise ValueError(f'{tid}: connection must resolve to a distinct other topic')
        targets.append(target)
        require_text(connection.get('reason'), f'{tid}.connections.reason')


def validate_samples(samples, data):
    versions = samples.get('versions')
    if not isinstance(versions, list) or len(versions) != 3:
        raise ValueError('interview samples need exactly 3 versions')
    for v in versions:
        require_text(v.get('label'), 'sample version label')
        require_text(v.get('hint'), 'sample version hint')
        require_text(v.get('clinicalHint'), 'sample version clinical hint')
    require_text(samples.get('note'), 'sample note')
    require_text(samples.get('clinicalNote'), 'sample clinical note')
    expected = {i['id'] for i in data['interview']}
    answers = samples.get('answers')
    if not isinstance(answers, dict) or set(answers) != expected:
        raise ValueError('interview samples must cover exactly the interview questions')
    for iid, texts in answers.items():
        if not isinstance(texts, list) or len(texts) != 3:
            raise ValueError(f'{iid}: need 3 sample answers')
        for t in texts:
            require_text(t, f'{iid} sample answer')


def validate_coverage(coverage, enrichment, data):
    """Validate the source audit separately from the unchanged original course."""
    for key in ['reviewedDate', 'scopeNote']:
        require_text(coverage.get(key), f'coverage.{key}')
    chapters = coverage.get('chapters')
    if not isinstance(chapters, dict) or set(chapters) != set(enrichment['chapters']):
        raise ValueError('Coverage must contain exactly the existing chapter IDs')
    topics = {topic['id']: topic for topic in data['topics']}
    for tid, chapter in chapters.items():
        require_text(chapter.get('sourceFile'), f'{tid}.coverage.sourceFile')
        page_count = chapter.get('pageCount')
        if type(page_count) is not int or page_count < 1:
            raise ValueError(f'{tid}: positive pageCount required')
        reviewed = chapter.get('reviewedPages')
        if not isinstance(reviewed, list) or not reviewed:
            raise ValueError(f'{tid}: reviewedPages required')
        seen_pages, teaching_pages = [], set()
        for span in reviewed:
            start, end = span.get('from'), span.get('to')
            if type(start) is not int or type(end) is not int or not 1 <= start <= end <= page_count:
                raise ValueError(f'{tid}: invalid reviewed page range')
            if span.get('kind') not in {'teaching', 'exam', 'administrative'}:
                raise ValueError(f'{tid}: invalid reviewed page kind')
            require_text(span.get('note'), f'{tid}.reviewedPages.note')
            seen_pages.extend(range(start, end + 1))
            if span['kind'] in {'teaching', 'exam'}:
                teaching_pages.update(range(start, end + 1))
        if sorted(seen_pages) != list(range(1, page_count + 1)):
            raise ValueError(f'{tid}: reviewedPages must partition every PDF page exactly once')
        if chapter.get('unresolved') != []:
            raise ValueError(f'{tid}: unresolved audit findings must be resolved before publishing')
        limitations = chapter.get('sourceLimitations', [])
        if not isinstance(limitations, list):
            raise ValueError(f'{tid}: sourceLimitations must be a list')
        for limitation in limitations:
            pages = limitation.get('pages')
            if not isinstance(pages, list) or not pages or not all(type(p) is int and 1 <= p <= page_count for p in pages) or len(set(pages)) != len(pages):
                raise ValueError(f'{tid}: source limitations require unique in-range pages')
            for key in ['reason', 'handling']:
                require_text(limitation.get(key), f'{tid}.sourceLimitations.{key}')
        entries = chapter.get('entries')
        if not isinstance(entries, list) or not entries:
            raise ValueError(f'{tid}: coverage entries required')
        lesson = enrichment['chapters'][tid]
        units = {unit['id'] for unit in lesson.get('integrated', {}).get('units', [])}
        resource_ids = {resource['id'] for resource in lesson['resources']}
        seen_ids, linked_pages = set(), set()
        for entry in entries:
            eid = entry.get('id')
            if not isinstance(eid, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', eid) or eid in seen_ids:
                raise ValueError(f'{tid}: invalid or duplicate coverage entry ID {eid}')
            seen_ids.add(eid)
            for key in ['title', 'clinicalLink', 'pitfall']:
                require_text(entry.get(key), f'{tid}.{eid}.{key}')
            pages = entry.get('pages')
            if not isinstance(pages, list) or not pages or not all(type(p) is int and 1 <= p <= page_count for p in pages) or len(set(pages)) != len(pages):
                raise ValueError(f'{tid}.{eid}: unique in-range source pages required')
            linked_pages.update(pages)
            if entry.get('unitId') not in units:
                raise ValueError(f'{tid}.{eid}: unresolved integrated unit')
            sections = entry.get('sectionIndexes')
            if not isinstance(sections, list) or not sections or not all(type(i) is int and 0 <= i < len(topics[tid]['sections']) for i in sections) or len(set(sections)) != len(sections):
                raise ValueError(f'{tid}.{eid}: valid original sectionIndexes required')
            for key in ['terms', 'keyPoints']:
                values = entry.get(key)
                if not isinstance(values, list) or not values or (key == 'keyPoints' and not 2 <= len(values) <= 4):
                    raise ValueError(f'{tid}.{eid}: {key} requires ' + ('2–4 paragraphs' if key == 'keyPoints' else 'search terms'))
                for value in values:
                    require_text(value, f'{tid}.{eid}.{key}')
            for key in ['question', 'answer']:
                require_text(entry.get('recall', {}).get(key), f'{tid}.{eid}.recall.{key}')
            related = entry.get('relatedTopics')
            if not isinstance(related, list) or len(set(related)) != len(related) or not set(related) <= set(topics):
                raise ValueError(f'{tid}.{eid}: unresolved relatedTopics')
            refs = entry.get('sourceIds')
            if not isinstance(refs, list) or not refs or not all(isinstance(ref, str) for ref in refs) or not set(refs) <= resource_ids:
                raise ValueError(f'{tid}.{eid}: unresolved clinical sourceIds')
        if teaching_pages - linked_pages:
            raise ValueError(f'{tid}: teaching/exam pages without topic entries: {sorted(teaching_pages - linked_pages)}')


JS = r'''
/* enrichment-ui:start */
function chapterEnrichment(t){return D.enrichment?.chapters?.[t.id]||null;}
function chapterCoverage(t){return D.coverage?.chapters?.[t.id]||null;}
function coveragePageLabel(pages){const sorted=[...new Set(pages)].sort((a,b)=>a-b),ranges=[];for(let i=0;i<sorted.length;i++){const first=sorted[i];let last=first;while(sorted[i+1]===last+1)last=sorted[++i];ranges.push(first===last?String(first):first+'–'+last);}return ranges.join('、');}
function coverageLink(t,label,target,css=''){return `<a class="${esc(css)}" href="#${t.id}-${esc(target)}" data-action="coverage-focus" data-value="${t.id}|${esc(target)}">${esc(label)}</a>`;}
function coverageTarget(t,target){const c=chapterCoverage(t);if(!c)return false;if(target==='coverage')return true;if(target.startsWith('coverage-'))return c.entries.some(entry=>target==='coverage-'+entry.id);if(/^section-\d+$/.test(target))return Number(target.slice(8))<t.sections.length;return chapterEnrichment(t)?.integrated?.units.some(unit=>unit.id===target)||false;}
function coverageFocus(value,updateHash=true){
  const [tid,target]=value.split('|'),t=D.topics.find(topic=>topic.id===tid);
  if(!t||!coverageTarget(t,target))return false;
  if(S.tab!=='learn'||S.learn!==tid){S.learn=tid;switchTab('learn');}
  const anchor=tid+'-'+target,node=document.getElementById(anchor);
  if(!node)return false;
  for(let parent=node;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  const focus=node.tagName==='DETAILS'?node.querySelector('summary'):node;
  if(focus){focus.setAttribute('tabindex','-1');focus.focus({preventScroll:true});}
  node.scrollIntoView({block:'start'});
  if(updateHash&&window.history?.replaceState)window.history.replaceState(null,'','#'+anchor);
  return true;
}
function coverageRestoreHash(){const match=(window.location?.hash||'').match(/^#(notes-\d{2})-(coverage(?:-[a-z][a-z0-9-]*)?|section-\d+|u[1-3])$/);if(match)coverageFocus(match[1]+'|'+match[2],false);}
function coverageEntry(t,entry,c){
  const unit=c.integrated.units.find(unit=>unit.id===entry.unitId);
  const teaching=`${entry.keyPoints.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}<div class="coverage-clinical"><p><strong>放進臨床判斷</strong>${esc(entry.clinicalLink)}</p><p><strong>容易漏掉的差別</strong>${esc(entry.pitfall)}</p></div>`;
  const answer=`<details class="coverage-answer"><summary>${S.recall?'回想後，查看解析與參考回答':'回答後，查看參考回答'}</summary><div>${S.recall?teaching:''}<p class="coverage-recall-answer">${esc(entry.recall.answer)}</p>${enrichmentSourceLinks(entry,c)}</div></details>`;
  return `<details class="coverage-entry" id="${t.id}-coverage-${entry.id}"><summary><span>${esc(entry.title)}</span><span class="coverage-pages">PDF 頁 ${coveragePageLabel(entry.pages)}</span></summary><div class="coverage-entry-body"><p class="coverage-source">${esc(chapterCoverage(t).sourceFile)} · PDF 頁 ${coveragePageLabel(entry.pages)}</p><p class="coverage-terms">${entry.terms.map(esc).join(' · ')}</p>${S.recall?'':teaching}<p class="coverage-question"><strong>換你整合</strong>${esc(entry.recall.question)}</p>${answer}<nav class="coverage-backlinks" aria-label="${esc(entry.title)}的相關內容">${coverageLink(t,'回到單元：'+unit.title,entry.unitId)}${entry.sectionIndexes.map(i=>coverageLink(t,'基礎重點：'+t.sections[i].title,'section-'+i)).join('')}${coverageLink(t,'查看全章共筆對照','coverage')}</nav>${entry.relatedTopics.length?`<div class="coverage-related"><span>一起複習</span>${entry.relatedTopics.map(id=>btn(shortTitle(id),'learn-topic',id,'small')).join('')}</div>`:''}</div></details>`;
}
function coverageUnit(t,c,unit){const entries=(chapterCoverage(t)?.entries||[]).filter(entry=>entry.unitId===unit.id);return entries.length?`<section class="coverage-unit" aria-label="本單元共筆主題詳解"><div class="coverage-unit-heading"><h4>把共筆細節放回這個單元</h4><span>${entries.length} 個主題</span></div><p class="small">從原共筆頁面逐項整理，串連機轉、臨床意義與容易混淆的地方。</p>${entries.map(entry=>coverageEntry(t,entry,c)).join('')}</section>`:'';}
function coverageAudit(chapter){const names={teaching:'教學內容',exam:'題目概念',administrative:'編務或重複頁'},limitations=chapter.sourceLimitations||[];return `${limitations.length?`<section class="coverage-limitations" aria-label="原共筆的內容限制"><h4>原檔限制與本版處理</h4>${limitations.map(item=>`<div><p><strong>PDF 頁 ${coveragePageLabel(item.pages)}</strong>${esc(item.reason)}</p><p>${esc(item.handling)}</p></div>`).join('')}</section>`:''}<details class="coverage-audit"><summary>頁面核對紀錄</summary><p class="small">頁碼採 PDF 檔案的頁面順序；每頁只歸入一類。題目以概念重述。</p><ul>${chapter.reviewedPages.map(span=>`<li><span>頁 ${span.from===span.to?span.from:span.from+'–'+span.to} · ${names[span.kind]}</span><p>${esc(span.note)}</p></li>`).join('')}</ul></details>`;}
function coverageEntryOutline(t,chapter){const course=chapterEnrichment(t).integrated;return course.units.map(unit=>{const entries=chapter.entries.filter(entry=>entry.unitId===unit.id);return entries.length?`<div class="coverage-outline-unit"><h4>${coverageLink(t,'單元：'+unit.title,unit.id)}</h4><ul>${entries.map(entry=>`<li>${coverageLink(t,entry.title,'coverage-'+entry.id)}<span>頁 ${coveragePageLabel(entry.pages)}</span></li>`).join('')}</ul></div>`:'';}).join('');}
function coverageOutline(t){const chapter=chapterCoverage(t);if(!chapter)return '';return `<details class="coverage-outline" id="${t.id}-coverage"><summary><span>本章共筆對照</span><span>${chapter.entries.length} 個主題 · 核對 ${chapter.pageCount} 頁</span></summary><div><p class="coverage-scope">逐頁核對主題；教學重述，非原文全文或官方考綱。</p><p class="small">${esc(chapter.sourceFile)} · 查核 ${esc(D.coverage.reviewedDate)}。點選主題可直接打開對應詳解。</p>${coverageEntryOutline(t,chapter)}${coverageAudit(chapter)}</div></details>`;}
function coverageOverview(){
  const chapters=D.topics.filter(t=>chapterCoverage(t));if(!chapters.length)return '';
  const count=chapters.reduce((n,t)=>n+chapterCoverage(t).entries.length,0),pages=chapters.reduce((n,t)=>n+chapterCoverage(t).pageCount,0);
  return `<section class="coverage-overview" aria-label="原共筆主題對照"><div class="coverage-overview-heading"><h2>從共筆找到每個主題的位置</h2><p>${chapters.length} 章 · 核對 ${pages} 頁 · ${count} 個主題詳解</p></div><p class="coverage-scope">${esc(D.coverage.scopeNote)}</p><details class="coverage-all"><summary>展開全冊共筆對照</summary><p class="small">依章節與學習單元排列。選擇主題，直接前往詳解；各章保留頁面核對紀錄。</p>${chapters.map(t=>{const chapter=chapterCoverage(t);return `<details class="coverage-all-chapter"><summary><span>${esc(t.title)}</span><span>${chapter.entries.length} 個主題 · ${chapter.pageCount} 頁</span></summary><div>${coverageEntryOutline(t,chapter)}<p>${coverageLink(t,'查看本章頁面核對紀錄','coverage')}</p></div></details>`;}).join('')}</details></section>`;
}
function enrichmentSourceLinks(item,chapter){const ids=new Set(item.sourceIds||[]),sources=(chapter.resources||[]).filter(r=>ids.has(r.id));return sources.length?`<div class="enrichment-citations"><span>依據</span>${sources.map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`).join('')}</div>`:'';}
function enrichmentResourceItems(resources){return `<ul>${resources.map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><span class="enrichment-provider">${esc(r.kind)} · ${esc(r.provider)}</span><p>${esc(r.note)}</p></li>`).join('')}</ul>`;}
function enrichmentContextSources(item,c){const ids=new Set(item.sourceIds||[]),resources=c.resources.filter(r=>ids.has(r.id));return resources.length?`<details class="enrichment-context-sources"><summary>搭配圖譜、影片與文獻理解本單元</summary><div class="enrichment-resource-group">${enrichmentResourceItems(resources)}</div></details>`:'';}
function enrichmentNav(t){const c=chapterEnrichment(t);if(!c)return '';if(c.integrated)return `<nav class="enrichment-nav" aria-label="本章學習路徑"><span>本章路徑</span>${chapterCoverage(t)?coverageLink(t,'共筆對照（'+chapterCoverage(t).entries.length+' 主題）','coverage'):''}${c.integrated.units.map((u,n)=>`<a href="#${t.id}-${u.id}">${n+1}. ${esc(u.title)}</a>`).join('')}<a href="#${t.id}-case">整合病例</a><a href="#${t.id}-connections">跨章串連</a><a href="#${t.id}-resources">延伸資源</a></nav>`;return `<nav class="enrichment-nav" aria-label="本章延伸學習"><span>延伸學習</span><a href="#${t.id}-figure">圖解</a><a href="#${t.id}-deep">深入理解</a><a href="#${t.id}-challenge">口述挑戰</a><a href="#${t.id}-resources">延伸資源</a></nav>`;}
function enrichmentFigure(t,c){const f=c.figure,src='assets/figures/'+t.id+'.svg';return `<figure class="enrichment-figure" id="${t.id}-figure"><img class="enrichment-image" src="${esc(src)}" alt="${esc(f.alt)}" width="960" height="560" loading="lazy" decoding="async"><p class="enrichment-image-fallback" hidden>圖解暫時無法顯示，請先閱讀下方圖說與延伸資料。</p><figcaption><div class="enrichment-figure-heading"><strong>${esc(f.title)}</strong><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">放大圖解</a></div><p>${esc(f.caption)}</p><p class="small">概念示意圖，非實際臨床影像。</p>${enrichmentSourceLinks(f,c)}</figcaption></figure>`;}
function enrichmentDeepDive(b,c){return `<details class="enrichment-detail"><summary>${esc(b.heading)}</summary><div>${b.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}${enrichmentSourceLinks(b,c)}</div></details>`;}
function enrichmentChallenge(t,c){return `<section class="enrichment-challenge" id="${t.id}-challenge"><h3>口述挑戰</h3><p>${esc(c.oralChallenge.question)}</p><details class="enrichment-detail"><summary>回答後，查看重點</summary><div><p class="preline">${esc(c.oralChallenge.answer)}</p>${enrichmentSourceLinks(c.oralChallenge,c)}</div></details></section>`;}
function enrichmentResources(t,c){return `<section class="enrichment-resources" id="${t.id}-resources" aria-label="延伸學習資源"><h3>本章資源索引</h3><p class="small">依提示找出重點，再回到單元用自己的話解釋。最近查核 ${esc(D.enrichment.reviewedDate||'2026-10-11')}。</p>${['圖譜','影片','期刊','指南'].map(kind=>{const resources=c.resources.filter(r=>r.kind===kind);return resources.length?`<details class="enrichment-resource-group"><summary>${kind} <span class="small">${resources.length} 項</span></summary>${enrichmentResourceItems(resources)}</details>`:'';}).join('')}</section>`;}
function renderEnrichment(t){const c=chapterEnrichment(t);if(!c)return '';return `<section class="enrichment-block" aria-label="本章練習與資源">${c.integrated?'':`${enrichmentFigure(t,c)}<section class="enrichment-deep" id="${t.id}-deep" aria-label="深入理解"><h3>深入理解</h3>${c.deepDive.map(b=>enrichmentDeepDive(b,c)).join('')}</section>`}${enrichmentChallenge(t,c)}${enrichmentResources(t,c)}</section>`;}
function renderLessonSection(t,b,i,compact=false){const key=t.id+':'+i,shown=S.revealed.has(key),title=`<span class="step-number">${i+1}</span>${esc(b.title)}`,ref=b.ref?`<p class="small source-location">${esc(t.source)} · 頁 ${esc(b.ref)}</p>`:'';if(compact&&!S.recall)return `<details class="integrated-reference" id="${t.id}-section-${i}"><summary>${title}</summary><div>${ref}${medicalReviewNote(b.medicalReview)}${list(b.points)}</div></details>`;return `<section class="lesson-block" id="${t.id}-section-${i}"><h3>${title}</h3>${ref}${b.medicalReview&&!S.recall?medicalReviewNote(b.medicalReview):''}${S.recall?`<div class="recall-box"><p>${esc(b.recall||'先不看筆記：請說出「'+b.title+'」的核心重點，以及要留意的例外。')}</p><button class="btn small" data-action="reveal" data-value="${key}" aria-expanded="${shown}">${shown?'再次遮住':'查看重點'}</button>${shown?`<div class="recall-answer">${list(b.points)}${medicalReviewNote(b.medicalReview)}</div><div class="actions"><span class="small">剛才的回想：</span>${[[true,'說得出來'],[false,'還要再練']].map(([val,label])=>`<button class="chip" data-action="recall-rating" data-value="${key}|${val}" aria-pressed="${meta['recall:'+key]?.mastered===val}">${label}</button>`).join('')}</div>`:''}</div>`:list(b.points)}</section>`;}
function integratedDecisionRows(unit){
  let content;
  if(S.recall){
    content=unit.decisions.map(d=>`<details class="integrated-decision-recall"><summary>${esc(d.finding)}<span class="small">先說出解讀與下一步，再展開</span></summary><div><p><strong>怎麼解讀</strong>${esc(d.interpretation)}</p><p><strong>下一步</strong>${esc(d.nextStep)}</p></div></details>`).join('');
  }else{
    const rows=unit.decisions.map(d=>`<div class="integrated-decision-row" role="row"><p role="cell"><span>看到什麼</span>${esc(d.finding)}</p><p role="cell"><span>怎麼解讀</span>${esc(d.interpretation)}</p><p role="cell"><span>下一步</span>${esc(d.nextStep)}</p></div>`).join('');
    content=`<div role="table" aria-label="臨床線索與下一步"><div class="integrated-decision-head" role="row"><span role="columnheader">看到什麼</span><span role="columnheader">怎麼解讀</span><span role="columnheader">下一步</span></div>${rows}</div>`;
  }
  return `<section class="integrated-decisions" aria-label="從發現到下一步"><h4>把線索轉成判斷</h4>${content}</section>`;
}
function integratedCaseStep(step,n,c){
  return `<li><details class="integrated-case-step" ${n===0?'open':''}>
    <summary>階段 ${n+1}</summary><div><p>${esc(step.newInfo)}</p><p class="integrated-case-prompt">${esc(step.prompt)}</p>
      <details class="enrichment-detail integrated-case-answer"><summary>回答後，查看推理</summary><div>
        <p><strong>參考回答</strong></p><p class="preline">${esc(step.answer)}</p>
        <p><strong>推理依據</strong></p><p>${esc(step.rationale)}</p>${enrichmentSourceLinks(step,c)}
      </div></details>
    </div></details></li>`;
}
function integratedCase(t,c){
  const problem=c.integrated.case;
  return `<section class="integrated-case" id="${t.id}-case" aria-labelledby="${t.id}-case-title">
    <h3 id="${t.id}-case-title">整合病例 · ${esc(problem.title)}</h3>
    <p class="integrated-case-stem">${esc(problem.stem)}</p>
    <p class="small">每一階段先說出判斷與理由，再展開參考回答；完成後再看下一階段。</p>
    <ol class="integrated-case-steps">${problem.steps.map((step,n)=>integratedCaseStep(step,n,c)).join('')}</ol>
  </section>`;
}
function integratedConnections(t,c){return `<section class="integrated-connections" id="${t.id}-connections"><h3>跨章串連</h3><ul>${c.integrated.connections.map(link=>`<li>${btn(shortTitle(link.topicId),'learn-topic',link.topicId,'small')}<p>${esc(link.reason)}</p></li>`).join('')}</ul></section>`;}
function integratedSynthesis(t,c,unit){
  const paragraphs=unit.synthesis.map(p=>`<p>${esc(p)}</p>`).join('');
  const figure=unit.showFigure?enrichmentFigure(t,c):'';
  if(S.recall)return `<details class="enrichment-detail integrated-synthesis-recall"><summary>回想後，查看概念串連${unit.showFigure?'與圖解':''}</summary><div>${paragraphs}${figure}</div></details>`;
  return `<div class="integrated-synthesis">${paragraphs}</div>${figure}`;
}
function integratedUnit(t,c,unit,n){
  const sections=unit.sectionIndexes.map(i=>renderLessonSection(t,t.sections[i],i,true)).join('');
  const depth=unit.deepDiveIndexes.map(i=>enrichmentDeepDive(c.deepDive[i],c)).join('');
  return `<section class="integrated-unit" id="${t.id}-${unit.id}" aria-labelledby="${t.id}-${unit.id}-title">
    <div class="integrated-unit-heading"><span>學習單元 ${n+1} / ${c.integrated.units.length}</span><h3 id="${t.id}-${unit.id}-title">${esc(unit.title)}</h3></div>
    ${integratedSynthesis(t,c,unit)}
    <div class="integrated-reference-group"><h4>${S.recall?'逐點回想':'回到檢查與知識細節'}</h4>${sections}</div>
    ${depth?`<section class="integrated-depth" aria-label="機轉與例外"><h4>往下追問：機轉與例外</h4>${depth}</section>`:''}
    ${coverageUnit(t,c,unit)}${integratedDecisionRows(unit)}${enrichmentContextSources(unit,c)}
  </section>`;
}
function renderLessonContent(t){
  const c=chapterEnrichment(t);
  if(!c?.integrated)return t.sections.map((b,i)=>renderLessonSection(t,b,i)).join('');
  const course=c.integrated;
  const intro=`<section class="integrated-intro" aria-label="本章學習目標"><p class="integrated-framing">${esc(course.framing)}</p><h3>讀完這章，要能回答</h3><ul>${course.objectives.map(objective=>`<li>${esc(objective)}</li>`).join('')}</ul></section>`;
  return intro+coverageOutline(t)+course.units.map((unit,n)=>integratedUnit(t,c,unit,n)).join('')+integratedCase(t,c)+integratedConnections(t,c);
}
function enrichmentIndex(){
  const out=[];
  for(const t of D.topics){
    const c=chapterEnrichment(t);
    if(!c)continue;
    const common={topicId:t.id,chapter:t.chapter,action:'learn-topic',target:t.id};
    for(const entry of chapterCoverage(t)?.entries||[])out.push({...common,type:'共筆主題詳解',title:entry.title,body:[...entry.terms,...entry.keyPoints,entry.clinicalLink,entry.pitfall,entry.recall.question,entry.recall.answer].join(' '),ref:coveragePageLabel(entry.pages),action:'coverage-focus',target:t.id+'|coverage-'+entry.id});
    out.push({...common,type:'圖解',title:c.figure.title,body:c.figure.caption+' '+c.figure.alt});
    for(const b of c.deepDive)out.push({...common,type:'深入理解',title:b.heading,body:b.paragraphs.join(' ')});
    out.push({...common,type:'口述挑戰',title:c.oralChallenge.question,body:c.oralChallenge.answer});
    for(const r of c.resources)out.push({...common,type:'延伸資源',title:r.title,body:r.provider+' '+r.kind+' '+r.note});
    if(c.integrated){
      const integrated=c.integrated;
      out.push({...common,type:'學習目標',title:t.title,body:integrated.framing+' '+integrated.objectives.join(' ')});
      for(const u of integrated.units)out.push({...common,type:'整合單元',title:u.title,body:[...u.synthesis,...u.decisions.flatMap(d=>[d.finding,d.interpretation,d.nextStep])].join(' ')});
      for(const step of integrated.case.steps)out.push({...common,type:'整合病例',title:integrated.case.title+' · '+step.prompt,body:[integrated.case.stem,step.newInfo,step.answer,step.rationale].join(' ')});
      for(const link of integrated.connections)out.push({...common,type:'跨章串連',title:t.title+' / '+shortTitle(link.topicId),body:link.reason});
    }
  }
  for(const path of D.enrichment?.learningPaths||[]){
    const target=path.topicIds[0],topic=D.topics.find(t=>t.id===target);
    out.push({topicId:target,chapter:topic?.chapter||0,action:'learn-topic',target,type:'學習路徑',title:path.title,body:path.question+' '+path.topicIds.map(shortTitle).join(' ')});
  }
  return out;
}
function enrichmentLearningPaths(){const paths=D.enrichment?.learningPaths||[];return paths.length?`<section class="integrated-paths" aria-labelledby="paths-title"><div class="section-heading"><h2 id="paths-title">從症狀出發</h2><span class="small">每條路線串連數章：症狀 → 檢查 → 機轉 → 處置</span></div><div class="path-grid">${paths.map(path=>`<article class="path-card"><span class="path-count">${path.topicIds.length} 章</span><h3>${esc(path.title)}</h3><p>${esc(path.question)}</p><div class="path-steps">${path.topicIds.map((id,n)=>btn((n+1)+'. '+shortTitle(id),'learn-topic',id,'small')).join('')}</div></article>`).join('')}</div></section>`:'';}
function enrichmentOverview(){
  const chapters=D.topics.filter(t=>chapterEnrichment(t));
  if(!chapters.length)return '';
  const sections=chapters.reduce((n,t)=>n+chapterEnrichment(t).deepDive.length,0);
  const resources=chapters.reduce((n,t)=>n+chapterEnrichment(t).resources.length,0);
  const integrated=chapters.filter(t=>chapterEnrichment(t).integrated);
  const units=integrated.reduce((n,t)=>n+chapterEnrichment(t).integrated.units.length,0);
  const description=integrated.length?`${units} 個整合單元、${integrated.length} 個分階段病例，搭配 ${chapters.length} 張概念圖、${sections} 組深入解析及 ${resources} 筆延伸資源。每章先理解機轉，再用病例練判斷。`:`${chapters.length} 張概念圖、${sections} 組深入理解與 ${resources} 筆延伸資源，已加入各章。可直接搜尋概念、圖解或資源名稱。`;
  return `<section class="enrichment-overview" aria-label="整合學習"><div><strong>${integrated.length?'把知識、圖解與臨床判斷串起來':'圖解與延伸學習'}</strong><p>${description}</p></div>${btn('開始第一章','learn-topic',chapters[0].id,'small')}</section>${enrichmentLearningPaths()}${coverageOverview()}`;
}
window.addEventListener('hashchange',coverageRestoreHash);
window.addEventListener('load',coverageRestoreHash);
document.addEventListener('error',e=>{const image=e.target;if(!image?.classList?.contains('enrichment-image'))return;image.hidden=true;const fallback=image.closest('figure')?.querySelector('.enrichment-image-fallback');if(fallback)fallback.hidden=false;},true);
function interviewSamples(i){const s=D.interviewSamples,list=s?.answers?.[i.id];if(!list)return '';return `<section class="interview-samples" aria-label="三位示範者的回答"><div class="preview-heading"><span class="tag">示範回答</span><span class="small">3 位虛構示範者</span></div><h3>聽聽三個人怎麼回答</h3><p class="small">${esc(i.clinical?s.clinicalNote:s.note)}</p>${list.map((text,n)=>{const v=s.versions[n];return `<details class="interview-sample"><summary>${esc(v.label)}<span class="small">${esc(i.clinical?v.clinicalHint:v.hint)}</span></summary><div><p class="preline">${esc(text)}</p><div class="actions">${btn('帶入此版本改寫','use-sample',String(n),'small')}</div></div></details>`;}).join('')}</section>`;}
/* enrichment-ui:end */
'''


CSS = r'''
/* enrichment-styles:start */
.enrichment-nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 0;margin:20px 0;font-size:14px;line-height:1.7}.enrichment-nav>span{color:var(--muted);font-size:12px;margin-right:2px}.enrichment-nav>a{padding:4px 0;color:var(--blue);text-decoration-thickness:1px}.enrichment-block{padding:30px 0;border-top:2px solid #adcdd1;max-width:76ch;margin:24px auto 0}.enrichment-section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:21px}.enrichment-section-heading h3{font-size:1.13rem}.enrichment-section-heading .small{font-size:12px;color:var(--muted)}.enrichment-figure{margin:0 0 28px;scroll-margin-top:90px}.enrichment-image{display:block;width:100%;height:auto;max-height:700px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:5px}.enrichment-figure figcaption{padding:16px 0 0;font-size:14px;line-height:1.9;color:var(--ink)}.enrichment-figure figcaption p{margin-top:9px}.enrichment-figure-heading{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap}.enrichment-figure-heading strong{font-size:16px;font-weight:600}.enrichment-figure-heading>a{font-size:14px;padding:5px 0}.enrichment-image-fallback{padding:22px;border:1px solid var(--line);background:#f5f9fa;border-radius:5px;font-size:15px;line-height:1.85;color:var(--muted)}.enrichment-citations{display:flex;gap:5px 13px;align-items:baseline;flex-wrap:wrap;margin-top:14px;font-size:12px;line-height:1.8;color:var(--muted)}.enrichment-citations>span{flex-shrink:0}.enrichment-citations a{color:#426b78;text-decoration-thickness:1px;overflow-wrap:anywhere}.enrichment-deep,.enrichment-challenge,.enrichment-resources{padding:25px 0;border-top:1px solid var(--line);scroll-margin-top:90px}.enrichment-deep>h3,.enrichment-challenge>h3,.enrichment-resources>h3{font-size:1.05rem;margin-bottom:15px;color:var(--navy)}.enrichment-detail{border-bottom:1px solid var(--line)}.enrichment-detail>summary{padding:17px 4px;font-size:16px;font-weight:600;line-height:1.8;color:#245968}.enrichment-detail>div{padding:0 4px 21px;font-size:16px;line-height:1.95}.enrichment-detail>div>p+p{margin-top:14px}.enrichment-challenge>p{font-size:16px;line-height:1.95;margin:0 0 15px}.enrichment-challenge .enrichment-detail{border:1px solid var(--line);border-radius:5px;padding:0 16px;background:#f8fbfb}.enrichment-challenge .enrichment-detail>summary{font-size:14px}.enrichment-resource-group{margin-top:23px}.enrichment-resource-group h4{font-size:14px;font-weight:600;line-height:1.8;color:var(--muted);margin:0 0 9px}.enrichment-resource-group ul{list-style:none;padding:0;margin:0}.enrichment-resource-group li{padding:16px 0;border-top:1px solid #e3ecef;margin:0}.enrichment-resource-group li>a{font-size:16px;font-weight:600;line-height:1.8}.enrichment-provider{display:block;font-size:12px;color:var(--muted);margin-top:4px}.enrichment-resource-group li>p{margin:8px 0 0;font-size:15px;line-height:1.9;color:var(--ink)}.enrichment-overview{display:flex;align-items:center;justify-content:space-between;gap:22px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:19px 2px;margin:0 0 28px}.enrichment-overview strong{font-size:16px;font-weight:600;color:var(--navy)}.enrichment-overview p{font-size:14px;color:var(--muted);line-height:1.9;margin-top:6px;max-width:75ch}.enrichment-overview>.btn{flex-shrink:0}.enrichment-nav a:focus-visible,.enrichment-detail summary:focus-visible,.enrichment-figure-heading a:focus-visible{outline:3px solid #258b99;outline-offset:3px}
@media(max-width:760px){.enrichment-nav{gap:8px 17px;margin:19px 0;padding:10px 0}.enrichment-nav>a{min-height:44px;display:inline-flex;align-items:center;font-size:14px}.enrichment-nav>span{flex-basis:100%;font-size:12px}.enrichment-block{padding-top:25px}.enrichment-section-heading{gap:8px;margin-bottom:18px}.enrichment-section-heading h3{font-size:18px}.enrichment-image{max-height:none}.enrichment-figure,.enrichment-deep,.enrichment-challenge,.enrichment-resources{scroll-margin-top:145px}.enrichment-figure-heading>a{min-height:44px;display:inline-flex;align-items:center}.enrichment-figure figcaption{font-size:14px;line-height:1.9}.enrichment-figure-heading strong{font-size:16px}.enrichment-detail>summary{font-size:16px;padding:17px 0;min-height:52px}.enrichment-detail>div{font-size:16px;line-height:1.95;padding-left:0;padding-right:0}.enrichment-challenge>p{font-size:16px}.enrichment-citations{font-size:12px;line-height:1.85;gap:7px 12px}.enrichment-challenge .enrichment-detail{padding-left:14px;padding-right:14px}.enrichment-resource-group li>a{font-size:16px;line-height:1.9}.enrichment-resource-group li>p{font-size:16px;line-height:1.95}.enrichment-provider{font-size:12px}.enrichment-overview{display:block;padding:20px 1px;margin-bottom:23px}.enrichment-overview p{font-size:14px}.enrichment-overview>.btn{margin-top:15px;min-height:44px;font-size:14px}}

.integrated-intro{max-width:76ch;margin:25px auto 15px;padding:0 0 25px;border-bottom:1px solid var(--line)}
.integrated-framing{font-size:17px;line-height:1.95;color:var(--navy);margin:0 0 22px}
.integrated-intro h3{font-size:15px;color:var(--muted);margin-bottom:10px}
.integrated-intro ul{padding-left:22px;margin:0;line-height:1.9;font-size:16px}
.integrated-intro li+li{margin-top:7px}
.integrated-unit,.integrated-case,.integrated-connections{max-width:76ch;margin:0 auto;padding:30px 0;border-bottom:1px solid var(--line);scroll-margin-top:90px}
.integrated-unit-heading{margin-bottom:20px}
.integrated-unit-heading>span{display:block;font-size:12px;color:var(--muted);margin-bottom:8px}
.integrated-unit-heading h3{font-size:22px;line-height:1.6;color:var(--navy);margin:0}
.integrated-synthesis{font-size:17px;line-height:1.95;margin-bottom:24px}
.integrated-synthesis p+p{margin-top:16px}
.integrated-unit .enrichment-figure{margin:26px 0}
.integrated-reference-group,.integrated-depth,.integrated-decisions{margin-top:27px}
.integrated-unit h4{font-size:14px;color:var(--muted);font-weight:600;margin:0 0 12px;line-height:1.8}
.integrated-reference{border-top:1px solid var(--line);scroll-margin-top:90px}
.integrated-reference>summary{display:flex;align-items:baseline;gap:10px;position:relative;padding:15px 25px 15px 0;font-size:16px;font-weight:600;line-height:1.85;color:var(--navy);list-style:none}
.integrated-reference>summary::-webkit-details-marker{display:none}
.integrated-reference>summary:after{content:'＋';position:absolute;right:1px;top:16px;font-size:16px;font-weight:400;color:var(--muted)}
.integrated-reference[open]>summary:after{content:'−'}
.integrated-reference .step-number{flex-shrink:0;margin:0;width:24px;height:24px;font-size:12px;line-height:24px;display:inline-flex;align-items:center;justify-content:center}
.integrated-reference>div{font-size:16px;line-height:1.95;padding:0 0 18px 34px}
.integrated-reference .source-location{font-size:12px;margin:0 0 8px}
.integrated-reference-group>.lesson-block{padding:18px 0}
.integrated-depth .enrichment-detail>summary{font-size:16px}
.integrated-depth .enrichment-detail>div{font-size:16px}
.integrated-synthesis-recall{margin:0 0 24px}
.integrated-synthesis-recall .enrichment-figure{margin-bottom:0}
.integrated-decision-head,.integrated-decision-row{display:grid;grid-template-columns:1fr 1.3fr 1.3fr;gap:16px}
.integrated-decision-head{font-size:12px;color:var(--muted);padding:0 0 9px}
.integrated-decision-row{padding:15px 0;border-top:1px solid var(--line);font-size:15px;line-height:1.9}
.integrated-decision-row>p{margin:0;overflow-wrap:anywhere}
.integrated-decision-row>p>span{display:none}
.integrated-decision-recall{border-top:1px solid var(--line)}
.integrated-decision-recall>summary{font-size:16px;line-height:1.9;padding:14px 0;color:var(--navy)}
.integrated-decision-recall>summary>.small{display:block;padding-left:17px;font-size:12px;color:var(--muted);font-weight:400}
.integrated-decision-recall>div{padding:0 0 17px;font-size:16px;line-height:1.95}
.integrated-decision-recall p+p{margin-top:13px}
.integrated-decision-recall strong{display:block;font-size:13px;color:var(--muted)}
.enrichment-context-sources{margin-top:20px;border-top:1px solid var(--line);font-size:14px}
.enrichment-context-sources>summary{padding:14px 0;line-height:1.8;color:#426b78}
.enrichment-context-sources>.enrichment-resource-group{margin-top:0}
.enrichment-context-sources .enrichment-resource-group li>a{font-size:15px}
.enrichment-context-sources .enrichment-resource-group li>p{font-size:14px}
.integrated-case>h3,.integrated-connections>h3{font-size:21px;color:var(--navy);line-height:1.6;margin:0 0 18px}
.integrated-case-stem{font-size:17px;line-height:1.95;margin:0 0 14px}
.integrated-case>.small{font-size:13px;color:var(--muted);line-height:1.9}
.integrated-case-steps{list-style:none;margin:20px 0 0;padding:0;border-top:1px solid var(--line)}
.integrated-case-steps>li{margin:0;padding:0;border-bottom:1px solid var(--line)}
.integrated-case-step>summary{font-size:16px;line-height:1.8;color:#245968;padding:17px 0;font-weight:600}
.integrated-case-step>div{font-size:16px;line-height:1.95;padding-bottom:20px}
.integrated-case-prompt{font-weight:600;margin-top:16px;color:var(--navy)}
.integrated-case-answer{margin-top:15px;border:1px solid var(--line);padding:0 16px;border-radius:5px;background:#f8fbfb}
.integrated-case-answer>summary{font-size:14px}
.integrated-case-answer>div>p+p{margin-top:10px}
.integrated-connections ul{list-style:none;padding:0;margin:0}
.integrated-connections li{padding:16px 0;border-top:1px solid var(--line)}
.integrated-connections li>p{font-size:15px;line-height:1.9;margin-top:10px}
.integrated-paths{margin:8px 0 30px}
.integrated-paths .section-heading{margin-bottom:10px}
.integrated-path{border-bottom:1px solid var(--line)}
.integrated-path>summary{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:16px 26px 16px 0;position:relative;font-size:16px;font-weight:600;color:var(--navy);line-height:1.8;list-style:none}
.integrated-path>summary::-webkit-details-marker{display:none}
.integrated-path>summary:after{content:'＋';position:absolute;right:0;color:var(--muted);font-weight:400}
.integrated-path[open]>summary:after{content:'−'}
.integrated-path>summary>.small{color:var(--muted);font-size:12px;font-weight:400;white-space:nowrap}
.integrated-path>div{padding:0 0 18px;font-size:15px;line-height:1.9}
.integrated-path .actions{margin-top:13px;gap:8px}
.enrichment-resource-group>summary{font-size:15px;line-height:1.8;font-weight:600;color:#245968;padding:12px 0}
.enrichment-resource-group>summary>.small{font-weight:400;color:var(--muted);margin-left:10px}
.integrated-reference>summary:focus-visible,.integrated-path>summary:focus-visible,.integrated-case-step>summary:focus-visible,.integrated-decision-recall>summary:focus-visible,.enrichment-context-sources>summary:focus-visible,.enrichment-resource-group>summary:focus-visible{outline:3px solid #258b99;outline-offset:3px}
@media(max-width:760px){
.integrated-unit,.integrated-case,.integrated-connections,.integrated-reference{scroll-margin-top:145px}
.integrated-intro{margin-top:22px;padding-bottom:20px}
.integrated-unit,.integrated-case,.integrated-connections{padding:25px 0}
.integrated-unit-heading h3{font-size:20px}
.integrated-framing,.integrated-synthesis,.integrated-case-stem{font-size:16px;line-height:1.95}
.integrated-reference>summary{min-height:50px;font-size:16px;gap:9px}
.integrated-reference>div{padding-left:0}
.integrated-decision-head{display:none}
.integrated-decision-row{display:block;padding:16px 0;font-size:16px}
.integrated-decision-row>p+p{margin-top:15px}
.integrated-decision-row>p>span{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}
.integrated-decision-row>p:first-child{font-weight:600;color:var(--navy)}
.integrated-decision-row>p:first-child>span{font-weight:400}
.integrated-case>h3,.integrated-connections>h3{font-size:19px}
.integrated-case-answer{padding-left:12px;padding-right:12px}
.integrated-case-step>summary,.integrated-decision-recall>summary,.enrichment-context-sources>summary,.integrated-path>summary,.enrichment-resource-group>summary{min-height:48px}
.enrichment-context-sources .enrichment-resource-group li>a,.enrichment-context-sources .enrichment-resource-group li>p,.integrated-connections li>p{font-size:16px}
.integrated-paths .section-heading{display:block}
.integrated-paths .section-heading>.small{display:block;margin-top:6px}
.integrated-path .actions>.btn{min-height:44px;text-align:left;white-space:normal}
}
.coverage-overview{margin:30px 0 34px;padding:25px 0;border-top:2px solid #adcdd1;border-bottom:1px solid var(--line)}
.coverage-overview-heading h2{font-size:20px;line-height:1.6;color:var(--navy);margin:0 0 8px}
.coverage-overview-heading>p{font-size:14px;color:#426b78;line-height:1.8}
.coverage-scope{font-size:14px;line-height:1.9;color:var(--muted);margin:12px 0 18px;max-width:76ch}
.coverage-outline{max-width:76ch;margin:0 auto 14px;border-bottom:1px solid var(--line);scroll-margin-top:90px}
.coverage-outline>summary,.coverage-all>summary{padding:18px 0;font-size:16px;color:var(--navy);font-weight:600;line-height:1.8}
.coverage-outline>summary>span+span{font-size:12px;color:var(--muted);font-weight:400;margin-left:15px;display:inline-block}
.coverage-outline>div{padding:0 0 20px}
.coverage-outline-unit{margin:23px 0 18px}
.coverage-outline-unit h4{font-size:14px;line-height:1.8;margin-bottom:9px;color:#426b78}
.coverage-outline-unit ul{list-style:none;margin:0;padding:0}
.coverage-outline-unit li{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #e3ecef;font-size:15px;line-height:1.8}
.coverage-outline-unit li>a{flex:1;min-width:0;overflow-wrap:anywhere}
.coverage-outline-unit li>span{flex-shrink:0;font-size:12px;color:var(--muted);text-align:right;max-width:30%;overflow-wrap:anywhere}
.coverage-limitations{margin:20px 0;padding:16px;border-left:3px solid #b6a06c;background:#faf8f1;font-size:14px;line-height:1.9}.coverage-limitations h4{font-size:14px;color:var(--navy);margin:0 0 12px}.coverage-limitations>div+div{margin-top:16px}.coverage-limitations strong{display:block;color:var(--navy);font-size:12px;margin-bottom:4px}.coverage-limitations p+p{margin-top:8px}
.coverage-audit{margin-top:24px;border-top:1px solid var(--line)}
.coverage-audit>summary{font-size:14px;color:#426b78;line-height:1.8;padding:14px 0}
.coverage-audit ul{list-style:none;margin:0;padding:0}
.coverage-audit li{padding:12px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:1.9}
.coverage-audit li>span{color:var(--navy);font-weight:600}
.coverage-audit li>p{margin-top:4px;color:var(--muted)}
.coverage-all-chapter{border-top:1px solid var(--line)}
.coverage-all-chapter>summary{padding:17px 0;font-size:16px;line-height:1.8;color:var(--navy);font-weight:600}
.coverage-all-chapter>summary>span+span{display:block;padding-left:18px;font-weight:400;color:var(--muted);font-size:12px}
.coverage-all-chapter>div{max-width:76ch;padding:0 0 18px 18px}
.coverage-unit{margin-top:28px;padding-top:22px;border-top:2px solid #adcdd1}
.coverage-unit-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px}
.coverage-unit-heading h4{font-size:16px;color:var(--navy);margin-bottom:7px}
.coverage-unit-heading>span{flex-shrink:0;color:var(--muted);font-size:12px}
.coverage-unit>.small{line-height:1.9;margin:0 0 13px;color:var(--muted)}
.coverage-entry{border-top:1px solid var(--line);scroll-margin-top:90px}
.coverage-entry>summary{position:relative;padding:17px 25px 17px 0;list-style:none;color:#245968;font-size:16px;line-height:1.85;font-weight:600}
.coverage-entry>summary::-webkit-details-marker{display:none}
.coverage-entry>summary:after{content:'＋';position:absolute;right:1px;top:17px;font-size:16px;font-weight:400;color:var(--muted)}
.coverage-entry[open]>summary:after{content:'−'}
.coverage-pages{display:block;font-size:12px;line-height:1.8;color:var(--muted);font-weight:400;margin-top:3px}
.coverage-entry-body{font-size:16px;line-height:1.95;padding:0 0 23px}
.coverage-entry-body>p+p{margin-top:15px}
.coverage-entry-body>.coverage-source{font-size:12px;color:var(--muted);margin:0}
.coverage-entry-body>.coverage-terms{font-size:13px;color:#426b78;margin:4px 0 20px;overflow-wrap:anywhere}
.coverage-clinical{margin:20px 0;padding-left:16px;border-left:3px solid #adcdd1}
.coverage-clinical strong,.coverage-question>strong{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
.coverage-clinical p+p{margin-top:15px}
.coverage-entry-body>.coverage-question{color:var(--navy);margin-top:22px}
.coverage-answer{border:1px solid var(--line);border-radius:5px;margin-top:13px;padding:0 15px;background:#f8fbfb}
.coverage-answer>summary{font-size:14px;color:#245968;padding:14px 0;line-height:1.8;font-weight:600}
.coverage-answer>div{padding:0 0 17px;line-height:1.95}
.coverage-answer>div>p+p{margin-top:15px}
.coverage-recall-answer{white-space:pre-line}
.coverage-backlinks{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:20px;font-size:13px;line-height:1.8}
.coverage-related{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:17px}
.coverage-related>span{font-size:12px;color:var(--muted);margin-right:4px}
.coverage-entry>summary:focus-visible,.coverage-answer>summary:focus-visible,.coverage-outline>summary:focus-visible,.coverage-all>summary:focus-visible,.coverage-all-chapter>summary:focus-visible,.coverage-audit>summary:focus-visible,[data-action="coverage-focus"]:focus-visible{outline:3px solid #258b99;outline-offset:3px}
@media(max-width:760px){
.coverage-entry,.coverage-outline{scroll-margin-top:145px}
.coverage-overview-heading h2{font-size:19px}
.coverage-overview{margin:24px 0;padding:21px 0}
.coverage-outline>summary>span+span{display:block;margin-left:18px}
.coverage-outline-unit li{display:block;padding:11px 0;font-size:16px}
.coverage-outline-unit li>span{display:block;text-align:left;max-width:100%;margin-top:3px}
.coverage-all-chapter>div{padding-left:0}
.coverage-unit-heading{display:block}
.coverage-unit-heading>span{display:block;margin-bottom:9px}
.coverage-entry>summary{min-height:60px}
.coverage-entry-body{font-size:16px}
.coverage-answer{padding-left:12px;padding-right:12px}
.coverage-answer>summary,.coverage-all>summary,.coverage-all-chapter>summary,.coverage-audit>summary{min-height:48px}
.coverage-backlinks>a{display:flex;align-items:center;min-height:44px;font-size:14px}
.coverage-related>.btn{min-height:44px;white-space:normal;text-align:left}
}
.interview-samples{margin-top:18px;padding:21px;border:1px solid var(--line);border-radius:10px;background:#f8fbfb}.interview-samples>h3{margin:10px 0 6px}.interview-samples>p.small{color:var(--muted);line-height:1.8}.interview-sample{border-bottom:1px solid var(--line)}.interview-sample:last-child{border-bottom:0}.interview-sample>summary{padding:14px 2px;font-weight:600;line-height:1.7;color:#245968;min-height:48px}.interview-sample>summary>.small{display:block;font-weight:400;color:var(--muted);font-size:13px}.interview-sample>div{padding:0 2px 16px;font-size:16px;line-height:1.95}.interview-sample>summary:focus-visible{outline:3px solid #258b99;outline-offset:3px}
@media(max-width:760px){.interview-samples{padding:16px}}
/* enrichment-styles:end */
'''


def validate_kaogu(questions, base, data):
    topics = {t['id'] for t in data['topics']}
    seen = {q['id'] for q in base}
    for q in questions:
        label = 'past-exam question ' + str(q.get('id'))
        if not re.fullmatch(r'notes-\d\d-k\d\d', str(q.get('id'))) or q['id'] in seen:
            raise ValueError(label + ': malformed or duplicate id')
        seen.add(q['id'])
        if q.get('topicId') not in topics or q.get('pastExam') is not True:
            raise ValueError(label + ': unknown topic or missing pastExam flag')
        for key in ('stem', 'explanation', 'sourceType', 'sourceId', 'source', 'sourceRef'):
            require_text(q.get(key), label + ' ' + key)
        options = q.get('options')
        if not isinstance(options, list) or len(options) != 4 or len(set(options)) != 4:
            raise ValueError(label + ': exactly four distinct options required')
        for option in options:
            require_text(option, label + ' option')
        if type(q.get('correctIndex')) is not int or not 0 <= q['correctIndex'] < 4:
            raise ValueError(label + ': correctIndex must be 0-3')


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
    if KAOGU.is_file():
        # Re-merged on every build so a re-imported base index.html gets the past-exam set back.
        kaogu = json.loads(KAOGU.read_text(encoding='utf-8'))
        base = [q for q in data['questions'] if not q.get('pastExam')]
        validate_kaogu(kaogu, base, data)
        data['questions'] = base + kaogu
        data['notes']['questionDisclaimer'] = f'共 {len(base) + len(kaogu)} 題單選練習：{len(base)} 題自編、{len(kaogu)} 題依共筆考古題考點改寫，皆非歷屆試題原文。'
    elif any(q.get('pastExam') for q in data['questions']):
        raise ValueError('The app has past-exam questions but content/past-exam-questions.json is missing')
    preserved = json.loads(json.dumps({k:v for k,v in data.items() if k not in {'enrichment', 'coverage', 'interviewSamples'}}))
    enrichment = json.loads(CONTENT.read_text(encoding='utf-8'))
    enrichment.setdefault('reviewedDate', '2026-10-11')
    validate(enrichment, data)
    data['enrichment'] = enrichment
    if COVERAGE.is_file():
        coverage = json.loads(COVERAGE.read_text(encoding='utf-8'))
        validate_coverage(coverage, enrichment, data)
        data['coverage'] = coverage
    elif 'coverage' in data:
        raise ValueError('The app has coverage data but content/source-coverage.json is missing')
    if SAMPLES.is_file():
        samples = json.loads(SAMPLES.read_text(encoding='utf-8'))
        validate_samples(samples, data)
        data['interviewSamples'] = samples
    elif 'interviewSamples' in data:
        raise ValueError('The app has interview samples but content/interview-samples.json is missing')
    data['notebook']['imageScope'] = '本版提供原創教學示意圖，非實際臨床影像；延伸資源連至來源網站的圖譜、影片或文獻。原始共筆 PDF 未公開。'
    preserved['notebook']['imageScope'] = data['notebook']['imageScope']
    js = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
    js = re.sub(re.escape(JS_START)+r'.*?'+re.escape(JS_END)+r'\n?', '', js, flags=re.S)

    # These markers are placed once; repeated runs only refresh data/functions.
    m = function_line(js, 'chapterExtras')
    old = m.group(0)
    new = old.replace('${renderEnrichment(t)}', '')
    if not new.endswith('`;}' ):
        raise ValueError('chapterExtras insertion point changed')
    new = new[:-3] + '${renderEnrichment(t)}`;}'
    js = js[:m.start()] + new + js[m.end():]
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
    m = function_line(js, 'learn')
    old = m.group(0)
    if '${renderLessonContent(t)}' not in old:
        section_start = old.find('${t.sections.map((b,i)=>')
        section_end = old.find('${chapterExtras(t)}', section_start)
        if section_start < 0 or section_end < 0:
            raise ValueError('learn section map insertion point changed')
        new = old[:section_start] + '${renderLessonContent(t)}' + old[section_end:]
        js = js[:m.start()] + new + js[m.end():]
    m = function_line(js, 'notebookIndex')
    old = m.group(0)
    if '...enrichmentIndex()' not in old:
        if not old.endswith('return out;}'):
            raise ValueError('notebookIndex insertion point changed')
        new=old[:-len('return out;}')]+'return [...out,...enrichmentIndex()];}'
        js=js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'notebook')
    old = m.group(0)
    if 'enrichmentOverview()' not in old:
        needle='${searching?`<section class="search-section">'
        if needle not in old:
            raise ValueError('notebook insertion point changed')
        new=old.replace(needle,'${enrichmentOverview()}'+needle,1)
        js=js[:m.start()]+new+js[m.end():]
    m = function_line(js, 'notebook')
    old = m.group(0)
    new = old.replace("x.type==='臨床口試'?'進入口試':'閱讀本章'", "x.type==='臨床口試'?'進入口試':x.type==='共筆主題詳解'?'閱讀這個主題':'閱讀本章'")
    new = new.replace('${enrichmentOverview()}', "${searching?'':enrichmentOverview()}")
    new = new.replace('${nSections}</strong> 個知識重點', '${nSections}</strong> 個基礎重點')
    meta = '${t.sections.length} 個重點<span>${qs.length} 題</span>'
    if '${chapterCoverage(t)?.entries.length' not in new:
        new = new.replace(meta, '${t.sections.length} 個基礎重點${chapterCoverage(t)?`<span>${chapterCoverage(t)?.entries.length} 個共筆詳解</span>`:\'\'}<span>${qs.length} 題</span>')
    js=js[:m.start()]+new+js[m.end():]
    if "case'coverage-focus':" not in js:
        needle = "case'learn-topic':"
        if needle not in js:
            raise ValueError('Chapter action insertion point changed')
        js = js.replace(needle, "case'coverage-focus':e.preventDefault?.();coverageFocus(v);break;\n"+needle, 1)
    m = function_line(js, 'personalInterviewTools')
    old = m.group(0)
    new = old.replace('</section>${interviewSamples(i)}`;}', '</section>`;}')
    js = js[:m.start()] + new + js[m.end():]
    if '${interviewSamples(i)}' not in js:
        needle = '${i.clinical?clinicalSource(i):personalInterviewTools(i)}'
        if js.count(needle) != 1:
            raise ValueError('Interview samples insertion point changed')
        js = js.replace(needle, needle+'${interviewSamples(i)}', 1)
    if "case'use-sample':" not in js:
        needle = "case'use-short':"
        if needle not in js:
            raise ValueError('Interview action insertion point changed')
        js = js.replace(needle, "case'use-sample':appendToInterview(S.interview,D.interviewSamples?.answers?.[S.interview]?.[+v]||'','示範回答：'+(D.interviewSamples?.versions?.[+v]?.label||''));break;\n"+needle, 1)
    if "mode==='kaogu'" not in js:
        for needle, extra in (
            ("(mode==='reserve'&&q.reserve)||", "(mode==='kaogu'&&q.pastExam)||"),
            ('''<option value="reserve" ${S.mode==='reserve'?'selected':''}>進階保留題</option>''', '''<option value="kaogu" ${S.mode==='kaogu'?'selected':''}>考古題考點</option>'''),
        ):
            if js.count(needle) != 1:
                raise ValueError('Quiz mode insertion point changed')
            js = js.replace(needle, needle + extra)
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
    if {k:v for k,v in after.items() if k not in {'enrichment', 'coverage', 'interviewSamples'}} != preserved:
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
    coverage_chapters = data.get('coverage', {}).get('chapters', {})
    print(json.dumps({'mode':'check' if args.check else 'write','index':str(INDEX),'bytes':len(encoded),'sha256':hashlib.sha256(encoded).hexdigest(),'chapters':len(chapters),'deep_dive_sections':sum(len(c['deepDive']) for c in chapters.values()),'integrated_units':sum(len(c.get('integrated',{}).get('units',[])) for c in chapters.values()),'integrated_cases':sum('integrated' in c for c in chapters.values()),'learning_paths':len(data['enrichment'].get('learningPaths',[])),'resources':sum(len(c['resources']) for c in chapters.values()),'coverage_topics':sum(len(c['entries']) for c in coverage_chapters.values()),'reviewed_pdf_pages':sum(c['pageCount'] for c in coverage_chapters.values()),'existing_content_preserved':True,'updated_metadata':['notebook.imageScope']},ensure_ascii=False))
