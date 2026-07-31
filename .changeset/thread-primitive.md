---
"@use-crux/core": minor
"@use-crux/upstash": minor
"@use-crux/convex": minor
---

Add linearizable single-key record mutation through native or versioned
compare-and-set adapters, including memory, Upstash Redis, and Convex storage.

Replace the top-level `config.persistence` setting with the standard
`config.storage` bundle. The legacy key now fails with targeted migration
guidance; move `{ records }` directly to `storage`.

Add the provider-neutral `thread({ id })` primitive with immutable canonical
history, stable replay identities, causal-group pagination, and durable
alternatives for concurrent appends. Threads support immutable user-message
edits, remembered branch selection, and deterministic variant navigation
metadata. Adapter authors can run the shared Thread conformance suite from
`@use-crux/core/thread/testing/vitest`.

Integrate Threads with managed Prompt and Agent execution through `use`.
Execution reads one exact history snapshot, publishes the rendered user turn
and accepted assistant/tool exchange atomically, and exposes the receipt as
`threadCommit`. Explicit call-site messages shadow Thread I/O, streams await
publication before final completion, and publication failures reject with
`ThreadCommitError`.
