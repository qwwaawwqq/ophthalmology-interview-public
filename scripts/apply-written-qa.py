#!/usr/bin/env python3
"""Wire the Written Q&A module (scripts/written-qa.{css,js}) into index.html idempotently."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
CSS_TAG = '<link rel="stylesheet" href="scripts/written-qa.css">'
JS_TAG = '<script src="scripts/written-qa.js" defer></script>'
HEAD_ANCHOR = '<script defer src="scripts/cram-review.js?v=20261103"></script>'
RENDER_ANCHOR = "if(S.tab==='cram'&&window.OphCram)window.OphCram.mount(document.getElementById('cram-root'));"
RENDER_HOOK = "window.OphWritten?.bindContainer?.($('#main'));"

REQUIRED_INDEX_HOOKS = (
    CSS_TAG,
    JS_TAG,
    RENDER_HOOK,
    'window.OphWritten?.quizBankHtml',
    'window.OphWritten?.chapterHtml',
    'window.OphWritten?.contextHtml',
    'window.OphWritten?.searchIndex',
    'window.OphWrittenBridge=',
    'window.OphWritten?.clearLocalCache',
    "pool==='written'",
)

REQUIRED_EXTERNAL_HOOKS = (
    ('scripts/textbook-depth.js', 'bcscBookHtml'),
    ('scripts/textbook-depth.js', 'bcscChapterHtml'),
    ('scripts/cram-review.js', 'cramSectionHtml'),
    ('scripts/advanced-training.js', 'hardBankHtml'),
    ('scripts/advanced-training.js', 'deepDiveHtml'),
    ('scripts/study-srs.js', "written:'手寫問答'"),
)


def once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if text.count(old) != 1:
        raise ValueError(f'Written Q&A anchor changed ({label}): {old[:90]}')
    return text.replace(old, new, 1)


def build(html: str) -> str:
    head_Target = f'{HEAD_ANCHOR}\n{CSS_TAG}\n{JS_TAG}'
    if CSS_TAG not in html and JS_TAG not in html:
        html = once(html, HEAD_ANCHOR, head_Target, 'head assets')
    elif CSS_TAG not in html:
        html = once(html, JS_TAG, f'{CSS_TAG}\n{JS_TAG}', 'css link')
    elif JS_TAG not in html:
        html = once(html, CSS_TAG, f'{CSS_TAG}\n{JS_TAG}', 'js script')
    html = once(html, RENDER_ANCHOR, RENDER_ANCHOR + RENDER_HOOK, 'render bindContainer')
    return html


def verify_hooks(html: str) -> None:
    for asset in ('scripts/written-qa.css', 'scripts/written-qa.js'):
        if not (ROOT / asset).is_file():
            raise SystemExit(f'Missing required asset: {asset}')
    missing = [hook for hook in REQUIRED_INDEX_HOOKS if hook not in html]
    if missing:
        raise SystemExit(f'Missing Written Q&A hooks in index.html: {missing}')
    for rel_path, token in REQUIRED_EXTERNAL_HOOKS:
        src = (ROOT / rel_path).read_text(encoding='utf-8')
        if token not in src:
            raise SystemExit(f'Missing Written Q&A hook {token!r} in {rel_path}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify hooks without modifying files')
    args = parser.parse_args()

    original = INDEX.read_text(encoding='utf-8')
    updated = build(original)
    if args.check:
        if updated != original:
            raise SystemExit('Written Q&A hooks are not built into index.html; run python3 scripts/apply-written-qa.py')
        verify_hooks(original)
        print('Written Q&A hooks current across index.html and external scripts.')
        return

    verify_hooks(updated)
    if updated != original:
        backup = INDEX.with_name(INDEX.name + '.bak-20261107')
        if not backup.exists():
            shutil.copy2(INDEX, backup)
        INDEX.write_text(updated, encoding='utf-8')
    print('Written Q&A hooks built.')


if __name__ == '__main__':
    main()
