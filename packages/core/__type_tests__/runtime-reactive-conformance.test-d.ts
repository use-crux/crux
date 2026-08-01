import { inMemoryRuntimeStore } from "@use-crux/core/runtime";
import { runReactiveCompositeAdapterTests } from "@use-crux/core/runtime/testing";

// @ts-expect-error Every conformance run must supply deterministic fault injection.
runReactiveCompositeAdapterTests({
  name: "missing-fault-hook",
  createStore: () => inMemoryRuntimeStore(),
});

runReactiveCompositeAdapterTests({
  name: "atomicity-claim-is-not-conformance",
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  // @ts-expect-error Native transaction claims cannot skip rollback testing.
  substrateAtomicTransact: true,
});
