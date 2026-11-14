#!/usr/bin/env python3
"""Offline tests for scripts/tutor-server.py: a fake `claude` binary, a temporary HOME and data dir, no network."""
from __future__ import annotations

import http.client
import importlib.util
import json
import os
import stat
import sys
import tempfile
import threading
import unittest

sys.dont_write_bytecode = True  # loading tutor-server.py must not leave scripts/__pycache__ behind
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, os, sys
log = __LOG__  # the tutor passes only a minimal environment, so paths are baked in
args = sys.argv[1:]
if "--version" in args:
    print("9.9.9 (Claude Code fake)"); sys.exit(0)
if "--help" in args:
    print("Usage: claude [options]\n  -p, --print\n  --output-format <format>\n  --model <model>\n"
          "  --append-system-prompt <prompt>\n  --tools <tools...>\n  --strict-mcp-config\n"
          "  --no-session-persistence\n  --max-turns <n>"); sys.exit(0)
prompt = sys.stdin.read()
if log:
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"argv": args, "stdin": prompt, "cwd": os.getcwd(),
                             "env": sorted(os.environ.keys()),
                             "config_dir": os.environ.get("CLAUDE_CONFIG_DIR")}, ensure_ascii=False) + "\n")
mode = open(__MODE__).read().strip() if os.path.exists(__MODE__) else "ok"
if mode == "auth":
    print(json.dumps({"type": "result", "subtype": "success", "is_error": True, "result": "Invalid API key · Please run /login"})); sys.exit(1)
if mode == "limit":
    print(json.dumps({"type": "result", "subtype": "success", "is_error": True, "result": "Claude usage limit reached. Your limit will reset at 5am"})); sys.exit(1)
if mode == "nostate":
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "先回答我：RAPD 是什麼？"})); sys.exit(0)
state = {"phase": "diagnostic", "title": "急性隅角閉鎖", "topic": "急性隅角閉鎖", "target": 4,
         "subskills": [{"name": "辨識發作", "level": None, "focus": True}, {"name": "降眼壓藥物", "level": 2}],
         "notes": ["還沒問 LPI 的時機"]}
reply = "我先問幾題看看你的程度。\n\n急性隅角閉鎖病人眼壓 60 mmHg，你第一步做什麼？\n<<<STATE\n" + json.dumps(state, ensure_ascii=False) + "\nSTATE>>>"
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": reply}, ensure_ascii=False))
'''


def load_server():
    spec = importlib.util.spec_from_file_location("tutor_server", os.path.join(HERE, "tutor-server.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


TS = load_server()


class PureFunctions(unittest.TestCase):
    def test_parse_reply_splits_state(self):
        reply, st = TS.parse_reply('第一題：RAPD 怎麼測？\n<<<STATE\n{"phase":"diagnostic","subskills":[]}\nSTATE>>>')
        self.assertEqual(reply, "第一題：RAPD 怎麼測？")
        self.assertEqual(st["phase"], "diagnostic")
        reply, st = TS.parse_reply("沒有狀態的回覆\n<<<STA")
        self.assertEqual((reply, st), ("沒有狀態的回覆", None))
        reply, st = TS.parse_reply("壞掉的狀態\n<<<STATE\n{not json\nSTATE>>>")
        self.assertEqual((reply, st), ("壞掉的狀態", None))

    def test_clean_state_keeps_previous_fields_when_shapes_are_wrong(self):
        prev = TS.clean_state({"phase": "teaching", "target": 5, "subskills": [{"name": "A", "level": 3}], "notes": ["x"]})
        st = TS.clean_state({"phase": "bogus", "target": "nan", "subskills": "A", "notes": {"x": 1}}, prev)
        self.assertEqual(st["phase"], "teaching")
        self.assertEqual(st["target"], 5)
        self.assertEqual(st["subskills"], prev["subskills"])
        self.assertEqual(st["notes"], ["x"])
        st = TS.clean_state({"subskills": [{"name": "B", "level": 9}, {"name": "", "level": 1}, {"level": 2}]}, prev)
        self.assertEqual(st["subskills"], [{"name": "B", "level": 5, "focus": False}])
        self.assertIs(TS.clean_state("not a dict", prev), prev)
        self.assertEqual(TS.overall_pct(prev), 60)

    def test_tokens_use_cjk_bigrams_and_english_words(self):
        self.assertEqual(TS.tokens("急性隅角 PI"), ["急性", "性隅", "隅角", "pi"])
        self.assertIn("anti", TS.tokens("anti-VEGF 治療"))
        self.assertIn("vegf", TS.tokens("anti-VEGF 治療"))
        self.assertEqual(TS.tokens("眼"), ["眼"])

    def test_build_command_disables_tools_and_appends_rules(self):
        flags = ["--append-system-prompt", "--tools", "--strict-mcp-config", "--no-session-persistence", "--max-turns"]
        cmd = TS.build_command("/x/claude", flags, "sonnet", "RULES")
        self.assertEqual(cmd[:4], ["/x/claude", "-p", "--output-format", "json"])
        self.assertIn("RULES", cmd)
        self.assertEqual(cmd[cmd.index("--tools") + 1], "")
        self.assertEqual(cmd[cmd.index("--max-turns") + 1], "1")
        old = TS.build_command("/x/claude", [], "", "RULES")
        self.assertIn("--disallowedTools", old)
        self.assertNotIn("RULES", old)

    def test_subprocess_env_has_no_api_key_or_app_secrets(self):
        os.environ["ANTHROPIC_API_KEY"] = "sk-should-not-leak"
        os.environ["GITHUB_TOKEN"] = "ghp-should-not-leak"
        try:
            env = TS.subprocess_env("/opt/bin/claude", "~/.claude-work")
        finally:
            del os.environ["ANTHROPIC_API_KEY"], os.environ["GITHUB_TOKEN"]
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertTrue(env["PATH"].startswith("/opt/bin"))
        self.assertTrue(env["CLAUDE_CONFIG_DIR"].endswith(".claude-work"))
        self.assertNotIn("CLAUDE_CONFIG_DIR", TS.subprocess_env("/opt/bin/claude", "~/.claude"))

    def test_login_command_is_pasteable(self):
        self.assertEqual(TS.login_command("~/.claude"), "claude")
        self.assertEqual(TS.login_command("~/.claude-2"), 'CLAUDE_CONFIG_DIR="$HOME/.claude-2" claude')

    def test_rules_name_the_specialty_and_keep_the_state_format(self):
        p = TS.system_prompt("ent")
        self.assertIn("耳鼻喉科", p)
        self.assertIn("<<<STATE", p)
        self.assertIn("共筆更正", p)
        self.assertIn("CRAO", TS.system_prompt("oph"))
        self.assertNotIn("CRAO", p)


class CourseRetrieval(unittest.TestCase):
    def test_every_specialty_lists_its_chapters(self):
        oph = TS.COURSE.chapters("oph")
        self.assertEqual([c["id"] for c in oph], ["notes-%02d" % i for i in range(1, 15)])
        for spec in ("ent", "rad", "nm", "neuro"):
            self.assertTrue(TS.COURSE.chapters(spec), spec)

    def test_pinned_chapter_brings_its_summary_and_correction(self):
        refs = TS.COURSE.retrieve("oph", [("CRAO 眼球按摩", 1.0)], chapter="notes-10")
        self.assertTrue(refs[0].startswith("【共筆 10"))
        self.assertTrue(any("共筆更正" in r and "CRAO" in r for r in refs))
        self.assertLessEqual(sum(len(r) for r in refs), TS.REFERENCE_CHAR_BUDGET)

    def test_query_finds_matching_notes_and_respects_budget(self):
        refs = TS.COURSE.retrieve("oph", [("急性隅角閉鎖 pilocarpine 雷射虹膜切開", 1.0)], budget=2500)
        self.assertTrue(refs)
        self.assertTrue(any("隅角閉鎖" in r for r in refs[:3]))
        self.assertLessEqual(sum(len(r) for r in refs), 2500)
        self.assertFalse(any("atlas-s" in r for r in refs))
        self.assertEqual(TS.COURSE.retrieve("oph", [("", 1.0)]), [])


class ServerEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = cls.tmp.name
        cls.home = os.path.join(base, "home")
        os.makedirs(os.path.join(cls.home, ".claude-2"))
        cls.data = os.path.join(base, "data")
        cls.log = os.path.join(base, "calls.jsonl")
        cls.mode = os.path.join(base, "mode")
        fake = os.path.join(base, "claude")
        with open(fake, "w", encoding="utf-8") as fh:
            fh.write(FAKE_CLAUDE.replace("#!/usr/bin/env python3", "#!" + sys.executable, 1)
                     .replace("__LOG__", repr(cls.log)).replace("__MODE__", repr(cls.mode)))
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        cls.saved_env = dict(os.environ)
        os.environ.update({"HOME": cls.home, "TUTOR_CLAUDE_BIN": fake, "ANTHROPIC_API_KEY": "sk-should-not-leak"})
        os.environ.pop("TUTOR_CLAUDE_CONFIG_DIR", None)
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        cls.httpd = TS.make_server(0, cls.data)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        os.environ.clear()
        os.environ.update(cls.saved_env)
        cls.tmp.cleanup()

    def setUp(self):
        self.set_mode("ok")

    def set_mode(self, mode):
        with open(self.mode, "w") as fh:
            fh.write(mode)

    def req(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": "127.0.0.1:%d" % self.port}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h.update({"Content-Type": "application/json", "X-Tutor": "1", "Origin": "http://127.0.0.1:%d" % self.port})
        if raw is not None:
            data = raw
        h.update(headers or {})
        conn.request(method, path, body=data, headers=h)
        r = conn.getresponse()
        text = r.read().decode("utf-8", "replace")
        conn.close()
        try:
            payload = json.loads(text)
        except ValueError:
            payload = text
        return r.status, payload, dict(r.getheaders())

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def test_01_status_reports_cli_chapters_and_no_sessions(self):
        code, st, _ = self.req("GET", "/api/tutor/status?specialty=oph")
        self.assertEqual(code, 200)
        self.assertTrue(st["available"])
        self.assertEqual(st["claude"]["version"], "9.9.9 (Claude Code fake)")
        self.assertEqual(len(st["chapters"]), 14)
        self.assertEqual(st["sessions"], [])
        self.assertIn("~/.claude-2", st["claude"]["account_dirs"])
        self.assertEqual(st["claude"]["model"], "sonnet")
        code, st, _ = self.req("GET", "/api/tutor/status?specialty=../../etc")
        self.assertEqual(st["specialty"], "oph")

    def test_02_mutations_need_local_json_requests(self):
        ok = {"message": "教我青光眼", "specialty": "oph"}
        self.assertEqual(self.req("POST", "/api/tutor/chat", ok, {"X-Tutor": "0"})[0], 403)
        self.assertEqual(self.req("POST", "/api/tutor/chat", ok, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.req("POST", "/api/tutor/chat", ok, {"Content-Type": "text/plain"})[0], 403)
        self.assertEqual(self.req("POST", "/api/tutor/chat", ok, {"Host": "evil.example:%d" % self.port})[0], 403)
        self.assertEqual(self.req("GET", "/api/tutor/status", headers={"Host": "rebind.example"})[0], 403)
        big = b"{" + b'"m":"' + b"x" * (70 * 1024) + b'"}'
        code, body, _ = self.req("POST", "/api/tutor/chat", headers={"Content-Type": "application/json", "X-Tutor": "1"}, raw=big)
        self.assertEqual(code, 413)
        self.assertEqual(self.calls(), [], "no request reached claude")

    def test_03_chat_creates_a_grounded_session_outside_the_repo(self):
        code, r, _ = self.req("POST", "/api/tutor/chat", {"message": "教我急性隅角閉鎖", "specialty": "oph", "chapter": "notes-07"})
        self.assertEqual(code, 200, r)
        sess = r["session"]
        self.assertEqual(sess["specialty"], "oph")
        self.assertEqual(sess["chapter"], "notes-07")
        self.assertEqual(sess["turns"], 1)
        self.assertEqual(sess["state"]["phase"], "diagnostic")
        self.assertEqual(sess["title"], "急性隅角閉鎖")
        self.assertNotIn("<<<STATE", r["reply"])
        self.assertTrue(os.path.exists(os.path.join(self.data, "sessions", sess["id"] + ".json")))
        self.assertFalse(os.path.abspath(self.data).startswith(ROOT))
        call = self.calls()[-1]
        self.assertIn("[Reference notes from the student's site · 眼科]", call["stdin"])
        self.assertIn("【共筆 07 青光眼｜摘要】", call["stdin"])
        self.assertIn("教我急性隅角閉鎖", call["stdin"])
        self.assertIn("--append-system-prompt", call["argv"])
        rules = call["argv"][call["argv"].index("--append-system-prompt") + 1]
        self.assertIn("眼科甄選練習室", rules)
        self.assertIn("Socratic Tutor", rules)
        self.assertEqual(call["argv"][call["argv"].index("--tools") + 1], "")
        self.assertNotIn("ANTHROPIC_API_KEY", call["env"])
        self.assertIsNone(call["config_dir"])
        self.assertNotEqual(os.path.realpath(call["cwd"]), os.path.realpath(ROOT))
        type(self).sid = sess["id"]

    def test_04_follow_up_keeps_history_and_lists_by_specialty(self):
        code, r, _ = self.req("POST", "/api/tutor/chat", {"id": self.sid, "message": "先給 acetazolamide"})
        self.assertEqual(code, 200, r)
        self.assertEqual(r["session"]["turns"], 2)
        stdin = self.calls()[-1]["stdin"]
        self.assertIn("Student: 教我急性隅角閉鎖", stdin)
        self.assertIn('"phase": "diagnostic"', stdin)
        self.assertEqual([s["id"] for s in self.req("GET", "/api/tutor/status?specialty=oph")[1]["sessions"]], [self.sid])
        self.assertEqual(self.req("GET", "/api/tutor/status?specialty=ent")[1]["sessions"], [])
        code, r, _ = self.req("GET", "/api/tutor/session?id=" + self.sid)
        self.assertEqual((code, len(r["session"]["messages"])), (200, 4))
        self.assertEqual(self.req("GET", "/api/tutor/session?id=../../x")[0], 400)
        self.assertEqual(self.req("GET", "/api/tutor/session?id=t20990101-000000-abcdef")[0], 404)

    def test_05_reply_without_state_keeps_previous_state(self):
        self.set_mode("nostate")
        code, r, _ = self.req("POST", "/api/tutor/chat", {"id": self.sid, "message": "我不確定"})
        self.assertEqual(code, 200, r)
        self.assertEqual(r["session"]["state"]["phase"], "diagnostic")
        self.assertEqual(r["reply"], "先回答我：RAPD 是什麼？")

    def test_06_login_and_limit_errors_are_explained(self):
        self.set_mode("auth")
        code, r, _ = self.req("POST", "/api/tutor/chat", {"message": "教我白內障", "specialty": "oph"})
        self.assertEqual((code, r["code"]), (503, "auth"))
        self.assertIn("/login", r["error"])
        self.assertEqual(self.req("GET", "/api/tutor/status")[1]["login"], "needed")
        self.set_mode("limit")
        code, r, _ = self.req("POST", "/api/tutor/check", {})
        self.assertEqual((code, r["code"]), (429, "limit"))
        self.set_mode("ok")
        code, r, _ = self.req("POST", "/api/tutor/check", {})
        self.assertEqual((code, r["login"]), (200, "ok"))

    def test_07_busy_tutor_refuses_a_second_message(self):
        tutor = self.httpd.RequestHandlerClass.tutor
        self.assertTrue(tutor.chat_lock.acquire(blocking=False))
        try:
            code, r, _ = self.req("POST", "/api/tutor/chat", {"message": "再一題", "specialty": "oph"})
        finally:
            tutor.chat_lock.release()
        self.assertEqual((code, r["code"]), (409, "busy"))

    def test_08_settings_accept_only_known_models_and_accounts(self):
        self.assertEqual(self.req("POST", "/api/tutor/settings", {"model": "opus"})[0], 200)
        self.assertEqual(self.req("GET", "/api/tutor/status")[1]["claude"]["model"], "opus")
        self.assertEqual(self.req("POST", "/api/tutor/settings", {"model": "gpt"})[0], 400)
        self.assertEqual(self.req("POST", "/api/tutor/settings", {"account_dir": "~/.ssh"})[0], 400)
        self.assertEqual(self.req("POST", "/api/tutor/settings", {"account_dir": "~/.claude-2"})[0], 200)
        self.req("POST", "/api/tutor/chat", {"message": "教我斜視", "specialty": "oph"})
        self.assertTrue(self.calls()[-1]["config_dir"].endswith(".claude-2"))
        self.assertIn("opus", self.calls()[-1]["argv"])
        self.req("POST", "/api/tutor/settings", {"account_dir": "", "model": ""})

    def test_09_archive_hides_a_session(self):
        self.assertEqual(self.req("POST", "/api/tutor/archive", {"id": self.sid})[0], 200)
        ids = [s["id"] for s in self.req("GET", "/api/tutor/status?specialty=oph")[1]["sessions"]]
        self.assertNotIn(self.sid, ids)

    def test_10_static_site_is_served_without_dotfiles(self):
        code, body, headers = self.req("GET", "/")
        self.assertEqual(code, 200)
        self.assertIn("眼科甄選練習室", body)
        self.assertEqual(headers.get("Cache-Control"), "no-cache")
        self.assertEqual(self.req("GET", "/scripts/tutor.js")[0], 200)
        self.assertEqual(self.req("GET", "/.git/config")[0], 404)
        self.assertEqual(self.req("GET", "/%2egit/config")[0], 404)
        self.assertEqual(self.req("GET", "/.github/workflows/test-learning-project.yml")[0], 404)
        code, _, headers = self.req("GET", "/tutor")
        self.assertEqual((code, headers.get("Location")), (302, "/#tutor"))
        self.assertEqual(self.req("GET", "/api/nope")[0], 404)


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False).result
    sys.exit(0 if result.wasSuccessful() else 1)
