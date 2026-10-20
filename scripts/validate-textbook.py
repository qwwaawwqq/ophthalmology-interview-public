#!/usr/bin/env python3
"""Validate public original teaching content without needing private textbook text."""
import argparse
import ast
import collections
import copy
import datetime as dt
import json
import math
import operator
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
IMAGES = {'not-reviewed', 'missing', 'unreadable', 'verified', 'not-applicable'}
STATUSES = {'draft', 'source-checked', 'independently-reviewed'}
DOMAINS = {'mechanism': None, 'clinicalClues': ['finding', 'meaning'], 'differential': ['diagnosis', 'for', 'against', 'discriminator'], 'investigations': ['test', 'purpose', 'interpretation', 'limitation'], 'management': ['condition', 'stage', 'action', 'rationale', 'caution'], 'imageClues': ['modality', 'clue', 'interpretation', 'status'], 'pitfalls': ['mistake', 'correction']}
PLACEHOLDERS = re.compile(r'^(?:TODO|TBD|待補(?:充)?|尚待補入|請填入.*|請參考原書|詳見原書|依實際情況處理|機轉說明|待核對答案)[。.!！\s]*$', re.I)


def require(test, message):
    if not test:
        raise ValueError(message)


def text(value, name):
    require(isinstance(value, str) and value.strip() and not PLACEHOLDERS.fullmatch(value.strip()), name + ': missing or placeholder teaching text')


def refs(values, pages, name):
    require(isinstance(values, list) and values, name + ': sourceRefs required')
    for r in values:
        require(isinstance(r, dict) and isinstance(r.get('pdfPages'), list) and r['pdfPages'], name + ': PDF page anchors required')
        require(all(isinstance(p, int) and 1 <= p <= pages for p in r['pdfPages']), name + ': PDF page outside source')
        require(r.get('printedPages') is None or isinstance(r['printedPages'], list), name + ': printedPages must be labels or null')
        text(r.get('chapterHeading'), name + ': chapterHeading')


def clinical_updates(item, name):
    for update in item.get('clinicalUpdates', []):
        text(update.get('statement'), name + ': clinical update')
        source = update.get('source', {})
        require(isinstance(source.get('url'), str) and source['url'].startswith('https://'), name + ': clinical update needs HTTPS primary source')
        text(source.get('title'), name + ': update source title')
        require(re.fullmatch(r'\d{4}-\d{2}-\d{2}', source.get('checkedAt', '')), name + ': update checkedAt date required')


def walk_strings(value, path=''):
    if isinstance(value, dict):
        for k, v in value.items():
            yield from walk_strings(v, path + '.' + k)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from walk_strings(v, path + '[' + str(i) + ']')
    elif isinstance(value, str):
        yield path, value


def backup(path):
    if path.exists():
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
        shutil.copy2(path, path.with_name(path.name + '.bak-' + stamp))


def save(path, value):
    output = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text() == output:
        return
    backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(output)


def eval_arithmetic(expression):
    ops = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}
    def calc(node):
        if isinstance(node, ast.Expression): return calc(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float): return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            a, b = calc(node.left), calc(node.right)
            require(not isinstance(node.op, ast.Pow) or abs(b) <= 10, 'exponent too large')
            return ops[type(node.op)](a, b)
        if isinstance(node, ast.UnaryOp) and type(node.op) in ops: return ops[type(node.op)](calc(node.operand))
        raise ValueError('Only literal arithmetic is allowed')
    return calc(ast.parse(expression, mode='eval'))


def numeric_claims(book):
    result, calculations = [], []
    collect_numeric(book, 'book', book['bookId'], result, calculations)
    for chapter in book['chapters']:
        records = [(u, 'unit', u['id']) for u in chapter['units']]
        for item, kind, identity in records:
            collect_numeric(item, kind, identity, result, calculations)
    for q in book['questions']:
        collect_numeric(q, 'question', q['id'], result, calculations)
    return result, calculations


def collect_numeric(item, kind, identity, output, calculations):
    fields = ['mechanism', 'clinicalClues', 'differential', 'investigations', 'management', 'imageClues', 'pitfalls', 'recall', 'clinicalUpdates'] if kind == 'unit' else ['clinicalUpdates'] if kind == 'book' else ['stem', 'options', 'explanation', 'clinicalUpdates']
    for field in fields:
        for path, value in walk_strings(item.get(field), field):
            if path.endswith(('.url', '.checkedAt', '.title', '.figureId', '.status')): continue
            types = []
            if re.search(r'\d(?:[\d.,–—~−+-]*\d)?\s*(?:mg|mcg|µg|μg|g/kg|mL|IU|單位|毫克|微克)\b', value, re.I): types.append('dose')
            if re.search(r'\d\s*[%％]', value): types.append('percentage')
            if re.search(r'百分之[零〇一二兩三四五六七八九十百千萬點\d]+', value): types.append('chinese-percentage-candidate')
            if re.search(r'[一二兩三四五六七八九十百千萬]+(?:歲|小時|分鐘|天|毫克|微克|公分|毫米|倍|成|分之一)', value): types.append('chinese-number-candidate')
            if re.search(r'[<>≤≥≦≧]|(?:至少|低於|高於|超過|不超過|門檻|上限|下限).{0,12}\d', value) and re.search(r'\d', value): types.append('threshold')
            if re.search(r'[=＝]|\b(?:SE|AL|IOP)\s*\+|\d\s*[×÷*/^]', value): types.append('formula')
            if re.search(r'\d\s*(?:歲|mmHg|mmol/L|mg/dL|cm|mm\b|D\b|小時|分鐘)', value) and not types: types.append('scenario-or-measurement')
            if types: output.append({'id': identity, 'kind': kind, 'field': path, 'types': types, 'statement': value, 'sourceRefs': item.get('sourceRefs', []), 'verification': 'requires independent source review'})
    for check in item.get('calculationChecks', []):
        value = eval_arithmetic(check['expression'])
        require(math.isclose(value, check['expected'], rel_tol=1e-8, abs_tol=1e-8), identity + ': arithmetic verification failed')
        calculations.append({'id': identity, 'expression': check['expression'], 'expected': check['expected'], 'recomputed': value, 'pass': True})


def validate_book(book, expected, complete=False):
    bid = expected['bookId']
    require(book.get('schemaVersion') == 1 and book.get('bookId') == bid, bid + ': identity/schema mismatch')
    for key in ['title', 'edition', 'sha256', 'pdfPageCount']:
        require(book.get('source', {}).get(key) == expected['source'][key], bid + ': source ' + key + ' mismatch')
    for path, value in walk_strings(book):
        require('/Users/' not in value and 'private-text/' not in value and 'question_english' not in path and 'answer_english' not in path, bid + ': private source data leaked at ' + path)
    clinical_updates(book, bid)
    for update in book.get('clinicalUpdates', []):
        require(update.get('chapterIds') or update.get('questionIds'), bid + ': book update requires linked chapter/question IDs')
        require(set(update.get('chapterIds', [])) <= {c['id'] for c in expected['chapters']}, bid + ': unknown clinical update chapter')
        require(set(update.get('questionIds', [])) <= {q['sourceQuestionKey'] for q in expected['sourceQuestions']}, bid + ': unknown clinical update question')
    expected_ch = {c['id']: c for c in expected['chapters']}
    actual_ch = {c.get('id'): c for c in book.get('chapters', [])}
    require(len(actual_ch) == len(book.get('chapters', [])), bid + ': duplicate chapter ID')
    require(set(actual_ch) <= set(expected_ch), bid + ': unknown chapter')
    if complete: require(set(actual_ch) == set(expected_ch), bid + ': chapter denominator incomplete')
    units, signatures = {}, set()
    for cid, ch in actual_ch.items():
        src = expected_ch[cid]
        require(ch.get('number') == src['number'] and ch.get('title') == src['title'], cid + ': source chapter title/number drift')
        refs(ch.get('sourceRefs'), book['source']['pdfPageCount'], cid)
        if complete: require(ch.get('units'), cid + ': heading alone is not teaching')
        for u in ch.get('units', []):
            uid = u.get('id', '')
            require(re.fullmatch(re.escape(cid) + r'-u\d{2}', uid) and uid not in units, cid + ': invalid/duplicate stable unit ID')
            units[uid] = u
            text(u.get('title'), uid + ': title')
            refs(u.get('sourceRefs'), book['source']['pdfPageCount'], uid)
            require(u.get('status') in STATUSES, uid + ': review status required')
            for domain, keys in DOMAINS.items():
                values = u.get(domain, [])
                require(isinstance(values, list), uid + ': ' + domain + ' must be a list')
                if not values:
                    text(u.get('notApplicable', {}).get(domain), uid + ': empty ' + domain + ' needs specific notApplicable reason')
                for value in values:
                    if keys is None: text(value, uid + ': ' + domain)
                    else:
                        require(isinstance(value, dict), uid + ': ' + domain + ' item must be an object')
                        for key in keys:
                            if key == 'status': require(value.get(key) in IMAGES, uid + ': image status invalid')
                            else: text(value.get(key), uid + ': ' + domain + '.' + key)
            text(u.get('recall', {}).get('prompt'), uid + ': retrieval prompt')
            text(u.get('recall', {}).get('answer'), uid + ': retrieval answer')
            signature = json.dumps([u.get('mechanism'), u.get('clinicalClues'), u.get('management'), u.get('recall')], ensure_ascii=False)
            require(signature not in signatures, uid + ': entire unit template repeated without specific reasoning')
            signatures.add(signature)
            clinical_updates(u, uid)
    expected_q = {q['sourceQuestionKey']: q for q in expected['sourceQuestions']}
    actual_q = {}
    for q in book.get('questions', []):
        key, qid = q.get('sourceQuestionKey'), q.get('id')
        require(key in expected_q and key not in actual_q, bid + ': unknown/duplicate source question identity')
        src = expected_q[key]
        require(qid == key, bid + ': stable concept ID must match verified source identity')
        require(q.get('questionScope') == src['questionScope'] and str(q.get('sourceNumber')) == str(src['sourceNumber']), qid + ': original numbering changed')
        require(q.get('status') in STATUSES and q.get('imageStatus') in IMAGES, qid + ': status invalid')
        text(q.get('stem'), qid + ': stem');text(q.get('explanation'), qid + ': explanation')
        require(isinstance(q.get('correctIndex'), int) and 0 <= q['correctIndex'] <= 3, qid + ': correctIndex invalid')
        require(len(q.get('options', [])) == 4, qid + ': four options required')
        for o in q['options']:
            text(o.get('text'), qid + ': option text');text(o.get('rationale'), qid + ': option-specific rationale')
            require(o.get('whenTrue') is None or isinstance(o['whenTrue'], str), qid + ': whenTrue must be text or null')
        require(len({o['text'].strip() for o in q['options']}) == 4 and len({o['rationale'].strip() for o in q['options']}) == 4, qid + ': duplicated option/rationale')
        require(q.get('chapterIds') and set(q['chapterIds']) <= set(actual_ch), qid + ': chapter links unresolved')
        require(q.get('unitIds') and set(q['unitIds']) <= set(units), qid + ': unit links unresolved')
        refs(q.get('sourceRefs'), book['source']['pdfPageCount'], qid)
        clinical_updates(q, qid)
        actual_q[key] = q
    if complete: require(set(actual_q) == set(expected_q), bid + ': source question denominator incomplete')
    old = book.get('coverage', {})
    old_ch = {r['chapterId']: r for r in old.get('chapterRows', [])}
    old_q = {r['sourceQuestionKey']: r for r in old.get('questionRows', [])}
    chrows, qrows = [], []
    for cid, source in expected_ch.items():
        ch = actual_ch.get(cid)
        prior = old_ch.get(cid, {})
        ids = [u['id'] for u in (ch or {}).get('units', [])]
        coverage_status = prior.get('coverageStatus', 'partial')
        require(coverage_status in {'partial', 'independently-reviewed'}, cid + ': chapter coverage status invalid')
        status = 'unreviewed' if not ids else ('source-checked' if coverage_status == 'independently-reviewed' and all(units[uid]['status'] != 'draft' for uid in ids) else 'partial' if all(units[uid]['status'] != 'draft' for uid in ids) else 'draft')
        image = prior.get('originalImageStatus', 'not-reviewed')
        require(image in IMAGES, cid + ': image audit invalid')
        chrows.append({'chapterId': cid, 'unitIds': ids, 'teachingStatus': status, 'coverageStatus': coverage_status, 'originalImageStatus': image, 'gaps': prior.get('gaps', [] if ids else ['教材尚未補入'])})
    for key, source in expected_q.items():
        q, prior = actual_q.get(key), old_q.get(key, {})
        answer = prior.get('sourceAnswerStatus', 'unverified')
        image = prior.get('originalImageStatus', source.get('originalImageStatus', 'not-reviewed'))
        require(answer in {'unverified', 'matched', 'missing'} and image in IMAGES, key + ': source answer/image audit invalid')
        ready = bool(q and q['status'] != 'draft' and answer == 'matched' and (not q.get('requiresImage', False) or q['imageStatus'] == 'verified'))
        if q: q['readiness'] = 'ready' if ready else 'draft'
        qrows.append({'sourceQuestionKey': key, 'questionScope': source['questionScope'], 'sourceNumber': source['sourceNumber'], 'questionId': q['id'] if q else None, 'unitIds': q.get('unitIds', []) if q else [], 'conceptStatus': 'source-checked' if ready else 'draft' if q else 'unmapped', 'sourceAnswerStatus': answer, 'originalImageStatus': image, 'gaps': prior.get('gaps', [] if q else ['概念重述尚未補入'])})
    summary = {'taughtChapters': sum(r['teachingStatus'] == 'source-checked' for r in chrows), 'authoredChapters': sum(bool(r['unitIds']) for r in chrows), 'readyQuestions': sum(r['conceptStatus'] == 'source-checked' for r in qrows), 'authoredQuestions': len(actual_q), 'verifiedImages': sum(r['originalImageStatus'] == 'verified' for r in chrows + qrows)}
    book['coverage'] = {'chapterRows': chrows, 'questionRows': qrows, 'summary': summary}
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--numeric-audit', type=Path)
    args = parser.parse_args()
    manifest_path = args.root / 'content/textbook-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get('schemaVersion') == 1 and len(manifest['books']) == 13, 'verified thirteen-volume manifest required')
    audit = {'scope': 'Teaching and question content only; IDs, metadata pages and edition years excluded', 'claims': [], 'calculationChecks': []}
    summaries = []
    for expected in manifest['books']:
        path = args.root / expected['file']
        require(path.exists(), expected['bookId'] + ': per-volume content missing')
        book = json.loads(path.read_text())
        original = copy.deepcopy(book)
        summary = validate_book(book, expected, args.require_complete)
        summaries.append({'bookId': expected['bookId'], **summary})
        claims, calculations = numeric_claims(book)
        audit['claims'].extend(claims);audit['calculationChecks'].extend(calculations)
        if args.write: save(path, book)
        else: require(book == original, expected['bookId'] + ': derived coverage/readiness stale; run with --write')
        expected['coverage'] = summary
    if args.write: save(manifest_path, manifest)
    if args.numeric_audit: save(args.numeric_audit, audit)
    print(json.dumps({'books': summaries, 'numericClaimsRequiringIndependentReview': len(audit['claims']), 'calculationsRecomputed': len(audit['calculationChecks'])}, ensure_ascii=False))


if __name__ == '__main__':
    main()
