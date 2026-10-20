#!/usr/bin/env python3
"""Apply small, idempotent hooks to the current app without replacing its payload."""
import argparse
import datetime as dt
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def once(text, old, new):
    if new in text: return text
    if text.count(old) != 1: raise ValueError('Textbook insertion anchor changed: ' + old[:75])
    return text.replace(old, new, 1)


def build(html):
    result = once(html, '</head>', '<link rel="stylesheet" href="scripts/textbook-depth.css">\n<script src="scripts/textbook-depth.js" defer></script>\n</head>')
    result = once(result, 'const navs=[', "const navs=[['textbook','▥','原文書進階'],")
    result = once(result, "['閱讀',['cram','notebook','learn','links']]", "['閱讀',['textbook','cram','notebook','learn','links']]")
    result = once(result, 'sync:syncPage,cram:cramPage}', 'sync:syncPage,cram:cramPage,textbook:textbookPage}')
    old = "if(S.tab==='cram'&&window.OphCram)window.OphCram.mount(document.getElementById('cram-root'));}"
    new = old[:-1] + "if(S.tab==='textbook'&&window.OphTextbook)window.OphTextbook.mount(document.getElementById('textbook-root'));}"
    result = once(result, old, new)
    result = once(result, 'function validateEntry(key,v){const extra=practiceEntry(key,v);', 'function validateEntry(key,v){const textbook=textbookEntry(key,v);if(textbook!==undefined)return textbook;const extra=practiceEntry(key,v);')
    bridge = (ROOT / 'scripts/textbook-bridge.js').read_text().strip()
    if '/* textbook-bridge:start */' in result:
        result = re.sub(r'/\* textbook-bridge:start \*/.*?/\* textbook-bridge:end \*/', lambda _: bridge, result, count=1, flags=re.S)
    else:
        result = once(result, 'function render(){', bridge + '\nfunction render(){')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'index.html'
    original = path.read_text()
    result = build(original)
    if args.check:
        if result != original: raise SystemExit('Textbook hooks are not built into index.html')
        print('Textbook hooks current; no payload or unrelated blocks changed.')
        return
    if result != original:
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
        shutil.copy2(path, path.with_name(path.name + '.bak-' + stamp))
        path.write_text(result)
    print('Textbook hooks built. Content remains in on-demand per-volume JSON.')


if __name__ == '__main__':
    main()
