/**
 * OTel instrumentation hooks for Crux events.
 *
 * Maps Crux InstrumentationHooks to span creation/end via the SpanManager.
 *
 * @module
 */

import type { InstrumentationHooks } from '@crux/core'
import type { SpanManager, SpanRef } from './span-manager'
import type { TelemetryOptions } from './plugin'
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  CRUX_PROMPT_ID,
  CRUX_COST,
  CRUX_COST_SOURCE,
  CRUX_COST_THRESHOLD,
  CRUX_COST_TOTAL,
  CRUX_TOOL_NAME,
  CRUX_TOOL_CALL_ID,
  CRUX_TOOL_APPROVAL_ID,
  CRUX_TOOL_APPROVAL_APPROVED,
  CRUX_TOOL_ESTIMATED,
  CRUX_TOOL_MODEL_OUTPUT_TYPE,
  CRUX_TOOL_OUTPUT_SIZE,
  CRUX_TOOL_MODEL_OUTPUT_SIZE,
  CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE,
  CRUX_EMBEDDING_NAME,
  CRUX_EMBEDDING_KIND,
  CRUX_EMBEDDING_OPERATION,
  CRUX_EMBEDDING_DIMENSIONS,
  CRUX_EMBEDDING_INPUT_COUNT,
  CRUX_EMBEDDING_CHUNK_COUNT,
  CRUX_EMBEDDING_CACHE_HIT_COUNT,
  CRUX_EMBEDDING_CACHE_MISS_COUNT,
  CRUX_EMBEDDING_RETRY_COUNT,
  CRUX_EMBEDDING_TRUNCATED_COUNT,
  CRUX_EMBEDDING_RATE_LIMIT_WAIT_MS,
  CRUX_RETRIEVER_ID,
  CRUX_RETRIEVAL_NAMESPACE,
  CRUX_RETRIEVAL_MODE,
  CRUX_RETRIEVAL_LIMIT,
  CRUX_RETRIEVAL_RESULT_COUNT,
  CRUX_RETRIEVAL_FUSION,
  CRUX_RETRIEVAL_PIPELINE_ID,
  CRUX_RETRIEVAL_STAGE_NAME,
  CRUX_RETRIEVAL_STAGE_KIND,
  CRUX_RETRIEVAL_STAGE_PHASE,
  CRUX_RETRIEVAL_STAGE_INPUT_QUERY_COUNT,
  CRUX_RETRIEVAL_STAGE_OUTPUT_QUERY_COUNT,
  CRUX_RETRIEVAL_STAGE_INPUT_HIT_COUNT,
  CRUX_RETRIEVAL_STAGE_OUTPUT_HIT_COUNT,
  CRUX_RETRIEVAL_STAGE_WARNING_COUNT,
  CRUX_WORKSPACE_ID,
  CRUX_WORKSPACE_OPERATION,
  CRUX_WORKSPACE_MOUNT,
  CRUX_WORKSPACE_MIME_TYPE,
  CRUX_WORKSPACE_SIZE,
  CRUX_WORKSPACE_PATH_HASH,
  CRUX_WORKSPACE_STATUS,
  CRUX_INDEXER_ID,
  CRUX_INDEX_NAMESPACE,
  CRUX_INDEX_OPERATION,
  CRUX_INDEX_SOURCE_COUNT,
  CRUX_INDEX_CHUNK_COUNT,
  CRUX_INDEX_DELETED_COUNT,
  CRUX_INDEX_STAGE_COUNT,
  CRUX_INDEX_STAGE_CACHE_HIT_COUNT,
  CRUX_CORPUS_ID,
  CRUX_CORPUS_NAMESPACE_HASH,
  CRUX_CORPUS_MODE,
  CRUX_CORPUS_STALE_POLICY,
  CRUX_CORPUS_SOURCE_SET,
  CRUX_CORPUS_DRY_RUN,
  CRUX_CORPUS_SOURCE_ID_HASH,
  CRUX_CORPUS_ACTION,
  CRUX_CORPUS_REASON,
  CRUX_CORPUS_CHUNK_COUNT,
  CRUX_CORPUS_SOURCE_COUNT,
  CRUX_CORPUS_ADDED_COUNT,
  CRUX_CORPUS_CHANGED_COUNT,
  CRUX_CORPUS_UNCHANGED_COUNT,
  CRUX_CORPUS_STALE_COUNT,
  CRUX_CORPUS_SKIPPED_COUNT,
  CRUX_CORPUS_DELETED_COUNT,
  CRUX_CORPUS_FAILED_COUNT,
  CRUX_INGEST_PARSER,
  CRUX_INGEST_FORMAT,
  CRUX_INGEST_NAMESPACE_HASH,
  CRUX_INGEST_SOURCE_ID_HASH,
  CRUX_INGEST_BYTE_LENGTH,
  CRUX_INGEST_PART_COUNT,
  CRUX_INGEST_WARNING_COUNT,
  CRUX_FLOW_ID,
  CRUX_FLOW_NAME,
  CRUX_FLOW_PARENT_ID,
  CRUX_STEP_ID,
  CRUX_STEP_LABEL,
  CRUX_COMPOSITION_ID,
  CRUX_COMPOSITION_KIND,
  CRUX_COMPOSITION_AGENT_COUNT,
  CRUX_COMPOSITION_HANDOFF_COUNT,
  CRUX_COMPOSITION_AGREEMENT,
  CRUX_MEMORY_TYPE,
  CRUX_MEMORY_OPERATION,
  CRUX_MEMORY_BLOCK_ID,
  CRUX_MEMORY_BLOCK_KIND,
  CRUX_MEMORY_NAMESPACE_HASH,
  CRUX_MEMORY_WRITE_MODE,
  CRUX_MEMORY_PROPOSAL_STATUS,
  CRUX_COMPACTION_RATIO,
  CRUX_JUDGE_METRIC,
  CRUX_JUDGE_SCORE,
  CRUX_PLAN_ID,
  CRUX_PLAN_VERSION,
  CRUX_TASKLIST_ID,
  CRUX_TASK_ID,
  CRUX_TASK_STATUS,
  CRUX_CONTEXT_CACHE_STATUS,
  CRUX_CONTEXT_ID,
  CRUX_CONTEXT_CACHE_AGE_MS,
  CRUX_SEMANTIC_CACHE_VERSION,
  CRUX_SEMANTIC_CACHE_OPERATION,
  CRUX_SEMANTIC_CACHE_STATUS,
  CRUX_SEMANTIC_CACHE_THRESHOLD,
  CRUX_SEMANTIC_CACHE_SCORE,
  CRUX_SEMANTIC_CACHE_AGE_MS,
  CRUX_SEMANTIC_CACHE_TTL_MS,
  CRUX_SKILL_ID,
  CRUX_SKILL_SOURCE,
  CRUX_SKILL_CACHE_STATUS,
  CRUX_ROUTER_CLASSIFIED_AS,
  CRUX_ROUTER_SELECTED_MODEL,
  CRUX_ROUTER_OVERRIDDEN,
  CRUX_CASCADE_TIER_INDEX,
  CRUX_CASCADE_TIER_MODEL,
  CRUX_CASCADE_TIER_STATUS,
  CRUX_CASCADE_TOTAL_TIERS,
  CRUX_CASCADE_ACCEPTED_TIER,
  CRUX_CASCADE_BUDGET_EXCEEDED,
  CRUX_CONSTRAINT_NAME,
  CRUX_CONSTRAINT_SEVERITY,
  CRUX_CONSTRAINT_PASS,
  CRUX_CONSTRAINT_ATTEMPT,
} from './attributes'

type OtelAttributes = Record<string, string | number | boolean>

function hashValue(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Create instrumentation hooks that produce OTel spans.
 *
 * @param spanManager - Manages span lifecycle.
 * @param options - Telemetry configuration.
 * @returns Partial `InstrumentationHooks` with tool tracking.
 */
export function createOtelInstrumentationHooks(
  spanManager: SpanManager,
  options: TelemetryOptions,
): InstrumentationHooks {
  // Track open spans by ID
  const activeToolSpans = new Map<string, SpanRef>()
  const activeEmbeddingSpans = new Map<string, SpanRef>()
  const activeRetrievalSpans = new Map<string, SpanRef>()
  const activeRetrievalStageSpans = new Map<string, SpanRef>()
  const activeIndexSpans = new Map<string, SpanRef>()
  const activeCorpusSyncSpans = new Map<string, SpanRef>()
  const activeIngestSpans = new Map<string, SpanRef>()
  const activeFlowSpans = new Map<string, SpanRef>()
  const activeStepSpans = new Map<string, SpanRef>()
  const activeCompositionSpans = new Map<string, SpanRef>()
  const activeDelegateSpans = new Map<string, SpanRef>()
  const activeSemanticCacheLookupSpans = new Map<string, SpanRef>()
  let activeCompactSpan: SpanRef | undefined
  const activeValidationRetrySpans = new Map<string, SpanRef>()

  function emitCostSpan(
    kind: 'report' | 'warn' | 'limit',
    traceId: string | undefined,
    attributes: Record<string, string | number | boolean>,
  ): void {
    const ref = spanManager.startSpan(`crux.cost.${kind}`, {
      ...attributes,
      ...(traceId ? { 'crux.trace.id': traceId } : {}),
    })
    spanManager.endSpan(ref)
  }

  return {
    onCostReport(event) {
      emitCostSpan('report', event.entry.traceId, {
        [CRUX_COST]: event.entry.cost,
        [CRUX_COST_TOTAL]: event.report.total.cost,
        [CRUX_COST_SOURCE]: event.entry.source,
        ...(event.entry.model ? { 'gen_ai.request.model': event.entry.model } : {}),
        ...(event.entry.provider ? { 'gen_ai.system': event.entry.provider } : {}),
        ...(event.entry.promptId ? { 'crux.prompt.id': event.entry.promptId } : {}),
        ...(event.entry.sessionId ? { 'crux.session.id': event.entry.sessionId } : {}),
        ...(event.entry.flowId ? { [CRUX_FLOW_ID]: event.entry.flowId } : {}),
        ...(event.entry.stepId ? { [CRUX_STEP_ID]: event.entry.stepId } : {}),
        ...(event.entry.inputTokens ? { [GEN_AI_USAGE_INPUT_TOKENS]: event.entry.inputTokens } : {}),
      })
    },

    onCostWarn(event) {
      emitCostSpan('warn', event.entry.traceId, {
        [CRUX_COST]: event.entry.cost,
        [CRUX_COST_TOTAL]: event.actual,
        [CRUX_COST_THRESHOLD]: event.threshold,
        [CRUX_COST_SOURCE]: event.entry.source,
      })
    },

    onCostLimit(event) {
      emitCostSpan('limit', event.entry.traceId, {
        [CRUX_COST]: event.entry.cost,
        [CRUX_COST_TOTAL]: event.actual,
        [CRUX_COST_THRESHOLD]: event.threshold,
        [CRUX_COST_SOURCE]: event.entry.source,
      })
    },

    onFlowStart(event) {
      const ref = spanManager.startSpan('crux.flow', {
        [CRUX_FLOW_ID]: event.flowId,
        [CRUX_FLOW_NAME]: event.name,
        ...(event.parentFlowId ? { [CRUX_FLOW_PARENT_ID]: event.parentFlowId } : {}),
        'crux.flow.started_at': event.startedAt,
      })
      activeFlowSpans.set(event.flowId, ref)
    },

    onFlowEnd(event) {
      const ref = activeFlowSpans.get(event.flowId)
      if (!ref) return
      activeFlowSpans.delete(event.flowId)

      if ((event.status === 'error' || event.status === 'cancelled' || event.status === 'expired') && event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onStepStart(event) {
      const ref = spanManager.startSpan('crux.flow.step', {
        [CRUX_FLOW_ID]: event.flowId,
        [CRUX_STEP_ID]: event.stepId,
        [CRUX_STEP_LABEL]: event.label,
        ...(event.source
          ? {
              'code.filepath': event.source.file,
              'code.lineno': event.source.line,
              ...(event.source.column != null ? { 'code.column': event.source.column } : {}),
              ...(event.source.function ? { 'code.function': event.source.function } : {}),
            }
          : {}),
      })
      activeStepSpans.set(event.stepId, ref)
    },

    onStepEnd(event) {
      const ref = activeStepSpans.get(event.stepId)
      if (!ref) return
      activeStepSpans.delete(event.stepId)

      if (event.status === 'error' && event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onFlowSuspend(event) {
      const ref = activeFlowSpans.get(event.flowId)
      if (!ref) return
      // Add suspend event and end the span — the process may terminate
      spanManager.addEvent(ref, 'crux.flow.suspended', {
        'crux.flow.suspend_point': event.suspendPoint,
      })
      spanManager.endSpan(ref)
      activeFlowSpans.delete(event.flowId)
    },

    onFlowResume(event) {
      // Start a fresh span for the resumed execution — correlate via flowId
      const ref = spanManager.startSpan('crux.flow.resume', {
        [CRUX_FLOW_ID]: event.flowId,
        [CRUX_FLOW_NAME]: event.name,
      })
      activeFlowSpans.set(event.flowId, ref)
    },

    onFlowSignal(event) {
      const ref = activeFlowSpans.get(event.flowId)
      if (!ref) return
      spanManager.addEvent(ref, 'crux.flow.signal', {
        'crux.flow.signal_name': event.signalName,
      })
    },

    onFlowCancel(event) {
      const ref = activeFlowSpans.get(event.flowId)
      if (!ref) return
      spanManager.addEvent(ref, 'crux.flow.cancelled', {
        ...(event.reason ? { 'crux.flow.cancel_reason': event.reason } : {}),
      })
      // onFlowEnd will handle ending the span
    },

    onFlowExpired(event) {
      const ref = activeFlowSpans.get(event.flowId)
      if (!ref) return
      spanManager.addEvent(ref, 'crux.flow.expired', {
        'crux.flow.suspend_point': event.suspendPoint,
      })
      // onFlowEnd will handle ending the span
    },

    onCompositionStart(event) {
      const ref = spanManager.startSpan(`crux.composition.${event.kind}`, {
        [CRUX_COMPOSITION_ID]: event.compositionId,
        [CRUX_COMPOSITION_KIND]: event.kind,
      })
      activeCompositionSpans.set(event.compositionId, ref)
    },

    onCompositionAgent(event) {
      // Agent spans are start+end in one event (durationMs provided)
      const ref = spanManager.startSpan(`crux.composition.agent.${event.agentId}`, {
        [CRUX_COMPOSITION_ID]: event.compositionId,
      })

      if (event.status === 'error' && event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onCompositionEnd(event) {
      const ref = activeCompositionSpans.get(event.compositionId)
      if (!ref) return
      activeCompositionSpans.delete(event.compositionId)

      const endAttrs: Record<string, string | number | boolean> = {
        [CRUX_COMPOSITION_AGENT_COUNT]: event.agentCount,
      }

      if (event.handoffCount != null) {
        endAttrs[CRUX_COMPOSITION_HANDOFF_COUNT] = event.handoffCount
      }
      if (event.agreement != null) {
        endAttrs[CRUX_COMPOSITION_AGREEMENT] = event.agreement
      }

      spanManager.setAttributes(ref, endAttrs)

      if (event.status === 'error') {
        spanManager.setStatus(ref, { code: 'ERROR' })
      }

      spanManager.endSpan(ref)
    },

    onToolStart(event) {
      const ref = spanManager.startSpan(`crux.tool.${event.toolName}`, {
        [CRUX_TOOL_NAME]: event.toolName,
        [CRUX_TOOL_CALL_ID]: event.toolCallId,
      })
      activeToolSpans.set(event.toolCallId, ref)
    },

    onToolApprovalRequest(event) {
      const ref = spanManager.startSpan('crux.tool.approval.request', {
        [CRUX_TOOL_NAME]: event.toolName,
        [CRUX_TOOL_CALL_ID]: event.toolCallId,
        [CRUX_TOOL_APPROVAL_ID]: event.approvalId,
      })
      spanManager.endSpan(ref)
    },

    onToolApprovalDecision(event) {
      const ref = spanManager.startSpan('crux.tool.approval.decision', {
        [CRUX_TOOL_APPROVAL_ID]: event.approvalId,
        [CRUX_TOOL_APPROVAL_APPROVED]: event.approved,
        ...(event.toolName ? { [CRUX_TOOL_NAME]: event.toolName } : {}),
        ...(event.toolCallId ? { [CRUX_TOOL_CALL_ID]: event.toolCallId } : {}),
      })
      spanManager.endSpan(ref)
    },

    onEmbedStart(event) {
      const ref = spanManager.startSpan('crux.embedding', {
        [CRUX_EMBEDDING_NAME]: event.name,
        [CRUX_EMBEDDING_KIND]: event.kind,
        [CRUX_EMBEDDING_OPERATION]: event.operation,
        [CRUX_EMBEDDING_INPUT_COUNT]: event.inputCount,
        [CRUX_EMBEDDING_CHUNK_COUNT]: event.chunkCount,
        ...(event.dimensions != null ? { [CRUX_EMBEDDING_DIMENSIONS]: event.dimensions } : {}),
      })
      activeEmbeddingSpans.set(event.embedId, ref)
    },

    onEmbedEnd(event) {
      const ref = activeEmbeddingSpans.get(event.embedId)
      if (!ref) return

      activeEmbeddingSpans.delete(event.embedId)

      const attrs: Record<string, string | number | boolean> = {
        [CRUX_EMBEDDING_NAME]: event.name,
        [CRUX_EMBEDDING_KIND]: event.kind,
        [CRUX_EMBEDDING_OPERATION]: event.operation,
        [CRUX_EMBEDDING_INPUT_COUNT]: event.inputCount,
        [CRUX_EMBEDDING_CHUNK_COUNT]: event.chunkCount,
      }
      if (event.dimensions != null) {
        attrs[CRUX_EMBEDDING_DIMENSIONS] = event.dimensions
      }
      if (event.usage?.inputTokens != null) {
        attrs[GEN_AI_USAGE_INPUT_TOKENS] = event.usage.inputTokens
      }
      if (event.cost != null) {
        attrs[CRUX_COST] = event.cost
      }
      if (event.cacheHitCount != null) {
        attrs[CRUX_EMBEDDING_CACHE_HIT_COUNT] = event.cacheHitCount
      }
      if (event.cacheMissCount != null) {
        attrs[CRUX_EMBEDDING_CACHE_MISS_COUNT] = event.cacheMissCount
      }
      if (event.retryCount != null) {
        attrs[CRUX_EMBEDDING_RETRY_COUNT] = event.retryCount
      }
      if (event.truncatedCount != null) {
        attrs[CRUX_EMBEDDING_TRUNCATED_COUNT] = event.truncatedCount
      }
      if (event.rateLimitWaitMs != null) {
        attrs[CRUX_EMBEDDING_RATE_LIMIT_WAIT_MS] = event.rateLimitWaitMs
      }
      spanManager.setAttributes(ref, attrs)

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onRetrievalStart(event) {
      const ref = spanManager.startSpan('crux.retrieval', {
        [CRUX_RETRIEVER_ID]: event.retrieverId,
        [CRUX_RETRIEVAL_NAMESPACE]: event.namespace,
        [CRUX_RETRIEVAL_MODE]: event.mode,
        ...(event.limit != null ? { [CRUX_RETRIEVAL_LIMIT]: event.limit } : {}),
        ...(event.fusion ? { [CRUX_RETRIEVAL_FUSION]: event.fusion } : {}),
      })
      activeRetrievalSpans.set(event.retrievalId, ref)
    },

    onRetrievalEnd(event) {
      const ref = activeRetrievalSpans.get(event.retrievalId)
      if (!ref) return

      activeRetrievalSpans.delete(event.retrievalId)

      spanManager.setAttributes(ref, {
        [CRUX_RETRIEVER_ID]: event.retrieverId,
        [CRUX_RETRIEVAL_NAMESPACE]: event.namespace,
        [CRUX_RETRIEVAL_MODE]: event.mode,
        [CRUX_RETRIEVAL_RESULT_COUNT]: event.resultCount,
        ...(event.limit != null ? { [CRUX_RETRIEVAL_LIMIT]: event.limit } : {}),
        ...(event.fusion ? { [CRUX_RETRIEVAL_FUSION]: event.fusion } : {}),
      })

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onRetrievalStageStart(event) {
      const spanKey = `${event.retrievalId}:${event.stageName}`
      const ref = spanManager.startSpan('crux.retrieval.stage', {
        [CRUX_RETRIEVER_ID]: event.retrieverId,
        [CRUX_RETRIEVAL_PIPELINE_ID]: event.pipelineId,
        [CRUX_RETRIEVAL_STAGE_NAME]: event.stageName,
        [CRUX_RETRIEVAL_STAGE_KIND]: event.stageKind,
        [CRUX_RETRIEVAL_STAGE_PHASE]: event.phase,
        ...(event.inputQueryCount != null ? { [CRUX_RETRIEVAL_STAGE_INPUT_QUERY_COUNT]: event.inputQueryCount } : {}),
        ...(event.inputHitCount != null ? { [CRUX_RETRIEVAL_STAGE_INPUT_HIT_COUNT]: event.inputHitCount } : {}),
      })
      activeRetrievalStageSpans.set(spanKey, ref)
    },

    onRetrievalStageEnd(event) {
      const spanKey = `${event.retrievalId}:${event.stageName}`
      const ref = activeRetrievalStageSpans.get(spanKey)
      if (!ref) return

      activeRetrievalStageSpans.delete(spanKey)
      spanManager.setAttributes(ref, {
        [CRUX_RETRIEVER_ID]: event.retrieverId,
        [CRUX_RETRIEVAL_PIPELINE_ID]: event.pipelineId,
        [CRUX_RETRIEVAL_STAGE_NAME]: event.stageName,
        [CRUX_RETRIEVAL_STAGE_KIND]: event.stageKind,
        [CRUX_RETRIEVAL_STAGE_PHASE]: event.phase,
        ...(event.inputQueryCount != null ? { [CRUX_RETRIEVAL_STAGE_INPUT_QUERY_COUNT]: event.inputQueryCount } : {}),
        ...(event.outputQueryCount != null ? { [CRUX_RETRIEVAL_STAGE_OUTPUT_QUERY_COUNT]: event.outputQueryCount } : {}),
        ...(event.inputHitCount != null ? { [CRUX_RETRIEVAL_STAGE_INPUT_HIT_COUNT]: event.inputHitCount } : {}),
        ...(event.outputHitCount != null ? { [CRUX_RETRIEVAL_STAGE_OUTPUT_HIT_COUNT]: event.outputHitCount } : {}),
        ...(event.warningCount != null ? { [CRUX_RETRIEVAL_STAGE_WARNING_COUNT]: event.warningCount } : {}),
      })

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onWorkspaceOperation(event) {
      const ref = spanManager.startSpan(`crux.workspace.${event.operation}`, {
        [CRUX_WORKSPACE_ID]: event.workspaceId,
        [CRUX_WORKSPACE_OPERATION]: event.operation,
        [CRUX_WORKSPACE_STATUS]: event.status,
        [CRUX_WORKSPACE_PATH_HASH]: hashValue(event.path),
        ...(event.mount ? { [CRUX_WORKSPACE_MOUNT]: event.mount } : {}),
        ...(event.mimeType ? { [CRUX_WORKSPACE_MIME_TYPE]: event.mimeType } : {}),
        ...(event.size != null ? { [CRUX_WORKSPACE_SIZE]: event.size } : {}),
      })
      if (event.error) {
        spanManager.recordError(ref, event.error)
      }
      spanManager.endSpan(ref)
    },

    onIndexStart(event) {
      const ref = spanManager.startSpan('crux.indexing', {
        [CRUX_INDEXER_ID]: event.indexerId,
        [CRUX_INDEX_NAMESPACE]: event.namespace,
        [CRUX_INDEX_OPERATION]: event.operation,
        [CRUX_INDEX_SOURCE_COUNT]: event.sourceCount,
        [CRUX_INDEX_CHUNK_COUNT]: event.chunkCount,
      })
      activeIndexSpans.set(event.indexId, ref)
    },

    onIndexEnd(event) {
      const ref = activeIndexSpans.get(event.indexId)
      if (!ref) return

      activeIndexSpans.delete(event.indexId)

      spanManager.setAttributes(ref, {
        [CRUX_INDEXER_ID]: event.indexerId,
        [CRUX_INDEX_NAMESPACE]: event.namespace,
        [CRUX_INDEX_OPERATION]: event.operation,
        [CRUX_INDEX_SOURCE_COUNT]: event.sourceCount,
        [CRUX_INDEX_CHUNK_COUNT]: event.chunkCount,
        ...(event.deletedCount != null ? { [CRUX_INDEX_DELETED_COUNT]: event.deletedCount } : {}),
        ...(event.stages ? { [CRUX_INDEX_STAGE_COUNT]: event.stages.length } : {}),
        ...(event.stages
          ? { [CRUX_INDEX_STAGE_CACHE_HIT_COUNT]: event.stages.filter((stage) => stage.cache === 'hit').length }
          : {}),
      })

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onCorpusSyncStart(event) {
      const ref = spanManager.startSpan('crux.corpus.sync', {
        [CRUX_CORPUS_ID]: event.corpusId,
        [CRUX_CORPUS_NAMESPACE_HASH]: hashValue(event.namespace),
        [CRUX_CORPUS_MODE]: event.mode,
        [CRUX_CORPUS_STALE_POLICY]: event.stalePolicy,
        [CRUX_CORPUS_SOURCE_SET]: event.sourceSet,
        [CRUX_CORPUS_DRY_RUN]: event.dryRun,
        [CRUX_CORPUS_SOURCE_COUNT]: event.sourceCount,
      })
      activeCorpusSyncSpans.set(event.syncId, ref)
    },

    onCorpusSource(event) {
      const ref = spanManager.startSpan('crux.corpus.source', {
        [CRUX_CORPUS_ID]: event.corpusId,
        [CRUX_CORPUS_NAMESPACE_HASH]: hashValue(event.namespace),
        [CRUX_CORPUS_SOURCE_ID_HASH]: hashValue(event.sourceId),
        [CRUX_CORPUS_ACTION]: event.action,
        [CRUX_CORPUS_DRY_RUN]: event.dryRun,
        ...(event.reason ? { [CRUX_CORPUS_REASON]: event.reason } : {}),
        ...(event.chunkCount != null ? { [CRUX_CORPUS_CHUNK_COUNT]: event.chunkCount } : {}),
        ...(event.stages ? { [CRUX_INDEX_STAGE_COUNT]: event.stages.length } : {}),
        ...(event.stages
          ? { [CRUX_INDEX_STAGE_CACHE_HIT_COUNT]: event.stages.filter((stage) => stage.cache === 'hit').length }
          : {}),
      })

      if (event.error) {
        spanManager.recordError(ref, event.error.message)
      }

      spanManager.endSpan(ref)
    },

    onCorpusSyncEnd(event) {
      const ref = activeCorpusSyncSpans.get(event.syncId)
      if (!ref) return

      activeCorpusSyncSpans.delete(event.syncId)

      spanManager.setAttributes(ref, {
        [CRUX_CORPUS_ID]: event.corpusId,
        [CRUX_CORPUS_NAMESPACE_HASH]: hashValue(event.namespace),
        [CRUX_CORPUS_MODE]: event.mode,
        [CRUX_CORPUS_STALE_POLICY]: event.stalePolicy,
        [CRUX_CORPUS_SOURCE_SET]: event.sourceSet,
        [CRUX_CORPUS_DRY_RUN]: event.dryRun,
        [CRUX_CORPUS_ADDED_COUNT]: event.added,
        [CRUX_CORPUS_CHANGED_COUNT]: event.changed,
        [CRUX_CORPUS_UNCHANGED_COUNT]: event.unchanged,
        [CRUX_CORPUS_STALE_COUNT]: event.stale,
        [CRUX_CORPUS_SKIPPED_COUNT]: event.skipped,
        [CRUX_CORPUS_DELETED_COUNT]: event.deleted,
        [CRUX_CORPUS_FAILED_COUNT]: event.failed,
        [CRUX_CORPUS_CHUNK_COUNT]: event.chunkCount,
      })

      if (event.failed > 0) {
        spanManager.setStatus(ref, { code: 'ERROR', message: `${event.failed} corpus source(s) failed` })
      }

      spanManager.endSpan(ref)
    },

    onIngestParseStart(event) {
      const ref = spanManager.startSpan('crux.ingest.parse', {
        [CRUX_INGEST_PARSER]: event.parser,
        [CRUX_INGEST_FORMAT]: event.format,
        [CRUX_INGEST_NAMESPACE_HASH]: hashValue(event.namespace),
        [CRUX_INGEST_SOURCE_ID_HASH]: hashValue(event.sourceId),
        [CRUX_INGEST_BYTE_LENGTH]: event.byteLength,
      })
      activeIngestSpans.set(event.ingestId, ref)
    },

    onIngestParseEnd(event) {
      const ref = activeIngestSpans.get(event.ingestId)
      if (!ref) return

      activeIngestSpans.delete(event.ingestId)

      spanManager.setAttributes(ref, {
        [CRUX_INGEST_PARSER]: event.parser,
        [CRUX_INGEST_FORMAT]: event.format,
        [CRUX_INGEST_NAMESPACE_HASH]: hashValue(event.namespace),
        [CRUX_INGEST_SOURCE_ID_HASH]: hashValue(event.sourceId),
        [CRUX_INGEST_BYTE_LENGTH]: event.byteLength,
        [CRUX_INGEST_PART_COUNT]: event.partCount,
        [CRUX_INGEST_WARNING_COUNT]: event.warningCount,
      })

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      spanManager.endSpan(ref)
    },

    onToolEnd(event) {
      const ref = activeToolSpans.get(event.toolCallId)
      if (!ref) return

      activeToolSpans.delete(event.toolCallId)

      if (event.error) {
        spanManager.recordError(ref, event.error)
      }

      if (event.estimated) {
        spanManager.setAttributes(ref, { [CRUX_TOOL_ESTIMATED]: true })
      }

      spanManager.setAttributes(ref, {
        ...(event.modelOutputType ? { [CRUX_TOOL_MODEL_OUTPUT_TYPE]: event.modelOutputType } : {}),
        ...(event.outputSize != null ? { [CRUX_TOOL_OUTPUT_SIZE]: event.outputSize } : {}),
        ...(event.modelOutputSize != null ? { [CRUX_TOOL_MODEL_OUTPUT_SIZE]: event.modelOutputSize } : {}),
        ...(event.tokenSavingsEstimate != null
          ? { [CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE]: event.tokenSavingsEstimate }
          : {}),
      })

      spanManager.endSpan(ref)
    },

    // ── Memory ──────────────────────────────────────────────

    onMemoryRead(event) {
      const ref = spanManager.startSpan('crux.memory.read', {
        [CRUX_MEMORY_OPERATION]: event.operation,
        ...(event.memoryType ? { [CRUX_MEMORY_TYPE]: event.memoryType } : {}),
        ...(event.blockId ? { [CRUX_MEMORY_BLOCK_ID]: event.blockId } : {}),
        ...(event.blockKind ? { [CRUX_MEMORY_BLOCK_KIND]: event.blockKind } : {}),
        ...(event.namespaceHash ? { [CRUX_MEMORY_NAMESPACE_HASH]: event.namespaceHash } : {}),
      })
      spanManager.endSpan(ref)
    },

    onMemoryWrite(event) {
      const ref = spanManager.startSpan('crux.memory.write', {
        [CRUX_MEMORY_OPERATION]: event.operation,
        ...(event.memoryType ? { [CRUX_MEMORY_TYPE]: event.memoryType } : {}),
        ...(event.blockId ? { [CRUX_MEMORY_BLOCK_ID]: event.blockId } : {}),
        ...(event.blockKind ? { [CRUX_MEMORY_BLOCK_KIND]: event.blockKind } : {}),
        ...(event.namespaceHash ? { [CRUX_MEMORY_NAMESPACE_HASH]: event.namespaceHash } : {}),
        ...(event.writeMode ? { [CRUX_MEMORY_WRITE_MODE]: event.writeMode } : {}),
        ...(event.proposalStatus ? { [CRUX_MEMORY_PROPOSAL_STATUS]: event.proposalStatus } : {}),
      })
      spanManager.endSpan(ref)
    },

    // ── Compaction ──────────────────────────────────────────

    onCompactStart(event) {
      activeCompactSpan = spanManager.startSpan('crux.compact', {
        'crux.compaction.reason': event.reason,
      })
    },

    onCompactEnd(event) {
      if (!activeCompactSpan) return
      const ref = activeCompactSpan
      activeCompactSpan = undefined

      spanManager.setAttributes(ref, {
        [CRUX_COMPACTION_RATIO]: event.compressionRatio,
      })
      spanManager.endSpan(ref)
    },

    // ── Judge ───────────────────────────────────────────────

    onJudgeResult(event) {
      const ref = spanManager.startSpan('crux.judge', {
        [CRUX_JUDGE_METRIC]: event.metricId,
        [CRUX_JUDGE_SCORE]: event.score,
      })
      spanManager.endSpan(ref)
    },

    // ── Delegate ────────────────────────────────────────────

    onDelegateStart(event) {
      const ref = spanManager.startSpan('crux.delegate', {
        'crux.delegate.id': event.delegateId,
      })
      activeDelegateSpans.set(event.delegateId, ref)
    },

    onDelegateComplete(event) {
      const ref = activeDelegateSpans.get(event.delegateId)
      if (!ref) return
      activeDelegateSpans.delete(event.delegateId)
      spanManager.endSpan(ref)
    },

    // ── Plan & TaskList ────────────────────────────────────────

    onPlanCreated(event) {
      const ref = spanManager.startSpan('crux.plan.create', {
        [CRUX_PLAN_ID]: event.planId,
        'crux.plan.title': event.title,
      })
      spanManager.endSpan(ref)
    },

    onPlanUpdated(event) {
      const ref = spanManager.startSpan('crux.plan.update', {
        [CRUX_PLAN_ID]: event.planId,
        [CRUX_PLAN_VERSION]: event.version,
      })
      spanManager.endSpan(ref)
    },

    onTaskListCreated(event) {
      const ref = spanManager.startSpan('crux.tasklist.create', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        ...(event.planId ? { [CRUX_PLAN_ID]: event.planId } : {}),
      })
      spanManager.endSpan(ref)
    },

    onTaskListCompleted(event) {
      const ref = spanManager.startSpan('crux.tasklist.complete', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        'crux.tasklist.total_tasks': event.totalTasks,
      })
      spanManager.endSpan(ref)
    },

    onTaskListDiscarded(event) {
      const ref = spanManager.startSpan('crux.tasklist.discard', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        'crux.tasklist.completed_count': event.completedCount,
        'crux.tasklist.remaining_count': event.remainingCount,
      })
      spanManager.endSpan(ref)
    },

    onTaskAdded(event) {
      const ref = spanManager.startSpan('crux.task.add', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        [CRUX_TASK_ID]: event.taskId,
        'crux.task.label': event.label,
      })
      spanManager.endSpan(ref)
    },

    onTaskUpdated(event) {
      const ref = spanManager.startSpan('crux.task.update', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        [CRUX_TASK_ID]: event.taskId,
        [CRUX_TASK_STATUS]: event.status,
      })
      spanManager.endSpan(ref)
    },

    onTaskRemoved(event) {
      const ref = spanManager.startSpan('crux.task.remove', {
        [CRUX_TASKLIST_ID]: event.taskListId,
        [CRUX_TASK_ID]: event.taskId,
      })
      spanManager.endSpan(ref)
    },

    // ── Context Cache ─────────────────────────────────────────

    onContextCacheHit(event) {
      const ref = spanManager.startSpan('crux.context.cache', {
        [CRUX_CONTEXT_CACHE_STATUS]: 'hit',
        [CRUX_CONTEXT_ID]: event.contextId,
        [CRUX_CONTEXT_CACHE_AGE_MS]: event.ageMs,
      })
      spanManager.endSpan(ref)
    },

    onContextCacheMiss(event) {
      const ref = spanManager.startSpan('crux.context.cache', {
        [CRUX_CONTEXT_CACHE_STATUS]: 'miss',
        [CRUX_CONTEXT_ID]: event.contextId,
      })
      spanManager.endSpan(ref)
    },

    // ── Semantic Cache ─────────────────────────────────────────

    onSemanticCacheLookupStart(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.lookup', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_OPERATION]: event.operation,
        [CRUX_SEMANTIC_CACHE_VERSION]: event.version,
        [CRUX_SEMANTIC_CACHE_THRESHOLD]: event.threshold,
      })
      activeSemanticCacheLookupSpans.set(event.cacheId, ref)
    },

    onSemanticCacheLookupEnd(event) {
      const ref = activeSemanticCacheLookupSpans.get(event.cacheId)
      if (!ref) return
      activeSemanticCacheLookupSpans.delete(event.cacheId)
      if (event.error) {
        spanManager.recordError(ref, event.error)
      }
      spanManager.setAttributes?.(ref, {
        [CRUX_SEMANTIC_CACHE_STATUS]: event.hit ? 'hit' : 'miss',
        ...(event.score !== undefined ? { [CRUX_SEMANTIC_CACHE_SCORE]: event.score } : {}),
      })
      spanManager.endSpan(ref)
    },

    onSemanticCacheHit(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.hit', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_OPERATION]: event.operation,
        [CRUX_SEMANTIC_CACHE_VERSION]: event.version,
        [CRUX_SEMANTIC_CACHE_SCORE]: event.score,
        [CRUX_SEMANTIC_CACHE_AGE_MS]: event.ageMs,
      })
      spanManager.endSpan(ref)
    },

    onSemanticCacheMiss(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.miss', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_OPERATION]: event.operation,
        [CRUX_SEMANTIC_CACHE_VERSION]: event.version,
      })
      spanManager.endSpan(ref)
    },

    onSemanticCacheWrite(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.write', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_OPERATION]: event.operation,
        [CRUX_SEMANTIC_CACHE_VERSION]: event.version,
        [CRUX_SEMANTIC_CACHE_TTL_MS]: event.ttl,
        'crux.semantic_cache.result_kind': event.resultKind,
      })
      spanManager.endSpan(ref)
    },

    onSemanticCacheSkip(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.skip', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_OPERATION]: event.operation,
        'crux.semantic_cache.skip_reason': event.reason,
      })
      spanManager.endSpan(ref)
    },

    onSemanticCacheReplayStart(event) {
      const ref = spanManager.startSpan('crux.semantic_cache.replay', {
        ...(event.promptId ? { [CRUX_PROMPT_ID]: event.promptId } : {}),
        [CRUX_SEMANTIC_CACHE_VERSION]: event.version,
      })
      spanManager.endSpan(ref)
    },

    // ── Skills ───────────────────────────────────────────────────

    onSkillLoad(event) {
      const ref = spanManager.startSpan('crux.skill.load', {
        [CRUX_SKILL_ID]: event.skillId,
        [CRUX_SKILL_SOURCE]: event.source,
      })
      spanManager.endSpan(ref)
    },

    onSkillCacheHit(event) {
      const ref = spanManager.startSpan('crux.skill.cache', {
        [CRUX_SKILL_CACHE_STATUS]: 'hit',
        [CRUX_SKILL_ID]: event.skillId,
      })
      spanManager.endSpan(ref)
    },

    onSkillCacheMiss(event) {
      const ref = spanManager.startSpan('crux.skill.cache', {
        [CRUX_SKILL_CACHE_STATUS]: 'miss',
        [CRUX_SKILL_ID]: event.skillId,
      })
      spanManager.endSpan(ref)
    },

    onSkillResolve(event) {
      const ref = spanManager.startSpan('crux.skill.resolve', {
        [CRUX_SKILL_ID]: event.skillId,
      })
      spanManager.endSpan(ref)
    },

    onValidationRetryAttempt(event) {
      // Start or update the validation retry span
      let ref = activeValidationRetrySpans.get(event.retryId)
      if (!ref) {
        ref = spanManager.startSpan('crux.validation.retry', {
          'crux.validation.retry_id': event.retryId,
          'crux.validation.max_attempts': event.maxAttempts,
        })
        activeValidationRetrySpans.set(event.retryId, ref)
      }

      spanManager.addEvent(ref, `validation.attempt.${event.attemptNumber}`, {
        'crux.validation.attempt_number': event.attemptNumber,
        'crux.validation.error': event.error,
        'crux.validation.repair_attempted': event.repairAttempted,
        'crux.validation.repair_succeeded': event.repairSucceeded,
      })
    },

    onValidationRetryExhausted(event) {
      const ref = activeValidationRetrySpans.get(event.retryId)
      if (!ref) return

      activeValidationRetrySpans.delete(event.retryId)

      spanManager.setAttributes(ref, {
        'crux.validation.total_attempts': event.totalAttempts,
        'crux.validation.exhausted': true,
        'crux.validation.prompt_id': event.promptId,
      })

      spanManager.recordError(ref, event.lastError)
      spanManager.endSpan(ref)
    },

    // ── Routing hooks ──

    onRouterSelect(event) {
      const ref = spanManager.startSpan('crux.router.select', {
        [CRUX_ROUTER_CLASSIFIED_AS]: event.classifiedAs,
        [CRUX_ROUTER_SELECTED_MODEL]: event.selectedModel,
        [CRUX_ROUTER_OVERRIDDEN]: event.overridden,
      })
      // Router selection is instantaneous — end immediately
      spanManager.endSpan(ref)
    },

    onCascadeTier(event) {
      const ref = spanManager.startSpan(`crux.cascade.tier.${event.tierIndex}`, {
        [CRUX_CASCADE_TIER_INDEX]: event.tierIndex,
        [CRUX_CASCADE_TIER_MODEL]: event.model,
        [CRUX_CASCADE_TIER_STATUS]: event.status,
        'crux.cascade.tier.duration_ms': event.durationMs,
        ...(event.cost != null ? { 'crux.cascade.tier.cost': event.cost } : {}),
      })
      spanManager.endSpan(ref)
    },

    onCascadeComplete(event) {
      const ref = spanManager.startSpan('crux.cascade.run', {
        [CRUX_CASCADE_ACCEPTED_TIER]: event.acceptedTier,
        [CRUX_CASCADE_TOTAL_TIERS]: event.totalTiers,
        [CRUX_CASCADE_BUDGET_EXCEEDED]: event.budgetExceeded,
        'crux.cascade.total_cost': event.totalCost,
        'crux.cascade.total_duration_ms': event.totalDurationMs,
      })
      spanManager.endSpan(ref)
    },

    onBudgetExceeded(event) {
      // Emit as a span event on the current context (not a standalone span)
      const ref = spanManager.startSpan('crux.budget.exceeded', {
        'crux.budget.type': event.budgetType,
        'crux.budget.limit': event.limit,
        'crux.budget.actual': event.actual,
      })
      spanManager.endSpan(ref)
    },

    // ── Constraints ────────────────────────────────────────────

    onConstraintCheck(event) {
      const ref = spanManager.startSpan('crux.constraint.check', {
        [CRUX_CONSTRAINT_NAME]: event.constraintName,
        [CRUX_CONSTRAINT_SEVERITY]: event.severity,
        [CRUX_CONSTRAINT_PASS]: event.pass,
        [CRUX_CONSTRAINT_ATTEMPT]: event.attempt,
      })
      if (!event.pass && event.feedback) {
        spanManager.setAttributes(ref, { 'crux.constraint.feedback': event.feedback })
      }
      spanManager.endSpan(ref)
    },

    onConstraintRetry(event) {
      const ref = spanManager.startSpan('crux.constraint.retry', {
        [CRUX_CONSTRAINT_ATTEMPT]: event.attempt,
        'crux.constraint.names': event.constraintNames.join(','),
      })
      spanManager.endSpan(ref)
    },

    onConstraintViolation(event) {
      const ref = spanManager.startSpan('crux.constraint.violation', {
        'crux.constraint.names': event.constraintNames.join(','),
        'crux.constraint.total_attempts': event.totalAttempts,
      })
      spanManager.recordError(ref, new Error(`Constraint violation: ${event.constraintNames.join(', ')}`))
      spanManager.endSpan(ref)
    },
  }
}
