---
"@use-crux/core": minor
"@use-crux/otel": patch
---

Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

Flows can now declare local typed signal maps with `flow(name, { signals }, handler)`. Signal schemas type both `flow.suspend('name')` and `handle.signal(flowId, 'name', payload)`, and `noPayload()` declares notification-only signals.

Declared signal schemas now validate payloads before `handle.signal()` writes to persistence and again when `flow.suspend()` delivers a stored signal during resume.

Refresh OTel package README wording to describe `flow().run()` spans.
