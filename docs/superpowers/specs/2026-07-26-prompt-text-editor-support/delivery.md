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
  preview.rs
  limits.rs

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
  preview.ts
  commands.ts
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
- canonical fragment-catalogue digest order invariance, field sensitivity,
  duplicate rejection, empty identity, and coordinator-cache separation from
  #266 source-profile identity;
- aggregate canonical fragment-byte equality/overflow/zero boundaries and
  known-length plus chunked ATTACHED request-body rejection;
- identical TypeScript tokens and interpolation provider results with
  decorations enabled and disabled;
- folding, symbols, links, navigation, and hover;
- preview golden parity, placeholders, fragments, and truncation;
- diagnostic type inference, evidence schemas, actions, and stale edits;
- ATTACHED and OWN end-to-end behavior;
- byte-for-byte cache/store non-mutation; and
- final Go tests under the race detector.

The decoration spike includes a documented manual theme matrix where rendered
legibility cannot be asserted reliably through extension APIs.

## Cache and release impact

The transient query does not alter saved static output, so it does not require
`STATIC_PARSE_CACHE_EPOCH`.

Saved semantic evidence requires:

- `SEMANTIC_FACTS_CACHE_EPOCH` to advance;
- `ProjectIndexSnapshotCacheEpoch` to advance;
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
