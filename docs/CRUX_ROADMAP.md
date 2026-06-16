# Crux Roadmap

This roadmap follows the vision in [CRUX_VISION.md](./CRUX_VISION.md).

The mission is:

> Same Prompt. Same Output. Every Time.

The strategy is the three-layer model: a complete, composable set of **building blocks**; **one composition model** (`use[]`) that every block goes through; and, because of that, **one graph and one proof system** — everything can be explained through one graph and tested through one harness, tied to source.

The roadmap deliberately does not list existing features as new work. Each phase calls out the existing foundation and the incremental work needed to make Crux's position clearer, stronger, and more usable.

## Pace And Prioritization

This roadmap orders work; it does not date it. Two standing rules govern prioritization:

- **The tiebreaker:** when in doubt, prefer work that closes the why-gap or ships a decision the user can see and test.
- **The explanation-parity bar:** a primitive must be complete across all three questions — declared deliberately, evidenced with reasons, assertable in quality suites — before it gains new capability. (Worked example: consensus gets per-agent vote edges and disagreement evidence before consensus learns any new trick.)

The alpha launch bar is: demoable and stable enough, honestly labeled. Perfection is for RC and stable.

## Current Foundation

Crux already has:

- Typed `prompt()` and `context()` definitions with input/output schemas.
- Conditional context resolution through context-level `when`, `when()`, `match()`, and falsy `use` entries.
- Token-budget context dropping with `droppedContexts`, and inspection with `excludedContexts`.
- Context resolver caching and provider cache hints.
- Memory blocks for recent messages, working state, episodes, facts, procedures, proposals, and policies.
- Retrieval, grounding, indexing pipelines, corpus sync, stale-source handling, semantic cache, embeddings, and stores.
- Guardrails, constraints, safety reports, guardrail evals, redaction actions, and stream transforms.
- Routing, fallback, cascades, model/cost metadata, and routing reports.
- Quality suites, targets, experiments, cassettes, baselines, feedback records, and redaction support.
- A canonical observability graph (one contract, one emitter) with Go read models for runs, spans, artifacts, edges, context, safety, memory, retrieval, tools, scores, errors, and metrics.
- Project Index source intelligence, runtime joins, quality joins, lint findings, injection read models, `expandedInputSchema`, and `inputContributions`.
- Devtools, local Go runtime, TUI, embedded indexer/eval/source-resolver workers, and OTel-safe telemetry defaults.

Honest status: the facts above are recorded; not all of their *reasons* are. Routing rationale, consensus votes, policy-boundary decisions, a unified freshness vocabulary, and the harness-decision matcher library are the active gaps. Closing them is most of Phases 2–3.

## Phase 1: Sharpen The Product Story

Goal: make Crux's position obvious before adding new architecture.

### 1.1 Reposition The Front Door

Work:

- Reframe README and top-level docs around **harness engineering** and the three-layer story (building blocks / one composition model / one graph and proof).
- Lead with the proactive stance: others measure outputs reactively and leave you guessing why; Crux measures and shapes what goes in. Include the economic consequence: a solid harness works with almost any capable model, so model choice becomes a routing decision, not a crutch.
- Keep typed prompts and the building blocks as honest entry points; present the whole-turn explanation as the flagship moment.
- Label shipped vs in-progress vs planned explicitly, everywhere. Alpha status stays prominent.
- Extend the existing compare pages with the proactive/reactive framing. Factual, never combative — Crux is not trying to replace anyone; let the difference sell itself.

### 1.2 Create The Vocabulary

Work:

- Define standard terms: turn, contribution, decision, rationale, dependency, freshness, sensitivity, boundary, evidence, baseline, impact.
- Add the disambiguation lines (harness ≠ agent runtime; determinism ≠ deterministic models; context engineering ⊂ harness engineering).
- Map each term to existing Crux records where possible; avoid adding APIs until the vocabulary is stable.
- Audit devtools labels against the vocabulary.

Deliverables: revised README opening, revised foundations/philosophy pages, public glossary, devtools label audit.

### 1.3 Code Is Config

Existing foundation: the Project Index already discovers many definitions from source; contexts used by prompts are auto-collected; runtime snapshots enrich source-indexed definitions; Quality definitions can be discovered by convention.

Work:

- Document the product rule: explicit construction decides behavior; Crux discovery provides visibility.
- Stop presenting `config({ prompts, contexts, tools })` as required for local tooling.
- Treat `crux.config.ts` as policy, override, trust, and boundary config; not primitive registration.
- Add the duplicate-registration test to docs and reviews: if a relationship is already authored in code, do not require it in config.
- Clarify that stores, providers, telemetry, cloud upload, training export, retention, and sensitive boundaries remain explicit user choices.

## Phase 2: Close The Why-Gap (The Deliberate Turn)

Goal: every decision in the turn is recorded **with its reason**, and the whole turn can be explained in one place.

### 2.1 Turn Decision Report

Existing foundation: prompt resolution emits context predicate spans, contributions, budget artifacts, and consumed edges; inspect exposes excluded and dropped contexts.

Work:

- Add a normalized per-generation **decision report** read model covering the whole turn, not just context: included/excluded/dropped/cached/refreshed/redacted/blocked contributions, tool eligibility, model selection, armed guardrails and their actions, fallback/retry plan and firings, budget arbitration.
- Connect each decision to its authored source definition and to quality assertions when available.
- Refresh the devtools generation panel around it.

### 2.2 Rationale Artifacts

Existing foundation: routing, cascade, consensus, swarm, fallback, and policy spans exist; most record the outcome but not the reason.

Work:

- Routing: why this model for this turn — policy matched, alternatives considered, cost/capability trade-off.
- Consensus: per-agent vote edges and disagreement evidence.
- Swarm: routing justification for agent selection.
- Fallback/retry: which error class triggered, which step of the chain fired.
- Safety/boundaries: which policy allowed or blocked a crossing, what was redacted and why.

This work doubles as v2 preparation: these evidence shapes are what external runtimes will eventually have to emit.

### 2.3 Context Contracts

Existing foundation: contexts have input schemas, priorities, conditions, caching, nested `use`, tools, and contribution artifacts.

Work:

- Optional context metadata for declared dependencies, expected freshness, sensitivity, and intended use.
- Surface contract metadata in Project Index and Run Detail.
- Index lints for missing contract metadata only where the context is high-impact, dynamic, sensitive, long-lived, or tool-producing.
- Do not rename existing primitives; do not require metadata everywhere; treat metadata as an authored contract first, enforcement later.

### 2.4 Unified Freshness Model

Existing foundation: context resolver cache TTL, semantic cache TTL, store TTL, corpus stale-source handling, memory retention metadata — all real, all independent.

Work:

- One freshness vocabulary across context, memory, retrieval, corpus, cache, and runtime artifacts.
- Record `observedAt`, `validUntil`, `sourceVersion`, or equivalent where the primitive can know it.
- Show freshness in Run Detail for every contribution that affected a generation.
- Freshness-aware quality matchers; strict/experimental lints for dynamic context without freshness contracts.
- Do not build a universal cache replacement.

### 2.5 Context Impact Evaluation

Work:

- First-class, documented context impact tests: with/without a context, fresh/stale variants, retriever variants, budget strategies.
- A simple impact summary: helped, hurt, redundant, missing, or inconclusive.

## Phase 3: Harness Proof

Goal: harness decisions are assertable, and test-driven harness design is the flagship workflow.

### 3.1 Harness-Decision Matchers

Existing foundation: quality executions already expose context, routing, memory, safety, tool, and trace facts; the matcher library over them is thin.

Work: ship ~10 real matchers with recipes —

- context included / excluded / dropped-for-budget;
- contribution fresh enough / stale;
- routing decision within declared policy; no silent downgrade;
- memory write redacted / retained per policy;
- guardrail fired on the regression cases;
- fallback chain engaged in declared order.

### 3.2 Test-Driven Harness Design

Existing foundation: suites, targets, experiments, cassettes, and baselines all exist.

Work:

- Make the workflow native and documented: describe the expected cases first → build the harness against them until behavior matches exactly → mark a **baseline** → every change must meet at least that bar.
- Baseline gating in CI.
- A guide that walks one real harness from empty expectations to a green baseline.

### 3.3 CI Outputs

Work:

- `crux quality run` and `crux lint` produce clean JSON for CI and Markdown summaries for PR comments.
- Review summary for changed AI definitions: changed prompts/contexts/tools/retrievers/flows/agents, affected suites, changed contracts, new/removed lint findings, baseline status.

## Milestone: The Flagship Demo

A named deliverable, not a docs afterthought: wrap **one existing SDK call with zero rewrite**, open devtools, and see the entire turn explained — context decisions, budget drops, freshness, routing rationale, armed and fired guardrails, the fallback plan. Demo repository plus video. This is the moment a visitor discovers the composition model and the source-linked graph; it requires Phases 2.1–2.2 and showcases the breadth of the building blocks, not one primitive.

## Phase 4: Reliability Graph Product Surface

Goal: authored graph, runtime graph, and quality graph feel like one product.

### 4.1 Definition-Centric Health Pages

For each prompt/context/tool/memory/retriever/flow/agent, show: source location and dependencies; runtime runs that used it; the decisions it produced; quality suites, baselines, and pass rates; lint findings and suppressions; classification and policy coverage.

### 4.2 PR/CI Review Mode

Builds on 3.3: a complete review surface for AI-system changes, with baseline status and governance regressions included.

### 4.3 Suggested Fixes

Extend lint fix suggestions to decision-report and freshness findings; group suggested fixes by user action (add eval coverage, add contract metadata, tighten condition, add freshness policy, add guardrail, add retention policy, reduce redundant context).

### Governance, Distributed

There is no separate governance phase. The items live inside the surface work:

- Classification metadata ships as decision-report fields (2.1) and artifact metadata.
- Boundary policies ship as declarations plus policy-decision artifacts (2.2).
- Governance assertions ship with the matcher wave (3.1); governance lints ship with health pages (4.1).
- The classification/boundary vocabulary is designed **once**, inside the open-spec effort (Phase 5), so incrementally shipped pieces share one model.

Enterprise-shaped governance (SSO/SCIM, audit exports, retention administration) is out of scope for the OSS roadmap and waits for real demand.

## Phase 5: The Open Specification

Goal: the turn-assembly vocabulary becomes a published contract, not just an implementation detail.

Existing foundation: Crux emits OTel GenAI-compatible spans where conventions exist; the conventions have no vocabulary for assembly decisions, budget arbitration, freshness, routing rationale, policy boundaries, or source provenance.

Work, once the vocabulary has stabilized in real usage:

- Publish the decision-provenance vocabulary (including the classification/boundary model) as an open specification.
- Position it as the semantic layer above standard GenAI telemetry.
- Design everything in Phases 2–4 with publication in mind; publication itself is not a launch blocker.

This specification is also the seed of the v2 adapter contract: it defines exactly what evidence an external runtime must emit to be a first-class citizen of the graph.

## Phase 6: Pluggable Runtime Profiles (v2)

Goal: users keep Crux-quality insight while swapping underlying implementations.

- Publish the composition model's contribution/evidence contracts for memory, flow, tool-loop, retrieval, agent, and orchestration runtimes.
- Separate execution from evidence: external runtimes execute; Crux records the authored/runtime/quality evidence.
- Compatibility suites validate that adapters emit enough evidence for Devtools, Quality, Project Index joins, and governance checks.
- Native Crux primitives remain the reference implementation and best default — never the only implementation.

Avoid: destabilizing native primitives too early; publishing adapter APIs before the internal evidence model is stable; weakening the local-first default experience.

## Phase 7: Advanced Reliability Workflows

Built on the mature graph:

- Automated context minimization: find redundant or low-impact context.
- Stale-context incident reports: identify runs affected by a bad source version or stale memory.
- Safety regression suites: replay representative traces against new policies.
- Provider migration reports: context, cost, quality, and safety differences across models — the payoff of the proactive stance, since a deterministic harness makes models swappable.
- Harness baselines: snapshot a full prompt/context/retrieval/memory/routing configuration and detect drift.

## Experimental Track: Context Planner

Deliberately outside the numbered phases. An optional planning layer that chooses among eligible context sources before normal resolution is a genuine long-term differentiator, but it must not fight the mission.

Ship conditions (binding, per the deterministic-assembly principle):

- Deterministic policies first; model-assisted planning only when it can be evaluated and constrained.
- Planner output compiles back into normal context contributions.
- Planner decisions emit decision reports, are replayable, and are assertable in quality suites.
- Sensitive context is never selectable by an unconstrained planner.
- Existing `use` behavior remains the default deterministic path.

## Suggested Near-Term Sequence

1. Reposition the front door: harness engineering, three layers, proactive vs reactive, honest status labels, compare-page updates (1.1–1.2).
2. Turn Decision Report read model (2.1).
3. Rationale artifacts for routing, consensus, swarm, fallback, and boundaries (2.2).
4. Unified freshness vocabulary, using existing TTL/cache/corpus evidence first (2.4).
5. ~10 harness-decision matchers with recipes, building to the test-driven harness design guide (3.1–3.2).
6. The flagship demo: one wrapper, whole turn explained — demo repo and video.
7. OTel GenAI semconv alignment plus documented decision-provenance namespace (groundwork for Phase 5).
8. CI JSON/Markdown outputs (3.3).
9. Context contracts and impact evaluation (2.3, 2.5), then health pages (4.1).

## Configuration Action Split

See [CRUX_CONFIG_STRATEGY.md](./CRUX_CONFIG_STRATEGY.md) for the detailed config strategy.

### Actionable Now

- Make `crux quality run` discovery depend on conventions by default: nearest package id, `.crux/quality`, `evals/**/*.eval.ts`, and `**/*.eval.ts`.
- Stop requiring or recommending `config({ prompts, contexts, tools })` for local Devtools, lint, or quality discovery.
- Add `crux config inspect` or an equivalent Project Model view that shows inferred roots, source roots, ignored paths, discovered definitions, quality assets, explicit config, and diagnostics.
- Add discovery diagnostics with minimal fixes: stable id missing, dynamic tool map not provable, suite target unknown, model-backed eval missing explicit executor/model, skipped generated source.
- Start moving Quality examples away from ambient `quality.setup` and toward eval-local imports/helpers for model-backed tasks.
- Move replay posture toward CLI/run-tier policy (`--ci`, `--replay replay-strict`, `--replay live`) instead of global setup where possible.
- Auto-attach local devtools only when a Crux-local dev environment provides the local URL; keep production telemetry explicit.

### Longer-Term

- Separate runtime setup from tooling policy, likely with an inert `defineConfig()` for CLI/indexer/cloud and a runtime API for behavior/plugins.
- Publish the resolved project model as a stable contract for cloud, CI, IDEs, and future adapters.
- Give every project-model field explicit provenance: source-inferred, runtime-observed, filesystem-conventional, config-explicit, or CLI-explicit.
- Make config inspection a first-class compatibility surface so changes to inference, ignored paths, quality assets, and policy overrides are reviewable.
- Let pluggable runtime profiles declare discovery and evidence capabilities.
- Let adapters declare inspectable resources, emitted evidence, required trust, and unsupported capabilities without becoming global registries.
- Add cloud/training boundary policy that controls upload, retention, classification, redaction, and dataset export without duplicating harness registration.
- Keep future cloud dashboards from becoming harness registries; cloud settings may govern upload, retention, access, teams, and policy, but the authored graph stays in code plus evidence.
- Add config drift review in CI: newly discovered definitions, missing quality coverage, changed replay/cassette status, changed cloud/training eligibility, and changed explicit policy.
- Design the future `defineConfig()` type as a policy schema with type-level separation between inert tooling policy and runtime behavior installation.

## Explicit Non-Goals

- Do not replace existing context resolution.
- Do not make planner behavior mandatory — or nondeterministic by default.
- Do not present scaffolding as shipped, or existing guardrails, budgets, caching, memory policies, matchers, or lint as missing.
- Do not move existing open-source features behind a paywall.
- Do not broaden into a hosted prompt-management platform before the local workflow is excellent.
- Do not compete on agent-framework breadth.
- Do not add privacy claims that Crux cannot enforce or test.
- Do not turn native primitives into unavoidable lock-in once stable adapter contracts can preserve the same insight model.
- Do not make central config or cloud dashboards duplicate harness structure already present in code.

## Open Questions

- Should context contract metadata live directly on `context()`, on a nested `policy` object, or on a generic `metadata` field shared by multiple primitives?
- Which freshness fields are universal enough for core, and which should be primitive-specific?
- Should sensitivity classification use fixed labels, project-defined labels, or both? (Scoped into the open-spec effort.)
- How much of context impact evaluation should be deterministic ablation versus LLM-judged summary?
- Which devtools screen becomes the primary home: run detail, project health, or definition detail?
- Should CI review mode be a separate command or an option on `crux lint` / `crux quality run`?
- Should `config()` and a future pure `defineConfig()` become separate APIs?
- What should `crux config inspect` show in monorepos with multiple Crux-using packages?
- Which cloud/training settings belong in repo config versus local credentials versus team policy?
