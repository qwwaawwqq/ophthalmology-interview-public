#!/usr/bin/env python3
"""Add a read-only exam schedule while preserving the existing training payload."""
import argparse, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def once(text, old, new):
    if new in text:
        return text
    if text.count(old) != 1:
        raise ValueError('Exam schedule anchor changed: ' + old[:100])
    return text.replace(old, new, 1)
def build(text):
    text = once(text, '</title>', '</title>\n<link rel="stylesheet" href="scripts/exam-schedule.css">\n<script src="scripts/exam-schedule.js" defer></script>')
    text = once(text, "['links','☆','我的連結'],['sync'", "['links','☆','我的連結'],['schedule','▣','考試時程'],['sync'")
    text = once(text, "['進階訓練',['advanced']],", "['進階訓練',['advanced']],['考試安排',['schedule']],")
    text = once(text, "$('#main').innerHTML=({notebook,", "$('#main').innerHTML=({schedule:schedulePage,notebook,")
    text = once(text, 'function render(){window.OphStudy?.context', "function schedulePage(){setTimeout(()=>window.OphSchedule?.mount(document.getElementById('schedule-root')),0);return heading('','考試時程','報名截止、筆試與面試，按日期整理。')+'<section id=\"schedule-root\" aria-label=\"考試時程\"><p role=\"status\">正在讀取時程…</p></section>';}\nfunction render(){window.OphStudy?.context")
    return text
if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--check', action='store_true'); args = p.parse_args()
    f = ROOT/'index.html'; old = f.read_text(); new = build(old)
    if args.check:
        if old != new: raise SystemExit('Exam schedule hooks are not current')
        print('Exam schedule hooks current; no training payload edits.'); raise SystemExit(0)
    if old != new:
        backup = f.with_name(f.name+'.bak-20261025')
        if not backup.exists(): shutil.copy2(f, backup)
        f.write_text(new)
    print('Exam schedule hooks built.')
