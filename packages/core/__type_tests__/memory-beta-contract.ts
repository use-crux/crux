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
  type MemoryTurn,
} from "../src/memory";
import type { MemoryEntry } from "../src/prompt/context-types";

const block = memoryBlock({ id: "custom", kind: "custom" });

expectTypeOf<MemoryCaptureMode>().toEqualTypeOf<
  "inline" | "deferred"
>();
expectTypeOf<MemoryCaptureConfig["mode"]>().toEqualTypeOf<
  MemoryCaptureMode | undefined
>();

const config: MemoryConfig = {
  id: "assistant-memory",
  namespace: ({ input }) => `thread:${input.threadId}`,
  capture: { mode: "deferred" },
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

expectTypeOf(dynamicMemory).toMatchTypeOf<MemoryEntry>();

const defaultCaptureConfig = {
  id: "default-capture",
  namespace: "thread:default",
  blocks: [block],
} satisfies MemoryConfig;
memory(defaultCaptureConfig);

const mutableMessages = [{ role: "user", content: "Hello" }];
const mutableToolEvents = [{ toolName: "lookup", args: { query: "Crux" } }];
const readonlyTurn: MemoryTurn = {
  messages: mutableMessages,
  toolEvents: mutableToolEvents,
};
expectTypeOf(readonlyTurn).toMatchTypeOf<MemoryTurn>();

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

const deferredCapture: MemoryCaptureConfig = { mode: "deferred" };
const inlineCapture: MemoryCaptureConfig = { mode: "inline" };

// @ts-expect-error — removed pre-1.0 mode.
const afterResponseCapture: MemoryCaptureConfig = { mode: "afterResponse" };

// @ts-expect-error — removed unsafe mode.
const detachedCapture: MemoryCaptureConfig = { mode: "detached" };

const memoryWaitUntil: MemoryCaptureConfig = {
  mode: "deferred",
  // @ts-expect-error — host retention is configured through config({ host }).
  waitUntil: (_promise: Promise<unknown>) => undefined,
};

// @ts-expect-error — semantic rendering requires an explicit query.
const invalidSemanticRender: MemoryEntryRenderStrategy = { strategy: "semantic" };

void deferredCapture;
void inlineCapture;
void afterResponseCapture;
void detachedCapture;
void memoryWaitUntil;
void invalidSemanticRender;
