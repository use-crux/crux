# Quality Workbench Backend/BFF Handover

> For client vs. server ownership decisions, see
> [`CLIENT_SERVER_BOUNDARY.md`](./CLIENT_SERVER_BOUNDARY.md). The boundary
> doc enumerates the BFF gaps the UI currently shims around (run rollup,
> insight categories, narrative content, semantic kind, citation list).

## Status

The backend/BFF contract for the local Quality Workbench is now in place in the CLI dev server. The UI agent should build against these domain records and the canonical observability graph instead of raw protocol events, old eval event payloads, or shadow-run terminology.

This work is local-dev only. The CLI/dev server persists and hydrates local quality data from `.crux/quality`; app runtimes emit collector events and do not write `.crux` directly.

## Vocabulary

Use these names in UI and code:

- Suite: reusable eval/test cases. Do not call this dataset in new UI.
- Case: one input plus expectations/assertions.
- Run: one local execution trace enriched with feedback, experiment, and cassette links.
- Experiment: immutable run over a suite and one or more variants.
- Variant: one target/model/settings/prompt config inside an experiment.
- Comparison: baseline vs candidate or variant-vs-variant diff.
- Baseline: promoted reference experiment or variant.
- Feedback: local human/user judgment attached to a trace/output/case.
- Cassette: deterministic replay fixture.
- Insight: derived diagnosis from local records.

Avoid UI labels like `shadow`, `RAG eval session`, `event payload`, and `dataset` for the new Quality surface. If older code still uses those terms internally, adapt at the boundary.

## Endpoints

All endpoints are served by the CLI dev server.

```txt
GET  /api/quality/overview?window=24h|7d|30d|all
GET  /api/quality/activity?limit=N
GET  /api/quality/runs
GET  /api/quality/runs/{traceId}
GET  /api/quality/suites
GET  /api/quality/suites/{suiteId}
POST /api/quality/suites
PUT  /api/quality/suites/{suiteId}
POST /api/quality/suites/{suiteId}/cases
GET  /api/quality/insights
POST /api/quality/insights/{insightId}/status
GET  /api/quality/experiments
GET  /api/quality/experiments/{experimentId}
GET  /api/quality/experiments/{experimentId}/cell-evidence?caseId={caseId}&variantName={variantName}&trial={trial}
GET  /api/quality/experiments/diff?a={experimentId}&b={experimentId}
GET  /api/quality/judge-report/{evaluationId}
GET  /api/quality/evaluations/experiment-groups?limit=N
GET  /api/quality/evaluations/{evaluationId}/experiments?limit=N
GET  /api/quality/evaluations/{evaluationId}/progress?limit=N
GET  /api/quality/comparisons
GET  /api/quality/comparisons/{comparisonId}
POST /api/quality/comparisons
GET  /api/quality/baselines
GET  /api/quality/baselines/{baselineId}
POST /api/quality/baselines
GET  /api/quality/feedback
POST /api/quality/feedback
GET  /api/quality/feedback/annotations
POST /api/quality/feedback/annotations
POST /api/quality/feedback/{feedbackId}/status
GET  /api/quality/feedback/memory-proposals
GET  /api/quality/cassettes
POST /api/quality/cassettes/issues
GET  /api/quality/scorers
```

Trace endpoints have been removed. List and detail drilldown use the canonical
observability and Quality APIs:

```txt
GET /api/observability/runs/page
GET /api/observability/runs/{runId}
GET /api/quality/runs
GET /api/quality/runs/{traceId}
```

## Live Data Contract

The Go CLI owns the local Quality service and event bus. Native clients such as
the Bubbletea TUI should subscribe to the in-process service/event stream when
they are running inside the same `crux dev` process. The web devtools remain on
the stable HTTP/WebSocket adapter.

The `/api/quality/*` handlers are adapters over the same Go `internal/quality.Service`
used by native clients. They should stay thin: request decode, service call,
response encode. New Quality behavior belongs behind the service boundary, not
inside HTTP handlers.

The rest of the devtools read surface and collector ingestion are backed by
`internal/devtools.Service`. HTTP reads, WebSocket snapshots, raw live-event forwarding,
and the TUI direct client use that service rather than reaching into the store
from adapter code. Collector ingestion is service-owned: process the event,
publish raw live subscribers, publish quality activity, then persist the local
quality event log.

Owned TUI mode subscribes through `devtools.Service.SubscribeChanges()` and
`quality.Service.Events()`; it does not connect to the WebSocket adapter.

WebSocket clients receive typed quality events from the Go service/subscription
layer. Raw collector forwarding is adapter-level only; clients should fetch
read models from the service APIs for truth after reconnects.

```ts
type QualityEvent = {
  _tag: 'QualityEvent'
  id: string
  timestamp: number
  kind: 'trace' | 'insight' | 'experiment' | 'cassette' | 'feedback' | 'dataset' | string
  action: string
  severity: 'info' | 'warn' | 'error' | string
  refId: string
  payload?: QualityJsonValue
}
```

`GET /api/quality/activity?limit=N` returns the replayable activity feed:

```ts
type QualityActivityEvent = {
  _tag: 'QualityActivityEvent'
  timestamp: number
  kind: 'trace' | 'insight' | 'experiment' | 'cassette' | 'feedback' | 'dataset' | string
  severity: 'info' | 'warn' | 'error'
  summary: string
  refId: string
}
```

Activity is retained in memory up to 500 events and persisted to
`.crux/quality/activity.jsonl`.

## Implemented BFF Records

### `QualityOverview`

`GET /api/quality/overview` returns counts and latest experiment summary.
Pass `window=24h|7d|30d|all` to re-scope the KPI fields and spark series;
the default is `all`.

```ts
type QualityOverviewRecord = {
  _tag: 'QualityOverview'
  runCount: number
  suiteCount: number
  experimentCount: number
  comparisonCount: number
  baselineCount: number
  feedbackCount: number
  feedbackNeedingReviewCount: number
  cassetteCount: number
  cassetteIssueCount: number
  insightCount: number
  latestExperimentId?: string
  latestExperimentPassRate?: number
  latestExperimentCompletedAt?: string
  passRate?: number
  meanScore?: number
  totalCost: number
  p50LatencyMs?: number
  p95LatencyMs?: number
  costPer100Runs?: number
  passRateHistory: readonly number[]
  openInsightsHistory: readonly number[]
  passRateSpark: readonly number[]
  costSpark: readonly number[]
  latencySpark: readonly number[]
  openInsightSeverityCounts?: Partial<Record<'low' | 'medium' | 'high', number>>
  recentRuns?: readonly QualityRunRecord[]
}
```

Use this for the Quality overview header/cards. The KPI fields map directly to the design cards: runs, pass rate, mean score, selected-window cost, p50 latency, open insight severities, and recent runs.

The overview histories are service-computed from local records:
`passRateHistory` is bucketed and forward-filled, and the 12-point sparks are
bucketed from local runs. Bounded windows filter experiments, baselines,
cassettes, feedback, insights, and runs before aggregating; `all` keeps the
whole retained local record set.

### `QualityRun`

`GET /api/quality/runs` returns trace records enriched for the workbench:

```ts
type QualityRunRecord = {
  _tag: 'QualityRun'
  traceId: string
  targetId?: string
  promptId?: string
  flowId?: string
  status: 'running' | 'success' | 'error' | string
  startedAt: number
  durationMs?: number
  model?: string
  provider?: string
  input?: Record<string, QualityJsonValue>
  output?: QualityJsonValue
  error?: QualityJsonValue
  usage?: QualityJsonValue
  cost?: number
  tokenCount?: number
  score?: number
  scoreName?: string
  toolCallCount: number
  feedbackIds: readonly string[]
  experimentIds: readonly string[]
  cassetteStatus?: 'recorded' | 'missing' | 'mismatch' | string
  cassettePaths?: readonly string[]
}
```

Derivation rules:

- `targetId` is prompt id first, then flow id, then step label, then trace id.
- `output`, `usage`, `cost`, and `toolCallCount` are extracted from trace result.
- `tokenCount` is derived from `usage.totalTokens` or input/output token fields.
- `score`/`scoreName` come from linked experiment case scores when a trace is part of a suite run.
- `feedbackIds` are linked through feedback records with matching `traceId`.
- `experimentIds` are linked through experiment case records with matching `traceId`.
- `cassetteStatus` is currently `recorded` when a cassette has an entry for the same target id.

For the run inspect/replay screen, prefer:

```txt
GET /api/quality/runs/{traceId}
```

It returns a normalized detail record:

```ts
type QualityRunDetailRecord = {
  _tag: 'QualityRunDetail'
  run: QualityRunRecord
  trace: QualityTraceRecord
  events: readonly CorrelatedEvent[]
  spans: readonly QualityRunSpan[]
  narrative: readonly QualityRunNarrativeEvent[]
}
```

Use `spans` for the waterfall tree and `narrative` for the replay timeline.
Use the canonical observability graph endpoint when a low-level graph/debug
view needs more than the quality detail projection.

### `QualitySuite`

`GET /api/quality/suites` returns suite summaries derived from experiment suite snapshots:

```ts
type QualitySuiteRecord = {
  _tag: 'QualitySuite'
  suiteId: string
  name?: string
  version?: string
  source?: 'code' | 'json' | 'composed' | string
  path?: string
  caseCount: number
  tags?: readonly string[]
  scorers?: readonly string[]
  lastExperimentId?: string
  lastRunAt?: string
  lastPassRate?: number
  cases: readonly QualitySuiteCase[]
}

type QualitySuiteCase = {
  caseId: string
  id?: string
  name?: string
  input?: QualityJsonValue
  expected?: QualityJsonValue
  tags?: readonly string[]
  metadata?: Record<string, QualityJsonValue>
  origin?: QualityJsonValue
}
```

Suite editing is backed by `.crux/quality/suites/{suiteId}.json`.

```txt
POST /api/quality/suites
PUT  /api/quality/suites/{suiteId}
POST /api/quality/suites/{suiteId}/cases
```

Use `POST /api/quality/suites` for newly created/imported suites, `PUT` for full-record edits, and `POST /cases` for case upsert from the workbench. The BFF accepts either `caseId` or `id` for case identifiers but returns canonical `caseId`.

Use `GET /api/quality/suites/{suiteId}` for the suite detail screen. It returns the same shape as the list item, including cases, last run status, scorer names, tags, and persisted JSON edits.

### `QualityInsight`

`GET /api/quality/insights` returns derived local diagnoses:

```ts
type QualityInsightRecord = {
  _tag: 'QualityInsight'
  insightId: string
  title: string
  severity: 'low' | 'medium' | 'high'
  tags: readonly string[]
  summary: string
  targetId?: string
  linkedTraceIds?: readonly string[]
  linkedExperimentIds?: readonly string[]
  linkedCaseIds?: readonly string[]
  linkedCassettePaths?: readonly string[]
  suspectedCause?: string
  proposedFix?: string
  status: 'open' | 'dismissed' | 'resolved'
  updatedAt?: string
}
```

V1 insight derivations currently include:

- failed experiment cases
- new feedback needing review
- potential tool loops when one trace has many tool calls
- cassette mismatch/missing issues when those counters are present

Treat these as local diagnosis cards. They are intentionally derived, not user-authored records.

Insight status is persisted separately from the derived insight:

```txt
POST /api/quality/insights/{insightId}/status
```

Request:

```ts
type QualityInsightStatusRequest = {
  status: 'open' | 'dismissed' | 'resolved'
  note?: string
}
```

The next `GET /api/quality/insights` call applies the latest persisted status overlay.

### `QualityCellEvidence`

`GET /api/quality/experiments/{experimentId}/cell-evidence` returns one
backend-joined record for a case × variant × trial cell. Required query
params are `caseId`, `variantName`, and `trial`.

```ts
type QualityCellEvidence = {
  _tag: 'QualityCellEvidence'
  schemaVersion: 1
  experimentId: string
  evaluationId?: string
  generatedAt: string
  cell: QualityCellIdentity
  trialSummary: QualityTrialSummary
  io: QualityCellIOEvidence
  scores: readonly QualityScoreEvidence[]
  assertions: QualityAssertionEvidence
  checks: readonly QualityCheckEvidence[]
  code: QualityCodeEvidence
  baseline: QualityBaselineEvidence
  trace: QualityTraceEvidence
  repro: QualityReproEvidence
  provenance: QualityEvidenceProvenance
}
```

The service owns the join across experiment records, assertion outcomes,
authored source-frame snapshots, normalized score/check evidence, retained
baseline output, and observability spans. Assertion `checks` are emitted for
both passed and failed retained outcomes so the drawer can show the full
ledger; score-threshold checks and `scores[].threshold` come from authored
assertion comparisons first, then from numeric score gates such as
`scores.helpful.min` / `scores.helpful.max`. Judge rationale is copied from
score metadata when the scorer retained it.

Fresh spec-02 assertion outcomes may carry `subjectExpr`, recovered from the
authored `ctx.expect(...)` / `ctx.expect.soft(...)` source-frame line, so UI
rows can render the subject prefix without parsing source locally. Assertion
checks copy retained matcher messages, and score-threshold checks carry
backend-synthesized messages such as `0.58 is below the 0.70 floor`.

Old records degrade explicitly: missing source frames and score-only baselines
return `kind: 'unavailable'` with a reason instead of fabricated code
locations. Records that only retained assertion counters/failures do not get
synthetic assertion outcomes; migrate or rerun them before expecting the
cell-evidence drawer to show assertion rows. The current contract does not
emit `resolver: 'disk-legacy'`; disk-reconstructed source frames use
`resolver: 'disk'` and may set `stale: true`. Trace evidence separates
authored cell `traceIds` from backend-retained `retainedTraceIds`: a
callback-only cell may have a retained root run with an empty compact
`trace.spans` waterfall. In that state, render an honest "trace retained;
this cell did not emit child spans" message and still open
`/api/observability/runs/{runId}` from `retainedTraceIds[0]`.

Local backend store note from 2026-06-16: the existing
`packages/backend/.crux/quality` failed cells were hard-migrated from
`packages/backend` to current-shape assertion outcomes. For example,
experiment `01KTYX615TBB6XCA8E1NFJBW1E`, case
`delegates-seo-optimization-for-write-intent`, variant `default`, trial `0`
now returns `subjectExpr:
ctx.output.toolCalls.some((toolCall) => toolCall.name === 'optimizeSeo')`,
message `expected true to be false`, resolver `disk`, and no legacy markers
through the Vite-proxied cell-evidence endpoint.

Clients should use `checks` for human-debuggable rows, `code.primaryFrame`
for the authored source lens, `code.valuesAtCheck` for curated payload values,
`trialSummary` for flaky-cell summaries, and `trace.hotSpanIds`/`trace.spans`
for trace context. Do not rebuild this record in React or Bubbletea from raw
experiment, baseline, catalog, and trace APIs.

### `QualityEvaluationProgress`

`GET /api/quality/evaluations/{evaluationId}/progress?limit=N` returns recent
run progress and score series for one evaluation. `limit` defaults to 20 and
is capped by the backend.

```ts
type QualityEvaluationProgress = {
  _tag: 'QualityEvaluationProgress'
  schemaVersion: 1
  evaluationId: string
  generatedAt: string
  limit: number
  runs: readonly QualityEvaluationProgressRun[]
  scoreSeries: readonly QualityScoreProgressSeries[]
}
```

The service sorts recent experiments newest-first, computes pass rate/verdict,
cost, duration, per-score mean/SEM/n points, and overlays the current baseline
score when one exists. This is the contract for progress strips and TUI
status panes; clients should not scan the full experiment list to derive it.

### Evaluation ↔ Experiment relations

`GET /api/quality/evaluations/{evaluationId}/experiments?limit=N` returns the
latest experiment summaries for one evaluation. It has collection semantics:
an evaluation id with no retained runs returns `200` with `total: 0` and an
empty `experiments` array.

`GET /api/quality/evaluations/experiment-groups?limit=N` returns experiment
summary buckets grouped by evaluation, sorted by the latest retained experiment
in each bucket. `limit` defaults to 20 and caps the number of summaries inside
each evaluation group; `total` fields report the retained counts before that
limit is applied.

```ts
type QualityEvaluationExperiments = {
  _tag: 'QualityEvaluationExperiments'
  schemaVersion: 1
  evaluationId: string
  generatedAt: string
  limit: number
  total: number
  experiments: readonly QualityExperimentSummary[]
}

type QualityEvaluationExperimentGroups = {
  _tag: 'QualityEvaluationExperimentGroups'
  schemaVersion: 1
  generatedAt: string
  limit: number
  totalEvaluations: number
  totalExperiments: number
  groups: readonly {
    evaluationId: string
    total: number
    experiments: readonly QualityExperimentSummary[]
  }[]
}
```

Use these relation reads for evaluation detail panels and grouped experiment
lists. The UI should not scan `/api/quality/experiments` to rebuild the same
relation unless it is already rendering the flat list for another reason.

### `QualityComparison`

`GET /api/quality/comparisons` lists persisted comparisons. `GET /api/quality/comparisons/{comparisonId}` returns one persisted comparison. `POST /api/quality/comparisons` creates a comparison from baseline/candidate experiments or variants.

Comparison records now include summary deltas and case-level deltas:

```ts
type QualityComparisonRecord = {
  _tag: 'QualityComparison'
  id: string
  qualityId: string
  comparedAt: string
  baseline: QualityComparisonSummary
  candidate: QualityComparisonSummary
  metrics: {
    passRateDelta: number
    avgDurationMsDelta: number
    numericScoreDeltas: Record<string, { baseline?: number; candidate?: number; delta?: number }>
  }
  caseDeltas?: readonly QualityComparisonCaseDelta[]
  status: 'candidate_better' | 'candidate_worse' | 'same' | 'mixed'
}

type QualityComparisonCaseDelta = {
  caseId: string
  caseName?: string
  status: 'fixed' | 'regressed' | 'still_failing' | 'unchanged' | 'new' | 'removed' | string
  baseline?: { traceId?: string; status: string; outputPreview?: string; score?: number; durationMs: number }
  candidate?: { traceId?: string; status: string; outputPreview?: string; score?: number; durationMs: number }
  scoreDelta?: number
  outputChange?: string
}
```

Use `caseDeltas` for the Compare screen’s fixed/regressed/unchanged rows and output previews.

### `QualityScorer`

`GET /api/quality/scorers` returns scorer usage derived from experiment case scores:

```ts
type QualityScorerRecord = {
  _tag: 'QualityScorer'
  name: string
  kind: string
  suiteIds?: readonly string[]
  runCount: number
  passRate?: number
  meanScore?: number
  lastUsedAt?: string
}
```

Use this for the “Scorers & gates” sidebar/settings screen. V1 derives scorer rows from local experiment records; scorer editing/import can be layered on top later if needed.

### `QualityCassette`

`GET /api/quality/cassettes` now returns richer cassette summaries:

```ts
type QualityCassetteRecord = {
  path: string
  mode?: string
  status: 'matching' | 'missing' | 'mismatch' | string
  coverage: number
  entryCount: number
  missingCount: number
  mismatchCount: number
  providerCallsAvoided: number
  boundaries?: Record<string, { count: number; missing?: number; mismatched?: number }>
  matchers?: readonly string[]
  entries?: readonly {
    id?: string
    caseId?: string
    kind?: string
    targetId?: string
    provider?: string
    model?: string
    status?: string
    reason?: string
    recordedAt?: string
  }[]
  recordedAt?: string
}
```

Boundary keys are cassette request kinds such as `generate`, `stream`, `embed`, `retrieve`, or `tool` depending on what the cassette contains.

Replay missing/mismatch state is persisted through issue overlays:

```txt
POST /api/quality/cassettes/issues
```

Request:

```ts
type QualityCassetteIssueRecord = {
  path: string
  entryId?: string
  caseId?: string
  kind?: string
  targetId?: string
  provider?: string
  model?: string
  status: 'missing' | 'mismatch' | 'recorded' | 'error'
  reason?: string
}
```

The BFF stores these in `.crux/quality/cassettes/issues.jsonl` and folds them into `GET /api/quality/cassettes` by updating `missingCount`, `mismatchCount`, boundary issue counts, and entry statuses.

## Design Handoff Notes

The provided Claude Design handoff was downloaded and inspected from:

```txt
https://api.anthropic.com/v1/design/h/7EMghnQwiPfmrHp74sJlNA?open_file=Crux+Devtools+-+Quality+Workbench.html
```

The handoff archive contains `Crux Devtools - Quality Workbench.html` and V4 React prototypes for overview, runs, evals, data, settings, and shell. The prototype still labels the suite area as `Datasets`; for implementation, use the same visual placement but label and wire it as `Suites`.

## Frontend Type Source

The Devtools UI type file now contains the BFF-facing record types:

```txt
packages/devtools/ui/src/types.ts
```

The Go client/API mirrors the same backend contract:

```txt
packages/local/internal/api
```

## Frontend Service Helpers

The Devtools UI already has typed fetch helpers for the new read models:

```ts
import { qualityService } from '@/shared/services/quality'
import type { QualityCellEvidence, QualityEvaluationProgress } from '@/types'

const evidence: QualityCellEvidence = await qualityService.cellEvidence(
  experimentId,
  { caseId, variantName, trial },
  signal,
)

const progress: QualityEvaluationProgress = await qualityService.evaluationProgress(evaluationId, limit, signal)
```

Use these helpers from UI integration code instead of hand-building endpoint
URLs in components. They live in:

```txt
packages/devtools/ui/src/shared/services/quality.ts
```

There are not dedicated React Query hooks or query keys for cell evidence and
evaluation progress yet. If the UI agent is building persistent panels, add
matching keys in `packages/devtools/ui/src/shared/query/queryClient.ts` and
hooks in `packages/devtools/ui/src/shared/hooks/useQualityApi.ts`, then call
the service helpers from those hooks. The broad `qk.quality.all` invalidation
already refreshes Quality reads after quality events; more targeted invalidation
can be added once the UI shape is known.

## CLI Surface

The CLI now exposes the BFF records:

```bash
crux quality
crux quality list
crux quality run [id...]
crux quality watch [id...]
crux quality show <experiment-id> --json
crux quality cell-evidence <experiment-id> --case <case-id> --variant <variant-name> --trial <n> --json
crux quality progress <evaluation-id> --limit <n> --json
crux quality promote <experiment-id> --variant <variant-name>
```

JSON output is available with `--json`.

## UI Integration Guidance

Build the new UI around these domain screens:

- Overview: call `/api/quality/overview?window=24h|7d|30d|all`, then optionally load insights/experiments.
- Insights: call `/api/quality/insights`; linked IDs open Runs, Experiments, Suites, or Cassettes.
- Runs: call `/api/quality/runs`; drill into `/api/quality/runs/{traceId}` for the quality projection or `/api/observability/runs/{runId}` for the full graph.
- Quality eval trace links: connected `crux quality run` executions now post the
  canonical observability graph before the worker exits, and direct
  `evaluation.run()` calls do the same when `CRUX_DEVTOOLS_URL`, `DEVTOOLS_URL`,
  or a reachable local `localhost:4400` devtools server is available. Fresh
  cell `traceIds` should resolve in the Runs detail view. Still handle 404s as
  expired/offline trace detail, not as a screen-level crash.
- Suites: call `/api/quality/suites`; create/update through `POST /api/quality/suites`, `PUT /api/quality/suites/{suiteId}`, and `POST /api/quality/suites/{suiteId}/cases`.
- Experiments: call `/api/quality/experiments`; use `suite`, `variants`, `cases`, `summary`, and `status`. Completed rows report `status` as `passed`, `failed`, or `informational`; active run-event rows report `running` with a synthetic `running:` experiment id and should not open persisted experiment detail.
- Grouped experiment list: call `/api/quality/evaluations/experiment-groups?limit=...`; render each evaluation bucket directly.
- Evaluation detail experiments: call `/api/quality/evaluations/{evaluationId}/experiments?limit=...`; use `total` for "latest N of total" copy.
- Cell evidence: call `/api/quality/experiments/{experimentId}/cell-evidence?caseId=...&variantName=...&trial=...`; render the backend-owned evidence record directly.
- Evaluation progress: call `/api/quality/evaluations/{evaluationId}/progress?limit=...`; use the returned runs and score series instead of scanning experiments client-side.
- Compare: call `/api/quality/comparisons`; create comparisons with `POST /api/quality/comparisons`.
- Baselines: call `/api/quality/baselines`; promote with `POST /api/quality/baselines`.
- Feedback: call `/api/quality/feedback`; review with `POST /api/quality/feedback/{feedbackId}/status` or the lower-level annotation endpoint.
- Cassettes: call `/api/quality/cassettes`; persist replay issues through `POST /api/quality/cassettes/issues`.
- Scorers & gates: call `/api/quality/scorers` for derived scorer rows, then link back to suites/experiments through `suiteIds`.

Prefer domain records over raw event arrays. The backend owns graph assembly,
relations, search, filtering, rollups, and replay projections.

## Current Limits

- Insight content is still derived on read; only insight status/note overlays are persisted.
- Suite editing is JSON-file backed and local. There is no hosted or collaborative suite store in V1.
- Cassette replay writes missing/mismatch overlays; updating the actual cassette fixture contents is still a separate replay/update action.
- Scorer rows are derived from experiments in V1. A dedicated scorer registry/editor is not yet a separate persistence model.
- Production observability remains OTel metadata. Full-fidelity local
  observability is stored by the CLI backend and exposed through the
  observability/quality read models.

## Verification

Scoped checks run:

```bash
cd packages/cli
go test ./... -count=1
```
