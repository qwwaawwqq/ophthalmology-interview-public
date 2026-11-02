#!/usr/bin/env python3
"""Apply the 2026-11 layout (issue #108) to the existing app without touching course data.

Grouped rail with one specialty switcher, a slimmer top bar with site search and a 保存與同步 menu,
the 今日 home view, an interview reference column and a phone tab bar.
Run from any directory. --check verifies index.html is current without writing.
"""
import argparse
import datetime as dt
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
SHELL_JS = ROOT / 'scripts/layout-shell.js'
START, END = '/* layout-shell:start */', '/* layout-shell:end */'
CSS_LINK = '<link rel="stylesheet" href="scripts/layout.css?v=20261102">'


def once(text, old, new, label):
    if new in text:
        return text
    if text.count(old) != 1:
        raise ValueError('Layout anchor changed: ' + label)
    return text.replace(old, new, 1)


INTERVIEW_OLD = (
    "${ivGroups(i)}<div class=\"two-col\"><aside class=\"card topic-menu\" aria-label=\"面試題目\">",
    "<article class=\"card reading-card\"><div class=\"interview-stage\">",
    "${i.clinical?clinicalSource(i):personalInterviewTools(i)}${interviewSamples(i)}<label class=\"field-label\" for=\"iv-draft\">",
)
INTERVIEW_NEW = (
    "${ivGroups(i)}<div class=\"two-col iv-layout\"><aside class=\"card topic-menu\" aria-label=\"面試題目\">",
    "<article class=\"card reading-card iv-practice\"><div class=\"interview-stage\">",
    "${i.clinical?'':personalInterviewTools(i)}<label class=\"field-label\" for=\"iv-draft\">",
)
REFERENCE_START = '<details class="model"><summary>${i.clinical?'
REFERENCE_END = '<h3>回看這一輪：哪裡已經做到？</h3>'
INTERVIEW_TAIL = "${btn('下一個題目','iv-next')}</div></article></div>`;}"


def interview_hooks(text):
    for old, new, n in zip(INTERVIEW_OLD, INTERVIEW_NEW, range(1, 4)):
        text = once(text, old, new, f'interview layout {n}')
    if '<aside class="iv-reference"' in text:
        return text
    # Move the model answer, detailed answer and follow-up block into a reference column after the practice article.
    start = text.find(REFERENCE_START)
    end = text.find(REFERENCE_END, start)
    tail = text.find(INTERVIEW_TAIL, end)
    if start < 0 or end < 0 or tail < 0 or text.count(REFERENCE_START) != 1 or text.count(INTERVIEW_TAIL) != 1:
        raise ValueError('Layout anchor changed: interview reference column')
    reference = text[start:end]
    if '${interviewDetailed(i)}' not in reference or '${followupReference(i)}' not in reference:
        raise ValueError('Layout anchor changed: interview reference content')
    split = reference.index('${i.followups?.length?')
    model_and_detail, followup = reference[:split], reference[split:]
    aside = ('</div></article><aside class="iv-reference" aria-label="參考答案與追問">' + followup
             + "${i.clinical?clinicalSource(i):''}${interviewSamples(i)}" + model_and_detail + '</aside></div>`;}')
    text = text[:start] + text[end:]
    return text.replace(INTERVIEW_TAIL, "${btn('下一個題目','iv-next')}" + aside, 1)


def build(text):
    text = once(text, '</style>\n<link rel="stylesheet" href="scripts/cram-review.css?v=20261016">',
                '</style>\n' + CSS_LINK + '\n<link rel="stylesheet" href="scripts/cram-review.css?v=20261016">', 'stylesheet')
    # Top bar: site search, then status, then one 保存與同步 menu holding the existing buttons unchanged.
    text = once(text, '<header class="topbar"><div class="top-status">',
                '<header class="topbar"><form class="top-search" role="search" data-top-search-form><label class="vh" for="top-search">搜尋知識、題目與解析</label><span class="top-search-symbol" aria-hidden="true">⌕</span><input class="top-search-input" id="top-search" type="search" placeholder="搜尋知識、題目與解析" autocomplete="off" enterkeyhint="search"></form><div class="top-status">', 'top search')
    text = once(text, '</button></div><div class="top-actions"><button class="btn subtle bookmark-current"',
                '</button></div><div class="top-menu"><button type="button" class="btn subtle top-menu-toggle" data-action="top-menu" aria-expanded="false" aria-controls="top-actions">保存與同步<span aria-hidden="true">▾</span></button><div class="top-actions" id="top-actions"><button class="btn subtle bookmark-current"', 'top menu')
    text = once(text, 'data-action="export" title="下載一份進度備份（選用）">匯出進度</button></div></header>',
                'data-action="export" title="下載一份進度備份（選用）">匯出進度</button></div></div></header>', 'top menu end')
    text = once(text, '</footer></div>\n</div><input id="import-file"',
                '</footer></div>\n<nav class="tabbar" id="tabbar" aria-label="主要分頁"></nav>\n</div><input id="import-file"', 'tab bar')
    # Application script.
    text = once(text, "['cram','✦','共筆考前衝刺'],['notebook','▧','章節教材']",
                "['cram','✦','共筆考前衝刺'],['today','◎','今日'],['notebook','▧','章節教材']", 'today tab')
    text = once(text, "storyTarget:null,tab:'notebook',", "storyTarget:null,tab:'today',", 'home tab')
    block = SHELL_JS.read_text(encoding='utf-8').strip()
    if '</script' in block.lower():
        raise ValueError('layout-shell.js must not contain a closing script tag')
    if START in text:
        text = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda _: block, text, count=1, flags=re.S)
    else:
        i = text.find('function specialtyPicker(){')
        j = text.find('function pendingCard(', i)
        if i < 0 or j < 0 or text.count('function specialtyPicker(){') != 1 or 'function specialtyNav(){' not in text[i:j]:
            raise ValueError('Layout anchor changed: specialty picker functions')
        text = text[:i] + block + '\n' + text[j:]
    text = once(text, "if(!D.topics.length)return specialtyPicker()+heading('SPECIALTY PREP'",
                "if(!D.topics.length)return heading('SPECIALTY PREP'", 'notebook empty picker')
    # 章節教材 no longer repeats the 今日 hero and stat tiles (issue #114); the first edition kept notebookHero().
    if 'return notebookHero()+' in text and 'return notebookHeading()+' not in text:
        text = text.replace('return notebookHero()+', 'return specialtyPicker()+notebookHero()+', 1)
    text = once(text, 'return specialtyPicker()+notebookHero()+', 'return notebookHeading()+', 'notebook picker')
    text = once(text, "return specialtyNav()+groups.map(([label,ids])=>[label,ids.filter(tabAllowed)]).filter(([,ids])=>ids.length).map(([label,ids])=>`<section class=\"nav-group\" aria-label=\"${label}\"><p class=\"nav-group-label\">${label}</p>",
                "return specialtySwitcher()+navLayout(groups).map(([label,ids])=>[label,ids.filter(tabAllowed)]).filter(([,ids])=>ids.length).map(([label,ids])=>`<section class=\"nav-group${label?'':' nav-home'}\" aria-label=\"${label||'首頁'}\">${label?`<p class=\"nav-group-label\">${label}</p>`:''}", 'nav groups')
    text = once(text, ":id==='workflow'?`<span class=\"nav-count\" aria-hidden=\"true\">${D.workflows?.workflows?.length||0}</span>`:''}</button>",
                ":id==='workflow'?`<span class=\"nav-count\" aria-hidden=\"true\">${D.workflows?.workflows?.length||0}</span>`:''}${id==='schedule'?scheduleBadge():''}</button>", 'schedule badge')
    text = once(text, "$('#main').setAttribute('data-view',S.tab);$('#main').innerHTML=({schedule:schedulePage,notebook,",
                "$('#main').setAttribute('data-view',S.tab);layoutChrome();$('#main').innerHTML=({schedule:schedulePage,notebook,today:todayPage,", 'render today')
    text = once(text, "today:todayPage,originals,quiz,learn,",
                "today:todayPage,originals,quiz:quizPage,learn,", 'render quizPage')
    text = once(text, "document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');",
                "document.addEventListener('click',e=>{layoutDismiss(e);const b=e.target.closest('[data-action]');", 'click dismiss')
    old_cases = "case'spec-toggle':case'top-menu':case'more-toggle':case'today-new':layoutAction(a,v,b);break;"
    new_cases = "case'spec-toggle':case'top-menu':case'more-toggle':case'today-new':case'quiz-bank':case'quiz-bank-open':case'quiz-adv-answer':case'quiz-adv-reveal':case'quiz-adv-retry':case'quiz-adv-shuffle':case'quiz-adv-reset-shown':case'quiz-adv-more':case'quiz-hard-timed':case'quiz-hard-deepdives':case'quiz-adv-open-source':layoutAction(a,v,b);break;"
    if old_cases in text and new_cases not in text:
        text = text.replace(old_cases, new_cases, 1)
    else:
        text = once(text, "if(window.OphProject?.action(a,v,b))return;switch(a){\ncase'nav-toggle':",
                    "if(window.OphProject?.action(a,v,b))return;switch(a){\n" + new_cases + "\ncase'nav-toggle':", 'layout actions')
    text = once(text, "document.addEventListener('change',e=>{const el=e.target;if(window.OphProject?.change(el))return;if(practiceChange(el))return;",
                "document.addEventListener('change',e=>{const el=e.target;if(window.OphProject?.change(el))return;if(layoutChange(el))return;if(practiceChange(el))return;", 'layout change')
    text = once(text, "document.addEventListener('input',e=>{const el=e.target;if(window.OphProject?.input(el))return;",
                "document.addEventListener('input',e=>{const el=e.target;if(window.OphProject?.input(el))return;if(layoutInput(el))return;", 'layout input')
    text = once(text, "S.round=Object.create(null);switchTab('quiz');}",
                "S.round=Object.create(null);quizBankMode='core';switchTab('quiz');}", 'startQuiz core reset')
    return merge_hooks(interview_hooks(text))


def merge_hooks(text):
    """Issue #114: one home per subject. Folded quick-review topics, one chapter entry, cases linked to 面試演練."""
    text = once(text, "function orderedTopics(){return [...D.topics.filter(t=>t.chapter),...D.topics.filter(t=>!t.chapter)];}",
                "function orderedTopics(){return [...D.topics.filter(t=>t.chapter),...D.topics.filter(t=>!t.chapter&&!mergedInto(t.id))];}", 'topic order')
    text = once(text, "heading('02 / ACTIVE RECALL','主動複習','讀過之後，遮住答案。能用自己的話說出來，才算完成一次回想。',`<div class=\"heading-stat\"><strong>${st.topics}<i> / ${D.topics.length}</i></strong><span>主題已複習</span></div>`)",
                "heading('02 / ACTIVE RECALL','章節教材','閱讀重點，或遮住答案主動回想；能用自己的話說出來，才算記住。',`<div class=\"heading-stat\"><strong>${orderedTopics().filter(x=>entries['topic:'+x.id]?.done).length}<i> / ${orderedTopics().length}</i></strong><span>已複習</span></div>`)", 'chapter heading')
    text = once(text, "<p class=\"eyebrow\">CONCEPT ${String(D.topics.indexOf(t)+1).padStart(2,'0')} / ${D.topics.length}</p>",
                "<p class=\"eyebrow\">${topicEyebrow(t)}</p>", 'chapter eyebrow')
    text = once(text, "<p class=\"lead\">${esc(t.summary)}</p>${enrichmentNav(t)}",
                "<p class=\"lead\">${esc(t.summary)}</p>${mergedNotice(t)}${enrichmentNav(t)}", 'merged notice')
    text = once(text, "${extensionList(t.ext)}${renderEnrichment(t)}`;}",
                "${mergedSupplements(t)}${extensionList(t.ext)}${renderEnrichment(t)}`;}", 'merged supplements')
    text = once(text, "${cs.length?`<section class=\"lesson-block\"><h3>臨床口試 · 先回答再展開</h3>${cs.map((c,n)=>`<div class=\"case-block\"><h3>${n+1}. ${esc(c.prompt)}</h3><p class=\"small\">${esc(Array.isArray(t.source)?t.source.join('；'):t.source||'')}${c.ref?' · 頁 '+esc(c.ref):''}</p><details class=\"model\"><summary>查看參考回答</summary><div class=\"preline\">${esc(c.answer)}</div></details>${D.interview.some(i=>i.id===t.id+'-case-'+(n+1))?btn('進入 90 秒口試','interview',t.id+'-case-'+(n+1),'small'):''}</div>`).join('')}</section>`:''}",
                "${cs.length?`<section class=\"lesson-block chapter-cases\"><h3>臨床口試情境</h3><p class=\"small\">計時、草稿、追問與參考回答都在「面試演練」，這裡只列情境。</p><ol class=\"case-links\">${cs.map((c,n)=>{const id=t.id+'-case-'+(n+1);return D.interview.some(i=>i.id===id)?`<li><span>${esc(c.prompt)}</span>${btn('到面試演練練習','interview',id,'small')}</li>`:`<li><span>${esc(c.prompt)}</span><details class=\"model\"><summary>查看參考回答</summary><div class=\"preline\">${esc(c.answer)}</div></details></li>`;}).join('')}</ol></section>`:''}", 'chapter cases')
    text = once(text, "<button class=\"nav-button\" data-action=\"tab\" data-value=\"${id}\" ${id===S.tab?'aria-current=\"page\"':''}>",
                "<button class=\"nav-button\" data-action=\"tab\" data-value=\"${id}\" ${navCurrent(id)?'aria-current=\"page\"':''}>", 'rail current')
    text = once(text, "S.ids=D.questions.filter(q=>(topic==='all'||q.topicId===topic)&&",
                "S.ids=D.questions.filter(q=>(topic==='all'||q.topicId===topic||mergedInto(q.topicId)===topic)&&", 'chapter practice')
    # The chapter's own questions come first; folded quick-review questions follow.
    text = once(text, "(mode==='uncertain'&&entries['q:'+q.id]&&meta['q:'+q.id]?.confidence===1))).map(q=>q.id);S.qi=",
                "(mode==='uncertain'&&entries['q:'+q.id]&&meta['q:'+q.id]?.confidence===1))).sort((a,b)=>(a.topicId!==topic)-(b.topicId!==topic)).map(q=>q.id);S.qi=", 'chapter practice order')
    text = once(text, "個快速重點、${D.questions.filter(q=>!q.sourceId).length} 題與個人面試資料持續保留。",
                "個快速重點已併入對應章節；${D.questions.filter(q=>!q.sourceId).length} 題與個人面試資料持續保留。", 'notebook note')
    return once(text, "${D.topics.map(t=>{const qs=D.questions.filter(q=>q.topicId===t.id);return `<tr><td><button class=\"text-button\" data-action=\"learn-topic\"",
                "${orderedTopics().map(t=>{const qs=topicQuestions(t);return `<tr><td><button class=\"text-button\" data-action=\"learn-topic\"", 'progress rows')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    old = INDEX.read_text(encoding='utf-8')
    new = build(old)
    if args.check:
        if old != new:
            raise SystemExit('Layout hooks are not current')
        print('Layout hooks current; course data and progress formats untouched.')
        return
    if old != new:
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')
        shutil.copy2(INDEX, INDEX.with_name(INDEX.name + '.bak-layout-' + stamp))
        INDEX.write_text(new, encoding='utf-8')
    print('Layout hooks built.')


if __name__ == '__main__':
    main()
