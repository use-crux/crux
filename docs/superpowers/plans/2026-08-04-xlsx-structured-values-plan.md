# XLSX Structured Values and Merged Cells Implementation Plan

**Goal:** Make XLSX ingestion emit citation-safe display values for every
ExcelJS cell-value shape and preserve merged-cell ownership explicitly.

**Design:**
`docs/superpowers/specs/2026-08-04-xlsx-structured-values-and-merges-design.md`

## Task 1: Implement the complete XLSX contract

1. Add failing focused tests in `packages/ingest/__tests__/sources.test.ts` for:
   - rich-text values across `rows`, `sourceRows`, `columns`, table content,
     and sheet content;
   - hyperlink display text, literal errors, cached formula errors, cached
     `0`/`false`, and an actual shared formula retaining its translated formula;
   - horizontal and vertical merged rich-text cells with master-only value and
     formula ownership plus exact merge descriptors;
   - an unknown structured value through a narrow internal test seam, proving
     it warns with location and never emits `[object Object]`;
   - preservation of the existing number-format, date, sparse-row, and source
     coordinate behavior.
2. In `packages/ingest/src/parsers.ts`, replace object stringification with one
   exhaustive XLSX display-value projector. Keep number-format rendering for
   numeric/date display values, recursively render cached formula results, and
   emit a safe located warning plus an empty string for malformed/unknown
   objects.
3. Read merge ranges from the public worksheet model and normalize them into
   `IngestSpreadsheetRange`. Attach the same merge descriptor to every member
   cell. Only the master emits its value/formula; followers stay empty while
   retaining their physical coordinates.
4. Add and export `IngestSpreadsheetMerge` from `packages/ingest/src/types.ts`
   and `packages/ingest/src/index.ts`.
5. Update the XLSX contract in
   `apps/docs/content/docs/reference/ingest/index.mdx` and concise XLSX wording
   in the relevant file/retrieval reference pages when necessary.
6. Update `.changeset/xlsx-source-coordinates.md`; do not add a new changeset.
7. Run the focused tests, the complete `@use-crux/ingest` test suite and
   typecheck, plus `git diff --check`. Self-review the resulting diff and commit
   it on the worktree branch.

Do not recalculate formulas, retain rich-text styling, expose ExcelJS types in
the public API, or change unrelated ingest behavior.
