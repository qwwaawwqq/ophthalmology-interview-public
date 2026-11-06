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
- The PR body must contain `Closes #<issue number>`, say how it was tested, and include the line `Content changed: yes/no`.
- Merging has two tiers:
  - **Auto-merge (code):** PRs that change only code, tests, CI, scripts, styling or docs, with nothing under `content/` changed.
  - **Content, owner's decision of 2 Nov 2026:** PRs that add or rewrite teaching text, questions, answers or model answers under `content/` merge without the owner, but only through the coordinator (the `pr-coordinator` task, or a session the owner asks to coordinate). The agent that wrote a PR does not merge it. The gates are the eligibility checks below plus, on the exact head SHA: the newest Codex review has no open finding of any priority (P0, P1 or P2), and a medical-accuracy finding is fixed or answered with a source; JSON is valid, with no control characters, raw LaTeX or removed ids, and no answer key changed unless the PR lists it; a blind answer-key sample and a medical review have run, confirmed errors are fixed, and the PR records what was sampled and what was not; a new bank, or a bank whose options the PR changes, has the keyed option longest in at most 40% of its questions (a PR that leaves a bank's options unchanged may merge above 40%, with rebalancing tracked separately). The PR body still lists the changed items with the source page for each, so the owner can spot-check them after the fact.
  - **Owner merges:** PRs labelled `needs-human` or `do-not-merge`, and PRs that edit this file, CLAUDE.md or `.claude/`.
- For the auto-merge (code) tier, for this user's authorized updates in this repository, agents should automatically merge eligible PRs created by the agent team unless the user requests draft or PR-only delivery. The coordinator uses the same eligibility checks for content PRs. Eligibility requires verifying the exact current head SHA, non-draft and conflict-free state, authorized diff scope, successful required and task-relevant tests/CI for that SHA, and existing review/branch protections. Pin direct merges to that SHA; use GitHub auto-merge only if the platform enforces the same gates, and recheck after any head change. Never bypass failed, pending, action-required or missing relevant checks, or include unrelated changes. Human-created and external-contributor PRs remain human decisions. Agents never force-push or delete branches. Verify the merge result and, when applicable, deployment outcome.
- Do not edit AGENTS.md, CLAUDE.md or `.claude/` unless the issue asks for it.
- Change only what the issue asks. No drive-by refactors. No new dependencies unless the issue asks.
- Add or update tests for behavior you change. Tests must pass before opening a PR.
- Never commit secrets (`.env`, keys, certificates, tokens).

## Code Review Rules
<!-- Codex reads this section when it reviews pull requests. -->
- Flag: secrets in code, missing tests for changed behavior, breaking API changes,
  unhandled errors on user input, SQL/shell/command injection, changes outside the issue's scope.
- Do not flag: formatting, naming style, comment wording.
- If a test or check was deleted, skipped or loosened to make the change pass, that is P0.
- Do not suggest possible refactors or extra features.
- If the change is sound, say so in one line.
