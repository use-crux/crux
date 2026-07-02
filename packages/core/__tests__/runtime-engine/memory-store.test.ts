import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import { runStoreAdapterTests } from '../../runtime/testing'

runStoreAdapterTests({
  name: 'inMemoryRuntimeStore',
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
})
