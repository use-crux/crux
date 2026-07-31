import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  context,
  droppable,
  loopRuntimeAdapter,
  prefer,
  prompt,
  tool,
  type AdapterSpec,
  type CallArgs,
  type LoopRuntimePort,
} from "../src";

describe("request representation epochs", () => {
  it("removes omitted tools at an SDK-owned provider boundary", async () => {
    const ownedTool = tool({
      description: "Owned capability.",
      input: z.object({}),
      execute: () => "done",
    });
    let activeTools: readonly string[] | undefined;
    const runtime: LoopRuntimePort<string, object> = {
      id: "representation-sdk-tools",
      capabilities: { requestPlanning: "per-step" },
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      describeModel: (model) => ({
        provider: "representation-sdk-tools",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const planned = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: [{ role: "user", content: "hello" }],
        });
        activeTools = planned.activeTools;
        return {
          status: "complete",
          raw: {},
          response: {
            text: "done",
            usage: undefined,
            finishReason: "stop",
            responseId: "response-1",
            actualModelId: "model-1",
          },
          messages: [{ role: "assistant", content: "done" }],
          steps: 1,
          stepFacts: [{
            request: planned.receipt,
            content: [{ type: "text", text: "done" }],
            finishReason: "stop",
            responseId: "response-1",
            modelId: "model-1",
          }],
          meta: {},
        };
      },
      async runStructuredAttempt() {
        throw new Error("not used");
      },
      async runStream() {
        throw new Error("not used");
      },
    };
    const reply = prompt({
      id: "sdk-tool-omission",
      use: [
        droppable(
          context({
            id: "sdk-tool-owner",
            system: "optional ".repeat(100),
            tools: { ownedTool },
          }),
        ),
      ],
      prompt: "Answer.",
    });

    await loopRuntimeAdapter(runtime).generate(reply, {
      model: "model-1",
      inputBudget: { max: 30 },
    });

    expect(activeTools).toEqual([]);
  });

  it("keeps reduced fidelity after transient headroom returns", async () => {
    const lookup = tool({
      description: "Look up a value.",
      input: z.object({ key: z.string() }),
      execute: ({ key }) => key,
    });
    const requests: CallArgs<Record<string, unknown>>[] = [];
    let calls = 0;
    const spec: AdapterSpec<object, { readonly call: number }> = {
      providerId: "representation-epoch",
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        requests.push(args);
        calls += 1;
        return {
          raw: { call: calls },
          extracted:
            calls === 1
              ? {
                  text: "",
                  toolCalls: [
                    { id: "tool-1", name: "lookup", args: { key: "a" } },
                  ],
                  usage: undefined,
                  finishReason: "tool-calls",
                  responseId: "response-1",
                  actualModelId: "model-1",
                }
              : {
                  text: "done",
                  usage: undefined,
                  finishReason: "stop",
                  responseId: "response-2",
                  actualModelId: "model-1",
                },
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: () => [{ role: "user", content: "short" }],
      mapSettings: () => ({}),
    };
    const reply = prompt({
      id: "epoch-stability",
      use: [
        prefer(
          context({ id: "epoch-full", system: "full ".repeat(80) }),
          context({ id: "epoch-compact", system: "compact" }),
        ),
      ],
      prompt: "unused",
      tools: { lookup },
    });

    const result = await adapter(spec)({}).generate(reply, {
      model: "model-1",
      messages: [{ role: "user", content: "history ".repeat(80) }],
      inputBudget: { optimizeAt: 150, max: 300 },
      maxSteps: 2,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.system).toContain("compact");
    expect(requests[1]?.system).toContain("compact");
    expect(result.steps.map((step) => step.request?.adaptations)).toEqual([
      [expect.objectContaining({ representation: "authored" })],
      [expect.objectContaining({ representation: "authored" })],
    ]);
  });

  it("replans from canonical sources when the concrete model changes", async () => {
    const plannedSystems: string[] = [];
    const runtime: LoopRuntimePort<string, object> = {
      id: "representation-model-epoch",
      capabilities: { requestPlanning: "per-step" },
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      describeModel: (model) => ({
        provider: "representation-model-epoch",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const first = await request.planStep!({
          model: "model-a",
          modelInfo: {
            provider: "representation-model-epoch",
            modelId: "model-a",
          },
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: [{ role: "user", content: "history ".repeat(50) }],
        });
        const second = await request.planStep!({
          model: "model-b",
          modelInfo: {
            provider: "representation-model-epoch",
            modelId: "model-b",
          },
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: [{ role: "user", content: "short" }],
        });
        plannedSystems.push(first.system ?? "", second.system ?? "");
        return {
          status: "complete",
          raw: {},
          response: {
            text: "done",
            usage: undefined,
            finishReason: "stop",
            responseId: "response-2",
            actualModelId: "model-b",
          },
          messages: [{ role: "assistant", content: "done" }],
          steps: 2,
          stepFacts: [
            {
              request: first.receipt,
              content: [],
              finishReason: "tool-calls",
              responseId: "response-1",
              modelId: "model-a",
            },
            {
              request: second.receipt,
              content: [{ type: "text", text: "done" }],
              finishReason: "stop",
              responseId: "response-2",
              modelId: "model-b",
            },
          ],
          meta: {},
        };
      },
      async runStructuredAttempt() {
        throw new Error("not used");
      },
      async runStream() {
        throw new Error("not used");
      },
    };
    const reply = prompt({
      id: "model-epoch-reset",
      use: [
        prefer(
          context({
            id: "model-epoch-full",
            system: "full ".repeat(80),
          }),
          context({
            id: "model-epoch-compact",
            system: "compact",
          }),
        ),
      ],
      prompt: "unused",
    });

    const result = await loopRuntimeAdapter(runtime).generate(reply, {
      model: "model-a",
      inputBudget: { optimizeAt: 150, max: 300 },
    });

    expect(plannedSystems[0]).toContain("compact");
    expect(plannedSystems[1]).toContain("full");
    expect(result.steps[0]?.request?.adaptations).toHaveLength(1);
    expect(result.steps[1]?.request?.adaptations).toEqual([]);
  });
});
