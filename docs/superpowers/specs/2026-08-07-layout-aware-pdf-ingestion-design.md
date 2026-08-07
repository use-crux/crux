# Layout-Aware PDF Ingestion

Date: 2026-08-07

Status: Approved for implementation planning

## Summary

`@use-crux/ingest` will use `@firecrawl/pdf-inspector` as its default PDF
text-extraction backend. Its per-page, layout-aware Markdown will replace the
flat text currently assembled from `pdfjs-dist` text items. This gives the
existing structured chunker better heading, list, table, column, and reading
order signals. Native pages also expose typed text and table blocks so the
default structured chunker can use those signals for section-aware boundaries,
heading context, and table row windows.

`pdfjs-dist` remains responsible for opening the PDF, reporting the
authoritative physical page count, and reading document metadata. It is also
the document-wide extraction fallback when native layout-aware extraction is
unavailable or invalid. Every successful fallback emits one bounded warning
because the resulting document may contain less structure.

## Goals

- Improve PDF content supplied to indexing and chunking through layout-aware
  Markdown.
- Preserve the native page structure as typed, ordered blocks beneath each
  physical page.
- Make the default structured and parent-child chunkers use page blocks for
  section boundaries, heading context, coherent block splitting, and tables.
- Route only pages that `pdf-inspector` identifies as unreliable through the
  existing application-owned `media.describe` operation.
- Preserve every physical page, its one-based page number, and its existing
  `sourceLocation`.
- Preserve title metadata through `pdfjs-dist` when available.
- Degrade safely on unsupported platforms and native parser failures.
- Make every downgrade visible through the existing ingest warning contract.
- Keep parser/source call signatures unchanged and add only the page-block type
  surface needed to carry structure into chunking.

## Non-goals

- Adding a public parser-backend selector.
- Adding a PDF-specific parser or backend abstraction to `@use-crux/core`.
- Turning detected PDF tables into top-level `IngestTablePart` values. Tables
  remain nested beneath their physical page.
- Shipping OCR. Visual extraction remains an application-owned model
  operation.
- Running two extractors and heuristically scoring their output.
- Adding PDF parsing to Crux Local or the Project Index compiler.

## Public Contract

Existing file, URL, and Asset source calls continue to emit
`IngestPagePart` values. The type gains an optional block representation:

```ts
interface IngestPagePart {
  kind: "page";
  content: string; // Complete page Markdown or fallback text.
  pageNumber: number;
  sourceLocation?: { type: "page"; pageNumber: number };
  blocks?: IngestPageBlock[];
}

type IngestPageBlock = IngestPageTextBlock | IngestPageTableBlock;

interface IngestPageTextBlock {
  id: string;
  kind: "text";
  role: "heading" | "paragraph" | "list" | "code" | "other";
  content: string;
  headingPath?: string[];
}

interface IngestPageTableBlock {
  id: string;
  kind: "table";
  content: string;
  rows: string[][];
  columns?: string[];
  headingPath?: string[];
}
```

Block IDs are stable within their page and ordered exactly as their source
blocks appear. Arrays exposed by parser results follow existing ingest
mutability conventions; Core's corresponding indexing input types remain
readonly where currently required.

The compatible content change is that `content` may now contain structured
Markdown instead of flattened plain text. `blocks` is additive and optional:
custom callers and fallback pages remain valid without it. Document rendering
continues to use page `content`; nested blocks are chunking input and are not
rendered again or duplicated in aggregate document content.

`@use-crux/core` mirrors the provider-neutral page-block shape in
`CruxIngestPart`. It does not reference `pdf-inspector`, PDF parser settings,
or another ingest dependency.

`@firecrawl/pdf-inspector` becomes a direct dependency of
`@use-crux/ingest`. Its platform packages remain its own optional
dependencies. An unsupported or unavailable native binary does not prevent
PDF ingestion because the parser falls back to `pdfjs-dist`.

## Architecture

The PDF parser remains one deep internal module behind the existing
`IngestParser.parse()` interface. It coordinates two external parser
boundaries but does not expose either boundary publicly.

```text
PDF bytes
  |
  +-- pdfjs-dist
  |     +-- open document
  |     +-- authoritative physical page count
  |     +-- best-effort title metadata
  |     `-- flat page extraction, only if native extraction downgrades
  |
  `-- pdf-inspector
        +-- layout-aware Markdown for every physical page
        `-- per-page needsOcr decision
```

The parser loads the `pdfjs-dist` document first. Failure to open the document
remains a parse failure, matching the current contract. A failure of
`getMetadata()` alone is ignored and successful content extraction continues
without an extracted title.

The native package is imported dynamically so a missing platform binary can
be recovered at runtime. PDF bytes are converted to a Node `Buffer` only at
this external boundary; the public ingest contract remains `Uint8Array`. The
native operation is exactly `extractPagesMarkdown(buffer)`, called without a
page selection so its result must cover the complete document.

The `pdfjs-dist` loading task is owned by `parsePdf()` and destroyed in one
outer `finally` block. Native success, fallback success, metadata failure,
native failure, fallback failure, and result-validation failure must all pass
through that cleanup.

After native result validation, an internal Markdown block parser converts
each page independently. It uses the existing Markdown dependencies already
owned by `@use-crux/ingest`, preserves source order, maintains an active
heading path, classifies top-level narrative/list/code blocks, and converts
Markdown tables to cell rows. This parser is internal and does not add a
general Markdown AST contract to Core.

## Native Result Validation

The native add-on is a runtime boundary. Its result is treated as `unknown`
until a small type guard validates only the fields Crux consumes. The internal
validated types use readonly properties and a closed fallback-reason union;
they do not reproduce the dependency's full API.

A valid result must satisfy all of these invariants:

- `pages` is an array with exactly the `pdfjs-dist` physical page count.
- Each entry has a finite integer, zero-based `page` index.
- Entries are in strict document order: entry `n` has `page === n`.
- `markdown` is a string.
- `needsOcr` is a boolean.

Any violation downgrades the entire document. Crux will not combine native and
fallback extraction semantics within one PDF.

## Page Data Flow

For each validated native page, Crux converts the zero-based native index to
the existing one-based `pageNumber`.

### Reliable native page

When `needsOcr` is false, the trimmed native Markdown becomes the page part's
content. Non-empty Markdown is also parsed into ordered page blocks. Empty
content is retained as an empty physical page without blocks.

### Page requiring visual extraction

When `needsOcr` is true, native Markdown is considered unreliable and is not
indexed. If `media.describe` is bound, Crux sends the same one-page extraction
request used today and uses its non-empty response as the page content.

Model-derived page text has no trusted structural parse in this change and is
therefore emitted without blocks.

If `media.describe` is unavailable, returns empty text, or throws, Crux emits
the existing located `partial_extraction` warning and retains an empty page
part. Native OCR reasons are not copied into warnings in this change. Native
Markdown, PDF bytes, error stacks, and dependency-owned diagnostic strings
must not be included.

This expected OCR route is not a parser fallback and does not emit the
document-level downgrade warning.

## Document-wide Fallback

The parser falls back to `pdfjs-dist` page extraction when:

1. the native package or its platform binary cannot load;
2. native extraction throws; or
3. native output fails the page-result invariants.

Fallback applies to every page in the document. The existing text-item
normalization supplies each page's content. Textless fallback pages retain the
current `media.describe` behavior and located `partial_extraction` warning
semantics. Fallback pages do not carry blocks; their absence is the structural
downgrade reported by the document warning.

After fallback extraction succeeds, the parser emits exactly one
document-level warning through `ParseContext.warn()`:

```ts
{
  code: "parser_warning",
  message:
    'PDF source "<sourceId>" used the pdfjs-dist fallback because ' +
    'layout-aware extraction was unavailable; document structure may be reduced.',
  metadata: {
    primaryParser: "pdf-inspector",
    fallbackParser: "pdfjs-dist",
    reason: "backend_unavailable" | "extraction_failed" | "invalid_result"
  }
}
```

The warning is part of `document.warnings`; the implementation must not write
to `console.warn`. Warning metadata contains only the closed reason and parser
names. It does not contain raw error messages, paths beyond the existing source
identifier in the warning message, PDF content, native output, or stacks.

If fallback extraction also fails, the source fails through the existing
`parse_failed` path. There is no document on which to return a downgrade
warning, so `document.warnings` is not observable in that case. The
implementation should preserve the fallback failure as the public error cause
and attach the native failure internally where the current error pipeline
permits it, but must not create a new public error or warning channel.

## Structured Chunking

Physical pages remain hard provenance boundaries. The default
`chunker.structured()` checks for page blocks before using its existing flat
page splitter.

Within a blocked page it processes blocks in source order:

1. A heading starts a new section and updates the active heading path.
2. Narrative blocks are packed within that section up to `maxChars`; a chunk
   never crosses the next heading or physical page.
3. Paragraph, list, and code blocks remain whole when they fit. An individual
   oversized block uses the existing paragraph, sentence, then hard-limit
   splitter.
4. Every narrative chunk carries its active heading path in its content. The
   first chunk may use the source heading already present; later chunks repeat
   a normalized Markdown heading prefix so embeddings and generation receive
   the section context.
5. A table is a separate structural unit. It uses `tableRowsPerChunk`, repeats
   its column/header row for each window, and carries the active heading path.
6. A heading with no following content still produces one useful heading
   chunk rather than disappearing.

Chunks that are exact contiguous page/block slices retain exact provenance
when it can be proven. Repeating heading context, rendering table windows, or
combining separated block content marks character-span provenance as derived.
Every resulting chunk retains the physical page location and the nested block
IDs that contributed to it.

The page-block path is enabled only for `chunker.structured()` and the
structured first stage used by `chunker.parentChild()`. `chunker.text()` keeps
flat page splitting even when blocks are present. `chunker.semantic()` keeps
its existing caller-supplied/model/embedding boundary behavior. This avoids
silently changing explicitly selected chunking strategies.

Pages without blocks—including `pdfjs-dist` fallback and model-derived
pages—use today's paragraph-aware flat page splitting. Thus the fallback
warning corresponds to a real loss of section and table-aware chunking.

The structured and parent-child chunker fingerprint versions must change so
stored indexing identities cannot reuse output produced before page blocks
were understood. The text and semantic chunker fingerprints do not change.

## Dependency and Packaging

- Add `@firecrawl/pdf-inspector` to `packages/ingest/package.json`.
- Keep `pdfjs-dist`; it is not optional because metadata and fallback depend
  on it.
- Do not add the native dependency to Core, Local, Indexer, or another package.
- Core receives only the provider-neutral optional page-block types and
  chunking behavior; dependency direction remains `ingest -> core`.
- This remains a Node package with the existing Node 22 minimum. Native PDF
  extraction is not supported in browser or Edge runtimes.
- Normal package-manager installation must leave
  `@firecrawl/pdf-inspector` and its selected optional platform package
  resolvable at runtime. Application bundlers must externalize the N-API
  package rather than folding its binary into a single-file or Edge bundle;
  document this deployment requirement.
- Exercise the installed native package in the supported development/CI
  environment, while forcing boundary failures in focused tests.
- Document that PDF ingestion prefers a native backend and may fall back on
  unsupported platforms.

## TDD Implementation Sequence

Implementation follows vertical red-green slices. Each test exercises a public
source API; the external native package may be mocked only where a particular
boundary failure must be forced.

1. **Layout-aware tracer bullet:** a PDF loaded through `fileSource()` exposes
   the native page Markdown, typed blocks, and existing page provenance. Add
   the minimum native and block-parsing path to pass.
2. **Structured chunk tracer bullet:** the public structured chunker keeps two
   PDF sections separate and repeats heading context when one section spans
   multiple chunks. Add the minimum block-aware chunking path to pass.
3. **Table chunking:** a native PDF table becomes row-windowed chunks with a
   repeated header, heading context, page provenance, and derived span
   confidence. Add only the table block path.
4. **Explicit strategy isolation:** text chunking remains flat while
   parent-child consumes the structured page interpretation. Add the minimum
   strategy distinction and fingerprint changes.
5. **Visual routing:** a mixed PDF routes only native `needsOcr` pages through
   `media.describe`, never indexes their unreliable native Markdown, and keeps
   reliable pages model-free. Add the minimum routing logic.
6. **Unavailable backend fallback:** forced native-load failure returns all
   physical pages through `pdfjs-dist` and one bounded downgrade warning. Add
   the minimum fallback state and warning.
7. **Extraction and validation fallbacks:** throws and malformed/missing page
   results select their exact closed reason while preserving the same public
   behavior. Add runtime validation without `any` or broad assertions.
8. **Metadata and source parity:** preserve PDF title metadata and verify URL
   and Asset-backed sources use the same parser behavior.
9. **Failure compatibility:** failure of both extraction paths still becomes
   the existing source parse failure.
10. **Refactor while green:** remove duplication between native and fallback
    page materialization, retain one media-description helper, and keep the
    external boundary and page-block types small.

Tests should assert caller-visible documents and warnings, not private helper
calls. They may assert the application-owned `media.describe` boundary because
whether a paid/model operation occurs is observable behavior.

## Verification

Run at minimum:

```sh
pnpm --filter @use-crux/ingest test
pnpm --filter @use-crux/ingest typecheck
pnpm --filter @use-crux/core test
pnpm --filter @use-crux/core typecheck
```

Also verify the package lockfile and package build/type resolution with the
repository's normal package workflow as appropriate. Pack
`@use-crux/ingest`, install the tarball in a temporary Node 22 project through
the package manager, and load a PDF without workspace resolution. This must
prove that the wrapper package and selected optional platform binary resolve
from a consumer installation. A focused real-package test must demonstrate
that the installed native binary loads on the current platform; fallback tests
must not depend on the current platform being unsupported. Browser, Edge, and
single-file bundled execution are outside the supported contract.

## Documentation and Release

Update the ingest guide and reference to say that PDFs use layout-aware native
Markdown extraction, route unreliable pages through `media.describe`, and
fall back to `pdfjs-dist` with a `parser_warning` when native extraction cannot
be used. Update chunking documentation with the page-block behavior, supported
chunkers, heading repetition, table windows, and provenance consequences.

This changes published runtime behavior and install behavior for
`@use-crux/ingest`. Update the existing pending ingest changeset
`.changeset/xlsx-source-coordinates.md`; do not add a duplicate changeset.

## Acceptance Criteria

- Supported installations use `pdf-inspector` by default.
- Reliable pages retain layout-aware Markdown, ordered typed blocks, and exact
  page provenance.
- Structured chunks do not cross PDF headings or physical pages, retain active
  heading context, and keep fitting list/code/paragraph blocks whole.
- PDF table blocks use row windows with repeated headers and derived span
  provenance.
- Parent-child chunking consumes the structured page interpretation while text
  and semantic chunking retain their existing strategies.
- Pages marked `needsOcr` never index unreliable native Markdown.
- Only those unreliable pages invoke `media.describe`.
- Native loading, extraction, or validation failures recover with a
  document-wide `pdfjs-dist` extraction when that extractor succeeds.
- Every successful recovery emits exactly one bounded `parser_warning`
  explaining the structural downgrade; a failed recovery returns the existing
  source parse failure without inventing a warning channel.
- Fallback retains every physical page and the existing per-page warning
  behavior.
- Best-effort PDF title metadata remains available.
- Every success and failure path destroys the `pdfjs-dist` loading task.
- A packed consumer install on Node 22 resolves and loads the native package
  and its selected platform binary without workspace resolution.
- No public backend configuration or PDF-specific Core dependency is
  introduced; the only additive public surface is provider-neutral page-block
  data.
- Ingest and Core tests and typechecking pass.
