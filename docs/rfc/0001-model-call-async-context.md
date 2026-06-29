# RFC 0001: Model Call Async Context Wrapper

Status: Deferred

Date: 2026-06-29

## Summary

Consider adding an optional async-context wrapper around provider model calls at
the `LoopRuntimePort` boundary so provider-owned OpenTelemetry spans can nest
under Crux model spans.

This is deferred from the observability event-spine consolidation. The spine
work makes Crux-owned graph records flow through one source of truth. This RFC
tracks a narrower follow-up: preserving context for spans emitted inside
provider SDK internals.

## Motivation

Crux emits model-call observability in its own policy and orchestration layers.
Those records are enough for devtools, `subscribeObservability()` consumers, and
the planned `@use-crux/otel` record subscriber.

Some provider SDKs may also emit OpenTelemetry spans internally, such as HTTP
client spans. Without an explicit async-context wrapper at the provider call
boundary, those provider-owned spans may not always nest under the Crux model
span in a downstream OTel trace.

The event spine should not solve that by adding another event bus or by moving
provider-specific concerns into `@use-crux/core`. If this becomes important, it
should be handled as a focused execution-boundary feature.

## Proposed Direction

Add an optional `executeModelCall` wrapper at the `LoopRuntimePort` boundary.
The wrapper would run the provider call inside the active model span context
without changing the graph record contract.

The exact API is intentionally undecided. A later design should answer:

1. Whether this belongs on the loop runtime port, runtime config, or OTel
   integration layer.
2. How it behaves in non-Node runtimes where `AsyncResource` is unavailable or
   undesirable.
3. Whether it is always enabled by `withTelemetry()` or opt-in for specific
   adapters.
4. How it composes with streaming calls whose completion happens after the
   initial provider call returns.
5. What tests prove provider-emitted spans nest correctly without making
   `@use-crux/core` depend on OpenTelemetry.

## Non-Goals

- No second observability bus.
- No change to the Crux graph record contract.
- No OpenTelemetry dependency in provider packages or `@use-crux/core`.
- No Node-only requirement for ordinary generation or streaming.
- No replacement for `subscribeObservability()` or the diagnostics channel.

## Acceptance Criteria For Revival

Revive this RFC when there is evidence that provider-owned spans matter for a
real integration, such as a user needing provider HTTP spans to nest under Crux
model spans in a production OTel backend.

When revived, implementation should ship with:

1. A small public or internal API at the selected execution boundary.
2. Tests that prove nested provider spans preserve parent context.
3. A fallback path for runtimes without Node async-context APIs.
4. Docs that distinguish provider-internal span nesting from the Crux event
   spine.
