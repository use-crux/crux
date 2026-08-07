import { afterEach, describe, expect, it } from 'vitest'
import { effect } from '@use-crux/core'
import {
  createRuntimeProgram,
  createRuntimeWorker,
  node,
} from '@use-crux/core/runtime'
import { resetEffectDefinitionsForTesting } from '../../src/effect/define-effect'
import { resetEffectLedgerForTesting } from '../../src/effect/internal/ledger'
import { resetHooks } from '../../src/runtime/runtime'
import { seedInterruptedScope } from './runtime-worker-effects-fixture'

afterEach(() => {
  resetEffectDefinitionsForTesting()
  resetEffectLedgerForTesting()
  resetHooks()
})

describe('Runtime worker Effect target authority', () => {
  it('settles an undeclared recovery target as handler unavailable', async () => {
    const seeded = await seedInterruptedScope(
      'worker.undeclared-update',
      async () => undefined,
    )
    const worker = createRuntimeWorker({
      runtime: node({
        store: seeded.store,
        namespace: seeded.namespace,
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
      pollIntervalMs: 5,
    })

    await expect.poll(async () =>
      (await seeded.store.effects.getReceipt(seeded.receiptId, {
        namespace: seeded.namespace,
      }))?.receipt.recovery,
    ).toBe('handler_unavailable')
    await expect(seeded.store.effects.reconstructScope(seeded.scope, {
      namespace: seeded.namespace,
    })).resolves.toMatchObject({
      scopeRecord: { scope: { status: 'completed' } },
      units: [{ unit: { status: 'failed' } }],
    })
    await worker.stop()
  })

  it('settles a version-mismatched recovery target as handler unavailable', async () => {
    let invoked = false
    const seeded = await seedInterruptedScope(
      'worker.versioned-update',
      async () => undefined,
    )
    const otherVersion = effect(
      'worker.versioned-update',
      async () => undefined,
      {
        version: 2,
        recover: async () => {
          invoked = true
        },
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
        effectTargets: [otherVersion],
        transports: [],
      }),
      pollIntervalMs: 5,
    })

    await expect.poll(async () =>
      (await seeded.store.effects.getReceipt(seeded.receiptId, {
        namespace: seeded.namespace,
      }))?.receipt.recovery,
    ).toBe('handler_unavailable')
    expect(invoked).toBe(false)
    await worker.stop()
  })
})
