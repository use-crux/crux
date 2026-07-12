export type RunsGroupBy = 'none' | 'primitive' | 'session' | 'target'

export interface RunsFilters {
  status?: readonly string[]
  target?: readonly string[]
  model?: readonly string[]
  last?: 'all' | '1h' | '24h' | '7d' | '30d'
  has?: 'feedback' | 'experiment'
  search?: string
}

export interface RunsProps {
  /**
   * Default group is `primitive` (initiation primitive - flow/agent/etc.).
   * `session` groups by the literal `sessionId` from the root trace:
   * metadata only, since runs are already structurally grouped by root.
   */
  groupBy: RunsGroupBy
  filters: RunsFilters
}

export type RunsTab = 'all' | 'live' | 'failures' | 'has-feedback'

export type RunKind =
  | 'flow'
  | 'swarm'
  | 'pipeline'
  | 'consensus'
  | 'agent'
  | 'retrieval'
  | 'generate'
  | 'resolve'
  | 'defer'
  | 'trace'

export type ColumnId =
  | 'kind'
  | 'status'
  | 'trace'
  | 'target'
  | 'model'
  | 'provider'
  | 'dur'
  | 'tokens'
  | 'cost'
  | 'score'
  | 'fdbk'
  | 'tools'
  | 'spans'
  | 'session'
  | 'cassette'
  | 'error'
  | 'time'

export interface ColumnDef {
  id: ColumnId
  label: string
  width: string
  align?: 'right'
}

export interface RunRow {
  kind: RunKind
  /** The id used by the URL (traceId for traces, flow's first traceId for flows). */
  traceId: string
  /** A stable id for React keys + onclick navigation. */
  id: string
  /** Display name. */
  target: string
  /** Session id from the root trace - metadata only, not used for rollup. */
  sessionId?: string
  model?: string
  provider?: string
  status: string
  startedAt: number
  durationMs?: number
  tokenCount?: number
  cost?: number
  score?: number
  feedbackCount: number
  /** Number of tool invocations across the run family. */
  toolCallCount?: number
  /** Number of nested traces if this is a flow rollup. */
  childCount?: number
  /** Server-owned canonical graph rollups from the observability run list. */
  recordCount?: number
  spanCount?: number
  eventCount?: number
  artifactCount?: number
  edgeCount?: number
  /** Cassette replay state: 'recorded' | 'missing' | 'mismatch' | etc. */
  cassetteStatus?: string
  /** Run-level diagnostics from the backend read model. */
  diagnosticsCount?: number
  diagnosticsMaxSeverity?: string
  /** Short error preview, only meaningful when `status` is error-ish. */
  errorMessage?: string
}
