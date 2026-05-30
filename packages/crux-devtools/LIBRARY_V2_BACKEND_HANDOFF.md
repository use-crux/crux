# Library v2 — backend gaps blocking the UI redesign

## Backend response — current shipped contract

Implemented in the Go devtools service:

- `GET /api/catalog` now may include `definition.quality.drift`, but only for affected evals/suites where the backend can calculate both current pass rate and a baseline pass rate. Missing `drift` means “not enough data”, not zero drift.
- `GET /api/memory/stores` lists discovered memory stores from actual memory instance state plus memory read/write events.
- `GET /api/memory/stores` includes `stats.trend` when the backend has events for that store. The trend is an eight-bucket read/write count over the store's recent observed lifetime, capped to the last 24 hours.
- `GET /api/memory/stores/{storeId}` returns the current store detail with type-specific `state`.
- `GET /api/memory/stores/{storeId}` also joins optional authored/runtime metadata when present: `schema`, `owner`, `source`, `backend`, `conflictPolicy`, and `evictionPolicy`.
- `GET /api/memory/stores/{storeId}` adds episodic `state.index` and `state.retention` only when those fields were captured in memory event metadata.
- `GET /api/memory/operations?since=...&until=...&limit=...` returns a unified cross-store operation stream from observed memory events. Defaults to 50 records, caps at 500, sorted newest first.
- Project Catalog indexing now projects memory/blackboard source metadata for the memory screens:
  - `blackboard({ schema })` exposes `definition.metadata.schema`.
  - `memory({ store, blocks })` exposes `definition.metadata.backend`, `blockCount`, `blocks[]`, and, when there is exactly one `workingState({ schema })` block, top-level `definition.metadata.schema`.
  - `workingState({ schema })` block schemas are included in `definition.metadata.blocks[].schema`.
  - Built-in `episodes`, `facts`, `procedures`, and `reflections` blocks now project default entry schemas. For single-block episodic/semantic memories, that schema is also lifted to `definition.metadata.schema`, so `/api/memory/stores/{id}` can populate `detail.schema` instead of only blackboard schemas.
  - Factory-local call sites are indexed, not just `export const` definitions. This covers Karyla's `createThreadBlackboard(...)`, `createSessionMemory(...)`, `createUserEpisodicMemory(...)`, and `createProjectSemanticMemory(...)` shape.
  - `createMemoryId('session' | 'semantic' | 'episodic' | 'blackboard', ...)` is projected as `definition.metadata.runtimeIdPrefix` (`session:`, `project-knowledge:`, `user-episodes:`, `thread:`). The Go memory detail service joins runtime store ids back to these authored definitions by exact id first, then by this prefix.
  - Shorthand factory locals are resolved before projection, so `const store = cruxConvexStore(...); memory({ id: memoryId, store, blocks })` reports `backend: "cruxConvexStore"` instead of the local variable name.
- `GET /api/memory/stores/{storeId}` now also populates episodic `state.index` from authored block metadata when runtime index telemetry is absent. The fallback is deliberately modest: `status: "observed"`, `indexedCount`, and `targetCount` from observed entries. `embeddingModel`, `dimensions`, `distance`, and GC fields are still only present when captured explicitly by runtime/store metadata.
- Runtime built-in memory blocks emit `spanId`, `runId`, `sourceDefinitionId`, `blockDefinitionId`, and schema metadata for working-state reads/writes. `blackboard()` memory spans emit `sourceDefinitionId`, schema metadata, backend tag (`inMemory` or `configured`), and `conflictPolicy: "last-writer-wins"`.
- `GET /api/workspaces` lists workspaces from observed workspace operations.
- `GET /api/workspaces/{workspaceId}` returns file summaries and recent operation history from observed workspace operations.
- `GET /api/workspaces/{workspaceId}/files/{filePath}` returns per-file operation history when that file has observed workspace operations.
- `GET /api/plans` lists plan summaries built from plan/task/task-list events.
- `GET /api/plans/{planId}` returns plan detail, task hierarchy, versions when version events exist, and the event log.
- Realtime invalidation messages are broadcast from the Go websocket layer for memory/workspace/plan observability events using `MemoryStoreEvent`, `WorkspaceEvent`, and `PlanEvent`.

Important UI contract rule: the backend intentionally omits fields it cannot derive from captured runtime data. Treat missing optional fields as “not captured yet”. Do not render them as zeros, empty diffs, or errors.

Not shipped yet because the runtime/store does not currently capture enough data:

- Workspace file preview bodies.
- Workspace file versions and file diffs.
- Plan content diffs and task deltas between arbitrary versions.
- Human-readable span paths/actors for legacy memory/workspace events when only a trace id is available.
- Authored memory owner, conflict, and eviction fields for stores that have neither a matching catalog definition nor event metadata carrying those fields. The backend intentionally does not infer owner/policies from usage sites.
- Semantic/episodic index metadata such as embedding model, dimensions, distance/similarity, index freshness, or retention unless memory/index events persist it.
- Memory query top score, latency, and result count except when the event itself captured those fields.
- Blackboard conflict policy/resolution fields except where write events capture actual conflict/proposal data.

The UI should use feature detection:

- If `definition.quality.drift` exists, render the drift table. If absent, hide that table.
- If memory detail `schema`, `owner`, `source`, `backend`, `conflictPolicy`, `evictionPolicy`, `state.index`, or `state.retention` exists, render the corresponding cards. If absent, hide them; do not infer them from runtime values.
- Prefer `/api/memory/operations` for the overview operation history. Keep the old per-detail merge only as a temporary fallback for older binaries.
- If memory `state.queries[].latencyMs` / `topScore` is absent, omit those columns or show “not captured”.
- If workspace `size`, `mime`, `preview`, `versions`, or file diff routes are absent/404, hide preview/version/diff affordances.
- If plan version `diff` is absent or `/api/plans/{id}/diff` is 404, hide diff affordances.

The web devtools just received a new Claude Design handoff for the **Library** section. It defines 10 screens across 4 routes:

| Route | Screens |
|---|---|
| **Catalog** | architecture map with tree + featured definition (schemas, relations, quality impact, diagnostics) |
| **Memory** | overview + 4 detail screens (Working, Episodic, Semantic, Blackboard) |
| **Workspaces** | overview + per-workspace file inspector (preview, ops timeline, diff) |
| **Plans & Tasks** | overview + plan detail (full content, version diff, sub-task hierarchy, event log) |

The UI is wired for the data points the backend **has already promised** (the previous handoff: `definition.metadata.inputSchema/outputSchema`, `catalog.relations[]`, `definition.quality`). Those will light up automatically when the server re-deploys with those projections populated — they're returning `null` / `[]` on `localhost:4400` right now.

Beyond that, the design needs the following **new** read-model endpoints / fields. The UI is **deliberately not built yet** for the items in this doc (per user direction) — please ship the backend first so we don't have to redo the UI against a moving contract.

The relevant prototype source is in the design bundle under `crux-devtools-ui/project/v4-library.jsx` + `v4-library-detail.jsx` (latest reference: design id `lE2fsnWMkuiEz8Mqd_49Kw`). Open them when in doubt about what a screen renders — the data structures in this doc were extracted directly from those prototypes.

---

## 1. Catalog — quality impact drift table

The design's featured-definition view ends with a **Quality impact** table showing, for each affected eval/suite, the current pass-rate, run count, baseline experiment id, and drift in pp vs the baseline. Example row:

```
●  citation_validity   86%   142 runs   baseline · exp-216   drift · -3pp
●  answer_relevance    91%   142 runs   baseline · exp-216   drift · +1pp
●  rfp.gold @v7        86%    18 runs   baseline · exp-216   drift · -2pp
```

Today we have `definition.quality.affectedEvalIds` / `affectedSuiteIds` (the ids), but no pass-rate / drift figures keyed by definition id.

### Asked of backend

Extend `definition.quality` (the already-defined sub-object on `ProjectDefinition`) with a `drift` map:

```ts
interface ProjectDefinitionQuality {
  // ... existing fields ...
  drift?: {
    evals: Array<{
      id: string                  // eval id
      passRate: number            // 0..1 — current pass rate over `runs`
      runs: number                // sample size since the baseline experiment ended
      baselineExperimentId: string
      baselinePassRate: number    // 0..1 — pass rate at the time of the baseline
      driftPp: number             // (passRate - baselinePassRate) * 100, signed
    }>
    suites: Array<{
      id: string                  // suite id
      passRate: number
      runs: number
      baselineExperimentId: string
      baselinePassRate: number
      driftPp: number
    }>
  }
}
```

Backend already has all three inputs (`affectedEvalIds`, run pass-rate history, baseline ids). Wiring is the only step. We render zero when `driftPp == 0` and signed otherwise.

---

## 2. Memory — read models for all 4 memory types

Today: only `/api/observability/resources/memory` returns the raw `memory.read` / `memory.write` events (currently 88 entries on localhost). That's enough to draw an event log but **not** the current state, entries, chunks, or fields the design needs.

We need a **store-aware** projection layer. Proposed endpoints:

### 2.1 List of memory stores

```http
GET /api/memory/stores
```

```ts
type MemoryStore = {
  id: string                              // e.g. "wm_session_7e2a"
  type: 'working' | 'episodic' | 'semantic' | 'blackboard'
  label?: string                          // e.g. "Working · session"
  scope: { kind: 'run' | 'user' | 'session' | 'agent' | 'project'; id: string }
  stats: {
    reads: number
    writes: number
    entries: number | null                // null when not applicable (working)
    conflicts: number                     // blackboard-only; 0 otherwise
    lifetime: { startedAt: number; lastTouchedAt: number; durationMs: number }
  }
  lastRunId?: string
  lastTraceId?: string
  health: 'healthy' | 'partial' | 'stale' | 'errored'
}

// Response: readonly MemoryStore[]
```

### 2.2 Per-store detail

Single endpoint, shape depends on `type`:

```http
GET /api/memory/stores/{storeId}
```

The response includes the common header stats above plus one `state` block per type:

#### Working memory

```ts
state: {
  type: 'working'
  fields: Array<{ name: string; ty: string; value: unknown; updatedAt: number; writerSpanId?: string }>
  mutations: Array<{
    eventId: string
    op: 'write' | 'update' | 'append' | 'delete'
    key: string
    before: unknown        // null when the field didn't exist
    after: unknown
    spanId: string         // the span that mutated it
    span: string           // human-readable span path, e.g. "support_swarm → triage → step:wm_set"
    traceId: string
    timestamp: number
  }>
}
```

#### Episodic memory

```ts
state: {
  type: 'episodic'
  entries: Array<{
    id: string                      // e.g. "epi_8731"
    content: string
    tags: string[]
    confidence: number              // 0..1
    writtenBy: string               // span path, e.g. "support_swarm/billing"
    sourceTraceId: string
    timestamp: number
  }>
  queries: Array<{
    eventId: string
    query: string
    k: number
    topScore: number
    latencyMs: number
    spanId: string
    traceId: string
    timestamp: number
  }>
  writes: Array<{
    eventId: string
    op: 'append' | 'evict'
    entryId: string
    contentPreview: string
    confidence?: number
    writtenBy: string
    traceId: string
    timestamp: number
  }>
}
```

#### Semantic memory

```ts
state: {
  type: 'semantic'
  index: {
    chunkCount: number
    sourceCount: number
    embeddingModel: string          // e.g. "embed-3-small"
    dimensions: number              // e.g. 1536
    similarity: 'cosine' | 'dot' | 'euclidean'
  }
  chunks: Array<{
    id: string                      // e.g. "chunk_3814"
    sourceDoc: string               // e.g. "refund-policy.md#monthly"
    text: string                    // chunk text (~200-500 chars OK)
    magnitude?: number              // norm or quality score
    tags: string[]
  }>
  queries: Array<{
    eventId: string
    query: string
    k: number
    topScore: number
    hitChunkIds: string[]
    latencyMs: number
    spanId: string
    traceId: string
    timestamp: number
  }>
}
```

#### Blackboard

```ts
state: {
  type: 'blackboard'
  fields: Array<{
    name: string
    ty: string                              // type signature, e.g. "enum<billing|tech>"
    value: unknown
    writer: string                          // last agent to write
    writtenAt: number
    conflicts: number                       // count for this field
    lastConflictResolution?: string         // e.g. "tie broken via judge"
  }>
  changeLog: Array<{
    eventId: string
    agent: string                           // e.g. "consensus" / "triage"
    field: string
    before: unknown
    after: unknown
    resolved?: string                       // e.g. "tie broken via judge: 0.82"
    timestamp: number
  }>
  collaborators: string[]                   // distinct agents that ever wrote to this board
  conflictPolicy: string                    // e.g. "consensus.judge"
}
```

### 2.3 Invalidation

WS event `MemoryStoreEvent` on writes / new queries — same convention as the existing `QualityEvent` so the UI's TanStack Query prefix invalidator picks it up:

```ts
{ _tag: 'MemoryStoreEvent', kind: 'state' | 'query' | 'write' | 'conflict', storeId: string, ... }
```

---

## 3. Workspaces — full projection from scratch

`/api/observability/resources/workspace` currently returns `null`. The design needs a complete workspace projection.

### 3.1 List of workspaces

```http
GET /api/workspaces
```

```ts
type Workspace = {
  id: string                              // e.g. "ws_rfp_drafts"
  namespace: string                       // e.g. "projects/rfp/2026-q1"
  mounts: Array<{
    path: string                          // e.g. "/drafts", "/sources"
    mode: 'read-write' | 'read-only'
    fileCount: number
  }>
  stats: {
    runs: number                          // distinct runs that touched the workspace
    operations: number                    // total ops in window
    errors: number
    p50LatencyMs: number
    p99LatencyMs: number
  }
  lastTouchedAt: number
}

// Response: readonly Workspace[]
```

### 3.2 Per-workspace detail

```http
GET /api/workspaces/{workspaceId}
```

```ts
type WorkspaceDetail = Workspace & {
  files: Array<{
    path: string                          // full path including mount, e.g. "/drafts/acme-rfp/exec-summary.md"
    mount: string                         // which mount it belongs to
    op: 'read' | 'write' | 'edit' | 'delete' | 'list'  // last op
    status: 'ok' | 'err' | 'denied'
    size: number                          // bytes
    mime: string
    lastOpAt: number
    lastOpDurationMs: number
    lastError?: string                    // present when status === 'err'
    operationCount: number                // total ops on this file
  }>
  recentOps: Array<{
    eventId: string
    op: 'read' | 'write' | 'edit' | 'delete' | 'list'
    path: string
    durationMs: number
    status: 'ok' | 'err' | 'denied'
    bytes?: number                        // size of the read/write
    traceId: string
    spanId: string
    actor: string                         // span path or agent id
    error?: string
    timestamp: number
  }>
}
```

### 3.3 Per-file detail (preview + ops timeline + diff)

```http
GET /api/workspaces/{workspaceId}/files/{filePath}
```

`filePath` URL-encoded.

```ts
type WorkspaceFileDetail = {
  path: string
  mime: string
  size: number
  status: 'ok' | 'err' | 'denied'
  preview?: {
    contentType: 'text' | 'markdown' | 'json' | 'binary'
    body: string                          // text body; clipped to ~64KB; null for binary
    truncated: boolean
  }
  operations: Array<{
    eventId: string
    op: 'read' | 'write' | 'edit' | 'delete'
    actor: string                         // span path, e.g. "rfp.write_section → fs.write"
    spanId: string
    traceId: string
    durationMs: number
    diff?: { added: number; removed: number }  // line counts for edit ops
    timestamp: number
  }>
  versions?: Array<{
    versionId: string
    timestamp: number
    actor: string
    diff: { added: number; removed: number }
    traceId: string
  }>
}
```

### 3.4 Diff between two file versions

```http
GET /api/workspaces/{workspaceId}/files/{filePath}/diff?from={versionId}&to={versionId}
```

```ts
type WorkspaceFileDiff = {
  from: string
  to: string
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: Array<{ kind: 'context' | 'add' | 'remove'; text: string }>
  }>
}
```

### 3.5 WS invalidation

`WorkspaceEvent` with `kind: 'op' | 'mount-change' | 'error'`.

---

## 4. Plans & Tasks — plan detail + task hierarchy + version diff

Today: 5 plan events and 8 task events on `/api/observability/resources/plan` and `/api/observability/resources/task`. Enough for an event log, not enough for the screens.

### 4.1 List of plans

```http
GET /api/plans?status=active,suspended,completed,discarded&limit=...
```

```ts
type PlanSummary = {
  id: string                              // e.g. "plan_rfp_acme"
  title: string
  status: 'active' | 'suspended' | 'completed' | 'discarded' | 'in_progress'
  version: number                         // current version
  versionCount: number
  startedAt: number
  lastUpdatedAt: number
  author: string                          // agent or user id
  taskCounts: { done: number; inProgress: number; pending: number; removed: number }
  contentPreview: string                  // first ~280 chars of the plan body
}
```

### 4.2 Plan detail (everything the design's plan-detail screen needs)

```http
GET /api/plans/{planId}
```

```ts
type PlanDetail = PlanSummary & {
  content: string                         // full plan body (markdown / serif-rendered)
  versions: Array<{
    version: number
    timestamp: number
    author: string                        // "rfp_writer" / "henri" / etc.
    summary: string                       // "expanded tech section outline"
    diff: { added: number; removed: number }
    contentSnapshot?: string              // optional, for diff rendering
  }>
  tasks: Array<{
    id: string                            // e.g. "t-03"
    parentId: string | null               // sub-task hierarchy
    label: string
    status: 'done' | 'in_progress' | 'pending' | 'removed'
    progress: number                      // 0..1
    assignee: string                      // agent id or user
    model?: string                        // e.g. "gpt-4o"
    durationMs: number | null
    spanId?: string                       // the span that produced the task action
    traceId?: string
    addedInVersion: number                // which plan version added it
    removedInVersion?: number             // present for status 'removed'
  }>
  events: Array<{
    eventId: string
    kind: 'plan.created' | 'plan.updated' | 'task.added' | 'task.updated' | 'task.removed'
    agent: string                         // who triggered it (agent or user)
    label: string                         // human-readable description, e.g. "t-03 · 50% → 62%"
    timestamp: number
    payload?: unknown                     // raw event payload for inspection
  }>
}
```

### 4.3 Plan version diff

```http
GET /api/plans/{planId}/diff?from={versionA}&to={versionB}
```

```ts
type PlanDiff = {
  from: number
  to: number
  summary: string                         // e.g. "added compliance carve-out"
  contentDiff: {
    added: number
    removed: number
    hunks: Array<{ kind: 'context' | 'add' | 'remove'; text: string }>
  }
  taskDelta: {
    added: string[]                       // task ids added in this version
    removed: string[]
    statusChanges: Array<{ taskId: string; from: string; to: string }>
  }
}
```

### 4.4 WS invalidation

`PlanEvent` with `kind: 'plan' | 'task'`, prefix-invalidated like `QualityEvent`.

---

## Wiring expectations

- All endpoints: REST GET, JSON, served by the same Go CLI dev server (port 4400) the rest of devtools already uses.
- Read-only — no mutations from the UI.
- WS push: a single `*.changed` event per cluster is fine. The UI's TanStack Query layer invalidates by prefix, so per-store / per-workspace / per-plan ids don't need their own keys server-side.
- **Treat the backend payload as authoritative**, per the existing UI rules in `packages/crux-devtools/CLAUDE.md`. The UI should never reconstruct memory state, workspace file lists, plan versions, etc. from raw events client-side once these endpoints exist.

## What the UI will do once these ship

1. **Catalog** — render the quality drift table from `quality.drift` (~30 lines of UI code). No new screens, just a new card.
2. **Memory** — implement all 5 screens (overview + 4 details) against `/api/memory/stores` + `/api/memory/stores/{id}`. ~1 day of UI work.
3. **Workspaces** — implement both screens against `/api/workspaces` + per-workspace detail + per-file detail. ~1 day.
4. **Plans & Tasks** — implement both screens against `/api/plans` + `/api/plans/{id}`. ~1 day.

Total UI work after backend lands: ~3–4 days. None of it is hard; it's all card grids, tables, and timelines against well-shaped payloads. The blocker is the data not existing yet.

Ping me when any cluster (Catalog drift / Memory / Workspaces / Plans) is ready and I'll wire that one up.
