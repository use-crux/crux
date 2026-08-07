import { config, effect, flow, rollbackOnError } from '@use-crux/core'
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from '@use-crux/core/runtime'
import { resetEffectLedgerForTesting } from '../../src/effect/internal/ledger'

export async function seedInterruptedScope(
  effectId: string,
  recover: (idempotencyKey: string) => Promise<unknown>,
  occurrences = 1,
) {
  const seeded = await seedInterruptedScopes(
    effectId,
    recover,
    1,
    occurrences,
  )
  return {
    namespace: seeded.namespace,
    definition: seeded.definition,
    scope: seeded.scopes[0]!,
    receiptId: seeded.snapshots[0]!.receipts[0]!.receipt.id,
    snapshot: seeded.snapshots[0]!,
    store: seeded.store,
  }
}

export async function seedInterruptedScopes(
  effectId: string,
  recover: (idempotencyKey: string) => Promise<unknown>,
  scopeCount: number,
  occurrences = 1,
) {
  const namespace = `namespace.${effectId}`
  const initial = inMemoryRuntimeStore()
  const definition = effect(
    effectId,
    async (input: { readonly revision: number }) => input,
    {
      recover: async ({ idempotencyKey }) => {
        await recover(idempotencyKey)
      },
    },
  )
  const program = createRuntimeProgram({
    targets: [],
    effectTargets: [definition],
    transports: [],
  })
  const application = config({
    runtime: node({
      store: initial,
      namespace,
      program,
      autoStartMaintenance: false,
    }),
  })
  const operation = flow(`flow.${effectId}`, async () => {
    for (let revision = 1; revision <= occurrences; revision += 1) {
      await definition({ revision })
    }
  })
  const completed = []
  for (let index = 0; index < scopeCount; index += 1) {
    completed.push(await operation.run())
  }
  const snapshots = await Promise.all(completed.map(async (result) => {
    const snapshot = await initial.effects.reconstructScope(result.effects, {
      namespace,
    })
    if (!snapshot) throw new TypeError('Durable Effect scope was not persisted.')
    return snapshot
  }))
  for (const snapshot of snapshots) {
    await initial.transact(async (tx) => {
      await tx.effects!.transitionScope({
        next: {
          ...snapshot.scopeRecord,
          scope: { ...snapshot.scopeRecord.scope, status: 'rolling_back' },
          revision: snapshot.scopeRecord.revision + 1,
        },
      })
    })
  }
  application.dispose()
  resetEffectLedgerForTesting()
  return {
    namespace,
    definition,
    scopes: completed.map((result) => result.effects),
    snapshots,
    store: initial.testing.restart(),
  }
}

export async function seedNestedInterruptedScope(
  effectId: string,
  recover: (idempotencyKey: string) => Promise<unknown>,
) {
  const namespace = `namespace.${effectId}`
  const initial = inMemoryRuntimeStore()
  const definition = effect(effectId, async () => undefined, {
    recover: async ({ idempotencyKey }) => recover(idempotencyKey),
  })
  const program = createRuntimeProgram({
    targets: [],
    effectTargets: [definition],
    transports: [],
  })
  const application = config({
    runtime: node({
      store: initial,
      namespace,
      program,
      autoStartMaintenance: false,
    }),
  })
  const operation = flow(`flow.${effectId}`, async () => {
    await rollbackOnError(async () => {
      await definition()
    })
  })
  const completed = await operation.run()
  const parentSnapshot = await initial.effects.reconstructScope(
    completed.effects,
    { namespace },
  )
  if (!parentSnapshot) throw new TypeError('Parent Effect scope was not persisted.')
  const childStep = parentSnapshot.plan.find((step) => step.kind === 'boundary')
  if (!childStep) throw new TypeError('Nested Effect boundary was not persisted.')
  const childSnapshot = await initial.effects.reconstructScope(childStep.scope, {
    namespace,
  })
  if (!childSnapshot) throw new TypeError('Child Effect scope was not persisted.')
  await initial.transact(async (tx) => {
    await tx.effects!.transitionScope({
      next: {
        ...parentSnapshot.scopeRecord,
        scope: { ...parentSnapshot.scopeRecord.scope, status: 'rolling_back' },
        revision: parentSnapshot.scopeRecord.revision + 1,
      },
    })
  })
  application.dispose()
  resetEffectLedgerForTesting()
  return {
    namespace,
    definition,
    parentScope: completed.effects,
    childScope: childStep.scope,
    childSnapshot,
    store: initial.testing.restart(),
  }
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
