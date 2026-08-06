/**
 * Runtime Engine conformance helpers.
 *
 * @module
 */

export { runStoreAdapterTests } from "./store";
export type { RunStoreAdapterTestsOptions } from "./store";
export { runStoreEffectAdapterTests } from "./store-effects";
export type {
  RunStoreEffectAdapterTestsOptions,
  StoreEffectCapability,
  StoreEffectConformanceCapabilities,
} from "./store-types";
export { runRuntimeEngineAdapterTests } from "./engine";
export type {
  RunRuntimeEngineAdapterTestsOptions,
  RuntimeEngineAdapterTestHarness,
} from "./engine";
export { runReactiveCompositeAdapterTests } from "./reactive-composites";
export type { RunReactiveCompositeAdapterTestsOptions } from "./reactive-composites";
export { createTestRuntime } from "./test-runtime";
export type {
  CreateTestRuntimeOptions,
  TestRuntime,
  TestRuntimeClock,
  TestRuntimeSettleOptions,
  TestRuntimeSettleResult,
} from "./test-runtime";
export { runSessionConformanceTests } from "../../session/testing/conformance";
export type {
  RunSessionConformanceTestsOptions,
  SessionConformanceHarness,
  SessionConformanceInput,
  SessionConformanceOutput,
  SessionConformanceWorker,
  SessionConformanceExecutionCounts,
  SessionConformanceFaultBoundary,
} from "../../session/testing/conformance";
export { runTransportStoreConformanceTests } from "../transport/testing/conformance";
export type {
  RunTransportStoreConformanceTestsOptions,
  TransportStoreConformanceHarness,
} from "../transport/testing/conformance";
