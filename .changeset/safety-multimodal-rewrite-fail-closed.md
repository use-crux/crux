---
"@use-crux/core": patch
---

Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
faithfully re-applied to the message's text parts (mutated or spoofed media placeholders,
media-only messages) throws `SafetyResultError` instead of being silently dropped or duplicating
placeholder text into the prompt. `boundary.output.both()` guards now receive the parsed object
alongside the output text.
