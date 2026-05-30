export const CRUX_OBSERVABILITY_SCHEMA_VERSION = 1

export const CRUX_PRIMITIVE_FAMILIES = [
  'run',
  'generation',
  'prompt',
  'context',
  'agent',
  'flow',
  'composition',
  'tool',
  'retrieval',
  'embedding',
  'memory',
  'constraint',
  'guardrail',
  'routing',
  'cache',
  'compaction',
  'cost',
  'eval',
  'scoring',
  'citation',
  'handoff',
  'delegate',
  'plan',
  'task',
  'workspace',
  'indexing',
  'ingest',
  'corpus',
  'skill',
  'security',
  'feedback',
  'runtime',
  'custom',
] as const

export const CRUX_PRIMITIVE_NAMES = [
  'run',
  'generation.call',
  'generation.stream',
  'prompt.resolve',
  'prompt.budget',
  'context.resolve',
  'context.predicate',
  'context.cache',
  'agent.run',
  'flow.run',
  'flow.step',
  'flow.suspension',
  'composition.parallel',
  'composition.pipeline',
  'composition.consensus',
  'composition.swarm',
  'composition.branch',
  'composition.join',
  'composition.vote',
  'tool.call',
  'tool.approval',
  'retrieval.query',
  'retrieval.stage',
  'embedding.call',
  'memory.read',
  'memory.write',
  'constraint.check',
  'constraint.retry',
  'guardrail.run',
  'routing.router',
  'routing.cascade',
  'fallback.attempt',
  'cache.lookup',
  'compaction.run',
  'eval.run',
  'eval.case',
  'scoring.judge',
  'citation.check',
  'handoff.prepare',
  'delegate.invoke',
  'plan.operation',
  'task.operation',
  'workspace.operation',
  'indexing.pipeline',
  'ingest.parse',
  'corpus.sync',
  'skill.load',
  'security.warning',
  'cost.record',
  'feedback.record',
  'runtime.convex.action',
  'runtime.convex.query',
  'runtime.convex.mutation',
  'runtime.convex.schedule',
  'runtime.convex.resume',
  'runtime.convex.flush',
  'custom.operation',
] as const

export const CRUX_CANONICAL_EDGE_TYPES = [
  'caused',
  'triggered',
  'called',
  'explains',
  'produced',
  'consumed',
  'handoff.payload',
  'delegate.invoked',
  'memory.read',
  'memory.write',
  'retrieval.returned',
  'citation.used',
  'constraint.retry',
  'guardrail.blocked',
  'fallback.attempt',
  'replay.of',
  'feedback.for',
  'eval.case_of',
  'comparison.baseline',
  'comparison.candidate',
] as const

export const CRUX_CANONICAL_ARTIFACT_KINDS = [
  'input',
  'output',
  'messages',
  'system',
  'context',
  'prompt',
  'tool.args',
  'tool.request',
  'tool.result',
  'retrieval.hits',
  'memory.snapshot',
  'handoff.payload',
  'constraint.report',
  'guardrail.report',
  'error.stack',
  'error.raw',
  'stream.timeline',
  'score.report',
  'citation.report',
] as const

export const CRUX_PRIMITIVE_FAMILY_BY_NAME = {
  run: 'run',
  'generation.call': 'generation',
  'generation.stream': 'generation',
  'prompt.resolve': 'prompt',
  'prompt.budget': 'prompt',
  'context.resolve': 'context',
  'context.predicate': 'context',
  'context.cache': 'context',
  'agent.run': 'agent',
  'flow.run': 'flow',
  'flow.step': 'flow',
  'flow.suspension': 'flow',
  'composition.parallel': 'composition',
  'composition.pipeline': 'composition',
  'composition.consensus': 'composition',
  'composition.swarm': 'composition',
  'composition.branch': 'composition',
  'composition.join': 'composition',
  'composition.vote': 'composition',
  'tool.call': 'tool',
  'tool.approval': 'tool',
  'retrieval.query': 'retrieval',
  'retrieval.stage': 'retrieval',
  'embedding.call': 'embedding',
  'memory.read': 'memory',
  'memory.write': 'memory',
  'constraint.check': 'constraint',
  'constraint.retry': 'constraint',
  'guardrail.run': 'guardrail',
  'routing.router': 'routing',
  'routing.cascade': 'routing',
  'fallback.attempt': 'routing',
  'cache.lookup': 'cache',
  'compaction.run': 'compaction',
  'eval.run': 'eval',
  'eval.case': 'eval',
  'scoring.judge': 'scoring',
  'citation.check': 'citation',
  'handoff.prepare': 'handoff',
  'delegate.invoke': 'delegate',
  'plan.operation': 'plan',
  'task.operation': 'task',
  'workspace.operation': 'workspace',
  'indexing.pipeline': 'indexing',
  'ingest.parse': 'ingest',
  'corpus.sync': 'corpus',
  'skill.load': 'skill',
  'security.warning': 'security',
  'cost.record': 'cost',
  'feedback.record': 'feedback',
  'runtime.convex.action': 'runtime',
  'runtime.convex.query': 'runtime',
  'runtime.convex.mutation': 'runtime',
  'runtime.convex.schedule': 'runtime',
  'runtime.convex.resume': 'runtime',
  'runtime.convex.flush': 'runtime',
  'custom.operation': 'custom',
} as const satisfies Record<(typeof CRUX_PRIMITIVE_NAMES)[number], (typeof CRUX_PRIMITIVE_FAMILIES)[number]>

type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type CruxRunId = Brand<string, 'CruxRunId'>
export type CruxTraceId = Brand<string, 'CruxTraceId'>
export type CruxSpanId = Brand<string, 'CruxSpanId'>
export type CruxSpanEventId = Brand<string, 'CruxSpanEventId'>
export type CruxEdgeId = Brand<string, 'CruxEdgeId'>
export type CruxArtifactId = Brand<string, 'CruxArtifactId'>
export type CruxRecordId = Brand<string, 'CruxRecordId'>

export type CruxRunStatus = 'running' | 'ok' | 'error' | 'blocked' | 'cancelled' | 'suspended'
export type CruxSpanStatus = CruxRunStatus | 'skipped'

export type CruxPrimitiveFamily = (typeof CRUX_PRIMITIVE_FAMILIES)[number]

export type CruxPrimitiveName = (typeof CRUX_PRIMITIVE_NAMES)[number]

export type CruxCustomEdgeType = `custom.${string}`
export type CruxCanonicalEdgeType = (typeof CRUX_CANONICAL_EDGE_TYPES)[number]
export type CruxEdgeType = CruxCanonicalEdgeType | CruxCustomEdgeType

export type CruxCustomArtifactKind = `custom.${string}`
export type CruxCanonicalArtifactKind = (typeof CRUX_CANONICAL_ARTIFACT_KINDS)[number]
export type CruxArtifactKind = CruxCanonicalArtifactKind | CruxCustomArtifactKind

export interface CruxSourceLocation {
  file: string
  line: number
  column?: number
  function?: string
}

export interface CruxTokenMetrics {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  costUsd?: number
}

export type CruxAttributes = Record<string, unknown>
export type CruxMetrics = CruxTokenMetrics & Record<string, number | undefined>

export interface CruxGenerationCallAttributes {
  mode?: 'text' | 'object' | 'messages'
  temperature?: number
  finishReason?: string
}

export interface CruxGenerationStreamAttributes {
  mode?: 'text' | 'object' | 'messages'
  ttftMs?: number
  chunksReceived?: number
  tokensPerSecond?: number
  finishReason?: string
}

export interface CruxPromptResolveAttributes {
  contextCount?: number
  droppedContextCount?: number
  excludedContextCount?: number
}

export type CruxSpanAttributesByPrimitive = {
  'generation.call': CruxGenerationCallAttributes
  'generation.stream': CruxGenerationStreamAttributes
  'prompt.resolve': CruxPromptResolveAttributes
  'custom.operation': CruxAttributes
}

export interface CruxErrorSummary {
  message: string
  name?: string
  category?: string
  retryable?: boolean
  statusCode?: number
}

interface CruxRecordBase {
  schemaVersion: typeof CRUX_OBSERVABILITY_SCHEMA_VERSION
  recordId: CruxRecordId
  runId: CruxRunId
  traceId?: CruxTraceId
}

export interface CruxRunStartRecord extends CruxRecordBase {
  type: 'run:start'
  name: string
  rootPrimitive: CruxPrimitiveName
  startedAt: string
  status: Extract<CruxRunStatus, 'running'>
  attributes?: CruxAttributes
  source?: CruxSourceLocation
}

export interface CruxRunEndRecord extends CruxRecordBase {
  type: 'run:end'
  endedAt: string
  durationMs?: number
  status: Exclude<CruxRunStatus, 'running'>
  metrics?: CruxMetrics
  error?: CruxErrorSummary
  attributes?: CruxAttributes
}

export interface CruxSpanStartRecord extends CruxRecordBase {
  type: 'span:start'
  spanId: CruxSpanId
  parentSpanId?: CruxSpanId | null
  family: CruxPrimitiveFamily
  primitive: CruxPrimitiveName
  name: string
  startedAt: string
  status: Extract<CruxSpanStatus, 'running'>
  model?: string
  provider?: string
  promptId?: string
  contextId?: string
  agentId?: string
  toolName?: string
  flowId?: string
  stepId?: string
  memoryId?: string
  retrieverId?: string
  attributes?: CruxAttributes
  source?: CruxSourceLocation
}

export interface CruxSpanEndRecord extends CruxRecordBase {
  type: 'span:end'
  spanId: CruxSpanId
  endedAt: string
  durationMs?: number
  status: Exclude<CruxSpanStatus, 'running'>
  metrics?: CruxMetrics
  error?: CruxErrorSummary
  attributes?: CruxAttributes
}

export interface CruxSpanRecord extends CruxRecordBase {
  type: 'span'
  spanId: CruxSpanId
  parentSpanId?: CruxSpanId | null
  family: CruxPrimitiveFamily
  primitive: CruxPrimitiveName
  name: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  status: Exclude<CruxSpanStatus, 'running'>
  metrics?: CruxMetrics
  error?: CruxErrorSummary
  attributes?: CruxAttributes
  source?: CruxSourceLocation
}

export interface CruxSpanEventRecord extends CruxRecordBase {
  type: 'span:event'
  spanId: CruxSpanId
  eventId: CruxSpanEventId
  name: string
  timestamp: string
  attributes?: CruxAttributes
}

export type CruxGraphNodeRef =
  | { kind: 'run'; id: CruxRunId }
  | { kind: 'span'; id: CruxSpanId }
  | { kind: 'artifact'; id: CruxArtifactId }

export interface CruxEdgeRecord extends CruxRecordBase {
  type: 'edge'
  edgeId: CruxEdgeId
  edgeType: CruxEdgeType
  from: CruxGraphNodeRef
  to: CruxGraphNodeRef
  createdAt: string
  attributes?: CruxAttributes
}

export interface CruxArtifactRecord extends CruxRecordBase {
  type: 'artifact'
  artifactId: CruxArtifactId
  spanId?: CruxSpanId
  kind: CruxArtifactKind
  createdAt: string
  contentType: string
  encoding: 'json' | 'text' | 'bytes' | 'reference'
  sizeBytes?: number
  hash?: string
  preview?: unknown
  uri?: string
  attributes?: CruxAttributes
}

export type CruxGraphRecord =
  | CruxRunStartRecord
  | CruxRunEndRecord
  | CruxSpanStartRecord
  | CruxSpanEndRecord
  | CruxSpanRecord
  | CruxSpanEventRecord
  | CruxEdgeRecord
  | CruxArtifactRecord

export interface CruxGraphRecordBatch {
  records: CruxGraphRecord[]
}

export type CruxPresentationDisplay = 'primary' | 'detail' | 'metadata'

export interface CruxPresentationHint {
  display?: CruxPresentationDisplay
  ownerSpanId?: CruxSpanId | string
  label?: string
  groupId?: string
}

export interface CruxPresentationAttributes {
  presentation?: CruxPresentationHint
}

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
  attributes?: CruxAttributes | null
  metrics?: CruxMetrics | null
  error?: CruxErrorSummary | string | null
}

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
  metrics?: CruxMetrics | null
  error?: CruxErrorSummary | string | null
}

export interface CruxPresentationDetailView extends CruxSpanSummaryView {
  display: Exclude<CruxPresentationDisplay, 'primary'>
}

export interface CruxPresentationNodeView extends CruxSpanSummaryView {
  display: 'primary'
  details?: CruxPresentationDetailView[]
  children: CruxPresentationNodeView[]
}

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

export type CruxRunDetailStatus = CruxRunStatus | CruxSpanStatus | 'incomplete' | 'stale' | string
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

export type CruxPresentationPlacement = 'node' | 'detail' | 'runDetail' | 'omitted'
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

export interface CruxRunDetailDisplay {
  kind: CruxPresentationNodeKind
  label: string
  description?: string
  icon?: string
  accent?: string
  severity?: 'info' | 'ok' | 'warn' | 'error' | string
}

export interface CruxRunDetailTiming {
  startedAt: string
  endedAt?: string
  durationMs: number
  selfMs?: number
  childrenMs?: number
  detailsMs?: number
}

export interface CruxRunDetailMetricBuckets {
  own?: CruxMetrics | null
  children?: CruxMetrics | null
  details?: CruxMetrics | null
  total?: CruxMetrics | null
}

export interface CruxRunDetailInspectionItem {
  type: 'span' | 'event' | 'artifact' | 'relation' | 'diagnostic' | 'metric' | 'raw' | string
  id: string
  label?: string
  kind?: string
  role?: string
  sourceSpanId?: CruxSpanId | string
  data?: unknown
}

export type CruxRunDetailInspectionSections = Record<string, CruxRunDetailInspectionItem[]>

export interface CruxRunDetailDiagnostic {
  code: string
  severity: 'info' | 'warn' | 'error'
  message: string
  recordIds?: CruxRecordId[] | string[]
  spanIds?: CruxSpanId[] | string[]
  suggestedFix?: string
}

export interface CruxRunDetailArtifact {
  artifactId: CruxArtifactId
  runId: CruxRunId
  traceId: CruxTraceId | ''
  spanId: CruxSpanId | ''
  kind: CruxArtifactKind | string
  createdAt: string
  contentType: string
  encoding: string
  sizeBytes: number
  hash: string
  uri: string
  preview?: unknown
  attributes?: CruxAttributes | null
}

export interface CruxRunDetailEvent {
  eventId: CruxSpanEventId
  runId: CruxRunId
  traceId: CruxTraceId | ''
  spanId: CruxSpanId
  name: string
  timestamp: string
  attributes?: CruxAttributes | null
}

export interface CruxObservabilityRecordsNotification {
  _tag: 'ObservabilityEvent'
  id: string
  timestamp: number
  kind: 'observability.records'
  action: 'ingested'
  severity: 'info'
  refId: CruxRunId | string
  payload?: {
    runId: CruxRunId | string
  }
}

export interface CruxTokenDeltaNotification {
  _tag: 'ObservabilityEvent'
  id: string
  timestamp: number
  kind: 'token.delta'
  action: 'appended'
  severity: 'info'
  refId: CruxRunId | string
  payload: {
    runId: CruxRunId | string
    traceId?: CruxTraceId | string
    spanId: CruxSpanId | string
    eventId: CruxSpanEventId | string
    timestamp: string
    attributes?: CruxAttributes | null
  }
}

export type CruxObservabilityNotification = CruxObservabilityRecordsNotification | CruxTokenDeltaNotification

export interface CruxRunDetailRelation {
  edgeId: CruxEdgeId
  runId: CruxRunId
  traceId: CruxTraceId | ''
  edgeType: CruxEdgeType | string
  from: CruxGraphNodeRef | { kind: string; id: string }
  to: CruxGraphNodeRef | { kind: string; id: string }
  createdAt: string
  attributes?: CruxAttributes | null
}

export interface CruxRunDetailSource {
  placementReason: CruxPresentationPlacementReason
  ownerSpanId?: CruxSpanId | string
  canonicalParentSpanId?: CruxSpanId | string
}

export interface CruxRunDetailDetail extends CruxSpanSummaryView {
  id: string
  kind: CruxPresentationNodeKind
  role?: string
  label: string
  display: Exclude<CruxPresentationDisplay, 'primary'>
  timing: CruxRunDetailTiming
  summary?: string
  events: CruxRunDetailEvent[]
  artifacts: CruxRunDetailArtifact[]
  relations: CruxRunDetailRelation[]
  diagnostics: CruxRunDetailDiagnostic[]
  source: CruxRunDetailSource
  inspection?: CruxRunDetailInspectionSections
}

export interface CruxRunDetailNode extends CruxSpanSummaryView {
  id: string
  virtual: boolean
  parentId: string
  path: string[]
  kind: CruxPresentationNodeKind
  display: CruxRunDetailDisplay
  timing: CruxRunDetailTiming
  metricBuckets: CruxRunDetailMetricBuckets
  source: CruxRunDetailSource
  details: CruxRunDetailDetail[]
  artifacts: CruxRunDetailArtifact[]
  events: CruxRunDetailEvent[]
  relations: CruxRunDetailRelation[]
  diagnostics: CruxRunDetailDiagnostic[]
  flow?: CruxAttributes | null
  step?: CruxAttributes | null
  composition?: CruxAttributes | null
  transition?: CruxAttributes | null
  inspection?: CruxRunDetailInspectionSections
  children: CruxRunDetailNode[]
}

export interface CruxRunDetailRow {
  nodeId: string
  spanId?: CruxSpanId | string
  parentId: string
  depth: number
  path: string[]
  hasChildren: boolean
  expandedDefault: boolean
  display: CruxRunDetailDisplay
  status: CruxRunDetailStatus
  timing: CruxRunDetailTiming
  match?: boolean
}

export interface CruxRunDetailSpanPlacement {
  placement: CruxPresentationPlacement
  nodeId?: string
  ownerNodeId?: string
  path: string[]
  reason?: CruxPresentationPlacementReason
}

export interface CruxRunDetail {
  schemaVersion: typeof CRUX_OBSERVABILITY_SCHEMA_VERSION
  run: CruxRunSummaryView
  root: CruxRunDetailNode
  rows: CruxRunDetailRow[]
  spanIndex: Record<string, CruxRunDetailSpanPlacement>
  facets: Record<string, Record<string, number>>
  matches?: Record<string, unknown>
  diagnostics: CruxRunDetailDiagnostic[]
  counts: {
    primary: number
    detail: number
    metadata: number
    attachedDetails: number
  }
  debug?: unknown
}
