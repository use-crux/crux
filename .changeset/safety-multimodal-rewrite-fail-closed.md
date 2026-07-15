---
"@use-crux/core": minor
"@use-crux/indexer": patch
---

Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
faithfully re-applied to the message's text parts (mutated or spoofed media placeholders,
media-only messages) throws `SafetyResultError` instead of being silently dropped or duplicating
placeholder text into the prompt. `boundary.output.both()` guards now receive the parsed object
alongside the output text.

Add `boundary.input.media()` for inspecting canonical non-text input parts before provider
normalization with fully inferred callback types and stable original indexes. Enforced `strip`
decisions remove only the current part, while report-mode strips record intent without changing
provider input; Project Index now records the exact media boundary on authored guardrails. Input
media remains guardrail-only: constraints reject `boundary.input.media()` in TypeScript and fail
closed on bypassed configurations.
