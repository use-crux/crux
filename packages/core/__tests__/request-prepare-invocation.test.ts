import { expect, it } from "vitest";
import { z } from "zod";
import {
  agent,
  createConsensus,
  createFakeAgentExecutor,
  createParallel,
  createPipeline,
  createSwarm,
} from "../src/agent";
import {
  adapter,
  context,
  prompt,
  tool,
  type AdapterResponse,
  type AdapterSpec,
  type InvocationContext,
  PreparationError,
} from "../src";
import { blackboard } from "../src/agent";

const child = agent({
  id: "writer",
  prompt: prompt({
    id: "prepare-invocation-writer",
    input: z.object({ seed: z.number() }),
    prompt: "write",
  }),
});

it("pins declared resources across callback evaluation and child resolution", async () => {
  const board = blackboard({
    id: "invocation-board",
    schema: z.object({ phase: z.string() }),
  });
  await board.patch({ phase: "draft" });
  const target = agent({
    id: "resource-child",
    prompt: prompt({
      id: "resource-child-prompt",
      use: [board],
      prompt: "hello",
    }),
  });
  let system: string | undefined;
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-invocation-resources",
    async call(_client, args) {
      system = args.system;
      return {
        raw: {},
        extracted: {
          text: "done",
          finishReason: "stop",
          responseId: "response-1",
          actualModelId: args.model,
        },
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };

  await adapter(spec)({}).pipeline({
    id: "resource-pipeline",
    context: {},
    model: "model-1",
    steps: [{ name: "child", agent: target }],
    async prepareInvocation({ resources }) {
      expect(await resources.read(board)).toEqual({ phase: "draft" });
      await board.patch({ phase: "changed" });
      return {};
    },
  });

  expect(system).toContain('"phase": "draft"');
  expect(system).not.toContain("changed");
});

it("prevents child dispatch when invocation preparation fails", async () => {
  const executor = createFakeAgentExecutor({ fallback: "echo" });
  const error = await createPipeline(executor)({
    id: "failed-preparation",
    context: { seed: 1 },
    steps: [{ name: "write", agent: child }],
    prepareInvocation() {
      throw new Error("sensitive callback detail");
    },
  }).catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(PreparationError);
  expect(error).toMatchObject({ reason: "callback" });
  expect(error.message).not.toContain("sensitive");
  expect(executor.calls).toHaveLength(0);
});

it("provides composition-specific contexts for parallel, consensus, and swarm leaves", async () => {
  const seen: InvocationContext[] = [];
  const record = (context: InvocationContext) => {
    seen.push(context);
  };
  const executor = createFakeAgentExecutor({
    fallback: { output: "yes" },
  });
  const second = agent({
    id: "reviewer",
    prompt: child.prompt,
    handoffs: [],
  });

  await createParallel(executor)({
    id: "prepared-parallel",
    context: { seed: 2 },
    agents: { writer: child, function: async () => "plain" },
    prepareInvocation: record,
  });
  await createConsensus(executor)({
    id: "prepared-consensus",
    agents: [second],
    input: { seed: 3 },
    extract: (result) => String(result.output),
    prepareInvocation: record,
  });
  await createSwarm(executor)({
    id: "prepared-swarm",
    agents: { reviewer: second },
    startAgent: "reviewer",
    input: { seed: 4 },
    prepareInvocation: record,
  });

  expect(seen).toHaveLength(3);
  expect(seen[0]).toMatchObject({
    composition: { id: "prepared-parallel", kind: "parallel" },
    branch: { name: "writer", index: 0 },
    context: { seed: 2 },
  });
  expect(seen[1]).toMatchObject({
    composition: { id: "prepared-consensus", kind: "consensus" },
    candidate: { index: 0 },
    input: { seed: 3 },
  });
  expect(seen[2]).toMatchObject({
    composition: { id: "prepared-swarm", kind: "swarm" },
    hop: { index: 0, path: ["reviewer"] },
    input: { seed: 4 },
  });
});

it("prepares managed pipeline leaves and skips function-only stages", async () => {
  const seen: InvocationContext[] = [];
  const executor = createFakeAgentExecutor({ fallback: "echo" });

  await createPipeline(executor)({
    id: "prepared-pipeline",
    context: { seed: 1 },
    steps: [
      {
        name: "derive",
        fn: async ({ seed }) => seed + 1,
      },
      {
        name: "write",
        agent: child,
      },
    ],
    prepareInvocation(context) {
      seen.push(context);
      return { model: "prepared-model" };
    },
  });

  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    operation: "language",
    target: { id: "writer", operation: "language" },
    composition: { id: "prepared-pipeline", kind: "pipeline" },
    step: { name: "write", index: 1 },
    context: { seed: 1, derive: 2 },
  });
  expect(Object.isFrozen(seen[0])).toBe(true);
  expect(executor.calls[0]?.resolvedModel).toBe("prepared-model");
});

it("layers the invocation baseline under fresh step amendments for every provider call", async () => {
  const base = context({ id: "invocation-base", system: "BASE" });
  const invocation = context({
    id: "invocation-added",
    system: "INVOCATION",
  });
  const perStep = context({ id: "step-added", system: "STEP" });
  const lookup = tool({
    description: "Look up a value.",
    input: z.object({ key: z.string() }),
    execute: ({ key }) => `value:${key}`,
  });
  const target = agent({
    id: "layered-child",
    model: "definition-model",
    prompt: prompt({
      id: "layered-child-prompt",
      use: [base],
      prompt: "hello",
      tools: { lookup },
    }),
    prepareStep: ({ index }) =>
      index === 0 ? { use: { add: [perStep] } } : undefined,
  });
  const calls: Array<{ model: string; system: string | undefined }> = [];
  const usage = {
    inputTokens: 5,
    outputTokens: 3,
    totalTokens: 8,
    inputTokenDetails: {},
    outputTokenDetails: {},
  };
  const response = (toolRound: boolean): AdapterResponse => ({
    text: toolRound ? "" : "done",
    toolCalls: toolRound
      ? [{ id: "call-1", name: "lookup", args: { key: "a" } }]
      : undefined,
    usage,
    finishReason: toolRound ? "tool-calls" : "stop",
    responseId: `response-${calls.length}`,
    actualModelId: "prepared-model",
  });
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-invocation",
    async call(_client, args) {
      calls.push({ model: args.model, system: args.system });
      return { raw: {}, extracted: response(calls.length === 1) };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages, assistant, results) => [
      ...messages,
      {
        role: "assistant",
        content: assistant.text,
        metadata: { toolCalls: assistant.toolCalls },
      },
      ...results.map((result) => ({
        role: "tool" as const,
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.name,
        },
      })),
    ],
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).pipeline({
    id: "layered-pipeline",
    context: {},
    model: "invocation-model",
    steps: [{ name: "child", agent: target }],
    prepareInvocation() {
      return {
        model: "prepared-model",
        use: {
          remove: [base],
          add: [invocation],
        },
      };
    },
  });

  expect(calls).toEqual([
    { model: "prepared-model", system: "INVOCATION\n\nSTEP" },
    { model: "prepared-model", system: "INVOCATION" },
  ]);
  expect(result.results[0]?.output).toBe("done");
  expect(result.requestReceipts).toMatchObject({
    composition: { id: "layered-pipeline", kind: "pipeline" },
    children: [
      {
        kind: "invocation",
        label: "child",
        target: { id: "layered-child", operation: "language" },
      },
    ],
  });
  const receipts = result.requestReceipts.children[0];
  expect(receipts?.kind).toBe("invocation");
  if (receipts?.kind === "invocation") {
    expect(receipts.receipts).toHaveLength(2);
    expect(receipts.receipts[1]?.previousRequestId).toBe(
      receipts.receipts[0]?.id,
    );
  }
});
