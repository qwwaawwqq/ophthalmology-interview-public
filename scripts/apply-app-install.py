#!/usr/bin/env python3
"""Add install metadata and a user-triggered entry without altering course data."""
import argparse, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def once(text,old,new):
    if new in text: return text
    if text.count(old)!=1: raise ValueError('App installation anchor changed: '+old[:100])
    return text.replace(old,new,1)
def build(text):
    text=once(text,'<meta name="color-scheme" content="light">','<meta name="color-scheme" content="light">\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#132743">\n<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">\n<link rel="stylesheet" href="scripts/app-install.css">\n<script src="scripts/app-install.js" defer></script>')
    text=once(text,'<button class="btn subtle" data-action="import">匯入進度</button>','<button type="button" class="btn app-install-entry" data-app-install-open aria-haspopup="dialog">安裝App</button><button class="btn subtle" data-action="import">匯入進度</button>')
    return text
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');a=p.parse_args();f=ROOT/'index.html';old=f.read_text();new=build(old)
    if a.check:
        if old!=new: raise SystemExit('App installation hooks are not current')
        print('App installation hooks current; course data and progress preserved.');raise SystemExit(0)
    if old!=new:
        backup=f.with_name(f.name+'.bak-20261028')
        if not backup.exists():shutil.copy2(f,backup)
        f.write_text(new)
    print('App installation hooks built.')
