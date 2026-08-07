import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  RuntimeEffectPruneOptions,
  RuntimePruneResult,
} from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import { getEffectDocument, replaceEffectRecord } from './effect_records'

/** Expire a bounded batch of Convex recovery envelopes atomically. */
export async function pruneEffectEnvelopes(
  ctx: MutationCtx,
  options: RuntimeEffectPruneOptions,
): Promise<RuntimePruneResult> {
  const takeLimit = Math.max(0, Math.floor(options.limit)) + 1
  const namespace = options.namespace
  const expiryDocuments = namespace
    ? await ctx.db
        .query('runtimeEffectRecords')
        .withIndex('by_retention', (q) =>
          q
            .eq('namespace', namespace)
            .eq('kind', 'envelope')
            .eq('retentionMode', 'expiry')
            .lte('retentionAt', options.now.getTime()),
        )
        .take(takeLimit)
    : await ctx.db
        .query('runtimeEffectRecords')
        .withIndex('by_retention_global', (q) =>
          q
            .eq('kind', 'envelope')
            .eq('retentionMode', 'expiry')
            .lte('retentionAt', options.now.getTime()),
        )
        .take(takeLimit)
  const createdDocuments = namespace
    ? await ctx.db
        .query('runtimeEffectRecords')
        .withIndex('by_retention', (q) =>
          q
            .eq('namespace', namespace)
            .eq('kind', 'envelope')
            .eq('retentionMode', 'created')
            .lt('retentionAt', options.before.getTime()),
        )
        .take(takeLimit)
    : await ctx.db
        .query('runtimeEffectRecords')
        .withIndex('by_retention_global', (q) =>
          q
            .eq('kind', 'envelope')
            .eq('retentionMode', 'created')
            .lt('retentionAt', options.before.getTime()),
        )
        .take(takeLimit)
  const candidates = [...expiryDocuments, ...createdDocuments].sort(
    (left, right) =>
      (left.retentionAt ?? 0) - (right.retentionAt ?? 0) ||
      left.recordId.localeCompare(right.recordId),
  )
  const selected = candidates.slice(0, options.limit)
  for (const envelope of selected) {
    const receiptDocument = await getEffectDocument(
      ctx,
      'receipt',
      envelope.namespace,
      envelope.recordId,
    )
    const receipt = receiptDocument?.record as
      | DurableEffectReceiptRecord
      | undefined
    if (
      receiptDocument &&
      receipt &&
      receipt.receipt.recovery !== 'recovered'
    ) {
      await replaceEffectRecord(
        ctx,
        receiptDocument,
        receipt.receipt.boundaryId,
        {
          ...receipt,
          receipt: { ...receipt.receipt, recovery: 'expired' },
          revision: receipt.revision + 1,
        },
      )
    }
    await ctx.db.delete(envelope._id)
  }
  return {
    removed: selected.length,
    truncated: candidates.length > selected.length,
  }
}
