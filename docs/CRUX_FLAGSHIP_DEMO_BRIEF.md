# Crux Flagship Demo Brief

This brief is Phase 4 of the local Crux positioning workplan. It defines the product story for the first flagship demo. It is not an implementation spec and does not authorize runtime code, read models, API fields, devtools routes, matcher APIs, or artifact schemas.

## Sources

- [Crux Roadmap](./CRUX_ROADMAP.md)
- [Crux Vision](./CRUX_VISION.md)
- [Crux Problem/Solution Map](./CRUX_PROBLEM_SOLUTION_MAP.md)
- [Crux Positioning Plan](../../docs/plans/crux-positioning-workplan/01-positioning-plan.md)
- [Open Technical Questions](../../docs/plans/crux-positioning-workplan/02-open-technical-questions.md)

## Target Visitor

The target visitor is a TypeScript developer or technical founder with an AI feature that has outgrown a single prompt string. They already have an SDK, model provider, app framework, database, and deployment path. They are not looking for a new agent framework. They want to know why the same feature behaves differently across users, documents, models, retries, and product modes.

They may arrive through one small need:

- replacing scattered prompt strings with typed prompts;
- making conditional context easier to inspect;
- adding memory to an SDK call;
- grounding answers in sources;
- adding guardrails or constraints;
- declaring routing and fallback policy;
- testing AI behavior before it ships;
- debugging what the model actually saw.

The demo should respect that starting point. Crux is useful at the first door, and the larger story appears when the visitor sees that every added piece becomes part of the same inspectable and testable model turn.

## Aha Moment

The aha moment is:

> I can keep my SDK call, add one Crux wrapper around the setup, and see what the model saw, where it came from, what changed, and which expectations protect it.

The demo should make the visitor feel that Crux is practical before it is grand. The first reaction should be "I could add this to my current code" rather than "I need to migrate into a platform."

## Minimal-Rewrite Narrative

The demo starts with an existing SDK call that already works but is hard to debug:

1. A prompt includes product instructions and user input.
2. Context is assembled from account state, retrieved documents, and a few conditional rules.
3. The app has safety expectations, a fallback model, and at least one quality check.
4. A bad answer happens because the setup, not the model alone, changed.

The Crux version should preserve the user's execution choice. The story is not "replace your SDK." The story is:

1. Name the prompt and context pieces in code.
2. Keep the chosen adapter at the execution boundary.
3. Open local devtools.
4. Compare a good and bad run.
5. Show the setup that reached the model and the checks that should protect it.

The demo can use one wrapper or a small set of Crux definitions, but it should feel like adopting the first useful slice, not rewriting the whole application.

## What Can Be Shown Honestly Now

The current foundation can truthfully show:

- typed `prompt()` and `context()` definitions with schemas;
- conditional context resolution;
- context priority, token-budget dropping, excluded context inspection, and dropped context inspection;
- context caching and provider cache hints;
- memory blocks;
- retrieval, grounding, indexing, stores, and stale-source handling;
- guardrails, constraints, safety reports, redaction actions, and stream transforms;
- routing, fallback, cascades, model/cost metadata, and routing reports;
- quality suites, targets, experiments, cassettes, baselines, feedback records, and redaction support;
- the canonical observability graph, local devtools/runtime, and OTel-safe telemetry;
- Project Index source intelligence, runtime joins, quality joins, and lint findings.

The demo should label these as shipped foundation capabilities, not future promises.

## What Must Be Labeled In Progress

The full flagship moment described in the roadmap depends on deeper roadmap work. These are active gaps, not shipped demo requirements:

- whole-turn decision report;
- rationale artifacts for routing, consensus, swarm, fallback, and boundaries;
- context contract metadata;
- unified freshness vocabulary;
- harness-decision matcher library;
- test-driven harness design as a polished workflow.

The demo can foreshadow these gaps in plain language: "Crux already records a lot of what happened; the next phase makes the reasons easier to see and assert in one place." It should not name API shapes, read models, UI routes, matcher names, or event schemas.

## Dependence On Roadmap Phase 2.1-2.2

The complete "whole turn explained" demo waits on the roadmap work for:

- Phase 2.1, Turn Decision Report: one normalized view of inclusion, exclusion, budget drops, cache/refresh decisions, redaction, blocking, tool eligibility, model selection, guardrails, fallback, retries, and source links.
- Phase 2.2, Rationale Artifacts: reason-bearing records for routing, consensus, swarm, fallback, retry, and policy-boundary decisions.

Until those are shaped and implemented, the first public demo should avoid promising that every decision has a complete reason in one surface. It can still show the current pieces that exist: resolved requests, context inspection, routing reports, safety records, quality results, traces, and source links.

## First Demo Non-Goals

The first flagship demo should not:

- build or announce a new demo repository before the technical dependencies are ready;
- publish a video that implies unfinished rationale features are shipped;
- create a new wrapper API just for the demo;
- add SDK adapters, read models, devtools routes, runtime event schemas, or matcher APIs;
- choose the final Run Detail, Project Health, or Definition Detail information architecture;
- define the decision-report schema or rationale-artifact schema;
- present Crux as an agent runtime, provider abstraction, RAG framework, tracing dashboard, hosted prompt platform, or generic framework replacement;
- make privacy, freshness, governance, or CI claims that the product cannot currently enforce and test.

## Product Shape To Aim For

The strongest first version is a short, concrete path:

1. Start from an ordinary SDK call in a real app-shaped scenario.
2. Add the smallest Crux definitions needed to name prompt setup and context.
3. Introduce one or two additional doors, such as retrieval plus quality or routing plus safety.
4. Open devtools and show the assembled request plus related runtime facts.
5. Show a quality check catching a behavior change.
6. Close by naming what is shipped today and what the roadmap will make clearer next.

This sequence keeps the demo honest while still showing the strategic story: a visitor can adopt one Crux primitive, and every additional primitive joins the same inspectable and testable model-turn workflow.

## Technical Phases Remain Parked

The technical phases remain parked behind the shaping gate in [Open Technical Questions](../../docs/plans/crux-positioning-workplan/02-open-technical-questions.md). This brief does not decide the decision report, rationale artifacts, context contracts, freshness model, matcher library, reliability graph surface, open specification, runtime profiles, or context planner.
