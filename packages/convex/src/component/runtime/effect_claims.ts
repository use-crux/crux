import type {
  DurableEffectReceiptRecord,
  DurableEffectEnvelopeRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryClaim,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
  RuntimeEffectRecoveryClaimOptions,
  RuntimeEffectRecoveryRelease,
} from '@use-crux/core/runtime'
import { reconstructDurableEffectScope } from '@use-crux/core/runtime/internal/effects-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  getEffectDocument,
  listEffectDocuments,
  replaceEffectRecord,
} from './effect_records'

export async function claimEffectRecovery(
  ctx: MutationCtx,
  options: RuntimeEffectRecoveryClaimOptions,
): Promise<readonly DurableEffectRecoveryClaim[]> {
  const indexed = await ctx.db
    .query('runtimeEffectRecords')
    .withIndex('by_recovery', (q) =>
      q.eq('namespace', options.namespace)
        .eq('kind', 'scope')
        .eq('recoveryStatus', 'rolling_back')
        .lte('recoveryLeaseExpiresAt', options.now.getTime()),
    )
    .order('asc')
    .collect()
  const legacy = await ctx.db
    .query('runtimeEffectRecords')
    .withIndex('by_identity', (q) =>
      q.eq('namespace', options.namespace).eq('kind', 'scope'),
    )
    .filter((q) => q.eq(q.field('recoveryStatus'), undefined))
    .collect()
  const documents = [...indexed, ...legacy]
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
  const claims: DurableEffectRecoveryClaim[] = []
  for (const document of documents) {
    if (claims.length >= options.limit) break
    const current = document.record as DurableEffectScopeRecord
    if (
      current.scope.status !== 'rolling_back' ||
      (current.recoveryLeaseExpiresAt ?? 0) > options.now.getTime()
    ) continue
    const set = await scopeRecordSet(ctx, current)
    const snapshot = reconstructDurableEffectScope(current.scope.ref, set)
    if (!hasPendingRecovery(snapshot)) continue
    const expiresAt = options.now.getTime() + options.leaseMs
    const scope = {
      ...current,
      fenceToken: options.leaseToken,
      recoveryLeaseExpiresAt: expiresAt,
      ...(options.ownerId ? { recoveryOwnerId: options.ownerId } : {}),
      revision: current.revision + 1,
    }
    if (!(await replaceEffectRecord(
      ctx, document, current.scope.ref.id, scope,
    ))) continue
    await fenceDocuments(ctx, set, options.leaseToken)
    await fenceNestedRecoveryScopes(
      ctx,
      snapshot,
      expiresAt,
      options.leaseToken,
      options.ownerId,
    )
    const fenced = await scopeRecordSet(ctx, scope)
    claims.push(Object.freeze({
      scope: current.scope.ref,
      leaseToken: options.leaseToken,
      expiresAt,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      snapshot: reconstructDurableEffectScope(current.scope.ref, fenced),
    }))
  }
  return Object.freeze(claims)
}

async function fenceNestedRecoveryScopes(
  ctx: MutationCtx,
  snapshot: DurableEffectScopeSnapshot,
  expiresAt: number,
  fenceToken: string,
  ownerId: string | undefined,
): Promise<void> {
  for (const step of snapshot.plan) {
    if (step.kind !== 'boundary') continue
    const document = await getEffectDocument(
      ctx,
      'scope',
      snapshot.scopeRecord.namespace,
      step.scope.id,
    )
    const current = document?.record as DurableEffectScopeRecord | undefined
    if (!document || !current || current.scope.ref.runId !== step.scope.runId) continue
    const set = await scopeRecordSet(ctx, current)
    const scope = {
      ...current,
      fenceToken,
      recoveryLeaseExpiresAt: expiresAt,
      ...(ownerId ? { recoveryOwnerId: ownerId } : {}),
      revision: current.revision + 1,
    }
    if (!(await replaceEffectRecord(ctx, document, step.scope.id, scope))) {
      throw new TypeError(`Durable Effect scope \`${step.scope.id}\` rejected its fence.`)
    }
    await fenceDocuments(ctx, set, fenceToken)
    await fenceNestedRecoveryScopes(
      ctx,
      reconstructDurableEffectScope(step.scope, { ...set, scope }),
      expiresAt,
      fenceToken,
      ownerId,
    )
  }
}

export async function releaseEffectRecovery(
  ctx: MutationCtx,
  release: RuntimeEffectRecoveryRelease,
): Promise<boolean> {
  const document = await getEffectDocument(
    ctx, 'scope', release.namespace, release.scope.id,
  )
  const current = document?.record as DurableEffectScopeRecord | undefined
  if (
    !document ||
    !current ||
    current.scope.ref.runId !== release.scope.runId ||
    current.fenceToken !== release.leaseToken
  ) return false
  return await replaceEffectRecord(ctx, document, release.scope.id, {
    ...current,
    recoveryLeaseExpiresAt: release.now.getTime(),
    revision: current.revision + 1,
  })
}

async function scopeRecordSet(
  ctx: MutationCtx,
  scope: DurableEffectScopeRecord,
) {
  const documents = await listEffectDocuments(
    ctx,
    scope.namespace,
    scope.scope.ref.id,
  )
  const records = <T>(kind: string) => documents
    .filter((document) => document.kind === kind)
    .map((document) => document.record as T)
  return {
    scope,
    receipts: records<DurableEffectReceiptRecord>('receipt'),
    units: records<DurableEffectRecoveryUnitRecord>('unit'),
    envelopes: records<DurableEffectEnvelopeRecord>('envelope'),
    attempts: records<DurableEffectRecoveryAttemptRecord>('attempt'),
    reconciliations: records<DurableEffectReconciliationRecord>('reconciliation'),
    documents,
  }
}

async function fenceDocuments(
  ctx: MutationCtx,
  set: Awaited<ReturnType<typeof scopeRecordSet>>,
  fenceToken: string,
): Promise<void> {
  for (const document of set.documents) {
    if (!['receipt', 'unit', 'attempt'].includes(document.kind)) continue
    const record = document.record as
      | DurableEffectReceiptRecord
      | DurableEffectRecoveryUnitRecord
      | DurableEffectRecoveryAttemptRecord
    const next = { ...record, fenceToken, revision: record.revision + 1 }
    if (!(await replaceEffectRecord(ctx, document, document.boundaryId, next))) {
      throw new TypeError(
        `Durable Effect ${document.kind} \`${document.recordId}\` rejected its fence.`,
      )
    }
  }
}

function hasPendingRecovery(
  snapshot: ReturnType<typeof reconstructDurableEffectScope>,
): boolean {
  return snapshot.plan.some(
    (step) => step.status === 'active' || step.status === 'failed',
  )
}
