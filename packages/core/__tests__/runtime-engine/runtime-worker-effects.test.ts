import { afterEach, describe, expect, it } from 'vitest'
import { EffectOutcomeUnknownError } from '@use-crux/core/effect'
import {
  createRuntimeProgram,
  createRuntimeWorker,
  node,
} from '@use-crux/core/runtime'
import { resetEffectDefinitionsForTesting } from '../../src/effect/define-effect'
import { resetEffectLedgerForTesting } from '../../src/effect/internal/ledger'
import { resetHooks } from '../../src/runtime/runtime'
import {
  deferred,
  seedInterruptedScope,
  seedInterruptedScopes,
  seedNestedInterruptedScope,
} from './runtime-worker-effects-fixture'

afterEach(() => {
  resetEffectDefinitionsForTesting()
  resetEffectLedgerForTesting()
  resetHooks()
})

describe('Runtime worker Effect recovery', () => {
  it('claims and recovers an interrupted durable plan', async () => {
    const recoveredKeys: string[] = []
    const seeded = await seedInterruptedScope(
      'worker.customer-update',
      async (idempotencyKey) => recoveredKeys.push(idempotencyKey),
      2,
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })

    await expect.poll(() => recoveredKeys).toEqual([
      ...seeded.snapshot.plan.map((step) => step.idempotencyKey),
    ])
    await expect.poll(async () =>
      (await seeded.store.effects.reconstructScope(seeded.scope, {
        namespace: seeded.namespace,
      }))?.scopeRecord.scope.status,
    ).toBe('completed')
    await expect(seeded.store.effects.reconstructScope(seeded.scope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      units: [
        { unit: { status: 'recovered' } },
        { unit: { status: 'recovered' } },
      ],
    })
    await worker.stop()
  })

  it('recovers the exact durable plan of a nested boundary', async () => {
    const recoveredKeys: string[] = []
    const seeded = await seedNestedInterruptedScope(
      'worker.nested-update',
      async (idempotencyKey) => recoveredKeys.push(idempotencyKey),
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })

    await expect.poll(() => recoveredKeys).toEqual([
      seeded.childSnapshot.plan[0]!.idempotencyKey,
    ])
    await expect(seeded.store.effects.reconstructScope(seeded.childScope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      units: [{ unit: { status: 'recovered' } }],
    })
    await expect(seeded.store.effects.reconstructScope(seeded.parentScope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      scopeRecord: { scope: { status: 'completed' } },
      units: [{ kind: 'boundary', unit: { status: 'recovered' } }],
    })
    await worker.stop()
  })

  it('does not retry a crash-ambiguous recovery attempt', async () => {
    let calls = 0
    const seeded = await seedInterruptedScope(
      'worker.ambiguous-update',
      async () => {
        calls += 1
        throw new EffectOutcomeUnknownError('Provider outcome is unknown')
      },
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })

    await expect.poll(() => calls).toBe(1)
    await expect.poll(async () =>
      (await seeded.store.effects.reconstructScope(seeded.scope, {
        namespace: seeded.namespace,
      }))?.reconciliationRequired,
    ).toEqual([
      expect.objectContaining({ kind: 'recovery', state: 'unknown' }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(1)
    await worker.stop()
  })

  it('persists an ordinary recovery failure without inventing ambiguity', async () => {
    let calls = 0
    const seeded = await seedInterruptedScope(
      'worker.failed-update',
      async () => {
        calls += 1
        throw new Error('Provider rejected compensation')
      },
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })

    await expect.poll(async () =>
      (await seeded.store.effects.reconstructScope(seeded.scope, {
        namespace: seeded.namespace,
      }))?.scopeRecord.scope.status,
    ).toBe('completed')
    await expect(seeded.store.effects.reconstructScope(seeded.scope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      receipts: expect.arrayContaining([
        expect.objectContaining({ receipt: expect.objectContaining({ outcome: 'failed' }) }),
      ]),
      units: [{ unit: { status: 'failed' } }],
      reconciliationRequired: [],
    })
    expect(calls).toBe(1)
    await worker.stop()
  })

  it('waits for admitted recovery settlement before releasing on stop', async () => {
    const gate = deferred<void>()
    let entered = false
    const seeded = await seedInterruptedScope(
      'worker.shutdown-update',
      async () => {
        entered = true
        await gate.promise
      },
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })
    await expect.poll(() => entered).toBe(true)

    let stopped = false
    const stopping = worker.stop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stopped).toBe(false)
    gate.resolve()
    await stopping
    await expect(seeded.store.effects.reconstructScope(seeded.scope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      scopeRecord: { scope: { status: 'completed' } },
      units: [{ unit: { status: 'recovered' } }],
    })
  })

  it('stops admitting additional claimed scopes during shutdown', async () => {
    const gate = deferred<void>()
    let calls = 0
    const seeded = await seedInterruptedScopes(
      'worker.shutdown-admission',
      async () => {
        calls += 1
        await gate.promise
      },
      2,
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [],
        effectTargets: [seeded.definition],
        transports: [],
      }),
      pollIntervalMs: 5,
    })
    await expect.poll(() => calls).toBe(1)

    const stopping = worker.stop()
    gate.resolve()
    await stopping
    const statuses = await Promise.all(seeded.scopes.map(async (scope) =>
      (await seeded.store.effects.reconstructScope(scope, {
        namespace: seeded.namespace,
      }))?.scopeRecord.scope.status,
    ))
    expect(statuses.sort()).toEqual(['completed', 'rolling_back'])
    expect(calls).toBe(1)
  })

})
