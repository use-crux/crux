---
"@use-crux/core": minor
"@use-crux/local": minor
"@use-crux/devtools": patch
---

Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.
