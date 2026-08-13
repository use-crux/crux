# Anydoc ingestion and citation design

Date: 2026-08-08 · Status: Ready for implementation planning

## Decision

Crux will adopt `@firecrawl/anydoc` where it produces the best reliable source
representation, not as a universal parser. The integration expands format
coverage while preserving specialized parsers where their source models are
stronger.

| Formats | Production direction |
| --- | --- |
| DOC, DOCM, RTF, ODT, EPUB | Anydoc is the candidate primary parser after passing the bounded conformance suite. |
| PPT, PPS, POT, PPTX, PPTM, PPSX, PPSM, ODP | Anydoc is the candidate primary only if it preserves slide boundaries, order, text, tables, notes, and assets. |
| DOCX | Run a decisive bake-off against Mammoth, then choose one primary. Do not permanently parse with both. |
| PDF | Keep direct `pdf-inspector`, with `pdfjs-dist` for metadata and as the explicit degraded fallback. |
| XLSX, XLSM | Keep ExcelJS because spreadsheet coordinates, formulas, merges, and displayed values are first-class facts. |
| CSV | Keep `csv-parse` because its exact logical cell matrix is already the right representation. |
| XLS, XLSB, ODS | Evaluate Anydoc for readable document extraction, but do not call it spreadsheet-grade unless exact sheet and cell coordinates survive. |

Format detection is out of scope; callers and the existing loader supply the format.

Crux is pre-stable. We may replace normalized types and public provenance types
when doing so materially improves truthfulness, retrieval quality, or safety.
Compatibility shims are unnecessary unless they simplify migration.

## Parser ownership

Exactly one parser owns each document in normal production operation. We will
not merge outputs using fuzzy text matching, ordinal proximity, or model
judgment. Those techniques can make content look better while attaching the
wrong location to it.

For DOCX, evaluation selects one primary. The loser is eligible only for a
trigger-specific whole-document fallback declared in the `docx-fallback-v1`
fixture manifest. The closed primary triggers are `unsupported-feature`,
`invalid-result`, and `parser-crash`; timeout, memory/resource, containment,
encrypted, and input-validation failures never invoke another parser. For each
enabled trigger, the manifest must include a representative primary failure and
fallback success, with the fallback passing 100% required DOCX facts, identical
three-cold/five-warm hashes, hostile-input safety, package, and <=50% resource-
budget gates. Routing enables only individually proven triggers; if none pass,
there is no fallback. A fallback emits `parser-downgrade` with its trigger and
uses only its own provenance.

For PDF, `pdfjs-dist` fallback is allowed when `pdf-inspector` fails or returns
an invalid result. It must log a warning because layout roles, tables, and
heading understanding may be reduced.

Unsupported-format parsing succeeds only when its required structural contract
passes. Otherwise Crux returns a typed unsupported or invalid-result error; it
must not silently flatten a presentation or spreadsheet and label the result
lossless.

## Provider-neutral document model

`@use-crux/core` owns this provider-neutral document, chunk, and retrieval
provenance contract. `@use-crux/ingest` owns every parser dependency, worker,
adapter, and conversion into that contract; core never imports ingest or a
parser. Anydoc-native objects cannot cross the ingest boundary.

```ts
interface IngestedDocument {
  readonly schemaVersion: 2
  readonly source: DocumentSource
  readonly producer: ParserIdentity
  readonly metadata: Readonly<Record<string, Scalar>>
  readonly blocks: readonly DocumentBlock[]
  readonly assets: readonly DocumentAsset[]
  readonly diagnostics: readonly IngestDiagnostic[]
}
interface DocumentSource {
  readonly documentSha256: string
  readonly mediaType: string
  readonly format: IngestFormat
}
interface ParserIdentity {
  readonly name: 'anydoc' | 'mammoth' | 'pdf-inspector' | 'pdfjs-dist' | 'exceljs' | 'csv-parse'
  readonly version: string
  readonly adapterVersion: string
}
type Scalar = string | number | boolean
type DocumentBlock = TextBlock | ListBlock | TableBlock | PageBlock | SlideBlock | SheetBlock
interface BlockBase {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly headingPath: readonly string[]
  readonly producer: ParserIdentity
}
interface TextBlock extends BlockBase {
  readonly kind: 'text'
  readonly role: 'heading' | 'paragraph' | 'code' | 'quote' | 'note'
  readonly text: string
  readonly level?: number
  readonly inlines: readonly Inline[]
}
type Inline =
  | { readonly kind: 'text'; readonly text: string; readonly coordinate: SourceCoordinate; readonly producer: ParserIdentity }
  | { readonly kind: 'link'; readonly text: string; readonly target: string; readonly coordinate: SourceCoordinate; readonly producer: ParserIdentity }
interface ListBlock extends BlockBase {
  readonly kind: 'list'
  readonly ordered: boolean
  readonly items: readonly ListItem[]
}
interface ListItem {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: ParserIdentity
  readonly blocks: readonly (TextBlock | ListBlock)[]
}
interface TableBlock extends BlockBase {
  readonly kind: 'table'
  readonly columns: readonly string[]
  readonly headerRows: number
  readonly rows: readonly (readonly TableCell[])[]
}
interface TableCell {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: ParserIdentity
  readonly row: number
  readonly column: number
  readonly rowSpan: number
  readonly columnSpan: number
  readonly blocks: readonly (TextBlock | ListBlock)[]
  readonly displayedValue?: string
  readonly formula?: string
  readonly mergeRange?: string
}
interface PageBlock extends BlockBase {
  readonly kind: 'page'
  readonly page: number
  readonly blocks: readonly (TextBlock | ListBlock | TableBlock)[]
}
interface SlideBlock extends BlockBase {
  readonly kind: 'slide'
  readonly slide: number
  readonly blocks: readonly (TextBlock | ListBlock | TableBlock)[]
  readonly notes: readonly TextBlock[]
}
interface SheetBlock extends BlockBase {
  readonly kind: 'sheet'
  readonly sheet: string
  readonly range: string
  readonly blocks: readonly TableBlock[]
}
interface DocumentAsset {
  readonly id: string
  readonly mediaType: string
  readonly sha256: string
  readonly byteLength: number
  readonly coordinate: SourceCoordinate
  readonly producer: ParserIdentity
}
type IngestDiagnostic =
  | { readonly code: 'parser-downgrade'; readonly severity: 'warning'; readonly trigger: 'unsupported-feature' | 'invalid-result' | 'parser-crash'; readonly from: ParserIdentity['name']; readonly to: ParserIdentity['name']; readonly producer: ParserIdentity }
  | { readonly code: 'partial-extraction' | 'unsupported-feature'; readonly severity: 'warning'; readonly message: string; readonly coordinate?: SourceCoordinate; readonly producer: ParserIdentity }
type SourceCoordinate =
  | { readonly kind: 'document'; readonly documentSha256: string }
  | { readonly kind: 'package-part'; readonly part: string; readonly anchor?: string }
  | { readonly kind: 'page-block'; readonly page: number; readonly block: number; readonly start?: number; readonly end?: number }
  | { readonly kind: 'slide'; readonly slide: number; readonly block?: number }
  | { readonly kind: 'sheet-range'; readonly sheet: string; readonly range: string }
  | { readonly kind: 'logical-table'; readonly rowStart: number; readonly rowEnd: number }
```

Coordinates express only what the owning parser directly establishes. Anydoc
prose may initially use document or package-part provenance. That is honest but
less precise, and the API/UI must not present it as a page or character range.
Stable block IDs derive from the document hash, parser identity, coordinate,
and structural path; they are comparison and retrieval identities, not invented
source coordinates.

This work also closes two existing gaps:

- XLSX cell/range provenance must survive normalization and chunking instead of
  collapsing to sheet-level provenance.
- Public retrieval results and citations must expose a closed, typed source
  coordinate union instead of loosely shaped metadata.

Because Crux is pre-stable, existing ingest types are replaced at their package
boundary: adapters first convert old fixtures to schema 2, then consumers move
to core's new exhaustive types, and the obsolete shapes and compatibility
branches are deleted in the same release. Persisted schema-1 content is
re-ingested; it is not guessed into stronger provenance.

## Structure-aware chunking

Chunking consumes typed blocks, never raw parser Markdown. It is deterministic
for a document hash, parser identity, chunker version, and options.

### Prose

- Target roughly 200–800 tokens, with configured hard limits.
- Prefer heading, paragraph, list-item, and semantic-block boundaries.
- Carry the full ancestor heading path into every chunk.
- Never split a short list item, link label/target pair, note, or code line just
  to reach a target size.
- Oversized indivisible blocks split deterministically and record the parent
  coordinate plus exact normalized character spans.

### Tables and CSV

- Preserve the cell grid and logical row identities.
- Split on row windows; never split a logical row or cell.
- Repeat identified header rows in each rendered retrieval chunk while marking
  repeated headers as context, not duplicate source rows.
- Carry the exact logical row range. CSV does not claim physical byte or line
  coordinates unless a future parser directly supplies them.

### Presentations

- A slide is the primary boundary.
- Keep slide notes with their slide and retain slide number.
- Split an oversized slide only at typed block boundaries, retaining slide and
  block coordinates.

### Spreadsheets

- Chunk occupied regions by bounded row windows, repeating headers.
- Preserve sheet name and exact A1 ranges on every chunk and cell.
- Keep displayed values and formulas as separate facts.
- Do not use Anydoc output for spreadsheet-grade answers when those facts are
  unavailable.

### PDF

- Preserve physical page and parser block identity.
- Prefer layout block and heading boundaries.
- Any span refers to emitted normalized page content, never PDF source bytes.
- `pdfjs-dist` fallback chunks carry a downgrade diagnostic and must not claim
  layout roles it did not establish.

## Citation integrity

The auditable citation chain is:

```text
document SHA-256
  -> parser name/version and adapter version
  -> typed source coordinate
  -> normalized block and chunk hash
  -> exact quoted span
  -> answer claim
```

Each retrieved chunk exposes at least:

```ts
interface StoredEvidence {
  readonly documentSha256: string
  readonly parser: ParserIdentity
  readonly coordinate: SourceCoordinate
  readonly blockIds: readonly string[]
  readonly chunkId: string
  readonly normalizedContent: string
  readonly normalizedContentSha256: string
  readonly normalizationVersion: string
  readonly chunkerVersion: string
}
interface CitationInput {
  readonly chunkId: string
  readonly quote: string
  readonly span: { readonly start: number; readonly end: number }
}
type CitationResult =
  | { readonly ok: true; readonly evidence: StoredEvidence }
  | { readonly ok: false; readonly code: 'not-retrieved' | 'evidence-missing' | 'hash-mismatch' | 'span-invalid' | 'quote-mismatch' }
```

Spans are half-open `[start, end)` offsets in JavaScript UTF-16 code units over
the immutable `normalizedContent`; this matches `slice` and avoids ambiguous
byte/code-point conversion. The normalization version and SHA-256 make its
meaning stable.

Before accepting a citation, deterministic verification checks:

1. the cited chunk was supplied to the answering model;
2. `normalizedContent.slice(start, end) === quote` and the span is in bounds;
3. the normalized-content hash and block identities match stored evidence;
4. the coordinate belongs to the same document SHA-256 and parser identity;
5. the evidence row is the immutable row stored when that chunk was retrieved.

These checks reject invented IDs, altered quotations, stale-document citations,
and coordinates detached from their producer. They do not prove that evidence
supports a claim.

Normal verification is a lookup against retained `StoredEvidence`; it never
reparses per citation. Optional offline audits re-ingest fixture or retained
source bytes with retained lockfiles/native hashes and pinned parser artifacts,
then compare normalized hashes. If artifacts are unavailable, the audit is
`unreproducible`, not a citation failure.

Semantic evaluation separately measures:

- **entailment:** cited evidence supports the associated claim;
- **completeness:** externally verifiable claims have citations;
- **citation quality:** the most direct available evidence was cited;
- **contradiction:** cited or retrieved evidence conflicts with the claim.

A model or NLI scorer may assess these properties in offline evals, with human-
labeled examples and calibration. It is never the authority for source identity,
quotes, hashes, or coordinates. Scores are quality signals and regression gates,
not a mechanism for repairing provenance.

## Bounded evaluation

Build a small offline conformance suite under `packages/ingest/evals/anydoc/`.
It is a parser test harness, not a permanent routing-decision engine and not a
provider-backed Crux Eval.

Use generated or redistribution-safe fixtures with checked-in SHA-256 hashes:

- DOCX: headings, nested lists, links, notes, tables, images, malformed package;
- one representative DOC, DOCM, RTF, ODT, and EPUB document;
- PPTX plus one legacy presentation, containing slide order, notes, tables, and
  images;
- XLS/ODS as candidates for both readable extraction and coordinate retention;
- one PDF, CSV, and XLSX control showing the incumbent contract;
- one encrypted, truncated, mislabeled, expansion-heavy, and external-link case.

Admission uses exact structural assertions, never average or golden-Markdown
scores:

| Use case | Required facts on every valid fixture |
| --- | --- |
| Prose | all expected text in order; heading levels; list nesting; table grid; link targets; declared notes/assets; truthful coordinates |
| Presentation | prose facts plus slide identity/order/boundaries and slide-note ownership |
| Spreadsheet-grade | sheet identity/order; occupied ranges; every cell address/display value; formulas and merges where declared |
| CSV table | exact rectangular/ragged logical matrix, columns behavior, row bounds, and deterministic diagnostics |
| PDF page | physical page count/order/content, block coordinates, metadata, and explicit fallback warning |

A parser/format is admitted only with 100% required assertions, identical
normalized hashes across three cold and five warm runs, zero crashes/hangs,
zero undeclared partial extractions, all hostile cases failing with their
expected typed result, and successful package smoke tests on every production
target. Every run must remain below both hard containment and a rollout budget
of 50% of its memory/wall ceiling; otherwise the format is not admitted.

DOCX uses the same gates. If only one passes, it wins. If both pass, compare the
fixed candidate-value assertion count, then lower p95 wall time, then lower p95
peak memory, then fewer production dependencies, in that order. Exact ties keep
Mammoth. Record inputs/results and the deterministic winner in an ADR; do not
add dynamic routing. Model/NLI quality scores may reject a mechanically admitted
candidate after human review, but can never compensate for a failed required
fact, safety, determinism, or reliability gate.

## Worker isolation and memory safety

Anydoc runs in a fresh child process without a shell. Parsing is sequential by
default and tests run with one worker maximum. The parent streams source bytes
without base64 duplication, bounds IPC frames before allocation, observes the
whole process group, kills and reaps descendants on failure, and removes temp
files.

Process isolation improves crash cleanup but is not a security or memory
sandbox. Environment scrubbing and cooperative RSS sampling cannot stop native
allocation quickly enough to protect an OOM-prone host.

Production Anydoc routing therefore requires enforceable kernel containment.
The initial supported target is Linux with cgroup v2 `memory.max`, zero
`memory.swap.max`, `pids.max`, and CPU limits, created by a supervisor before starting
the worker; `RLIMIT_AS`/`RLIMIT_CPU` are defense in depth where supported, not a
replacement for the cgroup. The supervisor verifies controllers and effective
limits before accepting input. Any setup/verification failure returns
`containment-unavailable` and does not load Anydoc.

macOS and Windows production routing stays disabled until an implementation
plan names and tests an equally hard mechanism (for example a Windows Job
Object with process-tree memory limits). A plain child process, `ulimit`, RSS
polling, or timeout is insufficient. Local development on an unsupported host
may run explicitly marked eval fixtures with conservative limits and one worker,
but cannot enable production routing. CI must use the same verified Linux cgroup
supervisor as production; if its runner cannot delegate a bounded cgroup, the
native eval is skipped/fails as infrastructure according to job policy, never
reported as a containment pass.

Filesystem/network isolation is a separate host-owned capability:

```ts
interface SandboxCapability {
  readonly version: 1
  readonly verifiedBy: 'host-supervisor'
  readonly filesystem: { readonly read: 'input-only'; readonly write: 'private-temp-only' }
  readonly outboundNetwork: 'denied'
  readonly privilegeEscalation: 'denied'
}
```

The same host supervisor supplies this capability only after verifying its
container/sandbox policy; the Node child cannot mint or verify it. Production
routing requires both `SandboxCapability` and verified hard memory containment,
otherwise it returns `containment-unavailable` before loading Anydoc. The
initial supported posture is the Linux cgroup-v2 supervisor inside a sandbox
that enforces the declared mounts, network namespace/filter, and privileges.
Local unsupported-host evals are explicitly non-production. CI only records a
safety pass when the production-equivalent supervisor verifies both capabilities.

Non-bypassable initial ceilings are:

| Resource | Ceiling |
| --- | ---: |
| Source bytes | 32 MiB |
| Expanded/decoded bytes | 256 MiB |
| Wall / CPU time | 30 s / 20 s |
| Whole-process-group peak RSS | 512 MiB |
| Result payload | 8 MiB |
| stdout / stderr | 64 KiB each |
| Assets | 128 and 64 MiB total |

Fixtures may lower but never raise these ceilings. Expansion is counted before
allocation where possible. Breaches return closed typed errors such as
`source-too-large`, `expanded-too-large`, `timeout`, `memory-limit`,
`containment-unavailable`, `invalid-result`, or `worker-crash`.

Before rollout, lower the RSS ceiling from fixture evidence. A format does not
ship if typical files approach it or repeated isolated runs leak memory.

## TDD implementation plan

Implementation uses red-green-refactor slices and test commands use one worker.

### Phase 1: normalized model and provenance

1. Add failing type/runtime tests for every block and coordinate variant.
2. Introduce schema version 2 and migrate existing CSV, DOCX, XLSX, and PDF
   adapters.
3. Add failing XLSX tests proving cell addresses and A1 ranges survive through
   chunks and retrieval results; implement the fix.
4. Replace public loose provenance metadata with `StoredEvidence` and add
   compile-time exhaustiveness tests.

Acceptance: incumbent parser fixtures retain all current facts; XLSX citations
resolve to exact sheet ranges/cells; no provider package dependency enters core.

### Phase 2: evaluation harness and DOCX decision

1. Add fixture manifests and failing structural assertions.
2. Implement the one-process-at-a-time harness and resource accounting.
3. Add Anydoc as an exact-pinned development dependency and adapters for eval
   output only.
4. Run the representative suite, capture normalized evidence, and write the
   DOCX parser ADR.

Acceptance: deterministic runs, resource violations are typed, hostile fixtures
cannot escape isolation, and one DOCX primary is selected.

### Phase 3: production Anydoc worker and new formats

1. Add failing integration tests for worker protocol, limits, crashes, invalid
   output, and cleanup.
2. Promote the Anydoc adapter and worker with exact dependency/native hashes.
3. Enable only formats whose required structure and packaging tests pass.
4. Add explicit downgrade/unsupported diagnostics for all failure paths.

Acceptance: supported prose documents retain ordered structure; presentations
retain slide boundaries and notes; no spreadsheet-grade claim is made without
coordinates; parsing stays within measured limits.

### Phase 4: chunking and citation verification

1. Add red tests for each format's boundary and repeated-header rules.
2. Implement typed structure-aware chunkers and stable chunk identities.
3. Add red tampering tests for wrong document hashes, stale parser versions,
   altered spans, unprovided chunk IDs, and changed chunk contents.
4. Implement deterministic citation verification.
5. Add a small human-labeled entailment/completeness eval and regression gates.

Acceptance: mechanical citation tampering is always rejected; chunks resolve to
truthful typed coordinates; quality evals detect unsupported and uncited claims.

### Phase 5: rollout

1. Run package/build/typecheck/unit/integration tests with one worker.
2. Smoke-test installed-package native loading on each supported runtime target.
3. Document supported formats, fidelity levels, limits, and fallback warnings.
4. Add or update one Changesets entry for the public ingestion behavior and
   breaking provenance/type changes.

Acceptance: fresh-consumer installs work, observed memory remains comfortably
below production ceilings, and documentation never overstates location fidelity.

## Public package impact

- `@use-crux/ingest` gains qualifying loaders and normalized schema version 2.
- Core retrieval/chunk APIs gain `StoredEvidence`; ingest maps into it.
- Existing normalized document and provenance types may change incompatibly.
- Anydoc and its native package belong only in the package that owns the worker;
  they must not enter `@use-crux/core`.
- PDF, CSV, and XLSX production dependencies and ownership remain unchanged.

The implementation requires a Changesets entry because it changes published
runtime behavior and public types. The evaluation-only phase does not.

## Explicit cuts

This excludes universal routing/detection, permanent dual parsing, fuzzy/model
merging, exhaustive matrices, decision DSLs, Markdown or model identity oracles,
and treating document-level provenance as an exact location.
