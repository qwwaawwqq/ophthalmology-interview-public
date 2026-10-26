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

- Individual unit/question `status` uses `draft` or `source-checked` in this release. Chapter coverage separately uses `independently-reviewed`. The validator retains compatibility with legacy item `independently-reviewed` values; schema validation alone never promotes any item.
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

Final acceptance also requires reviewed units and ready source-matched concepts, explicit independent chapter-scope approval, and appropriate original-question image evidence. Checked item text is tied to an exact normalized content hash in sanitized per-book review metadata; changing teaching while retaining its old approval fails validation. Original chapter figures remain a separate axis and need not be falsely marked verified for text-only questions.

Local original-PDF reference opening: each volume may temporarily hold a user-selected PDF in memory. The browser verifies a PDF header and rejects a conflicting MIME type, then creates only an application/pdf Blob URL. Source-page links are bounded to the book PDF page count and open with noopener/noreferrer. Replacement, pagehide and unload revoke URLs; pending selections are invalidated on unload. No file, filename or Blob URL enters progress exports, local persistence, cloud sync or network requests. Edition/page-order matching remains the learner’s responsibility. Opening a PDF never promotes source-image verification. Image clues with a `pdfPage`, and questions whose linked units have such clues (or that set `requiresImage`, using their source pages), can show that page of the same local Blob URL in an in-app panel beside the question or clue, with a new-tab fallback where the browser has no inline PDF viewer; without a selected PDF the panel offers only a local file picker. Nothing from the PDF is copied into the repository.

Before promotion, every source question must also have independent approval of its actual target against a substantive field in a linked learning unit. The private support matrix pins the final author version, question and unit hashes, exact field pointer, supporting excerpt and excerpt hash. A heading, shared chapter or existing unit ID is not proof of teaching. Optical formulas may support a worked answer by derivation, and diagnostic features may support a clinical inference; commonness, ranking, doses and decision thresholds must be explicitly taught. If the original link is wrong, link the existing appropriate unit rather than inserting unrelated disease facts. Freeze the release only when all 13 matrices and their final author hashes agree with the independent reports. The private matrices and raw source excerpts are excluded from the public payload.


## Additional original practice and spaced review

`content/textbook-depth/additional-practice.json` is a separate original-practice pack. It never receives official BCSC source-coverage credit. Promotion requires the independent review's exact approved IDs and question content hashes; only status/readiness and sanitized review metadata may change. Extra questions may explicitly reference another known book with `sourceRefs[].bookId`; omitted book IDs mean the question's primary book. Unit routes use their actual book prefix. The official 13-book source schema is unchanged.

The three practice pools retain separate stable IDs: shared-note questions, official-source concept restatements, and additional original cases. Spaced-review records use `study:srs:<pool>:<id>` inside the existing local/private-cloud progress payload. Unknown future pools and IDs survive import/export; old correct answers and mastery marks do not create a review plan.

A valid wrong submission schedules Again after 10 minutes. A valid correct answer waits for one manual rating: Hard is 1 day, Good advances through 1/3/7/14/30 days, and Easy advances two levels with a 3-day minimum. Days are fixed 24-hour intervals; dates and today's cutoff use Asia/Taipei. Correct answers left unrated preserve their previous plan. Each live attempt can consume only one rating; navigating away, retrying, importing a different attempt, or reloading invalidates the live rating token. Revealing an explanation alone never creates mastery. The full question pools remain available for early manual practice.

Run `node scripts/test-study-srs.cjs` for real answer-handler, duplicate-event, progress round-trip, due-list, and cross-book-link checks. Scheduler arithmetic/date cases also have an independent review outside the public repository. Private review artifacts, proofs, source extractions, PDFs, and backups are excluded from publication.
