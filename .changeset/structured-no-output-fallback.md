---
"@use-crux/core": minor
"@use-crux/ai": minor
---

Normalize AI SDK structured-generation no-output failures as invalid responses so configured fallback models are attempted and routing receipts retain the failed attempt category.

Convert standalone `generateObjectFn` authored-schema parse failures to `ValidationExhaustedError` so `fallback(..., { on: ["invalid_response"] })` can try the next model, and restore connected-knowledge community/global-search domain repair when the first structured attempt is validation-exhausted (safe issue feedback only; final exhaustion stays a `ValidationExhaustedError`).

Route AI SDK structured schemas by the concrete provider attempt. Unknown and aggregator models now pass canonical output and tool schemas through unchanged by default, while direct providers retain their verified lowering. `createCruxAi()` accepts factory-scoped explicit capabilities/resolvers and an `unknownModel` passthrough-or-reject policy. Schema compilation failures and evidenced provider schema rejections use the new `schema_incompatible` fallback category, with strategy/profile recorded in generation traces.
