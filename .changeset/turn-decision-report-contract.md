---
"@use-crux/core": minor
"@use-crux/local": minor
---

Add the public observability `TurnDecisionReport` type contract for per-turn explanation read models, including separate freshness and cache evidence, stable decision reason codes, source joins, coverage rows, and missing-evidence diagnostics.

Expose `decisionReport` on Crux Local Run Detail generation nodes and details, projecting request composition, runtime decisions, source joins, coverage rows, and missing-evidence gaps from existing observability evidence. The public `CruxRunDetailNode` and `CruxRunDetailDetail` types now declare the optional `decisionReport` field so consumers can read the projection without re-deriving it.

Project recorded freshness evidence into Run Detail `decisionReport` rows, including cache outcomes accepted or rejected by freshness while keeping cache and freshness as separate evidence concepts.

Add Quality `ctx.expect.decisionReport` matchers for protecting context dispositions, routing/fallback outcomes, freshness status, and cache acceptance using stable `TurnDecisionReport` reason codes.

Harden Run Detail turn explanations so empty `decisionReport` collections encode as `[]` in Crux Local and Devtools tolerates older partial reports that used `null` for empty collections.
