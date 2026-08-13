# Anydoc Phase 1 contract audit

Date: 2026-08-08 · Scope: Phase 1 task 1 only · Status: complete

This records the pre-schema-2 state on `feat/anydoc-ingestion`. It is an audit,
not an implementation decision or compatibility promise.

## Incumbent facts mapped to schema 2

| Area | Current fact | Schema-2 disposition |
| --- | --- | --- |
| Core document | `CruxDocument` has namespace/source ID, aggregate content, optional source facts, metadata, parts, and warnings (`packages/core/src/indexing/types.ts`). | Replace as the normalized ingest boundary with `IngestedDocument { schemaVersion: 2, source, producer, blocks, assets, diagnostics }`. Namespace/source ID remain corpus concerns, not document provenance. |
| Ingest document | `IngestDocument` has the same broad shape, with parser output normalized in `packages/ingest/src/document.ts`; `parseDocument` records only `format` and parser *name* in loose metadata. | Adapt each parser result to Core schema 2. Add document SHA-256, media type, closed format, and parser dependency/adapter versions; do not rely on metadata. |
| Parts and blocks | Core and Ingest model text, tables, sheets, JSON, pages, plus PDF page text/table blocks. Blocks have IDs, roles, headings, and optional ranges, but are PDF-specific and lack coordinates/producer identity. | Generalize to the schema-2 recursive `DocumentBlock` union. Retain PDF page/block content and heading paths, but attach a closed coordinate and producer at every applicable level. |
| Source locations | `CruxSourceLocation`/`IngestSourceLocation` are only `{ type: 'page' }` or audio/video time. `ChunkProvenance` separately carries loose arrays for part IDs, pages, sheets, tables, JSON paths, and optional aggregate-content spans. | Replace public loose location/provenance with the closed `SourceCoordinate` union. Existing page locations map to `page-block` only when an actual block is known; the schema needs an explicit truthful representation for a physical page with no block, never an invented character location. |
| PDF | Merged main already uses `@firecrawl/pdf-inspector` for layout-aware page Markdown and typed page blocks, with `pdfjs-dist` metadata and whole-document fallback. It validates all physical pages, keeps textless pages, and emits warnings on downgrade/partial extraction (`packages/ingest/src/pdf.ts`). The inspector establishes the page ordinal; `pdf:page:N` and `pdf:page:N/block:N` are Crux adapter IDs, with blocks parsed from emitted Markdown. | Preserve this ownership and facts. Map the inspector page identity, adapter-derived structural IDs, normalized page-relative ranges, headings, and tables. Model fallback as `parser-downgrade` with the actual closed trigger and producer; do not infer layout roles on `pdfjs-dist` output. |
| PDF `media.describe` | For a textless PDF page, an application-owned `media.describe` callback may return text. Ingest observes the call and creates `pdf:page:N:visual`, but the returned content has no parser identity/version or model/operation provenance in the normalized document. | Treat this as derived application output, not parser extraction: retain its physical page coordinate only, mark provenance derived, and give it an explicit application-operation producer identity supplied by the host (or exclude it from schema-2 retrievable evidence until that identity exists). It must never be attributed to `pdf-inspector` or `pdfjs-dist`, and it must not receive parser-established block/range claims. |
| CSV | `csv-parse` produces a single table, exact logical cell strings, columns, and `rowStart`/`rowEnd` (`packages/ingest/src/parsers.ts`). | Preserve the matrix and map the table/window to `logical-table`. It currently has no per-cell ID/coordinate nor header count, and must not claim source byte/line offsets. |
| DOCX | Mammoth converts DOCX to HTML, then the existing HTML adapter produces text/table parts and parser warnings. It has no package-part coordinates, assets, parser version, or deterministic primary/fallback policy. | Convert current facts to schema 2 with document/package-part provenance only where established. The Phase 2 bake-off decides the one primary; Phase 1 must not introduce dual parsing. |
| XLSX | Merged main's ExcelJS adapter emits worksheet occupied range, row ranges, every physical cell address/value, formula, merge membership/master, display-formatted values, sheet parts, and table parts (`packages/ingest/src/types.ts`, `packages/ingest/src/parsers.ts`). | Preserve these facts exactly. Map sheet/range and cell/table coordinates into `sheet-range` and table cells. `displayedValue`, `formula`, and `mergeRange` belong in schema-2 cells. |
| Chunking | Core structured chunking already respects PDF page blocks, headings, and table row windows. It repeats rendered table headers, but marks table output `derived`; generic chunks derive spans by finding a unique aggregate-content substring. | Replace with deterministic typed-block chunking. Persist exact logical CSV rows and XLSX A1 ranges/cells through chunks; rendered headers are context, not source rows. Do not use aggregate-text searching as schema-2 source truth. |
| Retrieval and citations | Indexed records persist optional `ChunkProvenance`, but retrieval returns loose `EvidenceHit` content/source/metadata. Citations validate allowed hit IDs, quote inclusion, and optional spans against mutable hit content (`packages/core/src/citations/*`). | Add immutable `StoredEvidence` to Core retrieval/chunk APIs. Citation verification must bind retained normalized content/hash, block IDs, parser identity, document SHA, closed coordinate, and UTF-16 half-open quote span. |

## Exact gaps and migration requirements

1. Core has no schema version, document SHA-256, media type/format contract,
   parser identity, typed diagnostics, assets, or recursive document block model.
   Its `computeSourceHashes()` is a corpus change-detection hash, not the
   required source-byte SHA-256.
2. `ChunkProvenance` is an optional, open collection of independent fields;
   `RetrieverSource.location` is only page/time; citation metadata is arbitrary.
   None can enforce a coordinate belongs to the same document/parser.
3. The detailed XLSX facts are public from `@use-crux/ingest`, but Core's
   `CruxIngestPart` table/sheet branches do not declare `sourceRange`,
   `sourceRows`, or cells. Core chunking consequently renders `rows` and loses
   exact cell/range facts before stored retrieval evidence. This is the highest
   priority Phase-1 end-to-end regression test.
4. PDF facts are materially stronger than the old model: inspector-established
   physical page ordinals, Crux adapter-derived block IDs, layout-derived
   headings/tables, exact ranges only when emitted Markdown matches, degraded
   fallback warnings, and addressable textless pages. Schema 2 must migrate
   these rather than recreate PDF parsing. Current warning metadata is not a
   typed downgrade diagnostic and uses broader reasons (`backend_unavailable`,
   `extraction_failed`, `invalid_result`) than the production schema's declared
   trigger set.
5. Current IDs are parser-local strings and chunk IDs are based on current
   chunking inputs. Schema 2 requires stable block/chunk identity that includes
   document hash, parser identity, coordinate/structure, normalization, and
   chunker versions; persisted schema-1 material must be re-ingested, never
   upgraded by guessing.
6. The specified coordinate union has no page-only variant, while merged-main
   PDF deliberately preserves textless pages and `pdfjs-dist` fallback pages
   without native layout blocks. Add `{ readonly kind: 'page'; readonly page:
   number }` to schema 2 before implementing adapters. Do not silently
   manufacture a `page-block` sentinel such as `block: 0`.
7. `ParserIdentity` has no legal representation for application-owned
   `media.describe` output. Schema 2 needs a separate, closed application
   operation producer identity (with host-supplied version/identity) if that
   derived content remains retrievable, or the migration must retain it outside
   `IngestedDocument`/`StoredEvidence`. Reusing the enclosing PDF parser's
   identity would make citations falsely claim parser extraction.

## Dependency and release impact

- Direction is currently correct: `@use-crux/ingest` depends on
  `@use-crux/core`; Core has no ingest/parser import. Keep parser dependencies
  (`@firecrawl/pdf-inspector`, `pdfjs-dist`, `csv-parse`, ExcelJS, Mammoth, and
  future Anydoc) out of Core. Anydoc-native values must stop at the ingest
  adapter boundary.
- Phase-1's final type/runtime migration changes published Core and Ingest
  contracts incompatibly. It requires one coordinated Changesets entry owned by
  the implementation work, naming directly affected `@use-crux/core` and
  `@use-crux/ingest`; the repository's fixed package group will align releases.
  This audit adds none.
- Pending `xlsx-source-coordinates.md` already declares a **minor** change for
  Core and Ingest and describes the merged XLSX/PDF work. Its compatibility
  `rows` wording conflicts with the binding design's instruction to replace
  obsolete schema-1 shapes in the same release; the changeset owner must update
  that release note/bump as needed instead of adding a duplicate entry.
- Pending `structured-chunk-source-spans.md` is a Core **patch** for current
  span behavior. Schema 2 supersedes its ambiguous aggregate-text-span model;
  coordinate/evidence work must be reconciled with it by the single changeset
  owner.

## Recommended Phase-1 order

Define Core's exhaustive schema-2 contracts first, adapt CSV then DOCX then
XLSX then PDF, add the XLSX preservation test across normalization/chunking/
storage/retrieval, and finally replace retrieval/citation provenance with
`StoredEvidence`. This keeps the existing direct PDF and ExcelJS implementations
as inputs to the migration rather than duplicating or weakening them.
