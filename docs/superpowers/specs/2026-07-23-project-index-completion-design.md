# Project Index-aware semantic completion

Status: **approved for implementation planning**

Tracking: [#268](https://github.com/use-crux/crux/issues/268)

Related: [#242](https://github.com/use-crux/crux/issues/242),
[#266](https://github.com/use-crux/crux/issues/266)

## Problem

TypeScript can complete identifiers and imports from its type model, but it does
not know the authored-graph contract represented by the Crux Project Index. In
an `agent({ prompt: ... })` slot, Crux can distinguish prompt definitions from
unrelated values; in `tools`, routing, and injection slots it can make the same
kind-aware choice.

The existing LSP intentionally does not retain document text or parse unsaved
source. It shifts disk-derived ranges through `didChange`, while the Project
Index remains save-based. Correct completion is inherently an unsaved-buffer
feature, so it needs a narrowly bounded overlay without turning editor content
into a second index.

## Product contract

When the cursor is in a compiler-recognized first-party Crux dependency slot,
completion offers compatible authored definitions from the current project.
For example, `agent({ prompt: ... })` offers prompts, and tool maps offer tools.

A completion item:

- inserts an already accessible binding without another edit;
- adds or merges a named import for an importable cross-file definition;
- identifies the Crux kind, logical ID, description, and source file;
- never offers a definition whose compatibility or importability is ambiguous;
  and
- is ordered deterministically, with accessible and nearby definitions first.

The initial delivery covers first-party primitives only. It does not stabilize
a third-party Indexer Extension completion API.

## Decisions and rejected alternatives

The accepted architecture is a compiler-owned, bounded completion query over a
completion-only dirty-buffer overlay.

Rejected alternatives:

1. **LSP-side matching.** Regexes or a Go parser would duplicate compiler
   knowledge of call names, properties, aliases, and incomplete syntax.
2. **An LSP-owned TypeScript service.** A second compiler session would compete
   with the Project Index and behave differently in ATTACHED and OWN modes.
3. **Full dirty-buffer indexing.** Persisting an unsaved patch into the store or
   cache would change diagnostics and navigation semantics and pre-empt RFC
   #266.

This follows the normal language-server pattern of combining versioned editor
text with an on-demand compiler query. clangd is the closest analogue: a
transient current-file completion parse is combined with a project-wide symbol
index. Crux's distinct concern is routing that query through its existing
ATTACHED/OWN lifecycle.

## Architectural boundaries

The LSP owns protocol and open-document transport only. It retains text,
applies LSP edits, snapshots a request, and maps compiler results to LSP wire
types. It does not know that `prompt`, `tools`, `use`, or any specific primitive
has completion meaning.

The Project Index compiler owns slot recognition, compatibility, source/import
analysis, and completion-item edit recipes. First-party dependency declarations
are normalized into one internal, data-only completion-site manifest. The
Rust/Oxc tolerant frontend consumes that manifest; Go must not carry a duplicate
call-name/property table.

The Project Index read model remains the authoritative candidate catalogue.
Candidate filtering uses backend-neutral definition fields such as kind,
source, and compiler-proven export metadata. Raw TypeScript or TypeScript-Go
checker objects never cross the compiler boundary.

## Open-document overlay

The LSP retains text for supported open TypeScript/JavaScript documents:

- `didOpen` installs `{uri, languageId, version, text}`;
- ordered `didChange` events apply incremental UTF-16 ranges or a full-text
  replacement;
- regressive or invalid changes make the buffer unavailable until a full
  replacement/open rather than guessing;
- `didClose` immediately drops text; and
- workspace shutdown clears all buffers.

Text retention has explicit per-document and process-wide byte limits. The
initial defaults are 2 MiB per document and 32 MiB total. Exceeding a limit
disables Crux completion for that document and emits trace-only metadata, never
buffer content or a notification on every keystroke.

This overlay is completion-only. No other LSP provider may read it in this
delivery, and it cannot feed store apply, diagnostics, navigation, inlay hints,
code lenses, lint, or runtime generation.

## Query contract

`textDocument/completion` snapshots the current workspace source identity,
mode epoch, URI, language, document version, full text, and UTF-16 cursor. The
workspace routes one internal query:

- ATTACHED calls `POST /api/project/index/completions` on the discovered dev
  service;
- OWN calls the same service contract through the existing in-process client
  boundary.

The request is private local-runtime API, not a Project Index snapshot/delta
field. Conceptually it carries:

```json
{
  "file": "src/agent.ts",
  "documentVersion": 17,
  "languageId": "typescript",
  "text": "...",
  "position": { "line": 8, "character": 12 },
  "limit": 100
}
```

The service pins one coherent definition view and generation, invokes the
compiler query, and returns the input document version, generation,
`isIncomplete`, and completion items. It does not span a reindex.

Requests have a 250 ms hard deadline, honor `$/cancelRequest`, and use a bounded
latest-useful-work policy so abandoned keystrokes do not queue behind one
another. The warm persistent worker path has a representative-fixture p99 goal
of 150 ms; a process spawn per completion is prohibited.

## Compiler query

The Go-orchestrated Rust/Oxc frontend parses the smallest safe enclosing
statement/call context from the supplied buffer using its error-tolerant path.
It returns no result when the cursor cannot be classified safely.

The normalized completion-site manifest supplies:

- recognized first-party call identities;
- property/path and slot shape;
- accepted Project Definition kind or kinds; and
- insertion form for scalar identifiers, arrays, routing targets, and tool-map
  members.

The service passes a compact catalogue from the pinned Project Index view into
the query. The compiler excludes incompatible, already-present, privacy-
excluded, generated, ambiguous, and duplicate candidates.

The parse is explicitly cache-bypassing. It cannot write static or semantic
cache entries, participate in cache identity, emit patches, or change store
generation. A completion request that changes cache bytes or store state is a
correctness failure.

## Candidate and import rules

Candidates are eligible in this order:

1. a compiler-proven binding already accessible at the cursor;
2. a safe same-file binding whose declaration order and lexical scope permit
   use; or
3. a cross-file definition with a compiler-proven named top-level export.

Default-only, non-exported, shadowed, conflicting, or otherwise ambiguous
cross-file definitions are omitted. Same-file values that would introduce a
temporal-dead-zone access are omitted.

Import edits are computed from the same unsaved-buffer parse used for the slot.
The compiler:

- reuses an existing alias when the export is already imported;
- merges into a compatible named import when safe;
- otherwise inserts one relative, extensionless named import;
- avoids incompatible namespace, default-only, and type-only declarations;
- chooses a collision-free local binding or omits the candidate;
- preserves the buffer's dominant quote and semicolon style; and
- refuses an edit when the import region cannot be located safely.

If a cross-file candidate requires an import and no safe edit exists, the item
is omitted. Returning a binding that would knowingly leave the document broken
is not an acceptable fallback.

Completion items carry their originating document version and index generation
as opaque `data` for tracing and tests. Standard LSP completion edits do not
carry a version on the wire, so the server validates both values immediately
before returning and must not promise wire-level version rejection. After
delivery, the client owns atomic application of the main and additional edits.

## Ordering and result shape

Results rank by:

1. exact/prefix match against accessible binding, definition name, and ID;
2. already-accessible binding;
3. same file, then same directory;
4. remaining workspace definitions; and
5. stable file, line, column, kind, ID, and binding tie-breaks.

The response is capped at 100 items and sets `isIncomplete: true` when more
compatible candidates exist. The LSP advertises a minimal `:` trigger; normal
identifier typing and manual completion remain client-driven. Items are eager
and self-contained (`resolveProvider: false`) so editor support does not depend
on a second round trip.

## Coherence and handover

Completion has two independent identities:

- document version **V**, for the unsaved syntax and edits; and
- Project Index generation **G**, for the candidate catalogue.

The workspace also snapshots a monotonic mode/source epoch. Before returning,
the LSP verifies V, G, and the epoch are still current. Any document change,
reindex, ATTACHED/OWN transition, or source replacement returns an empty,
incomplete result. DISCOVERING and RECONNECT do the same. Completion never
blocks handover or retains a closing transport.

Generation pinning does not make unsaved source authoritative. It only proves
which coherent disk-derived catalogue the transient query used.

## Backend parity

Both JavaScript TypeScript and native semantic backends must expose identical
backend-neutral definition kind, source, and export metadata for supported
completion candidates. Existing parity fixtures expand to cover every
first-party kind admitted by the completion manifest.

Slot recognition belongs to the shared static syntax frontend and must not vary
with the selected semantic backend. Unsupported syntax returns no Crux items
rather than a native-only partial answer.

## Security and privacy

Restricted Mode remains fully inert. Bare clients without a trusted-workspace
signal receive no completion query. ATTACHED HTTP inherits the dev server's
existing loopback/non-loopback authentication behavior; the endpoint never
creates a weaker bypass.

Unsaved buffer text may contain secrets that have never existed on disk. It is
never logged, persisted, included in traces, attached to errors, or written to
workflow artifacts. Logs may contain only bounded metadata such as URI hash,
byte count, duration, outcome, V, and G.

The query reuses Project Index privacy, source eligibility, and generated-file
exclusions. It never loads configuration or executes project code as part of a
completion request.

## Failure behavior

Cancellation, timeout, invalid syntax, stale identity, unavailable workers,
mode transitions, unsafe import edits, and size limits all fail soft with an
empty or reduced completion list. They do not show user-facing errors while the
user types. Trace mode records a structured reason without source text.

Repeated worker failures may surface one rate-limited warning and otherwise
leave TypeScript's native completion intact.

## Testing

- Protocol tests pin completion capabilities, request/response mapping,
  cancellation, and deterministic LSP items.
- Buffer tests cover ordered incremental UTF-16 edits, astral characters, full
  replacements, invalid/regressive versions, limits, close, and shutdown.
- Compiler fixtures cover each scalar, array, routing, and tool-map slot,
  aliases, incomplete syntax, unsupported positions, and every admitted kind.
- Import fixtures cover existing named/aliased/default/namespace/type-only
  imports, quote/semicolon styles, binding collisions, TDZ, unsafe regions, and
  non-exported definitions.
- Parity fixtures prove identical candidate/export facts for JavaScript and
  native semantic backends.
- Invariant tests snapshot cache files and store generation before and after a
  dirty completion request and prove byte-for-byte non-mutation.
- Lifecycle tests race completion with `didChange`, reindex, cancellation,
  ATTACHED→OWN, OWN→ATTACHED, RECONNECT, and shutdown.
- Benchmarks enforce the warm p99 goal and prove no worker process spawn per
  request.
- End-to-end tests cover OWN and ATTACHED completion plus import insertion with
  the real binary; a manual Cursor walkthrough verifies merged completion UX.
- Final Go tests run with `-race`.

## Cache, API, and release impact

This adds an internal HTTP query route and new LSP methods/types, but does not
change Project Index snapshot/delta payloads or saved-source compiler output.
No Project Index cache epoch changes are required. A red invariant test guards
that conclusion.

The behavior is public CLI/LSP functionality, so implementation updates the
relevant pending changeset after inspecting the existing release queue. The LSP
reference and extension README document supported slots, save-based index
semantics, trust requirements, and the completion-only overlay boundary.
