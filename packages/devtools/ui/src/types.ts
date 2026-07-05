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
  /** Runtime join key for a Storage Beta record-store definition. */
  recordStoreId?: string
  /** Runtime join key for a Storage Beta vector-store definition. */
  vectorStoreId?: string
  /** Runtime join key for a Storage Beta blob-store definition. */
  blobStoreId?: string
  /** Runtime join key for a Storage Beta bundle definition. */
  storageId?: string
  /** Runtime join key for a scoped Storage Beta wrapper definition. */
  storageScopeId?: string
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
  expandedInputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schemaRefs?: SourceRefSummary[]
  inputContributions?: InputSchemaContribution[]
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

export interface InputSchemaContribution {
  field: string
  schema?: JsonSchema
  description?: string
  required?: boolean
  sourceDefinitionId?: string
  sourceName?: string
  sourceKind?: string
  path?: string[]
  via?: 'direct' | 'array-ref' | 'spread' | 'when' | 'match' | 'binary' | 'runtime'
  conditionality?: 'always' | 'when' | 'match-case' | 'match-default' | 'binary-guard' | 'dynamic' | 'unknown'
  branch?: string
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
  targetKind?:
    | 'memory'
    | 'blackboard'
    | 'workspace'
    | 'store'
    | 'block'
    | 'storage.recordStore'
    | 'storage.vectorStore'
    | 'storage.blobStore'
    | 'storage.bundle'
    | 'storage.scope'
  key?: string
  operation?:
    | 'read'
    | 'write'
    | 'append'
    | 'update'
    | 'delete'
    | 'query'
    | 'exists'
    | 'stat'
    | 'grep'
    | 'watch'
    | 'artifacts'
    | 'rename'
    | 'move'
    | 'copy'
    | 'history'
    | 'diff'
    | 'undo'
    | 'finalize'
    | 'transaction'
  source?: { file: string; line: number; column?: number; function?: string }
}

export interface DataFacts {
  reads?: DataAccessFact[]
  writes?: DataAccessFact[]
  artifacts?: Array<{
    name: string
    kind?: string
    source?: { file: string; line: number; column?: number; function?: string }
  }>
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
  injectables?: string[]
  tools?: string[]
  agents?: string[]
  flows?: string[]
  memory?: string[]
  blackboards?: string[]
  workspaces?: string[]
  stores?: string[]
  /** Storage Beta record-store dependencies referenced by variable or definition id. */
  recordStores?: string[]
  /** Storage Beta vector-store dependencies referenced by variable or definition id. */
  vectorStores?: string[]
  /** Storage Beta blob-store dependencies referenced by variable or definition id. */
  blobStores?: string[]
  /** Storage Beta bundle dependencies referenced by variable or definition id. */
  storage?: string[]
  /** Scoped Storage Beta wrappers referenced by variable or definition id. */
  storageScopes?: string[]
  blocks?: string[]
  routers?: string[]
  ragPipelines?: string[]
  retrievers?: string[]
  guardrails?: string[]
  constraints?: string[]
  scorers?: string[]
  extensions?: Record<string, unknown>
}

export interface InjectionUseFacts {
  variable?: string
  relationHint?: 'context' | 'injectable' | 'memory' | 'blackboard' | 'unknown'
  targetDefinitionId?: string
  targetKind?: string
  targetName?: string
  relationType?: string
  relationFidelity?: string
  conditionality?: 'always' | 'when' | 'match-case' | 'match-default' | 'binary-guard' | 'dynamic' | 'unknown'
  branch?: string
  via?: 'direct' | 'array-ref' | 'spread' | 'when' | 'match' | 'binary' | 'runtime'
}

export interface InjectionToolFacts {
  hasTools: boolean
  dynamic?: boolean
  names?: string[]
  variables?: string[]
}

export interface InjectionReturnContributionFacts {
  constraints?: InjectionReferenceContributionFacts
  guardrails?: InjectionReferenceContributionFacts
  metadata?: InjectionMetadataContributionFacts
}

export interface InjectionReferenceContributionFacts {
  variables?: string[]
  dynamic?: boolean
}

export interface InjectionMetadataContributionFacts {
  keys?: string[]
  dynamic?: boolean
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

export interface WorkspaceMountSourceSummary {
  kind?: string
  retriever?: string
  helper?: string
  reference?: string
  capabilities?: readonly string[]
}

export interface WorkspaceDefinitionMount {
  path: string
  access?: string
  mode?: string
  description?: string
  source?: WorkspaceMountSourceSummary
}

export type PrimitiveSpecificFacts =
  | {
      kind: 'prompt'
      use?: string[]
      useEntries?: InjectionUseFacts[]
      hasSystem?: boolean
      hasPrompt?: boolean
      hasMessages?: boolean
      settings?: Record<string, unknown>
      fragments?: SourceRefSummary[]
    }
  | {
      kind: 'context'
      use?: string[]
      useEntries?: InjectionUseFacts[]
      isStatic?: boolean
      priority?: number
      cache?: Record<string, unknown>
      tools?: InjectionToolFacts
      fragments?: SourceRefSummary[]
    }
  | {
      kind: 'injectable'
      injectableId?: string
      inputKeys?: string[]
      mayInject?: Array<'contexts' | 'tools' | 'constraints' | 'guardrails' | 'metadata'>
      useEntries?: InjectionUseFacts[]
      tools?: InjectionToolFacts
      contributions?: InjectionReturnContributionFacts
    }
  | { kind: 'tool'; toolName?: string; hasExecute?: boolean; hasToModelOutput?: boolean; approvalRequired?: boolean }
  | {
      kind: 'agent'
      promptId?: string
      toolNames?: string[]
      handoffs?: string[]
      contextHandler?: SourceRefSummary
      usageHandler?: SourceRefSummary
      prepareHandler?: SourceRefSummary
    }
  | { kind: 'flow'; stepNames?: string[]; hasArgs?: boolean; runtime?: 'node' | 'convex' }
  | {
      kind: 'flow.step'
      flowId: string
      stepId?: string
      stepLabel?: string
      targetDefinitionId?: string
      targetKind?: string
    }
  | {
      kind: 'composition.parallel' | 'composition.pipeline' | 'composition.swarm' | 'composition.consensus'
      participants?: string[]
      coordinator?: string
      judge?: string
      scorer?: string
      sharedMemory?: string | string[]
      sharedBlackboard?: string
    }
  | {
      kind: 'composition.parallel.branch' | 'composition.pipeline.stage'
      compositionId: string
      index?: number
      branchId?: string
      stageId?: string
      targetVariable?: string
      targetDefinitionId?: string
      targetKind?: string
    }
  | {
      kind: 'routing.router' | 'routing.cascade' | 'routing.fallback'
      routingId?: string
      hasStableId?: boolean
      routeKeys?: string[]
      routeCount?: number
      hasDefaultRoute?: boolean
      hasClassify?: boolean
      tierCount?: number
      optionCount?: number
      hasBudget?: boolean
      budget?: Record<string, unknown>
    }
  | {
      kind: 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'
      routingId?: string
      routeKey?: string
      tierIndex?: number
      optionIndex?: number
      parentDefinitionId?: string
      targetVariable?: string
      targetDefinitionId?: string
      targetKind?: string
      hasEvaluate?: boolean
      isDefault?: boolean
    }
  | {
      kind:
        | 'rag.knowledgeBase'
        | 'rag.recipe'
        | 'rag.recipe.step'
        | 'rag.pipeline'
        | 'rag.pipeline.stage'
        | 'rag.reranker'
        | 'rag.retriever'
      knowledgeBaseId?: string
      recipeId?: string
      stepId?: string
      rerankerId?: string
      retrieverId?: string
      stageId?: string
      stageKind?: string
      topK?: number
    }
  | {
      kind: 'memory' | 'blackboard'
      backend?: string
      runtimeIdPrefix?: string
      blockCount?: number
      evictionPolicy?: string
      conflictPolicy?: string
    }
  | { kind: 'memory.store'; ownerDefinitionKey?: string; backend?: string; component?: string; variableName?: string }
  | {
      kind: 'memory.block'
      memoryId: string
      blockId?: string
      blockKind?: string
      priority?: number
      writeMode?: string
      hasEmbed?: boolean
    }
  | {
      kind: 'workspace'
      workspaceId?: string
      namespace?: string
      mounts?: WorkspaceDefinitionMount[]
      hasTools?: boolean
    }
  | StorageFacts
  | { kind: 'constraint' | 'guardrail'; appliesTo?: string[]; policy?: string; severity?: string }
  | {
      kind: 'scorer'
      scorerId?: string
      model?: string
      threshold?: number
      scaleMin?: number
      scaleMax?: number
      hasRubric?: boolean
      hasDetailSchema?: boolean
      chainOfThought?: boolean
      criteriaPreview?: string
    }
  | {
      kind: 'dataset' | 'suite' | 'suite.case' | 'eval.prompt' | 'eval.flow' | 'eval.rag' | 'eval.quality'
      targetDefinitionId?: string
      suiteId?: string
      caseCount?: number
      scorerIds?: string[]
    }

export type ProjectDefinitionFacts =
  | PrimitiveSpecificFacts
  | ({ kind: string; extensions?: Record<string, unknown> } & Record<string, unknown>)

/** Project Index capability summary for Storage Beta definitions. */
export interface IndexedStorageCapabilities {
  /** JSON record-store capabilities when the definition is a record store or bundle. */
  record?: {
    /** TTL support: backend-native, adapter-managed lazy expiry, unsupported, or unknown statically. */
    ttl?: 'native' | 'lazy' | false | 'unknown'
    /** Exact top-level scalar filter support. */
    filter?: 'native' | 'scan' | false | 'unknown'
    /** Whether record watch subscriptions are available. */
    watch?: boolean | 'unknown'
    /** Whether native batch record operations are available. */
    batch?: boolean | 'unknown'
  }
  /** Vector-index capabilities when the definition is a vector store or bundle. */
  vector?: {
    /** Whether dense-vector similarity search is available. */
    dense?: boolean | 'unknown'
    /** Whether sparse-vector search is available. */
    sparse?: boolean | 'unknown'
    /** Whether dense and sparse queries can be combined by the same store. */
    hybrid?: boolean | 'unknown'
    /** Supported hybrid result fusion algorithms, or `unknown` when the adapter cannot report them. */
    fusion?: readonly ('rrf' | 'dbsf')[] | 'unknown'
    /** Whether metadata filters run before vector search, after vector search, or not at all. */
    filter?: 'pre' | 'post' | false | 'unknown'
    /** Read-after-write visibility expected from the vector backend. */
    consistency?: 'strong' | 'eventual' | 'unknown'
  }
  /** Blob-store capabilities when the definition is a blob store or bundle. */
  blob?: {
    /** Whether multipart uploads are available for large blobs. */
    multipart?: boolean | 'unknown'
    /** Whether the adapter can mint signed URLs for direct blob access. */
    signedUrls?: boolean | 'unknown'
    /** Maximum blob size in bytes when known statically. */
    maxBytes?: number | 'unknown'
  }
}

/** First-class Storage Beta definition facts emitted by Project Index. */
export interface StorageFacts {
  kind: 'storage.recordStore' | 'storage.vectorStore' | 'storage.blobStore' | 'storage.bundle' | 'storage.scope'
  /** Store or bundle factory name when statically known, for example `inMemoryStorage`. */
  backend?: string
  /** Authored variable bound to this storage definition. */
  variableName?: string
  /** Capabilities provided by this storage definition, or `unknown` fields for conservative static output. */
  capabilities?: IndexedStorageCapabilities
  /** Record store variable or definition id used by a bundle. */
  records?: string
  /** Vector store variable or definition id used by a bundle. */
  vectors?: string
  /** Blob store variable or definition id used by a bundle. */
  blobs?: string
  /** Base storage variable or definition id wrapped by a scope. */
  storage?: string
  /** Key prefix used by a scoped storage wrapper when statically known. */
  prefix?: string
}

export interface ProjectDefinitionMetadata extends Record<string, unknown> {
  argsSchema?: JsonSchema
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schema?: JsonSchema
  indexPresentation?: {
    standalone: boolean
    parentDefinitionId?: string
    parentRelationType?: string
    role?: 'step' | 'branch' | 'stage' | 'route' | 'tier' | 'option' | 'block' | 'store' | 'storage' | 'case'
    order?: number
  }
  intelligence?: DefinitionIntelligence
  runtimeJoin?: ProjectRuntimeJoin
  sourceStatus?: {
    importSafe?: boolean
    partialReason?: string
    confidence?: PrimitiveIntelligenceConfidence
  }
  /** Last-edit signal derived from the source file's mtime (not git blame),
   *  so there is no author. See CATALOG_V2_BACKEND_FOLLOWUPS.md §"updated". */
  updated?: {
    lastEditedAt?: string
    lastEditedAtMs?: number
    sourceMtime?: true
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

export interface IndexDiagnostic {
  id: string
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  source?: { file: string; line: number; column?: number; function?: string }
  relatedDefinitionIds?: string[]
  suggestedFix?: string
}

export interface IndexLintFinding {
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
  /** For the injection contract rules (`prompt.hidden_required_input`,
   *  `prompt.conflicting_injected_input`, `prompt.conditional_required_input`):
   *  the exact effective-input field the finding concerns, so it can be
   *  anchored in context on the prompt's effective-input card in addition to
   *  its home in Health. */
  inputField?: string
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

export interface IndexSourceFile {
  file: string
  status: 'indexed' | 'partial' | 'error'
  definitionIds?: string[]
  diagnostics?: string[]
}

export interface IndexIndexingPhaseStatus {
  status: 'pending' | 'running' | 'ready' | 'degraded'
  indexedAt?: string
  durationMs?: number
  fileCount?: number
  changedFileCount?: number
  diagnosticCount?: number
}

export interface ProjectIndexingStatus {
  status: 'cold' | 'cached' | 'refreshing' | 'ready' | 'degraded'
  ast: IndexIndexingPhaseStatus
  semantic: Omit<IndexIndexingPhaseStatus, 'status'> & {
    status: 'disabled' | IndexIndexingPhaseStatus['status']
    enrichedDefinitionCount?: number
  }
  cache?: {
    status: 'miss' | 'hit' | 'stale' | 'invalid'
    loadedAt?: string
    snapshotAgeMs?: number
  }
}

export interface ProjectIndexData {
  schemaVersion?: number
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools: ToolMeta[]
  project?: ProjectIdentity
  indexedAt?: string
  indexing?: ProjectIndexingStatus
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: IndexDiagnostic[]
  lintFindings: IndexLintFinding[]
  sources: IndexSourceFile[]
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
  sessionId?: string
  userId?: string
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
} from '@use-crux/core/observability'

// Turn Explanation read model — backs the Run Detail `Explain` tab. Projected
// onto generation nodes/details as `decisionReport` (see contract.ts).
export type {
  TurnDecisionReport,
  TurnDecisionTurn,
  TurnSawItem,
  TurnConsideredItem,
  TurnFreshnessEvidence,
  TurnCacheEvidence,
  TurnDecision,
  TurnDecisionPhase,
  TurnDecisionReason,
  TurnDecisionSubject,
  TurnSourceGroup,
  TurnSourceJoin,
  TurnDecisionCoverage,
  TurnCoverageArea,
  TurnDecisionDiagnostic,
  TurnDecisionChip,
  TurnDeepTabTarget,
  TurnEvidenceLevel,
  TurnDisposition,
  TurnSourceStatus,
} from '@use-crux/core/observability'

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
  experimentCount: number
  baselineCount: number
  feedbackCount: number
  feedbackNeedingReviewCount: number
  cassetteCount: number
  /** Cassettes past the engine's 90-day replay staleness window. */
  staleCassetteCount: number
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
  | 'retrieval.step'
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

// ─── Spec-02 Quality contracts ───────────────────────────────────────
//
// The Go server serves the rewritten Quality engine's records: experiment
// summaries (presentation rows), the full ExperimentRecord verbatim,
// BaselineRecords verbatim, executor-boundary cassette files, scorer stats
// derived from experiment cells, and evaluation manifests. The record
// schemas evolve additively — render unknown statuses defensively.

/** One row of `GET /api/quality/experiments` — the list projection of a spec-02 ExperimentRecord. */
export interface QualityExperimentSummary {
  experimentId: string
  evaluationId: string
  qualityId: string
  experimentLabel?: string
  startedAt: string
  endedAt: string
  filteredRun: boolean
  replayMode: string
  cassette?: string
  /** Promoted baseline this run compared against, if any. */
  baselineId?: string
  variants: readonly string[]
  /** Cell counts aggregated across all variants. */
  cells: number
  cellsPassed: number
  cellsFailed: number
  cellsErrored: number
  cellsSkipped: number
  /** Gate verdicts (spec-02 §1 gates block). */
  gatesPassed: boolean
  gatesInformational: boolean
  gateFailures: number
  hasComparison: boolean
  comparisonDemoted?: boolean
  /** The record's top-level convenience verdict. */
  passed: boolean
  /**
   * Backend-owned lifecycle/verdict status. Completed rows report
   * `passed | failed | informational`; in-flight rows from run events report
   * `running` and carry a synthetic `running:` experimentId (no persisted detail).
   */
  status?: 'passed' | 'failed' | 'informational' | 'running'
}

/** Faceted counts over the current evaluation+window scope, ignoring `status`. */
export interface QualityExperimentStatusCounts {
  all: number
  passed: number
  failed: number
  informational: number
  running: number
}

/** Server-side filter + paging options for the experiments list. */
export interface QualityExperimentsOptions {
  status?: 'passed' | 'failed' | 'informational' | 'running'
  evaluation?: string
  window?: '24h' | '7d' | '30d' | 'all'
  limit?: number
  cursor?: string
}

/**
 * One page of the server-filtered, server-paged experiments list.
 *
 * `statusCounts` and `evaluations` are facets the backend computes over the
 * current evaluation+window scope (ignoring `status`) so the UI can render tab
 * counts and the evaluation filter without scanning the full record set.
 */
export interface QualityExperimentsPage {
  _tag: 'QualityExperimentsPage'
  experiments: readonly QualityExperimentSummary[]
  total: number
  nextCursor?: string
  statusCounts: QualityExperimentStatusCounts
  evaluations: readonly string[]
}

/**
 * Backend-owned relation read for one evaluation's retained experiments.
 *
 * `total` is the full retained count before `limit` is applied, so evaluation
 * detail screens can show "latest N of total" without scanning all records.
 */
export interface QualityEvaluationExperiments {
  readonly _tag: 'QualityEvaluationExperiments'
  readonly schemaVersion: 1
  readonly evaluationId: string
  readonly generatedAt: string
  readonly limit: number
  readonly total: number
  readonly experiments: readonly QualityExperimentSummary[]
}

/** One evaluation bucket in the grouped experiment relation read model. */
export interface QualityEvaluationExperimentGroup {
  readonly evaluationId: string
  readonly total: number
  readonly experiments: readonly QualityExperimentSummary[]
}

/**
 * Backend-owned grouping for experiment list screens.
 *
 * Groups are ordered by their latest retained experiment. Each group's
 * `experiments` list is newest-first and capped by the requested `limit`.
 */
export interface QualityEvaluationExperimentGroups {
  readonly _tag: 'QualityEvaluationExperimentGroups'
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly limit: number
  readonly totalEvaluations: number
  readonly totalExperiments: number
  readonly groups: readonly QualityEvaluationExperimentGroup[]
}

export interface QualityExperimentReplay {
  mode: string
  cassette?: string
  trialsCollapsed?: boolean
  staleSince?: string
}

export interface QualityExperimentBaselineRef {
  baselineId: string
  experimentId: string
  variantName?: string
}

export interface QualityExperimentVariantDecl {
  name: string
  overrideKeys: readonly string[]
  overrides?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityCellScore {
  name: string
  score: number | null
  label?: string
  costClass?: string
  metadata?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityAssertionFailure {
  level: string
  index: number
  matcher: string
  soft: boolean
  message: string
  expectedPreview?: string
  actualPreview?: string
  sourceRef?: string
}

export interface QualityAssertionValue {
  label: string
  value: QualityJsonValue
  preview: string
  redacted: boolean
}

export type QualityEvidenceValue = QualityAssertionValue

export type QualityEvaluatedExpressionOperator =
  | '>='
  | '>'
  | '<='
  | '<'
  | '=='
  | '!='
  | 'contains'
  | 'matches'
  | 'custom'

/**
 * Structured matcher expression captured by the backend.
 *
 * `rendered` is server-owned so CLI, TUI, and web clients show the same
 * compact statement instead of rebuilding matcher text independently.
 */
export interface QualityEvaluatedExpression {
  readonly left: QualityAssertionValue
  readonly operator: QualityEvaluatedExpressionOperator
  readonly right?: QualityAssertionValue
  readonly result: boolean
  readonly rendered: string
}

export type QualitySourceFrameRole = 'context' | 'failed' | 'passed' | 'not-evaluated'

/** One authored source line in a retained evidence frame. */
export interface QualitySourceFrameLine {
  line: number
  text: string
  role: QualitySourceFrameRole
}

/**
 * Authored source context for an assertion outcome.
 *
 * `source-frame` means the backend resolved the runtime stack location to
 * authored source and retained a narrow snapshot. `unavailable` is an honest
 * degradation path for missing sourcemaps, missing source files, unsupported
 * source, or generated-only locations.
 */
export type QualitySourceFrame =
  | {
      kind: 'source-frame'
      sourceRef: string
      authoredFile: string
      authoredLine: number
      authoredColumn?: number
      frameStartLine: number
      frameEndLine: number
      lines: readonly QualitySourceFrameLine[]
      contentHash: string
      capturedAt: string
      stale: boolean
      resolver: 'source-map' | 'catalog' | 'disk'
    }
  | {
      kind: 'unavailable'
      reason:
        | 'no-source-ref'
        | 'invalid-source-ref'
        | 'source-map-missing'
        | 'source-file-missing'
        | 'source-line-missing'
        | 'source-root-missing'
        | 'source-outside-project'
        | 'unsupported-language'
        | 'unsupported-source-file'
    }

/**
 * One assertion outcome in execution order.
 *
 * Outcomes include passes and not-evaluated placeholders, not just failures,
 * so clients can render where an assertion callback stopped without replaying
 * matcher control flow locally.
 */
export interface QualityAssertionOutcome {
  id: string
  level: 'evaluation' | 'case'
  phase: 'expect' | 'assert'
  index: number
  status: 'passed' | 'failed' | 'not-evaluated' | 'uncaptured'
  matcher: string
  soft: boolean
  message?: string
  subjectExpr?: string
  actual?: QualityAssertionValue
  expected?: QualityAssertionValue
  expression?: QualityEvaluatedExpression
  sourceRef?: string
  assertionSiteId?: string
  spanIds?: readonly string[]
  sourceFrame?: QualitySourceFrame
}

export interface QualityCellError {
  message: string
  phase: string
  missingCassetteKey?: string
  sourceRef?: string
  sourceFrame?: QualitySourceFrame
}

/** One cell (case × variant × trial) of a spec-02 ExperimentRecord. */
export interface QualityExperimentCell {
  caseId: string
  caseName?: string
  variantName: string
  trial: number
  status: 'passed' | 'failed' | 'errored' | 'skipped'
  skipReason?: string
  input: QualityJsonValue
  output?: QualityJsonValue
  expected?: QualityJsonValue
  scores: readonly QualityCellScore[]
  assertions: {
    ran: number
    notEvaluated: number
    failures: readonly QualityAssertionFailure[]
    outcomes?: readonly QualityAssertionOutcome[]
  }
  error?: QualityCellError
  durationMs: number
  costUsd?: number
  usage?: { inputTokens: number; outputTokens: number }
  traceIds: readonly string[]
  capturedSignals: readonly string[]
  metadata?: { readonly [key: string]: QualityJsonValue }
}

export interface QualityVariantAggregate {
  cells: number
  passed: number
  failed: number
  errored: number
  skipped: number
  passRate: number
  scores: Readonly<Record<string, { mean: number; sem: number; n: number }>>
  consistency?: { passAtK: number; passAllTrials: number }
  latency: { meanMs: number; p95Ms: number }
  costUsd?: number
}

export interface QualityComparisonDelta {
  variantName: string
  scoreName: string
  meanDelta: number
  sem: number
  n: number
}

export interface QualityExperimentComparison {
  kind: 'variant' | 'promoted'
  baseline: string
  deltas: readonly QualityComparisonDelta[]
  unmatchedCases: { baselineOnly: readonly string[]; candidateOnly: readonly string[] }
  demoted?: { reason: string }
}

export interface QualityGateResult {
  gate: string
  variantName?: string
  threshold: QualityJsonValue
  actual: QualityJsonValue
  passed: boolean
  informational?: boolean
}

/** Full spec-02 ExperimentRecord — `GET /api/quality/experiments/{experimentId}` serves it verbatim. */
export interface QualityExperimentDetail {
  schemaVersion: number
  experimentId: string
  evaluationId: string
  qualityId: string
  experimentLabel?: string
  startedAt: string
  endedAt: string
  configFingerprint: string
  taskFingerprint: string
  filteredRun: boolean
  replay: QualityExperimentReplay
  baselineRef?: QualityExperimentBaselineRef
  variants: readonly QualityExperimentVariantDecl[]
  cases: readonly QualityExperimentCell[]
  aggregates: { perVariant: Readonly<Record<string, QualityVariantAggregate>> }
  comparison?: QualityExperimentComparison
  gates: {
    passed: boolean
    informational: boolean
    results: readonly QualityGateResult[]
  }
  passed: boolean
}

export type QualityCellEvidenceStatus = 'passed' | 'failed' | 'errored' | 'skipped'

export type QualityCellEvidenceErrorPhase = 'execute' | 'expect' | 'assert' | 'score' | 'replay' | 'timeout'

/**
 * Backend-owned evidence record for one case x variant x trial cell.
 *
 * The server performs the joins across experiment records, source frames,
 * score details, baseline availability, and trace references. Clients should
 * render this record directly rather than reconstructing it from raw records.
 */
export interface QualityCellEvidence {
  readonly _tag: 'QualityCellEvidence'
  readonly schemaVersion: 1
  readonly experimentId: string
  readonly evaluationId?: string
  readonly generatedAt: string
  readonly cell: QualityCellIdentity
  readonly trialSummary: QualityTrialSummary
  readonly io: QualityCellIOEvidence
  readonly scores: readonly QualityScoreEvidence[]
  readonly assertions: QualityAssertionEvidence
  readonly checks: readonly QualityCheckEvidence[]
  readonly code: QualityCodeEvidence
  readonly baseline: QualityBaselineEvidence
  readonly trace: QualityTraceEvidence
  readonly repro: QualityReproEvidence
  readonly provenance: QualityEvidenceProvenance
}

/** Stable identity and execution state for the selected cell. */
export interface QualityCellIdentity {
  readonly caseId: string
  readonly caseName?: string
  readonly variantName: string
  readonly trial: number
  readonly status: QualityCellEvidenceStatus
  readonly durationMs: number
  readonly costUsd?: number
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
  readonly traceIds: readonly string[]
  readonly capturedSignals: readonly string[]
  readonly error?: {
    readonly message: string
    readonly phase: QualityCellEvidenceErrorPhase
    readonly missingCassetteKey?: string
    readonly sourceRef?: string
    readonly sourceFrame?: QualitySourceFrame
  }
}

/** Sibling-trial rollup for the same case and variant. */
export interface QualityTrialSummary {
  readonly selectedTrial: number
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly errored: number
  readonly skipped: number
  readonly verdict: 'stable-pass' | 'stable-fail' | 'flaky' | 'all-errored' | 'mixed'
  readonly trials: readonly {
    readonly trial: number
    readonly status: QualityCellEvidenceStatus
    readonly durationMs: number
    readonly primaryFailure?: string
  }[]
}

/** Already-redacted input/output values from the stored experiment cell. */
export interface QualityCellIOEvidence {
  readonly input: QualityJsonValue
  readonly output?: QualityJsonValue
  readonly expected?: QualityJsonValue
  readonly outputTruncated: boolean
  readonly redactionApplied: boolean
}

/** Normalized score evidence, including model-judge rationale when present. */
export interface QualityScoreEvidence {
  readonly name: string
  readonly score: number
  readonly label?: string
  readonly costClass?: 'code' | 'judge' | 'hybrid' | string
  readonly rationale?: string
  readonly metadata?: Readonly<Record<string, QualityJsonValue>>
  readonly threshold?: {
    readonly source: 'assertion' | 'gate' | 'baseline'
    readonly operator: QualityEvaluatedExpressionOperator
    readonly value: number
    readonly passed: boolean
  }
  readonly deltaFromBaseline?: number
}

/** Ordered assertion ledger for the selected cell. */
export interface QualityAssertionEvidence {
  readonly ran: number
  readonly notEvaluated: number
  readonly outcomes: readonly QualityAssertionOutcome[]
}

/** Human-debuggable checks normalized from assertions, thresholds, and errors. */
export type QualityCheckEvidence =
  | {
      readonly kind: 'assertion'
      readonly outcomeId: string
      readonly status: QualityAssertionOutcome['status']
      readonly summary: string
      readonly message?: string
      readonly sourceFrame?: QualitySourceFrame
      readonly expression?: QualityEvaluatedExpression
      readonly spanIds?: readonly string[]
    }
  | {
      readonly kind: 'score-threshold'
      readonly scoreName: string
      readonly score: number
      readonly operator: QualityEvaluatedExpressionOperator
      readonly threshold: number
      readonly passed: boolean
      readonly source: 'assertion' | 'gate' | 'baseline'
      readonly message?: string
      readonly sourceFrame?: QualitySourceFrame
      readonly rationale?: string
    }
  | {
      readonly kind: 'runtime-error'
      readonly phase: QualityCellEvidenceErrorPhase
      readonly message: string
      readonly sourceFrame?: QualitySourceFrame
      readonly spanIds: readonly string[]
    }

/** Authored source context and curated values available at the selected check. */
export interface QualityCodeEvidence {
  readonly primaryFrame: QualitySourceFrame
  readonly valuesAtCheck: readonly QualityEvidenceValue[]
  readonly openedInEditor?: {
    readonly file: string
    readonly line: number
    readonly column?: number
  }
}

/** Baseline comparison evidence or an explicit degradation reason. */
export type QualityBaselineEvidence =
  | {
      readonly kind: 'available'
      readonly baselineId: string
      readonly experimentId?: string
      readonly sameInput: boolean
      readonly sameCase: boolean
      readonly baselineCell: {
        readonly status: QualityCellEvidenceStatus
        readonly output?: QualityJsonValue
        readonly scores: readonly QualityScoreEvidence[]
      }
      readonly deltas: readonly {
        readonly scoreName: string
        readonly baseline: number
        readonly candidate: number
        readonly delta: number
      }[]
    }
  | {
      readonly kind: 'unavailable'
      readonly baselineId?: string
      readonly experimentId?: string
      readonly reason:
        | 'no-baseline'
        | 'baseline-has-no-output-evidence'
        | 'baseline-experiment-missing'
        | 'case-not-in-baseline'
        | 'variant-not-comparable'
    }

/** Trace references for the cell; span waterfalls appear only when defensible. */
export interface QualityTraceEvidence {
  readonly traceIds: readonly string[]
  readonly retainedTraceIds: readonly string[]
  readonly hotSpanIds: readonly string[]
  readonly rootCause?: {
    readonly summary: string
    readonly spanId?: string
    readonly confidence: 'exact' | 'heuristic'
  }
  readonly spans: readonly {
    readonly spanId: string
    readonly parentSpanId?: string
    readonly name: string
    readonly kind?: string
    readonly startMs: number
    readonly durationMs: number
    readonly status: 'ok' | 'error' | 'unknown'
    readonly hot: boolean
  }[]
}

/** Command surface that can refetch the same evidence record. */
export interface QualityReproEvidence {
  readonly command: string
  readonly args: readonly string[]
}

/** Local sources used to build the evidence record, when known. */
export interface QualityEvidenceProvenance {
  readonly experimentRecordPath?: string
  readonly baselineRecordPath?: string
  readonly sourceCatalogVersion?: string
  readonly sourceResolverVersion?: string
}

/** Spec-02 BaselineRecord — committed at `baselines/<evaluationId>.json`, served verbatim. */
export interface QualityBaselineRecord {
  schemaVersion: number
  baselineId: string
  evaluationId: string
  experimentId: string
  variantName?: string
  promotedAt: string
  promotedBy?: string
  configFingerprint: string
  /** caseId → scoreName → reference value. */
  reference: Readonly<Record<string, Readonly<Record<string, number>>>>
}

export type QualityEvaluationProgressVerdict = 'passed' | 'failed' | 'errored' | 'skipped'

/**
 * Backend-owned progress strip data for one evaluation.
 *
 * The local service computes recent run rows, score series, and baseline
 * overlays from quality records. UI clients should use this record directly
 * instead of scanning experiments in the browser.
 */
export interface QualityEvaluationProgress {
  readonly _tag: 'QualityEvaluationProgress'
  readonly schemaVersion: 1
  readonly evaluationId: string
  readonly generatedAt: string
  readonly limit: number
  readonly runs: readonly QualityEvaluationProgressRun[]
  readonly scoreSeries: readonly QualityScoreProgressSeries[]
}

/** One recent experiment row in evaluation progress. */
export interface QualityEvaluationProgressRun {
  readonly experimentId: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly verdict: QualityEvaluationProgressVerdict
  readonly passRate: number
  readonly durationMs?: number
  readonly costUsd?: number
}

/** One score's recent run series, with an optional current-baseline line. */
export interface QualityScoreProgressSeries {
  readonly scoreName: string
  readonly baseline?: {
    readonly value: number
    readonly baselineId: string
  }
  readonly points: readonly QualityScoreProgressPoint[]
}

/** Aggregate score point for one experiment in an evaluation series. */
export interface QualityScoreProgressPoint {
  readonly experimentId: string
  readonly mean: number
  readonly sem: number
  readonly n: number
  readonly passedGate?: boolean
}

/** `POST /api/quality/promote` success payload. */
export interface QualityPromoteResult {
  baselineId: string
  evaluationId: string
  experimentId: string
  variantName?: string
  path: string
  pinHint?: string
}

/** One evaluation manifest from `GET /api/quality/evaluations` (spec-02 EvaluationManifest). */
export interface QualityEvaluationManifest {
  schemaVersion: number
  id: string
  explicitId: boolean
  file: string
  exportName: string
  source: 'file' | 'prompt-tests' | string
  description?: string
  tags: readonly string[]
  task: {
    kind: 'prompt' | 'flow' | 'agent' | 'retriever' | 'fn' | string
    ref?: string
    capabilities: readonly string[]
  }
  cases: readonly {
    caseId: string
    name?: string
    hasExpect: boolean
    trials: number
    tags: readonly string[]
    skip?: boolean | string
    only?: boolean
  }[]
  datasets: readonly { path: string; caseCount?: number }[]
  hasEvaluationExpect: boolean
  scorers: readonly { name: string; costClass: 'code' | 'model' | string }[]
  variants: readonly { name: string; overrideKeys: readonly string[] }[]
  baseline?: string
  trials: number
  gates?: { readonly [key: string]: QualityJsonValue }
  replay?: { mode: string; cassette?: string }
  flags: { only: boolean; skip: boolean }
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

/** One executor-boundary cassette file from `GET /api/quality/cassettes`. */
export interface QualityCassetteRecord {
  name: string
  path: string
  recordedAt: string
  sdkVersion: string
  models: readonly string[]
  entryCount: number
  /** Mirrors the engine's 90-day replay staleness window. */
  stale: boolean
  sizeBytes: number
}

/** Scorer usage stats from `GET /api/quality/scorers`, derived from experiment cells. */
export interface QualityScorerRecord {
  name: string
  costClass?: string
  evaluationIds: readonly string[]
  cellCount: number
  meanScore?: number
  lastUsedAt?: string
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
  operation:
    | 'list'
    | 'read'
    | 'write'
    | 'edit'
    | 'delete'
    | 'exists'
    | 'stat'
    | 'append'
    | 'rename'
    | 'move'
    | 'copy'
    | 'grep'
    | 'artifacts'
    | 'finalize'
    | 'transaction'
    | string
  path: string
  pathHash?: string
  status: 'success' | 'error'
  durationMs: number
  mount?: string
  mimeType?: string
  size?: number
  artifactStatus?: string
  artifactKind?: string
  uri?: string
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

export interface IndexEvent {
  type: 'index'
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools?: ToolMeta[]
  project?: ProjectIdentity
  indexedAt?: string
  definitions?: ProjectDefinition[]
  relations?: ProjectRelation[]
  diagnostics?: IndexDiagnostic[]
  sources?: IndexSourceFile[]
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
  | IndexEvent
  | RuntimeSnapshotEvent
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
  captureMode?: string
  budget?: Record<string, unknown>
  blocks?: readonly MemoryBlockMetadata[]
  conflictPolicy?: string
  evictionPolicy?: string
  state: MemoryStoreState
  // Live runtime inspection joined server-side. Missing on overview shapes,
  // present on detail. `status: 'ok'` means `entries` carry live data on top
  // of the projected `state`; anything else means projection-only and the UI
  // surfaces `message` + `docsUrl` as a notice.
  inspection?: MemoryInspection
}

export interface MemoryBlockMetadata {
  id?: string
  kind?: string
  priority?: number
  budget?: Record<string, unknown>
  writeMode?: string
  renderStrategy?: string
  renderLimit?: number
  retentionPolicy?: string
  hasEmbed?: boolean
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
  sourceKind?: string
  sourceHelper?: string
  sourceRef?: string
  retriever?: string
  capabilities?: readonly string[]
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
  artifactStatus?: string
  artifactKind?: string
  uri?: string
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
  mime?: string
  artifactStatus?: string
  artifactKind?: string
  uri?: string
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
  status: 'completed' | 'in_progress' | 'pending' | 'failed' | 'skipped' | 'cancelled' | 'removed' | string
  progress?: number
  progressMessage?: string
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
