# @use-crux/mcp

## 0.8.0

### Patch Changes

- Updated dependencies [02d7a23]
- Updated dependencies [d230918]
- Updated dependencies [7c3a5ae]
- Updated dependencies [7c3eaba]
- Updated dependencies [cc78bd5]
- Updated dependencies [a0ed87c]
- Updated dependencies [9418f19]
- Updated dependencies [91f7885]
- Updated dependencies [c090b22]
- Updated dependencies [ce9c409]
- Updated dependencies [226aa70]
- Updated dependencies [5d33890]
- Updated dependencies [d172b05]
- Updated dependencies [b9672b3]
- Updated dependencies [9f9b459]
- Updated dependencies [8d5c9d3]
- Updated dependencies [87c7958]
- Updated dependencies [e13389e]
  - @use-crux/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [70a8520]
- Updated dependencies [69564b7]
- Updated dependencies [be06e40]
- Updated dependencies [3140e0b]
- Updated dependencies [d5d37bf]
- Updated dependencies [42419b1]
- Updated dependencies [0e52c7d]
- Updated dependencies [2b50f9d]
- Updated dependencies [f5c5da3]
  - @use-crux/core@0.7.0

## 0.6.0

### Minor Changes

- e24f46c: Add portable MCP tool sources over Streamable HTTP and stdio. MCP tools now
  materialize lazily across every first-party generation adapter and retain the
  ordinary Crux middleware, Safety, approval, Eval, observability, and
  cleanup contracts.

  Project Index and Devtools now connect authored MCP servers with
  runtime-discovered tools, safe schemas and fingerprints, health and lifecycle state,
  Run Detail preparation evidence, and exact Catalog activity. The new
  `@use-crux/mcp` package owns both supported client paths and keeps MCP optional
  for Core and adapter installations.

  The release also validates widened runtime transport and selection values at
  the public boundary, keeps opaque dependency failures out of errors and
  evidence, preserves every accepted portable tool name, closes materialized
  sessions when lifecycle preparation fails, and bounds Project Index runtime
  delivery and ingestion.

### Patch Changes

- efbed7f: Replace the pre-release Quality authoring, execution, CLI, storage, and
  Devtools model with Crux Evals V1. Applications now bind ordinary callable
  production tasks with `generate.task()` or `stream.task()`, define inert typed
  Cases and Variants through `@use-crux/core/eval`, run them with `crux eval`,
  reuse exact safe evidence automatically, and explicitly accept complete Eval
  run arms as Baselines. The old `@use-crux/core/quality` exports and
  `crux quality` commands are removed without compatibility aliases.

  Add `stableModel()` to attest a standard or custom AI SDK model's secret-free
  versioned identity for safe automatic Eval reuse. Unattested model objects keep
  working fresh and receive one actionable CLI and Devtools remedy.

  Reuse function-form prompt, system, and message renderers through their tracked
  literal-ESM source closure and an exact one-way fingerprint captured from the
  real normalized generate/stream request. The comparison projects only fields
  that can affect the provider request, excluding per-resolution observability
  IDs while retaining Context text and cache boundaries. Evidence candidates are locally
  re-rendered before reuse; mismatches execute fresh with actionable
  `nondeterministic_renderer` CLI and Devtools guidance, and raw prompt material
  never crosses the evidence boundary. Unresolved source dependencies remain
  fresh.

  Fingerprint callback-free Crux router, split, retry, fallback, and cascade
  trees by recursively projecting attested model leaves and structural options,
  then include the resolved model target in observed identity. `stableModel()`
  rejects whole route trees. Static contexts, inline skills, and schema-only
  tools can reuse exact evidence; dynamic context renderers/selectors, executable tools,
  function-produced tools, memoized or effectful context families execute fresh.
  Route-tree evidence remains fresh when its resolved target was not covered at
  planning.

  Fail closed for inline managed-task bindings and callback-bearing Variant
  prompt overrides, report the distinct `task_binding_untracked` remedy, and
  derive deployed Variant fingerprints from adapter semantic projections so
  schema-backed prompt changes cannot collide. Fingerprint Current and imported
  replacement task bindings independently so an unrelated candidate edit does
  not invalidate Current evidence.

  Add Runtime-hosted Eval execution with generated identity-only registries,
  strict offline and pre-spend planning, Node/serverless/Convex conformance, and
  the first-party `@use-crux/cloudflare` Durable Object host. Explicit fresh
  executions use a new durable admission identity while retries reconnect to the
  same admitted action. Strict offline runs load the generated data-only privacy
  policy without importing Runtime code or touching the network, and fail closed
  when that projection is missing or stale. Add awaited
  run-linked feedback through `@use-crux/core/feedback` and AI message metadata
  through `@use-crux/ai/feedback`, plus durable Review and explicit Add-to-eval
  workflows in Crux Local and Devtools.

  Add first-class Eval catalog and run views to Devtools, including same-origin
  run triggering, exact run comparisons, Baseline promotion, Eval search, reuse
  and invalidation reasons, cost and score evidence, feedback, and Review links.
  Keep the CLI coordinator protocol bounded by sending diagnostic run summaries
  instead of duplicating stored inputs and outputs over NDJSON.

  Keep durable result writes type-safe and bounded: reject non-JSON media before
  redaction, preserve supported structured values exactly, and omit oversized
  provider response envelopes from the stored run while retaining their linked
  trace references. Align privacy-policy fingerprints across TypeScript and Go,
  including HTML-sensitive keys and JavaScript UTF-16 key ordering.

  Make `--max-cost` fail closed on conservative per-call USD ceilings. Managed AI
  tasks, routing trees, bounded tool loops, and judges estimate from
  `experimental.eval.pricing`; unknown paths report missing model keys and an
  actionable remedy before any billable work.

- Updated dependencies [efbed7f]
- Updated dependencies [fac9733]
- Updated dependencies [aa067eb]
- Updated dependencies [b22f00a]
- Updated dependencies [e24f46c]
- Updated dependencies [fa12d14]
- Updated dependencies [048b397]
- Updated dependencies [692e538]
- Updated dependencies [d943c41]
- Updated dependencies [4d51ecf]
- Updated dependencies [ed6626b]
- Updated dependencies [21bba63]
  - @use-crux/core@0.6.0
