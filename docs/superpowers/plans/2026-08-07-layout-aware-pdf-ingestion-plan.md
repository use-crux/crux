# Layout-Aware PDF Ingestion Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-07-layout-aware-pdf-ingestion-design.md`

**Scope guard:** keep `@use-crux/core` provider-neutral. It defines only page
block data and consumes it for chunking; `@use-crux/ingest` owns Markdown
parsing plus the `pdfjs-dist` and `@firecrawl/pdf-inspector` boundaries. Do
not add a parser/backend selector, a Core dependency on ingest/native code, or
a public test seam. Mock an external boundary only to force an unavailable,
throwing, or malformed failure. A normal successful native result must cross
the real installed `@firecrawl/pdf-inspector` boundary with a committed PDF
fixture.

The seven tasks below are sequential, independently committed TDD slices.
Within each task, add one failing caller-visible behavior test, implement only
enough to make it green, and then proceed to the next listed RED/GREEN behavior.
Run every test, typecheck, build, release-stage, install, lockfile, and package
command sequentially and non-overlapping. Every Vitest command must use
`--maxWorkers=1 --no-file-parallelism`. Before the next task starts, request
spec-compliance review of the task commit and then code-quality review of the
same commit. Do not combine or reorder those review gates.

## Task 1 — Core block/provenance contract

**Public behavior:** Core accepts provider-neutral blocks beneath a page and
preserves their identifiers in chunk provenance without introducing PDF or
Markdown knowledge.

**Likely files:**

- `packages/core/src/indexing/types.ts`
- `packages/core/src/indexing/provenance.ts`
- `packages/core/src/indexing/index.ts` (only if the existing type export needs
  adjustment)
- `packages/core/__tests__/indexing/page-block-contract.test.ts` (new)

1. RED: add a focused Core public chunking/provenance test with an authored
   `CruxDocument` page containing text and table blocks. Assert the readonly
   provider-neutral block shape, page/location facts, and first-contribution
   order/deduplication of `blockIds` when provenance is merged.
2. GREEN: add `CruxIngestPageBlock`, text/table block variants, and optional
   `blocks` only to Core's `kind: 'page'` part; add `blockIds?: string[]` to
   `ChunkProvenance`; update coarse and merged provenance to retain block IDs
   in order. Keep Core input fields readonly wherever existing indexing input
   types require it. Do not mention Markdown, PDF, or parser dependencies.
3. RED then GREEN: prove ordinary top-level parts and pages without `blocks`
   retain their existing valid behavior and make only the minimal compatibility
   change required.
4. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-contract.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

5. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): add page block provenance contract`.

## Task 2 — Complete native PDF extraction safety

**Public behavior:** `fileSource()` uses the real installed native extractor
for successful layout-aware pages, routes only pages marked `needsOcr` through
the application model boundary, and safely falls back document-wide for every
unavailable, throwing, or invalid native result before this task is committed.

**Likely files:**

- `packages/ingest/src/types.ts`
- `packages/ingest/src/pdf.ts`
- `packages/ingest/src/index.ts` (only if public ingest block types need an
  explicit export)
- `packages/ingest/__tests__/sources.test.ts`
- a committed small mixed-`needsOcr` PDF fixture under the existing ingest
  fixture convention
- `packages/ingest/package.json`
- `pnpm-lock.yaml`

1. RED: add `@firecrawl/pdf-inspector` as a direct ingest dependency through
   the normal pnpm workflow and commit a small PDF fixture whose real installed
   `extractPagesMarkdown(buffer)` result contains both reliable and
   `needsOcr: true` pages. The public `fileSource()` test must cross that real
   successful native boundary; do not mock or synthesize a normal successful
   result. Assert authoritative one-based physical page numbers and source
   locations, native Markdown for reliable pages, stable
   `<pageId>/block:<ordinal>` IDs, headings, paragraph/list/code blocks, GFM
   table `columns` and body `rows`, decoded compact heading paths, and exact
   `sourceRange` slices. Include a normalized or combined block that omits its
   range rather than guessing it.
2. GREEN: mirror the provider-neutral optional block shape in ingest types,
   structurally compatible with Core. Dynamically import
   `@firecrawl/pdf-inspector`, convert bytes to `Buffer` only at that boundary,
   and call `extractPagesMarkdown(buffer)` without page selection. Keep
   `pdfjs-dist` as initial opener, authoritative page-count owner, best-effort
   metadata owner, and fallback extractor. Destroy its loading task in one
   outer `finally` covering every success and failure path.
3. GREEN: add the internal Markdown-to-block parser in `pdf.ts` or a focused
   internal sibling. Use the already-installed mdast/GFM utilities; preserve
   source order, retain raw heading slices, derive parser-decoded compact
   heading paths, classify top-level narrative/list/code/other blocks, parse
   tables using the first GFM row as `columns`, omit empty blocks, and expose a
   range only when `page.content.slice(start, end) === block.content`. Do not
   expose an AST or parser hook.
4. RED then GREEN: using the committed mixed fixture and the real successful
   native result, assert only `needsOcr: true` pages invoke observable
   `media.describe`; their unreliable native Markdown is discarded and any
   model-derived page has no blocks. Reliable pages remain model-free. Cover
   unavailable, empty, and throwing descriptions: retain the physical page as
   empty, emit the existing located `partial_extraction` warning, and do not
   include native diagnostics or OCR reasons. Use one shared media-description
   helper for native OCR pages and fallback textless pages.
5. RED then GREEN: title metadata is best-effort—native pages still load when
   `getMetadata()` fails, while an available `Title` survives.
6. RED: force only failure/malformed external boundaries and validate the
   native result as `unknown`. Cover all of these independently: missing
   `pages`; non-array `pages`; too few or too many entries; non-object entries;
   duplicate, missing, unordered, or non-one-to-one page values after the
   required zero-based-to-one-based mapping; fractional, `NaN`, or infinite
   page values; non-string `markdown`; and non-boolean `needsOcr`. The accepted
   native entries must be exactly the physical page count, unique and in strict
   document order, with finite integer zero-based values `entry.page === n`
   (therefore yielding ordered one-based public pages). Use `unknown`, small
   readonly internal validated types, a closed fallback-reason union, and
   narrow guards; do not use `any` or broad assertions.
7. GREEN: before this task's commit, implement complete all-or-nothing result
   validation and the document-wide `pdfjs-dist` fallback. For dynamic-import
   unavailability, native extraction throw, and every invalid result, retain
   every physical fallback page without blocks and emit exactly one
   `parser_warning` with the exact message:

   ```text
   PDF source "<sourceId>" used the pdfjs-dist fallback because layout-aware extraction was unavailable; document structure may be reduced.
   ```

   Assert metadata contains only `primaryParser: "pdf-inspector"`,
   `fallbackParser: "pdfjs-dist"`, and respectively
   `reason: "backend_unavailable"`, `"extraction_failed"`, or
   `"invalid_result"`. Preserve fallback textless-page/model behavior and the
   one outer loading-task cleanup. Warnings must not contain bytes, native
   output/diagnostics, stacks, or paths beyond the source ID.
8. RED then GREEN: if fallback page extraction also fails, retain the existing
   public `parse_failed` behavior and fallback failure cause. Do not create a
   document, downgrade warning, or new public error channel.
9. Regenerate only the package lock through the normal pnpm workflow. Confirm
   the native package's platform packages remain optional/transitive; do not add
   it to Core, Local, or Indexer. Run that lock command alone and wait for it to
   exit before any verification command.
10. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/ingest test -- __tests__/sources.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/ingest typecheck
   ```

11. Perform spec-compliance review, then code-quality review. Commit this task
    alone, e.g. `feat(ingest): safely extract native PDF pages`.

## Task 3 — Structured narrative

**Public behavior:** `chunker.structured()` uses page text blocks to keep
narrative sections and physical pages separate, repeat normalized heading
context, and report exact provenance only when it can prove it.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/src/indexing/provenance.ts`
- `packages/core/src/indexing/pipeline.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts` (new)
- `packages/core/__tests__/indexing/chunk-source-spans.test.ts`

1. RED: use authored Core page blocks to prove two sections remain separate,
   fitting paragraph/list/code/`other` blocks remain whole, and a split body
   repeats exactly one compact ATX heading prefix. Cover nested and skipped
   levels, consecutive headings, content before a heading, an empty-visible
   heading retained as `other`, heading-only sections, separator-aware body
   budgets, and over-limit prefixes/heading-only output remaining whole under
   the approved soft-overhead rule.
2. GREEN: add a block-aware structured narrative path ahead of the existing
   flat page splitter. Treat headings as boundaries, not duplicated body;
   pack narrative only within one page and compact heading path; use the
   existing paragraph/sentence/hard-limit splitter only for oversized narrative
   blocks. Pages without blocks retain today's flat behavior.
3. RED then GREEN: chunks retain page part ID, physical location, and
   deduplicated heading/body block IDs. Expose exact spans only for one unchanged
   contiguous block or proven split slice with a matching relative range and a
   uniquely occurring complete page. Repeated block text within one unique page
   remains exact by range; repeated complete page content is derived with no
   guessed global span. Packing, prefixes, and unprovable splits are derived.
4. Bump only the `structured` chunker version/fingerprint in `pipeline.ts`.
   Leave `text`, `semantic`, and `parent-child` behavior/fingerprints unchanged
   in this slice.
5. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts __tests__/indexing/chunk-source-spans.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

6. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): chunk page block narratives structurally`.

## Task 4 — Table windows

**Public behavior:** structured page-table blocks become deterministic,
indivisible-row Markdown windows with heading context and derived provenance.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts`

1. RED: assert a page table becomes canonical Markdown row windows with active
   heading prefix, page/heading/table block IDs, and derived spans. Cover the
   GFM header/body convention, absent headers, header-only tables, ragged cells,
   escaped backslash/pipe/newline cells, `tableRowsPerChunk`, exact
   max-character shrinking, and one oversized indivisible row or header
   payload. Prove nested page tables never become top-level table parts.
2. GREEN: implement the approved canonical cell normalization, escaping,
   padding, rendering, and window planner. Recalculate width/padding for every
   candidate; repeat a real header only; count body rows; repeatedly remove the
   final candidate row until the exact payload fits `maxChars`; never truncate
   cells or split rows. Preserve heading-prefix soft overhead and the declared
   indivisible over-limit exceptions.
3. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

4. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): window page block tables`.

## Task 5 — Explicit text/semantic strategy isolation

**Public behavior:** explicitly selected text and semantic strategies do not
silently adopt structured page-block behavior.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/src/indexing/pipeline.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts`
- `packages/core/__tests__/indexing/indexer-identity.test.ts`

1. RED: prove `chunker.text()` keeps the current flat page splitter even when
   blocks exist, and `chunker.semantic()` keeps its existing caller/model/
   embedding boundary behavior. Assert their chunker versions and fingerprints
   remain unchanged while the already-changed structured fingerprint differs.
2. GREEN: make the minimum deliberate strategy split needed to isolate the
   structured page-block path. Do not copy structured section/table behavior
   into text or semantic, and do not change their fingerprints.
3. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts __tests__/indexing/indexer-identity.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

4. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `fix(core): isolate explicit chunking strategies`.

## Task 6 — Parent-child boundaries

**Public behavior:** parent-child aggregation consumes structured units without
crossing pages, heading paths, or tables, and table windows remain indivisible
parents and children.

**Likely files:**

- `packages/core/src/indexing/chunkers.ts`
- `packages/core/src/indexing/pipeline.ts`
- `packages/core/__tests__/indexing/page-block-chunking.test.ts`
- `packages/core/__tests__/indexing/indexer-identity.test.ts`

1. RED: prove the structured first stage supplies page ID, compact
   `headingPath`, contributing `blockIds`, and structural kind. Parents and
   children must not cross a physical page or heading-path boundary. Narrative
   and table units must not join; each rendered table window is one identical
   parent and child even above `parentMaxChars` or `childMaxChars`. Assert
   retained page, heading-block, and table-block provenance.
2. GREEN: add hard aggregation boundaries on page/heading change and before and
   after every table window. Split children only inside one narrative parent;
   bypass both splitters for table windows. Keep table provenance derived.
3. RED then GREEN: bump only the `parent-child` version/fingerprint now. Assert
   `structured` and `parent-child` changed, while `text` and `semantic` versions
   and fingerprints remain unchanged.
4. Verify sequentially:

   ```sh
   pnpm --filter @use-crux/core test -- __tests__/indexing/page-block-chunking.test.ts __tests__/indexing/indexer-identity.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   ```

5. Perform spec-compliance review, then code-quality review. Commit this task
   alone, e.g. `feat(core): preserve parent child block boundaries`.

## Task 7 — Release, docs, and consumer evidence

**Public behavior:** all source forms share the approved native/fallback
contract, published documentation explains the behavior and deployment limits,
and a staged packed consumer resolves both Crux packages and the native binary.

**Likely files:**

- `packages/ingest/__tests__/sources.test.ts`
- `apps/docs/content/docs/guides/retrieval/ingestion.mdx`
- `apps/docs/content/docs/guides/retrieval/chunkers.mdx`
- `apps/docs/content/docs/reference/ingest/index.mdx`
- `.changeset/xlsx-source-coordinates.md`

1. RED then GREEN: add caller-visible URL and Asset source parity coverage for
   native success, mixed OCR routing, document-wide fallback, retained physical
   pages, best-effort title, and loading-task destruction across success and
   failure. Keep only unavailable/throwing/malformed external boundaries
   mocked; normal native success continues through the committed fixture and
   real installed package.
2. Update the ingest guide/reference and chunker guide with native layout-aware
   Markdown/page blocks, `needsOcr` visual routing, the bounded downgrade
   warning, structured versus text/semantic behavior, heading repetition,
   table windows, parent-child boundaries, provenance, Node 22/native-only
   support, and required bundler externalization of the N-API package.
3. Update the existing `.changeset/xlsx-source-coordinates.md`; do not create a
   new changeset. Its front matter must name both directly affected packages as
   minor:

   ```yaml
   "@use-crux/core": minor
   "@use-crux/ingest": minor
   ```

   Keep the notes concise and user-facing: one note for Core's additive
   page-block/provenance and structured/parent-child chunking behavior, and one
   for Ingest's native PDF extraction, selective visual routing, and safe
   `pdfjs-dist` fallback behavior.
4. Verify sequentially, starting each command only after the previous command
   exits:

   ```sh
   pnpm --filter @use-crux/ingest test -- __tests__/sources.test.ts --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/ingest typecheck
   pnpm --filter @use-crux/core test -- --maxWorkers=1 --no-file-parallelism
   pnpm --filter @use-crux/core typecheck
   pnpm --filter @use-crux/ingest test -- --maxWorkers=1 --no-file-parallelism
   ```

5. From `packages/ingest`, run the focused real-package proof as an isolated
   command: invoke the installed `@firecrawl/pdf-inspector` entry and
   `extractPagesMarkdown` against the committed mixed tiny fixture on Node 22.
   Prove the selected optional platform binary loads. Do not mock this proof or
   make forced fallback tests depend on platform support.
6. Prepare packed-consumer inputs before packing through the repository's
   normal release workflow. Run
   `pnpm release:stage:ts -- --out <recorded-stage-dir>` alone, wait for it to
   exit, and record the stage directory. This release staging must compile the
   output and rewrite package exports to `dist`. Do not pack a raw workspace
   package.
7. Only after release staging exits, run the packed-consumer smoke sequentially
   in a safely created temporary directory. Use `mktemp -d` beneath
   `${TMPDIR:-/tmp}` and a shell `trap` that removes only the recorded temporary
   directory. Pack staged `<recorded-stage-dir>/@use-crux/core` and staged
   `<recorded-stage-dir>/@use-crux/ingest` into the temporary `packs/`
   directory, one package command at a time. Create a Node 22 consumer beneath
   `install/`, install those tarballs with pnpm offline/no-workspace resolution,
   then run a Node ESM script that imports `@use-crux/ingest`, loads the fixture
   through `fileSource()`, and confirms the wrapper plus selected optional
   native platform package resolve. Do not use repository paths, workspace
   links, raw workspace tarballs, Edge/browser bundles, or overlapping stage,
   pack, install, or smoke commands.
8. Run `git diff --check`. Perform a whole-implementation spec-compliance
   review followed by a whole-implementation code-quality review. Commit this
   task alone, e.g. `feat(ingest): release layout-aware PDF ingestion`.

## Final sequential checklist

1. Confirm the seven task commits exist in order and each task received its
   own spec-compliance review followed by code-quality review before the next
   task began.
2. Confirm Core remains provider-neutral and dependency direction is only
   `@use-crux/ingest -> @use-crux/core`.
3. Confirm `pdfjs-dist` owns open/page count/metadata/fallback and one outer
   cleanup; native extraction is dynamic and all-or-nothing after complete
   validation.
4. Confirm the committed real-package mixed fixture proves native success and
   selective `needsOcr` routing without mocking a normal native result; only
   failure and malformed external boundaries are mocked.
5. Confirm unavailable, throwing, and invalid native results produce their
   exact single bounded warning, while fallback failure preserves the existing
   `parse_failed` behavior without a document warning.
6. Confirm every relevant test command uses
   `--maxWorkers=1 --no-file-parallelism`, and every test, typecheck, build,
   release-stage, install, lockfile, and package command ran sequentially and
   non-overlapping.
7. Confirm only structured and parent-child behavior/fingerprints changed;
   text and semantic behavior/fingerprints did not.
8. Confirm `.changeset/xlsx-source-coordinates.md` includes both
   `@use-crux/core` and `@use-crux/ingest` as minor with concise package-specific
   notes, no duplicate changeset exists, and docs cover native platform and
   bundler constraints.
9. Confirm release staging completed before either staged package was packed,
   and the temporary Node 22 consumer used only staged Core/Ingest tarballs,
   resolved the native platform package, and was safely removed.
10. Re-run `git diff --check`, inspect the final diff, then complete the final
    spec-compliance review followed by the final code-quality review before
    merge.

## Repository discoveries affecting execution

- Current `packages/ingest/src/pdf.ts` has one `pdfjs-dist` extraction path;
  its textless-page behavior already uses `media.describe` and located
  `partial_extraction` warnings. Preserve those semantics for fallback and
  model pages rather than adding another warning channel.
- Core currently has no page-block representation and `chunker.text()` calls
  the same `chunkDocumentStructured()` implementation as `structured`; Task 5
  requires a deliberate strategy split, not merely a new conditional.
- `structured`, `parent-child`, `text`, and semantic are currently version `2`
  in `packages/core/src/indexing/pipeline.ts`. Task 3 bumps structured, Task 6
  bumps parent-child, and Tasks 5/6 prove text and semantic stay unchanged.
- Ingest already owns `mdast-util-from-markdown`, `mdast-util-gfm`, and
  `mdast-util-to-string`, so no general Markdown dependency belongs in Core.
- The lock currently contains `pdfjs-dist` but no installed
  `@firecrawl/pdf-inspector`; Task 2 must make dependency and lock resolution
  reproducible before the real native and packed-consumer checks.
- `.changeset/xlsx-source-coordinates.md` is the relevant pending release
  changeset and already includes PDF behavior. Task 7 extends that file for
  both directly affected packages instead of adding another changeset.
