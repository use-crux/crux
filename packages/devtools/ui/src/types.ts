/**
 * Client-side types mirroring the devtools protocol.
 */

export type JsonSchema = Record<string, unknown>

export interface PromptMeta {
  id: string | undefined
  description: string | undefined
  tags: readonly string[]
  inputSchema: JsonSchema | undefined
  outputSchema: JsonSchema | undefined
  contextIds: (string | undefined)[]
  hasOutput: boolean
  settings: Record<string, unknown>
  path?: string[]
  systemTemplate?: string | null
  promptTemplate?: string | null
  hasMessages?: boolean
  definitionSource?: { file: string; line: number; column?: number }
}

export interface ContextMeta {
  id: string | undefined
  description: string | undefined
  priority: number
  inputSchema: JsonSchema | undefined
  isStatic: boolean
  usedBy: (string | undefined)[]
  path?: string[]
  systemTemplate?: string | null
  definitionSource?: { file: string; line: number; column?: number }
}

export interface ToolMeta {
  name: string
  description: string
  inputSchema: JsonSchema | undefined
  path?: string[]
}

export interface ProjectIdentity {
  root: string
  name?: string
  configFile?: string
}

export interface SourceRange {
  file: string
  startLine: number
  endLine?: number
  startColumn?: number
  endColumn?: number
}

export interface SourceSnippet {
  source: string
  language?: string
  range: SourceRange
  truncated?: boolean
}

export type ProjectSourceRefRole =
  | 'schema'
  | 'callback'
  | 'handler'
  | 'execute'
  | 'prompt'
  | 'system'
  | 'resolver'
  | 'validator'
  | 'policy'
  | 'config'
  | 'helper'

export interface ProjectSourceRef {
  id: string
  role: ProjectSourceRefRole
  property?: string
  symbol?: string
  source: { file: string; line: number; column?: number; function?: string }
  snippet?: SourceSnippet
  fidelity: 'resolved' | 'partial'
  description?: string
  metadata?: {
    schemaKind?: 'zod' | 'convex-validator' | 'json-schema'
    parsedSchema?: boolean
    referencedDefinitionIds?: string[]
    dataAccess?: boolean
    injected?: boolean
    nested?: boolean
    fragment?: boolean
    factoryArg?: boolean
    argumentIndex?: number
    argumentName?: string
    toolMapContributor?: 'spread' | 'property'
    routingTarget?: boolean
    extensions?: Record<string, unknown>
  }
}

export type PrimitiveIntelligenceConfidence = 'static' | 'resolved' | 'semantic' | 'runtime' | 'partial'

export interface PrimitiveSuspensionPoint {
  id: string
  label: string
  signal?: string
  source?: { file: string; line: number; column?: number; function?: string }
  resumesDefinitionId?: string
}

export interface ProjectRuntimeJoin {
  definitionId: string
  kind: string
  name: string
  primitive?: string
  spanName?: string
  flowName?: string
  stepLabel?: string
  parentDefinitionId?: string
  sourceDefinitionId?: string
  blockDefinitionId?: string
  blockId?: string
  blockKind?: string
  correlationAttributes?: string[]
  spanAttributes?: Record<string, string>
  backend?: string
  resource?: string
  runtimeIdPrefix?: string
  promptId?: string
  contextId?: string
  agentId?: string
  toolName?: string
  retrieverId?: string
  memoryId?: string
  memoryStoreId?: string
  ragPipelineId?: string
  workspaceId?: string
  routingId?: string
  routeKey?: string
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

export interface SourceRefSummary {
  id?: string
  role?: ProjectSourceRefRole
  property?: string
  symbol?: string
  source?: { file: string; line: number; column?: number; function?: string }
  fidelity?: 'resolved' | 'partial'
  description?: string
}

export interface ContractFacts {
  argsSchema?: JsonSchema
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schemaRefs?: SourceRefSummary[]
  nestedSchemas?: Array<{
    name: string
    schema?: JsonSchema
    source?: { file: string; line: number; column?: number; function?: string }
    role: 'input' | 'output' | 'args' | 'config' | 'field'
  }>
  requiredFields?: string[]
  optionalFields?: string[]
  enumFields?: Array<{ field: string; values: string[] }>
}

export interface ControlFacts {
  mode?:
    | 'sequential'
    | 'parallel'
    | 'fanout'
    | 'consensus'
    | 'swarm'
    | 'durable'
    | 'immediate'
    | 'routing'
    | 'cascade'
    | 'fallback'
    | 'event-driven'
  ordering?: 'ordered' | 'concurrent' | 'event-driven' | 'conditional' | 'unknown'
  children?: string[]
  retryPolicy?: {
    maxAttempts?: number
    backoff?: string
    nonRetryableErrors?: string[]
    [key: string]: unknown
  }
  fallbackPolicy?: {
    optionCount?: number
    timeoutMs?: number
    shouldFallback?: boolean | 'callback'
    [key: string]: unknown
  }
  suspensionPoints?: PrimitiveSuspensionPoint[]
  budget?: {
    maxDurationMs?: number
    maxTokens?: number
    maxCostUsd?: number
    [key: string]: unknown
  }
}

export interface DataAccessFact {
  targetId?: string
  targetVariable?: string
  targetKind?: 'memory' | 'blackboard' | 'workspace' | 'store' | 'block'
  key?: string
  operation?: 'read' | 'write' | 'append' | 'update' | 'delete' | 'query'
  source?: { file: string; line: number; column?: number; function?: string }
}

export interface DataFacts {
  reads?: DataAccessFact[]
  writes?: DataAccessFact[]
  artifacts?: Array<{ name: string; kind?: string; source?: { file: string; line: number; column?: number; function?: string } }>
  retrievals?: Array<{
    retrieverId?: string
    memoryId?: string
    workspaceId?: string
    querySource?: { file: string; line: number; column?: number; function?: string }
    topK?: number
  }>
}

export interface DependencyFacts {
  prompts?: string[]
  contexts?: string[]
  tools?: string[]
  agents?: string[]
  flows?: string[]
  memory?: string[]
  blackboards?: string[]
  workspaces?: string[]
  stores?: string[]
  blocks?: string[]
  routers?: string[]
  ragPipelines?: string[]
  guardrails?: string[]
  constraints?: string[]
  scorers?: string[]
  extensions?: Record<string, unknown>
}

export interface RuntimeFacts {
  join?: ProjectRuntimeJoin
  expectedPrimitive?: string
  expectedSpanName?: string
  correlationAttributes?: string[]
  spanAttributes?: Record<string, string>
  extensions?: Record<string, unknown>
}

export interface DefinitionIntelligence {
  confidence: PrimitiveIntelligenceConfidence
  contract?: ContractFacts
  control?: ControlFacts
  data?: DataFacts
  dependencies?: DependencyFacts
  runtime?: RuntimeFacts
  diagnostics?: Array<{
    code: string
    message: string
    severity?: 'info' | 'warning' | 'error'
    source?: { file: string; line: number; column?: number; function?: string }
    data?: Record<string, unknown>
  }>
  runtimeJoin?: ProjectRuntimeJoin
  extensions?: Record<string, unknown>
}

export type PrimitiveSpecificFacts =
  | { kind: 'prompt'; use?: string[]; hasSystem?: boolean; hasPrompt?: boolean; hasMessages?: boolean; settings?: Record<string, unknown>; fragments?: SourceRefSummary[] }
  | { kind: 'context'; use?: string[]; isStatic?: boolean; priority?: number; cache?: Record<string, unknown>; fragments?: SourceRefSummary[] }
  | { kind: 'tool'; toolName?: string; hasExecute?: boolean; hasToModelOutput?: boolean; approvalRequired?: boolean }
  | { kind: 'agent'; promptId?: string; toolNames?: string[]; handoffs?: string[]; contextHandler?: SourceRefSummary; usageHandler?: SourceRefSummary; prepareHandler?: SourceRefSummary }
  | { kind: 'flow'; stepNames?: string[]; hasArgs?: boolean; runtime?: 'node' | 'convex' }
  | { kind: 'flow.step'; flowId: string; stepId?: string; stepLabel?: string; targetDefinitionId?: string; targetKind?: string }
  | { kind: 'composition.parallel' | 'composition.pipeline' | 'composition.swarm' | 'composition.consensus'; participants?: string[]; coordinator?: string; judge?: string; scorer?: string; sharedMemory?: string | string[]; sharedBlackboard?: string }
  | { kind: 'composition.parallel.branch' | 'composition.pipeline.stage'; compositionId: string; index?: number; branchId?: string; stageId?: string; targetVariable?: string; targetDefinitionId?: string; targetKind?: string }
  | { kind: 'routing.router' | 'routing.cascade' | 'routing.fallback'; routingId?: string; hasStableId?: boolean; routeKeys?: string[]; routeCount?: number; hasDefaultRoute?: boolean; hasClassify?: boolean; tierCount?: number; optionCount?: number; hasBudget?: boolean; budget?: Record<string, unknown> }
  | { kind: 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'; routingId?: string; routeKey?: string; tierIndex?: number; optionIndex?: number; parentDefinitionId?: string; targetVariable?: string; targetDefinitionId?: string; targetKind?: string; hasEvaluate?: boolean; isDefault?: boolean }
  | { kind: 'rag.pipeline' | 'rag.pipeline.stage' | 'rag.retriever'; retrieverId?: string; stageId?: string; stageKind?: string; topK?: number }
  | { kind: 'memory' | 'blackboard'; backend?: string; runtimeIdPrefix?: string; blockCount?: number; evictionPolicy?: string; conflictPolicy?: string }
  | { kind: 'memory.store'; ownerDefinitionKey?: string; backend?: string; component?: string; variableName?: string }
  | { kind: 'memory.block'; memoryId: string; blockId?: string; blockKind?: string; priority?: number; writeMode?: string; hasEmbed?: boolean }
  | { kind: 'workspace'; workspaceId?: string; namespace?: string; mounts?: Array<{ path: string; mode?: string }>; hasTools?: boolean }
  | { kind: 'constraint' | 'guardrail'; appliesTo?: string[]; policy?: string; severity?: string }
  | { kind: 'scorer'; scorerId?: string; model?: string; threshold?: number }
  | { kind: 'dataset' | 'suite' | 'suite.case' | 'eval.prompt' | 'eval.flow' | 'eval.rag' | 'eval.quality'; targetDefinitionId?: string; suiteId?: string; caseCount?: number; scorerIds?: string[] }

export type ProjectDefinitionFacts = PrimitiveSpecificFacts | ({ kind: string; extensions?: Record<string, unknown> } & Record<string, unknown>)

export interface ProjectDefinitionMetadata extends Record<string, unknown> {
  argsSchema?: JsonSchema
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schema?: JsonSchema
  catalogPresentation?: {
    standalone: boolean
    parentDefinitionId?: string
    parentRelationType?: string
    role?: 'step' | 'branch' | 'stage' | 'route' | 'tier' | 'option' | 'block' | 'store' | 'case'
    order?: number
  }
  intelligence?: DefinitionIntelligence
  runtimeJoin?: ProjectRuntimeJoin
  sourceStatus?: {
    importSafe?: boolean
    partialReason?: string
    confidence?: PrimitiveIntelligenceConfidence
  }
  facts?: ProjectDefinitionFacts
  extensions?: Record<string, unknown>
}

export interface ProjectDefinition {
  id: string
  kind: string
  name: string
  description?: string
  tags?: string[]
  /** Authored namespace segments. See CATALOG_PATH_BACKEND_TICKET.md.
   * Last element is the leaf name; preceding elements are folder
   * segments. Empty / unset means "no authored namespace" — the UI
   * derives a tree from `name` splits as a fallback. */
  path?: readonly string[]
  source?: { file: string; line: number; column?: number; function?: string }
  sourceSnippet?: SourceSnippet
  sourceRefs?: ProjectSourceRef[]
  fidelity: 'resolved' | 'partial' | 'error'
  status?: 'active' | 'missing' | 'stale'
  fingerprint?: string
  metadata?: ProjectDefinitionMetadata
  quality?: ProjectDefinitionQuality
}

export interface ProjectDefinitionQuality {
  evalIds?: string[]
  suiteIds?: string[]
  experimentIds?: string[]
  baselineIds?: string[]
  comparisonIds?: string[]
  feedbackIds?: string[]
  cassettePaths?: string[]
  runIds?: string[]
  traceIds?: string[]
  affectedEvalIds?: string[]
  affectedSuiteIds?: string[]
  runCount?: number
  experimentCount?: number
  baselineCount?: number
  comparisonCount?: number
  feedbackCount?: number
  cassetteCount?: number
  completedRunCount?: number
  failedRunCount?: number
  runningRunCount?: number
  lastRunId?: string
  lastRunAt?: number
  lastStatus?: string
  caseCount?: number
  passRate?: number
  currentFingerprint?: string
  baselineFingerprint?: string
  changedSinceBaseline?: boolean
  drift?: {
    evals: ProjectDefinitionQualityDriftRow[]
    suites: ProjectDefinitionQualityDriftRow[]
  }
}

export interface ProjectDefinitionQualityDriftRow {
  id: string
  passRate: number
  runs: number
  baselineExperimentId: string
  baselinePassRate: number
  driftPp: number
}

export interface ProjectRelation {
  id: string
  type: string
  from: string
  to: string
  fidelity: 'resolved' | 'partial' | 'error'
  source?: { file: string; line: number; column?: number; function?: string }
  metadata?: Record<string, unknown>
}

export interface CatalogDiagnostic {
  id: string
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  source?: { file: string; line: number; column?: number; function?: string }
  relatedDefinitionIds?: string[]
  suggestedFix?: string
}

export interface CatalogLintFinding {
  id: string
  severity: 'info' | 'warning' | 'error'
  ruleId: string
  category: 'contracts' | 'observability' | 'evaluation' | 'safety' | 'memory' | 'runtime' | 'composition' | 'quality'
  maturity: 'stable' | 'preview' | 'experimental'
  confidence: 'high' | 'medium' | 'low'
  profiles: Array<'recommended' | 'strict' | 'experimental'>
  title: string
  message: string
  rationale: string
  impact?: string
  source?: { file: string; line: number; column?: number; function?: string }
  primaryDefinitionId?: string
  relatedDefinitionIds: string[]
  affectedDefinitionIds?: string[]
  evidence: Array<{
    kind: 'definition' | 'relation' | 'quality' | 'runtime' | 'source'
    label: string
    description?: string
    definitionId?: string
    relationId?: string
    source?: { file: string; line: number; column?: number; function?: string }
    data?: Record<string, unknown>
  }>
  fixes: Array<{
    title: string
    description: string
    kind: 'manual' | 'docs' | 'config' | 'suppress' | 'code-action'
    docsUrl?: string
    command?: string
    suppression?: string
  }>
  docsUrl: string
  suppression?: {
    supported: boolean
    directive: string
    scope: 'next-line' | 'line' | 'file'
  }
  suppressed?: boolean
  suppressedBy?: {
    source: { file: string; line: number; column?: number; function?: string }
    reason?: string
  }
  propagatedDefinitionIds?: string[]
  propagationPaths?: Array<{
    fromDefinitionId: string
    toDefinitionId: string
    relationTypes: string[]
  }>
}

export interface CatalogSourceFile {
  file: string
  status: 'indexed' | 'partial' | 'error'
  definitionIds?: string[]
  diagnostics?: string[]
}

export interface CatalogIndexingPhaseStatus {
  status: 'pending' | 'running' | 'ready' | 'degraded'
  indexedAt?: string
  durationMs?: number
  fileCount?: number
  changedFileCount?: number
  diagnosticCount?: number
}

export interface ProjectCatalogIndexingStatus {
  status: 'cold' | 'cached' | 'refreshing' | 'ready' | 'degraded'
  ast: CatalogIndexingPhaseStatus
  semantic: Omit<CatalogIndexingPhaseStatus, 'status'> & {
    status: 'disabled' | CatalogIndexingPhaseStatus['status']
    enrichedDefinitionCount?: number
  }
  cache?: {
    status: 'miss' | 'hit' | 'stale' | 'invalid'
    loadedAt?: string
    snapshotAgeMs?: number
  }
}

export interface ProjectCatalogData {
  schemaVersion?: number
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools: ToolMeta[]
  project?: ProjectIdentity
  indexedAt?: string
  indexing?: ProjectCatalogIndexingStatus
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  lintFindings: CatalogLintFinding[]
  sources: CatalogSourceFile[]
}

/** Static-vs-dynamic text segmentation (backend B1). A `dynamic` segment is an
 *  interpolated value, optionally labelled with its `source` key. */
export interface TextSegment {
  text: string
  dynamic: boolean
  source?: string
}

export interface InspectPart {
  source: string
  text: string
  tokens: number
  skipped: boolean
  segments?: TextSegment[]
  staticTokens?: number
  dynamicTokens?: number
}

export interface DroppedContext {
  source: string
  text: string
  tokens: number
  priority: number
  segments?: TextSegment[]
  staticTokens?: number
  dynamicTokens?: number
}

export interface ExcludedContext {
  source: string
  reason: string
}

export interface InspectResult {
  system: { total: string; parts: InspectPart[]; totalTokens: number }
  prompt: { text: string; tokens: number } | undefined
  totalTokens: number
  droppedContexts: DroppedContext[]
  excludedContexts: ExcludedContext[]
  tokenBudget: number | undefined
  tools: string[] | undefined
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface ToolCall {
  id?: string
  name: string
  args: unknown
}

export interface Trace {
  traceId: string
  promptId: string | undefined
  startedAt: number
  input: Record<string, unknown>
  model: string
  provider: string
  durationMs?: number
  inspect?: InspectResult
  result?: {
    text?: string
    object?: unknown
    usage?: TokenUsage
    finishReason?: string
    toolCalls?: ToolCall[]
    responseId?: string
    modelId?: string
    cost?: number
  }
  error?: {
    message: string
    stack?: string
    category?: string
    statusCode?: number
    retryable?: boolean
  }
  status: 'running' | 'success' | 'error'
  sessionId?: string
  role?: 'resolve' | 'agent-step' | 'generate'
  parentTraceId?: string
  flowId?: string
  parentFlowId?: string
  stepId?: string
  stepLabel?: string
  source?: { file: string; line: number; column?: number; function?: string }
  streaming?: {
    ttftMs: number
    tokensPerSecond?: number
    totalChunks?: number
  }
  streamProgress?: {
    elapsedMs: number
    chunksReceived: number
    ttftMs?: number
    textLength?: number
    /** Individual text delta batches (each ~500ms of accumulated tokens). */
    chunks: string[]
  }
  fallback?: {
    attempts: number
    failedModels: string[]
    details: Array<{
      model: string
      durationMs: number
      status: 'success' | 'error'
      error?: string
      errorCategory?: string
      cost?: number
    }>
  }
}

export interface ObservabilityRunSummary {
  runId: string
  traceId: string
  name: string
  rootPrimitive: string
  status: string
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
  attributes?: Record<string, unknown> | null
  metrics?: Record<string, unknown> | null
  error?: Record<string, unknown> | string | null
}

export interface ObservabilitySpanSummary {
  spanId: string
  runId: string
  traceId: string
  parentSpanId: string
  family: string
  primitive: string
  name: string
  status: string
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
  attributes?: Record<string, unknown> | null
  metrics?: Record<string, unknown> | null
  error?: Record<string, unknown> | string | null
}

export interface ObservabilitySpanEventSummary {
  eventId: string
  runId: string
  traceId: string
  spanId: string
  name: string
  timestamp: string
  attributes?: Record<string, unknown> | null
}

export interface ObservabilityArtifactSummary {
  artifactId: string
  runId: string
  traceId: string
  spanId: string
  kind: string
  createdAt: string
  contentType: string
  encoding: string
  sizeBytes: number
  hash: string
  uri: string
  preview?: unknown
  attributes?: Record<string, unknown> | null
}

export interface ObservabilityResourceArtifact extends ObservabilityArtifactSummary {
  preview?: unknown
  attributes?: Record<string, unknown> | null
}

export interface ObservabilityEdgeSummary {
  edgeId: string
  runId: string
  traceId: string
  edgeType: string
  from: { kind: 'run' | 'span' | 'artifact'; id: string }
  to: { kind: 'run' | 'span' | 'artifact'; id: string }
  createdAt: string
  attributes?: Record<string, unknown> | null
}

export interface ObservabilityStoredRecord {
  recordId: string
  runId: string
  traceId: string
  type: string
  payloadJson: string
  receivedAt: string
}

export interface ObservabilityResourceActivity {
  spanId: string
  runId: string
  traceId: string
  family: string
  primitive: string
  name: string
  status: string
  startedAt: string
  endedAt: string
  durationMs: number
  resourceId: string
  attributes?: Record<string, unknown> | null
  metrics?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  artifacts?: ObservabilityResourceArtifact[]
  edges?: ObservabilityEdgeSummary[]
}

export type {
  CruxRunDetail as ObservabilityRunDetail,
  CruxRunDetailDetail as ObservabilityRunDetailDetail,
  CruxRunDetailNode as ObservabilityRunDetailNode,
  CruxRunDetailRow as ObservabilityRunDetailRow,
} from '@crux/core/observability'

export interface EvalCaseData {
  caseName: string
  modelId: string
  passed: boolean
  durationMs: number
  error?: string
  usage?: TokenUsage
  cost?: number
  traceId?: string
  input?: unknown
  output?: unknown
  scores?: Record<string, { score: number; reasoning?: string }>
  failureCategory?: string
}
export interface EvalRun {
  evalId: string
  promptId: string | undefined
  startedAt: number
  models: string[]
  caseNames: string[]
  totalCases: number
  completedCases: EvalCaseData[]
  status: 'running' | 'completed'
  durationMs?: number
  summary?: {
    total: number
    passed: number
    failed: number
    byModel: Record<string, { total: number; passed: number; failed: number }>
  }
}

export type RagFailureType =
  | 'retrieval_miss'
  | 'low_precision'
  | 'invalid_citation'
  | 'unsupported_answer'
  | 'judge_failed'
  | 'timeout'
  | 'error'

export interface RagMetricPreview {
  status: 'passed' | 'failed' | 'not_applicable'
  score?: number
  reason?: string
}

export interface RagCitationIssuePreview {
  code: string
  message: string
  namespace?: string
  sourceId: string
  chunkId: string
}

export interface RagResolvedCitationPreview {
  namespace: string
  sourceId: string
  chunkId: string
  url?: string
  path?: string
}

export interface RagEvalCaseData {
  caseId: string
  caseName: string
  status: 'passed' | 'failed' | 'skipped' | 'error'
  configRole?: 'baseline' | 'candidate' | 'single'
  configLabel?: string
  failureTypes: RagFailureType[]
  durationMs: number
  metrics: {
    retrieval?: Record<string, RagMetricPreview>
    answer?: Record<string, RagMetricPreview>
    citations?: Record<string, RagMetricPreview>
  }
  retrieval?: {
    hitCount: number
    evidence: Array<{
      namespace: string
      sourceId: string
      chunkId: string
      score: number
      rank?: number
      contentPreview?: string
    }>
  }
  answer?: { textPreview?: string }
  citations?: {
    citationCount: number
    validCitationCount?: number
    invalidCitationCount?: number
    issueCodes?: string[]
    issues?: RagCitationIssuePreview[]
    resolved?: RagResolvedCitationPreview[]
  }
  trace?: {
    available: boolean
    stageCount?: number
    stages?: Array<{
      name: string
      kind: string
      phase: 'query' | 'hits'
      status: 'success' | 'error' | 'skipped'
      inputQueryCount?: number
      outputQueryCount?: number
      inputHitCount?: number
      outputHitCount?: number
      warningCount?: number
    }>
  }
  error?: string
}

export interface RagEvalRun {
  evalId: string
  suiteId?: string
  startedAt: number
  caseCount: number
  configLabels?: string[]
  completedCases: RagEvalCaseData[]
  status: 'running' | 'completed'
  summary?: {
    total: number
    passed: number
    failed: number
    passRate: number
    byFailureType: Record<RagFailureType, number>
    retrieval?: {
      hitRateAtK?: Record<string, number>
      recallAtK?: Record<string, number>
      precisionAtK?: Record<string, number>
      mrr?: number
      ndcg?: number
    }
    citations?: { validityRate: number }
    answer?: { passRate: number }
  }
}

export type QualityJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly QualityJsonValue[]
  | { readonly [key: string]: QualityJsonValue }

export interface QualityOverviewRecord {
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
  runTabCounts: QualityRunTabCounts
  recentRuns?: readonly QualityRunRecord[]
}

export interface QualityRunTabCounts {
  all: number
  live: number
  failures: number
  hasFeedback: number
}

export interface QualityEvent {
  _tag: 'QualityEvent'
  id: string
  timestamp: number
  kind: 'trace' | 'insight' | 'experiment' | 'cassette' | 'feedback' | 'dataset' | string
  action: string
  severity: 'info' | 'warn' | 'error' | string
  refId: string
  payload?: QualityJsonValue
}

export interface QualityActivityEvent {
  _tag: 'QualityActivityEvent'
  timestamp: number
  kind: 'trace' | 'insight' | 'experiment' | 'cassette' | 'feedback' | 'dataset' | string
  severity: 'info' | 'warn' | 'error'
  summary: string
  refId: string
}

/**
 * Closed taxonomy of span primitives. Mirrors the Go `SpanPrimitive*`
 * constants in `packages/cli/internal/api/types.go`. The UI switches
 * on this value (NOT `eventType`) to pick glyph, color, and attribute
 * layout. Anything outside the enum is normalized to `'other'`.
 */
export type SpanPrimitive =
  | 'run'
  | 'generation.call'
  | 'generation.stream'
  | 'prompt.resolve'
  | 'prompt.budget'
  | 'context.resolve'
  | 'context.predicate'
  | 'context.cache'
  | 'agent.run'
  | 'tool.call'
  | 'tool.approval'
  | 'retrieval.query'
  | 'embedding.call'
  | 'memory.read'
  | 'memory.write'
  | 'constraint.check'
  | 'constraint.retry'
  | 'guardrail.run'
  | 'routing.router'
  | 'routing.cascade'
  | 'fallback.attempt'
  | 'cache.lookup'
  | 'compaction.run'
  | 'eval.run'
  | 'eval.case'
  | 'scoring.judge'
  | 'citation.check'
  | 'handoff.prepare'
  | 'delegate.invoke'
  | 'workspace.operation'
  | 'plan.operation'
  | 'task.operation'
  | 'indexing.pipeline'
  | 'ingest.parse'
  | 'corpus.sync'
  | 'skill.load'
  | 'security.warning'
  | 'cost.record'
  | 'feedback.record'
  | 'custom.operation'
  // Legacy aliases emitted by older local dev sessions. New code should use
  // the canonical dotted primitives above.
  | 'trace'
  | 'generation'
  | 'flow.step'
  | 'eval.flow'
  | 'flow'
  | 'tool'
  | 'retrieval'
  | 'pipeline'
  | 'parallel'
  | 'consensus'
  | 'swarm'
  | 'agent'
  | 'delegate'
  | 'handoff'
  | 'retrieval'
  | 'retrieval.stage'
  | 'embed'
  | 'judge'
  | 'plan'
  | 'task'
  | 'memory'
  | 'blackboard'
  | 'compact'
  | 'index'
  | 'ingest'
  | 'corpus'
  | 'cache'
  | 'skill'
  | 'cost'
  | 'security'
  | 'budget'
  | 'other'

export type CompositionType = 'pipeline' | 'parallel' | 'consensus' | 'swarm'

/**
 * Aggregated record for one ROOT trace family. Server-side rollup: a
 * trace with 18 children renders as 1 record with `traceCount = 19`.
 */
export interface QualityRunRecord {
  _tag: 'QualityRun'
  traceId: string
  targetId?: string
  promptId?: string
  flowId?: string
  parentRunId?: string
  rootPrimitive?: string
  kind?: 'composition' | 'agent' | 'flow' | 'generation' | 'retrieval' | 'eval' | 'operation' | string
  /**
   * Session this run belongs to (sourced from the root trace).
   * Metadata only — does NOT participate in run-grouping. Grouping is
   * always structural (parent / flow / time-window overlap).
   */
  sessionId?: string
  /** Root span primitive — UI uses this for the row glyph. */
  primitive?: SpanPrimitive
  /** Total span count in the observability graph. */
  spanCount?: number
  /** UI row rollup count. Kept separate from `traceCount` for the redesigned Runs list. */
  childCount?: number
  /** Total spans in the family (root + sub-traces). 1 for standalone. */
  traceCount?: number
  status:
    | 'running'
    | 'ok'
    | 'error'
    | 'blocked'
    | 'cancelled'
    | 'suspended'
    | 'skipped'
    | 'incomplete'
    | 'stale'
    | string
  startedAt: number
  /** Family-wide: max(endedAt) - min(startedAt). */
  durationMs?: number
  model?: string
  provider?: string
  input?: { readonly [key: string]: QualityJsonValue }
  output?: QualityJsonValue
  error?: QualityJsonValue
  usage?: QualityJsonValue
  /** Family-wide sum. */
  cost?: number
  /** Family-wide sum. */
  tokenCount?: number
  score?: number
  scoreName?: string
  /** Family-wide sum. */
  toolCallCount: number
  feedbackCount?: number
  /** Deduped across family. */
  feedbackIds: readonly string[]
  /** Deduped across family. */
  experimentIds: readonly string[]
  cassetteStatus?: 'recorded' | 'missing' | 'mismatch' | string
  cassettePaths?: readonly string[]
  diagnosticsCount?: number
  diagnosticsMaxSeverity?: 'info' | 'warn' | 'error' | string
  diagnosticCodes?: readonly string[]
}

export interface QualityRunDetailRecord {
  _tag: 'QualityRunDetail'
  run: QualityRunRecord
  trace: Trace
  events: readonly CorrelatedEvent[]
  spans: readonly QualityRunSpan[]
  narrative: readonly QualityRunNarrativeEvent[]
}

/**
 * Per-primitive payload merged from start + end events.
 * Backend merges: end-event keys win; start payload preserved under `_start`.
 * Fields documented in the API design doc — most are optional.
 */
export interface QualityRunSpanData {
  status?: string
  error?: { message?: string; code?: string; stack?: string }
  /** Original start-event payload (kept for replay). */
  _start?: { readonly [key: string]: QualityJsonValue }
  /** Allow any primitive-specific keys (input, output, args, hits, etc.). */
  readonly [key: string]: QualityJsonValue | undefined
}

export interface QualityRunSpanTimings {
  /** Streaming: time-to-first-token. */
  ttftMs?: number
  /** Streaming: chunks observed mid-flight. */
  chunksReceived?: number
  /** Streaming: final chunk count. */
  totalChunks?: number
  /** Streaming: throughput. */
  tokensPerSecond?: number
  /** Fallback attempts before final outcome. */
  retries?: number
  /** Span duration minus children (reserved, not yet populated). */
  selfMs?: number
}

export interface QualityRunSpan {
  id: string
  parentId?: string
  /** Authoritative for UI rendering. Switch on this, NOT `eventType`. */
  primitive: SpanPrimitive
  /** Only set when `primitive` is a composition family. */
  compositionType?: CompositionType
  kind: string
  op: 'agent' | 'llm' | 'tool' | 'other' | string
  name: string
  status: string
  startedAt?: number
  /** Unix-ms absolute end time (paired primitives only). */
  endedAt?: number
  /** end - start delta for paired primitives. */
  durationMs?: number
  tokenCount?: number
  cost?: number
  /** Debug only — format may change. Use `primitive` for rendering. */
  eventType?: string
  duplicate: boolean
  duplicateOfSpanId?: string
  attributes?: Readonly<Record<string, string>>
  /** Primitive-specific payload (merged start+end event data). */
  data?: QualityRunSpanData
  /** Streaming / retry / self-time. */
  timings?: QualityRunSpanTimings
  linkedInsightIds?: readonly string[]
}

export interface QualityRunNarrativeEvent {
  id: string
  kind: string
  label: string
  timestamp: number
  offsetMs: number
  data?: { readonly [key: string]: QualityJsonValue }
}

export interface QualitySuiteRecord {
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
  state: 'draft' | 'pinned' | 'live' | 'frozen' | string
  cases: readonly QualitySuiteCase[]
}

export interface QualitySuiteCase {
  caseId: string
  id?: string
  name?: string
  input?: QualityJsonValue
  expected?: QualityJsonValue
  tags?: readonly string[]
  metadata?: { readonly [key: string]: QualityJsonValue }
  origin?: QualityJsonValue
  lastRunStatus?: 'pass' | 'fail' | 'skip' | 'error' | string
  lastRunExperimentId?: string
  lastRunAt?: string
  assertions?: readonly QualitySuiteAssertion[]
  feedbackRating?: 'up' | 'down' | ''
}

export interface QualitySuiteAssertion {
  op: string
  arg: string
  lastPass?: boolean
}

export interface QualityInsightRecord {
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
  linkedDefinitionIds?: readonly string[]
  linkedSources?: readonly { file: string; line: number; column?: number; function?: string }[]
  suspectedCause?: string
  proposedFix?: string
  occurrenceCount: number
  trend: readonly number[]
  status: 'open' | 'dismissed' | 'resolved'
  updatedAt?: string
  /** When the user last marked this insight resolved (Sentry-style snapshot). */
  resolvedAt?: string
  /** `occurrenceCount` at the moment of resolution; used for auto-reopen comparison. */
  resolvedOccurrences?: number
  /** Set when the insight was previously resolved and the backend auto-reopened
   *  it because `occurrenceCount` grew past `resolvedOccurrences`. */
  reopenedAt?: string
  /** The most recent prior resolution timestamp — surfaced when auto-reopened
   *  so the UI can show "previously resolved 2h ago." */
  previousResolutionAt?: string
}

export interface QualityInsightStatusRecord {
  _tag: 'QualityInsightStatus'
  insightId: string
  status: 'open' | 'dismissed' | 'resolved'
  note?: string
  updatedAt: string
  resolvedAt?: string
  resolvedOccurrences?: number
}

/**
 * Pattern silence — backend-owned filter that removes matching insights
 * from the read model before they reach the UI. Soft-deleted (DeletedAt
 * set) silences are kept in the log for audit + restore.
 */
export interface QualityInsightSilence {
  _tag: 'QualityInsightSilence'
  id: string
  pattern: {
    title: string
    targetId?: string
  }
  note?: string
  createdAt: string
  /** Set when the silence has been removed; the insight returns on next read. */
  deletedAt?: string
}

export interface QualityExperimentRecord {
  _tag: 'Experiment'
  id: string
  qualityId: string
  suite: {
    id: string
    name?: string
    source: { kind: 'code' } | { kind: 'json'; path: string } | { kind: 'composed'; suiteIds: readonly string[] }
    path?: string
    caseCount: number
    snapshot: readonly QualityJsonValue[]
  }
  baselineVariantId?: string
  variants: readonly QualityExperimentVariant[]
  variantConfigs?: Readonly<Record<string, QualityVariantConfigDiff>>
  progress?: QualityExperimentProgress
  primaryScore?: string
  startedAt: string
  endedAt: string
  status: 'passed' | 'failed' | 'error'
  summary: {
    total: number
    passed: number
    failed: number
    errored: number
    byVariant: Record<string, { total: number; passed: number; failed: number; errored: number }>
  }
  cases: readonly {
    caseId: string
    caseName: string
    variantId: string
    status: 'passed' | 'failed' | 'error'
    input: QualityJsonValue
    output?: QualityJsonValue
    usage?: QualityJsonValue
    cost?: number
    traceId?: string
    scores: readonly QualityJsonValue[]
    assertion?: {
      passed: boolean
      error?: string
    }
    durationMs: number
    error?: string
  }[]
}

export interface QualityExperimentVariant {
  id: string
  targetId: string
  definitionFingerprint?: string
  label?: string
  passRate?: number
  meanScore?: number
  tokensAvg?: number
  latencyP95Ms?: number
  costTotal?: number
  isBaseline?: boolean
  isWinner?: boolean
  baselineDeltaPassPts?: number
  settings?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityVariantConfigDiff {
  vsBaselineVariantId: string
  lines: readonly ConfigDiffLine[]
}

export interface ConfigDiffLine {
  op: 'add' | 'remove' | 'context' | string
  text: string
  note?: string
}

export interface QualityExperimentProgress {
  casesDone: number
  casesTotal: number
  variantsTotal: number
  providerCalls: number
  estRemainingMs?: number
  seed?: number
  temperature?: number
}

export interface QualityComparisonRecord {
  _tag: 'QualityComparison'
  id: string
  qualityId: string
  comparedAt: string
  baseline: QualityComparisonSummary
  candidate: QualityComparisonSummary
  metrics: {
    passRateDelta: number
    avgDurationMsDelta: number
    numericScoreDeltas: Record<
      string,
      {
        baseline?: number
        candidate?: number
        delta?: number
      }
    >
  }
  caseDeltas?: readonly QualityComparisonCaseDelta[]
  gates?: {
    status: 'passed' | 'failed'
    results: readonly {
      name: string
      passed: boolean
      actual: number
      expected: number
      operator: 'gte' | 'lte'
    }[]
  }
  status: 'candidate_better' | 'candidate_worse' | 'same' | 'mixed'
}

export interface QualityComparisonCaseDelta {
  caseId: string
  caseName?: string
  status: 'fixed' | 'regressed' | 'still_failing' | 'unchanged' | 'new' | 'removed' | string
  baseline?: QualityComparisonCaseSide
  candidate?: QualityComparisonCaseSide
  scoreDelta?: number
  outputChange?: string
}

export interface QualityComparisonCaseSide {
  traceId?: string
  status: string
  outputPreview?: string
  score?: number
  durationMs: number
}

export interface QualityComparisonSummary {
  experimentId: string
  variantId?: string
  label?: string
  total: number
  passed: number
  failed: number
  errored: number
  passRate: number
  avgDurationMs: number
  numericScores: Record<string, number>
}

export interface QualityBaselineRecord {
  _tag: 'QualityBaseline'
  id: string
  qualityId: string
  experimentId: string
  variantId?: string
  label?: string
  promotedAt: string
  summary: QualityComparisonSummary
}

export interface QualityFeedbackRecord {
  _tag: 'QualityFeedback'
  id: string
  qualityId: string
  createdAt: string
  status: 'new' | 'reviewed' | 'dismissed'
  traceId?: string
  experimentId?: string
  caseId?: string
  rating?: -1 | 0 | 1
  comment?: string
  expected?: { readonly [key: string]: QualityJsonValue }
  tags?: readonly string[]
  metadata?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityFeedbackAnnotationRecord {
  _tag: 'QualityFeedbackAnnotation'
  id: string
  qualityId: string
  feedbackId: string
  createdAt: string
  status?: 'new' | 'reviewed' | 'dismissed'
  note?: string
  expected?: { readonly [key: string]: QualityJsonValue }
  tags?: readonly string[]
  metadata?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityFeedbackMemoryProposalRecord {
  _tag: 'QualityFeedbackMemoryProposal'
  id: string
  qualityId: string
  feedbackId: string
  createdAt: string
  status: 'proposed'
  memoryId?: string
  memoryKind?: string
  proposal: { readonly [key: string]: QualityJsonValue }
  reason?: string
  tags?: readonly string[]
  metadata?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityCassetteRecord {
  path: string
  mode?: string
  status: 'matching' | 'missing' | 'mismatch' | string
  coverage: number
  entryCount: number
  missingCount?: number
  mismatchCount?: number
  providerCallsAvoided?: number
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

export interface QualityCassetteIssueRecord {
  _tag: 'QualityCassetteIssue'
  path: string
  entryId?: string
  caseId?: string
  kind?: string
  targetId?: string
  provider?: string
  model?: string
  status: 'missing' | 'mismatch' | 'recorded' | 'error'
  reason?: string
  recordedAt: string
}

export interface QualityScorerRecord {
  _tag: 'QualityScorer'
  name: string
  kind: string
  suiteIds?: readonly string[]
  runCount: number
  passRate?: number
  meanScore?: number
  lastUsedAt?: string
}

export interface RagEvalStartEvent {
  type: 'rag-eval:start'
  evalId: string
  suiteId?: string
  caseCount: number
  configLabels?: string[]
  timestamp: number
}

export interface RagEvalCaseEvent extends RagEvalCaseData {
  type: 'rag-eval:case'
  evalId: string
  completedCount: number
  timestamp: number
}

export interface RagEvalEndEvent {
  type: 'rag-eval:end'
  evalId: string
  status: 'success' | 'error'
  summary: NonNullable<RagEvalRun['summary']>
  timestamp: number
}

export interface FlowStepDetail {
  id: string
  modelId: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  skipped: boolean
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  input?: unknown
  output?: unknown
  text?: string
  turns?: Array<{
    userMessage: string
    response: string
    toolCalls: Array<{ name: string; args: unknown; result: unknown }>
    durationMs: number
    inputTokens: number
    outputTokens: number
  }>
}
export interface FlowCaseData {
  caseName: string
  configName: string
  passed: boolean
  durationMs: number
  error?: string
  traceSummary: {
    stepCount: number
    toolCallNames: string[]
    totalTokens: number
    totalCost: number
    steps?: FlowStepDetail[]
  }
}
export interface FlowRun {
  flowId: string
  name: string
  description?: string
  startedAt: number
  stepIds: string[]
  configNames: string[]
  caseNames: string[]
  totalCases: number
  completedCases: FlowCaseData[]
  status: 'running' | 'completed'
  durationMs?: number
  summary?: {
    total: number
    passed: number
    failed: number
    byConfig: Record<string, { total: number; passed: number; failed: number }>
    totalSteps: number
    avgSteps: number
    totalTokens: number
    totalCost: number
  }
}

export interface EmbeddingUsage {
  inputTokens?: number
  totalTokens?: number
}

export interface EmbedStartEvent {
  type: 'embed:start'
  embedId: string
  name: string
  kind: 'dense' | 'sparse'
  operation: 'embed' | 'embedMany'
  inputCount: number
  chunkCount: number
  maxChunkSize: number
  dimensions?: number
  traceId?: string
  timestamp: number
}
export interface EmbedEndEvent {
  type: 'embed:end'
  embedId: string
  name: string
  kind: 'dense' | 'sparse'
  operation: 'embed' | 'embedMany'
  inputCount: number
  chunkCount: number
  maxChunkSize: number
  dimensions?: number
  durationMs: number
  usage?: EmbeddingUsage
  cost?: number
  cacheHitCount?: number
  cacheMissCount?: number
  retryCount?: number
  truncatedCount?: number
  rateLimitWaitMs?: number
  error?: string
  traceId?: string
  timestamp: number
}
export type EmbeddingEventData = (EmbedStartEvent | EmbedEndEvent) & {
  _kind: 'start' | 'end'
}

export interface RetrievalStartEvent {
  type: 'retrieval:start'
  retrievalId: string
  retrieverId: string
  namespace: string
  mode: 'dense' | 'sparse' | 'hybrid' | 'custom'
  query: string
  limit?: number
  threshold?: number
  filter?: Record<string, unknown>
  fusion?: 'rrf' | 'dbsf'
  traceId?: string
  timestamp: number
}
export interface RetrievalEndEvent {
  type: 'retrieval:end'
  retrievalId: string
  retrieverId: string
  namespace: string
  mode: 'dense' | 'sparse' | 'hybrid' | 'custom'
  query: string
  limit?: number
  threshold?: number
  filter?: Record<string, unknown>
  fusion?: 'rrf' | 'dbsf'
  resultCount: number
  durationMs: number
  error?: string
  traceId?: string
  timestamp: number
}
export type RetrievalEventData = (RetrievalStartEvent | RetrievalEndEvent) & {
  _kind: 'start' | 'end'
}

export type RetrievalStageKind =
  | 'query-planner'
  | 'multi-query'
  | 'parent-expand'
  | 'compress'
  | 'diversify'
  | 'decay'
  | 'custom'

export interface RetrievalStagePreview {
  queries?: Array<{ query: string; filter?: Record<string, unknown>; reason?: string }>
  hits?: Array<{ sourceId: string; chunkId: string; score: number; contentPreview?: string }>
}

export interface RetrievalStageStartEvent {
  type: 'retrieval:stage:start'
  retrievalId: string
  retrieverId: string
  pipelineId: string
  stageName: string
  stageKind: RetrievalStageKind
  phase: 'query' | 'hits'
  inputQueryCount?: number
  inputHitCount?: number
  traceId?: string
  timestamp: number
}

export interface RetrievalStageEndEvent extends Omit<RetrievalStageStartEvent, 'type'> {
  type: 'retrieval:stage:end'
  status: 'success' | 'error' | 'skipped'
  outputQueryCount?: number
  outputHitCount?: number
  durationMs: number
  warningCount?: number
  error?: string
  preview?: RetrievalStagePreview
}

export type RetrievalStageEventData = (RetrievalStageStartEvent | RetrievalStageEndEvent) & {
  _kind: 'stage-start' | 'stage-end'
}

export interface WorkspaceOperationEvent {
  type: 'workspace:operation'
  workspaceId: string
  namespace: string
  operation: 'list' | 'read' | 'write' | 'edit' | 'delete'
  path: string
  status: 'success' | 'error'
  durationMs: number
  mount?: string
  mimeType?: string
  size?: number
  error?: string
  traceId?: string
  sessionId?: string
  timestamp: number
}

export interface SourceStageEventRecord {
  name: string
  kind?: 'parser' | 'document-transform' | 'chunker' | 'chunk-transform' | 'embedding' | 'promotion' | 'sync'
  version?: string
  status: 'pending' | 'success' | 'failed' | 'skipped'
  cache?: 'hit' | 'miss' | 'write' | 'refresh' | 'bypass'
  hash?: string
  inputHash?: string
  outputHash?: string
  durationMs?: number
  chunkCount?: number
  parentCount?: number
  error?: { message: string; stack?: string }
  updatedAt: number
}

export interface IndexStartEvent {
  type: 'index:start'
  indexId: string
  indexerId: string
  namespace: string
  operation: 'indexDocuments' | 'indexChunks' | 'deleteSource' | 'clear'
  sourceCount: number
  chunkCount: number
  replaceSources?: boolean
  sourceId?: string
  dryRun?: boolean
  traceId?: string
  timestamp: number
}
export interface IndexEndEvent {
  type: 'index:end'
  indexId: string
  indexerId: string
  namespace: string
  operation: 'indexDocuments' | 'indexChunks' | 'deleteSource' | 'clear'
  sourceCount: number
  chunkCount: number
  replaceSources?: boolean
  sourceId?: string
  dryRun?: boolean
  durationMs: number
  deletedCount?: number
  stages?: SourceStageEventRecord[]
  error?: string
  traceId?: string
  timestamp: number
}
export type IndexEventData = (IndexStartEvent | IndexEndEvent) & {
  _kind: 'start' | 'end'
}

export interface CorpusSyncStartEvent {
  type: 'corpus:sync:start'
  syncId: string
  corpusId: string
  namespace: string
  mode: 'replaceChanged' | 'appendOnly'
  stalePolicy: 'keep' | 'delete'
  sourceSet: 'partial' | 'complete'
  dryRun: boolean
  sourceCount: number
  traceId?: string
  timestamp: number
}

export interface CorpusSourceEvent {
  type:
    | 'corpus:source:added'
    | 'corpus:source:changed'
    | 'corpus:source:unchanged'
    | 'corpus:source:skipped'
    | 'corpus:source:failed'
    | 'corpus:source:stale'
    | 'corpus:source:deleted'
  syncId: string
  corpusId: string
  namespace: string
  sourceId: string
  action: 'added' | 'changed' | 'unchanged' | 'skipped' | 'failed' | 'stale' | 'deleted'
  reason?: 'new' | 'contentChanged' | 'metadataChanged' | 'indexChanged' | 'appendOnly' | 'stale' | 'dryRun' | 'error'
  dryRun: boolean
  chunkCount?: number
  stages?: SourceStageEventRecord[]
  error?: { message: string; stack?: string }
  traceId?: string
  timestamp: number
}

export interface CorpusSyncEndEvent {
  type: 'corpus:sync:end'
  syncId: string
  corpusId: string
  namespace: string
  mode: 'replaceChanged' | 'appendOnly'
  stalePolicy: 'keep' | 'delete'
  sourceSet: 'partial' | 'complete'
  dryRun: boolean
  added: number
  changed: number
  unchanged: number
  stale: number
  skipped: number
  deleted: number
  failed: number
  chunkCount: number
  durationMs: number
  traceId?: string
  timestamp: number
}

export type CorpusEventData =
  | (CorpusSyncStartEvent & { _kind: 'sync:start' })
  | (CorpusSourceEvent & { _kind: 'source' })
  | (CorpusSyncEndEvent & { _kind: 'sync:end' })

export interface IngestParseStartEvent {
  type: 'ingest:parse:start'
  ingestId: string
  parser: string
  format: string
  namespace: string
  sourceId: string
  byteLength: number
  contentType?: string
  traceId?: string
  timestamp: number
}

export interface IngestParseEndEvent {
  type: 'ingest:parse:end'
  ingestId: string
  parser: string
  format: string
  namespace: string
  sourceId: string
  byteLength: number
  contentType?: string
  durationMs: number
  partCount: number
  warningCount: number
  error?: string
  traceId?: string
  timestamp: number
}

export type IngestEventData = (IngestParseStartEvent & { _kind: 'start' }) | (IngestParseEndEvent & { _kind: 'end' })

export interface MemoryReadEvent {
  type: 'memory:read'
  spanId?: string
  runId?: string
  memoryId: string
  operation: string
  query?: string
  resultCount: number
  durationMs: number
  traceId?: string
  results?: Array<{ key: string; preview: string; score?: number }>
  memoryType?: 'working' | 'episodic' | 'semantic' | 'block'
  blockId?: string
  blockKind?: 'recent' | 'working' | 'episodes' | 'facts' | 'procedures' | 'reflections' | 'custom'
  namespaceHash?: string
  snapshot?: unknown
  metadata?: Record<string, unknown>
  timestamp: number
}
export interface MemoryWriteEvent {
  type: 'memory:write'
  spanId?: string
  runId?: string
  memoryId: string
  operation: string
  entryKey?: string
  traceId?: string
  content?: string
  memoryType?: 'working' | 'episodic' | 'semantic' | 'block'
  blockId?: string
  blockKind?: 'recent' | 'working' | 'episodes' | 'facts' | 'procedures' | 'reflections' | 'custom'
  namespaceHash?: string
  writeMode?: 'propose' | 'auto' | 'manual'
  proposalStatus?: 'pending' | 'approved' | 'rejected'
  snapshot?: unknown
  metadata?: Record<string, unknown>
  timestamp: number
}
export type MemoryEventData = (MemoryReadEvent | MemoryWriteEvent) & {
  _kind: 'read' | 'write'
}
export interface CompactStartEvent {
  type: 'compact:start'
  reason: string
  inputMessageCount: number
  inputTokens: number
  traceId?: string
  timestamp: number
}
export interface CompactEndEvent {
  type: 'compact:end'
  outputTokens: number
  compressionRatio: number
  summaryPreview?: string
  durationMs: number
  traceId?: string
  timestamp: number
}
export type CompactEventData = (CompactStartEvent | CompactEndEvent) & {
  _kind: 'start' | 'end'
}
export interface BudgetCheckEvent {
  type: 'budget:check'
  used: number
  available: number
  level: 'normal' | 'warning' | 'critical'
  traceId?: string
  breakdown?: Record<string, number>
  timestamp: number
}
export type BudgetSnapshotData = BudgetCheckEvent
export interface CostBreakdown {
  cost: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  calls: number
}
export interface CostEntry extends CostBreakdown {
  id: string
  timestamp: number
  source: 'actual' | 'estimated'
  promptId?: string
  model?: string
  provider?: string
  traceId?: string
  sessionId?: string
  flowId?: string
  stepId?: string
  stepLabel?: string
  agentId?: string
}
export interface CostReport {
  total: CostBreakdown
  byPrompt: Record<string, CostBreakdown>
  byModel: Record<string, CostBreakdown>
  byProvider: Record<string, CostBreakdown>
  byAgent: Record<string, CostBreakdown>
  byFlow: Record<string, CostBreakdown>
  bySession: Record<string, CostBreakdown>
  byStep: Record<string, CostBreakdown>
  entries: CostEntry[]
}
export interface CostReportEvent {
  type: 'cost:report'
  traceId?: string
  entry: CostEntry
  report: CostReport
  timestamp: number
}
export interface CostWarnEvent {
  type: 'cost:warn'
  traceId?: string
  threshold: number
  actual: number
  entry: CostEntry
  report: CostReport
  timestamp: number
}
export interface CostLimitEvent {
  type: 'cost:limit'
  traceId?: string
  threshold: number
  actual: number
  entry: CostEntry
  report: CostReport
  timestamp: number
}
export type CostEventData = (CostReportEvent | CostWarnEvent | CostLimitEvent) & {
  _kind: 'report' | 'warn' | 'limit'
}
export interface BlackboardUpdateEvent {
  type: 'blackboard:update'
  boardId: string
  fieldsChanged: string[]
  traceId?: string
  snapshot?: Record<string, unknown>
  timestamp: number
}
export interface HandoffPrepareEvent {
  type: 'handoff:prepare'
  handoffId: string
  inputSize: number
  outputSize: number
  traceId?: string
  summary?: string
  fromAgent?: string
  toAgent?: string
  input?: unknown
  output?: unknown
  timestamp: number
}
export type AgentEventData = (BlackboardUpdateEvent | HandoffPrepareEvent) & {
  _kind: 'blackboard' | 'handoff'
}
export interface JudgeResultEvent {
  type: 'judge:result'
  metricId: string
  score: number
  reasoning?: string
  evalId?: string
  traceId?: string
  input?: string
  output?: string
  timestamp: number
}
export type JudgeEventData = JudgeResultEvent
export interface DelegateStartEvent {
  type: 'delegate:start'
  delegateId: string
  handoffId: string
  inputSize: number
  input?: unknown
  traceId?: string
  timestamp: number
}
export interface DelegateCompleteEvent {
  type: 'delegate:complete'
  delegateId: string
  handoffId: string
  inputSize: number
  outputSize: number
  durationMs: number
  output?: unknown
  traceId?: string
  timestamp: number
}
export type DelegateEventData = (DelegateStartEvent | DelegateCompleteEvent) & {
  _kind: 'start' | 'complete'
}
export interface ToolStartEvent {
  type: 'tool:start'
  toolCallId: string
  toolName: string
  args: unknown
  traceId?: string
  timestamp: number
}
export interface ToolEndEvent {
  type: 'tool:end'
  toolCallId: string
  toolName: string
  durationMs: number
  result?: unknown
  modelOutput?: unknown
  modelOutputType?: 'text' | 'json' | 'content' | 'error-text' | 'error-json' | 'execution-denied'
  outputSize?: number
  modelOutputSize?: number
  tokenSavingsEstimate?: number
  modelOutputError?: string
  error?: string
  estimated?: boolean
  traceId?: string
  timestamp: number
}
export interface ToolApprovalRequestEvent {
  type: 'tool:approval:request'
  approvalId: string
  toolCallId: string
  toolName: string
  input?: unknown
  request?: {
    title?: string
    description?: string
    details?: unknown
  }
  traceId?: string
  timestamp: number
}
export interface ToolApprovalDecisionEvent {
  type: 'tool:approval:decision'
  approvalId: string
  toolCallId?: string
  toolName?: string
  approved: boolean
  reason?: string
  traceId?: string
  timestamp: number
}
export type ToolEventData =
  | (ToolStartEvent & { _kind: 'start' })
  | (ToolEndEvent & { _kind: 'end' })
  | (ToolApprovalRequestEvent & { _kind: 'approval-request' })
  | (ToolApprovalDecisionEvent & { _kind: 'approval-decision' })
export interface SecurityWarningEvent {
  type: 'security:warning'
  promptId: string | undefined
  field: string
  pattern: string
  message: string
  inputPreview: string
  traceId?: string
  sessionId?: string
  timestamp: number
}
export type SecurityEventData = SecurityWarningEvent

export interface ConstraintCheckEventData {
  constraintName: string
  severity: 'assert' | 'suggest'
  pass: boolean
  feedback?: string
  durationMs: number
  attempt: number
  traceId?: string
  timestamp: number
}

export interface ConstraintRetryEventData {
  constraintNames: string[]
  attempt: number
  combinedFeedback: string
  traceId?: string
  timestamp: number
}

export interface ConstraintViolationEventData {
  constraintNames: string[]
  totalAttempts: number
  traceId?: string
  timestamp: number
}
export interface PlanCreatedEvent {
  type: 'plan:created'
  planId: string
  title: string
  contentPreview: string
  status: string
  timestamp: number
}
export interface PlanUpdatedEvent {
  type: 'plan:updated'
  planId: string
  version: number
  changes: ('title' | 'content' | 'status' | 'metadata')[]
  timestamp: number
}
export type PlanEventData = (PlanCreatedEvent | PlanUpdatedEvent) & {
  _kind: 'created' | 'updated'
}
export interface TaskListCreatedEvent {
  type: 'tasklist:created'
  taskListId: string
  planId?: string
  timestamp: number
}
export interface TaskListCompletedEvent {
  type: 'tasklist:completed'
  taskListId: string
  totalTasks: number
  durationMs: number
  timestamp: number
}
export interface TaskListDiscardedEvent {
  type: 'tasklist:discarded'
  taskListId: string
  reason?: string
  completedCount: number
  remainingCount: number
  timestamp: number
}
export type TaskListEventData = (TaskListCreatedEvent | TaskListCompletedEvent | TaskListDiscardedEvent) & {
  _kind: 'created' | 'completed' | 'discarded'
}
export interface TaskAddedEvent {
  type: 'task:added'
  taskListId: string
  taskId: string
  label: string
  assignee?: { agent?: string; model?: string }
  timestamp: number
}
export interface TaskUpdatedEvent {
  type: 'task:updated'
  taskListId: string
  taskId: string
  status: string
  progress?: string
  durationMs?: number
  timestamp: number
}
export interface TaskRemovedEvent {
  type: 'task:removed'
  taskListId: string
  taskId: string
  timestamp: number
}
export type TaskEventData = (TaskAddedEvent | TaskUpdatedEvent | TaskRemovedEvent) & {
  _kind: 'added' | 'updated' | 'removed'
}

export interface RuntimeFlowStepData {
  stepId: string
  label: string
  status: 'started' | 'completed' | 'failed' | 'skipped'
  timestamp: number
  durationMs?: number
  totalTokens?: number
  cost?: number
  toolCallNames: string[]
  actor?: string
  fromStepId?: string
  handoffKind?: 'agent' | 'tool' | 'routing' | 'user' | 'system'
  inputSummary?: string
  outputSummary?: string
  traceId?: string
  note?: string
}

export interface RuntimeFlowRun {
  flowId: string
  sessionId: string
  name: string
  goal?: string
  startedAt: number
  triggerTraceId?: string
  relatedTraceIds: string[]
  steps: RuntimeFlowStepData[]
  status: 'running' | 'completed' | 'failed' | 'abandoned' | 'suspended' | 'cancelled' | 'expired'
  durationMs?: number
  finishedAt?: number
  aggregate?: { totalSteps: number; totalTokens?: number; totalCost?: number }
  error?: string
  parentFlowId?: string
  suspendedAt?: string
  cancelReason?: string
}

export interface RuntimeFlowStartEvent {
  type: 'runtime-flow:start'
  flowId: string
  sessionId: string
  name: string
  goal?: string
  startedAt: number
  traceId?: string
  parentFlowId?: string
}

export interface RuntimeFlowStepEvent {
  type: 'runtime-flow:step'
  flowId: string
  sessionId: string
  stepId: string
  label: string
  status: 'started' | 'completed' | 'failed' | 'skipped'
  timestamp: number
  traceId?: string
  durationMs?: number
  totalTokens?: number
  cost?: number
  toolCallNames?: string[]
  actor?: string
  fromStepId?: string
  handoffKind?: 'agent' | 'tool' | 'routing' | 'user' | 'system'
  inputSummary?: string
  outputSummary?: string
  note?: string
}

export interface RuntimeFlowEndEvent {
  type: 'runtime-flow:end'
  flowId: string
  sessionId: string
  status: 'completed' | 'failed' | 'abandoned' | 'cancelled' | 'expired'
  durationMs: number
  timestamp: number
  traceId?: string
  aggregate?: { totalSteps: number; totalTokens?: number; totalCost?: number }
  error?: string
}

export interface RuntimeFlowSuspendEvent {
  type: 'runtime-flow:suspend'
  flowId: string
  sessionId: string
  name: string
  suspendPoint: string
  timestamp: number
  traceId?: string
}

export interface RuntimeFlowResumeEvent {
  type: 'runtime-flow:resume'
  flowId: string
  sessionId: string
  name: string
  timestamp: number
  traceId?: string
}

export interface RuntimeFlowSignalEvent {
  type: 'runtime-flow:signal'
  flowId: string
  sessionId: string
  signalName: string
  payload?: unknown
  timestamp: number
  traceId?: string
}

export interface RuntimeFlowCancelEvent {
  type: 'runtime-flow:cancel'
  flowId: string
  sessionId: string
  name: string
  reason?: string
  timestamp: number
  traceId?: string
}

export interface RuntimeFlowExpiredEvent {
  type: 'runtime-flow:expired'
  flowId: string
  sessionId: string
  name: string
  suspendPoint: string
  timestamp: number
  traceId?: string
}

export interface TimelineEvent {
  type: string
  timestamp: number
  traceId?: string
  sessionId?: string
  data: Record<string, unknown>
}
export interface SessionInfo {
  sessionId: string
  traceCount: number
  startedAt: number
  lastActivityAt: number
}
export interface CorrelatedEvent {
  id: string
  eventType: string
  timestamp: number
  data: Record<string, unknown>
}

export interface StatsData {
  totalExecutions: number
  successCount: number
  errorCount: number
  runningCount: number
  avgDurationMs: number
  memoryReadCount: number
  memoryWriteCount: number
  compactionCount: number
  budgetLevel: 'normal' | 'warning' | 'critical' | null
  judgeAvgScore: number | null
  totalCost: number
  avgCost: number
  totalTokens: number
  errorRate: number
  avgTtftMs: number | null
  avgThroughput: number | null
  streamingTraceCount: number
  memoryByType: Record<string, { reads: number; writes: number }>
  handoffCount: number
  blackboardUpdateCount: number
  toolTokenSavingsEstimate: number
  delegateCount: number
  avgDelegateDurationMs: number | null
  avgHandoffSizeBytes: number | null
  toolExecutionCount: number
  avgToolDurationMs: number | null
  toolErrorCount: number
  securityWarningCount: number
  contextCacheHitCount?: number
  contextCacheMissCount?: number
  contextCacheHitRate?: number | null
  semanticCacheHitCount?: number
  semanticCacheMissCount?: number
  semanticCacheWriteCount?: number
  semanticCacheHitRate?: number | null
  skillLoadCount?: number
  skillCacheHitCount?: number
  skillCacheMissCount?: number
  skillResolveCount?: number
  embeddingCallCount?: number
  totalEmbeddingTexts?: number
  avgEmbeddingDurationMs?: number | null
  totalEmbeddingTokens?: number
  totalEmbeddingCost?: number
  embeddingCacheHitCount?: number
  embeddingCacheMissCount?: number
  embeddingRetryCount?: number
  embeddingTruncatedCount?: number
  embeddingRateLimitWaitMs?: number
  retrievalCallCount?: number
  retrievalErrorCount?: number
  avgRetrievalDurationMs?: number | null
  totalRetrievedHits?: number
  indexOperationCount?: number
  indexErrorCount?: number
  avgIndexDurationMs?: number | null
  totalIndexedSources?: number
  totalIndexedChunks?: number
  ingestParseCount?: number
  ingestErrorCount?: number
  avgIngestDurationMs?: number | null
  totalIngestParts?: number
  totalIngestWarnings?: number
}

export interface CompositionStatsData {
  byKind: Record<
    string,
    {
      total: number
      success: number
      error: number
      avgDurationMs: number
      avgAgents: number
    }
  >
  swarm: {
    avgHandoffs: number
    topPaths: Array<{ path: string; count: number }>
    agentBottleneck: { agentId: string; avgDurationMs: number } | null
  } | null
}

export interface TimeseriesBucket {
  t: number
  executions: number
  errors: number
  avgDurationMs: number
  totalCost: number
  avgScore: number | null
  budgetLevel: 'normal' | 'warning' | 'critical' | null
}

export interface PromptBaseline {
  promptId: string
  avgDurationMs: number
  avgTokens: number
  avgCost: number
  traceCount: number
}

export interface PromptUsageStat {
  count: number
  lastUsed: number
  errorCount: number
  avgDurationMs: number
  totalCost: number
}

export interface JudgeTimeseriesBucket {
  t: number
  byMetric: Record<string, { avg: number; count: number }>
}

export interface CatalogEvent {
  type: 'catalog'
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools?: ToolMeta[]
  project?: ProjectIdentity
  indexedAt?: string
  definitions?: ProjectDefinition[]
  relations?: ProjectRelation[]
  diagnostics?: CatalogDiagnostic[]
  sources?: CatalogSourceFile[]
}
export interface EvalSnapshotEvent {
  type: 'eval:snapshot'
  evalRuns: EvalRun[]
}
export interface RagEvalSnapshotEvent {
  type: 'rag-eval:snapshot'
  ragEvalRuns: RagEvalRun[]
}
export interface FlowSnapshotEvent {
  type: 'flow:snapshot'
  flowRuns: FlowRun[]
}
export interface RuntimeSnapshotEvent {
  type: 'runtime:snapshot'
  embeddingEvents?: EmbeddingEventData[]
  retrievalEvents?: RetrievalEventData[]
  retrievalStageEvents?: RetrievalStageEventData[]
  workspaceEvents?: WorkspaceOperationEvent[]
  indexEvents?: IndexEventData[]
  corpusEvents?: CorpusEventData[]
  ingestEvents?: IngestEventData[]
  memoryEvents: MemoryEventData[]
  compactEvents: CompactEventData[]
  budgetSnapshots: BudgetSnapshotData[]
  costEvents?: CostEventData[]
  agentEvents: AgentEventData[]
  judgeEvents: JudgeEventData[]
  delegateEvents: DelegateEventData[]
  toolEvents?: ToolEventData[]
  securityEvents?: SecurityEventData[]
  planEvents?: PlanEventData[]
  taskListEvents?: TaskListEventData[]
  taskEvents?: TaskEventData[]
  constraintChecks?: ConstraintCheckEventData[]
  constraintRetries?: ConstraintRetryEventData[]
  constraintViolations?: ConstraintViolationEventData[]
}

// Live eval/flow events
export interface EvalStartEvent {
  type: 'eval:start'
  evalId: string
  promptId: string | undefined
  startedAt: number
  models: string[]
  caseNames: string[]
  totalCases: number
}
export interface EvalCaseEvent {
  type: 'eval:case'
  evalId: string
  caseName: string
  modelId: string
  passed: boolean
  durationMs: number
  error?: string
  completedCount: number
  usage?: TokenUsage
  cost?: number
  traceId?: string
}
export interface EvalEndEvent {
  type: 'eval:end'
  evalId: string
  durationMs: number
  summary: {
    total: number
    passed: number
    failed: number
    byModel: Record<string, { total: number; passed: number; failed: number }>
  }
}
export interface FlowStartEvent {
  type: 'flow:start'
  flowId: string
  name: string
  description?: string
  startedAt: number
  stepIds: string[]
  configNames: string[]
  caseNames: string[]
  totalCases: number
}
export interface FlowCaseEvent {
  type: 'flow:case'
  flowId: string
  caseName: string
  configName: string
  passed: boolean
  durationMs: number
  error?: string
  completedCount: number
  traceSummary: FlowRun['completedCases'][number]['traceSummary']
}
export interface FlowEndEvent {
  type: 'flow:end'
  flowId: string
  durationMs: number
  summary: FlowRun['summary']
}

export interface ConstraintCheckWsEvent {
  type: 'constraint:check'
  constraintName: string
  severity: 'assert' | 'suggest'
  pass: boolean
  feedback?: string
  durationMs: number
  attempt: number
  traceId?: string
  timestamp: number
}
export interface ConstraintRetryWsEvent {
  type: 'constraint:retry'
  constraintNames: string[]
  attempt: number
  combinedFeedback: string
  traceId?: string
  timestamp: number
}
export interface ConstraintViolationWsEvent {
  type: 'constraint:violation'
  constraintNames: string[]
  totalAttempts: number
  traceId?: string
  timestamp: number
}

export type WsEvent =
  | CatalogEvent
  | EvalSnapshotEvent
  | RagEvalSnapshotEvent
  | FlowSnapshotEvent
  | RuntimeSnapshotEvent
  | EvalStartEvent
  | EvalCaseEvent
  | EvalEndEvent
  | RagEvalStartEvent
  | RagEvalCaseEvent
  | RagEvalEndEvent
  | FlowStartEvent
  | FlowCaseEvent
  | FlowEndEvent
  | RuntimeFlowStartEvent
  | RuntimeFlowStepEvent
  | RuntimeFlowEndEvent
  | RuntimeFlowSuspendEvent
  | RuntimeFlowResumeEvent
  | RuntimeFlowSignalEvent
  | RuntimeFlowCancelEvent
  | RuntimeFlowExpiredEvent
  | EmbedStartEvent
  | EmbedEndEvent
  | RetrievalStartEvent
  | RetrievalEndEvent
  | RetrievalStageStartEvent
  | RetrievalStageEndEvent
  | WorkspaceOperationEvent
  | IndexStartEvent
  | IndexEndEvent
  | CorpusSyncStartEvent
  | CorpusSourceEvent
  | CorpusSyncEndEvent
  | IngestParseStartEvent
  | IngestParseEndEvent
  | MemoryReadEvent
  | MemoryWriteEvent
  | CompactStartEvent
  | CompactEndEvent
  | BudgetCheckEvent
  | CostReportEvent
  | CostWarnEvent
  | CostLimitEvent
  | BlackboardUpdateEvent
  | HandoffPrepareEvent
  | JudgeResultEvent
  | DelegateStartEvent
  | DelegateCompleteEvent
  | ToolStartEvent
  | ToolEndEvent
  | ToolApprovalRequestEvent
  | ToolApprovalDecisionEvent
  | SecurityWarningEvent
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | TaskListCreatedEvent
  | TaskListCompletedEvent
  | TaskListDiscardedEvent
  | TaskAddedEvent
  | TaskUpdatedEvent
  | TaskRemovedEvent
  | ConstraintCheckWsEvent
  | ConstraintRetryWsEvent
  | ConstraintViolationWsEvent

// ─── Library v2 — Memory / Workspaces / Plans read models ────────────
//
// Shapes mirror the backend contract documented in
// `packages/devtools/LIBRARY_V2_BACKEND_HANDOFF.md`. All optional
// fields are populated only when the runtime actually captured the data
// — per backend contract: missing means "not captured yet", never zero.

export type MemoryStoreType = 'working' | 'episodic' | 'semantic' | 'blackboard'

export interface MemoryStoreScope {
  kind: 'run' | 'user' | 'session' | 'agent' | 'project' | string
  id: string
}

export interface MemoryStoreStats {
  reads: number
  writes: number
  entries: number | null
  conflicts: number
  lifetime: { startedAt: number; lastTouchedAt: number; durationMs: number }
  trend?: { reads: readonly number[]; writes: readonly number[] }
}

export interface MemoryStore {
  id: string
  type: MemoryStoreType
  label?: string
  scope: MemoryStoreScope
  stats: MemoryStoreStats
  lastRunId?: string
  lastTraceId?: string
  health: 'healthy' | 'partial' | 'stale' | 'errored' | string
}

export interface MemoryWorkingField {
  name: string
  ty: string
  value: unknown
  updatedAt: number
  writerSpanId?: string
}

export interface MemoryWorkingMutation {
  eventId: string
  op: 'write' | 'update' | 'append' | 'delete' | string
  key: string
  before: unknown
  after: unknown
  spanId?: string
  span?: string
  traceId?: string
  timestamp: number
}

export interface MemoryWorkingState {
  type: 'working'
  fields: readonly MemoryWorkingField[]
  mutations: readonly MemoryWorkingMutation[]
}

export interface MemoryEpisodicEntry {
  id: string
  content: string
  tags?: readonly string[]
  confidence?: number
  writtenBy?: string
  // Originating run id of the write. Populated for recency stores (the live
  // snapshot path carries it); prefer this over `sourceTraceId` for "from run".
  sourceRun?: string
  // Originating trace id. Usually absent on the Convex mutation path, which
  // carries no traceId — render only when present.
  sourceTraceId?: string
  timestamp: number
}

export interface MemoryEpisodicQuery {
  eventId: string
  query: string
  k?: number
  topScore?: number
  latencyMs?: number
  spanId?: string
  traceId?: string
  timestamp: number
}

export interface MemoryEpisodicWrite {
  eventId: string
  // Backend emits `record` (new episode), `evict` (retention GC sweep) or
  // `delete` (manual). NOT `append`.
  op: 'record' | 'evict' | 'delete' | string
  entryId?: string
  contentPreview?: string
  confidence?: number
  writtenBy?: string
  traceId?: string
  spanId?: string
  timestamp: number
}

export interface MemoryEpisodicState {
  type: 'episodic'
  entries: readonly MemoryEpisodicEntry[]
  queries: readonly MemoryEpisodicQuery[]
  writes: readonly MemoryEpisodicWrite[]
  index?: {
    embeddingModel?: string
    dimensions?: number
    distance?: 'cosine' | 'dot' | 'euclidean' | string
    indexedCount?: number
    targetCount?: number
    status?: 'fresh' | 'stale' | 'rebuilding' | string
  }
  retention?: { policy: string; lastGcAt?: number; lastGcEvicted?: number }
}

export interface MemorySemanticIndex {
  chunkCount: number
  sourceCount: number
  embeddingModel?: string
  dimensions?: number
  similarity?: 'cosine' | 'dot' | 'euclidean' | string
}

export interface MemorySemanticChunk {
  id: string
  sourceDoc: string
  text: string
  magnitude?: number
  tags?: readonly string[]
}

export interface MemorySemanticQuery {
  eventId: string
  query: string
  k?: number
  topScore?: number
  hitChunkIds?: readonly string[]
  latencyMs?: number
  spanId?: string
  traceId?: string
  timestamp: number
}

export interface MemorySemanticState {
  type: 'semantic'
  index: MemorySemanticIndex
  chunks: readonly MemorySemanticChunk[]
  queries: readonly MemorySemanticQuery[]
}

export interface MemoryBlackboardField {
  name: string
  ty: string
  value: unknown
  writer?: string
  writtenAt?: number
  conflicts?: number
  lastConflictResolution?: string
}

export interface MemoryBlackboardChange {
  eventId: string
  agent?: string
  field: string
  before: unknown
  after: unknown
  resolved?: string
  traceId?: string
  spanId?: string
  timestamp: number
}

export interface MemoryBlackboardState {
  type: 'blackboard'
  fields: readonly MemoryBlackboardField[]
  changeLog: readonly MemoryBlackboardChange[]
  collaborators?: readonly string[]
  conflictPolicy?: string
}

export type MemoryStoreState = MemoryWorkingState | MemoryEpisodicState | MemorySemanticState | MemoryBlackboardState

export type MemoryInspectionStatus = 'ok' | 'partial' | 'unavailable' | 'error'
export type MemoryInspectionSource = 'projection' | 'runtime_bridge' | 'mixed'

export interface MemoryInspectionEntry {
  key: string
  value?: unknown
}

export interface MemoryInspection {
  status: MemoryInspectionStatus
  source?: MemoryInspectionSource
  resourceId: string
  kind?: string
  value?: unknown
  entries?: readonly MemoryInspectionEntry[]
  message?: string
  reason?: string
  docsUrl?: string
}

export interface MemoryStoreDetail extends MemoryStore {
  schema?: { name?: string; type?: string; fields?: readonly unknown[]; description?: string } | Record<string, unknown>
  owner?: string
  source?: { file: string; line: number; column?: number; function?: string }
  backend?: string
  conflictPolicy?: string
  evictionPolicy?: string
  state: MemoryStoreState
  // Live runtime inspection joined server-side. Missing on overview shapes,
  // present on detail. `status: 'ok'` means `entries` carry live data on top
  // of the projected `state`; anything else means projection-only and the UI
  // surfaces `message` + `docsUrl` as a notice.
  inspection?: MemoryInspection
}

export interface MemoryOperationRecord {
  eventId: string
  timestamp: number
  storeId: string
  storeType: MemoryStoreType | string
  op: string
  key: string
  value?: string
  traceId?: string
  spanId?: string
}

// ─── Workspaces ──────────────────────────────────────────────────────

export interface WorkspaceMount {
  path: string
  mode?: 'read-write' | 'read-only' | string
  fileCount?: number
}

export interface WorkspaceStats {
  runs?: number
  operations?: number
  errors?: number
  p50LatencyMs?: number
  p99LatencyMs?: number
}

export interface Workspace {
  id: string
  namespace?: string
  mounts?: readonly WorkspaceMount[]
  stats?: WorkspaceStats
  lastTouchedAt?: number
}

export interface WorkspaceFileSummary {
  path: string
  mount?: string
  op?: 'read' | 'write' | 'edit' | 'delete' | 'list' | string
  status?: 'ok' | 'err' | 'denied' | string
  size?: number
  mime?: string
  lastOpAt?: number
  lastOpDurationMs?: number
  lastError?: string
  operationCount?: number
}

export interface WorkspaceOpRecord {
  eventId: string
  op: 'read' | 'write' | 'edit' | 'delete' | 'list' | string
  path: string
  durationMs?: number
  status?: 'ok' | 'err' | 'denied' | string
  bytes?: number
  traceId?: string
  spanId?: string
  actor?: string
  error?: string
  timestamp: number
}

export interface WorkspaceDetail extends Workspace {
  files?: readonly WorkspaceFileSummary[]
  recentOps?: readonly WorkspaceOpRecord[]
}

export interface WorkspaceFilePreview {
  contentType?: 'text' | 'markdown' | 'json' | 'binary' | string
  body?: string
  truncated?: boolean
}

export interface WorkspaceFileVersion {
  versionId: string
  timestamp: number
  actor?: string
  diff?: { added: number; removed: number }
  traceId?: string
}

export interface WorkspaceFileDetail {
  path: string
  mime?: string
  size?: number
  status?: 'ok' | 'err' | 'denied' | string
  preview?: WorkspaceFilePreview
  operations?: readonly WorkspaceOpRecord[]
  versions?: readonly WorkspaceFileVersion[]
}

// ─── Plans & Tasks ───────────────────────────────────────────────────

export interface PlanTaskCounts {
  done: number
  inProgress: number
  pending: number
  removed: number
}

export interface PlanSummary {
  id: string
  title?: string
  status: 'active' | 'suspended' | 'completed' | 'discarded' | 'in_progress' | string
  version: number
  versionCount?: number
  startedAt?: number
  lastUpdatedAt?: number
  author?: string
  taskCounts?: PlanTaskCounts
  contentPreview?: string
}

export interface PlanVersion {
  version: number
  timestamp?: number
  author?: string
  summary?: string
  diff?: { added: number; removed: number }
  contentSnapshot?: string
}

export interface PlanTask {
  id: string
  parentId?: string | null
  label: string
  status: 'done' | 'in_progress' | 'pending' | 'removed' | string
  progress?: number
  assignee?: string
  model?: string
  durationMs?: number | null
  spanId?: string
  traceId?: string
  addedInVersion?: number
  removedInVersion?: number
}

export interface PlanEventRecord {
  eventId: string
  kind: 'plan.created' | 'plan.updated' | 'task.added' | 'task.updated' | 'task.removed' | string
  agent?: string
  label?: string
  timestamp: number
  payload?: unknown
}

export interface PlanDetail extends PlanSummary {
  content?: string
  versions?: readonly PlanVersion[]
  tasks?: readonly PlanTask[]
  events?: readonly PlanEventRecord[]
}
