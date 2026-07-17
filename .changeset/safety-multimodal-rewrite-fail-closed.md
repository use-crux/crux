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

Add `guardrail.media()` as a declarative, provider-neutral attachment policy for MIME allowlists,
byte limits, exact remote hosts, inline/provider-file categories, and URL userinfo/query posture.
It inspects only caller-supplied metadata and local bytes, supports block or strip enforcement, and
keeps locator and payload details out of decisions. Project Index now records complete literal
guardrail helper strategy config through the bundled native Safety extractor and retains kind-only
facts for dynamic config.
