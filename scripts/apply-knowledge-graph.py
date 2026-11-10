#!/usr/bin/env python3
"""Wire the chapter knowledge graph (scripts/knowledge-graph.{css,js}) into index.html idempotently.

The page calls OphKnowledgeGraph.sync from syncPracticeHash in scripts/practice-ui.js.
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'

CSS_OLD = '<link rel="stylesheet" href="scripts/knowledge-map.css">'
CSS_NEW = CSS_OLD + '\n<link rel="stylesheet" href="scripts/knowledge-graph.css">'
JS_OLD = '<script src="scripts/knowledge-map.js" defer></script>'
JS_NEW = JS_OLD + '\n<script src="scripts/knowledge-graph.js" defer></script>'


def once(text, old, new, label):
    if new in text:
        return text
    if text.count(old) != 1:
        raise SystemExit(f'{label}: anchor found {text.count(old)} times')
    return text.replace(old, new)


def build(text):
    text = once(text, CSS_OLD, CSS_NEW, 'stylesheet')
    return once(text, JS_OLD, JS_NEW, 'script')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    current = INDEX.read_text(encoding='utf-8')
    built = build(current)
    if args.check:
        if built != current:
            print('index.html is missing the knowledge graph hooks; run scripts/apply-knowledge-graph.py')
            return 1
        print('knowledge graph hooks present')
        return 0
    if built != current:
        INDEX.write_text(built, encoding='utf-8')
    print('knowledge graph hooks applied')
    return 0


if __name__ == '__main__':
    sys.exit(main())
