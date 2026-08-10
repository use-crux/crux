import { expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import { createProcessLocalAgentWorkController } from "../../src/work/internal/agent-work-controller";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

function response(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}

it("replays the same Agent-tool occurrence instead of starting a second child", async () => {
  let childCalls = 0;
  const results: unknown[] = [];
  let parentCalls = 0;

  const child = agent({
    id: "occurrence-child",
    model: "child-model",
    description: "Child with stable occurrence identity",
    prompt: prompt({
      id: "occurrence-child-prompt",
      input: z.object({ topic: z.string() }),
      prompt: ({ input }) => input.topic,
    }),
  });
  const parent = agent({
    id: "occurrence-parent",
    model: "parent-model",
    prompt: prompt({
      id: "occurrence-parent-prompt",
      prompt: () => "parent",
    }),
    tools: { research: child },
  });

  const spec: AdapterSpec<object, object> = {
    providerId: "occurrence-recording",
    async call(_client, args) {
      if (args.model === "child-model") {
        childCalls += 1;
        return { raw: {}, extracted: response(`child-${childCalls}`) };
      }
      parentCalls += 1;
      if (parentCalls === 1) {
        return {
          raw: {},
          extracted: response("", [
            {
              id: "stable-call",
              name: "research",
              args: { topic: "work" },
            },
            {
              id: "stable-call",
              name: "research",
              args: { topic: "work" },
            },
          ]),
        };
      }
      return { raw: {}, extracted: response("parent finished") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, _assistant, toolResults: ToolResultEntry[]) {
      for (const entry of toolResults) {
        results.push(entry.output);
      }
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "occurrence-replay",
    context: {},
    agents: { parent },
    model: "parent-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  // Same toolCallId must not start a second child execution.
  expect(childCalls).toBe(1);
  expect(results).toEqual(["child-1", "child-1"]);
});

it("rejects conflicting Agent-tool occurrence reuse at the controller boundary", async () => {
  let starts = 0;
  const child = agent({
    id: "conflict-child",
    description: "Child used for conflict checks",
    prompt: prompt({
      id: "conflict-child-prompt",
      input: z.object({ topic: z.string() }),
      prompt: ({ input }) => input.topic,
    }),
  });
  const executor: AgentExecutor = async () => {
    starts += 1;
    return { agentId: "conflict-child", output: "ok", durationMs: 1 };
  };
  const controller = createProcessLocalAgentWorkController({
    kernel: createProcessLocalWorkKernel(),
  });
  const occurrence = {
    ownerId: "owner_exec_conflict",
    turnId: "hist:0",
    toolCallId: "stable-call",
    bindingKey: "research",
  };

  const first = await controller.spawnAgent(
    child,
    { topic: "first" },
    { executor, occurrence },
  );
  await expect(first.result()).resolves.toBe("ok");
  expect(starts).toBe(1);

  await expect(
    controller.spawnAgent(child, { topic: "second" }, { executor, occurrence }),
  ).rejects.toThrow(/conflicting input/);
  expect(starts).toBe(1);
});
