# Layout-Aware PDF Ingestion

Date: 2026-08-07

Status: Approved for implementation planning

## Summary

`@use-crux/ingest` will use `@firecrawl/pdf-inspector` as its default PDF
text-extraction backend. Its per-page, layout-aware Markdown will replace the
flat text currently assembled from `pdfjs-dist` text items. This gives the
existing structured chunker better heading, list, table, column, and reading
order signals without changing the public document, part, or chunker APIs.

`pdfjs-dist` remains responsible for opening the PDF, reporting the
authoritative physical page count, and reading document metadata. It is also
the document-wide extraction fallback when native layout-aware extraction is
unavailable or invalid. Every successful fallback emits one bounded warning
because the resulting document may contain less structure.

## Goals

- Improve PDF content supplied to indexing and chunking through layout-aware
  Markdown.
- Route only pages that `pdf-inspector` identifies as unreliable through the
  existing application-owned `media.describe` operation.
- Preserve every physical page, its one-based page number, and its existing
  `sourceLocation`.
- Preserve title metadata through `pdfjs-dist` when available.
- Degrade safely on unsupported platforms and native parser failures.
- Make every downgrade visible through the existing ingest warning contract.
- Keep Core and the public parser/source APIs unchanged.

## Non-goals

- Adding a public parser-backend selector.
- Adding PDF-specific types to `@use-crux/core`.
- Turning detected PDF tables into separate `IngestTablePart` values. Tables
  remain Markdown inside their physical page in this change.
- Shipping OCR. Visual extraction remains an application-owned model
  operation.
- Running two extractors and heuristically scoring their output.
- Adding PDF parsing to Crux Local or the Project Index compiler.

## Public Contract

There is no new public API. Existing file, URL, and Asset source calls continue
to emit `IngestPagePart` values:

```ts
interface IngestPagePart {
  kind: "page";
  content: string;
  pageNumber: number;
  sourceLocation?: { type: "page"; pageNumber: number };
}
```

The compatible behavior change is that `content` may now contain structured
Markdown instead of flattened plain text. The default structured chunker
already consumes each part independently and carries page provenance forward,
so it receives the improved structure without a new chunking interface.

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
content. Empty content is retained as an empty physical page.

### Page requiring visual extraction

When `needsOcr` is true, native Markdown is considered unreliable and is not
indexed. If `media.describe` is bound, Crux sends the same one-page extraction
request used today and uses its non-empty response as the page content.

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
semantics.

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

## Chunking Consequences

This change improves the semantic material presented to chunking rather than
changing chunking policy. Physical pages remain the first provenance
boundary. Within page content, Markdown headings, lists, tables, code blocks,
and reading order provide more coherent input to current and future chunkers.

This design deliberately does not parse the returned Markdown into nested
`IngestPart` values. That can be evaluated separately if corpus evidence shows
that page-level Markdown alone is insufficient.

## Dependency and Packaging

- Add `@firecrawl/pdf-inspector` to `packages/ingest/package.json`.
- Keep `pdfjs-dist`; it is not optional because metadata and fallback depend
  on it.
- Do not add the native dependency to Core, Local, Indexer, or another package.
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
   the native page Markdown and existing page provenance. Add the minimum
   native path to pass.
2. **Visual routing:** a mixed PDF routes only native `needsOcr` pages through
   `media.describe`, never indexes their unreliable native Markdown, and keeps
   reliable pages model-free. Add the minimum routing logic.
3. **Unavailable backend fallback:** forced native-load failure returns all
   physical pages through `pdfjs-dist` and one bounded downgrade warning. Add
   the minimum fallback state and warning.
4. **Extraction and validation fallbacks:** throws and malformed/missing page
   results select their exact closed reason while preserving the same public
   behavior. Add runtime validation without `any` or broad assertions.
5. **Metadata and source parity:** preserve PDF title metadata and verify URL
   and Asset-backed sources use the same parser behavior.
6. **Failure compatibility:** failure of both extraction paths still becomes
   the existing source parse failure.
7. **Refactor while green:** remove duplication between native and fallback
   page materialization, retain one media-description helper, and keep the
   external boundary types small.

Tests should assert caller-visible documents and warnings, not private helper
calls. They may assert the application-owned `media.describe` boundary because
whether a paid/model operation occurs is observable behavior.

## Verification

Run at minimum:

```sh
pnpm --filter @use-crux/ingest test
pnpm --filter @use-crux/ingest typecheck
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
be used.

This changes published runtime behavior and install behavior for
`@use-crux/ingest`. Update the existing pending ingest changeset
`.changeset/xlsx-source-coordinates.md`; do not add a duplicate changeset.

## Acceptance Criteria

- Supported installations use `pdf-inspector` by default.
- Reliable pages retain layout-aware Markdown and exact page provenance.
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
- No new Core or ingest public configuration/type surface is introduced.
- Ingest tests and typechecking pass.
