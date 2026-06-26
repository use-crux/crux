# Crux Problem/Solution Map

This document breaks down the problems Crux solves in service of the mission:

> Same Prompt. Same Output. Every Time.

The mission is harness determinism: every input to a model turn is deliberate, inspectable, and testable, so the same authored prompt, context, tools, memory, routing policy, and safety boundaries produce behavior that is explainable, reproducible, and improvable.

Crux's value has three layers (see [CRUX_VISION.md](./CRUX_VISION.md)):

- **The building blocks** — primitives that fill the gaps SDKs leave open (memory, guardrails, constraints, routing, fallback, plans, retrieval, quality). Valuable on their own; individually copyable; not the thing that sets Crux apart.
- **One composition model** — everything composes into the turn the same way, through `use[]`. The architectural decision that cannot be cheaply retrofitted.
- **One graph, one proof** — because everything enters the turn the same way, everything can be explained through one graph and tested through one harness, tied to source. This is the part competitors cannot easily reproduce.

The stance throughout is **proactive, not reactive**: most tools measure outputs after the fact and leave teams guessing why — and paying for stronger models to compensate for a weak harness. Crux measures what goes into each turn, in detail, and gives users the instruments to shape it until it is exactly right.

Crux provides this without replacing the user's SDK, provider, app framework, or agent framework. In the long term, the composition model's contribution-and-evidence contract should also let users adapt external memory, workflow, agent, retrieval, or orchestration runtimes while preserving the same composition, observability, quality, and governance model.

## The Core Problem

AI apps are unreliable because the model call is only one part of the system.

The output depends on:

- prompt text and system instructions;
- dynamic context;
- memory;
- retrieval and grounding;
- tools and tool-loop behavior;
- model routing and fallback;
- output constraints;
- safety and privacy policies;
- streaming and retries;
- orchestration patterns;
- eval coverage;
- source-code drift;
- runtime state and production data.

Most teams debug the final answer — reactively, from the outside. Crux helps them design, explain, and test the harness that produced it.

## Problem 1: The Prompt Is Not A Stable Unit

Symptoms:

- Prompts are scattered template strings.
- Shared instructions drift across files.
- Input requirements are implicit.
- Output expectations are only in comments or examples.
- Model-specific tweaks are hidden at call sites.

Crux solutions today:

- `prompt()` and `context()` as typed, inspectable data.
- Zod input/output schemas.
- `createPrompts()` and `createContexts()` for authored organization.
- Provider adaptation through prompt metadata instead of call-site forks.
- Project Index source discovery and source refs.
- Prompt inspection before execution.

What to improve:

- Make prompt/context contracts easier to understand in docs and Devtools.
- Show changed prompt/context contracts clearly in CI/PR review.
- Add stronger guidance around stable IDs and source-linked definitions.

## Problem 2: Context Is Included By Accident

Symptoms:

- Every call gets too much context.
- Important context is hidden behind runtime conditionals.
- Context is included even when irrelevant.
- Context is dropped under token pressure without users realizing.
- Tools appear because a context contributed them, but nobody knows which one.
- Data that should be private to a tool, workflow, or store is exposed directly to the model.
- Dynamic state is treated like static prompt text and accumulates across turns.

Crux solutions today:

- Conditional contexts through `when`, `when()`, `match()`, and falsy `use` entries.
- Context priority and token-budget dropping.
- `excludedContexts` and `droppedContexts`.
- `context.contribution` artifacts with source, inclusion state, tokens, cache status, and injected tools.
- Project Index injection read model with `expandedInputSchema` and `inputContributions`.

What to improve (in progress):

- A first-class per-turn decision report summarizing every inclusion decision with its reason.
- Context contract metadata for purpose, dependencies, sensitivity, and freshness.
- High-signal lints for dynamic or high-impact context without visible contracts.
- Context impact evaluation helpers.
- Explicit visibility modes for context and data: prompt-visible, conditional, on-demand, tool-only, private, and blocked.
- A matcher library that asserts inclusion decisions directly (today the facts are recorded; the assertions are still thin).

## Problem 3: Context Is Stale

Symptoms:

- Retrieved documents are out of date.
- Memory contains old or misleading facts.
- Account, billing, project, or workspace state changes between turns.
- Cached context is reused beyond its safe lifetime.
- Users cannot tell whether a bad answer came from stale state or a bad model.

Crux solutions today:

- Context resolver cache TTL.
- Semantic cache TTL and cache policy.
- Store TTL.
- Corpus sync source ledger and stale-source handling.
- Memory retention metadata and eviction guidance.
- Observability cache/stale states in several primitives.

What to improve (in progress):

- These TTL systems are currently independent. Define one freshness vocabulary across context, memory, retrieval, corpus, cache, and runtime artifacts.
- Record `observedAt`, `validUntil`, `sourceVersion`, or equivalent freshness evidence where the primitive can know it.
- Surface freshness evidence in Run Detail for every contribution that affected a generation.
- Add freshness-aware quality matchers.
- Add strict/experimental lints for dynamic context without freshness contracts.

## Problem 4: The System Cannot Explain A Bad Answer

Symptoms:

- Logs show the final request but not how it was assembled.
- Tool calls, memory reads, retrieval hits, guardrails, and routing decisions live in separate systems.
- Runtime traces cannot be tied back to source definitions.
- Teams cannot tell which part of the harness changed.

Crux solutions today:

- Canonical observability graph: one emitter, one contract, covering prompt/context resolution, memory, retrieval, tools, safety, routing, scoring, compaction, evals, and artifacts.
- Go read model for Run Detail.
- Project Index source intelligence and runtime joins.
- Devtools and TUI.
- OTel export with privacy-safe defaults, compatible with GenAI semantic conventions where they exist.

What to improve (in progress):

- The graph records most decisions but not yet all of their *reasons*. Add rationale artifacts: why a route was chosen, how a consensus vote split, why a fallback fired, which policy allowed a boundary crossing.
- Make the Run Detail view answer "why did this happen?" directly via the per-turn decision report.
- Add definition-centric health pages linking source, runtime runs, quality, lint, and governance.
- Document the turn-assembly vocabulary the OTel conventions lack, and publish it as an open specification when stable.

## Problem 5: Evals Only Judge The Final Text

Symptoms:

- Output looks good, but the model used the wrong source.
- A test passes even though context was dropped.
- A cheaper model was selected for a task that required a stronger one.
- A memory write happened when it should have been proposed.
- A safety redaction happened too late or not at all.

Crux solutions today:

- Quality suites, targets, experiments, cassettes, and baselines.
- Execution facts exposed for output, structured output, tools, retrieval, citations/grounding, usage/budgets, artifacts, safety, memory, workspace, routing, scoring, cache, compaction, embeddings, errors, retries, latency, events, spans, contexts, and handoffs.
- Trace-linked quality results.

What to improve (in progress):

- The execution facts exist; the matcher library that asserts harness decisions is still being built out. Ship matchers for context inclusion, freshness, routing policy, memory policy, guardrail actions, and fallback order.
- Make **test-driven harness design** the flagship workflow: describe the expected cases first, build the harness against them until behavior matches exactly, mark a baseline, and gate every change on at least that bar.
- Add recipes that assert context decisions, freshness, routing, memory policies, and safety boundaries.
- Add context ablation and context impact experiments.
- Make affected-eval suggestions visible in Project Health and CI.

## Problem 6: Tool Loops And Orchestration Are Hidden

Symptoms:

- Tool calls are hard to audit.
- SDKs differ in tool-loop behavior.
- Common patterns such as pipeline, parallel, consensus, swarm, handoff, and delegate are reimplemented differently in every app.
- Agent frameworks can orchestrate work, but the harness decisions around that work remain opaque.

Crux solutions today:

- SDK-agnostic tool definitions and tool middleware.
- Approval middleware.
- Native composition primitives: `pipeline()`, `parallel()`, `consensus()`, `swarm()`, `handoff()`, `delegate()`.
- Flow and plan/task primitives.
- Observability records for tools, compositions, handoffs, delegates, flows, plans, and tasks.

What to improve (in progress):

- These primitives are recorded but not yet fully *explained*. Apply the explanation-parity bar: consensus needs per-agent vote edges and disagreement evidence; swarm needs routing justification; compositions need reports on what was tried and why the result won — before any of them gains new capability.
- Keep these primitives framed as harness patterns, not an agent-framework replacement.
- Pass execution to the underlying SDK whenever possible; provide native execution only where required for portability, debuggability, or missing SDK behavior.
- Add visual explanations for common orchestration patterns in Devtools.

## Problem 6.5: Native Primitives Can Become Lock-In

Symptoms:

- Users like Crux observability but already have a memory framework.
- Users want durable workflows from another runtime but still want Crux `flow()`-level insight.
- Users want another agent framework's multi-agent execution but still want Crux routing, guardrails, context contracts, and quality.
- Crux-native primitives become the only path to first-class Devtools and Quality support.

Crux's answer: the composition contract.

- Every native primitive already participates through the same composition and evidence model. That model — how a block contributes to a turn and what evidence it must emit — is the adapter contract in waiting.
- Native primitives define the reference behavior and reporting shape; they are defaults, not lock-in.
- Runtime profiles already exist conceptually through packages such as `@use-crux/convex`.

What to improve (v2 scope):

- Publish the composition model's contribution and evidence contracts for memory, flows, tool loops, retrieval, agent execution, and orchestration patterns.
- Separate "Crux owns the insight contract" from "Crux owns the executor."
- Add compatibility test suites for adapters.
- Let adapted runtimes compose with Crux primitives where possible.

## Problem 7: Routing And Scaling Change Behavior

Symptoms:

- Model routing is hidden in application conditionals.
- Fallbacks change quality but are not evaluated.
- Cost reductions accidentally change behavior.
- Provider-specific prompt differences are not visible.
- Teams pay for expensive models to compensate for harness problems they cannot see.

Crux solutions today:

- `router()`, `cascade()`, fallback, model resolution, cost tracking, and routing reports.
- Provider-specific prompt adaptation.
- Quality facts for routing, usage, budgets, latency, and scoring.

What to improve (in progress):

- Routing decisions are recorded but not yet justified. Add rationale artifacts: why this model for this turn, what the alternatives were, what the cost/capability trade-off was.
- Make routing a first-order part of the determinism story: a solid harness works with almost any capable model, so model choice becomes a per-task (and per-subtask, eventually per-step) routing decision — exactly the capability you need, when you need it, at the price that fits.
- Add examples for model downgrade safety, fallback acceptance criteria, and provider migration checks.
- Add PR review summaries for routing-policy changes.

## Problem 8: Safety And Privacy Are Boundary Problems

Symptoms:

- PII is redacted from output but still appears in traces.
- Sensitive context is sent to the wrong provider.
- Memory writes store secrets.
- Tool calls receive data they should not receive.
- Cassettes, feedback, or eval records preserve sensitive fields.

Crux solutions today:

- Guardrails with block, redact, transform, warn, and hold.
- Guardrail pipelines, stream transforms, and guardrail evals.
- Memory policies with redact, validate, and should-remember hooks.
- Feedback redaction paths.
- Privacy-safe observability and OTel defaults.
- Lints for writable workspaces without guardrails and long-lived memory without retention.

What to improve (in progress):

- These redaction and policy layers work independently; privacy is not yet a coordinated graph property. Treat it as data flow through the harness.
- Add classification metadata for context contributions and artifacts.
- Define boundary policies for provider requests, tools, memory writes, retrieval, workspace writes, feedback, cassettes, and telemetry — and emit policy decision artifacts when data crosses a boundary.
- Design the classification/boundary vocabulary once, inside the open-spec effort, so the pieces that ship incrementally share one model.
- Add quality matchers and lints for policy-boundary behavior.

## Problem 9: Teams Cannot Review AI-System Changes

Symptoms:

- Prompt changes are reviewed as text diffs.
- Context changes do not show affected prompts.
- Retriever changes do not show affected evals.
- Safety/routing/memory changes do not show runtime impact.
- Reviewers cannot tell what quality evidence protects a change.

Crux solutions today:

- Project Index definitions and relations.
- Quality joins and lint findings.
- `crux lint` and `crux quality run`.
- Source refs and runtime joins.

What to improve:

- Add CI/PR review mode for changed AI definitions.
- Summarize affected prompts, contexts, tools, retrievers, flows, agents, evals, baselines, and lints.
- Show contract/freshness/governance changes explicitly.
- Show baseline status: which baselines cover the change, and whether they still pass.
- Provide Markdown output for PR comments and JSON for CI.

## Problem 10: Users Need Different Amounts Of Crux

Symptoms:

- Some teams only need typed prompts and context inspection.
- Some need memory and retrieval.
- Some need full quality, routing, safety, orchestration, and governance.
- Heavy frameworks scare users who want one primitive at a time.

Crux solutions today:

- Small primitives that compose through one model.
- SDK-agnostic adapters.
- Local-first workflow.
- No required hosted platform.
- Optional devtools and observability.

What to improve:

- Make docs clearly support the "use 5% or 100%" story with many honest entry points: typed prompts only; prompts plus contexts; memory for an SDK that has none; guardrails that compose; context plus evals; full harness.
- Make the flagship demo the moment visitors discover the composition model and the source-linked graph: one wrapper around an existing SDK call, then the whole turn explained in devtools.
- Keep APIs modular and avoid framework gravity.
- Show adapter paths for teams that want Crux insight around existing memory, flow, agent, or retrieval systems.

## Problem 11: Configuration Becomes A Second Product

Symptoms:

- Users define prompts, contexts, stores, memories, retrievers, tools, and suites in code, then must also register them in a central config object.
- A forgotten config entry makes authored code invisible to Devtools, Quality, or lint.
- A dashboard or config file becomes a second source of truth for harness behavior.
- Global `setup()` functions hide model, provider, or executor dependencies from the suite that uses them.
- Users cannot tell which settings came from code, defaults, CLI flags, environment, local config, or cloud policy.

Crux solutions today:

- Project Index discovers many authored definitions from source.
- `createPrompts()` and `createContexts()` preserve typed namespace paths.
- Contexts used by prompts are auto-collected.
- Runtime snapshots enrich source-indexed definitions.
- Quality definitions are already discovered by convention in projects such as Karyla backend.

What to improve:

- Make local tools work from source discovery without `config({ prompts })`.
- Treat `crux.config.ts` as policy/override/trust/boundary config, not primitive registration.
- Add a resolved project model view showing inferred values, explicit overrides, source locations, and diagnostics.
- Move Quality away from ambient global `setup()` toward eval-local imports/helpers for model-backed tasks.
- Keep cloud/training config focused on upload, retention, classification, and dataset eligibility, not harness registration.

## Prioritized Solution Themes

### Theme 1: The Deliberate Turn

The core focus. Deliver:

- Per-turn decision report covering the whole turn: context decisions, routing rationale, guardrail actions, budget drops, freshness, fallback plan.
- Rationale artifacts for routing, consensus, swarm, and policy boundaries.
- Context contract metadata.
- One freshness vocabulary across all TTL systems.
- High-signal context lints.
- Classification metadata rides along on decision-report fields.

### Theme 2: Harness Evals And Test-Driven Harness Design

Deliver:

- Matchers that assert harness decisions: inclusion, freshness, routing policy, memory policy, guardrail actions, fallback order.
- The test-driven harness design workflow: cases first, harness until green, baseline, CI enforces the bar.
- Context impact and ablation experiments.
- Boundary-policy assertions.
- Affected-eval suggestions.

### Theme 3: Source-To-Runtime Reliability Graph

Deliver:

- Definition-centric health views.
- Runtime joins that are easy to understand.
- PR/CI review summaries with baseline status.
- Better lint/fix workflows, including governance lints.

### Theme 4: Accessible Native Patterns

Deliver:

- Explanation parity for orchestration primitives (vote edges, routing justification, composition reports) before new capability.
- Better docs and visualizations for pipeline, parallel, consensus, swarm, handoff, delegate, routing, and tool loops.
- Clear guidance that these are harness patterns, not framework lock-in.

### Theme 5: The Open Specification

When the vocabulary stabilizes in real usage:

- Publish the turn-assembly/decision-provenance vocabulary as an open specification, including the classification and boundary model.
- Position it as the layer the OTel GenAI conventions do not cover.

### Theme 6: Pluggable Runtime Profiles

Long-term v2 direction. Deliver:

- The composition model's contribution/evidence contracts as published adapter interfaces.
- Compatibility suites proving adapters emit enough evidence for Devtools, Quality, governance, and Project Index joins.
- Documentation for "bring your own memory/workflow/agent runtime."

### Theme 7: Optional Config And Project Discovery

Deliver:

- No central registry tax for local tools.
- Source-discovered prompts, contexts, tools, memory, retrieval, flows, agents, safety, and quality suites.
- A resolved project model inspector.
- Discovery diagnostics with minimal fixes.
- Explicit config only for behavior, policy, trust, data movement, and unusual overrides.

## Beyond The Ten Problems (Long-Horizon)

The ten problems above are the near-term focus. One forward-looking problem is worth naming so today's seams are designed for it, without building it yet: **as the model commoditizes, the durable asset becomes the harness and the curated, eval-scored dataset it produces.** A deterministic, provable harness emits (context, decision, output, quality verdict) records as a byproduct; the same baselines that prove the harness can certify a specialized or distilled model built from those records. See the vision's [The Horizon](./CRUX_VISION.md#the-horizon).

The only near-term implication: keep cassettes and traces designed as clean, governed, eligibility-gated, exportable records (this rides Problem 8's privacy-as-graph-property work). Everything else — distillation, certification, auto-tune — is "design the seams, build when there are users," and Crux owns no GPUs and hosts no weights.

## What To Say No To

- Generic prompt management as the main product.
- Generic cloud observability as the main product.
- Broad agent-framework positioning.
- Provider abstraction as the core mission.
- More primitives before the existing ones meet the explanation-parity bar.
- Enterprise governance claims before local turn correctness is excellent.
- Owning GPUs or hosting weights; training execution is always delegated to a provider.
- Presenting scaffolding as shipped.

## The Product Test

Before adding a feature, ask:

1. Does this make the same prompt more likely to produce the same output?
2. Does it make harness behavior easier to inspect — with reasons, not just outcomes?
3. Does it make context, tools, memory, retrieval, routing, or safety more testable?
4. Does it keep turn assembly deterministic — and if not, is it replayable and assertable?
5. Does it preserve SDK choice and avoid unnecessary framework lock-in?
6. Can it be represented in the authored graph, runtime graph, or quality graph?
7. Could an external runtime implement the same insight contract later?
8. Does this avoid a duplicate-registration failure mode?

If the answer is no, it probably does not belong in Crux core.
