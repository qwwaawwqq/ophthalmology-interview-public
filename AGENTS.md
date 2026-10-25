# Rules for every AI agent on this repo (Claude, Codex, Jules)

## Project
- 眼科甄選練習室 (ophthalmology interview practice site). Buildless static site: `index.html` + `assets/` + JSON content in `content/`. Published by GitHub Pages from `main`, so merging a PR publishes it.
- No install step. Test: `node scripts/test-integrated-lessons.cjs && node scripts/test-source-coverage.cjs`. Content tooling: `python3 scripts/apply-enrichment.py`.
- Content rules: all teaching text and exam-point questions are original restatements. Never paste source handout (共筆) or textbook text verbatim. Never invent answers for questions whose source image is missing or blurry; mark them as the README describes. Keep traditional Chinese (繁體中文) and the existing JSON schemas; progress files must stay compatible with v1/v2/v3.

## How work flows (AI team: Claude, Codex, Jules)
- Every task is a GitHub issue. Labels mean:
  - `plan` — big goal; an agent splits it into small `ready` issues
  - `ready` — free for any Claude agent to take
  - `jules` — reserved for Google Jules (Claude agents skip it)
  - `claimed` — an agent is working on it
  - `in-review` — a pull request is open
  - `blocked` — needs a human
  - `pause` — if any open issue has this label, every agent stops
- One issue → one branch → one pull request. Never commit to the default branch.
- The PR body must contain `Closes #<issue number>` and say how it was tested.
- For this user's authorized updates in this repository, agents should automatically merge eligible PRs created by the agent team unless the user requests draft or PR-only delivery. Eligibility requires verifying the exact current head SHA, non-draft and conflict-free state, authorized diff scope, successful required and task-relevant tests/CI for that SHA, and existing review/branch protections. Pin direct merges to that SHA; use GitHub auto-merge only if the platform enforces the same gates, and recheck after any head change. Never bypass failed, pending, action-required or missing relevant checks, or include unrelated changes. Human-created and external-contributor PRs remain human decisions. Agents never force-push or delete branches. Verify the merge result and, when applicable, deployment outcome.
- Do not edit AGENTS.md, CLAUDE.md or `.claude/` unless the issue asks for it.
- Change only what the issue asks. No drive-by refactors. No new dependencies unless the issue asks.
- Add or update tests for behavior you change. Tests must pass before opening a PR.
- Never commit secrets (`.env`, keys, certificates, tokens).

## Code Review Rules
<!-- Codex reads this section when it reviews pull requests. -->
- Flag: secrets in code, missing tests for changed behavior, breaking API changes,
  unhandled errors on user input, SQL/shell/command injection, changes outside the issue's scope.
- Do not flag: formatting, naming style, comment wording.
