/**
 * The `InstrumentationHooks` contract — the global observation surface for Crux
 * primitive operations.
 *
 * A single plugin/devtools-installed hook bag with one optional callback per
 * primitive event (embedding, retrieval, indexing, corpus sync, ingest, memory,
 * compaction, cost, agent coordination, tools, security, composition, flows,
 * plans/tasks, context cache, skills, validation retry, routing, guardrails,
 * constraints, and the semantic cache). It is read field-by-field via
 * `getRuntime().instrumentationHooks` and merged per-hook (fan-out) by
 * `mergeRuntime()`.
 *
 * Split out of `middleware.ts` so the hook *function* types (resolve/execution/
 * stream) stay in a small, focused module while this large declarative bag
 * lives on its own. Re-exported from `./middleware` so `from './middleware'`
 * import sites keep working unchanged.
 *
 * @module
 */

import type { CostBudgetEvent, CostReportEvent } from '../cost'
import type { SourceStageRecord } from '../indexing'

/** Global hooks for observing primitive operations (memory, compaction, scoring, agent coordination). */
export interface InstrumentationHooks {
  onEmbedStart?: (event: {
    embedId: string
    name: string
    kind: 'dense' | 'sparse'
    operation: 'embed' | 'embedMany'
    inputCount: number
    chunkCount: number
    maxChunkSize: number
    dimensions?: number
  }) => void
  onEmbedEnd?: (event: {
    embedId: string
    name: string
    kind: 'dense' | 'sparse'
    operation: 'embed' | 'embedMany'
    inputCount: number
    chunkCount: number
    maxChunkSize: number
    dimensions?: number
    durationMs: number
    usage?: { inputTokens?: number; totalTokens?: number }
    cost?: number
    cacheHitCount?: number
    cacheMissCount?: number
    retryCount?: number
    truncatedCount?: number
    rateLimitWaitMs?: number
    error?: string
  }) => void
  onRetrievalStart?: (event: {
    retrievalId: string
    retrieverId: string
    namespace: string
    mode: 'dense' | 'sparse' | 'hybrid' | 'custom'
    query: string
    limit?: number
    threshold?: number
    filter?: Record<string, unknown>
    fusion?: 'rrf' | 'dbsf'
  }) => void
  onRetrievalEnd?: (event: {
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
  }) => void
  onRetrievalStageStart?: (event: {
    retrievalId: string
    retrieverId: string
    pipelineId: string
    stageName: string
    stageKind: 'query-planner' | 'multi-query' | 'parent-expand' | 'compress' | 'diversify' | 'decay' | 'custom'
    phase: 'query' | 'hits'
    inputQueryCount?: number
    inputHitCount?: number
  }) => void
  onRetrievalStageEnd?: (event: {
    retrievalId: string
    retrieverId: string
    pipelineId: string
    stageName: string
    stageKind: 'query-planner' | 'multi-query' | 'parent-expand' | 'compress' | 'diversify' | 'decay' | 'custom'
    phase: 'query' | 'hits'
    status: 'success' | 'error' | 'skipped'
    inputQueryCount?: number
    outputQueryCount?: number
    inputHitCount?: number
    outputHitCount?: number
    durationMs: number
    warningCount?: number
    error?: string
    preview?: {
      queries?: Array<{ query: string; filter?: Record<string, unknown>; reason?: string }>
      hits?: Array<{ sourceId: string; chunkId: string; score: number; contentPreview?: string }>
    }
  }) => void
  onWorkspaceOperation?: (event: {
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
  }) => void
  onIndexStart?: (event: {
    indexId: string
    indexerId: string
    namespace: string
    operation: 'indexDocuments' | 'indexChunks' | 'deleteSource' | 'clear'
    sourceCount: number
    chunkCount: number
    replaceSources?: boolean
    sourceId?: string
    dryRun?: boolean
  }) => void
  onIndexEnd?: (event: {
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
    stages?: SourceStageRecord[]
    error?: string
  }) => void
  onCorpusSyncStart?: (event: {
    syncId: string
    corpusId: string
    namespace: string
    mode: 'replaceChanged' | 'appendOnly'
    stalePolicy: 'keep' | 'delete'
    sourceSet: 'partial' | 'complete'
    dryRun: boolean
    sourceCount: number
  }) => void
  onCorpusSource?: (event: {
    syncId: string
    corpusId: string
    namespace: string
    sourceId: string
    action: 'added' | 'changed' | 'unchanged' | 'skipped' | 'failed' | 'stale' | 'deleted'
    reason?: 'new' | 'contentChanged' | 'metadataChanged' | 'indexChanged' | 'appendOnly' | 'stale' | 'dryRun' | 'error'
    dryRun: boolean
    chunkCount?: number
    stages?: SourceStageRecord[]
    error?: { message: string; stack?: string }
  }) => void
  onCorpusSyncEnd?: (event: {
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
  }) => void
  onIngestParseStart?: (event: {
    ingestId: string
    parser: string
    format: string
    namespace: string
    sourceId: string
    byteLength: number
    contentType?: string
  }) => void
  onIngestParseEnd?: (event: {
    ingestId: string
    parser: string
    format: string
    namespace: string
    sourceId: string
    byteLength: number
    durationMs: number
    partCount: number
    warningCount: number
    contentType?: string
    error?: string
  }) => void
  onSemanticCacheLookupStart?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    scopeHash: string
    version: string
    threshold: number
  }) => void
  onSemanticCacheLookupEnd?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    scopeHash: string
    version: string
    durationMs: number
    hit: boolean
    score?: number
    error?: string
  }) => void
  onSemanticCacheHit?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    scopeHash: string
    version: string
    score: number
    ageMs: number
  }) => void
  onSemanticCacheMiss?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    scopeHash: string
    version: string
  }) => void
  onSemanticCacheWrite?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    scopeHash: string
    version: string
    ttl: number
    resultKind: 'text' | 'object'
  }) => void
  onSemanticCacheSkip?: (event: {
    cacheId: string
    promptId?: string
    operation: 'generate' | 'stream'
    reason: string
  }) => void
  onSemanticCacheReplayStart?: (event: {
    cacheId: string
    promptId?: string
    scopeHash: string
    version: string
  }) => void
  onSemanticCacheReplayEnd?: (event: {
    cacheId: string
    promptId?: string
    scopeHash: string
    version: string
    durationMs: number
  }) => void
  onMemoryRead?: (event: {
    memoryId: string
    operation: string
    query?: string
    resultCount: number
    durationMs: number
    results?: Array<{ key: string; preview: string; score?: number }>
    memoryType?: 'working' | 'episodic' | 'semantic' | 'block'
    blockId?: string
    blockKind?: 'recent' | 'working' | 'episodes' | 'facts' | 'procedures' | 'reflections' | 'custom'
    namespaceHash?: string
    spanId?: string
    runId?: string
    metadata?: Record<string, unknown>
    error?: string
    /** Full state/entries returned by the read. */
    snapshot?: unknown
    traceId?: string
  }) => void
  onMemoryWrite?: (event: {
    memoryId: string
    operation: string
    entryKey?: string
    content?: string
    memoryType?: 'working' | 'episodic' | 'semantic' | 'block'
    blockId?: string
    blockKind?: 'recent' | 'working' | 'episodes' | 'facts' | 'procedures' | 'reflections' | 'custom'
    namespaceHash?: string
    writeMode?: 'propose' | 'auto' | 'manual'
    proposalStatus?: 'pending' | 'approved' | 'rejected'
    spanId?: string
    runId?: string
    metadata?: Record<string, unknown>
    /** Full state after the write. */
    snapshot?: unknown
    traceId?: string
  }) => void
  onCompactStart?: (event: { reason: string; inputMessageCount: number; inputTokens: number }) => void
  onCompactEnd?: (event: {
    outputTokens: number
    compressionRatio: number
    summaryPreview?: string
    durationMs: number
  }) => void
  onBudgetCheck?: (event: {
    used: number
    available: number
    level: 'normal' | 'warning' | 'critical'
    breakdown?: Record<string, number>
  }) => void
  onCostReport?: (event: CostReportEvent) => void
  onCostWarn?: (event: CostBudgetEvent) => void
  onCostLimit?: (event: CostBudgetEvent) => void
  onBlackboardUpdate?: (event: { boardId: string; fieldsChanged: string[]; snapshot?: Record<string, unknown> }) => void
  onHandoffPrepare?: (event: {
    handoffId: string
    inputSize: number
    outputSize: number
    summary?: string
    fromAgent?: string
    toAgent?: string
    input?: unknown
    output?: unknown
    /** Span ID for this handoff boundary (see ExecutionContext.spanStack). */
    spanId?: string
  }) => void
  onJudgeResult?: (event: {
    metricId: string
    score: number
    reasoning?: string
    evalId?: string
    input?: string
    output?: string
  }) => void
  onDelegateStart?: (event: {
    delegateId: string
    handoffId: string
    inputSize: number
    input?: unknown
    /** Span ID for this delegate boundary (see ExecutionContext.spanStack). */
    spanId?: string
  }) => void
  onDelegateComplete?: (event: {
    delegateId: string
    handoffId: string
    inputSize: number
    outputSize: number
    durationMs: number
    output?: unknown
    /** Matches the spanId from the paired delegate:start. */
    spanId?: string
  }) => void
  onToolStart?: (event: {
    toolCallId: string
    toolName: string
    args: unknown
    traceId?: string
    /** Span ID for this tool boundary (see ExecutionContext.spanStack). */
    spanId?: string
  }) => void
  onToolEnd?: (event: {
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
    /** Matches the spanId from the paired tool:start. */
    spanId?: string
  }) => void
  onToolApprovalRequest?: (event: {
    approvalId: string
    toolCallId: string
    toolName: string
    input: unknown
    request?: {
      title?: string
      description?: string
      details?: unknown
    }
    traceId?: string
  }) => void
  onToolApprovalDecision?: (event: {
    approvalId: string
    toolCallId?: string
    toolName?: string
    approved: boolean
    reason?: string
    traceId?: string
  }) => void
  onSecurityWarning?: (event: {
    promptId: string | undefined
    field: string
    pattern: string
    message: string
    inputPreview: string
  }) => void
  onCompositionStart?: (event: {
    compositionId: string
    kind: 'parallel' | 'pipeline' | 'consensus' | 'swarm'
    agentIds: string[]
    startAgent?: string
    maxHandoffs?: number
  }) => void
  onCompositionAgent?: (event: {
    compositionId: string
    agentId: string
    index: number
    status: 'success' | 'error'
    durationMs: number
    error?: string
    handoffFrom?: string
    handoffReason?: string
    hopNumber?: number
  }) => void
  onCompositionEnd?: (event: {
    compositionId: string
    kind: 'parallel' | 'pipeline' | 'consensus' | 'swarm'
    status: 'success' | 'error'
    durationMs: number
    agentCount: number
    agreement?: number
    handoffPath?: string[]
    handoffCount?: number
    finalAgentId?: string
  }) => void
  onFlowStart?: (event: {
    flowId: string
    name: string
    parentFlowId?: string
    goal?: string
    input?: unknown
    startedAt: number
    /** Span ID for this runtime-flow boundary (see ExecutionContext.spanStack). */
    spanId?: string
  }) => void
  onFlowEnd?: (event: {
    flowId: string
    name: string
    status: 'success' | 'error' | 'cancelled' | 'expired'
    durationMs: number
    totalSteps: number
    error?: string
    /** Matches the spanId from the paired onFlowStart. */
    spanId?: string
  }) => void
  onStepStart?: (event: {
    flowId: string
    stepId: string
    label: string
    source?: { file: string; line: number; column?: number; function?: string }
  }) => void
  onStepEnd?: (event: {
    flowId: string
    stepId: string
    label: string
    status: 'success' | 'error'
    durationMs: number
    error?: string
  }) => void
  onFlowSuspend?: (event: { flowId: string; name: string; suspendPoint: string; timestamp: number }) => void
  onFlowResume?: (event: { flowId: string; name: string; timestamp: number }) => void
  onFlowSignal?: (event: { flowId: string; signalName: string; payload: unknown; timestamp: number }) => void
  onFlowCancel?: (event: { flowId: string; name: string; reason?: string; timestamp: number }) => void
  onFlowExpired?: (event: { flowId: string; name: string; suspendPoint: string; timestamp: number }) => void
  onPlanCreated?: (event: { planId: string; title: string; contentPreview: string; traceId?: string }) => void
  onPlanUpdated?: (event: { planId: string; version: number; changes: string[]; traceId?: string }) => void
  onTaskListCreated?: (event: { taskListId: string; planId?: string; traceId?: string }) => void
  onTaskListCompleted?: (event: {
    taskListId: string
    totalTasks: number
    durationMs: number
    traceId?: string
  }) => void
  onTaskListDiscarded?: (event: {
    taskListId: string
    reason?: string
    completedCount: number
    remainingCount: number
    traceId?: string
  }) => void
  onTaskAdded?: (event: {
    taskListId: string
    taskId: string
    label: string
    assignee?: { agent?: string; model?: string }
    traceId?: string
  }) => void
  onTaskUpdated?: (event: {
    taskListId: string
    taskId: string
    status: string
    progress?: string
    durationMs?: number
    traceId?: string
  }) => void
  onTaskRemoved?: (event: { taskListId: string; taskId: string; traceId?: string }) => void
  onContextCacheHit?: (event: { contextId: string; cacheKey: string; ageMs: number; traceId?: string }) => void
  onContextCacheMiss?: (event: { contextId: string; cacheKey: string; resolutionMs: number; traceId?: string }) => void

  // ── Skill hooks ──
  /** Fired when a skill's full content is loaded via LoadSkill. */
  onSkillLoad?: (event: { skillId: string; source: 'file' | 'registry' | 'inline'; traceId?: string }) => void
  /** Fired when a registry skill is served from cache. */
  onSkillCacheHit?: (event: { skillId: string; traceId?: string }) => void
  /** Fired when a registry skill must be freshly fetched. */
  onSkillCacheMiss?: (event: { skillId: string; traceId?: string }) => void
  /** Fired after a skill's content is injected into the system prompt via re-resolution. */
  onSkillResolve?: (event: { skillId: string; traceId?: string }) => void

  // ── Validation retry hooks ──
  /** Fired on each validation retry attempt for structured output. */
  onValidationRetryAttempt?: (event: {
    retryId: string
    attemptNumber: number
    maxAttempts: number
    error: string
    rawOutput: string
    repairAttempted: boolean
    repairSucceeded: boolean
    traceId?: string
  }) => void
  /** Fired when all validation retries are exhausted. */
  onValidationRetryExhausted?: (event: {
    retryId: string
    totalAttempts: number
    lastError: string
    promptId: string
    traceId?: string
  }) => void

  // ── Routing hooks ──
  /** Fired when a router selects a model based on classification. */
  onRouterSelect?: (event: {
    classifiedAs: string
    selectedModel: string
    availableRoutes: string[]
    hints?: Record<string, unknown>
    overridden: boolean
    traceId?: string
  }) => void
  /** Fired for each cascade tier attempt. */
  onCascadeTier?: (event: {
    tierIndex: number
    model: string
    status: 'accepted' | 'rejected' | 'skipped'
    durationMs: number
    cost?: number
    traceId?: string
  }) => void
  /** Fired when a cascade completes. */
  onCascadeComplete?: (event: {
    acceptedTier: number
    totalTiers: number
    totalCost: number
    totalDurationMs: number
    budgetExceeded: boolean
    traceId?: string
  }) => void
  /** Fired when a cascade budget constraint is hit. */
  onBudgetExceeded?: (event: {
    budgetType: 'cost' | 'latency'
    limit: number
    actual: number
    traceId?: string
  }) => void

  // ── Guardrail hooks ──
  /** Fired when a guardrail check completes. */
  onGuardrailRun?: (event: {
    guardrailId: string
    phase: 'input' | 'output'
    action: 'pass' | 'block' | 'redact' | 'transform' | 'warn'
    reason?: string
    durationMs: number
    traceId?: string
  }) => void

  // ── Constraint hooks ──
  /** Fired when a single constraint check completes. */
  onConstraintCheck?: (event: {
    constraintName: string
    severity: 'assert' | 'suggest'
    pass: boolean
    feedback?: string
    durationMs: number
    attempt: number
    traceId?: string
  }) => void
  /** Fired when constraints trigger a combined retry. */
  onConstraintRetry?: (event: {
    constraintNames: string[]
    attempt: number
    combinedFeedback: string
    traceId?: string
  }) => void
  /** Fired when assert constraints are violated (retries exhausted). */
  onConstraintViolation?: (event: { constraintNames: string[]; totalAttempts: number; traceId?: string }) => void
}
