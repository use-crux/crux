import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import { runStoreAdapterTests } from '../../src/runtime/testing'

runStoreAdapterTests({
  name: 'inMemoryRuntimeStore',
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
  assertSerializedTransactions: true,
})
