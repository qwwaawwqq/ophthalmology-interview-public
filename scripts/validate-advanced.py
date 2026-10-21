#!/usr/bin/env python3
"""Validate the additional reviewed hard pack without changing the original 120-question acceptance."""
import ast
import hashlib
import json
import math
import operator
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PACK = 'advanced-20261022'
HASH_DEFINITION = "sha256(json.dumps(question excluding status/readiness, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode('utf-8'))"
def require(ok, message):
    if not ok: raise ValueError(message)
def text(value, name):
    require(isinstance(value, str) and value.strip(), name + ': missing text')
def content_hash(question):
    content = {k: v for k, v in question.items() if k not in {'status', 'readiness'}}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
def strings(value):
    if isinstance(value, dict):
        for v in value.values(): yield from strings(v)
    elif isinstance(value, list):
        for v in value: yield from strings(v)
    elif isinstance(value, str): yield value

def arithmetic(expression, inputs):
    ops = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}
    def calc(node):
        if isinstance(node, ast.Expression): return calc(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float): return node.value
        if isinstance(node, ast.Name) and node.id in inputs: return inputs[node.id]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'abs' and len(node.args) == 1 and not node.keywords: return abs(calc(node.args[0]))
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            a, b = calc(node.left), calc(node.right)
            require(not isinstance(node.op, ast.Pow) or abs(b) <= 10, 'calculation exponent too large')
            return ops[type(node.op)](a, b)
        if isinstance(node, ast.UnaryOp) and type(node.op) in ops: return ops[type(node.op)](calc(node.operand))
        raise ValueError('calculation: only literal arithmetic and declared inputs are allowed')
    value = calc(ast.parse(expression, mode='eval'))
    require(math.isfinite(value), 'calculation result is not finite')
    return value

def validate(root=ROOT):
    read = lambda name: json.loads((root / name).read_text())
    pack = read('content/textbook-depth/advanced-practice.json')
    review = read('content/textbook-depth/advanced-review.json')
    manifest = read('content/textbook-manifest.json')
    books = {b['bookId']: b for b in manifest['books']}
    units = {bid: {u['id'] for ch in read(b['file'])['chapters'] for u in ch['units']} for bid, b in books.items()}
    require(pack.get('schemaVersion') == 1 and pack.get('packId') == PACK, 'advanced pack identity mismatch')
    require(pack.get('origin') == 'original-extra-practice' and pack.get('questionScope') == 'original-practice' and pack.get('officialCoverageCredit') is False, 'advanced pack original-practice scope required')
    for key in ['title', 'description', 'notice']: text(pack.get(key), key)
    questions = pack.get('questions')
    require(isinstance(questions, list) and 1 <= len(questions) <= 200, 'approved pack must contain between 1 and 200 questions')
    ids = [q.get('id') for q in questions]
    require(len(set(ids)) == len(ids), 'duplicate advanced stable IDs')
    require(review.get('schemaVersion') == 1 and review.get('packId') == PACK and review.get('hashDefinition') == HASH_DEFINITION, 'review identity/hash definition mismatch')
    items = review.get('items')
    require(isinstance(items, list) and len(items) == len(questions), 'exact per-question review records required')
    reviews = {v.get('id'): v for v in items}
    require(len(reviews) == len(items) and set(reviews) == set(ids), 'reviewed IDs must exactly equal published IDs')
    for q in questions:
        qid = q['id']; require(bool(re.fullmatch(r'extra-20261022-q\d{3}', qid)), 'invalid advanced stable ID')
        require(q.get('questionScope') == 'original-practice' and q.get('difficulty') == 'advanced', qid + ': original advanced scope required')
        require(q.get('status') == 'source-checked' and q.get('readiness') == 'ready', qid + ': only approved ready content may be published')
        require(q.get('requiresImage') is False and q.get('imageStatus') == 'not-applicable', qid + ': unresolved images cannot enter hard training')
        require(bool(re.fullmatch(r'[a-z][a-z0-9-]*', q.get('domain', ''))), qid + ': single primary domain required')
        for key in ['stem', 'explanation', 'testConcept', 'questionType']: text(q.get(key), qid + '.' + key)
        options = q.get('options'); require(isinstance(options, list) and len(options) == 4, qid + ': four options required')
        for option in options:
            for key in ['text', 'rationale', 'whenTrue']: text(option.get(key), qid + '.option.' + key)
        require(len({o['text'] for o in options}) == 4 and len({o['rationale'] for o in options}) == 4, qid + ': duplicate distractors/rationales')
        require(type(q.get('correctIndex')) is int and 0 <= q['correctIndex'] < 4, qid + ': invalid source answer index')
        require(type(q.get('closestDistractorIndex')) is int and 0 <= q['closestDistractorIndex'] < 4 and q['closestDistractorIndex'] != q['correctIndex'], qid + ': closest distractor source index required')
        text(q.get('decisiveDiscriminator'), qid + ': decisive discriminator');text(q.get('counterfactual'), qid + ': counterfactual')
        require(not re.search(r'(?:改選|選項)\s*[ABCD](?![a-z])', q['counterfactual']), qid + ': source-letter counterfactual must use semantic option text or source index')
        require(q.get('counterfactualIndex') is None or type(q['counterfactualIndex']) is int and 0 <= q['counterfactualIndex'] < 4, qid + ': counterfactual source index invalid')
        steps = q.get('reasoningSteps'); require(isinstance(steps, list) and 2 <= len(steps) <= 8, qid + ': multistep explanation required')
        for step in steps: text(step, qid + ': reasoning step')
        bid = q.get('bookId'); require(bid in books, qid + ': unknown primary book')
        chapters = q.get('chapterIds'); require(isinstance(chapters, list) and chapters and set(chapters) <= {c['id'] for b in books.values() for c in b['chapters']}, qid + ': unresolved chapter links')
        linked = q.get('unitIds'); require(isinstance(linked, list) and linked, qid + ': related concept links required')
        for uid in linked:
            match = re.match(r'^(bcsc-s\d{2})-', uid); require(match and uid in units.get(match[1], set()), qid + ': unresolved unit ' + uid)
        refs = q.get('sourceRefs'); require(isinstance(refs, list) and refs, qid + ': source anchors required')
        for ref in refs:
            source = books.get(ref.get('bookId', bid)); require(source is not None, qid + ': unknown source book')
            pages = ref.get('pdfPages'); require(isinstance(pages, list) and pages and all(type(p) is int and 1 <= p <= source['source']['pdfPageCount'] for p in pages), qid + ': source page outside source')
            text(ref.get('chapterHeading'), qid + ': source heading')
        for ref in q.get('externalRefs', []):
            require(isinstance(ref.get('url'), str) and ref['url'].startswith('https://'), qid + ': external source must use HTTPS')
            text(ref.get('title'), qid + ': external source title')
        r = reviews[qid]
        require(r.get('contentSha256') == content_hash(q), qid + ': approved content hash changed')
        require(all(r.get(k) == 'pass' for k in ['medical', 'hardness', 'source']) and r.get('numbers') in ['pass', 'not-applicable'], qid + ': incomplete independent acceptance')
        for check in q.get('calculationAudit', []):
            inputs = check.get('inputs', {}); require(isinstance(inputs, dict) and all(type(v) in (int, float) and math.isfinite(v) for v in inputs.values()), qid + ': invalid arithmetic inputs')
            value = arithmetic(check['formula'], inputs); expected = check['expected']; tolerance = check.get('tolerance', 1e-8)
            require(type(expected) in (int, float) and type(tolerance) in (int, float) and 0 <= tolerance <= 1 and math.isclose(value, expected, rel_tol=tolerance, abs_tol=tolerance), qid + ': arithmetic mismatch')
    require(all('/Users/' not in value and 'private-text/' not in value and 'file://' not in value for value in strings([pack, review])), 'private filesystem/source data in public pack')
    return {'packId': PACK, 'approvedQuestions': len(questions), 'domains': sorted({q['domain'] for q in questions}), 'contentHashMatched': True}
if __name__ == '__main__': print(json.dumps(validate(), ensure_ascii=False, indent=2))
