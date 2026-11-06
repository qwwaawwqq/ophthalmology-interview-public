#!/usr/bin/env python3
"""Validate content/written-qa/{oph,ent,rad,nm,neuro}.json against WRITTEN_QA_SCHEMA.md."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECIALTIES = ('oph', 'ent', 'rad', 'nm', 'neuro')
CATEGORIES = {'chapter', 'bcsc', 'hard'}
REQUIRED_ITEM_KEYS = {
    'id',
    'specialty',
    'category',
    'topicId',
    'bookId',
    'chapterId',
    'deepDiveId',
    'pblId',
    'workflowId',
    'cramHighYield',
    'format',
    'title',
    'prompt',
    'answer',
    'keyPoints',
    'pitfall',
    'sourceRef',
}

ID_RE = re.compile(r'^[a-z]+-wq-[a-z0-9-]+$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
RAW_LATEX_PATTERNS = (
    (re.compile(r'\$[^$\n]+\$'), 'inline $...$ math'),
    (re.compile(r'\\(?:frac|times|div|pm|geq|leq|rightarrow|leftarrow|leftrightarrow|alpha|beta|gamma|delta|mu|sigma|cdot|sqrt|text|textbf|mathrm)\b'), 'LaTeX command'),
    (re.compile(r'\^\{[^}]*\}|_\{[^}]*\}'), 'LaTeX superscript/subscript braces'),
)


def load_repo_targets(root: Path) -> dict:
    html = (root / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'<script[^>]*\bid="course-data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError('Unable to locate <script id="course-data"> in index.html')
    oph_data = json.loads(m.group(1))
    oph_chapters = [t['id'] for t in oph_data.get('topics', []) if t.get('chapter')]
    oph_topics = {t['id'] for t in oph_data.get('topics', []) if isinstance(t.get('id'), str)}

    pbl_oph = json.loads((root / 'content/pbl-cases.json').read_text(encoding='utf-8'))
    wf_oph = json.loads((root / 'content/clinical-workflows.json').read_text(encoding='utf-8'))

    targets = {
        'oph': {
            'chapters': set(oph_chapters),
            'topics': oph_topics,
            'pbl': {c['id'] for c in pbl_oph.get('cases', [])},
            'workflows': {w['id'] for w in wf_oph.get('workflows', [])},
        }
    }

    for sid in ('ent', 'rad', 'nm', 'neuro'):
        topics = json.loads((root / 'content' / sid / 'topics.json').read_text(encoding='utf-8'))
        pbl_path = next(p for name in ('pbl-cases.json', 'pbl.json') if (p := root / 'content' / sid / name).is_file())
        wf_path = next(p for name in ('clinical-workflows.json', 'workflows.json') if (p := root / 'content' / sid / name).is_file())
        pbl_raw = json.loads(pbl_path.read_text(encoding='utf-8'))
        wf_raw = json.loads(wf_path.read_text(encoding='utf-8'))
        pbl_list = pbl_raw.get('cases', []) if isinstance(pbl_raw, dict) else pbl_raw
        wf_list = wf_raw.get('workflows', []) if isinstance(wf_raw, dict) else wf_raw
        targets[sid] = {
            'chapters': {t['id'] for t in topics if t.get('chapter')},
            'topics': {t['id'] for t in topics if isinstance(t.get('id'), str)},
            'pbl': {c['id'] for c in pbl_list},
            'workflows': {w['id'] for w in wf_list},
        }

    manifest = json.loads((root / 'content/textbook-manifest.json').read_text(encoding='utf-8'))
    bcsc_chapters = {}
    for book in manifest.get('books', []):
        bid = book['bookId']
        bdata = json.loads((root / book['file']).read_text(encoding='utf-8'))
        bcsc_chapters[bid] = {ch['id'] for ch in bdata.get('chapters', [])}

    adv = json.loads((root / 'content/textbook-depth/advanced-practice.json').read_text(encoding='utf-8'))
    deep_dives = {d['id'] for d in adv.get('deepDives', []) if d.get('status') == 'source-checked'}

    return {
        'by_spec': targets,
        'bcsc_chapters': bcsc_chapters,
        'deep_dives': deep_dives,
    }


def check_prose_hygiene(text: str, label: str, errors: list[str]) -> None:
    if CTRL_RE.search(text):
        errors.append(f'{label}: contains forbidden control character')
    for regex, desc in RAW_LATEX_PATTERNS:
        hit = regex.search(text)
        if hit:
            errors.append(f'{label}: contains forbidden raw LaTeX ({desc}: {hit.group(0)!r})')
            break


def require_non_empty_str(val, label: str, errors: list[str], min_len: int = 1, max_len: int | None = None) -> str:
    if not isinstance(val, str) or not val.strip():
        errors.append(f'{label}: non-empty string required')
        return ''
    check_prose_hygiene(val, label, errors)
    stripped = val.strip()
    if len(stripped) < min_len:
        errors.append(f'{label}: length {len(stripped)} < minimum {min_len}')
    if max_len is not None and len(stripped) > max_len:
        errors.append(f'{label}: length {len(stripped)} > maximum {max_len}')
    return stripped


def validate_pack(sid: str, path: Path, repo_targets: dict, global_ids: set[str], errors: list[str]) -> int:
    raw_bytes = path.read_text(encoding='utf-8')
    if CTRL_RE.search(raw_bytes):
        errors.append(f'{path.name}: raw file contains forbidden control characters')
    try:
        data = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        errors.append(f'{path.name}: invalid JSON ({exc})')
        return 0

    if not isinstance(data, dict):
        errors.append(f'{path.name}: top-level JSON value must be an object')
        return 0
    if data.get('schemaVersion') != 1:
        errors.append(f'{path.name}: schemaVersion must be 1')
    if data.get('specialty') != sid:
        errors.append(f'{path.name}: specialty must be {sid!r}, got {data.get("specialty")!r}')
    require_non_empty_str(data.get('title'), f'{path.name}.title', errors, min_len=4, max_len=120)
    updated = data.get('updated')
    if not isinstance(updated, str) or not DATE_RE.fullmatch(updated):
        errors.append(f'{path.name}.updated: YYYY-MM-DD date string required')
    require_non_empty_str(data.get('disclaimer'), f'{path.name}.disclaimer', errors, min_len=15, max_len=400)

    items = data.get('items')
    if not isinstance(items, list) or not items:
        errors.append(f'{path.name}.items: non-empty list required')
        return 0

    spec_targets = repo_targets['by_spec'][sid]
    bcsc_chapters = repo_targets['bcsc_chapters']
    deep_dives = repo_targets['deep_dives']

    covered_chapters: set[str] = set()
    covered_bcsc_books: set[str] = set()
    covered_deep_dives: set[str] = set()
    covered_pbl: set[str] = set()
    covered_workflows: set[str] = set()

    for idx, item in enumerate(items):
        ilabel = f'{path.name}.items[{idx}]'
        if not isinstance(item, dict):
            errors.append(f'{ilabel}: must be an object')
            continue

        missing_keys = REQUIRED_ITEM_KEYS - set(item.keys())
        extra_keys = set(item.keys()) - REQUIRED_ITEM_KEYS
        if missing_keys:
            errors.append(f'{ilabel}: missing required keys {sorted(missing_keys)}')
        if extra_keys:
            errors.append(f'{ilabel}: unexpected keys {sorted(extra_keys)}')

        qid = item.get('id')
        if not isinstance(qid, str) or not ID_RE.fullmatch(qid) or len(qid) > 80:
            errors.append(f'{ilabel}.id: invalid id {qid!r} (expected /^[a-z]+-wq-[a-z0-9-]+$/ <= 80 chars)')
        else:
            ilabel = f'{path.name}:{qid}'
            if not qid.startswith(f'{sid}-wq-'):
                errors.append(f'{ilabel}.id: must start with "{sid}-wq-"')
            if qid in global_ids:
                errors.append(f'{ilabel}.id: duplicate id {qid!r}')
            global_ids.add(qid)

        if item.get('specialty') != sid:
            errors.append(f'{ilabel}.specialty: expected {sid!r}, got {item.get("specialty")!r}')

        cat = item.get('category')
        if cat not in CATEGORIES:
            errors.append(f'{ilabel}.category: invalid category {cat!r}')
        if sid != 'oph' and cat != 'chapter':
            errors.append(f'{ilabel}.category: non-oph specialty {sid!r} must use category "chapter"')

        topic_id = item.get('topicId')
        if not isinstance(topic_id, str) or topic_id not in spec_targets['topics']:
            errors.append(f'{ilabel}.topicId: unknown topicId {topic_id!r} for {sid}')
        elif cat == 'chapter' and topic_id in spec_targets['chapters']:
            covered_chapters.add(topic_id)

        book_id = item.get('bookId')
        chapter_id = item.get('chapterId')
        deep_id = item.get('deepDiveId')

        if cat == 'bcsc':
            if not isinstance(book_id, str) or book_id not in bcsc_chapters:
                errors.append(f'{ilabel}.bookId: valid BCSC bookId required for category "bcsc", got {book_id!r}')
            else:
                covered_bcsc_books.add(book_id)
                if not isinstance(chapter_id, str) or chapter_id not in bcsc_chapters[book_id]:
                    errors.append(f'{ilabel}.chapterId: {chapter_id!r} not found in {book_id}')
            if deep_id is not None:
                errors.append(f'{ilabel}.deepDiveId: must be null for category "bcsc"')
        elif cat == 'hard':
            if not isinstance(deep_id, str) or deep_id not in deep_dives:
                errors.append(f'{ilabel}.deepDiveId: valid deepDiveId required for category "hard", got {deep_id!r}')
            else:
                covered_deep_dives.add(deep_id)
            if book_id is not None and (not isinstance(book_id, str) or book_id not in bcsc_chapters):
                errors.append(f'{ilabel}.bookId: invalid BCSC bookId {book_id!r}')
            if chapter_id is not None:
                if not isinstance(book_id, str) or book_id not in bcsc_chapters or chapter_id not in bcsc_chapters[book_id]:
                    errors.append(f'{ilabel}.chapterId: invalid chapterId {chapter_id!r} for bookId {book_id!r}')
        else:
            if book_id is not None:
                errors.append(f'{ilabel}.bookId: must be null for category "chapter"')
            if chapter_id is not None:
                errors.append(f'{ilabel}.chapterId: must be null for category "chapter"')
            if deep_id is not None:
                errors.append(f'{ilabel}.deepDiveId: must be null for category "chapter"')

        pbl_id = item.get('pblId')
        if pbl_id is not None:
            if not isinstance(pbl_id, str) or pbl_id not in spec_targets['pbl']:
                errors.append(f'{ilabel}.pblId: unknown pblId {pbl_id!r} for {sid}')
            else:
                covered_pbl.add(pbl_id)

        wf_id = item.get('workflowId')
        if wf_id is not None:
            if not isinstance(wf_id, str) or wf_id not in spec_targets['workflows']:
                errors.append(f'{ilabel}.workflowId: unknown workflowId {wf_id!r} for {sid}')
            else:
                covered_workflows.add(wf_id)

        if type(item.get('cramHighYield')) is not bool:
            errors.append(f'{ilabel}.cramHighYield: boolean required')

        require_non_empty_str(item.get('format'), f'{ilabel}.format', errors, min_len=2, max_len=40)
        require_non_empty_str(item.get('title'), f'{ilabel}.title', errors, min_len=4, max_len=120)
        require_non_empty_str(item.get('prompt'), f'{ilabel}.prompt', errors, min_len=55, max_len=3000)
        require_non_empty_str(item.get('answer'), f'{ilabel}.answer', errors, min_len=90, max_len=5000)
        require_non_empty_str(item.get('pitfall'), f'{ilabel}.pitfall', errors, min_len=20, max_len=1000)
        require_non_empty_str(item.get('sourceRef'), f'{ilabel}.sourceRef', errors, min_len=4, max_len=300)

        kps = item.get('keyPoints')
        if not isinstance(kps, list) or not (3 <= len(kps) <= 5):
            errors.append(f'{ilabel}.keyPoints: list of 3 to 5 strings required')
        else:
            for kp_idx, kp in enumerate(kps):
                require_non_empty_str(kp, f'{ilabel}.keyPoints[{kp_idx}]', errors, min_len=12, max_len=120)

    missing_chapters = sorted(spec_targets['chapters'] - covered_chapters)
    if missing_chapters:
        errors.append(f'{path.name}: missing chapter coverage for {missing_chapters}')

    missing_pbl = sorted(spec_targets['pbl'] - covered_pbl)
    if missing_pbl:
        errors.append(f'{path.name}: missing direct pblId coverage for {missing_pbl}')

    missing_wf = sorted(spec_targets['workflows'] - covered_workflows)
    if missing_wf:
        errors.append(f'{path.name}: missing direct workflowId coverage for {missing_wf}')

    if sid == 'oph':
        missing_books = sorted(set(bcsc_chapters.keys()) - covered_bcsc_books)
        if missing_books:
            errors.append(f'{path.name}: missing BCSC book coverage for {missing_books}')
        missing_dd = sorted(deep_dives - covered_deep_dives)
        if missing_dd:
            errors.append(f'{path.name}: missing Hard deepDiveId coverage for {missing_dd}')

    return len(items)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', type=Path, default=ROOT / 'content/written-qa', help='Directory containing <spec>.json packs')
    parser.add_argument('--allow-missing', action='store_true', help='Allow missing specialty JSON files while content workers finish')
    args = parser.parse_args()

    repo_targets = load_repo_targets(ROOT)
    errors: list[str] = []
    global_ids: set[str] = set()
    counts: dict[str, int] = {}
    missing_specs: list[str] = []

    for sid in SPECIALTIES:
        pack_path = args.dir / f'{sid}.json'
        if not pack_path.is_file():
            if args.allow_missing:
                missing_specs.append(sid)
                continue
            errors.append(f'Missing required written-qa pack: {pack_path}')
            continue
        counts[sid] = validate_pack(sid, pack_path, repo_targets, global_ids, errors)

    if errors:
        for err in errors[:50]:
            print(f'ERROR: {err}', file=sys.stderr)
        if len(errors) > 50:
            print(f'... and {len(errors) - 50} more errors', file=sys.stderr)
        raise SystemExit(1)

    total = sum(counts.values())
    if missing_specs and not counts:
        print(f'Written Q&A validation skipped missing packs (--allow-missing): {", ".join(missing_specs)}')
        return
    summary = ', '.join(f'{sid}={n}' for sid, n in counts.items())
    extra = f' (missing allowed: {", ".join(missing_specs)})' if missing_specs else ''
    print(f'Written Q&A validation passed: {len(counts)} packs, {total} total items ({summary}){extra}.')


if __name__ == '__main__':
    main()
