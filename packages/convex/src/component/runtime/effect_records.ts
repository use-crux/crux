import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
} from '@use-crux/core/runtime'
import type { Doc } from '../_generated/dataModel.js'
import type { MutationCtx } from '../_generated/server.js'

export type EffectRecordKind =
  | 'attempt'
  | 'envelope'
  | 'receipt'
  | 'reconciliation'
  | 'scope'
  | 'unit'

export type ComponentEffectRecord =
  | DurableEffectEnvelopeRecord
  | DurableEffectReceiptRecord
  | DurableEffectReconciliationRecord
  | DurableEffectRecoveryAttemptRecord
  | DurableEffectRecoveryUnitRecord
  | DurableEffectScopeRecord

export async function getEffectDocument(
  ctx: MutationCtx,
  kind: EffectRecordKind,
  namespace: string,
  recordId: string,
): Promise<Doc<'runtimeEffectRecords'> | null> {
  return await ctx.db
    .query('runtimeEffectRecords')
    .withIndex('by_identity', (q) =>
      q.eq('namespace', namespace).eq('kind', kind).eq('recordId', recordId),
    )
    .first()
}

export async function getEffectRecord<T extends ComponentEffectRecord>(
  ctx: MutationCtx,
  kind: EffectRecordKind,
  namespace: string,
  recordId: string,
): Promise<T | null> {
  const document = await getEffectDocument(ctx, kind, namespace, recordId)
  return document ? document.record as T : null
}

export async function listEffectRecords<T extends ComponentEffectRecord>(
  ctx: MutationCtx,
  kind: EffectRecordKind,
  namespace: string,
  boundaryId: string,
): Promise<readonly T[]> {
  const documents = await ctx.db
    .query('runtimeEffectRecords')
    .withIndex('by_boundary_kind', (q) =>
      q.eq('namespace', namespace).eq('boundaryId', boundaryId).eq('kind', kind),
    )
    .collect()
  return documents
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
    .map((document) => document.record as T)
}

export async function insertEffectRecord(
  ctx: MutationCtx,
  kind: EffectRecordKind,
  recordId: string,
  boundaryId: string,
  value: ComponentEffectRecord,
): Promise<boolean> {
  if (await getEffectDocument(ctx, kind, value.namespace, recordId)) return false
  await ctx.db.insert('runtimeEffectRecords', {
    namespace: value.namespace,
    kind,
    recordId,
    boundaryId,
    record: value,
    revision: value.revision,
    ...('fenceToken' in value && value.fenceToken
      ? { fenceToken: value.fenceToken }
      : {}),
  })
  return true
}

export async function replaceEffectRecord(
  ctx: MutationCtx,
  current: Doc<'runtimeEffectRecords'>,
  boundaryId: string,
  value: ComponentEffectRecord,
): Promise<boolean> {
  if (current.revision + 1 !== value.revision) return false
  await ctx.db.replace(current._id, {
    namespace: value.namespace,
    kind: current.kind,
    recordId: current.recordId,
    boundaryId,
    record: value,
    revision: value.revision,
    ...('fenceToken' in value && value.fenceToken
      ? { fenceToken: value.fenceToken }
      : {}),
  })
  return true
}
