# Turn Decision Report V0

## Purpose

Turn Decision Report V0 is the normalized per-turn read model that explains what went into a model
turn, why it was assembled that way, where each part came from, and which evidence/source definition
supports it.

It is not a new tracing format. It is a deterministic projection over Crux's existing observability
graph, Project Index Read Model, and Quality records. Its job is to make the turn understandable and
testable without asking users to inspect raw spans, artifacts, and source joins by hand.

Market context matters here:

- OTel GenAI semantic conventions are standardizing model-call capture, but not Crux's
  source-linked turn assembly semantics.
- MCP standardizes tools, resources, and prompts as transport concepts, but not source-linked
  harness decisions.
- OpenAI Agents, Vercel AI SDK, Google ADK, LangSmith, Langfuse, and Braintrust are moving quickly
  on tracing, evals, and agent observability. Crux's wedge is source-linked, reason-bearing,
  testable turn assembly.

## Product Problem

Today Crux can show many of the raw facts that influenced a generation:

- context contributions
- prompt budget drops
- routing reports
- guardrail, constraint, security, cache, and compaction reports
- tool calls and artifacts
- retrieval and memory artifacts
- Project Index source definitions
- Quality baselines, experiments, assertions, and trace-backed signals

The missing product layer is a single per-turn explanation that answers:

1. What did the model see?
2. What was checked but not included?
3. What was dropped, redacted, blocked, cached, refreshed, or retried?
4. Which model was selected, and what fallback or cascade behavior fired?
5. Which authored source definition caused this thing to exist?
6. Which quality baseline or assertion covers this definition or this trace, when available?
7. Which claims are supported by explicit evidence, and which are only observed outcomes?

Without that layer, Run Detail can feel like an accurate event log rather than a usable explanation.
The user has to know where to look and how to join records.

## User Story

As a prompt, agent, or evaluation author, I want to open one model turn and see the assembled request,
the decisions that shaped it, and the source/quality evidence for those decisions, so that I can
debug failures, write assertions, and change the right authored definition instead of guessing from
the final answer.

The first V0 user flow should be:

1. Open a run.
2. Select a generation turn.
3. See "What the model saw" first: messages, context contributions, tools, budget, and dropped items.
4. Expand "Why this happened" for decision groups: request assembly, model selection, checks, tool
   and data use, recovery, and efficiency.
5. Click any decision to see evidence refs, source definition refs, and quality coverage if present.

## Core Design Principles

### 1. Read model, not raw schema

Turn Decision Report is a projection. It should not create a second observability schema or duplicate
raw spans. Every decision row must link back to one or more canonical evidence records:

- span
- artifact
- event
- edge
- Project Index definition/source ref
- Quality record/assertion/baseline

If there is no supporting evidence, the report should show a gap, not invent a reason.

### 2. The "why" must be qualified

Crux often has outcome evidence today, not full rationale evidence. For example, a router report can
prove which route was selected and which model was used. It may not prove the complete business
reason the author expected that route to win.

Every reason in V0 should carry an evidence level:

- `declared`: a first-party report or artifact explicitly provided the reason.
- `observed`: the graph proves the outcome, but not necessarily the author's rationale.
- `inferred`: the projection derived a reason from current fields or strings.
- `missing`: Crux knows the decision happened, but does not have enough evidence to explain why.

This prevents the UI from overpromising model or harness rationale.

### 3. Stable codes, flexible text

Machine-facing tests and matchers should use stable `reasonCode` values. Human-facing copy should be
separate `reason.text` that can improve over time.

Existing strings like `token budget`, `when() predicate returned false`, and `no case for "x" and no
default` can be displayed, but V0 should map them to stable codes. Future artifacts should emit
stable reason codes directly.

### 4. Source joins are annotations, not required input

The raw report should be buildable from observability records alone. Source links from the Project
Index Read Model should enrich decisions when available.

This keeps the projection useful for:

- runs captured before an index exists
- external/imported traces
- anonymous or dynamic runtime definitions
- failing index states

### 5. Quality joins are coverage, not verdict invention

Quality links should say which baseline, suite, experiment, cassette, feedback, or assertion covers a
decision or definition. V0 should not invent pass/fail meaning unless the Quality record has that
trace-backed signal.

## V0 Product Scope

### Included In V0

V0 should include decisions for:

- Context contributions:
  - included
  - checked but not included
  - disabled
  - dropped by budget
  - cached, when cache status is present
- Prompt budget:
  - used tokens
  - total tokens
  - dropped contexts
- Tool eligibility:
  - tools available to the model
  - tools injected by context/resources when known
  - tool calls/results when present
- Routing:
  - selected model
  - router chosen route
  - cascade tier outcomes
  - fallback attempts and firings
- Checks:
  - guardrail reports
  - constraint reports
  - security reports
- Efficiency/data shaping:
  - cache reports
  - compaction reports
  - retrieval hits
  - memory recall/diff/snapshot artifacts
- Source annotations:
  - Project Index definition ID when resolvable
  - source refs and snippets when available
  - unresolved/ambiguous source join state when not resolvable
- Quality annotations:
  - baselines, suites, experiments, cassettes, feedback, and assertion matchers when available
  - direct trace coverage when a Quality record references this run/trace/span
  - definition-level coverage when only source definition linkage is available

### Deferred From V0

V0 should explicitly defer:

- Full routing rationale beyond existing router/cascade/fallback evidence.
- Consensus votes, swarm decisions, planner decisions, and multi-agent deliberation.
- Cost/capability alternative analysis unless already recorded in a report.
- Unified freshness semantics across retrieval, cache, memory, and source files.
- Context contract metadata enforcement and matcher DSL for turn decisions.
- Policy-boundary explanations for allowed/blocked/redacted content unless a report exists.
- Impact analysis such as "this context helped", "this context hurt", or "this context was redundant".
- Model internal reasoning or chain-of-thought.
- Suggested fixes and automated PR generation.
- Adapter compatibility guarantees for OpenAI Agents, AI SDK, LangSmith, Langfuse, Braintrust, or
  OTel exporter output.

## Schema Proposal

V0 should be both:

- a TypeScript contract in `@use-crux/core`, so SDK users, devtools, tests, and future matchers share the
  same JSON shape
- a Go read-model projection in Crux Local, so Run Detail can serve it from the canonical graph

The TypeScript contract should be the normative public shape. The Go type should mirror that shape
for the local API response.

### Placement

Preferred TypeScript placement:

- new file: `packages/core/observability/turn-decision-report.ts`
- export from: `packages/core/observability/index.ts`
- optionally re-export from `packages/core/observability/contract.ts` only if the current package
  export pattern requires it

Preferred Go placement:

- new file: `packages/local/internal/observability/decision_report.go`
- add optional `decisionReport` field to generation nodes/details in
  `packages/local/internal/observability/service.go`
- invoke projection from `packages/local/internal/observability/projection.go` after request
  composition has been applied

### Top-Level Shape

```ts
export interface TurnDecisionReport {
  schemaVersion: 1;
  reportId: TurnDecisionReportId;
  runId: CruxRunId | string;
  traceId?: CruxTraceId | string;
  turn: TurnDecisionTurn;
  coverage: TurnDecisionCoverage;
  summary: TurnDecisionSummary;
  decisions: TurnDecision[];
  diagnostics?: TurnDecisionDiagnostic[];
}
```

`reportId` should be deterministic for a run-detail projection:

```ts
type TurnDecisionReportId = string; // e.g. `tdr:${runId}:${generationSpanId}`
```

Use a branded type if this lands in TypeScript:

```ts
export type TurnDecisionReportId = string & { readonly __brand: 'TurnDecisionReportId' };
export type TurnDecisionId = string & { readonly __brand: 'TurnDecisionId' };
```

### Turn Metadata

```ts
export interface TurnDecisionTurn {
  spanId: CruxSpanId | string;
  primitive: 'generation.call' | 'generation.stream' | string;
  label?: string;
  status?: CruxSpanStatus | string;
  promptId?: string;
  model?: string;
  provider?: string;
  startedAt?: string;
  endedAt?: string;
}
```

### Coverage

Coverage tells the UI and tests what the report could and could not prove.

```ts
export interface TurnDecisionCoverage {
  request: TurnCoverageState;
  contributions: TurnCoverageState;
  budget: TurnCoverageState;
  routing: TurnCoverageState;
  checks: TurnCoverageState;
  tools: TurnCoverageState;
  retrieval: TurnCoverageState;
  memory: TurnCoverageState;
  source: TurnCoverageState;
  quality: TurnCoverageState;
  gaps: TurnDecisionGap[];
}

export type TurnCoverageState = 'present' | 'partial' | 'absent' | 'not-applicable';

export interface TurnDecisionGap {
  code: TurnDecisionGapCode;
  text: string;
  evidence?: TurnEvidenceRef[];
}
```

Example gap codes:

```ts
export type TurnDecisionGapCode =
  | 'request.messages.missing'
  | 'request.consumed_edges.missing'
  | 'context.reason.missing'
  | 'routing.report.missing'
  | 'routing.rationale.missing'
  | 'quality.snapshot.unavailable'
  | 'source.index.unavailable'
  | 'source.definition.unresolved'
  | 'tool.source.unresolved';
```

### Summary

Summary is deliberately small. It powers the Run Detail header and lets tests assert the report's
shape without walking every decision row.

```ts
export interface TurnDecisionSummary {
  request: {
    includedContributions: number;
    excludedContributions: number;
    droppedContributions: number;
    toolCount: number;
    usedTokens?: number;
    totalTokens?: number;
  };
  routing: {
    selectedModel?: string;
    routed: boolean;
    fallbackUsed: boolean;
    cascadeUsed: boolean;
  };
  checks: {
    guardrails: number;
    constraints: number;
    securityReports: number;
    blocked: number;
    warnings: number;
  };
  data: {
    retrievalHits: number;
    memoryReads: number;
    memoryWrites: number;
  };
}
```

### Decision Union

Use a discriminated union rather than a single bag of optional fields.

```ts
export type TurnDecision =
  | TurnContributionDecision
  | TurnBudgetDecision
  | TurnToolDecision
  | TurnRoutingDecision
  | TurnFallbackDecision
  | TurnGuardrailDecision
  | TurnConstraintDecision
  | TurnSecurityDecision
  | TurnCacheDecision
  | TurnCompactionDecision
  | TurnRetrievalDecision
  | TurnMemoryDecision;
```

All decisions share a common base:

```ts
export interface TurnDecisionBase {
  id: TurnDecisionId;
  order: number;
  phase: TurnDecisionPhase;
  kind: string;
  outcome: string;
  subject: TurnDecisionSubject;
  reason: TurnDecisionReason;
  evidence: TurnEvidenceRef[];
  source?: TurnSourceJoin;
  quality?: TurnQualityJoin[];
  metrics?: TurnDecisionMetrics;
  related?: TurnDecisionRelated;
}
```

Decision phases:

```ts
export type TurnDecisionPhase =
  | 'request'
  | 'model-selection'
  | 'checks'
  | 'tool-use'
  | 'data'
  | 'recovery'
  | 'efficiency';
```

Reason:

```ts
export interface TurnDecisionReason {
  code: TurnReasonCode;
  text: string;
  evidenceLevel: 'declared' | 'observed' | 'inferred' | 'missing';
  source: 'artifact' | 'span-attribute' | 'event' | 'edge' | 'projection' | 'not-recorded';
}
```

Subject:

```ts
export interface TurnDecisionSubject {
  kind:
    | 'context'
    | 'prompt-budget'
    | 'tool'
    | 'model'
    | 'route'
    | 'guardrail'
    | 'constraint'
    | 'security-check'
    | 'cache'
    | 'compaction'
    | 'retrieval'
    | 'memory'
    | 'generation';
  id?: string;
  name?: string;
  label?: string;
}
```

Metrics:

```ts
export interface TurnDecisionMetrics {
  tokens?: number;
  staticTokens?: number;
  dynamicTokens?: number;
  priority?: number;
  sizeBytes?: number;
  durationMs?: number;
  costUsd?: number;
  score?: number;
  confidence?: number;
}
```

Related:

```ts
export interface TurnDecisionRelated {
  parentDecisionId?: TurnDecisionId | string;
  childDecisionIds?: Array<TurnDecisionId | string>;
  sourceDecisionIds?: Array<TurnDecisionId | string>;
}
```

### Concrete Decision Variants

Contribution decisions:

```ts
export interface TurnContributionDecision extends TurnDecisionBase {
  kind: 'contribution';
  phase: 'request';
  outcome:
    | 'included'
    | 'checked-not-included'
    | 'dropped-budget'
    | 'disabled'
    | 'unknown';
  subject: TurnDecisionSubject & { kind: 'context' };
  contribution: {
    sourceId?: string;
    injectableKind?: string;
    branch?: string;
    injects?: string[];
    injectedTools?: string[];
    cacheStatus?: string;
    segments?: Array<{
      id: string;
      label?: string;
      tokens?: number;
      state?: string;
    }>;
    previewText?: string;
  };
}
```

Budget decisions:

```ts
export interface TurnBudgetDecision extends TurnDecisionBase {
  kind: 'budget';
  phase: 'request';
  outcome: 'applied' | 'not-configured' | 'exceeded' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'prompt-budget' };
  budget: {
    usedTokens?: number;
    totalTokens?: number;
    droppedCount: number;
    droppedDecisionIds?: Array<TurnDecisionId | string>;
  };
}
```

Tool decisions:

```ts
export interface TurnToolDecision extends TurnDecisionBase {
  kind: 'tool';
  phase: 'request' | 'tool-use';
  outcome: 'eligible' | 'called' | 'approved' | 'denied' | 'result' | 'errored' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'tool' };
  tool: {
    name: string;
    origin?: 'request' | 'context-injection' | 'runtime' | 'unknown';
    sourceIds?: string[];
    callSpanId?: CruxSpanId | string;
    resultArtifactId?: CruxArtifactId | string;
  };
}
```

Routing decisions:

```ts
export interface TurnRoutingDecision extends TurnDecisionBase {
  kind: 'routing';
  phase: 'model-selection';
  outcome:
    | 'router-selected'
    | 'cascade-tier-accepted'
    | 'cascade-tier-rejected'
    | 'cascade-tier-skipped'
    | 'model-selected'
    | 'unknown';
  subject: TurnDecisionSubject & { kind: 'route' | 'model' };
  routing: {
    routingKind?: 'router' | 'cascade' | 'fallback' | string;
    routingId?: string;
    routeKey?: string;
    selectedModel?: string;
    classifiedAs?: string;
    tier?: number;
    verdict?: string;
    note?: string;
    availableRoutes?: string[];
  };
}
```

Fallback decisions:

```ts
export interface TurnFallbackDecision extends TurnDecisionBase {
  kind: 'fallback';
  phase: 'recovery';
  outcome:
    | 'attempt-started'
    | 'attempt-succeeded'
    | 'attempt-failed'
    | 'fallback-fired'
    | 'fallback-exhausted'
    | 'not-attempted';
  subject: TurnDecisionSubject & { kind: 'model' };
  fallback: {
    attempt?: number;
    routingId?: string;
    model?: string;
    totalModels?: number;
    errorCategory?: string;
    willAttemptFallback?: boolean;
  };
}
```

Guardrail, constraint, and security decisions should preserve their report payloads in a compact,
typed wrapper instead of flattening every provider-specific field:

```ts
export interface TurnGuardrailDecision extends TurnDecisionBase {
  kind: 'guardrail';
  phase: 'checks';
  outcome: 'passed' | 'warned' | 'blocked' | 'redacted' | 'transformed' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'guardrail' };
  guardrail: {
    action?: string;
    reason?: string;
    reportArtifactId?: CruxArtifactId | string;
  };
}

export interface TurnConstraintDecision extends TurnDecisionBase {
  kind: 'constraint';
  phase: 'checks';
  outcome: 'passed' | 'failed' | 'retry-requested' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'constraint' };
  constraint: {
    reportArtifactId?: CruxArtifactId | string;
    retryCount?: number;
  };
}

export interface TurnSecurityDecision extends TurnDecisionBase {
  kind: 'security';
  phase: 'checks';
  outcome: 'passed' | 'warned' | 'blocked' | 'redacted' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'security-check' };
  security: {
    reportArtifactId?: CruxArtifactId | string;
    severity?: string;
  };
}
```

Cache, compaction, retrieval, and memory decisions:

```ts
export interface TurnCacheDecision extends TurnDecisionBase {
  kind: 'cache';
  phase: 'efficiency';
  outcome: 'hit' | 'miss' | 'write' | 'disabled' | 'mixed' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'cache' | 'context' };
  cache: {
    status?: string;
    reportArtifactId?: CruxArtifactId | string;
  };
}

export interface TurnCompactionDecision extends TurnDecisionBase {
  kind: 'compaction';
  phase: 'efficiency';
  outcome: 'applied' | 'skipped' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'compaction' };
  compaction: {
    reportArtifactId?: CruxArtifactId | string;
    beforeTokens?: number;
    afterTokens?: number;
  };
}

export interface TurnRetrievalDecision extends TurnDecisionBase {
  kind: 'retrieval';
  phase: 'data';
  outcome: 'returned-hits' | 'returned-empty' | 'errored' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'retrieval' };
  retrieval: {
    hitCount?: number;
    retrieverId?: string;
    reportArtifactId?: CruxArtifactId | string;
  };
}

export interface TurnMemoryDecision extends TurnDecisionBase {
  kind: 'memory';
  phase: 'data';
  outcome: 'recalled' | 'written' | 'updated' | 'skipped' | 'unknown';
  subject: TurnDecisionSubject & { kind: 'memory' };
  memory: {
    memoryId?: string;
    operation?: string;
    artifactId?: CruxArtifactId | string;
  };
}
```

### Evidence References

Evidence references are the escape hatch that keeps the report small and honest.

```ts
export type TurnEvidenceRef =
  | TurnSpanEvidenceRef
  | TurnArtifactEvidenceRef
  | TurnEventEvidenceRef
  | TurnEdgeEvidenceRef;

export interface TurnSpanEvidenceRef {
  kind: 'span';
  spanId: CruxSpanId | string;
  primitive?: string;
  role:
    | 'turn'
    | 'owner'
    | 'predicate'
    | 'routing'
    | 'guard'
    | 'tool'
    | 'retrieval'
    | 'memory'
    | 'cache'
    | 'fallback';
}

export interface TurnArtifactEvidenceRef {
  kind: 'artifact';
  artifactId: CruxArtifactId | string;
  artifactKind: string;
  spanId?: CruxSpanId | string;
  role:
    | 'request'
    | 'preview'
    | 'report'
    | 'budget'
    | 'input'
    | 'output'
    | 'tool-args'
    | 'tool-result';
}

export interface TurnEventEvidenceRef {
  kind: 'event';
  spanId: CruxSpanId | string;
  name: string;
  role: 'routing' | 'fallback' | 'retry' | 'budget' | 'other';
}

export interface TurnEdgeEvidenceRef {
  kind: 'edge';
  edgeType: string;
  fromId?: string;
  toId?: string;
  role: 'consumed' | 'explains' | 'fallback' | 'derived' | 'other';
}
```

### Source Joins

Source joins connect decisions to authored Project Index definitions.

```ts
export interface TurnSourceJoin {
  definitionId?: string;
  definitionKind?: string;
  name?: string;
  source?: {
    file?: string;
    line?: number;
    column?: number;
  };
  sourceRefs?: Array<{
    role?: string;
    file?: string;
    line?: number;
    column?: number;
    snippet?: string;
  }>;
  fidelity: 'exact' | 'runtime-join' | 'source-id' | 'inferred' | 'unresolved';
  unresolvedReason?:
    | 'anonymous'
    | 'dynamic'
    | 'missing-index'
    | 'ambiguous'
    | 'missing-runtime-join'
    | 'unknown';
}
```

Source resolution order should be:

1. Existing Project Runtime Join keyed by primitive and source identifiers.
2. Exact Project Definition ID from `sourceId` conventions, such as `context:{id}`,
   `prompt:{id}`, `tool:{name}`, `routing.router:{id}`, or related runtime metadata.
3. Definition source refs and source snippets from the Project Index Read Model.
4. Best-effort inferred join from stable runtime IDs.
5. Explicit unresolved state.

Do not mutate the raw Project Index Snapshot to support this. The enriched Project Index Read Model
is the right source for source joins.

### Quality Joins

Quality joins connect decisions to assertions and baselines without implying a stronger verdict than
the record supports.

```ts
export interface TurnQualityJoin {
  level: 'turn' | 'definition' | 'assertion';
  coverage:
    | 'baseline'
    | 'experiment'
    | 'suite'
    | 'cassette'
    | 'feedback'
    | 'quality-run'
    | 'none';
  confidence: 'direct-trace' | 'definition-coverage' | 'none';
  evalIds?: string[];
  suiteIds?: string[];
  experimentIds?: string[];
  baselineIds?: string[];
  comparisonIds?: string[];
  feedbackIds?: string[];
  cassettePaths?: string[];
  caseIds?: string[];
  traceIds?: string[];
  assertionMatchers?: string[];
  status?: 'passed' | 'failed' | 'running' | 'unknown';
  changedSinceBaseline?: boolean;
}
```

Quality resolution order should be:

1. Direct trace/run/case references from Quality records.
2. Project Definition `quality` metadata from the Project Index Read Model.
3. Target ID conventions used by QualityFS, such as raw ID, `prompt:{id}`, `flow:{id}`,
   `agent:{id}`, `rag.pipeline:{id}`, and `tool:{name}`.
4. Explicit `coverage: 'none'` only when the UI needs to show a checked-but-uncovered state.

## Stable Reason Codes

V0 should define a small stable code set and allow unknown/custom codes for forward compatibility.
The projection can start with these codes:

```ts
export type TurnReasonCode =
  | 'context.included'
  | 'context.excluded.when_false'
  | 'context.excluded.match_no_case'
  | 'context.excluded.disabled'
  | 'context.dropped.token_budget'
  | 'context.cache.hit'
  | 'context.cache.miss'
  | 'context.cache.disabled'
  | 'budget.applied'
  | 'budget.not_configured'
  | 'tool.eligible.request'
  | 'tool.eligible.context_injection'
  | 'tool.called'
  | 'tool.result'
  | 'routing.router.selected'
  | 'routing.router.default_route'
  | 'routing.router.forced_route'
  | 'routing.cascade.tier_accepted'
  | 'routing.cascade.tier_rejected'
  | 'routing.cascade.tier_skipped'
  | 'routing.cascade.budget_exceeded'
  | 'routing.fallback.attempt_started'
  | 'routing.fallback.attempt_failed'
  | 'routing.fallback.attempt_succeeded'
  | 'routing.fallback.fired'
  | 'guardrail.passed'
  | 'guardrail.warned'
  | 'guardrail.blocked'
  | 'guardrail.redacted'
  | 'guardrail.transformed'
  | 'constraint.passed'
  | 'constraint.failed'
  | 'constraint.retry_requested'
  | 'security.passed'
  | 'security.warned'
  | 'security.blocked'
  | 'security.redacted'
  | 'cache.hit'
  | 'cache.miss'
  | 'cache.write'
  | 'cache.mixed'
  | 'compaction.applied'
  | 'compaction.skipped'
  | 'retrieval.returned_hits'
  | 'retrieval.returned_empty'
  | 'memory.recalled'
  | 'memory.written'
  | 'memory.updated'
  | 'reason.missing'
  | `custom.${string}`
  | `unknown.${string}`;
```

Mapping current human strings:

| Current evidence text | V0 reason code | Evidence level |
| --- | --- | --- |
| `token budget` | `context.dropped.token_budget` | `declared` if from `prompt.budget`, otherwise `inferred` |
| `when() predicate returned false` | `context.excluded.when_false` | `declared` |
| `context-level when returned false` | `context.excluded.when_false` | `declared` |
| `no case for "x" and no default` | `context.excluded.match_no_case` | `declared` |
| Missing contribution reason with included state | `context.included` | `observed` |
| Missing routing rationale with selected model | `routing.router.selected` or `routing.cascade.tier_accepted` | `observed` |

The UI should show the human text, but tests and future matchers should assert the code.

## Evidence Mapping

| Existing evidence | Current location | V0 field(s) | Notes |
| --- | --- | --- | --- |
| `generation.call` / `generation.stream` span | `packages/core/orchestrate.ts` | `turn`, report ownership, turn evidence | The report is per generation turn. |
| Messages/input artifact | `packages/core/orchestrate.ts`, projected by `request_composition.go` | request summary, evidence refs | Supports "what the model saw." |
| `systemBlocks` and consumed edges | `packages/core/resolve.ts`, `orchestrate.ts`, `request_composition.go` | contribution order, request evidence | Prefer these over time-order guesses. |
| `context.contribution` active | `resolve.ts`, `resolver/driver.ts` | `TurnContributionDecision` outcome `included` | Includes sourceId, injectableKind, priority, tokens, cacheStatus, injectedTools, segments, text. |
| `context.contribution` checked-not-included | `resolver/driver.ts`, `resolver/lower.ts` | `TurnContributionDecision` outcome `checked-not-included` | Reasons come from gate/match/predicate facts. |
| `context.contribution` disabled | `resolver/driver.ts` | `TurnContributionDecision` outcome `disabled` | V0 should preserve this as distinct from excluded. |
| `prompt.budget` | `resolve.ts` | `TurnBudgetDecision`, dropped contribution decisions | Dropped contexts should be visible next to included contexts. |
| `cacheStatus` on contribution | `resolve.ts`, `resolver/driver.ts` | contribution metrics plus `TurnCacheDecision` when useful | Context cache state is local to the contribution. |
| `cache.report` | core cache primitives, Run Detail inspection | `TurnCacheDecision` | Report-level cache behavior belongs under efficiency. |
| Request tools from `RunDetailRequest.Tools` | `request_composition.go` | `TurnToolDecision` outcome `eligible` | Origin can be request, context-injection, or unknown. |
| `tool.request`, `tool.args`, `tool.result`, tool spans | observability contract/core tool execution | `TurnToolDecision` outcomes `called`, `result`, `errored` | Source join may be weak unless tool definition is indexed. |
| `routing.report` router | `packages/core/routing/resolve.ts` | `TurnRoutingDecision` outcome `router-selected` | Has chosen route/model, available routes, default/override events. |
| `routing.report` cascade | `packages/core/routing/resolve.ts` | `TurnRoutingDecision` tier decisions | Has verdict, note, confidence, budget/cost/duration. |
| `fallback.attempt` spans | `packages/core/orchestrate.ts` | `TurnFallbackDecision` | Has attempt, model, status, errorCategory, willAttemptFallback. |
| fallback edges | `packages/core/orchestrate.ts` | fallback evidence refs/related decisions | Shows relation from failed attempt to next attempt. |
| `guardrail.report` | guardrail pipeline | `TurnGuardrailDecision` | Preserve action/reason without over-flattening. |
| `constraint.report` | constraint runner | `TurnConstraintDecision` | Retry behavior can be represented when emitted. |
| `security.report` | security checks | `TurnSecurityDecision` | Treat as checks, not routing. |
| `compaction.report` | compaction primitives | `TurnCompactionDecision` | Belongs under efficiency/data shaping. |
| `retrieval.hits` | retrieval primitives | `TurnRetrievalDecision` | V0 should not assume hits were included in prompt unless linked via contribution/request evidence. |
| `memory.recall`, `memory.diff`, `memory.snapshot` | memory primitives | `TurnMemoryDecision` | Distinguish recall/write/update where artifact kind allows it. |
| Project Runtime Joins | Project Index / local read model | `source` | Best source for exact runtime-to-definition links. |
| Project Definition source refs | `packages/core/project-index/index.ts` | `source.sourceRefs` | Include role/snippet when present. |
| Project Definition quality metadata | Project Index Read Model enrichment | `quality` | Good for definition-level coverage. |
| QualityFS experiment/baseline/assertion records | `packages/local/internal/qualityfs` | `quality` | Good for direct trace coverage when trace IDs/case IDs match. |

## Run Detail Information Architecture

Run Detail should start with "what the model saw." That is the fastest debugging question and the
least speculative. "Why this happened" comes second, as decision groups supported by evidence. Checks
and routing should be groups inside the report, not the primary organizing concept.

### Recommended Layout

1. Turn Header
   - model/provider/status/duration
   - selected route/model chips
   - included/dropped/check warning counts
   - coverage gaps chip when present

2. What The Model Saw
   - messages
   - included context contributions in request order
   - available tools
   - token budget
   - dropped or excluded contexts collapsed below the included list

3. Why This Happened
   - grouped decision timeline:
     - Request assembly
     - Model selection
     - Checks
     - Tool use
     - Data and memory
     - Recovery
     - Efficiency
   - each row shows:
     - subject
     - outcome
     - reason text
     - evidence level badge
     - source definition badge
     - quality coverage badge

4. Evidence Drawer
   - raw artifact preview
   - span/event/edge refs
   - source ref with file/snippet
   - quality record links
   - coverage gaps

### UI Labels

Use user-goal labels:

- "What the model saw"
- "Why this happened"
- "Source"
- "Quality coverage"
- "Evidence"
- "Not recorded" for missing rationale

Avoid making "rationale" the main UI word. Reserve it for docs/API discussions.

### Existing Component Impact

The current `GenerationDecisions.tsx` component already groups governance artifacts by tabs:

- Routing
- Guardrail
- Security
- Constraint
- Cache
- Compaction

V0 should evolve that into a decision report renderer:

- First keep existing report tabs as the fallback renderer.
- Add a `DecisionReportPanel` that renders `node.decisionReport` when present.
- Reuse current detail components for raw report previews inside the evidence drawer.
- Gradually move `routingFacts`, report scanning, and span-attribute fallbacks into the Go
  projection so the UI stops reconstructing product meaning from raw records.

## Implementation Phases

### Phase 0: Design Handshake

Files:

- `docs/TURN_DECISION_REPORT_V0.md`

Output:

- align on V0 schema, scope, source/quality join semantics, UI order, and risk language

### Phase 1: TypeScript Contract

Files likely touched:

- `packages/core/observability/turn-decision-report.ts`
- `packages/core/observability/index.ts`
- `packages/core/observability/contract.ts` if exports remain centralized
- type tests or compile tests under the existing package test pattern

Implementation notes:

- Define discriminated unions for decision variants.
- Use branded IDs for `TurnDecisionReportId` and `TurnDecisionId`.
- Keep `TurnReasonCode` as a string-literal union with `custom.${string}` and `unknown.${string}`.
- Do not import provider SDKs, React, Convex, or app-specific types into `@use-crux/core`.
- Reuse existing observability ID brands where possible.

Type design guidance:

- Prefer discriminated unions over optional-field mega-interfaces.
- Add type guards only where consumer code genuinely benefits, such as
  `isTurnContributionDecision(decision)`.
- Do not encode every artifact-specific payload as advanced conditional types in V0. Keep the
  contract readable and stable.

### Phase 2: Go Raw Projection From Observability Graph

Files likely touched:

- `packages/local/internal/observability/service.go`
- `packages/local/internal/observability/projection.go`
- `packages/local/internal/observability/request_composition.go`
- new `packages/local/internal/observability/decision_report.go`
- `packages/local/internal/observability/*_test.go`
- run-detail golden/testdata files if that package already uses goldens

Implementation notes:

- Build the report after `applyRunDetailRequests`.
- Attach `decisionReport` to generation call/stream nodes and generation details.
- Use existing `RunDetailRequest` composition as the source of request contributions, budget, and
  tools.
- Add report decisions by reading already-indexed artifacts/spans/edges from the graph.
- Preserve deterministic ordering:
  1. request assembly in model-seen order
  2. budget/dropped decisions
  3. routing/model-selection
  4. checks
  5. tool use
  6. retrieval/memory
  7. fallback/recovery
  8. efficiency/cache/compaction
- Compute coverage and gaps from missing evidence, not from absence of feature use.
- Do not fetch Project Index or Quality data inside the raw projection.

### Phase 3: Source Join Enrichment

Files likely touched:

- `packages/local/internal/indexread/model.go`
- `packages/local/internal/indexread/run_enrichment.go`
- new helper near `packages/local/internal/observability/decision_report_enrichment.go` if package
  dependencies allow it
- server/service layer that already has access to both Run Detail and the Project Index Read Model

Implementation notes:

- Keep raw `ProjectRunDetail(graph)` usable without source context.
- Enrich decisions with Project Index Read Model definitions and runtime joins in a separate pass.
- Do not write enriched joins back into the raw Project Index Snapshot.
- Represent ambiguous or missing joins explicitly.

Potential source join keys:

- `context:{id}` from `context.contribution.sourceId`
- `prompt:{id}` from generation/prompt metadata
- `tool:{name}` from request/tool records
- routing IDs from router/cascade/fallback reports
- `ProjectRuntimeJoin` fields: primitive, spanName, sourceDefinitionId, blockDefinitionId,
  promptId, contextId, toolName, retrieverId, memoryId, routingId, routeKey

### Phase 4: Quality Join Enrichment

Files likely touched:

- `packages/local/internal/indexread/quality_enrichment.go`
- `packages/local/internal/qualityfs/spec_records.go` only if read helpers are missing
- `packages/local/internal/quality/*` if an existing service should expose trace/case lookup helpers
- decision report enrichment helper from Phase 3

Implementation notes:

- Join direct trace/run/case references first.
- Join definition-level Project Definition `quality` metadata second.
- Mark coverage confidence as `direct-trace` or `definition-coverage`.
- Do not evaluate new assertions in Run Detail. Only display recorded coverage and outcomes.

### Phase 5: Devtools UI

Files likely touched:

- `packages/devtools/ui/src/features/run-detail/components/GenerationDecisions.tsx`
- new `packages/devtools/ui/src/features/run-detail/components/TurnDecisionReportPanel.tsx`
- new smaller components for:
  - decision summary chips
  - decision group list
  - evidence drawer
  - source/quality badges
- run-detail API/client types if they are locally declared or generated

Implementation notes:

- Render "What the model saw" before decision groups.
- Show evidence-level badges so users can distinguish declared reasons from observed outcomes.
- Keep the existing governance tabs as fallback when `decisionReport` is absent.
- Avoid presenting raw span taxonomy as the main IA.

### Phase 6: Matcher And Assertion Surface

This is post-V0 unless the first product slice needs it.

Potential files:

- `packages/core/quality/*`
- `packages/local/internal/quality/*`
- docs for new matchers

Potential matcher examples:

- `expectTurn().toIncludeContext('context:billing-policy')`
- `expectTurn().toDropContext('context:large-history', { reasonCode: 'context.dropped.token_budget' })`
- `expectTurn().toSelectRoute('support-escalation')`
- `expectTurn().toHaveGuardrailAction('pii', 'redacted')`

These should assert decision report codes, not brittle human text.

## Test Plan

Use a TDD sequence that grows one vertical behavior at a time.

### Contract Tests

Goal: TypeScript consumers can narrow and assert decision variants safely.

Tests:

- A contribution decision narrows by `kind: 'contribution'`.
- A routing decision narrows by `kind: 'routing'`.
- Unknown/custom reason codes compile.
- Branded IDs prevent accidental assignment in internal helpers where practical.
- No provider/framework imports leak into `@use-crux/core`.

### Go Projection Unit Tests

Goal: A canonical graph produces a deterministic decision report.

Start with small graph fixtures:

1. Generation with one included context.
   - report has one contribution decision
   - summary included count is 1
   - evidence includes generation span and contribution artifact

2. Generation with one excluded context.
   - decision outcome is `checked-not-included`
   - reason code maps to `context.excluded.when_false`
   - evidence level is `declared`

3. Generation with prompt budget drop.
   - budget decision exists
   - dropped context decision exists
   - dropped reason code is `context.dropped.token_budget`

4. Router selection.
   - routing decision exists
   - selected model is copied
   - missing full rationale creates `routing.rationale.missing` gap when appropriate

5. Cascade with accepted/rejected/skipped tiers.
   - one decision per tier
   - skipped tiers retain `not reached` note as text
   - accepted tier uses stable reason code

6. Fallback attempt failure and success.
   - attempt decisions preserve attempt order
   - fallback edge appears as evidence
   - summary `fallbackUsed` is true

7. Guardrail block or redact.
   - check decision outcome matches action
   - source is report artifact

8. Retrieval hits not linked to prompt.
   - retrieval decision exists under data
   - no contribution inclusion is invented

9. Missing request messages.
   - coverage request state is partial/absent
   - gap is explicit
   - report still builds

### Source Join Tests

Goal: Source enrichment annotates without mutating the raw report.

Tests:

- `context:{id}` resolves to an exact Project Definition.
- runtime join resolves a routing decision to router/cascade source.
- unresolved source returns `fidelity: 'unresolved'` with a reason.
- ambiguous source returns unresolved/ambiguous instead of picking randomly.
- raw `ProjectRunDetail(graph)` remains usable without indexread dependencies.

### Quality Join Tests

Goal: Quality enrichment reports coverage honestly.

Tests:

- direct trace ID in an experiment case creates `confidence: 'direct-trace'`.
- definition-level baseline creates `confidence: 'definition-coverage'`.
- matcher names are displayed only when present in Quality records.
- missing Quality Snapshot is a coverage gap, not an error.
- a failed assertion is shown only when the Quality record says it failed.

### UI Tests

Goal: Run Detail presents the product story in the intended order.

Tests:

- "What the model saw" renders before "Why this happened".
- Included, excluded, and dropped contexts are visually distinguishable.
- Evidence-level badges render for declared/observed/inferred/missing reasons.
- Source badge opens source details when available.
- Quality badge shows baseline/assertion coverage when available.
- Existing governance tabs render as fallback when `decisionReport` is absent.

### Integration Tests

Goal: A real Crux generation emits enough evidence for V0.

Scenarios:

- prompt with context inclusion/exclusion and token budget
- router selection
- cascade fallback path
- guardrail or constraint failure/retry
- tool call
- retrieval/memory artifact

The integration tests should assert Turn Decision Report behavior through the public Run Detail API,
not by reaching into projection internals.

## Open Questions

1. Should the API attach the report only to generation nodes, or also expose a flat
   `turnDecisionReportsBySpanId` map at the run-detail root?

   Recommendation: attach to generation nodes first. Add a flat map only if UI navigation or API
   clients need cross-turn queries.

2. Should preview text be duplicated into contribution decisions?

   Recommendation: include short `previewText` only if already present in `RunDetailRequest`; avoid
   copying large raw prompt text into every decision. Evidence refs should point back to artifacts for
   full details.

3. Should V0 source joins depend on Project Index Read Model availability?

   Recommendation: no. Source joins enrich the report but are not required to build it.

4. Should Quality coverage live in every decision or only in source definitions?

   Recommendation: allow it on every decision, but populate it sparsely. Use direct trace coverage
   when available and definition-level coverage otherwise.

5. Should routing `note` become a stable reason?

   Recommendation: no. Preserve `note` as human text and map known verdicts/events to reason codes.
   Add first-class rationale artifacts later.

6. Should `cache.report` and contribution `cacheStatus` be separate decisions?

   Recommendation: yes when both exist. Contribution cache status explains a context's request
   assembly state. `cache.report` explains broader cache behavior.

7. Should Turn Decision Report include final model output?

   Recommendation: no, except as evidence refs. This report explains turn assembly and harness
   decisions, not answer quality by itself.

## Non-Goals

- Do not replace OTel or Crux canonical observability records.
- Do not make `@use-crux/core` depend on providers, React, Convex, local services, or Project Index
  implementation details.
- Do not mutate the raw Project Index Snapshot for UI-specific enrichment.
- Do not require `.crux/cache` deletion or cache identity changes for a read-model-only feature.
- Do not claim full model/provider rationale.
- Do not expose raw TypeScript AST/checker objects through source joins.
- Do not make QualityFS own observability summaries.
- Do not build a matcher DSL in the V0 projection phase.

## Risks And Mitigations

### Risk: Overpromising rationale

Crux may know that a route was selected or a guardrail blocked, but not the full authorial reason.

Mitigation:

- require `evidenceLevel`
- show "Not recorded" gaps
- keep "rationale artifacts" as a separate post-V0 feature

### Risk: Building a second observability schema

A rich report can drift into duplicating spans and artifacts.

Mitigation:

- keep the report as a read model
- require evidence refs on every decision
- preserve raw payloads in existing artifacts, not copied decision blobs

### Risk: Source joins are brittle

Dynamic definitions, anonymous contexts, missing indexes, and ambiguous IDs can make source linking
hard.

Mitigation:

- model source join fidelity
- represent unresolved states explicitly
- prefer Project Runtime Joins over string guessing

### Risk: Quality coverage is mistaken for quality verdict

Definition-level coverage does not mean this exact turn passed a test.

Mitigation:

- distinguish `direct-trace` from `definition-coverage`
- show assertion status only from Quality records
- avoid computing new pass/fail verdicts in Run Detail

### Risk: UI becomes too dense

The report can overwhelm users if every artifact becomes a row.

Mitigation:

- lead with "What the model saw"
- group decisions by phase
- show summary chips first
- put raw refs in an evidence drawer

### Risk: Privacy and payload size

Decision reports can accidentally duplicate prompt text, memory contents, or tool outputs.

Mitigation:

- keep large payloads in artifacts
- use previews sparingly
- respect existing redaction/security report behavior
- make evidence refs the primary path to raw data

## Recommended V0 Slice

Build the smallest useful product slice in this order:

1. TypeScript contract with discriminated decisions, reason codes, evidence refs, source joins, and
   quality joins.
2. Go raw projection for generation turns using existing `RunDetailRequest` composition.
3. UI panel that renders the report for context, budget, tools, routing, fallback, and checks.
4. Source enrichment using Project Index Read Model.
5. Quality enrichment using direct trace references and definition coverage.
6. Matcher/assertion work after the report has proven stable in Run Detail.

The crucial first milestone is not "explain everything." It is:

> For one generation turn, Crux can show what the model saw, which harness decisions shaped it, and
> the evidence/source/quality links that support those claims, while clearly labeling what was not
> recorded.

