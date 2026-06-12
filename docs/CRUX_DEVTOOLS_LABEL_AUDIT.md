# Crux Devtools Label Audit

This audit is Phase 3 of the local Crux positioning workplan. It captures current devtools labels that may need future alignment with the public glossary. It is an audit only: it does not authorize UI code changes, runtime schema changes, event contract changes, or API naming changes.

## Sources

- [Crux Positioning Plan](../../docs/plans/crux-positioning-workplan/01-positioning-plan.md)
- [Crux Positioning Inventory](./CRUX_POSITIONING_INVENTORY.md)
- [Crux Vision](./CRUX_VISION.md)
- [Crux Problem/Solution Map](./CRUX_PROBLEM_SOLUTION_MAP.md)
- [Thinking in Crux](../apps/docs/content/docs/foundations/thinking-in-crux.mdx)

## Audit Summary

Devtools already carries much of the right substance: runs, context composition, injected pieces, routing reports, quality experiments, baselines, source index health, and evidence lists. The label set should be audited against user-facing language, not an internal vocabulary list. Future labels should start from what users are trying to understand: what the model saw, where it came from, why it was included or skipped, and what changed between runs.

Do not rename labels in-place until the relevant technical shaping phase decides the underlying product contract. Some labels are implementation terms that may remain correct even if the surrounding copy changes.

## Labels To Revisit

| Surface | Current labels | Source anchors | User-language pressure | Future alignment question |
| --- | --- | --- | --- | --- |
| Top-level navigation | `Inspect`, `Evaluate`, `Loop`, `Library`; items `Runs`, `Suites`, `Experiments`, `Compare`, `Baselines`, `Feedback`, `Cassettes`, `Index`, `Memory`, `Workspaces`, `Plans & Tasks` | `packages/devtools/ui/src/qw/shell/nav.ts:72-110` | `Runs` is operationally accurate and user-recognizable. Avoid replacing it with abstract terms too early. | Should future copy explain that a run includes prompt setup, context, tools, model choice, and output rather than renaming the surface? |
| Overview | `Quality at a glance`, `Runs`, `Pass rate`, `Mean score`, `Cost · 24h`, `P50 latency`, `Open insights` | `packages/devtools/ui/src/features/overview/components/OverviewView.tsx:148-260` | Quality should help users understand whether the AI feature is still behaving, not only whether a score moved. | Should overview copy distinguish answer-quality metrics from setup/behavior checks once those checks exist? |
| Runs list | `Runs`, `New run`, `Save to suite`, `All`, `Live`, `Failures`, `Has feedback`, grouping by `Kind`, `Target`, `Session` | `packages/devtools/ui/src/features/runs/components/RunsView.tsx:74-167` | `Run` and `Trace` are capture terms; `Turn` is the product unit. | Should captured executions remain `runs`, while model-facing units inside them become `turns`? |
| Run header and lenses | Breadcrumb `Runs / {traceId}`; actions `Compare`, `Share`, `Replay`; lenses `Tree`, `Timeline`, `Graph`, `Story` | `packages/devtools/ui/src/features/run-detail/components/RunHeader.tsx:64-126`; `packages/devtools/ui/src/features/run-detail/components/atoms.tsx:213-233` | `Graph` and `Story` are understandable, but future reason-bearing surfaces should avoid abstract naming. | Should `Story` remain a narrative view of the same run data, while any future "why" surface uses plain labels like "Why this happened"? |
| Context composition pane | `Effective request`, `Budget`, `Rendered request`, `Base prompt`, `Injected contributions`, `Accumulated context · messages`, `Tools in the request` | `packages/devtools/ui/src/features/run-detail/components/ContextComposition.tsx:647-894` | `Injected contributions` is precise but technical. User-facing copy may be clearer as "pieces added to the prompt." | Should the pane eventually say `Request setup`, and should `Budget` explain which pieces were dropped to fit? |
| Contribution state chips | `active`, `checked · not included`, `dropped · budget`, `disabled`, `unknown`; group labels `Always`, `Conditional`, `Runtime-dependent` | `packages/devtools/ui/src/features/index/v2/kit.tsx:481-539`; `packages/devtools/ui/src/features/index/v2/kit.tsx:608-709` | These labels are concrete and useful. They explain what happened without requiring the user to learn a taxonomy first. | Should `checked · not included` stay as the precise UI label, with docs teaching that it is different from a budget drop? |
| Governance tabs on generation | `Routing`, `Guardrail`, `Security`, `Constraint`, `Cache`, `Compaction`; empty state `No routing decision folded onto this generation` | `packages/devtools/ui/src/features/run-detail/components/GenerationDecisions.tsx:327-369` | `Governance` is an internal grouping. User-facing labels should describe the thing users are checking: model choice, safety, cache, retries, or output constraints. | Should future tabs group these under a simpler "What changed the request?" or "Checks and routing" surface? |
| Routing report copy | `Router · classify -> model`, `Cost cascade`, `Latency cascade`, `escalating tiers`, `fallback.attempt edge` | `packages/devtools/ui/src/features/run-detail/components/GenerationDecisions.tsx:135-313` | Users mostly want to know "why this model?" and "what would happen on failure?" | Should routing panels lead with model choice and fallback behavior before showing lower-level report names? |
| Project Index families | `Authoring`, `Agents`, `Capabilities`, `Orchestration`, `Routing`, `State`, `Safety`, `Quality`; kind labels such as `Prompt`, `Context`, `Injectable`, `Retriever`, `Scorer`, `Suite` | `packages/devtools/ui/src/features/index/v2/kit.tsx:33-126` | These are useful browse categories, but they should not become the public positioning by themselves. | Should the Index surface explain these as the AI parts Crux found in the codebase? |
| Index fidelity and freshness-like status | `static`, `resolved`, `semantic`, `runtime`; `indexed · cold/cached/refreshing/ready/degraded`; substatus `AST`, `semantic` | `packages/devtools/ui/src/features/index/v2/kit.tsx:283-408` | These labels describe source-index confidence, not whether retrieved context is current enough for a user task. | Should future UI make that distinction explicit where both ideas appear? |
| Health findings | `evidence · why it fired`, `propagation · where it spreads`, `fix`, severity `error/warning/info` | `packages/devtools/ui/src/features/index/v2/health.tsx:79-205` | This is already close to user language because it answers "why did this fire?" | Should the same plain "why" language be reused for future run-detail explanations? |
| Experiments and baselines | `Experiments`, `Suites`, `Pass`, `Score`, `Promoted baselines`, `Promotion rules`, `Compare latest`, `Open experiment` | `packages/devtools/ui/src/features/experiments/components/ExperimentsView.tsx:92-149`; `packages/devtools/ui/src/features/baselines/components/BaselinesView.tsx:37-156` | Baselines should read as expectations a future change must protect, not only promoted experiment records. | Should baseline cards show the protected expectation and target more explicitly once richer setup checks exist? |

## Already Aligned

- `Injected contributions` is precise, but public docs should usually say "pieces added to the prompt" unless the UI needs the shorter technical label.
- `checked · not included` and `dropped · budget` preserve the important distinction between a predicate/branch exclusion and a token-budget drop.
- `evidence · why it fired` is useful because it answers a user question directly.
- `Baselines` is the right quality term, as long as the UI makes clear what expectation the baseline protects.

## Do Not Change In This Phase

- Do not rename `Run`, `Trace`, `Span`, or `Observability` in code or event contracts.
- Do not introduce decision-report, rationale-artifact, freshness, sensitivity, boundary, or matcher API names in UI copy until the underlying feature is shaped and the user-facing wording is chosen.
- Do not rename devtools routes, nav IDs, persisted view IDs, or generated assets.
- Do not change UI copy until the relevant product/technical phase decides whether the label maps to a real contract or only surrounding explanatory text.

## Recommended Future Work

1. After the deeper "why did this happen?" feature is shaped, decide whether Run Detail gets a plain-language surface such as `Request setup`, `Why this happened`, or `Checks and routing`.
2. Reserve specialized terms such as `rationale` for API/docs contexts where precision matters; prefer "why" in UI copy.
3. After unified freshness is shaped, audit all uses of `stale`, `cached`, `refreshing`, `ready`, and TTL labels so source-index freshness, cache freshness, and contribution freshness do not blur together.
4. After harness-decision matchers are shaped, revisit Quality and Baselines labels so they describe protected harness expectations, not only pass rates and scores.
