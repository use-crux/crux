---
"@use-crux/core": minor
"@use-crux/postgres": minor
"@use-crux/convex": minor
"@use-crux/indexer": minor
"@use-crux/next": minor
---

Add request-scoped `defer(callback)` with bounded host-lifetime execution, the
explicit `@use-crux/core/defer/node` HTTP integration, and Runtime-backed named
target staging through `await defer(target, input)`. Postgres and Convex Runtime
stores now persist named deferred intents and recover their release through the
existing transactional outbox. Public `defer()` is rejected during replayable
flow execution, and Runtime snapshots migrate replay-visible child work from
`scheduledEffects` to `scheduledWork` with compatibility reads for old rows.
Inline callbacks now isolate nested named commits per callback and report late
commit failures without stopping sibling cleanup.
Project Index now discovers public inline and named scheduling sites as stable
`deferred-work` definitions, resolves their task and enclosing-definition
relations, and reports replay-unsafe, floating-promise, missing-scope, and
explicitly missing-Runtime diagnostics.
Public deferred work emits `defer.scheduled` and `defer.run` observability
spans with causal `triggered` edges, one lightweight grouped run when no
originating Crux run exists, and quiet diagnostics-only internal composition.
Devtools Catalog and Runs surface deferred-work kinds, lifecycle states, and
honest handler-returned streaming notes.
Provider-neutral serverless hosts live at `@use-crux/core/defer/serverless`
(injected `waitUntil` / `after` / named-only). `@use-crux/next` binds Next.js
`after()` as response-finished. Convex bridge runs install a named-only lifetime
so inline callbacks fail with `DEFER_CAPABILITY_MISSING` while named Runtime work
remains supported.
Docs cover host reliability boundaries, completion classes, strict named commit,
at-least-once edges, cancellation limits, and the distinction from
`flow.defer()` / future Effects. Unified project setup aggregation and
`crux runtime setup` compatibility aliases are **not** part of this release note
until the separate setup foundation lands.
