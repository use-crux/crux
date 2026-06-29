import { expectTypeOf } from "vitest";
import {
  memory,
  memoryBlock,
  type MemoryCaptureConfig,
  type MemoryCaptureMode,
  type MemoryConfig,
} from "../memory";

const block = memoryBlock({ id: "custom", kind: "custom" });

expectTypeOf<MemoryCaptureMode>().toEqualTypeOf<
  "inline" | "afterResponse" | "detached"
>();
expectTypeOf<MemoryCaptureConfig["mode"]>().toEqualTypeOf<
  MemoryCaptureMode | undefined
>();

const config: MemoryConfig = {
  id: "assistant-memory",
  namespace: ({ input }) => `thread:${input.threadId}`,
  capture: { mode: "afterResponse" },
  blocks: [block],
};

expectTypeOf(config.capture).toMatchTypeOf<MemoryCaptureConfig | undefined>();

const dynamicMemory = memory(config);

dynamicMemory.proposals.list({ input: { threadId: "t1" }, promptId: "prompt" });
dynamicMemory.proposals.approve("proposal_1", {
  input: { threadId: "t1" },
  edit: { content: "updated" },
});
dynamicMemory.proposals.reject("proposal_1", {
  input: { threadId: "t1" },
  reason: "duplicate",
});
dynamicMemory.proposals.edit(
  "proposal_1",
  { content: "updated" },
  { input: { threadId: "t1" } },
);

// @ts-expect-error — capture mode names are constrained to the beta contract.
const invalidCaptureConfig: MemoryCaptureConfig = { mode: "deferred" };

void invalidCaptureConfig;
