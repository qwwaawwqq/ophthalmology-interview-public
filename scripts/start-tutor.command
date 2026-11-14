#!/bin/bash
# 在 Finder 雙擊這個檔案：開啟本機版的眼科甄選練習室，附蘇格拉底家教（用你 Mac 上的 Claude Code 訂閱）。
# 關掉終端機視窗或按 Ctrl+C 就會結束。
cd "$(dirname "$0")/.." || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "找不到 python3。請先安裝 Xcode Command Line Tools：在終端機執行 xcode-select --install"
  read -r -p "按 Enter 關閉…" _
  exit 1
fi
exec python3 scripts/tutor-server.py "$@"
