---
"@use-crux/core": major
"@use-crux/ai": major
"@use-crux/convex": major
"@use-crux/openai": minor
"@use-crux/anthropic": minor
"@use-crux/google": minor
---

Add provider-neutral model capacity profiles, conservative unknown-model
fallbacks, and an optional authoritative token-counting adapter port. All
first-party language adapters can report the context window, default output
reserve, and counting confidence used for whole-request budget derivation.

Plan every Core-owned language request against model capacity before dispatch.
Add per-call `inputBudget` settings, typed pre-dispatch composition failures,
and linked JSON-safe request receipts with redacted token breakdowns on
generation and stream steps. Adapters may report transport retries for the
same sealed request so live receipt inspection can expose the retry count.

Apply the same measure-plan-seal contract to every semantic provider call in
AI SDK-owned loops, including tool steps, structured retries, and streams.
Loop runtimes now declare and invoke an awaited per-step planning boundary.

Remove the narrow `tokenBudget` resolver and adapter option. Migrate managed
calls to `inputBudget`, which measures the complete provider request and never
silently drops exact context contributions. Prompt resolution now retains all
exact contexts; representation wrappers authorize future lossy alternatives.
Resolver-only Convex lifecycle budget fields are removed as well.

Add stateless, causal-group-safe `history.recent()` projection for complete
caller-owned transcripts across Core-owned and SDK-owned language loops.
Message and token caps retain leading system directives, keep Tool lifecycles
atomic, and receipt soft-cap boundary adjustments. Bare exact history now
warns predictively near its optimization watermark and points to
`history.recent()` or managed `history()` before an oversized request is
dispatched.

Remove the stateful MemoryBlock `recentMessages()` API and the stateful
`createSlidingWindow()` compaction helper. Use `history.recent()` for a
stateless exact-history suffix; managed summary artifacts will be provided by
the context-planning history surface. The Convex memory profile mirrors the
MemoryBlock removal.

Add type-safe request representation ladders with `prefer()`, `summarizable()`,
`offloadable()`, and terminal `droppable()` composition. Authored alternatives
now participate in deterministic two-tier whole-request selection, retain the
canonical source's capabilities, remain monotonic within a concrete-model
epoch, and expose every selected alternative or omission in request receipts.
Generated-summary and exact-recovery rungs fail explicitly until their backing
artifacts are prepared.

Add managed `history()` with derived recent-history defaults, adaptive,
regenerating, rolling, and hierarchical summary strategies, content-addressed
summary artifacts, concurrent preparation deduplication, stale-while-revalidate
reuse, and explicit inline, recent-only, or fail miss behavior. Summary
maintenance uses the configured request-retention host without delaying the
accepted response, every bounded support call is linked through receipt
inspection, and `providerNative: false` forces portable Core lowering.

Remove the `@use-crux/core/compaction` subpath and its legacy
`summarizeMessages()`, `compactConversation()`, `createBudgetManager()`, and
`extractKeyFacts()` helpers. Use managed `history()` for adaptive conversation
projection and provider-neutral generation function types from
`@use-crux/core`. The Convex package no longer mirrors
`compactConversation()`.
