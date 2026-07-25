---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/indexer": patch
"@use-crux/devtools": patch
---

Unify model-input Safety around semantic text, media, and instruction boundaries
for caller, tool, and retrieval content. Raw tool controls remain in
`toolPolicy`, and custom model-output conversion can no longer bypass input
guardrails.
