# BCSC advanced study content

This module adds original Traditional Chinese explanations, not copies of the source books. The public manifest records the 2024–2025 edition, source file hash, chapter/page identity and source question keys. Raw PDF/text, private source chunks and unlicensed figures stay outside this repository.

## Structure and stable identity

`content/textbook-manifest.json` is a source denominator and lazy-load catalog. `content/textbook-depth/bcsc-sNN.json` contains one volume. A source identity is not a completion claim.

- Book `bcsc-s13`; true chapter `bcsc-s13-ch001`; unit `bcsc-s13-ch001-u01`.
- End question `bcsc-s13-rq001`; inline exercise `bcsc-s03-ch010-iq001`.
- Preserve the source's `sourceNumber` as a number or original string, including anomalous printed labels. `sourceQuestionKey` must match the manifest exactly.
- File hashes track provenance, not learner progress. Correcting wording does not change progress IDs. A genuine edition change needs an explicit migration.

Each unit links source pages and teaches mechanisms, clinical clues, competing explanations, investigations and their limitations, conditional management with reasons, image interpretation clues, pitfalls and recall. A domain that genuinely does not apply needs a specific `notApplicable` reason; headings or generic filler are not teaching.

Each original question restatement preserves its source concept and links chapters/units. It has four plausible choices, `correctIndex`, an explanation, and a rationale for every option. `whenTrue` must state a real setting where the option applies; an absolutely false sentence should be corrected, not falsely justified. Display choices are deterministically shuffled; saved choice indices always refer to the source option array.

Optional `clinicalUpdates` on a unit or question cite an actual HTTPS primary source and `checkedAt`. A book-level update must link `chapterIds` and/or `questionIds`; the renderer shows it in those chapters and before those questions. A source URL's existence does not substitute for medical review.

## Separate coverage axes

- `status`: `draft`, `source-checked`, or `independently-reviewed` on an individual unit/question. Schema validation alone never promotes this.
- `coverage.chapterRows[].coverageStatus`: `partial` by default; only an explicit independent chapter-scope review permits `independently-reviewed`. Existing checked units do not certify missing subtopics.
- `coverage.questionRows[].sourceAnswerStatus`: `unverified`, `matched`, or `missing`. Mapping an identity or matching the source answer alone does not certify the restated question.
- Image state: `not-reviewed`, `missing`, `unreadable`, `verified`, or `not-applicable`. A text-only question can be N/A; that does not verify the chapter's figures.
- Learner self-rating and answers are separate from all editorial evidence. Draft questions can be read for review, but cannot receive graded learner answers.

The validator derives summaries against all 209 chapter identities and 540 question concepts (488 end questions plus 52 inline exercises). Numbers describe the supplied source inventory, not a percentage of clinical knowledge. Missing teaching stays visible. Numeric claims are separately collected for independent source review; literal arithmetic checks are recomputed. Neither word count nor schema validity establishes medical depth.

## Build and review

The large `index.html` is generated from existing app sources and small textbook hooks. Textbook payloads are fetched one volume at a time; the initial HTML contains no full-book payload.

Run `python3 scripts/validate-textbook.py`, `python3 scripts/apply-enrichment.py`, `python3 scripts/apply-textbook.py`, then the existing test suites and `node scripts/test-textbook-depth.cjs`.

The feature workflow writes generated `index.html` only to `content/bcsc-depth-issue-8`, checks the actual git root, refuses `main`, and excludes generated index changes from its triggers. Draft checkpoints allow incomplete volumes and remain visibly draft. Before requesting final review, run `validate-textbook.py --require-complete` and dispatch the feature workflow with `require_complete=true`, verify medical review evidence against the exact content version, and inspect the UI. One issue, one branch, one PR; a human merges it. No workflow publishes directly to main.

The new progress namespace validates record shapes independently of loaded volumes. Existing v1/v2/v3 import/export, local storage and private sync must retain records for unopened volumes. The module never includes the user's own PDFs or raw private source text in progress exports.
