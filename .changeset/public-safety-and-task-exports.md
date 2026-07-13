---
"@use-crux/core": minor
---

Export `detectSuspiciousPatterns` from `@use-crux/core` (alongside the existing
`safe`, `escapeXml`, and other prompt-injection defense helpers) and export the
`TaskCompleteArgs` type from `@use-crux/core/tasks`. Both were already documented
in the reference but were not part of the public export surface.

Also corrects the documentation URLs emitted in a few packages after the docs
site reorganized its guide routes (`defer` → `background-work`, `runtime` →
`durable-execution`).
