# Anydoc ingestion implementation plan

Date: 2026-08-08

Status: executable

Binding design: `docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md`

## Outcome

Adopt Anydoc only for formats where measured structure, provenance, safety, and
reliability beat the available alternative. Keep the specialized PDF, CSV, and
spreadsheet parsers where they remain stronger. Finish with deterministic,
structure-aware chunks and mechanically verifiable citations.

This plan is ordered. A phase may begin only after the prior phase's acceptance
criteria are recorded as passing. Work one red-green-refactor behavior at a
time; do not batch an entire phase into one test or commit.

## Durable decisions

- `@use-crux/core` owns provider-neutral document, coordinate, evidence, and
  citation types. It never imports parser packages.
- `@use-crux/ingest` owns parser dependencies, isolation, format adapters, and
  conversion into Core contracts. Anydoc-native values do not cross this edge.
- One parser owns a production document. Never merge parser output through
  fuzzy matching, model judgment, or ordinal proximity.
- PDF remains direct `pdf-inspector` with a warned `pdfjs-dist` downgrade. CSV
  remains `csv-parse`. XLSX/XLSM remain ExcelJS. Anydoc is evaluated for the
  format groups named in the binding design.
- DOCX gets one deterministic winner. The losing parser may be a whole-document
  fallback only for fixture-proven closed triggers.
- Coordinates state only facts established by the owning parser. Document-level
  provenance is acceptable; invented page, character, cell, or slide locations
  are not.
- Production Anydoc is fail-closed unless the host verifies both hard memory
  containment and filesystem/network sandboxing before loading it.
- Crux is pre-stable: replace weak public shapes when that improves correctness;
  do not retain compatibility branches for persisted schema 1 data.
- Existing main already includes layout-aware PDF and detailed XLSX provenance.
  Phase 1 must audit these contracts against schema 2 and preserve them rather
  than recreate them.

## Operating protocol

### Before each task

1. Read the binding design sections referenced by the task.
2. Inspect the current implementation and pending changesets; do not assume a
   path or type described here still has exactly the same shape.
3. Add the smallest failing test for one observable behavior and run it alone.
4. Implement only enough to make that test pass, then refactor while green.
5. Run the task's scoped verification before starting the next task.

### Memory-safe commands

This host OOMs easily. All tests and builds are sequential.

```sh
# One test file or named behavior while iterating
pnpm --filter @use-crux/ingest exec vitest run <test-file> --maxWorkers=1 --minWorkers=1
pnpm --filter @use-crux/core exec vitest run <test-file> --maxWorkers=1 --minWorkers=1

# Package gates; run one command at a time, never concurrently
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/ingest typecheck
pnpm --filter @use-crux/core test -- --maxWorkers=1 --minWorkers=1
pnpm --filter @use-crux/ingest test -- --maxWorkers=1 --minWorkers=1
```

- Never run root Turbo tests/builds in parallel with native evals.
- Never raise Vitest above one worker. The eval harness itself permits one parser
  child at a time.
- Use fixture subsets during development. Run three-cold/five-warm admission
  loops sequentially only at the Phase 2 decision checkpoint.
- Do not run `make build` until Phase 5. When required, run it alone after the
  package test processes have exited.
- A native run that lacks verified containment is an infrastructure failure or
  an explicitly labeled local eval, never evidence of production safety.

### Commits, changesets, and reviews

- Keep commits small and conventional, normally one completed behavior or
  tightly cohesive task. Stage explicit pathspecs; never use `git add -A`.
- Assign one implementation agent as changeset owner at the start of Phase 1.
  That owner reads every non-README `.changeset/*.md` before editing. Update the
  existing ingestion/XLSX/PDF changeset if it already covers the release theme;
  create exactly one new entry only if none does.
- No changeset is needed for eval-only work. The final public runtime/type change
  requires the directly affected package entries and the appropriate breaking
  pre-stable bump described by repository policy.
- At the end of every phase, use an independent subagent to review the diff
  against that phase's acceptance criteria. Resolve P0/P1 findings and rerun
  scoped tests before continuing.
- After Phase 3, require an additional security review of containment, IPC,
  filesystem/network policy, cleanup, and hostile inputs.
- After Phase 5, require a final independent code review over the complete diff
  before opening a PR.

## Phase 1 — normalized model and truthful provenance

Read: “Provider-neutral document model”, “Structure-aware chunking”, “Citation
integrity”, and “Public package impact”.

Dependencies: none. This phase establishes the contracts every later phase
consumes.

### Tasks

1. **Audit the incumbent contract.** Map existing Core `CruxDocument`, ingest
   parts, source locations, chunk provenance, citations, PDF blocks, and XLSX
   ranges/cells to schema 2. Record which merged-main facts already satisfy the
   design and which public weak shapes must be replaced. Add no production code
   in this task.
2. **Define schema 2 in Core.** Red-test every document block, nested fact,
   parser identity, diagnostic, and closed coordinate variant, including
   compile-time exhaustive switches and invalid-shape runtime tests. Add the
   provider-neutral types and validators without parser imports.
3. **Migrate incumbent adapters one at a time.** For CSV, DOCX, XLSX, then PDF,
   snapshot required existing facts in a failing adapter test, convert that
   adapter to schema 2, and make its test green before touching the next parser.
4. **Preserve exact spreadsheet provenance end to end.** Red-test cell address,
   displayed value, formula, merge, occupied A1 range, and sheet identity through
   normalization, structured chunking, stored records, and retrieval. Close only
   losses found by that test.
5. **Introduce stored evidence.** Red-test closed public source coordinates,
   immutable normalized-content hashes, parser/adapter versions, block IDs,
   normalization/chunker versions, and exhaustive serialization round trips.
   Replace loose provenance shapes at their public boundary and delete obsolete
   schema-1 compatibility branches.

### Task verification

Run the changed test file with one worker after each red and green cycle. After
each package task, run that package's typecheck. At phase end, run Core tests,
then Ingest tests, sequentially with one worker.

### Acceptance criteria

- All incumbent parser fixtures retain or strengthen their facts.
- XLSX evidence resolves to exact sheet ranges and cells without losing formula,
  display, or merge data.
- Every exposed coordinate belongs to a closed union and its parser producer.
- Core has no dependency or import edge to Ingest or parser packages.
- Schema-1 persisted content is rejected/re-ingested, not upgraded by guessing.
- Independent phase review has no unresolved P0/P1 findings.

Non-goals: Anydoc dependency, new formats, native worker, semantic scoring.

## Phase 2 — bounded conformance harness and DOCX decision

Read: “Parser ownership”, “Bounded evaluation”, and the resource ceilings in
“Worker isolation and memory safety”.

Dependencies: Phase 1 schema, validators, and normalized hashing.

### Tasks

1. **Define redistribution-safe fixtures and manifests.** Start with failing
   manifest-validation tests. Add generated or licensed fixtures and checked-in
   SHA-256 values for every case required by the design. Keep binaries small;
   prefer deterministic generators where practical.
2. **Build structural assertions.** Add one red assertion family at a time for
   prose, presentations, spreadsheet-grade facts, CSV controls, and PDF controls.
   Assertions compare typed facts, not Markdown appearance or model opinions.
3. **Build the sequential runner.** Red-test one child at a time, bounded input
   and IPC, typed resource errors, process-group cleanup, result hashing, and
   three-cold/five-warm determinism accounting. The eval path must clearly label
   unsupported-host runs as non-production.
4. **Add exact-pinned Anydoc for evaluation only.** Record package and native
   artifact identity. Convert its output through a private eval adapter and make
   invalid/partial output fail closed.
5. **Run the admission suite sequentially.** Capture required-fact results,
   hostile-input outcomes, package smoke results, p95 wall/RSS, normalized
   hashes, and missing coordinate fidelity for each candidate format.
6. **Decide DOCX and write the ADR.** Apply the binding deterministic tie-breaker.
   Declare one primary and only individually proven fallback triggers. If neither
   parser passes, stop and report the blocker instead of choosing one.

### Acceptance criteria

- All manifest hashes and structural assertions are reproducible offline.
- No fixture crash, hang, partial success, or resource breach is misreported as
  parser success.
- Admission evidence includes identical three-cold/five-warm normalized hashes
  and remains below 50% rollout budgets.
- PDF/CSV/XLSX controls demonstrate that incumbents keep their declared role.
- The ADR names the DOCX winner and exact fallback triggers from fixed evidence.
- Independent phase review has no unresolved P0/P1 findings.

Non-goals: production routing, dynamic parser selection, model-based merging,
provider-backed evals.

## Phase 3 — contained production worker and admitted formats

Read: “Decision”, “Parser ownership”, “Worker isolation and memory safety”, and
the Phase 2 ADR/evidence.

Dependencies: admitted-format evidence and DOCX decision from Phase 2.

### Tasks

1. **Specify the worker protocol with red tests.** Cover length-prefixed/bounded
   messages, typed success/failure, invalid frames, early exit, timeout, crash,
   abort, descendant cleanup, temp cleanup, capped logs, and result-size limits.
2. **Implement host-owned containment capability checks.** Red-test fail-closed
   behavior before Anydoc loads when cgroup v2 limits or the sandbox capability
   cannot be verified. Treat `RLIMIT_*`, timeout, and RSS sampling only as
   defense-in-depth/observability.
3. **Implement the isolated Anydoc worker.** Stream input without base64 copies,
   parse sequentially, account for expansion/assets/output, scrub environment,
   avoid shells, and reap the entire process tree on every terminal path.
4. **Promote only admitted adapters.** Add each Phase 2 winner behind its exact
   format contract, one format family per red-green slice. Preserve truthful
   document/package/slide provenance; reject unsupported structure rather than
   flattening it under a stronger label.
5. **Implement declared fallback behavior.** Red-test each proven DOCX trigger,
   PDF downgrade warning, forbidden retry trigger, and provenance ownership.
   There is no generic “try the other parser” path.
6. **Run packaging and hostile-input tests under production-equivalent Linux
   supervision.** Record exact package/native hashes and measured ceilings.

### Acceptance criteria

- Production Anydoc cannot load without verified hard memory and sandbox
  capabilities.
- Breaches map to the closed typed error set; descendants and temp files are
  cleaned after success, failure, abort, and kill.
- Only Phase 2-admitted formats are enabled, with fidelity described exactly.
- Presentations ship only with slide boundaries/order/notes; spreadsheet-grade
  support ships only with exact coordinate facts.
- Resource evidence is comfortably below ceilings and no run exceeds 50% of its
  rollout budget.
- Independent functional and security reviews have no unresolved P0/P1 findings.

Non-goals: macOS/Windows production Anydoc without equivalent hard containment,
format detection, multiple concurrent parses, content merging.

## Phase 4 — structure-aware chunking and citation verification

Read: “Structure-aware chunking” and “Citation integrity”.

Dependencies: schema 2, admitted adapters, stable normalized blocks and evidence.

### Tasks

1. **Chunk prose deterministically.** Red-test heading paths, semantic boundary
   preference, oversized-block spans, intact links/list items/notes/code lines,
   stable identities, and configured hard limits.
2. **Chunk tables, CSV, and sheets.** Red-test row windows, unsplit cells/rows,
   repeated headers marked as context, logical CSV ranges, and exact spreadsheet
   A1/cell provenance.
3. **Chunk slides and PDF pages.** Red-test slide/notes ownership, oversized slide
   block splits, physical page/block identity, normalized page spans, and PDF
   fallback downgrade propagation.
4. **Implement mechanical citation verification.** Add one tampering red test at
   a time for unprovided chunks, missing evidence, stale document/parser identity,
   changed content/hash, invalid UTF-16 half-open spans, quote mismatch, and
   detached coordinates. Make verification a retained-evidence lookup, never a
   per-citation reparse.
5. **Add the offline semantic quality eval.** Use a small human-labeled set for
   entailment, completeness, citation quality, and contradiction. Calibrate any
   model/NLI scorer against labels; scores may reject regressions but never mint
   or repair identity/provenance.

### Acceptance criteria

- Repeated runs produce identical chunk content, IDs, coordinates, and hashes.
- Every chunk resolves through typed coordinates to its owning document/parser.
- All mechanical tampering cases are deterministically rejected with the closed
  failure code expected by the test.
- Quality fixtures detect supported-but-uncited, unsupported, indirect, and
  contradicted claims without weakening mechanical gates.
- Independent phase review has no unresolved P0/P1 findings.

Non-goals: live reparsing per citation, model authority over source identity,
automatic claim rewriting.

## Phase 5 — release and rollout

Read: “Public package impact”, all phase evidence/ADRs, and repository changeset
instructions.

Dependencies: all prior phases green and reviewed.

### Tasks

1. **Run final scoped verification sequentially.** Core typecheck/test, then
   Ingest typecheck/test, then any affected package checks. Resolve failures
   before continuing.
2. **Run production-equivalent native/package smoke tests.** Verify fresh
   consumer installation, native loading, artifact hashes, hard containment,
   sandbox capability, and admitted format fixtures on every supported target.
3. **Run the repository build alone.** Use `make build`; do not run tests or
   native evals concurrently. Investigate OOM/resource failures rather than
   increasing parallelism.
4. **Document the actual measured product.** List supported formats, primary and
   fallback parsers, fidelity/coordinate levels, warnings, limits, unsupported
   hosts, and what citation verification does and does not prove.
5. **Finalize the single owned changeset.** Re-read pending changesets and update
   the relevant existing release-theme file where possible. Describe public
   schema/provenance changes and new runtime behavior without duplicating PDF or
   XLSX entries already queued.
6. **Final independent review and PR readiness.** Review complete diff, public
   API ergonomics, safety, dependency direction, package contents, docs accuracy,
   and test evidence. Resolve P0/P1 findings and rerun affected gates.

### Acceptance criteria

- Every affected package typecheck and one-worker test suite passes.
- `make build` passes without concurrent memory-intensive work.
- Fresh-consumer/native smoke tests pass on each declared production target.
- Documentation matches admitted evidence and never overstates coordinates,
  sandbox support, semantic entailment, or spreadsheet fidelity.
- Exactly one appropriate changeset owner/file accounts for the public changes.
- Final review is clear and the branch is ready for commit/push/PR handoff.

Non-goals: publishing, enabling unqualified formats, loosening limits to make a
fixture pass, or claiming semantic citation correctness from hash checks alone.

## Stop conditions

Stop and return to the user instead of improvising when:

- the binding design and current public contract require irreconcilable source
  coordinate meanings;
- no DOCX candidate passes the required facts and safety gates;
- a format needs fuzzy/model merging to meet its required facts;
- production-equivalent hard containment or sandbox verification is unavailable;
- package/native artifacts cannot be pinned or reproduced;
- measured typical usage approaches the hard memory ceiling;
- a new platform needs a containment mechanism not approved in the design; or
- implementation would require changing the one-parser ownership rule.
