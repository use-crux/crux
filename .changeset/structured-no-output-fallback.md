---
"@use-crux/core": patch
"@use-crux/ai": patch
---

Normalize AI SDK structured-generation no-output failures as invalid responses so configured fallback models are attempted and routing receipts retain the failed attempt category.
