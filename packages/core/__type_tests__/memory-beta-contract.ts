import { expectTypeOf } from "vitest";
import {
  facts,
  memory,
  memoryBlock,
  type MemoryBudget,
  type MemoryCaptureConfig,
  type MemoryCaptureMode,
  type MemoryConfig,
  type MemoryEntryRenderStrategy,
  type MemorySemanticRenderStrategy,
} from "../src/memory";

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
expectTypeOf(config.budget).toMatchTypeOf<MemoryBudget | undefined>();

const semanticRender: MemorySemanticRenderStrategy = {
  strategy: "semantic",
  query: ({ input }) => String(input?.message ?? ""),
  limit: 3,
};

expectTypeOf(semanticRender).toMatchTypeOf<MemoryEntryRenderStrategy>();

facts({
  id: "semantic-facts",
  render: semanticRender,
});

facts({
  id: "latest-facts",
  render: { strategy: "list", limit: 5 },
});

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

// @ts-expect-error — semantic rendering requires an explicit query.
const invalidSemanticRender: MemoryEntryRenderStrategy = { strategy: "semantic" };

void invalidCaptureConfig;
void invalidSemanticRender;
