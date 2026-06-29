---
'@use-crux/core': patch
---

Reorganize `@use-crux/core` into package-root domain folders (`prompt/`, `resolver/`, `runtime/`, `generation/`, `tools/`, `shared/`) and split the largest single-file domains into curated barrels plus focused implementation files. The root `types.ts` mega file was drained into the owning domains and reduced to the dependency-free base contracts (`AnyModel`/`AnyToolSet`/`AnyMessage`, `FlowToolDef`, `ModelInfo`).

This is an internal restructuring only: the public `@use-crux/core` API, every package subpath (including `./tools` and `./tool-middleware`), and `package.json` exports/`typesVersions` are unchanged. No import paths change for consumers.

Deepen agent composition internals behind a shared composition runtime that owns composition ids, canonical composition spans, child execution contexts, retry wrapping, and report artifacts for `parallel`, `pipeline`, `consensus`, and `swarm`. Public composition factories are unchanged; consensus observability now reports voter agent spans directly under the consensus composition instead of adding a nested parallel composition span.
