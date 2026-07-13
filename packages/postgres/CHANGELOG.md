# @use-crux/postgres

## 0.5.0

### Minor Changes

- 0c3ba08: Add request-scoped `defer(callback)` with bounded host-lifetime execution, the
  explicit `@use-crux/core/defer/node` HTTP integration, and Runtime-backed named
  target staging through `await defer(target, input)`. Postgres and Convex Runtime
  stores now persist named deferred intents and recover their release through the
  existing transactional outbox. Public `defer()` is rejected during replayable
  flow execution, and the Runtime snapshot field for replay-visible child work is
  hard-renamed from `scheduledEffects` to `scheduledWork` with no compatibility
  field or read path.
  Inline callbacks now isolate nested named commits per callback and report late
  commit failures without stopping sibling cleanup.
  Project Index now discovers public inline and named scheduling sites as stable
  `deferred-work` definitions, resolves their task and enclosing-definition
  relations, and reports replay-unsafe, floating-promise, missing-scope, and
  explicitly missing-Runtime diagnostics.
  Public deferred work emits `defer.scheduled` and `defer.run` observability
  spans with causal `triggered` edges, one lightweight grouped run when no
  originating Crux run exists, and quiet diagnostics-only internal composition.
  Inline retained tasks flush only after their full graph closes. Named wakes use
  fresh same-trace runs and segments with a causal edge, then flush only after the
  durable outcome commits.
  Devtools Catalog and Runs surface deferred-work kinds, lifecycle states, and
  honest handler-returned streaming notes.
  Provider-neutral serverless hosts live at `@use-crux/core/defer/serverless`
  (injected `waitUntil` / `after` / named-only). `@use-crux/next` binds Next.js
  `after()` as response-finished. Convex bridge runs install a named-only lifetime
  so inline callbacks fail with `DEFER_CAPABILITY_MISSING` while named Runtime work
  remains supported.
  Docs cover host reliability boundaries, completion classes, strict named commit,
  at-least-once edges, cancellation limits, and the distinction from
  `flow.defer()` / future Effects.

  The defer setup contributor now participates in `crux setup`, reporting host
  integration and named Runtime durability readiness without redefining the
  shared `@use-crux/core/setup` contract.
  Deferred intent stores now preserve the first terminal state across memory,
  Postgres, and Convex, and setup distinguishes inline host wrapping from literal
  named-work `durableFinalization: true` capability.

- 74f27bf: Promote `@use-crux/core/runtime` and its store-adapter contract to stable beta while Crux remains pre-1.0.

  Remove unused Runtime Engine dead port exports, validate `crux.flows.signal()` against the durable flow snapshot before emitting, warn once when a durable target name is re-registered with a different definition, and make production `createRuntimeHandler()` fail closed unless wake request verification is configured explicitly or supplied by the wake adapter.

  Embed delivered event payloads in runtime flow snapshots so flow replay no longer scans the event log after delivery. Store adapters must persist the `payload` field passed to `state.markSnapshotDelivered()`.

  Add Runtime Engine retention config and bounded maintenance pruning for events, terminal work, terminal snapshots, confirmed outbox rows, idempotency keys, settled timers, and settled waiters. The memory, Postgres, and Convex runtime stores implement the new prune contract and conformance coverage.

  Fence Runtime Engine wake commits with lease tokens and heartbeat leases while target code runs. Stale workers now exit cleanly with `LEASE_LOST` instead of retrying, dead-lettering, or overwriting a reclaimed worker's result.

  Add named Runtime Engine composite commits and the optional store-adapter `runComposite(kind, input)` override. Core keeps the default `transact()` runner, and the Convex runtime component now routes composites through one mutation for atomic host-bound commits.

  Run the shared composite conformance cases against Convex's component-backed `runComposite` path, and encode composite Date payloads with Convex-valid object keys.

  Use Convex-compatible filenames for internal Runtime Engine component modules so Convex codegen and deployment can discover them.

  Make `config()` lifecycle-safe by installing one hook layer per active config, replacing the previous active config on repeat calls, and keeping independent layers such as imperative devtools intact when a config is disposed.

  Hard-rename the global hook-store API from the runtime family to the hooks family: `CruxHooks`, `getHooks()`, `setHooks()`, `updateHooks()`, `resetHooks()`, and `mergeHooks()`. The old hook-store names are removed with no deprecated aliases so Runtime Engine terminology can stay unambiguous.

  Rename the Runtime Engine task target factory from `task()` to `durableTask()` and remove the dead task output generic. Project Index runtime target discovery and lint guidance now recognize `durableTask()` declarations. Remove `createConvexRuntimeBridge` from the public `@use-crux/convex` root and package subpath; use `createCruxConvex().run()`, `.storage()`, and `.bridge()` as the single Convex entry point.

  Add `createTestRuntime()` on `@use-crux/core/runtime/testing` for app-level Runtime Engine tests. The harness installs an in-memory runtime hook layer, provides a controllable clock for `flow.after()` and suspend timeouts, and exposes bounded `tick()`/`settle()` helpers without real timers.

  Runtime Engine store adapters now honor the runtime clock when pending work is requeued, keeping `createTestRuntime()` timers deterministic even when the injected clock differs from wall time.

  Bound Runtime Engine outbox dispatch to eight concurrent deliveries by default, add `RuntimeOutboxPort.listByWork()` for targeted orphan recovery, remove shared-counter event append hot spots and the unused `runtimeCounters` table from the Convex runtime component, require namespaces for maintenance scans, and remove `eval.run` plus stale bridge manifest fields from the runtime bridge command contract. Orphan requeue now treats any same-namespace pending wake for the work id as live, even when its idempotency key was refreshed.

  Disable Runtime Engine lease heartbeat timers for Convex host bindings while preserving lease fencing, and make the default heartbeat scheduler a no-op when timer APIs are unavailable.

  Remove unused exported idempotency helpers `flowSignalResumeKey()` and `watchDeliverKey()` from `@use-crux/core/runtime`.

### Patch Changes

- Updated dependencies [fd6edcc]
- Updated dependencies [37ebe22]
- Updated dependencies [cd3e235]
- Updated dependencies [0c3ba08]
- Updated dependencies [64a716b]
- Updated dependencies [74f27bf]
- Updated dependencies [2ab4bd9]
- Updated dependencies [58edfa9]
- Updated dependencies [089ba6f]
- Updated dependencies [aa37b64]
  - @use-crux/core@0.5.0

## 0.4.0

### Minor Changes

- 4b29d0c: Add the `@use-crux/core/runtime` subpath with Runtime Engine port contracts, typed runtime diagnostics, wake envelope validation, retry helpers, the pure work state-machine surface, kernel composite operations, outbox dispatch, the in-memory runtime store, and the `@use-crux/core/runtime/testing` conformance suites for adapter authors.

  Add the first Runtime Engine composer surface: `node()` for in-process local/test execution, `createRuntime()` for resolving composers with targets, store-backed timers and maintenance, cancellation, scoped-idle counters, and the standard `RUNTIME_REQUIRED` diagnostic factory.

  Wire existing flow handles into the Runtime Engine: runtime-backed `flow.suspend()` snapshots, reserved signal events with automatic resume from `FlowHandle.signal()`, `{ resume: false }` plus runtime-backed `FlowHandle.resume(flowId)`, replay fingerprint drift blocking, and delivery recording for multiple waiter events that arrive before replay.

  Add the flow runtime API layer: runtime-only executable `task()` targets from `@use-crux/core/runtime`, `flow.waitFor()`, barrier-buffered `flow.defer()` and `flow.after()` durable effects, scoped `flow.untilIdle()`, and name-bound `crux.flows.signal/resume/cancel`.

  Add `@use-crux/postgres/runtime` with a durable Postgres Runtime Engine store adapter, additive setup check/apply support for the Crux-owned schema, and real-Postgres conformance coverage gated by `CRUX_TEST_DATABASE_URL`.

  Add the HTTP wake layer for serverless Runtime Engine deployments: `createRuntimeHandler({ targets })`, `serverless({ store, wake })`, `genericQueue()`, and `@use-crux/upstash/runtime` `qstash()` wake delivery with QStash signature verification.

  Add host-bound Runtime Engine declarations and Convex runtime entry helpers: `RuntimeEngineDefinition` now distinguishes in-process and host-bound runtimes, `bindHostRuntime()` composes host bindings through the shared kernel path, `RUNTIME_HOST_ONLY` reports runtime use outside a required host, and `@use-crux/convex/runtime` exposes `convex()` plus `createConvexRuntimeHandlers()`.

  Add Runtime Engine artifact generation: the indexer can discover runtime flow/task targets, emit deterministic `.crux/generated/runtime/manifest.json` plus readable Next and Convex entry files, expose drift preflight helpers, and `withCrux()` can regenerate artifacts during Next builds.

  Add Runtime Engine operator tooling: `crux runtime setup`, `status`, `inspect`, `retry`, and `cancel` now route through the local worker, use typed runtime diagnostics, support JSON output, and preflight generated artifacts against durable runtime state.

  Harden Runtime Engine delivery and adapter parity: scheduled wake rows now honor `notBefore`/retry delays end-to-end, runtime-backed flows preserve object-bound replay semantics for errors, cancellation, resume options, and repeated suspend labels, Convex handler/component boundaries validate and encode runtime payloads consistently, and cross-adapter conformance now covers retry source-status guards, waiter matching, and idle-counter invariants.

  Tighten runtime artifact and handler DX: generated entry files are host-specific and marker-protected, target exports are validated before manifest generation, `withCrux()` runs during Next config evaluation for Webpack and Turbopack, unresolved name-only handler targets now fail with `TARGET_NOT_FOUND`, and malformed wake envelopes return terminal client responses instead of queue poison loops.

  Add Project Index runtime lint rules for durable target identity, exported targets, runtime API use without configured runtime support, closure-based defers, nondeterministic flow bodies, and non-serializable deferred payloads, with docs metadata and native lint parity.

  Expose bounded Runtime Engine inspection reads for work, timers, and outbox state so local tooling can show runtime status details without mutating durable state.

  Move the Postgres adapter's `pg` client to a caller-controlled peer dependency while retaining it as a repo dev dependency for tests, and refresh the package homepage to a live source URL.

  Add the Runtime Engine documentation set: core runtime reference, runtime deployment guides, recipe-only adapter mappings, package references for Postgres/QStash/Convex runtime surfaces, runtime lint navigation, and per-code Runtime Engine error pages.

  Fix final Runtime Engine hardening gaps: wake delivery now rechecks leased work before execution, null waiter payloads replay correctly, manual resume/retry keys are unique per invocation, runtime status counts use adapter-owned counting instead of silently truncated list samples, Postgres setup checks validate required columns, Convex component status queries avoid unindexed full-table scans, runtime artifact host detection no longer guesses from raw config text, and `runtime.missing_runtime_config` now runs in production Project Index lint paths without claiming native parity.

  Close follow-up Runtime Engine review gaps: Project Index snapshots now cache runtime-config presence for linting, destructured flow-scope runtime APIs retain TypeScript/Rust parity, manual resume/retry keys include an isolate nonce, delayed wake rows dedupe duplicate `notBefore` reschedules, Convex status counts stay under a bounded read budget, Convex outbox confirmation retains rows like other adapters, and Postgres setup column checks are covered by DDL parity tests.

  Finish the review-tail hardening: outbox duplicate suppression no longer hides legitimate re-enqueues while a row is being dispatched, maintenance re-enqueues orphaned pending work, config-load failures no longer produce false missing-runtime lint findings, status count truncation is surfaced in CLI and devtools, and runtime artifact preflight now uses the worker-owned stale-target result instead of duplicating status rules in the CLI.

  Complete native Project Index parity for runtime task targets and missing-runtime linting so the Rust/Oxc production path matches the TypeScript baseline.

  Fix npm release staging so exported package subpaths, including `@use-crux/core/runtime`, are typechecked through their declared public entry files.

  Make the public Runtime Engine barrels isolate-safe for Convex and edge-style bundlers by moving custom wake HMAC signing/verification to WebCrypto, run the Convex runtime store through the shared adapter conformance suite with declared substrate-atomic exclusions, and keep caller-provided Convex event IDs from colliding with internal event cursors.

  Improve Convex runtime generation DX: `crux dev` now refreshes runtime artifacts on startup and watched source changes, generated writes are idempotent, Convex no longer emits a top-level `convex/crux.ts` shim, generated target imports run behind a Node action boundary via `@use-crux/convex/runtime/node`, and Convex-native `flow()` handles can execute as generated Runtime Engine targets.

  Fix Convex direct flow starts under `createCruxConvex().run()`: core runtime-backed flow APIs now resolve host-bound declarations through an active request-scoped host binding, and the Convex profile bridge installs that binding before user code starts runtime-backed work.

### Patch Changes

- Updated dependencies [01ce116]
- Updated dependencies [cdc9c16]
- Updated dependencies [d2b64b4]
- Updated dependencies [78592f0]
- Updated dependencies [3b0fb37]
- Updated dependencies [643751b]
- Updated dependencies [dcee4fa]
- Updated dependencies [0ba939b]
- Updated dependencies [4b29d0c]
- Updated dependencies [fa1c979]
- Updated dependencies [41cf753]
- Updated dependencies [8927775]
  - @use-crux/core@0.4.0
