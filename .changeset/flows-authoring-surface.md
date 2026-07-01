---
"@use-crux/core": minor
"@use-crux/convex": minor
"@use-crux/indexer": minor
"@use-crux/otel": patch
---

Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

Flows can now declare local typed signal maps with `flow(name, { signals }, handler)`. Signal schemas type both `flow.suspend('name')` and `handle.signal(flowId, 'name', payload)`, and `noPayload()` declares notification-only signals.

Declared signal schemas now validate payloads before `handle.signal()` writes to persistence and again when `flow.suspend()` delivers a stored signal during resume.

Resumed flows now persist terminal lifecycle metadata when they complete, cancel, or expire. Terminal snapshots are retained for inspection and listing, but `completed`, `cancelled`, and `expired` snapshots cannot be resumed again.

Delivered flow signals are now consumed after validation and replayed from the flow snapshot for earlier suspend points, preventing stale pending signals from satisfying later waits.

The Project Index now records local flow signal names and emits lint findings for duplicate literal `flow.suspend()` names and literal suspend names missing from a local signal map.

Flow step labels are now enforced as durable replay identities. Duplicate labels throw at runtime, the Project Index records ordered step label metadata, and linting reports duplicate literal `flow.step()` labels.

Flow lifecycle control errors thrown inside `flow.step()` now bypass step retry and fallback handling, preserving suspend, cancel, and expire outcomes.

Persisted flow input, step outputs, signal payloads, and terminal snapshot metadata are now validated as JSON-serializable before flow state is written.

Convex flow actions now start and resume through the accepted core `run(input)` and `resume(flowId)` handle APIs. Convex flows can also declare local signal maps, and `.signal()` validates declared payload schemas before writing a pending signal or scheduling the resume action.

Refresh OTel package README wording to describe `flow().run()` spans.
