#!/usr/bin/env python3
"""眼科甄選練習室 · 蘇格拉底家教（本機版）。

在自己的 Mac 上打開這個網站，並多一個用自己 Claude 訂閱回答的家教：

    python3 scripts/tutor-server.py              # 會自動打開 http://127.0.0.1:8002/#tutor
    python3 scripts/tutor-server.py --port 8010 --no-open

- 只用 Python 標準庫，不需要安裝套件。伺服器只綁 127.0.0.1，同一個網站加上 /api/tutor/*。
- 每送一則訊息跑一次 `claude -p`（Mac 上的 Claude Code，用你自己的訂閱登入）：
  不給工具、在空的暫存資料夾裡跑、只帶最少的環境變數（不帶 ANTHROPIC_API_KEY，所以不會走按量計費）。
- 每則訊息會依目前科別，從網站內容（章節、考點、筆試申論、臨床流程）挑出相關段落附在提示裡，
  讓家教跟網站的教材與「共筆更正」一致。
- 對話存在 ~/.ophthalmology-tutor/（可用 --data-dir 或 OPH_TUTOR_HOME 改），不在 repo 裡，不會被提交或發布。
- 教學規則取自 Jane Street 的 agent_skills/socratic-tutor（commit 7c6715c，MIT License，授權全文在檔尾），
  與 shioaji-app 的學習頁家教相同。

環境變數（都可以不設）：
  TUTOR_CLAUDE_BIN          claude 指令的完整路徑（預設自己找）
  TUTOR_CLAUDE_CONFIG_DIR   用哪個 Claude 帳號的設定資料夾（例如 ~/.claude-work；預設 = claude 的預設登入）
  TUTOR_MODEL               模型（預設 sonnet，比 opus 省訂閱用量）
  OPH_TUTOR_HOME            對話與設定存放位置（預設 ~/.ophthalmology-tutor）
"""
from __future__ import annotations

import argparse
import datetime
import glob
import http.server
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
import webbrowser
from collections import Counter
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8002
TPE = datetime.timezone(datetime.timedelta(hours=8))
ID_RE = re.compile(r"^t\d{8}-\d{6}-[0-9a-f]{6}$")
TOPIC_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
MAX_MESSAGE_CHARS = 4000
MAX_BODY_BYTES = 64 * 1024
HISTORY_CHAR_BUDGET = 20000
REFERENCE_CHAR_BUDGET = 6000
UNIT_CHAR_LIMIT = 700
CALL_TIMEOUT_S = 180
PROBE_TIMEOUT_S = 20
CLI_CACHE_S = 600
DEFAULT_MODEL = "sonnet"
MODELS = ("sonnet", "opus", "haiku")
PHASES = ("intent", "diagnostic", "teaching", "review", "final", "done")
STATE_OPEN, STATE_CLOSE = "<<<STATE", "STATE>>>"
SKILL_SOURCE = {"repo": "https://github.com/janestreet/agent_skills", "path": "socratic-tutor/SKILL.md",
                "commit": "7c6715c", "license": "MIT (c) 2026 Jane Street Group, LLC"}
# 與 scripts/specialty-registry.js 的科別一致；oph 的資料在 id="course-data"，其他科在 id="course-data-<科別>"。
SPECIALTIES = {"oph": "眼科", "ent": "耳鼻喉科", "rad": "放射診斷科", "nm": "核子醫學科", "neuro": "神經內科"}
# 早期快速重點已併入眼科各章（與 scripts/layout-shell.js 的 LEGACY_TOPICS 相同）。
LEGACY_TOPICS = {"examination": "notes-01", "optics": "notes-02", "red-eye": "notes-14", "vision-loss": "notes-14",
                 "trauma": "notes-05", "glaucoma": "notes-07", "vascular-retina": "notes-10", "retina-macula": "notes-10",
                 "neuro": "notes-03", "diplopia": "notes-04", "pediatric": "notes-04", "cataract": "notes-06"}


class TutorError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code, self.message, self.http = code, message, http_status


# ---------------------------------------------------------------- 教學規則（socratic-tutor SKILL.md 本文，未改字）
SKILL_TEXT = """# Socratic Tutor

Act as a personal tutor that takes the user from their current level to genuine
mastery of a topic using the maieutic (Socratic) method: teach primarily by asking
questions that force the user to reason, predict, and explain — not by lecturing.

## Guard: confirm intent before starting

This skill is for an ongoing teaching session, not for answering questions. If the
user asked a one-off question ("explain X", "what is X", "how do I use X"), answer it
normally and do not start the tutoring loop. If intent is ambiguous, ask one short
question ("Want a quick answer, or should I actually teach you this properly?") before
launching the diagnostic. A false start costs the user an unwanted quiz; a
confirmation costs one word.

## Session start

1. Break the topic into 4-10 concrete subskills (fewer for narrow topics). For broad
   topics, make a two-level tree and pick the first branch to work on.
2. Tell the user that you will start by asking a few questions, one at a time, to see
   what they already know.
3. Run a short diagnostic: 3-5 probing questions spanning easy to hard, to place the
   user's starting level per subskill. Do not teach anything until the diagnostic is
   done.
4. Show the initial skill map (format below) and propose where to start. Let the user
   override.


## Skill map

Track each subskill at levels 0-5:

    0 unaware . 1 heard of it . 2 can follow along . 3 can do with help
    4 can do independently . 5 can teach it / handle edge cases

Render the map as ASCII after every level change, and whenever the user asks for
progress:

    Topic: <topic>                          overall: ######.... 58%
    -----------------------------------------------------------------
    subskill A            [########..]  4/5  * independent
    subskill B            [######....]  3/5  <- current focus
    subskill C            [##........]  1/5
    -----------------------------------------------------------------

Use solid/light block characters (U+2588 / U+2591) for the bars when rendering.

## Teaching loop (repeat per subskill)

- Ask ONE question at a time. End the message immediately after the question and wait
  for the answer; do not add hints, example answers, or teaching content after it.
- Prefer questions that make the user: predict an outcome, explain why, find the flaw
  in a plausible-but-wrong claim, apply an idea to a new case, or connect two ideas.
- When the user is wrong, do not give the answer. Ask a narrower question that exposes
  the contradiction in their reasoning. Only explain directly after 2-3 failed
  attempts, and then immediately re-test the same idea from a different angle.
- When the user is right, occasionally play devil's advocate ("are you sure? what
  about X?") — they should be able to defend correct answers under pressure.
- Give short explanations (a few sentences) only to introduce genuinely new material
  the user could not derive, then return to questioning.
- Where tools are available and relevant, set practical exercises (e.g. "write a
  query that...", "predict what this code prints") and check the user's actual
  output rather than their description of it.

## Evaluation rules — be strict

- Levels are earned, not given. Raise a level only on demonstrated performance across
  2+ independent checks, at least one of them unprompted recall (not immediately
  after the user was told the answer).
- A vague or partially-correct answer is not correct. Probe until you know whether
  the user actually understands. Do not attribute to the user any insight they did
  not actually express.
- Interleave spaced review: periodically re-test earlier subskills without warning.
  If the user fails a review, lower the level and revisit.
- Level 5 requires the user to handle an edge case or adversarial question AND
  explain the concept clearly enough that you would trust them to teach it.
- Do not flatter. "Not quite — why would X happen if Y were true?" beats "Great
  try!".

## Mastery and completion

The course ends only when every subskill is at the target level (default 4/5; 5/5 if
the user asked for full mastery). Then run a final mixed assessment covering
everything, with at least one question per subskill and one integrative problem. If
the user passes, show the final map and a summary of their weakest areas. If not,
back to the loop.

## Commands the user can use anytime

- "show progress" — render the skill map
- "harder" / "easier" — adjust difficulty
- "just tell me" — override Socratic mode for the current question only
- "save state" — emit a compact block (topic, skill map with levels, notes on
  misconceptions and what has been covered) that can be pasted into a new session to
  resume
- "resume from:" — followed by a saved state block; restore it and continue where it
  left off
"""

# ---------------------------------------------------------------- 這個網站加的規則（考試情境、教材依據、輸出格式）
OPH_FOCUS = """- High-yield for this exam: emergencies and their first step (chemical injury, open globe,
  CRAO, acute angle closure, endophthalmitis, orbital compartment syndrome, giant cell
  arteritis, retinal detachment), localisation (visual fields, pupils, cranial nerves),
  drug toxicity, and the pairs students confuse."""


def app_rules(spec: str) -> str:
    label = SPECIALTIES.get(spec, SPECIALTIES["oph"])
    focus = OPH_FOCUS if spec == "oph" else ""
    return f"""# How this tutor runs here

You are the tutor inside 眼科甄選練習室, the student's own practice site for Taiwan residency
selection (a written exam, then an oral interview). The specialty being studied now is {label}.
The student is a doctor in postgraduate (PGY) training preparing for the {label} first-year
residency written exam and interview. They type in a chat box; each of your messages is shown
as one chat turn.

- Reply in the language the student writes in. If they write Chinese, use Traditional Chinese
  as used in Taiwan and keep the English terms Taiwanese clinicians use (RAPD, anti-VEGF, OCT…);
  give the English term in brackets the first time you use a Chinese medical term.
- Keep each message short. When teaching, end with exactly one question.
- Fit the questions to this exam: single-best-answer questions like the written exam,
  "what is your first step" questions like the oral exam, and short-essay outlines.
{focus}
- A request may include [Reference notes from the student's site]: excerpts from their course
  chapters, exam-point questions, essay key points and clinical workflows. Treat them as the
  syllabus and keep your teaching consistent with them, above all items marked 共筆更正
  (corrections). If a note looks wrong or out of date, say so briefly and explain, instead of
  silently teaching something different. Do not paste the notes back at length.
- Do not invent page numbers, trial results, guideline years or statistics. If unsure, say so.
- This is exam study, not care for a real patient. If the student asks about a real patient,
  say that decisions follow their attending physician and hospital protocol.
- The page draws the skill map next to the chat from your STATE block, so do not draw the ASCII
  map in your message unless the student asks for progress.
- You have no tools in this chat: do not claim to look anything up or run anything.
- After your message, output a line containing only <<<STATE, then ONE JSON object on the
  following lines, then a line containing only STATE>>>. Nothing after it.
  JSON fields:
    "phase": one of "intent", "diagnostic", "teaching", "review", "final", "done"
    "title": a short session title (at most 20 characters)
    "topic": the topic being taught ("" before it is known)
    "target": 4 or 5
    "subskills": [{{"name": string, "level": 0-5 or null if not placed yet, "focus": true for the current one}}]
    "notes": at most 8 short strings: misconceptions seen, what has been covered, what to re-test
  Keep subskills, levels and notes up to date every turn; levels follow the evaluation rules
  above (earned, never given).
"""


def system_prompt(spec: str) -> str:
    return SKILL_TEXT + "\n\n" + app_rules(spec)


# ---------------------------------------------------------------- 小工具
def _now_iso() -> str:
    return datetime.datetime.now(TPE).isoformat(timespec="seconds")


def _new_id() -> str:
    return "t" + datetime.datetime.now(TPE).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def _txt(v: Any, n: int) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _num(v: Any) -> float | None:
    """有限的數字（或寫成字串的數字）→ float；布林、物件、None、NaN、無限大 → None。"""
    if isinstance(v, bool):
        return None
    if isinstance(v, str):
        try:
            v = float(v.strip())
        except ValueError:
            return None
    if not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _str(v: Any, n: int) -> str:
    """字串或數字 → 壓掉多餘空白、截到 n 個字；其他型別 → 空字串。"""
    return _txt(v, n) if isinstance(v, (str, int, float)) and not isinstance(v, bool) else ""


def spec_of(v: Any) -> str:
    v = str(v or "").strip()
    return v if v in SPECIALTIES else "oph"


# ---------------------------------------------------------------- 回覆解析（與 shioaji-app tutor.py 相同的 STATE 格式）
def _strip_partial_marker(text: str) -> str:
    return re.sub(r"\n?<{1,3}S?T?A?T?E?\s*$", "", text)


def parse_reply(text: str) -> tuple[str, dict[str, Any] | None]:
    """把模型輸出拆成「給學生看的訊息」與 STATE JSON；STATE 壞掉就回 None（沿用上一輪的狀態）。"""
    text = str(text or "")
    i = text.rfind(STATE_OPEN)
    if i < 0:
        return _strip_partial_marker(text).strip(), None
    reply = text[:i].strip()
    raw = text[i + len(STATE_OPEN):]
    j = raw.find(STATE_CLOSE)
    raw = (raw[:j] if j >= 0 else raw).strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", raw).strip()
    state = None
    for cand in (raw, raw[raw.find("{"): raw.rfind("}") + 1] if "{" in raw else ""):
        try:
            obj = json.loads(cand)
        except ValueError:
            continue
        if isinstance(obj, dict):
            state = obj
            break
    return reply, state


def clean_state(raw: Any, prev: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """模型回的 STATE → 存檔用的狀態。raw 不是物件 → 整份沿用上一輪；某一欄形狀不對 → 那一欄沿用上一輪。"""
    if not isinstance(raw, dict):
        return prev
    old = prev if isinstance(prev, dict) else {}
    phase = raw.get("phase") if raw.get("phase") in PHASES else old.get("phase") or "intent"
    t = _num(raw.get("target"))
    if t is not None:
        target = 5 if t >= 5 else 4
    else:
        target = old.get("target") if old.get("target") in (4, 5) else 4
    if isinstance(raw.get("subskills"), list):
        subs = []
        for s in raw["subskills"][:12]:
            if not isinstance(s, dict) or not _str(s.get("name"), 60):
                continue
            lv = _num(s.get("level"))
            subs.append({"name": _str(s.get("name"), 60), "level": None if lv is None else max(0, min(5, int(lv))),
                         "focus": bool(s.get("focus"))})
    else:
        subs = old.get("subskills") if isinstance(old.get("subskills"), list) else []
    if isinstance(raw.get("notes"), list):
        notes = [x for x in (_str(n, 160) for n in raw["notes"][:8]) if x]
    else:
        notes = old.get("notes") if isinstance(old.get("notes"), list) else []
    return {"phase": phase, "title": _str(raw.get("title"), 30), "topic": _str(raw.get("topic"), 80),
            "target": target, "subskills": subs, "notes": notes}


def overall_pct(state: dict[str, Any] | None) -> int | None:
    subs = [s for s in ((state or {}).get("subskills") or []) if isinstance(s.get("level"), int)]
    if not subs:
        return None
    return round(100 * sum(s["level"] for s in subs) / (5 * len(subs)))


# ---------------------------------------------------------------- 網站教材：從 index.html 與 content/written-qa 取段落
_CJK = "㐀-䶿一-鿿豈-﫿"
_TOKEN_RE = re.compile(r"[a-z0-9]+|[" + _CJK + r"]+")
_ATLAS_RE = re.compile(r"\s*(?:參見\s*)?atlas-s\d+-\d+(?:\s*(?:、|與|及)\s*atlas-s\d+-\d+)*")
_STOP = {"the", "and", "of", "to", "in", "is", "for", "on", "with", "vs", "or", "a", "an"}


def tokens(text: str) -> list[str]:
    """英數字整個字算一個詞，中文用相鄰兩字（bigram）；單一個中文字也算，讓兩字以下的詞找得到。"""
    out = []
    for m in _TOKEN_RE.finditer(str(text or "").lower()):
        w = m.group(0)
        if w[0] < "㐀":
            if len(w) >= 2 and w not in _STOP:
                out.append(w)
        elif len(w) == 1:
            out.append(w)
        else:
            out.extend(w[i:i + 2] for i in range(len(w) - 1))
    return out


def _clip(text: str, n: int = UNIT_CHAR_LIMIT) -> str:
    text = _ATLAS_RE.sub("", re.sub(r"\s+", " ", str(text or ""))).replace("（）", "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


class CourseIndex:
    """每個科別一份 BM25 索引。index.html 改了（mtime 變了）會自動重讀。"""

    def __init__(self, root: str = ROOT):
        self.root = root
        self._lock = threading.Lock()
        self._mtime = None
        self._data: dict[str, dict[str, Any]] = {}
        self._idx: dict[str, dict[str, Any]] = {}

    # -- 讀資料
    def _load(self) -> None:
        path = os.path.join(self.root, "index.html")
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = None
        if mtime is not None and mtime == self._mtime:
            return
        data: dict[str, dict[str, Any]] = {}
        if mtime is not None:
            with open(path, "r", encoding="utf-8") as fh:
                page = fh.read()
            for spec in SPECIALTIES:
                sid = "course-data" if spec == "oph" else "course-data-" + spec
                m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % re.escape(sid), page, flags=re.S)
                if not m:
                    continue
                try:
                    obj = json.loads(m.group(1))
                except ValueError:
                    continue
                if isinstance(obj, dict):
                    data[spec] = obj
        self._data, self._idx, self._mtime = data, {}, mtime

    def _written(self, spec: str) -> list[dict[str, Any]]:
        try:
            with open(os.path.join(self.root, "content", "written-qa", spec + ".json"), "r", encoding="utf-8") as fh:
                obj = json.load(fh)
        except (OSError, ValueError):
            return []
        items = obj.get("items") if isinstance(obj, dict) else obj
        return [x for x in (items or []) if isinstance(x, dict)]

    def data(self, spec: str) -> dict[str, Any]:
        with self._lock:
            self._load()
            return self._data.get(spec) or {}

    # -- 章節清單（家教首頁的主題按鈕）
    def chapters(self, spec: str) -> list[dict[str, Any]]:
        topics = [t for t in (self.data(spec).get("topics") or []) if isinstance(t, dict) and t.get("chapter")]
        topics.sort(key=lambda t: (_num(t.get("chapter")) or 0))
        return [{"id": str(t.get("id")), "title": _txt(t.get("title"), 60), "chapter": int(_num(t.get("chapter")) or 0)}
                for t in topics if TOPIC_ID_RE.match(str(t.get("id") or ""))]

    def chapter_label(self, spec: str, topic: dict[str, Any]) -> str:
        ch = int(_num(topic.get("chapter")) or 0)
        title = _txt(topic.get("title"), 40)
        if not ch:
            return "快速重點 " + title
        return ("共筆 %02d " % ch if spec == "oph" else "第 %02d 章 " % ch) + title

    # -- 切成段落
    def _units(self, spec: str) -> list[dict[str, Any]]:
        d = self.data(spec)
        topics = [t for t in (d.get("topics") or []) if isinstance(t, dict) and t.get("id")]
        by_id = {str(t["id"]): t for t in topics}
        units: list[dict[str, Any]] = []

        def add(chapter: str, kind: str, label: str, text: str, pin: bool = False) -> None:
            text = _clip(text)
            if text:
                units.append({"chapter": chapter, "kind": kind, "text": "【" + label + "】" + text, "pin": pin})

        def home(tid: str) -> str:
            if spec == "oph" and tid in LEGACY_TOPICS and LEGACY_TOPICS[tid] in by_id:
                return LEGACY_TOPICS[tid]
            return tid

        for t in topics:
            tid = str(t["id"])
            lab = self.chapter_label(spec, t)
            add(home(tid), "summary", lab + "｜摘要", t.get("summary") or "", pin=bool(t.get("chapter")))
            for sec in t.get("sections") or []:
                if isinstance(sec, dict):
                    pts = " ".join(str(p) for p in (sec.get("points") or []) if isinstance(p, str))
                    add(home(tid), "section", lab + "｜" + _txt(sec.get("title"), 30), pts)
            for row in t.get("compare") or []:
                if isinstance(row, list) and len(row) >= 2:
                    trap = ("；陷阱：" + str(row[2])) if len(row) > 2 and row[2] else ""
                    add(home(tid), "compare", lab + "｜易混", f"{row[0]}：{row[1]}{trap}")
            if t.get("correction"):
                add(home(tid), "correction", lab + "｜共筆更正", str(t["correction"]), pin=True)
            for c in t.get("cases") or []:
                if isinstance(c, dict) and c.get("prompt"):
                    add(home(tid), "case", lab + "｜情境", f"{c.get('prompt')} → {c.get('answer') or ''}")
        for q in d.get("questions") or []:
            if not isinstance(q, dict) or q.get("reserve") or not q.get("stem"):
                continue
            opts = q.get("options") if isinstance(q.get("options"), list) else []
            ci = q.get("correctIndex")
            ans = opts[ci] if isinstance(ci, int) and 0 <= ci < len(opts) else ""
            tag = "歷屆考點改寫" if q.get("pastExam") or "考古" in str(q.get("sourceType") or "") else "練習題"
            add(home(str(q.get("topicId") or "")), "question", f"{tag} {q.get('id')}",
                f"{q.get('stem')} → 答：{ans}。{q.get('explanation') or ''}")
        for w in self._written(spec):
            kp = "；".join(str(k) for k in (w.get("keyPoints") or []) if isinstance(k, str))
            add(home(str(w.get("topicId") or "")), "written", "筆試申論｜" + _txt(w.get("title"), 40),
                f"{w.get('prompt') or ''} 要點：{kp}。地雷：{w.get('pitfall') or ''}")
        wfs = d.get("workflows")
        wfs = wfs.get("workflows") if isinstance(wfs, dict) else wfs
        for w in wfs or []:
            if not isinstance(w, dict):
                continue
            steps = "；".join(f"{s.get('title')}：{s.get('detail')}" for s in (w.get("steps") or []) if isinstance(s, dict))
            pit = "；".join(str(p) for p in (w.get("pitfalls") or []) if isinstance(p, str))
            tids = [str(x) for x in (w.get("topicIds") or [])]
            add(home(tids[0]) if tids else "", "workflow", "臨床流程｜" + _txt(w.get("title"), 40),
                f"{steps}。常錯：{pit}")
        enr = (d.get("enrichment") or {}).get("chapters") if isinstance(d.get("enrichment"), dict) else None
        for tid, e in (enr or {}).items():
            if not isinstance(e, dict):
                continue
            for dd in e.get("deepDive") or []:
                if isinstance(dd, dict):
                    add(home(str(tid)), "deep", "深入｜" + _txt(dd.get("heading"), 40),
                        " ".join(str(p) for p in (dd.get("paragraphs") or []) if isinstance(p, str)))
        return units

    def _index(self, spec: str) -> dict[str, Any]:
        with self._lock:
            self._load()
            cached = self._idx.get(spec)
        if cached is not None:
            return cached
        units = self._units(spec)
        df: Counter = Counter()
        for u in units:
            u["tf"] = Counter(tokens(u["text"]))
            u["len"] = sum(u["tf"].values()) or 1
            df.update(u["tf"].keys())
        n = len(units) or 1
        avg = sum(u["len"] for u in units) / n
        idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}
        idx = {"units": units, "idf": idf, "avg": avg}
        with self._lock:
            self._idx[spec] = idx
        return idx

    def retrieve(self, spec: str, weighted_texts: list[tuple[str, float]], chapter: str = "",
                 budget: int = REFERENCE_CHAR_BUDGET) -> list[str]:
        """依問題挑段落。weighted_texts：[(文字, 權重)]，例如新訊息 1.0、主題 0.6、前文 0.3。"""
        idx = self._index(spec)
        units, idf, avg = idx["units"], idx["idf"], idx["avg"] or 1.0
        q: Counter = Counter()
        for text, wt in weighted_texts:
            for tok in tokens(text):
                q[tok] += wt
        picked: list[str] = []
        used = 0

        def take(text: str) -> bool:
            nonlocal used
            if text in picked or used + len(text) > budget:
                return False
            picked.append(text)
            used += len(text)
            return True

        if chapter:
            for u in units:
                if u["chapter"] == chapter and u["pin"]:
                    take(u["text"])
        if not q:
            return picked
        k1, b = 1.2, 0.75
        scored = []
        for u in units:
            s = 0.0
            for tok, wt in q.items():
                f = u["tf"].get(tok)
                if f:
                    s += wt * idf.get(tok, 0.0) * f * (k1 + 1) / (f + k1 * (1 - b + b * u["len"] / avg))
            if s > 0:
                if chapter and u["chapter"] == chapter:
                    s *= 1.3
                scored.append((s, u["text"]))
        scored.sort(key=lambda x: -x[0])
        if scored:
            floor = scored[0][0] * 0.2
            for s, text in scored[:40]:
                if s < floor:
                    break
                take(text)
        return picked


COURSE = CourseIndex()


# ---------------------------------------------------------------- 儲存（~/.ophthalmology-tutor，不在 repo 裡）
class Store:
    def __init__(self, home: str):
        self.home = os.path.abspath(os.path.expanduser(home))
        self.sessions = os.path.join(self.home, "sessions")
        self.lock = threading.Lock()   # 短暫的「讀檔 → 改 → 存檔」

    def _write(self, path: str, obj: Any) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(obj, fh, ensure_ascii=False, indent=1)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    @staticmethod
    def _read(path: str) -> dict[str, Any] | None:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                obj = json.load(fh)
            return obj if isinstance(obj, dict) else None
        except (OSError, ValueError):
            return None

    def new_session(self, spec: str, chapter: str = "") -> dict[str, Any]:
        now = _now_iso()
        return {"id": _new_id(), "specialty": spec, "chapter": chapter, "title": "", "topic": "",
                "created_at": now, "updated_at": now, "messages": [], "state": None, "turns": 0,
                "archived": False, "skill": SKILL_SOURCE}

    def path(self, sid: str) -> str:
        return os.path.join(self.sessions, sid + ".json")

    def save(self, sess: dict[str, Any]) -> None:
        self._write(self.path(sess["id"]), sess)

    def get(self, sid: str) -> dict[str, Any]:
        sid = str(sid or "").strip()
        if not ID_RE.match(sid):
            raise TutorError("bad_id", "課程編號不對", 400)
        sess = self._read(self.path(sid))
        if not sess:
            raise TutorError("not_found", "找不到這個課程", 404)
        return sess

    def list(self, spec: str, limit: int = 50) -> list[dict[str, Any]]:
        out = []
        for p in glob.glob(os.path.join(self.sessions, "t*.json")):
            sess = self._read(p)
            if not sess or sess.get("archived") or not ID_RE.match(str(sess.get("id") or "")):
                continue
            if spec_of(sess.get("specialty")) != spec:
                continue
            st = sess.get("state") or {}
            out.append({"id": sess["id"], "title": sess.get("title") or "", "topic": sess.get("topic") or "",
                        "updated_at": sess.get("updated_at"), "turns": sess.get("turns") or 0,
                        "phase": st.get("phase"), "overall": overall_pct(st)})
        out.sort(key=lambda s: str(s.get("updated_at") or ""), reverse=True)
        return out[:limit]

    def archive(self, sid: str) -> dict[str, Any]:
        with self.lock:
            sess = self.get(sid)
            sess["archived"] = True
            sess["updated_at"] = _now_iso()
            self.save(sess)
        return {"ok": True, "id": sess["id"]}

    def settings(self) -> dict[str, Any]:
        raw = self._read(os.path.join(self.home, "settings.json")) or {}
        acct = raw.get("account_dir") if raw.get("account_dir") in account_dirs() else None
        model = raw.get("model") if raw.get("model") in MODELS else None
        return {"account_dir": acct, "model": model}

    def save_settings(self, account_dir: Any = None, model: Any = None) -> dict[str, Any]:
        cur = self.settings()
        if account_dir is not None:
            if not isinstance(account_dir, str) or (account_dir and account_dir not in account_dirs()):
                raise TutorError("bad_account", "沒有這個 Claude 帳號資料夾", 400)
            cur["account_dir"] = account_dir or None
        if model is not None:
            if not isinstance(model, str) or (model and model not in MODELS):
                raise TutorError("bad_model", "不支援這個模型", 400)
            cur["model"] = model or None
        self._write(os.path.join(self.home, "settings.json"), dict(cur, updated_at=_now_iso()))
        return {"ok": True, "settings": cur}


# ---------------------------------------------------------------- Claude Code（與 shioaji-app tutor.py 相同的呼叫方式）
def resolve_claude_bin() -> str | None:
    home = os.path.expanduser("~")
    cands = [os.environ.get("TUTOR_CLAUDE_BIN"), shutil.which("claude"),
             f"{home}/.local/bin/claude", f"{home}/.claude/local/claude",
             "/opt/homebrew/bin/claude", "/usr/local/bin/claude", f"{home}/.npm-global/bin/claude"]
    cands += sorted(glob.glob(f"{home}/.nvm/versions/node/*/bin/claude"), reverse=True)
    for c in cands:
        if c and os.path.isfile(os.path.expanduser(c)) and os.access(os.path.expanduser(c), os.X_OK):
            return os.path.expanduser(c)
    return None


_ENV_KEEP = ("HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TERM",
             "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
             "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS")
DEFAULT_ACCOUNT = "~/.claude"


def is_default_account(path: str | None) -> bool:
    """~/.claude 是 claude 不帶 CLAUDE_CONFIG_DIR 時用的帳號；把它設成 CLAUDE_CONFIG_DIR 反而會被當成另一個帳號。"""
    if not (path or "").strip():
        return True
    return os.path.normpath(os.path.expanduser(path.strip())) == os.path.normpath(os.path.expanduser(DEFAULT_ACCOUNT))


def env_account() -> str | None:
    return (os.environ.get("TUTOR_CLAUDE_CONFIG_DIR") or os.environ.get("CLAUDE_CONFIG_DIR") or "").strip() or None


def account_dirs() -> list[str]:
    """家目錄裡的 Claude Code 帳號資料夾（~/.claude-*）；只列名字，不讀內容。"""
    home = os.path.expanduser("~")
    return sorted("~/" + os.path.basename(p) for p in glob.glob(os.path.join(home, ".claude*"))
                  if os.path.isdir(p) and re.match(r"^\.claude-[\w.-]+$", os.path.basename(p)))


def subprocess_env(bin_path: str, account_dir: str | None = None) -> dict[str, str]:
    """只帶最少的環境變數，沒有 ANTHROPIC_API_KEY（一定走訂閱登入）。"""
    env = {k: os.environ[k] for k in _ENV_KEEP if os.environ.get(k)}
    parts = [os.path.dirname(bin_path)] + [p for p in (os.environ.get("PATH") or "/usr/bin:/bin:/usr/sbin:/sbin").split(os.pathsep) if p]
    env["PATH"] = os.pathsep.join(dict.fromkeys(parts))
    cfg = (account_dir or env_account() or "").strip()
    if cfg and not is_default_account(cfg):
        env["CLAUDE_CONFIG_DIR"] = os.path.expanduser(cfg)
    env.setdefault("LANG", "en_US.UTF-8")
    return env


_ALL_TOOLS = "Bash,Edit,Write,MultiEdit,NotebookEdit,Read,Glob,Grep,LS,WebFetch,WebSearch,Task,TodoWrite"


def build_command(bin_path: str, flags: list[str], model: str, prompt_text: str) -> list[str]:
    f = set(flags or [])
    cmd = [bin_path, "-p", "--output-format", "json"]
    if model:
        cmd += ["--model", model]
    if "--append-system-prompt" in f:
        cmd += ["--append-system-prompt", prompt_text]
    if "--tools" in f:
        cmd += ["--tools", ""]
    else:
        cmd += ["--disallowedTools", _ALL_TOOLS]
    for flag in ("--strict-mcp-config", "--no-session-persistence"):
        if flag in f:
            cmd.append(flag)
    if "--max-turns" in f:
        cmd += ["--max-turns", "1"]
    return cmd


def login_command(account: str) -> str:
    """可以直接貼進「終端機」的一行：用家教現在的帳號資料夾開 claude（進去後輸入 /login）。"""
    if account == DEFAULT_ACCOUNT:
        return "claude"
    if re.match(r"^~/[\w./-]+$", account):
        return 'CLAUDE_CONFIG_DIR="$HOME/' + account[2:] + '" claude'
    return "CLAUDE_CONFIG_DIR=" + shlex.quote(os.path.expanduser(account)) + " claude"


class Tutor:
    def __init__(self, store: Store, course: CourseIndex = COURSE):
        self.store = store
        self.course = course
        self.chat_lock = threading.Lock()
        self._cli: dict[str, Any] = {}
        self._login: dict[str, str] = {}

    # -- 設定
    def account(self) -> str | None:
        return self.store.settings()["account_dir"] or env_account()

    def account_key(self) -> str:
        acct = self.account() or ""
        return DEFAULT_ACCOUNT if is_default_account(acct) else acct.strip()

    def model(self) -> str:
        return self.store.settings()["model"] or (os.environ.get("TUTOR_MODEL") or "").strip() or DEFAULT_MODEL

    def login_state(self) -> str:
        return self._login.get(self.account_key(), "unknown")

    def login_hint(self) -> str:
        key = self.account_key()
        return (f"家教用的 Claude 帳號 {key} 還沒登入（或登入過期）。打開「終端機」貼上 {login_command(key)} 按 Enter，"
                "在裡面輸入 /login 照畫面登入，登好後回來再送一次；或在「設定」換一個已登入的帳號。")

    def friendly(self, msg: str) -> TutorError:
        low = msg.lower()
        raw = re.sub(r"\s+", " ", msg).strip()[:200]
        if re.search(r"usage limit|limit reached|rate.?limit|429|quota", low):
            return TutorError("limit", f"Claude 訂閱這段時間的用量到上限了，等額度重置後再繼續。（Claude Code：{raw}）", 429)
        if re.search(r"login|log in|authenticat|oauth|invalid api key|credential", low):
            self._login[self.account_key()] = "needed"
            return TutorError("auth", f"{self.login_hint()}（Claude Code：{raw}）", 503)
        return TutorError("cli_error", "Claude Code 回覆失敗：" + raw, 502)

    # -- claude 指令
    def cli_info(self, refresh: bool = False) -> dict[str, Any]:
        now = time.time()
        if not refresh and self._cli.get("at") and now - self._cli["at"] < CLI_CACHE_S:
            return dict(self._cli["info"])
        info: dict[str, Any] = {"bin": resolve_claude_bin(), "version": None, "flags": [], "error": None}
        if not info["bin"]:
            info["error"] = "找不到 Claude Code（claude 指令）。在 Mac 上裝好並登入後重新啟動本機版，或用環境變數 TUTOR_CLAUDE_BIN 指定路徑。"
        else:
            env = subprocess_env(info["bin"])
            try:
                v = subprocess.run([info["bin"], "--version"], capture_output=True, text=True, timeout=PROBE_TIMEOUT_S, env=env)
                vtxt = (v.stdout or v.stderr or "").strip()
                info["version"] = vtxt.splitlines()[0][:80] if vtxt else None
                h = subprocess.run([info["bin"], "--help"], capture_output=True, text=True, timeout=PROBE_TIMEOUT_S, env=env)
                info["flags"] = sorted(set(re.findall(r"--[a-zA-Z][a-zA-Z-]+", (h.stdout or "") + (h.stderr or ""))))
            except (OSError, subprocess.SubprocessError) as e:
                info["error"] = f"claude 指令跑不起來：{type(e).__name__}: {str(e)[:120]}"
        self._cli = {"at": now, "info": info}
        return dict(info)

    def run_claude(self, prompt: str, spec: str) -> str:
        info = self.cli_info()
        if not info["bin"] or info.get("error"):
            raise TutorError("no_cli", info.get("error") or "找不到 Claude Code", 503)
        sysp = system_prompt(spec)
        text_prompt = prompt if "--append-system-prompt" in info["flags"] else sysp + "\n\n" + prompt
        cmd = build_command(info["bin"], info["flags"], self.model(), sysp)
        try:
            with tempfile.TemporaryDirectory(prefix="oph-tutor-") as cwd:
                proc = subprocess.run(cmd, input=text_prompt, capture_output=True, text=True, timeout=CALL_TIMEOUT_S,
                                      cwd=cwd, env=subprocess_env(info["bin"], self.store.settings()["account_dir"]))
        except subprocess.TimeoutExpired:
            raise TutorError("timeout", f"Claude Code 超過 {CALL_TIMEOUT_S} 秒沒回，請再送一次。", 504)
        except OSError as e:
            raise TutorError("no_cli", f"claude 指令跑不起來：{e}", 503)
        out = (proc.stdout or "").strip()
        obj = None
        for cand in (out, out.splitlines()[-1] if out else ""):
            try:
                obj = json.loads(cand)
                break
            except ValueError:
                continue
        if isinstance(obj, dict):
            if obj.get("is_error") or proc.returncode != 0 or obj.get("subtype") not in (None, "success"):
                raise self.friendly(str(obj.get("result") or obj.get("subtype") or proc.stderr or "unknown error"))
            self._login[self.account_key()] = "ok"
            return str(obj.get("result") or "")
        raise self.friendly((proc.stderr or out or f"exit {proc.returncode}").strip())

    # -- 提示
    def build_prompt(self, sess: dict[str, Any], message: str) -> str:
        spec = spec_of(sess.get("specialty"))
        st = sess.get("state") or {}
        msgs = sess.get("messages") or []
        recent = " ".join(str(m.get("text") or "") for m in msgs[-2:])
        focus = " ".join(str(s.get("name") or "") for s in (st.get("subskills") or []) if isinstance(s, dict) and s.get("focus"))
        about = " ".join([str(sess.get("topic") or ""), str(st.get("topic") or ""), focus])
        refs = self.course.retrieve(spec, [(message, 1.0), (about, 0.6), (recent, 0.3)], chapter=str(sess.get("chapter") or ""))
        lines, total = [], 0
        for m in reversed(msgs):
            who = "Student" if m.get("role") == "user" else "Tutor"
            line = f"{who}: {m.get('text') or ''}"
            if total + len(line) > HISTORY_CHAR_BUDGET:
                lines.append("(earlier turns omitted; rely on the notes in the current state)")
                break
            lines.append(line)
            total += len(line)
        lines.reverse()
        parts = [f"[Reference notes from the student's site · {SPECIALTIES[spec]}]",
                 "\n".join("- " + r for r in refs) if refs else "(none matched this message)", "",
                 "[Current state kept by the app]", json.dumps(sess.get("state"), ensure_ascii=False) if sess.get("state") else "none yet (new session)",
                 "", "[Conversation so far, oldest first]", "\n\n".join(lines) if lines else "(no turns yet)",
                 "", "[Student's new message]", message, "",
                 "Write the tutor's next message now, then the STATE block."]
        return "\n".join(parts)

    # -- 對外
    def chat(self, sid: Any, message: Any, spec: Any = None, chapter: Any = None) -> dict[str, Any]:
        msg = str(message or "").strip()
        if not msg:
            raise TutorError("empty", "請先輸入訊息", 400)
        if len(msg) > MAX_MESSAGE_CHARS:
            raise TutorError("too_long", f"訊息太長（上限 {MAX_MESSAGE_CHARS} 字）", 400)
        chapter = str(chapter or "").strip()
        if chapter and not TOPIC_ID_RE.match(chapter):
            raise TutorError("bad_chapter", "章節編號不對", 400)
        if not self.chat_lock.acquire(blocking=False):
            raise TutorError("busy", "家教還在回上一則，等它回完再送。", 409)
        try:
            if str(sid or "").strip():
                sess = self.store.get(str(sid))
            else:
                sess = self.store.new_session(spec_of(spec), chapter)
            reply, raw_state = parse_reply(self.run_claude(self.build_prompt(sess, msg), spec_of(sess.get("specialty"))))
            if not reply:
                raise TutorError("empty_reply", "Claude Code 回了空白訊息，請再送一次。", 502)
            now = _now_iso()
            sess["messages"] = list(sess.get("messages") or []) + [{"role": "user", "text": msg, "at": now},
                                                                 {"role": "tutor", "text": reply, "at": _now_iso()}]
            sess["state"] = clean_state(raw_state, sess.get("state"))
            st = sess["state"] or {}
            sess["title"] = st.get("title") or sess.get("title") or _txt(msg, 20)
            sess["topic"] = st.get("topic") or sess.get("topic") or ""
            sess["turns"] = sum(1 for m in sess["messages"] if m.get("role") == "user")
            sess["updated_at"] = _now_iso()
            with self.store.lock:
                # 等回覆時這堂課在別的分頁被收起來了：收起要留著，不能被手上的舊副本蓋掉
                on_disk = self.store._read(self.store.path(sess["id"]))
                if on_disk and on_disk.get("archived"):
                    sess["archived"] = True
                self.store.save(sess)
            return {"ok": True, "session": sess, "reply": reply}
        finally:
            self.chat_lock.release()

    def check_login(self) -> dict[str, Any]:
        if not self.chat_lock.acquire(blocking=False):
            raise TutorError("busy", "家教還在回上一則，等它回完再試。", 409)
        try:
            self.run_claude("這是連線測試。只回覆 OK，不要輸出別的，也不要輸出 STATE。", "oph")
            return {"ok": True, "login": self.login_state()}
        finally:
            self.chat_lock.release()

    def status(self, spec: Any = None) -> dict[str, Any]:
        spec = spec_of(spec)
        info = self.cli_info()
        try:
            sessions, err = self.store.list(spec), None
        except Exception as e:  # 讀不到課程清單不影響狀態
            sessions, err = [], str(e)[:120]
        key = self.account_key()
        return {"ok": True, "available": bool(info["bin"]) and not info.get("error"), "reason": info.get("error"),
                "busy": self.chat_lock.locked(), "login": self.login_state(), "specialty": spec,
                "specialty_label": SPECIALTIES[spec], "chapters": self.course.chapters(spec),
                "claude": {"bin": info["bin"], "version": info["version"], "model": self.model(), "models": list(MODELS),
                           "account_dir": self.account(), "account_dirs": account_dirs(),
                           "default_account": env_account() or DEFAULT_ACCOUNT, "login_command": login_command(key)},
                "data_dir": self.store.home, "skill": SKILL_SOURCE, "sessions": sessions, "sessions_error": err}


# ---------------------------------------------------------------- HTTP
class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "OphTutor/1"
    tutor: Tutor = None  # type: ignore[assignment]
    port: int = DEFAULT_PORT

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_request(self, code: Any = "-", size: Any = "-") -> None:  # 只記失敗的請求，不把每個靜態檔都印出來
        try:
            failed = int(code) >= 400
        except (TypeError, ValueError):
            failed = False
        if failed:
            super().log_request(code, size)

    def log_error(self, fmt: str, *args: Any) -> None:  # 失敗已由 log_request 記一行
        pass

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")  # 每次都向本機確認，改版後重新整理就是新版
        super().end_headers()

    # -- 守門
    def _hosts(self) -> set:
        return {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}

    def _host_ok(self) -> bool:
        return (self.headers.get("Host") or "").strip().lower() in self._hosts()

    def _mutation_ok(self) -> str | None:
        if not self._host_ok():
            return "Host 不是本機"
        origin = (self.headers.get("Origin") or "").strip().lower()
        if origin and origin not in {"http://" + h for h in self._hosts()}:
            return "只接受本機網頁送來的請求"
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return "需要 JSON"
        if self.headers.get("X-Tutor") != "1":
            return "缺少 X-Tutor 標頭"
        return None

    def _json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, e: TutorError) -> None:
        self._json({"ok": False, "error": e.message, "code": e.code}, e.http)

    def _body(self) -> dict[str, Any]:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n < 0 or n > MAX_BODY_BYTES:
            raise TutorError("too_large", "請求太大", 413)
        raw = self.rfile.read(n) if n else b""
        if not raw:
            return {}
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise TutorError("bad_json", "JSON 格式不對", 400)
        if not isinstance(obj, dict):
            raise TutorError("bad_json", "JSON 要是物件", 400)
        return obj

    # -- 路由
    def do_GET(self) -> None:  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/api/"):
            if not self._host_ok():
                return self._json({"ok": False, "error": "Host 不是本機", "code": "forbidden"}, 403)
            qs = urllib.parse.parse_qs(url.query)
            try:
                if url.path == "/api/tutor/status":
                    return self._json(self.tutor.status((qs.get("specialty") or [""])[0]))
                if url.path == "/api/tutor/session":
                    return self._json({"ok": True, "session": self.tutor.store.get((qs.get("id") or [""])[0])})
            except TutorError as e:
                return self._error(e)
            return self._json({"ok": False, "error": "沒有這個 API", "code": "not_found"}, 404)
        if url.path in ("/tutor", "/tutor/"):
            self.send_response(302)
            self.send_header("Location", "/#tutor")
            self.end_headers()
            return
        parts = [p for p in urllib.parse.unquote(url.path).split("/") if p]
        if any(p.startswith(".") for p in parts):
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self.path.startswith("/api/") or any(p.startswith(".") for p in urllib.parse.unquote(self.path.split("?")[0]).split("/") if p):
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        bad = self._mutation_ok()
        if bad:
            return self._json({"ok": False, "error": bad, "code": "forbidden"}, 403)
        try:
            body = self._body()
            if url.path == "/api/tutor/chat":
                return self._json(self.tutor.chat(body.get("id"), body.get("message"), body.get("specialty"), body.get("chapter")))
            if url.path == "/api/tutor/archive":
                return self._json(self.tutor.store.archive(str(body.get("id") or "")))
            if url.path == "/api/tutor/check":
                return self._json(self.tutor.check_login())
            if url.path == "/api/tutor/settings":
                return self._json(self.tutor.store.save_settings(account_dir=body.get("account_dir"), model=body.get("model")))
        except TutorError as e:
            return self._error(e)
        return self._json({"ok": False, "error": "沒有這個 API", "code": "not_found"}, 404)


def make_server(port: int, data_dir: str, course: CourseIndex = COURSE) -> http.server.ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"tutor": Tutor(Store(data_dir), course), "port": port})
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.daemon_threads = True
    handler.port = httpd.server_address[1]  # --port 0（測試用）時換成實際的連接埠
    return httpd


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="眼科甄選練習室 · 蘇格拉底家教（本機版）")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"本機連接埠（預設 {DEFAULT_PORT}）")
    ap.add_argument("--data-dir", default=os.environ.get("OPH_TUTOR_HOME") or "~/.ophthalmology-tutor",
                    help="對話與設定存放位置（預設 ~/.ophthalmology-tutor）")
    ap.add_argument("--no-open", action="store_true", help="不要自動打開瀏覽器")
    args = ap.parse_args(argv)
    try:
        httpd = make_server(args.port, args.data_dir)
    except OSError as e:
        print(f"連接埠 {args.port} 開不起來（{e.strerror or e}）。可能已經開著一個本機版：直接打開 "
              f"http://127.0.0.1:{args.port}/#tutor ；或換一個，例如 --port {args.port + 1}", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{args.port}/#tutor"
    tutor = httpd.RequestHandlerClass.tutor  # type: ignore[attr-defined]
    info = tutor.cli_info()
    print("眼科甄選練習室 · 蘇格拉底家教（本機版）")
    print(f"  網址：{url}")
    print(f"  Claude Code：{info['bin'] or '找不到'}{(' · ' + info['version']) if info.get('version') else ''}")
    if info.get("error"):
        print("  " + info["error"])
    print(f"  對話存放：{tutor.store.home}")
    print("  按 Ctrl+C 結束。")
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已結束。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ---------------------------------------------------------------- 授權
# The Socratic Tutor instructions above (SKILL_TEXT) come from
# https://github.com/janestreet/agent_skills (socratic-tutor/SKILL.md, commit 7c6715c):
#
# The MIT License
#
# Copyright (c) 2026 Jane Street Group, LLC <opensource-contacts@janestreet.com>
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
