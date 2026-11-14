#!/usr/bin/env python3
"""Wire the Socratic tutor tab (scripts/tutor.{css,js}) into index.html idempotently.

The tab answers through scripts/tutor-server.py on the student's own Mac; on GitHub Pages it only shows how to start it.
Every hook is guarded by a marker, and each anchor sits at a boundary that no other apply-*.py script depends on
(checked by running every apply-*.py --check after inserting; see the tutor test in scripts/test-tutor.cjs).
The rail position (under 今日) lives in scripts/layout-shell.js and is injected by scripts/apply-layout.py.

    python3 scripts/apply-tutor.py           # write the hooks
    python3 scripts/apply-tutor.py --check   # fail if index.html is not current
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
VERSION = '20261115'

TUTOR_VIEW = (
    "tutor:()=>(setTimeout(()=>window.OphTutor?.mount(document.getElementById('tutor-root')),0),"
    "heading('','蘇格拉底家教','一次問一題，帶你把一個主題真的學會。回答來自你 Mac 上的 Claude Code（自己的 Claude 訂閱）。')"
    "+'<section id=\"tutor-root\" class=\"tutor-root\" aria-label=\"蘇格拉底家教\"><p class=\"small\" role=\"status\">正在載入家教…</p></section>')"
)

# (marker that proves the hook is in place, anchor, replacement)
PATCHES = [
    ('src="scripts/tutor.js',
     '<script src="scripts/knowledge-graph.js" defer></script>',
     '<script src="scripts/knowledge-graph.js" defer></script>\n'
     f'<link rel="stylesheet" href="scripts/tutor.css?v={VERSION}">\n'
     f'<script src="scripts/tutor.js?v={VERSION}" defer></script>'),
    ("['tutor','✎','蘇格拉底家教']",
     "['plan','▣','每日計畫'],['progress','◴','學習進度']",
     "['plan','▣','每日計畫'],['tutor','✎','蘇格拉底家教'],['progress','◴','學習進度']"),
    ("['家教',['tutor']]",
     "['考試安排',['schedule']],['閱讀',",
     "['考試安排',['schedule']],['家教',['tutor']],['閱讀',"),
    ("tutor:()=>(",
     "progress,pbl:pblPage",
     "progress," + TUTOR_VIEW + ",pbl:pblPage"),
]
# Placed by scripts/layout-shell.js (run scripts/apply-layout.py after editing it).
RAIL_HOME = "const NAV_LAYOUT=[['',['today','tutor']],"


def build(text: str) -> str:
    for marker, old, new in PATCHES:
        count = text.count(marker)
        if count > 1:
            raise ValueError(f'Tutor hook appears {count} times: {marker}')
        if count == 1:
            continue
        if text.count(old) != 1:
            raise ValueError(f'Tutor anchor changed (expected exactly one): {old[:90]}')
        text = text.replace(old, new, 1)
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='verify only; exit 1 if index.html is not current')
    args = ap.parse_args()
    old = INDEX.read_text(encoding='utf-8')
    new = build(old)
    if RAIL_HOME not in new:
        raise SystemExit('The tutor is not placed under 今日: update NAV_LAYOUT in scripts/layout-shell.js, then run scripts/apply-layout.py')
    if args.check:
        if old != new:
            raise SystemExit('Tutor hooks are not current; run python3 scripts/apply-tutor.py')
        print('Tutor hooks current.')
        return 0
    if old != new:
        INDEX.write_text(new, encoding='utf-8')
        print('Tutor hooks written.')
    else:
        print('Tutor hooks already current.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
