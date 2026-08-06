---
"@use-crux/core": patch
"@use-crux/ai": patch
---

Normalize AI SDK structured-generation no-output failures as invalid responses so configured fallback models are attempted and routing receipts retain the failed attempt category.

Convert standalone `generateObjectFn` authored-schema parse failures to `ValidationExhaustedError` so `fallback(..., { on: ["invalid_response"] })` can try the next model, and restore connected-knowledge community/global-search domain repair when the first structured attempt is validation-exhausted (safe issue feedback only; final exhaustion stays a `ValidationExhaustedError`).
