---
"@use-crux/core": minor
"@use-crux/convex": minor
"@use-crux/indexer": minor
"@use-crux/postgres": minor
"@use-crux/upstash": minor
---

Add the `@use-crux/core/runtime` subpath with Runtime Engine port contracts, typed runtime diagnostics, wake envelope validation, retry helpers, the pure work state-machine surface, kernel composite operations, outbox dispatch, the in-memory runtime store, and the `@use-crux/core/runtime/testing` conformance suites for adapter authors.

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

Move the Postgres adapter's `pg` client to a caller-controlled peer dependency while retaining it as a repo dev dependency for tests, and refresh the package homepage to a live source URL.
