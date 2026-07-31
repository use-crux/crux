import { describe, expect, it } from "vitest";
import {
  adapter,
  context,
  droppable,
  prompt,
  type AdapterSpec,
  type CallArgs,
  type LoopRuntimePort,
} from "../src";
import { loopRuntimeAdapter } from "../src";
import { skill } from "../src/skill";
import { LOAD_SKILL_TOOL_NAME } from "../src/skill/tools";

describe("request representation skill loops", () => {
  it("preserves a loaded Skill across a later Core use amendment", async () => {
    const systems: Array<string | undefined> = [];
    let calls = 0;
    const spec: AdapterSpec<object, object> = {
      providerId: "prepared-core-skill-loop",
      async call(_client, args) {
        systems.push(args.system);
        calls += 1;
        return {
          raw: {},
          extracted:
            calls === 1
              ? {
                  text: "",
                  toolCalls: [{
                    id: "load-core",
                    name: LOAD_SKILL_TOOL_NAME,
                    args: { name: "prepared-core-skill" },
                  }],
                  finishReason: "tool-calls",
                  responseId: "response-1",
                  actualModelId: "model-1",
                }
              : {
                  text: "done",
                  finishReason: "stop",
                  responseId: "response-2",
                  actualModelId: "model-1",
                },
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => [
        ...messages,
        { role: "user", content: "continue" },
      ],
      mapSettings: () => ({}),
    };
    const loaded = skill.inline({
      id: "prepared-core-skill",
      description: "Prepared Core procedure",
      instructions: "Keep the loaded Core procedure.",
    });
    const added = context({
      id: "prepared-core-added",
      system: "Added at the second boundary.",
    });

    await adapter(spec)({}).generate(
      prompt({
        id: "prepared-core-skill-prompt",
        use: [loaded],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        maxSteps: 2,
        prepareStep: ({ index }) =>
          index === 1 ? { use: { add: [added] } } : undefined,
      },
    );

    expect(systems[1]).toContain("Keep the loaded Core procedure.");
    expect(systems[1]).toContain("Added at the second boundary.");
  });

  it("preserves a loaded Skill across a later SDK use amendment", async () => {
    let secondSystem = "";
    const runtime: LoopRuntimePort<string, object> = {
      id: "prepared-sdk-skill-loop",
      capabilities: { requestPlanning: "per-step" },
      describeModel: (model) => ({
        provider: "prepared-sdk-skill-loop",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const first = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: [{ role: "user", content: "load it" }],
        });
        const loader = request.tools?.[LOAD_SKILL_TOOL_NAME] as {
          execute?: (
            input: { readonly name: string },
            options: { readonly toolCallId: string },
          ) => Promise<unknown>;
        };
        await loader.execute?.(
          { name: "prepared-sdk-skill" },
          { toolCallId: "load-sdk" },
        );
        const directive = await request.observer!.onStepEnd({
          request: first.receipt,
          index: 0,
          text: "",
          toolCalls: [{
            id: "load-sdk",
            name: LOAD_SKILL_TOOL_NAME,
            args: { name: "prepared-sdk-skill" },
          }],
          toolResults: [{
            toolCallId: "load-sdk",
            toolName: LOAD_SKILL_TOOL_NAME,
            output: "loaded",
          }],
          finishReason: "tool-calls",
        });
        const second = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system:
            directive.kind === "amend"
              ? directive.system
              : request.system,
          systemBlocks:
            directive.kind === "amend"
              ? directive.systemBlocks
              : request.systemBlocks,
          messages: [{ role: "user", content: "continue" }],
        });
        secondSystem = second.system ?? "";
        return {
          status: "complete",
          raw: {},
          response: {
            text: "done",
            finishReason: "stop",
            responseId: "response-2",
            actualModelId: "model-1",
          },
          messages: [{ role: "assistant", content: "done" }],
          steps: 2,
          stepFacts: [
            {
              request: first.receipt,
              content: [],
              finishReason: "tool-calls",
            },
            {
              request: second.receipt,
              content: [{ type: "text", text: "done" }],
              finishReason: "stop",
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
    const loaded = skill.inline({
      id: "prepared-sdk-skill",
      description: "Prepared SDK procedure",
      instructions: "Keep the loaded SDK procedure.",
    });
    const added = context({
      id: "prepared-sdk-added",
      system: "Added to the SDK boundary.",
    });

    await loopRuntimeAdapter(runtime).generate(
      prompt({
        id: "prepared-sdk-skill-prompt",
        use: [loaded],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        prepareStep: ({ index }) =>
          index === 1 ? { use: { add: [added] } } : undefined,
      },
    );

    expect(secondSystem).toContain("Keep the loaded SDK procedure.");
    expect(secondSystem).toContain("Added to the SDK boundary.");
  });

  it("removes newly loaded instructions after a later monotonic omission", async () => {
    const requests: CallArgs<Record<string, unknown>>[] = [];
    let calls = 0;
    const spec: AdapterSpec<object, { readonly call: number }> = {
      providerId: "representation-skill-loop",
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      countTokens: async (_client, candidate) => {
        const pressured = candidate.messages.some(
          (message) => message.content === "pressure",
        );
        if (!pressured) return 50;
        return candidate.system?.includes("Loaded optional instructions.")
          ? 200
          : 80;
      },
      async call(_client, args) {
        requests.push(args);
        calls += 1;
        return {
          raw: { call: calls },
          extracted:
            calls === 1
              ? {
                  text: "",
                  toolCalls: [{
                    id: "load-1",
                    name: LOAD_SKILL_TOOL_NAME,
                    args: { name: "optional-loaded-skill" },
                  }],
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
      appendToolRound: () => [{ role: "user", content: "pressure" }],
      mapSettings: () => ({}),
    };
    const optionalSkill = skill.inline({
      id: "optional-loaded-skill",
      description: "Optional loaded procedure",
      instructions: "Loaded optional instructions.",
    });
    const reply = prompt({
      id: "representation-loaded-skill",
      use: [
        droppable(
          context({
            id: "loaded-skill-owner",
            use: [optionalSkill],
            system: "Optional skill owner.",
          }),
        ),
      ],
      prompt: "Answer.",
    });

    await adapter(spec)({}).generate(reply, {
      model: "model-1",
      inputBudget: { optimizeAt: 100, max: 250 },
      maxSteps: 2,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.system).toContain("optional-loaded-skill");
    expect(requests[1]?.system ?? "").not.toContain(
      "Loaded optional instructions.",
    );
    expect(requests[1]?.system ?? "").not.toContain("optional-loaded-skill");
    expect(requests[1]?.tools).toEqual([]);
  });

  it("refreshes policies after skill loading in an SDK-owned loop", async () => {
    let secondSystem = "";
    let secondActiveTools: readonly string[] | undefined;
    const runtime: LoopRuntimePort<string, object> = {
      id: "representation-sdk-skill-loop",
      capabilities: { requestPlanning: "per-step" },
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      describeModel: (model) => ({
        provider: "representation-sdk-skill-loop",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const first = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: [{ role: "user", content: "load it" }],
        });
        const loader = request.tools?.[LOAD_SKILL_TOOL_NAME] as {
          execute?: (
            input: { readonly name: string },
            options: { readonly toolCallId: string },
          ) => Promise<unknown>;
        };
        await loader.execute?.(
          { name: "optional-sdk-skill" },
          { toolCallId: "load-sdk-1" },
        );
        const directive = await request.observer!.onStepEnd({
          request: first.receipt,
          index: 0,
          text: "",
          toolCalls: [{
            id: "load-sdk-1",
            name: LOAD_SKILL_TOOL_NAME,
            args: { name: "optional-sdk-skill" },
          }],
          toolResults: [{
            toolCallId: "load-sdk-1",
            toolName: LOAD_SKILL_TOOL_NAME,
            output: "loaded",
          }],
          finishReason: "tool-calls",
          usage: undefined,
        });
        const second = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: directive.kind === "amend"
            ? directive.system
            : request.system,
          systemBlocks: directive.kind === "amend"
            ? directive.systemBlocks
            : request.systemBlocks,
          messages: [{
            role: "user",
            content: "pressure ".repeat(150),
          }],
        });
        secondSystem = second.system ?? "";
        secondActiveTools = second.activeTools;
        return {
          status: "complete",
          raw: {},
          response: {
            text: "done",
            usage: undefined,
            finishReason: "stop",
            responseId: "response-2",
            actualModelId: "model-1",
          },
          messages: [{ role: "assistant", content: "done" }],
          steps: 2,
          stepFacts: [
            {
              request: first.receipt,
              content: [],
              finishReason: "tool-calls",
              responseId: "response-1",
              modelId: "model-1",
            },
            {
              request: second.receipt,
              content: [{ type: "text", text: "done" }],
              finishReason: "stop",
              responseId: "response-2",
              modelId: "model-1",
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
    const optionalSkill = skill.inline({
      id: "optional-sdk-skill",
      description: "Optional SDK procedure",
      instructions: "Loaded SDK-only instructions.",
    });

    await loopRuntimeAdapter(runtime).generate(
      prompt({
        id: "representation-sdk-loaded-skill",
        use: [
          droppable(
            context({
              id: "sdk-loaded-skill-owner",
              use: [optionalSkill],
              system: "Optional SDK skill owner.",
            }),
          ),
        ],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 650, max: 1_200 },
      },
    );

    expect(secondSystem).not.toContain("Loaded SDK-only instructions.");
    expect(secondSystem).not.toContain("optional-sdk-skill");
    expect(secondActiveTools).toEqual([]);
  });
});
