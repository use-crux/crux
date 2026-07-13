import type {
  CruxAttributes,
  CruxErrorSummary,
  CruxParsedMetrics,
  CruxPrimitiveFamily,
  CruxPrimitiveName,
  CruxRunId,
  CruxRunStatus,
  CruxSpanId,
  CruxSpanStatus,
  CruxTraceId,
} from '../contract'

/** Visual prominence for a span or detail in the observability read model. */
export type CruxPresentationDisplay = 'primary' | 'detail' | 'metadata'

/** Caller-supplied placement hints consumed by local presentation builders. */
export interface CruxPresentationHint {
  display?: CruxPresentationDisplay
  ownerSpanId?: CruxSpanId | string
  label?: string
  groupId?: string
}

/** Attributes envelope for presentation-only placement hints. */
export interface CruxPresentationAttributes {
  presentation?: CruxPresentationHint
}

/**
 * "unknown" (no persisted correlation to any delivery/export health signal)
 * is deliberately distinct from "healthy" — the server never invents a
 * healthy status it cannot actually trace back to this run.
 */
export interface CruxRunDeliveryHealth {
  status: 'unknown' | 'healthy' | 'degraded' | string
  rejected?: number
  lastKnownAt?: string
}

/** Run-level summary projected by the local observability read path. */
export interface CruxRunSummaryView {
  runId: CruxRunId
  traceId: CruxTraceId | ''
  name: string
  rootPrimitive: CruxPrimitiveName | string
  status: CruxRunStatus | string
  startedAt: string
  endedAt: string
  durationMs: number
  model: string
  provider: string
  promptId: string
  recordCount: number
  spanCount: number
  eventCount: number
  artifactCount: number
  edgeCount: number
  /** Number of physical execution segments observed for this logical run. */
  segmentCount: number
  /** The only live segment, omitted when none or more than one is live. */
  activeSegmentId?: string
  /** Whether the server could establish one causal display order. */
  orderingConfidence: 'causal' | 'partial'
  /** Missing segment-local sequence values and unresolved parent references. */
  gapCount: number
  /** True when a trace alias identifies more than one logical run. */
  traceAliasConflict?: boolean
  /** Delivery/export health; "unknown" is distinct from "healthy". */
  deliveryHealth?: CruxRunDeliveryHealth
  attributes?: CruxAttributes | null
  metrics?: CruxParsedMetrics | null
  error?: CruxErrorSummary | string | null
}

/** Span summary projected for graph, tree, and run-detail views. */
export interface CruxSpanSummaryView {
  spanId: CruxSpanId
  runId: CruxRunId
  traceId: CruxTraceId | ''
  parentSpanId: CruxSpanId | ''
  family: CruxPrimitiveFamily | string
  primitive: CruxPrimitiveName | string
  name: string
  status: CruxSpanStatus | string
  startedAt: string
  endedAt: string
  durationMs: number
  model: string
  provider: string
  promptId?: string
  contextId?: string
  agentId?: string
  toolName?: string
  flowId?: string
  stepId?: string
  memoryId?: string
  retrieverId?: string
  attributes?: (CruxAttributes & CruxPresentationAttributes) | null
  metrics?: CruxParsedMetrics | null
  error?: CruxErrorSummary | string | null
}

/** Secondary detail attached to a primary presentation node. */
export interface CruxPresentationDetailView extends CruxSpanSummaryView {
  display: Exclude<CruxPresentationDisplay, 'primary'>
}

/** Primary node in the compact presentation tree. */
export interface CruxPresentationNodeView extends CruxSpanSummaryView {
  display: 'primary'
  details?: CruxPresentationDetailView[]
  children: CruxPresentationNodeView[]
}

/** Compact presentation projection used by devtools graph views. */
export interface CruxPresentationView {
  run: CruxRunSummaryView
  displayMode: 'presentation'
  spans: CruxPresentationNodeView[]
  runDetails?: CruxPresentationDetailView[]
  hiddenSpanCount: number
  counts: {
    primary: number
    detail: number
    metadata: number
  }
}

/** Status values used by run-detail rows after lifecycle reconciliation. */
export type CruxRunDetailStatus = CruxRunStatus | CruxSpanStatus | 'incomplete' | 'stale' | string

/** Coarse visual kind used for run-detail nodes and details. */
export type CruxPresentationNodeKind =
  | 'run'
  | 'agent'
  | 'generation'
  | 'tool'
  | 'flow'
  | 'step'
  | 'composition'
  | 'transition'
  | 'memory'
  | 'retrieval'
  | 'detail'
  | 'operation'
  | string

/** Placement target chosen by the presentation projection. */
export type CruxPresentationPlacement = 'node' | 'detail' | 'runDetail' | 'omitted'

/** Explanation for why a span was placed at a given presentation location. */
export type CruxPresentationPlacementReason =
  | 'primary'
  | 'explains-edge'
  | 'owner-hint'
  | 'dataflow-edge'
  | 'chronology'
  | 'wrapper-compact'
  | 'run-root'
  | 'unknown'
  | string
