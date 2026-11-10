#!/usr/bin/env python3
"""Wire the Interactive Knowledge Map (scripts/knowledge-map.{css,js}) into index.html idempotently."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
PRACTICE_JS = ROOT / 'scripts/practice-ui.js'
LAYOUT_JS = ROOT / 'scripts/layout-shell.js'
KM_CSS = ROOT / 'scripts/knowledge-map.css'
KM_MOTION_JS = ROOT / 'scripts/knowledge-map-motion.js'
KM_JS = ROOT / 'scripts/knowledge-map.js'

CSS_TAG = '<link rel="stylesheet" href="scripts/knowledge-map.css">'
MOTION_JS_TAG = '<script src="scripts/knowledge-map-motion.js" defer></script>'
JS_TAG = '<script src="scripts/knowledge-map.js" defer></script>'
HEAD_ANCHOR = '<script src="scripts/written-qa.js" defer></script>'

NAVS_OLD = "['workshop','◇','故事與證據'],['plan','▣','每日計畫']"
NAVS_NEW = "['workshop','◇','故事與證據'],['map','❖','知識地圖'],['plan','▣','每日計畫']"

GROUP_OLD = "['演練',['quiz','interview','pbl','workflow','workshop']]"
GROUP_NEW = "['演練',['quiz','interview','pbl','workflow','workshop','map']]"

PAGE_OLD = "/* study-bridge:end */\nfunction schedulePage(){"
PAGE_NEW = (
    "/* study-bridge:end */\n"
    "function mapPage(){return '<section id=\"knowledge-map-root\" class=\"km-shell\" aria-label=\"知識地圖\">"
    "<p class=\"km-loading\" role=\"status\">正在載入知識地圖…</p></section>';}\n"
    "function schedulePage(){"
)

VIEW_OLD = "workflow:workflowPage,links:linksPage,sync:syncPage"
VIEW_NEW = "workflow:workflowPage,map:mapPage,links:linksPage,sync:syncPage"

MOUNT_OLD = "window.OphWritten?.bindContainer?.($('#main'));if(S.tab==='textbook'"
MOUNT_V1 = (
    "window.OphWritten?.bindContainer?.($('#main'));"
    "if(S.tab==='map'&&window.OphKnowledgeMap)window.OphKnowledgeMap.mount("
    "document.getElementById('knowledge-map-root'),"
    "{specialty:SPEC.id,specialtyLabel:SPEC.label,appTitle:SPEC.appTitle,selectedNodeId:S.mapNode||'',"
    "topics:D.topics,questions:D.questions,interview:D.interview,pbl:D.pbl,workflows:D.workflows,"
    "openRoute,switchTab,tabAllowed,onSelectNode(id){S.mapNode=id||'';syncPracticeHash();}});"
    "if(S.tab==='textbook'"
)
MOUNT_NEW = (
    "window.OphWritten?.bindContainer?.($('#main'));"
    "if(S.tab==='map'&&window.OphKnowledgeMap)window.OphKnowledgeMap.mount("
    "document.getElementById('knowledge-map-root'),"
    "{specialty:SPEC.id,specialtyLabel:SPEC.label,appTitle:SPEC.appTitle,selectedNodeId:S.mapNode||'',"
    "nodeId:S.mapNode||'',explicitRoute:Boolean(S.mapRouteExplicit),"
    "topics:D.topics,questions:D.questions,interview:D.interview,pbl:D.pbl,workflows:D.workflows,"
    "openRoute,switchTab,tabAllowed,onSelectNode(id){S.mapNode=id||'';S.mapRouteExplicit=true;syncPracticeHash();}});"
    "if(S.tab==='textbook'"
)

REQUIRED_INDEX_HOOKS = (
    CSS_TAG,
    MOTION_JS_TAG,
    JS_TAG,
    "['map','❖','知識地圖']",
    GROUP_NEW,
    'function mapPage(){',
    'map:mapPage',
    "window.OphKnowledgeMap.mount(document.getElementById('knowledge-map-root')",
    'explicitRoute:Boolean(S.mapRouteExplicit)',
    "['sync','⇅','保存與同步'],['project','◉','甄試訓練日誌']];",
    "function navMarkup(){const groups=[['訓練專案',['project']],",
)

REQUIRED_EXTERNAL_HOOKS = (
    ('scripts/practice-ui.js', '#knowledge-map'),
    ('scripts/practice-ui.js', 'data-knowledge-map-card'),
    ('scripts/practice-ui.js', 'mapRouteExplicit'),
    ('scripts/layout-shell.js', "['面試',['interview','pbl','workflow','workshop','map','project']]"),
    ('scripts/knowledge-map-motion.js', 'OphKnowledgeMotion'),
    ('scripts/knowledge-map.js', 'OphKnowledgeMap'),
    ('scripts/knowledge-map.js', 'setStudioMode'),
    ('scripts/knowledge-map.js', 'buildObsidianMarkdown'),
)


def once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if text.count(old) != 1:
        raise ValueError(f'Knowledge Map anchor changed ({label}): {old[:95]}')
    return text.replace(old, new, 1)


def sync_block(html: str, start_marker: str, end_marker: str, block_path: Path, label: str) -> str:
    block = block_path.read_text(encoding='utf-8').strip()
    if '</script' in block.lower():
        raise ValueError(f'{label} must not contain a closing script tag')
    pattern = re.escape(start_marker) + r'.*?' + re.escape(end_marker)
    updated, count = re.subn(pattern, lambda _: block, html, count=1, flags=re.S)
    if count != 1:
        raise ValueError(f'Missing inline block markers for {label}')
    return updated


def build(html: str) -> str:
    head_target = f'{HEAD_ANCHOR}\n{CSS_TAG}\n{MOTION_JS_TAG}\n{JS_TAG}'
    if CSS_TAG not in html and MOTION_JS_TAG not in html and JS_TAG not in html:
        html = once(html, HEAD_ANCHOR, head_target, 'head assets')
    else:
        if CSS_TAG not in html:
            anchor = MOTION_JS_TAG if MOTION_JS_TAG in html else JS_TAG
            html = once(html, anchor, f'{CSS_TAG}\n{anchor}', 'css link')
        if JS_TAG not in html:
            anchor = MOTION_JS_TAG if MOTION_JS_TAG in html else CSS_TAG
            html = once(html, anchor, f'{anchor}\n{JS_TAG}', 'js script')
        if MOTION_JS_TAG not in html:
            html = once(html, JS_TAG, f'{MOTION_JS_TAG}\n{JS_TAG}', 'motion js script')

    html = sync_block(html, '/* layout-shell:start */', '/* layout-shell:end */', LAYOUT_JS, 'layout-shell.js')
    html = sync_block(html, '/* practice-ui:start */', '/* practice-ui:end */', PRACTICE_JS, 'practice-ui.js')

    html = once(html, NAVS_OLD, NAVS_NEW, 'navs map item')
    html = once(html, GROUP_OLD, GROUP_NEW, 'navMarkup practice group')
    html = once(html, PAGE_OLD, PAGE_NEW, 'mapPage function')
    html = once(html, VIEW_OLD, VIEW_NEW, 'render view map')
    if MOUNT_V1 in html and MOUNT_NEW not in html:
        html = once(html, MOUNT_V1, MOUNT_NEW, 'render OphKnowledgeMap.mount upgrade')
    else:
        html = once(html, MOUNT_OLD, MOUNT_NEW, 'render OphKnowledgeMap.mount')
    return html


def verify_hooks(html: str) -> None:
    for asset in (KM_CSS, KM_MOTION_JS, KM_JS, PRACTICE_JS, LAYOUT_JS):
        if not asset.is_file():
            raise SystemExit(f'Missing required asset: {asset.relative_to(ROOT)}')
    missing = [hook for hook in REQUIRED_INDEX_HOOKS if hook not in html]
    if missing:
        raise SystemExit(f'Missing Knowledge Map hooks in index.html: {missing}')
    if html.index(MOTION_JS_TAG) >= html.index(JS_TAG):
        raise SystemExit('scripts/knowledge-map-motion.js must appear before scripts/knowledge-map.js in index.html')
    for rel_path, token in REQUIRED_EXTERNAL_HOOKS:
        src = (ROOT / rel_path).read_text(encoding='utf-8')
        if token not in src:
            raise SystemExit(f'Missing Knowledge Map hook {token!r} in {rel_path}')

    app_scripts = re.findall(r'<script>([\s\S]*?)</script>', html)
    if not app_scripts:
        raise SystemExit('Missing inline application <script> in index.html')
    app_js = app_scripts[-1]
    if not re.search(r'render\(\);\s*\}\)\(\);\s*$', app_js):
        raise SystemExit('Inline application script must end with render();})();')

    if shutil.which('node'):
        for label, code in (
            ('index.html inline script', app_js),
            ('scripts/knowledge-map-motion.js', KM_MOTION_JS.read_text(encoding='utf-8')),
            ('scripts/knowledge-map.js', KM_JS.read_text(encoding='utf-8')),
        ):
            checked = subprocess.run(['node', '--check'], input=code, text=True, capture_output=True)
            if checked.returncode != 0:
                raise SystemExit(f'JavaScript syntax check failed for {label}: {checked.stderr}')


def write_atomic(target: Path, content: str) -> None:
    data = content.encode('utf-8')
    fd, tmp_name = tempfile.mkstemp(prefix=target.name + '.tmp-', dir=str(target.parent))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
        os.replace(tmp_name, target)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify Knowledge Map hooks without modifying files')
    parser.add_argument('--backup-dir', type=Path, default=None, help='Optional directory outside git tree to store a backup before writing')
    args = parser.parse_args()

    original = INDEX.read_text(encoding='utf-8')
    updated = build(original)
    if args.check:
        if updated != original:
            raise SystemExit('Knowledge Map hooks are not current in index.html; run python3 scripts/apply-knowledge-map.py')
        verify_hooks(original)
        print('Knowledge Map hooks current across index.html and external scripts; course payloads preserved.')
        return

    verify_hooks(updated)
    if updated != original:
        if args.backup_dir is not None:
            args.backup_dir.mkdir(parents=True, exist_ok=True)
            backup_target = args.backup_dir / INDEX.name
            if not backup_target.exists():
                shutil.copy2(INDEX, backup_target)
        write_atomic(INDEX, updated)
    print('Knowledge Map hooks built.')


if __name__ == '__main__':
    main()
