import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  runReactiveCompositeAdapterTests,
  runStoreEffectAdapterTests,
  runStoreAdapterTests,
} from "../../src/runtime/testing";

runStoreAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
  assertSerializedTransactions: true,
});

runStoreEffectAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  effectCapabilities: {
    atomicOperations: { support: "supported" },
    multiOperationTransactions: { support: "supported" },
    crashFencing: { support: "supported" },
    reconstruction: { support: "supported" },
    recoveryClaims: { support: "supported" },
  },
});

runReactiveCompositeAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
});
