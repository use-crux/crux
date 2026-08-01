import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  runReactiveCompositeAdapterTests,
  runStoreAdapterTests,
} from "../../src/runtime/testing";

runStoreAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  crashBeforeOutboxConfirm: (store) => store.testing.crashBeforeConfirm(),
  assertSerializedTransactions: true,
});

runReactiveCompositeAdapterTests({
  name: "inMemoryRuntimeStore",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
});
