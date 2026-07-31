---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/upstash": minor
"@use-crux/convex": minor
"@use-crux/otel": minor
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
`threadCommit`. Call-site and Prompt-level messages shadow Thread I/O without
merging transcripts. Bare Threads remain complete exact history, while
`history.recent()` and `history()` project the Thread through whole-request
planning. Sealed plans pin the Thread revision, managed summary artifacts use
revision/range identity, streams await publication before final completion,
and publication failures reject with `ThreadCommitError`.

Add irreversible atomic message redaction, structural causal-group removal,
and owner-safe whole-Thread deletion. Redaction permanently poisons replay and
editing while erasing Thread-owned assets; deletion rejects while any durable
owner remains, publishes inaccessibility before cleanup, and erases nodes,
append receipts, pending receipt state, and assets.

Hydrate persisted media automatically on Thread reads, emit payload-safe
`thread.operation` evidence for every public operation, expose structural
tree/group/branch/head data to the Runtime Bridge, and discover authored
Threads plus Prompt/Agent bindings and binding diagnostics in Project Index.

Surface duplicate active Thread ids and conflicting Thread bindings as
descriptor-backed Project Index lint findings, including `crux lint` and LSP
diagnostics, without unresolved-target false positives for valid Thread uses.

Wire the devtools helpers' `bridge` option so `enableDevtools()` and
`withDevtools()` connect the Runtime Bridge peer directly, and make
`crux lint --port` read the running dev server instead of silently
falling back to a one-shot index.

Evict Project Index facts for source files deleted while the local server was stopped.
