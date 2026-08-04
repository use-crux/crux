import { afterEach } from "vitest";
import { resetHooks } from "@use-crux/core";
import { runSessionConformanceTests } from "../../src/runtime/testing";
import { createMemorySessionConformanceHarness } from "./session-conformance.memory-fixture";

afterEach(() => resetHooks());

runSessionConformanceTests({
  name: "memory",
  createHarness: createMemorySessionConformanceHarness,
});
