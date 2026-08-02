import { runNativeEffect, type NativeEffectProvider } from '../effect/internal/native'
import { recordEffectReceiptVerification } from '../effect/internal/receipt-verification-evidence'
import { observe, type CruxPrimitiveName } from '../observability'
import type { EffectResource } from '../effect'
import type { ConnectedKnowledgeSummary, CorpusSyncResult, IndexResult } from '../indexing'
import type { JsonValue } from '../storage'
import type { KnowledgeBaseRemoveResult } from './knowledge-base-runtime'

/** Public knowledge-base mutation operation represented as a native Effect. */
export type KnowledgeBaseMutationOperation =
  | 'index'
  | 'reindex'
  | 'remove'
  | 'corpus.sync'

interface KnowledgeBaseMutation {
  readonly knowledgeBaseId: string
  readonly namespace: string
  readonly operation: KnowledgeBaseMutationOperation
  readonly sourceIds: readonly string[]
  readonly nativePrimitive: CruxPrimitiveName
  readonly recovery?: 'unavailable' | 'irreversible'
}

const provider: NativeEffectProvider<KnowledgeBaseMutation, never> = {
  describe(operation) {
    return {
      effectId: `knowledge.base.${operation.operation}`,
      effectVersion: 1,
      nativePrimitive: operation.nativePrimitive,
      recovery: operation.recovery ?? recoveryFor(operation.operation),
      resource: mutationResources(operation),
    }
  },
  resourceForOutput(operation, output) {
    return isMutationOutput(output)
      ? mutationResources(operation, output)
      : mutationResources(operation)
  },
  async recover() {
    return undefined
  },
}

const mutationReceipts = new WeakMap<object, { readonly kind: 'effect.receipt'; readonly id: string; readonly effectId: string }>()

/** Run one public knowledge-base mutation as an audit-first native Effect. */
export async function runKnowledgeBaseMutationEffect<
  TOutput extends IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult,
>(
  operation: KnowledgeBaseMutation,
  run: () => Promise<TOutput>,
): Promise<TOutput> {
  const span = observe.openSpan({
    name: `${operation.knowledgeBaseId}.${operation.operation}`,
    primitive: operation.nativePrimitive,
    attributes: {
      knowledgeBaseId: operation.knowledgeBaseId,
      namespace: operation.namespace,
      operation: operation.operation,
      sourceCount: operation.sourceIds.length,
      sourceIds: [...operation.sourceIds],
    },
  })
  try {
    const execution = await runNativeEffect(provider, operation, span, run)
    if (typeof execution.output === 'object' && execution.output !== null) {
      mutationReceipts.set(execution.output, execution.receipt)
    }
    span.end({ attributes: mutationEndAttributes(execution.output) })
    return execution.output
  } catch (error) {
    span.error(error)
    throw error
  }
}

/** Record connected-knowledge diagnostics against the mutation receipt that produced a result. Internal. */
export function recordKnowledgeBaseMutationKnowledgeEvidence(
  output: IndexResult | CorpusSyncResult,
  knowledge: ConnectedKnowledgeSummary | undefined,
): void {
  if (!knowledge) return
  const receipt = mutationReceipts.get(output)
  if (!receipt) return
  recordEffectReceiptVerification(receipt, knowledgeEvidenceData(knowledge))
}

function recoveryFor(
  operation: KnowledgeBaseMutationOperation,
): 'unavailable' | 'irreversible' {
  return operation === 'index' ? 'unavailable' : 'irreversible'
}

function mutationResources(
  operation: KnowledgeBaseMutation,
  output?: IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult,
): readonly EffectResource[] {
  return [
    {
      type: 'knowledge-base',
      id: operation.knowledgeBaseId,
      namespace: operation.namespace,
      attributes: knowledgeBaseAttributes(operation, output),
    },
    ...sourceResources(operation, output),
  ]
}

function knowledgeBaseAttributes(
  operation: KnowledgeBaseMutation,
  output?: IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult,
): EffectResource['attributes'] {
  const base = {
    operation: operation.operation,
    sourceCount: operation.sourceIds.length,
  }
  if (!output) return base
  if (output && 'sources' in output) {
    const knowledge = knowledgeAttributes(output.knowledge)
    return {
      ...base,
      sourceCount: output.sources.length,
      chunkCount: output.chunkCount,
      added: output.added,
      changed: output.changed,
      unchanged: output.unchanged,
      stale: output.stale,
      skipped: output.skipped,
      failed: output.failed,
      deleted: output.deleted,
      ...knowledge,
    }
  }
  if ('deletedCount' in output) return { ...base, deletedCount: output.deletedCount }
  return {
    ...base,
    sourceCount: output.sourceCount,
    chunkCount: output.chunkCount,
    stageCount: output.stages?.length ?? 0,
    ...knowledgeAttributes(output.knowledge),
  }
}

function knowledgeAttributes(
  knowledge: ConnectedKnowledgeSummary | undefined,
): Record<string, number> {
  if (!knowledge) return {}
  return {
    knowledgeStageCount: knowledge.stages.length,
    knowledgeClaimCount: knowledge.stages.reduce((total, stage) => total + stage.claims, 0),
    knowledgeWarningCount: knowledge.stages.reduce((total, stage) => total + stage.warnings.length, 0),
  }
}

function knowledgeEvidenceData(knowledge: ConnectedKnowledgeSummary): JsonValue {
  return {
    knowledge: {
      stages: knowledge.stages.map((stage) => ({
        stageId: stage.stageId,
        status: { ran: stage.status.ran, cached: stage.status.cached },
        claims: stage.claims,
        warnings: [...stage.warnings],
      })),
    },
  }
}

function sourceResources(
  operation: KnowledgeBaseMutation,
  output?: IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult,
): readonly EffectResource[] {
  if (output && 'sources' in output) {
    return output.sources.map((source) => sourceResource(operation, source.sourceId, {
      action: source.action,
      ...(source.reason ? { reason: source.reason } : {}),
      ...(source.chunkCount !== undefined ? { chunkCount: source.chunkCount } : {}),
    }))
  }
  if (output && 'deletedCount' in output) {
    return [sourceResource(operation, output.sourceId, {
      action: 'removed',
      deletedCount: output.deletedCount,
    })]
  }
  return operation.sourceIds.map((sourceId) => sourceResource(operation, sourceId, { action: output ? 'indexed' : 'planned' }))
}

function sourceResource(
  operation: KnowledgeBaseMutation,
  sourceId: string,
  attributes: NonNullable<EffectResource['attributes']>,
): EffectResource {
  return {
    type: 'knowledge-base.source',
    id: sourceId,
    namespace: operation.namespace,
    attributes: { knowledgeBaseId: operation.knowledgeBaseId, ...attributes },
  }
}

function mutationEndAttributes(
  output: IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult,
): Record<string, number> {
  if ('sources' in output) {
    return {
      sourceCount: output.sources.length,
      chunkCount: output.chunkCount,
      deletedCount: output.deleted,
      failedCount: output.failed,
    }
  }
  if ('deletedCount' in output) return { deletedCount: output.deletedCount }
  return { sourceCount: output.sourceCount, chunkCount: output.chunkCount }
}

function isMutationOutput(
  value: unknown,
): value is IndexResult | CorpusSyncResult | KnowledgeBaseRemoveResult {
  return typeof value === 'object' && value !== null
}
