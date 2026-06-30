---
"@use-crux/core": minor
"@use-crux/local": minor
---

Add the public observability `TurnDecisionReport` type contract for per-turn explanation read models, including separate freshness and cache evidence, stable decision reason codes, source joins, coverage rows, and missing-evidence diagnostics.

Expose `decisionReport` on Crux Local Run Detail generation nodes and details, projecting request composition, runtime decisions, source joins, coverage rows, and missing-evidence gaps from existing observability evidence. The public `CruxRunDetailNode` and `CruxRunDetailDetail` types now declare the optional `decisionReport` field so consumers can read the projection without re-deriving it.

Project recorded freshness evidence into Run Detail `decisionReport` rows, including cache outcomes accepted or rejected by freshness while keeping cache and freshness as separate evidence concepts.

Add Quality `ctx.expect.decisionReport` matchers for protecting context dispositions, routing/fallback outcomes, freshness status, and cache acceptance using stable `TurnDecisionReport` reason codes.

Harden Run Detail turn explanations so empty `decisionReport` collections encode as `[]` in Crux Local and Devtools tolerates older partial reports that used `null` for empty collections.

Polish the `TurnDecisionReport` V1 contract before freeze: rename `turn.verdict` to `turn.readout` (a deterministic evidence-bound sentence, not a pass/fail judgment), rename the top-level `summary` chip list to `chips` (type `TurnDecisionChip`, was `TurnSummaryChip`), and replace `TurnCoverageArea.area` with stable `id` + display `label` fields while renaming `suggest`/`cmd` to `suggestion`/`command`. These are breaking renames to the pre-release public contract; `@use-crux/local` and Devtools are updated to match.

Document the `TurnDecisionReport` V1 freeze policy in the observability reference, including additive `schemaVersion: 1` compatibility, matcher-stable reason codes and coverage ids, display-only human text, explicit unknown/missing/unresolved states, cache/freshness separation, and the rule that Run Insight is UI-derived from per-turn reports rather than a separate run-level `decisionReport`.

Add docs for debugging a bad model turn with Explain and for protecting setup behavior with `ctx.expect.decisionReport` Quality assertions.
