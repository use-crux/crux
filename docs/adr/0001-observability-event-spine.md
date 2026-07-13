# ADR 0001: Observability Event Spine

Status: Accepted; lifecycle, delivery, and OTel assumptions built on top of this spine are
superseded by [ADR 0002](./0002-observability-runtime-reliability.md).

Date: 2026-06-29

> **2026-07-11 note:** the "one event birthplace: `emit()`" decision below still holds unchanged.
> ADR 0002 replaces this document's implicit assumptions that a run/span is process-local (a
> per-run monotonic `seq`, an OTel span object held open across a boundary, `response.ok` as
> delivery success) with an explicit multi-invocation contract: logical runs vs. physical execution
> segments, `run:suspend`/`run:resume`, per-record delivery receipts, and a host-lifecycle-aware
> OTel bridge. Read ADR 0002 for anything about run lifecycle, delivery guarantees, or OTel span
> activation; this document remains the source of truth for the subscriber/diagnostics-channel/
> transport fan-out shape itself.

## Context

Crux currently has two parallel observability buses that are hand-fired from the
same runtime call sites.

The canonical graph stream is emitted through `observe.*` and `emit()`. It
produces versioned graph records for runs, spans, span events, artifacts, and
edges. Devtools consume this stream through the observability transport.

`InstrumentationHooks` is a separate callback surface on `CruxRuntime`.
`@use-crux/otel` consumes it through a hooks-to-OpenTelemetry mapper. This path
duplicates many of the same lifecycle events and is narrower than the graph
stream.

Keeping both paths creates drift. Every new primitive has to be wired into both
surfaces, OTel can miss records that devtools see, and external observability
vendors have to implement Crux-specific hooks instead of subscribing to the
canonical stream.

The AI SDK v7 telemetry design is a useful reference point: one internal
dispatcher can feed more than one sink. Crux already has a richer event model
than spans plus callbacks, so the decision is about distribution, not changing
the graph contract.

## Decision

Crux will consolidate observability around one event spine: graph records born
only in `emit()`.

`emit()` will synchronously fan out records to in-process subscribers registered
with `subscribeObservability()`, publish a plain per-record message on
`node:diagnostics_channel` channel `crux:observability` when that channel has
subscribers, and continue to queue records for the existing async transport.

The diagnostics channel message shape is:

```ts
{
  schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
  record: CruxGraphRecord,
}
```

The channel uses plain `channel.publish()`, not
`diagnostics_channel.tracingChannel()`. Crux records already encode lifecycle
events such as `span:start`, `span:end`, `span:event`, artifacts, and edges.
Wrapping them in a second tracing lifecycle would make the distribution layer
look like a second model.

Subscriber delivery is synchronous and runs inside the active observability
async context. Subscriber and channel failures are isolated with safe publish
wrappers so a failing sink cannot affect user execution, sibling subscribers,
or devtools transport delivery.

`InstrumentationHooks` will be removed rather than preserved as a compatibility
projection. `subscribeObservability()` and the diagnostics channel are the new
extension mechanics. `@use-crux/otel` will be rebuilt as a graph-record
subscriber and will keep `withTelemetry()` as the public entrypoint.

The workstream does not add an `executeModelCall` async-context wrapper at the
provider port boundary. That follow-up is tracked separately because it targets
provider-internal spans emitted below Crux's graph records, not the event spine
itself.

## Alternatives Considered

The two-bus status quo would avoid a breaking removal before launch, but it
keeps the source of drift and requires future primitives to maintain two
parallel instrumentation contracts.

Keeping `InstrumentationHooks` as a derived projection from graph records would
reduce inline hook firing, but it would still preserve a hooks-shaped public
mental model. Pre-launch, the simpler contract is to remove it and make the
canonical graph stream the only public observability source.

Using `diagnostics_channel.tracingChannel()` would more closely mirror AI SDK
v7. Crux does not need that wrapper because its graph records already carry
explicit start, end, event, artifact, and edge semantics. A plain publish keeps
the Node tee a transport for records, not a second lifecycle abstraction.

Adding an `AsyncResource` streaming wrapper now could help provider-owned HTTP
spans nest under model spans. That is useful but narrower than the spine
consolidation. It also risks introducing a Node-specific concern into the
provider execution boundary before there is evidence users need it.

## Consequences

There is exactly one event birthplace: `emit()`.

Devtools keep consuming the existing transport. The transport remains async,
batched, and backpressured; the new subscriber and diagnostics-channel paths are
additional downstream sinks.

OTel receives the same graph records as devtools, so future observability
coverage should be added once to the graph stream and inherited by all sinks.

The public API changes before launch. Packages that referenced
`InstrumentationHooks` will migrate to `subscribeObservability()` or the
diagnostics channel.

The idle path keeps the existing schema validation behavior. Zero cost when
idle means no extra subscriber or channel allocation and no fan-out work when no
subscriber, transport, or channel listener is active.

The event spine must continue to work in non-Node runtimes. Diagnostics-channel
acquisition is lazy and degrades to no-op when the builtin module is absent.

## Validation

Implementation must keep coverage at these boundaries:

1. Core tests prove subscribers receive records in order, unsubscribe works, and
   throwing subscribers cannot break sibling subscribers or transport delivery.
2. Core tests prove the diagnostics channel publishes
   `CruxObservabilityChannelMessage` only when the channel has subscribers.
3. Core type tests cover the public subscriber and channel-message types.
4. OTel tests prove the record subscriber matches or intentionally improves the
   old hooks-based span output before hooks are removed.
5. Workspace grep after removal shows no inline `InstrumentationHooks` emission
   remains outside intentional historical docs or tests.
6. Docs describe one graph-record spine with subscribers, diagnostics-channel
   publishing, and the existing devtools transport as downstream sinks.
