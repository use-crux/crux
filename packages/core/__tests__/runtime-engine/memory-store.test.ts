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
});

runReactiveCompositeAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
});
