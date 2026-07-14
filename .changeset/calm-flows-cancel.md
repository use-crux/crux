---
"@use-crux/core": minor
---

Add object-bound `FlowHandle.cancel(flowId)` with consistent idempotent behavior
with and without a Runtime Engine. Runtime cancellation now atomically marks
both durable work and its flow snapshot cancelled, including through
`crux.flows.cancel()`, while leaving independently deferred or scheduled child
work running.

Correct missing-runtime guidance to use `handle.resume(flowId)` and document
the positional, barrier-buffered durability contract for `flow.defer()` and
`flow.after()`.
