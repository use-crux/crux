# Indexer Terminology And Package Rename

Status: Accepted
Date: 2026-06-08

Crux will use **Indexer** as the public system name and **Project Index** as the output/read-model
name. The current `@use-crux/indexer` package and Project Index naming predate the broader
compiler role: the system now models authored Crux definitions, relations, diagnostics, lint
findings, source evidence, semantic facts, and incremental graph evidence rather than only source
files.

**Decision**

Rename the public package to `@use-crux/indexer` before launch. Rename public-facing Index types and
functions to Index terminology in the same compatibility-breaking slice:

- `ProjectIndexSnapshot` -> `ProjectIndexSnapshot`
- `ProjectIndexCompiler` -> `ProjectIndexCompiler`
- `IndexExtractor` -> `IndexExtractor`
- `IndexRule` -> `IndexRule`
- `IndexRuleMeta` -> `IndexRuleMeta`
- `IndexDiagnostic` -> `IndexDiagnostic`
- `IndexLintFinding` -> `IndexLintFinding`
- `IndexPatch` -> `IndexPatch`
- `compileProjectIndex` -> `compileProjectIndex`

Use **Crux Indexer** as the public system name, **Project Index** as the artifact/read model, and
**Project Index Compiler** as the internal compiler engine. Keep **compiler** as architecture
language for phases, passes, diagnostics, caches, and emitters, but do not make compiler internals
the public extension-author product concept.

**Consequences**

The rename must scan all Crux packages, not only this package. Current index/indexer naming
appears in core public contracts, devtools workers, CLI embeds, docs, snapshots, patch payloads,
cache files, and tests.

Because this is pre-launch, serialized snapshot, patch, and cache terminology should be renamed
cleanly with schema/cache version bumps rather than long-term compatibility aliases. A temporary
first-party adapter is acceptable only if an internal integration needs a short transition.

Public docs should present `@use-crux/indexer`, `@use-crux/indexer/extensions`,
`@use-crux/indexer/testing`, and `@use-crux/indexer/source-resolver`. The current `@use-crux/indexer`
name remains an implementation detail only until the rename slice lands.
