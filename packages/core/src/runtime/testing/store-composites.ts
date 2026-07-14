import { expect, it } from 'vitest'
import type { RuntimeStoreAdapter } from '../store'
import { operationalCompositeRollbackCases } from './store-composite-operational-cases'
import { workflowCompositeRollbackCases } from './store-composite-workflow-cases'
import {
  requireFaultHook,
  type StoreCompositeRollbackCase,
} from './store-composite-case-utils'
import type { RunStoreAdapterTestsOptions } from './store-types'

/** Register atomicity checks for named Runtime Engine composite operations. */
export function registerStoreCompositeTests<
  TStore extends RuntimeStoreAdapter,
>(options: RunStoreAdapterTestsOptions<TStore>): void {
  it('invariant: named composites execute through the adapter runner', async () => {
    const cases = compositeCases()

    for (const testCase of cases) {
      const store = await options.createStore()
      await testCase.prepare?.(store)
      await expect(testCase.run(store), testCase.kind).resolves.toBeUndefined()
      await testCase.verifySuccess?.(store)
    }
  })

  it.skipIf(options.substrateAtomicTransact)(
    'invariant: named composites roll back partial writes when the transaction fails',
    async () => {
      const cases = compositeCases()

      for (const testCase of cases) {
        const store = await options.createStore()
        await testCase.prepare?.(store)
        requireFaultHook(options.failAfterWrites)(
          store,
          testCase.writesBeforeFailure,
        )
        await expect(testCase.run(store)).rejects.toThrow(
          'Injected transaction failure',
        )
        await testCase.verifyRollback(store)
      }
    },
  )
}

function compositeCases(): StoreCompositeRollbackCase[] {
  return [
    ...workflowCompositeRollbackCases(),
    ...operationalCompositeRollbackCases(),
  ]
}
