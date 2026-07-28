# PromptText editor delivery

Parent: [PromptText editor support](../2026-07-26-prompt-text-editor-support-design.md)

## Maintainable layout

Prefer nested domains with short filenames over repeated prefixes:

```text
crates/syntax-oxc/src/prompt_text/
  mod.rs
  candidates.rs
  projection.rs
  interpolation.rs
  mapping.rs

crates/static-compiler/src/prompt_text/
  mod.rs
  markdown.rs
  structure.rs
  limits.rs
  preview/
    mod.rs
    composition.rs
    fragments.rs
    json.rs
    segments.rs
    value.rs

packages/local/internal/projectindex/prompttext/
  types.go
  service.go
  fragments.go
  limits.go

packages/local/internal/lsp/transient/
  source.go
  coordinator.go
  revision.go

packages/local/internal/lsp/view/
  types.go
  provider.go
  selection.go

packages/local/internal/lsp/prompttext/
  controller.go
  analysis.go
  decorations.go
  folding.go
  symbols.go
  links.go
  preview.go
  diagnostics.go
  actions.go
  navigation.go

packages/vscode/src/prompt-text/
  contracts.ts
  controller.ts
  types.ts
  commands.ts
  preview/
    controller.ts
    provider.ts
    wire.ts
    range.ts
    metadata.ts
    types.ts
```

The server package composes the focused PromptText controller through explicit
ports. The controller must not depend on server internals.

Do not enlarge `packages/core/src/project-index/index.ts`. Put new evidence
types and schemas in `project-index/diagnostic-evidence.ts`, then re-export
them. Do not enlarge VS Code `extension.ts`; activation only composes
controllers. New tests stay focused instead of extending existing 300+ line
suites.

## Type and documentation quality

Use discriminated unions, `unknown`, readonly data, exhaustive records, and
literal-preserving inference. Avoid `any`, assertions, recursive type tricks,
and conditional types whose complexity is not buying caller safety.

Every exported TypeScript boundary receives library-grade JSDoc:

- purpose and ownership first;
- lifecycle, cancellation, and safety constraints;
- coordinate units and range semantics;
- `@param` and `@returns` for functions; and
- focused `@example` blocks for meaningful entry points.

The standard is the behavior-first style used by Crux adapter APIs, Next.js,
and AI SDK. Do not narrate obvious implementation details.

## TDD sequence

Use one behavior per red-green cycle:

1. mapped-decoration feasibility spike;
2. exact saved view selection and source-row retention;
3. one canonical heading decoration end to end;
4. interpolation and identity fail-closed cases;
5. folding, then symbol, then literal link from shared structure;
6. static preview literals, values, placeholders, fragments, and truncation;
7. each semantic diagnostic and allowed action;
8. owner/fragment navigation, hover, and byte-preserving refactor;
9. exact-preview and latest-Run Devtools routing; and
10. parity, migration, privacy, load, race, and real-binary hardening.

This is an order of vertical slices, not permission to write every test before
implementation.

## Test matrix

A shared conformance fixture feeds one TypeScript source through Rust, verifies
all Go-derived views, and verifies VS Code role mapping.

Architecture tests reject:

- independent Markdown parsing in Go or VS Code;
- another TypeScript service;
- competing semantic-token or broad grammar providers;
- source or dirty facts entering cache/store paths; and
- files that collapse unrelated concerns into one large module.

Focused tests cover:

- projection mappings, barriers, malformed syntax, CRLF, and Unicode;
- cooked-versus-raw escapes, Core construction-normalization parity, segmented
  endpoint mappings, and invalid cooked quasis that fail closed;
- valid surrogate-pair and genuine U+FFFD mappings, plus candidate-local
  unsupported results for every unpaired cooked surrogate;
- Markdown block/inline structure and interpolation isolation;
- direct, alias, namespace, re-export, shadowed, unrelated, and unresolved
  identity;
- view selection across edit, return-to-saved, save, close, generation,
  cancellation, handover, and reconnect;
- decorations across supported themes and semantic-highlighting modes;
- the dedicated window-scoped decoration switch, immediate cancellation and
  clearing, and zero decoration-type replacement across theme changes;
- canonical preview-evidence digest order invariance, every-field sensitivity,
  duplicate/dangling/range/proof rejection, empty identity, and
  coordinator-cache separation from #266 source-profile identity;
- aggregate canonical fragment-plus-join byte equality/overflow/zero
  boundaries, `maxFragmentJoins`, and known-length plus chunked ATTACHED
  request-body rejection;
- identical TypeScript tokens and interpolation provider results with
  decorations enabled and disabled;
- folding, symbols, links, navigation, and hover;
- Rust-owned heading-label normalization across decoded text/entities/escapes,
  code, links, image alt text, inline HTML, breaks, Unicode whitespace, and
  empty-heading fallback;
- the amended V1 golden, required Rust/Go heading-label fields and accessors,
  OWN/ATTACHED parity, and finalized-template output-byte boundaries;
- document links using Rust `textRange`, eager final targets, and
  `resolveProvider: false`;
- HTTP(S) host/userinfo/port/query/fragment policy plus rejection of opaque,
  protocol-relative, email, file, command, script, data, and unknown targets;
- exactly-once percent decoding, raw/encoded separator and control rejection,
  local fragment/query behavior, literal and encoded dot segments, lexical
  scope containment, and nonexistent targets without filesystem/network I/O;
- stale/cancelled link suppression and one shared-analysis identity across
  decorations, folding, symbols, and links;
- preview ABI/golden parity, syntax-versus-semantic proof ownership, saved-join
  withholding on dirty bytes, exact placeholders, JavaScript number/JSON
  rendering, arrays/seams/fragments/cycles, whole-segment byte truncation,
  reconstruction, and structural-status independence;
- owning-source-ref `named-fragment` evidence parity across both semantic
  backends, snapshot retention/migration, and stale semantic/snapshot cache
  misses after the required epoch bumps;
- strict static-preview request/result unions; position/choice/exact-range
  selection; ordinal-independent slot reuse; range-less position failures
  preserving every retained slot; exact-key and generation-associated failures
  clearing only their slot; immediate clear plus 150 ms refresh; EOL
  compatibility/equality rejection; content-only virtual documents; CodeLens
  metadata; URI/title privacy; source/reconnect lifecycle; and 16-resource
  capacity including split editors;
- recursively strict PromptText evidence schemas, canonical runtime-kind
  ordering, invalid optional-field combinations, and permissive outer
  `IndexDiagnostic` compatibility;
- diagnostic type inference across aliases, enums, intersections, never,
  uncertainty, exact literals, objects, PromptText identity, mutable/readonly
  sequences, tuples, optional/rest/generic/recursive shapes, and unions;
- exact nested required tuple paths, cause precedence, comma-join proof,
  whole-expression `mdJsonApplicable`, and canonical `.json()` accepted/
  rejected call shapes;
- deterministic diagnostic IDs, exact error projection/messages/source points,
  prohibited-word scanning, source-ref ambiguity/lifecycle/nesting joins, and
  one conclusion per owner/interpolation;
- JavaScript/native byte-equivalent normalized conclusions, stale semantic
  cache misses, evidence retention, actions, and stale edits;
- V3 fact-group presence for omitted, empty, and populated array groups;
- canonical all-group ordering; exact singleton cardinality and `factCount`;
- rejection of null, non-array, unknown, duplicate, out-of-order, undeclared,
  or envelope-inconsistent presence claims without partial phase state;
- legacy V3 omission behavior, old/new TypeScript and Go goldens, and Go
  nil-versus-nonnil-empty reconstruction;
- lint and PromptText lane isolation, ordered complete replacements, and proof
  that transient work never runs under the lint publisher lock;
- synchronous PromptText clears for every invalidation, change-to-saved
  recovery, save/reindex gaps, source loss/gain, and close;
- exact revision, source-epoch, generation, and complete-view stamp rejection
  for every stale or cancelled diagnostic result;
- required open-document diagnostic versions, post-save version retention,
  closed-document version omission, and capability-gated PromptText output;
- exact expression ranges, strict minimal diagnostic data, and absence of
  semantic evidence on the LSP wire;
- request-time action regeneration, range/ID matching, final stamp rechecks,
  and suppression for closed, changed, unavailable, or cancelled requests;
- one versioned `TextDocumentEdit` containing one edit, with no legacy
  `changes`, resolve handler, resource operations, or annotations;
- exact action titles/order, no JSON-serialization action, and race tests
  proving clears and version guards cannot be overtaken;
- ATTACHED and OWN end-to-end behavior;
- byte-for-byte cache/store non-mutation; and
- final Go tests under the race detector.

The decoration spike includes a documented manual theme matrix where rendered
legibility cannot be asserted reliably through extension APIs.

## Cache and release impact

The transient query does not alter saved static output, so it does not require
`STATIC_PARSE_CACHE_EPOCH`.

Saved semantic evidence requires:

- Phase 10 to advance `SEMANTIC_FACTS_CACHE_EPOCH` when JavaScript conclusions
  begin changing saved semantic output;
- Phase 11 to advance `ProjectIndexSnapshotCacheEpoch` when the Go snapshot
  begins retaining the evidence;
- JavaScript/native semantic parity fixtures; and
- migration tests proving old snapshots cannot hide missing evidence.

Implementation changes public Project Index data and `crux lsp` behavior.
Inspect pending changesets first and extend the relevant release theme rather
than creating a duplicate.

## Documentation

Update:

- LSP reference and command documentation;
- PromptText reference and preview safety model;
- VS Code README and settings;
- saved-versus-current identity behavior;
- exact preview and Runtime Bridge availability;
- supported diagnostics and blocked #276/#277 behavior; and
- the later #266 live-semantic upgrade boundary.
