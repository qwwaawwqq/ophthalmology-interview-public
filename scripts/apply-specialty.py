#!/usr/bin/env python3
"""Validate and embed per-specialty content/<s>/ files into index.html course-data-<s> blocks.

Ophthalmology (id="course-data") is never modified; its payload hash is verified before and after every run.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / 'index.html'
DEFAULT_CONTENT_ROOT = ROOT / 'content'


def _load_enrichment_module():
    spec = importlib.util.spec_from_file_location('apply_enrichment', ROOT / 'scripts' / 'apply-enrichment.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_ENRICH = _load_enrichment_module()
SPECIALTIES = dict(_ENRICH.NON_OPH_SPECIALTIES)
SPECIALTY_ORDER = [sid for sid, _ in _ENRICH.NON_OPH_SPECIALTIES]

DEFAULT_WORKFLOW_CATEGORIES = [
    {'id': 'emergency', 'label': '急症處置'},
    {'id': 'same-day', 'label': '當日評估與轉介'},
    {'id': 'safety', 'label': '操作與用藥安全'},
    {'id': 'screening', 'label': '篩檢與跨科照會'},
]

DEFAULT_PBL_METHOD = [
    {'step': '整理事實', 'hint': '列出目前已確認的病史、檢查與時序'},
    {'step': '提出假說', 'hint': '依解剖、生理或機轉排定鑑別優先順序'},
    {'step': '辨識未知', 'hint': '指出改變處置最關鍵的待補資訊'},
    {'step': '決定行動', 'hint': '先穩定急症與安全界線，再安排確診與轉介'},
    {'step': '總結議題', 'hint': '連結基礎科學、臨床決策與溝通倫理'},
]

FILE_ALIASES = {
    'meta': ('meta.json',),
    'topics': ('topics.json',),
    'questions': ('questions.json',),
    'past_exam': ('past-exam-questions.json',),
    'interview': ('interview.json',),
    'samples': ('interviewSamples.json', 'interview-samples.json'),
    'detailed': ('interviewDetailed.json', 'interview-detailed.json'),
    'workflows': ('workflows.json', 'clinical-workflows.json'),
    'pbl': ('pbl.json', 'pbl-cases.json'),
    'enrichment': ('enrichment.json', 'study-enrichment.json'),
}
KNOWN_JSON_FILES = {name for names in FILE_ALIASES.values() for name in names}
RESOURCE_KINDS = {'圖譜', '影片', '期刊', '指南'}


def require_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label}: non-empty string required')
    return value.strip()


def require_str_list(value, label, low=1, high=None):
    if not isinstance(value, list) or len(value) < low or (high is not None and len(value) > high):
        bound = f'{low}-{high}' if high is not None else f'>={low}'
        raise ValueError(f'{label}: expected {bound} string items')
    out = []
    for i, item in enumerate(value):
        out.append(require_text(item, f'{label}[{i}]'))
    return out


def validate_source(value, label):
    if isinstance(value, str):
        s = value.strip()
        if not s:
            raise ValueError(f'{label}: non-empty source reference required')
        return s
    if isinstance(value, list) and value:
        out = []
        for i, item in enumerate(value):
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f'{label}[{i}]: non-empty source reference required')
            out.append(item.strip())
        return out
    raise ValueError(f'{label}: non-empty source reference required')


def validate_https_urls(urls, label):
    if urls is None:
        return []
    if not isinstance(urls, list):
        raise ValueError(f'{label}: expected list of https URLs')
    out = []
    for i, url in enumerate(urls):
        u = require_text(url, f'{label}[{i}]')
        if not re.match(r'^https://\S+$', u):
            raise ValueError(f'{label}[{i}]: must start with https://')
        out.append(u)
    return out


def validate_medical_review(review, label):
    if review is None:
        return None
    if not isinstance(review, dict):
        raise ValueError(f'{label}: must be null or object')
    reason = require_text(review.get('reason'), f'{label}.reason')
    sources_in = review.get('sources')
    if not isinstance(sources_in, list) or not sources_in:
        raise ValueError(f'{label}.sources: non-empty list required')
    sources = []
    for i, src in enumerate(sources_in):
        if not isinstance(src, dict):
            raise ValueError(f'{label}.sources[{i}]: object required')
        title = require_text(src.get('title'), f'{label}.sources[{i}].title')
        url = require_text(src.get('url'), f'{label}.sources[{i}].url')
        if not re.match(r'^https://\S+$', url):
            raise ValueError(f'{label}.sources[{i}].url: must start with https://')
        sources.append({'title': title, 'url': url})
    return {'reason': reason, 'sources': sources}


def resolve_files(sdir):
    if not sdir.exists():
        return {}
    if not sdir.is_dir():
        raise ValueError(f'{sdir}: expected directory')
    for p in sorted(sdir.glob('*.json')):
        if p.name.startswith('_'):
            continue
        if p.name not in KNOWN_JSON_FILES:
            raise ValueError(f'{sdir}: unknown JSON file {p.name} (expected one of {sorted(KNOWN_JSON_FILES)})')
    found = {}
    for key, names in FILE_ALIASES.items():
        existing = [sdir / name for name in names if (sdir / name).is_file()]
        if len(existing) > 1:
            raise ValueError(f'{sdir}: ambiguous files {[p.name for p in existing]} for {key}')
        if existing:
            try:
                found[key] = json.loads(existing[0].read_text(encoding='utf-8'))
            except json.JSONDecodeError as exc:
                raise ValueError(f'{existing[0]}: invalid JSON ({exc})') from exc
    return found


def apply_meta(shell, meta, sid):
    if not isinstance(meta, dict):
        raise ValueError(f'{sid} meta.json: object required')
    allowed = {'title', 'exam', 'plan', 'notes', 'dayBeforeChecklist', 'examDayChecklist', 'storySeeds', 'evidenceSeeds', 'notebook'}
    unknown = set(meta) - allowed
    if unknown:
        raise ValueError(f'{sid} meta.json: unknown keys {sorted(unknown)}')
    if 'title' in meta:
        shell['title'] = require_text(meta['title'], f'{sid} meta.title')
    for dict_key in ('exam', 'notes', 'notebook'):
        if dict_key in meta:
            if not isinstance(meta[dict_key], dict):
                raise ValueError(f'{sid} meta.{dict_key}: object required')
            shell[dict_key] = {**shell[dict_key], **meta[dict_key]}
    for list_key in ('dayBeforeChecklist', 'examDayChecklist'):
        if list_key in meta:
            shell[list_key] = require_str_list(meta[list_key], f'{sid} meta.{list_key}', low=1, high=30)
    if 'plan' in meta:
        plan = meta['plan']
        if not isinstance(plan, list):
            raise ValueError(f'{sid} meta.plan: list required')
        seen_dates = set()
        out_plan = []
        for i, p in enumerate(plan):
            plabel = f'{sid} meta.plan[{i}]'
            if not isinstance(p, dict):
                raise ValueError(f'{plabel}: object required')
            date = require_text(p.get('date'), f'{plabel}.date')
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) or date in seen_dates:
                raise ValueError(f'{plabel}.date: unique YYYY-MM-DD required')
            seen_dates.add(date)
            goals = require_str_list(p.get('goals'), f'{plabel}.goals', low=1, high=10)
            tids = p.get('topicIds', [])
            if not isinstance(tids, list) or not all(isinstance(x, str) and x.strip() for x in tids):
                raise ValueError(f'{plabel}.topicIds: list of topic ID strings required')
            item = {
                'date': date,
                'topicIds': [x.strip() for x in tids],
                'goals': goals,
                'normalDayMinutes': p.get('normalDayMinutes', [60, 90]),
                'onCallMinimumMinutes': p.get('onCallMinimumMinutes', [20, 30]),
                'workloadNote': str(p.get('workloadNote', '建議練習量，非官方要求。')),
            }
            if p.get('courseTask') is not None:
                ct = p['courseTask']
                if not isinstance(ct, dict) or ct.get('target') not in {'stories', 'evidence', 'sources'}:
                    raise ValueError(f'{plabel}.courseTask: target must be stories, evidence, or sources')
                item['courseTask'] = {'target': ct['target'], 'text': require_text(ct.get('text'), f'{plabel}.courseTask.text')}
            out_plan.append(item)
        shell['plan'] = out_plan
    for seed_key in ('storySeeds', 'evidenceSeeds'):
        if seed_key in meta:
            seeds = meta[seed_key]
            if not isinstance(seeds, list) or not seeds:
                raise ValueError(f'{sid} meta.{seed_key}: non-empty list required')
            seen = set()
            for i, s in enumerate(seeds):
                if not isinstance(s, dict):
                    raise ValueError(f'{sid} meta.{seed_key}[{i}]: object required')
                item_id = require_text(s.get('id'), f'{sid} meta.{seed_key}[{i}].id')
                if not re.fullmatch(r'[a-z0-9-]+', item_id) or item_id in seen:
                    raise ValueError(f'{sid} meta.{seed_key}[{i}].id: malformed or duplicate')
                seen.add(item_id)
                require_text(s.get('title'), f'{sid} meta.{seed_key}[{i}].title')
                require_text(s.get('cue'), f'{sid} meta.{seed_key}[{i}].cue')
            shell[seed_key] = seeds


def validate_topics(raw_topics, sid):
    if not isinstance(raw_topics, list):
        raise ValueError(f'{sid} topics.json: list required')
    seen_ids = set()
    seen_chapters = set()
    out = []
    id_re = re.compile(rf'^{re.escape(sid)}-[a-z0-9-]+$')
    for i, t in enumerate(raw_topics):
        label = f'{sid} topic[{i}]'
        if not isinstance(t, dict):
            raise ValueError(f'{label}: object required')
        tid = require_text(t.get('id'), f'{label}.id')
        label = f'{sid} topic {tid}'
        if not id_re.fullmatch(tid) or tid in seen_ids:
            raise ValueError(f'{label}: id must match {sid}-<slug> and be unique')
        seen_ids.add(tid)
        title = require_text(t.get('title'), f'{label}.title')
        summary = require_text(t.get('summary'), f'{label}.summary')
        source = validate_source(t.get('source'), f'{label}.source')

        chapter = t.get('chapter')
        if chapter is not None:
            if type(chapter) is not int or chapter < 1 or chapter in seen_chapters:
                raise ValueError(f'{label}.chapter: unique positive integer required')
            seen_chapters.add(chapter)

        sections_in = t.get('sections')
        if not isinstance(sections_in, list) or not sections_in:
            raise ValueError(f'{label}.sections: non-empty list required')
        sections = []
        for s_idx, sec in enumerate(sections_in):
            slabel = f'{label}.sections[{s_idx}]'
            if not isinstance(sec, dict):
                raise ValueError(f'{slabel}: object required')
            stitle = require_text(sec.get('title'), f'{slabel}.title')
            points = require_str_list(sec.get('points'), f'{slabel}.points', low=1, high=20)
            s_out = {'title': stitle, 'points': points}
            if sec.get('recall') is not None:
                s_out['recall'] = require_text(sec['recall'], f'{slabel}.recall')
            if sec.get('ref') is not None:
                s_out['ref'] = require_text(sec['ref'], f'{slabel}.ref')
            if 'medicalReview' in sec:
                s_out['medicalReview'] = validate_medical_review(sec['medicalReview'], f'{slabel}.medicalReview')
            sections.append(s_out)

        compare = []
        for c_idx, row in enumerate(t.get('compare', []) or []):
            compare.append(require_str_list(row, f'{label}.compare[{c_idx}]', low=3, high=3))

        cases = []
        for c_idx, c in enumerate(t.get('cases', []) or []):
            if not isinstance(c, dict):
                raise ValueError(f'{label}.cases[{c_idx}]: object required')
            c_out = {
                'prompt': require_text(c.get('prompt'), f'{label}.cases[{c_idx}].prompt'),
                'answer': require_text(c.get('answer'), f'{label}.cases[{c_idx}].answer'),
            }
            if c.get('ref') is not None:
                c_out['ref'] = require_text(c['ref'], f'{label}.cases[{c_idx}].ref')
            cases.append(c_out)

        images = []
        for img_idx, img in enumerate(t.get('images', []) or []):
            if not isinstance(img, dict):
                raise ValueError(f'{label}.images[{img_idx}]: object required')
            img_out = {
                'prompt': require_text(img.get('prompt'), f'{label}.images[{img_idx}].prompt'),
                'answer': require_text(img.get('answer'), f'{label}.images[{img_idx}].answer'),
            }
            if img.get('ref') is not None:
                img_out['ref'] = require_text(img['ref'], f'{label}.images[{img_idx}].ref')
            images.append(img_out)

        topic_obj = {
            'id': tid,
            'title': title,
            'summary': summary,
            'sections': sections,
            'notes': str(t.get('notes', '') or '').strip(),
            'refs': validate_https_urls(t.get('refs', []), f'{label}.refs'),
            'source': source,
            'compare': compare,
            'cases': cases,
            'images': images,
        }
        if chapter is not None:
            topic_obj['chapter'] = chapter
        if t.get('sourceUrl') is not None:
            su = require_text(t['sourceUrl'], f'{label}.sourceUrl')
            if not re.match(r'^https://\S+$', su):
                raise ValueError(f'{label}.sourceUrl: must start with https://')
            topic_obj['sourceUrl'] = su
        if t.get('correction'):
            topic_obj['correction'] = require_text(t['correction'], f'{label}.correction')
        if t.get('ext'):
            topic_obj['ext'] = require_str_list(t['ext'], f'{label}.ext', low=1, high=20)
        out.append(topic_obj)
    return out


def validate_questions(raw_questions, sid, topic_ids, seen_ids=None, require_past_exam=False):
    if not isinstance(raw_questions, list):
        raise ValueError(f'{sid} questions: list required')
    if seen_ids is None:
        seen_ids = set()
    id_re = re.compile(rf'^{re.escape(sid)}-[a-z0-9-]+$')
    out = []
    for i, q in enumerate(raw_questions):
        label = f'{sid} question[{i}]'
        if not isinstance(q, dict):
            raise ValueError(f'{label}: object required')
        qid = require_text(q.get('id'), f'{label}.id')
        label = f'{sid} question {qid}'
        if not id_re.fullmatch(qid) or qid in seen_ids:
            raise ValueError(f'{label}: id must match {sid}-<slug> and be unique')
        seen_ids.add(qid)

        topic_id = require_text(q.get('topicId'), f'{label}.topicId')
        if topic_id not in topic_ids:
            raise ValueError(f'{label}.topicId: unknown topicId {topic_id!r}')

        stem = require_text(q.get('stem'), f'{label}.stem')
        options = require_str_list(q.get('options'), f'{label}.options', low=2, high=6)
        if len(set(options)) != len(options):
            raise ValueError(f'{label}.options: options must be distinct')

        raw_idx = q.get('correctIndex')
        raw_ans = q.get('answer')
        has_idx = raw_idx is not None
        has_ans = raw_ans is not None
        if not has_idx and not has_ans:
            raise ValueError(f'{label}: answer required (missing correctIndex / answer)')
        if has_idx:
            if type(raw_idx) is not int or not 0 <= raw_idx < len(options):
                raise ValueError(f'{label}.correctIndex: integer in 0..{len(options) - 1} required')
        if has_ans:
            ans_text = require_text(raw_ans, f'{label}.answer')
            if ans_text not in options:
                raise ValueError(f'{label}.answer: must match one of options')
            ans_idx = options.index(ans_text)
            if has_idx and raw_idx != ans_idx:
                raise ValueError(f'{label}: correctIndex ({raw_idx}) disagrees with answer ({ans_text!r})')
            correct_idx = ans_idx
        else:
            correct_idx = raw_idx

        explanation = require_text(q.get('explanation'), f'{label}.explanation')
        source = validate_source(q.get('source'), f'{label}.source')

        if require_past_exam and q.get('pastExam') is not True:
            raise ValueError(f'{label}: items in past-exam-questions.json must set pastExam: true')

        q_out = {
            'id': qid,
            'topicId': topic_id,
            'stem': stem,
            'options': options,
            'correctIndex': correct_idx,
            'explanation': explanation,
            'source': source,
        }
        for bool_key in ('pastExam', 'safety', 'reserve'):
            if bool_key in q:
                if type(q[bool_key]) is not bool:
                    raise ValueError(f'{label}.{bool_key}: boolean required')
                q_out[bool_key] = q[bool_key]
        for str_key in ('sourceId', 'sourceRef', 'sourceType'):
            if q.get(str_key) is not None:
                q_out[str_key] = require_text(q[str_key], f'{label}.{str_key}')
        if 'refs' in q:
            q_out['refs'] = validate_https_urls(q['refs'], f'{label}.refs')
        if 'medicalReview' in q:
            q_out['medicalReview'] = validate_medical_review(q['medicalReview'], f'{label}.medicalReview')
        out.append(q_out)
    return out


def validate_interview(raw_interview, sid, topic_ids):
    if not isinstance(raw_interview, list):
        raise ValueError(f'{sid} interview.json: list required')
    seen_ids = set()
    id_re = re.compile(rf'^{re.escape(sid)}-[a-z0-9-]+$')
    out = []
    for i, item in enumerate(raw_interview):
        label = f'{sid} interview[{i}]'
        if not isinstance(item, dict):
            raise ValueError(f'{label}: object required')
        iid = require_text(item.get('id'), f'{label}.id')
        label = f'{sid} interview {iid}'
        if not id_re.fullmatch(iid) or iid in seen_ids:
            raise ValueError(f'{label}: id must match {sid}-<slug> and be unique')
        seen_ids.add(iid)

        title = require_text(item.get('title'), f'{label}.title')
        question = require_text(item.get('question'), f'{label}.question')
        answer = require_text(item.get('answer'), f'{label}.answer')
        source = validate_source(item.get('source'), f'{label}.source')

        clinical = item.get('clinical')
        if type(clinical) is not bool:
            raise ValueError(f'{label}.clinical: boolean required')

        duration = item.get('durationSeconds', 180)
        if type(duration) is not int or not 30 <= duration <= 900:
            raise ValueError(f'{label}.durationSeconds: integer in 30..900 required')

        rubric = require_str_list(item.get('rubric'), f'{label}.rubric', low=5, high=5)
        followups = require_str_list(item['followups'], f'{label}.followups', low=1, high=8) if item.get('followups') else []

        topic_id = item.get('topicId')
        if clinical and topic_ids and not topic_id:
            raise ValueError(f'{label}.topicId: clinical interview must reference a topicId')
        if topic_id is not None and topic_id != '':
            topic_id = require_text(topic_id, f'{label}.topicId')
            if topic_ids and topic_id not in topic_ids:
                raise ValueError(f'{label}.topicId: unknown topicId {topic_id!r}')

        iv_out = {
            'id': iid,
            'title': title,
            'question': question,
            'durationSeconds': duration,
            'clinical': clinical,
            'answer': answer,
            'personalizationRequired': str(item.get('personalizationRequired', '') or '').strip(),
            'followups': followups,
            'rubric': rubric,
            'source': source,
        }
        if topic_id:
            iv_out['topicId'] = topic_id
        for str_key in ('shortAnswer', 'basis', 'sourceRef'):
            if item.get(str_key):
                iv_out[str_key] = require_text(item[str_key], f'{label}.{str_key}')
        for list_key in ('keyFacts', 'pitfalls', 'followupAnswers'):
            if item.get(list_key):
                iv_out[list_key] = require_str_list(item[list_key], f'{label}.{list_key}', low=1, high=10)
        out.append(iv_out)
    return out


def validate_samples(raw_samples, sid, interview_by_id):
    label = f'{sid} interviewSamples'
    if not isinstance(raw_samples, dict):
        raise ValueError(f'{label}: object required')
    note = require_text(raw_samples.get('note'), f'{label}.note')
    clinical_note = require_text(raw_samples.get('clinicalNote'), f'{label}.clinicalNote')
    versions_in = raw_samples.get('versions')
    if not isinstance(versions_in, list) or len(versions_in) != 3:
        raise ValueError(f'{label}.versions: exactly 3 persona versions required')
    versions = []
    for i, v in enumerate(versions_in):
        if not isinstance(v, dict):
            raise ValueError(f'{label}.versions[{i}]: object required')
        versions.append({
            'label': require_text(v.get('label'), f'{label}.versions[{i}].label'),
            'hint': require_text(v.get('hint'), f'{label}.versions[{i}].hint'),
            'clinicalHint': require_text(v.get('clinicalHint'), f'{label}.versions[{i}].clinicalHint'),
        })
    answers_in = raw_samples.get('answers')
    if not isinstance(answers_in, dict) or (interview_by_id and not answers_in):
        raise ValueError(f'{label}.answers: non-empty object required')
    unknown = set(answers_in) - set(interview_by_id)
    if unknown:
        raise ValueError(f'{label}.answers: unknown interview IDs {sorted(unknown)}')
    answers = {}
    for iid, texts in answers_in.items():
        answers[iid] = require_str_list(texts, f'{label}.answers.{iid}', low=3, high=3)
    out = {'note': note, 'clinicalNote': clinical_note, 'versions': versions, 'answers': answers}
    if 'source' in raw_samples:
        out['source'] = validate_source(raw_samples['source'], f'{label}.source')
    return out


def validate_detailed(raw_detailed, sid, interview_by_id):
    label = f'{sid} interviewDetailed'
    if not isinstance(raw_detailed, dict):
        raise ValueError(f'{label}: object required')
    reviewed = require_text(raw_detailed.get('reviewedDate'), f'{label}.reviewedDate')
    note = require_text(raw_detailed.get('note'), f'{label}.note')
    clinical_note = require_text(raw_detailed.get('clinicalNote'), f'{label}.clinicalNote')
    answers_in = raw_detailed.get('answers')
    if not isinstance(answers_in, dict) or (interview_by_id and not answers_in):
        raise ValueError(f'{label}.answers: non-empty object required')
    unknown = set(answers_in) - set(interview_by_id)
    if unknown:
        raise ValueError(f'{label}.answers: unknown interview IDs {sorted(unknown)}')
    answers = {}
    for iid, a in answers_in.items():
        alabel = f'{label}.answers.{iid}'
        if not isinstance(a, dict):
            raise ValueError(f'{alabel}: object required')
        iv = interview_by_id[iid]
        summary = require_text(a.get('summary'), f'{alabel}.summary')
        answer = require_text(a.get('answer'), f'{alabel}.answer')
        outline = require_str_list(a.get('outline'), f'{alabel}.outline', low=2, high=8)
        f_count = len(iv['followups'])
        if f_count:
            followup_answers = require_str_list(a.get('followupAnswers'), f'{alabel}.followupAnswers', low=f_count, high=f_count)
        else:
            followup_answers = require_str_list(a['followupAnswers'], f'{alabel}.followupAnswers', low=1, high=8) if a.get('followupAnswers') else []
        more = []
        for idx, mf in enumerate(a.get('moreFollowups', []) or []):
            if not isinstance(mf, dict):
                raise ValueError(f'{alabel}.moreFollowups[{idx}]: object required')
            more.append({
                'q': require_text(mf.get('q'), f'{alabel}.moreFollowups[{idx}].q'),
                'a': require_text(mf.get('a'), f'{alabel}.moreFollowups[{idx}].a'),
            })
        focus = require_str_list(a.get('examinerFocus'), f'{alabel}.examinerFocus', low=2, high=6)
        pitfalls = require_str_list(a.get('pitfalls'), f'{alabel}.pitfalls', low=2, high=6)
        a_out = {
            'summary': summary,
            'outline': outline,
            'answer': answer,
            'followupAnswers': followup_answers,
            'moreFollowups': more,
            'examinerFocus': focus,
            'pitfalls': pitfalls,
        }
        if a.get('personalize'):
            a_out['personalize'] = require_str_list(a['personalize'], f'{alabel}.personalize', low=1, high=6)
        if 'source' in a:
            a_out['source'] = validate_source(a['source'], f'{alabel}.source')
        answers[iid] = a_out
    return {'version': 1, 'reviewedDate': reviewed, 'note': note, 'clinicalNote': clinical_note, 'answers': answers}


def validate_enrichment(raw_enrichment, sid, topics_by_id):
    label = f'{sid} enrichment'
    if not isinstance(raw_enrichment, dict):
        raise ValueError(f'{label}: object required')
    reviewed = require_text(raw_enrichment.get('reviewedDate'), f'{label}.reviewedDate')
    chapters_in = raw_enrichment.get('chapters')
    if not isinstance(chapters_in, dict):
        raise ValueError(f'{label}.chapters: object required')
    unknown = set(chapters_in) - set(topics_by_id)
    if unknown:
        raise ValueError(f'{label}.chapters: unknown topic IDs {sorted(unknown)}')
    all_resource_ids = set()
    chapters = {}
    for tid, ch in chapters_in.items():
        clabel = f'{label}.chapters.{tid}'
        if not isinstance(ch, dict):
            raise ValueError(f'{clabel}: object required')
        ch_source = validate_source(ch.get('source'), f'{clabel}.source')
        resources = []
        ch_res_ids = set()
        for r_idx, r in enumerate(ch.get('resources', []) or []):
            rlabel = f'{clabel}.resources[{r_idx}]'
            if not isinstance(r, dict):
                raise ValueError(f'{rlabel}: object required')
            rid = require_text(r.get('id'), f'{rlabel}.id')
            if not re.fullmatch(rf'{re.escape(sid)}-[a-z0-9-]+', rid) or rid in all_resource_ids:
                raise ValueError(f'{rlabel}.id: must match {sid}-<slug> and be globally unique')
            all_resource_ids.add(rid)
            ch_res_ids.add(rid)
            url = require_text(r.get('url'), f'{rlabel}.url')
            if not re.match(r'^https://\S+$', url):
                raise ValueError(f'{rlabel}.url: must start with https://')
            kind = require_text(r.get('kind'), f'{rlabel}.kind')
            if kind not in RESOURCE_KINDS:
                raise ValueError(f'{rlabel}.kind: must be one of {sorted(RESOURCE_KINDS)}')
            resources.append({
                'id': rid,
                'title': require_text(r.get('title'), f'{rlabel}.title'),
                'url': url,
                'kind': kind,
                'provider': require_text(r.get('provider'), f'{rlabel}.provider'),
                'note': require_text(r.get('note'), f'{rlabel}.note'),
            })

        def check_res_refs(sids, ref_label):
            if not sids:
                return []
            ids = require_str_list(sids, ref_label, low=1, high=6)
            if not set(ids) <= ch_res_ids:
                raise ValueError(f'{ref_label}: unknown chapter resource IDs {sorted(set(ids) - ch_res_ids)}')
            return ids

        deep_dive = []
        for d_idx, b in enumerate(ch.get('deepDive', []) or []):
            dlabel = f'{clabel}.deepDive[{d_idx}]'
            if not isinstance(b, dict):
                raise ValueError(f'{dlabel}: object required')
            deep_dive.append({
                'heading': require_text(b.get('heading'), f'{dlabel}.heading'),
                'paragraphs': require_str_list(b.get('paragraphs'), f'{dlabel}.paragraphs', low=1, high=6),
                'sourceIds': check_res_refs(b.get('sourceIds'), f'{dlabel}.sourceIds'),
            })

        ch_out = {'source': ch_source, 'deepDive': deep_dive, 'resources': resources}
        if ch.get('figure') is not None:
            fig = ch['figure']
            if not isinstance(fig, dict):
                raise ValueError(f'{clabel}.figure: object required')
            f_out = {
                'title': require_text(fig.get('title'), f'{clabel}.figure.title'),
                'caption': require_text(fig.get('caption'), f'{clabel}.figure.caption'),
                'alt': require_text(fig.get('alt'), f'{clabel}.figure.alt'),
                'sourceIds': check_res_refs(fig.get('sourceIds'), f'{clabel}.figure.sourceIds'),
            }
            if fig.get('src'):
                f_out['src'] = require_text(fig['src'], f'{clabel}.figure.src')
            ch_out['figure'] = f_out

        if ch.get('oralChallenge') is not None:
            oc = ch['oralChallenge']
            if not isinstance(oc, dict):
                raise ValueError(f'{clabel}.oralChallenge: object required')
            ch_out['oralChallenge'] = {
                'question': require_text(oc.get('question'), f'{clabel}.oralChallenge.question'),
                'answer': require_text(oc.get('answer'), f'{clabel}.oralChallenge.answer'),
                'sourceIds': check_res_refs(oc.get('sourceIds'), f'{clabel}.oralChallenge.sourceIds'),
            }

        if ch.get('integrated') is not None:
            integ = ch['integrated']
            if not isinstance(integ, dict):
                raise ValueError(f'{clabel}.integrated: object required')
            framing = require_text(integ.get('framing'), f'{clabel}.integrated.framing')
            objectives = require_str_list(integ.get('objectives'), f'{clabel}.integrated.objectives', low=2, high=6)
            units_in = integ.get('units')
            if not isinstance(units_in, list) or not 1 <= len(units_in) <= 3:
                raise ValueError(f'{clabel}.integrated.units: 1-3 units required')
            n_sec = len(topics_by_id[tid]['sections'])
            n_dd = len(deep_dive)
            seen_uids = set()
            units = []
            for u_idx, u in enumerate(units_in):
                ulabel = f'{clabel}.integrated.units[{u_idx}]'
                if not isinstance(u, dict):
                    raise ValueError(f'{ulabel}: object required')
                uid = require_text(u.get('id'), f'{ulabel}.id')
                if uid not in {'u1', 'u2', 'u3'} or uid in seen_uids:
                    raise ValueError(f'{ulabel}.id: unique id in u1..u3 required')
                seen_uids.add(uid)
                sec_idxs = u.get('sectionIndexes', [])
                if not isinstance(sec_idxs, list) or not all(type(x) is int and 0 <= x < n_sec for x in sec_idxs):
                    raise ValueError(f'{ulabel}.sectionIndexes: valid section indexes required')
                dd_idxs = u.get('deepDiveIndexes', [])
                if not isinstance(dd_idxs, list) or not all(type(x) is int and 0 <= x < n_dd for x in dd_idxs):
                    raise ValueError(f'{ulabel}.deepDiveIndexes: valid deepDive indexes required')
                decisions = []
                for dec_idx, dec in enumerate(u.get('decisions', []) or []):
                    if not isinstance(dec, dict):
                        raise ValueError(f'{ulabel}.decisions[{dec_idx}]: object required')
                    decisions.append({
                        'finding': require_text(dec.get('finding'), f'{ulabel}.decisions[{dec_idx}].finding'),
                        'interpretation': require_text(dec.get('interpretation'), f'{ulabel}.decisions[{dec_idx}].interpretation'),
                        'nextStep': require_text(dec.get('nextStep'), f'{ulabel}.decisions[{dec_idx}].nextStep'),
                    })
                units.append({
                    'id': uid,
                    'title': require_text(u.get('title'), f'{ulabel}.title'),
                    'sectionIndexes': sec_idxs,
                    'deepDiveIndexes': dd_idxs,
                    'synthesis': require_str_list(u.get('synthesis'), f'{ulabel}.synthesis', low=1, high=6),
                    'decisions': decisions,
                    'showFigure': bool(u.get('showFigure', False) and 'figure' in ch_out),
                    'sourceIds': check_res_refs(u.get('sourceIds'), f'{ulabel}.sourceIds'),
                })
            integ_out = {'framing': framing, 'objectives': objectives, 'units': units, 'connections': []}
            if integ.get('case') is not None:
                ic = integ['case']
                if not isinstance(ic, dict):
                    raise ValueError(f'{clabel}.integrated.case: object required')
                steps_in = ic.get('steps')
                if not isinstance(steps_in, list) or not steps_in:
                    raise ValueError(f'{clabel}.integrated.case.steps: non-empty list required')
                steps = []
                for st_idx, st in enumerate(steps_in):
                    if not isinstance(st, dict):
                        raise ValueError(f'{clabel}.integrated.case.steps[{st_idx}]: object required')
                    steps.append({
                        'newInfo': require_text(st.get('newInfo'), f'{clabel}.integrated.case.steps[{st_idx}].newInfo'),
                        'prompt': require_text(st.get('prompt'), f'{clabel}.integrated.case.steps[{st_idx}].prompt'),
                        'answer': require_text(st.get('answer'), f'{clabel}.integrated.case.steps[{st_idx}].answer'),
                        'rationale': require_text(st.get('rationale'), f'{clabel}.integrated.case.steps[{st_idx}].rationale'),
                        'sourceIds': check_res_refs(st.get('sourceIds'), f'{clabel}.integrated.case.steps[{st_idx}].sourceIds'),
                    })
                integ_out['case'] = {
                    'title': require_text(ic.get('title'), f'{clabel}.integrated.case.title'),
                    'stem': require_text(ic.get('stem'), f'{clabel}.integrated.case.stem'),
                    'steps': steps,
                }
            for c_idx, conn in enumerate(integ.get('connections', []) or []):
                if not isinstance(conn, dict):
                    raise ValueError(f'{clabel}.integrated.connections[{c_idx}]: object required')
                ctid = require_text(conn.get('topicId'), f'{clabel}.integrated.connections[{c_idx}].topicId')
                if ctid not in topics_by_id:
                    raise ValueError(f'{clabel}.integrated.connections[{c_idx}].topicId: unknown topicId {ctid!r}')
                integ_out['connections'].append({
                    'topicId': ctid,
                    'reason': require_text(conn.get('reason'), f'{clabel}.integrated.connections[{c_idx}].reason'),
                })
            ch_out['integrated'] = integ_out
        chapters[tid] = ch_out

    paths = []
    for p_idx, p in enumerate(raw_enrichment.get('learningPaths', []) or []):
        plabel = f'{label}.learningPaths[{p_idx}]'
        if not isinstance(p, dict):
            raise ValueError(f'{plabel}: object required')
        tids = require_str_list(p.get('topicIds'), f'{plabel}.topicIds', low=2, high=8)
        if not set(tids) <= set(topics_by_id):
            raise ValueError(f'{plabel}.topicIds: unknown topicIds {sorted(set(tids) - set(topics_by_id))}')
        paths.append({
            'title': require_text(p.get('title'), f'{plabel}.title'),
            'question': require_text(p.get('question'), f'{plabel}.question'),
            'topicIds': tids,
        })
    return {'version': 1, 'reviewedDate': reviewed, 'chapters': chapters, 'learningPaths': paths}, all_resource_ids


def validate_workflows(raw_workflows, sid, topic_ids, resource_ids):
    label = f'{sid} workflows'
    if not isinstance(raw_workflows, dict):
        raise ValueError(f'{label}: object required')
    reviewed = require_text(raw_workflows.get('reviewedDate'), f'{label}.reviewedDate')
    intro = require_text(raw_workflows.get('intro'), f'{label}.intro')
    disclaimer = require_text(raw_workflows.get('disclaimer'), f'{label}.disclaimer')

    cats_in = raw_workflows.get('categories')
    if cats_in is None:
        categories = copy.deepcopy(DEFAULT_WORKFLOW_CATEGORIES)
    else:
        if not isinstance(cats_in, list) or not cats_in:
            raise ValueError(f'{label}.categories: non-empty list required')
        categories = []
        seen_cats = set()
        for idx, c in enumerate(cats_in):
            if not isinstance(c, dict):
                raise ValueError(f'{label}.categories[{idx}]: object required')
            cid = require_text(c.get('id'), f'{label}.categories[{idx}].id')
            if not re.fullmatch(r'[a-z0-9-]+', cid) or cid in seen_cats:
                raise ValueError(f'{label}.categories[{idx}].id: malformed or duplicate')
            seen_cats.add(cid)
            categories.append({'id': cid, 'label': require_text(c.get('label'), f'{label}.categories[{idx}].label')})
    valid_cats = {c['id'] for c in categories}

    items_in = raw_workflows.get('workflows')
    if not isinstance(items_in, list):
        raise ValueError(f'{label}.workflows: list required')
    id_re = re.compile(rf'^wf-{re.escape(sid)}-[a-z0-9-]+$')
    seen_ids = set()
    workflows = []
    for idx, w in enumerate(items_in):
        wlabel = f'{label}.workflows[{idx}]'
        if not isinstance(w, dict):
            raise ValueError(f'{wlabel}: object required')
        wid = require_text(w.get('id'), f'{wlabel}.id')
        wlabel = f'{sid} workflow {wid}'
        if not id_re.fullmatch(wid) or wid in seen_ids:
            raise ValueError(f'{wlabel}: id must match wf-{sid}-<slug> and be unique')
        seen_ids.add(wid)

        source = validate_source(w.get('source'), f'{wlabel}.source')
        cat = require_text(w.get('category'), f'{wlabel}.category')
        if cat not in valid_cats:
            raise ValueError(f'{wlabel}.category: unknown category {cat!r}')
        title = require_text(w.get('title'), f'{wlabel}.title')
        urgency = require_text(w.get('urgency'), f'{wlabel}.urgency')
        trigger = require_text(w.get('trigger'), f'{wlabel}.trigger')
        handoff = require_text(w.get('handoff'), f'{wlabel}.handoff')

        tids = require_str_list(w.get('topicIds'), f'{wlabel}.topicIds', low=1, high=5)
        if len(set(tids)) != len(tids) or not set(tids) <= topic_ids:
            raise ValueError(f'{wlabel}.topicIds: unique existing topicIds required')

        steps_in = w.get('steps')
        if not isinstance(steps_in, list) or not 2 <= len(steps_in) <= 12:
            raise ValueError(f'{wlabel}.steps: 2-12 steps required')
        steps = []
        for s_idx, s in enumerate(steps_in):
            if not isinstance(s, dict):
                raise ValueError(f'{wlabel}.steps[{s_idx}]: object required')
            if type(s.get('critical')) is not bool:
                raise ValueError(f'{wlabel}.steps[{s_idx}].critical: boolean required')
            steps.append({
                'title': require_text(s.get('title'), f'{wlabel}.steps[{s_idx}].title'),
                'detail': require_text(s.get('detail'), f'{wlabel}.steps[{s_idx}].detail'),
                'why': require_text(s.get('why'), f'{wlabel}.steps[{s_idx}].why'),
                'critical': s['critical'],
            })
        if len({s['title'] for s in steps}) != len(steps):
            raise ValueError(f'{wlabel}.steps: step titles must be distinct')
        if not any(s['critical'] for s in steps):
            raise ValueError(f'{wlabel}.steps: at least one critical step required')

        red_flags = require_str_list(w.get('redFlags'), f'{wlabel}.redFlags', low=1, high=8)
        pitfalls = require_str_list(w.get('pitfalls'), f'{wlabel}.pitfalls', low=1, high=8)
        eq_in = w.get('examQuestions')
        if not isinstance(eq_in, list) or not 1 <= len(eq_in) <= 6:
            raise ValueError(f'{wlabel}.examQuestions: 1-6 Q&A pairs required')
        exam_questions = []
        for q_idx, eq in enumerate(eq_in):
            if not isinstance(eq, dict):
                raise ValueError(f'{wlabel}.examQuestions[{q_idx}]: object required')
            exam_questions.append({
                'q': require_text(eq.get('q'), f'{wlabel}.examQuestions[{q_idx}].q'),
                'a': require_text(eq.get('a'), f'{wlabel}.examQuestions[{q_idx}].a'),
            })

        sids = w.get('sourceIds', []) or []
        if sids:
            sids = require_str_list(sids, f'{wlabel}.sourceIds', low=1, high=6)
            if not set(sids) <= resource_ids:
                raise ValueError(f'{wlabel}.sourceIds: unknown enrichment resource IDs')

        workflows.append({
            'id': wid,
            'category': cat,
            'title': title,
            'urgency': urgency,
            'trigger': trigger,
            'topicIds': tids,
            'steps': steps,
            'redFlags': red_flags,
            'pitfalls': pitfalls,
            'examQuestions': exam_questions,
            'handoff': handoff,
            'sourceIds': sids,
            'source': source,
        })
    return {'version': 1, 'reviewedDate': reviewed, 'intro': intro, 'disclaimer': disclaimer, 'categories': categories, 'workflows': workflows}, seen_ids


def validate_pbl(raw_pbl, sid, topic_ids, workflow_ids, resource_ids):
    label = f'{sid} pbl'
    if not isinstance(raw_pbl, dict):
        raise ValueError(f'{label}: object required')
    reviewed = require_text(raw_pbl.get('reviewedDate'), f'{label}.reviewedDate')
    intro = require_text(raw_pbl.get('intro'), f'{label}.intro')
    disclaimer = require_text(raw_pbl.get('disclaimer'), f'{label}.disclaimer')

    method_in = raw_pbl.get('method')
    if method_in is None:
        method = copy.deepcopy(DEFAULT_PBL_METHOD)
    else:
        if not isinstance(method_in, list) or not 3 <= len(method_in) <= 6:
            raise ValueError(f'{label}.method: 3-6 steps required')
        method = []
        for idx, m in enumerate(method_in):
            if not isinstance(m, dict):
                raise ValueError(f'{label}.method[{idx}]: object required')
            method.append({
                'step': require_text(m.get('step'), f'{label}.method[{idx}].step'),
                'hint': require_text(m.get('hint'), f'{label}.method[{idx}].hint'),
            })

    cases_in = raw_pbl.get('cases')
    if not isinstance(cases_in, list):
        raise ValueError(f'{label}.cases: list required')
    id_re = re.compile(rf'^pbl-{re.escape(sid)}-[a-z0-9-]+$')
    seen_ids = set()
    cases = []
    for idx, c in enumerate(cases_in):
        clabel = f'{label}.cases[{idx}]'
        if not isinstance(c, dict):
            raise ValueError(f'{clabel}: object required')
        cid = require_text(c.get('id'), f'{clabel}.id')
        clabel = f'{sid} PBL case {cid}'
        if not id_re.fullmatch(cid) or cid in seen_ids:
            raise ValueError(f'{clabel}: id must match pbl-{sid}-<slug> and be unique')
        seen_ids.add(cid)

        source = validate_source(c.get('source'), f'{clabel}.source')
        title = require_text(c.get('title'), f'{clabel}.title')
        theme = require_text(c.get('theme'), f'{clabel}.theme')
        trigger = require_text(c.get('trigger'), f'{clabel}.trigger')
        takeaway = require_text(c.get('takeaway'), f'{clabel}.takeaway')

        tids = require_str_list(c.get('topicIds'), f'{clabel}.topicIds', low=1, high=5)
        if len(set(tids)) != len(tids) or not set(tids) <= topic_ids:
            raise ValueError(f'{clabel}.topicIds: unique existing topicIds required')

        wf_ids = c.get('workflowIds', []) or []
        if not isinstance(wf_ids, list) or not set(wf_ids) <= workflow_ids:
            raise ValueError(f'{clabel}.workflowIds: must reference existing workflow IDs')

        stages_in = c.get('stages')
        if not isinstance(stages_in, list) or not 2 <= len(stages_in) <= 5:
            raise ValueError(f'{clabel}.stages: 2-5 stages required')
        stages = []
        for s_idx, st in enumerate(stages_in):
            slabel = f'{clabel}.stages[{s_idx}]'
            if not isinstance(st, dict):
                raise ValueError(f'{slabel}: object required')
            stages.append({
                'title': require_text(st.get('title'), f'{slabel}.title'),
                'info': require_text(st.get('info'), f'{slabel}.info'),
                'prompts': require_str_list(st.get('prompts'), f'{slabel}.prompts', low=1, high=5),
                'facts': require_str_list(st.get('facts'), f'{slabel}.facts', low=1, high=8),
                'hypotheses': require_str_list(st.get('hypotheses'), f'{slabel}.hypotheses', low=1, high=6),
                'needToKnow': require_str_list(st.get('needToKnow'), f'{slabel}.needToKnow', low=1, high=6),
                'discussion': require_text(st.get('discussion'), f'{slabel}.discussion'),
            })

        li_in = c.get('learningIssues')
        if not isinstance(li_in, list) or not 1 <= len(li_in) <= 8:
            raise ValueError(f'{clabel}.learningIssues: 1-8 learning issues required')
        learning_issues = []
        for l_idx, li in enumerate(li_in):
            if not isinstance(li, dict):
                raise ValueError(f'{clabel}.learningIssues[{l_idx}]: object required')
            learning_issues.append({
                'issue': require_text(li.get('issue'), f'{clabel}.learningIssues[{l_idx}].issue'),
                'why': require_text(li.get('why'), f'{clabel}.learningIssues[{l_idx}].why'),
            })

        hum = c.get('humanities')
        if not isinstance(hum, dict):
            raise ValueError(f'{clabel}.humanities: object required')
        humanities = {
            'title': require_text(hum.get('title'), f'{clabel}.humanities.title'),
            'points': require_str_list(hum.get('points'), f'{clabel}.humanities.points', low=1, high=6),
        }

        ef_in = c.get('examinerFollowups')
        if not isinstance(ef_in, list) or not 1 <= len(ef_in) <= 6:
            raise ValueError(f'{clabel}.examinerFollowups: 1-6 Q&A pairs required')
        followups = []
        for f_idx, ef in enumerate(ef_in):
            if not isinstance(ef, dict):
                raise ValueError(f'{clabel}.examinerFollowups[{f_idx}]: object required')
            followups.append({
                'q': require_text(ef.get('q'), f'{clabel}.examinerFollowups[{f_idx}].q'),
                'a': require_text(ef.get('a'), f'{clabel}.examinerFollowups[{f_idx}].a'),
            })

        sids = c.get('sourceIds', []) or []
        if sids:
            sids = require_str_list(sids, f'{clabel}.sourceIds', low=1, high=6)
            if not set(sids) <= resource_ids:
                raise ValueError(f'{clabel}.sourceIds: unknown enrichment resource IDs')

        cases.append({
            'id': cid,
            'title': title,
            'theme': theme,
            'trigger': trigger,
            'topicIds': tids,
            'workflowIds': wf_ids,
            'stages': stages,
            'learningIssues': learning_issues,
            'humanities': humanities,
            'examinerFollowups': followups,
            'takeaway': takeaway,
            'sourceIds': sids,
            'source': source,
        })
    return {'version': 1, 'reviewedDate': reviewed, 'intro': intro, 'method': method, 'disclaimer': disclaimer, 'cases': cases}


def build_specialty_payload(sid, content_root=DEFAULT_CONTENT_ROOT):
    if sid not in SPECIALTIES:
        raise ValueError(f'Unsupported specialty {sid!r}; expected one of {SPECIALTY_ORDER}')
    label = SPECIALTIES[sid]
    shell = _ENRICH.default_specialty_shell(sid, label)
    sdir = pathlib.Path(content_root) / sid
    files = resolve_files(sdir)
    if not files:
        return shell

    meta_override_disclaimer = False
    if 'meta' in files:
        meta_override_disclaimer = isinstance(files['meta'].get('notes'), dict) and 'questionDisclaimer' in files['meta']['notes']
        apply_meta(shell, files['meta'], sid)

    topics = validate_topics(files.get('topics', []), sid) if 'topics' in files else []
    shell['topics'] = topics
    topics_by_id = {t['id']: t for t in topics}
    topic_ids = set(topics_by_id)

    for p in shell['plan']:
        if p.get('topicIds') and not set(p['topicIds']) <= topic_ids:
            raise ValueError(f'{sid} plan date {p["date"]}: unknown topicIds {sorted(set(p["topicIds"]) - topic_ids)}')

    seen_qids = set()
    questions = []
    if 'questions' in files:
        questions.extend(validate_questions(files['questions'], sid, topic_ids, seen_qids, require_past_exam=False))
    if 'past_exam' in files:
        questions.extend(validate_questions(files['past_exam'], sid, topic_ids, seen_qids, require_past_exam=True))
    shell['questions'] = questions
    if questions and not meta_override_disclaimer:
        past_n = sum(1 for q in questions if q.get('pastExam'))
        base_n = len(questions) - past_n
        if past_n and base_n:
            shell['notes']['questionDisclaimer'] = f'共 {len(questions)} 題單選練習：{base_n} 題自編、{past_n} 題依歷屆考點改寫，均附核對來源，非歷屆試題原文。'
        elif past_n:
            shell['notes']['questionDisclaimer'] = f'共 {len(questions)} 題單選練習（依歷屆考點改寫），均附核對來源，非歷屆試題原文。'
        else:
            shell['notes']['questionDisclaimer'] = f'共 {len(questions)} 題自編單選練習，均附核對來源，非歷屆試題原文。'

    interview = validate_interview(files.get('interview', []), sid, topic_ids) if 'interview' in files else []
    shell['interview'] = interview
    interview_by_id = {i['id']: i for i in interview}

    if 'samples' in files:
        shell['interviewSamples'] = validate_samples(files['samples'], sid, interview_by_id)
    if 'detailed' in files:
        shell['interviewDetailed'] = validate_detailed(files['detailed'], sid, interview_by_id)

    resource_ids = set()
    if 'enrichment' in files:
        enrichment_obj, resource_ids = validate_enrichment(files['enrichment'], sid, topics_by_id)
        shell['enrichment'] = enrichment_obj

    workflow_ids = set()
    if 'workflows' in files:
        workflows_obj, workflow_ids = validate_workflows(files['workflows'], sid, topic_ids, resource_ids)
        shell['workflows'] = workflows_obj

    if 'pbl' in files:
        shell['pbl'] = validate_pbl(files['pbl'], sid, topic_ids, workflow_ids, resource_ids)

    return shell


def encode_json_script_payload(data):
    return json.dumps(data, ensure_ascii=False).replace('</', '<\\/').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def extract_block(html, block_id):
    pattern = re.compile(rf'(<script type="application/json" id="{re.escape(block_id)}">)(.*?)(</script>)', re.S)
    matches = list(pattern.finditer(html))
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one <script type="application/json" id="{block_id}"> block, found {len(matches)}')
    return matches[0]


def apply_specialties(html, specialties=None, content_root=DEFAULT_CONTENT_ROOT):
    targets = list(specialties or SPECIALTY_ORDER)
    for sid in targets:
        if sid not in SPECIALTIES:
            raise ValueError(f'Invalid specialty {sid!r}; choose from {SPECIALTY_ORDER}')

    oph_before = extract_block(html, 'course-data').group(2)
    oph_sha_before = hashlib.sha256(oph_before.encode('utf-8')).hexdigest()

    summaries = {}
    out_html = html
    for sid in targets:
        payload_obj = build_specialty_payload(sid, content_root=content_root)
        encoded = encode_json_script_payload(payload_obj)
        m = extract_block(out_html, f'course-data-{sid}')
        current_raw = m.group(2)
        changed = current_raw != encoded
        if changed:
            out_html = out_html[:m.start(2)] + encoded + out_html[m.end(2):]
        summaries[sid] = {
            'changed': changed,
            'topics': len(payload_obj['topics']),
            'questions': len(payload_obj['questions']),
            'interview': len(payload_obj['interview']),
            'pbl_cases': len(payload_obj['pbl']['cases']),
            'workflows': len(payload_obj['workflows']['workflows']),
            'sha256': hashlib.sha256(encoded.encode('utf-8')).hexdigest(),
        }

    oph_after = extract_block(out_html, 'course-data').group(2)
    oph_sha_after = hashlib.sha256(oph_after.encode('utf-8')).hexdigest()
    if oph_before != oph_after or oph_sha_before != oph_sha_after:
        raise RuntimeError('Ophthalmology course-data block was unexpectedly modified')

    return out_html, summaries, oph_sha_after


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--s', '--specialty', dest='specialties', action='append', choices=SPECIALTY_ORDER, help='Specialty ID to build/check (ent, rad, radonc, nm, neuro). Repeatable.')
    parser.add_argument('--all', action='store_true', help='Process all non-ophthalmology specialties (default when --s is omitted).')
    parser.add_argument('--check', action='store_true', help='Validate content/<s>/ and verify index.html is up to date without writing.')
    parser.add_argument('--content-root', type=pathlib.Path, default=DEFAULT_CONTENT_ROOT, help='Root content directory (default: content/).')
    parser.add_argument('--index', type=pathlib.Path, default=DEFAULT_INDEX, help='Target index.html path (default: index.html).')
    args = parser.parse_args(argv)
    if args.specialties and args.all:
        parser.error('Use either --s <id> or --all, not both.')
    targets = args.specialties if args.specialties else list(SPECIALTY_ORDER)
    invalid = [s for s in targets if s not in SPECIALTIES]
    if invalid:
        parser.error(f'Unsupported specialty {invalid}; allowed values: {", ".join(SPECIALTY_ORDER)}')
    # Preserve canonical order while deduplicating.
    seen = set()
    ordered = [s for s in targets if not (s in seen or seen.add(s))]
    return args, ordered


def main(argv=None):
    args, targets = parse_args(argv)
    index_path = args.index.resolve()
    content_root = args.content_root.resolve()
    html = index_path.read_text(encoding='utf-8')
    new_html, summaries, oph_sha = apply_specialties(html, specialties=targets, content_root=content_root)
    stale = [sid for sid, info in summaries.items() if info['changed']]
    if args.check:
        if stale:
            raise SystemExit(f'course-data out of date for {stale}; run python3 scripts/apply-specialty.py')
    elif new_html != html:
        index_path.write_bytes(new_html.encode('utf-8'))
    print(json.dumps({
        'mode': 'check' if args.check else 'write',
        'index': str(index_path),
        'content_root': str(content_root),
        'course_data_sha256': oph_sha,
        'specialties': summaries,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
