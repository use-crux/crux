---
'@use-crux/core': minor
'@use-crux/local': minor
'@use-crux/devtools': patch
---

Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.
