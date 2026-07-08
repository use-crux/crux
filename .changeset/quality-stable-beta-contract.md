---
'@use-crux/core': minor
'@use-crux/local': minor
'@use-crux/devtools': patch
---

Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

Harden the Quality local pipeline by making `crux quality run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.
