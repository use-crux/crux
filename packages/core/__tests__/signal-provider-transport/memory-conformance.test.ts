import { runTransportStoreConformanceTests } from "../../src/runtime/transport/testing/conformance";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";

runTransportStoreConformanceTests({
  name: "memory",
  createHarness: () => ({
    store: inMemoryRuntimeStore(),
    dispose() {},
  }),
});
