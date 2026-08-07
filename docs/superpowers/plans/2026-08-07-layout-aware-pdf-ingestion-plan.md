# Layout-Aware PDF Ingestion Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-07-layout-aware-pdf-ingestion-design.md`

**Scope guard:** keep `@use-crux/core` provider-neutral. It defines only page
block data and consumes it for chunking; `@use-crux/ingest` owns Markdown
parsing plus the `pdfjs-dist` and `@firecrawl/pdf-inspector` boundaries. Do
not add a parser/backend selector, a Core dependency on ingest/native code, or
a public test seam. Mock only the external `pdf-inspector`/`pdfjs-dist`
boundaries when a boundary failure must be forced.

Each task is a sequential vertical slice. Within a task, add one failing
caller-visible behavior test, implement only enough to make that test green,
then proceed to the next listed behavior. Run commands one at a time; every
Vitest command below is single-worker and no verification commands overlap.
Before the next task starts, request spec-compliance review, then code-quality
review, of the task commit.

## Task 1 — Core page-block and provenance contract

**Public behavior:** Core accepts provider-neutral blocks below a page and
preserves their identifiers in chunk provenance without introducing PDF
knowledge.

**Likely files:**

- `packages/core/src/indexing/types.ts`
- `packages/core/src/indexing/provenance.ts`
- `packages/core/src/indexing/index.ts` (only if the existing type export needs
  adjustment)
- `packages/core/__tests__/indexing/page-block-contract.test.ts` (new)

1. RED: add a focused Core public chunking/provenance test with an authored
   `CruxDocument` page that has text and table blocks. Assert the readonly
   provider-neutral block shape, page/location facts, and first-contribution
   order/deduplication of `blockIds` when provenance is merged.
2. GREEN: add `CruxIngestPageBlock`, text/table block variants, and optional
   `blocks` only to Core's `kind: 'page'` part; add `blockIds?: string[]` to
   `ChunkProvenance`; update coarse/merged provenance to retain block IDs in
   order. Keep Core input fields readonly wherever existing indexing input
   types require it, and do not mention Markdown, PDF, or parser dependencies.
3. Add the next RED assertion only after green: normal top-level parts and
   pages without `blocks` keep their existing valid behavior. Make the minimal
   compatibility change if needed.
4. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-contract.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

5. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): add page block provenance contract`.

## Task 2 — Native PDF pages and block materialization

**Public behavior:** `fileSource()` emits reliable native layout Markdown as
physical page parts, with deterministic ordered blocks and only provable
page-relative source ranges.

**Likely files:**

- `packages/ingest/src/types.ts`
- `packages/ingest/src/pdf.ts`
- `packages/ingest/src/index.ts` (if the new public ingest block types require
  an explicit export)
- `packages/ingest/__tests__/sources.test.ts`
- `packages/ingest/package.json`
- `pnpm-lock.yaml`

1. RED: in the existing public-source test suite, make `fileSource()` load a
   small PDF while the native external boundary returns multi-page Markdown.
   Assert authoritative one-based physical pages/source locations, native
   Markdown as `content`, stable `<pageId>/block:<ordinal>` IDs, headings,
   paragraph/list/code blocks, GFM table `columns`/body `rows`, decoded compact
   heading paths, and exact `sourceRange` slices. Include a normalized or
   combined block case that deliberately omits `sourceRange` rather than
   guessing it.
2. GREEN: mirror the same provider-neutral optional block shape in ingest
   types (structurally compatible with Core); dynamically import
   `@firecrawl/pdf-inspector`, convert bytes to `Buffer` only at that call, and
   call `extractPagesMarkdown(buffer)` without page selection. Keep
   `pdfjs-dist` as the initial opener/page-count/metadata owner and destroy its
   loading task in one outer `finally`.
3. Add the internal Markdown-to-block parser in `pdf.ts` or a focused new
   internal sibling. Use the already-installed mdast/GFM utilities; preserve
   source order, classify top-level blocks, retain raw heading slices, derive
   visible normalized heading paths, and omit empty blocks/ranges that cannot
   prove `page.content.slice(start, end) === block.content`. Do not expose an
   AST or parser hook.
4. RED then GREEN for title metadata best-effort behavior: native pages still
   load if `getMetadata()` fails, and an available `Title` survives.
5. Add `@firecrawl/pdf-inspector` as a direct ingest dependency and regenerate
   only the package lock through the normal pnpm workflow (not a manual lock
   edit). Confirm its optional platform packages remain optional/transitive;
   do not add it to Core, Local, or Indexer.
6. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/ingest test -- __tests__/sources.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/ingest typecheck
   ```

7. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(ingest): extract layout-aware PDF page blocks`.

## Task 3 — Structured narrative page-block chunking

**Public behavior:** `chunker.structured()` uses page blocks to keep narrative
sections and physical pages separate, repeats normalized heading context, and
reports exact provenance only when it can prove it.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/src/indexing/provenance.ts`
- `packages/core/src/indexing/pipeline.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts` (new)
- `packages/core/__tests__/indexing/chunk-source-spans.test.ts`

1. RED: use authored Core page blocks to prove two sections remain separate,
   fitting paragraph/list/code/`other` blocks remain whole, and a body split
   repeats exactly one compact ATX heading prefix. Cover nested/skipped levels,
   consecutive headings, content before a heading, an empty-visible heading as
   retained `other`, heading-only sections, separator-aware body budgets, and
   over-limit prefixes/heading-only output remaining whole.
2. GREEN: add a block-aware structured-page path ahead of the existing flat
   page splitter. Treat headings as boundaries rather than duplicated body;
   pack narrative only inside one page/heading path; use the existing
   paragraph/sentence/hard-limit splitter only for oversized narrative blocks.
   Pages without blocks retain today's flat behavior.
3. RED then GREEN for provenance: output keeps page part ID, page location, and
   deduplicated heading/body block IDs; permit exact spans only for one
   unchanged contiguous block/split slice with a proven relative range and a
   uniquely occurring complete page. Assert repeated block text in one unique
   page remains exact by range, while repeated complete page content is derived
   with no guessed global span.
4. Bump only the `structured` chunker version/fingerprint in `pipeline.ts`.
   Preserve `text` and `semantic` implementations/fingerprints for now.
5. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts __tests__/indexing/chunk-source-spans.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

6. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): chunk page block narratives structurally`.

## Task 4 — Table windows, strategy isolation, and parent-child boundaries

**Public behavior:** structured and parent-child chunkers respect page-block
tables and section boundaries; text and semantic strategies do not silently
adopt them.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/src/indexing/pipeline.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts`
- `packages/core/__tests__/indexing/indexer-identity.test.ts` (if the existing
  fingerprint assertions are the closest public coverage)

1. RED: assert a page table becomes canonical Markdown row windows with active
   heading prefix, page/heading/table block IDs, and derived spans. Cover GFM
   header/body convention, missing headers, header-only tables, ragged cells,
   escaped/newline cells, `tableRowsPerChunk`, max-character shrinking, and one
   oversized indivisible row/header payload.
2. GREEN: implement a block-table renderer/window planner that recalculates
   width/padding for every candidate, repeats a real header only, and never
   splits rows. Do not turn nested page tables into top-level table parts.
3. RED then GREEN: `chunker.text()` remains the current flat splitter and
   `chunker.semantic()` keeps caller/model/embedding boundaries; the structured
   first stage used by `parentChild()` carries page ID, heading path, block IDs,
   and unit kind. Parents/children cannot cross page or heading boundaries;
   table windows neither join narrative nor split into children, even above
   parent/child limits.
4. Bump only `parent-child` alongside the already-bumped structured version;
   assert both fingerprints change while text and semantic versions do not.
5. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts __tests__/indexing/indexer-identity.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

6. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): preserve page table chunk boundaries`.

## Task 5 — PDF downgrades, release contract, docs, and consumer evidence

**Public behavior:** OCR-needed pages alone use `media.describe`; any native
backend downgrade falls back document-wide with exactly one bounded warning,
while installed consumers resolve the native package.

**Likely files:**

- `packages/ingest/src/pdf.ts`
- `packages/ingest/__tests__/sources.test.ts`
- `packages/ingest/package.json` and `pnpm-lock.yaml` only if Task 2 review
  identified necessary packaging corrections
- `apps/docs/content/docs/guides/retrieval/ingestion.mdx`
- `apps/docs/content/docs/guides/retrieval/chunkers.mdx`
- `apps/docs/content/docs/reference/ingest/index.mdx`
- `.changeset/xlsx-source-coordinates.md`

1. RED: a mixed native result routes only `needsOcr: true` pages through the
   observable application-owned `media.describe` call, discards their native
   Markdown, emits no blocks for model text, retains blank/warned pages for an
   unavailable/empty/throwing description, and leaves reliable pages model-free.
   GREEN with one shared media-description helper.
2. RED then GREEN for each document-wide downgrade boundary, forced only at
   `pdf-inspector`/`pdfjs-dist`: dynamic-load unavailability,
   `extractPagesMarkdown` throw, and each malformed result invariant (count,
   index/order, markdown, `needsOcr`). Validate `unknown` with small readonly
   internal types and the closed reason union; use `pdfjs-dist` extraction for
   every page, no blocks, and exactly one `parser_warning` with only the
   specified parser names/reason. Preserve fallback failure as the existing
   `parse_failed` cause and do not create a warning/document in that case.
3. RED then GREEN for URL and Asset source parity, retained physical pages,
   best-effort title, and loading-task destruction on all success/failure
   paths. Ensure warning messages never include bytes, native diagnostic text,
   paths beyond source ID, or stacks.
4. Update the ingest guide/reference and chunker guide: native layout-aware
   Markdown and page blocks, OCR routing, downgrade warning, structured versus
   text/semantic behavior, heading repetition, table windows, provenance, Node
   22/native-only support, and bundler externalization of the N-API package.
5. Update the existing pending `.changeset/xlsx-source-coordinates.md` with
   the published `@use-crux/ingest` runtime/install behavior. Do **not** create
   a new changeset.
6. Verify sequentially, after every preceding command has exited:

   ```sh
   pnpm --filter @use-crux/ingest test -- __tests__/sources.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/ingest typecheck
   pnpm --filter @use-crux/core test -- --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   pnpm --filter @use-crux/ingest test -- --maxWorkers=1 --no-file-parallelism
   ```

7. Run the focused real-package native proof from `packages/ingest` (not a
   mocked test), invoking the installed `@firecrawl/pdf-inspector` entry and
   `extractPagesMarkdown` against a tiny PDF fixture on the current Node 22
   platform. This proves the selected optional platform binary loads; keep
   forced fallback tests independent of platform support.
8. Run a packed-consumer smoke sequentially in a safely created temporary
   directory. Use `mktemp -d` under `${TMPDIR:-/tmp}` and a shell `trap` that
   removes only the recorded temp directory; pack Core and Ingest into its
   `packs/` directory with the package manager, create a Node-22 consumer
   project under its `install/` directory, and install the tarballs with pnpm
   offline/no-workspace resolution. Run a Node ESM script from that consumer
   that imports `@use-crux/ingest`, loads a tiny PDF through `fileSource()`, and
   confirms both the wrapper and selected optional native platform package
   resolve. Do not use a repository path, workspace link, or Edge/browser
   bundle for this smoke.
9. Run `git diff --check`. Perform a whole-implementation spec review followed
   by a whole-implementation code-quality review. Commit this task alone, e.g.
   `feat(ingest): complete layout-aware PDF fallback`.

## Final sequential checklist

1. Confirm the Core API remains provider-neutral and dependency direction is
   `@use-crux/ingest -> @use-crux/core` only.
2. Confirm `pdfjs-dist` owns open/page count/metadata/fallback and one outer
   cleanup; native extraction is dynamic and all-or-nothing after validation.
3. Confirm every relevant test command above includes
   `--maxWorkers=1 --no-file-parallelism`, and no tests, typechecks, lockfile
   update, packaging, or smoke commands run concurrently.
4. Confirm only structured and parent-child fingerprints changed; text and
   semantic behavior/fingerprints did not.
5. Confirm the existing XLSX changeset was updated, no duplicate added, and
   documentation tells consumers about native platform/bundler constraints.
6. Confirm the packed Node-22 consumer proof uses only tarballs installed in a
   temporary directory, then cleanly removes that directory.
7. Re-run `git diff --check`, inspect the final diff, and complete the final
   spec-compliance review followed by code-quality review before merge.

## Repository discoveries affecting execution

- Current `packages/ingest/src/pdf.ts` has one `pdfjs-dist` extraction path;
  its current textless-page behavior already uses `media.describe` and located
  `partial_extraction` warnings. Preserve those semantics for fallback/model
  pages rather than adding another warning channel.
- Core currently has no page-block representation and `chunker.text()` calls
  the same `chunkDocumentStructured()` implementation as `structured`; strategy
  isolation requires a deliberate split, not only a new conditional.
- `structured` and `parent-child` are both version `2` in
  `packages/core/src/indexing/pipeline.ts`; `text` and semantic are also `2`.
  Only the former two should be bumped.
- Ingest already owns `mdast-util-from-markdown`, `mdast-util-gfm`, and
  `mdast-util-to-string`, so no general Markdown dependency belongs in Core.
- The lock currently contains `pdfjs-dist` but no installed
  `@firecrawl/pdf-inspector`; Task 2 must make the dependency/lock resolution
  reproducible before the real native and packed-consumer checks.
- `.changeset/xlsx-source-coordinates.md` is the relevant pending ingest
  changeset and already includes PDF behavior; extend it rather than adding a
  file.
