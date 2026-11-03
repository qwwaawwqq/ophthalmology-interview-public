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
    # Keep the existing study/depth adjacency used by study_hooks.
    html = html.replace('<script src="scripts/textbook-atlas.js?v=volume-atlas-20261028" defer></script>\n', '')
    # Normalize our versioned URLs before the existing idempotent hook pass.
    html = html.replace('scripts/textbook-depth.js?v=volume-atlas-20261028', 'scripts/textbook-depth.js').replace('scripts/textbook-depth.css?v=volume-atlas-20261028', 'scripts/textbook-depth.css')
    result = html if '<script src="scripts/textbook-depth.js"' in html else once(html, '</head>', '<link rel="stylesheet" href="scripts/textbook-depth.css">\n<script src="scripts/textbook-depth.js" defer></script>\n</head>')
    if "['textbook','▥','原文書進階']" not in result: result = once(result, 'const navs=[', "const navs=[['textbook','▥','原文書進階'],")
    if "['閱讀',['study','textbook'" not in result: result = once(result, "['閱讀',['cram','notebook','learn','links']]", "['閱讀',['textbook','cram','notebook','learn','links']]")
    if 'textbook:textbookPage' not in result: result = once(result, 'sync:syncPage,cram:cramPage}', 'sync:syncPage,cram:cramPage,textbook:textbookPage}')
    old = "if(S.tab==='cram'&&window.OphCram)window.OphCram.mount(document.getElementById('cram-root'));}"
    new = old[:-1] + "if(S.tab==='textbook'&&window.OphTextbook)window.OphTextbook.mount(document.getElementById('textbook-root'));}"
    if "if(S.tab==='textbook'&&window.OphTextbook)" not in result: result = once(result, old, new)
    if 'const study=studyEntry(key,v)' not in result: result = once(result, 'function validateEntry(key,v){const extra=practiceEntry(key,v);', 'function validateEntry(key,v){const textbook=textbookEntry(key,v);if(textbook!==undefined)return textbook;const extra=practiceEntry(key,v);')
    bridge = (ROOT / 'scripts/textbook-bridge.js').read_text().strip()
    if '/* textbook-bridge:start */' in result:
        result = re.sub(r'/\* textbook-bridge:start \*/.*?/\* textbook-bridge:end \*/', lambda _: bridge, result, count=1, flags=re.S)
    else:
        result = once(result, 'function render(){', bridge + '\nfunction render(){')
    result = study_hooks(result)
    if 'scripts/textbook-atlas.css?v=volume-atlas-20261028' not in result:
        result = once(result, '<link rel="stylesheet" href="scripts/textbook-depth.css">', '<link rel="stylesheet" href="scripts/textbook-depth.css">\n<link rel="stylesheet" href="scripts/textbook-atlas.css?v=volume-atlas-20261028">')
    if 'scripts/textbook-atlas.js?v=volume-atlas-20261028' not in result:
        anchor = '<link rel="stylesheet" href="scripts/advanced-training.css">' if '<link rel="stylesheet" href="scripts/advanced-training.css">' in result else '<script src="scripts/study-srs.js" defer></script>'
        result = once(result, anchor, '<script src="scripts/textbook-atlas.js?v=volume-atlas-20261028" defer></script>\n' + anchor)
    return result.replace('href="scripts/textbook-depth.css"', 'href="scripts/textbook-depth.css?v=volume-atlas-20261028"').replace('src="scripts/textbook-depth.js"', 'src="scripts/textbook-depth.js?v=volume-atlas-20261028"')


def study_hooks(result):
    result = once(result, '<script src="scripts/textbook-depth.js" defer></script>', '<script src="scripts/study-srs.js" defer></script>\n<script src="scripts/textbook-depth.js" defer></script>')
    result = once(result, "const navs=[['textbook'", "const navs=[['study','↻','今日複習'],['textbook'")
    result = once(result, "['閱讀',['textbook','cram'", "['閱讀',['study','textbook','cram'")
    result = once(result, 'textbook:textbookPage}', 'textbook:textbookPage,study:studyPage}')
    old="if(S.tab==='textbook'&&window.OphTextbook)window.OphTextbook.mount(document.getElementById('textbook-root'));}"
    result=once(result, old, old[:-1]+"if(S.tab==='study'&&window.OphStudy)window.OphStudy.mount(document.getElementById('study-root'));}")
    result=once(result, 'function validateEntry(key,v){const textbook=', 'function validateEntry(key,v){const study=studyEntry(key,v);if(study!==undefined)return study;const textbook=')
    bridge=(ROOT/'scripts/study-bridge.js').read_text().strip()
    if '/* study-bridge:start */' in result:
        result=re.sub(r'/\* study-bridge:start \*/.*?/\* study-bridge:end \*/',lambda _:bridge,result,count=1,flags=re.S)
    else:result=once(result,'function render(){',bridge+'\nfunction render(){')
    result=once(result,'function render(){',"function render(){window.OphStudy?.context(S.tab==='quiz'&&question()?'shared':null,S.tab==='quiz'&&question()?question().id:null);")
    result=once(result,"putMeta('q:'+q.id,{confidence:S.confidence});render();break;}","putMeta('q:'+q.id,{confidence:S.confidence});window.OphStudy?.commit('shared',q.id,value.correct);render();break;}")
    result=once(result,":feedback(q,response)}",":feedback(q,response)+(window.OphStudy?.ratingHtml('shared',q.id)||'')}")
    result=once(result,"function startQuiz(topic='all',mode='all',first=null){","function startQuiz(topic='all',mode='all',first=null){window.OphStudy?.leave();")
    result=once(result,"(mode==='uncertain'&&entries['q:'+q.id]&&meta['q:'+q.id]?.confidence===1)","(mode==='due'&&srsDueNow(entries['study:srs:shared:'+q.id]))||(mode==='srs-weak'&&srsWeakEntry(entries['study:srs:shared:'+q.id]))||(mode==='uncertain'&&entries['q:'+q.id]&&meta['q:'+q.id]?.confidence===1)")
    result=once(result,"S.mode==='wrong'?'錯題再練':S.mode==='uncertain'?'不確定題再練':'筆試練習'","S.mode==='wrong'?'錯題再練':S.mode==='uncertain'?'不確定題再練':S.mode==='due'?'到期複習':S.mode==='srs-weak'?'SRS 弱項再練':'筆試練習'")
    result=once(result,"<option value=\"uncertain\" ${S.mode==='uncertain'?'selected':''}>不確定的題目</option></select>","<option value=\"uncertain\" ${S.mode==='uncertain'?'selected':''}>不確定的題目</option><option value=\"due\" ${S.mode==='due'?'selected':''}>到期複習（SRS）</option><option value=\"srs-weak\" ${S.mode==='srs-weak'?'selected':''}>SRS 弱項</option></select>")
    result=once(result,"S.mode==='wrong'?'先完成一輪練習，錯題會出現在這裡。':S.mode==='uncertain'?'選擇「還不確定」後提交答案，就能在這裡再練一次。':'這個主題可先從主動複習開始。'","S.mode==='wrong'?'先完成一輪練習，錯題會出現在這裡。':S.mode==='uncertain'?'選擇「還不確定」後提交答案，就能在這裡再練一次。':S.mode==='due'?'目前沒有到期的複習題目；作答並評分熟悉度後，到期題會出現在這裡。':S.mode==='srs-weak'?'目前沒有 SRS 弱項（答錯、重來或微卡題目會出現在這裡）。':'這個主題可先從主動複習開始。'")
    result=once(result,'function moveQuestion(n){','function moveQuestion(n){window.OphStudy?.leave();')
    result=once(result,"case'retry':delete S.round[question().id];","case'retry':window.OphStudy?.leave();delete S.round[question().id];")
    # Import/cloud merges invalidate an in-flight familiarity action.
    marker=re.search(r'function mergeProgress\(([^)]*)\)\{',result)
    if marker and not result[marker.end():].startswith('window.OphStudy?.leave();'):
        result=result[:marker.end()]+'window.OphStudy?.leave();'+result[marker.end():]
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
