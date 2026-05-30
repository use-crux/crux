# Quality Workbench — Client vs Server Boundary

This document is the canonical decision record for where Quality Workbench
logic lives. It complements `QUALITY_BACKEND_HANDOVER.md` (the BFF
contract) and is referenced from `apps/web` and `packages/backend` to keep
the BFF and the UI honest about which side owns what.

The rule of thumb:

```
Server owns: data shape, hierarchy, filters, joins, graph relations, derived domain records.
Client owns: transient UI state, rendering choices, layout.
Anything the user might filter, sort, search, inspect, persist, or replay must round-trip through the BFF/read-model services.
```

Concretely:

## 1. Top-level Runs list (`/api/quality/runs`)

**Server returns rolled-up runs from the canonical observability graph.**

| What                             | Owner  | Notes                                                          |
| -------------------------------- | ------ | -------------------------------------------------------------- |
| Decide what counts as a "run"    | Server | Initiating agent/flow/composition/generation from the graph. Nested generations are NOT top-level runs. |
| `kind` / primitive fields on each row | Server | Derived from canonical span primitives, not UI event-name heuristics. |
| `childCount` / span counts       | Server | UI can show graph size without rebuilding it locally.           |
| `feedbackIds` / `experimentIds`  | Server | Already in contract.                                           |
| Filtering (`?status=...`, `?kind=...`, `?target=...`, `?model=...`, `?since=...`, `?has=feedback`) | Server | Listed below. |
| Sorting (`?sort=startedAt:desc`) | Server | Default desc-by-time.                                          |
| Pagination (`?cursor=…&limit=…`) | Server | Required for sessions with >100 runs.                          |
| Visible tab toggle (All/Live/Failures/Has feedback) | Both | Server provides counts in `/overview` or a `?counts=true` opt-in; client switches by re-fetching with `?status=...`. |
| Selected run, scroll position    | Client | Transient UI state.                                            |

**Required BFF additions:**

```ts
// GET /api/quality/runs?rollup=top-level&status=...&kind=...&target=...&model=...&since=...&has=feedback&limit=200&cursor=...
type QualityRunRecord = {
  // ...existing fields
  kind: 'flow' | 'swarm' | 'pipeline' | 'consensus' | 'agent' | 'retrieval' | 'generate' | 'resolve' | 'trace'
  childCount?: number            // > 0 when this row rolled-up nested traces
  parentRunId?: string           // null/undefined for top-level rows
  flowId?: string                // present when kind is a composition/flow
}
```

The client should consume the server row shape directly. Do not rebuild run
rollups from raw collector events or local runtime state.

## 2. Run detail (`/api/quality/runs/{traceId}`)

| What                        | Owner  | Notes                                                  |
| --------------------------- | ------ | ------------------------------------------------------ |
| Trace summary + spans + graph events | Server | Built from `internal/observability.Service`. |
| Narrative (chronological)   | Server | Must include real content per event (tool args/results, retrieval hits with previews, generated text, judge reasoning, memory edits). |
| Tool inventory (`inspect.tools`) | Server | Already in `trace.inspect`. UI renders chips.     |
| Citation detection from output text | Server | Regex/structured detection is fine on either side, but the *list of canonical citation ids* should be on the trace record so it survives across UI rewrites. Currently client-side regex. |
| Selected span in waterfall  | Client | Transient.                                             |
| Tab state (`mode=output`)   | Client | Encoded in URL — bookmarkable.                         |
| Replay cursor, play state, speed | Client | Pure UI.                                          |

**Required BFF additions:**

```ts
type QualityRunNarrativeEvent = {
  id: string
  kind: 'input' | 'agent' | 'generate' | 'tool' | 'retrieval' | 'score' | 'handoff' | 'memory' | 'compact' | 'output'
  label: string
  timestamp: number
  offsetMs: number
  data: {
    actor?: string            // e.g. "billing.retrieve"
    text?: string             // markdown body for input/generate/output
    body?: unknown            // structured payload (args, hits, deltas)
    meta?: string             // right-aligned meta (tokens · cost · model)
    detail?: string           // secondary line (e.g. judge reasoning)
  }
}
```

The client may format narrative rows, but it must not infer graph structure,
ownership, or relationships. Those come from the backend read model.

## 3. Insights (`/api/quality/insights`)

**Server should derive ALL insight categories.**

| Category                 | Currently | Should be |
| ------------------------ | --------- | --------- |
| Failed experiment cases  | Server    | Server    |
| Feedback needing review  | Server    | Server    |
| Cassette mismatches      | Server    | Server    |
| Constraint violations    | Server | Server |
| Judge score regressions  | Server | Server |
| Cost anomalies (5× median) | Server | Server |
| Retrieval no-hit clusters | Server | Server |
| Tool-loop detection      | Server    | Server    |
| Security warnings (prompt-injection) | Server | Server |
| Status persistence (open/dismissed/resolved) | Server | Server |

Insight derivation belongs in `internal/quality.Service`, backed by
`internal/observability.Service` where execution graph data is needed.
The UI should filter/render returned insight records only.

## 4. Spans / waterfall hierarchy

| What                                  | Owner  | Notes                                       |
| ------------------------------------- | ------ | ------------------------------------------- |
| Span tree shape (parent/child links)  | Server | Built from canonical span parent IDs and edges. |
| Span primitive / composition type | Server | UI switches on `primitive` and `compositionType`, not event strings. |
| Collapsed/expanded state              | Client | Transient.                                  |
| Filter input ("Filter spans...")      | Client | Tree is small enough for local filtering.   |
| Tree vs Timeline view toggle          | Client | UI mode.                                    |
| Selected span                         | Client | Transient.                                  |

The canonical primitive taxonomy is mirrored in
`packages/cli/internal/api/types.go` and
`packages/devtools/ui/src/types.ts`.

## 5. Mutations

All side effects route through the BFF — the client never persists.

| Endpoint                                    | Owner  | Verified |
| ------------------------------------------- | ------ | -------- |
| `POST /api/quality/insights/:id/status`     | Server | ✓ wired  |
| `POST /api/quality/feedback/:id/status`     | Server | ✓ wired  |
| `POST /api/quality/cassettes/issues`        | Server | ✓ wired  |
| `POST /api/quality/baselines`               | Server | ✓ wired  |
| `POST /api/quality/suites/:id/cases`        | Server | ✓ wired  |
| `POST /api/quality/comparisons`             | Server | (next)   |
| `POST /api/quality/experiments` (start run) | Server | (next)   |

Optimistic UI updates are allowed in the client (e.g. hiding a dismissed
insight before the response lands) but they must reconcile with the next
GET. The dismissed list shouldn't be persisted in `localStorage`.

## 6. Real-time updates

The CLI server emits updates over the in-process Go subscription layer.
The web devtools receive those through the HTTP/WebSocket/SSE adapter;
the TUI subscribes through Go services directly. The adapter may forward
live update notifications, but the backend read model remains the source
of truth after every refresh.

- Observability records are ingested by the backend service, stored in SQLite, and projected into runs/graphs/resources.
- Quality experiment / comparison / baseline / feedback / cassette events are persisted by the service layer and exposed via `/api/quality/*`.
- Memory / tool / retrieval / agent / generation / handoff / composition details are read from the canonical graph for run detail views.

## 7. Filters

| Filter                | Where        | Notes                                       |
| --------------------- | ------------ | ------------------------------------------- |
| Runs by status/kind/target/model/has-feedback | Server | Bottleneck on large sessions. |
| Runs free-text search | Server (when implemented) | Full-text against trace + output text. |
| Experiments by suite  | Server       | Query param.                                |
| Insights by severity / target | Both | UI filter is fine for the open set; for archived insights use server. |
| Filter chip state     | Client URL   | So a filtered Runs page is shareable.       |

## 8. Search (⌘K global search)

| What                  | Owner  | Notes                                       |
| --------------------- | ------ | ------------------------------------------- |
| Index of catalog (prompts/contexts/tools/judges) | Server | Already in catalog. |
| Local run text fuzzy match | Server preferred | The UI may filter visible rows, but persisted search belongs in the backend. |
| Persistent run search across history | Server | Pages, with pagination. |

## Implementation rule

The web UI and TUI are dumb consumers of backend read models. New Quality
behavior belongs in Go services/subscriptions first, then in HTTP/WS/SSE
adapters, then in UI rendering. Do not add a second graph interpreter in
React or Bubbletea.
