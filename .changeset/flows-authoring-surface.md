---
"@use-crux/core": minor
"@use-crux/otel": patch
---

Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

Refresh OTel package README wording to describe `flow().run()` spans.
