#!/usr/bin/env python3
"""Apply the reviewed cram tab hooks to the exact known app, without rebuilding it."""
import argparse
import hashlib
import shutil
from pathlib import Path

BASE_BLOB = "59874e4bd7c72992340126261940994e62436c07"
RESULT_BLOB = "5a9ee2515433bda64759310c6d948fcf524615e8"
PATCHES = [
    ("const navs=[[", "const navs=[['cram','✦','共筆考前衝刺'],["),
    ("['閱讀',['notebook','learn','links']]", "['閱讀',['cram','notebook','learn','links']]"),
    ("sync:syncPage})[S.tab]();syncPracticeHash();}",
     "sync:syncPage,cram:cramPage})[S.tab]();syncPracticeHash();if(S.tab==='cram'&&window.OphCram)window.OphCram.mount(document.getElementById('cram-root'));}"),
    ("function render(){const active=",
     "function cramPage(){return '<section id=\"cram-root\" aria-label=\"共筆考前衝刺\"><p role=\"status\">正在載入共筆考前衝刺…</p></section>'; }\nfunction render(){const active="),
    ("</head>", '<link rel="stylesheet" href="scripts/cram-review.css?v=20261016">\n<script defer src="scripts/cram-review.js?v=20261016"></script>\n</head>'),
]


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def patched(data):
    current = git_blob(data)
    if current == RESULT_BLOB:
        return data, False
    if current != BASE_BLOB:
        raise ValueError(f"Refusing unknown index.html blob {current}; expected {BASE_BLOB} or already-patched {RESULT_BLOB}.")
    text = data.decode("utf-8")
    for number, (before, after) in enumerate(PATCHES, 1):
        count = text.count(before)
        if count != 1:
            raise ValueError(f"Patch {number} needs exactly one anchor; found {count}. No file was changed.")
        text = text.replace(before, after, 1)
    result = text.encode("utf-8")
    actual = git_blob(result)
    if actual != RESULT_BLOB:
        raise ValueError(f"Reviewed output mismatch: {actual}; expected {RESULT_BLOB}. No file was changed.")
    return result, True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--apply", action="store_true", help="Write the verified result; otherwise verify only.")
    args = parser.parse_args()
    index = args.root / "index.html"
    data = index.read_bytes()
    result, changed = patched(data)
    if not changed:
        print(f"Already applied; unchanged index.html {RESULT_BLOB}")
        return
    if not args.apply:
        print(f"Verified: {BASE_BLOB} -> {RESULT_BLOB}. Add --apply to write.")
        return
    backup = index.with_name(index.name + ".bak-20261016")
    if backup.exists():
        if backup.read_bytes() != data:
            raise ValueError(f"Existing backup differs; refusing to overwrite {backup.name}.")
    else:
        shutil.copy2(index, backup)
    index.write_bytes(result)
    if git_blob(index.read_bytes()) != RESULT_BLOB:
        raise ValueError("Readback verification failed after writing index.html.")
    print(f"Applied five reviewed hooks; index.html {RESULT_BLOB}; backup {backup.name}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError) as error:
        raise SystemExit(f"Cram update failed: {error}")
