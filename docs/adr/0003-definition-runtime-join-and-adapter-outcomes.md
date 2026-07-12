# ADR 0003: Definition↔Runtime Join And Normalized Adapter Outcomes

Status: Accepted

Date: 2026-07-12

## Context

ADR 0001 established the graph-record event spine. ADR 0002 made that spine multi-invocation reliable
(segments, receipts, host lifecycle, revisioned Runs). Two coverage gaps remained for Catalog and
production adapters:

1. **Authored vs executed** — the compiler-owned Project Index knows where a prompt, agent, flow, or
   tool is defined and what it depends on. The runtime graph knows what ran, with which model, cost,
   and delivery health. Nothing joined those planes with a canonical key, so Catalog "View Runs" was
   stale, Run Detail could not link agent/flow/retriever definitions into Catalog, and operators
   could not answer "did this definition run?" without guessing from names or stack traces.

2. **Adapter outcome drift** — finish reasons and errors leaked provider-specific strings or were
   dropped on stream completion (Anthropic `finalMessage()` rejections were swallowed; OpenAI/Google
   streams often lacked usage/finish/tool assembly). Progressive tool-call argument fragments were
   never a product surface, but completed tool calls on streams were incomplete or missing.

This workstream closes both without redesigning either plane.

## Decision

### Exhaustive coverage manifest

`DEFINITION_KIND_COVERAGE` is a `Record<ProjectDefinitionKind, CoverageDescriptor>` in
`@use-crux/core`. Every kind is classified as one of:

- `directly-observed` — subject of a runtime span; Catalog shows View Runs when activity exists
- `runtime-contributor` — referenced by an owner; Catalog shows "referenced by N runs"
- `structural-child` — nested under a parent for Catalog display
- `quality-owned` — primary evidence is the Quality↔observability join
- `static-only` — declarative; truthful empty runtime state
- `fallback` — the `unknown` sentinel

Secondary treatments (`direct-runtime`, `quality-owned`) cover dual cases such as `scorer`
(Quality-primary with live `scoring.judge` secondary evidence). Catalog and DevTools derive treatment
from this manifest; they do not hard-code a six-family subset.

### DefinitionRef envelope

Runtime records may carry `definitionRefs?: DefinitionRef[]` on `run:start`, `span:start`, and full
`span` records:

- `id` — exact `store.ProjectDefinition.ID`
- `kind` — full `ProjectDefinitionKind`
- `role` — closed family role (`resolved-prompt`, `invoked-agent`, …)
- `source?` — optional `SanitizedSourceRef` (repo-relative only; absolute paths and `..` dropped)

Refs are emitted **only** when the runtime already holds a compiled definition handle (required
authored `id` / literal name / object-map key). Stack-trace guessing is forbidden. Anonymous handles
omit the ref. A compile-time `DirectlyObservedKind → DefinitionRefRole` map fails the build if a
directly-observed kind lacks a role.

The same rule applies category by category beyond directly-observed owners. Knowledge bases and tool
policies attach contributor refs to their owner spans; executed flow steps, parallel branches, recipe
steps, and authored scorers attach child/scorer refs when their canonical identity is present. A
structural child without such runtime identity derives activity only from its indexed parent and is
labelled explicitly as not independently observed. Static-only kinds retain zero runtime activity.
The runtime never fabricates a child id or derives one from display text.

Compositions (`parallel` / `pipeline` / `swarm` / `consensus`) take a **required** authored `id`; the
random per-execution `compositionId` remains a separate execution identity. Recipe rerankers require
a named engine (`rerank({ engine })` / `judgeReranker({ name, … })`) so `rag.reranker` ids are
collision-free.

### Go derived activity projection

`run_definition_activity` is a rebuildable SQLite projection written in the same ingest transaction
as run rollups and `observability_revision` bumps. It stores only runtime-emitted id/kind/role and
aggregate timestamps/counts — never a denormalized Project Index snapshot. Filtered Runs
(`definitionId` query / `GET /api/observability/definitions/{id}/runs`) reuse the existing revision
stream. Since-deleted definitions remain filterable; read-time Catalog resolution marks them
unresolved rather than dropping history.

**Runtime evidence never participates in Project Index or Quality cache identity.**

### Normalized adapter outcomes

All four first-party adapters map completed calls into:

- `CruxFinishReason` — closed finish vocabulary
- `CruxProviderError` / `CruxAdapterError` — `kind` / namespaced `code` / `retryable` / optional
  redacted `message` (via the shared observability redaction path)

Completed tool calls are assembled for both `generate()` and `stream()`. There is **no**
`toolCallDelta` or progressive argument-fragment surface. Abort and budget timeouts classify as
`aborted` / `timeout`; `retryable` is classification only (SDK clients own network retries).

### DevTools truthfulness

Catalog Observability sections, View Runs, and Run Detail ↔ Catalog links are manifest-driven.
Delivery health is tri-state `unknown` / `healthy` / `degraded` with a shared badge and plain-language
explanations for `suspended` / `incomplete` / `conflicted`. `healthy` is only set when the Go read
model can prove a clean terminal delivery (causal order, zero gaps, no alias conflict, no ingest
rejects). `unknown` is never presented as healthy.

### Quality nested-run signal capture

Quality cells open an `eval.case` run; nested `flow()` tasks open durable child runs linked by
`edgeType: 'triggered'`. Signal capture takes the **triggered-run closure** of the cell root so
`flow.step` matchers see step spans instead of honest-failing as uncaptured.

## Alternatives Considered

**Guess definition identity from stack traces or free-text names.** Rejected: false joins are worse
than no join; Catalog would link the wrong definition under rename/refactor.

**Denormalize Project Index rows into the observability database.** Rejected: couples compiler cache
identity to runtime traffic and creates two sources of truth for source location.

**A second revision stream for definition activity.** Rejected: activity only changes when a run
revises; a second counter is strictly derivable and invites drift.

**Progressive tool-call argument streaming.** Rejected: partial JSON is not a reliable product
surface; completed calls already serve generate and stream uniformly.

**Ship with known-red Quality/UI baselines reconfirmed unchanged.** Rejected: the release gate is
zero unexplained red checks; nested-run capture and architecture allowlist fixes close the baselines
this workstream owns.

## Consequences

- Catalog can answer definition-level runtime questions without leaving the Index surface.
- Adapter consumers get one finish/error taxonomy across providers.
- Contributors must update `DEFINITION_KIND_COVERAGE`, its runtime-identity treatment, and the role
  map/builders when adding kinds or emitters.
- Composition and reranker call sites must supply authored ids (breaking, pre-launch).
- Cache epochs are unchanged for the join itself; semantic facts epoch may bump only when indexer
  discovery rules for shared kinds change (documented in release notes when that happens).

## Validation

- Unit/integration: DefinitionRef emission, kind coverage exhaustiveness, Go activity
  projection/filter/rebuild/retention, adapter normalized-outcome conformance for all four packages.
- Connected fixture: generated from every manifest entry with direct, contributor, child,
  parent-derived, Quality, and zero-runtime treatments; multi-segment healthy run, degraded delivery
  via record-id conflict, filtered Runs, revision catch-up, and real Quality experiment correlation
  (`TestConnectedFixtureDefinitionJoinDeliveryAndCatchup`).
- Quality: nested triggered-run closure so flow step matchers capture under `eval.case` cells.
- DevTools: `check:ui-architecture` green; Catalog coverage treatments unit-tested.
- Docs: public guides for adapter outcomes, Catalog evidence, Runs/delivery, runtime setup, privacy,
  troubleshooting; stale hook samples removed.

Treat this ADR as the durable architectural record and the changeset / CHANGELOG as point-in-time
evidence. ADR 0001 and ADR 0002 remain in force; this decision is additive coverage on top of both.
