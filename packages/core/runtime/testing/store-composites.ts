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
  it.skipIf(options.substrateAtomicTransact)(
    'invariant: named composites roll back partial writes when the transaction fails',
    async () => {
      const cases: StoreCompositeRollbackCase[] = [
        ...workflowCompositeRollbackCases(),
        ...operationalCompositeRollbackCases(),
      ]

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
