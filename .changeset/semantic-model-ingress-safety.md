---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/indexer": patch
"@use-crux/devtools": patch
"@use-crux/local": patch
---

Unify model-input Safety around semantic text, media, and instruction boundaries
for caller, tool, retrieval, memory, blackboard, handoff, and retry-feedback
content. Add provider-visible authored/discovered tool boundaries and managed
memory commit guardrails; raw tool execution controls remain in `toolPolicy`.

Guard rejected output and corrective feedback before every eligible retry.
Semantic-cache hits now pass through current output guardrails, one authored
schema parse, and constraints before publication, with safe live fallback for
expected content rejections.

Deprecate `boundary.validation.feedback()` in favor of
`boundary.input.text({ from: "feedback" })`; the compatibility boundary remains
operational for validation feedback.
