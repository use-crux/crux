export type RunsGroupBy = "none" | "primitive" | "session" | "target";

export interface RunsFilters {
  status?: readonly string[];
  target?: readonly string[];
  model?: readonly string[];
  last?: "all" | "1h" | "24h" | "7d" | "30d";
  search?: string;
  /** Pre-filter to runs whose DefinitionRefs include this Catalog definition (Phase 3 filter). */
  definitionId?: string;
}

export interface RunsProps {
  /**
   * Default group is `primitive` (initiation primitive - flow/agent/etc.).
   * `session` groups by the literal `sessionId` from the root trace:
   * metadata only, since runs are already structurally grouped by root.
   */
  groupBy: RunsGroupBy;
  filters: RunsFilters;
}

export type RunsTab = "all" | "live" | "failures";

export type RunKind =
  | "flow"
  | "swarm"
  | "pipeline"
  | "consensus"
  | "agent"
  | "retrieval"
  | "generate"
  | "resolve"
  | "defer"
  | "trace";

export type ColumnId =
  | "kind"
  | "status"
  | "trace"
  | "target"
  | "model"
  | "provider"
  | "dur"
  | "tokens"
  | "cost"
  | "score"
  | "tools"
  | "spans"
  | "session"
  | "error"
  | "time";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  width: string;
  align?: "right";
}

export interface RunRow {
  kind: RunKind;
  /** The operation-family id used by list identity, selection, and navigation. */
  operationId: string;
  /** A stable id for React keys + onclick navigation. */
  id: string;
  /** Display name. */
  target: string;
  /** Session id from the root trace - metadata only, not used for rollup. */
  sessionId?: string;
  model?: string;
  provider?: string;
  status: string;
  startedAt: number;
  durationMs?: number;
  tokenCount?: number;
  cost?: number;
  score?: number;
  /** Number of tool invocations across the run family. */
  toolCallCount?: number;
  /** Number of nested traces if this is a flow rollup. */
  childCount?: number;
  /** Server-owned canonical graph rollups from the observability run list. */
  recordCount?: number;
  spanCount?: number;
  eventCount?: number;
  artifactCount?: number;
  edgeCount?: number;
  /** Run-level diagnostics from the backend read model. */
  diagnosticsCount?: number;
  diagnosticsMaxSeverity?: string;
  /** Short error preview, only meaningful when `status` is error-ish. */
  errorMessage?: string;
  /** Server-owned read-model revision this row was current as of. */
  revision?: number;
  /** Number of physical execution segments observed for this logical run. */
  segmentCount?: number;
  /** The only live segment, omitted when none or more than one is live. */
  activeSegmentId?: string;
  /** Whether the server could establish one causal display order. */
  orderingConfidence?: "causal" | "partial" | string;
  /** Missing segment-local sequence values and unresolved parent references. */
  gapCount?: number;
  /** Deprecated compatibility field; operation identity is never inferred from traceId. */
  traceAliasConflict?: boolean;
  /** Delivery/export health; "unknown" is distinct from "healthy". */
  deliveryHealth?: "unknown" | "healthy" | "degraded" | string;
  topologyHealth?: "healthy" | "incomplete" | "conflicted" | string;
  activeChildCount?: number;
  suspendedChildCount?: number;
  failedChildCount?: number;
}
