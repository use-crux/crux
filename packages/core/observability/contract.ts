import type { TurnDecisionReport } from './turn-decision-report'

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
  'retrieval.pipeline',
  'retrieval.recipe',
  'retrieval.retrieve',
  'retrieval.query',
  'retrieval.stage',
  'retrieval.step',
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
  'context.contribution',
  'prompt',
  'prompt.budget',
  'tool.args',
  'tool.request',
  'tool.result',
  'retrieval.hits',
  'memory.snapshot',
  'memory.recall',
  'memory.diff',
  'handoff.payload',
  'delegate.report',
  'constraint.report',
  'guardrail.report',
  'error.stack',
  'error.raw',
  'stream.timeline',
  'score.report',
  'citation.report',
  'composition.report',
  'routing.report',
  'cache.report',
  'compaction.report',
  'embedding.report',
  'indexing.report',
  'ingest.report',
  'corpus.report',
  'security.report',
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
  'retrieval.pipeline': 'retrieval',
  'retrieval.recipe': 'retrieval',
  'retrieval.retrieve': 'retrieval',
  'retrieval.query': 'retrieval',
  'retrieval.stage': 'retrieval',
  'retrieval.step': 'retrieval',
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

export type CruxContextContributionState = 'active' | 'checked-not-included' | 'dropped-budget' | 'disabled'
export type CruxContextInjectableKind =
  | 'prompt'
  | 'context'
  | 'conditional'
  | 'match'
  | 'skill'
  | 'memory'
  | 'blackboard'
  | 'retriever'
  | 'handoff'
  | 'injectable'
export type CruxContextInjects = 'system' | 'tools' | 'constraints' | 'guardrails'
export type CruxContextCacheStatus = 'hit' | 'miss' | 'disabled'

export interface CruxContextTextSegmentPreview {
  text: string
  dynamic: boolean
  source?: string
}

export interface CruxContextContributionPreview {
  kind: 'context.contribution'
  state: CruxContextContributionState
  included: boolean
  sourceId: string
  injectableKind: CruxContextInjectableKind
  reason?: string
  branch?: string
  injects?: readonly CruxContextInjects[]
  priority?: number
  sizeBytes?: number
  tokens?: number
  cacheStatus?: CruxContextCacheStatus
  injectedTools?: readonly string[]
  segments?: readonly CruxContextTextSegmentPreview[]
  staticTokens?: number
  dynamicTokens?: number
  text?: string
}

export interface CruxPromptBudgetPreview {
  kind: 'prompt.budget'
  usedTokens: number
  totalTokens: number
  dropped: readonly CruxContextContributionPreview[]
}

export interface CruxPromptInputPreview {
  kind: 'prompt.input'
  promptId?: string
  validationStatus: 'passed' | 'failed' | 'not-configured'
  providedKeys: readonly string[]
  schemaKeys?: readonly string[]
  requiredKeys?: readonly string[]
  missingKeys?: readonly string[]
  unexpectedKeys?: readonly string[]
}

export interface CruxRetrievalHitPreview {
  rank: number
  sourceId: string
  chunkId: string
  score?: number
  preview?: string
}

export interface CruxRetrievalStagePreview {
  name: string
  phase?: 'query' | 'hits'
  kind?: string
  status?: 'success' | 'error' | 'skipped'
  inHits?: number
  outHits?: number
  inQueries?: number
  outQueries?: number
  note?: string
}

export interface CruxRetrievalHitsPreview {
  kind: 'retrieval.hits'
  query: string
  mode?: string
  recipeId?: string
  fusion?: string
  limit?: number
  returned: number
  hits: readonly CruxRetrievalHitPreview[]
  stages?: readonly CruxRetrievalStagePreview[]
}

export interface CruxMemoryRecalledBlockPreview {
  blockKind: string
  key: string
  preview: string
  score?: number
}

export interface CruxMemoryRecallPreview {
  kind: 'memory.recall'
  memoryType?: string
  blockKind: string
  operation: string
  query?: string
  returned: number
  blocks: readonly CruxMemoryRecalledBlockPreview[]
}

export interface CruxMemoryBlockSummaryPreview {
  blockKind: string
  key?: string
  preview: string
  score?: number
}

export interface CruxMemoryDiffPreview {
  kind: 'memory.diff'
  memoryType?: string
  blockKind: string
  operation: string
  before?: unknown
  after?: unknown
  added?: readonly CruxMemoryBlockSummaryPreview[]
  removed?: readonly CruxMemoryBlockSummaryPreview[]
  updated?: readonly CruxMemoryBlockSummaryPreview[]
}

export interface CruxCitationMarkerPreview {
  marker: string
  start?: number
  end?: number
  outputQuote?: string
  sourceId?: string
  chunkId?: string
  score?: number
  grounded?: boolean
  note?: string
}

export interface CruxCitationReportPreview {
  kind: 'citation.report'
  valid?: boolean
  markers: readonly CruxCitationMarkerPreview[]
  summary?: Record<string, number | string | boolean>
}

export interface CruxScoreJudgePreview {
  name: string
  score?: number
  threshold?: number
  status?: 'passed' | 'failed' | 'warn' | string
  rationale?: string
}

export interface CruxScoreReportPreview {
  kind: 'score.report'
  verdict?: 'pass' | 'fail' | string
  primaryFailureType?: string
  score?: number
  rawScore?: number
  reasoningPreview?: string
  judges?: readonly CruxScoreJudgePreview[]
  expected?: unknown
  actual?: unknown
}

export interface CruxCompositionBranchPreview {
  id: string
  agentId?: string
  status: 'success' | 'error' | 'skipped' | string
  durationMs?: number
  tokens?: number
  resultPreview?: unknown
  error?: string
}

export interface CruxCompositionVotePreview {
  agent: string
  answer?: string
  confidence?: number
  reasoning?: string
}

export interface CruxCompositionStagePreview {
  name: string
  status?: 'success' | 'error' | 'skipped' | string
  outputPreview?: unknown
}

export interface CruxCompositionReportPreview {
  kind: 'composition.report'
  compositionType: 'parallel' | 'pipeline' | 'consensus' | 'swarm'
  compositionId?: string
  status?: 'success' | 'error' | string
  branches?: readonly CruxCompositionBranchPreview[]
  stages?: readonly CruxCompositionStagePreview[]
  agreement?: number
  quorum?: 'majority' | 'unanimous' | number
  votes?: readonly CruxCompositionVotePreview[]
  handoffPath?: readonly string[]
  handoffCount?: number
  finalAgentId?: string
  roster?: readonly {
    id: string
    role?: string
    turns?: number
    durationMs?: number
    tokens?: number
  }[]
  wallTimeMs?: number
  serialTimeMs?: number
}

export interface CruxHandoffPayloadPreview {
  kind?: 'handoff.payload'
  handoffId?: string
  fromAgent?: string
  toAgent?: string
  hop?: number
  totalHops?: number
  reason?: string
  contract?: { input?: string; output?: string }
  inputSize?: number
  outputSize?: number
  beforeSize?: number
  afterSize?: number
  summary?: string
  data?: unknown
}

export interface CruxDelegateReportPreview {
  kind: 'delegate.report'
  delegateId: string
  handoffId?: string
  caller?: string
  callee?: string
  inputSize?: number
  outputSize?: number
  subRunId?: string
  args?: unknown
  resultPreview?: unknown
}

export interface CruxConstraintAttemptPreview {
  n: number
  status: 'pass' | 'fail' | 'retry' | string
  feedback?: string
}

export interface CruxConstraintReportPreview {
  kind: 'constraint.report'
  assertion?: string
  constraint?: string
  severity?: string
  pass?: boolean
  feedback?: string
  attempts?: readonly CruxConstraintAttemptPreview[]
  nextAttempt?: number
  metadata?: unknown
}

export interface CruxGuardrailMatchPreview {
  kind?: string
  from?: string
  to?: string
  note?: string
}

export interface CruxGuardrailReportPreview {
  kind: 'guardrail.report'
  phase?: string
  action: 'pass' | 'block' | 'redact' | 'transform' | 'warn' | string
  matches?: readonly CruxGuardrailMatchPreview[]
  reason?: string
  beforePreview?: string
  afterPreview?: string
}

export interface CruxRoutingTierPreview {
  tier: number
  model: string
  budget?: number
  verdict?: 'accepted' | 'rejected' | 'skipped' | 'error' | string
  note?: string
  confidence?: number
  cost?: number
  durationMs?: number
}

export interface CruxRoutingReportPreview {
  kind: 'routing.report'
  routingKind: 'router' | 'cascade' | 'fallback'
  chosen?: string
  classifiedAs?: string
  fallbackReason?: string
  tiers?: readonly CruxRoutingTierPreview[]
  availableRoutes?: readonly string[]
  selectedModel?: string
}

export interface CruxCacheReportPreview {
  kind: 'cache.report'
  cacheKind: string
  status: 'hit' | 'miss' | 'mixed' | 'write' | string
  key?: string
  hitCount?: number
  missCount?: number
  skippedSpanId?: CruxSpanId | string
  saved?: {
    tokens?: number
    costUsd?: number
    latencyMs?: number
  }
}

export interface CruxCompactionReportPreview {
  kind: 'compaction.report'
  strategy: string
  beforeTokens: number
  afterTokens: number
  compressionRatio?: number
  summarizedPreview?: string
}

export interface CruxEmbeddingReportPreview {
  kind: 'embedding.report'
  embeddingKind: 'dense' | 'sparse' | string
  embeddingName?: string
  dimensions?: number
  inputCount: number
  chunkCount?: number
  cacheHitCount?: number
  cacheMissCount?: number
  cacheHitRatio?: number
  truncatedCount?: number
  retryCount?: number
  rateLimitWaitMs?: number
}

export interface CruxSourceStageCountsPreview {
  parse?: number
  chunk?: number
  embed?: number
  store?: number
  [key: string]: number | undefined
}

export interface CruxCorpusSourcePreview {
  id: string
  action: 'added' | 'changed' | 'unchanged' | 'skipped' | 'failed' | 'stale' | 'deleted' | string
  reason?: string
  chunks?: number
}

export interface CruxIndexingReportPreview {
  kind: 'indexing.report'
  indexerId?: string
  namespace?: string
  operation: string
  totals: {
    sources: number
    chunks: number
    parents?: number
    added?: number
    changed?: number
    unchanged?: number
    skipped?: number
    failed?: number
    stale?: number
    deleted?: number
  }
  stageCounts?: CruxSourceStageCountsPreview
  sources?: readonly CruxCorpusSourcePreview[]
}

export interface CruxIngestReportPreview {
  kind: 'ingest.report'
  sourceId: string
  status: 'success' | 'failed'
  parser?: string
  warningCount?: number
  parts?: number
  chunks?: number
  reason?: string
}

export interface CruxCorpusReportPreview {
  kind: 'corpus.report'
  corpusId?: string
  namespace?: string
  mode?: string
  stalePolicy?: string
  totals: {
    added: number
    changed: number
    unchanged: number
    skipped: number
    failed: number
    stale: number
    deleted: number
    chunks: number
  }
  sources: readonly CruxCorpusSourcePreview[]
  stageCounts?: CruxSourceStageCountsPreview
}

export interface CruxSecurityReportPreview {
  kind: 'security.report'
  severity: 'info' | 'warn' | 'error' | string
  pattern: string
  location?: string
  action: 'warn' | 'block' | 'redact' | 'transform' | string
  message?: string
  preview?: string
}

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
  ttftMs?: number
  tokensPerSecond?: number
}

export type CruxAttributes = Record<string, unknown>

/**
 * Numeric measurements attached to terminal run/span records.
 *
 * Metric values may be `undefined` at the TypeScript boundary so callers can
 * pass natural optional expressions such as `{ inputTokens: usage?.input }`.
 * The emit pipeline strips `undefined`, `NaN`, and infinite values before a
 * record reaches subscribers, diagnostics channels, or transports.
 */
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
  /** Per-run monotonic record sequence used for deterministic graph ordering. */
  seq: number
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

export interface CruxRunDetailRequestRepresentative {
  spanId: CruxSpanId | string
  strategy: 'self' | 'final-generation' | 'nearest-ancestor-request' | string
  reason?: string
}

export interface CruxRunDetailRequestModel {
  model?: string
  provider?: string
  spanIds: readonly (CruxSpanId | string)[]
  count: number
}

export interface CruxRunDetailRequestModelSummary {
  primaryModel?: string
  primaryProvider?: string
  mixed: boolean
  models: readonly CruxRunDetailRequestModel[]
}

export interface CruxRunDetailRequestBasePrompt {
  sourceId: 'prompt' | string
  text?: string
  segments?: CruxContextContributionPreview['segments']
  tokens?: number
  staticTokens?: number
  dynamicTokens?: number
}

export interface CruxRunDetailRequestMessages {
  artifactId?: CruxArtifactId | string
  source?: string
  phase?: string
  input?: unknown
  system?: unknown
  prompt?: unknown
  messages?: unknown
  allMessages?: unknown
  inputMessages?: unknown
  inputPrompt?: unknown
  recent?: unknown
  existingResponses?: unknown
  search?: unknown
  previousStepMessages?: unknown
}

export interface CruxRunDetailRequestContribution extends CruxContextContributionPreview {
  artifactId?: CruxArtifactId | string
  order: number
}

export interface CruxRunDetailRequestBudget extends CruxPromptBudgetPreview {
  artifactId?: CruxArtifactId | string
}

export interface CruxRunDetailRequestTool {
  name: string
  origin: 'request' | 'injected' | string
  sourceId?: string
  artifactId?: CruxArtifactId | string
}

export interface CruxRunDetailRequestTurn {
  spanId: CruxSpanId | string
  primitive: CruxPrimitiveName | string
  label: string
  startedAt?: string
  status?: CruxSpanStatus | string
  requestMode: 'exact' | 'inherited' | 'aggregate' | string
  model?: string
  provider?: string
  promptId?: string
}

export interface CruxRunDetailRequest {
  mode: 'exact' | 'inherited' | 'aggregate' | string
  representative?: CruxRunDetailRequestRepresentative
  modelSummary?: CruxRunDetailRequestModelSummary
  basePrompt?: CruxRunDetailRequestBasePrompt
  messages?: CruxRunDetailRequestMessages
  contributions: CruxRunDetailRequestContribution[]
  budget?: CruxRunDetailRequestBudget
  tools: CruxRunDetailRequestTool[]
  turns?: CruxRunDetailRequestTurn[]
  diagnostics?: string[]
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
  request?: CruxRunDetailRequest
  /**
   * Per-turn explanation read model projected onto a folded generation detail.
   *
   * Present only for generation details when the local projection has enough
   * recorded evidence. Consumed by the Run Detail `Explain` tab; absent reports
   * leave existing detail views unchanged.
   */
  decisionReport?: TurnDecisionReport
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
  request?: CruxRunDetailRequest
  /**
   * Per-turn explanation read model projected onto a generation node.
   *
   * The local Go projection emits one `TurnDecisionReport` per generation turn
   * (and on the run root for run-level roll-up) when projection data is
   * available. The Run Detail `Explain` tab treats it as authoritative when
   * present and falls back to the existing tabs when it is absent.
   */
  decisionReport?: TurnDecisionReport
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
  model?: string
  provider?: string
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
