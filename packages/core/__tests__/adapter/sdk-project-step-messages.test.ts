import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  loopRuntimeAdapter,
  prompt,
  type LoopRuntimePort,
  type RequestReceipt,
} from "../../src";

const steerPrompt = prompt({
  id: "sdk-project-step-messages",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

function response(text: string) {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop" as const,
    responseId: "response-1",
    actualModelId: "model-1",
  };
}

describe("SDK projectStepMessages planning", () => {
  it("seals projectStepMessages into the first provider request without prepareStep", async () => {
    const plannedMessages: Array<readonly unknown[]> = [];
    const projectStepMessages = vi.fn(async () => [
      {
        role: "user" as const,
        content: "prioritize primary sources",
        metadata: { provenance: "agent-steering" as const },
      },
    ]);

    const runtime: LoopRuntimePort<string, object> = {
      id: "sdk-project-step-messages",
      capabilities: { requestPlanning: "per-step" },
      describeModel: (model) => ({
        provider: "sdk-project-step-messages",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const planned = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: request.system,
          systemBlocks: request.systemBlocks,
          messages: request.messages ?? [
            { role: "user", content: request.prompt ?? "" },
          ],
        });
        plannedMessages.push(planned.messages ?? []);
        return {
          status: "complete",
          raw: {},
          response: response("done"),
          messages: [
            ...(request.messages ?? []),
            { role: "assistant", content: "done" },
          ],
          steps: 1,
          stepFacts: [
            {
              request: planned.receipt as RequestReceipt,
              content: [{ type: "text", text: "done" }],
              finishReason: "stop",
              responseId: "response-1",
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

    const executor = loopRuntimeAdapter(runtime);
    await executor.generate(steerPrompt, {
      model: "model-1",
      input: { message: "start" },
      projectStepMessages,
    });

    expect(projectStepMessages).toHaveBeenCalledTimes(1);
    expect(plannedMessages[0]).toEqual([
      { role: "user", content: "start" },
      {
        role: "user",
        content: "prioritize primary sources",
        metadata: { provenance: "agent-steering" },
      },
    ]);
  });
});
